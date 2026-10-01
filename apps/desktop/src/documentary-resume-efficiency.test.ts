import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,stat,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {createVoiceCalibration,type DocumentaryCandidate} from '@gold-work/shared';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {DocumentarySearch} from './documentary-search.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {prepareDocumentaryScript} from './documentary-plan.js';
import {documentaryMetadataShortlist} from './documentary-intelligence.js';
import {timelineThumbnail} from './timeline-thumbnail.js';
import {effectFfmpeg,probeEffectMedia} from './effect-media.js';
import {anyModelUsageDiagnostic} from './anymodel-client.js';
import {TextFileLogger} from './text-file-logger.js';

test('numeric provider usage survives credential redaction without exposing secrets',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-usage-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const path=join(root,'diagnostic.log'),logger=new TextFileLogger(path);await logger.initialize();
  await logger.write('info','anymodel.completion.usage',{...anyModelUsageDiagnostic({prompt_tokens:123,completion_tokens:45,total_tokens:168}),apiToken:'secret-fixture'});
  const line=(await readFile(path,'utf8')).trim().split('\n').at(-1)!;const details=JSON.parse(line.slice(line.indexOf('{')));
  assert.equal(details.inputCount,123);assert.equal(details.outputCount,45);assert.equal(details.totalCount,168);
  assert.equal(details.apiToken,'[REDACTED]');assert.equal(anyModelUsageDiagnostic(undefined).reported,false);
});

test('failed identity repair runs once, preserving approved and manual scenes and paid audio',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-resume-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
  let p=await projects.create({title:'mechanism',topic:'mechanism',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
  p.videoBrief={...p.videoBrief!,creationMode:'script',readyScript:'The piston moves inside the engine.'};
  const calibration=createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:'The piston moves inside the engine.',audioDurationSeconds:3});
  const base=prepareDocumentaryScript(p,calibration)[0]!;
  p=await projects.update(p.id,{scenes:[0,1,2].map((n)=>({...base,id:`s${n}`,order:n,audioPath:`paid-${n}.mp3`,documentary:{...base.documentary!,verified:n===1,pinned:n===2,
    autoError:'Не подтверждён обязательный именованный объект',requirement:{...base.documentary!.requirement,identities:[{name:'piston',aliases:[]}],identityContextVersion:3,plannedBy:'semantic' as const}}}))});
  let repairs=0;
  const intelligence={available:async()=>false,resolveIdentities:async(_p:unknown,scenes:typeof p.scenes,save:(plan:Map<string,any>)=>Promise<void>)=>{
    repairs++;assert.deepEqual(scenes.map(s=>s.id),['s0']);await save(new Map(scenes.map(s=>[s.id,{...s.documentary!.requirement,identities:[]}])));
  }};
  const service=new DocumentaryProjectService(projects,new LocalProjectStorage(root),new DocumentarySearch(),join(root,'Materials'),{download:async()=>{throw new Error('No downloads in this test');}},()=>{},intelligence as never);
  // Test the paid repair boundary without starting search, download or provider calls.
  const repair=(service as unknown as {repairFailedIdentities:(id:string)=>Promise<boolean>}).repairFailedIdentities.bind(service);
  assert.equal(await repair(p.id),true);assert.equal(await repair(p.id),false);assert.equal(repairs,1);
  const saved=(await projects.get(p.id))!;
  assert.deepEqual(saved.scenes.map(s=>s.audioPath),p.scenes.map(s=>s.audioPath));
  assert.deepEqual(saved.scenes.slice(1),p.scenes.slice(1));assert.equal(saved.scenes[0]!.documentary!.requirement.identityRepairVersion,1);
});

test('named subjects and dates always get semantic ranking before downloading',()=>{
  const scene={documentary:{requirement:{identities:[{name:'SS United States',aliases:[]}],years:[],queries:['SS United States deck']}}} as never;
  const source=(title:string,id:string)=>({id,provider:'commons',kind:'image',title,description:'',query:'',width:1920,height:1080,concerns:[]}) as unknown as DocumentaryCandidate;
  const exact=source('SS United States deck in Philadelphia','exact'),other=source('United States economy','other');
  assert.deepEqual(documentaryMetadataShortlist(scene,[other,exact]),[]);
  assert.deepEqual(documentaryMetadataShortlist(scene,[other]),[]);
  assert.deepEqual(documentaryMetadataShortlist({documentary:{requirement:{identities:[],years:['1945'],queries:['ship deck']}}} as never,[exact]),[]);
});

test('Faster and long named compilations cannot bypass semantic source ranking',()=>{
  const scene={documentary:{requirement:{identities:[{name:'Faster',aliases:[]}],years:[],queries:['Faster motorcycle documentary']}}} as never;
  const bad=['Make XP Faster: Windows Help','Ostriches run faster','Which car is faster?'].map(title=>({title,kind:'video',provider:'youtube',durationSeconds:900,concerns:[]})) as unknown as DocumentaryCandidate[];
  assert.deepEqual(documentaryMetadataShortlist(scene,bad),[]);
  const generic={documentary:{requirement:{identities:[],years:[],queries:['engine piston detail']}}} as never;
  assert.deepEqual(documentaryMetadataShortlist(generic,[{...bad[0]!,title:'engine piston detail',durationSeconds:900}]),[]);
  assert.equal(documentaryMetadataShortlist(generic,[{...bad[0]!,provider:'pexels',title:'engine piston detail',durationSeconds:12}]).length,1);
});

test('timeline thumbnails are small, coalesced and cached without changing the source',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-thumbnail-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const source=join(root,'source.png');await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=size=1920x1080','-frames:v','1',source]);
  const before=await stat(source),cache=join(root,'cache');
  const [a,b]=await Promise.all([timelineThumbnail(source,cache),timelineThumbnail(source,cache)]);assert.equal(a,b);
  const info=await probeEffectMedia(a);assert.ok(info.width&&info.height&&info.width<=240&&info.height<=136);
  const cached=await stat(a);assert.equal(await timelineThumbnail(source,cache),a);assert.equal((await stat(a)).mtimeMs,cached.mtimeMs);
  assert.equal((await stat(source)).mtimeMs,before.mtimeMs);
});
