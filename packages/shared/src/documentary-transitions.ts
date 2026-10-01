import type { Scene } from "./index.js";
import type { DocumentaryEffect } from "./documentary.js";

type TransitionScene = { transition?: "none" | "mix" | "fade"; transitionDurationSeconds?: number; autoTransition?: "none" | "mix" | "fade"; autoTransitionDurationSeconds?: number };
type TransitionAssembly = { fadeTransitions?: boolean; transitionType?: "none" | "mix" | "fade"; transitionDurationSeconds?: number; documentary?: { autoTransitions?: boolean; autoEffects?: boolean } };
export function documentarySceneTransition(scene: TransitionScene, assembly: TransitionAssembly) {
  const automatic = (assembly.documentary?.autoTransitions ?? assembly.documentary?.autoEffects) !== false;
  const kind = scene.transitionDurationSeconds === 0 ? "none" : scene.transition
    ?? (automatic ? scene.autoTransition : undefined)
    ?? (assembly.fadeTransitions === false ? "none" : assembly.transitionType ?? "none");
  const seconds = scene.transitionDurationSeconds ?? (scene.transition === undefined && automatic ? scene.autoTransitionDurationSeconds : undefined)
    ?? assembly.transitionDurationSeconds ?? .35;
  return { kind, durationSeconds: kind === "none" ? 0 : Math.max(.05, Math.min(5, Number.isFinite(seconds) ? seconds : .35)) };
}

/** Split a complete visual effect at the cut; neither half changes narration,
 * scene length or source audio. The second half continues the same source. */
export function documentaryTransitionPair(left: Scene, right: Scene, effect: DocumentaryEffect, origin: "manual" | "automatic") {
  if (!left.documentary || !right.documentary || effect.kind === "audio") throw new Error("Для стыка нужен визуальный переход и два кадра Stock");
  const frames = Math.max(2, Math.round(effect.durationSeconds * 30));
  const leftFrames = Math.floor(frames / 2), rightFrames = frames - leftFrames;
  const length = (scene: Scene) => Math.max(scene.documentary?.timing?.durationInFrames ?? Math.ceil(scene.durationSeconds * 30), Math.ceil((scene.durationOverrideSeconds ?? 0) * 30));
  if (leftFrames > length(left) || rightFrames > length(right)) throw new Error("Этот переход длиннее соседних кадров. Выберите более короткий эффект.");
  const boundary = { from: left.id, to: right.id, origin };
  const common = { ...effect, role: "transition" as const, boundary, enabled: true };
  const defaults = { ...effect.defaults, sourceAudio: false, volume: 0 };
  return [
    { ...common, id: `${effect.id}-out`, startSeconds: (length(left) - leftFrames) / 30, durationSeconds: leftFrames / 30,
      defaults: { ...defaults, trimEndSeconds: defaults.trimStartSeconds + leftFrames / 30, fadeOutSeconds: 0 } },
    { ...common, id: `${effect.id}-in`, startSeconds: 0, durationSeconds: rightFrames / 30,
      defaults: { ...defaults, trimStartSeconds: defaults.trimStartSeconds + leftFrames / 30, trimEndSeconds: defaults.trimStartSeconds + frames / 30, fadeInSeconds: 0 } },
  ] satisfies DocumentaryEffect[];
}
