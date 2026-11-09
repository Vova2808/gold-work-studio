import assert from 'node:assert/strict';
import test,{type TestContext} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectService,MemoryProjectRepository,MockDirectorProvider} from '@gold-work/core';
import {createVoiceCalibration,type AutoStockSelectionResult,type DocumentaryCandidate} from '@gold-work/shared';
import {DocumentaryProjectService,documentaryTransferFingerprint} from './documentary-project-service.js';
import {DocumentaryDownloadTimeoutError} from './documentary-download.js';
import {DocumentarySearch} from './documentary-search.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {prepareDocumentaryScript} from './documentary-plan.js';
import {DocumentarySelectionSession} from './documentary-selection-session.js';

test('transfer identity ignores discovery time while changed URL, size and content revision remain recoverable',()=>{
  const source={provider:'pexels',id:'pexels:39364492',kind:'video',downloadUrl:'https://example.test/original.mp4',bytes:1234,
    width:1280,height:720,durationSeconds:69,retrievedAt:'first query',query:'clipper ship'} as DocumentaryCandidate;
  const original=documentaryTransferFingerprint(source);
  assert.equal(documentaryTransferFingerprint({...source,retrievedAt:'another query later',query:'mast on ship'}),original);
  for(const changed of [
    {...source,downloadUrl:'https://example.test/revised.mp4'}, {...source,bytes:2345}, {...source,width:1920,height:1080},
    {...source,excerpt:{sourceChecksum:'new-content-revision',startSeconds:0,endSeconds:4,sourceDurationSeconds:69}},
  ])assert.notEqual(documentaryTransferFingerprint(changed),original);
});

async function transferFixture(t:TestContext,count:number,id:string,durationSeconds:number,download:()=>Promise<never>){
  const root=await mkdtemp(join(tmpdir(),'gws-failed-transfer-'));t.after(()=>rm(root,{recursive:true,force:true}));
  t.mock.method(globalThis,'fetch',async()=>assert.fail('No live network in transfer coordination regression'));
  const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
  let project=await projects.create({title:'Source failure',topic:'Boats',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
  const narration='Boats rest in the harbour.';
  project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:narration};
  const base=prepareDocumentaryScript(project,createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:narration,audioDurationSeconds:4}))[0]!;
  project.scenes=Array.from({length:count},(_,order)=>({...structuredClone(base),id:`scene-${order}`,order,audioPath:`preserved-${order}.mp3`}));
  for(const scene of project.scenes)scene.documentary!.requirement={...scene.documentary!.requirement,entities:['boats'],identities:[],years:[],queries:['boats harbour'],preferredKind:'video',plannedBy:'semantic'};
  project.settings.stockVideoPercent=100;project.settings.voice.enabled=false;
  project.settings.assembly.documentary!.autoMotionGraphics=false;
  project=await projects.update(project.id,project);
  const source:DocumentaryCandidate={id:`pexels:${id}`,provider:'pexels',kind:'video',title:'Boats harbour',description:'Boats harbour',
    downloadUrl:'https://example.test/same-original.mp4',pageUrl:'https://example.test/source',width:1280,height:720,durationSeconds,
    author:'Fixture',attribution:'Fixture',license:'Fixture',licenseUrl:'',rights:'licensed',query:'boats harbour',retrievedAt:'first query',match:'unverified',concerns:[]};
  let searches=0;
  const search=new DocumentarySearch();search.search=async input=>({candidates:input.kind==='video'?[{...source,retrievedAt:`query-${++searches}`}]:[],sources:[]});
  const service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,'projects')),search,join(root,'Materials'),{
    download,
  },()=>{}, {simpleSelection:true,available:async()=>true,plan:async()=>new Map(),inspect:async()=>assert.fail('No paid analysis after failed download')});
  Reflect.set(service,'selectionResources',async()=>({workers:2}));
  return {service,project};
}

test('queued scenes do not repeat a timed-out original merely because another query retrieved it later',{timeout:15000},async t=>{
  let queued!:()=>void;const siblingQueued=new Promise<void>(resolve=>{queued=resolve;});
  let transfers=0,clock=Date.now();t.mock.method(Date,'now',()=>clock);
  const {service,project}=await transferFixture(t,2,'39364492',69,async()=>{
    transfers++;await siblingQueued;clock+=35_000;
    throw new DocumentaryDownloadTimeoutError('Fixture total transfer timeout','total');
  });
  const reserve=Reflect.get(service,'reserveSource').bind(service) as (key:string)=>Promise<()=>void>;
  let reservations=0;
  Reflect.set(service,'reserveSource',(key:string)=>{
    const pending=reserve(key);
    if(key==='download:video:pexels:pexels:39364492'&&++reservations===2)queued();
    return pending;
  });
  const result=await service.autoSelect(project.id);
  assert.ok(reservations>=2,'Both scenes reached the real shared source lock');
  assert.equal(transfers,1,'The failure is visible before releasing the source lock, regardless of retrievedAt');
  assert.deepEqual(result.project.scenes.map(scene=>scene.audioPath),['preserved-0.mp3','preserved-1.mp3']);
  assert.equal(result.selected,0);
});

test('full03 11986678: one late recovery is possible for the unchanged original, with no third transfer',{timeout:15000},async t=>{
  let transfers=0,clock=Date.now();t.mock.method(Date,'now',()=>clock);
  const {service,project}=await transferFixture(t,4,'11986678',80.57,async()=>{
    transfers++;
    if(transfers===1){clock+=35_000;throw new DocumentaryDownloadTimeoutError('Fixture first transfer deadline','total');}
    // Any result of the one recovery, even a non-timeout transport failure,
    // consumes it. The live full03 second transfer completed successfully.
    throw Error('Fixture late transport reached');
  });
  const session=new DocumentarySelectionSession(()=>clock),attempts=new Map();
  const select=(index:number)=>Reflect.apply(Reflect.get(service,'selectAll'),service,[project.id,
    {sceneIds:[project.scenes[index]!.id]},false,attempts,session,true]) as Promise<AutoStockSelectionResult>;
  await select(0);assert.equal(transfers,1);
  const timedOutAt=clock;
  clock+=50;
  await select(1);assert.equal(transfers,1,'No immediate duplicate in another scene');
  const observedGap=Date.parse('2026-11-08T23:29:22.778Z')-Date.parse('2026-11-08T23:21:38.588Z');
  clock=timedOutAt+observedGap;
  await select(2);assert.equal(transfers,2,'The observed late recovery must reach the downloader in the same run');
  clock+=60*60_000;
  await select(3);assert.equal(transfers,2,'Recovery is limited to one attempt per unchanged original and run');
});

test('a successfully recovered original stays eligible for cached reuse without a new download',()=>{
  let clock=1000;
  const failures=new DocumentarySelectionSession(()=>clock).failedTransfers;
  failures.add('original');
  clock+=5*60_000-1;
  assert.equal(failures.takeAttempt('original'),false,'No early recovery');
  clock++;
  assert.equal(failures.takeAttempt('original'),true);
  assert.equal(failures.has('original'),true,'A second scene cannot start while recovery is pending');
  failures.complete('original');
  assert.equal(failures.has('original'),false,'Let the candidate reach the catalog lookup');
  assert.equal(failures.takeAttempt('original'),false,'A missing or unsuitable cache entry cannot open a third transfer');
});
