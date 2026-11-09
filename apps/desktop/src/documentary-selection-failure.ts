import type {AutoStockFailure,Scene} from '@gold-work/shared';
import {DocumentaryAnalysisError} from './documentary-analysis-error.js';
import {DocumentaryDownloadTimeoutError} from './documentary-download.js';
import {documentarySearchUnavailable} from './documentary-search.js';
import {DocumentaryBudgetExhausted} from './documentary-work-budget.js';

/** A final scene failure is distinct from outages of other discovery lanes. */
export function documentarySelectionFailure(scene:Scene,options:{message?:string;error?:unknown;sourceErrors?:string[];fallbackCategory?:AutoStockFailure['category']}={}):AutoStockFailure {
  const doc=scene.documentary;
  const message=options.message??doc?.autoError??(options.error instanceof Error?options.error.message:'Не найден материал с подтверждённым объектом, качеством и правами.');
  const rejected=doc?.searchRecovery?.reason===message||doc?.visualReview?.status==='rejected'&&doc.visualReview.reason===message;
  let category:AutoStockFailure['category'];
  if(options.error instanceof DocumentaryBudgetExhausted||/^(?:Исчерпан ограниченный бюджет|Не осталось достаточно времени для проверки|Ожидание очереди анализа превышает бюджет)/u.test(message))category='budget-exhausted';
  else if(rejected)category='content-rejected';
  else if(options.error instanceof DocumentaryAnalysisError||/^(?:Анализ материала не завершён|Сервис анализа|Принадлежность прежней незавершённой проверки)/u.test(message))category='analysis';
  else if(options.error instanceof DocumentaryDownloadTimeoutError||/^(?:Источник превысил время автоматической загрузки|Этот оригинал уже достиг лимита загрузки)/u.test(message))category='download';
  else if(documentarySearchUnavailable(message))category='provider-temporary';
  else category=options.fallbackCategory??((options.sourceErrors??doc?.searchError?.split('\n')??[]).some(documentarySearchUnavailable)?'provider-temporary':'no-results');
  return {sceneId:scene.id,sceneNumber:scene.order+1,category,message};
}

/** Reclassify persisted reasons too: older results may carry a coarse category. */
export function documentarySelectionFailureSummary(unfinished:Scene[],failures:AutoStockFailure[]=[]):string {
  const counts=new Map<AutoStockFailure['category'],number>();
  const seen=new Set<string>();
  for(const failure of failures){
    const scene=unfinished.find(s=>s.id===failure.sceneId&&s.order+1===failure.sceneNumber);
    if(!scene||scene.documentary?.manualReview||seen.has(scene.id))continue;
    seen.add(scene.id);
    const current=documentarySelectionFailure(scene,{message:scene.documentary?.autoError??failure.message,fallbackCategory:failure.category});
    counts.set(current.category,(counts.get(current.category)??0)+1);
  }
  const labels:Array<[AutoStockFailure['category'],string]>=[
    ['content-rejected','Материалы отклонены по содержимому'],
    ['download','Ошибка или исчерпание окна скачивания'],
    ['budget-exhausted','Исчерпан бюджет подбора или очереди проверки'],
    ['analysis','Проверка материала не завершена'],
    ['provider-temporary','Ограничения или недоступность источников'],
  ];
  return labels.filter(([category])=>counts.has(category)).map(([category,label])=>` ${label}: ${counts.get(category)}.`).join('');
}
