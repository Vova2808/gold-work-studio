import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { MemoryProjectRepository, MemoryTaskRepository, MockDirectorProvider, ProjectService } from "@gold-work/core";
import { createDefaultProjectSettings, type Project, type QueueTask, type Scene } from "@gold-work/shared";
import { FlowSubmissionUncertainError, type FlowGenerateImageInput, type FlowRemoteImageJob } from "./flow-client.js";
import { LocalProjectStorage } from "./local-project-storage.js";
import { DEFAULT_QUEUE_POLICY, MockGenerationPipeline, type PipelineLogEvent } from "./mock-generation-pipeline.js";
import { StandardRenderer } from "./standard-renderer.js";
import { FileTaskRepository } from "./file-task-repository.js";
import type { FlowGenerateInput } from "./flow-client.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4SIAAAAASUVORK5CYII=", "base64");
const remoteJob: FlowRemoteImageJob = {
  provider: "flow", kind: "image", accountId: "original-account", projectId: "original-flow-project",
  mediaName: "already-paid-image", modelKey: "NARWHAL", submittedAt: "2026-09-06T00:00:00.000Z",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

async function harness(context: TestContext, options: {
  mediaMode?: Project['mediaMode'];
  videoProvider?: Project['settings']['video']['provider'];
  provider?: Project["settings"]["image"]["provider"];
  configured?: boolean;
  prompt?: string;
  sceneOrders?: number[];
  completedOrders?: number[];
  job?: FlowRemoteImageJob;
  references?: string[];
  failImageSave?: boolean;
  durable?: boolean;
  kind?: "image" | "video";
  generateVideo?: (input: FlowGenerateInput) => Promise<Buffer>;
  generateImage(input: FlowGenerateImageInput): Promise<Buffer>;
}) {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-flow-queue-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const scenes: Scene[] = (options.sceneOrders ?? [0]).map((order) => ({
    id: `scene-${order}`, order, title: `Scene ${order}`, narration: "A mechanic inspects the dashboard.",
    imagePrompt: options.prompt ?? "Mechanic inspecting an old car dashboard", animationPrompt: "Slow camera push in",
    durationSeconds: 8, status: "draft",
  }));
  const settings = createDefaultProjectSettings();
  settings.image.provider = options.provider ?? "flow";
  settings.image.references = options.references ?? [];
  if (options.kind === "video") { settings.video.enabled = true; settings.video.provider = options.videoProvider??"flow"; settings.video.startFrame = false; }
  const project: Project = {
    id: "flow-queue-project", title: "Flow image queue", topic: "Car inspection", aspectRatio: "16:9",
    language: "English", mode: "standard", mediaMode:options.mediaMode, status: "paused", createdAt: "", updatedAt: "", settings, scenes,
  };
  const projectsRepository = new MemoryProjectRepository();
  await projectsRepository.save(project);
  const projects = new ProjectService(projectsRepository, new MockDirectorProvider());
  const queuePath = join(directory, "queue.json");
  const repository = options.durable ? new FileTaskRepository(queuePath) : new MemoryTaskRepository();
  await repository.replace(scenes.map((scene): QueueTask => ({
    id: `image-${scene.order}`, runId: "flow-image-run", projectId: project.id, sceneId: scene.id,
    kind: options.kind ?? "image", label: "Generate media", status: options.completedOrders?.includes(scene.order) ? "done" : "paused", pausedFrom: "pending", attempts: 0,
    maxAttempts: 3, progress: 0, dependsOn: [], createdAt: "", updatedAt: "", remoteJob: options.job,
  })));
  const storage = new LocalProjectStorage(directory);
  if (options.failImageSave) storage.saveGeneratedImage = async () => { throw new Error("ENOSPC: no space left on device"); };
  let placeholderCalls = 0;
  storage.createPlaceholderImage = async () => {
    placeholderCalls += 1;
    throw new Error("Unexpected placeholder image");
  };
  let anyModelCalls = 0;
  const anyModel = {
    configured: async () => true,
    generateImage: async () => { anyModelCalls += 1; return png; },
  };
  const flow = { configured: async () => options.configured ?? true, generateImage: options.generateImage, generateVideo: options.generateVideo };
  const events: PipelineLogEvent[] = [];
  const makePipeline = () => new MockGenerationPipeline(
    options.durable ? new FileTaskRepository(queuePath) : repository, projects, storage, new StandardRenderer(storage),
    { ...DEFAULT_QUEUE_POLICY, retryDelaysMs: [0, 0] },
    (event) => events.push(event), anyModel as never, undefined, undefined, flow as never,
  );
  const pipeline = makePipeline();
  await pipeline.initialize();
  return {
    pipeline, makePipeline, repository, project, events,
    counts: () => ({ anyModel: anyModelCalls, placeholder: placeholderCalls }),
  };
}

test("Flow-only image selection never alternates even and odd scenes with AnyModel", async (context) => {
  const prompts: string[] = [];
  const setup = await harness(context, {
    sceneOrders: [0, 1],
    generateImage: async (input) => { prompts.push(input.prompt); return png; },
  });
  await setup.pipeline.resume(setup.project.id);
  await setup.pipeline.drain(30);
  const tasks = await setup.pipeline.list();
  assert.equal(prompts.length, 2);
  assert.ok(prompts.every((prompt) => prompt.includes("Mechanic inspecting an old car dashboard")));
  assert.ok(tasks.every((task) => task.status === "done"));
  for (const task of tasks) assert.ok((await readFile(task.resultPath!)).length > 32);
  assert.deepEqual(setup.counts(), { anyModel: 0, placeholder: 0 });
  assert.equal(setup.events.filter((event) => event.message === "queue.task.image_fallback").length, 0);
});

test('legacy AI Story image providers also generate only through Flow',async context=>{
  for(const provider of ['nano-banana','gpt-image','anymodel-image'] as const){
    let calls=0;const setup=await harness(context,{provider,mediaMode:'ai',generateImage:async()=>{calls++;return png;}});
    await setup.pipeline.resume(setup.project.id);await setup.pipeline.drain(30);
    assert.equal(calls,1);assert.deepEqual(setup.counts(),{anyModel:0,placeholder:0});
    assert.ok((await setup.pipeline.list()).every(task=>task.status==='done'));
  }
});

test('legacy AI Story video selection uses Flow and preserves its returned bytes',async context=>{
  let calls=0;const setup=await harness(context,{kind:'video',videoProvider:'anymodel-video',mediaMode:'ai',
    generateImage:async()=>{throw Error('Unexpected image generation');},generateVideo:async input=>{
      calls++;assert.equal(input.model,'veo_3_1_i2v_s_fast');return Buffer.from('existing-flow-response');
    }});
  await setup.pipeline.resume(setup.project.id);await setup.pipeline.drain(30);
  const task=(await setup.pipeline.list())[0]!;assert.equal(calls,1);assert.equal(task.status,'done');
  assert.equal(await readFile(task.resultPath!,'utf8'),'existing-flow-response');assert.equal(setup.counts().anyModel,0);
});

test("the queue dispatches five independent Flow image scenes concurrently", async (context) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let notifyFiveStarted!: () => void;
  const fiveStarted = new Promise<void>((resolve) => { notifyFiveStarted = resolve; });
  let active = 0;
  let maxActive = 0;
  const setup = await harness(context, {
    sceneOrders: [0, 1, 2, 3, 4],
    generateImage: async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (active === 5) notifyFiveStarted();
      await gate;
      active -= 1;
      return png;
    },
  });
  await setup.pipeline.resume(setup.project.id);
  const draining = setup.pipeline.drain(30);
  let timeout: NodeJS.Timeout | undefined;
  await Promise.race([
    fiveStarted,
    new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("five Flow image tasks did not start concurrently")), 2_000);
    }),
  ]).finally(() => clearTimeout(timeout));
  assert.equal(maxActive, 5);
  assert.equal((await setup.pipeline.list()).filter((task) => task.status === "running").length, 5);
  release();
  await draining;
  assert.ok((await setup.pipeline.list()).every((task) => task.status === "done"));
});

