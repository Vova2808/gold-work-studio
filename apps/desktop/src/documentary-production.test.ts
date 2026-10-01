import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryProjectRepository, MockDirectorProvider, ProjectService } from "@gold-work/core";
import { createVoiceCalibration, type DocumentaryCandidate, type QueueTask } from "@gold-work/shared";
import { DocumentaryProjectService } from "./documentary-project-service.js";
import { DocumentarySearch } from "./documentary-search.js";
import { LocalProjectStorage } from "./local-project-storage.js";
import { prepareDocumentaryScript } from "./documentary-plan.js";
import { documentaryNarrationReadiness } from "./documentary-production.js";
import { effectFfmpeg } from "./effect-media.js";

test("sources prepare before TTS; same-source checks overlap and use measured voice without losing audio", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-production-overlap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projects = new ProjectService(new MemoryProjectRepository(), new MockDirectorProvider());
  const storage = new LocalProjectStorage(join(root, "projects"));
  let project = await projects.create({ title: "Pattern", topic: "Pattern", mediaMode: "stock", mode: "standard", language: "English", aspectRatio: "16:9" });
  project.videoBrief = { ...project.videoBrief!, creationMode: "script", readyScript: "The first view shows a changing pattern. The next view shows its movement." };
  project.scenes = prepareDocumentaryScript(project, createVoiceCalibration({ provider: "elevenlabs", voice: "fixture", language: "en", sampleText: "A measured fixture voice reads these exact words.", audioDurationSeconds: 4 })).slice(0, 2);
  assert.equal(project.scenes.length, 2);
  project.scenes.forEach(scene => { scene.documentary!.requirement = { ...scene.documentary!.requirement, plannedBy: "semantic", entities: ["Pattern"], identities: [], queries: ["Pattern"], preferredKind: "video" }; });
  project.settings.stockVideoPercent = 0;
  project.settings.voice.enabled = true;
  project = await projects.update(project.id, project);
  const source = join(root, "pattern.mp4");
  await effectFfmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=30", "-t", "8", "-c:v", "libx264", "-preset", "ultrafast", source]);
  const voice = join(root, "voice.wav");
  await effectFfmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", voice]);
  const candidate = { id: "pattern", provider: "local", kind: "video", title: "Pattern", description: "Pattern", localPath: source, downloadUrl: "", query: "Pattern", rights: "user-confirmed", concerns: [], match: "exact-metadata" } as unknown as DocumentaryCandidate;
  const search = new DocumentarySearch();
  search.search = async () => ({ candidates: [candidate], sources: [] });
  let prepared = 0, inspecting = 0, peak = 0;
  let sourcesReady!: () => void, inspectionsReady!: () => void;
  const beforeVoice = new Promise<void>(resolve => { sourcesReady = resolve; });
  const bothInspecting = new Promise<void>(resolve => { inspectionsReady = resolve; });
  const tasks = project.scenes.map(scene => ({ id: scene.id, sceneId: scene.id, kind: "speech", status: "running" })) as QueueTask[];
  const controller = new AbortController();
  const waitForVoice = documentaryNarrationReadiness({ projectId: project.id, projects, storage, tasks, list: async () => tasks, signal: controller.signal });
  const service = new DocumentaryProjectService(projects, storage, search, join(root, "Materials"), { download: async () => { throw new Error("Local media"); } }, () => {}, {
    available: async () => true, plan: async () => new Map(),
    prepareSource: async (_project, scene) => {
      assert.equal(scene.audioPath, undefined, "Source catalogue must not wait for TTS");
      if (++prepared === 2) sourcesReady();
    },
    inspect: async (_project, scene) => {
      assert.equal(scene.audioPath, voice);
      assert.ok(scene.documentary!.timing!.durationInFrames >= 30 && scene.documentary!.timing!.durationInFrames <= 37);
      inspecting++; peak = Math.max(peak, inspecting);
      if (inspecting === 2) inspectionsReady();
      await bothInspecting;
      inspecting--;
      return { status: "accepted", confidence: 1, reason: "fixture", quality: "fixture", sampleSeconds: [], checkedAt: "now", trimStartSeconds: scene.order * 4, trimEndSeconds: scene.order * 4 + 1.2 };
    }
  });
  await projects.mutate(project.id, () => ({ status: "generating" }));
  const run = service.autoSelect(project.id, {}, waitForVoice);
  const deadline = setTimeout(() => { controller.abort(); sourcesReady(); inspectionsReady(); }, 10000);
  try {
    await beforeVoice;
    assert.equal(prepared, 2);
    await projects.mutate(project.id, current => ({ scenes: current.scenes.map(scene => ({ ...scene, audioPath: voice })), status: "ready" }));
    tasks.forEach(task => { task.status = "done"; });
    const result = await run;
    assert.equal(peak, 2, "Remote checks must not serialize on the source lock");
    assert.ok(result.project.scenes.every(scene => scene.audioPath === voice && scene.documentary?.timing));
  } finally { clearTimeout(deadline); controller.abort(); await run.catch(() => {}); }
});
