import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyMediaSource,
  getBeatFrameRange,
  getTimelineDurationInFrames,
  normalizeUniversalTimeline,
  toStagedAssetPath,
} from "./timeline.js";
import { DOCUMENTARY_PALETTES, selectProjectDocumentaryPalette } from "./palette.js";

test("normalizes AI JSON to allow-listed, frame-accurate values", () => {
  const timeline = normalizeUniversalTimeline({
    version: 999,
    fps: 30,
    width: 720,
    height: 1280,
    durationInFrames: 10,
    accentColor: "red",
    beats: [
      {
        id: "hook",
        fromFrame: 30,
        durationInFrames: 90,
        template: "arbitrary-ai-css",
        dim: 99,
        accentColor: "#112233",
        motion: { kind: "spin-around", strength: 10 },
        transition: { kind: "crossfade", durationSeconds: 99 },
        media: [{ id: "clip", src: "staged/hook.mp4", kind: "video", volume: 5, startFromFrame: 30.9, endAtFrame: 20 }],
        text: { headline: " Hook   text ", items: Array.from({ length: 8 }, (_, index) => ({ label: `Item ${index}` })) },
      },
    ],
  });

  assert.equal(timeline.version, 1);
  assert.deepEqual([timeline.width, timeline.height], [720, 1280]);
  assert.equal(timeline.accentColor, DOCUMENTARY_PALETTES[0]!.accentColor);
  assert.notEqual(timeline.backgroundColor, "#080808");
  assert.notEqual(timeline.accentColor, "#ebc84a");
  assert.equal(timeline.durationInFrames, 120);
  assert.equal(timeline.beats[0]?.template, "full-media");
  assert.equal(timeline.beats[0]?.dim, 0.82);
  assert.equal(timeline.beats[0]?.motion?.kind, "static");
  assert.equal(timeline.beats[0]?.motion?.strength, 1);
  assert.equal(timeline.beats[0]?.transition?.durationSeconds, 0.18);
  assert.equal(timeline.beats[0]?.media[0]?.volume, 1);
  assert.equal(timeline.beats[0]?.media[0]?.startFromFrame, 30);
  assert.equal(timeline.beats[0]?.media[0]?.endAtFrame, undefined);
  assert.equal(timeline.beats[0]?.text?.headline, "Hook text");
  assert.equal(timeline.beats[0]?.text?.items?.length, 5);
});

test("keeps a safe video subrange for later beats of the same scene", () => {
  const timeline = normalizeUniversalTimeline({
    fps: 30,
    beats: [
      {
        id: "scene-1-beat-2",
        fromFrame: 75,
        durationInFrames: 45,
        template: "full-media",
        media: [{ id: "clip", src: "media/scene-001.mp4", kind: "video", startFromFrame: 75, endAtFrame: 120 }],
      },
    ],
  });

  assert.deepEqual(
    {
      startFromFrame: timeline.beats[0]?.media[0]?.startFromFrame,
      endAtFrame: timeline.beats[0]?.media[0]?.endAtFrame,
    },
    { startFromFrame: 75, endAtFrame: 120 },
  );
});

test("accepts seconds at the boundary but emits canonical frames", () => {
  const timeline = normalizeUniversalTimeline({
    fps: 25,
    resolution: "900x900",
    durationSeconds: 3,
    beats: [{ id: "one", startSeconds: 0.4, durationSeconds: 2.2, template: "focus-text", media: [] }],
  });

  assert.deepEqual([timeline.width, timeline.height], [900, 900]);
  assert.equal(timeline.durationInFrames, 75);
  assert.equal(timeline.beats[0]?.fromFrame, 10);
  assert.equal(timeline.beats[0]?.durationInFrames, 55);
  assert.equal(getTimelineDurationInFrames(timeline), 75);
});

test("keeps all editorial additions inside the universal template allowlist", () => {
  const timeline = normalizeUniversalTimeline({
    fps: 30,
    beats: [
      { id: "stat", fromFrame: 0, durationInFrames: 60, template: "stat-callout", media: [] },
      { id: "editorial", fromFrame: 60, durationInFrames: 60, template: "editorial-panel", media: [] },
      { id: "chapter", fromFrame: 120, durationInFrames: 60, template: "chapter-card", media: [] },
      { id: "quote", fromFrame: 180, durationInFrames: 60, template: "quote-card", media: [] },
      { id: "checklist", fromFrame: 240, durationInFrames: 60, template: "checklist-grid", media: [] },
    ],
  });

  assert.deepEqual(timeline.beats.map((beat) => beat.template), ["stat-callout", "editorial-panel", "chapter-card", "quote-card", "checklist-grid"]);
});

test("transition begins before the exact beat boundary for a real overlap", () => {
  const timeline = normalizeUniversalTimeline({
    fps: 30,
    beats: [
      {
        id: "two",
        fromFrame: 90,
        durationInFrames: 60,
        template: "full-media",
        transition: { kind: "crossfade", durationSeconds: 0.3 },
        media: [],
      },
    ],
  });
  const range = getBeatFrameRange(timeline.beats[0]!, timeline.fps);
  assert.deepEqual(range, { from: 85, durationInFrames: 65, transitionInFrames: 5 });
});

test("project palettes are deterministic, varied and never use the former product colors", () => {
  const first = selectProjectDocumentaryPalette("project-alpha", "Road story");
  assert.deepEqual(first, selectProjectDocumentaryPalette("project-alpha", "Road story"));
  const choices = new Set(Array.from({ length: 20 }, (_, index) => selectProjectDocumentaryPalette(`project-${index}`, "Story").id));
  assert.ok(choices.size >= 4);
  for (const palette of DOCUMENTARY_PALETTES) {
    assert.ok(!Object.values(palette).includes("#ebc84a"));
    assert.ok(!Object.values(palette).includes("#080808"));
  }
});

test("classifies and normalizes staged media paths", () => {
  assert.equal(classifyMediaSource("https://cdn.example/video.mp4"), "remote");
  assert.equal(classifyMediaSource("data:image/png;base64,AA"), "embedded");
  assert.equal(classifyMediaSource("C:\\project\\clip.mp4"), "file");
  assert.equal(classifyMediaSource("media\\clip.mp4"), "staged");
  assert.equal(toStagedAssetPath("./media\\clip.mp4"), "media/clip.mp4");
});

test("keeps the Electron preview protocol as a directly loadable source", () => {
  assert.equal(classifyMediaSource("gw-media://local/C%3A/project/scene.mp4"), "remote");
});
