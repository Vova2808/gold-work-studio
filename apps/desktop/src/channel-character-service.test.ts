import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MemoryProjectRepository, MockDirectorProvider, ProjectService } from "@gold-work/core";
import { sceneImageReferences, selectCharacterReference, type FlowRemoteImageJob } from "@gold-work/shared";
import { ChannelProfileStore } from "./channel-profile-store.js";
import { ChannelCharacterService } from "./channel-character-service.js";
import { LocalProjectStorage } from "./local-project-storage.js";
import { StoryCharacterService } from "./story-character-service.js";
import { readyScriptChannelHeroContext } from "./ready-script.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "gws-channel-hero-"));
  const profiles = new ChannelProfileStore(join(dir, "channels.json"));
  const input = { name: "AI channel", countryCode: "US", languageCode: "en", languageLabel: "English", masterPrompt: "",
    direction: "ai-story" as const, defaultMediaMode: "ai" as const, defaultDurationMinutes: 10, motionTemplate: "none" };
  const channel = await profiles.create(input);
  const other = await profiles.create({ ...input, name: "Other channel" });
  const projects = new ProjectService(new MemoryProjectRepository(), new MockDirectorProvider());
  let project = await projects.create({ title: "Finished video", topic: "Test", language: "English", aspectRatio: "16:9", mode: "pro", channelProfileId: channel.id }, true);
  const originalPath = join(dir, "source.png");
  await writeFile(originalPath, png);
  project = await projects.update(project.id, { mediaMode: "ai", status: "complete", outputPath: join(dir, "Final.mp4"), storyCharacters: [{
    id: "main", name: "Sam", aliases: ["Main User/Viewer"], prompt: "White round face, gray shirt", stylePrompt: "Flat 2D", imagePath: originalPath, status: "ready",
    candidate: { imagePath: join(dir, "unconfirmed.png"), prompt: "Wrong unconfirmed face", stylePrompt: "Flat 2D", createdAt: new Date().toISOString() },
  }] });
  const storage = new LocalProjectStorage(join(dir, "workspace"));
  return { dir, profiles, channel, other, projects, project, originalPath, storage };
}

