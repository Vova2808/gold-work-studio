/** Live QA only: one portrait, up to six frames, optionally one Veo. Existing TTS is reused.
 * Requires an isolated profile; durable remote IDs are kept and no failed run auto-restarts. */
import assert from "node:assert/strict";
import { app } from "electron";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { selectCharacterReference, type Project } from "@gold-work/shared";
import { AnyModelClient } from "../src/anymodel-client.js";
import { AnyModelStore } from "../src/anymodel-store.js";
import { FlowAccountStore } from "../src/flow-account-store.js";
import { FlowAuthService } from "../src/flow-auth-service.js";
import { FlowClient } from "../src/flow-client.js";
import { buildImagePrompt } from "../src/mock-generation-pipeline.js";
import { LocalProjectStorage } from "../src/local-project-storage.js";
import { applyMeasuredStoryTiming, measuredStoryTimingExpansion } from "../src/measured-story-timing.js";
import { StandardRenderer, mediaDurationSeconds, runFfmpeg, shouldUseAiVideo } from "../src/standard-renderer.js";

const profile = process.env.GOLD_WORK_FLOW_DATA_PATH!;
assert.ok(profile && /^gws-flow-live-/u.test(basename(profile)), "Use an isolated QA profile, never the open production cookie database");
assert.ok(process.env.GW_PROJECT_JSON, "A source project with existing audio is required");
assert.ok(process.env.GOLD_WORK_FLOW_ACCOUNT_ID, "Choose a verified account explicitly");
app.setPath("userData", profile);
app.on("window-all-closed", () => undefined);
app.commandLine.appendSwitch("force-webrtc-ip-handling-policy", "disable_non_proxied_udp");
app.commandLine.appendSwitch("disable-quic");
const root = resolve("captures", "flow-story-live", String(Date.now()));
const regenerateOne = process.argv.includes("--regenerate-one");
const sha = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const clean = (error: unknown) => String(error instanceof Error ? error.message : error)
  .replace(/(?:https?|socks5h?):\/\/[^\s]+/giu, "[URL]").replace(/Bearer\s+\S+/giu, "Bearer [REDACTED]").slice(0, 800);
