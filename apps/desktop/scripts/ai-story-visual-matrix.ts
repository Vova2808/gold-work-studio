import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import type { Project, Scene } from "@gold-work/shared";
import { LocalProjectStorage } from "../src/local-project-storage.js";
import { StandardRenderer, mediaDurationSeconds, runFfmpeg } from "../src/standard-renderer.js";

// Nine isolated, local-only visual regressions. Never writes into the source project.
assert.ok(process.env.GW_PROJECT_JSON, "Set GW_PROJECT_JSON to a real AI Story project.json");
const source: Project = JSON.parse(await readFile(process.env.GW_PROJECT_JSON, "utf8"));
assert.equal(source.mediaMode, "ai");
const photos = source.scenes.filter(scene => scene.imagePath && scene.includeInAssembly !== false).slice(0, 3);
assert.equal(photos.length, 3);
const root = resolve("captures", "ai-story-visual-matrix", String(Date.now()));
await mkdir(root, {recursive:true});
const storage = new LocalProjectStorage(root);
const renderer = new StandardRenderer(storage);
const results: {mode:string; transition:string; path:string; seconds:number; contactSheet:string}[] = [];
for (const mode of ["off", "alternate", "smart"] as const) {
  for (const transition of ["none", "mix", "fade"] as const) {
    const id = `${mode}-${transition}`;
    const scenes: Scene[] = photos.map((photo, order) => ({
      id:`${id}-${order}`, order, title:photo.title, imagePath:photo.imagePath,
      imagePrompt:photo.imagePrompt, animationPrompt:photo.animationPrompt,
      narration:"", durationSeconds:3, status:"ready", autoKenBurnsDirection:order % 2 ? "pan-right" : "pan-left",
    }));
    const project: Project = {...source, id, scenes, outputPath:undefined, mediaMode:"ai", settings:{
      ...source.settings,
      voice:{...source.settings.voice, enabled:false}, video:{...source.settings.video, enabled:false},
      music:{...source.settings.music, enabled:false}, subtitles:{...source.settings.subtitles, enabled:false},
      assembly:{...source.settings.assembly, quality:"preview", kenBurns:mode !== "off",
        kenBurnsDirection:mode === "off" ? "in" : mode, fadeTransitions:transition !== "none",
        transitionType:transition, transitionDurationSeconds:0.5,
        montage:{...source.settings.assembly.montage, enabled:false}},
    }};
    const path = await renderer.render(project);
    const seconds = await mediaDurationSeconds(path);
    assert.ok(Math.abs(seconds - 9) < 0.2, `${id}: timeline changed to ${seconds}`);
    // 0.5 / 1.5 / 2.5 / 3.5 / ... highlights motion and both transition regions.
    const contactSheet = join(root, `${id}.jpg`);
    await runFfmpeg(["-y", "-ss", "0.5", "-i", path, "-vf", "fps=1,scale=240:-1,tile=9x1", "-frames:v", "1", contactSheet]);
    results.push({mode, transition, path, seconds, contactSheet});
    await writeFile(join(root, "results.json"), JSON.stringify(results, null, 2));
    console.log(`[ai-story-matrix] ${id}: ${seconds.toFixed(2)}s, full decode passed`);
  }
}
const inputs = results.flatMap(result => ["-i", result.contactSheet]);
await runFfmpeg(["-y", ...inputs, "-filter_complex", "vstack=inputs=9", "-frames:v", "1", join(root,"matrix.jpg")]);
console.log(`[ai-story-matrix] PASS ${join(root,"matrix.jpg")}`);
