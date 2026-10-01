import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryProjectRepository, MemoryTaskRepository, MockDirectorProvider, ProjectService } from "@gold-work/core";
import { channelImageStyle, createDefaultProjectSettings, imageMotionFrame, resolveImageMotionPlan, prepareCharacterReferencePreview, selectCharacterReference, type ChannelCharacterReference, type Project, type QueueTask, type Scene } from "@gold-work/shared";
import { buildImagePrompt, requestsVisibleSceneText, MockGenerationPipeline, selectAiVideoSceneIndexes, type PipelineLogEvent } from "./mock-generation-pipeline.js";
import { resolveKenBurnsDirection, runFfmpeg, shouldUseAiVideo, StandardRenderer } from "./standard-renderer.js";
import { LocalProjectStorage } from "./local-project-storage.js";
import { applyNarrationSlice, narrationSliceTail, planNarrationSlices } from "./narration-timing.js";

test("measured narration splits retain exact text and contiguous bounded audio", () => {
  const text = "  Максим взял свой пылесос.\r\nОн приехал к клиенту в субботу.\u00a0Оплата — после уборки. 👨‍👩‍👧‍👦  ";
  for (const duration of [8, 8.8, 8.81, 9.7, 10.44, 17, 27.51, 50]) {
    const slices = planNarrationSlices(text, {durationSeconds: duration + 2, speechStartSeconds: 0.5, speechEndSeconds: duration + 0.5});
    assert.equal(slices.map(slice => slice.narration).join(""), text);
    assert.equal(slices[0]!.startSeconds, 0.5);
    assert.equal(slices.at(-1)!.endSeconds, duration + 0.5);
    for (const [index, slice] of slices.entries()) {
      assert.equal(slice.last, index === slices.length - 1);
      assert.ok(slice.endSeconds > slice.startSeconds);
      assert.ok(slice.endSeconds - slice.startSeconds + (slice.last ? 0.2 : 0) <= 9 + 1e-9);
      if (index) assert.equal(slice.startSeconds, slices[index - 1]!.endSeconds);
      assert.ok(!/^[\udc00-\udfff]|[\ud800-\udbff]$/u.test(slice.narration));
    }
  }
});

test("measured narration prefers a nearby pause without deleting it", () => {
  const slices = planNarrationSlices("Первый кадр. Второй кадр.", {
    durationSeconds: 11, speechStartSeconds: 0, speechEndSeconds: 10,
    silences: [{startSeconds: 4.9, endSeconds: 5.1}],
  });
  assert.equal(slices.length, 2);
  assert.equal(slices[0]!.endSeconds, 5);
  assert.equal(slices[1]!.startSeconds, 5);
});

test("narration slices reject corrupt ranges, preserve full-file measurements and omit only intermediate tails", () => {
  const info = {durationSeconds: 12, speechStartSeconds: 1, speechEndSeconds: 11, loudness: {value: -20}};
  const sliced = scene(0, {narrationSlice: {sourceSceneId: "original", startSeconds: 1, endSeconds: 6, last: false}});
  assert.deepEqual(applyNarrationSlice(sliced, info), {...info, speechStartSeconds: 1, speechEndSeconds: 6});
  assert.equal(narrationSliceTail(sliced, 0.2), 0);
  assert.equal(narrationSliceTail(scene(1), 0.2), 0.2);
  assert.equal(applyNarrationSlice(scene(0), info), info);
  for (const [startSeconds, endSeconds] of [[-1, 2], [2, 2], [0, 30], [NaN, 4]]) {
    assert.throws(() => applyNarrationSlice(scene(0, {narrationSlice: {sourceSceneId: "x", startSeconds: startSeconds!, endSeconds: endSeconds!, last: true}}), info), /no-retry/);
  }
  assert.throws(() => planNarrationSlices("text", {...info, speechEndSeconds: 13}), /границы/);
});