const save = (name: string, data: unknown) => writeFile(join(root, name), JSON.stringify(data, null, 2));
let auth: FlowAuthService | undefined;
let step = "startup";
const controller = new AbortController();
const deadline = setTimeout(() => controller.abort(new Error("Live material QA deadline")), 900_000);
app.whenReady().then(async () => {
  await mkdir(root, { recursive: true });
  const sourceBytes = await readFile(process.env.GW_PROJECT_JSON!);
  const source: Project = JSON.parse(sourceBytes.toString("utf8"));
  assert.equal(source.mediaMode, "ai");
  if (regenerateOne) assert.ok(source.id.startsWith("live-material-qa-") && source.characterReference, "Regenerate only the existing QA sample");
  const sourceScenes = source.scenes.filter(scene => scene.includeInAssembly !== false && scene.audioPath).slice(0, 3);
  assert.equal(sourceScenes.length, 3);
  const originalAudio = await Promise.all(sourceScenes.map(async scene => ({path: scene.audioPath!, hash: sha(await readFile(scene.audioPath!))})));
  const project: Project = structuredClone({...source, id: `live-material-qa-${Date.now()}`, status: "ready", outputPath: undefined,
    scenes: sourceScenes.map((scene, order) => ({...scene, order, imagePath: regenerateOne ? scene.imagePath : undefined, videoPath: undefined, videoFallback: undefined,
      narrationSlice: undefined, editor: undefined, visualBeats: undefined, videoSelected: undefined, status: "draft"})),
    settings: {...source.settings, image: {...source.settings.image, references: [],
      style: "Flat 2D hand-drawn editorial comic illustration, bold clean ink outlines, soft paper texture, muted warm natural colors. No 3D render, no photorealism."},
      video: {...source.settings.video, enabled: false}, subtitles: {...source.settings.subtitles, enabled: false},
      music: {...source.settings.music, enabled: false}, assembly: {...source.settings.assembly, quality: "preview", kenBurns: true,
        kenBurnsDirection: "alternate", fadeTransitions: true, transitionType: "mix", transitionDurationSeconds: 0.4,
        montage: {...source.settings.assembly.montage, enabled: false}}}});
  const storage = new LocalProjectStorage(root);
  const expansion = await measuredStoryTimingExpansion(project, storage);
  if (expansion) Object.assign(project, applyMeasuredStoryTiming(project, expansion));
  assert.ok(project.scenes.length <= 6, "Bound this paid QA to six scene images");
  const store = new FlowAccountStore(join(profile, "credentials/flow/accounts.json"));
  auth = new FlowAuthService(store, () => undefined, () => undefined);
  const flow = new FlowClient(store, auth);
  const accountId = process.env.GOLD_WORK_FLOW_ACCOUNT_ID!;
  await auth.refresh(accountId);
  await auth.prepareRuntime(accountId, controller.signal);
  const sceneImage = async (name: string, prompt: string, references: Buffer[] = []) => {
    step = name;
    await save(`${name}-request.json`, {prompt, referenceCount: references.length, startedAt: new Date().toISOString()});
    console.log(`[flow-story-live] ${name}: generation started`);
    const bytes = await flow.generateImage({accountId, prompt, references, aspectRatio: "16:9", signal: controller.signal,
      onBeforeSubmit: async submittedAccountId => {
        assert.equal(submittedAccountId,accountId,"The QA request must not switch accounts");
        await save(`${name}-submission.json`,{state:"pending",accountId,startedAt:new Date().toISOString()});
      },
      onSubmitRejected: async () => save(`${name}-submission.json`,{state:"rejected",accountId}),
      onRemoteJob: async job => { if (job) {
        await save(`${name}-job.json`, job);
        await save(`${name}-submission.json`,{state:"accepted",accountId,mediaName:job.mediaName});
      } },
      onProgress: progress => { console.log(`[flow-story-live] ${name}: ${clean(progress.stage)}`); }});
    assert.ok(bytes.length > 1024);
    const path = join(root, `${name}.png`);
    await writeFile(path, bytes);
    return {path, bytes};
  };
  if (regenerateOne) {
    Object.assign(project, selectCharacterReference(project, source.characterReference!));
    const scene = project.scenes[1]!;
    const image = await sceneImage("scene-2-corrected", buildImagePrompt(project, scene), [await readFile(source.characterReference!.imagePath)]);
    scene.imagePath = image.path;
    scene.status = "ready";
    await save("project-checkpoint.json", project);
  } else {
  const anyModel = new AnyModelClient(new AnyModelStore(join(process.env.APPDATA!, "@gold-work/desktop/credentials/anymodel.json")));
  step = "hero-description";
  const hero = await anyModel.characterReference(project, stage => console.log(`[flow-story-live] ${stage}`),
    async prompt => (await sceneImage("hero", prompt)).bytes,
    "Максим: взрослый нарисованный ведущий, круглая белая голова, чёрные овальные глаза, без волос, светло-серая рубашка, оливковые брюки. Плоский 2D комикс, не 3D фигурка.");
  const character = {name: hero.name, prompt: hero.prompt, imagePath: join(root, "hero.png"), updatedAt: new Date().toISOString(), stylePrompt: project.settings.image.style};
  Object.assign(project, selectCharacterReference(project, character));
  await save("hero.json", character);
  for (const [index, scene] of project.scenes.entries()) {
    const image = await sceneImage(`scene-${index + 1}`, buildImagePrompt(project, scene), [hero.image]);
    scene.imagePath = image.path;
    scene.status = "ready";
    await save("project-checkpoint.json", project);
  }
  }
  let videoGenerated = false;
  if (process.argv.includes("--veo")) {
    const scene = project.scenes[0]!;
    step = "veo";
    await save("veo-request.json", {sceneId: scene.id, startedAt: new Date().toISOString()});
    console.log("[flow-story-live] Veo: one selected frame");
    const video = await flow.generateVideo({accountId, aspectRatio: project.aspectRatio, durationSeconds: 8,
      prompt: "Animate this exact flat 2D illustrated character subtly: a blink and slight thoughtful head movement. Preserve face, clothes, framing and drawing style. Fixed camera. No talking, music, text or extra characters.",
      startFrame: await readFile(scene.imagePath!), signal: controller.signal,
      onRemoteJob: async job => { if (job) await save("veo-job.json", job); },
      onProgress: progress => { console.log(`[flow-story-live] ${clean(progress.stage)}`); }});
    scene.videoPath = join(root, "veo.mp4");
    await writeFile(scene.videoPath, video);
    project.settings.video={...project.settings.video,enabled:true,provider:"flow",selectionMode:"manual"};
    scene.videoSelected=true;
    assert.ok(shouldUseAiVideo(project,scene),"A generated Veo clip must be included in the tested assembly");
    videoGenerated = true;
    await save("project-checkpoint.json", project);
  }
  step = "render";
  let bucket = -1;
  const output = await new StandardRenderer(storage).render(project, (stage, progress) => {
    if (Math.floor(progress / 10) > bucket) { bucket = Math.floor(progress / 10); console.log(`[flow-story-live] ${progress}% ${stage}`); }
  });
  const seconds = await mediaDurationSeconds(output);
  const expected = project.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
  assert.ok(Math.abs(seconds - expected) < 0.3, `Timeline drift: ${seconds} vs ${expected}`);
  assert.equal(sha(await readFile(process.env.GW_PROJECT_JSON!)), sha(sourceBytes));
  for (const audio of originalAudio) assert.equal(sha(await readFile(audio.path)), audio.hash, "Original TTS must remain unchanged");
  await runFfmpeg(["-y", "-i", output, "-vf", "fps=1/2,scale=320:-1,tile=4x3", "-frames:v", "1", join(root, "frames.jpg")]);
  await save("report.json", {sourceProject: source.id, accountId, referenceSha256:sha(await readFile(project.characterReference!.imagePath)), frames: project.scenes.length, imagesGenerated: regenerateOne ? 1 : project.scenes.length + 1,
    videoGenerated, reusedVoice: true, newTtsOrders: 0, seconds, expected, output, originalFilesUnchanged: true});
  console.log(`[flow-story-live] PASS ${root}`);
}).catch(async error => {
  await mkdir(root, {recursive: true});
  await save("failure.json", {step, error: clean(error), automaticRestart: false});
  console.error(`[flow-story-live] STOP ${step}: ${clean(error)}. Checkpoints: ${root}`);
  process.exitCode = 1;
}).finally(async () => { clearTimeout(deadline); await auth?.closeAll(); app.exit(process.exitCode ?? 0); });
