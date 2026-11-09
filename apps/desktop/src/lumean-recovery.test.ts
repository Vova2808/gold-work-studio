import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { MemoryProjectRepository, MockDirectorProvider, ProjectService } from "@gold-work/core";
import { createDefaultProjectSettings, createDocumentarySettings, type Project } from "@gold-work/shared";
import { FileTaskRepository } from "./file-task-repository.js";
import { LocalProjectStorage } from "./local-project-storage.js";
import { DEFAULT_QUEUE_POLICY, MockGenerationPipeline } from "./mock-generation-pipeline.js";
import { StandardRenderer } from "./standard-renderer.js";
import { VoicerClient, VoicerClientError } from "./voicer-client.js";

const audio = Buffer.from("ID3-offline-fixture-audio-".repeat(20));
const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
const completedOrder = { id: "paid-order", status: "completed", result: { files: ["voice.mp3"] } };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function client(fetchImpl: typeof fetch) {
  return new VoicerClient({
    publicSettings: async () => ({ configured: true, baseUrl: "https://api.lumean.test/api/public" }),
    apiKey: async () => "offline-test-key",
  } as never, {
    fetchImpl, requestTimeoutMs: 2_000, responseBodyTimeoutMs: 2_000,
    downloadTimeoutMs: 2_000, pollTimeoutMs: 2_000, pollIntervalMs: 0,
    safeRetryAttempts: 1, safeRetryBaseDelayMs: 0, sleep: async () => undefined,
  });
}
async function harness(t: TestContext, fetchImpl: typeof fetch) {
  const directory = await mkdtemp(join(tmpdir(), "gws-lumean-recovery-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const settings = createDefaultProjectSettings();
  settings.voice.provider = "elevenlabs";
  settings.voice.voice = "template-1";
  const project: Project = {
    id: "speech-project", title: "Offline speech recovery", topic: "Test", aspectRatio: "16:9", language: "Русский",
    mode: "standard", status: "paused", createdAt: "", updatedAt: "", settings,
    scenes: [{ id: "scene-1", order: 0, title: "Test", narration: "Тестовая озвучка", imagePrompt: "", animationPrompt: "", durationSeconds: 5, status: "draft" }],
  };
  const projectsRepository = new MemoryProjectRepository();
  await projectsRepository.save(project);
  const projects = new ProjectService(projectsRepository, new MockDirectorProvider());
  const path = join(directory, "queue.json");
  const repository = new FileTaskRepository(path);
  await repository.replace([{
    id: "speech-1", runId: "speech-run", projectId: project.id, sceneId: "scene-1", kind: "speech", label: "Speech",
    status: "paused", pausedFrom: "pending", attempts: 0, maxAttempts: 3, progress: 0, dependsOn: [], createdAt: "", updatedAt: "",
  }]);
  const storage = new LocalProjectStorage(directory);
  const makePipeline = () => new MockGenerationPipeline(new FileTaskRepository(path), projects, storage,
    new StandardRenderer(storage), { ...DEFAULT_QUEUE_POLICY, retryDelaysMs: [0] }, undefined, undefined, client(fetchImpl));
  const pipeline = makePipeline();
  await pipeline.initialize();
  return { pipeline, makePipeline, project, projects, repository, directory };
}

test("unknown Lumean submission survives queue reload and cannot create a duplicate order", async t => {
  const submitted = deferred<void>();
  const reply = deferred<Response>();
  let posts = 0;
  const setup = await harness(t, async (_url, init) => {
    assert.equal(init?.method, "POST");
    posts++;
    assert.equal((await setup.repository.list())[0]!.pendingSubmission?.provider, "lumean");
    submitted.resolve();
    return reply.promise;
  });
  await setup.pipeline.resume(setup.project.id);
  await setup.pipeline.tick();
  await submitted.promise;
  const restored = setup.makePipeline();
  await restored.initialize();
  const task = (await restored.list())[0];
  assert.ok(task);
  assert.equal(task.status, "failed");
  assert.equal(task.attempts, 1, "Blocked submission must display the real attempt count");
  assert.match(task.retryBlockedReason!, /Lumean/);
  await restored.resume(setup.project.id);
  await restored.drain(5);
  await assert.rejects(restored.retry(task.id), /Lumean/);
  await assert.rejects(restored.start(setup.project.id), /Lumean/);
  await assert.rejects(restored.regenerateScene(setup.project.id, "scene-1", "audio"), /Lumean/);
  await assert.rejects(restored.assembleOnly(setup.project.id), /Lumean/);
  assert.equal(posts, 1);
  reply.reject(new Error("lost creation reply"));
  await setup.pipeline.drain(10);
});

test("queue heartbeat progress does not rewrite project data while a paid voice request is pending", async t => {
  const submitted = deferred<void>(), reply = deferred<Response>();
  let posts = 0;
  const setup = await harness(t, async () => { posts++; submitted.resolve(); return reply.promise; });
  await setup.pipeline.resume(setup.project.id); await setup.pipeline.tick(); await submitted.promise;
  let projectWrites = 0;
  const mutate = setup.projects.mutate.bind(setup.projects);
  setup.projects.mutate = async (...args: Parameters<ProjectService["mutate"]>) => { projectWrites++; return mutate(...args); };
  const before = (await setup.pipeline.list())[0]!.progress;
  for (let i = 0; i < 3; i++) await setup.pipeline.tick();
  assert.ok((await setup.pipeline.list())[0]!.progress > before, "Queue progress still updates");
  assert.equal(projectWrites, 0, "Percent updates must not invalidate the full project registry");
  assert.equal(posts, 1);
  reply.reject(new Error("offline request stopped")); await setup.pipeline.drain(10);
  assert.ok(projectWrites > 0, "The failure/status change must still reach the project");
});

test("known production speech order survives failed download/reload and retry never posts again", async t => {
  let posts = 0;
  let orderGets = 0;
  let failDownload = true;
  const setup = await harness(t, async (input, init) => {
    const url = String(input);
    if (url.endsWith("/orders") && init?.method === "POST") { posts++; return ok(completedOrder); }
    if (url.endsWith("/orders/paid-order")) { orderGets++; return ok(completedOrder); }
    if (url.endsWith("/storage/url")) {
      const saved = (await setup.repository.list())[0];
      assert.ok(saved);
      assert.equal(saved.lumeanOrder?.orderId, "paid-order");
      assert.equal(saved.pendingSubmission, undefined);
      return ok({ url: "https://cdn.lumean.test/voice.mp3" });
    }
    if (url.endsWith("/voice.mp3")) {
      if (failDownload) throw new Error("offline CDN");
      return new Response(audio, { headers: { "content-type": "audio/mpeg" } });
    }
    throw new Error(`Unexpected offline route: ${url}`);
  });
  await setup.pipeline.resume(setup.project.id);
  await setup.pipeline.drain(20);
  assert.equal((await setup.pipeline.list())[0]!.status, "failed");
  assert.equal((await setup.pipeline.list())[0]!.retryBlockedReason, undefined);
  failDownload = false;
  const restored = setup.makePipeline();
  await restored.initialize();
  await restored.retry("speech-1");
  await restored.drain(20);
  const task = (await restored.list())[0];
  assert.ok(task);
  assert.equal(task.status, "done", task.error);
  assert.deepEqual(await readFile(task.resultPath!), audio);
  assert.equal(posts, 1);
  assert.equal(orderGets, 1);
});

test("stopped Stock production resumes its paid scene order on a new run", async t => {
  const downloading = deferred<void>();
  let posts = 0;
  let orderGets = 0;
  let stopDownload = true;
  const setup = await harness(t, async (input, init) => {
    const url = String(input);
    if (url.endsWith("/orders") && init?.method === "POST") { posts++; return ok(completedOrder); }
    if (url.endsWith("/orders/paid-order")) { orderGets++; return ok(completedOrder); }
    if (url.endsWith("/storage/url")) return ok({ url: "https://cdn.lumean.test/voice.mp3" });
    if (url.endsWith("/voice.mp3")) {
      if (stopDownload) {
        downloading.resolve();
        return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new Error("Stopped")), { once: true }));
      }
      return new Response(audio, { headers: { "content-type": "audio/mpeg" } });
    }
    throw new Error(`Unexpected offline route: ${url}`);
  });
  await setup.projects.mutate(setup.project.id, project => ({
    mediaMode: "stock", settings: { ...project.settings, assembly: { ...project.settings.assembly, documentary: createDocumentarySettings() } },
  }));
  await setup.pipeline.resume(setup.project.id);
  await setup.pipeline.tick();
  await downloading.promise;
  await setup.pipeline.stop(setup.project.id);
  await setup.pipeline.drain(10);
  assert.equal((await setup.pipeline.list())[0]!.status, "cancelled");
  stopDownload = false;
  const restored = setup.makePipeline();
  await restored.initialize();
  const tasks = await restored.start(setup.project.id, "narration");
  assert.equal(tasks[0]!.lumeanOrder?.orderId, "paid-order");
  await restored.drain(20);
  const result = (await restored.list())[0]!;
  assert.equal(result.status, "done", result.error);
  assert.deepEqual(await readFile(result.resultPath!), audio);
  assert.equal(posts, 1, "Restart must not submit a second paid order");
  assert.equal(orderGets, 1);
});

