import type {DocumentaryCandidate,DocumentaryRequirement} from '@gold-work/shared';
import {documentaryFuseModelSuffix} from './documentary-search.js';
import {documentaryRequiredVisiblePart,documentaryRivalryTarget} from './documentary-detail-evidence.js';
import {documentaryProjectionIssue,documentarySpecificIdentity} from './documentary-visual-relevance.js';
import {documentaryExplicitModelYear} from './documentary-model-year.js';
import {documentaryShortMetadata,documentaryMetadataRelevance} from './documentary-metadata-relevance.js';

const normalized=(text:string)=>` ${documentaryFuseModelSuffix(text).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()} `;
const has=(text:string,name:string)=>normalized(text).includes(normalized(name));

/** Captions describe the depicted subject; book credits, categories and page
 * chrome do not. Keep these discovery hints separate from full provenance,
 * which is still retained on the candidate for the actual-file review. */
function primarySubjectMetadata(candidate:DocumentaryCandidate):string {
  const description=candidate.description.replace(/\r\n?/g,'\n');
  const captions=description.match(/(?:^|\n)Captions\s*\n([\s\S]*?)(?=\n(?:Summary\s*(?:edit)?|Description)\b)/iu)?.[1]??'';
  const field=/(?:^|\n)Description[ \t]*(?:\n|:)/iu.exec(description);
  const body=field?description.slice(field.index+field[0].length):description;
  const subject=body.split(/\n(?:Date|Source|Author|Licensing\s*(?:edit)?|File history|File usage(?: on Commons)?|Metadata|Items portrayed in this file|Category|Categories|Hidden categories)(?:[ \t]*[:\t\n]|$)/iu)[0]??'';
  const stripCredits=(value:string)=>value.split('\n').map(line=>line
    .replace(/\b(?:for|from|in|published in)\s+(?:(?:his|her|their|its|own|the|a|an)\s+)*(?:book|publication|catalogue|catalog|biography)\b.*$/iu,'')
    .replace(/(?:для|из|к)\s+(?:(?:его|е[её]|их|своей|своего)\s+)?книг\p{L}*.*$/iu,'')
    // A leading credit may introduce a separate factual caption after ':';
    // keep that caption after removing book provenance above.
    .replace(/^((?:\p{L}+:\s*)?)(?:drawn|painted|created|produced|photographed|illustrated)\s+by\s+[^:;\n]{1,100}[:;]\s*/iu,'$1')
    // Preserve a subject before its credit ("Ship interior, photographed by
    // ..."), but never promote a credited book's title to the depicted object.
    .replace(/\b(?:drawn|painted|created|produced|photographed|illustrated)\s+by\b.*$/iu,''))
    .join(' ');
  const caption=documentaryShortMetadata({...candidate,description:`${stripCredits(captions)} ${stripCredits(subject)}`});
  return `${caption.title} ${caption.description}`;
}

// Only a cheap contradiction with an explicitly human portrait, not a
// required taxonomy: sparse/ambiguous captions remain eligible for pixels.
const physicalObjectCue=/\b(?:ships?|vessels?|clippers?|steamships?|steamers?|sailboats?|warships?|liners?|hull|rudder|stern|rigging|masts?|deck|cargo hold|iron fram\w*|metal sheathing|aircraft|airplanes?|aeroplanes?|jets?|cockpit|fuselage|vehicles?|cars?|automobiles?|motorcycles?|locomotives?|engines?|crankshaft|pistons?|cameras?|shutter|sensor)\b|корабл|судн|пароход|парусник|фрегат|корпус|рул[ьяе]|самол[её]т|автомобил|мотоцикл|локомотив|двигател|коленвал|поршн/iu;
const portraitCue=/\b(?:portraits?|headshots?|self[ -]portrait)\b|портрет/iu;

