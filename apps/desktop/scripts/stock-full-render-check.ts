import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Project } from "@gold-work/shared";
import { buildDocumentaryTimeline } from "@gold-work/remotion-video";
import { RemotionMontageRenderer } from "../src/remotion-montage-renderer.js";
import { mediaDurationSeconds, runFfmpeg } from "../src/standard-renderer.js";
import { atomicWrite } from "../src/fs-utils.js";

const registry = "C:/Users/rosup/AppData/Roaming/@gold-work/desktop/projects.json";
const original = await readFile(registry);
const raw = JSON.parse(original.toString()) as Project[];
const project = raw.find(project => project.id === "project_mu8iia3v_qhpe9y9");
assert.ok(project); assert.equal(project.scenes.length, 107);
const root = resolve("captures/stock-full-render"); await mkdir(root, { recursive: true });
const directory = await mkdtemp(join(root, "run-")), outputPath = join(directory, "Final.mp4");
const sourceHash = createHash("sha256").update(JSON.stringify(project)).digest("hex");
const timeline = buildDocumentaryTimeline(project), expected = timeline.durationInFrames / timeline.fps;
let last = -1, peakStagingBytes = 0, inspecting = false;
const bytes = async (path: string): Promise<number> => { let total = 0; for (const entry of await readdir(path, { withFileTypes: true })) { const file = join(path, entry.name); total += entry.isDirectory() ? await bytes(file) : (await stat(file)).size; } return total; };
const timer = setInterval(() => { if (inspecting) return; inspecting = true; void bytes(directory).then(size => { peakStagingBytes = Math.max(peakStagingBytes, size); }).catch(() => {}).finally(() => { inspecting = false; }); }, 3000);
const started = Date.now();
try {
  await new RemotionMontageRenderer(() => directory).render({ project, clips: [], audioMasterPath: "", outputPath, onProgress: (stage, progress) => {
    if (Math.floor(progress / 5) === last) return; last = Math.floor(progress / 5); console.log(JSON.stringify({ elapsedSeconds: Math.round((Date.now() - started) / 1000), progress, stage }));
  } });
  const duration = await mediaDurationSeconds(outputPath);
  assert.ok(Math.abs(duration - expected) < .06, `Duration ${duration} must match ${expected}`);
  assert.equal(createHash("sha256").update(JSON.stringify(project)).digest("hex"), sourceHash, "Render must not mutate the source project");
  assert.deepEqual(await readFile(registry), original, "Production registry must remain untouched");
  for (const [index, seconds] of [1, 53, 75, 180, 310].entries()) await runFfmpeg(["-y", "-ss", String(seconds), "-i", outputPath, "-frames:v", "1", join(directory, `frame-${index + 1}.jpg`)]);
  const result = { outputPath, scenes: project.scenes.length, duration, expected, elapsedSeconds: (Date.now() - started) / 1000, peakStagingBytes, outputBytes: (await stat(outputPath)).size, paidRequests: 0, productionRegistryUnchanged: true };
  await atomicWrite(join(directory, "result.json"), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { clearInterval(timer); }
