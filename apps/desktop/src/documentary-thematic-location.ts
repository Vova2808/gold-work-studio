import type {DocumentaryAiSearchPlan,Scene} from '@gold-work/shared';
import {documentaryRequiredLocation} from './documentary-location-review.js';

const normalized=(value:string)=>value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const contains=(text:string,name:string)=>` ${normalized(text)} `.includes(` ${normalized(name)} `);

/** Preserve only an explicit current place identity, never geography inherited
 * from another sentence or the historical context of a different subject. */
function mandatoryPlace(scene:Scene,ai:DocumentaryAiSearchPlan):string|undefined {
  const doc=scene.documentary;if(!doc)return;
  const primary={...scene,documentary:{...doc,requirement:{...doc.requirement,footageFallback:undefined}}};
  const place=documentaryRequiredLocation(primary);
  const identities=[ai.subject,...(doc.requirement.identities??[]).flatMap(id=>[id.name,...id.aliases])];
  return place&&contains(scene.narration,place)&&identities.some(id=>contains(id,place))?place:undefined;
}

export function documentaryGeographicReservePlan(scene:Scene,ai:DocumentaryAiSearchPlan):DocumentaryAiSearchPlan {
  const place=mandatoryPlace(scene,ai);if(!place)return ai;
  // Do not flatten an authored OR or guess which branch owns a place. Retain
  // the complete primary task and its queries when a safe projection is unclear.
  if(/\bor\b/iu.test(ai.visualTarget)||/\bor\b/iu.test(ai.fallbackVisualTarget))
    return {...ai,fallbackVisualTarget:ai.visualTarget,fallbackVideoQueries:[...ai.videoQueries]};
  return {...ai,fallbackVisualTarget:contains(ai.fallbackVisualTarget,place)?ai.fallbackVisualTarget
    :`(${ai.fallbackVisualTarget}) at ${place}; a modern view of the same place is allowed, not a recording of the historical event`,
    fallbackVideoQueries:ai.fallbackVideoQueries.map(query=>contains(query,place)?query:`${place} ${query}`)};
}

export function documentaryGeographicReserveIssue(scene:Scene):string|undefined {
  const req=scene.documentary?.requirement,ai=req?.aiSearchPlan,fallback=req?.footageFallback;
  if(!ai||!fallback?.automaticRecovery||!mandatoryPlace(scene,ai))return;
  const expected=documentaryGeographicReservePlan(scene,ai);
  if(fallback.target!==expected.fallbackVisualTarget||JSON.stringify(fallback.queries)!==JSON.stringify(expected.fallbackVideoQueries))
    return 'Тематический резерв не сохраняет обязательное место текущей реплики и исходной задачи. Прежнее одобрение не подтверждает нужную географию; материал и оплаченный ответ сохранены.';
}
