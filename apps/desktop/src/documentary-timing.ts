import { createHash } from "node:crypto";
import { mkdir, stat, rename } from "node:fs/promises";
import { join } from "node:path";
import type { Project, Scene } from "@gold-work/shared";
import type { LocalProjectStorage } from "./local-project-storage.js";
import { inspectNarration, runFfmpeg } from "./standard-renderer.js";
import { applyNarrationSlice } from "./narration-timing.js";

/** Original TTS/checkpoints stay untouched; Player and render use the same local audio. */
export async function prepareDocumentaryTiming(project: Project, storage: LocalProjectStorage, options: { prepareAudio?: boolean } = {}): Promise<Scene[]> {
  if (project.mediaMode !== "stock" || project.settings.assembly.documentary?.version !== 2) return project.scenes;
  const prepareAudio = options.prepareAudio !== false;
  const audioInfo = new Map<string, ReturnType<typeof inspectNarration>>();
  const root = join(storage.projectDirectory(project.id), "Documentary", "Narration");
  await mkdir(root, { recursive: true });
  const scenes: Scene[] = [];
  for (const scene of project.scenes) {
    if (!scene.documentary || scene.includeInAssembly === false) { scenes.push(scene); continue; }
    const audioPath = project.settings.voice.enabled ? scene.audioPath : undefined;
    if (!audioPath) {
      if (project.settings.voice.enabled && scene.narration.trim()) throw new Error(`Сцена ${scene.order + 1}: озвучка ещё не готова`);
      scenes.push({ ...scene, documentary: { ...scene.documentary, timing: { sourceKey: "silent", durationInFrames: Math.ceil(Math.max(scene.durationSeconds, scene.durationOverrideSeconds ?? 0) * 30), speechSeconds: 0 } } });
      continue;
    }
    const info = await stat(audioPath);
    const keyFor = (prepared: boolean) => createHash("sha256").update(JSON.stringify([5, prepared, audioPath, info.size, info.mtimeMs, scene.narrationSlice, scene.durationOverrideSeconds, project.settings.assembly.audioNormalize])).digest("hex");
    const sourceKey = keyFor(prepareAudio);
    const existing = scene.documentary.timing;
    if (existing && (existing.sourceKey === sourceKey || !prepareAudio && existing.sourceKey === keyFor(true)) && existing.audioPath && await stat(existing.audioPath).then(file => file.size > 0, () => false)) { scenes.push(scene); continue; }
    // Going back to selection must not discard a prepared WAV. Going forward
    // can reuse the measured source range instead of scanning all voices again.
    const measuredRange = prepareAudio && existing?.sourceKey === keyFor(false) && existing.audioStartSeconds !== undefined && existing.audioEndSeconds !== undefined;
    if (!measuredRange && !audioInfo.has(audioPath)) audioInfo.set(audioPath, inspectNarration(audioPath));
    const measured = measuredRange ? {speechStartSeconds:existing.audioStartSeconds!,speechEndSeconds:existing.audioEndSeconds!,durationSeconds:existing.audioEndSeconds!} : applyNarrationSlice(scene, await audioInfo.get(audioPath)!);
    const start = measured.speechStartSeconds;
    const end = measured.speechEndSeconds > start ? measured.speechEndSeconds : measured.durationSeconds;
    const speechSeconds = end - start;
    if (!(speechSeconds > 0)) throw new Error(`Сцена ${scene.order + 1}: пустая озвучка`);
    const tail = scene.narrationSlice && !scene.narrationSlice.last ? 0 : 0.2;
    const durationInFrames = Math.ceil(Math.max(speechSeconds + tail, scene.durationOverrideSeconds ?? 0) * 30 - 1e-6);
    // Selection needs the measured duration before it chooses a video range,
    // but it does not need a converted WAV yet.  The assemble step invokes the
    // default path below and creates the exact render/preview audio once.
    if (!prepareAudio) {
      scenes.push({ ...scene, documentary: { ...scene.documentary, timing: { sourceKey, audioPath, audioStartSeconds: start, audioEndSeconds: end, durationInFrames, speechSeconds } } });
      continue;
    }
    const output = join(root, `${sourceKey}.wav`);
    let sourceAudio = audioPath;
    const normalizeWholeTrack = project.settings.assembly.audioNormalize && Boolean(scene.narrationSlice);
    if (normalizeWholeTrack) {
      const key = createHash("sha256").update(JSON.stringify([audioPath, info.size, info.mtimeMs])).digest("hex");
      sourceAudio = join(root, `normalized-${key}.wav`);
      if (!await stat(sourceAudio).then(file => file.size > 0, () => false)) {
        const temporary = join(root, `normalized-${key}.part.wav`);
        await runFfmpeg(["-y", "-i", audioPath, "-vn", "-af", "loudnorm=I=-18:TP=-2:LRA=11", "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", temporary]);
        await rename(temporary, sourceAudio);
      }
    }
    if (scene.narrationSlice) {
      // A continuous voice needs one source and adjacent ranges, not one FFmpeg process per shot.
      scenes.push({ ...scene, documentary: { ...scene.documentary, timing: { sourceKey, audioPath: sourceAudio, audioStartSeconds: start, audioEndSeconds: end, durationInFrames, speechSeconds } } });
      continue;
    }
    const temporary = join(root, `${sourceKey}.part.wav`);
    await runFfmpeg(["-y", "-i", sourceAudio, "-vn", "-af", `atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,${project.settings.assembly.audioNormalize && !normalizeWholeTrack ? "loudnorm=I=-18:TP=-2:LRA=11," : ""}apad,atrim=duration=${durationInFrames / 30}`,
      "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", temporary]);
    await rename(temporary, output);
    scenes.push({ ...scene, documentary: { ...scene.documentary, timing: { sourceKey, audioPath: output, durationInFrames, speechSeconds } } });
  }
  return scenes;
}