const scene = (order: number, patch: Partial<Scene> = {}): Scene => ({
  id: `scene-${order}`,
  order,
  title: `Scene ${order + 1}`,
  imagePrompt: `cinematic moment ${order + 1}`,
  animationPrompt: "subtle natural character movement and camera motion",
  narration: `Narration ${order + 1}`,
  durationSeconds: 5,
  status: "draft",
  ...patch,
});

const project = (count = 20): Project => ({
  id: "ai-story-visual-selection",
  title: "AI Story",
  topic: "test",
  aspectRatio: "16:9",
  language: "English",
  mode: "pro",
  mediaMode: "ai",
  status: "ready",
  createdAt: "2026-09-07T00:00:00.000Z",
  updatedAt: "2026-09-07T00:00:00.000Z",
  scenes: Array.from({ length: count }, (_, order) => scene(order)),
  settings: createDefaultProjectSettings(),
});

test("AI Story defaults select fifteen percent of important frames", () => {
  const draft = project();
  const selected = selectAiVideoSceneIndexes(draft);
  assert.equal(draft.settings.video.animationPercent, 15);
  assert.equal(selected.size, 3);
  assert.equal(selected.has(0), true, "hook must be a strong automatic candidate");
});

test("channel hero preview is not applied before confirmation and replacement cannot blend older faces", () => {
  const draft = project(1);
  draft.channelProfileId = "channel-A";
  const old = {name:"Maxim", prompt:"gray shirt, brown belt", imagePath:"C:/heroes/old.png", updatedAt:"old"};
  const candidate: ChannelCharacterReference = {...old, imagePath:"C:/heroes/new.png", prompt:"gray shirt, red cap", channelProfileId:"channel-A", versionId:"new", createdAt:"new"};
  draft.characterReference = old;
  draft.settings.image.references = [old.imagePath,"C:/heroes/older.png","C:/styles/watercolor.png"];
  const preview = prepareCharacterReferencePreview(draft,candidate,"watercolor","flow");
  assert.equal(preview.characterReference,old);
  assert.deepEqual(preview.settings.image.references,draft.settings.image.references);
  const confirmed = selectCharacterReference(draft,candidate,[old.imagePath,"C:/heroes/older.png"]);
  assert.equal(confirmed.characterReference,candidate);
  assert.deepEqual(confirmed.settings.image.references,[candidate.imagePath,"C:/styles/watercolor.png"]);
  assert.deepEqual(draft.settings.image.references,[old.imagePath,"C:/heroes/older.png","C:/styles/watercolor.png"],"input must not be mutated");
  assert.throws(()=>selectCharacterReference({...draft,channelProfileId:"channel-B"},candidate),/другому каналу/);
  assert.throws(()=>selectCharacterReference({...draft,status:"generating"},candidate),/остановите/);
  assert.throws(()=>prepareCharacterReferencePreview({...draft,status:"paused"},candidate,"watercolor","flow"),/остановите/);
});

test("AI frame prompt carries selected style and active identity without forcing a hero or captions into every shot", () => {
  const draft = project(1);
  draft.language = "Español";
  draft.settings.image.style = "flat hand-drawn watercolor, no 3D";
  draft.characterReference = {name:"Maxim",prompt:"white round head, gray shirt, brown belt",imagePath:"hero.png",updatedAt:""};
  draft.settings.image.references = ["hero.png"];
  const prompt = buildImagePrompt(draft,scene(0,{imagePrompt:"A readable sign above the shop"}));
  assert.ok(prompt.includes(draft.settings.image.style));
  assert.ok(prompt.includes(draft.characterReference.prompt));
  assert.match(prompt,/only when this character is present/);
  assert.match(prompt,/language \(Español\)/);
  const withoutText = buildImagePrompt(draft,scene(0));
  assert.match(withoutText,/Do not add text, captions/);
  draft.settings.image.references = [];
  assert.ok(!buildImagePrompt(draft,scene(0)).includes(draft.characterReference.prompt),"inactive hero must not leak into the prompt");
});