test("publishing cast copies the accepted portrait into its channel, survives source deletion, never mutates finished videos", async () => {
  const f = await fixture();
  try {
    const before = await f.projects.get(f.project.id);
    const service = new ChannelCharacterService(f.profiles, f.projects, f.storage, async () => { throw new Error("Publishing must not generate"); });
    const profile = await service.publish(f.project.id, "main");
    assert.equal(profile.primaryCharacter?.name, "Sam");
    assert.equal(profile.primaryCharacter?.prompt, "White round face, gray shirt");
    assert.notEqual(profile.primaryCharacter?.imagePath, f.originalPath);
    assert.deepEqual(await readFile(profile.primaryCharacter!.imagePath), png);
    assert.deepEqual(await f.projects.get(f.project.id), before);
    assert.equal((await service.publish(f.project.id, "main")).characterVersions.length, 1, "Repeated click reuses the same version");
    assert.equal((await f.profiles.get(f.other.id))?.primaryCharacter, undefined);
    await assert.rejects(service.select(f.other.id, profile.primaryCharacter!.versionId), /не найдена/);
    await assert.rejects(service.publish(f.project.id, "not-in-this-project"), /Сначала создайте/);
    await rm(f.originalPath);
    const fresh = await new ChannelProfileStore(join(f.dir, "channels.json")).get(f.channel.id);
    assert.deepEqual(await readFile(fresh!.primaryCharacter!.imagePath), png, "Channel copy survives deleted source");
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("new channel portrait is a durable candidate, explicitly selected; older project and version remain unchanged", async () => {
  const f = await fixture();
  try {
    let calls = 0;
    const service = new ChannelCharacterService(f.profiles, f.projects, f.storage, async (prompt, style) => {
      calls++; assert.equal(prompt, "Green coat and glasses"); assert.equal(style, "Flat 2D"); return png;
    });
    const initial = (await service.publish(f.project.id, "main")).primaryCharacter!;
    let next = await f.projects.create({ title: "Next", topic: "Test", language: "English", aspectRatio: "16:9", mode: "pro", channelProfileId: f.channel.id }, true);
    next = await f.projects.update(next.id, { ...selectCharacterReference(next, initial), mediaMode: "ai", scenes: next.scenes.slice(0, 2) });
    const snapshot = structuredClone(next);
    const profile = await service.generate(f.channel.id, { sourceVersionId: initial.versionId, name: "Samuel", prompt: "Green coat and glasses" });
    assert.equal(calls, 1);
    assert.equal(profile.characterGeneration, undefined);
    assert.equal(profile.primaryCharacter?.versionId, initial.versionId);
    assert.equal(profile.characterVersions.length, 2);
    const candidate = profile.characterVersions[0]!;
    assert.ok(candidate.aliases?.includes("Sam"));
    assert.ok(candidate.aliases?.includes("Main User/Viewer"));
    await new ChannelCharacterService(new ChannelProfileStore(join(f.dir, "channels.json")), f.projects, f.storage, async () => png)
      .select(f.channel.id, candidate.versionId);
    assert.deepEqual(await f.projects.get(next.id), snapshot, "Changing the channel never upgrades existing projects");
    assert.deepEqual(await readFile(initial.imagePath), png);
    await service.select(f.channel.id, initial.versionId);
    assert.equal((await f.profiles.get(f.channel.id))?.primaryCharacter?.versionId, initial.versionId);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("known Flow portrait jobs survive restart and are retrieved without resubmission; wrong recovery inputs are rejected", async () => {
  const f = await fixture();
  try {
    const job: FlowRemoteImageJob = { provider: "flow", kind: "image", accountId: "account", projectId: "remote-project",
      mediaName: "media/portrait", modelKey: "test-model", submittedAt: new Date().toISOString() };
    let calls = 0;
    const service = new ChannelCharacterService(f.profiles, f.projects, f.storage, async (_prompt, _style, recovery) => {
      calls++; await recovery.onRemoteJob(job); throw new Error("Download failed");
    });
    const initial = (await service.publish(f.project.id, "main")).primaryCharacter!;
    const input = { sourceVersionId: initial.versionId, name: "Sam", prompt: "Green coat" };
    await assert.rejects(service.generate(f.channel.id, input), /Download failed/);
    const freshStore = new ChannelProfileStore(join(f.dir, "channels.json"));
    assert.deepEqual((await freshStore.get(f.channel.id))?.characterGeneration?.remoteJob, job);
    const resumed = new ChannelCharacterService(freshStore, f.projects, f.storage, async (_prompt, _style, recovery) => {
      calls++; assert.deepEqual(recovery.resumeJob, job); return png;
    });
    await assert.rejects(resumed.generate(f.channel.id, { ...input, prompt: "Different request" }), /Сначала получите/);
    assert.equal(calls, 1);
    const result = await resumed.generate(f.channel.id, input);
    assert.equal(result.characterGeneration, undefined);
    assert.equal(result.primaryCharacter?.versionId, initial.versionId);
    assert.equal(result.characterVersions.length, 2);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("next video reuses the chosen channel identity and portrait by alias, only in assigned shots, with exact narration", async () => {
  const f = await fixture();
  try {
    const service = new ChannelCharacterService(f.profiles, f.projects, f.storage, async () => png);
    const hero = (await service.publish(f.project.id, "main")).primaryCharacter!;
    let next = await f.projects.create({ title: "New video", topic: "Test", language: "English", aspectRatio: "16:9", mode: "pro", channelProfileId: f.channel.id }, true);
    next = await f.projects.update(next.id, { ...selectCharacterReference(next, hero), mediaMode: "ai", scenes: next.scenes.slice(0, 2) });
    const text = next.scenes.map(scene => scene.narration);
    const cast = new StoryCharacterService(f.projects, {
      describeStoryCharacters: async () => [{ name: "Main User/Viewer", aliases: [], prompt: "Should not replace the saved identity", sceneNumbers: [1] }],
      generateStoryCharacterPortrait: async () => { throw new Error("Existing hero must not be regenerated"); },
    }, f.storage, async () => { throw new Error("No paid call expected"); });
    const prepared = await cast.prepare(next.id);
    assert.equal(prepared.storyCharacters?.[0]?.name, "Sam");
    assert.equal(prepared.storyCharacters?.[0]?.prompt, hero.prompt);
    assert.deepEqual(sceneImageReferences(prepared, prepared.scenes[0]!), [hero.imagePath]);
    assert.deepEqual(sceneImageReferences(prepared, prepared.scenes[1]!), []);
    assert.deepEqual(prepared.scenes.map(scene => scene.narration), text);
    assert.match(readyScriptChannelHeroContext(prepared), /Sam/);
    assert.match(readyScriptChannelHeroContext(prepared), /White round face/);
    assert.equal(readyScriptChannelHeroContext({}), "");
    const other = await f.projects.create({ title: "Other", topic: "Test", language: "English", aspectRatio: "16:9", mode: "pro", channelProfileId: f.other.id }, true);
    assert.throws(() => selectCharacterReference(other, hero), /другому каналу/);
    assert.equal(other.characterReference, undefined);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("deleting channel versions is durable and recoverable without deleting images, changing existing videos or selecting a replacement", async () => {
  const f = await fixture();
  try {
    const service = new ChannelCharacterService(f.profiles, f.projects, f.storage, async () => png);
    const hero = (await service.publish(f.project.id, "main")).primaryCharacter!;
    let next = await f.projects.create({ title: "Uses hero", topic: "Test", language: "English", aspectRatio: "16:9", mode: "pro", channelProfileId: f.channel.id }, true);
    next = await f.projects.update(next.id, selectCharacterReference(next, hero));
    const before = structuredClone(next);
    const generated = await service.generate(f.channel.id, { sourceVersionId: hero.versionId, name: "Second version", prompt: "Blue coat" });
    const candidate = generated.characterVersions[0]!;
    const withoutCandidate = await service.remove(f.channel.id, candidate.versionId);
    assert.equal(withoutCandidate.primaryCharacter?.versionId, hero.versionId);
    assert.equal(withoutCandidate.characterVersions.length, 1);
    await assert.rejects(service.select(f.channel.id, candidate.versionId), /не найдена/);
    const removed = await service.remove(f.channel.id, hero.versionId);
    assert.equal(removed.primaryCharacter, undefined);
    assert.equal(removed.characterVersions.length, 0);
    assert.equal(removed.deletedCharacterVersions?.length, 2);
    assert.equal((await service.remove(f.channel.id, hero.versionId)).deletedCharacterVersions?.length, 2, "Repeated removal is idempotent");
    assert.deepEqual(await f.projects.get(next.id), before);
    assert.deepEqual(await readFile(hero.imagePath), png);
    assert.deepEqual(await readFile(candidate.imagePath), png);
    const freshStore = new ChannelProfileStore(join(f.dir, "channels.json"));
    assert.equal((await freshStore.get(f.channel.id))?.primaryCharacter, undefined);
    const fresh = new ChannelCharacterService(freshStore, f.projects, f.storage, async () => png);
    await assert.rejects(fresh.restore(f.other.id, hero.versionId), /не найдена/);
    await assert.rejects(fresh.remove(f.other.id, hero.versionId), /не найдена/);
    const restored = await fresh.restore(f.channel.id, hero.versionId);
    assert.equal(restored.primaryCharacter, undefined, "Restoring does not silently change the channel hero");
    assert.equal(restored.characterVersions[0]?.versionId, hero.versionId);
    assert.equal((await fresh.select(f.channel.id, hero.versionId)).primaryCharacter?.versionId, hero.versionId);
    await fresh.remove(f.channel.id, hero.versionId);
    const republished = await fresh.publish(f.project.id, "main");
    assert.equal(republished.primaryCharacter?.versionId, hero.versionId);
    assert.ok(!republished.deletedCharacterVersions?.some(item => item.versionId === hero.versionId));
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("portrait deletion cannot discard a pending Flow job or race an in-flight portrait generation", async () => {
  const f = await fixture();
  try {
    let release!: () => void;
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const service = new ChannelCharacterService(f.profiles, f.projects, f.storage, async (_prompt, _style, recovery) => {
      await recovery.onRemoteJob({ provider: "flow", kind: "image", accountId: "account", projectId: "project", mediaName: "media/test", modelKey: "test", submittedAt: new Date().toISOString() });
      started(); await new Promise<void>(resolve => { release = resolve; });
      throw new Error("Download failed");
    });
    const hero = (await service.publish(f.project.id, "main")).primaryCharacter!;
    const running = service.generate(f.channel.id, { sourceVersionId: hero.versionId, name: "Sam", prompt: "Blue coat" });
    const expectedFailure = assert.rejects(running, /Download failed/);
    await ready;
    await assert.rejects(service.remove(f.channel.id, hero.versionId), /уже обрабатывается/);
    release(); await expectedFailure;
    const before = (await f.profiles.get(f.channel.id))!.characterGeneration;
    const fresh = new ChannelCharacterService(f.profiles, f.projects, f.storage, async () => png);
    await assert.rejects(fresh.remove(f.channel.id, hero.versionId), /незавершённой генерацией/);
    assert.deepEqual((await f.profiles.get(f.channel.id))?.characterGeneration, before);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});
