import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {createVoiceCalibration,documentaryManualReviewReady,type DocumentaryCandidate,type Project,type Scene} from '@gold-work/shared';
import {documentaryCandidateUses,documentaryFallbackVideoRange,preferUnusedDocumentaryCandidates} from './documentary-candidate-allocation.js';
import {DocumentaryProjectService} from './documentary-project-service.js';
import type {DocumentarySearch} from './documentary-search.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {prepareDocumentaryScript} from './documentary-plan.js';

function candidate(id:string,kind:'image'|'video'='image'):DocumentaryCandidate{
  return {id,kind,provider:'pexels',title:id,description:'car',pageUrl:`https://www.pexels.com/${id}/`,downloadUrl:`https://fixture.invalid/${id}`,
    localPath:`/fixtures/${id}.${kind==='image'?'png':'mp4'}`,author:'fixture',attribution:'fixture',license:'Pexels',licenseUrl:'https://www.pexels.com/license/',
    rights:'licensed',query:'car',retrievedAt:'now',width:1600,height:900,durationSeconds:30,match:'unverified',concerns:[]};
}
function scene(id:string,order:number,selected?:DocumentaryCandidate,checksum=selected?.id):Scene{
  return {id,order,title:id,imagePrompt:'car',animationPrompt:'',status:'ready',narration:`speech ${id}`,durationSeconds:5,audioPath:`voice-${id}.wav`,imagePath:selected?.localPath,
    videoPath:selected?.kind==='video'?selected.localPath:undefined,
    documentary:{version:2,illustrative:true,reviewNote:'',layout:'full',effects:[],
      caption:{text:'',enabled:false,position:'bottom',animation:'fade',fontSize:32,color:'#fff',backgroundColor:'#000',opacity:1},
      requirement:{text:'car',entities:[],years:[],queries:['car']},
      timing:{durationInFrames:150,sourceKey:id,speechSeconds:5},selected,checksum,verified:false,pinned:false,candidates:[],
      ...(selected?{manualReview:{version:1,status:'pending',provider:'pexels',kind:selected.kind,candidateId:selected.id,checksum:checksum!,
        mediaPath:selected.localPath!,narration:`speech ${id}`,reason:'check manually'}}:{})}};
}
const project=(scenes:Scene[])=>({aspectRatio:'16:9',scenes} as Project);

test('pending and verified files affect selection, excluded scenes and foreign provider IDs do not',()=>{
  const a=candidate('a'),b=candidate('b'),c=candidate('c'),first=scene('first',0,a),target=scene('target',1),last=scene('last',2,b);
  last.includeInAssembly=false;
  const p=project([first,target,last]);
  assert.ok(documentaryManualReviewReady(first));
  assert.deepEqual(preferUnusedDocumentaryCandidates(p,target,[a,c,b]).map(item=>item.id),['c','b','a']);
  assert.equal(documentaryCandidateUses(p,target,{...a,provider:'pixabay',downloadUrl:'different',localPath:'different'}).length,0);
  first.documentary!.verified=true;first.documentary!.manualReview=undefined;
  assert.equal(documentaryCandidateUses(p,target,a).length,1);
});

test('fallback keeps adequate duration and matching framing before diversity',()=>{
  const used=candidate('used','video'),portrait={...candidate('portrait','video'),width:900,height:1600},short={...candidate('short','video'),durationSeconds:2};
  const target=scene('target',1),p=project([scene('used',0,used),target]);
  assert.deepEqual(preferUnusedDocumentaryCandidates(p,target,[portrait,short,used],true).map(item=>item.id),['used','portrait','short']);
  const fresh={...candidate('fresh','video'),width:1440,height:1080};
  assert.equal(preferUnusedDocumentaryCandidates(p,target,[used,fresh],true)[0]!.id,'fresh');
});

test('checksum aliases and local catalog hashes refer to the same material',()=>{
  const checksum='a'.repeat(64),first=scene('first',0,candidate('a'),checksum),target=scene('target',1),p=project([first,target]);
  assert.equal(documentaryCandidateUses(p,target,candidate('alias'),checksum).length,1);
  assert.equal(documentaryCandidateUses(p,target,{...candidate('catalog'),id:`local:${checksum}`}).length,1);
  assert.equal(documentaryCandidateUses(p,target,{...candidate('path'),localPath:`D:\\Media\\${checksum}.png`}).length,1);
});

test('fallback video uses disjoint source seconds, including playback rate and pending donors',()=>{
  const source=candidate('video','video'),first=scene('first',0,source),target=scene('target',1,source);
  first.playbackRate=2;target.playbackRate=1.5;
  const before=structuredClone(first),p=project([first,target]);
  assert.deepEqual(documentaryFallbackVideoRange(p,target),{trimStartSeconds:10,trimEndSeconds:17.5});
  assert.deepEqual(first,before);
});