test("Lumean saves a late accepted receipt before honoring Stop", async () => {
  const controller = new AbortController();
  let saved = "";
  let posts = 0;
  const voicer = client(async () => {
    posts++;
    const response = ok(completedOrder);
    return { ...response, ok: true, status: 200, text: async () => {
      controller.abort();
      return JSON.stringify({ data: completedOrder });
    } } as Response;
  });
  await assert.rejects(voicer.tts("Text", "template-1", controller.signal, {
    onOrderKnown: async id => { saved = id; },
  }), (error: unknown) => error instanceof VoicerClientError && error.orderKnown && error.code === "aborted");
  assert.equal(saved, "paid-order");
  assert.equal(posts, 1);
});

test("Lumean refuses to submit when its durable preflight checkpoint cannot be saved", async () => {
  let posts = 0;
  const voicer = client(async () => { posts++; return ok(completedOrder); });
  await assert.rejects(voicer.tts("Text", "template-1", undefined, {
    onBeforeOrderCreate: async () => { throw new Error("disk full"); },
  }), /disk full/);
  assert.equal(posts, 0);
});

test("only definite Lumean rejection clears the pre-submission checkpoint", async () => {
  for (const status of [400, 401, 402, 403, 429, 408, 409, 503, 200]) {
    let posts = 0;
    let pending = false;
    const voicer = client(async () => { posts++; return new Response("{}", { status }); });
    await assert.rejects(voicer.tts("Text", "template-1", undefined, {
      onBeforeOrderCreate: async () => { pending = true; },
      onOrderRejected: async () => { pending = false; },
    }));
    assert.equal(posts, 1);
    assert.equal(pending, [408, 409, 503, 200].includes(status), `status ${status}`);
  }
});

