import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { storyCharacterIdentityKey, type FlowRemoteImageJob, type Project, type StoryCharacter, type UpdateProjectInput } from "@gold-work/shared";
import type { AnyModelClient } from "./anymodel-client.js";
import type { LocalProjectStorage } from "./local-project-storage.js";
import { runFfmpeg } from "./standard-renderer.js";

type Repository = { get(id: string): Promise<Project | undefined>; mutate(id: string, patch: (project: Project) => UpdateProjectInput): Promise<Project> };
type Writer = Pick<AnyModelClient, "describeStoryCharacters" | "generateStoryCharacterPortrait">;
type Storage = Pick<LocalProjectStorage, "saveStoryCharacterReference" | "ensureProject">;
const readableError = (error: unknown) => error instanceof Error ? error.message : String(error);
const fingerprint = (project: Project) => createHash("sha256").update(project.scenes.map(scene => scene.narration).join(" ").replace(/\s+/gu, " ").trim()).digest("hex");
function editable(project: Project): void {
  if (project.mediaMode !== "ai") throw new Error("Персонажи доступны в AI Story");
  if (project.status === "generating" || project.status === "paused") throw new Error("Сначала остановите или завершите производство — менять персонажей сейчас нельзя.");
}

export class StoryCharacterService {
  private active = new Set<string>();
  constructor(private readonly repository: Repository, private readonly writer: Writer, private readonly storage: Storage,
    private readonly generate: (project: Project, prompt: string, recovery: { resumeJob?: FlowRemoteImageJob; onRemoteJob: (job: FlowRemoteImageJob | undefined) => Promise<void> }) => Promise<Buffer>) {}

  private async get(id: string): Promise<Project> {
    const project = await this.repository.get(id);
    if (!project) throw new Error("Ролик не найден");
    editable(project);
    return project;
  }
  private change(id: string, patch: (project: Project) => UpdateProjectInput) {
    return this.repository.mutate(id, current => { editable(current); return patch(current); });
  }
  private async exclusive(id: string, work: () => Promise<Project>) {
    if (this.active.has(id)) throw new Error("Образы этого ролика уже создаются. Дождитесь результата.");
    this.active.add(id);
    try { return await work(); } finally { this.active.delete(id); }
  }

  prepare(id: string, progress: (message: string) => void = () => undefined): Promise<Project> {
    return this.exclusive(id, async () => {
      let project = await this.get(id);
      if (!project.scenes.length) throw new Error("Сначала подготовьте сценарий.");
      const key = fingerprint(project);
      if (project.storyCharacterPlan?.fingerprint !== key || project.storyCharacterPlan.status !== "ready") {
        progress("Персонажи: определяю участников истории и их кадры…");
        await this.change(id, () => ({ storyCharacterPlan: { fingerprint: key, status: "planning" } }));
        try {
          const descriptions = await this.writer.describeStoryCharacters(project);
          const characters: StoryCharacter[] = descriptions.map(description => {
            const old = project.storyCharacters?.find(character => character.name.toLocaleLowerCase() === description.name.toLocaleLowerCase());
            if (old) return old;
            const hero = project.characterReference;
            const heroNames = new Set(hero ? [hero.name, ...(hero.aliases ?? [])].map(name => name.trim().toLocaleLowerCase()) : []);
            const sameHero = hero && [description.name, ...description.aliases].some(name => heroNames.has(name.trim().toLocaleLowerCase()));
            return { id: randomUUID(), name: sameHero ? hero.name : description.name,
              aliases: sameHero ? [...new Set([description.name, ...description.aliases, ...(hero.aliases ?? [])])] : description.aliases,
              prompt: sameHero ? hero.characterPrompt || hero.prompt : description.prompt,
              stylePrompt: sameHero ? hero.stylePrompt || project.settings.image.style : project.settings.image.style,
              imagePath: sameHero ? hero.imagePath : undefined, status: sameHero ? "ready" : "draft" };
          });
          project = await this.change(id, current => ({ storyCharacters: characters, storyCharacterPlan: { fingerprint: key, status: "ready" },
            scenes: current.scenes.map((scene, index) => ({ ...scene, characterIds: characters.filter((_, c) => descriptions[c]!.sceneNumbers.includes(index + 1)).map(character => character.id) })) }));
        } catch (error) {
          return this.change(id, () => ({ storyCharacterPlan: { fingerprint: key, status: "failed", error: readableError(error) } }));
        }
      }
      const cast = project.storyCharacters ?? [];
      for (const [index, character] of cast.entries()) {
        // An interrupted/uncertain paid portrait is never replayed by automatic continuation.
        if (character.imagePath || character.status !== "draft") continue;
        progress(`Персонажи: создаю образ «${character.name}» (${index + 1}/${cast.length})…`);
        project = await this.render(id, character.id, character.prompt);
        if (project.storyCharacters?.find(item => item.id === character.id)?.error) break;
      }
      return this.sheet(project);
    });
  }

