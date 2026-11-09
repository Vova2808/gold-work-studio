import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {createDefaultProjectSettings, createDocumentarySettings, type Project, type Scene} from '@gold-work/shared';
import {DocumentaryAiQueryPlanner} from './documentary-ai-query-planner.js';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {DocumentarySearch} from './documentary-search.js';
import {LocalProjectStorage} from './local-project-storage.js';

test('planning status follows persisted partial-to-complete resume and reports the actual completed-answer failure', async t => {
  const root=await mkdtemp(join(tmpdir(),'gws-planning-status-'));
  assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const settings=createDefaultProjectSettings();
  settings.assembly.documentary=createDocumentarySettings();
  const scenes=['Cutty Sark sailed.', 'Tea clippers raced.'].map((narration,order)=>({
    id:`scene-${order}`,order,title:narration,narration,durationSeconds:5,status:'draft',imagePrompt:'',animationPrompt:'',
    documentary:{version:2,requirement:{text:narration,entities:[],years:[],queries:[]},candidates:[],verified:false,
      pinned:false,illustrative:false,reviewNote:'',layout:'full',effects:[],caption:{enabled:false,text:'',position:'bottom',
        animation:'fade',fontSize:48,color:'#ffffff',backgroundColor:'#000000',opacity:.7}},
  } as Scene));
  let project={id:'status-project',title:'Cutty Sark',topic:'Ships',language:'English',mediaMode:'stock',status:'ready',
    settings,scenes,videoBrief:{readyScript:scenes.map(scene=>scene.narration).join('')}} as Project;
  const planner=new DocumentaryAiQueryPlanner({documentaryQueryModel:async()=>'fixture-model',
    documentaryCompletion:async(_system:string,payload:string)=>JSON.stringify({scenes:JSON.parse(payload).requestedScenes.map(({sceneId}:{sceneId:string})=>({
      sceneId,subject:'Cutty Sark',visualTarget:'Cutty Sark at sea',years:[],visualScope:'exact',preferredKind:'image',
      imageQueries:['Cutty Sark'],videoQueries:[],fallbackVideoQueries:[],fallbackVisualTarget:'',
    }))})} as never,()=>join(root,'mock-planner'));
  const plans=await planner.plan(project,scenes);
  let complete=false,failStorage=false;
  const projects={get:async()=>structuredClone(project),mutate:async(_id:string,change:(p:Project)=>Partial<Project>)=>{
    project={...project,...change(structuredClone(project))};return structuredClone(project);
  }};
  const storage=new LocalProjectStorage(join(root,'projects'));
  const ensure=storage.ensureProject.bind(storage);
  storage.ensureProject=async current=>{if(failStorage)throw new Error('fixture storage failure');return ensure(current);};
  const messages:string[]=[];
  const reason='AI-план неполон для 1 сцен после 2 ответов. Готовые части сохранены; автоматические исправления исчерпаны.';
  const service=new DocumentaryProjectService(projects as never,storage,new DocumentarySearch(),join(root,'materials'),
    {download:async()=>{throw new Error('No transfer');}},event=>messages.push(event.message??''),undefined,undefined,undefined,
    {plan:async()=>{if(!complete)throw new Error(reason);return plans;},readCached:async()=>new Map([[scenes[0]!.id,plans.get(scenes[0]!.id)!]])});
  await assert.rejects(service.planSearch(project.id),error=>{
    assert.match(String(error),/исправления исчерпаны/);
    assert.match(String(error),/уже полученные результаты сохранены/i);
    assert.doesNotMatch(String(error),/озвучк|неопределён/i);
    return true;
  });
  const statusPath=join(storage.projectDirectory(project.id),'Documentary','Plans','ai-query-status.json');
  const partial=JSON.parse(await readFile(statusPath,'utf8'));
  assert.equal(partial.state,'partial');
  assert.deepEqual(partial.aiSceneIds,[scenes[0]!.id]);
  assert.deepEqual(partial.missingSceneIds,[scenes[1]!.id]);
  assert.ok(messages.some(message=>/исправления исчерпаны/.test(message)));
  assert.ok(messages.every(message=>!/озвучк|неопределён/i.test(message)));
  complete=true;failStorage=true;
  await assert.rejects(service.planSearch(project.id),/fixture storage failure/);
  assert.deepEqual(JSON.parse(await readFile(statusPath,'utf8')),partial,'Do not declare completion before project storage succeeds');
  failStorage=false;
  await service.planSearch(project.id);
  const final=JSON.parse(await readFile(statusPath,'utf8'));
  assert.equal(final.state,'complete');
  assert.deepEqual(final.aiSceneIds,scenes.map(scene=>scene.id));
  assert.deepEqual(final.missingSceneIds,[]);
  assert.equal(final.error,undefined);
});
