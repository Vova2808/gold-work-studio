import { imageMotionFrame, resolveImageMotionPlan, resolveProjectSceneTransitionDuration } from "@gold-work/shared";
import type { Project, Scene } from "@gold-work/shared";

export type PreviewClip = { scene: Scene; index: number; start: number; end: number; duration: number; overlapToNext: number; transition: "none" | "fade" | "mix" };
const clamp = (n: number, min = 0, max = 1) => Math.min(max, Math.max(min, n));
export const activePreviewClips = (layout: PreviewClip[], time: number) => layout.filter(entry => time >= entry.start && time <= entry.end).slice(-2);

/** No React state or media reloads in the animation clock. Same motion contract as FFmpeg. */
export function preparePreviewFrames(project: Project, layout: PreviewClip[]) {
  const plans = new Map(layout.map(entry => [entry.scene.id, resolveImageMotionPlan(project, entry.scene)]));
  return (time: number) => {
    const active = activePreviewClips(layout, time);
    const older = active[0], newer = active[1], foreground = active.at(-1);
    const progress = older && newer && older.overlapToNext > 0 ? clamp((time - newer.start) / older.overlapToNext) : 1;
    const layers = active.map(entry => {
      const video = Boolean(entry.scene.videoPath && ((project.settings.video.enabled && !entry.scene.videoFallback) || entry.scene.stockSource?.mediaType === "video"));
      const frame = imageMotionFrame(plans.get(entry.scene.id)!, clamp((time - entry.start) / entry.duration));
      let opacity = 1;
      if (newer && older) opacity = older.transition === "mix"
        ? entry === older ? 1 : progress
        : older.transition === "fade" ? Number(progress < 0.5 ? entry === older : entry === newer) : Number(entry === newer);
      return { entry, opacity, transform: video ? "scale(1)" : `translate(${frame.translateXPercent}%, ${frame.translateYPercent}%) scale(${frame.zoom})` };
    });
    let fade = 0;
    if (foreground) {
      const local = time - foreground.start;
      const previous = layout[foreground.index - 1];
      if (previous?.transition === "fade" && previous.overlapToNext > 0) {
        const duration = previous.overlapToNext;
        if (local < duration) fade = 1 - Math.abs(clamp(local / duration) * 2 - 1);
      }
      // AI transitions use an outgoing visual tail; only the final scene needs its own end fade.
      if (foreground.scene.fadeEdges || (foreground.transition === "fade" && !layout[foreground.index + 1])) {
        const duration = Math.min(resolveProjectSceneTransitionDuration(project, foreground.scene), foreground.duration / 2);
        if (duration > 0) fade = Math.max(fade, foreground.scene.fadeEdges ? 1 - clamp(local / duration) : 0, 1 - clamp((foreground.end - time) / duration));
      }
    }
    return { layers, fade: clamp(fade) };
  };
}

/** New media metadata may move earlier clips. Keep the paused cursor on the same scene. */
export function remapPreviewTime(previous: PreviewClip[], incoming: PreviewClip[], time: number): number {
  const anchor = activePreviewClips(previous, time).at(-1);
  const next = anchor && incoming.find(entry => entry.scene.id === anchor.scene.id);
  return next ? next.start + clamp(time - anchor!.start, 0, next.duration) : clamp(time, 0, incoming.at(-1)?.end ?? 0);
}