test("text requests exclude visible anatomy, design and negative captions", () => {
  for (const prompt of [
    "MAKSIM, no visible nose, full body visible, character design, holding a plain gray cardboard box",
    "Character surrounded by floating blank glowing colorful blank signboards without any writing",
    "A person without text, captions or labels. No watermark or logos.",
    "Text-free illustration with a blank sign above the door",
    "Персонаж без текста, надписей и подписей",
  ]) assert.equal(requestsVisibleSceneText(prompt),false,prompt);
  for (const prompt of [
    "A readable sign above the shop", "A signboard reading STOP", "The word written on the box is ДОМ",
    "Russian words written on a box", "Visible text on the blackboard", "На коробке написано ДОМ",
    "No text on the shirt. A sign reading OPEN above the shop.",
  ]) assert.equal(requestsVisibleSceneText(prompt),true,prompt);
  const prompt = buildImagePrompt(project(1),scene(0,{imagePrompt:"MAKSIM, no visible nose, holding a plain box"}));
  assert.match(prompt,/Do not add text, captions/);
  assert.doesNotMatch(prompt,/explicitly requires visible text/);
  assert.match(prompt,/metadata, not words to draw/);
});

test("manual Veo mode creates no automatic video tasks", () => {
  const draft = project(8);
  draft.settings.video.selectionMode = "manual";
  assert.deepEqual([...selectAiVideoSceneIndexes(draft)], []);
});

test("new AI stories inherit channel style or selected hero style, without rewriting existing overrides", () => {
  const hero: ChannelCharacterReference = {
    name: "Maxim", prompt: "gray coat", imagePath: "C:/heroes/hero.png", updatedAt: "now", createdAt: "now",
    versionId: "v1", channelProfileId: "channel-A", stylePrompt: "Flat 2D watercolor",
  };
  const channel = { direction: "ai-story" as const, defaultImageStyle: "Ink drawing", primaryCharacter: hero };
  assert.equal(channelImageStyle(channel, "3D default"), "Ink drawing");
  assert.equal(channelImageStyle(channel, "3D default", true), "Flat 2D watercolor");
  assert.equal(channelImageStyle({ ...channel, defaultImageStyle: undefined }, "3D default"), "Flat 2D watercolor");
  assert.equal(channelImageStyle({ direction: "ai-story" }, "3D default"), "3D default");
  assert.equal(channelImageStyle({ ...channel, direction: "stock-documentary" }, "original stock"), "original stock");
  const existing = project(1);
  existing.channelProfileId = hero.channelProfileId;
  existing.settings.image.style = "Explicit per-video override";
  assert.equal(selectCharacterReference(existing, hero).settings.image.style, "Explicit per-video override");
});

test("assembly detects deleted or empty media before rendering and without automatic retry", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gws-ai-story-missing-media-"));
  context.after(() => rm(directory, {recursive:true, force:true}));
  const draft = project(1);
  draft.settings.voice.enabled = false;
  const renderer = new StandardRenderer(new LocalProjectStorage(directory));
  draft.scenes[0]!.imagePath = join(directory, "missing.png");
  await assert.rejects(renderer.render(draft), /\[no-retry\].*сцена 1: изображение/u);
  await writeFile(draft.scenes[0]!.imagePath, "");
  await assert.rejects(renderer.render(draft), /\[no-retry\].*сцена 1: изображение/u);
  await writeFile(draft.scenes[0]!.imagePath, "not-decoded-in-this-test");
  draft.settings.voice.enabled = true;
  draft.scenes[0]!.audioPath = join(directory, "deleted.mp3");
  await assert.rejects(renderer.render(draft), /\[no-retry\].*сцена 1: озвучка/u);
});

