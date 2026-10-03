import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from "remotion";
import { getBeatFrameRange, normalizeUniversalTimeline } from "./timeline.js";
import { UniversalTemplate } from "./templates.js";
import type { UniversalTimeline, UniversalVisualBeat } from "./types.js";

const BeatSequence = ({
  beat,
  timeline,
  durationInFrames,
  transitionInFrames,
}: {
  beat: UniversalVisualBeat;
  timeline: UniversalTimeline;
  durationInFrames: number;
  transitionInFrames: number;
}) => {
  const frame = useCurrentFrame();
  const transitionKind = beat.transition?.kind ?? "cut";
  const introOpacity =
    transitionInFrames > 0
      ? interpolate(frame, [0, transitionInFrames], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 1;
  const contentOpacity = transitionKind === "crossfade" ? introOpacity : 1;
  const dipOpacity = transitionKind === "dip-black" ? 1 - introOpacity : 0;

  return (
    <AbsoluteFill style={{ opacity: contentOpacity, overflow: "hidden" }}>
      <UniversalTemplate beat={beat} timeline={timeline} durationInFrames={durationInFrames} />
      {dipOpacity > 0 ? <AbsoluteFill style={{ backgroundColor: timeline.backgroundColor, opacity: dipOpacity }} /> : null}
    </AbsoluteFill>
  );
};

/**
 * One composition for both @remotion/player and renderMedia(). It renders only
 * the visual layer. Gold Work Studio muxes the authoritative FFmpeg narration
 * track after render, keeping scene timing and audio identical in both paths.
 */
export const UniversalVideo = (inputProps: UniversalTimeline) => {
  const timeline = normalizeUniversalTimeline(inputProps);

  return (
    <AbsoluteFill style={{ backgroundColor: timeline.backgroundColor, overflow: "hidden" }}>
      {timeline.beats.map((beat) => {
        const range = getBeatFrameRange(beat, timeline.fps);
        return (
          <Sequence key={beat.id} from={range.from} durationInFrames={range.durationInFrames} name={beat.id}>
            <BeatSequence
              beat={beat}
              timeline={timeline}
              durationInFrames={range.durationInFrames}
              transitionInFrames={range.transitionInFrames}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
