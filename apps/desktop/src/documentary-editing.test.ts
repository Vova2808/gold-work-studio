import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildDocumentaryTimeline } from "@gold-work/remotion-video";
import { createDefaultProjectSettings, createDocumentarySettings, createVoiceCalibration, type Project } from "@gold-work/shared";
import { prepareDocumentaryScript } from "./documentary-plan.js";
import { documentaryRenderCache, documentaryExportProject } from "./documentary-render-cache.js";
import { renderDocumentaryAudio } from "./documentary-fast-render.js";
import { runFfmpeg } from "./standard-renderer.js";
import { documentaryEditErrors } from "./documentary-validation.js";
import { splitVisualCut, rollVisualCut, mergeVisualCut } from "../../renderer/src/documentary-editing.js";
import { mergeScenarioDraft, restoreDocumentaryEdit } from "../../renderer/src/scenario-draft-merge.js";
import { documentaryDesign, documentaryEase } from "../../../packages/remotion-video/src/documentary-design.js";

function fixture() {
  const project={id:"editor-test",mediaMode:"stock",aspectRatio:"16:9",scenes:[],settings:createDefaultProjectSettings(),videoBrief:{creationMode:"script",readyScript:"SS United States crossed the Atlantic. Icon of the Seas is a cruise ship."}} as unknown as Project;
  project.settings.assembly.documentary=createDocumentarySettings();
  const calibration=createVoiceCalibration({provider:"elevenlabs",voice:"fixture",language:"en",sampleText:"A clear measured voice reads this whole sentence.",audioDurationSeconds:5});
  project.scenes=prepareDocumentaryScript(project,calibration).map(scene=>({...scene,durationSeconds:5,documentary:{...scene.documentary!,verified:true}}));
  return project;
}
test("picture cuts, rolling and merge preserve narration and duration, including freeze tails",()=>{
  const project=fixture(), scene=project.scenes[0]!;
  const narration=scene.narration;
  scene.trimEndSeconds=1;
  scene.documentary!.cuts=splitVisualCut(scene,75,"right");
  assert.equal(scene.narration,narration);
  assert.equal(scene.documentary!.cuts!.length,2);
  assert.ok(scene.documentary!.cuts![1]!.trimStartSeconds<1);
  assert.equal(scene.documentary!.cuts!.reduce((sum,c)=>sum+c.durationInFrames,0),150);
  scene.documentary!.cuts=rollVisualCut(scene,"right",-8);
  assert.equal(scene.documentary!.cuts![1]!.fromFrame,67);
  assert.equal(scene.documentary!.cuts!.reduce((sum,c)=>sum+c.durationInFrames,0),150);
  scene.documentary!.cuts=mergeVisualCut(scene,"right");
  assert.equal(scene.documentary!.cuts!.length,1);
  assert.equal(scene.documentary!.cuts![0]!.durationInFrames,150);
  assert.deepEqual(documentaryEditErrors(project),[]);
});
test("chapter/cuts/text edits survive backend updates and undo without losing new voice",()=>{
  const project=fixture(),before=structuredClone(project.scenes),edited=structuredClone(before),incoming=structuredClone(before);
  edited[0]!.documentary!.template="chapter-breathe";
  edited[0]!.documentary!.templateMotion={amountPercent:25,curve:"dramatic"};
  edited[0]!.documentary!.cuts=splitVisualCut(edited[0]!,30,"right");
  edited[0]!.documentary!.texts=[{id:"text",text:"Chapter",enabled:true,startSeconds:1,durationSeconds:2,x:50,y:50,fontSize:96,color:"#ffffff",backgroundColor:"#000000",opacity:100,animation:"fade",fadeInSeconds:.3,fadeOutSeconds:.3}];
  incoming[0]!.audioPath="new.wav";
  const merged=mergeScenarioDraft(edited,before,incoming);
  assert.equal(merged[0]!.documentary!.template,"chapter-breathe");
  assert.deepEqual(merged[0]!.documentary!.cuts,edited[0]!.documentary!.cuts);
  assert.deepEqual(merged[0]!.documentary!.texts,edited[0]!.documentary!.texts);
  const undo=restoreDocumentaryEdit(before,merged);
  assert.equal(undo[0]!.documentary!.cuts,undefined);assert.equal(undo[0]!.documentary!.texts,undefined);
  assert.equal(undo[0]!.audioPath,"new.wav");
});
test("chapter motion eases both ends and breathe returns to its starting scale",()=>{
  for(const curve of ["smooth","dramatic"] as const){
    assert.equal(documentaryEase(0,curve),0);assert.equal(documentaryEase(.5,curve),.5);assert.equal(documentaryEase(1,curve),1);
    assert.ok(documentaryEase(.1,curve)<.02);assert.ok(documentaryEase(.9,curve)>.98);
    const design=(f:number)=>documentaryDesign("chapter-breathe",f,101,"#abcdef",{amountPercent:20,curve});
    assert.equal(design(0).mediaTransform,"scale(1)");assert.equal(design(50).mediaTransform,"scale(1.2)");assert.equal(design(100).mediaTransform,"scale(1)");
  }
  assert.equal(documentaryDesign('chapter-split',100,101,'#abcdef',{amountPercent:0,curve:'smooth'}).mediaTransform,'scale(1)');
  assert.notEqual(documentaryDesign('chapter-split',100,101,'#abcdef',{amountPercent:20,curve:'smooth'}).mediaTransform,'scale(1)');
  const project=fixture();project.scenes[0]!.autoKenBurnsDirection='pan-left';
  assert.equal(buildDocumentaryTimeline(project).scenes[0]!.autoKenBurnsDirection,'pan-left');
});
test("audio cache invalidates volume changes, not graphics; visual cache tracks cross-scene text",async()=>{
  const root=await mkdtemp(join(tmpdir(),"gws-editor-cache-test-")), project=fixture();
  project.settings.assembly.transitionType='none';
  const audio=join(root,"voice.wav");await writeFile(audio,"local fixture identity, not playable audio");
  project.scenes[0]!.documentary!.timing={sourceKey:"test",audioPath:audio,durationInFrames:150,speechSeconds:5};
  const cache=await documentaryRenderCache(root,resolve("../../packages/remotion-video/dist/index.js"));
  const a=buildDocumentaryTimeline(project),audioKey=await cache.audioPath(a),visualKey=await cache.path(a,1,1,28);
  const shifted=structuredClone(project);shifted.scenes[0]!.durationOverrideSeconds=8;
  assert.equal(await cache.path(buildDocumentaryTimeline(shifted),1,1,28),visualKey,'Extending a prior shot must reuse unchanged later pixels');
  shifted.scenes[1]!.durationOverrideSeconds=9;
  assert.notEqual(await cache.path(buildDocumentaryTimeline(shifted),1,1,28),visualKey,'Changing the cached shot duration requires new frames');
  const mixed=structuredClone(project);mixed.scenes[0]!.transition='mix';
  const mixedKey=await cache.path(buildDocumentaryTimeline(mixed),1,1,28);
  mixed.scenes[0]!.durationOverrideSeconds=8;
  assert.notEqual(await cache.path(buildDocumentaryTimeline(mixed),1,1,28),mixedKey,'An incoming dissolve still depends on the previous shot');
  project.scenes[0]!.documentary!.texts=[{id:"across",text:"Chapter",enabled:true,startSeconds:4,durationSeconds:2,x:50,y:50,fontSize:96,color:"#ffffff",backgroundColor:"#000000",opacity:100,animation:"fade",fadeInSeconds:.3,fadeOutSeconds:.3}];
  const b=buildDocumentaryTimeline(project);
  assert.equal(await cache.audioPath(b),audioKey);assert.notEqual(await cache.path(b,1,1,28),visualKey);
  project.scenes[0]!.narrationVolume=50;
  assert.notEqual(await cache.audioPath(buildDocumentaryTimeline(project)),audioKey);
});
test("opening preview does not replace export originals or invalidate video pixels",async()=>{
  const root=await mkdtemp(join(tmpdir(),'gws-preview-cache-')),project=fixture();
  const video=join(root,'video.mp4'),poster=join(root,'poster.jpg'),nextPoster=join(root,'next-poster.jpg');
  for(const file of [video,poster,nextPoster])await writeFile(file,'fixture file identity');
  const scene=project.scenes[0]!;scene.videoPath=video;scene.imagePath=poster;
  const cache=await documentaryRenderCache(root,resolve('../../packages/remotion-video/dist/index.js'));
  const before=await cache.path(buildDocumentaryTimeline(project),0,0,20,true);
  const compositionBefore=await cache.path(buildDocumentaryTimeline(project),0,0,20,false);
  scene.imagePath=nextPoster;
  assert.equal(await cache.path(buildDocumentaryTimeline(project),0,0,20,true),before);
  assert.notEqual(await cache.path(buildDocumentaryTimeline(project),0,0,20,false),compositionBefore,'Composited video can paint this poster as a blurred backdrop');
  scene.trimStartSeconds=1;
  assert.notEqual(await cache.path(buildDocumentaryTimeline(project),0,0,20,true),before,'A real trim still invalidates the export');
  scene.videoPath=undefined;scene.documentary!.checksum='photo';
  scene.documentary!.selected={...scene.documentary!.selected!,kind:'image',localPath:poster};
  const preview=join(root,'Documentary','Playback','photo-3840.png');scene.imagePath=preview;
  assert.equal(documentaryExportProject(project,root).scenes[0]!.imagePath,poster);
  assert.equal(scene.imagePath,preview,'Export must not rewrite the UI preview');
  scene.imagePath=nextPoster;
  assert.equal(documentaryExportProject(project,root).scenes[0]!.imagePath,nextPoster,'Preserve an explicitly different edited image');
});

