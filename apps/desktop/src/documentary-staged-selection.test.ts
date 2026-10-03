import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {createVoiceCalibration,type DocumentaryCandidate,type DocumentarySearchInput} from '@gold-work/shared';
import {DocumentaryProjectService,documentaryCacheableVisualRejection} from './documentary-project-service.js';
import {DocumentarySearch} from './documentary-search.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {prepareDocumentaryScript} from './documentary-plan.js';
import {effectFfmpeg} from './effect-media.js';

for(const rejectFirst of [false,true])test(`staged selection ${rejectFirst?'continues after rejection':'accepts precise material before archive queries'} without touching another scene`,async()=>{
  const root=await mkdtemp(join(tmpdir(),'gws-staged-selection-'));
  const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
  let project=await projects.create({title:'Motorcycle',topic:'Honda RC211V',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
  project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:'The Honda RC211V is a racing motorcycle.'};
  const calibration=createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:'The Honda RC211V is a racing motorcycle.',audioDurationSeconds:4});
  const scene=prepareDocumentaryScript(project,calibration)[0]!;
  scene.audioPath=join(root,'paid-voice-preserved.mp3');
  scene.documentary!.requirement={...scene.documentary!.requirement,entities:['Honda RC211V'],identities:[{name:'Honda RC211V',aliases:[]}],years:[],queries:['Honda RC211V'],preferredKind:'image',plannedBy:'semantic',identityContextVersion:3};
  project=await projects.update(project.id,{settings:{...project.settings,stockVideoPercent:0},scenes:[scene,{...structuredClone(scene),id:'untouched',order:1}]});
  const untouched=structuredClone(project.scenes[1]);
  const candidates:DocumentaryCandidate[]=[];
  for(const [index,color] of ['red','blue'].entries()){
    const file=join(root,`source-${index}.png`);
    await effectFfmpeg(['-y','-f','lavfi','-i',`color=c=${color}:s=1280x720`,'-frames:v','1',file]);
    candidates.push({id:`source-${index}`,provider:'commons',kind:'image',title:'Honda RC211V',description:'Synthetic local test fixture, not provider or semantic evidence',
      localPath:file,width:1280,height:720,pageUrl:`https://example.test/source-${index}`,downloadUrl:'',author:'test',license:'Own fixture',licenseUrl:'',rights:'user-confirmed',attribution:'test',query:'Honda RC211V',retrievedAt:'now',match:'exact-metadata',concerns:[]});
  }
  const calls:string[]=[],inspected:string[]=[];
  const searcher=new DocumentarySearch();
  searcher.search=async(input:DocumentarySearchInput)=>{
    const precise=input.kind==='image'&&input.providers?.length===1&&input.providers[0]==='commons';
    if(!precise)assert.ok(inspected.length>0,'Broader providers must not precede actual-frame inspection of precise results');
    calls.push(precise?'precise':'broad');
    return {candidates:precise?[candidates[0]!]:candidates,sources:[]};
  };
  const service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,'projects')),searcher,join(root,'Materials'),
    {download:async()=>{throw new Error('No remote media in this regression test');}},()=>{},{
      available:async()=>true,
      plan:async(_project,scenes)=>new Map(scenes.map(s=>[s.id,s.documentary!.requirement])),
      rankCandidates:async(_project,_scene,pool)=>pool,
      inspect:async(_project,current)=>{
        const id=current.documentary!.selected!.id;inspected.push(id);
        assert.equal((await projects.get(project.id))!.scenes[0]!.documentary!.verified,false,'Unreviewed pixels cannot be committed');
        return {status:rejectFirst&&id==='source-0'?'rejected':'accepted',confidence:.99,reason:'Stub semantic result for orchestration only',checkedAt:'now',sampleSeconds:[],quality:'1280x720'};
      },
    });
  const result=await service.autoSelect(project.id,{sceneIds:[scene.id]});
  assert.equal(result.selected,1,JSON.stringify(result.failures));
  assert.deepEqual(inspected,rejectFirst?['source-0','source-1']:['source-0']);
  assert.equal(calls.includes('broad'),rejectFirst);
  assert.equal(result.project.scenes[0]!.documentary!.selected!.id,rejectFirst?'source-1':'source-0');
  assert.equal(result.project.scenes[0]!.audioPath,scene.audioPath);
  assert.deepEqual(result.project.scenes[1],untouched);
});

