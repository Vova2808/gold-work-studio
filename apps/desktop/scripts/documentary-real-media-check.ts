import assert from "node:assert/strict";
import { readFile, mkdir, copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Project } from "@gold-work/shared";
import { LocalProjectStorage } from "../src/local-project-storage.js";
import { StandardRenderer, mediaDurationSeconds, runFfmpeg } from "../src/standard-renderer.js";
import { RemotionMontageRenderer } from "../src/remotion-montage-renderer.js";
import { prepareDocumentaryTiming } from "../src/documentary-timing.js";

// Visual QA only. The user's production project and original voice settings are read-only.
const control = resolve("captures/documentary-control");
const state = JSON.parse(await readFile(join(control, "state.json"), "utf8"));
const projects = JSON.parse(await readFile("C:/Users/rosup/AppData/Roaming/@gold-work/desktop/projects.json", "utf8")) as Project[];
const project = structuredClone(projects.find(project => project.id === state.projectId)!);
assert.ok(project);
project.id = `${project.id}-visual-check`;
project.title = "Stock Documentary — silent visual check, original real materials";
project.scenes = project.scenes.slice(0, 3);
project.settings.voice.enabled = false;
project.settings.assembly.quality = "standard";
const labels = ["SS United States · 1952 / Icon of the Seas · 2023", "SS United States · Philadelphia, 2009", "Icon of the Seas · Sea trials, 2023"];
project.scenes.forEach((scene, index) => {
  assert.ok(scene.imagePath && scene.documentary?.selected);
  scene.durationSeconds = 5; scene.durationOverrideSeconds = 5;
  scene.documentary!.verified = true; // Photos and per-file rights manually inspected in this task.
  scene.documentary!.caption = { ...scene.documentary!.caption, text: labels[index]!, enabled: index > 0, fontSize: 44 };
  scene.transition = index === 0 ? "mix" : "none";
  scene.kenBurnsZoom = 1.06;
});
project.scenes[0]!.documentary!.layout = "compare";
project.scenes[0]!.documentary!.comparison = { sceneId: project.scenes[2]!.id, leftLabel: "SS United States · 1952", rightLabel: "Icon of the Seas · 2023" };
const root = join(control, "visual-check"); await mkdir(root, { recursive: true });
const storage = new LocalProjectStorage(root);
await storage.ensureProject(project);
project.scenes = await prepareDocumentaryTiming(project, storage);
const renderer = new StandardRenderer(storage, new RemotionMontageRenderer(id => storage.projectDirectory(id)));
const output = await renderer.render(project);
assert.ok(Math.abs(await mediaDurationSeconds(output) - 15) < .05);
await copyFile(output, join(root, "silent-visual-check.mp4"));
await runFfmpeg(["-y", "-ss", "2.5", "-i", output, "-frames:v", "1", join(root, "comparison.png")]);
await runFfmpeg(["-y", "-ss", "12.5", "-i", output, "-frames:v", "1", join(root, "icon-full-frame.png")]);
console.log("PASS: 15-second silent real-material visual check. This is not the five-minute narrated control video.");
