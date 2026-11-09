import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultProjectSettings, createDocumentarySettings, documentaryVideoCoverage, type DocumentaryCandidate, type Project, type Scene } from "@gold-work/shared";
import { documentaryReuseIssue, documentaryVarietyIssue, documentarySampleTimes, usedDocumentaryRanges, unavailableDocumentaryRanges, revalidateDocumentaryVariety } from "./documentary-reuse.js";
import { documentaryEditErrors } from "./documentary-validation.js";
import { DocumentaryIntelligence } from "./documentary-intelligence.js";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, resolve, sep, basename } from "node:path";
import { tmpdir } from "node:os";
import { documentaryVideoWindows } from "./documentary-video-catalog.js";
import { effectFfmpeg } from './effect-media.js';

test("overview samples preserve a short tail action and do not collapse exact-length unused gaps", () => {
  const tail = documentarySampleTimes(3.67, 2.64, []);
  assert.equal(tail.length, 3);
  assert.ok(tail[0]! < .15 && tail.at(-1)! > 3.5);
  const gap = documentarySampleTimes(10, 2, [{ start: 0, end: 4 }, { start: 6, end: 10 }]);
  assert.equal(gap.length, 3);
  assert.ok(gap[0]! > 4 && gap[0]! < 4.2 && gap.at(-1)! > 5.8 && gap.at(-1)! < 6);
  assert.deepEqual(documentarySampleTimes(10, 2, [{ start: 0, end: 4 }, { start: 6, end: 10 }], true), [5], "Unknown old overviews retain the exact checkpoint samples");
  assert.ok(documentarySampleTimes(3.67, 2.64, [], true).at(-1)! < 2.9);
});

function scene(order: number, kind: "video" | "image", start = 0): Scene {
  const selected: DocumentaryCandidate = { id: "source", provider: "local", kind, title: "Source", description: "", pageUrl: "", downloadUrl: "", author: "", license: "Owned", licenseUrl: "", rights: "user-confirmed", attribution: "", query: "", retrievedAt: "", match: "unverified", concerns: [], durationSeconds: 60, width:1280,height:720 };
  return { id: String(order), order, title: "", narration: "", imagePrompt: "", animationPrompt: "", status: "ready", durationSeconds: 4, trimStartSeconds: start, trimEndSeconds: start + 4,
    ...(kind === "video" ? { videoPath: "source.mp4" } : { imagePath: "source.jpg" }),
    documentary: { version: 2, requirement: { text: "", entities: [], years: [], queries: [] }, candidates: [], selected, checksum: "same-file", visualHash: "1234567890abcdef", verified: true, pinned: false, illustrative: false, reviewNote: "", layout: "full", effects: [],
      caption: { enabled: false, text: "", position: "bottom", animation: "fade", fontSize: 52, color: "#ffffff", backgroundColor: "#000000", opacity: 80 } } };
}
function project(scenes: Scene[]): Project {
  const settings = createDefaultProjectSettings(); settings.assembly.documentary = createDocumentarySettings();
  return { scenes, settings, mediaMode: "stock" } as Project;
}

test("variety blocks repeated wide runs and similar range frames, not all excerpts of one file", () => {
  const clips = Array.from({ length: 4 }, (_, i) => scene(i, "video", i * 10));
  for (const clip of clips) clip.documentary!.visualReview = { status: "accepted", confidence: .95, checkedAt: "now", sampleSeconds: [], quality: "good", reason: "Aerial camera footage of the vessel" };
  const p = project(clips);
  assert.match(documentaryVarietyIssue(p, clips[2]!)!, /Три общих/);
  clips[2]!.documentary!.visualReview!.viewDescription = "Close-up of the ship engine mechanisms";
  assert.equal(documentaryVarietyIssue(p, clips[2]!), undefined, "A detail from the same source adds variety");
  assert.equal(documentaryVarietyIssue(p, clips[3]!), undefined, "The source can be reused after a different view");
  clips[1]!.documentary!.visualReview!.frameHash = "0123456789abcdef";
  clips[2]!.documentary!.visualReview!.frameHash = "0123456789abcdee";
  assert.match(documentaryVarietyIssue(p, clips[2]!)!, /почти одинаковы/, "Actual range pixels take precedence over a description");
  delete clips[2]!.documentary!.visualReview!.frameHash;
  assert.equal(documentaryVarietyIssue(p, clips[2]!), undefined, "Legacy source-poster hashes are not compared as range frames");
});