test("unavailable explicit Flow fails without charging AnyModel or creating a placeholder", async (context) => {
  let flowCalls = 0;
  const setup = await harness(context, {
    configured: false,
    generateImage: async () => { flowCalls += 1; return png; },
  });
  await setup.pipeline.resume(setup.project.id);
  await setup.pipeline.drain(30);
  const task = (await setup.pipeline.list())[0]!;
  assert.equal(task.status, "failed");
  assert.equal(setup.events.filter((event) => event.message === "queue.task.started").length, 1);
  assert.match(task.error ?? "", /Flow недоступен/);
  assert.equal(task.resultPath, undefined);
  assert.equal(flowCalls, 0);
  assert.deepEqual(setup.counts(), { anyModel: 0, placeholder: 0 });
});

test("a real image provider with an empty prompt fails before any generation", async (context) => {
  let flowCalls = 0;
  const setup = await harness(context, {
    prompt: "  ",
    generateImage: async () => { flowCalls += 1; return png; },
  });
  await setup.pipeline.resume(setup.project.id);
  await setup.pipeline.drain(30);
  const task = (await setup.pipeline.list())[0]!;
  assert.equal(task.status, "failed");
  assert.equal(setup.events.filter((event) => event.message === "queue.task.started").length, 1);
  assert.match(task.error ?? "", /Пустой промпт/);
  assert.equal(flowCalls, 0);
  assert.deepEqual(setup.counts(), { anyModel: 0, placeholder: 0 });
});

