import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { MemoryProjectRepository, MockDirectorProvider, ProjectService } from "@gold-work/core";
import { createVoiceCalibration, type DocumentaryCandidate, type EffectAsset } from "@gold-work/shared";
import { prepareDocumentaryScript } from "./documentary-plan.js";
import { DocumentarySearch } from "./documentary-search.js";
import { DocumentaryProjectService } from "./documentary-project-service.js";
import { LocalProjectStorage } from "./local-project-storage.js";
import { effectFfmpeg } from "./effect-media.js";
import { prepareDocumentaryMedia } from "./documentary-media-cache.js";

test("stock uses cached identity across search phrases and keeps one project-volume original/proxy", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-stock-cache-test-"));
  await mkdir(resolve("captures"), { recursive: true });
  const library = await mkdtemp(join(resolve("captures"), "stock-cache-test-"));
  t.after(async () => { await rm(root, { recursive: true, force: true }); await rm(library, { recursive: true, force: true }); });
  const image = join(root, "image.png");
  await effectFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=blue:size=64x64", "-frames:v", "1", image]);
  let downloads = 0;
  const projects = new ProjectService(new MemoryProjectRepository(), new MockDirectorProvider());
  const storage = new LocalProjectStorage(join(root, "projects"));
  const service = new DocumentaryProjectService(projects, storage, new DocumentarySearch(), library, {
    download: async () => { downloads++; return { data: await readFile(image), extension: ".png", contentType: "image/png" }; },
  });
  let project = await projects.create({ title: "Ship", topic: "Ships", mediaMode: "stock", mode: "standard", language: "English", aspectRatio: "16:9" });
  project.videoBrief = { creationMode: "script", readyScript: "A ship crosses the ocean." } as NonNullable<typeof project.videoBrief>;
  project.scenes = prepareDocumentaryScript(project, createVoiceCalibration({ provider: "elevenlabs", voice: "test", language: "en", sampleText: "A measured voice reads every word at a natural pace.", audioDurationSeconds: 5 }));
  const candidate: DocumentaryCandidate = { id: "pexels:one", provider: "pexels", kind: "image", title: "Ship", description: "Ship", query: "first", downloadUrl: "https://example.test/one.png", pageUrl: "https://example.test/collection", concerns: [], match: "unverified", rights: "unknown", retrievedAt: new Date().toISOString(), license: "test", licenseUrl: "", attribution: "", author: "" };
  project.scenes = [0, 1, 2].map(order => ({ ...project.scenes[0]!, id: `scene-${order}`, order, documentary: { ...project.scenes[0]!.documentary!, candidates: [{ ...candidate, query: `query-${order}`, downloadUrl: `https://example.test/${order}.png`, ...(order === 2 ? { id: "pexels:different" } : {}) }] } }));
  project = await projects.mutate(project.id, () => project);
  await service.applyCandidate(project.id, "scene-0", candidate.id);
  project = await service.applyCandidate(project.id, "scene-1", candidate.id);
  assert.equal(downloads, 1, "changed query/URL must reuse the stable provider ID");
  const first = project.scenes[0]!.documentary!.selected!.localPath!;
  const second = project.scenes[1]!.documentary!.selected!.localPath!;
  assert.equal((await stat(first, { bigint: true })).ino, (await stat(second, { bigint: true })).ino);
  await service.applyCandidate(project.id, "scene-2", "pexels:different");
  assert.equal(downloads, 2, "a collection page is not the identity of an individual media file");
  // Simulate derivatives previously prepared on another drive. Only one local
  // copy is allowed; scene paths on this drive must be links to it.
  const checksum = "b".repeat(64), prepared = { state: "ready", metadata: { videoCodec: "h264", width: 64, height: 64, durationSeconds: 1 }, poster: `Previews/${checksum}.jpg`, proxy: `Proxies/${checksum}.mp4`, preview: `Proxies/${checksum}.mp4` };
  const shared = join(library, "Prepared", checksum);
  await mkdir(join(shared, "Previews"), { recursive: true }); await mkdir(join(shared, "Proxies"));
  await writeFile(join(shared, prepared.poster), "poster"); await writeFile(join(shared, prepared.proxy), "proxy");
  await writeFile(join(shared, "prepared.json"), JSON.stringify(prepared));
  const asset = { id: checksum, checksum, kind: "video" } as EffectAsset, localCache = join(root, "cache");
  const one = join(root, "one"), two = join(root, "two");
  await prepareDocumentaryMedia(one, asset, library, [], localCache);
  await prepareDocumentaryMedia(two, asset, library, [], localCache);
  assert.equal((await stat(join(one, prepared.proxy), { bigint: true })).ino, (await stat(join(two, prepared.proxy), { bigint: true })).ino);
  assert.equal(await readFile(join(two, prepared.proxy), "utf8"), "proxy");
});
