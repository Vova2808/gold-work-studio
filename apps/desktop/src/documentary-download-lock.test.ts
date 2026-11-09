import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {createVoiceCalibration,type DocumentaryCandidate} from '@gold-work/shared';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {DocumentarySearch} from './documentary-search.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {prepareDocumentaryScript} from './documentary-plan.js';

async function lockedSelection(t:TestContext,waitMs:number,fallback=false){
 const root=await mkdtemp(join(tmpdir(),'gws-download-lock-'));
 assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));
 t.after(()=>rm(root,{recursive:true,force:true}));
 t.mock.method(globalThis,'fetch',async()=>assert.fail('Offline source-lock regression must never use the network'));
 const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
 let project=await projects.create({title:'Source lock',topic:'Harbour',mediaMode:'stock',mode:'standard',language:'English',aspectRatio:'16:9'});
 const narration='Boats rest in the harbour.';
 project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:narration};
 const scene=prepareDocumentaryScript(project,createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:narration,audioDurationSeconds:4}))[0]!;
 scene.audioPath='preserved-narration.mp3';
 scene.documentary!.requirement={...scene.documentary!.requirement,identities:[],entities:['boats'],years:[],queries:['boats harbour'],preferredKind:'video',plannedBy:'semantic'};
 project.scenes=[scene];project.settings.stockVideoPercent=100;project.settings.voice.enabled=false;
 project.settings.assembly.documentary!.autoMotionGraphics=false;
 project=await projects.update(project.id,project);
 const candidate:DocumentaryCandidate={id:'pixabay:35266',provider:'pixabay',kind:'video',title:'Boats harbour',description:'Boats harbour',
  downloadUrl:'https://example.test/boats.mp4',pageUrl:'https://example.test/boats',width:1920,height:1080,durationSeconds:10,
  author:'Fixture',license:'Fixture',licenseUrl:'',rights:'licensed',attribution:'Fixture',query:'boats harbour',retrievedAt:'now',match:'unverified',concerns:[]};
 const search=new DocumentarySearch();search.search=async input=>({candidates:input.kind==='video'?[candidate]:[],sources:[]});
 let transfers=0;
 const service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,'projects')),search,join(root,'Materials'),
  {download:async()=>{transfers++;throw Error('Offline transfer reached; no media bytes requested');}},()=>{},
  {simpleSelection:true,available:async()=>true,plan:async()=>new Map(),inspect:async()=>assert.fail('No paid analysis in a transfer regression')});
 Reflect.set(service,'selectionResources',async()=>({workers:1}));
 const reserve=Reflect.get(service,'reserveSource').bind(service) as (key:string)=>Promise<()=>void>;
 const key='download:video:pixabay:pixabay:35266',release=await reserve(key);
 let entered!:()=>void;const waiting=new Promise<void>(done=>entered=done);
 Reflect.set(service,'reserveSource',(value:string)=>{const pending=reserve(value);if(value===key)entered();return pending;});
 const work=fallback
   ?service.completeWithNativeFallback(project.id).then(project=>({project,failures:[]}))
   :service.autoSelect(project.id,{sceneIds:[scene.id]});
 try{
  await waiting;
  assert.equal(transfers,0,'The real source lock prevents a second transfer');
  const now=Date.now();t.mock.method(Date,'now',()=>now+waitMs);
 }finally{release();}
 const result=await work;
 assert.equal(result.project.scenes[0]!.audioPath,scene.audioPath);
 return {transfers,result};
}

test('simple selection starts its short transfer window after a delayed source lock',{timeout:15000},async t=>{
 const {transfers,result}=await lockedSelection(t,25_000);
 assert.equal(transfers,1,JSON.stringify(result.failures));
});

test('a source-lock wait cannot extend the absolute scene budget',{timeout:15000},async t=>{
 const {transfers}=await lockedSelection(t,300_000);
 assert.equal(transfers,0,'An exhausted scene must not start a transfer');
});

test('automatic fallback leaves the review time available after waiting for a source',{timeout:15000},async t=>{
 const {transfers}=await lockedSelection(t,75_000,true);
 assert.equal(transfers,0,'Only 15 seconds remain in the 90-second fallback window');
});
