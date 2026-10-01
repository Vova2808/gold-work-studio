import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { MediaSurface } from "./MediaSurface.js";
import { DOCUMENTARY_PALETTES } from "./palette.js";
import type { UniversalTimeline, UniversalVisualBeat } from "./types.js";

export interface UniversalTemplateProps {
  beat: UniversalVisualBeat;
  timeline: UniversalTimeline;
  durationInFrames: number;
}

const fontStacks: Record<NonNullable<UniversalTimeline["fontFamily"]>, string> = {
  system: "Inter, Arial, Helvetica, system-ui, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "'Cascadia Mono', Consolas, monospace",
};

const useTheme = (timeline: UniversalTimeline, beat: UniversalVisualBeat) => {
  const { width, height } = useVideoConfig();
  const fallback = DOCUMENTARY_PALETTES[0]!;
  return {
    scale: Math.min(width / 1280, height / 720),
    portrait: height > width * 1.2,
    square: Math.abs(height - width) < width * 0.12,
    background: timeline.backgroundColor ?? fallback.backgroundColor,
    foreground: timeline.foregroundColor ?? fallback.foregroundColor,
    accent: beat.accentColor ?? timeline.accentColor ?? fallback.accentColor,
    surface: timeline.surfaceColor ?? fallback.surfaceColor,
    surfaceForeground: timeline.surfaceForegroundColor ?? fallback.surfaceForegroundColor,
    muted: timeline.mutedColor ?? fallback.mutedColor,
    fontFamily: fontStacks[timeline.fontFamily ?? "system"],
  };
};

const Enter = ({ children, delay = 0, distance = 34 }: { children: ReactNode; delay?: number; distance?: number }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = spring({
    frame: Math.max(0, frame - delay),
    fps,
    config: { damping: 24, stiffness: 210, mass: 0.72 },
    durationInFrames: Math.max(6, Math.round(fps * 0.3)),
  });
  return (
    <div
      style={{
        opacity: interpolate(progress, [0, 1], [0, 1]),
        transform: `translate3d(0, ${interpolate(progress, [0, 1], [distance, 0])}px, 0)`,
      }}
    >
      {children}
    </div>
  );
};

const Eyebrow = ({ children, color, scale }: { children?: string; color: string; scale: number }) =>
  children ? (
    <div
      style={{
        color,
        fontSize: 23 * scale,
        fontWeight: 800,
        letterSpacing: 2.8 * scale,
        lineHeight: 1.2,
        textTransform: "uppercase",
        marginBottom: 20 * scale,
      }}
    >
      {children}
    </div>
  ) : null;

const Headline = ({ children, color, scale, compact = false }: { children?: string; color: string; scale: number; compact?: boolean }) =>
  children ? (
    <div
      style={{
        color,
        fontSize: (compact ? 54 : 78) * scale,
        fontWeight: 820,
        letterSpacing: -2.1 * scale,
        lineHeight: 1.04,
        textWrap: "balance",
      }}
    >
      {children}
    </div>
  ) : null;

const Body = ({ children, color, scale }: { children?: string; color: string; scale: number }) =>
  children ? (
    <div style={{ color, fontSize: 32 * scale, lineHeight: 1.32, fontWeight: 500, marginTop: 24 * scale, textWrap: "balance" }}>
      {children}
    </div>
  ) : null;