export function documentaryCandidateSubjectIssue(candidate:DocumentaryCandidate,requirement:DocumentaryRequirement,narration=requirement.text,rejectPortraitObjects=true):string|undefined {
  if(candidate.kind!=='image')return;
  const fallback=requirement.footageFallback;
  const activeFallback=fallback&&(fallback.narration??requirement.text)===narration?fallback:undefined;
  const plan=requirement.aiSearchPlan;
  const target=activeFallback?.target||plan?.visualTarget||requirement.detail||requirement.fastVisualTarget||'';
  // The target itself wins over incidental names/ship words in narration or
  // discovery queries (e.g. a captain's portrait found with his ship's name).
  const primaryTarget=target.split(/[,;]|\s+[—–]\s+/u)[0]??target;
  if(portraitCue.test(primaryTarget)&&!physicalObjectCue.test(primaryTarget)){
    // A clearly depicted object is not a person's portrait, even when its
    // description mentions an owner/captain. Sparse titles stay undecided.
    const primaryTitle=candidate.title.split(/[,;]|\s+[—–]\s+/u)[0]??candidate.title;
    if(rejectPortraitObjects&&physicalObjectCue.test(primaryTitle)&&!portraitCue.test(primaryTitle))
      return 'Основной предмет источника — предмет или его деталь; текущая визуальная задача требует портрет человека.';
    return;
  }
  const queries=activeFallback?.queries??(plan?[...plan.imageQueries,...plan.videoQueries]:requirement.queries);
  if(!physicalObjectCue.test(`${target} ${queries.join(' ')}`))return;
  const metadata=primarySubjectMetadata(candidate);
  // "Captain Cook" may name a ship. Explicit subject attribution keeps that
  // source, as well as genuine interiors, details and ship portraits, eligible.
  if(physicalObjectCue.test(metadata))return;
  const title=candidate.title.replace(/^File:/iu,'').replace(/\.[a-z0-9]{2,5}(?:\s+-\s+Wikimedia Commons)?$/iu,'').replace(/_/g,' ').trim();
  const titledPerson=/^(?:[Cc]aptain|[Aa]dmiral|[Pp]rofessor|[Dd]octor|[Кк]апитан|[Аа]дмирал|[Пп]рофессор|[Дд]октор)\s+\p{Lu}[\p{L}'’-]+(?:\s+\p{Lu}[\p{L}'’-]+){1,3}$/u.test(title);
  if(portraitCue.test(metadata)||titledPerson)
    return 'Основной предмет источника — портрет человека; текущая визуальная задача требует предмет или его деталь.';
}

export function documentaryNamedMetadataIssue(candidate:DocumentaryCandidate):string|undefined {
  if(/\b(?:gameplay|game play|gaming|playstation|ps[2-5]|simulator|diecast|die cast|toy|scale model|model kit|miniature|miniatura|maqueta|modellino|minichamps|maisto|protar)\b|игровой процесс|игрушеч|\b(?:scale|escala)\s*1\s*[:/]\s*\d+/iu.test(candidate.title)
    ||/\b(?:review|unboxing)\b|обзор/iu.test(candidate.title)
      &&/\b(?:diecast|die cast|scale model|model kit|miniature|maqueta|modellino)\b|\bscale\s*1\s*[:/]\s*\d+/iu.test(candidate.description.slice(0,500)))
    return 'Источник описан как игра или уменьшенная модель; нужен настоящий именованный объект.';
}
export function documentaryDiscoveryName(identity:NonNullable<DocumentaryRequirement['identities']>[number]):string {
  return identity.aliases.find(name=>/[a-z]/i.test(name)&&!/[а-яё]/i.test(name))??identity.name;
}

function plannedTitleName(name:string,queries:string[]):string|undefined {
  const prefix=name.match(/^([\p{Lu}\d][\p{L}\d’'-]*(?:\s+[\p{Lu}\d][\p{L}\d’'-]*)+)\s+\p{Ll}[\p{Ll}\s-]*$/u)?.[1];
  return prefix&&queries.some(query=>has(query,prefix))?prefix:undefined;
}

const discoveryObjectClass=/^(?:(?:sailing|steam|clipper|historic|preserved|passenger|military)\s+)*(?:ship|vessel|warship|aircraft|locomotive|automobile|motorcycle|camera|engine|building|bridge|canal|person|composer|scientist|inventor)$/iu;

/** Legacy AI subjects can mix the proper name with an action, place or object
 * class. Extract only the leading name, independently of candidate captions;
 * an ambiguous/generic description must not become an impossible exact gate. */