test("uncertain Flow submission prevents automatic retry, manual retry and legacy paid fallback", async (context) => {
  let submissions = 0;
  const setup = await harness(context, {
    provider: "anymodel-image", sceneOrders: [0, 1], completedOrders: [0],
    generateImage: async () => { submissions += 1; throw new FlowSubmissionUncertainError("image submission"); },
  });
  await setup.pipeline.resume(setup.project.id);
  await setup.pipeline.drain(30);
  const task = (await setup.pipeline.list()).find((item) => item.sceneId === "scene-1")!;
  assert.equal(task.status, "failed");
  assert.equal(setup.events.filter((event) => event.message === "queue.task.started").length, 1);
  assert.match(task.retryBlockedReason ?? "", /Flow мог уже создать/);
  assert.equal(task.nextAttemptAt, undefined);
  await assert.rejects(setup.pipeline.retry(task.id), /Flow мог уже создать/);
  assert.equal(submissions, 1);
  assert.deepEqual(setup.counts(), { anyModel: 0, placeholder: 0 });
});

test("pausing an in-flight uncertain image does not re-enable a paid submission on Resume", async (context) => {
  const entered = deferred<void>();
  const result = deferred<Buffer>();
  let submissions = 0;
  const setup = await harness(context, {
    generateImage: async () => { submissions += 1; entered.resolve(); return result.promise; },
  });
  await setup.pipeline.resume(setup.project.id);
  await setup.pipeline.tick();
  await entered.promise;
  await setup.pipeline.pause(setup.project.id);
  result.reject(new FlowSubmissionUncertainError("image response body"));
  await setup.pipeline.drain(30);
  const task = (await setup.pipeline.list())[0]!;
  assert.equal(task.status, "failed");
  assert.match(task.retryBlockedReason ?? "", /Flow мог уже создать/);
  await assert.rejects(setup.pipeline.retry(task.id), /Flow мог уже создать/);
  await setup.pipeline.resume(setup.project.id);
  await setup.pipeline.drain(30);
  assert.equal(submissions, 1);
  assert.deepEqual(setup.counts(), { anyModel: 0, placeholder: 0 });
});

