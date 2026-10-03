import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Project } from "@gold-work/shared";
import { documentaryJson, readAnalysisCheckpoint } from "../src/documentary-intelligence.js";
import { prepareDocumentaryRangePoster } from "../src/documentary-media-cache.js";
import { documentaryVarietyIssue } from "../src/documentary-reuse.js";

// Local media/checkpoint replay only. No provider client, keys, TTS or project writes.
const [profile, projectId, checkpointName] = process.argv.slice(2);
assert.ok(profile && projectId && checkpointName && /^[a-f0-9]{64}\.json$/.test(checkpointName));
const out = resolve("captures", `stock-selection-${Date.now()}`);
await mkdir(out, { recursive: true });
const path = join(profile, "projects.json"), original = await readFile(path);
const project = (JSON.parse(original.toString("utf8")) as Project[]).find(item => item.id === projectId);
assert.ok(project);
const scenes = [];
for (const scene of project.scenes) scenes.push(scene.documentary?.verified && scene.videoPath ? await prepareDocumentaryRangePoster(out, scene) : scene);
const replay = { ...project, scenes };
const issues = scenes.flatMap(scene => {
  const reason = scene.documentary?.verified && !scene.documentary.pinned && documentaryVarietyIssue(replay, scene);
  return reason ? [{ scene: scene.order + 1, reason }] : [];
});
assert.ok(issues.some(item => item.scene >= 6 && item.scene <= 14), "The reported repetitive sequence must be detected");
const selected = scenes.filter(scene => scene.documentary?.verified && scene.videoPath);
assert.ok(selected.every(scene => scene.imagePath?.startsWith(out)), "Each video gets a real range poster, not the source cover");
assert.equal(new Set(selected.map(scene => scene.imagePath)).size, selected.length);

const checkpointPath = join(profile, "workspace", "projects", projectId, "Documentary", "Analysis", checkpointName);
const saved = await readFile(checkpointPath, "utf8"), checkpoint = JSON.parse(saved);
assert.equal(checkpoint.purpose, "video-range-choice");
assert.equal(checkpoint.state, "received");
const result = documentaryJson(checkpoint.raw);
assert.deepEqual(result.choices, [], "Recovery must retain the model's rejection, not invent a selection");
await copyFile(checkpointPath, join(out, "received-answer-backup.json"));
assert.equal(await readFile(checkpointPath, "utf8"), saved, "Do not overwrite a concurrently changed checkpoint");
const recovered = await readAnalysisCheckpoint(checkpointPath);
assert.equal(recovered?.state, "complete");
assert.equal(recovered?.raw, checkpoint.raw);
assert.deepEqual(recovered?.result, result);
assert.deepEqual(await readFile(path), original, "The production project remains unchanged");
const summary = { projectId, output: out, recoveredAnswer: checkpointName, paidRequests: 0,
  projectSha256: createHash("sha256").update(original).digest("hex"), selected: selected.length, varietyIssues: issues,
  posters: selected.map(scene => ({ scene: scene.order + 1, image: scene.imagePath })) };
await writeFile(join(out, "result.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
