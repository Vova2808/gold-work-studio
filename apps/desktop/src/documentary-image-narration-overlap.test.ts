import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {createVoiceCalibration,type DocumentaryCandidate,type QueueTask} from '@gold-work/shared';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {DocumentarySearch} from './documentary-search.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {prepareDocumentaryScript} from './documentary-plan.js';
import {documentaryNarrationReadiness} from './documentary-production.js';
import {documentarySavedContextIssue} from './documentary-context-approval.js';
import {AnyModelCompletionUncertainError} from './anymodel-client.js';
import {effectFfmpeg} from './effect-media.js';

function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}

async function fixture(t:test.TestContext,kind:'image'|'video',unknown=false,duplicates=false){
 const root=await mkdtemp(join(tmpdir(),'gws-image-before-voice-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider()),storage=new LocalProjectStorage(join(root,'projects'));
 let project=await projects.create({title:'Train',topic:'Train',mediaMode:'stock',mode:'standard',language:'English',aspectRatio:'16:9'});
 const narration=kind==='image'?'A steam train stands at the station.':'A steam train moves along the railway.';
 project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:narration};
 project.scenes=prepareDocumentaryScript(project,createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:narration,audioDurationSeconds:5}));
 assert.equal(project.scenes.length,1);
 if(duplicates)project.scenes.push({...structuredClone(project.scenes[0]!),id:'duplicate',order:1});
 project.settings.stockVideoPercent=kind==='video'?100:0;project.settings.voice.enabled=true;
 project=await projects.update(project.id,project);
 const source=join(root,kind==='image'?'train.jpg':'train.mp4'),voice=join(root,'voice.wav');
 await effectFfmpeg(kind==='image'?['-y','-f','lavfi','-i','testsrc2=s=1280x720:r=1','-frames:v','1',source]
  :['-y','-f','lavfi','-i','testsrc2=s=1280x720:r=10','-t','8','-c:v','libx264','-threads','1','-preset','ultrafast',source]);
 await effectFfmpeg(['-y','-f','lavfi','-i','sine=frequency=440:duration=1.3',voice]);
 const candidate={id:'local-train',provider:'local',kind,title:'Steam train',description:'Steam train at a station',localPath:source,
  downloadUrl:'',pageUrl:'',query:'steam train',rights:'user-confirmed',concerns:[],match:'unverified',author:'fixture',license:'user',licenseUrl:'',attribution:'fixture',retrievedAt:'now'} as DocumentaryCandidate;
 const search=new DocumentarySearch();search.search=async()=>({candidates:[candidate],sources:[]});
 const first=deferred<'review'|'voice'>(),waiting=deferred<string|undefined>(),voiceGate=deferred<void>();
 const inputs:Array<Record<string,unknown>>=[];
 const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(_system:string,input:string,images:string[]=[])=>{
  first.resolve('review');assert.equal(images.length,kind==='image'?1:3);inputs.push(JSON.parse(input));
  if(unknown)throw new AnyModelCompletionUncertainError('Fixture response lost after submission');
  return JSON.stringify({description:'Fixture steam train',suitable:true,reason:'Mock matching train',targetVisible:true,targetEvidence:'Train locomotive and wheels are visible.',sourceText:{kind:'none',text:''},...(kind==='video'?{footageOrigin:'camera'}:{})});
 }},id=>storage.projectDirectory(id));
 const service=new DocumentaryProjectService(projects,storage,search,join(root,'Materials'),{download:async()=>{throw Error('Local media only');}},()=>{},intelligence);
 Reflect.set(service,'selectionResources',async()=>({workers:duplicates?2:1}));
 project=await service.planSearch(project.id);
 const tasks=project.scenes.map(scene=>({id:scene.id,sceneId:scene.id,kind:'speech',status:'running'})) as QueueTask[];
 const readiness=documentaryNarrationReadiness({projectId:project.id,projects,storage,tasks,list:async()=>tasks,signal:new AbortController().signal});
 const waits:Array<string|undefined>=[];
 const wait=async(sceneId?:string)=>{waits.push(sceneId);first.resolve('voice');waiting.resolve(sceneId);await voiceGate.promise;await readiness(sceneId);};
 const release=async()=>{await projects.mutate(project.id,current=>({scenes:current.scenes.map(scene=>({...scene,audioPath:voice}))}));
  tasks.forEach(task=>{task.status='done';});voiceGate.resolve();};
 const receipts=async()=>{const path=join(storage.projectDirectory(project.id),'Documentary','Analysis');
  return Promise.all((await readdir(path)).filter(name=>/^[a-f0-9]{64}\.json$/.test(name)).map(async name=>({path:join(path,name),bytes:await readFile(join(path,name),'utf8')})));};
 return {projects,project,service,intelligence,first,waiting,wait,release,waits,inputs,voice,receipts};
}

