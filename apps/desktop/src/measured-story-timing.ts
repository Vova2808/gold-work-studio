import { createId } from "@gold-work/core";
import { resolveProjectSceneTransition, resolveProjectSceneTransitionDuration, scenarioQualityFingerprint, type Project, type Scene } from "@gold-work/shared";
import { LocalProjectStorage } from "./local-project-storage.js";
import { applyNarrationSlice, planNarrationSlices } from "./narration-timing.js";
import { inspectNarration } from "./standard-renderer.js";

export class MeasuredStoryTimingExpansion extends Error {
  constructor(readonly original: Project, readonly scenes: Scene[]) {
    super("Дополнительные кадры по фактической длительности озвучки");
  }
}

/** Анализ локальных файлов. Никаких TTS/LLM-запросов; готовые медиа не удаляются. */
export async function measuredStoryTimingExpansion(project: Project, storage: LocalProjectStorage): Promise<MeasuredStoryTimingExpansion | undefined> {
  if (project.mediaMode !== "ai" || !project.settings.voice.enabled) return undefined;
  const result: Scene[] = [];
  let changed = false;
  const included = project.scenes.filter(scene => scene.includeInAssembly !== false).sort((a,b) => a.order - b.order);
  const transitionGraph = included.slice(0, -1).some(scene => resolveProjectSceneTransition(project, scene) !== "none");
  for (const scene of [...project.scenes].sort((a, b) => a.order - b.order)) {
    if (scene.includeInAssembly === false || !scene.audioPath || scene.narrationSlice) {
      result.push(scene);
      continue;
    }
    const timing = applyNarrationSlice(scene, await inspectNarration(scene.audioPath));
    // Полностью тихий placeholder не является измеренной речью.
    const speechDuration = timing.speechEndSeconds - timing.speechStartSeconds;
    if (speechDuration <= 0.2) {
      result.push(scene);
      continue;
    }
    const overlap = scene.id !== included.at(-1)?.id && transitionGraph
      ? resolveProjectSceneTransition(project, scene) === "none" ? 0.02 : resolveProjectSceneTransitionDuration(project, scene)
      : 0;
    const visualBudget = 9 - Math.min(5, Math.max(0, overlap));
    let parts = planNarrationSlices(scene.narration, timing, visualBudget);
    if (parts.length > 1) {
      // Даже последняя исходная сцена после деления получает внутренние стыки.
      const internalOverlap = resolveProjectSceneTransition(project, scene) === "none"
        ? 0.02 : resolveProjectSceneTransitionDuration(project, scene);
      parts = planNarrationSlices(scene.narration, timing, Math.min(visualBudget, 9 - Math.min(5, Math.max(0, internalOverlap))));
    }
    if (parts.map(part => part.narration).join("") !== scene.narration) {
      throw new Error("[no-retry] Разделение изменило исходный текст; проект не изменён");
    }
    if (result.length + parts.length + project.scenes.length > 3200) {
      throw new Error("[no-retry] Слишком много кадров после измерения; проверьте соответствие озвучки сценарию");
    }
    const audioPath = parts.length > 1 ? await storage.snapshotNarration(project, scene) : scene.audioPath;
    for (const [index, part] of parts.entries()) {
      result.push({
        ...scene,
        id: index === 0 ? scene.id : createId("scene"),
        title: index === 0 ? scene.title : `${scene.title} · кадр ${index + 1}`,
        narration: part.narration,
        durationSeconds: Math.max(parts.length === 1 ? Math.min(scene.durationOverrideSeconds ?? 0, visualBudget) : 0,
          part.endSeconds - part.startSeconds + (part.last ? 0.2 : 0)),
        durationOverrideSeconds: parts.length === 1 && scene.durationOverrideSeconds
          ? Math.min(scene.durationOverrideSeconds, visualBudget) : undefined,
        audioPath,
        narrationSlice: {sourceSceneId: scene.id, startSeconds: part.startSeconds, endSeconds: part.endSeconds, last: part.last},
        imagePath: index === 0 ? scene.imagePath : undefined,
        videoPath: index === 0 ? scene.videoPath : undefined,
        videoFallback: index === 0 ? scene.videoFallback : undefined,
        trimStartSeconds: index === 0 ? scene.trimStartSeconds : undefined,
        trimEndSeconds: index === 0 ? scene.trimEndSeconds : undefined,
        imagePrompt: index === 0 ? scene.imagePrompt : [
          scene.imagePrompt,
          "Additional distinct shot in the SAME scene, with the SAME characters, wardrobe, location and visual style. Use a different camera framing, not a duplicate composition.",
          `Depict specifically this part of the narration: ${part.narration.trim()}`,
          "The narration describes the action; do not print it as captions or an infographic.",
        ].join("\n"),
        status: index === 0 ? scene.status : "queued",
      });
    }
    changed = true;
  }
  if (!changed) return undefined;
  if (result.length > 1600) throw new Error("[no-retry] После измерения нужно больше 1600 кадров; проект не изменён");
  return new MeasuredStoryTimingExpansion(project, result.map((scene, order) => ({...scene, order})));
}

export function applyMeasuredStoryTiming(current: Project, expansion: MeasuredStoryTimingExpansion): Partial<Project> {
  // Пока FFmpeg читал звук, пользователь мог остановить работу/отредактировать
  // проект. Не перезаписываем изменившийся текст или вручную заменённое медиа.
  const signature = (project: Project) => JSON.stringify([project.scenes.map(scene => ({...scene, status: undefined})), project.settings]);
  if (signature(current) !== signature(expansion.original)) {
    throw new Error("[no-retry] Сцены изменились во время измерения озвучки; готовые материалы сохранены. Повторите сборку");
  }
  const scenes = expansion.scenes;
  const audit = current.referenceAnalysis?.scenarioQuality;
  const previousFingerprint = scenarioQualityFingerprint(current.scenes);
  const scenarioQuality = audit?.fingerprint === previousFingerprint ? {
    ...audit,
    fingerprint: scenarioQualityFingerprint(scenes),
    sceneCount: scenes.filter(scene => scene.includeInAssembly !== false).length,
    totalDurationSeconds: scenes.filter(scene => scene.includeInAssembly !== false).reduce((sum, scene) => sum + scene.durationSeconds, 0),
    timingAdjustment: {method: "measured-audio-split" as const, previousFingerprint, appliedAt: new Date().toISOString()},
  } : audit;
  return {
    scenes,
    outputPath: undefined,
    lastRender: undefined,
    referenceAnalysis: current.referenceAnalysis ? {...current.referenceAnalysis, scenes, scenarioQuality} : undefined,
  };
}
