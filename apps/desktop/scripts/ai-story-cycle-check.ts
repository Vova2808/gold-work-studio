import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { MemoryProjectRepository, MockDirectorProvider, ProjectService } from "@gold-work/core";
import { resolveImageMotionPlan } from "@gold-work/shared";
import { LocalProjectStorage } from "../src/local-project-storage.js";
import { StandardRenderer, mediaDurationSeconds, runFfmpeg } from "../src/standard-renderer.js";

// Local diagnostic media only. No providers, user projects, credentials or paid requests.
const root = resolve("captures", "ai-story-cycle", String(Date.now()));
await mkdir(root, { recursive: true });
const service = new ProjectService(new MemoryProjectRepository(), new MockDirectorProvider());
const project = await service.create({ title: "Six motion cycle", topic: "Local visual check", language: "Русский", aspectRatio: "16:9", mode: "pro" }, true);
project.mediaMode = "ai";
const source = join(root, "motion-target.png");
await runFfmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=s=1280x720", "-frames:v", "1", source]);
project.scenes = Array.from({ length: 6 }, (_, order) => ({ ...project.scenes[0]!, id: `cycle-${order}`, order,
  narration: "", imagePrompt: "Diagnostic color chart", imagePath: source, audioPath: undefined, videoPath: undefined,
  durationSeconds: 2, kenBurnsDirection: "auto", kenBurnsZoom: 1.12, transition: "auto" }));
project.settings.voice.enabled = project.settings.video.enabled = project.settings.music.enabled = project.settings.subtitles.enabled = false;
Object.assign(project.settings.assembly, { quality: "preview", kenBurns: true, kenBurnsDirection: "cycle", fadeTransitions: false, transitionType: "none" });
project.settings.assembly.montage.enabled = false;
const storage = new LocalProjectStorage(root);
const output = await new StandardRenderer(storage).render(project);
const seconds = await mediaDurationSeconds(output);
assert.ok(Math.abs(seconds - 12) < 0.2);
await runFfmpeg(["-v", "error", "-xerror", "-i", output, "-f", "null", "-"]);
const rows: string[] = [];
for (const scene of project.scenes) {
  const row = join(root, `step-${scene.order}.jpg`);
  await runFfmpeg(["-y", "-i", storage.sceneVideoPath(project, scene), "-vf", "select='eq(n,0)+eq(n,58)',scale=384:216,tile=2x1", "-frames:v", "1", row]);
  rows.push(row);
}
const contactSheet = join(root, "cycle-start-end.jpg");
await runFfmpeg(["-y", ...rows.flatMap(row => ["-i", row]), "-filter_complex", "vstack=inputs=6", "-frames:v", "1", contactSheet]);
await writeFile(join(root, "report.json"), JSON.stringify({ output, seconds, contactSheet,
  plans: project.scenes.map(scene => resolveImageMotionPlan(project, scene)), newProviderRequests: 0, fullDecode: true }, null, 2));
console.log(`[ai-story-cycle] PASS: ${seconds}s, six FFmpeg motions, full decode; ${contactSheet}`);
