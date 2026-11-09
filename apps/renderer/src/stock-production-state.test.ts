import test from 'node:test';
import assert from 'node:assert/strict';
import type {Project,QueueTask,AutoStockProgress} from '@gold-work/shared';
import {createDefaultProjectSettings,createDocumentarySettings,documentaryManualReviewReady} from '@gold-work/shared';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {StockMaterialQueue,stockProductionState} from './StockProduction';
import {documentaryMaterialReviewNote} from './documentary-material-review';

test('failed production stays a failure when cleanup cancelled unfinished voice tasks',()=>{
  const project={id:'p',status:'failed',settings:{voice:{enabled:true}},scenes:[
    {id:'a',documentary:{requirement:{plannedBy:'semantic'},verified:false}},
  ]} as unknown as Project;
  const tasks=[{id:'voice',projectId:'p',runId:'run',createdAt:'2026-10-10',kind:'speech',status:'cancelled'}] as QueueTask[];
  const state=stockProductionState(project,tasks,null);
  assert.equal(state.failed,true);assert.equal(state.stopped,false);assert.equal(state.finalReady,false);
  assert.equal(state.status,'Производство требует внимания');
});

test('a legacy complete progress event with missing scenes cannot report finished production',()=>{
  const project={id:'p',status:'ready',settings:{voice:{enabled:false}},scenes:[
    {id:'a',documentary:{requirement:{plannedBy:'semantic'},verified:false}},
  ]} as unknown as Project;
  const progress={projectId:'p',phase:'complete',failed:1,completed:1,total:1} as AutoStockProgress;
  const state=stockProductionState(project,[],progress);
  assert.equal(state.failed,true);assert.equal(state.ready.length,0);assert.equal(state.finalReady,false);
});

test('failure before queue creation does not blame the last completed scene or a nonexistent task',()=>{
 const project={id:'p',status:'failed',settings:{voice:{enabled:false}},scenes:[
  {id:'a',documentary:{requirement:{plannedBy:'semantic'},verified:false}},
 ]} as unknown as Project;
 const progress={projectId:'p',phase:'complete',failed:0,completed:54,total:54,
  currentSceneId:'last',currentSceneNumber:54,message:'Кадр 54: материал сохранён'} as AutoStockProgress;
 const state=stockProductionState(project,[],progress);
 assert.equal(state.failed,true);
 assert.match(state.next,/Собрать ролик/);
 assert.doesNotMatch(state.next,/задаче с ошибкой/);
 assert.doesNotMatch(state.operations.join(' '),/54|материал сохранён|задачу с ошибкой/);
});

test('an actual failed task retains its own error ahead of the last progress event',()=>{
 const project={id:'p',status:'failed',settings:{voice:{enabled:true}},scenes:[
  {id:'a',documentary:{requirement:{plannedBy:'semantic'},verified:false}},
 ]} as unknown as Project;
 const tasks=[{id:'voice',projectId:'p',runId:'run',createdAt:'2026-11-04',kind:'speech',status:'failed',error:'Озвучка требует внимания'}] as QueueTask[];
 assert.deepEqual(stockProductionState(project,tasks,null).operations,['Озвучка требует внимания']);
});

test('a full run shows script preparation before any queue task exists',()=>{
 const project={id:'p',status:'draft',settings:{voice:{enabled:true}},scenes:[],
  stockProduction:{phase:'script',status:'running',message:'Разбиваю исходный сценарий',updatedAt:'2026-11-06'}} as unknown as Project;
 const state=stockProductionState(project,[],null);
 assert.equal(state.status,'Подготавливаю сценарий');assert.equal(state.finalReady,false);assert.equal(state.overall,0);
 assert.deepEqual(state.operations,['Разбиваю исходный сценарий']);
 assert.match(state.next,/автоматического монтажа и экспорта/);
 assert.equal(state.stages[4]!.count,'Ожидает');
});

test('persisted preparation error is visible after restart without a queue or progress event',()=>{
 const project={id:'p',status:'failed',settings:{voice:{enabled:true}},scenes:[],
  stockProduction:{phase:'materials',status:'failed',message:'Неизвестный результат оплаченного запроса',updatedAt:'2026-11-06'}} as unknown as Project;
 const state=stockProductionState(project,[],null);
 assert.equal(state.failed,true);assert.deepEqual(state.operations,['Неизвестный результат оплаченного запроса']);
});

test('an interrupted full run cannot be shown as ready or idle',()=>{
 const project=finishedDocumentary(0,0);
 project.status='draft';project.stockProduction={phase:'materials',status:'interrupted',message:'Продолжите после перезапуска',updatedAt:'2026-11-06'};
 const state=stockProductionState(project,[],null);
 assert.equal(state.status,'Производство на паузе');assert.equal(state.finalReady,false);assert.ok(state.overall<100);
 assert.equal(state.next,project.stockProduction.message);
});