test('video excerpts compare original coordinates and respect explicit shorter trims',()=>{
  const source=candidate('original','video'),first=scene('first',0,source,'source-hash');first.trimStartSeconds=10;first.trimEndSeconds=13;
  first.documentary!.verified=true;first.documentary!.pinned=true;
  const excerpt={...candidate('excerpt','video'),durationSeconds:15,excerpt:{sourceChecksum:'source-hash',startSeconds:10,endSeconds:25,sourceDurationSeconds:30}};
  const target=scene('target',1,excerpt,'excerpt-hash');
  assert.deepEqual(documentaryFallbackVideoRange(project([first,target]),target),{trimStartSeconds:3,trimEndSeconds:8});
});

test('short or exhausted pools still return a bounded playable interval',()=>{
  const source={...candidate('short','video'),durationSeconds:8},first=scene('first',0,source),target=scene('target',1,source);
  assert.deepEqual(documentaryFallbackVideoRange(project([first,target]),target),{trimStartSeconds:3,trimEndSeconds:8});
  source.durationSeconds=2;
  assert.deepEqual(documentaryFallbackVideoRange(project([first,target]),target),{trimStartSeconds:0,trimEndSeconds:2});
});

test('automatic fallback prefers a free continuation of verified footage over its unrelated opening',()=>{
  const source={...candidate('tour','video'),durationSeconds:53.34};
  const first=scene('first',0,source),last=scene('last',1,source),target=scene('target',2,source);
  first.trimStartSeconds=6.233;first.trimEndSeconds=11.233;first.documentary!.verified=true;
  last.trimStartSeconds=11.233;last.trimEndSeconds=16.233;last.documentary!.verified=true;
  const p=project([first,last,target]),before=structuredClone(p);
  assert.deepEqual(documentaryFallbackVideoRange(p,target),{trimStartSeconds:0,trimEndSeconds:5},'Manual/default allocation stays unchanged');
  assert.deepEqual(documentaryFallbackVideoRange(p,target,true),{trimStartSeconds:16.233,trimEndSeconds:21.233});
  assert.deepEqual(p,before,'A range hint must not transfer approval or alter existing assignments');
  assert.equal(target.documentary!.verified,false);
});

test('automatic fallback excludes proven rejected source intervals and rejects depletion before another review',()=>{
  const originalHash='a'.repeat(64),localHash='b'.repeat(64);
  const source={...candidate('excerpt','video'),durationSeconds:15,
    excerpt:{sourceChecksum:originalHash,startSeconds:10,endSeconds:25,sourceDurationSeconds:60}};
  const target=scene('target',0,source,localHash),p=project([target]);
  target.documentary!.searchRecovery={rejectedRanges:[
    {checksum:originalHash,start:10,end:15},
    {checksum:localHash,start:5,end:10},
    {checksum:'unrelated',start:10,end:15}
  ]} as NonNullable<NonNullable<Scene['documentary']>['searchRecovery']>;
  assert.deepEqual(documentaryFallbackVideoRange(p,target,true),{trimStartSeconds:10,trimEndSeconds:15});
  target.documentary!.searchRecovery.rejectedRanges.push({checksum:'other-excerpt',sourceId:source.id,start:0,end:5,sourceStart:20,sourceEnd:25});
  assert.throws(()=>documentaryFallbackVideoRange(p,target,true),/не осталось свободного/);
  assert.equal(target.documentary!.verified,false);
});

test('automatic fallback never substitutes an overlapping or too-short interval for a missing full shot',()=>{
  const source={...candidate('short','video'),durationSeconds:6.53},first=scene('first',0,source),target=scene('target',1,source);
  first.trimEndSeconds=4.8;first.documentary!.verified=true;
  target.documentary!.timing!.durationInFrames=66;
  assert.throws(()=>documentaryFallbackVideoRange(project([first,target]),target,true),/не осталось свободного/);
  source.durationSeconds=2;
  assert.throws(()=>documentaryFallbackVideoRange(project([target]),target,true),/нет полного отрезка/);
});