test("automatic reuse blocks neighbouring photos and overlapping excerpts, but allows many different ranges from one video", () => {
  const photos = [scene(0, "image"), scene(1, "image")];
  assert.match(documentaryReuseIssue(project(photos), photos[1]!)!, /соседнем/);
  photos[1]!.documentary!.selected!.id = "another-search-id";
  assert.match(documentaryReuseIssue(project(photos), photos[1]!)!, /соседнем/, "Checksum catches the same photo under a different search ID");
  const clips = Array.from({ length: 8 }, (_, i) => scene(i, "video", i * 5));
  const video = project(clips);
  assert.equal(documentaryReuseIssue(video, clips[7]!), undefined, "The original video is not limited to three uses");
  clips[7]!.trimStartSeconds = 31; clips[7]!.trimEndSeconds = 35;
  assert.match(documentaryReuseIssue(video, clips[7]!)!, /соседнем/);
  const used = usedDocumentaryRanges(video, clips[7]!);
  const samples = documentarySampleTimes(60, 4, used);
  // These are observed frames, not centers of hypothetical four-second clips.
  // The latter collapsed an exact-length available interval to a single still.
  assert.ok(samples.length > 0 && samples.every(time => used.every(range => time <= range.start || time >= range.end)));
  assert.ok(documentarySampleTimes(60, 4, used, true).every(time => used.every(range => time + 2 <= range.start || time - 2 >= range.end)));
  assert.deepEqual(documentarySampleTimes(4, 4, [{ start: 0, end: 4 }]), []);
  clips[0]!.trimEndSeconds = 1;
  assert.equal(documentaryVideoCoverage(project([clips[0]!, scene(1, "image")]).scenes).percent, 12, "Frozen video tails and photos do not count as moving footage");
});

test("resume retains early choices and manual pins while rejecting repeated catalog views and sliced short stock", () => {
  const clips = Array.from({ length: 8 }, (_, i) => scene(i, "video", i * 5));
  for (const clip of clips) {
    clip.documentary!.selected!.durationSeconds = 40;
    if (clip.order % 2) { clip.documentary!.selected!.id = `other-${clip.order}`; clip.documentary!.checksum = `other-${clip.order}`; }
  }
  assert.deepEqual(revalidateDocumentaryVariety(project(clips)).filter(s => !s.documentary!.verified).map(s => s.order), [2, 4, 6]);
  for (const clip of clips.filter(s => s.order % 2 === 0)) clip.documentary!.checksum = "a".repeat(64);
  const localAlias = structuredClone(clips[6]!);
  localAlias.documentary!.checksum = undefined;
  localAlias.documentary!.selected!.id = `local:${"a".repeat(64)}`;
  assert.match(documentaryVarietyIssue(project(clips), localAlias)!, /Короткий исходник/, "A local cache ID cannot evade the original short-source limit before download");
  clips[6]!.documentary!.pinned = true;
  assert.equal(revalidateDocumentaryVariety(project(clips))[6]!.documentary!.verified, true);
  const long = [scene(0, "video", 0), scene(1, "video", 20), scene(2, "video", 40)];
  for (const clip of long) clip.documentary!.visualReview = { status: "accepted", confidence: .95, checkedAt: "now", sampleSeconds: [], quality: "good", reason: "Camera footage", viewDescription: "Lock control building from the same fixed camera" };
  const checked = revalidateDocumentaryVariety(project(long));
  assert.deepEqual(checked.map(s => s.documentary!.verified), [true, false, false]);
  assert.equal(checked[1]!.videoPath, long[1]!.videoPath, "Keep media for replacement/recovery");
  long[1]!.documentary!.visualReview!.viewDescription = "Close-up of the gate mechanism";
  assert.deepEqual(revalidateDocumentaryVariety(project(long)).map(s => s.documentary!.verified), [true, true, false], "A cutaway does not make a repeated camera view new");
});

