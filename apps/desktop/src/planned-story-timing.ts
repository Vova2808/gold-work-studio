import { createId } from "@gold-work/core";
import { countNarrationCharacters, scenarioQualityFingerprint, type Project } from "@gold-work/shared";
import { splitReadyScriptNarration } from "./ready-script.js";

/** Content was already approved. Correct its frame timing without another writer call. */
export function plannedStoryTimingPatch(project: Project): Partial<Project> | undefined {
  const calibration = project.settings.voice.calibration;
  if (project.mediaMode !== "ai" || !calibration || !Number.isFinite(calibration.charactersPerSecond)
    || calibration.charactersPerSecond <= 0) return;
  const audit = project.referenceAnalysis?.scenarioQuality;
  const previousFingerprint = scenarioQualityFingerprint(project.scenes);
  if (!audit?.complete || audit.fingerprint !== previousFingerprint) return;
  let changed = false;
  const scenes = project.scenes.flatMap(scene => {
    if (scene.includeInAssembly === false) return [{ ...scene }];
    const seconds = countNarrationCharacters(scene.narration) / calibration.charactersPerSecond;
    const parts = seconds > 9 ? splitReadyScriptNarration(scene.narration, calibration) : [{
      narration: scene.narration, durationSeconds: Math.max(0.001, Math.round(seconds * 1000) / 1000)
    }];
    changed ||= parts.length > 1 || Math.abs(parts[0]!.durationSeconds - scene.durationSeconds) > 0.001;
    return parts.map((part, index) => ({ ...scene, ...part, id: index ? createId("scene") : scene.id,
      ...(index ? { imagePrompt: `${scene.imagePrompt}\nAnother natural camera framing of the same moment; no collage.` } : {}) }));
  }).map((scene, order) => ({ ...scene, order }));
  if (!changed) return;
  if (scenes.map(scene => scene.narration).join("") !== project.scenes.map(scene => scene.narration).join("")) {
    throw new Error("Коррекция тайминга изменила текст: исходный сценарий сохранён");
  }
  const totalDurationSeconds = scenes.filter(scene => scene.includeInAssembly !== false).reduce((sum, scene) => sum + scene.durationSeconds, 0);
  return { scenes, referenceAnalysis: { ...project.referenceAnalysis!, scenes, scenarioQuality: { ...audit,
    fingerprint: scenarioQualityFingerprint(scenes), sceneCount: scenes.filter(scene => scene.includeInAssembly !== false).length,
    totalDurationSeconds, timingAdjustment: { method: "calibrated-text-split", previousFingerprint, appliedAt: new Date().toISOString() }
  } } };
}