test("a newly accepted image survives download failure without switching to AnyModel", async (context) => {
  let submissions = 0;
  let resumptions = 0;
  const setup = await harness(context, {
    provider: "anymodel-image", sceneOrders: [0, 1], completedOrders: [0],
    generateImage: async (input) => {
      if (!input.resumeJob) {
        submissions += 1;
        await input.onRemoteJob?.(remoteJob);
        throw new Error("Temporary image download failure");
      }
      resumptions += 1;
      assert.deepEqual(input.resumeJob, remoteJob);
      return png;
    },
  });
  await setup.pipeline.resume(setup.project.id);
  await setup.pipeline.drain(30);
  const task = (await setup.pipeline.list()).find((item) => item.sceneId === "scene-1")!;
  assert.equal(task.status, "done");
  assert.equal(submissions, 1);
  assert.equal(resumptions, 1);
  assert.deepEqual(setup.counts(), { anyModel: 0, placeholder: 0 });
  assert.equal(setup.events.filter((event) => event.message === "queue.task.image_fallback").length, 0);
});

test("restored image jobs retain their original account and media despite account cooldown", async (context) => {
  const inputs: FlowGenerateImageInput[] = [];
  const setup = await harness(context, {
    provider: "anymodel-image", configured: false, job: remoteJob, durable: true,
    generateImage: async (input) => { inputs.push(input); return png; },
  });
  const restored = setup.makePipeline();
  await restored.initialize();
  assert.equal(inputs.length, 0, "restart must await the user's Resume");
  await restored.resume(setup.project.id);
  await restored.drain(30);
  assert.equal(inputs.length, 1);
  assert.deepEqual(inputs[0]!.resumeJob, remoteJob);
  assert.equal((await restored.list())[0]!.status, "done");
  assert.deepEqual(setup.counts(), { anyModel: 0, placeholder: 0 });
});

test("durable paid submission without a receipt cannot be resubmitted after restart (image and video)",async(context)=>{
  for(const kind of ["image","video"] as const) {
    const entered=deferred<void>(),reply=deferred<Buffer>();let calls=0;
    const generate=async(input:FlowGenerateImageInput|FlowGenerateInput)=>{
      calls++;await input.onBeforeSubmit?.("original-account");entered.resolve();return reply.promise;
    };
    const setup=await harness(context,{durable:true,kind,generateImage:generate,generateVideo:generate});
    await setup.pipeline.resume(setup.project.id);await setup.pipeline.tick();await entered.promise;
    const disk=(await setup.repository.list())[0]!;
    assert.equal(disk.pendingSubmission?.accountId,"original-account");
    assert.equal(disk.pendingSubmission?.kind,kind);assert.equal(disk.status,"running");
    const restored=setup.makePipeline();await restored.initialize();
    const blocked=(await restored.list())[0]!;
    assert.equal(blocked.status,"failed");assert.match(blocked.retryBlockedReason??"",/повторная отправка отключена/);
    await restored.resume(setup.project.id);await restored.drain(3);
    await assert.rejects(restored.retry(blocked.id),/повторная отправка отключена/);
    assert.equal(calls,1,"No second paid call after reopening the disk checkpoint");
    // Settle only the fake first request after checking the recovered instance.
    reply.reject(new FlowSubmissionUncertainError("test transport ended"));await setup.pipeline.drain(3);
  }
});

test("accepted image receipt clears the pending checkpoint on disk before download completes",async(context)=>{
  const setup=await harness(context,{durable:true,generateImage:async(input)=>{
    await input.onBeforeSubmit?.("original-account");
    assert.ok((await setup.repository.list())[0]!.pendingSubmission);
    await input.onRemoteJob?.(remoteJob);
    const saved=(await setup.repository.list())[0]!;
    assert.equal(saved.pendingSubmission,undefined);assert.deepEqual(saved.remoteJob,remoteJob);
    return png;
  }});
  await setup.pipeline.resume(setup.project.id);await setup.pipeline.drain(30);
  assert.equal((await setup.repository.list())[0]!.status,"done");
});

