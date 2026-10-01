/** Offline verification of an already terminal live run. No provider/store imports or new jobs. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { Project, QueueTask } from "@gold-work/shared";
import { mediaDurationSeconds, runFfmpeg } from "../src/standard-renderer.js";

const root = resolve(process.argv[2]!);
const allowedRoot = resolve(process.argv[3]!);
const relativeRoot = relative(allowedRoot, root);
assert.ok(relativeRoot && !isAbsolute(relativeRoot) && !relativeRoot.startsWith(".."), "Use an explicit run under the QA captures directory");
const readJson = async (name: string) => JSON.parse(await readFile(join(root, name), "utf8"));
const evidence = await readJson("submissions.json") as { actualPosts: number; submissions: Array<{
  index: number; accountId: string; startedAt: number; acceptedAt: number; completedAt: number;
  mediaName: string; rejected?: boolean; referenceSha256: string[];
}> };
const tasks = await readJson("tasks-result.json") as QueueTask[];
const projects = await readJson("projects.json") as Project[];
assert.equal(projects.length, 1);
const project = projects[0]!;
assert.equal(project.status, "complete");
assert.equal(evidence.actualPosts, 2);
assert.equal(evidence.submissions.length, 2);
assert.equal(new Set(evidence.submissions.map(item => item.accountId)).size, 2);
const overlapMs = Math.min(...evidence.submissions.map(item => item.acceptedAt))
  - Math.max(...evidence.submissions.map(item => item.startedAt));
assert.ok(overlapMs > 0, "Actual generation requests must overlap, not just downloads");
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const referenceSha256 = hash(await readFile(project.characterReference!.imagePath));
for (const item of evidence.submissions) {
  assert.ok(!item.rejected && item.startedAt < item.acceptedAt && item.acceptedAt <= item.completedAt);
  assert.deepEqual(item.referenceSha256, [referenceSha256]);
}
assert.deepEqual(tasks.map(task => task.kind).sort(), ["assemble", "image", "image"]);
assert.ok(tasks.every(task => task.status === "done" && task.attempts === 1 && !task.pendingSubmission));
assert.deepEqual(project.scenes.map(scene => scene.order), [0, 1]);
const imageEvidence = [];
for (const scene of project.scenes) {
  assert.ok(scene.durationSeconds <= 9 && scene.audioPath);
  const task = tasks.find(item => item.kind === "image" && item.sceneId === scene.id)!;
  assert.equal(scene.imagePath, task.resultPath);
  assert.ok(task.remoteJob?.kind === "image");
  const job = task.remoteJob;
  assert.ok(evidence.submissions.some(item => item.mediaName === job.mediaName && item.accountId === job.accountId));
  imageEvidence.push({ sceneId: scene.id, order: scene.order, imagePath: scene.imagePath,
    sha256: hash(await readFile(scene.imagePath!)), accountId: job.accountId, mediaName: job.mediaName });
}
assert.equal(new Set(imageEvidence.map(item => item.sha256)).size, 2);
assert.ok(project.outputPath);
const seconds = await mediaDurationSeconds(project.outputPath);
const expectedSeconds = project.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
assert.ok(Math.abs(seconds - expectedSeconds) < 0.3);
await runFfmpeg(["-v", "error", "-i", project.outputPath, "-f", "null", "-"]);
await runFfmpeg(["-y", "-i", project.outputPath, "-vf", "fps=1/4,scale=400:-1,tile=2x2", "-frames:v", "1", join(root, "frames.jpg")]);
const report = { passed: true, offlineVerification: true, newRequestsDuringVerification: 0,
  imagesGeneratedInOriginalRun: 2, accountsUsed: 2, generationRequestOverlapMs: overlapMs,
  referenceSha256, imageEvidence, queueReceiptsPreserved: true, fullDecodePassed: true,
  newTtsOrders: 0, newVeoOrders: 0, reusedVoice: true, seconds, expectedSeconds, output: project.outputPath,
  previousFailure: "The original diagnostic compared receipt/download intervals; Flow returns the receipt after image generation. Original failure.json retained." };
await writeFile(join(root, "verified-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: true, generationRequestOverlapMs: overlapMs, seconds, expectedSeconds, report: join(root, "verified-report.json") }));