async function fallbackFixture(t:test.TestContext,count:number,kind:'image'|'video',sources:DocumentaryCandidate[],hash=(source:DocumentaryCandidate)=>source.id){
  const root=await mkdtemp(join(tmpdir(),'gws-allocation-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
  let p=await projects.create({title:'Allocation',topic:'Cars',mediaMode:'stock',mode:'standard',language:'English',aspectRatio:'16:9'});
  p.videoBrief={...p.videoBrief!,creationMode:'script',readyScript:'The cars enter the factory.'};
  const base=prepareDocumentaryScript(p,createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:'The cars enter the factory.',audioDurationSeconds:5}))[0]!;
  p.settings.voice.enabled=false;p.settings.stockVideoPercent=kind==='video'?100:0;
  const scenes=Array.from({length:count},(_,order)=>{
    const s=structuredClone(base);s.id=`scene-${order}`;s.order=order;s.durationSeconds=5;s.audioPath=`saved-voice-${order}.wav`;
    s.documentary!.timing={...s.documentary!.timing!,durationInFrames:150};
    s.documentary!.selectionPlan={kind,videoPercent:p.settings.stockVideoPercent};s.documentary!.requirement.queries=['car factory'];return s;
  });
  p=await projects.mutate(p.id,()=>({scenes,settings:p.settings,status:'generating'}));
  const stats={searches:0,attempts:0};
  const service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,'projects')),
    {search:async()=>{stats.searches++;return {candidates:sources,sources:[]};}} as unknown as DocumentarySearch,join(root,'materials'),
    {download:async()=>{throw Error('Unexpected network');}},()=>{},
    {simpleSelection:true,available:async()=>true,plan:async()=>{throw Error('Paid planning forbidden');},inspect:async()=>{throw Error('Paid inspection forbidden');}});
  const boundary=service as unknown as {apply:(id:string,sceneId:string,source:DocumentaryCandidate)=>Promise<Project>};
  boundary.apply=async(id,sceneId,source)=>{
    stats.attempts++;const checksum=hash(source);const path=join(root,`${checksum}.${kind==='image'?'png':'mp4'}`);await writeFile(path,checksum);
    const current=(await projects.get(id))!;
    return {...current,scenes:current.scenes.map(s=>s.id===sceneId?{...s,imagePath:path,videoPath:kind==='video'?path:undefined,
      documentary:{...s.documentary!,selected:{...source,localPath:path},checksum}}:s)};
  };
  return {projects,p,service,stats,boundary};
}

test('fallback rotates unused matching photos, then completes a sparse pool and resumes without work',async t=>{
  const f=await fallbackFixture(t,4,'image',[candidate('a'),candidate('b'),candidate('c')]);
  const result=await f.service.completeWithNativeFallback(f.p.id);
  assert.deepEqual(result.scenes.map(s=>s.documentary!.selected!.id),['a','b','c','a']);
  assert.ok(result.scenes.every(s=>documentaryManualReviewReady(s)));
  assert.deepEqual(result.scenes.map(s=>[s.narration,s.audioPath]),f.p.scenes.map(s=>[s.narration,s.audioPath]));
  assert.deepEqual(f.stats,{searches:4,attempts:4});
  await f.service.completeWithNativeFallback(f.p.id);assert.deepEqual(f.stats,{searches:4,attempts:4});
});

test('fallback persists successive video intervals without another candidate or paid review',async t=>{
  const f=await fallbackFixture(t,3,'video',[candidate('a','video')]);
  const result=await f.service.completeWithNativeFallback(f.p.id);
  assert.deepEqual(result.scenes.map(s=>[s.trimStartSeconds,s.trimEndSeconds]),[[0,5],[5,10],[10,15]]);
  assert.ok(result.scenes.every(s=>documentaryManualReviewReady(s)));assert.deepEqual(f.stats,{searches:3,attempts:3});
});

test('downloaded checksum aliases try the next candidate inside the existing limit',async t=>{
  const f=await fallbackFixture(t,2,'image',[candidate('a'),candidate('alias'),candidate('fresh')],source=>source.id==='alias'?'a':source.id);
  const result=await f.service.completeWithNativeFallback(f.p.id);
  assert.deepEqual(result.scenes.map(s=>s.documentary!.selected!.id),['a','fresh']);
  assert.deepEqual(f.stats,{searches:2,attempts:3});
});

test('completed fallback and manually pinned scenes are not silently reallocated',async t=>{
  const f=await fallbackFixture(t,2,'image',[candidate('a')]);
  const ready=await f.service.completeWithNativeFallback(f.p.id);
  ready.scenes[0]!.documentary!.verified=true;ready.scenes[0]!.documentary!.pinned=true;
  ready.scenes[0]!.documentary!.manualReview=undefined;
  const saved=await f.projects.mutate(f.p.id,()=>({scenes:ready.scenes}));
  const result=await f.service.completeWithNativeFallback(f.p.id);
  assert.deepEqual(result.scenes,saved.scenes);assert.deepEqual(f.stats,{searches:2,attempts:2});
});

test('a usable duplicate survives failed alternative preparations within three attempts',async t=>{
  const f=await fallbackFixture(t,2,'image',[candidate('a'),candidate('alias'),candidate('broken')],source=>source.id==='alias'?'a':source.id);
  const apply=f.boundary.apply;
  f.boundary.apply=async(...args)=>{if(args[2].id==='broken'){f.stats.attempts++;throw Error('broken media');}return apply(...args);};
  const result=await f.service.completeWithNativeFallback(f.p.id);
  assert.ok(result.scenes.every(s=>documentaryManualReviewReady(s)));
  assert.equal(result.scenes[1]!.documentary!.checksum,'a');assert.ok(f.stats.attempts<=4);
});
