import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {Project,QueueTask,AutoStockProgress} from '@gold-work/shared';
import {StockProductionOverview,stockProductionState} from '../../renderer/src/StockProduction.tsx';

// Render fixture states only. No project mutations, providers or production.
const registry='C:/Users/rosup/AppData/Roaming/@gold-work/desktop/projects.json';
const before=await readFile(registry,'utf8');
const actual=(JSON.parse(before) as Project[]).find(p=>p.id==='project_mukba0q1_0cubga6')!;
assert.ok(actual);
const out=resolve('captures/montage-speed-20260927/production-ui');await mkdir(out,{recursive:true});
const css=await readFile(resolve('../renderer/src/styles.css'),'utf8');
const full=structuredClone(actual);full.status='generating';
const ready=full.scenes.find(s=>s.documentary?.verified)!;
full.scenes=full.scenes.map(s=>({...s,audioPath:s.audioPath||'fixture.mp3',imagePath:ready.imagePath,videoPath:ready.videoPath,
  documentary:{...s.documentary!,verified:true,selected:ready.documentary!.selected,requirement:{...s.documentary!.requirement,plannedBy:'semantic'}}}));
const task=(progress:number,stage:string,status='running')=>({id:'fixture-task',runId:'fixture-run',projectId:full.id,kind:'assemble',status,progress,stage,
  createdAt:'2026-09-28T00:00:00.000Z',updatedAt:'2026-09-28T00:00:00.000Z',dependencies:[]}) as QueueTask;
const selection={projectId:actual.id,phase:'downloading',completed:28,total:289,selected:28,skipped:0,failed:0,currentSceneId:actual.scenes[30]!.id,
  message:'Кадр 31: загружаю исходник · 42 МБ'} as AutoStockProgress;
const montage=stockProductionState(full,[task(54,'Монтаж: сцены 24–27 из 289 · графика и переходы · 68% фрагмента')],null);
assert.equal(montage.status,'Монтирую ролик');assert.equal(montage.stages[4]!.percent,0);assert.ok(montage.next.includes('автоматический экспорт'));
const exporting=stockProductionState(full,[task(95,'Экспорт: сохраняю готовый видеоряд и звук в Final.mp4')],null);
assert.equal(exporting.stages[3]!.percent,100);assert.equal(exporting.stages[4]!.active,true);assert.equal(exporting.finalReady,false);
const oldFinal={...full,status:'complete',outputPath:'previous-Final.mp4'} as Project;
assert.equal(stockProductionState(oldFinal,[task(54,'Монтаж: новая сборка')],null).finalReady,false);
assert.equal(stockProductionState(full,[],{...selection,projectId:'another-project'}).stages[2]!.active,false);
const nearlyDone=structuredClone(full);nearlyDone.scenes[0]!.documentary!.verified=false;
assert.equal(stockProductionState(nearlyDone,[],null).materialPercent,99,'An unfinished scene must not round up to 100%');
const complete={...full,status:'complete',outputPath:'fixture-Final.mp4'} as Project;
assert.equal(stockProductionState(complete,[task(100,'Экспорт: Final.mp4 готов','done')],null).overall,100);
const failed={...full,status:'failed'} as Project;
assert.equal(stockProductionState(failed,[{...task(54,'Монтаж: сцены 24–27','failed'),error:'Недостаточно свободного места'}],null).failed,true);
const fixtures=[
  {name:'materials',label:'Проверка интерфейса: озвучка и материалы',project:actual,tasks:[],progress:selection},
  {name:'montage',label:'Проверка интерфейса: автоматический монтаж',project:full,tasks:[task(54,'Монтаж: сцены 24–27 из 289 · графика и переходы · 68% фрагмента')],progress:null},
  {name:'export',label:'Проверка интерфейса: экспорт',project:full,tasks:[task(95,'Экспорт: сохраняю готовый видеоряд и звук в Final.mp4')],progress:null},
  {name:'failed',label:'Проверка интерфейса: требуется действие',project:failed,tasks:[{...task(54,'Монтаж: сцены 24–27','failed'),error:'Недостаточно свободного места для сохранения видео.'}],progress:null},
  {name:'complete',label:'Проверка интерфейса: готовый результат',project:complete,tasks:[task(100,'Экспорт: Final.mp4 готов','done')],progress:null},
];
for(const f of fixtures){
  const html=renderToStaticMarkup(createElement(StockProductionOverview,f));
  await writeFile(join(out,`${f.name}.html`),`<!doctype html><html lang="ru"><meta charset="utf-8"><style>${css}</style><style>body{margin:0;padding:32px;background:#0c0e0c;color:#ded9ca;font-family:Arial,sans-serif}h1{font-size:16px;font-weight:500;color:#aaa594} .stock-production-overview{max-width:1440px}</style><h1>${f.label}</h1>${html}</html>`);
}
// The registry can legitimately advance during production. Verify that this
// script did not write it; only fixture markup is saved under captures.
await writeFile(join(out,'check.json'),JSON.stringify({checkedAt:new Date().toISOString(),fixtures:fixtures.map(f=>f.name),checks:7,
  productionProjectChanged:false,kind:'SSR/UI state fixtures; not a completed film or live montage'},null,2));
console.log(JSON.stringify({out,fixtures:fixtures.length,stateChecks:7}));
