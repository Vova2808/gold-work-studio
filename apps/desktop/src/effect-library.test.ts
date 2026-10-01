import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { EffectLibrary, checksumFile, classifyEffect } from "./effect-library.js";
import { effectFfmpeg } from "./effect-media.js";

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), "gws-effects-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "Звуковые эффекты");
  await mkdir(join(source, "Клавиатура"), { recursive: true });
  return { root, source, libraryPath: join(root, "Library") };
}
const prepare: ConstructorParameters<typeof EffectLibrary>[2] = async () => ({ state: "ready", metadata: { durationSeconds: 2, hasAudio: true, hasAlpha: false } });

test("copy/deduplicate nested imports, same names, origin history and restart without source", async t => {
  const { source, libraryPath } = await fixture(t);
  await writeFile(join(source, "Клавиатура", "one.wav"), "same sound");
  await writeFile(join(source, "one.wav"), "another sound");
  await writeFile(join(source, "duplicate.wav"), "same sound");
  await writeFile(join(source, "service.sfk"), "ignore");
  const library = new EffectLibrary(libraryPath, undefined, prepare);
  await library.startImport([source, join(source, "Клавиатура"), source]);
  const result = await library.waitForImport();
  assert.equal(result.importProgress?.total, 3);
  assert.equal(result.importProgress?.ignored, 1);
  assert.equal(result.importProgress?.added, 2);
  assert.equal(result.importProgress?.duplicates, 1);
  assert.equal(result.assets.length, 2);
  const duplicate = result.assets.find(asset => asset.origins.length === 2)!;
  assert.ok(duplicate);
  for (const asset of result.assets) {
    assert.equal(await checksumFile(join(libraryPath, asset.file)), asset.checksum);
    assert.equal(asset.automatic, false);
    assert.equal(asset.defaults.sourceAudio, false);
  }
  await library.startImport([source]);
  assert.equal((await library.waitForImport()).importProgress?.duplicates, 3);
  await rename(source, `${source}-offline`);
  const restarted = await new EffectLibrary(libraryPath).snapshot();
  assert.equal(restarted.assets.length, 2);
  assert.equal(await readFile(join(libraryPath, duplicate.file), "utf8"), "same sound");
});

test("cancel/checkpoint/resume keeps copied media and does not duplicate IDs", async t => {
  const { source, libraryPath } = await fixture(t);
  await writeFile(join(source, "click.wav"), "sound");
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const library = new EffectLibrary(libraryPath, undefined, async (_root, _asset, signal) => {
    entered();
    await new Promise<void>(resolve => signal!.addEventListener("abort", () => resolve(), { once: true }));
    signal!.throwIfAborted();
    return {};
  });
  await library.startImport([source]);
  await started;
  await assert.rejects(library.startImport([source]), /уже выполняется/);
  const second = new EffectLibrary(libraryPath, undefined, prepare);
  await assert.rejects(second.startImport([source]), /другим процессом/);
  library.cancel();
  const cancelled = await library.waitForImport();
  assert.equal(cancelled.importProgress?.status, "cancelled");
  assert.equal(cancelled.assets[0]?.state, "copied");
  await second.startImport([source]);
  const resumed = await second.waitForImport();
  assert.equal(resumed.assets.length, 1);
  assert.equal(resumed.assets[0]?.state, "ready");
});

test("review, permissions, ranges and reversible removal preserve stored bytes", async t => {
  const { source, libraryPath } = await fixture(t);
  await writeFile(join(source, "click.wav"), "sound");
  const library = new EffectLibrary(libraryPath, undefined, prepare);
  await library.startImport([source]);
  const asset = (await library.waitForImport()).assets[0]!;
  await assert.rejects(library.update(asset.id, { ...asset, automatic: true }), /сначала проверьте/);
  await assert.rejects(library.update(asset.id, { ...asset, defaults: { ...asset.defaults, trimStartSeconds: 3 } }), /от 0 до 2/);
  await assert.rejects(library.update("../projects", asset), /ID/);
  const edited = await library.update(asset.id, { ...asset, name: "Мой щелчок", favorite: true, automatic: true, review: "approved", rights: "user-confirmed", rightsNote: "User owned recording" });
  assert.equal(edited.automatic, true);
  await library.startImport([source]); await library.waitForImport();
  assert.equal((await library.snapshot()).assets[0]?.name, "Мой щелчок");
  assert.ok((await library.trash(asset.id, true)).deletedAt);
  assert.equal((await library.trash(asset.id, false)).deletedAt, undefined);
  assert.equal(await readFile(join(libraryPath, asset.file), "utf8"), "sound");
});

test("errors are attributed, retriable and corrupt catalogs are never silently empty", async t => {
  const { source, libraryPath } = await fixture(t);
  await writeFile(join(source, "broken.wav"), "broken");
  const library = new EffectLibrary(libraryPath, undefined, async () => { throw new Error("decode failed"); });
  await library.startImport([source]);
  const result = await library.waitForImport();
  assert.equal(result.importProgress?.errors.length, 1);
  assert.equal(result.assets[0]?.state, "error");
  const repaired = new EffectLibrary(libraryPath, undefined, prepare);
  await repaired.startImport([source]);
  assert.equal((await repaired.waitForImport()).assets[0]?.state, "ready");
  await assert.rejects(repaired.startImport([libraryPath]), /саму себя/);
  const record = (await readdir(join(libraryPath, "Catalog", "Assets")))[0]!;
  await writeFile(join(libraryPath, "Catalog", "Assets", record), "{broken");
  await assert.rejects(new EffectLibrary(libraryPath).snapshot(), SyntaxError);
});

test("known categories do not automatically approve dramatic or transition compositions", () => {
  assert.equal(classifyEffect("pack/TRANSITIONS FOOTAGE/23.mp4", "video").category, "review");
  assert.equal(classifyEffect("Звуковые эффекты/Популярные звуки/mouse click.wav", "audio").category, "click");
  assert.ok(classifyEffect("Звуковые эффекты/Клавиатура/Keyboard_01.wav", "audio").tags.includes("популярные"));
  assert.equal(classifyEffect("Популярные звуки/dramatic waterphone.wav", "audio").category, "dramatic");
});

test("real FFmpeg: full decode, audio waveform, muted-by-default video, proxy and durable metadata", { timeout: 60000 }, async t => {
  const { source, libraryPath } = await fixture(t);
  await effectFfmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=600:duration=0.6", join(source, "click.wav")]);
  await effectFfmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=15:duration=0.7", "-f", "lavfi", "-i", "sine=frequency=400:duration=0.7", "-c:v", "libx264", "-c:a", "aac", "-shortest", join(source, "clip.mp4")]);
  const library = new EffectLibrary(libraryPath);
  await library.startImport([source]);
  const result = await library.waitForImport();
  assert.deepEqual(result.importProgress?.errors, []);
  assert.equal(result.assets.length, 2);
  const video = result.assets.find(asset => asset.kind === "video")!;
  const audio = result.assets.find(asset => asset.kind === "audio")!;
  assert.equal(video.metadata?.width, 320);
  assert.equal(video.metadata?.height, 180);
  assert.equal(video.metadata?.hasAudio, true);
  assert.equal(video.defaults.sourceAudio, false);
  assert.ok(audio.metadata?.peakDb !== undefined);
  for (const path of [video.poster, video.proxy, audio.proxy, audio.waveform]) assert.ok((await readFile(join(libraryPath, path!))).byteLength > 0);
});