test('JPG review and approval precede TTS while final timing preserves the same receipt and fingerprint',{timeout:15_000},async t=>{
 const f=await fixture(t,'image'),run=f.service.autoSelect(f.project.id,{},f.wait);
 try{
  assert.equal(await f.first.promise,'review','An unchanged photograph must not wait for voice before actual-pixel inspection');
  assert.equal(await f.waiting.promise,undefined,'Only the all-voices barrier remains for images');
  const before=(await f.projects.get(f.project.id))!,scene=before.scenes[0]!;
  assert.equal(scene.audioPath,undefined);assert.equal(scene.documentary!.verified,true);
  assert.equal(documentarySavedContextIssue(before,scene),undefined);
  const approval=scene.documentary!.visualReview!.illustrationApproval,receipts=await f.receipts();assert.equal(receipts.length,1);
  await f.release();const result=await run,after=result.project.scenes[0]!;
  assert.equal(after.audioPath,f.voice);assert.ok(after.documentary!.timing!.durationInFrames<scene.durationSeconds*30);
  assert.equal(documentarySavedContextIssue(result.project,after),undefined);
  assert.deepEqual(after.documentary!.visualReview!.illustrationApproval,approval);
  const cached=await f.intelligence.inspectForSelection(result.project,after,undefined,undefined,true);
  assert.equal(cached.usedNewAnalysis,false);assert.equal(cached.review.status,'accepted');
  assert.deepEqual(cached.review.illustrationApproval,approval);assert.deepEqual(await f.receipts(),receipts);assert.equal(f.inputs.length,1);
 }finally{await f.release();await run.catch(()=>{});}
});

test('video pixel review still waits for measured TTS and uses its calibrated range',{timeout:15_000},async t=>{
 const f=await fixture(t,'video'),run=f.service.autoSelect(f.project.id,{},f.wait);
 try{
  assert.equal(await f.first.promise,'voice');assert.equal(await f.waiting.promise,f.project.scenes[0]!.id);assert.equal(f.inputs.length,0);
  await f.release();const result=await run,scene=result.project.scenes[0]!;
  assert.equal(f.inputs.length,1);assert.equal(scene.documentary!.verified,true);assert.equal(scene.audioPath,f.voice);
  assert.ok(Number(f.inputs[0]!.endSeconds)<2);assert.ok(scene.trimEndSeconds!<2);
  assert.deepEqual(f.waits,[scene.id,undefined]);
 }finally{await f.release();await run.catch(()=>{});}
});

test('early JPG unknown and pending receipts remain protected across TTS and resume',{timeout:15_000},async t=>{
 const f=await fixture(t,'image',true),run=f.service.autoSelect(f.project.id,{},f.wait);
 try{
  assert.equal(await f.first.promise,'review');assert.equal(await f.waiting.promise,undefined);
  await f.release();const result=await run;assert.equal(result.project.scenes[0]!.documentary!.verified,false);assert.equal(f.inputs.length,1);
  const receipts=await f.receipts();assert.equal(receipts.length,1);assert.equal(JSON.parse(receipts[0]!.bytes).state,'pending');
  for(const state of ['unknown','pending']){
   const receipt=receipts[0]!,bytes=JSON.stringify({...JSON.parse(receipt.bytes),state});await writeFile(receipt.path,bytes);
   const resumed=await f.service.autoSelect(f.project.id,{},f.wait);
   assert.equal(resumed.project.scenes[0]!.documentary!.verified,false);assert.equal(f.inputs.length,1);
   assert.equal(await readFile(receipt.path,'utf8'),bytes);
  }
 }finally{await f.release();await run.catch(()=>{});}
});

test('same-photo locks prevent a second paid review and duplicate approval before TTS',{timeout:15_000},async t=>{
 const f=await fixture(t,'image',false,true),run=f.service.autoSelect(f.project.id,{},f.wait);
 try{
  assert.equal(await f.first.promise,'review');assert.equal(await f.waiting.promise,undefined);
  const before=(await f.projects.get(f.project.id))!;
  assert.equal(f.inputs.length,1);assert.equal(before.scenes.filter(scene=>scene.documentary!.verified).length,1);
  assert.ok(before.scenes.every(scene=>!scene.audioPath));
  await f.release();const result=await run;
  assert.equal(f.inputs.length,1);assert.equal(result.project.scenes.filter(scene=>scene.documentary!.verified).length,1);
  assert.ok(result.project.scenes.every(scene=>scene.audioPath===f.voice&&scene.documentary!.timing));
 }finally{await f.release();await run.catch(()=>{});}
});
