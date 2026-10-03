export const UNIVERSAL_TEMPLATE_IDS = [
  "full-media",
  "focus-text",
  "fact-card",
  "evidence-card",
  "compare-split",
  "timeline-links",
  "quick-montage",
  "stat-callout",
  "editorial-panel",
  "chapter-card",
  "quote-card",
  "checklist-grid",
] as const;

export type UniversalTemplateId = (typeof UNIVERSAL_TEMPLATE_IDS)[number];

export const MOTION_KINDS = ["static", "zoom-in", "zoom-out", "pan-left", "pan-right"] as const;
export type MotionKind = (typeof MOTION_KINDS)[number];

export const TRANSITION_KINDS = ["cut", "crossfade", "dip-black"] as const;
export type TransitionKind = (typeof TRANSITION_KINDS)[number];

export interface TimelineMedia {
  id: string;
  /**
   * `https://`, `http://` and data URLs are used directly. Local files should be
   * copied into the Remotion public directory and referenced as `staged/path.ext`.
   */
  src: string;
  kind: "image" | "video";
  fit?: "cover" | "contain";
  focalPoint?: "center" | "top" | "bottom" | "left" | "right";
  muted?: boolean;
  volume?: number;
  playbackRate?: number;
  /** Frame offset inside a normalized staged video; keeps later beats in sync instead of restarting at frame 0. */
  startFromFrame?: number;
  /** Optional exclusive end frame inside the staged video. */
  endAtFrame?: number;
  /** Optional human-readable source credit. It is metadata, not rendered automatically. */
  attribution?: string;
}

export interface TimelineTextItem {
  label: string;
  value?: string;
}

export interface TimelineText {
  eyebrow?: string;
  headline?: string;
  body?: string;
  leftLabel?: string;
  rightLabel?: string;
  items?: TimelineTextItem[];
  align?: "left" | "center";
}

export interface BeatMotion {
  kind: MotionKind;
  /** 0..1. Converted by the component to a deliberately small, safe transform. */
  strength?: number;
}

export interface BeatTransition {
  kind: TransitionKind;
  /** Bounded to 0.12..0.18 seconds for brisk non-cut transitions. */
  durationSeconds?: number;
}

/**
 * A visual beat is smaller than a narrated scene. Several beats may therefore
 * share the same sceneId while using different media or a short graphic card.
 */
export interface UniversalVisualBeat {
  id: string;
  sceneId?: string;
  /** Canonical, frame-accurate placement used by preview and render. */
  fromFrame: number;
  durationInFrames: number;
  template: UniversalTemplateId;
  media: TimelineMedia[];
  text?: TimelineText;
  motion?: BeatMotion;
  transition?: BeatTransition;
  /** Background dimming, bounded to 0..0.82. */
  dim?: number;
  /** Hex color only. Invalid colors are replaced with the project accent. */
  accentColor?: string;
}

/**
 * JSON-safe contract shared by Remotion Player preview and renderMedia().
 * This package intentionally has no dependency on @gold-work/shared: the
 * desktop planner can use structural typing or a tiny adapter.
 */
export interface UniversalTimeline extends Record<string, unknown> {
  version: 1;
  fps: 24 | 25 | 30;
  width: 720 | 900 | 1280 | 1920;
  height: 720 | 900 | 1080 | 1280;
  durationInFrames: number;
  beats: UniversalVisualBeat[];
  backgroundColor?: string;
  foregroundColor?: string;
  accentColor?: string;
  /** Light or softly tinted card surface selected once per project. */
  surfaceColor?: string;
  /** Readable ink color for the project surface. */
  surfaceForegroundColor?: string;
  /** Secondary text/line color from the same restrained palette. */
  mutedColor?: string;
  fontFamily?: "system" | "serif" | "mono";
}

export interface TimelineDimensions {
  width: UniversalTimeline["width"];
  height: UniversalTimeline["height"];
}
