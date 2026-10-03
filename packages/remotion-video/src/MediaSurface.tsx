import type { CSSProperties, ReactNode } from "react";
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { classifyMediaSource, toStagedAssetPath } from "./timeline.js";
import type { BeatMotion, TimelineMedia } from "./types.js";

const focalPoint: Record<NonNullable<TimelineMedia["focalPoint"]>, string> = {
  center: "50% 50%",
  top: "50% 18%",
  bottom: "50% 82%",
  left: "18% 50%",
  right: "82% 50%",
};

export const resolveMediaSource = (src: string): string => {
  const sourceKind = classifyMediaSource(src);
  if (sourceKind === "remote" || sourceKind === "embedded") return src;
  if (sourceKind === "staged") return staticFile(toStagedAssetPath(src));
  if (/^file:/i.test(src)) return src;
  if (/^[a-z]:[\\/]/i.test(src)) return encodeURI(`file:///${src.replace(/\\/g, "/")}`);
  return encodeURI(`file://${src}`);
};

const mediaStyle = (media: TimelineMedia): CSSProperties => ({
  width: "100%",
  height: "100%",
  objectFit: media.fit ?? "cover",
  objectPosition: focalPoint[media.focalPoint ?? "center"],
  display: "block",
});

export interface MediaSurfaceProps {
  media?: TimelineMedia;
  motion?: BeatMotion;
  durationInFrames: number;
  dim?: number;
  blur?: number;
  borderRadius?: number;
  fallback?: ReactNode;
}

/**
 * Безопасная математика Ken Burns. Горизонтальное смещение всегда меньше
 * overscan от scale, поэтому даже на крайних кадрах за изображением не открывается фон.
 */
export const safeMediaMotionTransform = (
  kind: NonNullable<BeatMotion["kind"]>,
  strength: number,
  progress: number,
  width: number,
): { scale: number; translateX: number } => {
  const safeStrength = Math.min(1, Math.max(0, strength));
  const safeProgress = Math.min(1, Math.max(0, progress));
  const zoomDelta = 0.025 + safeStrength * 0.055;
  // Половина overscan = zoomDelta * width / 2. Держим pan на уровне 40%,
  // оставляя 10% запаса на округление браузером.
  const panDelta = zoomDelta * 0.4 * Math.max(1, width);
  const scale = kind === "zoom-in"
    ? 1 + zoomDelta * safeProgress
    : kind === "zoom-out"
      ? 1 + zoomDelta * (1 - safeProgress)
      : kind === "pan-left" || kind === "pan-right" ? 1 + zoomDelta : 1;
  const translateX = kind === "pan-left"
    ? panDelta * (1 - safeProgress * 2)
    : kind === "pan-right" ? -panDelta * (1 - safeProgress * 2) : 0;
  return { scale, translateX };
};

export const MediaSurface = ({
  media,
  motion,
  durationInFrames,
  dim = 0,
  blur = 0,
  borderRadius = 0,
  fallback,
}: MediaSurfaceProps) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const progress = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const strength = motion?.strength ?? 0.55;
  const kind = motion?.kind ?? "static";
  const { scale, translateX } = safeMediaMotionTransform(kind, strength, progress, width);

  const transform: CSSProperties = {
    transform: `translate3d(${translateX}px, 0, 0) scale(${scale})`,
    width: "100%",
    height: "100%",
    filter: blur > 0 ? `blur(${blur}px)` : undefined,
  };

  return (
    <AbsoluteFill style={{ overflow: "hidden", borderRadius }}>
      <div style={transform}>
        {media ? (
          media.kind === "video" ? (
            <OffthreadVideo
              src={resolveMediaSource(media.src)}
              muted={media.muted !== false}
              volume={media.muted === false ? media.volume ?? 1 : 0}
              playbackRate={media.playbackRate ?? 1}
              trimBefore={media.startFromFrame ?? 0}
              trimAfter={media.endAtFrame}
              style={mediaStyle(media)}
            />
          ) : (
            <Img src={resolveMediaSource(media.src)} style={mediaStyle(media)} />
          )
        ) : (
          fallback ?? (
            <AbsoluteFill
              style={{
                background:
                  "radial-gradient(circle at 28% 24%, rgba(92,145,181,0.2), transparent 36%), linear-gradient(135deg, #31546d, #173047 66%)",
              }}
            />
          )
        )}
      </div>
      {dim > 0 ? <AbsoluteFill style={{ backgroundColor: `rgba(0,0,0,${Math.min(0.82, Math.max(0, dim))})` }} /> : null}
    </AbsoluteFill>
  );
};
