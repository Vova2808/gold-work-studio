import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, realpath, readdir, rename, rm, stat, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { moveWorkspaceOnStartup, scheduleWorkspaceMove, workspaceStorageInfo } from "./workspace-storage.js";

for (const childHeld of [false, true]) test(`Windows held ${childHeld ? "project folder activates the copy and retains originals" : "workspace switches checked child folders"}`, { skip: process.platform !== "win32" }, async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-storage-held-"));
  const profile = join(root, "profile"), workspace = join(profile, "workspace"), target = join(root, "target"), external = join(root, "external");
  for (const directory of [join(workspace, "projects"), join(workspace, "Library"), target, external]) await mkdir(directory, { recursive: true });
  await writeFile(join(workspace, "projects", "voice.wav"), "voice");
  await writeFile(join(workspace, "Library", "effect.wav"), "effect");
  await writeFile(join(external, "video.mp4"), "video");
  await symlink(external, join(workspace, "Materials"), "junction");
  const holder = spawn(process.execPath, ["-e", "process.stdin.resume(); console.log('holding');"], { cwd: childHeld ? join(workspace, "projects") : workspace, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  await once(holder.stdout!, "data");
  t.after(async () => { holder.stdin!.end(); await once(holder, "exit"); await rm(root, { recursive: true, force: true }); });
  await scheduleWorkspaceMove(profile, target);
  const messages: string[] = [];
  await moveWorkspaceOnStartup(profile, message => messages.push(message));
  const info = await workspaceStorageInfo(profile);
  assert.equal(info.error, undefined); assert.equal(info.path, await realpath(target));
  assert.equal(info.retainedPath, childHeld ? workspace : undefined);
  assert.ok(messages.some(message => message.includes("контейнер workspace")), "Exercise the real Windows root-directory lock");
  assert.equal(await realpath(workspace), workspace);
  assert.equal(await readFile(join(workspace, "projects", "voice.wav"), "utf8"), "voice");
  assert.equal(await readFile(join(external, "video.mp4"), "utf8"), "video");
  assert.equal(await realpath(join(workspace, "Materials")), childHeld ? external : join(target, "Materials"));
  await writeFile(join(info.path, "projects", "new-output.mp4"), "new output");
  assert.equal(await stat(join(workspace, "projects", "new-output.mp4")).then(() => true, () => false), !childHeld);
  assert.ok(!(await readdir(profile)).some(name => name.includes(".gws-child-")));
});

for (const committed of [false, true]) test(`interrupted child switch ${committed ? "finishes committed cleanup" : "restores original folders before resuming"}`, async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-storage-child-recover-")); t.after(() => rm(root, { recursive: true, force: true }));
  const profile = join(root, "profile"), workspace = join(profile, "workspace"), target = join(root, "target");
  const source = join(workspace, "projects"), backup = join(profile, "workspace.gws-child-fixture-projects"), copied = join(target, "projects");
  for (const directory of [source, copied]) await mkdir(directory, { recursive: true });
  for (const directory of [source, copied]) await writeFile(join(directory, "voice.wav"), "keep");
  await rename(source, backup); await symlink(copied, source, "junction");
  await writeFile(join(target, ".goldwork-storage.json"), JSON.stringify({ workspace, state: "ready" }));
  await writeFile(join(profile, "storage-location.json"), JSON.stringify({ pendingPath: target, ...(committed ? { activePath: target } : {}), childSwitch: [{ source, backup, target: copied }] }));
  await moveWorkspaceOnStartup(profile, () => {});
  assert.equal((await workspaceStorageInfo(profile)).error, undefined);
  assert.equal(await readFile(join(workspace, "projects", "voice.wav"), "utf8"), "keep");
  assert.ok(!(await readdir(profile)).some(name => name.includes(".gws-child-")));
});

