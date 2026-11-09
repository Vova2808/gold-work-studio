import type {DocumentaryRequirement,Project,Scene} from '@gold-work/shared';

/** Only a source-blind native plan can classify historical commentary. Never
 * reinterpret an existing frozen literal action/date from a candidate. */
export function documentaryHistoricalIllustration(value:unknown,text:string,requirements:DocumentaryRequirement['scriptRequirements'],identities:DocumentaryRequirement['identities']):DocumentaryRequirement['historicalIllustration'] {
  if(!value||typeof value!=='object'||Array.isArray(value)||!identities?.length)return;
  const row=value as Record<string,unknown>;
  // Read the original wording, even when the planner mislabels a capture
  // request nonVisual. A year can precede or follow the media noun/verb.
  const exactCapture=text.split(/[.!?\n;]/u).some(clause=>/(?<!\d)(?:1[0-9]|20)\d{2}(?!\d)/u.test(clause)
    &&/\b(?:footage|record(?:ing|ed)?|film(?:ed|ing)?|photographs?|photos?)\b|(?:видео)?съ[её]мк|сним\p{L}*|фото\p{L}*|(?:видео)?запис|архивн\p{L}*\s+кадр/iu.test(clause));
  if(typeof row.scriptQuote!=='string'||!text.includes(row.scriptQuote)
    ||!/\b(?:introduced|adopted|pioneered)\b|внедрил\p{L}*|вв[её]л\p{L}*/iu.test(row.scriptQuote)
    ||exactCapture
    ||requirements?.checks.some(check=>check.kind==='action'))return;
  const {eventYear,startYear,endYear}=row;
  if(![eventYear,startYear,endYear].every(year=>typeof year==='number'&&Number.isInteger(year))
    ||Number(startYear)<1700||Number(endYear)>2099||Number(startYear)>Number(eventYear)||Number(endYear)<Number(eventYear)
    ||Number(endYear)-Number(startYear)>20||!row.scriptQuote.includes(String(eventYear))
    ||requirements&&!requirements.nonVisual.some(item=>item.scriptQuote.includes(String(eventYear))))return;
  return {scriptQuote:row.scriptQuote,eventYear:Number(eventYear),startYear:Number(startYear),endYear:Number(endYear)};
}

export const documentaryHistoricalIllustrationInstruction=' If narrativeContext.historicalIllustration is present, the original sentence is EVENT COMMENTARY, not a demand for a recording made in eventYear. Preserve the exact company/subject and visible production process. For identifiedEntity and visibleSubjects.name use the EXACT supplied requiredIdentities[].name when source provenance and actual pixels establish that company production. Put the equipment/process description in evidence, never append it to the canonical identifier. Accept ONLY authentic archive media captured within startYear–endYear with a literal source.title/description quotation dating the depicted footage/photo. Modern reenactments or footage of a model manufactured in that period are not archive capture provenance. Set requiredEra to the planned period, observedEra to the REAL source capture period, and eraEvidenceQuote to its exact source quotation. Explicitly describe this as a historical illustration, not a recording of the narrated introduction/event. Never relabel 1916/1920 media as filmed in 1913. Unverified capture date remains uncertain. A photograph is allowed only when the supplied mediaKind/settings permit images; it proves no temporal action.';

/** Editing slices are not independent stories. Preserve literal nearby script,
 * including flashbacks/comparisons, rather than copying the nearest year into
 * every requirement or inferring facts from a search result's title. */
