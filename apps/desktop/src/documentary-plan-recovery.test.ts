import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Project,Scene} from '@gold-work/shared';
import {recoverDocumentaryPlanContext,readDocumentaryContextRecovery} from './documentary-plan-recovery.js';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {createVoiceCalibration,type DocumentaryCandidate} from '@gold-work/shared';
import {prepareDocumentaryScript} from './documentary-plan.js';
import {DocumentarySearch} from './documentary-search.js';

const scene=(id:string)=>({id,order:0,narration:'Panels are painted. ',audioPath:'paid.wav',imagePath:'selected.jpg',documentary:{verified:true,pinned:false,
  checksum:'b'.repeat(64),candidates:[],requirement:{text:'Panels are painted. ',entities:['battery'],identities:[{name:'battery',aliases:[]}],identityContextVersion:3,
    queries:['battery'],detail:"View of battery for the original narration's continuing reference",years:[],plannedBy:'semantic'}}} as unknown as Scene);
const row=(id:string)=>({id,entities:[],identities:[],queries:['car factory painting'],detail:'Painting car body panels'});

test('planning restores paid semantic queries, preserves media, and never reads an unknown response as a plan',async t=>{
  const workspace=await mkdtemp(join(tmpdir(),'gws-context-recovery-'));t.after(()=>rm(workspace,{recursive:true,force:true}));
  const storage=new LocalProjectStorage(workspace),root=storage.projectDirectory('p'),analysis=join(root,'Documentary','Analysis');
  await mkdir(analysis,{recursive:true});
  await writeFile(join(analysis,`${'a'.repeat(64)}.json`),JSON.stringify({state:'complete',purpose:'search-plan',result:{scenes:[row('s')]}}));
  const pendingPath=join(analysis,`${'c'.repeat(64)}.json`),pending=JSON.stringify({state:'partial',purpose:'visual-overview',raw:'paid incomplete'});
  await writeFile(pendingPath,pending);
  const sourceDir=join(root,'Documentary','s');await mkdir(sourceDir,{recursive:true});
  await writeFile(join(sourceDir,`${'d'.repeat(64)}.source.json`),JSON.stringify({id:'old',downloadUrl:'https://example.test/old.jpg'}));
  let project={id:'p',status:'ready',mediaMode:'stock',settings:{assembly:{documentary:{version:2}}},scenes:[scene('s')]} as Project;
  const before=structuredClone(project.scenes[0]!);
  const projects={get:async()=>project,mutate:async(_id:string,change:(p:Project)=>Partial<Project>)=>project={...project,...change(project)}};
  const service=new DocumentaryProjectService(projects as never,storage,{} as never,'',{} as never);
  project=await service.planSearch('p');
  assert.deepEqual(project.scenes[0]!.documentary!.requirement.queries,['car factory painting']);
  assert.deepEqual(project.scenes[0]!.documentary!.requirement.identities,[]);
  assert.equal(project.scenes[0]!.documentary!.verified,false,'A review of the wrong subject is not approval of the corrected plan');
  assert.equal(project.scenes[0]!.audioPath,before.audioPath);assert.equal(project.scenes[0]!.imagePath,before.imagePath);
  assert.equal(await readFile(pendingPath,'utf8'),pending);
  const recovery=(await readDocumentaryContextRecovery(root)).scenes.s!;
  assert.deepEqual(recovery.previous,before.documentary!.requirement);
  assert.ok(recovery.checksums.includes('d'.repeat(64)));assert.ok(recovery.sourceKeys.includes('https://example.test/old.jpg'));
  assert.equal((await recoverDocumentaryPlanContext(project,root)).size,0,'Recovery is idempotent');
});

test('recovery preserves pins, edited queries, changed narration and ambiguous completed plans',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-context-edits-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const analysis=join(root,'Documentary','Analysis');await mkdir(analysis,{recursive:true});
  const scenes=['pinned','query','narration','ambiguous','partial'].map(scene);
  scenes[0]!.documentary!.pinned=true;scenes[1]!.documentary!.requirement.queries=['user query'];scenes[2]!.narration='User edit';
  await writeFile(join(analysis,`${'a'.repeat(64)}.json`),JSON.stringify({state:'complete',purpose:'search-plan',result:{scenes:scenes.slice(0,4).map(s=>row(s.id))}}));
  await writeFile(join(analysis,`${'b'.repeat(64)}.json`),JSON.stringify({state:'complete',purpose:'search-plan',result:{scenes:[{...row('ambiguous'),queries:['different completed plan']}]}}));
  await writeFile(join(analysis,`${'c'.repeat(64)}.json`),JSON.stringify({state:'partial',purpose:'search-plan',result:{scenes:[row('partial')]}}));
  const project={scenes} as Project,before=structuredClone(project);
  assert.equal((await recoverDocumentaryPlanContext(project,root)).size,0);assert.deepEqual(project,before);
});

