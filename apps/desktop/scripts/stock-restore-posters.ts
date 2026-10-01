import assert from "node:assert/strict";
import { readFile, stat, copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve, relative } from "node:path";
import type { Project } from "@gold-work/shared";
import { prepareDocumentaryRangePoster, prepareDocumentaryImages } from "../src/documentary-media-cache.js";

// Restore derived thumbnails only. Do not rewrite projects, media or voices.
const registry = "C:/Users/rosup/AppData/Roaming/@gold-work/desktop/projects.json";
const original = await readFile(registry);
const project = (JSON.parse(original.toString()) as Project[]).find(p => p.id === process.argv[2]);
assert.ok(project);
const root = resolve("D:/GoldWorkStorage/projects", project.id), posters = resolve(root, "Documentary/RangePosters");
await prepareDocumentaryImages(root, project.scenes.filter(scene => !scene.videoPath));
let restored = 0;
for (const scene of project.scenes) {
  if (!scene.videoPath || !scene.imagePath || await stat(scene.imagePath).then(() => true, () => false)) continue;
  const rel = relative(posters, resolve(scene.imagePath));
  assert.ok(rel && !rel.startsWith("..") && !rel.includes(":"), "Only derived range posters may be restored");
  assert.ok((await stat(scene.videoPath)).isFile());
  const prepared = await prepareDocumentaryRangePoster(root, scene);
  assert.ok(prepared.imagePath && (await stat(prepared.imagePath)).size > 0);
  if (prepared.imagePath !== scene.imagePath) {
    await mkdir(dirname(scene.imagePath), { recursive: true });
    await copyFile(prepared.imagePath, scene.imagePath);
  }
  restored++;
}
assert.deepEqual(await readFile(registry), original);
console.log(JSON.stringify({ restored, registryUnchanged: true, paidRequests: 0 }));