test("interval modes skip excluded frames and remain deterministic", () => {
  const draft = project(7);
  draft.scenes[1]!.includeInAssembly = false;
  draft.settings.video.selectionMode = "every-second";
  assert.deepEqual([...selectAiVideoSceneIndexes(draft)], [2, 4, 6]);
  draft.settings.video.selectionMode = "every-third";
  assert.deepEqual([...selectAiVideoSceneIndexes(draft)], [3, 6]);
});

test("smart motion preserves planned pans and has a varied safe fallback", () => {
  const draft = project(4);
  draft.settings.assembly.kenBurns = true;
  draft.settings.assembly.kenBurnsDirection = "smart";
  assert.equal(resolveKenBurnsDirection(draft, scene(0, { autoKenBurnsDirection: "pan-right" })), "pan-right");
  assert.deepEqual(
    draft.scenes.map((item) => resolveKenBurnsDirection(draft, { ...item, autoKenBurnsDirection: undefined })),
    ["in", "pan-left", "out", "pan-right"],
  );
});

test("AI portrait zoom preserves a head near the upper edge in the actual FFmpeg frame", async context => {
  const directory = await mkdtemp(join(tmpdir(), "gws-portrait-framing-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const width = 640, height = 360, rowBytes = width * 3;
  const bitmap = Buffer.alloc(54 + rowBytes * height);
  bitmap.write("BM"); bitmap.writeUInt32LE(bitmap.length, 2); bitmap.writeUInt32LE(54, 10);
  bitmap.writeUInt32LE(40, 14); bitmap.writeInt32LE(width, 18); bitmap.writeInt32LE(height, 22);
  bitmap.writeUInt16LE(1, 26); bitmap.writeUInt16LE(24, 28); bitmap.writeUInt32LE(rowBytes * height, 34);
  // Blue circle stands for a complete head with 10px of original headroom.
  // This is a geometric regression fixture, not a face recognition test.
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const head = (x - 320) ** 2 + (y - 28) ** 2 <= 18 ** 2;
    const offset = 54 + (height - 1 - y) * rowBytes + x * 3;
    bitmap[offset] = head ? 235 : 90; bitmap[offset + 1] = head ? 70 : 90; bitmap[offset + 2] = head ? 25 : 90;
  }
  const imagePath = join(directory, "headroom.bmp");
  await writeFile(imagePath, bitmap);
  const draft = project(1);
  draft.settings.voice.enabled = false;
  draft.settings.subtitles.enabled = false;
  draft.settings.assembly.quality = "preview";
  draft.settings.assembly.kenBurns = true;
  draft.settings.assembly.kenBurnsDirection = "alternate";
  const item = scene(1, { imagePath, imagePrompt: "Adult cartoon host, medium shot, round head, gray shirt",
    narration: "", durationSeconds: 1, autoKenBurnsZoom: 1.12 });
  const output = await new StandardRenderer(new LocalProjectStorage(directory)).renderScene(draft, item);
  const pixelsPath = join(directory, "first.rgb");
  await runFfmpeg(["-y", "-i", output, "-frames:v", "1", "-vf", "scale=640:360", "-pix_fmt", "rgb24", "-f", "rawvideo", pixelsPath]);
  const pixels = await readFile(pixelsPath);
  const blue = (offset: number) => pixels[offset + 2]! > pixels[offset]! + 90 && pixels[offset + 2]! > pixels[offset + 1]! + 70;
  const headPixels = Array.from({ length: width * height }, (_, index) => index).filter(index => blue(index * 3));
  assert.ok(headPixels.length > 800, "The head must exist, not be replaced by a blank frame");
  assert.ok(Math.min(...headPixels.map(index => Math.floor(index / width))) >= 8, "The zoom must not cut the top of the head");
  for (const offset of [0, (width - 1) * 3, (width * (height - 1)) * 3, (width * height - 1) * 3]) {
    assert.ok(pixels[offset]! > 60, "Motion must not introduce black corners");
  }
});

test("shared image motion keeps zoom/pan crop inside the image and maps CSS to FFmpeg coordinates", () => {
  const draft = project(1);
  draft.settings.assembly.kenBurns = true;
  draft.settings.assembly.kenBurnsDirection = "smart";
  for (const direction of ["in", "out", "pan-left", "pan-right"] as const) {
    for (const zoom of [1, 1.05, 1.12, 1.5, Number.NaN]) {
      const plan = resolveImageMotionPlan(draft, scene(0, { imagePrompt: "Adult cartoon host, medium shot", autoKenBurnsDirection: direction, autoKenBurnsZoom: zoom }));
      assert.equal(plan.anchorY, 0);
      for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
        const frame = imageMotionFrame(plan, progress);
        assert.ok(frame.cropX >= 0 && frame.cropY >= 0);
        assert.ok(frame.cropX + 1 / frame.zoom <= 1 + 1e-9);
        assert.ok(frame.cropY + 1 / frame.zoom <= 1 + 1e-9);
        assert.ok(Math.abs(frame.translateXPercent / 100 + frame.cropX * frame.zoom) < 1e-9);
        assert.ok(Math.abs(frame.translateYPercent / 100 + frame.cropY * frame.zoom) < 1e-9);
        assert.ok((0.01 - frame.cropY) * frame.zoom > 0, "A head 1% below the top must remain below the top");
      }
    }
  }
});

