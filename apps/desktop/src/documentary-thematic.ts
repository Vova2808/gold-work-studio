import type {DocumentaryRequirement, Scene} from '@gold-work/shared';
import {documentaryThematicReserveIssue} from '@gold-work/shared';

/** A script-only plan; this never approves a candidate or changes narration. */
export function documentaryThematicRequirement(scene:Scene,value:unknown):DocumentaryRequirement|undefined {
  if(documentaryThematicReserveIssue(scene.documentary?.requirement.aiSearchPlan))return;
  if(!value||typeof value!=='object'||Array.isArray(value)||!scene.documentary)return;
  const row=value as Record<string,unknown>;
  if(row.id!==scene.id||row.scriptText!==scene.narration||typeof row.subject!=='string'
    ||! /^[a-zA-Z][a-zA-Z -]{2,79}$/.test(row.subject)||!Array.isArray(row.queries)
    ||row.queries.length<1||row.queries.length>3
    ||row.queries.some(q=>typeof q!=='string'||q.trim().length<3||q.length>90||/https?:|www\./i.test(q)))return;
  const original=scene.documentary.requirement.literalRequirement??scene.documentary.requirement;
  return {...original,literalRequirement:original,visualScope:'illustrative',visualScopeVersion:3,
    visualScopeQuote:scene.narration,illustrationQuery:row.subject,entities:[],identities:[],years:[],detail:undefined,
    identityContextVersion:3,plannedBy:'semantic',queries:row.queries as string[],searchRefined:undefined,
    narrativeEntities:original.entities,narrativeIdentities:original.identities,narrativeYears:original.years,
    narrativeDetail:original.detail,narrativeQueries:original.queries,
    scriptRequirements:{version:1,mode:'thematic',scriptText:scene.narration,
      checks:[{id:'theme',kind:'object',scriptQuote:scene.narration,required:row.subject}],nonVisual:[]}};
}

/** Completed pixel evidence can contradict its own broad topic approval. */
export function documentaryRepresentationIssue(script:string,review:unknown):string|undefined {
  if(!review||typeof review!=='object'||Array.isArray(review))return;
  const representation=/\b(?:toys?|lego|miniature|scale model|plastic (?:tracks?|rails?))\b|игруш\p{L}*|макет\p{L}*|миниатюр\p{L}*/iu;
  if(representation.test(script))return;
  const row=review as Record<string,unknown>;
  const evidence=[row.reason,...(Array.isArray((row.scriptEvidence as {checks?:unknown[]}|undefined)?.checks)
    ?(row.scriptEvidence as {checks:unknown[]}).checks.map(check=>check&&typeof check==='object'?(check as {evidence?:unknown}).evidence:undefined):[])];
  if(evidence.some(text=>{
    if(typeof text!=='string')return false;
    const match=representation.exec(text);
    return Boolean(match&&!/\b(?:no|not)(?:\s+(?:a|an|any))?\s*$|\bне\s*$/iu.test(text.slice(0,match.index)));
  }))
    return 'Кадры показывают игрушку или миниатюрный макет вместо настоящего предмета сценария. Нужна съёмка реального объекта; тематический режим не разрешает такую подмену.';
}

export const documentaryThematicReviewInstruction=' The user explicitly selected THEMATIC B-ROLL mode. The frozen object check is a TOPIC LABEL: match its broad concrete subject category. Even if the label contains an action, weather or spatial modifier, those are optional search hints in this mode. The original narration is preserved as context, NOT a demand to reenact its action, weather, date, named identity or spatial relation. Judge topic relevance and real filmed content from the actual pixels; do not assert that this generic illustration proves the narrated event or action. Match the actual physical subject category: filmed toys, LEGO, miniature/scale models and replicas do NOT illustrate real transport, people or machinery unless the original script explicitly discusses those representations. Real camera footage of a toy is still the WRONG SUBJECT. Describe the physical subject and scale in pixel evidence before deciding the topic match. No temporal action proof is required for a thematic object check. Use requiredEra:"none". Keep all technical quality and camera-footage checks. Still answer the frozen theme check with concrete pixel evidence; unrelated footage must fail.';
