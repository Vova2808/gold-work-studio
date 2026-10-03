import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildVideoCatalog, documentaryVideoWindows, availableVideoSegments, nextVideoCatalogBatch, readVideoFrames, DocumentaryBlackFrameError, type VideoCatalog } from "./documentary-video-catalog.js";
import { documentaryDetailScore, documentaryNeedsVideo } from "./documentary-project-service.js";
import { effectFfmpeg } from "./effect-media.js";
import type { DocumentaryCandidate, Scene } from "@gold-work/shared";

test("local black-frame rejection avoids paid inspection and keeps useful dark footage", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-black-frame-")); t.after(() => rm(root, { recursive: true, force: true }));
  for (const color of ["black", "gray", "navy"]) {
    const source = join(root, `${color}.mp4`), frames = join(root, color);
    await effectFfmpeg(["-y", "-f", "lavfi", "-i", `color=c=${color}:s=640x360:r=30:d=1`, "-an", "-c:v", "libx264", source]);
    if (color === "black") {
      await assert.rejects(readVideoFrames(source, frames, [.2, .6], true), DocumentaryBlackFrameError);
      // Reuses the saved JPEG/quality check even if the source is unavailable.
      await assert.rejects(readVideoFrames("absent.mp4", frames, [.2, .6], true), DocumentaryBlackFrameError);
    } else assert.equal((await readVideoFrames(source, frames, [.2], true)).length, 1);
  }
});

test("batched black checks retain frame identity, including black frames after the first batch", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-black-batch-")); t.after(() => rm(root, { recursive: true, force: true }));
  // Pre-existing JPEGs are also the immutable inputs used by paid checkpoints.
  for (const [name, color] of [["dark", "navy"], ["black", "black"]]) {
    await effectFfmpeg(["-y", "-f", "lavfi", "-i", `color=c=${color}:s=320x180`, "-frames:v", "1", join(root, `${name}.jpg`)]);
  }
  const dark = await readFile(join(root, "dark.jpg")), black = await readFile(join(root, "black.jpg"));
  const times = Array.from({ length: 10 }, (_, i) => i);
  for (const time of times) await writeFile(join(root, `${time.toFixed(3)}.jpg`), [2, 8].includes(time) ? black : dark);
  await assert.rejects(readVideoFrames("source-not-needed.mp4", root, times, true), DocumentaryBlackFrameError);
  for (const time of times) {
    assert.equal(JSON.parse(await readFile(join(root, `${time.toFixed(3)}.jpg.black98.json`), "utf8")), [2, 8].includes(time));
    assert.deepEqual(await readFile(join(root, `${time.toFixed(3)}.jpg`)), [2, 8].includes(time) ? black : dark);
  }
  assert.equal((await readVideoFrames("source-not-needed.mp4", root, [0, 1, 3, 9], true)).length, 4);
});

test("a twenty-minute source includes its tail and never offers a range across a detected cut or used excerpt", () => {
  const windows = documentaryVideoWindows(1200, [10, 611.5, 1000]);
  assert.equal(windows[0]!.start, 0);
  assert.equal(windows.at(-1)!.end, 1200);
  assert.ok(windows.every(w => w.end - w.start <= 8 && [10, 611.5, 1000].every(cut => cut <= w.start || cut >= w.end)));
  const catalog: VideoCatalog = { version: 1, checksum: "test", duration: 1200, windows,
    segments: windows.map(w => ({ ...w, description: "Actual camera footage", entities: [], camera: true, usable: true })) };
  const available = availableVideoSegments(catalog, 3, [{ start: 0, end: 4 }, { start: 1190, end: 1196 }]);
  assert.ok(available.length > 100);
  assert.ok(available.every(w => w.end - w.start >= 3 && (w.end <= 1190 || w.start >= 1196) && w.start >= 4));
  assert.ok(available.some(w => w.end > 1199), "The end of the source is searchable, not just its opening");
  catalog.segments = [];
  const batch = nextVideoCatalogBatch(catalog);
  assert.ok(batch.some(window => window.sample > 1100) && batch.some(window => window.sample < 100));
  catalog.pendingIds = [55, 20];
  assert.deepEqual(nextVideoCatalogBatch(catalog).map(window => window.id), [55, 20], "An uncertain batch keeps its exact IDs/order after restart");
});

