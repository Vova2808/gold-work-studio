import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import type {AutoStockFailure,DocumentaryCandidate} from '@gold-work/shared';
import {prepareDocumentaryScript} from './documentary-plan.js';
import {applyDocumentaryNativeFallback} from './documentary-native-fallback.js';
import {documentaryMissingSelectedMaterialMessage} from './documentary-auto-readiness.js';
import {prepareDocumentaryProduction,DocumentarySelectionIncompleteError} from './documentary-production.js';

async function fixture(t:test.TestContext){
  const root=await mkdtemp(join(tmpdir(),'gws-production-policy-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const file=join(root,'related-photo.jpg');await writeFile(file,'nonempty local material fixture');
  const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
  let project=await projects.create({title:'Harbour',topic:'Harbour',mediaMode:'stock',mode:'standard',language:'English',aspectRatio:'16:9'});
  project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:'The harbour changed over time.'};
  project.scenes=prepareDocumentaryScript(project).slice(0,1);
  const scene=project.scenes[0]!;
  scene.audioPath='retained-paid-narration.wav';scene.documentary!.caption.enabled=false;
  scene.documentary!.autoError='Bounded primary search found no suitable material.';
  project.settings.stockVideoPercent=100;
  // Missing serialized policy must use the same default as a new project.
  delete project.settings.assembly.documentary!.missingMaterialPolicy;
  delete project.settings.assembly.documentary!.videoQuotaPolicy;
  project=await projects.update(project.id,project);
  const calls={related:0,cards:0,quota:0,montage:0};
  const get=async()=>(await projects.get(project.id))!;
  const acceptPhoto=async(related=false)=>projects.mutate(project.id,current=>({scenes:current.scenes.map(item=>({...item,imagePath:file,
    documentary:{...item.documentary!,verified:true,illustrative:true,autoError:undefined,
      selected:{id:'related-photo',kind:'image',provider:'local',rights:'user-confirmed',title:'Harbour',description:'Harbour view'} as DocumentaryCandidate,
      requirement:{...item.documentary!.requirement,...(related?{footageFallback:{version:1 as const,target:'harbour',queries:['harbour'],
        narration:item.narration,originalTarget:'historic harbour',reason:'Primary search exhausted'}}:{})},
      reviewNote:related?'Тематическая иллюстрация; не архив конкретного события.':''}}))}));
  let failures:AutoStockFailure[]=[];
  const documentary={automaticVideoQuotaRequired:true,
    planSearch:async()=>get(),
    autoSelect:async()=>({project:await get(),total:1,selected:0,skipped:0,failed:failures.length,failures}),
    completeWithRelatedMaterials:async()=>{calls.related++;return acceptPhoto(true);},
    completeWithFreeCards:async()=>{calls.cards++;return projects.mutate(project.id,current=>({scenes:current.scenes.map(item=>applyDocumentaryNativeFallback(current,item))}));},
    completeWithVideoQuota:async()=>{calls.quota++;return get();},
    prepareMontage:async()=>{calls.montage++;return get();}};
  const options={projects,documentary,signal:new AbortController().signal,startNarration:async()=>async()=>{}};
  const policy=async(missingMaterialPolicy:'related'|'card'|'hold',videoQuotaPolicy:'target'|'strict'='target')=>projects.mutate(project.id,current=>({
    settings:{...current.settings,assembly:{...current.settings.assembly,documentary:{...current.settings.assembly.documentary!,missingMaterialPolicy,videoQuotaPolicy}}}}));
  return {project,projects,get,acceptPhoto,calls,documentary,options,policy,setFailures:(value:AutoStockFailure[])=>{failures=value;}};
}

test('default related policy fills a scene with labelled thematic footage and reports it without a card',async t=>{
  const f=await fixture(t),result=await prepareDocumentaryProduction(f.project.id,f.options);
  assert.deepEqual(f.calls,{related:1,cards:0,quota:0,montage:1});
  const scene=result.project.scenes[0]!,report=result.project.settings.assembly.documentary!.productionReport!;
  assert.equal(scene.documentary!.selected!.id,'related-photo');assert.equal(scene.documentary!.nativeFallback,undefined);
  assert.equal(scene.audioPath,'retained-paid-narration.wav');
  assert.match(scene.documentary!.reviewNote,/Тематическая иллюстрация/);
  assert.match(report.message,/Тематические иллюстрации: №1/);
  assert.deepEqual(report.placeholderScenes,[]);assert.equal(report.targetVideoPercent,100);assert.equal(report.videoPercent,0);
});

test('explicit card policy creates a local placeholder and reports its scene number',async t=>{
  const f=await fixture(t);await f.policy('card');
  const result=await prepareDocumentaryProduction(f.project.id,f.options);
  assert.deepEqual(f.calls,{related:0,cards:1,quota:0,montage:1});
  assert.ok(result.project.scenes[0]!.documentary!.nativeFallback);
  const report=result.project.settings.assembly.documentary!.productionReport!;
  assert.deepEqual(report.placeholderScenes,[1]);assert.match(report.message,/Бесплатные карточки: №1/);
});

test('target quota permits export preparation below 100 percent; strict quota holds the same ready photo',async t=>{
  const f=await fixture(t);await f.acceptPhoto();
  const target=await prepareDocumentaryProduction(f.project.id,f.options);
  assert.equal(target.project.settings.stockVideoPercent,100);
  assert.deepEqual(f.calls,{related:0,cards:0,quota:0,montage:1});
  await f.policy('related','strict');
  await assert.rejects(prepareDocumentaryProduction(f.project.id,f.options),error=>error instanceof DocumentarySelectionIncompleteError
    &&error.recoverable&&/0.0%.*100%/.test(error.message));
  assert.deepEqual(f.calls,{related:0,cards:0,quota:1,montage:1});
  assert.equal((await f.get()).scenes[0]!.documentary!.selected!.id,'related-photo');
});

test('related replacement of a missing saved file removes the obsolete missing-file failure',async t=>{
  const f=await fixture(t);await f.projects.mutate(f.project.id,current=>({scenes:current.scenes.map(scene=>({...scene,
    imagePath:join(tmpdir(),'gws-never-present-old-image.jpg'),documentary:{...scene.documentary!,verified:true,
      selected:{id:'missing-old-photo',kind:'image',provider:'local',rights:'user-confirmed'} as DocumentaryCandidate}}))}));
  f.setFailures([{sceneId:f.project.scenes[0]!.id,sceneNumber:1,category:'download',message:documentaryMissingSelectedMaterialMessage}]);
  const result=await prepareDocumentaryProduction(f.project.id,f.options);
  assert.equal(result.project.scenes[0]!.documentary!.selected!.id,'related-photo');
  assert.deepEqual(f.calls,{related:1,cards:0,quota:0,montage:1});
});

test('hold policy and unresolved related selection cannot silently fall back to cards',async t=>{
  const f=await fixture(t);await f.policy('hold');
  await assert.rejects(prepareDocumentaryProduction(f.project.id,f.options),DocumentarySelectionIncompleteError);
  assert.deepEqual(f.calls,{related:0,cards:0,quota:0,montage:0});
  await f.policy('related');f.documentary.completeWithRelatedMaterials=async()=>{f.calls.related++;return f.get();};
  await assert.rejects(prepareDocumentaryProduction(f.project.id,f.options),DocumentarySelectionIncompleteError);
  assert.deepEqual(f.calls,{related:1,cards:0,quota:0,montage:0});
});
