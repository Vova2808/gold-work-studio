import {
  MOTION_KINDS,
  TRANSITION_KINDS,
  UNIVERSAL_TEMPLATE_IDS,
  type BeatMotion,
  type BeatTransition,
  type TimelineDimensions,
  type TimelineMedia,
  type TimelineText,
  type TimelineTextItem,
  type UniversalTimeline,
  type UniversalVisualBeat,
} from "./types.js";
import { DOCUMENTARY_PALETTES } from "./palette.js";

const DEFAULT_PALETTE = DOCUMENTARY_PALETTES[0]!;
const DEFAULT_ACCENT = DEFAULT_PALETTE.accentColor;
const DEFAULT_BACKGROUND = DEFAULT_PALETTE.backgroundColor;
const DEFAULT_FOREGROUND = DEFAULT_PALETTE.foregroundColor;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
// gw-media:// is Gold Work Studio's read-only Electron protocol for files from
// the application workspace. Player preview must use it directly; renderMedia
// still receives staged relative paths from the desktop adapter.
const HTTP_OR_EMBEDDED = /^(?:https?:|gw-media:|data:|blob:)/i;
const WINDOWS_ABSOLUTE = /^[a-z]:[\\/]/i;

export const DEFAULT_TIMELINE: UniversalTimeline = {
  version: 1,
  fps: 30,
  width: 1920,
  height: 1080,
  durationInFrames: 30,
  backgroundColor: DEFAULT_BACKGROUND,
  foregroundColor: DEFAULT_FOREGROUND,
  accentColor: DEFAULT_ACCENT,
  surfaceColor: DEFAULT_PALETTE.surfaceColor,
  surfaceForegroundColor: DEFAULT_PALETTE.surfaceForegroundColor,
  mutedColor: DEFAULT_PALETTE.mutedColor,
  fontFamily: "system",
  beats: [
    {
      id: "placeholder",
      fromFrame: 0,
      durationInFrames: 30,
      template: "full-media",
      media: [],
      motion: { kind: "static", strength: 0 },
      transition: { kind: "cut", durationSeconds: 0 },
    },
  ],
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const finite = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const text = (value: unknown, maxLength: number): string | undefined => {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
};

const color = (value: unknown, fallback: string): string =>
  typeof value === "string" && HEX_COLOR.test(value) ? value : fallback;

const enumValue = <T extends readonly string[]>(value: unknown, values: T, fallback: T[number]): T[number] =>
  typeof value === "string" && values.includes(value) ? (value as T[number]) : fallback;

const normalizeTextItem = (value: unknown): TimelineTextItem | undefined => {
  if (!isRecord(value)) return undefined;
  const label = text(value.label, 64);
  if (!label) return undefined;
  return { label, value: text(value.value, 64) };
};

const normalizeText = (value: unknown): TimelineText | undefined => {
  if (!isRecord(value)) return undefined;
  const items = Array.isArray(value.items)
    ? value.items.map(normalizeTextItem).filter((item): item is TimelineTextItem => Boolean(item)).slice(0, 5)
    : undefined;
  const normalized: TimelineText = {
    eyebrow: text(value.eyebrow, 48),
    headline: text(value.headline, 140),
    body: text(value.body, 360),
    leftLabel: text(value.leftLabel, 48),
    rightLabel: text(value.rightLabel, 48),
    items: items?.length ? items : undefined,
    align: value.align === "center" ? "center" : "left",
  };
  return Object.values(normalized).some(Boolean) ? normalized : undefined;
};

const normalizeMedia = (value: unknown, index: number): TimelineMedia | undefined => {
  if (!isRecord(value)) return undefined;
  const src = text(value.src, 2048);
  if (!src) return undefined;
  const kind = value.kind === "video" ? "video" : value.kind === "image" ? "image" : undefined;
  if (!kind) return undefined;
  const startFromFrame = Math.floor(clamp(finite(value.startFromFrame, 0), 0, 10_000_000));
  const requestedEnd = Math.floor(clamp(finite(value.endAtFrame, 0), 0, 10_000_000));
  return {
    id: text(value.id, 80) ?? `media-${index + 1}`,
    src,
    kind,
    fit: value.fit === "contain" ? "contain" : "cover",
    focalPoint:
      value.focalPoint === "top" ||
      value.focalPoint === "bottom" ||
      value.focalPoint === "left" ||
      value.focalPoint === "right"
        ? value.focalPoint
        : "center",
    muted: value.muted !== false,
    volume: clamp(finite(value.volume, value.muted === false ? 1 : 0), 0, 1),
    playbackRate: clamp(finite(value.playbackRate, 1), 0.5, 2),
    startFromFrame,
    endAtFrame: requestedEnd > startFromFrame ? requestedEnd : undefined,
    attribution: text(value.attribution, 180),
  };
};

const normalizeMotion = (value: unknown): BeatMotion => {
  if (!isRecord(value)) return { kind: "static", strength: 0 };
  return {
    kind: enumValue(value.kind, MOTION_KINDS, "static"),
    strength: clamp(finite(value.strength, 0.55), 0, 1),
  };
};

const normalizeTransition = (value: unknown): BeatTransition => {
  if (!isRecord(value)) return { kind: "cut", durationSeconds: 0 };
  const kind = enumValue(value.kind, TRANSITION_KINDS, "cut");
  return {
    kind,
    durationSeconds: kind === "cut" ? 0 : clamp(finite(value.durationSeconds, 0.16), 0.12, 0.18),
  };
};

const normalizeBeat = (
  value: unknown,
  index: number,
  projectAccent: string,
  fps: UniversalTimeline["fps"],
): UniversalVisualBeat | undefined => {
  if (!isRecord(value)) return undefined;
  // The component consumes frames. Seconds remain accepted only at the JSON
  // boundary so existing desktop planners can migrate without timing drift.
  const fromFrame = Math.round(
    clamp(
      finite(value.fromFrame, finite(value.startSeconds, 0) * fps),
      0,
      24 * 60 * 60 * fps,
    ),
  );
  const durationInFrames = Math.round(
    clamp(
      finite(value.durationInFrames, finite(value.durationSeconds, 3) * fps),
      Math.max(1, Math.round(0.35 * fps)),
      60 * fps,
    ),
  );
  const rawMedia = Array.isArray(value.media) ? value.media : [];
  return {
    id: text(value.id, 80) ?? `beat-${index + 1}`,
    sceneId: text(value.sceneId, 80),
    fromFrame,
    durationInFrames,
    template: enumValue(value.template, UNIVERSAL_TEMPLATE_IDS, "full-media"),
    media: rawMedia.map(normalizeMedia).filter((item): item is TimelineMedia => Boolean(item)).slice(0, 8),
    text: normalizeText(value.text),
    motion: normalizeMotion(value.motion),
    transition: normalizeTransition(value.transition),
    dim: clamp(finite(value.dim, 0), 0, 0.82),
    accentColor: color(value.accentColor, projectAccent),
  };
};

/**
 * Runtime boundary for AI/planner JSON. Unknown keys are dropped and all
 * presentation values are clamped to the product's allow-list.
 */
export const normalizeUniversalTimeline = (input: unknown): UniversalTimeline => {
  const raw = isRecord(input) ? input : {};
  const fps: UniversalTimeline["fps"] = raw.fps === 24 || raw.fps === 25 ? raw.fps : 30;
  const accentColor = color(raw.accentColor, DEFAULT_ACCENT);
  const beats = (Array.isArray(raw.beats) ? raw.beats : [])
    .map((beat, index) => normalizeBeat(beat, index, accentColor, fps))
    .filter((beat): beat is UniversalVisualBeat => Boolean(beat))
    .sort((left, right) => left.fromFrame - right.fromFrame || left.id.localeCompare(right.id));

  const maxBeatEnd = beats.reduce((max, beat) => Math.max(max, beat.fromFrame + beat.durationInFrames), 0);
  const requestedDuration = Math.round(
    clamp(
      finite(raw.durationInFrames, finite(raw.durationSeconds, maxBeatEnd / fps) * fps),
      1,
      24 * 60 * 60 * fps,
    ),
  );
  const normalizedBeats = beats.length ? beats : DEFAULT_TIMELINE.beats;

  const requestedWidth = finite(raw.width, 0);
  const requestedHeight = finite(raw.height, 0);
  const resolution = raw.resolution;
  const dimensions: TimelineDimensions =
    (requestedWidth === 720 && requestedHeight === 1280) || resolution === "720x1280"
      ? { width: 720, height: 1280 }
      : (requestedWidth === 900 && requestedHeight === 900) || resolution === "900x900"
        ? { width: 900, height: 900 }
        : (requestedWidth === 1280 && requestedHeight === 720) || resolution === "1280x720"
          ? { width: 1280, height: 720 }
          : { width: 1920, height: 1080 };

  return {
    version: 1,
    fps,
    ...dimensions,
    beats: normalizedBeats,
    durationInFrames: Math.max(requestedDuration, maxBeatEnd, 1),
    backgroundColor: color(raw.backgroundColor, DEFAULT_BACKGROUND),
    foregroundColor: color(raw.foregroundColor, DEFAULT_FOREGROUND),
    accentColor,
    surfaceColor: color(raw.surfaceColor, DEFAULT_PALETTE.surfaceColor),
    surfaceForegroundColor: color(raw.surfaceForegroundColor, DEFAULT_PALETTE.surfaceForegroundColor),
    mutedColor: color(raw.mutedColor, DEFAULT_PALETTE.mutedColor),
    fontFamily: raw.fontFamily === "serif" || raw.fontFamily === "mono" ? raw.fontFamily : "system",
  };
};

export const getTimelineDimensions = (timeline: UniversalTimeline): TimelineDimensions =>
  ({ width: timeline.width, height: timeline.height });

export const getTimelineDurationInFrames = (timeline: UniversalTimeline): number =>
  Math.max(1, Math.round(timeline.durationInFrames));

export const getBeatFrameRange = (
  beat: UniversalVisualBeat,
  fps: number,
): { from: number; durationInFrames: number; transitionInFrames: number } => {
  const beatFrom = Math.max(0, Math.round(beat.fromFrame));
  const durationInFrames = Math.max(1, Math.round(beat.durationInFrames));
  const transitionInFrames =
    beat.transition?.kind && beat.transition.kind !== "cut"
      ? Math.min(beatFrom, Math.max(1, Math.round((beat.transition.durationSeconds ?? 0.16) * fps)))
      : 0;
  return {
    from: beatFrom - transitionInFrames,
    durationInFrames: durationInFrames + transitionInFrames,
    transitionInFrames,
  };
};

export type MediaSourceKind = "remote" | "embedded" | "staged" | "file";

export const classifyMediaSource = (src: string): MediaSourceKind => {
  if (/^(?:data:|blob:)/i.test(src)) return "embedded";
  if (HTTP_OR_EMBEDDED.test(src)) return "remote";
  if (/^file:/i.test(src) || WINDOWS_ABSOLUTE.test(src) || src.startsWith("/")) return "file";
  return "staged";
};

export const toStagedAssetPath = (src: string): string =>
  src.replace(/^\.?[\\/]+/, "").replace(/\\/g, "/");