test("portrait framing is AI-only, does not force absent characters and preserves explicit zoom/off settings", () => {
  const draft = project(1);
  const portrait = scene(0, { imagePrompt: "Портрет главного героя", kenBurnsZoom: 1.2 });
  assert.equal(resolveImageMotionPlan(draft, portrait).anchorY, 0);
  assert.equal(resolveImageMotionPlan(draft, portrait).maximumZoom, 1.2);
  assert.equal(resolveImageMotionPlan({ ...draft, mediaMode: "stock" }, portrait).anchorY, 0.5);
  assert.equal(resolveImageMotionPlan(draft, scene(0, { imagePrompt: "An empty room without people" })).anchorY, 0.5);
  assert.equal(resolveImageMotionPlan(draft, scene(0, { imagePrompt: "A landscape with no characters" })).anchorY, 0.5);
  const off = imageMotionFrame(resolveImageMotionPlan(draft, { ...portrait, kenBurnsDirection: "off" }), 0.8);
  assert.equal(off.zoom, 1); assert.equal(off.cropX, 0); assert.equal(off.cropY, 0);
  assert.equal(portrait.kenBurnsZoom, 1.2, "Resolving motion must not rewrite the scene");
});

test("AI Story queue skips excluded scenes and waits for all images before Veo", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gws-ai-story-image-set-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const repository = new MemoryProjectRepository();
  const service = new ProjectService(repository, new MockDirectorProvider());
  const draft = project(3);
  draft.settings.video.enabled = true;
  draft.settings.image.sequential = true;
  draft.scenes[1] = { ...draft.scenes[1]!, includeInAssembly: false, imagePath: "keep-excluded.png" };
  await repository.save(draft);
  const storage = new LocalProjectStorage(directory);
  const pipeline = new MockGenerationPipeline(new MemoryTaskRepository(), service, storage, new StandardRenderer(storage));
  const tasks = await pipeline.start(draft.id);
  assert.equal(tasks.some(task => task.sceneId === draft.scenes[1]!.id), false);
  const images = tasks.filter(task => task.kind === "image");
  assert.equal(images.length, 2);
  assert.deepEqual(images[1]?.dependsOn, [images[0]!.id]);
  const video = tasks.find(task => task.kind === "video");
  assert.ok(video);
  assert.deepEqual(video.dependsOn, images.map(task => task.id));
  assert.equal((await service.get(draft.id))?.scenes[1]?.imagePath, "keep-excluded.png");
  const internals = pipeline as unknown as { tasks: QueueTask[]; syncProjects(): Promise<void> };
  for (const task of internals.tasks) { task.status = "done"; task.progress = 100; task.resultPath = task.kind + ".test"; }
  await internals.syncProjects();
  assert.equal((await service.get(draft.id))?.status, "complete", "excluded scene must not fail the scene graph");
});

