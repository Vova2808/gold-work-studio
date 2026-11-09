import assert from 'node:assert/strict';
import test from 'node:test';
import type {Project,Scene,DocumentaryRequirement,AutoStockSelectionResult,AutoStockSelectionOptions} from '@gold-work/shared';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {DocumentaryPlanIncompleteError} from './documentary-intelligence.js';
import {DocumentaryAnalysisError} from './documentary-analysis-error.js';
import {createDefaultProjectSettings,createDocumentarySettings} from '@gold-work/shared';

function fixture(count=300){
  const scenes=Array.from({length:count},(_,order)=>({id:`scene-${order}`,order,narration:`Car ${order}.`,includeInAssembly:true,
    documentary:{verified:false,pinned:false,requirement:{text:`Car ${order}.`,plannedBy:order===2?'literal':'semantic',queries:['car'],entities:['car'],years:[]}}})) as unknown as Scene[];
  let project={id:'p',scenes,status:'draft',videoBrief:{readyScript:'Cars.'}} as unknown as Project;
  let writes=0;
  const projects={get:async()=>project,mutate:async(_id:string,change:(p:Project)=>Partial<Project>)=>{writes++;project={...project,...change(project)};return project;}};
  const service=new DocumentaryProjectService(projects as never,{} as never,{} as never,'',{} as never);
  const target=service as unknown as {planSearch:()=>Promise<Project>;selectAll:(id:string,options:AutoStockSelectionOptions)=>Promise<AutoStockSelectionResult>};
  const entry=target.selectAll.bind(service);
  const completed=new Map(scenes.filter(scene=>scene.id!=='scene-2').map(scene=>[scene.id,scene.documentary!.requirement]));
  target.planSearch=async()=>{throw new DocumentaryPlanIncompleteError(completed,['scene-2']);};
  return {target,entry,project:()=>project,writes:()=>writes,completed};
}

test('incomplete planning selects the saved 299-scene scope and reports the excluded scene without approving it',async()=>{
  const f=fixture();let reached=0;
  f.target.selectAll=async(_id,options)=>{
    reached++;assert.equal(options.sceneIds?.length,299);assert.ok(!options.sceneIds?.includes('scene-2'));
    assert.equal(f.project().scenes[2]!.documentary!.verified,false);
    assert.match(f.project().scenes[2]!.documentary!.autoError!,/невалидный ответ/);
    return {project:f.project(),total:299,selected:0,skipped:0,failed:0,failures:[]};
  };
  const result=await f.entry('p',{});
  assert.equal(reached,1);assert.equal(result.total,300);assert.equal(result.failed,1);
  assert.deepEqual(result.failures.map(row=>row.sceneId),['scene-2']);
  assert.equal(result.project.scenes[2]!.documentary!.requirement.plannedBy,'literal');
});

test('a subset stays scoped and unknown planning failures never enter partial selection',async()=>{
  const f=fixture(6);let reached=0;
  f.target.selectAll=async(_id,options)=>{reached++;assert.deepEqual(options.sceneIds,['scene-1']);return {project:f.project(),total:1,selected:0,skipped:0,failed:0,failures:[]};};
  const result=await f.entry('p',{sceneIds:['scene-1','scene-2']});
  assert.equal(result.total,2);assert.equal(reached,1);
  assert.equal(f.project().scenes[0]!.documentary!.autoError,undefined);
  const before=f.writes();
  f.target.planSearch=async()=>{throw new DocumentaryAnalysisError('Unknown pending output','pending','search-plan');};
  await assert.rejects(f.entry('p',{}),/Unknown pending/);
  assert.equal(reached,1);assert.equal(f.writes(),before);
});

test('an entirely exhausted scope makes no selection call and remains failed',async()=>{
  const f=fixture(3);
  f.target.planSearch=async()=>{throw new DocumentaryPlanIncompleteError(new Map<string,DocumentaryRequirement>(),['scene-2']);};
  f.target.selectAll=async()=>{throw new Error('Selection must not run');};
  const result=await f.entry('p',{sceneIds:['scene-2']});
  assert.equal(result.total,1);assert.equal(result.selected,0);assert.equal(result.failed,1);
});

