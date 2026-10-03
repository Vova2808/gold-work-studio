/** Bounded live queue QA: exactly two images, existing reference/audio, no TTS or Veo.
 * This is a materials/queue check, not a fresh script-to-voice E2E. Never auto-restart. */
import assert from "node:assert/strict";
import { app } from "electron";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { MockDirectorProvider, ProjectService } from "@gold-work/core";
import type { Project } from "@gold-work/shared";
import { FileProjectRepository } from "../src/file-project-repository.js";
import { FileTaskRepository } from "../src/file-task-repository.js";
import { FlowAccountStore } from "../src/flow-account-store.js";
import { FlowAuthService } from "../src/flow-auth-service.js";
import { FlowClient, type FlowGenerateImageInput } from "../src/flow-client.js";
import { atomicWrite } from "../src/fs-utils.js";
import { LocalProjectStorage } from "../src/local-project-storage.js";
import { DEFAULT_QUEUE_POLICY, MockGenerationPipeline } from "../src/mock-generation-pipeline.js";
import { StandardRenderer, mediaDurationSeconds, runFfmpeg } from "../src/standard-renderer.js";

const profile = process.env.GOLD_WORK_FLOW_DATA_PATH!;
assert.ok(profile && /^gws-flow-live-/u.test(basename(profile)), "An isolated QA profile is required");
assert.ok(process.env.GW_PROJECT_JSON, "Use an existing live QA sample with saved narration");
app.setPath("userData", profile);
app.on("window-all-closed", () => undefined);
app.commandLine.appendSwitch("force-webrtc-ip-handling-policy", "disable_non_proxied_udp");
app.commandLine.appendSwitch("disable-quic");
const root = resolve("captures", "flow-parallel-live", String(Date.now()));
const hash = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const clean = (error: unknown) => String(error instanceof Error ? error.message : error)
  .replace(/(?:https?|socks5h?):\/\/[^\s]+/giu, "[URL]")
  .replace(/Bearer\s+\S+/giu, "Bearer [REDACTED]").slice(0, 500);
const save = (name: string, value: unknown) => atomicWrite(join(root, name), JSON.stringify(value, null, 2));
type Submission = { index: number; accountId?: string; startedAt?: number; acceptedAt?: number;
  completedAt?: number; mediaName?: string; rejected?: boolean; referenceSha256: string[] };
const submissions: Submission[] = [];
let actualPosts = 0;
let checkpointWrite: Promise<void> = Promise.resolve();
const checkpoint = () => {
  const snapshot = JSON.stringify({ actualPosts, submissions }, null, 2);
  checkpointWrite = checkpointWrite.then(() => atomicWrite(join(root, "submissions.json"), snapshot));
  return checkpointWrite;
};
let auth: FlowAuthService | undefined;
let pipeline: MockGenerationPipeline | undefined;
let projectId: string | undefined;
let deadline: NodeJS.Timeout | undefined;