test("image generation does not wait for an unrelated TTS task", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gws-ai-story-independent-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const projects = new MemoryProjectRepository();
  const service = new ProjectService(projects, new MockDirectorProvider());
  const draft = project(1);
  draft.settings.voice.enabled = true;
  draft.settings.video.enabled = false;
  await projects.save(draft);
  const storage = new LocalProjectStorage(directory);
  const pipeline = new MockGenerationPipeline(new MemoryTaskRepository(), service, storage, new StandardRenderer(storage));
  const tasks = await pipeline.start(draft.id);
  const speech = tasks.find((task) => task.kind === "speech");
  const image = tasks.find((task) => task.kind === "image");
  assert.ok(speech);
  assert.ok(image);
  assert.equal(image.dependsOn.includes(speech.id), false);
});

const flowVideoTask = (draft: Project, remoteJob?: QueueTask["remoteJob"]): QueueTask => ({
  id: "flow-video-task",
  runId: "flow-video-run",
  projectId: draft.id,
  sceneId: draft.scenes[0]!.id,
  kind: "video",
  label: "Flow video",
  status: "running",
  attempts: 1,
  maxAttempts: 3,
  progress: 10,
  dependsOn: [],
  createdAt: "2026-09-07T00:00:00.000Z",
  updatedAt: "2026-09-07T00:00:00.000Z",
  remoteJob,
});

test("unconfigured Flow video safely falls back to an existing static image", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gws-ai-story-flow-static-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const imagePath = join(directory, "ready-frame.png");
  await writeFile(imagePath, Buffer.from("ready image"));
  const draft = project(1);
  draft.settings.video.enabled = true;
  draft.settings.video.provider = "flow";
  draft.settings.image.provider = "flow";
  draft.scenes[0] = { ...draft.scenes[0]!, imagePath };
  const projects = new MemoryProjectRepository();
  await projects.save(draft);
  const service = new ProjectService(projects, new MockDirectorProvider());
  const storage = new LocalProjectStorage(directory);
  const renderer = new StandardRenderer(storage);
  const fallbackPath = join(directory, "static-fallback.mp4");
  let staticRenders = 0;
  renderer.renderScene = async () => { staticRenders += 1; return fallbackPath; };
  let videoSubmissions = 0;
  const flow = {
    configured: async () => false,
    generateVideo: async () => { videoSubmissions += 1; return Buffer.from("unexpected"); },
  };
  const events: PipelineLogEvent[] = [];
  const pipeline = new MockGenerationPipeline(
    new MemoryTaskRepository(), service, storage, renderer, undefined,
    (event) => events.push(event), undefined, undefined, undefined, flow as never,
  );
  const executeTask = (pipeline as unknown as { executeTask(task: QueueTask): Promise<string> }).executeTask.bind(pipeline);
  const task = flowVideoTask(draft);
  assert.equal(await executeTask(task), fallbackPath);
  assert.equal(task.resultFallback, "static-image");
  assert.equal(staticRenders, 1);
  assert.equal(videoSubmissions, 0);
  assert.equal(events.some((event) => event.message === "queue.task.video_fallback" && event.details?.fallback === "static-image"), true);
});