test("cut source audio follows its trimmed range and does not repeat on a freeze tail",async()=>{
  const root=await mkdtemp(join(tmpdir(),"gws-cut-audio-test-")),project=fixture();
  const source=join(root,"source.mp4");
  await runFfmpeg(["-y","-f","lavfi","-i","color=c=blue:s=64x64:r=30:d=1","-f","lavfi","-i","sine=frequency=700:duration=1","-c:v","libx264","-c:a","aac","-shortest",source]);
  project.settings.voice.enabled=false;
  const first=project.scenes[0]!,second=project.scenes[1]!;
  first.videoPath=source;first.sourceVolume=100;
  first.documentary!.selected={...first.documentary!.selected!,durationSeconds:1};
  first.documentary!.cuts=[{id:"video",fromFrame:0,durationInFrames:60,trimStartSeconds:.25,playbackRate:1},
    {id:"still",fromFrame:60,durationInFrames:90,sourceSceneId:second.id,trimStartSeconds:0,playbackRate:1}];
  const output=await renderDocumentaryAudio(buildDocumentaryTimeline(project),root);assert.ok(output);
  const pcm=join(root,"samples.f32");await runFfmpeg(["-y","-i",output,"-ac","1","-ar","8000","-f","f32le",pcm]);
  const data=await readFile(pcm);
  const rms=(at:number)=>Math.sqrt(Array.from({length:400},(_,i)=>data.readFloatLE((Math.round(at*8000)+i)*4)**2).reduce((a,b)=>a+b,0)/400);
  assert.ok(rms(.1)>.02);assert.ok(rms(1)<.001);assert.ok(rms(2.5)<.001);
});
