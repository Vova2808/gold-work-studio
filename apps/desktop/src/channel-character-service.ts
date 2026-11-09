import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ChannelCharacterGeneration, ChannelCharacterGenerationInput, ChannelCharacterReference, ChannelProfile, FlowRemoteImageJob, Project } from "@gold-work/shared";
import type { ChannelProfileStore } from "./channel-profile-store.js";
import type { LocalProjectStorage } from "./local-project-storage.js";

type Generate = (prompt: string, style: string, recovery: {
  resumeJob?: FlowRemoteImageJob;
  onRemoteJob: (job: FlowRemoteImageJob | undefined) => Promise<void>;
}) => Promise<Buffer>;

/** Channel-only mutations. Publishing or editing a hero must never rewrite a finished video. */
export class ChannelCharacterService {
  private active = new Set<string>();
  constructor(private readonly profiles: ChannelProfileStore,
    private readonly projects: { get(id: string): Promise<Project | undefined> },
    private readonly storage: Pick<LocalProjectStorage, "saveChannelCharacterReference">,
    private readonly generateImage: Generate) {}

  private async channel(id: string): Promise<ChannelProfile> {
    const profile = await this.profiles.get(id);
    if (!profile) throw new Error("Канал не найден");
    if (profile.direction !== "ai-story") throw new Error("Главный герой доступен только для AI Story");
    return profile;
  }

  private async exclusive(id: string, operation: () => Promise<ChannelProfile>) {
    if (this.active.has(id)) throw new Error("Образ героя этого канала уже обрабатывается. Дождитесь результата.");
    this.active.add(id);
    try { return await operation(); } finally { this.active.delete(id); }
  }

  async publish(projectId: string, characterId: string): Promise<ChannelProfile> {
    const project = await this.projects.get(projectId);
    if (!project?.channelProfileId) throw new Error("Ролик не привязан к каналу");
    const channelId = project.channelProfileId;
    return this.exclusive(channelId, async () => {
      const profile = await this.channel(channelId);
      if (project.mediaMode !== "ai") throw new Error("Персонажи доступны только для AI Story");
      const character = project.storyCharacters?.find(item => item.id === characterId);
      if (!character?.imagePath || character.status !== "ready") throw new Error("Сначала создайте и подтвердите образ персонажа в сценарии");
      // Never publish the unconfirmed candidate. Copy bytes out of the project so deleting it is safe.
      const image = await readFile(character.imagePath);
      const versionId = createHash("sha256").update(JSON.stringify([channelId, project.id, character.id,
        character.name, character.aliases, character.prompt, character.stylePrompt])).update(image).digest("hex").slice(0, 32);
      if (!profile.characterVersions.some(item => item.versionId === versionId)) {
        const now = new Date().toISOString();
        const metadata = { name: character.name, aliases: [...(character.aliases ?? [])], prompt: character.prompt,
          characterPrompt: character.prompt, stylePrompt: character.stylePrompt, updatedAt: now,
          sourceProjectId: project.id, sourceCharacterId: character.id };
        const imagePath = await this.storage.saveChannelCharacterReference(channelId, versionId, image, metadata);
        await this.profiles.addCharacterVersion(channelId, { ...metadata, channelProfileId: channelId, versionId, imagePath, createdAt: now });
      }
      return this.profiles.confirmCharacterVersion(channelId, versionId);
    });
  }

  select(channelId: string, versionId: string): Promise<ChannelProfile> {
    return this.exclusive(channelId, async () => {
      await this.channel(channelId);
      return this.profiles.confirmCharacterVersion(channelId, versionId);
    });
  }

  remove(channelId: string, versionId: string): Promise<ChannelProfile> {
    return this.exclusive(channelId, async () => {
      await this.channel(channelId);
      return this.profiles.deleteCharacterVersion(channelId, versionId);
    });
  }

  restore(channelId: string, versionId: string): Promise<ChannelProfile> {
    return this.exclusive(channelId, async () => {
      await this.channel(channelId);
      return this.profiles.restoreCharacterVersion(channelId, versionId);
    });
  }

  generate(channelId: string, input: ChannelCharacterGenerationInput): Promise<ChannelProfile> {
    return this.exclusive(channelId, async () => {
      const profile = await this.channel(channelId);
      if (typeof input?.name !== "string" || !input.name.trim() || input.name.length > 100
        || typeof input.prompt !== "string" || !input.prompt.trim() || input.prompt.length > 4000) {
        throw new Error("Введите имя (до 100 символов) и описание внешности (до 4000 символов)");
      }
      const source = profile.characterVersions.find(item => item.versionId === input.sourceVersionId);
      if (!source) throw new Error("Исходный образ не найден в этом канале");
      const requested = { sourceVersionId: source.versionId, name: input.name.trim(), prompt: input.prompt.trim() };
      const previous = profile.characterGeneration;
      if (previous?.remoteJob && (previous.name !== requested.name || previous.prompt !== requested.prompt
        || previous.sourceVersionId !== requested.sourceVersionId)) {
        throw new Error("Сначала получите уже созданный образ из Flow с прежним описанием. Новый запрос не отправлен.");
      }
      // A crash after persisting the image/version must not submit the same request again.
      if (previous && profile.characterVersions.some(item => item.versionId === previous.versionId)) {
        return this.profiles.setCharacterGeneration(channelId, undefined);
      }
      const generation: ChannelCharacterGeneration = previous?.remoteJob ? { ...previous, error: undefined } : {
        ...requested, versionId: randomUUID(), stylePrompt: source.stylePrompt || profile.defaultImageStyle || "",
      };
      await this.profiles.setCharacterGeneration(channelId, generation);
      try {
        const image = await this.generateImage(generation.prompt, generation.stylePrompt, {
          resumeJob: generation.remoteJob,
          onRemoteJob: async job => {
            if (job) {
              generation.remoteJob = job;
              await this.profiles.setCharacterGeneration(channelId, generation);
            }
          },
        });
        const now = new Date().toISOString();
        const metadata = { name: generation.name, aliases: [...new Set([source.name, ...(source.aliases ?? [])])],
          prompt: generation.prompt, characterPrompt: generation.prompt, stylePrompt: generation.stylePrompt, updatedAt: now };
        const imagePath = await this.storage.saveChannelCharacterReference(channelId, generation.versionId, image, metadata);
        const version: ChannelCharacterReference = { ...metadata, versionId: generation.versionId, channelProfileId: channelId,
          imagePath, createdAt: now };
        await this.profiles.addCharacterVersion(channelId, version);
        return this.profiles.setCharacterGeneration(channelId, undefined);
      } catch (error) {
        await this.profiles.setCharacterGeneration(channelId, { ...generation, error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    });
  }
}
