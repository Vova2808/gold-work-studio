import assert from "node:assert/strict";
import { link, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { workspaceUsageReader } from "./workspace-usage.js";

test("workspace usage restores a valid snapshot and refreshes without duplicate scans", async () => {
  const base = await mkdtemp(join(tmpdir(), "gws-usage-"));
  try {
    const root = join(base, "workspace");
    const otherRoot = join(base, "other-workspace");
    const cacheFile = join(base, "usage.json");
    await mkdir(join(root, "projects", "one"), { recursive: true });
    await mkdir(otherRoot);
    await writeFile(join(root, "projects", "one", "video.mp4"), Buffer.alloc(100));
    await link(join(root, "projects", "one", "video.mp4"), join(root, "projects", "one", "copy.mp4"));

    const first = await workspaceUsageReader(root, cacheFile)();
    assert.equal(first.bytes, 100);
    assert.equal(first.logicalBytes, 200);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (await readFile(cacheFile, "utf8").then(() => true, () => false)) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(await readFile(cacheFile, "utf8"));

    await writeFile(join(root, "projects", "one", "new.mp4"), Buffer.alloc(50));
    const reopened = workspaceUsageReader(root, cacheFile);
    assert.equal((await reopened()).bytes, 100);
    const [updated, concurrent] = await Promise.all([reopened("", true), reopened("", true)]);
    assert.equal(updated.bytes, 150);
    assert.equal(concurrent.scannedAt, updated.scannedAt);
    assert.equal(updated.projects[0]?.bytes, 150);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (JSON.parse(await readFile(cacheFile, "utf8")).usage.bytes === 150) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const wrongRootCache = join(base, "wrong-root.json");
    await writeFile(wrongRootCache, await readFile(cacheFile));
    assert.equal((await workspaceUsageReader(otherRoot, wrongRootCache)()).bytes, 0);

    const brokenCache = join(base, "broken.json");
    await writeFile(brokenCache, JSON.stringify({
      root: process.platform === "win32" ? root.toLowerCase() : root,
      usage: { ...first, files: "broken", entries: [{ ...first.entries[0], path: null }] }
    }));
    assert.equal((await workspaceUsageReader(root, brokenCache)()).bytes, 150);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