test('script, narration, manual pin and inclusion edits during planning block partial recovery',async()=>{
  for(const edit of [
    (p:Project)=>{p.videoBrief!.readyScript='Edited script.';},
    (p:Project)=>{p.scenes[2]!.narration='Edited scene.';},
    (p:Project)=>{p.scenes[2]!.documentary!.pinned=true;},
    (p:Project)=>{p.scenes[2]!.includeInAssembly=false;}
  ]){
    const f=fixture(6);
    f.target.planSearch=async()=>{edit(f.project());throw new DocumentaryPlanIncompleteError(f.completed,['scene-2']);};
    f.target.selectAll=async()=>{throw new Error('Selection must not run');};
    await assert.rejects(f.entry('p',{}),/Проект изменился/);
    assert.equal(f.writes(),0);assert.equal(f.project().scenes[2]!.documentary!.autoError,undefined);
  }
});

test('typed incomplete output from the requirements phase reaches the same guarded selection boundary',async()=>{
  const f=fixture(6);
  const core=f.target as unknown as {selectPrepared:()=>Promise<AutoStockSelectionResult>};
  core.selectPrepared=async()=>{throw new DocumentaryPlanIncompleteError(f.completed,['scene-2']);};
  f.target.selectAll=async(_id,options)=>{
    assert.deepEqual(options.sceneIds,['scene-0','scene-1','scene-3','scene-4','scene-5']);
    return {project:f.project(),total:5,selected:0,skipped:0,failed:0,failures:[]};
  };
  const result=await f.entry('p',{});
  assert.equal(result.total,6);assert.equal(result.failed,1);
});

test('real planSearch binds a stale incomplete failure to its original requirement and preserves a new approval',async()=>{
  const f=fixture(3);
  f.project().mediaMode='stock';f.project().settings=createDefaultProjectSettings();
  f.project().settings.assembly.documentary=createDocumentarySettings();
  const core=f.target as unknown as {intelligence:{plan:()=>Promise<Map<string,DocumentaryRequirement>>}};
  core.intelligence={plan:async()=>{
    const doc=f.project().scenes[2]!.documentary!;
    doc.requirement={...doc.requirement,plannedBy:'semantic',queries:['new user query']};doc.verified=true;
    throw new DocumentaryPlanIncompleteError(f.completed,['scene-2']);
  }};
  (f.target as unknown as {storage:{projectDirectory:()=>string}}).storage={projectDirectory:()=>'/nonexistent-incomplete-plan-test'};
  f.target.planSearch=()=>DocumentaryProjectService.prototype.planSearch.call(f.target as unknown as DocumentaryProjectService,'p');
  f.target.selectAll=async()=>{throw new Error('Partial selection must not run');};
  await assert.rejects(f.entry('p',{}),/Проект изменился/);
  const updated=f.project().scenes[2]!.documentary!;
  assert.deepEqual(updated.requirement.queries,['new user query']);assert.equal(updated.verified,true);assert.equal(updated.autoError,undefined);
});

test('stage input stays bound through catch reload and the atomic downgrade callback',async()=>{
  for(const gap of ['reload','mutation']){
    const f=fixture(3);
    f.project().mediaMode='stock';f.project().settings=createDefaultProjectSettings();
    f.project().settings.assembly.documentary=createDocumentarySettings();
    const core=f.target as unknown as {intelligence:{plan:()=>Promise<Map<string,DocumentaryRequirement>>};storage:{projectDirectory:()=>string};
      projects:{get:()=>Promise<Project>;mutate:(id:string,change:(p:Project)=>Partial<Project>)=>Promise<Project>}};
    core.storage={projectDirectory:()=>'/nonexistent-incomplete-plan-test'};
    core.intelligence={plan:async()=>{throw new DocumentaryPlanIncompleteError(f.completed,['scene-2']);}};
    f.target.planSearch=()=>DocumentaryProjectService.prototype.planSearch.call(f.target as unknown as DocumentaryProjectService,'p');
    const approve=()=>{const doc=f.project().scenes[2]!.documentary!;doc.requirement={...doc.requirement,plannedBy:'semantic',queries:['new user query']};doc.verified=true;};
    const get=core.projects.get,mutate=core.projects.mutate;let gets=0,writes=0;
    core.projects.get=async()=>{gets++;if(gap==='reload'&&gets===4)approve();return get();};
    core.projects.mutate=async(id,change)=>{writes++;if(gap==='mutation'&&writes===2)approve();return mutate(id,change);};
    f.target.selectAll=async()=>{throw new Error('Partial selection must not run');};
    await assert.rejects(f.entry('p',{}),/Проект изменился/);
    const doc=f.project().scenes[2]!.documentary!;
    assert.deepEqual(doc.requirement.queries,['new user query']);assert.equal(doc.verified,true);assert.equal(doc.autoError,undefined);
  }
});
