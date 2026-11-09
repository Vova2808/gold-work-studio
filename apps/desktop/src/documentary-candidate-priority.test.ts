import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {ProjectService,MemoryProjectRepository,MockDirectorProvider} from '@gold-work/core';
import type {DocumentaryAiSearchPlan,DocumentaryCandidate} from '@gold-work/shared';
import {documentaryAiPlanContext} from './documentary-ai-plan-state.js';
import {prepareDocumentaryScript} from './documentary-plan.js';
import {documentaryCandidatePriorityScore,documentarySimpleCandidatePriority,selectSimpleDocumentaryCandidates,type DocumentaryCandidatePriority} from './documentary-project-service.js';

type Row={number:number;narration:string;plan:Omit<DocumentaryAiSearchPlan,'version'|'inputHash'|'model'>;
  finalShortlistIds:string[];candidates:DocumentaryCandidate[]};
const fixture=JSON.parse(await readFile(new URL('./fixtures/short04-candidate-priority.json',import.meta.url),'utf8')) as {scenes:Row[]};
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const candidate=(id:string,title:string,query='retrieval only'):DocumentaryCandidate=>({id,title,query,description:'',
  provider:'local',kind:'image',rights:'user-confirmed',pageUrl:'',downloadUrl:'',previewUrl:'',author:'',attribution:'',license:'',licenseUrl:'',retrievedAt:'fixture',match:'unverified',concerns:[]});