test('completed native cards count as visual scenes and do not leave selection running after export',()=>{
 const project={id:'p',status:'complete',outputPath:'real-final.mp4',settings:{voice:{enabled:true}},scenes:[
  {id:'a',narration:'Original narration',audioPath:'paid.wav',documentary:{verified:true,
   requirement:{text:'Original narration',queries:['subject'],fastPlanVersion:1},
   nativeFallback:{version:1,narration:'Original narration',reason:'HTTP 429'},
   motionGraphic:{enabled:true,kind:'quote',origin:'automatic',title:'Original narration',durationSeconds:4}}},
 ]} as unknown as Project;
 const state=stockProductionState(project,[],{projectId:'p',phase:'complete',failed:0,completed:1,total:1} as AutoStockProgress);
 assert.equal(state.ready.length,1);assert.equal(state.materialPercent,100);assert.equal(state.finalReady,true);assert.equal(state.failed,false);
});

function finishedDocumentary(videoCount:number,target=60):Project {
 const settings=createDefaultProjectSettings();
 settings.assembly.documentary=createDocumentarySettings();settings.stockVideoPercent=target;settings.voice.enabled=false;
 return {id:'p',mediaMode:'stock',status:'complete',outputPath:'saved-final.mp4',settings,
  scenes:Array.from({length:3},(_,order)=>({id:`scene-${order}`,order,narration:'Unchanged narration',durationSeconds:5,
   ...(order<videoCount?{videoPath:`video-${order}.mp4`}:{imagePath:`photo-${order}.jpg`}),
   documentary:{verified:true,requirement:{plannedBy:'semantic'},selected:{kind:order<videoCount?'video':'image',durationSeconds:5}}}))} as unknown as Project;
}

test('pending Pexels media permits completion without being labelled confirmed',()=>{
 const project=finishedDocumentary(0,0),scene=project.scenes[0]!,doc=scene.documentary!;
 doc.verified=false;doc.checksum='checksum';doc.selected={...doc.selected!,id:'pexels:1',provider:'pexels',localPath:scene.imagePath};
 doc.manualReview={version:1,status:'pending',provider:'pexels',kind:'image',candidateId:'pexels:1',checksum:'checksum',mediaPath:scene.imagePath!,narration:scene.narration,reason:'Exact footage unavailable'};
 const state=stockProductionState(project,[],{projectId:project.id,phase:'complete',failed:1} as AutoStockProgress);
 assert.equal(documentaryManualReviewReady(scene),true);assert.equal(doc.verified,false);
 assert.equal(state.ready.length,3);assert.equal(state.finalReady,true);assert.equal(state.failed,false);
});

test('a completed documentary respects a selected target below 60 percent',()=>{
 const state=stockProductionState(finishedDocumentary(1,20),[],null);
 assert.equal(state.finalReady,true);assert.equal(state.materialPercent,100);assert.equal(state.overall,100);
});

test('a legacy fallback shows the bound Pixabay review in the queue and timeline note, without changing the project',()=>{
 const project=finishedDocumentary(0,0),scene=project.scenes[0]!,doc=scene.documentary!;
 const old='Adelaide Central Market',reason='Museum view of Cutty Sark';
 doc.verified=false;doc.checksum='current-file';doc.selected={...doc.selected!,id:'pixabay:2383413',provider:'pixabay',localPath:scene.imagePath};
 doc.reviewNote=old;
 doc.manualReview={version:1,status:'pending',provider:'pixabay',kind:'image',candidateId:doc.selected.id,checksum:doc.checksum,
   mediaPath:scene.imagePath!,narration:scene.narration,reason:old,analysis:{status:'accepted',reason}};
 const before=JSON.stringify(project);
 const html=renderToStaticMarkup(createElement(StockMaterialQueue,{project,progress:null,onReview:()=>{}}));
 assert.match(html,/Pixabay API/);assert.match(html,/Museum view of Cutty Sark/);assert.doesNotMatch(html,/Adelaide|Pexels/);
 assert.equal(documentaryMaterialReviewNote(scene),`Проверить вручную. ${reason}`);
 assert.equal(JSON.stringify(project),before);
 doc.manualReview.candidateId='previous-file';
 assert.doesNotMatch(documentaryMaterialReviewNote(scene),/Cutty Sark|Adelaide/);
});

test('prepared documentary is ready for the editor without reporting an automatic export',()=>{
 const project=finishedDocumentary(1,20);project.status='ready';project.outputPath=undefined;
 const state=stockProductionState(project,[],null);
 assert.equal(state.finalReady,false);assert.equal(state.overall,100);
 assert.equal(state.status,'Монтаж готов к редактированию');
 assert.match(state.next,/нажмите «Экспорт»/);
 assert.equal(state.stages.find(stage=>stage.name==='Экспорт')?.active,false);
});

test('photo-only and video-only completed documentaries remain ready at selected endpoints',()=>{
 for(const [count,target] of [[0,0],[3,100]]) {
  const state=stockProductionState(finishedDocumentary(count!,target),[],null);
  assert.equal(state.finalReady,true);assert.equal(state.materialPercent,100);assert.equal(state.overall,100);
 }
});