test("calibration remembers an uncertain paid submission across a fresh client", async t => {
  const directory = await mkdtemp(join(tmpdir(), "gws-lumean-calibration-pending-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let posts = 0;
  const fetchImpl: typeof fetch = async () => {
    posts++;
    const names = await readdir(directory);
    const saved = JSON.parse(await readFile(join(directory, names.find(name => name.endsWith(".order.json"))!), "utf8"));
    assert.equal(saved.submissionPending, true);
    throw new Error("lost reply");
  };
  await assert.rejects(client(fetchImpl).ttsSample("template-1", "ru", directory));
  await assert.rejects(client(fetchImpl).ttsSample("template-1", "ru", directory), /повторная отправка отключена/);
  const checkpointName = (await readdir(directory)).find(name => name.endsWith(".order.json"))!;
  await writeFile(join(directory, checkpointName), '{"broken":');
  await assert.rejects(client(fetchImpl).ttsSample("template-1", "ru", directory), /сохранённое состояние/);
  assert.equal(posts, 1);
});

test("legacy in-flight Lumean requests without IDs are held; tracked pre-submit work is resumable", async t => {
  const setup = await harness(t, async () => { throw new Error("No network expected"); });
  const task = (await setup.repository.list())[0];
  assert.ok(task);
  for (const tracked of [false, true]) {
    await setup.repository.replace([{ ...task, status: "running", submissionTrackingVersion: tracked ? 1 : undefined }]);
    const restored = setup.makePipeline();
    await restored.initialize();
    const recovered = (await restored.list())[0];
    assert.ok(recovered);
    assert.equal(recovered.status, tracked ? "paused" : "failed");
    assert.equal(Boolean(recovered.pendingSubmission), !tracked);
  }
});
