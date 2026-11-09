import type {Project,Scene} from '@gold-work/shared';
import {currentDocumentaryAiSearchPlan} from './documentary-ai-plan-state.js';

const normalized=(text:string)=>text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const contains=(text:string,name:string)=>` ${normalized(text)} `.includes(` ${normalized(name)} `);
// A planned subject may append a description after its proper name. Use only
// the name literally present in speech, never candidate titles or geography.
function nameOf(value:string):string|undefined {
  const word=String.raw`[\p{Lu}\d][\p{L}\p{N}.'’-]*`;
  const name=value.trim().match(new RegExp(`^${word}(?:\\s+(?:(?:of|the|de|la|van|von)\\s+)?${word})*`,'u'))?.[0];
  if(!name||name.length<3||/^(?:The|This|That|Ship|Sailing|Aircraft|Train|Portrait|Steamship|Generic|Representative)\b/u.test(name))return;
  return name.replace(/['’]s$/u,'');
}
function namesOf(scene:Scene):string[] {
  const req=scene.documentary?.requirement;
  return [...new Set([...(req?.identities??[]).flatMap(id=>[id.name,...id.aliases]),req?.aiSearchPlan?.subject??'']
    .map(nameOf).filter((name):name is string=>Boolean(name)))];
}
// Match the HEAD of a whole-object target. A map/route, weather, cargo or a
// close-up of a component does not inherit the surrounding object's identity.
function objectKind(target:string,name=''):number {
  let text=target.trim();
  if(name&&normalized(text).startsWith(normalized(name)))text=text.slice(name.length).replace(/^[\s,:-]+/u,'');
  text=text.replace(/^(?:a|an|the)\s+/iu,'');
  return [
    /^(?:(?:preserved|historic|historical|modern|sailing|clipper|three-masted|two-masted|passenger|cargo)\s+)*(?:ship|vessel|schooner|clipper|ocean liner)\b/iu,
    /^(?:(?:historic|modern|passenger|military|fighter|jet)\s+)*(?:aircraft|airplane|aeroplane)\b/iu,
    /^(?:(?:historic|steam|diesel|electric)\s+)*(?:train|locomotive)\b/iu,
    /^(?:(?:historic|racing|modern)\s+)*(?:motorcycle|motorbike)\b/iu,
    /^(?:(?:historic|racing|modern|passenger)\s+)*(?:car|automobile)\b/iu,
    /^(?:(?:historic|modern|suspension|railway|road)\s+)*bridge\b/iu,
    /^(?:portrait|scientist|physicist|person)\b/iu,
  ].findIndex(pattern=>pattern.test(text));
}

/** A deliberately narrow, source-blind repair for an unresolved singular
 * referent in a PRIMARY AI plan. Explicit thematic reserves retain their own
 * task. Ambiguous antecedents and non-object illustrations stay untouched. */
export function documentarySubjectContinuity(project:Project,scene:Scene) {
  const req=scene.documentary?.requirement,ai=currentDocumentaryAiSearchPlan(project,scene);
  if(!req||!ai||req.footageFallback)return;
  // Existing named tasks (including named details) keep their own contract.
  if(nameOf(ai.subject))return;
  const match=scene.narration.match(/\b(?:she|her|hers|he|him|his|it|its)\b|(?<!\p{L})(?:он|она|оно|его|её|ее|ему|ей)(?!\p{L})/iu);
  if(!match)return;
  const pronoun=match[0];
  // Neutral "it" after another clause may refer to that clause's new object.
  if(/^(?:it|its)$/iu.test(pronoun)&&scene.narration.slice(0,match.index).trim())return;
  if(/\b(?:another|different)\b/iu.test(scene.narration))return;
  const ordered=[...project.scenes].sort((a,b)=>a.order-b.order),index=ordered.findIndex(item=>item.id===scene.id),previous=ordered[index-1];
  if(!previous)return;
  const prior=currentDocumentaryAiSearchPlan(project,previous);
  if(!prior)return;
  // Comparison/coordination can give a singular pronoun several referents.
  if(/\b(?:and|or|versus|vs|against|alongside|with|beside|between)\b|(?<!\p{L})(?:и|или|между|против)(?!\p{L})/iu.test(previous.narration))return;
  const names=namesOf(previous).filter(name=>contains(previous.narration,name));
  const distinct=names.filter(name=>!names.some(other=>other!==name&&contains(other,name)));
  if(distinct.length!==1)return;
  const subject=distinct[0]!;
  // Require the immediately preceding clause to actually introduce the name.
  if(!normalized(previous.narration).startsWith(normalized(subject)))return;
  const kind=objectKind(prior.visualTarget,subject);
  if(kind<0||objectKind(ai.visualTarget,subject)!==kind)return;
  // A new explicit subject in this slice wins over the preceding pronoun.
  if(project.scenes.flatMap(namesOf).some(name=>!contains(subject,name)&&contains(scene.narration,name)))return;
  return {subject,antecedentSceneId:previous.id,antecedent:previous.narration,pronoun};
}

export function documentarySubjectContinuityIssue(required:ReturnType<typeof documentarySubjectContinuity>,identified:unknown):string|undefined {
  if(!required)return;
  if(typeof identified!=='string'||normalized(identified)!==normalized(required.subject))
    return `Просмотр не подтверждает тот же именованный предмет: ${required.subject}. Общее сходство по классу недостаточно.`;
}

/** Reuse already authored named queries; never manufacture a paid AI plan. */
export function documentarySubjectContinuityQueries(project:Project,scene:Scene,kind:'image'|'video'):string[]|undefined {
  const continuity=documentarySubjectContinuity(project,scene);
  if(!continuity)return;
  const prior=project.scenes.find(item=>item.id===continuity.antecedentSceneId)!.documentary!.requirement.aiSearchPlan!;
  const queries=(kind==='image'?prior.imageQueries:prior.videoQueries).filter(query=>contains(query,continuity.subject));
  return queries.length?queries:undefined;
}