test("a persisted Flow video job resumes even when configured reports unavailable", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gws-ai-story-flow-resume-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const imagePath = join(directory, "ready-frame.png");
  await writeFile(imagePath, Buffer.from("ready image"));
  const draft = project(1);
  draft.settings.video.enabled = true;
  draft.settings.video.provider = "flow";
  draft.settings.image.provider = "flow";
  draft.scenes[0] = { ...draft.scenes[0]!, imagePath };
  const projects = new MemoryProjectRepository();
  await projects.save(draft);
  const service = new ProjectService(projects, new MockDirectorProvider());
  const storage = new LocalProjectStorage(directory);
  const renderer = new StandardRenderer(storage);
  let staticRenders = 0;
  renderer.renderScene = async () => { staticRenders += 1; return join(directory, "must-not-fallback.mp4"); };
  let configuredChecks = 0;
  let resumedMediaName: string | undefined;
  const flow = {
    configured: async () => { configuredChecks += 1; return false; },
    generateVideo: async (input: { resumeJob?: { mediaName?: string } }) => {
      resumedMediaName = input.resumeJob?.mediaName;
      return Buffer.from("resumed video");
    },
  };
  const pipeline = new MockGenerationPipeline(
    new MemoryTaskRepository(), service, storage, renderer, undefined,
    undefined, undefined, undefined, undefined, flow as never,
  );
  const remoteJob: NonNullable<QueueTask["remoteJob"]> = {
    provider: "flow",
    accountId: "account-1",
    projectId: "flow-project-1",
    mediaName: "already-submitted-video",
    modelKey: "VEO_3_1_I2V_S_FAST",
    submittedAt: "2026-09-07T00:00:00.000Z",
  };
  const executeTask = (pipeline as unknown as { executeTask(task: QueueTask): Promise<string> }).executeTask.bind(pipeline);
  const resultPath = await executeTask(flowVideoTask(draft, remoteJob));
  assert.match(resultPath, /scene\.mp4$/);
  assert.equal(resumedMediaName, remoteJob.mediaName);
  assert.equal(configuredChecks, 0, "a persisted job must bypass availability selection and resume its account");
  assert.equal(staticRenders, 0);
});

test("a permanent Flow video refusal falls back to the ready image and still assembles AI Story", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gws-ai-story-veo-fallback-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const projects = new MemoryProjectRepository();
  const service = new ProjectService(projects, new MockDirectorProvider());
  const draft = project(1);
  draft.settings.voice.enabled = false;
  draft.settings.image.provider = "mock-image";
  draft.settings.video.enabled = true;
  draft.settings.video.provider = "flow";
  draft.settings.video.startFrame = false;
  draft.settings.video.animationPercent = 100;
  await projects.save(draft);

  let staticFallbacks = 0;
  const renderer = {
    renderScene: async () => {
      staticFallbacks += 1;
      return join(directory, "fallback-scene.mp4");
    },
    render: async () => join(directory, "Final.mp4"),
  } as unknown as StandardRenderer;
  const flow = {
    configured: async () => true,
    generateVideo: async () => {
      throw new Error("[no-retry] Flow недоступен для текущего аккаунта");
    },
  };
  const pipeline = new MockGenerationPipeline(
    new MemoryTaskRepository(),
    service,
    new LocalProjectStorage(directory),
    renderer,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    flow as never,
  );

  await pipeline.start(draft.id);
  await pipeline.drain();

  const completedTasks = await pipeline.list();
  assert.equal(staticFallbacks, 1, JSON.stringify(completedTasks, null, 2));
  assert.equal((await service.get(draft.id))?.status, "complete");
  assert.equal(completedTasks.find((task) => task.kind === "video")?.status, "done");
  assert.equal(completedTasks.find((task) => task.kind === "video")?.resultFallback, "static-image");
  assert.match(completedTasks.find((task) => task.kind === "video")?.stage ?? "", /Без анимации/);
  const completed = (await service.get(draft.id))!;
  assert.equal(completed.scenes[0]?.videoFallback, "static-image");
  assert.equal(shouldUseAiVideo(completed, completed.scenes[0]!, () => true), false,
    "Final must render the original still, not treat a local fallback as generated Veo");
  assert.equal(shouldUseAiVideo(completed, { ...completed.scenes[0]!, videoFallback: undefined }, () => true), true);
});
