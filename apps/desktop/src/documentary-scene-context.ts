import type {Project,Scene} from '@gold-work/shared';

/** Editing slices are not independent stories. Preserve literal nearby script,
 * including flashbacks/comparisons, rather than copying the nearest year into
 * every requirement or inferring facts from a search result's title. */
export function documentarySceneContext(project:Project,scene:Scene) {
  const ordered=[...project.scenes].sort((a,b)=>a.order-b.order),index=ordered.findIndex(item=>item.id===scene.id);
  const line=(item:Scene)=>({scene:item.order+1,text:item.narration});
  const preceding=ordered.slice(0,Math.max(0,index-8));
  return {current:line(scene),
    preceding:index<0?[]:ordered.slice(Math.max(0,index-8),index).map(line),
    following:index<0?[]:ordered.slice(index+1,index+3).map(line),
    // An explanation can span many editing slices without repeating its year.
    // Retain original dated phrases, including comparisons, not a guessed
    // "nearest year" which would turn the 2004 season into the 1992 flashback.
    earlierTimeReferences:preceding.filter(item=>/\b(?:1[0-9]|20)\d{2}\b/.test(item.narration)).slice(-6).map(line)};
}
export type DocumentarySceneContext=ReturnType<typeof documentarySceneContext>;

/** A vetted plan can explicitly leave a self-contained editorial line without
 * a named subject or period. Nearby historical scenes do not date that line's
 * generic illustration. Pronouns/deictic references still inherit context. */
export function documentaryGeneralIllustration(scene:Scene):boolean {
  const requirement=scene.documentary?.requirement;
  if(requirement?.visualScope==='illustrative')return requirement.text===scene.narration&&requirement.identities?.length===0&&requirement.years.length===0
    &&Boolean(requirement.illustrationQuery?.trim()&&requirement.visualScopeQuote?.trim());
  return requirement?.identityContextVersion===3&&requirement.identities?.length===0
    &&requirement.years.length===0
    &&!/(?:\b(?:1[0-9]|20)\d{2}\b|\b(?:he|she|they|his|her|their|it|its|that day|that year|this event|the same|later that year)\b|\b(?:он|она|они|его|её|их|тот же|в тот день|в том году)\b)/iu.test(scene.narration);
}

/** A vetted illustrative slice carries its own visual brief. Earlier names
 * and dates remain in the story but are not requirements for this shot. */
export function documentaryVisualReviewContext(project:Project,scene:Scene):DocumentarySceneContext {
  if(scene.documentary?.requirement?.visualScope==='illustrative'&&documentaryGeneralIllustration(scene)
    &&!documentaryCallToActionIllustration(scene))
    return {current:{scene:scene.order+1,text:scene.narration},preceding:[],following:[],earlierTimeReferences:[]};
  return documentarySceneContext(project,scene);
}

/** A self-contained audience prompt needs an on-topic background, not footage
 * of someone operating the platform UI. Named people and dated events stay
 * under their normal exact-evidence rules. */
export function documentaryCallToActionIllustration(scene:Scene):boolean {
  return documentaryGeneralIllustration(scene)
    && /\b(?:subscribe|hit (?:the )?bell|follow (?:this|the) channel|like (?:this|the) video)\b|подпиш\p{L}*|ставьте лайк/iu.test(scene.narration);
}

export const documentaryGeneralIllustrationInstruction=' This CURRENT editing slice is marked as a thematic illustration: its visual requirement has no named subject or period. A clean relevant stock view may support its general topic even when adjacent sentences discuss historical events. The visualTask/search phrase names the concrete visible TOPIC or ACTION required in this shot, but not exact model, year, numerical statistic or historical identity. Check the actual frames against that topic: a landscape from a nature documentary does not show film editing, and an unrelated legal dispute does not illustrate a racing contract. For an abstract specification or comparison, confirm the broad visible subject category (for example a real motorcycle for a motorcycle power comparison); do not demand the exact engine type, displacement, percentage, racing subtype or a visible measurement. A literal action or explicitly required visible component still needs to appear. For this slice use requiredEra:"none" and assess the actual visible topic, action, technical quality and rights. Do not claim a generic or modern shot depicts an earlier named person, model or event; do not apply this exception to any other scene.';

