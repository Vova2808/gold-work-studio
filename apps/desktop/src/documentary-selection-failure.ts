import type {AutoStockFailure,Scene} from '@gold-work/shared';
import {DocumentaryAnalysisError} from './documentary-analysis-error.js';
import {DocumentaryDownloadTimeoutError} from './documentary-download.js';
import {documentarySearchUnavailable} from './documentary-search.js';
import {DocumentaryBudgetExhausted} from './documentary-work-budget.js';
import {documentaryMissingSelectedMaterialMessage} from './documentary-auto-readiness.js';

export function documentarySelectionNextAction(category:AutoStockFailure['category']):string {
  switch(category){
    case 'analysis':return 'Откройте «Видео и фото»: проверьте сохранённый кандидат вручную или выберите другой. Не повторяйте платный анализ с неизвестным результатом вслепую.';
    case 'content-rejected':return 'Выберите другой материал в «Видео и фото» или уточните поисковое задание, сохранив нужные объект, человека, событие и место.';
    case 'budget-exhausted':return 'Продолжите подбор этой сцены: сохранённые кандидаты проверяются первыми. Либо выберите материал вручную.';
    case 'download':case 'cdn':return 'Проверьте доступность исходного файла или выберите другой источник. Продолжайте только незавершённую сцену.';
    case 'provider-temporary':return 'Дождитесь восстановления указанного источника либо выберите доступный материал вручную; действующую паузу повторный запуск не снимает.';
    case 'invalid-key':return 'Проверьте настройки именно указанного сервиса, затем продолжите незавершённую сцену.';
    case 'no-results':return 'Проверьте сохранённых кандидатов и уточните запрос или выберите материал вручную. Неизменённые отказы автоматически не переоцениваются.';
    case 'unknown':return 'Откройте «Видео и фото» этой сцены и связанные события: причину нужно уточнить до повторения операции.';
  }
}

/** A final scene failure is distinct from outages of other discovery lanes. */
export function documentarySelectionFailure(scene:Scene,options:{message?:string;error?:unknown;sourceErrors?:string[];fallbackCategory?:AutoStockFailure['category']}={}):AutoStockFailure {
  const doc=scene.documentary;
  const message=options.message??doc?.autoError??(options.error instanceof Error?options.error.message:'Не найден материал с подтверждённым объектом, качеством и правами.');
  const rejected=doc?.searchRecovery?.reason===message||doc?.visualReview?.status==='rejected'&&doc.visualReview.reason===message;
  let category:AutoStockFailure['category'];
  if(options.error instanceof DocumentaryBudgetExhausted||/^(?:Исчерпан ограниченный бюджет|Не осталось достаточно времени для проверки|Ожидание очереди анализа превышает бюджет)/u.test(message))category='budget-exhausted';
  else if(options.error instanceof DocumentaryAnalysisError||/^(?:Анализ материала не завершён|Модель завершила визуальную проверку пустым ответом|Сервис анализа|Принадлежность прежней незавершённой проверки)/u.test(message))category='analysis';
  else if(options.error instanceof DocumentaryDownloadTimeoutError||/^(?:Источник превысил время автоматической загрузки|Этот оригинал уже достиг лимита загрузки)/u.test(message))category='download';
  else if(documentarySearchUnavailable(message))category='provider-temporary';
  else if(rejected||/^YouTube помечает видео как SD\./u.test(message))category='content-rejected';
  else category=options.fallbackCategory??((options.sourceErrors??doc?.searchError?.split('\n')??[]).some(documentarySearchUnavailable)?'provider-temporary':'no-results');
  return {sceneId:scene.id,sceneNumber:scene.order+1,category,message,nextAction:documentarySelectionNextAction(category)};
}

/** Every unfinished scene has one reason, including missing or legacy results. */
export function documentarySelectionFailures(unfinished:Scene[],failures:AutoStockFailure[]=[]):AutoStockFailure[] {
  return unfinished.map(scene=>{
    const failure=failures.find(item=>item.sceneId===scene.id&&item.sceneNumber===scene.order+1);
    const message=failure?.message===documentaryMissingSelectedMaterialMessage?failure.message
      :scene.documentary?.autoError??failure?.message
        ??(scene.documentary?.manualReview?'Материал сохранён для ручной проверки и ещё не принят.':undefined);
    return documentarySelectionFailure(scene,{message,fallbackCategory:failure?.category});
  });
}

/** Reclassify persisted reasons too: older results may carry a coarse category. */
export function documentarySelectionFailureSummary(unfinished:Scene[],failures:AutoStockFailure[]=[]):string {
  const counts=new Map<AutoStockFailure['category'],number>();
  for(const failure of documentarySelectionFailures(unfinished,failures))counts.set(failure.category,(counts.get(failure.category)??0)+1);
  const labels:Array<[AutoStockFailure['category'],string]>=[
    ['content-rejected','Материалы отклонены по содержимому или качеству'],
    ['download','Ошибка или исчерпание окна скачивания'],
    ['budget-exhausted','Исчерпан бюджет подбора или очереди проверки'],
    ['analysis','Проверка материала не завершена'],
    ['provider-temporary','Ограничения или недоступность источников'],
    ['no-results','Подходящий материал не найден'],
    ['cdn','Ошибка доступа к файлу источника'],
    ['invalid-key','Ошибка авторизации источника'],
    ['unknown','Причина требует уточнения'],
  ];
  return labels.filter(([category])=>counts.has(category)).map(([category,label])=>` ${label}: ${counts.get(category)}.`).join('');
}