test('actual video discovery retains the planned rival and event in the second YouTube query',async()=>{
 const root=await mkdtemp(join(tmpdir(),'gws-rival-discovery-'));
 const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
 let p=await projects.create({title:'Race',topic:'Rossi and Biaggi',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
 p.videoBrief={...p.videoBrief!,creationMode:'script',readyScript:'Rossi faced Max Biaggi at the 2004 opening race.'};
 const calibration=createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:p.videoBrief.readyScript!,audioDurationSeconds:5});
 const scene=prepareDocumentaryScript(p,calibration)[0]!;
 const queries=['Max Biaggi Honda RC211V 2004 South Africa','Biaggi MotoGP season opener 2004','Max Biaggi pit box Welkom'];
 scene.documentary!.requirement={...scene.documentary!.requirement,entities:['Max Biaggi'],identities:[{name:'Valentino Rossi',aliases:[]},{name:'Max Biaggi',aliases:['Biaggi']}],years:[],queries,preferredKind:'video',plannedBy:'semantic',identityContextVersion:3};
 p=await projects.update(p.id,{settings:{...p.settings,stockVideoPercent:100},scenes:[scene]});
 const seen:string[]=[];
 const searcher=new DocumentarySearch();searcher.search=async(input)=>{
   if(input.kind==='video'&&input.providers?.length===1&&input.providers[0]==='youtube')seen.push(input.query);
   return {candidates:[],sources:[]};
 };
 const service=new DocumentaryProjectService(projects,new LocalProjectStorage(root),searcher,join(root,'Materials'),
   {download:async()=>{throw Error('No media in this test');}},()=>{},{available:async()=>true,
     plan:async(_p,scenes)=>new Map(scenes.map(s=>[s.id,s.documentary!.requirement])),inspect:async()=>{throw Error('No candidates');}},
   undefined,{download:async()=>{throw Error('No candidates');}});
 const result=await service.autoSelect(p.id,{sceneIds:[scene.id]});
 assert.equal(result.selected,0);
 assert.deepEqual([...new Set(seen)],queries.slice(0,2));
 assert.ok(!seen.includes('Valentino Rossi'),'The second request must not silently change to the other participant');
});