test("storage move preserves old absolute paths, mutable files and external junction targets, including a second move", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-storage-test-"));
  await mkdir(resolve("captures"), { recursive: true });
  const destination = await mkdtemp(join(resolve("captures"), "storage-test-"));
  t.after(async () => { await rm(root, { recursive: true, force: true }); await rm(destination, { recursive: true, force: true }); });
  const profile = join(root, "profile"), workspace = join(profile, "workspace");
  const first = join(destination, "first"), second = join(destination, "second"), external = join(root, "external");
  for (const directory of [workspace, first, second, external]) await mkdir(directory, { recursive: true });
  const mediaName = "a".repeat(64) + ".mp4";
  await mkdir(join(workspace, "scene"));
  await writeFile(join(workspace, mediaName), "immutable-video");
  await writeFile(join(workspace, "scene", mediaName), "immutable-video");
  await writeFile(join(workspace, "one.json"), "mutable");
  await writeFile(join(workspace, "two.json"), "mutable");
  await writeFile(join(external, "photo.jpg"), "external-image");
  await symlink(external, join(workspace, "Materials"), "junction");
  const registry = JSON.stringify({ audioPath: join(workspace, "voice.wav"), remoteJobId: "keep-me" });
  await writeFile(join(profile, "projects.json"), registry);
  await writeFile(join(workspace, "voice.wav"), "voice");
  assert.equal((await scheduleWorkspaceMove(profile, first)).pendingPath, await realpath(first));
  await moveWorkspaceOnStartup(profile, () => {});
  let info = await workspaceStorageInfo(profile);
  assert.equal(info.error, undefined); assert.equal(info.pendingPath, undefined);
  assert.equal(info.path, await realpath(first));
  assert.equal(await readFile(join(workspace, "voice.wav"), "utf8"), "voice");
  assert.equal(await readFile(join(external, "photo.jpg"), "utf8"), "external-image");
  assert.equal(await readFile(join(workspace, "Materials", "photo.jpg"), "utf8"), "external-image");
  assert.equal((await stat(join(first, mediaName), { bigint: true })).ino, (await stat(join(first, "scene", mediaName), { bigint: true })).ino);
  await writeFile(join(workspace, "one.json"), "changed");
  assert.equal(await readFile(join(workspace, "two.json"), "utf8"), "mutable");
  await scheduleWorkspaceMove(profile, second);
  await moveWorkspaceOnStartup(profile, () => {});
  info = await workspaceStorageInfo(profile);
  assert.equal(info.error, undefined); assert.equal(info.path, await realpath(second));
  assert.equal(await readFile(join(first, "voice.wav"), "utf8"), "voice");
  assert.equal(await readFile(join(workspace, "voice.wav"), "utf8"), "voice");
  assert.equal(await readFile(join(profile, "projects.json"), "utf8"), registry);
  assert.ok(!(await readdir(profile)).some(name => name.includes(".gws-move-")));
});

test("storage rejects foreign/nested folders and preserves source when files are added during copy", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-storage-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const profile = join(root, "profile"), workspace = join(profile, "workspace"), target = join(root, "target");
  await mkdir(join(workspace, "nested"), { recursive: true }); await mkdir(target);
  await writeFile(join(workspace, "original"), "keep");
  await assert.rejects(scheduleWorkspaceMove(profile, join(workspace, "nested")), /внутрь/);
  await writeFile(join(target, "foreign"), "keep");
  await assert.rejects(scheduleWorkspaceMove(profile, target), /пустую папку/);
  await rm(join(target, "foreign"));
  await scheduleWorkspaceMove(profile, target);
  let write: Promise<void> | undefined;
  await moveWorkspaceOnStartup(profile, message => {
    if (message.startsWith("Перенос и проверка:")) write = writeFile(join(workspace, "new-file"), "new");
  });
  await write;
  assert.match((await workspaceStorageInfo(profile)).error!, /изменились/);
  assert.equal(await realpath(workspace), workspace);
  assert.equal(await readFile(join(workspace, "original"), "utf8"), "keep");
  // A cancelled/failed copy can be retried only in this app-owned partial folder.
  await scheduleWorkspaceMove(profile, target); await moveWorkspaceOnStartup(profile, () => {});
  assert.equal((await workspaceStorageInfo(profile)).error, undefined);
  assert.equal(await readFile(join(workspace, "new-file"), "utf8"), "new");
});

test("storage recovers a shutdown between directory rename and junction creation", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-storage-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, "profile", "workspace"), target = join(root, "target"), backup = workspace + ".gws-move-fixture";
  await mkdir(workspace, { recursive: true }); await mkdir(target);
  await writeFile(join(workspace, "voice.wav"), "keep");
  await rename(workspace, backup);
  await writeFile(join(root, "profile", "storage-location.json"), JSON.stringify({ pendingPath: target, switching: { source: workspace, backup } }));
  await moveWorkspaceOnStartup(join(root, "profile"), () => {});
  assert.equal((await workspaceStorageInfo(join(root, "profile"))).error, undefined);
  assert.equal(await realpath(workspace), target);
  assert.equal(await readFile(join(workspace, "voice.wav"), "utf8"), "keep");
});