export function documentarySceneContext(project:Project,scene:Scene) {
  const ordered=[...project.scenes].sort((a,b)=>a.order-b.order),index=ordered.findIndex(item=>item.id===scene.id);
  const line=(item:Scene)=>({scene:item.order+1,text:item.narration});
  const preceding=ordered.slice(0,Math.max(0,index-8));
  const req=scene.documentary?.requirement;
  const historicalIllustration=req?.scriptRequirements&&documentaryHistoricalIllustration(req.historicalIllustration,scene.narration,req.scriptRequirements,req.identities);
  return {current:line(scene),...(historicalIllustration?{historicalIllustration}:{}),
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
  if(documentaryNamedListPortrait(project,scene)){
    const ordered=[...project.scenes].sort((a,b)=>a.order-b.order),index=ordered.findIndex(item=>item.id===scene.id);
    return {current:{scene:scene.order+1,text:scene.narration},preceding:[],following:ordered.slice(index+1,index+2).map(item=>({scene:item.order+1,text:item.narration})),earlierTimeReferences:[]};
  }
  if(scene.documentary?.requirement?.visualScope==='illustrative'&&documentaryGeneralIllustration(scene)
    &&!documentaryCallToActionIllustration(scene))
    return {current:{scene:scene.order+1,text:scene.narration},preceding:[],following:[],earlierTimeReferences:[]};
  return documentarySceneContext(project,scene);
}

/** Explicit closing lists introduce their named members, not a dated event.
 * Keep exact identities; only the unrelated earlier season is omitted. */
export function documentaryNamedListPortrait(project:Project,scene:Scene):boolean {
  const req=scene.documentary?.requirement;
  if(!req?.identities?.length||req.years.length||scene.includeInAssembly===false)return false;
  const ordered=[...project.scenes].sort((a,b)=>a.order-b.order),index=ordered.findIndex(item=>item.id===scene.id);
  const text=scene.narration+(/[,;:]\s*$/.test(scene.narration)?ordered[index+1]?.narration??'':'');
  return /(?:люди|гонщики|инженеры|people|riders|engineers)[^:]{0,35}:\s*[^:]+[,;]/iu.test(text)
    &&!/\b(?:1[0-9]|20)\d{2}\b|\b(?:won|winning|race start|podium|trophy)\b|победил|одержал|старт|подиум|трофе/iu.test(text);
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

export const documentaryPreArchiveEraProvenanceInstruction = documentaryLegacyEraProvenanceInstruction
  .replace('source.title, source.description or source.date', 'source.title or source.description')
  + ' The legacy source.date field can be a publication or file date: it is not verified capture provenance and must never establish the depicted era by itself.';
export const documentaryEraProvenanceInstruction = documentaryPreArchiveEraProvenanceInstruction
  + ' If the ORIGINAL current narration explicitly requests an archival photograph/image/footage/recording, archive provenance is mandatory even if the planner put that phrase in nonVisual and no exact year is given. A modern museum photograph of an old object is not proof of an archival photograph. Return eraEvidenceQuote as an EXACT source.title/description quotation explicitly establishing an archive/archival origin of this media. Antique/vintage model styling or manufacture year alone does not establish capture provenance. Without this source evidence return uncertain/rejected; never invent a quotation. This remains the same comprehensive actual-frame review.';

function literalSourceField(source:Record<string,unknown>|undefined,field:string):string|undefined {
  const saved=source?.[field];
  if(typeof saved!=='string')return;
  let value:string=saved;
  // Old saved candidates may carry the former search-only wrapper. Never
  // treat its generated caption as provenance; unknown receipt guards remain.
  const marker='\nOriginal source description:\n';
  while(field==='description'&&value.startsWith('Previous frame review,')&&value.includes(marker))
    value=value.slice(value.indexOf(marker)+marker.length);
  return value;
}

/** Source-blind identity checks receive literal dates, never a suggested name. */
export function documentarySourceEraReferences(source:Record<string,unknown>|undefined,includeLegacyDate=false) {
  return Object.fromEntries(['title','description','date'].map(field=>[field,(field!=='date'||includeLegacyDate)?[...new Set(literalSourceField(source,field)?.match(/\b(?:1[0-9]|20)\d{2}\b/g)??[])]:[]]));
}

export function documentaryNarrativeEvidenceIssue(review:Record<string,unknown>,source?:Record<string,unknown>,context?:DocumentarySceneContext):string|undefined {
  const evidence=review.narrativeEvidence as Record<string,unknown>|undefined;
  if(!evidence||evidence.subjectMatch!==true||evidence.eraMatch!==true||evidence.detailMatch!==true||typeof evidence.evidence!=='string'||evidence.evidence.trim().length<12)
    return `Не подтверждено соответствие человеку, эпохе и детали текущей сцены. ${typeof evidence?.evidence==='string'?evidence.evidence:typeof review.reason==='string'?review.reason:''}`;
  const requiredEra=evidence.requiredEra;
  if(typeof requiredEra!=='string'||!requiredEra.trim())return 'Не указано, требует ли исходная сцена определённую эпоху; материал не подтверждён.';
  // Read the original wording. A planner's nonVisual entry cannot erase an
  // explicit provenance requirement for the photograph/recording itself.
  const archivalMediaPhrase=/\b(?:archival|archive)\s+(?:[\p{L}-]+\s+){0,3}(?:photographs?|photos?|images?|pictures?|footage|films?|recordings?|videos?)\b|архивн\p{L}*\s+(?:[\p{L}-]+\s+){0,3}(?:фот\p{L}*|сним\p{L}*|кадр\p{L}*|виде\p{L}*|запис\p{L}*|съ[её]мк\p{L}*)/iu;
  const archiveSourcePhrase=/\b(?:from|courtesy of|provided by|held by)\s+(?:the\s+)?[\p{L}\p{N} .,'’()-]{0,80}\barchives?\b|(?:из|предоставлен\p{L}*)\s+[\p{L}\p{N} .,'’()-]{0,80}архив\p{L}*/iu;
  const archiveRequested=archivalMediaPhrase.test(context?.current.text??'');
  if(archiveRequested){
    const archiveQuote=typeof evidence.eraEvidenceQuote==='string'?evidence.eraEvidenceQuote.trim():'';
    const sourceFields=['title','description'].map(field=>literalSourceField(source,field)).filter((field):field is string=>typeof field==='string');
    const negatedArchive=/\b(?:not|never|no)\s+(?:(?:an?|the|genuine|authentic|original|verified)\s+){0,3}(?:archival|archives?)\b|\bnon[- ]archival\b|\bnot\s+(?:from|courtesy of|provided by|held by)\s+[\p{L}\p{N} .,'’()-]{0,80}\barchives?\b|не\s+(?:(?:является|подлинн\p{L}*|настоящ\p{L}*)\s+){0,3}архив\p{L}*/iu;
    if(!(archivalMediaPhrase.test(archiveQuote)||archiveSourcePhrase.test(archiveQuote))
      ||!sourceFields.some(field=>field.includes(archiveQuote))||sourceFields.some(field=>negatedArchive.test(field)))
      return 'Архивное происхождение самого снимка или записи не подтверждено источником. Современное фото старого объекта не доказывает архивность снимка.';
  }
  if(requiredEra.toLowerCase()==='none')return context?.historicalIllustration?'Историческая иллюстрация требует подтверждённой эпохи съёмки.':undefined;
  const quote=typeof evidence.eraEvidenceQuote==='string'?evidence.eraEvidenceQuote.trim():'';
  // Legacy capturedAt mixes capture, upload and file timestamps across
  // providers. A coinciding upload year cannot date the depicted event.
  const sourceFields=['title','description'].map(field=>literalSourceField(source,field)).filter((field):field is string=>typeof field==='string');
  const historical=context?.historicalIllustration;
  if(historical){
    const observed=String(evidence.observedEra??'').match(/\b(?:1[0-9]|20)\d{2}\b/g)??[];
    if(!requiredEra.includes(String(historical.startYear))||!requiredEra.includes(String(historical.endYear))
      ||!observed.length||observed.some(year=>Number(year)<historical.startYear||Number(year)>historical.endYear)
      ||quote.length<4||!sourceFields.some(field=>field.includes(quote))||!observed.every(year=>quote.includes(year)))
      return 'Дата исторической иллюстрации не подтверждена источником или находится вне согласованной эпохи. Дата события не датирует съёмку.';
    return;
  }
  const years=requiredEra.match(/\b(?:1[0-9]|20)\d{2}\b/g)??[];
  const observedYears=String(evidence.observedEra??'').match(/\b(?:1[0-9]|20)\d{2}\b/g)??[];
  if(new Set(years).size===1&&observedYears.some(year=>year!==years[0]))
    return `Проверка описывает эпоху «${evidence.observedEra}», противоречащую требуемому году «${years[0]}». Год в описании всего источника не исправляет другой год выбранного кадра.`;
  if(context&&years.length){
    const scriptYears=new Set([context.current,...context.preceding,...context.following,...context.earlierTimeReferences]
      .flatMap(line=>line.text.match(/\b(?:1[0-9]|20)\d{2}\b/g)??[]));
    if(scriptYears.size&&years.some(year=>!scriptYears.has(year)))return `Требуемая эпоха «${requiredEra}» взята не из исходного сценария; данные найденного источника не могут менять время рассказа.`;
  }
  if(quote.length<4||!sourceFields.some(field=>field.includes(quote))||years.length>0&&!years.some(year=>quote.includes(year)))
    return `Эпоха «${requiredEra}» не подтверждена исходными данными источника. Узнаваемый человек, номер или окраска не доказывают год события.`;
}