test('a completed query refinement survives context recovery and is not purchased again',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-context-refined-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const analysis=join(root,'Documentary','Analysis');await mkdir(analysis,{recursive:true});
  const s=scene('s');s.documentary!.requirement.queries=['factory body paint robots'];s.documentary!.requirement.searchRefined=true;
  await writeFile(join(analysis,`${'a'.repeat(64)}.json`),JSON.stringify({state:'complete',purpose:'search-plan',result:{scenes:[row('s')]}}));
  await writeFile(join(analysis,`${'b'.repeat(64)}.json`),JSON.stringify({state:'complete',purpose:'search-refinement',result:{scenes:[{id:'s',queries:s.documentary!.requirement.queries}]}}));
  const restored=(await recoverDocumentaryPlanContext({scenes:[s]} as Project,root)).get('s')!.restored;
  assert.deepEqual(restored.queries,s.documentary!.requirement.queries);assert.equal(restored.searchRefined,true);assert.deepEqual(restored.identities,[]);
});

test('automatic selection protects old sources by URL and by bytes before visual submission',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-recovered-selection-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
  let project=await projects.create({title:'Car factory',topic:'Painting',mediaMode:'stock',mode:'standard',language:'English',aspectRatio:'16:9'});
  project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:'Panels are painted.'};
  project.settings.stockVideoPercent=0;
  project.scenes=prepareDocumentaryScript(project,createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:'A voice reads this short sentence.',audioDurationSeconds:3}));
  const target=project.scenes[0]!;
  target.audioPath='saved-paid.wav';
  target.documentary={...target.documentary!,requirement:{...target.documentary!.requirement,plannedBy:'semantic',identityContextVersion:3,entities:[],identities:[],queries:['car factory painting'],detail:'Painting panels',preferredKind:'image'}};
  project=await projects.update(project.id,project);
  const storage=new LocalProjectStorage(root),doc=join(storage.projectDirectory(project.id),'Documentary');await mkdir(doc,{recursive:true});
  const candidate={id:'old',provider:'local',kind:'image',title:'Car factory painting panels',description:'Car factory painting panels',localPath:'saved-original.png',downloadUrl:'https://example.test/old.png',width:1920,height:1080,license:'CC0',concerns:[],score:1} as unknown as DocumentaryCandidate;
  const searcher=new DocumentarySearch();searcher.search=async input=>({candidates:input.kind==='image'?[candidate]:[],sources:[]});
  let visualCalls=0,downloads=0;
  const service=new DocumentaryProjectService(projects,storage,searcher,join(root,'Materials'),{download:async()=>{throw new Error('No network');}},()=>{},{available:async()=>true,plan:async()=>{throw new Error('No new plan');},inspect:async()=>{visualCalls++;throw new Error('Must not submit old visual request');}});
  (service as unknown as {apply:()=>Promise<Project>}).apply=async()=>{downloads++;return {...project,scenes:project.scenes.map(s=>s.id===target.id?{...s,documentary:{...s.documentary!,selected:candidate,checksum:'a'.repeat(64)}}:s)};};
  for(const guard of ['url','bytes']){
    await writeFile(join(doc,'context-recovery.json'),JSON.stringify({version:1,scenes:{[target.id]:{previous:target.documentary.requirement,restored:target.documentary.requirement,sourceKeys:guard==='url'?[candidate.downloadUrl]:[],checksums:['a'.repeat(64)]}}}));
    const result=await service.autoSelect(project.id,{sceneIds:[target.id]});
    assert.equal(result.selected,0);assert.equal(visualCalls,0);
    assert.equal(downloads,guard==='url'?0:1);
    assert.equal(result.project.scenes[0]!.audioPath,'saved-paid.wav');
    assert.equal(result.project.scenes[0]!.documentary!.verified,false);
  }
});
