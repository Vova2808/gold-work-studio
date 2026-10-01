import assert from "node:assert/strict";
import { app } from "electron";
import { copyFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Project } from "@gold-work/shared";
import { AnyModelClient } from "../src/anymodel-client.js";
import { AnyModelStore } from "../src/anymodel-store.js";
import { DocumentaryIntelligence } from "../src/documentary-intelligence.js";

// Four user-authorized visual checks, no production/queue writes or downloads.
// Fixed artifact/checkpoint paths make restarting reuse known answers.
assert.ok(process.argv.includes("--paid"));
const profile = "C:/Users/rosup/AppData/Roaming/@gold-work/desktop";
const identityCheck = process.argv.includes("--identity");
const out = resolve(`captures/stock-${identityCheck ? "identity" : "editorial"}-live-20260920`);
mkdirSync(out, { recursive: true });
const temporary = mkdtempSync(join(out, "electron-"));
copyFileSync(join(profile, "Local State"), join(temporary, "Local State"));
app.setPath("userData", temporary);
app.on("window-all-closed", () => undefined);
app.whenReady().then(async () => {
  const project: Project = JSON.parse(await readFile(join(profile, "projects.json"), "utf8")).find((p: Project) => p.id === "project_mu9x2ywf_1s9thrt");
  assert.ok(project);
  const client = new AnyModelClient(new AnyModelStore(join(profile, "credentials/anymodel.json")));
  let submissions = 0;
  const intelligence = new DocumentaryIntelligence(client, id => join(out, id), async () => { assert.ok(++submissions <= 8, "Bounded visual check exceeded eight paid calls"); });
  const results = [];
  for (const order of identityCheck ? [60, 64, 65] : [53, 56, 49, 65]) {
    const scene = project.scenes.find(scene => scene.order + 1 === order)!;
    assert.ok(scene.videoPath && scene.documentary?.verified);
    const checksum = scene.documentary.checksum!, start = scene.trimStartSeconds!, end = scene.trimEndSeconds!;
    const id = `editorial-${order}`, root = join(out, id, "Documentary/VideoCatalog", checksum);
    await mkdir(root, { recursive: true });
    // The production selector trims a 150 ms safety margin from shot edges.
    const segment = { id: 0, start: Math.max(0, start - .2), end: end + .2, sample: (start + end) / 2, camera: true, usable: true,
      description: scene.documentary.visualReview!.viewDescription || scene.documentary.visualReview!.reason,
      entities: scene.documentary.requirement.entities };
    await writeFile(join(root, "catalog-v1.json"), JSON.stringify({ version: 1, checksum, duration: scene.documentary.selected!.durationSeconds, windows: [segment], segments: [segment] }));
    const fixture = { ...project, id, scenes: [scene] };
    const before = Date.now();
    const review = await intelligence.inspect(fixture, scene);
    const result = { scene: order, seconds: (Date.now() - before) / 1000, expected: (identityCheck ? order === 60 : order === 53 || order === 56) ? "not-accepted" : "accepted", review };
    results.push(result); console.log(JSON.stringify(result));
    await writeFile(join(out, "result.json"), JSON.stringify({ submissions, results }, null, 2));
  }
  assert.ok(results.filter(row => row.expected === "not-accepted").every(row => row.review.status !== "accepted"), "Observed promo/CGI false positives must not remain approved");
  assert.ok(results.filter(row => row.expected === "accepted").every(row => row.review.status === "accepted"), "Clean camera footage must remain usable");
  app.exit(0);
}).catch(error => { console.error(String(error).replace(/https?:\/\/\S+/g, "[URL]")); app.exit(1); });
