import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import type {AutoStockFailure,Project,Scene} from '@gold-work/shared';
import {documentarySelectionFailure,documentarySelectionFailureSummary} from './documentary-selection-failure.js';
import {DocumentaryBudgetExhausted} from './documentary-work-budget.js';
import {DocumentaryAnalysisError} from './documentary-analysis-error.js';
import {DocumentaryDownloadTimeoutError} from './documentary-download.js';
import {prepareDocumentaryProduction,DocumentarySelectionIncompleteError} from './documentary-production.js';

type Row={number:number;id:string;autoError:string;recordedRejection?:string;sourceErrors:string[];
  oldCategory:AutoStockFailure['category'];expectedCategory:AutoStockFailure['category']};
const fixture=JSON.parse(await readFile(new URL('./fixtures/full03-selection-failures.json',import.meta.url),'utf8')) as {failures:Row[]};
const sceneFor=(row:Row)=>({id:row.id,order:row.number-1,documentary:{autoError:row.autoError,searchError:row.sourceErrors.join('\n'),
  searchRecovery:row.recordedRejection?{reason:row.recordedRejection,queries:[],rejectedRanges:[]}:undefined}}) as Scene;
const counts=(rows:AutoStockFailure[])=>Object.fromEntries([...new Set(rows.map(f=>f.category))].map(category=>[category,rows.filter(f=>f.category===category).length]));

test('actual full03: 27 coarse provider failures become 14 content, 9 download, 3 provider and 1 analysis; four budgets gain their own diagnosis',()=>{
  const before=fixture.failures.map(row=>({sceneId:row.id,sceneNumber:row.number,category:row.oldCategory,message:row.autoError}));
  assert.deepEqual(counts(before),{'provider-temporary':27,unknown:4});
  const classified=fixture.failures.map(row=>{
    const scene=sceneFor(row),saved=structuredClone(scene);
    const failure=documentarySelectionFailure(scene,{sourceErrors:row.sourceErrors});
    assert.equal(failure.category,row.expectedCategory,`Scene ${row.number}`);
    assert.equal(failure.message,row.autoError);
    assert.deepEqual(scene,saved,'Diagnosis never edits saved evidence or paid checkpoints');
    return failure;
  });
  assert.deepEqual(counts(classified),{download:9,analysis:1,'content-rejected':14,'budget-exhausted':4,'provider-temporary':3});
});

test('final materials-gate summary reclassifies old coarse results from saved terminal evidence',()=>{
  const scenes=fixture.failures.map(sceneFor);
  const old=fixture.failures.map(row=>({sceneId:row.id,sceneNumber:row.number,category:row.oldCategory,message:'Earlier source outage'}));
  const summary=documentarySelectionFailureSummary(scenes,old);
  assert.match(summary,/содержимому: 14/);
  assert.match(summary,/окна скачивания: 9/);
  assert.match(summary,/очереди проверки: 4/);
  assert.match(summary,/материала не завершена: 1/);
  assert.match(summary,/недоступность источников: 3/);
  assert.doesNotMatch(summary,/27|продолжите.*восстановления лимитов/);
  assert.equal(documentarySelectionFailureSummary(scenes,[...old,...old]),summary,'One scene is counted once');
});

test('typed local-budget, analysis and download errors take priority over background source outages',()=>{
  const scene=sceneFor(fixture.failures[0]!);
  for(const [error,category] of [
    [new DocumentaryBudgetExhausted('Fixture queue budget'),'budget-exhausted'],
    [new DocumentaryAnalysisError('Fixture analysis HTTP 429','pending'),'analysis'],
    [new DocumentaryAnalysisError('Анализ материала не завершён: HTTP 503','unavailable','single-visual-target',false,true),'analysis'],
    [new DocumentaryDownloadTimeoutError('Fixture transfer deadline'),'download'],
  ] as const){
    assert.equal(documentarySelectionFailure(scene,{message:error.message,error,sourceErrors:['pixabay: HTTP 429']}).category,category);
  }
});

test('a completed content refusal remains a content refusal even when its wording mentions unavailability',()=>{
  const scene=sceneFor(fixture.failures.find(row=>row.expectedCategory==='content-rejected')!);
  scene.documentary!.autoError='Required subject is not available in the shown frames';
  scene.documentary!.searchRecovery!.reason=scene.documentary!.autoError;
  assert.equal(documentarySelectionFailure(scene,{sourceErrors:['commons: HTTP 429']}).category,'content-rejected');
});

test('a real source outage without terminal content/budget evidence remains provider-temporary',()=>{
  const scene={id:'empty',order:0,documentary:{searchError:'pixabay: HTTP 429'}} as Scene;
  assert.equal(documentarySelectionFailure(scene).category,'provider-temporary');
  assert.equal(documentarySelectionFailure({...scene,documentary:{...scene.documentary!,searchError:undefined}}).category,'no-results');
});

test('the final summary excludes already-ready scenes and separately reported manual checks',()=>{
  const row=fixture.failures.find(row=>row.expectedCategory==='provider-temporary')!,scene=sceneFor(row);
  const failure=documentarySelectionFailure(scene);
  assert.equal(documentarySelectionFailureSummary([], [failure]),'');
  scene.documentary!.manualReview={analysis:{status:'pending'}} as NonNullable<Scene['documentary']>['manualReview'];
  assert.equal(documentarySelectionFailureSummary([scene],[failure]),'');
});

test('the real materials gate reports the saved full03 causes and still stops before quota or montage',async()=>{
  const scenes=fixture.failures.map(sceneFor),project={id:'full03-diagnosis',scenes} as Project;
  const failures=fixture.failures.map(row=>({sceneId:row.id,sceneNumber:row.number,category:row.oldCategory,message:'Earlier source outage'}));
  await assert.rejects(prepareDocumentaryProduction(project.id,{
    projects:{get:async()=>project,update:async()=>project},signal:new AbortController().signal,startNarration:async()=>async()=>{},
    documentary:{planSearch:async()=>project,autoSelect:async()=>({project,total:31,selected:0,skipped:0,failed:31,failures}),
      automaticVideoQuotaRequired:true,completeWithVideoQuota:async()=>assert.fail('Materials gate must stop quota submissions'),
      prepareMontage:async()=>assert.fail('Materials gate must stop montage')},
  }),error=>error instanceof DocumentarySelectionIncompleteError&&/для 31 сцен/.test(error.message)
    &&/содержимому: 14/.test(error.message)&&/очереди проверки: 4/.test(error.message)&&/недоступность источников: 3/.test(error.message));
});