test("known CGI/promo intervals stay excluded for later scenes without hiding uninspected source time", () => {
  const windows = documentaryVideoWindows(16, []);
  const catalog: VideoCatalog = { version: 1, checksum: "test", duration: 16, windows,
    segments: windows.map(window => ({ ...window, description: "Originally called camera footage", entities: [], camera: true, usable: true })),
    excludedRanges: [{ start: 2, end: 5, reason: "CGI" }] };
  const available = availableVideoSegments(JSON.parse(JSON.stringify(catalog)), 1, [{ start: 10, end: 12 }]);
  assert.ok(available.every(range => (range.end <= 2 || range.start >= 5) && (range.end <= 10 || range.start >= 12)));
  assert.ok(available.some(range => range.start < 1) && available.some(range => range.end > 15), "Keep both uninspected ends available");
  assert.equal(catalog.segments.length, 2, "Descriptions are retained; only the checked interval is excluded");
});

test("automatic photographs can be upgraded, but pinned choices and planned documents remain intact", () => {
  const scene = { documentary: { verified: true, pinned: false, selected: { kind: "image" }, requirement: { preferredKind: "video" } } } as Scene;
  assert.equal(documentaryNeedsVideo(scene), true);
  scene.documentary!.pinned = true;
  assert.equal(documentaryNeedsVideo(scene), false);
  scene.documentary!.pinned = false; scene.documentary!.requirement.preferredKind = "image";
  assert.equal(documentaryNeedsVideo(scene), false);
  const requirement = { text: "", entities: ["Icon of the Seas"], years: [], detail: "cabin", queries: ["Icon of the Seas cabin room"] };
  const candidate = (title: string) => ({ title, description: "" }) as DocumentaryCandidate;
  assert.ok(documentaryDetailScore(candidate("Icon of the Seas cabin tour"), requirement) > documentaryDetailScore(candidate("Icon of the Seas exterior"), requirement));
});

test("a shared catalog never repeats another project's uncertain paid batch", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-shared-video-catalog-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const catalog: VideoCatalog = { version: 1, checksum: "shared", duration: 8,
    windows: [{ id: 0, start: 0, end: 8, sample: 4 }], segments: [], pendingIds: [0], pendingProjectId: "source-project" };
  await writeFile(join(root, "catalog-v1.json"), JSON.stringify(catalog));
  const readOnly = await buildVideoCatalog({ file: "unused.mp4", root, checksum: "shared", duration: 8, title: "Fixture",
    complete: async () => { throw new Error("must not submit"); }, progress: () => {}, newBatches: 0, pendingProjectId: "next-project" });
  assert.deepEqual(readOnly, catalog, "Reading existing descriptions must not submit or clear another project's pending page");
  await assert.rejects(buildVideoCatalog({ file: "unused.mp4", root, checksum: "shared", duration: 8, title: "Fixture",
    complete: async () => { throw new Error("must not submit"); }, progress: () => {}, newBatches: 1, pendingProjectId: "next-project" }), /другого проекта/);
});

test("the first long-video catalog page is one distributed request before range verification", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-video-catalog-page-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "source.mp4");
  await effectFfmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=20", "-an", "-c:v", "libx264", file]);
  let calls = 0;
  const catalog = await buildVideoCatalog({ file, root: join(root, "catalog"), checksum: "fixture", duration: 20, title: "Fixture", progress: () => {},
    complete: async (_purpose, _system, input) => {
      calls++;
      const frames = (JSON.parse(input) as { frames: Array<{ id: number }> }).frames;
      return { segments: frames.map(frame => ({ id: frame.id, description: "Camera footage", entities: [], camera: true, usable: true })) };
    } });
  assert.equal(calls, 1);
  assert.equal(catalog.segments.length, Math.min(8, catalog.windows.length));
});

test("a completed partial catalog keeps valid ids without inventing or repeating missing descriptions",async t=>{
  const root=await mkdtemp(join(tmpdir(),"gws-partial-catalog-"));t.after(()=>rm(root,{recursive:true,force:true}));
  const file=join(root,"source.mp4");await effectFfmpeg(["-y","-f","lavfi","-i","testsrc2=s=640x360:r=30:d=20","-an","-c:v","libx264",file]);
  let calls=0;
  const catalog=await buildVideoCatalog({file,root:join(root,"index"),checksum:"partial",duration:20,title:"Fixture",progress:()=>{},complete:async(_p,_s,input)=>{
    calls++;const frames=JSON.parse(input).frames;return{segments:[{id:frames[0].id,description:"Only this actual image",camera:true,usable:true,entities:[]}]};
  }});
  assert.equal(calls,1);assert.equal(catalog.segments.length,1);assert.equal(catalog.pendingIds,undefined);
  assert.ok(nextVideoCatalogBatch(catalog).every(frame=>frame.id!==catalog.segments[0]!.id));
});