async function projectFor(row:Row){
  const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
  const project=await projects.create({title:'Cutty Sark',topic:'Historic clipper',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
  project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:row.narration};
  project.scenes=prepareDocumentaryScript(project).slice(0,1);
  const scene=project.scenes[0]!;
  scene.documentary!.requirement={text:scene.narration,queries:[...row.plan.videoQueries,...row.plan.imageQueries],entities:[row.plan.subject],
    identities:[{name:row.plan.subject,aliases:[]}],detail:row.plan.visualTarget,years:row.plan.years,preferredKind:row.plan.preferredKind,
    aiSearchPlan:{...row.plan,version:1,model:'fixture',inputHash:''}};
  scene.documentary!.requirement.aiSearchPlan!.inputHash=hash({inputHash:hash({version:1,model:'fixture',context:documentaryAiPlanContext(project)}),sceneId:scene.id});
  return {project,scene};
}

for(const number of [2,6])test(`actual short04 scene ${number}: Commons subject-only query cannot manufacture a perfect active-task score`,async()=>{
  const row=fixture.scenes.find(row=>row.number===number)!,{project,scene}=await projectFor(row);
  const priority=documentarySimpleCandidatePriority(project,scene,'image');
  const pool=row.candidates.filter(c=>row.finalShortlistIds.includes(c.id));
  const commons=pool.find(c=>c.provider==='commons')!;
  assert.equal(commons.query,'"Cutty Sark"');
  assert.equal(selectSimpleDocumentaryCandidates(pool)[0]!.provider,'commons');
  const score=documentaryCandidatePriorityScore(commons,priority);
  assert.ok(score>0&&score<1,`Active query constraints disappeared: ${score}`);
  // Retrieval provenance changes cannot change relevance to the active task.
  assert.equal(documentaryCandidatePriorityScore({...commons,query:row.plan.imageQueries[0]!},priority),score);
  const changed=selectSimpleDocumentaryCandidates(pool,priority);
  assert.deepEqual(changed.map(c=>c.id).sort(),pool.map(c=>c.id).sort());
  assert.equal(commons.query,'"Cutty Sark"');
  console.log(`short04 #${number}: first ${selectSimpleDocumentaryCandidates(pool)[0]!.id} -> ${changed[0]!.id}; Commons active score ${score.toFixed(3)}`);
});

test('actual short04 scene5: steamship captions precede the hat, including Victorian inside subject',async()=>{
  const row=fixture.scenes.find(row=>row.number===5)!,{project,scene}=await projectFor(row);
  const priority=documentarySimpleCandidatePriority(project,scene,'image');
  // The first photo (50445) has already been rejected when both pools are ready.
  const pool=row.candidates.filter(c=>row.finalShortlistIds.includes(c.id));
  assert.equal(selectSimpleDocumentaryCandidates(pool)[0]!.id,'pixabay:947146');
  for(const subjects of [priority.subjects,['Victorian steamship']]){
    const task={...priority,subjects},ranked=selectSimpleDocumentaryCandidates(pool,task);
    const hat=ranked.findIndex(c=>c.id==='pixabay:947146');
    const ships=['pexels:9402089','pexels:35719426','pexels:39398627','pexels:30809853'];
    for(const id of ships)assert.ok(ranked.findIndex(c=>c.id===id)<hat,id);
    assert.equal(hat,4);
    assert.deepEqual(ranked.map(c=>c.id).sort(),pool.map(c=>c.id).sort());
    console.log(`short04 #5 subject=${subjects.join(' / ')}: hat 1 -> ${hat+1}; first=${ranked[0]!.id}; scores ship=${documentaryCandidatePriorityScore(ranked[0]!,task).toFixed(3)} hat=${documentaryCandidatePriorityScore(ranked[hat]!,task).toFixed(3)}`);
  }
});

test('OR queries, alternative queries, quoted names and dates retain their independent evidence',()=>{
  const task:DocumentaryCandidatePriority={queries:['"Cutty Sark" sailing OR "Thermopylae" sailing'],visualTarget:'clipper sailing',subjects:['Cutty Sark','Thermopylae']};
  const cutty=candidate('cutty','Cutty Sark sailing'),thermo=candidate('thermo','Thermopylae sailing');
  assert.equal(documentaryCandidatePriorityScore(cutty,task),1);
  assert.equal(documentaryCandidatePriorityScore(thermo,task),1);
  assert.equal(documentaryCandidatePriorityScore(thermo,{...task,queries:['Cutty Sark sailing','Thermopylae sailing']}),1);
  const grouped={queries:['Cutty Sark (launch OR sailing) 1869'],visualTarget:'Cutty Sark 1869',subjects:['Cutty Sark']};
  assert.equal(documentaryCandidatePriorityScore(candidate('group','Cutty Sark sailing 1869'),grouped),1);
  assert.ok(documentaryCandidatePriorityScore(candidate('missing-date','Cutty Sark sailing'),grouped)<1);
  assert.ok(documentaryCandidatePriorityScore(candidate('missing-name','sailing 1869'),grouped)<1);
  const literal={queries:['"War OR Peace" poster'],visualTarget:'War OR Peace poster',subjects:['War OR Peace']};
  assert.equal(documentaryCandidatePriorityScore(candidate('literal','War OR Peace poster'),literal),1);
  assert.ok(documentaryCandidatePriorityScore(candidate('partial','War poster'),literal)<1);
  const dated={queries:['Cutty Sark launch 1869'],visualTarget:'Cutty Sark launch',subjects:['Cutty Sark']};
  assert.deepEqual(selectSimpleDocumentaryCandidates([candidate('wrong','Cutty Sark launch 1870'),candidate('right','Cutty Sark launch 1869')],dated).map(c=>c.id),['right','wrong']);
  const named={queries:['Airbus A320 aircraft'],visualTarget:'Airbus A320',subjects:['Airbus A320']};
  assert.deepEqual(selectSimpleDocumentaryCandidates([candidate('brand','Airbus aircraft'),candidate('model','Airbus A320 aircraft')],named).map(c=>c.id),['model','brand']);
});

test('sparse and period-only metadata stay available; repeated tags and retrieval query do not inflate priority',()=>{
  const task={queries:['Victorian steamship archival photograph'],visualTarget:'Victorian steamship at sea',subjects:['Victorian steamship']};
  const sparse=candidate('sparse',''),period=candidate('period','Victorian photograph'),ship=candidate('ship','steamship');
  const ranked=selectSimpleDocumentaryCandidates([sparse,period,ship],task);
  assert.deepEqual(ranked.map(c=>c.id),['ship','period','sparse']);
  assert.equal(documentaryCandidatePriorityScore({...ship,title:'steamship '.repeat(20),query:'steamship'},task),documentaryCandidatePriorityScore(ship,task));
  assert.equal(documentaryCandidatePriorityScore(sparse,task),0);
});

test('active thematic pass ranks its task and never inherits the primary identity or primary queries',async()=>{
  const row=fixture.scenes.find(row=>row.number===2)!,{project,scene}=await projectFor(row);
  const ai=scene.documentary!.requirement.aiSearchPlan!;
  scene.documentary!.requirement.footageFallback={version:1,target:ai.fallbackVisualTarget,queries:[...ai.fallbackVideoQueries],
    reason:'Primary pool exhausted',narration:scene.narration,originalTarget:ai.visualTarget};
  const task=documentarySimpleCandidatePriority(project,scene,'video');
  assert.deepEqual(task.subjects,[]);
  assert.deepEqual(task.queries,ai.fallbackVideoQueries);
  assert.equal(task.visualTarget,ai.fallbackVisualTarget);
  assert.deepEqual(documentarySimpleCandidatePriority(project,scene,'image').subjects,[], 'An unavailable thematic image query must not resurrect the primary identity');
  const named=candidate('primary','Cutty Sark dock Greenwich','"Cutty Sark"');
  const thematic=candidate('thematic','tall ship full sail ocean voyage historic',ai.fallbackVideoQueries[0]);
  assert.deepEqual(selectSimpleDocumentaryCandidates([named,thematic],task).map(c=>c.id),['thematic','primary']);
  assert.equal(documentaryCandidatePriorityScore(named,task),0);
});