app.whenReady().then(async () => {
  await mkdir(root, { recursive: true });
  const sourceBytes = await readFile(process.env.GW_PROJECT_JSON!);
  const source: Project = JSON.parse(sourceBytes.toString("utf8"));
  assert.ok(source.id.startsWith("live-material-qa-") && source.characterReference, "Only an existing isolated sample is allowed");
  const sourceScenes = source.scenes.filter(scene => scene.includeInAssembly !== false && scene.audioPath).slice(0, 2);
  assert.equal(sourceScenes.length, 2);
  const referenceSha256 = hash(await readFile(source.characterReference.imagePath));
  const originals = await Promise.all(sourceScenes.map(async scene => ({ path: scene.audioPath!, sha256: hash(await readFile(scene.audioPath!)) })));
  const credentialPath = join(process.env.APPDATA!, "@gold-work/desktop/credentials/flow/accounts.json");
  const credentialHash = hash(await readFile(credentialPath));
  const store = new FlowAccountStore(join(profile, "credentials/flow/accounts.json"));
  const enabled = (await store.list()).filter(account => account.enabled);
  assert.equal(enabled.length, 2, "Refuse to involve any additional account in this bounded test");
  auth = new FlowAuthService(store, () => undefined, () => undefined);
  const controller = new AbortController();
  deadline = setTimeout(() => {
    controller.abort(new Error("Parallel live QA deadline"));
    if (pipeline && projectId) void pipeline.stop(projectId).catch(() => undefined);
  }, 600_000);
  await Promise.all(enabled.map(async account => {
    await auth!.refresh(account.id);
    await auth!.prepareRuntime(account.id, controller.signal);
  }));
  class ObservedFlow extends FlowClient {
    override async generateImage(input: FlowGenerateImageInput): Promise<Buffer> {
      assert.ok(!input.resumeJob, "A fresh bounded run must not inherit somebody else's remote job");
      const record: Submission = { index: submissions.length, referenceSha256: (input.references ?? []).map(hash) };
      submissions.push(record);
      assert.ok(submissions.length <= 2, "No extra image requests are authorized by this diagnostic");
      assert.deepEqual(record.referenceSha256, [referenceSha256]);
      const result = await super.generateImage({ ...input,
        onBeforeSubmit: async accountId => {
          assert.ok(actualPosts < 2, "Two-submit budget exhausted: no retry or account fallback");
          actualPosts += 1;
          record.accountId = accountId;
          record.startedAt = Date.now();
          await checkpoint();
          await input.onBeforeSubmit?.(accountId);
          console.log(`[flow-parallel] image ${record.index + 1}: submit checkpoint saved`);
        },
        onSubmitRejected: async () => {
          record.rejected = true;
          await checkpoint();
          await input.onSubmitRejected?.();
        },
        onRemoteJob: async job => {
          // Persist the actual production queue receipt before diagnostic evidence.
          await input.onRemoteJob?.(job);
          if (job) { record.mediaName = job.mediaName; record.acceptedAt ??= Date.now(); await checkpoint(); }
        },
      });
      record.completedAt = Date.now();
      await checkpoint();
      console.log(`[flow-parallel] image ${record.index + 1}: downloaded`);
      return result;
    }
  }
  const flow = new ObservedFlow(store, auth);
  projectId = `live-parallel-qa-${Date.now()}`;
  const project: Project = structuredClone({ ...source, id: projectId, status: "ready", outputPath: undefined,
    scenes: sourceScenes.map((scene, order) => ({ ...scene, order, videoPath: undefined, videoSelected: false,
      videoFallback: undefined, editor: undefined, visualBeats: undefined })),
    settings: { ...source.settings, image: { ...source.settings.image, provider: "flow", sequential: false,
      references: [source.characterReference.imagePath] }, video: { ...source.settings.video, enabled: false } } });
  const repository = new FileProjectRepository(join(root, "projects.json"));
  await repository.save(project); // A documented existing-media fixture, not a new-script UI claim.
  const director = new MockDirectorProvider();
  director.createScenes = async () => { throw new Error("No new script is allowed in this material-only test"); };
  const projects = new ProjectService(repository, director);
  const storage = new LocalProjectStorage(root);
  pipeline = new MockGenerationPipeline(new FileTaskRepository(join(root, "queue.json")), projects, storage,
    new StandardRenderer(storage), { ...DEFAULT_QUEUE_POLICY, concurrency: 2, maxAttempts: 1 },
    event => {
      if (["queue.task.started", "queue.task.completed", "queue.task.failed"].includes(event.message))
        console.log(`[flow-parallel] ${event.message} ${event.details?.kind ?? ""}`);
    }, undefined, undefined, undefined, flow);
  await pipeline.regenerateScene(projectId, project.scenes.map(scene => scene.id), "image");
  await pipeline.drain(100);
  const tasks = await pipeline.list();
  await save("tasks-result.json", tasks);
  assert.ok(tasks.every(task => task.status === "done"), JSON.stringify(tasks.map(task => ({ kind: task.kind, status: task.status, error: clean(task.error ?? "") }))));
  assert.equal(actualPosts, 2);
  assert.equal(new Set(submissions.map(item => item.accountId)).size, 2, "Queue must use both real accounts");
  // batchGenerateImages returns the generated image, not an immediate async receipt.
  // onRemoteJob is consequently the end of generation, before the separate download.
  const overlapMs = Math.min(...submissions.map(item => item.acceptedAt!)) - Math.max(...submissions.map(item => item.startedAt!));
  assert.ok(overlapMs > 0, "Both generation requests must overlap before the first image response");
  const result = (await projects.get(projectId))!;
  assert.deepEqual(result.scenes.map(scene => scene.id), project.scenes.map(scene => scene.id));
  for (const scene of result.scenes) {
    const task = tasks.find(item => item.kind === "image" && item.sceneId === scene.id)!;
    assert.equal(scene.imagePath, task.resultPath, "An out-of-order response must stay attached to its own scene");
    assert.ok(task.remoteJob && !task.pendingSubmission);
    assert.equal(task.attempts, 1);
  }
  assert.ok(result.outputPath, "Real queue must assemble Final after both images");
  const seconds = await mediaDurationSeconds(result.outputPath);
  const expectedSeconds = result.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
  assert.ok(Math.abs(seconds - expectedSeconds) < 0.3);
  await runFfmpeg(["-v", "error", "-i", result.outputPath, "-f", "null", "-"]);
  await runFfmpeg(["-y", "-i", result.outputPath, "-vf", "fps=1/3,scale=400:-1,tile=2x2", "-frames:v", "1", join(root, "frames.jpg")]);
  assert.equal(hash(await readFile(process.env.GW_PROJECT_JSON!)), hash(sourceBytes));
  assert.equal(hash(await readFile(credentialPath)), credentialHash, "Production credentials must remain untouched");
  for (const original of originals) assert.equal(hash(await readFile(original.path)), original.sha256);
  await writeFile(join(root, "project-result.json"), JSON.stringify(result, null, 2));
  await save("report.json", { passed: true, imagesGenerated: actualPosts, accountsUsed: 2, overlapMs, referenceSha256,
    sceneOrderPreserved: true, queueReceiptsPreserved: true, sourceAndCredentialsUnchanged: true,
    newTtsOrders: 0, newVeoOrders: 0, reusedVoice: true, seconds, expectedSeconds, output: result.outputPath });
  console.log(`[flow-parallel] PASS ${root}`);
}).catch(async error => {
  await mkdir(root, { recursive: true });
  await save("failure.json", { error: clean(error), automaticRestart: false, actualPosts });
  console.error(`[flow-parallel] STOP ${clean(error)}; retained checkpoints: ${root}`);
  process.exitCode = 1;
}).finally(async () => { clearTimeout(deadline); await auth?.closeAll(); app.exit(process.exitCode ?? 0); });
