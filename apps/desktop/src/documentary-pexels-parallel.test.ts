import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {createVoiceCalibration,documentaryManualReviewReady,type DocumentaryCandidate,type Project} from '@gold-work/shared';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {DocumentarySearch} from './documentary-search.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {prepareDocumentaryScript} from './documentary-plan.js';

function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}
async function fixture(t:test.TestContext,count:number,workers:number,before:(id:string,signal:AbortSignal)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'gws-pexels-parallel-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
 let project=await projects.create({title:'Cars',topic:'Ford and Ferrari',mediaMode:'stock',mode:'standard',language:'English',aspectRatio:'16:9'});
 project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:'The cars entered the factory.'};
 const template=prepareDocumentaryScript(project,createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:'The cars entered the factory.',audioDurationSeconds:5}))[0]!;
 project.settings.voice.enabled=false;project.settings.stockVideoPercent=0;
 const scenes=Array.from({length:count},(_,order)=>{const scene=structuredClone(template);scene.id=`scene-${order}`;scene.order=order;scene.audioPath=`saved-voice-${order}.wav`;scene.documentary!.selectionPlan={kind:'image',videoPercent:0};scene.documentary!.requirement.queries=[`query ${order}`];return scene;});
 project=await projects.mutate(project.id,()=>({scenes,settings:project.settings,status:'generating'}));
 const stats={active:0,maximum:0,searches:0,attempts:0};
 const candidate:DocumentaryCandidate={id:'pexels:one',provider:'pexels',kind:'image',title:'Car',description:'',pageUrl:'https://www.pexels.com/photo/1/',downloadUrl:'https://images.pexels.com/1.jpg',previewUrl:'',author:'author',attribution:'author',license:'Pexels',licenseUrl:'https://www.pexels.com/license/',rights:'licensed',query:'car',retrievedAt:'now',width:1600,height:900,match:'unverified',concerns:[]};
 const service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,'projects')),
  {search:async()=>{stats.searches++;return {candidates:[candidate],sources:[]};}} as unknown as DocumentarySearch,
  join(root,'materials'),{download:async()=>{throw Error('Unexpected direct download');}},()=>{},
  {simpleSelection:true,available:async()=>true,plan:async()=>{throw Error('Paid planning forbidden');},inspect:async()=>{throw Error('Paid inspection forbidden');}});
 const boundary=service as unknown as {selectionResources:()=>Promise<{workers:number;physicalBytes:number;commitBytes:number}>;apply:(id:string,sceneId:string,selected:DocumentaryCandidate,commit?:boolean,progress?:unknown,wait?:unknown,deadline?:number,preview?:unknown,manual?:boolean,fallback?:{signal?:AbortSignal})=>Promise<Project>};
 boundary.selectionResources=async()=>({workers,physicalBytes:4*1024**3,commitBytes:4*1024**3});
 boundary.apply=async(id,sceneId,selected,_commit,_progress,_wait,_deadline,_preview,manual,fallback)=>{
  assert.equal(manual,true);assert.ok(fallback?.signal);stats.attempts++;stats.active++;stats.maximum=Math.max(stats.maximum,stats.active);
  try{await before(sceneId,fallback.signal);fallback.signal.throwIfAborted();const path=join(root,`${sceneId}.png`);await writeFile(path,`prepared ${sceneId}`);
   const current=(await projects.get(id))!;return {...current,scenes:current.scenes.map(s=>s.id===sceneId?{...s,imagePath:path,documentary:{...s.documentary!,selected:{...selected,localPath:path},checksum:`checksum-${sceneId}`}}:s)};
  }finally{stats.active--;}
 };
 return {projects,project,service,stats};
}

test('fallback caps high resource capacity at one, saves every result, and reuses pending files',async t=>{
 const started=deferred(),release=deferred();let arrivals=0;
 const f=await fixture(t,6,8,async()=>{if(++arrivals===1)started.resolve();await release.promise;});
 const work=f.service.completeWithNativeFallback(f.project.id);
 await started.promise;assert.equal(f.stats.active,1);assert.equal(f.stats.attempts,1);release.resolve();
 const result=await work;assert.equal(f.stats.maximum,1);assert.equal(result.scenes.filter(scene=>documentaryManualReviewReady(scene)).length,6);
 assert.deepEqual(result.scenes.map(s=>s.audioPath),f.project.scenes.map(s=>s.audioPath));
 const saved=await f.projects.get(result.id);assert.deepEqual(saved!.scenes,result.scenes);
 await f.service.completeWithNativeFallback(result.id);assert.equal(f.stats.searches,6);assert.equal(f.stats.attempts,6);
});

test('fallback honors a resource capacity of one',async t=>{
 const f=await fixture(t,3,1,async()=>{});const result=await f.service.completeWithNativeFallback(f.project.id);
 assert.equal(f.stats.maximum,1);assert.equal(result.scenes.filter(scene=>documentaryManualReviewReady(scene)).length,3);
});

test('one failed fallback does not discard another worker or later saved scenes',async t=>{
 const f=await fixture(t,4,2,async id=>{if(id==='scene-1')throw Error('CDN transfer failed');});
 const result=await f.service.completeWithNativeFallback(f.project.id);
 assert.equal(result.scenes.filter(scene=>documentaryManualReviewReady(scene)).length,3);assert.match(result.scenes[1]!.documentary!.autoError!,/CDN transfer failed/);
 assert.equal(result.scenes[3]!.documentary!.manualReview!.status,'pending');
});

test('Stop cancels the active fallback download, drains it, and starts no queued scene',async t=>{
 const started=deferred();let arrivals=0,aborted=0;const controller=new AbortController();
 const f=await fixture(t,5,2,async(_id,signal)=>new Promise<void>((_resolve,reject)=>{
  signal.addEventListener('abort',()=>{aborted++;reject(signal.reason);},{once:true});if(++arrivals===1)started.resolve();
 }));
 const work=f.service.completeWithNativeFallback(f.project.id,undefined,controller.signal);
 await started.promise;controller.abort(Error('User stopped'));await assert.rejects(work,/User stopped/);
 assert.equal(aborted,1);assert.equal(f.stats.active,0);assert.equal(f.stats.attempts,1);
 assert.equal((await f.projects.get(f.project.id))!.scenes.filter(scene=>documentaryManualReviewReady(scene)).length,0);
});