export const FullMediaTemplate = ({ beat, timeline, durationInFrames }: UniversalTemplateProps) => {
  const theme = useTheme(timeline, beat);
  const hasText = Boolean(beat.text?.headline || beat.text?.eyebrow);
  return (
    <AbsoluteFill style={{ backgroundColor: theme.background, fontFamily: theme.fontFamily }}>
      <MediaSurface
        media={beat.media[0]}
        motion={beat.motion}
        durationInFrames={durationInFrames}
        dim={hasText ? Math.max(beat.dim ?? 0, 0.2) : beat.dim}
      />
      {hasText ? (
        <AbsoluteFill style={{ justifyContent: "flex-end", padding: 108 * theme.scale }}>
          <Enter>
            <div style={{ maxWidth: 1260 * theme.scale }}>
              <Eyebrow color={theme.accent} scale={theme.scale}>{beat.text?.eyebrow}</Eyebrow>
              <Headline color={theme.foreground} scale={theme.scale} compact>{beat.text?.headline}</Headline>
            </div>
          </Enter>
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};

export const FocusTextTemplate = ({ beat, timeline, durationInFrames }: UniversalTemplateProps) => {
  const theme = useTheme(timeline, beat);
  const centered = beat.text?.align === "center";
  return (
    <AbsoluteFill style={{ backgroundColor: theme.background, color: theme.foreground, fontFamily: theme.fontFamily }}>
      <MediaSurface
        media={beat.media[0]}
        motion={beat.motion}
        durationInFrames={durationInFrames}
        dim={Math.max(0.48, beat.dim ?? 0)}
        blur={1.2 * theme.scale}
      />
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: centered ? "center" : "flex-start",
          textAlign: centered ? "center" : "left",
          padding: 150 * theme.scale,
        }}
      >
        <Enter distance={42 * theme.scale}>
          <div style={{ maxWidth: 1320 * theme.scale }}>
            <Eyebrow color={theme.accent} scale={theme.scale}>{beat.text?.eyebrow}</Eyebrow>
            <Headline color={theme.foreground} scale={theme.scale}>{beat.text?.headline}</Headline>
            <Body color="rgba(247,245,237,0.82)" scale={theme.scale}>{beat.text?.body}</Body>
          </div>
        </Enter>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const FactCardTemplate = ({ beat, timeline, durationInFrames }: UniversalTemplateProps) => {
  const theme = useTheme(timeline, beat);
  const frame = useCurrentFrame();
  const lineWidth = interpolate(frame, [0, Math.max(1, Math.min(10, durationInFrames * 0.12))], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ backgroundColor: theme.background, color: theme.foreground, fontFamily: theme.fontFamily }}>
      <MediaSurface media={beat.media[0]} motion={beat.motion} durationInFrames={durationInFrames} dim={Math.max(0.58, beat.dim ?? 0)} />
      <AbsoluteFill style={{ justifyContent: "center", padding: 132 * theme.scale }}>
        <Enter>
          <div
            style={{
              width: 1080 * theme.scale,
              padding: `${58 * theme.scale}px ${68 * theme.scale}px`,
              borderRadius: 22 * theme.scale,
              background: theme.surface,
              color: theme.surfaceForeground,
              border: `${2 * theme.scale}px solid ${theme.muted}`,
              boxShadow: `0 ${26 * theme.scale}px ${80 * theme.scale}px rgba(0,0,0,0.42)`,
              backdropFilter: "blur(16px)",
            }}
          >
            <div style={{ width: `${lineWidth * 150 * theme.scale}px`, height: 7 * theme.scale, background: theme.accent, marginBottom: 34 * theme.scale }} />
            <Eyebrow color={theme.accent} scale={theme.scale}>{beat.text?.eyebrow}</Eyebrow>
            <Headline color={theme.surfaceForeground} scale={theme.scale} compact>{beat.text?.headline}</Headline>
            <Body color={theme.surfaceForeground} scale={theme.scale}>{beat.text?.body}</Body>
          </div>
        </Enter>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Large, restrained numeric callout over the scene media. */
export const StatCalloutTemplate = ({ beat, timeline, durationInFrames }: UniversalTemplateProps) => {
  const theme = useTheme(timeline, beat);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const reveal = spring({
    frame,
    fps,
    config: { damping: 24, stiffness: 205, mass: 0.72 },
    durationInFrames: Math.max(7, Math.round(fps * 0.32)),
  });
  const lineProgress = interpolate(frame, [1, Math.max(6, Math.min(10, durationInFrames * 0.16))], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const headline = beat.text?.headline ?? "—";
  const headlineLength = Array.from(headline).length;
  const headlineSize = (headlineLength > 16 ? 92 : headlineLength > 10 ? 120 : theme.portrait ? 164 : 184) * theme.scale;

  return (
    <AbsoluteFill style={{ backgroundColor: theme.background, color: theme.foreground, fontFamily: theme.fontFamily }}>
      <MediaSurface
        media={beat.media[0]}
        motion={beat.motion}
        durationInFrames={durationInFrames}
        dim={Math.max(0.38, beat.dim ?? 0)}
      />
      <AbsoluteFill
        style={{
          background: theme.portrait
            ? `linear-gradient(180deg, transparent 20%, color-mix(in srgb, ${theme.background} 92%, transparent) 88%)`
            : `linear-gradient(90deg, color-mix(in srgb, ${theme.background} 92%, transparent) 0%, color-mix(in srgb, ${theme.background} 48%, transparent) 54%, transparent 100%)`,
        }}
      />
      <AbsoluteFill
        style={{
          justifyContent: theme.portrait ? "flex-end" : "center",
          alignItems: "flex-start",
          padding: (theme.portrait ? 82 : 104) * theme.scale,
        }}
      >
        <div
          style={{
            width: theme.portrait ? "100%" : "68%",
            maxWidth: 1120 * theme.scale,
            opacity: reveal,
            transform: `translate3d(0, ${(1 - reveal) * 30 * theme.scale}px, 0) scale(${0.96 + reveal * 0.04})`,
          }}
        >
          <div
            style={{
              width: `${Math.max(12, lineProgress * 100)}%`,
              maxWidth: 190 * theme.scale,
              height: 8 * theme.scale,
              borderRadius: 999,
              backgroundColor: theme.accent,
              marginBottom: 28 * theme.scale,
              boxShadow: `0 0 ${28 * theme.scale}px color-mix(in srgb, ${theme.accent} 45%, transparent)`,
            }}
          />
          <Eyebrow color={theme.accent} scale={theme.scale}>{beat.text?.eyebrow}</Eyebrow>
          <div
            style={{
              fontSize: headlineSize,
              fontWeight: 900,
              letterSpacing: -5 * theme.scale,
              lineHeight: 0.9,
              fontVariantNumeric: "tabular-nums",
              overflowWrap: "anywhere",
              textShadow: `0 ${16 * theme.scale}px ${48 * theme.scale}px rgba(0,0,0,0.38)`,
            }}
          >
            {headline}
          </div>
          {beat.text?.body ? (
            <div
              style={{
                maxWidth: 900 * theme.scale,
                marginTop: 28 * theme.scale,
                color: "rgba(247,245,237,0.82)",
                fontSize: 29 * theme.scale,
                fontWeight: 560,
                lineHeight: 1.28,
              }}
            >
              {beat.text.body}
            </div>
          ) : null}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Media plus a clean editorial side card; stacks vertically for portrait video. */
export const EditorialPanelTemplate = ({ beat, timeline, durationInFrames }: UniversalTemplateProps) => {
  const theme = useTheme(timeline, beat);
  const stacked = theme.portrait;
  return (
    <AbsoluteFill
      style={{
        display: "grid",
        gridTemplateColumns: stacked ? "1fr" : theme.square ? "58% 42%" : "64% 36%",
        gridTemplateRows: stacked ? "58% 42%" : "1fr",
        backgroundColor: theme.background,
        color: theme.foreground,
        fontFamily: theme.fontFamily,
      }}
    >
      <div style={{ position: "relative", minWidth: 0, minHeight: 0, overflow: "hidden" }}>
        <MediaSurface media={beat.media[0]} motion={beat.motion} durationInFrames={durationInFrames} dim={beat.dim} />
        <AbsoluteFill
          style={{
            background: stacked
              ? `linear-gradient(180deg, transparent 72%, color-mix(in srgb, ${theme.background} 48%, transparent))`
              : `linear-gradient(90deg, transparent 82%, color-mix(in srgb, ${theme.background} 36%, transparent))`,
          }}
        />
      </div>
      <div
        style={{
          position: "relative",
          minWidth: 0,
          minHeight: 0,
          display: "flex",
          alignItems: stacked ? "flex-start" : "center",
          padding: stacked
            ? `${44 * theme.scale}px ${72 * theme.scale}px ${58 * theme.scale}px`
            : `${54 * theme.scale}px ${58 * theme.scale}px`,
          background: theme.surface,
          color: theme.surfaceForeground,
          borderLeft: stacked ? undefined : `${2 * theme.scale}px solid ${theme.muted}`,
          borderTop: stacked ? `${2 * theme.scale}px solid ${theme.muted}` : undefined,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: stacked ? 72 * theme.scale : 58 * theme.scale,
            top: stacked ? 0 : 54 * theme.scale,
            width: stacked ? 112 * theme.scale : 8 * theme.scale,
            height: stacked ? 8 * theme.scale : 74 * theme.scale,
            borderRadius: 999,
            backgroundColor: theme.accent,
          }}
        />
        <Enter delay={3} distance={26 * theme.scale}>
          <div style={{ maxWidth: stacked ? 1020 * theme.scale : 540 * theme.scale }}>
            <Eyebrow color={theme.accent} scale={theme.scale}>{beat.text?.eyebrow}</Eyebrow>
            <div
              style={{
                color: theme.surfaceForeground,
                fontSize: (stacked ? 62 : theme.square ? 48 : 52) * theme.scale,
                fontWeight: 830,
                letterSpacing: -1.2 * theme.scale,
                lineHeight: 1.04,
                textWrap: "balance",
                overflowWrap: "anywhere",
              }}
            >
              {beat.text?.headline}
            </div>
            {beat.text?.body ? (
              <div
                style={{
                  color: theme.surfaceForeground,
                  fontSize: (stacked ? 29 : 25) * theme.scale,
                  lineHeight: 1.34,
                  fontWeight: 500,
                  marginTop: 22 * theme.scale,
                  textWrap: "balance",
                }}
              >
                {beat.text.body}
              </div>
            ) : null}
          </div>
        </Enter>
      </div>
    </AbsoluteFill>
  );
};

/** Act boundary: a decisive title panel paired with full-bleed scene media. */
export const ChapterCardTemplate = ({ beat, timeline, durationInFrames }: UniversalTemplateProps) => {
  const theme = useTheme(timeline, beat);
  const stacked = theme.portrait;
  return (
    <AbsoluteFill
      style={{
        display: "grid",
        gridTemplateColumns: stacked ? "1fr" : theme.square ? "47% 53%" : "42% 58%",
        gridTemplateRows: stacked ? "46% 54%" : "1fr",
        backgroundColor: theme.surface,
        color: theme.surfaceForeground,
        fontFamily: theme.fontFamily,
      }}
    >
      <div
        style={{
          order: stacked ? 2 : 1,
          minWidth: 0,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          padding: stacked ? `${56 * theme.scale}px ${70 * theme.scale}px` : `${74 * theme.scale}px ${68 * theme.scale}px`,
          borderRight: stacked ? undefined : `${2 * theme.scale}px solid ${theme.muted}`,
          borderTop: stacked ? `${2 * theme.scale}px solid ${theme.muted}` : undefined,
        }}
      >
        <Enter distance={24 * theme.scale}>
          <div>
            <div style={{ width: 88 * theme.scale, height: 7 * theme.scale, borderRadius: 999, backgroundColor: theme.accent, marginBottom: 28 * theme.scale }} />
            <Eyebrow color={theme.accent} scale={theme.scale}>{beat.text?.eyebrow}</Eyebrow>
            <Headline color={theme.surfaceForeground} scale={theme.scale} compact>{beat.text?.headline}</Headline>
            <Body color={theme.surfaceForeground} scale={theme.scale}>{beat.text?.body}</Body>
          </div>
        </Enter>
      </div>
      <div style={{ order: stacked ? 1 : 2, minWidth: 0, minHeight: 0, position: "relative", overflow: "hidden" }}>
        <MediaSurface media={beat.media[0]} motion={beat.motion} durationInFrames={durationInFrames} dim={beat.dim} />
        <div
          style={{
            position: "absolute",
            right: 34 * theme.scale,
            bottom: 24 * theme.scale,
            color: theme.foreground,
            fontSize: 20 * theme.scale,
            fontWeight: 760,
            letterSpacing: 2 * theme.scale,
            textTransform: "uppercase",
          }}
        >
          {beat.text?.eyebrow}
        </div>
      </div>
    </AbsoluteFill>
  );
};

/** Pull quote with a restrained editorial card; used only for explicit quotations. */
export const QuoteCardTemplate = ({ beat, timeline, durationInFrames }: UniversalTemplateProps) => {
  const theme = useTheme(timeline, beat);
  const width = theme.portrait ? "88%" : theme.square ? "82%" : "68%";
  return (
    <AbsoluteFill style={{ backgroundColor: theme.background, color: theme.foreground, fontFamily: theme.fontFamily }}>
      <MediaSurface media={beat.media[0]} motion={beat.motion} durationInFrames={durationInFrames} dim={Math.max(0.58, beat.dim ?? 0)} blur={1.5 * theme.scale} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: 62 * theme.scale }}>
        <Enter distance={22 * theme.scale}>
          <div
            style={{
              width,
              maxWidth: 1040 * theme.scale,
              position: "relative",
              padding: `${60 * theme.scale}px ${70 * theme.scale}px ${58 * theme.scale}px`,
              borderRadius: 18 * theme.scale,
              backgroundColor: theme.surface,
              color: theme.surfaceForeground,
              borderTop: `${8 * theme.scale}px solid ${theme.accent}`,
              boxShadow: `0 ${28 * theme.scale}px ${80 * theme.scale}px rgba(0,0,0,0.3)`,
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 18 * theme.scale,
                right: 30 * theme.scale,
                color: theme.accent,
                fontFamily: fontStacks.serif,
                fontSize: 108 * theme.scale,
                fontWeight: 800,
                lineHeight: 0.8,
              }}
            >
              “
            </div>
            <Eyebrow color={theme.accent} scale={theme.scale}>{beat.text?.eyebrow}</Eyebrow>
            <div
              style={{
                maxWidth: 900 * theme.scale,
                color: theme.surfaceForeground,
                fontFamily: fontStacks.serif,
                fontSize: (theme.portrait ? 55 : 50) * theme.scale,
                fontWeight: 650,
                letterSpacing: -1.1 * theme.scale,
                lineHeight: 1.12,
                textWrap: "balance",
              }}
            >
              {beat.text?.headline}
            </div>
            {beat.text?.body ? <Body color={theme.surfaceForeground} scale={theme.scale}>{beat.text.body}</Body> : null}
          </div>
        </Enter>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Two to four concrete steps/facts in a readable adaptive card grid. */
export const ChecklistGridTemplate = ({ beat, timeline, durationInFrames }: UniversalTemplateProps) => {
  const theme = useTheme(timeline, beat);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const items = (beat.text?.items ?? []).slice(0, 4);
  const columns = theme.portrait || items.length < 3 ? 1 : 2;
  return (
    <AbsoluteFill style={{ backgroundColor: theme.background, color: theme.foreground, fontFamily: theme.fontFamily }}>
      <MediaSurface media={beat.media[0]} motion={beat.motion} durationInFrames={durationInFrames} dim={0.78} blur={14 * theme.scale} />
      <AbsoluteFill style={{ justifyContent: "center", padding: (theme.portrait ? 68 : 90) * theme.scale }}>
        <Enter distance={20 * theme.scale}>
          <div>
            <Eyebrow color={theme.accent} scale={theme.scale}>{beat.text?.eyebrow}</Eyebrow>
            <Headline color={theme.foreground} scale={theme.scale} compact>{beat.text?.headline}</Headline>
          </div>
        </Enter>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            gap: (theme.portrait ? 22 : 24) * theme.scale,
            marginTop: 42 * theme.scale,
          }}
        >
          {items.map((item, index) => {
            const progress = spring({
              fps,
              frame: Math.max(0, frame - index * Math.max(2, Math.round(fps * 0.07))),
              config: { damping: 24, stiffness: 210, mass: 0.72 },
              durationInFrames: Math.max(6, Math.round(fps * 0.3)),
            });
            return (
              <div
                key={`${item.label}-${index}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: `${54 * theme.scale}px 1fr`,
                  gap: 22 * theme.scale,
                  alignItems: "start",
                  minHeight: (theme.portrait ? 118 : 126) * theme.scale,
                  padding: `${26 * theme.scale}px ${30 * theme.scale}px`,
                  borderRadius: 15 * theme.scale,
                  backgroundColor: theme.surface,
                  color: theme.surfaceForeground,
                  border: `${2 * theme.scale}px solid ${theme.muted}`,
                  opacity: progress,
                  transform: `translate3d(0, ${(1 - progress) * 20 * theme.scale}px, 0)`,
                }}
              >
                <div
                  style={{
                    width: 46 * theme.scale,
                    height: 46 * theme.scale,
                    display: "grid",
                    placeItems: "center",
                    borderRadius: "50%",
                    backgroundColor: theme.accent,
                    color: theme.surfaceForeground,
                    fontSize: 22 * theme.scale,
                    fontWeight: 900,
                  }}
                >
                  {item.value ?? index + 1}
                </div>
                <div style={{ fontSize: (theme.portrait ? 28 : 27) * theme.scale, lineHeight: 1.2, fontWeight: 720 }}>
                  {item.label}
                </div>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const EvidenceCardTemplate = ({ beat, timeline, durationInFrames }: UniversalTemplateProps) => {
  const theme = useTheme(timeline, beat);
  const vertical = theme.portrait || theme.square;
  return (
    <AbsoluteFill style={{ backgroundColor: theme.background, color: theme.foreground, fontFamily: theme.fontFamily }}>
      <MediaSurface media={beat.media[1] ?? beat.media[0]} motion={{ kind: "static", strength: 0 }} durationInFrames={durationInFrames} dim={0.7} blur={18 * theme.scale} />
      <AbsoluteFill
        style={{
          flexDirection: vertical ? "column" : "row",
          justifyContent: "center",
          alignItems: "center",
          gap: (vertical ? 48 : 78) * theme.scale,
          padding: (vertical ? 72 : 118) * theme.scale,
        }}
      >
        <Enter>
          <div
            style={{
              width: (vertical ? 940 : 800) * theme.scale,
              height: (vertical ? 600 : 620) * theme.scale,
              position: "relative",
              borderRadius: 18 * theme.scale,
              overflow: "hidden",
              border: `${7 * theme.scale}px solid rgba(255,255,255,0.9)`,
              boxShadow: `0 ${30 * theme.scale}px ${90 * theme.scale}px rgba(0,0,0,0.52)`,
              transform: "rotate(-1.2deg)",
            }}
          >
            <MediaSurface media={beat.media[0]} motion={beat.motion} durationInFrames={durationInFrames} />
          </div>
        </Enter>
        <Enter delay={5}>
          <div style={{ flex: vertical ? undefined : 1, maxWidth: (vertical ? 940 : 720) * theme.scale }}>
            <Eyebrow color={theme.accent} scale={theme.scale}>{beat.text?.eyebrow}</Eyebrow>
            <Headline color={theme.foreground} scale={theme.scale} compact>{beat.text?.headline}</Headline>
            <Body color="rgba(247,245,237,0.76)" scale={theme.scale}>{beat.text?.body}</Body>
          </div>
        </Enter>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const panelLabelStyle = (side: "left" | "right", scale: number, accent: string, ink: string): CSSProperties => ({
  position: "absolute",
  left: side === "left" ? 42 * scale : undefined,
  right: side === "right" ? 42 * scale : undefined,
  bottom: 38 * scale,
  padding: `${14 * scale}px ${22 * scale}px`,
  color: ink,
  backgroundColor: accent,
  borderRadius: 8 * scale,
  fontSize: 24 * scale,
  fontWeight: 850,
  letterSpacing: 1.2 * scale,
  textTransform: "uppercase",
});

export const CompareSplitTemplate = ({ beat, timeline, durationInFrames }: UniversalTemplateProps) => {
  const theme = useTheme(timeline, beat);
  return (
    <AbsoluteFill style={{ backgroundColor: theme.background, color: theme.foreground, fontFamily: theme.fontFamily }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          gridTemplateColumns: theme.portrait ? "1fr" : "1fr 1fr",
          gridTemplateRows: theme.portrait ? "1fr 1fr" : "1fr",
          gap: 8 * theme.scale,
        }}
      >
        <div style={{ position: "relative", overflow: "hidden" }}>
          <MediaSurface media={beat.media[0]} motion={beat.motion} durationInFrames={durationInFrames} dim={beat.dim} />
          {beat.text?.leftLabel ? <div style={panelLabelStyle("left", theme.scale, theme.accent, theme.surfaceForeground)}>{beat.text.leftLabel}</div> : null}
        </div>
        <div style={{ position: "relative", overflow: "hidden" }}>
          <MediaSurface media={beat.media[1] ?? beat.media[0]} motion={beat.motion} durationInFrames={durationInFrames} dim={beat.dim} />
          {beat.text?.rightLabel ? <div style={panelLabelStyle("right", theme.scale, theme.accent, theme.surfaceForeground)}>{beat.text.rightLabel}</div> : null}
        </div>
      </div>
      {beat.text?.headline ? (
        <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center", paddingTop: 58 * theme.scale, pointerEvents: "none" }}>
          <Enter>
            <div
              style={{
                color: theme.surfaceForeground,
                backgroundColor: theme.surface,
                padding: `${18 * theme.scale}px ${34 * theme.scale}px`,
                borderRadius: 12 * theme.scale,
                fontSize: 43 * theme.scale,
                fontWeight: 820,
                boxShadow: "0 12px 40px rgba(0,0,0,0.36)",
              }}
            >
              {beat.text.headline}
            </div>
          </Enter>
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};

export const TimelineLinksTemplate = ({ beat, timeline, durationInFrames }: UniversalTemplateProps) => {
  const theme = useTheme(timeline, beat);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const items = beat.text?.items?.length ? beat.text.items : [{ label: beat.text?.body ?? "" }];
  return (
    <AbsoluteFill style={{ backgroundColor: theme.background, color: theme.foreground, fontFamily: theme.fontFamily }}>
      <MediaSurface media={beat.media[0]} motion={beat.motion} durationInFrames={durationInFrames} dim={Math.max(0.68, beat.dim ?? 0)} />
      <AbsoluteFill style={{ justifyContent: "center", padding: `${90 * theme.scale}px ${150 * theme.scale}px` }}>
        <Eyebrow color={theme.accent} scale={theme.scale}>{beat.text?.eyebrow}</Eyebrow>
        <Headline color={theme.foreground} scale={theme.scale} compact>{beat.text?.headline}</Headline>
        <div
          style={{
            display: "flex",
            flexDirection: theme.portrait ? "column" : "row",
            alignItems: theme.portrait ? "stretch" : "flex-start",
            gap: theme.portrait ? 34 * theme.scale : 0,
            marginTop: 66 * theme.scale,
            position: "relative",
          }}
        >
          <div
            style={
              theme.portrait
                ? {
                    position: "absolute",
                    left: 18 * theme.scale,
                    top: 20 * theme.scale,
                    bottom: 20 * theme.scale,
                    width: 4 * theme.scale,
                    background: "rgba(255,255,255,0.2)",
                  }
                : {
                    position: "absolute",
                    left: 20 * theme.scale,
                    right: 20 * theme.scale,
                    top: 18 * theme.scale,
                    height: 4 * theme.scale,
                    background: "rgba(255,255,255,0.2)",
                  }
            }
          />
          {items.slice(0, 5).map((item, index) => {
            const progress = spring({
              fps,
              frame: Math.max(0, frame - index * Math.max(2, Math.round(fps * 0.07))),
              config: { damping: 24, stiffness: 210, mass: 0.72 },
              durationInFrames: Math.max(6, Math.round(fps * 0.3)),
            });
            return (
              <div
                key={`${item.label}-${index}`}
                style={{
                  flex: theme.portrait ? undefined : 1,
                  display: theme.portrait ? "flex" : "block",
                  gap: theme.portrait ? 28 * theme.scale : 0,
                  alignItems: theme.portrait ? "flex-start" : undefined,
                  position: "relative",
                  opacity: progress,
                  transform: `translateY(${(1 - progress) * 22 * theme.scale}px)`,
                }}
              >
                <div style={{ width: 40 * theme.scale, height: 40 * theme.scale, borderRadius: "50%", backgroundColor: theme.accent, border: `${8 * theme.scale}px solid ${theme.background}`, boxSizing: "border-box" }} />
                <div
                  style={{
                    marginTop: theme.portrait ? 0 : 25 * theme.scale,
                    maxWidth: theme.portrait ? 760 * theme.scale : 275 * theme.scale,
                    paddingRight: 24 * theme.scale,
                  }}
                >
                  <div style={{ fontSize: 29 * theme.scale, lineHeight: 1.18, fontWeight: 760 }}>{item.label}</div>
                  {item.value ? <div style={{ color: theme.accent, fontSize: 24 * theme.scale, marginTop: 10 * theme.scale, fontWeight: 720 }}>{item.value}</div> : null}
                </div>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const QuickMontageTemplate = ({ beat, timeline, durationInFrames }: UniversalTemplateProps) => {
  const theme = useTheme(timeline, beat);
  const frame = useCurrentFrame();
  // With one scene clip (the normal automatic path), create three different
  // crops while advancing the source offset. This remains a montage instead
  // of degenerating into a long static shot, without requiring extra stock.
  const assets = beat.media.length > 1
    ? beat.media
    : beat.media[0]
      ? [beat.media[0], beat.media[0], beat.media[0]]
      : [undefined];
  const segment = Math.max(1, Math.floor(durationInFrames / assets.length));
  const activeIndex = Math.min(assets.length - 1, Math.max(0, Math.floor(frame / segment)));
  const baseAsset = assets[activeIndex];
  const activeAsset = baseAsset && beat.media.length === 1
    ? {
        ...baseAsset,
        startFromFrame: (baseAsset.startFromFrame ?? 0) + activeIndex * segment,
      }
    : baseAsset;
  const montageMotions = [
    { kind: "zoom-in", strength: 0.72 },
    { kind: "pan-left", strength: 0.5 },
    { kind: "zoom-out", strength: 0.68 },
    { kind: "pan-right", strength: 0.5 },
  ] as const;
  const segmentFrame = frame % segment;
  const flash =
    segment > 5
      ? interpolate(segmentFrame, [0, 2, 5], [0.2, 0.08, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 0;
  return (
    <AbsoluteFill style={{ backgroundColor: theme.background, color: theme.foreground, fontFamily: theme.fontFamily }}>
      <Sequence from={activeIndex * segment} durationInFrames={Math.min(segment, durationInFrames - activeIndex * segment)}>
        <MediaSurface
          media={activeAsset}
          motion={beat.media.length === 1 ? montageMotions[activeIndex % montageMotions.length] : beat.motion}
          durationInFrames={segment}
          dim={beat.dim}
        />
      </Sequence>
      <AbsoluteFill style={{ backgroundColor: `rgba(255,255,255,${flash})` }} />
      {beat.text?.headline ? (
        <AbsoluteFill style={{ justifyContent: "flex-end", padding: 100 * theme.scale }}>
          <div style={{ maxWidth: 1180 * theme.scale }}>
            <Eyebrow color={theme.accent} scale={theme.scale}>{beat.text?.eyebrow}</Eyebrow>
            <Headline color={theme.foreground} scale={theme.scale} compact>{beat.text.headline}</Headline>
          </div>
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};

export const UniversalTemplate = (props: UniversalTemplateProps) => {
  switch (props.beat.template) {
    case "focus-text":
      return <FocusTextTemplate {...props} />;
    case "fact-card":
      return <FactCardTemplate {...props} />;
    case "evidence-card":
      return <EvidenceCardTemplate {...props} />;
    case "compare-split":
      return <CompareSplitTemplate {...props} />;
    case "timeline-links":
      return <TimelineLinksTemplate {...props} />;
    case "quick-montage":
      return <QuickMontageTemplate {...props} />;
    case "stat-callout":
      return <StatCalloutTemplate {...props} />;
    case "editorial-panel":
      return <EditorialPanelTemplate {...props} />;
    case "chapter-card":
      return <ChapterCardTemplate {...props} />;
    case "quote-card":
      return <QuoteCardTemplate {...props} />;
    case "checklist-grid":
      return <ChecklistGridTemplate {...props} />;
    case "full-media":
    default:
      return <FullMediaTemplate {...props} />;
  }
};