test("a definite Flow rejection clears the durable submission guard",async(context)=>{
  const setup=await harness(context,{durable:true,generateImage:async(input)=>{
    await input.onBeforeSubmit?.("original-account");await input.onSubmitRejected?.();
    assert.equal((await setup.repository.list())[0]!.pendingSubmission,undefined);
    throw new Error("[no-retry] HTTP 403 test refusal");
  }});
  await setup.pipeline.resume(setup.project.id);await setup.pipeline.drain(3);
  assert.equal((await setup.repository.list())[0]!.pendingSubmission,undefined);
});

test("legacy in-flight Flow without a receipt is held, but tracked pre-submit work can resume",async(context)=>{
  for(const tracked of [false,true]) {
    let calls=0;
    const setup=await harness(context,{durable:true,generateImage:async()=>{calls++;return png;}});
    const task=(await setup.repository.list())[0]!;
    await setup.repository.replace([{...task,status:"running",submissionTrackingVersion:tracked?1:undefined}]);
    const restored=setup.makePipeline();await restored.initialize();
    assert.equal((await restored.list())[0]!.status,tracked?"paused":"failed");
    await restored.resume(setup.project.id);await restored.drain(20);
    assert.equal(calls,tracked?1:0);
  }
});

test("Stop aborts the in-flight Flow image signal and preserves a late accepted job", async (context) => {
  const entered = deferred<void>();
  let signal: AbortSignal | undefined;
  const setup = await harness(context, {
    generateImage: async (input) => {
      signal = input.signal;
      assert.ok(signal);
      entered.resolve();
      await new Promise<void>((resolve) => signal!.addEventListener("abort", () => resolve(), { once: true }));
      await input.onRemoteJob?.(remoteJob);
      throw signal.reason;
    },
  });
  await setup.pipeline.resume(setup.project.id);
  await setup.pipeline.tick();
  await entered.promise;
  await setup.pipeline.stop(setup.project.id);
  await setup.pipeline.drain(30);
  const task = (await setup.pipeline.list())[0]!;
  assert.equal(signal?.aborted, true);
  assert.equal(task.status, "cancelled");
  assert.equal(task.resultPath, undefined);
  assert.deepEqual(task.remoteJob, remoteJob);
  assert.deepEqual((await setup.repository.list())[0]!.remoteJob, remoteJob);
  assert.deepEqual(setup.counts(), { anyModel: 0, placeholder: 0 });
});

test("resuming a paid image needs neither missing local references nor remote reference downloads", async (context) => {
  let requests = 0;
  context.mock.method(globalThis, "fetch", async () => {
    requests += 1;
    throw new Error("A resume must not request the original reference");
  });
  let resumes = 0;
  const setup = await harness(context, {
    job: remoteJob,
    references: [join(tmpdir(), "gold-work-reference-that-does-not-exist.png"), "https://example.invalid/missing-reference.png"],
    generateImage: async (input) => {
      resumes += 1;
      assert.deepEqual(input.resumeJob, remoteJob);
      assert.deepEqual(input.references, []);
      return png;
    },
  });
  await setup.pipeline.resume(setup.project.id);
  await setup.pipeline.drain(30);
  assert.equal((await setup.pipeline.list())[0]!.status, "done");
  assert.equal(requests, 0);
  assert.equal(resumes, 1);
  assert.deepEqual(setup.counts(), { anyModel: 0, placeholder: 0 });
});

test("a disk failure after Flow returns bytes without a remote ID cannot trigger another paid generation", async (context) => {
  let submissions = 0;
  const setup = await harness(context, {
    failImageSave: true,
    generateImage: async () => { submissions += 1; return png; },
  });
  await setup.pipeline.resume(setup.project.id);
  await setup.pipeline.drain(30);
  const task = (await setup.pipeline.list())[0]!;
  assert.equal(task.status, "failed");
  assert.match(task.error ?? "", /локальное сохранение/);
  assert.match(task.retryBlockedReason ?? "", /Flow мог уже создать/);
  assert.equal(task.remoteJob, undefined);
  assert.equal(task.resultPath, undefined);
  await assert.rejects(setup.pipeline.retry(task.id), /Flow мог уже создать/);
  assert.equal(submissions, 1);
  assert.deepEqual(setup.counts(), { anyModel: 0, placeholder: 0 });
});
