import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { moveWorkspaceOnStartup, scheduleWorkspaceMove, workspaceStorageInfo } from "../src/workspace-storage.js";

// Run only after the application/queue has stopped. This uses the same journalled,
// hash-verified migration as Settings, without starting paid/background work.
const [profileArg, targetArg, flag] = process.argv.slice(2);
assert.equal(flag, "--execute", "Usage: <profile> <destination> --execute; close GoldWork first");
assert.ok(profileArg && targetArg && isAbsolute(profileArg) && isAbsolute(targetArg));
const profile = resolve(profileArg), target = resolve(targetArg);
const output = resolve("captures", `workspace-move-${new Date().toISOString().replace(/[:.]/g, "-")}`);
await mkdir(output, { recursive: true });
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const snapshots: Record<string, string> = {};
for (const name of ["projects.json", "queue.json"]) {
  const text = await readFile(join(profile, name), "utf8"); snapshots[name] = hash(text);
  await copyFile(join(profile, name), join(output, name));
}
const references = new Set<string>();
function collect(value: unknown): void {
  if (typeof value === "string" && isAbsolute(value) && /\.(mp4|mov|mkv|webm|wav|mp3|png|jpe?g|webp)$/i.test(value)) references.add(value);
  else if (Array.isArray(value)) value.forEach(collect);
  else if (value && typeof value === "object") Object.values(value).forEach(collect);
}
collect(JSON.parse(await readFile(join(profile, "projects.json"), "utf8")));
const present: Array<{ path: string; bytes: number }> = [], missingBefore: string[] = [];
for (const path of references) {
  const info = await stat(path).catch(() => undefined);
  if (info?.isFile()) present.push({ path, bytes: info.size }); else missingBefore.push(path);
}
const before = await workspaceStorageInfo(profile);
await writeFile(join(output, "before.json"), JSON.stringify({ before, target, snapshots, present, missingBefore }, null, 2));
await mkdir(target, { recursive: true });
if (before.pendingPath) assert.equal(resolve(before.pendingPath), target, "Another migration must be recovered first");
else await scheduleWorkspaceMove(profile, target);
let printed = 0;
await moveWorkspaceOnStartup(profile, message => {
  if (Date.now() - printed > 10_000 || !message.startsWith("Перенос и проверка:")) { printed = Date.now(); console.log(message); }
});
const after = await workspaceStorageInfo(profile);
assert.equal(after.error, undefined, after.error);
assert.equal(after.path, await realpath(target));
assert.equal(after.pendingPath, undefined);
for (const [name, expected] of Object.entries(snapshots)) assert.equal(hash(await readFile(join(profile, name), "utf8")), expected, `${name} changed during move`);
for (const file of present) assert.equal((await stat(file.path)).size, file.bytes, `Reference changed/missing: ${file.path}`);
const result = { after, verifiedReferences: present.length, preExistingMissingReferences: missingBefore.length, registryAndQueueUnchanged: true, output };
await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
