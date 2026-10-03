import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {createVoiceCalibration,type DocumentaryCandidate,type DocumentarySearchInput} from '@gold-work/shared';
import {DocumentaryProjectService} from './documentary-project-service.js';
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