test("actual night-lock hashes reject adjacent same-camera views despite moving lights", () => {
  const clips = [scene(0, "video", 0), scene(1, "video", 20)];
  const hashes = ["0203a3cb0b8f5ffa", "000323cb1b334f9a"];
  for (const clip of clips) clip.documentary!.visualReview = { status: "accepted", confidence: .95, checkedAt: "now", sampleSeconds: [], quality: "good", reason: "Camera footage", frameHash: hashes[clip.order] };
  assert.match(documentaryVarietyIssue(project(clips), clips[1]!)!, /почти одинаковы/);
  clips[1]!.documentary!.selected!.id = "different-camera"; clips[1]!.documentary!.checksum = "different-file";
  assert.equal(documentaryVarietyIssue(project(clips), clips[1]!), undefined, "The wider tolerance applies only to known same-source shots");
});

test('short engine footage does not become a different shot just because a camera pan changes its hash', () => {
  const first = scene(0, 'video'), second = scene(2, 'video', 6.14), spacer = scene(1, 'image');
  spacer.durationSeconds = 40;
  for (const s of [first, second]) {
    s.documentary!.selected!.durationSeconds = 13;
    s.documentary!.visualReview = { status: 'accepted', confidence: .99, checkedAt: 'now', sampleSeconds: [], quality: 'good', reason: 'Engine under the hood',
      frameHash: s === first ? '339b1c566aea5fb4' : 'e4313cedb69eb9b9' };
  }
  const p = project([first, spacer, second]);
  assert.match(documentaryVarietyIssue(p, second)!, /Короткий исходник/);
  second.documentary!.visualReview!.viewDescription = 'Separate macro shot of a valve spring';
  assert.equal(documentaryVarietyIssue(p, second), undefined, 'An indexed different detail remains eligible');
  delete second.documentary!.visualReview!.viewDescription;
  spacer.durationSeconds = 100;
  assert.equal(documentaryVarietyIssue(p, second), undefined, 'A later return is still possible');
});

test('a third near-identical angle is blocked even across different distant ranges',()=>{
  const clips=Array.from({length:5},(_,i)=>({...scene(i,'video',i*7),durationSeconds:60}));
  for(const clip of clips)clip.documentary!.visualReview={status:'accepted',confidence:.95,checkedAt:'now',sampleSeconds:[],quality:'good',reason:'A detail view',frameHash:clip.order%2===0?'0123456789abcdef':'fedcba9876543210'};
  assert.equal(documentaryVarietyIssue(project(clips.slice(0,3)),clips[2]!),undefined);
  assert.match(documentaryVarietyIssue(project(clips),clips[4]!)!,/два раза/);
});

test('catalog excludes every used range including distant shots and aliases of the original',()=>{
  const clips=Array.from({length:9},(_,i)=>scene(i,'video',i%2===0?0:30));
  for(const clip of clips)clip.documentary!.verified=[0,2].includes(clip.order);
  assert.ok(unavailableDocumentaryRanges(project(clips),clips[8]!).some(r=>r.start===0&&r.end===4));
  assert.match(documentaryReuseIssue(project(clips),clips[8]!)!,/уже использован/);
  const excerpt=scene(9,'video');
  excerpt.documentary!.checksum='excerpt-file';
  excerpt.documentary!.selected={...excerpt.documentary!.selected!,id:'excerpt:other',excerpt:{sourceChecksum:'same-file',startSeconds:2,endSeconds:10,sourceDurationSeconds:60}};
  assert.match(documentaryReuseIssue(project([...clips,excerpt]),excerpt)!,/уже использован/);
  assert.ok(unavailableDocumentaryRanges(project([...clips,excerpt]),excerpt).some(r=>r.start===-2&&r.end===2));
});

test('a distant photo repeat is excluded by pixels while manual pins and unused shots survive resume',()=>{
  const photos=[scene(0,'image'),scene(1,'video',20),scene(2,'image')];
  Object.assign(photos[2]!.documentary!,{checksum:'other-encoding'});
  photos[2]!.documentary!.selected!.id='another-provider';
  assert.match(documentaryReuseIssue(project(photos),photos[2]!)!,/уже использован/);
  assert.deepEqual(revalidateDocumentaryVariety(project(photos)).map(s=>s.documentary!.verified),[true,true,false]);
  photos[2]!.documentary!.pinned=true;
  assert.equal(revalidateDocumentaryVariety(project(photos))[2]!.documentary!.verified,true);
});