  regenerate(id: string, characterId: string, prompt: string): Promise<Project> {
    if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 4000) return Promise.reject(new Error("Опишите внешность персонажа (до 4000 символов)."));
    return this.exclusive(id, async () => this.sheet(await this.render(id, characterId, prompt.trim())));
  }
  private async render(id: string, characterId: string, prompt: string): Promise<Project> {
    let project = await this.get(id);
    const character = project.storyCharacters?.find(item => item.id === characterId);
    if (!character) throw new Error("Персонаж не найден в этом ролике.");
    const pending = character.pendingGeneration;
    const style = pending?.remoteJob ? pending.stylePrompt : project.settings.image.style;
    if (pending?.remoteJob && pending.prompt !== prompt) {
      throw new Error("У этого персонажа уже есть созданное изображение в Flow. Сначала получите его с прежним описанием, затем создайте новый вариант.");
    }
    project = await this.change(id, current => ({ storyCharacters: current.storyCharacters?.map(item => item.id === characterId
      ? { ...item, status: "generating", error: undefined, pendingGeneration: { prompt, stylePrompt: style, remoteJob: pending?.remoteJob } } : item) }));
    try {
      const image = await this.writer.generateStoryCharacterPortrait(prompt, style, text => this.generate(project, text, {
        resumeJob: pending?.remoteJob,
        onRemoteJob: async job => {
          if (job) await this.change(id, current => ({ storyCharacters: current.storyCharacters?.map(item => item.id !== characterId ? item
            : { ...item, pendingGeneration: { prompt, stylePrompt: style, remoteJob: job } }) }));
        },
      }));
      const imagePath = await this.storage.saveStoryCharacterReference(project, characterId, image);
      return this.change(id, current => ({ storyCharacters: current.storyCharacters?.map(item => item.id !== characterId ? item : item.imagePath
        ? { ...item, status: "ready", pendingGeneration: undefined, candidate: { imagePath, prompt, stylePrompt: style, createdAt: new Date().toISOString() } }
        : { ...item, imagePath, prompt, stylePrompt: style, status: "ready", error: undefined, pendingGeneration: undefined }) }));
    } catch (error) {
      return this.change(id, current => ({ storyCharacters: current.storyCharacters?.map(item => item.id !== characterId ? item
        : { ...item, status: item.imagePath ? "ready" : "failed", error: readableError(error) }) }));
    }
  }
  confirm(id: string, characterId: string): Promise<Project> {
    return this.exclusive(id, async () => {
      const project = await this.change(id, current => {
        const character = current.storyCharacters?.find(item => item.id === characterId);
        if (!character?.candidate) throw new Error("Сначала создайте новый вариант персонажа.");
        return { storyCharacterSheet: undefined, storyCharacters: current.storyCharacters?.map(item => item.id !== characterId ? item
          : { ...item, ...item.candidate!, candidate: undefined, status: "ready", error: undefined }) };
      });
      return this.sheet(project);
    });
  }
  private async sheet(project: Project): Promise<Project> {
    const cast = project.storyCharacters ?? [];
    if (cast.length <= 3 || cast.some(character => !character.imagePath)) return project;
    const identityKey = storyCharacterIdentityKey(cast);
    if (project.storyCharacterSheet?.identityKey === identityKey) return project;
    // Flow accepts up to three image references. A single local cast board preserves
    // all identities for group shots, without asking the image model to redraw them.
    const path = join(await this.storage.ensureProject(project), `cast-reference-${randomUUID()}.png`);
    const columns = Math.min(3, cast.length);
    const filters = cast.map((_, i) => `[${i}:v]scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:white,setsar=1[t${i}]`);
    filters.push(`${cast.map((_, i) => `[t${i}]`).join("")}xstack=inputs=${cast.length}:layout=${cast.map((_, i) => `${i % columns * 512}_${Math.floor(i / columns) * 512}`).join("|")}:fill=white[out]`);
    try {
      await runFfmpeg(["-y", ...cast.flatMap(character => ["-i", character.imagePath!]), "-filter_complex", filters.join(";"), "-map", "[out]", "-frames:v", "1", path]);
      return this.change(project.id, () => ({ storyCharacterSheet: { imagePath: path, identityKey } }));
    } catch (error) {
      return this.change(project.id, current => ({ storyCharacterPlan: { ...current.storyCharacterPlan!, error: `Не удалось собрать общий референс: ${readableError(error)}` } }));
    }
  }
}