test('weak first YouTube results receive one metadata vote after broad discovery',async()=>{
 const root=await mkdtemp(join(tmpdir(),'gws-video-pool-'));
 const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
 let project=await projects.create({title:'Motorcycle',topic:'Honda RC211V',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
 project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:'The Honda RC211V entered the new four-stroke MotoGP class in 2002.'};
 const calibration=createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:project.videoBrief.readyScript!,audioDurationSeconds:5});
 const scene=prepareDocumentaryScript(project,calibration)[0]!;
 scene.audioPath=join(root,'preserved-voice.mp3');
 scene.documentary!.requirement={...scene.documentary!.requirement,entities:['Honda RC211V'],identities:[{name:'Honda RC211V',aliases:[]}],years:['2002'],
   queries:['Honda RC211V 2002 four-stroke MotoGP'],detail:'four-stroke MotoGP regulations',preferredKind:'video',plannedBy:'semantic',identityContextVersion:3};
 project=await projects.update(project.id,{settings:{...project.settings,stockVideoPercent:100},scenes:[scene]});
 const make=(id:string,title:string,durationSeconds:number):DocumentaryCandidate=>({id,provider:id.startsWith('youtube:')?'youtube':'commons',kind:'video',title,description:'Archive',
   pageUrl:`https://example.test/${id.replace(':','-')}`,downloadUrl:`https://example.test/${id.replace(':','-')}.mp4`,author:'Fixture',license:'CC BY',licenseUrl:'https://example.test/license',
   rights:'licensed',attribution:'Fixture',query:'Honda RC211V 2002',retrievedAt:'now',match:'unverified',concerns:[],durationSeconds});
 const weak=make('youtube:abcdefghijk','Honda RC211V 2002 race archive',600);
 const broad=make('commons:race','Honda RC211V 2002 four-stroke MotoGP',30);
 const searcher=new DocumentarySearch();
 searcher.search=async input=>({candidates:input.kind!=='video'?[]:input.providers?.length===1&&input.providers[0]==='youtube'?[weak]:input.providers?.includes('commons')?[broad]:[],sources:[]});
 const ranked:string[][]=[];
 const service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,'projects')),searcher,join(root,'Materials'),
   {download:async()=>{throw Error('No media download expected');}},()=>{},
   {available:async()=>true,plan:async(_p,scenes)=>new Map(scenes.map(item=>[item.id,item.documentary!.requirement])),
     rankCandidates:async(_p,_s,pool)=>{ranked.push(pool.map(item=>item.id));return [];},inspect:async()=>{throw Error('No inspection expected');}},
   undefined,{download:async()=>{throw Error('No YouTube download expected');}});
 const result=await service.autoSelect(project.id,{sceneIds:[scene.id]});
 assert.equal(result.selected,0);
 assert.equal(ranked.length,1);
 assert.deepEqual(new Set(ranked[0]),new Set([weak.id,broad.id]));
 assert.equal(result.project.scenes[0]!.audioPath,scene.audioPath);
});

test('a completed visual rejection of the same still is not reinspected on resume',async t=>{
 const root=await mkdtemp(join(tmpdir(),'gws-rejected-still-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
 let project=await projects.create({title:'Race',topic:'Motorcycle',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
 project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:'The motorcycle raced.'};
 const calibration=createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:project.videoBrief.readyScript!,audioDurationSeconds:4});
 const scene=prepareDocumentaryScript(project,calibration)[0]!;
 scene.documentary!.requirement={...scene.documentary!.requirement,entities:['motorcycle'],identities:[],years:[],queries:['red motorcycle race'],preferredKind:'image'};
 project=await projects.update(project.id,{settings:{...project.settings,stockVideoPercent:0},scenes:[scene]});
 const file=join(root,'source.png');await effectFfmpeg(['-y','-f','lavfi','-i','color=c=red:s=1280x720','-frames:v','1',file]);
 const source:DocumentaryCandidate={id:'commons:red',provider:'commons',kind:'image',title:'Red motorcycle race',description:'Fixture',localPath:file,
   width:1280,height:720,pageUrl:'https://example.test/red',downloadUrl:'',author:'Fixture',license:'Owned',licenseUrl:'',rights:'user-confirmed',
   attribution:'Fixture',query:'red motorcycle race',retrievedAt:'now',match:'exact-metadata',concerns:[]};
 let inspections=0;
 const searcher=new DocumentarySearch();searcher.search=async()=>({candidates:[source],sources:[]});
 const service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,'projects')),searcher,join(root,'Materials'),
   {download:async()=>{throw Error('No remote download expected');}},()=>{},
   {available:async()=>true,plan:async(_p,items)=>new Map(items.map(item=>[item.id,item.documentary!.requirement])),
     rankCandidates:async(_p,_s,pool)=>pool,inspect:async()=>{inspections++;return {status:'rejected',confidence:.99,reason:'Wrong subject in actual frame',checkedAt:'now',sampleSeconds:[],quality:'clear'};}});
 await service.autoSelect(project.id,{sceneIds:[scene.id]});
 await service.autoSelect(project.id,{sceneIds:[scene.id]});
 assert.equal(inspections,1,'The completed rejection must not consume the next bounded inspection slot');
 assert.equal(documentaryCacheableVisualRejection({...source,kind:'video',durationSeconds:600}),false,'Long videos may have other ranges');
 assert.equal(documentaryCacheableVisualRejection({...source,kind:'video',durationSeconds:9}),true);
});
