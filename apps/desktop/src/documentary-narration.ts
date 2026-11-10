import { countNarrationCharacters, ttsLanguageCode, type Project, type QueueTask, type Scene } from "@gold-work/shared";
import type { NarrationTiming } from "./narration-timing.js";
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename } from "node:path";

export function documentaryNarrationInput(project: Project, text: string): string {
  const { provider, voice } = project.settings.voice;
  const selected = voice?.trim() || "";
  const voiceInput = provider !== "elevenlabs" && selected === "custom" ? "" : selected;
  return createHash("sha256").update(JSON.stringify([text, provider, voiceInput, provider === "elevenlabs" ? null : ttsLanguageCode(project.language)])).digest("hex");
}

export function documentarySceneNarrationFilename(project: Project, scene: Scene, audio: Buffer): string {
  const input = documentaryNarrationInput(project, scene.narration);
  const content = createHash("sha256").update(audio).digest("hex");
  return `scene-voice-${input}-${content}.mp3`;
}

const nonemptyAudio = (path: string) => stat(path).then(file => file.isFile() && file.size > 0, () => false);

/** Undefined is the pre-scene-narration format and must keep its paid shared voice intact. */
export function usesContinuousDocumentaryNarration(project: Project): boolean {
  return project.mediaMode === "stock"
    && project.settings.assembly.documentary?.version === 2
    && project.settings.assembly.documentary.narrationMode !== "scene"
    && project.settings.voice.enabled
    && project.settings.voice.singleTrack;
}

/** Reuse only the complete track for this exact text and voice, including after a restart. */
export async function hasPreparedDocumentaryNarration(project: Project): Promise<boolean> {
  const scenes = project.scenes.filter(scene => scene.includeInAssembly !== false).sort((a, b) => a.order - b.order);
  const path = scenes[0]?.audioPath;
  if (!path || scenes.some(scene => scene.audioPath !== path || !scene.narrationSlice)) return false;
  try {
    const source = JSON.parse(await readFile(`${path}.json`, "utf8"));
    return source.text === scenes.map(scene => scene.narration).join("")
      && source.voice === project.settings.voice.voice && source.provider === project.settings.voice.provider
      && JSON.stringify(source.sceneIds) === JSON.stringify(scenes.map(scene => scene.id))
      && await nonemptyAudio(path);
  } catch { return false; }
}

/** New voices carry their input identity. Older attached/imported files are kept. */
export async function preparedDocumentarySceneNarrationIds(project: Project): Promise<Set<string>> {
  const prepared = new Set<string>();
  for (const scene of project.scenes) {
    if (scene.includeInAssembly === false || !scene.audioPath || scene.narrationSlice) continue;
    const input = /^scene-voice-([a-f0-9]{64})-[a-f0-9]{64}\.mp3$/i.exec(basename(scene.audioPath))?.[1];
    if (input && input !== documentaryNarrationInput(project, scene.narration)) continue;
    if (await nonemptyAudio(scene.audioPath)) prepared.add(scene.id);
  }
  return prepared;
}

export function invalidateChangedDocumentaryNarration(before: Project, after: Project): Scene[] | undefined {
  if (after.mediaMode !== "stock" || after.settings.assembly.documentary?.version !== 2) return;
  const previous = new Map(before.scenes.map(scene => [scene.id, scene]));
  let changed = false;
  const scenes = after.scenes.map(scene => {
    const saved = previous.get(scene.id);
    if (!saved?.audioPath || scene.audioPath !== saved.audioPath
      || documentaryNarrationInput(before, saved.narration) === documentaryNarrationInput(after, scene.narration)) return scene;
    changed = true;
    return { ...scene, audioPath: undefined, narrationSlice: undefined,
      documentary: scene.documentary ? { ...scene.documentary, timing: undefined } : undefined };
  });
  return changed ? scenes : undefined;
}

export function documentaryNarrationText(project: Project, task: Pick<QueueTask, "sceneId" | "narrationSceneIds">): string {
  if (!task.narrationSceneIds) return project.scenes.find(scene => scene.id === task.sceneId)?.narration ?? "";
  const scenes = project.scenes.filter(scene => scene.includeInAssembly !== false).sort((a, b) => a.order - b.order);
  if (project.settings.assembly.documentary?.version !== 2 || JSON.stringify(scenes.map(scene => scene.id)) !== JSON.stringify(task.narrationSceneIds)) throw new Error("Состав или порядок Stock-сцен изменён после запуска общей озвучки");
  return scenes.map(scene => scene.narration).join("");
}

/** Continuous adjacent ranges; no missing/repeated narration samples at faster visual cuts. */
export function distributeDocumentaryNarration(project: Project, ids: string[], audioPath: string, timing: NarrationTiming, alignment?: number[]): Scene[] {
  const ordered = ids.map(id => project.scenes.find(scene => scene.id === id)!);
  if (ordered.some(scene => !scene)) throw new Error("Кадр общей озвучки удалён");
  const start = Math.floor(timing.speechStartSeconds * 30) / 30;
  const end = Math.min(timing.durationSeconds, Math.ceil(timing.speechEndSeconds * 30) / 30);
  if (!(end > start)) throw new Error("Общая озвучка пуста");
  if (alignment && (alignment.length !== ids.length || alignment.some((value, i) => !Number.isFinite(value) || value < 0 || value >= end || i > 0 && value <= alignment[i - 1]!) || Math.abs(alignment[0]! - start) > 1)) throw new Error("Неверная привязка сцен к озвучке; исходная дорожка сохранена");
  const weights = ordered.map(scene => Math.max(1, countNarrationCharacters(scene.narration)));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let used = 0, previous = start;
  const mapped = new Map<string, Scene>();
  ordered.forEach((scene, index) => {
    used += weights[index]!;
    let boundary = index === ordered.length - 1 ? end : alignment?.[index + 1] ?? start + (end - start) * used / total;
    if (index < ordered.length - 1) {
      const nearby = (alignment ? [] : timing.silences ?? []).map(silence => (silence.startSeconds + silence.endSeconds) / 2)
        .filter(point => point > previous + .5 && point < end - (ordered.length - index - 1) / 30 && Math.abs(point - boundary) < .3)
        .sort((a, b) => Math.abs(a - boundary) - Math.abs(b - boundary))[0];
      boundary = Math.min(end - (ordered.length - index - 1) / 30, Math.max(previous + 1 / 30, Math.round((nearby ?? boundary) * 30) / 30));
    }
    mapped.set(scene.id, { ...scene, audioPath, narrationSlice: { sourceSceneId: ids[0]!, startSeconds: previous, endSeconds: boundary, last: index === ordered.length - 1 }, documentary: scene.documentary ? { ...scene.documentary, narrationAlignment: alignment ? "audio-analysis" : "estimated", timing: undefined } : undefined });
    previous = boundary;
  });
  return project.scenes.map(scene => mapped.get(scene.id) ?? scene);
}
