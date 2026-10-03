import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { bundle } from "@remotion/bundler";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import type { Project } from "@gold-work/shared";
import { buildDocumentaryTimeline } from "@gold-work/remotion-video";
import { serveDocumentaryRenderMedia } from "../src/documentary-render-media.js";

// Read-only replay of the reported scene; does not rebuild the running app.
const root = resolve("captures/stock-photo-frame-55"); await mkdir(root, { recursive: true });
const project: Project = JSON.parse(await readFile("C:/Users/rosup/AppData/Roaming/@gold-work/desktop/projects.json", "utf8")).find((p: Project) => p.id === "project_mu9x2ywf_1s9thrt");
const scene = project.scenes.find(scene => scene.order === 54)!; assert.ok(scene.imagePath && !scene.videoPath);
project.settings.voice.enabled = false;
project.scenes = [{ ...scene, audioPath: undefined, transition: "none", documentary: { ...scene.documentary!, effects: [] } }];
const timeline = buildDocumentaryTimeline(project), close = await serveDocumentaryRenderMedia(timeline);
const require = createRequire(import.meta.url), browser = await openBrowser("chrome");
try {
  for (const [name, entryPoint] of [["before", require.resolve("@gold-work/remotion-video/entry")], ["after", resolve("../../packages/remotion-video/src/remotion-entry.tsx")]]) {
    const serveUrl = await bundle({ entryPoint: entryPoint!, publicDir: null, outDir: join(root, `bundle-${name}`),
      webpackOverride: config => ({ ...config, resolve: { ...config.resolve, extensionAlias: { ".js": [".js", ".ts", ".tsx"] } } }) });
    const composition = await selectComposition({ serveUrl, id: "GoldWorkDocumentaryV2", inputProps: timeline, puppeteerInstance: browser });
    for (const frame of [0, Math.floor(timeline.durationInFrames / 2), timeline.durationInFrames - 1]) {
      await renderStill({ serveUrl, composition, inputProps: timeline, frame, scale: .5, output: join(root, `${name}-${frame}.png`), puppeteerInstance: browser });
    }
  }
  await writeFile(join(root, "result.json"), JSON.stringify({ scene: 55, originalImage: scene.imagePath, frames: [0, Math.floor(timeline.durationInFrames / 2), timeline.durationInFrames - 1], projectUnchanged: true }, null, 2));
  console.log(root);
} finally { await browser.close({ silent: true }); await close(); }
