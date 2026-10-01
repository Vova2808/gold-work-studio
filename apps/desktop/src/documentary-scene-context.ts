import type {Project,Scene} from '@gold-work/shared';

/** Editing slices are not independent stories. Preserve literal nearby script,
 * including flashbacks/comparisons, rather than copying the nearest year into
 * every requirement or inferring facts from a search result's title. */
export function documentarySceneContext(project:Project,scene:Scene) {
  const ordered=[...project.scenes].sort((a,b)=>a.order-b.order),index=ordered.findIndex(item=>item.id===scene.id);
  const line=(item:Scene)=>({scene:item.order+1,text:item.narration});
  return {current:line(scene),
    preceding:index<0?[]:ordered.slice(Math.max(0,index-8),index).map(line),
    following:index<0?[]:ordered.slice(index+1,index+3).map(line)};
}
export type DocumentarySceneContext=ReturnType<typeof documentarySceneContext>;

export const documentaryContinuityInstruction=' Narrative continuity: narrativeContext contains the exact current editing slice and nearby ORIGINAL script, in order. Resolve pronouns, current event/season and the actual person from this script BEFORE looking at candidate/source metadata. A historical comparison (e.g. first title since 1992) does not replace the currently narrated 2004 season. A source labelled 2015 cannot illustrate an actual 2004 race merely because the same racer appears. Upload/publication date alone is not capture date: distinguish them. Do not inherit a date across an explicit flashback or subject change. Preserve required named identities; a colleague, opponent or generic person cannot substitute. For a literal part/action require that detail itself; whole-vehicle views may illustrate abstract specifications but not exposed internals. A sentence about an engineer speaking is not illustrated by an unrelated racing rider just because both work for the same brand. Source metadata and generated search hints must never overwrite the original story.';
export const documentaryContinuityEvidenceInstruction=' In EACH actual-frame review, additionally return narrativeEvidence:{subjectMatch:boolean,eraMatch:boolean,detailMatch:boolean,requiredEra:string,observedEra:string,evidence:string}. Use eraMatch:true when the original script imposes no era, otherwise establish compatibility without inventing a year from generic appearance; explicit contradictory event/year is false. State if a general illustrative view is justified by an abstract statement. Missing/ambiguous mandatory identity, era or literal detail must be false and status uncertain/rejected. Evidence must explain the current scene, not repeat the source title. Do not assert unsampled footage was checked.';

export const documentaryEraProvenanceInstruction=' Era provenance: when the original script requires a period/event, narrativeEvidence.requiredEra must name that period (include the year when known), and additionally return narrativeEvidence.eraEvidenceQuote: an EXACT contiguous quotation from source.title, source.description or source.date establishing the depicted event/object period, or an exact year supplied in sourceEraReferences. These references contain only literal years from the source fields; they do not establish visible identity. Museum/photo upload date alone does not establish the age of the depicted object; a dated model description may. Sponsor colours, generic styling, rider number or a familiar brand cannot establish an exact season. Never derive the source era from the target narration. If no such source evidence exists, eraMatch:false, eraEvidenceQuote:"" and status:uncertain, even when the same rider/model is recognizable. For truly era-independent narration use requiredEra:"none" and explain why no particular period is claimed. Do not invent or alter a quotation to pass validation.';

/** Source-blind identity checks receive literal dates, never a suggested name. */
export function documentarySourceEraReferences(source:Record<string,unknown>|undefined) {
  return Object.fromEntries(['title','description','date'].map(field=>[field,typeof source?.[field]==='string'?[...new Set((source[field] as string).match(/\b(?:1[0-9]|20)\d{2}\b/g)??[])]:[]]));
}

export function documentaryNarrativeEvidenceIssue(review:Record<string,unknown>,source?:Record<string,unknown>):string|undefined {
  const evidence=review.narrativeEvidence as Record<string,unknown>|undefined;
  if(!evidence||evidence.subjectMatch!==true||evidence.eraMatch!==true||evidence.detailMatch!==true||typeof evidence.evidence!=='string'||evidence.evidence.trim().length<12)
    return `Не подтверждено соответствие человеку, эпохе и детали текущей сцены. ${typeof evidence?.evidence==='string'?evidence.evidence:typeof review.reason==='string'?review.reason:''}`;
  const requiredEra=evidence.requiredEra;
  if(typeof requiredEra!=='string'||!requiredEra.trim())return 'Не указано, требует ли исходная сцена определённую эпоху; материал не подтверждён.';
  if(requiredEra.toLowerCase()==='none')return;
  const quote=typeof evidence.eraEvidenceQuote==='string'?evidence.eraEvidenceQuote.trim():'';
  const sourceFields=[source?.title,source?.description,source?.date].filter((field):field is string=>typeof field==='string');
  const years=requiredEra.match(/\b(?:1[0-9]|20)\d{2}\b/g)??[];
  if(quote.length<4||!sourceFields.some(field=>field.includes(quote))||years.length>0&&!years.some(year=>quote.includes(year)))
    return `Эпоха «${requiredEra}» не подтверждена исходными данными источника. Узнаваемый человек, номер или окраска не доказывают год события.`;
}
