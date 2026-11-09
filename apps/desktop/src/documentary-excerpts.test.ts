import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultProjectSettings, createDocumentarySettings, type Project, type Scene } from "@gold-work/shared";
import { prepareDocumentaryExcerpts, documentaryExcerptBounds, restoreDocumentaryExcerptReviews } from "./documentary-excerpts.js";
import { documentaryContextApproval, documentaryIllustrationApproval, documentarySavedContextIssue } from './documentary-context-approval.js';
import { effectFfmpeg, probeEffectMedia } from "./effect-media.js";
import { checksumFile } from "./effect-library.js";
import { planDocumentaryCleanup, executeDocumentaryCleanup } from "./documentary-cleanup.js";
import { documentaryReuseIssue, usedDocumentaryRanges } from "./documentary-reuse.js";

for(const kind of ['context','illustration'] as const)test(`raw excerpts preserve ${kind} approval, edits and narration; original is deleted only after all project references move`, async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-excerpts-")); t.after(() => rm(root, { recursive: true, force: true }));
  const docRoot = join(root, "one", "Documentary"); await mkdir(docRoot, { recursive: true });
  const generated = join(docRoot, "fixture.mp4");
  await effectFfmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=s=160x90:r=30:d=60", "-f", "lavfi", "-i", "sine=f=330:d=60", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", generated]);
  const checksum = await checksumFile(generated), original = join(docRoot, `${checksum}.mp4`);
  const { rename } = await import("node:fs/promises"); await rename(generated, original);
  const source = { id: "source", provider: "commons", kind: "video", title: "Fixture", localPath: original, durationSeconds: 60, width: 160, height: 90, pageUrl: "https://example.test/source", downloadUrl: "https://example.test/file", license: "CC0", attribution: "Fixture" };
  await writeFile(join(docRoot, `${checksum}.source.json`), JSON.stringify(source));
  const materialRoot = join(root, "Materials");
  await mkdir(join(materialRoot, "Catalog"), { recursive: true });
  await writeFile(join(materialRoot, "Catalog", `${checksum}.json`), JSON.stringify(source));
  const makeScene = (id: string, order: number, start: number): Scene => ({ id, order, title: id, narration: `Original narration ${id}`, durationSeconds: 3, status: "ready", imagePrompt: "", animationPrompt: "", audioPath: join(root, "voice.wav"), videoPath: original, trimStartSeconds: start, trimEndSeconds: start + 3,
    documentary: { version: 2, selected: { ...source }, checksum, verified: true, pinned: false, candidates: [], requirement: { text: "", entities: [], years: [], queries: [] }, layout: "full", effects: [], caption: {}, illustrative: false, reviewNote: "" } } as unknown as Scene);
  const scenes = [makeScene("a", 0, 5), makeScene("b", 1, 20)];
  scenes[1]!.documentary!.selected = { ...scenes[1]!.documentary!.selected!, id: `local:${checksum}`, provider: "local" };
  scenes[1]!.documentary!.cuts = [{ id: "cut", sourceSceneId: "a", fromFrame: 0, durationInFrames: 60, trimStartSeconds: 10, trimEndSeconds: 12, playbackRate: 1 }];
  const settings = createDefaultProjectSettings(); settings.assembly.documentary = createDocumentarySettings();
  const project = { id: "one", mediaMode: "stock", aspectRatio: "16:9", settings, scenes } as Project;
  const checked=scenes[0]!;
  checked.documentary!.requirement={...checked.documentary!.requirement,text:checked.narration,
    scriptRequirements:{version:1,scriptText:checked.narration,checks:[{id:'subject',kind:'object',scriptQuote:checked.narration,required:'fixture subject'}],nonVisual:[]}};
  checked.documentary!.visualReview={status:'accepted',confidence:1,reason:'Fixture only',quality:'fixture',checkedAt:'now',sampleSeconds:[5.1,6.5,7.9],trimStartSeconds:5,trimEndSeconds:8,
    scriptEvidence:{version:1,scriptText:checked.narration,checks:[{requirementId:'subject',kind:'object',scriptQuote:checked.narration,required:'fixture subject',match:true,evidence:'Fixture pixels only.'}]}};
  if(kind==='context')checked.documentary!.visualReview.contextApproval=documentaryContextApproval(project,checked,{status:'accepted',narrativeEvidence:{subjectMatch:true,eraMatch:true,detailMatch:true,requiredEra:'none',observedEra:'none',evidence:'Synthetic fixture subject is visible.'}});
  else{
    checked.documentary!.requirement.footageFallback={version:1,target:'industrial machine',queries:['industrial machine'],originalTarget:'fixture',reason:'Orchestration fixture only',narration:checked.narration};
    checked.documentary!.visualReview.footageOrigin='camera';
    checked.documentary!.visualReview.viewDescription='A moving industrial machine.';
    checked.documentary!.visualReview.fastRelevance={version:1,target:'industrial machine',relevant:true,evidence:'Synthetic fixture for provenance regression only.'};
    const info=await stat(original,{bigint:true});
    checked.documentary!.visualReview.localReview={version:1,size:String(info.size),mtimeNs:String(info.mtimeNs),ctimeNs:String(info.ctimeNs)};
    checked.documentary!.visualReview.illustrationApproval=documentaryIllustrationApproval(project,checked);
  }
  assert.equal(documentarySavedContextIssue(project,checked),undefined);
  const untouched = JSON.stringify(project), originalBytes = (await stat(original)).size;
  assert.deepEqual(documentaryExcerptBounds(project, scenes[0]!), { start: 4.5, end: 12.5 });
  const result = await prepareDocumentaryExcerpts(project, join(root, "one"), undefined, undefined, materialRoot);
  assert.equal(result.count, 2); assert.equal(JSON.stringify(project), untouched);
  const compact = { ...project, scenes: result.scenes };
  assert.equal(documentarySavedContextIssue(compact,compact.scenes[0]!),undefined,'Automatic clipping preserves the original paid proof');
  assert.deepEqual(compact.scenes[0]!.documentary!.visualReview!.sampleSeconds.map(time=>Number(time.toFixed(3))),[.6,2,3.4]);
  // Older builds saved the excerpt with the original fingerprint. Restore only
  // this reproducible conversion, never a manually shifted interval.
  await mkdir(join(docRoot,'a'),{recursive:true});
  await writeFile(join(docRoot,'a',`${checksum}.source.json`),JSON.stringify(source));
  const legacy=structuredClone(compact);
  legacy.scenes[0]!.documentary!.visualReview!.contextApproval=checked.documentary!.visualReview.contextApproval;
  legacy.scenes[0]!.documentary!.visualReview!.illustrationApproval=checked.documentary!.visualReview.illustrationApproval;
  legacy.scenes[0]!.documentary!.visualReview!.localReview=checked.documentary!.visualReview.localReview;
  const repaired=await restoreDocumentaryExcerptReviews(legacy,join(root,'one'));
  assert.equal(documentarySavedContextIssue({...legacy,scenes:repaired},repaired[0]!),undefined);
  const compactInfo=await stat(repaired[0]!.videoPath!,{bigint:true});
  assert.equal(repaired[0]!.documentary!.visualReview!.localReview!.size,String(compactInfo.size));
  assert.equal(repaired[0]!.documentary!.visualReview!.localReview!.mtimeNs,String(compactInfo.mtimeNs));
  await writeFile(join(docRoot,'a',`${checksum}.source.json`),JSON.stringify({...source,localPath:join(root,'missing-source.mp4')}));
  assert.strictEqual((await restoreDocumentaryExcerptReviews(legacy,join(root,'one')))[0],legacy.scenes[0],'A missing original leaves the excerpt unconfirmed without throwing');
  await writeFile(join(docRoot,'a',`${checksum}.source.json`),JSON.stringify(source));
  if(kind==='illustration'){
    const clipBytes=await readFile(legacy.scenes[0]!.videoPath!),changed=Buffer.from(clipBytes);changed[changed.length-1]=changed[changed.length-1]!^1;
    await writeFile(legacy.scenes[0]!.videoPath!,changed);
    assert.strictEqual((await restoreDocumentaryExcerptReviews(legacy,join(root,'one')))[0],legacy.scenes[0],'Changed excerpt bytes must never inherit approval');
    await writeFile(legacy.scenes[0]!.videoPath!,clipBytes);
    const sourceBytes=await readFile(original),badSource=Buffer.from(sourceBytes);badSource[badSource.length-1]=badSource[badSource.length-1]!^1;
    await writeFile(original,badSource);
    assert.strictEqual((await restoreDocumentaryExcerptReviews(legacy,join(root,'one')))[0],legacy.scenes[0],'Changed original bytes must never authorize repair');
    await writeFile(original,sourceBytes);
  }
  legacy.scenes[0]!.trimStartSeconds!+=.2;
  const edited=await restoreDocumentaryExcerptReviews(legacy,join(root,'one'));
  assert.strictEqual(edited[0],legacy.scenes[0],'A user interval change must not acquire a proof');
  for (let i = 0; i < 2; i++) {
    const scene = compact.scenes[i]!, media = await probeEffectMedia(scene.videoPath!);
    assert.ok(media.hasAudio && media.durationSeconds < 10);
    assert.equal(scene.narration, scenes[i]!.narration); assert.equal(scene.audioPath, scenes[i]!.audioPath);
    assert.equal(scene.documentary!.selected!.excerpt!.sourceChecksum, checksum);
  }
  assert.equal(compact.scenes[1]!.documentary!.cuts![0]!.trimStartSeconds, 5.5);
  assert.equal(documentaryReuseIssue(compact, compact.scenes[1]!), undefined);
  assert.deepEqual(usedDocumentaryRanges(compact, compact.scenes[1]!), [{ start: -14.5, end: -11.5 }]);
  assert.equal((await prepareDocumentaryExcerpts(compact, join(root, "one"))).count, 0);
  const projectDirectory = (id: string) => join(root, id);
  assert.equal(compact.scenes[1]!.documentary!.selected!.provider, "commons");
  const cached = JSON.parse(await readFile(join(materialRoot, "Catalog", `${compact.scenes[1]!.documentary!.checksum}.json`), "utf8"));
  assert.ok((await stat(cached.localPath)).size > 0); assert.equal(cached.excerpt.startSeconds, 19.5);
  await writeFile(join(materialRoot, "Catalog", `${checksum}.json`), JSON.stringify({ ...source, id: "manual:import", provider: "local" }));
  assert.equal((await prepareDocumentaryExcerpts({ ...project, scenes: [scenes[1]!] }, join(root, "one"), undefined, undefined, materialRoot)).count, 0, "Cached imports are not compacted");
  await writeFile(join(materialRoot, "Catalog", `${checksum}.json`), JSON.stringify(source));
  // Cleanup protects downloads touched within the last day. Advance only the
  // fixture clock so this test checks the reference rules after that window.
  const afterRetention=Date.now()+25*3600_000;
  const retained = await planDocumentaryCleanup({ materialRoot, projectDirectory, projects: [compact, { id: "other", scenes: [scenes[0]] } as Project],now:afterRetention });
  assert.ok(!retained.files.some(file => file.path === original));
  const plan = await planDocumentaryCleanup({ materialRoot, projectDirectory, projects: [compact],now:afterRetention });
  assert.ok(plan.files.some(file => file.path === original));
  const removed = await executeDocumentaryCleanup(plan); assert.equal(removed.bytes, originalBytes);
  for (const scene of compact.scenes) assert.ok((await stat(scene.videoPath!)).size > 0);
  const provenance = JSON.parse(await readFile(join(docRoot, "Excerpts/fragments.json"), "utf8"));
  assert.equal(provenance.fragments[0].startSeconds, 4.5); assert.equal(provenance.fragments[0].sourceUrl, source.pageUrl);
});
