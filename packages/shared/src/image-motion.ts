import type { Project, Scene } from "./index.js";

export type ImageMotionDirection = "in" | "out" | "pan-left" | "pan-right" | "pan-up" | "pan-down" | "off";
export interface ImageMotionPlan {
  direction: ImageMotionDirection;
  maximumZoom: number;
  /** Fraction of the vertical crop room, not a detected face coordinate. */
  anchorY: number;
}
type MotionProject = Pick<Project, "mediaMode" | "settings" | "characterReference">;
type MotionScene = Pick<Scene, "order" | "imagePrompt" | "kenBurnsDirection" | "autoKenBurnsDirection" | "kenBurnsZoom" | "autoKenBurnsZoom">;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const finite = (value: number | undefined): value is number => typeof value === "number" && Number.isFinite(value);

export function resolveImageMotionZoom(scene: Pick<Scene, "kenBurnsZoom" | "autoKenBurnsZoom">): number {
  return clamp(finite(scene.kenBurnsZoom) ? scene.kenBurnsZoom : finite(scene.autoKenBurnsZoom) ? scene.autoKenBurnsZoom : 1.1, 1, 1.5);
}

export function resolveImageMotionDirection(project: MotionProject, scene: MotionScene): ImageMotionDirection {
  const configured = scene.kenBurnsDirection ?? "auto";
  if (configured === "off" || configured === "in" || configured === "out") return configured;
  if (!project.settings.assembly.kenBurns) return "off";
  const direction = project.settings.assembly.kenBurnsDirection ?? "smart";
  // Visible cycle: in, out, up, down, right, left. Legacy horizontal names describe the crop direction.
  if (direction === "cycle") return (["in", "out", "pan-up", "pan-down", "pan-left", "pan-right"] as const)[Math.abs(scene.order) % 6]!;
  if (direction === "smart") {
    if (scene.autoKenBurnsDirection) return scene.autoKenBurnsDirection;
    return (["in", "pan-left", "out", "pan-right"] as const)[Math.abs(scene.order) % 4]!;
  }
  return direction === "alternate" ? scene.order % 2 === 0 ? "in" : "out" : direction;
}

/** Semantic headroom protection for AI characters; deliberately not face recognition.
 * A head can be close to the top edge even when the prompt says "medium shot".
 * Anchoring vertical crop at the top prevents Ken Burns from cutting that edge.
 * It does not reconstruct content already missing/cropped in the source image. */
function preservesHeadroom(project: MotionProject, scene: MotionScene): boolean {
  if (project.mediaMode !== "ai") return false;
  const prompt = scene.imagePrompt.toLocaleLowerCase();
  if (/\b(?:no|without)\s+(?:any\s+)?(?:people|persons?|humans?|characters?)\b|без\s+(?:людей|персонажей)/iu.test(prompt)) return false;
  const name = project.characterReference?.name.trim().toLocaleLowerCase();
  return Boolean(name && prompt.includes(name))
    || /\b(?:portrait|headshot|person|people|man|woman|boy|girl|child|character|host|soldier|warrior)\b|портрет|персонаж|человек|мужчин|женщин|реб[её]нок|ведущ(?:ий|ая)|геро[йя]/iu.test(prompt);
}

export function resolveImageMotionPlan(project: MotionProject, scene: MotionScene): ImageMotionPlan {
  const direction = resolveImageMotionDirection(project, scene);
  return {
    direction,
    maximumZoom: direction.startsWith("pan-") ? Math.max(1.08, resolveImageMotionZoom(scene)) : resolveImageMotionZoom(scene),
    anchorY: preservesHeadroom(project, scene) ? 0 : 0.5,
  };
}

/** Crop coordinates are fractions of the source; CSS translations are fractions
 * of the unscaled element. Both editor and FFmpeg use this same crop trajectory. */
export function imageMotionFrame(plan: ImageMotionPlan, progress: number) {
  const p = clamp(Number.isFinite(progress) ? progress : 0, 0, 1);
  const panning = plan.direction.startsWith("pan-");
  const zoom = plan.direction === "off" ? 1 : panning ? plan.maximumZoom
    : 1 + (plan.maximumZoom - 1) * (plan.direction === "out" ? 1 - p : p);
  const room = 1 - 1 / zoom;
  const cropX = room * (plan.direction === "pan-left" ? 1 - p : plan.direction === "pan-right" ? p : 0.5);
  const cropY = room * (plan.direction === "pan-up" ? p : plan.direction === "pan-down" ? 1 - p : plan.anchorY);
  return { zoom, cropX, cropY, translateXPercent: -cropX * zoom * 100, translateYPercent: -cropY * zoom * 100 };
}