function metadataIdentityNames(identity:NonNullable<DocumentaryRequirement['identities']>[number],queries:string[]):string[] {
  const word=String.raw`(?:[\p{Lu}\d][\p{L}\p{N}.'’-]*|\p{Ll}[\p{L}\p{N}'’-]*[\p{Lu}\d][\p{L}\p{N}'’-]*)`;
  const prefix=new RegExp(`^${word}(?:\\s+(?:(?:van|von|de|del|della|da|di|du|la|le|der|den|of|the)\\s+)?${word})*`,'u');
  const extract=(value:string)=>{
    const text=value.trim(),leading=text.match(prefix)?.[0];
    if(!leading)return;
    let name=leading.replace(/['’]s$/u,''),tail=text.slice(leading.length);
    // Parentheses can distinguish models just as decisively as a hyphenated
    // suffix. Only an explicit object class is disposable without grounding.
    for(let group;(group=/^\s*\(([^()]+)\)/u.exec(tail));){
      if(!discoveryObjectClass.test(group[1]!.trim()))name+=' '+group[0].trim();
      tail=tail.slice(group[0].length);
    }
    if(name.length<3||!/[\p{L}]/u.test(name))return;
    // A sentence-initial category ("Steamship, representative of ...") is
    // not a named object. Single-word brands with a descriptor need an
    // independently capitalized occurrence in a planned query.
    if(!/\s/u.test(name)&&tail&&(/\b(?:representative|generic|unspecified)\b/iu.test(tail)
      ||!queries.some(query=>query.includes(name)&&has(query,name))))return;
    return {name,descriptive:Boolean(tail.trim())};
  };
  const primary=extract(identity.name),canonical=primary?normalized(primary.name):undefined;
  const aliases=identity.aliases.flatMap(value=>{
    const alias=extract(value);
    if(!alias)return [];
    const name=normalized(alias.name);
    // Stripping an alias's description must not turn a specific model into
    // its brand/family prefix. Explicit clean aliases and model-only names
    // remain valid; query repetition cannot restore a discarded discriminator.
    if(alias.descriptive&&canonical?.includes(name)&&!canonical.endsWith(name))return [];
    return [alias.name];
  });
  return [...new Set([...(primary?[primary.name]:[]),...aliases])];
}

/** A current plan may describe its identity as a sentence. Recover only its
 * explicit canonical name, witnessed by the original quote, for discovery.
 * Neither a related owner/vehicle nor a shortened model family is an alias. */
export function documentaryGroundedDiscoveryName(plan:DocumentaryRequirement['aiSearchPlan']):string|undefined {
  const checks=plan?.grounding?.mandatory.filter(check=>check.kind==='identity');
  if(!plan||!checks?.length)return;
  const queries=[...plan.imageQueries,...plan.videoQueries];
  const withoutGroundedRename=(value:string)=>value.replace(/\s*\((?:renamed|also named)\s+([^()]+)\)/giu,(group,alias:string,index:number)=>{
    const original=value.slice(0,index).trim(),escaped=alias.trim().replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const relation=new RegExp('\\b(?:renamed|also named)\\s+'+escaped+'(?=$|[^\\p{L}\\p{N}’\'-])','iu');
    return checks.some(check=>(check.aliases??[]).some(known=>normalized(known)===normalized(alias))
      &&has(check.scriptQuote,original)&&relation.test(check.scriptQuote))?'':group;
  });
  const [name]=metadataIdentityNames({name:withoutGroundedRename(plan.subject),aliases:[]},queries);
  if(!name)return;
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const quotedName=new RegExp('(^|[^\\p{L}\\p{N}’\'-])'+escaped+'(?=$|[^\\p{L}\\p{N}’\'-])','iu');
  if(!checks.some(check=>quotedName.test(check.scriptQuote)))return;
  // Several checks may describe the same subject at different times. An
  // anaphoric quote is safe only when every required identity directly binds
  // this same name and at least one original quote witnesses it in full.
  for(const check of checks){
    const required=withoutGroundedRename(check.required);
    const match=new RegExp('(^|[^\\p{L}\\p{N}])('+escaped+')(?=$|[^\\p{L}\\p{N}])','iu').exec(required);
    if(!match)return;
    const prefix=required.slice(0,match.index+match[1]!.length).trim();
    // "owner of X" and "Captain Y, aboard X" do not make X the identity.
    if(prefix&&!/^(?:(?:the|a|an|named|depicted|is|ship|vessel|clipper|aircraft|locomotive|automobile|motorcycle|camera|engine|building|bridge|canal|person|captain|owner|scientist|inventor)\s*)+$/iu.test(prefix))return;
    let tail=required.slice(match.index+match[0].length);
    for(let qualifier;(qualifier=/^\s*\(([^()]+)\)/u.exec(tail));){
      if(!discoveryObjectClass.test(qualifier[1]!.trim()))return;
      tail=tail.slice(qualifier[0].length);
    }
    if(/^(?:[-/]\d|\s+(?:\d|[A-Z][\p{L}\p{N}'’-]*)|['’]s\b)/u.test(tail)
      ||/^\s+(?:crew|owner|captain|pilot|designer|family|series|class)\b/iu.test(tail)
      ||/^\s+(?:and|or|versus|vs|alongside|aboard|with)\b|\b(?:and|or|versus|vs|alongside|aboard|with)\s+(?:the\s+)?\p{Lu}/u.test(tail))return;
  }
  return name;
}

/** The caller supplies only a current validated plan. This changes discovery
 * hints, never the stored requirement or the subject used by visual approval. */
export function documentaryPlannedDiscoveryRequirement(requirement:DocumentaryRequirement,currentPlan:DocumentaryRequirement['aiSearchPlan']):DocumentaryRequirement {
  if(!currentPlan||currentPlan!==requirement.aiSearchPlan||currentPlan.visualScope!=='illustrative'||!requirement.identities?.length)return requirement;
  const target=currentPlan.visualTarget.split(/[,;]|\s+[—–]\s+/u)[0]??currentPlan.visualTarget;
  const queries=[...currentPlan.imageQueries,...currentPlan.videoQueries];
  const identity=requirement.identities[0]!;
  const supported=(name:string)=>has(target,name)&&queries.some(query=>has(query,name));
  const grounded=documentaryGroundedDiscoveryName(currentPlan);
  const checks=currentPlan.grounding?.mandatory.filter(check=>check.kind==='identity');
  const sameGrounding=checks?.length===requirement.identities.length&&requirement.identities.every((item,index)=>
    item.name===checks[index]!.required&&JSON.stringify(item.aliases)===JSON.stringify(checks[index]!.aliases??[]));
  // Only the discovery view coalesces duplicate descriptions of one grounded
  // identity. Preserve any separate/stale requirement and every saved field.
  if(grounded&&supported(grounded)&&(requirement.identities.length===1||sameGrounding)
    &&(requirement.identities.length!==1||identity.name!==grounded))
    return {...requirement,identities:[{name:grounded,aliases:[]}]};
  if(requirement.identities.length!==1)return requirement;
  if(metadataIdentityNames(identity,requirement.queries).some(supported))return requirement;
  // Aliases already passed the canonical discriminator guard above. Splitting
  // them again as new identities would turn "Airbus, passenger aircraft" into
  // a brand-only replacement for Airbus A320. Only split the mixed main name.
  const primary=metadataIdentityNames({name:identity.name,aliases:[]},queries)[0];
  const canonical=primary?normalized(primary):undefined;
  const segments=identity.name.split(/[,;()]/u).map(value=>value.trim())
    .filter(value=>value.length>=3&&supported(value)
      &&!(canonical&&canonical!==normalized(value)&&canonical.includes(normalized(value)))
      &&metadataIdentityNames({name:value,aliases:[]},queries).includes(value));
  const names=[...new Set(segments)];
  return names.length?{...requirement,identities:names.map(name=>({name,aliases:[]}))}:requirement;
}

/** One canonical identity for bounded Commons discovery, never an approval.
 * Descriptive suffixes use the existing parser; aliases cannot replace the
 * primary name with a brand or generic category for this extra native query. */
export function documentaryCommonsDiscoverySubjects(requirement:DocumentaryRequirement,currentPlan:DocumentaryRequirement['aiSearchPlan'],query:string):string[]{
  if(!currentPlan||currentPlan!==requirement.aiSearchPlan||!requirement.identities?.length)return [];
  const discovery=documentaryPlannedDiscoveryRequirement(requirement,currentPlan);
  if(discovery.identities?.length!==1)return [];
  const identity=discovery.identities[0]!;
  const [name]=metadataIdentityNames({name:identity.name,aliases:[]},[...currentPlan.imageQueries,...currentPlan.videoQueries]);
  const target=currentPlan.visualTarget.split(/[,;]|\s+[—–]\s+/u)[0]??currentPlan.visualTarget;
  return name&&has(target,name)&&has(query,name)?[name]:[];
}

export function documentaryYouTubeNameFallback(requirement:DocumentaryRequirement,queries:string[]):string|undefined {
  if(requirement.identities?.length!==1||!queries[0]||!queries[1])return;
  const name=documentaryDiscoveryName(requirement.identities[0]!);
  const subject=plannedTitleName(name,queries)??name;
  // Replace only a generic second query. A second named action/angle stays planned.
  if(/^\p{Lu}/u.test(subject)&&subject.length>=3&&has(queries[0],subject)
    &&normalized(queries[0])!==normalized(subject)&&!has(queries[1],subject))return subject;
}

export function documentaryNamedVideo(candidate:DocumentaryCandidate,name:string):boolean {
  return candidate.kind==='video'&&candidate.rights!=='unknown'&&has(candidate.title,name)&&!documentaryNamedMetadataIssue(candidate);
}

/** A caption need not describe the exact moment or camera angle. Discover
 * the named event first, then verify the required action in actual frames. */
export function documentaryCompactEventQuery(query:string):string {
  return query.replace(/\bchampionship celebration\b/giu,'championship').replace(/\bworld title party\b/giu,'world title')
    .replace(/\b(?:race start|start|finish line win|parc ferme|track test|track action|real racing footage|archive|footage|close[ -]?up)\b/giu,' ')
    .replace(/\s+/g,' ').trim();
}

/** A failed thematic fallback is not the user's permanent visual target.
 * Retry its retained exact referent first; the same run may restore this
 * already classified fallback without paying to classify it again. */
export function documentaryExactRequirementForRetry(requirement:DocumentaryRequirement):DocumentaryRequirement|undefined {
  if(requirement.visualScope!=='illustrative'||requirement.illustrationFallbackVersion!==1
    ||!requirement.narrativeIdentities?.length||!requirement.narrativeQueries?.length)return;
  return {...requirement,visualScope:'exact',
    entities:requirement.narrativeEntities??requirement.narrativeIdentities.map(identity=>identity.name),
    identities:requirement.narrativeIdentities,years:requirement.narrativeYears??[],
    queries:requirement.narrativeQueries,detail:requirement.narrativeDetail,searchRefined:true};
}

/** Search one referent at a time. Requiring a rider, two brands and a verb in
 * the same caption hides genuine portraits and model photographs. These
 * queries discover candidates only; the unchanged scene governs approval. */
export function documentaryNamedDiscoveryQueries(requirement:DocumentaryRequirement,queries:string[],narration:string):string[] {
  if(!requirement.identities?.length)return queries;
  // An event-commentary plan already names the visible archive process.
  // A bare brand + event year finds namesakes and hides genuine period media.
  // Keep its source-blind queries intact; actual identity/era checks follow.
  if(requirement.historicalIllustration)return [...new Set([...requirement.queries,...queries])].slice(0,4);
  // The query can deliberately target the second participant of a rivalry.
  // Preserve that planned participant/event instead of switching to the first
  // globally listed name merely to make the search shorter.
  const focused=requirement.identities.length>1&&requirement.entities.length===1
    &&requirement.identities.some(identity=>[identity.name,...identity.aliases].some(name=>has(requirement.entities[0]!,name)));
  if(focused||documentaryRivalryTarget({narrationContext:narration,entities:requirement.entities},requirement.identities))return queries;
  const names=requirement.identities.map(documentaryDiscoveryName);
  const year=requirement.years.join(' ');
  const subject=(name:string)=>[name,year].filter(Boolean).join(' ');
  const detail=documentaryRequiredVisiblePart(narration);
  // A named object alone often returns parked walkarounds or modern factory
  // tours. Keep the user's physical operation in the first discovery request.
  // Frozen checks were planned before seeing candidates and do not change here.
  const literalAction=requirement.scriptRequirements?.mode!=='thematic'
    &&requirement.scriptRequirements?.checks.some(check=>check.kind==='action');
  if(literalAction&&requirement.queries[0]&&names.some(name=>has(requirement.queries[0]!,name))){
    const precise=requirement.queries.map(query=>year&&!/\b(?:1[89]|20)\d{2}\b/.test(query)?`${query} ${year}`:query);
    return [...new Set([...precise,...queries,...names.map(subject)])].slice(0,4);
  }
  // A planner may search an event or an internal component instead of naming
  // the enclosing vehicle. Keep those two precise queries ahead of a generic
  // portrait/model query; the latter cannot discover a race start or crankshaft.
  const eventTarget=Boolean(year&&/\b(?:race|grand prix|win|victory|championship|world title|first flight|crash|accident|launch|landing|assassination|trial|discovery|expedition|battle|election|inauguration|protest)\b|Гран-при|гонк|побед|чемпион|перв\p{L}*\s+пол[её]т|катастроф|авари|запуск|посадк|убийств|судебн|открыти|экспедиц|битв|выбор\p{L}*|инаугурац|протест/iu.test(`${requirement.queries.join(' ')} ${narration}`));
  if(detail||year&&requirement.queries[0]&&!has(requirement.queries[0],names[0]!)||eventTarget){
    const event=detail?queries.slice(0,2):requirement.queries.slice(0,2).map(documentaryCompactEventQuery);
    if(!detail&&eventTarget&&names[0]!.split(/\s+/).length>=2&&has(event[0]??'',names[0]!)){
      const surname=names[0]!.split(/\s+/).at(-1)!;
      if(surname.length>=4)event[1]=event[0]!.replace(new RegExp(names[0]!.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'giu'),surname);
    }
    if(!detail&&event[1]&&names.length>1){
      let broad=event[1];
      for(const name of names.slice(1))broad=broad.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'giu'),' ');
      broad=broad.replace(/\s+/g,' ').trim();
      if(broad.split(' ').length>=2)event[1]=broad;
    }
    return [...new Set([...event.map(query=>year&&!/\b(?:1[89]|20)\d{2}\b/.test(query)?`${query} ${year}`:query),...names.map(subject),...queries])].slice(0,4);
  }
  const first=subject(names[0]!);
  const secondary=names.slice(1).find(name=>name.trim().split(/\s+/).length>1);
  // Preserve the generated detail/action request, and allow a separately
  // named person/model in a list to be found without all names in one file.
  return [...new Set([first,secondary&&subject(secondary),queries[0],year?names[0]:undefined,...names.slice(1).map(subject),subject(names[0]!),...queries]
    .filter((query):query is string=>Boolean(query)))].slice(0,4);
}

/** Cheap shortlist, never visual proof. A resolvable proper name must appear
 * in source metadata. Generic/ambiguous legacy subjects retain candidates for
 * the unchanged actual-file review instead of imposing a false exact name. */
export function documentaryNamedMetadataShortlist(candidates:DocumentaryCandidate[],requirement:DocumentaryRequirement,narration:string,rejectPortraitObjects=true):DocumentaryCandidate[] {
  if(!requirement.identities?.length)return [];
  const primary=documentarySpecificIdentity(requirement);
  const identities=(primary?[primary]:requirement.identities).flatMap(identity=>{
    const [name,...aliases]=metadataIdentityNames(identity,requirement.queries);
    return name?[{name,aliases}]:[];
  });
  const part=documentaryRequiredVisiblePart(narration);
  const personTarget=identities.some(identity=>/^\p{Lu}\p{Ll}[\p{L}'’-]+(?:\s+\p{Lu}\p{Ll}[\p{L}'’-]+){1,3}$/u.test(identity.name));
  const detailWords=[...new Set((requirement.detail??'').toLowerCase().match(/[a-z]{4,}/g)??[])];
  const stem=(word:string)=>word.replace(/(?:ing|es|s)$/,'').replace(/e$/,'');
  const objectWords=new Set(requirement.scriptRequirements?.checks.filter(check=>check.kind==='object')
    .flatMap(check=>check.required.toLowerCase().match(/[a-z]{4,}/g)??[]).map(stem)??[]);
  const actionWords=requirement.scriptRequirements?.mode==='thematic'?[]
    :(requirement.scriptRequirements?.checks.filter(check=>check.kind==='action').flatMap(check=>check.required.toLowerCase().match(/[a-z]{4,}/g)??[])??[])
      .filter(word=>!['with','from','along','showing','visible','workers'].includes(word))
      .map(stem).filter(word=>!objectWords.has(word));
  const actionScore=(title:string)=>{
    const words=normalized(title).trim().split(' ').map(stem);
    return actionWords.filter(word=>words.includes(word)).length;
  };
  const names=identities.flatMap(identity=>[identity.name,...identity.aliases]).filter(name=>name.trim().length>=3);
  // Vehicle captions often omit the manufacturer ("Baby Blue Mustang driving").
  // A distinctive model word is a discovery clue only, never identity approval.
  const vehicleAction=requirement.scriptRequirements?.checks.some(check=>check.kind==='action'&&/\b(?:car|vehicle|automobile)\b/i.test(check.required));
  const mixedAction=(candidate:DocumentaryCandidate)=>vehicleAction
    ?(/\b(?:walk[ -]?around|cold start|startup|start up)\b/iu.test(candidate.title)?20:/\bvlog\b/iu.test(candidate.title)?6:0):0;
  const modelNames=vehicleAction?names.map(name=>name.trim().split(/\s+/).at(-1)!).filter(name=>/^[a-z]{6,}$/i.test(name)):[];
  const modelYear=documentaryExplicitModelYear(requirement,narration);
  const modelYearSupport=(candidate:DocumentaryCandidate)=>modelYear
    ?has(candidate.title,modelYear)?2:has(primarySubjectMetadata(candidate),modelYear)?1:0:0;
  const useful=candidates.filter(candidate=>{
    if(candidate.rights==='unknown'||documentaryProjectionIssue(candidate))return false;
    // Explicitly synthetic/irrelevant titles do not deserve paid inspection.
    if(documentaryNamedMetadataIssue(candidate)||documentaryCandidateSubjectIssue(candidate,requirement,narration,rejectPortraitObjects))return false;
    const metadata=`${candidate.title} ${candidate.description}`;
    const subject=primarySubjectMetadata(candidate);
    if(names.length&&![...names,...modelNames].some(name=>has(subject,name)))return false;
    const period=requirement.historicalIllustration;
    // This shortcut otherwise favours an undated building with several brand
    // aliases over the actual dated production photograph. Unknown provenance
    // stays in the remaining pool for ordinary ranking, never pixel approval.
    if(period&&!(metadata.match(/\b(?:1[0-9]|20)\d{2}\b/g)??[])
      .some(year=>Number(year)>=period.startYear&&Number(year)<=period.endYear))return false;
    // A shortcut must not spend the transfer budget on an explicitly different
    // dated subject. Ambiguous/multi-year sources remain eligible for ranking.
    const titledYears=candidate.title.match(/\b(?:1[89]|20)\d{2}\b/g)??[];
    if(modelYear&&titledYears.length===1&&titledYears[0]!==modelYear&&!has(candidate.description,modelYear))return false;
    if(candidate.kind==='video'&&actionWords.length&&!actionScore(candidate.title))return false;
    if(part&&!detailWords.some(word=>has(subject,word))&&!has(subject,part.replace(/-/g,' ')))return false;
    return candidate.kind==='image'||candidate.localPath||candidate.videoDefinition!=='sd';
  });
  const score=(candidate:DocumentaryCandidate)=>{
    const titleMatches=names.filter(name=>has(candidate.title,name)).length;
    const years:string[]=(candidate.title+' '+candidate.description).match(/\b(?:1[89]|20)\d{2}\b/g)??[];
    const date=modelYear?has(candidate.title,modelYear)?12:years.includes(modelYear)?4:-6
      :requirement.years.length?requirement.years.some(year=>years.includes(year))?4:years.length?-4:0:0;
    const detail=detailWords.filter(word=>has(candidate.title,word)).length;
    const short=candidate.kind==='video'&&(candidate.durationSeconds??Infinity)<=180?2:0;
    const title=candidate.title;
    const bystanders=personTarget&&!/\b(?:fans?|supporters|audience)\b|болельщик|фанат/iu.test(narration)
      &&/\bfan\s*club\b|\bfans?\b.*\b(?:reaction|react|members)\b|\b(?:trading card|photomontage|fotomontaje)\b|болельщик|фанат/iu.test(title)?20:0;
    const face=personTarget&&/\b(?:interview|intervista|entrevista)\b|интервью/iu.test(title)?2:0;
    return actionScore(title)*8+titleMatches*6+date+detail+short+face-bystanders-mixedAction(candidate);
  };
  const target={subject:primary?.name??identities[0]?.name,visualTarget:requirement.aiSearchPlan?.visualTarget??requirement.detail,
    queries:requirement.queries};
  return useful.sort((a,b)=>modelYearSupport(b)-modelYearSupport(a)||mixedAction(a)-mixedAction(b)
    ||documentaryMetadataRelevance(b,target)-documentaryMetadataRelevance(a,target)||score(b)-score(a)).slice(0,3);
}
