/** Re-render the existing two-account QA material, without touching the source or providers. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { resolveImageMotionPlan, type Project } from "@gold-work/shared";
import { LocalProjectStorage } from "../src/local-project-storage.js";
import { StandardRenderer, mediaDurationSeconds, runFfmpeg } from "../src/standard-renderer.js";

const sourcePath = resolve(process.argv[2]!);
const sourceBytes = await readFile(sourcePath);
const parsed = JSON.parse(sourceBytes.toString("utf8"));
const source: Project = Array.isArray(parsed) ? parsed[0] : parsed;
assert.ok(source.id.startsWith("live-parallel-qa-") && source.mediaMode === "ai");
assert.equal(source.scenes.length, 2);
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const originals = await Promise.all([sourcePath, source.outputPath!, ...source.scenes.flatMap(scene => [scene.imagePath!, scene.audioPath!])]
  .map(async path => ({ path, hash: hash(await readFile(path)) })));
const root = resolve("captures", "portrait-framing", String(Date.now()));
await mkdir(root, { recursive: true });
const storage = new LocalProjectStorage(root);
const project = structuredClone({ ...source, id: `framing-qa-${Date.now()}`, outputPath: undefined });
const output = await new StandardRenderer(storage).render(project);
const seconds = await mediaDurationSeconds(output);
const originalSeconds = await mediaDurationSeconds(source.outputPath!);
assert.ok(Math.abs(seconds - originalSeconds) < 0.04, "Motion fix must not change the narration timeline");
await runFfmpeg(["-v", "error", "-i", output, "-f", "null", "-"]);
const oldSecond = join(dirname(source.scenes[1]!.imagePath!), "scene.mp4");
const newSecond = storage.sceneVideoPath(project, project.scenes[1]!);
await runFfmpeg(["-y", "-i", oldSecond, "-i", newSecond, "-filter_complex",
  "[0:v]select=eq(n\\,0),scale=640:360[before];[1:v]select=eq(n\\,0),scale=640:360[after];[before][after]hstack=inputs=2",
  "-frames:v", "1", join(root, "before-after.jpg")]);
for (const original of originals) assert.equal(hash(await readFile(original.path)), original.hash);
await writeFile(join(root, "project.json"), JSON.stringify(project, null, 2));
await writeFile(join(root, "report.json"), JSON.stringify({ sourcePath, output, seconds, originalSeconds,
  originalFilesUnchanged: true, newProviderRequests: 0, fullDecodePassed: true,
  plans: project.scenes.map(scene => ({ sceneId: scene.id, ...resolveImageMotionPlan(project, scene) })),
  comparison: { path: join(root, "before-after.jpg"), left: "before", right: "after" },
  limitation: "Semantic headroom protection, not face detection or repair of an already cropped source image.",
}, null, 2));
console.log(`[portrait-framing] PASS ${root}; ${seconds}s; unchanged source files; zero provider requests`);