test('moving lights do not hide a repeated camera view behind a cutaway',()=>{
  const clips=[scene(0,'video',0),scene(1,'image'),scene(2,'video',20)];
  for(const [index,hash] of [[0,'0203a3cb0b8f5ffa'],[2,'000323cb1b334f9a']] as const){
    clips[index]!.documentary!.visualReview={status:'accepted',confidence:.95,checkedAt:'now',sampleSeconds:[],quality:'good',reason:'Night lock camera',frameHash:hash};
  }
  assert.match(documentaryVarietyIssue(project(clips),clips[2]!)!,/почти одинаковы/);
  clips[1]!.durationSeconds=120;
  assert.equal(documentaryVarietyIssue(project(clips),clips[2]!),undefined,'One return to a view after a substantial interval remains possible');
});

test("a riser may start before its owning shot and continue after it, but must stay inside the movie", () => {
  const p = project([scene(0, "image"), scene(1, "image"), scene(2, "image")]);
  const effect = { id: "riser", assetId: "local", assetVersion: 1 as const, name: "Riser", filePath: "riser.wav", kind: "audio" as const, role: "sound" as const, enabled: true, startSeconds: -2, durationSeconds: 7,
    defaults: { opacity: 100, volume: 100, sourceAudio: false, trimStartSeconds: 0, fadeInSeconds: .04, fadeOutSeconds: .15, blend: "normal" as const }, x: 0, y: 0, scale: 1, blend: "normal" as const };
  p.scenes[1]!.documentary!.effects = [effect];
  assert.deepEqual(documentaryEditErrors(p), []);
  effect.startSeconds = -5;
  assert.ok(documentaryEditErrors(p).some(error => error.includes("границы ролика")));
});

test("measured duration does not resubmit an uncertain paid visual overview", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-overview-checkpoint-"));
  assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&basename(root).startsWith('gws-overview-checkpoint-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const p = project([scene(0, "image")]);
  p.id = "checkpoint-fixture";
  const shot = p.scenes[0]!;
  Object.assign(shot.documentary!.selected!, { width: 1280, height: 720 });
  shot.imagePath=join(root,'source.png');
  await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=size=1280x720','-frames:v','1',shot.imagePath]);
  let submissions = 0;
  const intelligence = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async () => {
    submissions++; throw new Error("fixture: connection lost after submission");
  } }, () => root);
  await assert.rejects(intelligence.inspect(p, shot), /connection lost/);
  shot.documentary!.timing = { sourceKey: "measured", durationInFrames: 150, speechSeconds: 5 };
  await assert.rejects(intelligence.inspect(p, shot), /неизвестный результат/);
  assert.equal(submissions, 1, "A timing update must not charge again for an uncertain request");
});

test("a pending catalog batch is not charged again for another scene context", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-catalog-checkpoint-"));
  assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&basename(root).startsWith('gws-catalog-checkpoint-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const p = project([scene(0, "video")]); p.id = "catalog-checkpoint-fixture";
  const shot = p.scenes[0]!;
  Object.assign(shot.documentary!.selected!, { width: 1280, height: 720 });
  // The cache-only path checks the exact local frames before looking for a
  // completed interval receipt; use a real original rather than a fake path.
  shot.videoPath=join(root,'source.mp4');
  await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=size=1280x720:rate=3','-t','60','-c:v','libx264','-preset','ultrafast','-threads','1',shot.videoPath]);
  const catalogRoot = join(root, "Documentary", "VideoCatalog", "same-file");
  await mkdir(catalogRoot, { recursive: true });
  const windows = documentaryVideoWindows(60, []);
  await writeFile(join(catalogRoot, "catalog-v1.json"), JSON.stringify({ version: 1, checksum: "same-file", duration: 60, windows, segments: [],pendingIds:[0] }));
  let submissions = 0;
  const intelligence = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async () => {
    submissions++; throw new Error("fixture: uncertain paid response");
  } }, () => root);
  await assert.rejects(intelligence.inspect(p, shot), /Прежний платный анализ этого видео не завершён/);
  shot.narration = "A different detail in this source.";
  await assert.rejects(intelligence.inspect(p, shot), /Прежний платный анализ этого видео не завершён/);
  assert.equal(submissions, 0,'A saved pending catalog is neither re-created nor bypassed by a new scene review');
});
