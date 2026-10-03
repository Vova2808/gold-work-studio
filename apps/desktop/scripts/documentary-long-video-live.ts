// One existing 21-minute source, two original script excerpts, no project writes/TTS/downloads.
import { app } from "electron";
import { mkdir, readFile, writeFile, copyFile, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { AnyModelStore } from "../src/anymodel-store.js";
import { AnyModelClient } from "../src/anymodel-client.js";
import { DocumentaryIntelligence } from "../src/documentary-intelligence.js";
import type { Project } from "@gold-work/shared";
import { effectFfmpeg } from "../src/effect-media.js";
import { MemoryProjectRepository, ProjectService, MockDirectorProvider } from "@gold-work/core";
import { DocumentaryProjectService } from "../src/documentary-project-service.js";
import { DocumentarySearch } from "../src/documentary-search.js";
import { LocalProjectStorage } from "../src/local-project-storage.js";
import assert from "node:assert/strict";

const root = resolve("captures/documentary-long-video"), profile = join(root, "profile");
const original = join(process.env.APPDATA!, "@gold-work", "desktop");
await mkdir(join(profile, "credentials"), { recursive: true });
for (const file of ["Local State", "credentials/anymodel.json"]) {
  try { await access(join(profile, file)); } catch { await copyFile(join(original, file), join(profile, file)); }
}
app.setPath("userData", profile);
app.whenReady().then(async () => {
let requests = 0;
try {
  const projects = JSON.parse(await readFile(join(original, "projects.json"), "utf8")) as Project[];
  const project = structuredClone(projects.find(p => p.id === "project_mu1sc77k_kyoo4o9")!);
  const originalSource = project.scenes.find(scene => scene.videoPath && (scene.documentary?.selected?.durationSeconds ?? 0) > 1200)!;
  const cabinSource = structuredClone(project.scenes.find(scene => scene.order === 66 && scene.videoPath)!);
  if (!originalSource) throw new Error("The existing long source was not found");
  project.id = "long-source-live-2026-09-19";
  project.scenes = project.scenes.filter(scene => scene.order === 65 || scene.order === 66);
  for (const scene of project.scenes) {
    scene.videoPath = originalSource.videoPath;
    scene.documentary!.selected = structuredClone(originalSource.documentary!.selected);
    scene.documentary!.checksum = originalSource.documentary!.checksum;
    scene.documentary!.verified = false;
  }
  const client = new AnyModelClient(new AnyModelStore(join(profile, "credentials", "anymodel.json")));
  const intelligence = new DocumentaryIntelligence(client, () => root, async () => {
    if (requests >= 50) throw new Error("Live check request budget reached; completed catalog pages are saved");
    requests++;
  });
  if (process.argv.includes("--selection")) {
    const materialRoot = join(root, "Materials");
    await mkdir(join(materialRoot, "Catalog"), { recursive: true });
    await writeFile(join(materialRoot, "Catalog", `${originalSource.documentary!.checksum}.json`), JSON.stringify(originalSource.documentary!.selected));
    await writeFile(join(materialRoot, "Catalog", `${cabinSource.documentary!.checksum}.json`), JSON.stringify(cabinSource.documentary!.selected));
    const narration = project.scenes.map(scene => ({ text: scene.narration, audio: scene.audioPath }));
    for (const scene of project.scenes) {
      // A local still of the source models an existing automatic photo fallback.
      scene.videoPath = undefined; scene.imagePath = originalSource.imagePath;
      scene.documentary!.selected = { ...scene.documentary!.selected!, kind: "image", id: `photo-${scene.id}` };
      scene.documentary!.checksum = `photo-${scene.id}`;
      scene.documentary!.verified = true; scene.documentary!.pinned = false;
      scene.documentary!.visualReview = undefined;
      scene.documentary!.requirement.preferredKind = "video";
    }
    project.status = "ready";
    const repository = new MemoryProjectRepository(); await repository.save(project);
    const projects = new ProjectService(repository, new MockDirectorProvider());
    const storage = new LocalProjectStorage(join(root, "projects"));
    const search = new DocumentarySearch(undefined, async () => { throw new Error("This bounded check must reuse the downloaded source"); });
    const service = new DocumentaryProjectService(projects, storage, search, materialRoot, { download: async () => { throw new Error("No new download expected"); } },
      event => console.log(event.message), intelligence);
    const result = await service.autoSelect(project.id);
    const summary = { selected: result.selected, failed: result.failed, requests, failures: result.failures, scenes: result.project.scenes.map(scene => ({ order: scene.order + 1,
      kind: scene.documentary?.selected?.kind, verified: scene.documentary?.verified, start: scene.trimStartSeconds, end: scene.trimEndSeconds, review: scene.documentary?.visualReview })) };
    await writeFile(join(root, "selection-result.json"), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary));
    assert.equal(result.selected, 2); assert.equal(result.failed, 0);
    assert.deepEqual(result.project.scenes.map(scene => ({ text: scene.narration, audio: scene.audioPath })), narration);
    for (const [index, scene] of result.project.scenes.entries()) await effectFfmpeg(["-y", "-ss", String(scene.trimStartSeconds), "-i", scene.videoPath!, "-t", String(scene.trimEndSeconds! - scene.trimStartSeconds!), "-an", "-vf", "scale=960:-2", "-c:v", "libx264", "-preset", "fast", "-crf", "24", join(root, `selected-auto-${index + 1}.mp4`)]);
    app.exit(0); return;
  }
  const results = [];
  for (const scene of project.scenes) {
    const before = requests;
    const review = await intelligence.inspect(project, scene, message => console.log(message));
    results.push({ scene: scene.order + 1, text: scene.narration, newRequests: requests - before, review });
    await writeFile(join(root, "result.json"), JSON.stringify({ source: originalSource.documentary!.selected!.title, duration: originalSource.documentary!.selected!.durationSeconds, requests, results }, null, 2));
    console.log(JSON.stringify(results.at(-1)));
    if (review.status === "accepted") {
      scene.trimStartSeconds = review.trimStartSeconds; scene.trimEndSeconds = review.trimEndSeconds; scene.documentary!.verified = true;
      await effectFfmpeg(["-y", "-ss", String(review.trimStartSeconds), "-i", scene.videoPath!, "-t", String(review.trimEndSeconds! - review.trimStartSeconds!), "-an", "-vf", "scale=960:-2", "-c:v", "libx264", "-preset", "fast", "-crf", "24", join(root, `selected-${scene.order + 1}.mp4`)]);
    }
  }
  app.exit(results.every(result => result.review.status === "accepted") ? 0 : 2);
} catch (error) {
  const message = String(error).replace(/https?:\/\/\S+/g, "[source URL]");
  await writeFile(join(root, "failure.json"), JSON.stringify({ requests, message }, null, 2));
  console.error(message); app.exit(1);
}
});
