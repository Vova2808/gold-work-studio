import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm,writeFile,copyFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {createVoiceCalibration,type DocumentaryCandidate,type Project} from '@gold-work/shared';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {DocumentarySearch} from './documentary-search.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {prepareDocumentaryScript} from './documentary-plan.js';
import {effectFfmpeg} from './effect-media.js';
import {DocumentaryDownloadTimeoutError} from './documentary-download.js';

test('a timed-out stock range falls back inside the same budget and pauses the range shortcut',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-range-timeout-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const file=join(root,'source.mp4');
  await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=size=1280x720:rate=10','-t','8','-c:v','libx264','-preset','ultrafast','-threads','1',file]);
  const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
  let p=await projects.create({title:'Range timeout',topic:'Railway',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
  p.videoBrief={...p.videoBrief!,creationMode:'script',readyScript:'Railway connects cities. Trains carry people.'};
  const calibration=createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:p.videoBrief.readyScript!,audioDurationSeconds:8});
  const scenes=prepareDocumentaryScript(p,calibration);
  for(const scene of scenes)scene.documentary!.requirement={...scene.documentary!.requirement,entities:[],identities:[],years:[],queries:['railway'],
    visualScope:'illustrative',visualScopeVersion:3,visualScopeQuote:scene.narration,illustrationQuery:'railway',plannedBy:'semantic',identityContextVersion:3};
  p=await projects.update(p.id,{scenes});
  const candidate:DocumentaryCandidate={id:'pexels:range',provider:'pexels',kind:'video',title:'Railway',description:'',width:1280,height:720,durationSeconds:40,
    query:'railway',pageUrl:'https://example.test/range',downloadUrl:'https://example.test/range.mp4',author:'Fixture',license:'Fixture',licenseUrl:'',
    attribution:'Fixture',rights:'licensed',retrievedAt:'now',match:'unverified',concerns:[]};
  const realTimeout=AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal,'timeout',(ms:number)=>ms===12_000?AbortSignal.abort(new DOMException('Range timed out','TimeoutError')):realTimeout(ms));
  let ranges=0,originals=0;
  const service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,'projects')),new DocumentarySearch(),join(root,'Materials'),{
    download:async()=>{throw Error('Streaming adapter should be used');},
    downloadRangeToFile:async(_asset,destination,_range,signal)=>{
      ranges++;await writeFile(destination,'incomplete');signal?.throwIfAborted();throw Error('Expected range-only timeout');
    },
    downloadToFile:async(_asset,destination,_available,signal)=>{
      originals++;assert.equal(signal?.aborted,false,'Original retains the outer transfer deadline');
      await writeFile(destination,'',{flag:'wx'});await copyFile(file,destination);
      return {bytes:(await stat(destination)).size,extension:'.mp4',contentType:'video/mp4'};
    }
  },()=>{});
  // Exercise the actual automatic transfer boundary, without a provider or a mock approval.
  const automatic=service as unknown as {apply:(id:string,scene:string,candidate:DocumentaryCandidate,commit:boolean,
    progress?:undefined,wait?:undefined,deadline?:number)=>Promise<Project>};
  const first=await automatic.apply(p.id,scenes[0]!.id,candidate,false,undefined,undefined,Date.now()+120_000);
  assert.ok(first.scenes[0]!.videoPath);assert.equal(first.scenes[0]!.documentary!.verified,false);
  await automatic.apply(p.id,scenes[1]!.id,{...candidate,id:'pexels:other',downloadUrl:'https://example.test/other.mp4'},false,undefined,undefined,Date.now()+120_000);
  assert.equal(ranges,1,'Subsequent sources do not repeat the same slow range shortcut');
  assert.equal(originals,2,'Both bounded originals remain available for actual frame review');
});

test('after a transfer timeout, selection inspects another provider before more slow originals',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-provider-timeout-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const file=join(root,'source.mp4');
  await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=size=1280x720:rate=10','-t','8','-c:v','libx264','-preset','ultrafast','-threads','1',file]);
  const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
  let p=await projects.create({title:'Provider timeout',topic:'Railway',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
  p.videoBrief={...p.videoBrief!,creationMode:'script',readyScript:'Railway connects cities.'};
  const calibration=createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:p.videoBrief.readyScript!,audioDurationSeconds:4});
  const scene=prepareDocumentaryScript(p,calibration)[0]!;
  scene.documentary!.requirement={...scene.documentary!.requirement,entities:[],identities:[],years:[],queries:['railway'],preferredKind:'video',
    visualScope:'illustrative',visualScopeVersion:3,visualScopeQuote:scene.narration,illustrationQuery:'railway',plannedBy:'semantic',identityContextVersion:3};
  p=await projects.update(p.id,{scenes:[scene],settings:{...p.settings,stockVideoPercent:100}});
  const candidate:DocumentaryCandidate={id:'pixabay:slow',provider:'pixabay',kind:'video',title:'railway',description:'',width:1280,height:720,durationSeconds:40,
    query:'railway',pageUrl:'https://example.test/slow',downloadUrl:'https://example.test/slow.mp4',author:'Fixture',license:'Fixture',licenseUrl:'',
    attribution:'Fixture',rights:'licensed',retrievedAt:'now',match:'unverified',concerns:[]};
  const searcher=new DocumentarySearch();
  searcher.search=async()=>({candidates:[candidate,{...candidate,id:'pixabay:also-slow',durationSeconds:8,downloadUrl:'https://example.test/also-slow.mp4'},
    {...candidate,id:'pexels:available',provider:'pexels',durationSeconds:40,downloadUrl:'https://example.test/available.mp4'}],sources:[]});
  const transferred:string[]=[];
  let proxyRecovered=false;
  let transferClock=Date.now();t.mock.method(Date,'now',()=>transferClock);
  const service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,'projects')),searcher,join(root,'Materials'),{
    download:async()=>{throw Error('Streaming adapter should be used');},
    downloadToFile:async(asset,destination)=>{
      transferred.push(asset.id);
      if(asset.provider==='pixabay'&&!proxyRecovered){transferClock+=2000;throw new DocumentaryDownloadTimeoutError('Источник превысил время автоматической загрузки.');}
      await copyFile(file,destination);return {bytes:(await stat(destination)).size,extension:'.mp4',contentType:'video/mp4'};
    }
  },()=>{}, {available:async()=>true,plan:async(_project,scenes)=>new Map(scenes.map(s=>[s.id,s.documentary!.requirement])),
    inspect:async()=>({status:'accepted',confidence:.99,reason:'Mock: orchestration only',quality:'Fixture',checkedAt:'now',sampleSeconds:[.1,2,3.9],trimStartSeconds:0,trimEndSeconds:4})});
  const result=await service.autoSelect(p.id);
  assert.equal(result.project.scenes[0]!.documentary!.selected?.provider,'pexels');
  assert.deepEqual(transferred,['slow','available'],'A second slow original must not consume the remaining review budget');
  await projects.update(p.id,{scenes:[scene]});
  proxyRecovered=true;
  const resumed=await service.autoSelect(p.id);
  assert.equal(transferred.filter(id=>id==='slow').length,2,'A new user run may retry a temporary connection failure after fixing the proxy');
  assert.equal(resumed.project.scenes[0]!.documentary!.selected?.provider,'pixabay','The recovered source is usable again instead of remaining permanently blacklisted');
});
