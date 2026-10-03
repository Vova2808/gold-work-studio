# @gold-work/remotion-video

Universal, niche-independent Remotion visual layer for Gold Work Studio. The same `UniversalVideo` component is used by `@remotion/player` in the editor and by `renderMedia()` during export.

This package does **not** render narration, music, or source audio. Desktop first creates frame-accurate, muted scene clips with FFmpeg, Remotion adds visual beats and graphics, then Desktop muxes the authoritative FFmpeg audio track back into the rendered video. This keeps preview/export timing deterministic and preserves the existing reliable audio fallback.

## Contract

`UniversalTimeline` is JSON-safe and frame-based:

```ts
{
  version: 1,
  fps: 30,
  width: 1920,
  height: 1080,
  durationInFrames: 5400,
  beats: [{
    id: "scene-1-hook",
    sceneId: "scene-1",
    fromFrame: 0,
    durationInFrames: 72,
    template: "focus-text",
    media: [{
      id: "scene-1-clip",
      src: "media/scene-001.mp4",
      kind: "video",
      muted: true,
      startFromFrame: 0,
      endAtFrame: 72
    }],
    text: {
      eyebrow: "Ключевой вопрос",
      headline: "Что произошло на самом деле?",
      align: "left"
    },
    motion: {kind: "zoom-in", strength: 0.55},
    transition: {kind: "cut"},
    dim: 0.48
  }]
}
```

Supported output sizes are `1920x1080`, `1280x720`, `720x1280`, and `900x900`. Templates switch to vertical layouts where needed. `normalizeUniversalTimeline()` also accepts `resolution`, seconds-based timing, and missing presentation values at the integration boundary, but always emits canonical frames and one of the supported dimensions.

The runtime normalizer is the safety boundary for AI output. It drops unknown keys, limits text lengths and item counts, clamps dim/motion/volume/transition values, validates colors, and replaces an unknown template or effect with a safe default. The AI may choose parameters; it cannot create React, CSS, coordinates, or a new template.

## Universal templates

The allowlist contains twelve production templates. Every project receives one of five calm documentary palettes selected deterministically from its id and title; Player preview and final render call the same palette helper, so color and card styling cannot drift. The former product gold/black colors are not composition defaults.

| ID | Intended visual role |
| --- | --- |
| `full-media` | Clean photo/video beat, optionally with a small lower-third |
| `focus-text` | Dimmed media with a short hook, question, or chapter statement |
| `fact-card` | One concrete number, fact, or quote in a restrained card |
| `evidence-card` | Framed detail plus explanatory copy; useful beyond crime stories |
| `compare-split` | Before/after, option A/B, two objects, or two points of view |
| `timeline-links` | Up to five steps, dates, causes, or connected events |
| `quick-montage` | Fast deterministic cuts across up to eight related assets; with one asset it creates three advancing crops rather than a static hold |
| `stat-callout` | Large number, amount, date, or percentage over media; accepted only for a scene that actually contains a numeric value |
| `editorial-panel` | Media plus a clean explanatory side panel, stacked into a lower panel for portrait output |
| `chapter-card` | Act or hook title split against scene media; restricted to genuine boundaries |
| `quote-card` | Editorial pull quote; accepted only when narration contains an explicit quotation |
| `checklist-grid` | Two to four steps or points in an adaptive card grid |

All animation uses deterministic `interpolate()` and `spring()` calls. There is no randomness and no niche-specific text, imagery, or styling.

## Media staging

For reliable local rendering, do not give the composition arbitrary absolute file paths. Before bundling/rendering:

1. Create a per-render staging directory, for example `<project>/remotion-stage/public`.
2. Copy or hard-link the normalized muted scene clips and any stills into `public/media` using safe generated names.
3. Put relative paths such as `media/scene-001.mp4` in `TimelineMedia.src`.
4. Pass the staging `public` directory to `bundle({publicDir})`.
5. Remove the staging directory only after render and final FFmpeg mux complete.

HTTP(S), `data:`, and `blob:` sources work directly. Absolute/file URLs are accepted for development, but staging is the production path because headless Chromium file permissions vary between environments.

When several visual beats reuse one normalized scene clip, set `startFromFrame` to the beat's offset inside that scene (and optionally `endAtFrame`). `MediaSurface` maps these values to Remotion's frame-accurate video trim properties, so the second beat continues the clip instead of restarting it from frame zero.

## Player preview

```tsx
import {Player} from "@remotion/player";
import {
  UniversalVideo,
  normalizeUniversalTimeline,
  type UniversalTimeline,
} from "@gold-work/remotion-video";

const timeline = normalizeUniversalTimeline(projectTimeline) as UniversalTimeline;

<Player
  component={UniversalVideo}
  inputProps={timeline}
  durationInFrames={timeline.durationInFrames}
  fps={timeline.fps}
  compositionWidth={timeline.width}
  compositionHeight={timeline.height}
  controls
/>
```

The editor should pass the exact same normalized `timeline` JSON later used for export. This prevents a preview-only montage implementation from drifting away from `Final.mp4`.

## Programmatic render

Build this package first so `@gold-work/remotion-video/entry` resolves to `dist/remotion-entry.js`. Desktop then uses the matching Remotion versions:

```ts
import {bundle} from "@remotion/bundler";
import {renderMedia, selectComposition} from "@remotion/renderer";
import {UNIVERSAL_COMPOSITION_ID} from "@gold-work/remotion-video";

const serveUrl = await bundle({
  entryPoint: remotionEntryPath,
  publicDir: stagePublicDir,
});

const composition = await selectComposition({
  serveUrl,
  id: UNIVERSAL_COMPOSITION_ID,
  inputProps: timeline,
});

await renderMedia({
  serveUrl,
  composition,
  inputProps: timeline,
  codec: "h264",
  outputLocation: silentRemotionPath,
  onProgress: ({progress}) => reportProgress(progress),
});
```

Afterward FFmpeg muxes the already prepared narration/music track with `silentRemotionPath` using video stream copy where possible. If bundle/render fails, Desktop should retain the current FFmpeg video result as the recoverable fallback and log that Remotion enrichment was skipped.

## Integration dependencies

All Remotion packages must use the same exact version. The current package expects `4.0.520`:

- this package: `react`, `react-dom`, `remotion`;
- editor: `@remotion/player` plus a workspace dependency on this package;
- desktop: `@remotion/bundler`, `@remotion/renderer` plus a workspace dependency on this package.

The desktop adapter should map the shared montage planner's `VisualBeat` objects to this package's structural `UniversalVisualBeat` contract. No import from `@gold-work/shared` is required here, so the composition can stay independently bundleable.

## Checks

```powershell
pnpm --filter @gold-work/remotion-video typecheck
pnpm --filter @gold-work/remotion-video test
pnpm --filter @gold-work/remotion-video build
```