export const documentaryContinuityInstruction=' Narrative continuity: narrativeContext contains the exact current editing slice and nearby ORIGINAL script, in order. Resolve pronouns, current event/season and the actual person from this script BEFORE looking at candidate/source metadata. A historical comparison (e.g. first title since 1992) does not replace the currently narrated 2004 season. A source labelled 2015 cannot illustrate an actual 2004 race merely because the same racer appears. Upload/publication date alone is not capture date: distinguish them. Do not inherit a date across an explicit flashback or subject change. Preserve required named identities; a colleague, opponent or generic person cannot substitute. For a literal part/action require that detail itself; whole-vehicle views may illustrate abstract specifications but not exposed internals. A sentence about an engineer speaking is not illustrated by an unrelated racing rider just because both work for the same brand. Source metadata and generated search hints must never overwrite the original story.';
export const documentaryContinuityEvidenceInstruction=' In EACH actual-frame review, additionally return narrativeEvidence:{subjectMatch:boolean,eraMatch:boolean,detailMatch:boolean,requiredEra:string,observedEra:string,evidence:string}. Use eraMatch:true when the original script imposes no era, otherwise establish compatibility without inventing a year from generic appearance; explicit contradictory event/year is false. State if a general illustrative view is justified by an abstract statement. Missing/ambiguous mandatory identity, era or literal detail must be false and status uncertain/rejected. Evidence must explain the current scene, not repeat the source title. Do not assert unsampled footage was checked.';

export const documentaryLegacyEraProvenanceInstruction=' Era provenance: when the original script requires a period/event, narrativeEvidence.requiredEra must name that period (include the year when known), and additionally return narrativeEvidence.eraEvidenceQuote: an EXACT contiguous quotation from source.title, source.description or source.date establishing the depicted event/object period, or an exact year supplied in sourceEraReferences. These references contain only literal years from the source fields; they do not establish visible identity. Museum/photo upload date alone does not establish the age of the depicted object; a dated model description may. Sponsor colours, generic styling, rider number or a familiar brand cannot establish an exact season. Never derive the source era from the target narration. If no such source evidence exists, eraMatch:false, eraEvidenceQuote:"" and status:uncertain, even when the same rider/model is recognizable. For truly era-independent narration use requiredEra:"none" and explain why no particular period is claimed. Do not invent or alter a quotation to pass validation.';

export const documentaryEraProvenanceInstruction = documentaryLegacyEraProvenanceInstruction
  .replace('source.title, source.description or source.date', 'source.title or source.description')
  + ' The legacy source.date field can be a publication or file date: it is not verified capture provenance and must never establish the depicted era by itself.';

/** Source-blind identity checks receive literal dates, never a suggested name. */
export function documentarySourceEraReferences(source:Record<string,unknown>|undefined,includeLegacyDate=false) {
  return Object.fromEntries(['title','description','date'].map(field=>[field,(field!=='date'||includeLegacyDate)&&typeof source?.[field]==='string'?[...new Set((source[field] as string).match(/\b(?:1[0-9]|20)\d{2}\b/g)??[])]:[]]));
}

export function documentaryNarrativeEvidenceIssue(review:Record<string,unknown>,source?:Record<string,unknown>,context?:DocumentarySceneContext):string|undefined {
  const evidence=review.narrativeEvidence as Record<string,unknown>|undefined;
  if(!evidence||evidence.subjectMatch!==true||evidence.eraMatch!==true||evidence.detailMatch!==true||typeof evidence.evidence!=='string'||evidence.evidence.trim().length<12)
    return `Не подтверждено соответствие человеку, эпохе и детали текущей сцены. ${typeof evidence?.evidence==='string'?evidence.evidence:typeof review.reason==='string'?review.reason:''}`;
  const requiredEra=evidence.requiredEra;
  if(typeof requiredEra!=='string'||!requiredEra.trim())return 'Не указано, требует ли исходная сцена определённую эпоху; материал не подтверждён.';
  if(requiredEra.toLowerCase()==='none')return;
  const quote=typeof evidence.eraEvidenceQuote==='string'?evidence.eraEvidenceQuote.trim():'';
  // Legacy capturedAt mixes capture, upload and file timestamps across
  // providers. A coinciding upload year cannot date the depicted event.
  const sourceFields=[source?.title,source?.description].filter((field):field is string=>typeof field==='string');
  const years=requiredEra.match(/\b(?:1[0-9]|20)\d{2}\b/g)??[];
  if(context&&years.length){
    const scriptYears=new Set([context.current,...context.preceding,...context.following,...context.earlierTimeReferences]
      .flatMap(line=>line.text.match(/\b(?:1[0-9]|20)\d{2}\b/g)??[]));
    if(scriptYears.size&&years.some(year=>!scriptYears.has(year)))return `Требуемая эпоха «${requiredEra}» взята не из исходного сценария; данные найденного источника не могут менять время рассказа.`;
  }
  if(quote.length<4||!sourceFields.some(field=>field.includes(quote))||years.length>0&&!years.some(year=>quote.includes(year)))
    return `Эпоха «${requiredEra}» не подтверждена исходными данными источника. Узнаваемый человек, номер или окраска не доказывают год события.`;
}
