import { createHash, randomUUID } from "node:crypto";
import {documentaryDatedSearchQueries} from './documentary-dated-search.js';
import {documentarySavedContextIssue,revalidateDocumentaryContext} from './documentary-context-approval.js';
import {DocumentarySelectionSession} from './documentary-selection-session.js';
import {documentaryPreviewKey,documentaryPreviewDownloadRange,downloadDirectDocumentaryPreview,type DocumentaryPreview} from './documentary-preview.js';
import {documentaryGeneralDiagramScope} from './documentary-general-diagram.js';
import {documentaryRequiredVisiblePart,documentaryVisiblePartInMetadata} from './documentary-detail-evidence.js';
import {documentaryExactNamedShortVideoProbe} from './documentary-exact-short-video.js';
import {documentaryContinuityModelYear,documentaryContradictoryModelYear} from './documentary-model-year.js';
import {documentarySceneContext,documentaryGeneralIllustration,documentaryCallToActionIllustration,type DocumentarySceneContext} from './documentary-scene-context.js';
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import type { ProjectService } from "@gold-work/core";
import type { AutoStockProgress, AutoStockSelectionOptions, AutoStockSelectionResult, DocumentaryApi, DocumentaryCandidate, DocumentaryRequirement, DocumentarySearchInput, EffectAsset, Project, Scene } from "@gold-work/shared";
import { documentaryVideoCoverage } from "@gold-work/shared";
import type { LocalProjectStorage } from "./local-project-storage.js";
import type { StockClient } from "./stock-client.js";
import { checksumFile } from "./effect-library.js";
import { prepareDocumentaryMedia, prepareDocumentaryRangePoster,prepareDocumentaryDiagram } from "./documentary-media-cache.js";
import { DocumentarySearch, documentarySearchUnavailable, documentaryFuseModelSuffix } from "./documentary-search.js";
import { downloadDocumentaryFile, withDocumentaryDownloadBudget, documentaryDownloadTimedOut } from "./documentary-download.js";
import { atomicWrite } from "./fs-utils.js";
import { measureDocumentaryStage } from "./documentary-metrics.js";
import {recordDiagnosticEvent} from './diagnostics.js';
import {discoverDocumentarySourceBatches} from './documentary-discovery.js';
import { documentaryVisualHash, visualHashDistance } from "./documentary-visual-hash.js";
import { DocumentaryCachedAnalysisMissing, type DocumentaryIntelligence } from "./documentary-intelligence.js";
import {documentaryNarrationContext,documentaryMetadataShortlist} from './documentary-intelligence.js';
import type { EffectLibrary } from "./effect-library.js";
import { planDocumentaryEffects } from "./documentary-effects.js";
import { groundDocumentaryScenes, planDocumentaryComparisons } from "./documentary-comparison.js";
import {recoverDocumentaryPlanContext,readDocumentaryContextRecovery} from './documentary-plan-recovery.js';
import {documentarySourceQualityIssue,documentaryQualityPresentation,documentarySavedQualityIssue,documentaryKnownQualityIssue,documentaryAutoPortraitTemplate} from './documentary-source-quality.js';
import { planDocumentaryMontage } from "./documentary-montage.js";
import {prepareDocumentaryMaps} from './documentary-map.js';
import { copyImmutableDocumentaryFile, documentaryAvailableBytes, ensureDocumentarySpace, DocumentaryStorageUnavailableError } from "./documentary-storage.js";
import { DocumentaryYouTubeDefinitionError, documentaryLikelyPortraitShort, documentaryYouTubeFormatSelector, type DocumentaryYouTube } from "./documentary-youtube.js";
import { DocumentaryMemoryUnavailableError } from "./documentary-resources.js";
import {documentarySelectionResources,runDocumentarySelectionQueue} from './documentary-resources.js';
import { AnyModelModelUnavailableError } from "./anymodel-text-fallback.js";
import { DocumentaryAnalysisError } from "./documentary-analysis-error.js";
import { documentaryDistraction, documentarySavedIdentityIssue, applyDocumentaryRequirement, documentaryProjectionIssue,documentaryGeneralActionIssue } from "./documentary-visual-relevance.js";
import { documentaryCandidateKey, documentaryReuseIssue, documentaryVarietyIssue, revalidateDocumentaryVariety } from "./documentary-reuse.js";

const rejectedCandidateFingerprint=(candidate:DocumentaryCandidate)=>createHash('sha256').update(JSON.stringify([
  candidate.provider,candidate.id,candidate.excerpt?.sourceChecksum,candidate.excerpt?.startSeconds,candidate.excerpt?.endSeconds
])).digest('hex');
const uncertainFileFingerprint=(checksum:string)=>createHash('sha256').update(`uncertain-file:${checksum}`).digest('hex');
function uncertainCandidateFingerprints(candidate:DocumentaryCandidate):string[]{
  // Catalogued media reappears as local:<checksum> on the next run. Keep that
  // alias quarantined alongside the provider ID before another file copy.
  const checksum=/^local:([a-f0-9]{64})$/.exec(candidate.id)?.[1]
    ??(candidate.localPath?/^([a-f0-9]{64})\./.exec(basename(candidate.localPath))?.[1]:undefined);
  return [rejectedCandidateFingerprint(candidate),...(checksum?[uncertainFileFingerprint(checksum)]:[])];
}

/** A still has one view. For video only a short clip or an exact indexed
 * excerpt is safe to skip after a completed visual rejection; a long source
 * may contain another usable range. */
export const documentaryCacheableVisualRejection=(candidate:DocumentaryCandidate)=>candidate.kind==='image'
  ||candidate.kind==='video'&&(Boolean(candidate.excerpt)||(candidate.durationSeconds??Infinity)<=12);

async function readDocumentaryRejections(path:string,scope:string):Promise<Set<string>>{
  try{
    const saved=JSON.parse(await readFile(path,'utf8'));
    return saved?.version===1&&saved.scope===scope&&Array.isArray(saved.keys)
      ?new Set(saved.keys.filter((key:unknown)=>typeof key==='string'&&/^[a-f0-9]{64}$/.test(key))):new Set();
  }catch{return new Set();}
}

async function saveDocumentaryRejections(path:string,scope:string,keys:Set<string>){
  await atomicWrite(path,JSON.stringify({version:1,scope,keys:[...keys].slice(-250)}));
}

function documentarySearchSubjects(requirement: DocumentaryRequirement): string[] {
  if (!requirement.identities?.length) return requirement.entities;
  return [...new Set(requirement.identities.flatMap(identity => {
    const english = identity.aliases.find(name => /[a-z]/i.test(name) && !/[а-яё]/i.test(name));
    // A supplied disambiguation ("Faster (2003 film)", "Jaguar (car)")
    // is more useful than the bare common word. Never invent a qualifier.
    const qualified=identity.aliases.find(name=>/\([^)]{3,}\)/.test(name)&&name.toLowerCase().startsWith(identity.name.toLowerCase()+' '));
    return [qualified, english, identity.name, ...identity.aliases].filter((name): name is string => Boolean(name));
  }))];
}

function documentaryQueryForKind(query: string, requirement: DocumentaryRequirement, kind: "video" | "image"): string {
  const subjects = [...requirement.entities, ...(requirement.identities ?? []).flatMap(identity => [identity.name, ...identity.aliases])].join(" ");
  // Old semantic plans sometimes ask for animations of a physical mechanism.
  // The video reviewer requires camera footage, and still indexes need the
  // mechanism itself. Retain animation when it IS the named subject.
  let result = /\banimat\w*\b|анимац\p{L}*|мультфильм\p{L}*/iu.test(subjects)
    ? query : query.replace(/\b(?:3d\s+)?(?:animations?|animated)\b/gi, " ");
  // A still or muted stock clip cannot verify what a mechanism sounds like.
  // Keeping "sound" in a physical-detail query flooded live results with
  // mixers, records and music rather than the narrated engine part.
  if(documentaryRequiredVisiblePart(requirement.text))result=result.replace(/\b(?:sound|audio|noise)\b/gi," ");
  if (kind === "image") result = result.replace(/\b(?:video|footage|clips?|4k|hd)\b/gi, " ").replace(/\b([a-z]+ing) operations?\b/gi, "$1");
  return result.replace(/\s+/g, " ").trim();
}

export function documentarySearchQueries(requirement: DocumentaryRequirement, kind?: "video" | "image", context?:DocumentarySceneContext): string[] {
  if(kind==='image'&&context&&documentaryGeneralDiagramScope(context,requirement.identities)){
    // The original script explicitly explains a general mechanism. A full
    // inherited model name plus several explanatory words often has no hits
    // in archive search. Try one exact query, then a concise mechanism query;
    // neither query approves a generic photo as the named model.
    const names=(requirement.identities??[]).flatMap(identity=>[identity.name,...identity.aliases])
      .filter(name=>name.trim().length>=3).sort((a,b)=>b.length-a.length);
    const concise=requirement.queries.flatMap(query=>{
      let general=query;
      for(const name of names)general=general.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'giu'),' ');
      general=general.replace(/\b(?:diagram|schematic|illustration|explanation)\b/giu,' ').replace(/\s+/g,' ').trim();
      return general.split(' ').length>=2&&general!==query?[general]:[];
    }).sort((a,b)=>a.split(' ').length-b.split(' ').length);
    const part=documentaryRequiredVisiblePart(context.current.text);
    const partQuery=part&&part!=='exposed-engine'?`${part.replace(/-/g,' ')} diagram`:undefined;
    return [...new Set([requirement.queries[0],partQuery,...concise,...requirement.queries,...documentarySearchQueries(requirement,kind)]
      .filter((query):query is string=>Boolean(query)).map(query=>documentaryQueryForKind(query,requirement,kind)).filter(Boolean))].slice(0,4);
  }
  if (kind) {
    // Video-only vocabulary needlessly excludes still evidence in full-text
    // indexes. Keep the named subject and the actual action/detail intact.
    return [...new Set(documentarySearchQueries(requirement).map(query => documentaryQueryForKind(query, requirement, kind)).filter(Boolean))];
  }
  if (requirement.identities?.length) {
    const subjects = documentarySearchSubjects(requirement);
    const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const queries = requirement.queries.filter(Boolean).map(query => {
      const primary=subjects[0]!;
      const qualified=requirement.identities!.find(identity=>identity.aliases.includes(primary)&&primary.toLowerCase().startsWith(identity.name.toLowerCase()+' ('));
      if(qualified&&!normalize(query).includes(normalize(primary))){
        const escaped=qualified.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
        // Whole words only: "Faster" must not rewrite "FasterCar".
        const name=new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`,'iu');
        if(name.test(query))return query.replace(name,()=>primary);
      }
      return subjects.some(name => ` ${normalize(query)} `.includes(` ${normalize(name)} `))?query:`${primary} ${query}`;
    });
    const ignored = new Set([...subjects.flatMap(subject => normalize(subject).split(" ")), "the", "and", "with", "view", "video", "footage", "photo", "image", "archive", "archival"]);
    const detailWord = requirement.searchRefined ? normalize(requirement.queries[0] ?? "").split(" ").find(word => word.length >= 3 && !ignored.has(word)) : undefined;
    const concise = detailWord ? `${subjects[0]} ${detailWord}` : undefined;
    // A bounded semantic refinement may name the supporting location rather
    // than repeat a size-class label (e.g. the new locks). Retain that actual
    // discovery query as well as the identity-prefixed version. It is only a
    // candidate source; the mandatory identities still govern visual approval.
    // Keep one literal detail query even before an AI refinement. Prefixing
    // every query with an inherited model name hid engine diagrams/parts from
    // discovery, then the bare-model fallback returned more whole vehicles.
    // This is discovery only: identity and actual-frame checks still apply.
    const detailQuery = requirement.queries.find(query => query.trim() && !queries.includes(query));
    return [...new Set([...queries, ...(concise ? [concise] : []), ...(requirement.searchRefined ? requirement.queries : detailQuery ? [detailQuery] : []), subjects[0]!])].slice(0, 4);
  }
  // Preserve the generated object/detail queries before adding a bare-name fallback.
  // Context entities can be a location/company, so they must not displace the actual footage query.
  return [...new Set([...requirement.queries, ...requirement.entities].filter(Boolean))].slice(0, 4);
}

export function documentaryStockQueries(requirement: DocumentaryRequirement): string[] {
  // An unnamed clip remains eligible for real-frame review, but deliberately
  // stripping a mandatory place/model from discovery floods it with wrong subjects.
  if (requirement.identities?.length) return documentarySearchQueries(requirement, "video").slice(0, 2);
  const ignored = new Set(["the", "of", "and", "at", "in", "on", "a", "an", "view", "video", "footage", "photo", "photograph", "archive", "archival", "comparison", "compare"]);
  return [...new Set(requirement.queries.map(query => {
    let generic = documentaryQueryForKind(query, requirement, "video");
    for (const entity of [...requirement.entities].sort((a, b) => b.length - a.length)) generic = generic.replace(new RegExp(entity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ");
    const words = generic.match(/[\p{L}]+/gu)?.filter(word => !ignored.has(word.toLowerCase())) ?? [];
    return words.length >= 2 ? words.join(" ").slice(0, 100) : "";
  }).filter(Boolean))].slice(0, 2);
}

/** A self-contained editorial line can use a broad stock subject when its
 * descriptive/archival searches return nothing. Actual frames still decide. */
export function documentaryBroadIllustrationStockQuery(requirement: DocumentaryRequirement): string | undefined {
  if (requirement.identities?.length || requirement.years.length) return;
  const first = documentaryStockQueries(requirement)[0];
  if (!first) return;
  const modifiers = new Set(['archive','archival','historic','historical','footage','video','photo','photograph',
    'montage','film','reel','stock','clip','clips','shot','shots','dramatic','cinematic',
    'архивный','архивные','исторический','исторические','кадры','видео','фото','монтаж']);
  const words = (first.match(/[\p{L}\p{N}]+/gu) ?? []).filter(word => !modifiers.has(word.toLowerCase())).slice(0, 3);
  const broad = words.join(' ');
  return words.length >= 2 && broad.toLowerCase() !== first.toLowerCase() ? broad : undefined;
}

export function documentaryCandidateAttempts(candidates: DocumentaryCandidate[], entities: string[] = []): DocumentaryCandidate[] {
  const words = (text: string) => (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(word => !["the", "of", "and"].includes(word));
  const primary = words(entities[0] ?? "");
  const ready = candidates.filter(candidate => candidate.localPath && primary.length && primary.every(word => words(`${candidate.title} ${candidate.description}`).includes(word))).slice(0, 1);
  const seen = new Set<string>();
  return [...ready, ...candidates.slice(0, 3), ...candidates.filter(candidate => candidate.localPath), ...candidates.slice(3)]
    .filter(candidate => { const key = documentaryCandidateKey(candidate); return !seen.has(key) && Boolean(seen.add(key)); }).slice(0, 6);
}

export function documentaryNeedsVideo(scene: Scene): boolean {
  return Boolean(scene.documentary?.verified && !scene.documentary.pinned && scene.documentary.selected?.kind === "image" && scene.documentary.requirement.preferredKind !== "image");
}

/** Spend the requested photo share on documentary evidence first instead of
 * searching several long videos for a document/reference that wants a still. */
export function documentaryPhotoFirstScenes(project: Project): Set<string> {
  const included = project.scenes.filter(scene => scene.includeInAssembly !== false);
  const seconds = (scene: Scene) => Math.max((scene.documentary?.timing?.durationInFrames ?? scene.durationSeconds * 30) / 30,scene.durationOverrideSeconds??0);
  let budget = included.reduce((sum, scene) => sum + seconds(scene), 0) * (100 - project.settings.stockVideoPercent) / 100;
  budget -= included.filter(scene => scene.documentary?.verified && scene.documentary.selected?.kind === "image").reduce((sum, scene) => sum + seconds(scene), 0);
  const result = new Set<string>();
  for (const scene of included) {
    const doc = scene.documentary;
    // A failed refined run whose saved shortlist contains only photos already
    // reached its fallback stage. Resume there before repeating slow originals.
    // This changes search order only; the final moving-video quota still applies.
    if (doc && !doc.pinned && !doc.verified && doc.autoError && doc.requirement.searchRefined
      && doc.candidates.length && doc.candidates.every(candidate => candidate.kind === "image")) {
      result.add(scene.id); budget -= seconds(scene); continue;
    }
    if (doc?.pinned || doc?.verified) continue;
    // A planned cutaway/diagram is useful still evidence even when the model
    // generically prefers video for a machine. Spend only the existing photo
    // budget; don't exhaust long camera sources before looking for that plate.
    const diagram = /\b(?:diagram|cutaway|cross[ -]section|schematic|blueprint|exploded view|anatomy)\b/i
      .test(`${doc?.requirement.detail ?? ''} ${(doc?.requirement.queries ?? []).join(' ')}`);
    const narration = diagram ? documentaryNarrationContext(project, scene) : '';
    const needsAction = diagram && (documentaryGeneralActionIssue({ narration }) || /движ\p{L}*|вращ\p{L}*|поднима\p{L}*|опуска\p{L}*|\b(?:moving|rotating|rising|falling|opening|closing)\b/iu.test(narration));
    if (project.settings.stockVideoPercent !== 0 && doc?.requirement.preferredKind !== 'image' && (!diagram || needsAction)) continue;
    if (seconds(scene) > budget + .001) continue;
    result.add(scene.id); budget -= seconds(scene);
  }
  // Allocate the requested still share BEFORE downloads. A planner's generic
  // video preference must not turn a 35% video project into 191 video searches.
  // Spread static inserts through the film; literal movement still needs video.
  {
    const secured = documentaryVideoCoverage(project.scenes).percent >= project.settings.stockVideoPercent;
    const ordered = secured ? included : [...included].sort((a,b) =>
      ((a.order ?? included.indexOf(a)) * .61803398875 % 1) - ((b.order ?? included.indexOf(b)) * .61803398875 % 1));
    for(const scene of ordered){
      if(result.has(scene.id)||scene.documentary?.pinned||scene.documentary?.verified||seconds(scene)>budget+.001)continue;
      const narration=scene.narration ? documentaryNarrationContext(project,scene) : '';
      if(documentaryGeneralActionIssue({narration})||/движ\p{L}*|поднима(?:ется|ются|ет)|опуска(?:ется|ются|ет)|проплыв\p{L}*|буксир\p{L}*|\b(?:moves?|moving|rises?|rising|falls?|falling|sailing|towing|opening|closing)\b/iu.test(narration))continue;
      result.add(scene.id);budget-=seconds(scene);
    }
  }
  return result;
}

/** Cheap/exact clips can go straight to vision. A long new download also
 * needs view relevance: the right ship's dining tour is not its engine room. */
export function hasExactDocumentaryVideoCandidate(candidates: DocumentaryCandidate[], requirement?: DocumentaryRequirement, requiredVisiblePart?:string): boolean {
  // A model/race title can score highly from inherited search words while the
  // narration actually needs an exposed internal part. Do not bypass the
  // metadata shortlist for that case; the final original check still applies.
  if(requiredVisiblePart&&candidates.some(candidate=>candidate.kind==='video'
    &&!documentaryVisiblePartInMetadata(requiredVisiblePart,`${candidate.title} ${candidate.description}`)))return false;
  return candidates.some(candidate => candidate.kind === "video" && candidate.match === "exact-metadata" && candidate.rights !== "unknown")
    && candidates.every(candidate => candidate.kind !== "video" || candidate.localPath || (candidate.durationSeconds ?? Infinity) <= 45
      || requirement && documentaryDetailScore(candidate, requirement) >= 6);
}

/** Only metadata ranking is skipped; original pixels and context are checked. */
export function documentaryExactNamedStillProbe(candidates:DocumentaryCandidate[],requirement:DocumentaryRequirement,narration:string):DocumentaryCandidate|undefined {
  const identity=requirement.identities?.length===1?requirement.identities[0]:undefined;
  if(!identity||requirement.years.length||documentaryRequiredVisiblePart(narration)||documentaryGeneralActionIssue({narration}))return;
  const normalize=(value:string)=>` ${value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()} `;
  const name=normalize(identity.name);
  if(name.trim().split(' ').length<2)return;
  const personLike=/^\p{Lu}[\p{L}'’-]+(?:\s+\p{Lu}[\p{L}'’-]+){1,3}$/u.test(identity.name);
  const ignored=new Set(['the','and','for','with','from','this','that','photo','photos','image','images','rider','race','racing',
    'season','wins','winner','most','ever','record','history','documentary','previous','about']);
  const nameWords=new Set(name.trim().split(' '));
  const contextWords=personLike?[...new Set([...requirement.queries,narration].flatMap(value=>normalize(value).trim().split(' '))
    .filter(word=>word.length>=4&&!nameWords.has(word)&&!ignored.has(word)&&!/^\d+$/.test(word)))]:[];
  return candidates.find(candidate=>candidate.kind==='image'&&candidate.rights!=='unknown'
    &&normalize(candidate.title).includes(name)&&!documentaryProjectionIssue(candidate)
    &&(!personLike||contextWords.length>0&&contextWords.some(word=>normalize(candidate.title).includes(` ${word} `))));
}

/** For an establishing view of one named subject, the second YouTube query
 * should retrieve that subject rather than repeat another long description.
 * Literal part/recognized-operation/year scenes retain both precise queries. This only changes
 * discovery; ranking, rights and actual-frame approval remain mandatory. */
export function documentaryYouTubeQueries(requirement:DocumentaryRequirement,queries:string[],narration:string):string[] {
  const planned=queries.slice(0,2),identity=requirement.identities?.length===1?requirement.identities[0]:undefined;
  if(!identity||!planned.length)return planned;
  // The planner can put a related commentator or generic stock angle second,
  // while a third query still names the actual required subject and year.
  // Keep the same two YouTube requests, but spend the second on that subject.
  const normalize=(value:string)=>` ${value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()} `;
  const names=[identity.name,...identity.aliases].filter(name=>normalize(name).trim().length>=4);
  const namesSubject=(query:string)=>names.some(name=>normalize(query).includes(normalize(name)));
  const firstYears=[...new Set(planned[0]!.match(/\b(?:1[89]|20)\d{2}\b/g)??[])];
  if(planned.length===2&&namesSubject(planned[0]!)&&!namesSubject(planned[1]!)){
    const alternative=queries.slice(2).find(query=>namesSubject(query)
      &&(!firstYears.length||firstYears.some(year=>query.includes(year))));
    if(alternative){planned[1]=alternative;return planned;}
  }
  if(requirement.years.length||documentaryRequiredVisiblePart(narration)
    ||documentaryGeneralActionIssue({narration}))return planned;
  const qualified=identity.aliases.find(alias=>alias.toLowerCase().startsWith(identity.name.toLowerCase()+' (')&&/\([^)]{3,}\)/.test(alias));
  const name=(qualified??identity.name).trim();
  if(!/\s/.test(name)||name.length>100||planned[0]!.trim().toLowerCase()===name.toLowerCase())return planned;
  return [planned[0]!,name];
}

/** A broad wave may contain the named part even when the first exact search
 * returned only surrounding vehicles. The iterator yields the first batch at
 * the end if nothing better appears, so no source is silently discarded. */
export function documentaryFirstImageBatchWorthInspecting(candidates:DocumentaryCandidate[],requiredVisiblePart:string):boolean {
  return candidates.some(candidate=>candidate.kind==='image'
    &&documentaryVisiblePartInMetadata(requiredVisiblePart,`${candidate.title} ${candidate.description}`));
}

/** Only a concise, well-labelled clip merits an AI shortlist before other
 * source families return. Weak YouTube captions remain in the broad pool. */
export function documentaryFirstVideoBatchWorthInspecting(candidates: DocumentaryCandidate[], requirement: DocumentaryRequirement,narration=requirement.text): boolean {
  const identities=requirement.identities??[];
  return candidates.some(candidate=>{
    if(candidate.kind!=='video'||candidate.rights==='unknown'||(candidate.durationSeconds??Infinity)>120)return false;
    // If the first wave only contains a named person in a different sport or
    // role, wait for the already-running broader searches before paying to
    // rank this weak batch. The same source remains eligible later.
    if(identities.length===1&&/^\p{Lu}[\p{L}'’-]+(?:\s+\p{Lu}[\p{L}'’-]+){1,3}$/u.test(identities[0]!.name)
      &&documentaryExactNamedShortVideoProbe([candidate],requirement,narration)!==candidate)return false;
    const metadata=`${candidate.title} ${candidate.description}`.toLowerCase();
    if(identities.some(identity=>![identity.name,...identity.aliases].some(name=>name&&metadata.includes(name.toLowerCase()))))return false;
    if(requirement.years.length&&!requirement.years.some(year=>metadata.includes(year)))return false;
    return !requirement.detail?.trim()||documentaryDetailScore(candidate,requirement)>=3;
  });
}

export function documentaryDetailScore(candidate: DocumentaryCandidate, requirement: DocumentaryRequirement): number {
  const words = (value: string) => value.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [];
  const ignored = new Set([...requirement.entities.flatMap(words), "video", "footage", "photo", "view", "archive", "archival"]);
  const namedModel=requirement.identities?.length===1?requirement.identities[0]!.name:undefined;
  const modelCode=namedModel?.match(/\b[A-Za-z]+[A-Za-z0-9-]*\d[A-Za-z0-9-]*\b/u)?.[0];
  const literalDetail=words(requirement.detail??'').filter(word=>!ignored.has(word));
  // A precise model plus a specified view/action should rank by that detail.
  // Broad discovery terms such as the sport or brand locate candidates, but
  // are not evidence that a particular shot depicts the requested action.
  const details=[...new Set(modelCode&&literalDetail.length?literalDetail
    :words(`${requirement.detail ?? ""} ${requirement.queries.join(" ")}`).filter(word=>!ignored.has(word)))];
  const title = new Set(words(candidate.title)), description = new Set(words(candidate.description));
  const years=new Set(candidate.description.match(/\b(?:19|20)\d{2}\b/g)??[]);
  // A career-spanning source can mention the requested model and many search
  // words only in a season-by-season table. Keep it eligible for visual review,
  // but do not let that diffuse description outrank footage whose title names
  // the relevant action. An indexed excerpt may still prove the long source.
  const diffuseCatalogue=Boolean(candidate.kind==='video'&&(candidate.durationSeconds??0)>300
    &&candidate.description.length>800&&years.size>=5&&modelCode
    &&documentaryFuseModelSuffix(candidate.description).toLowerCase().includes(modelCode.toLowerCase())
    &&!documentaryFuseModelSuffix(candidate.title).toLowerCase().includes(modelCode.toLowerCase()));
  let descriptionMatches=0;
  const titleScore=details.reduce((score,word)=>{
    if(title.has(word))return score+3;
    if(description.has(word))descriptionMatches++;
    return score;
  },0);
  return titleScore+(diffuseCatalogue?Math.min(descriptionMatches,1):descriptionMatches);
}

/** A photo-first scene must not inspect a long review of a different model
 * merely because its description mentions the narrated one. This also applies
 * to a downloaded copy of that YouTube source: its local path does not change
 * the model named in the title. Comparative titles still reach frame review. */
export function documentaryConflictingModelTitle(candidate:DocumentaryCandidate,requirement:DocumentaryRequirement):boolean {
  const youtubeSource=candidate.provider==='youtube'||candidate.provider==='local'&&/^https:\/\/www\.youtube\.com\/watch\?v=/.test(candidate.pageUrl);
  if(candidate.kind!=='video'||!youtubeSource||(candidate.durationSeconds??0)<120
    ||requirement.preferredKind!=='image')return false;
  const titleWords=documentaryFuseModelSuffix(candidate.title).match(/[A-Za-z][A-Za-z0-9-]*/g)??[];
  for(const entity of requirement.entities){
    const match=/^([A-Za-z]{3,})\s+([A-Za-z][A-Za-z0-9-]*\d[A-Za-z0-9-]*)$/i.exec(entity.trim());
    if(!match)continue;
    const brandIndex=titleWords.findIndex(word=>word.toLowerCase()===match[1]!.toLowerCase());
    if(brandIndex<0)continue;
    const wanted=match[2]!.toLowerCase();
    const alias=wanted.includes('-')?wanted.split('-').at(-1)!:wanted;
    const codes=titleWords.slice(brandIndex+1,brandIndex+5).filter(word=>/[a-z]/i.test(word)&&/\d/.test(word)).map(word=>word.toLowerCase());
    if(codes.some(code=>code===wanted||code===alias))continue;
    if(codes.length)return true;
  }
  return false;
}

export function selectDocumentaryCandidates(candidates: DocumentaryCandidate[], entities: string[], used: Set<string>, years: string[] = [], allowUnlabelledStockVideos = false, refinedPhotoQueries: string[] = [], requirement?: DocumentaryRequirement): DocumentaryCandidate[] {
  const normalize = (text: string) => ` ${documentaryFuseModelSuffix(text).toLowerCase().normalize("NFKD").replace(/(?<=\p{L})\.(?=\p{L})/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
  const words = (text: string) => (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(word => !["the", "of", "and", "inc"].includes(word));
  const titleMatches = (candidate: DocumentaryCandidate) => entities.some(entity => normalize(candidate.title).includes(normalize(entity)));
  const yearsMatched = (candidate: DocumentaryCandidate) => years.filter(year => `${candidate.title} ${candidate.description} ${candidate.capturedAt ?? ""}`.includes(year)).length;
  const queryMatch = (candidate: DocumentaryCandidate) => {
    const terms = [...new Set(words(candidate.query).filter(word => !["video", "footage", "photo", "image", "view", "archive", "archival"].includes(word)))];
    const metadata = new Set(words(`${candidate.title} ${candidate.description}`));
    return terms.length ? terms.filter(term => metadata.has(term)).length / terms.length : 0;
  };
  const unique = new Set<string>();
  return candidates.filter(candidate => {
    if(requirement&&documentaryConflictingModelTitle(candidate,requirement))return false;
    if (documentaryProjectionIssue(candidate)) return false;
    if (candidate.bytes && candidate.bytes > 750 * 1024 * 1024) return false;
    if (candidate.width && candidate.height && (Math.max(candidate.width, candidate.height) < 640 || Math.min(candidate.width, candidate.height) < 350)) return false;
    if (candidate.kind === "video" && candidate.durationSeconds && candidate.durationSeconds < 1.5) return false;
    const key = documentaryCandidateKey(candidate);
    if (unique.has(key) || candidate.rights === "unknown") return false;
    unique.add(key);
    // Stock captions often name a class of object, not its proper name. Admission
    // is not approval: semantic ranking and real-frame inspection remain required.
    // A saved long source may show the named place only in one catalog range;
    // its overall filename must not exclude it before rankLocalCandidates runs.
    if (allowUnlabelledStockVideos && candidate.kind === "video" && (candidate.localPath || candidate.provider === "pexels" || candidate.provider === "pixabay")) return true;
    // The semantic repair can name a verified supporting location, while the
    // photo caption omits the requested technical class name. Keep that result
    // for semantic ranking + pixel review; a keyword filter is not an identity
    // verdict. Unrefined discovery and unknown rights keep their prior rules.
    if (allowUnlabelledStockVideos && candidate.kind === "image" && refinedPhotoQueries.some(query => normalize(query) === normalize(candidate.query))) return true;
    // A Russian (or other non-Latin) generic subject can have an English
    // discovery query and an English Commons caption. Literal entity matching
    // must not discard those results before the available semantic ranking.
    // This only admits a candidate: ranking and actual-pixel review still apply.
    if (allowUnlabelledStockVideos && candidate.kind === 'image' && entities.some(entity => /[^\p{Script=Latin}\p{N}\p{P}\p{Z}\p{S}]/u.test(entity))
      && /[a-z]/i.test(candidate.query) && /[a-z]/i.test(`${candidate.title} ${candidate.description}`)) return true;
    const metadata = normalize(`${candidate.title} ${candidate.description}`);
    const metadataWords = new Set(words(`${candidate.title} ${candidate.description}`));
    return !entities.length || entities.some(entity => {
      const terms = words(entity);
      if (metadata.includes(normalize(entity))) return true;
      // A vessel prefix distinguishes a named ship from its country/city namesake.
      // Matching only "United States" must not send lighthouse/building clips to AI.
      const vesselPrefix = /^(?:s\.?\s?s\.?|u\.?s\.?s\.?|r\.?m\.?s\.?|h\.?m\.?s\.?)\s+/i.test(entity);
      if (vesselPrefix) return false;
      return terms.length > 1 && terms.filter(term => metadataWords.has(term)).length / terms.length >= .5;
    });
  }).sort((a, b) => (requirement ? documentaryDetailScore(b, requirement) - documentaryDetailScore(a, requirement) : 0)
    || yearsMatched(b) - yearsMatched(a) || Number(titleMatches(b)) - Number(titleMatches(a)) || Number(b.match === "exact-metadata") - Number(a.match === "exact-metadata")
    || (allowUnlabelledStockVideos ? queryMatch(b) - queryMatch(a) : 0) || Number(used.has(a.id)) - Number(used.has(b.id)));
}

export class DocumentaryProjectService {
  private active = new Set<string>();
  private autoRuns = new Map<string, Promise<AutoStockSelectionResult>>();
  isSelecting(projectId:string) { return this.autoRuns.has(projectId); }
  private stopRequested = new Set<string>();
  private downloadControllers = new Map<string, AbortController>();
  private narrationWaits = new Map<string, (sceneId?: string) => Promise<void>>();
  async stop(projectId: string): Promise<void> {
    const run = this.autoRuns.get(projectId);
    if (!run) return;
    this.stopRequested.add(projectId);
    this.downloadControllers.get(projectId)?.abort();
    // Keep receiving an already-paid response and save it before stopping.
    await run.catch(() => {});
  }
  private sourceSelections = new Map<string, Promise<void>>();
  private sourceChecksums = new Map<string, string>();
  private selectedEvidence?: Promise<Map<string, string>>;
  private selectedFrameEvidence() {
    return this.selectedEvidence ??= (async () => {
      const evidence = new Map<string, string>();
      // Older excerpts can have only a generic source title in the catalog.
      // Recover exact-file search hints from saved accepted frame reviews. They
      // never transfer approval, voice, timing or an original's full range.
      for (const project of await this.projects.list?.({omitCandidates:true}) ?? []) {
        if (project.mediaMode !== "stock") continue;
        for (const scene of project.scenes) {
          const doc = scene.documentary, review = doc?.visualReview;
          if (!doc?.verified || !doc.checksum || review?.status !== "accepted") continue;
          const hint = [review.viewDescription, review.actionMatch && review.actionEvidence ? `Verified action in previous frame review: ${review.actionEvidence}` : undefined].filter(Boolean).join("\n");
          if (hint) evidence.set(doc.checksum, [evidence.get(doc.checksum), hint].filter(Boolean).join("\n").slice(0, 2400));
        }
      }
      return evidence;
    })();
  }
  private catalogIndex?: { stamp: number; entries: Promise<Array<{ file: string; asset: DocumentaryCandidate }>> };
  private catalogFiles = new Map<string, {revision: string; asset: DocumentaryCandidate}>();
  private catalogWords = new WeakMap<DocumentaryCandidate, {hint?: string; title: Set<string>; description: Set<string>; observed: Set<string>}>();
  private async catalogEntries() {
    const root = join(this.materialRoot, "Catalog");
    await mkdir(root, { recursive: true });
    const stamp = (await stat(root)).mtimeMs;
    if (this.catalogIndex?.stamp === stamp) return this.catalogIndex.entries;
    const next = new Map<string, {revision: string; asset: DocumentaryCandidate}>();
    const entries = (async () => {
      const files = (await readdir(root)).filter(name => /^[a-f0-9]{64}\.json$/.test(name));
      const result: Array<{file: string; asset: DocumentaryCandidate}> = new Array(files.length);
      let cursor = 0;
      // Adding one downloaded source used to reread every catalog JSON at once
      // (1683 files in the user's library). Retain unchanged entries and bound IO.
      const worker = async () => {
        for (let i = cursor++; i < files.length; i = cursor++) {
          const file = files[i]!, path = join(root, file), info = await stat(path, {bigint: true});
          const revision = `${info.ino}:${info.mtimeNs}:${info.size}`;
          const saved = this.catalogFiles.get(file);
          const entry = saved?.revision === revision ? saved : {revision, asset: JSON.parse(await readFile(path, 'utf8')) as DocumentaryCandidate};
          next.set(file, entry);
          result[i] = {file, asset: entry.asset};
        }
      };
      await Promise.all(Array.from({length: Math.min(8, files.length)}, worker));
      return result;
    })();
    this.catalogIndex = { stamp, entries };
    try {
      const result = await entries;
      if (this.catalogIndex?.entries === entries) this.catalogFiles = next;
      return result;
    } catch (error) { if (this.catalogIndex?.entries === entries) this.catalogIndex = undefined; throw error; }
  }
  private async reserveSource(key: string): Promise<() => void> {
    const previous = this.sourceSelections.get(key);
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    this.sourceSelections.set(key, current);
    await previous;
    return () => { if (this.sourceSelections.get(key) === current) this.sourceSelections.delete(key); release(); };
  }
  constructor(private readonly projects: Pick<ProjectService, "get" | "mutate"> & Partial<Pick<ProjectService, "list">>, private readonly storage: LocalProjectStorage,
    private readonly searcher: DocumentarySearch, private readonly materialRoot: string, private readonly stock: Pick<StockClient, "download"> & Partial<Pick<StockClient, "downloadToFile">>,
    private readonly publish: (progress: AutoStockProgress) => void = () => {},
    private readonly intelligence?: Pick<DocumentaryIntelligence, "plan" | "inspect" | "available"> & Partial<Pick<DocumentaryIntelligence, "rankCandidates" | "rankLocalCandidates" | "cataloguedCandidates" | "inspectForSelection" | "inspectPreview" | "inspectPreviewForScene" | "resolveIdentities" | "resolveVisualScopes" | "prepareSource" | "refineQueries">>,
    private readonly library?: EffectLibrary,
    private readonly youtube?: Pick<DocumentaryYouTube, "download"> & Partial<Pick<DocumentaryYouTube, "downloadAvailable"|"preview">>) {}

  async localCandidates(query: string): Promise<DocumentaryCandidate[]> {
    const candidates: Array<{ asset: DocumentaryCandidate; score: number }> = [];
    const ignored = new Set(["the", "of", "and", "at", "in", "on", "a", "an", "with", "for", "to", "by", "from", "view", "video", "footage", "photo", "photograph", "archive", "archival"]);
    const words = (text: string) => (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).map(word =>
      /^(?:open|opens|opened|opening)$/.test(word) ? "open"
        : /^(?:close|closes|closed|closing)$/.test(word) ? "close"
          : /^(?:dredge|dredges|dredged|dredging|dredger|dredgers)$/.test(word) ? "dredge" : word);
    const terms = [...new Set(words(query).filter(term => !ignored.has(term)))];
    if (!terms.length) return [];
    const evidence = await this.selectedFrameEvidence();
    for (const { file, asset } of await this.catalogEntries()) {
      // A previous search query is not evidence about the downloaded content.
      const hint = evidence.get(file.slice(0, -5));
      const enriched = hint ? { ...asset, description: `Previous frame review, a search hint requiring new visual verification: ${hint.slice(0, 1800)}\nOriginal source description:\n${asset.description ?? ""}` } : asset;
      let indexed = this.catalogWords.get(asset);
      if (!indexed || indexed.hint !== hint) {
        indexed = {hint, title: new Set(words(asset.title)), description: new Set(words(enriched.description ?? '')), observed: new Set(words(hint ?? ''))};
        this.catalogWords.set(asset, indexed);
      }
      const {title, description, observed} = indexed;
      const matches = terms.filter(term => title.has(term) || description.has(term));
      if (matches.length >= Math.min(2, terms.length)) candidates.push({ asset: { ...enriched, id: `local:${file.slice(0, -5)}`, provider: "local", query },
        score: matches.reduce((score, term) => score + (title.has(term) ? 3 : 1) + (observed.has(term) ? 2 : 0), 0) });
    }
    const ranked = candidates.sort((a, b) => b.score - a.score);
    const available: DocumentaryCandidate[] = [];
    for (const { asset } of ranked) {
      if (asset.localPath && await stat(asset.localPath).then(info => info.isFile(), () => false)) available.push(asset);
      if (available.length === 40) break;
    }
    return available;
  }

  private async cachedSource(candidate: DocumentaryCandidate): Promise<DocumentaryCandidate | undefined> {
    for (const { asset: source } of await this.catalogEntries()) {
      // Reuse by stable source identity, not by whatever search phrase found it.
      if (source.kind === candidate.kind && source.localPath && JSON.stringify(source.excerpt) === JSON.stringify(candidate.excerpt) && (source.provider === candidate.provider && source.id === candidate.id
        || candidate.downloadUrl && source.downloadUrl === candidate.downloadUrl)
        && await stat(source.localPath).then(info => info.isFile(), () => false)) return source;
    }
  }

  async search(projectId: string, sceneId: string, input: DocumentarySearchInput) {
    const { scene } = await this.editable(projectId, sceneId);
    const result = await this.searcher.search({ ...input, entities: input.entities ?? scene.documentary!.requirement.entities, years: input.years ?? scene.documentary!.requirement.years });
    const project = await this.changeScene(projectId, sceneId, current => ({ ...current, stockQuery: input.query,
      documentary: { ...current.documentary!, candidates: result.candidates,
        searchError: result.sources.filter(source => source.error).map(source => `${source.provider}: ${source.error}`).join("\n") || undefined } }));
    return { project, result };
  }

  async applyCandidate(projectId: string, sceneId: string, candidateId: string): Promise<Project> {
    const { scene } = await this.editable(projectId, sceneId);
    const candidate = scene.documentary!.candidates.find(candidate => candidate.id === candidateId);
    if (!candidate) throw new Error("Кандидат больше не доступен; повторите поиск");
    return this.apply(projectId, sceneId, candidate);
  }

  async importMaterial(projectId: string, sceneId: string, input: Parameters<DocumentaryApi["importDocumentaryMaterial"]>[2]): Promise<Project> {
    await this.editable(projectId, sceneId);
    if ((!input.path && !input.downloadUrl) || !input.title.trim()) throw new Error("Выберите файл или прямую ссылку и укажите название");
    const extension = extname(input.path ?? new URL(input.downloadUrl!).pathname).toLowerCase();
    const kind = /\.(mp4|mov|webm|mkv|wmv|avi|ogv)$/.test(extension) ? "video" : "image";
    const candidate: DocumentaryCandidate = { id: `manual:${randomUUID()}`, provider: input.path ? "local" : "web", kind, title: input.title,
      description: input.title, pageUrl: input.pageUrl, downloadUrl: input.downloadUrl ?? "", localPath: input.path,
      author: input.author, license: input.license, licenseUrl: input.licenseUrl, rights: "unknown",
      attribution: [input.author, input.pageUrl, input.license].filter(Boolean).join(" · "), query: input.title, retrievedAt: new Date().toISOString(), match: "unverified", concerns: ["Проверьте содержание и условия использования оригинала"] };
    return this.apply(projectId, sceneId, candidate);
  }

  async review(projectId: string, sceneId: string, input: Parameters<DocumentaryApi["reviewDocumentaryMaterial"]>[2]): Promise<Project> {
    const { scene } = await this.editable(projectId, sceneId);
    const selected = scene.documentary!.selected;
    if (!selected || !scene.documentary?.checksum) throw new Error("Сначала скачайте выбранный материал");
    if (input.verified && selected.rights === "unknown" && !input.rightsConfirmed) throw new Error("Подтвердите условия использования выбранного материала");
    if (input.illustrative && !input.note.trim()) throw new Error("Для иллюстративного кадра поясните отличие от названного объекта");
    const reviewed = await this.changeScene(projectId, sceneId, current => {
      if (current.documentary?.selected?.id !== selected.id) throw new Error("Материал изменился; проверьте новый выбор");
      return { ...current, documentary: { ...current.documentary!,
      verified: Boolean(input.verified), illustrative: Boolean(input.illustrative), reviewNote: input.note.slice(0, 2000),
      pinned: Boolean(input.verified), selected: { ...current.documentary!.selected!, rights: input.rightsConfirmed ? "user-confirmed" : current.documentary!.selected!.rights } } };
    });
    if (input.rightsConfirmed) {
      const path = join(this.materialRoot, "Catalog", `${scene.documentary.checksum}.json`);
      const catalog = await readFile(path, "utf8").then(text => JSON.parse(text) as DocumentaryCandidate, () => undefined);
      if (catalog) await atomicWrite(path, JSON.stringify({ ...catalog, rights: "user-confirmed" }, null, 2));
    }
    return reviewed;
  }

  async planSearch(projectId: string, sceneIds?: string[]): Promise<Project> {
    let project = await this.projects.get(projectId);
    if (!project) throw new Error("Проект не найден");
    if (project.mediaMode !== "stock" || project.settings.assembly.documentary?.version !== 2) throw new Error("Откройте Stock Documentary v2");
    if (project.status === "generating" || project.status === "paused") throw new Error("Сначала остановите производство");
    if (sceneIds?.some(id => !project!.scenes.some(scene => scene.id === id))) throw new Error("Сцена для подбора больше не существует");
    const inScope = (scene: Scene) => !sceneIds || sceneIds.includes(scene.id);
    const restored=await recoverDocumentaryPlanContext(project,this.storage.projectDirectory(projectId),sceneIds);
    if(restored.size)project=await this.projects.mutate(projectId,current=>({scenes:current.scenes.map(scene=>{
      const recovery=restored.get(scene.id);
      if(!recovery||scene.documentary?.pinned||scene.narration!==recovery.previous.text||JSON.stringify(scene.documentary?.requirement)!==JSON.stringify(recovery.previous))return scene;
      const restoredScene=applyDocumentaryRequirement(scene,recovery.restored);
      return {...restoredScene,documentary:{...restoredScene.documentary!,verified:false,
        autoError:'Восстановлены исходные поисковые запросы из сохранённого плана. Материал и озвучка сохранены; соответствие кадра рассказу нужно проверить заново.'}};
    })}),{candidateSceneIds:[]});
    project = await this.projects.mutate(projectId, current => ({ scenes: groundDocumentaryScenes(current.scenes).map(scene => inScope(scene) ? scene : current.scenes.find(item => item.id === scene.id)!) }),{candidateSceneIds:[]});
    const pending = project.scenes.filter(scene => inScope(scene) && scene.includeInAssembly !== false && scene.documentary?.requirement.plannedBy !== "semantic" && !scene.documentary?.pinned);
    if (!pending.length && !this.intelligence?.resolveIdentities) return project;
    if (!this.intelligence) throw new Error("Автоматический смысловой анализ Stock недоступен");
    const saveBatch = (plan: Map<string, DocumentaryRequirement>) => this.projects.mutate(projectId, current => {
      if (current.videoBrief?.readyScript !== project!.videoBrief?.readyScript || current.status === "generating" || current.status === "paused") throw new Error("Проект изменился во время анализа");
      return { scenes: groundDocumentaryScenes(current.scenes.map(scene => {
        const requirement = plan.get(scene.id);
        return requirement && scene.narration === requirement.text && scene.documentary && !scene.documentary.pinned
          ? applyDocumentaryRequirement(scene, requirement) : scene;
      })).map(scene => inScope(scene) ? scene : current.scenes.find(item => item.id === scene.id)!) };
    },{candidateSceneIds:[]});
    if (pending.length) {
      const plan = await this.intelligence.plan(project, pending, async batch => { await saveBatch(batch); },{
        shouldStop:()=>this.stopRequested.has(projectId),progress:message=>this.publish({projectId,phase:'preparing',completed:0,total:pending.length,selected:0,skipped:0,failed:0,message})});
      project = await saveBatch(plan);
    }
    const legacy = project.scenes.filter(scene => inScope(scene) && scene.includeInAssembly !== false && scene.documentary && !scene.documentary.pinned && scene.documentary.requirement.identityContextVersion !== 3);
    if (legacy.length && this.intelligence.resolveIdentities) {
      await this.intelligence.resolveIdentities(project, legacy, async batch => { project = await saveBatch(batch); },{
        shouldStop:()=>this.stopRequested.has(projectId),progress:message=>this.publish({projectId,phase:'preparing',completed:0,total:legacy.length,selected:0,skipped:0,failed:0,message})});
    }
    return project;
  }

  async autoSelect(projectId: string, options: AutoStockSelectionOptions = {}, waitForNarration?: (sceneId?: string) => Promise<void>): Promise<AutoStockSelectionResult> {
    const active = this.autoRuns.get(projectId); if (active) return active;
    this.selectedEvidence = undefined;
    this.stopRequested.delete(projectId);
    this.downloadControllers.set(projectId, new AbortController());
    if (waitForNarration) this.narrationWaits.set(projectId, waitForNarration);
    const run = (async () => {
      const attempts = new Map<string,{scope:string;keys:Set<string>;found:boolean}>();
      const session=new DocumentarySelectionSession();
      await this.repairFailedIdentities(projectId, options.sceneIds);
      let result = await this.selectAll(projectId, options, false, attempts,session);
      if (result.failed && !this.stopRequested.has(projectId) && await this.repairFailedIdentities(projectId, options.sceneIds))
        result = await this.selectAll(projectId, options, false, attempts,session);
      if (!result.failed || !this.intelligence?.refineQueries || this.stopRequested.has(projectId)) return result;
      const failed = result.project.scenes.filter(scene => scene.includeInAssembly !== false && (!options.sceneIds || options.sceneIds.includes(scene.id))
        && scene.documentary && !scene.documentary.verified && !scene.documentary.pinned && !scene.documentary.requirement.searchRefined
        // A rate limit at one provider must not suppress query repair when
        // other providers returned licensed candidates that failed relevance.
        // With no candidates, wait for the unavailable source instead of
        // spending a paid refinement on an outage.
        && (!documentarySearchUnavailable(scene.documentary.searchError)
          || attempts.get(scene.id)?.found)
        && (session.canAttempt(scene.id,'video')||session.canAttempt(scene.id,'image'))
        && !/pending|partial|неопредел|оплачен|ожидает ответа/i.test(scene.documentary.autoError ?? '')).slice(0, 24);
      if (!failed.length) return result;
      this.publish({ projectId, phase: 'preparing', completed: result.total - result.failed, total: result.total, selected: result.selected, skipped: result.skipped, failed: result.failed,
        message: `Уточняю поисковые запросы ${failed.length} неподтверждённых кадров; готовые материалы сохранены…` });
      const queries = await this.intelligence.refineQueries(result.project, failed);
      if (this.stopRequested.has(projectId)) throw new DOMException('Подбор остановлен пользователем', 'AbortError');
      let changed = false;
      await this.projects.mutate(projectId, current => ({ scenes: current.scenes.map(scene => {
        const before = failed.find(item => item.id === scene.id), next = queries.get(scene.id), doc = scene.documentary;
        if (!before || !next?.length || !doc || doc.verified || doc.pinned || scene.narration !== before.narration
          || JSON.stringify(doc.requirement) !== JSON.stringify(before.documentary!.requirement)) return scene;
        changed ||= JSON.stringify(next) !== JSON.stringify(doc.requirement.queries);
        return { ...scene, documentary: { ...doc, requirement: { ...doc.requirement, queries: next, searchRefined: true } } };
      }) }),{candidateSceneIds:[]});
      // Exactly one second pass. The persisted marker prevents repeated paid
      // rewrites on resume; source/inspection checkpoints still guard each call.
      return changed ? this.selectAll(projectId, options, false, attempts,session) : result;
    })(); this.autoRuns.set(projectId, run);
    try { return await run; }
    catch (error) {
      const project = await this.projects.get(projectId);
      const scenes = project?.scenes.filter(scene => scene.includeInAssembly !== false && (!options.sceneIds || options.sceneIds.includes(scene.id))) ?? [];
      const ready = scenes.filter(scene => scene.documentary?.verified).length;
      this.publish({ projectId, phase: this.stopRequested.has(projectId) ? "stopped" : "failed", completed: ready, total: scenes.length, selected: 0, skipped: ready, failed: this.stopRequested.has(projectId) ? 0 : Math.max(1, scenes.length - ready),
        message: `${error instanceof Error ? error.message : String(error)}. Готовые материалы сохранены; подбор можно продолжить.` });
      throw error;
    } finally { this.autoRuns.delete(projectId); this.downloadControllers.delete(projectId); this.narrationWaits.delete(projectId); }
  }

  private async repairFailedIdentities(projectId: string, sceneIds?: string[]): Promise<boolean> {
    if (!this.intelligence?.resolveIdentities) return false;
    const project = await this.projects.get(projectId);
    if (!project) return false;
    const failed = project.scenes.filter(scene => scene.includeInAssembly !== false && (!sceneIds || sceneIds.includes(scene.id))
      && !scene.documentary?.verified && !scene.documentary?.pinned && scene.documentary?.requirement.identities?.length
      && !documentarySearchUnavailable(scene.documentary.searchError)
      && !scene.documentary.requirement.identityRepairVersion
      && /именованн|identity|identifiedEntity|requiredIdentity/i.test(scene.documentary.autoError ?? ''));
    if (!failed.length) return false;
    let changed = false;
    await this.intelligence.resolveIdentities(project, failed, async plan => {
      await this.projects.mutate(projectId, current => ({scenes:current.scenes.map(scene => {
        const before=failed.find(item=>item.id===scene.id), next=plan.get(scene.id), doc=scene.documentary;
        if (!before || !next || !doc || doc.verified || doc.pinned || scene.narration!==before.narration
          || JSON.stringify(doc.requirement)!==JSON.stringify(before.documentary!.requirement)) return scene;
        changed ||= JSON.stringify(next.identities)!==JSON.stringify(doc.requirement.identities);
        return {...scene,documentary:{...doc,requirement:{...next,identityRepairVersion:1}}};
      })}),{candidateSceneIds:[]});
    }, {shouldStop:()=>this.stopRequested.has(projectId),progress:message=>this.publish({projectId,phase:'preparing',completed:project.scenes.filter(s=>s.documentary?.verified).length,total:project.scenes.length,selected:0,skipped:0,failed:failed.length,message})});
    return changed;
  }

  private async selectAll(projectId: string, options: AutoStockSelectionOptions, videoOnly = false, attempts = new Map<string,{scope:string;keys:Set<string>;found:boolean}>(),session=new DocumentarySelectionSession()): Promise<AutoStockSelectionResult> {
    this.publish({ projectId, phase: "preparing", completed: 0, total: 0, selected: 0, skipped: 0, failed: 0, message: "Подготавливаю поиск и проверку материалов…" });
    const waitForNarration = this.narrationWaits.get(projectId);
    let project = waitForNarration ? (await this.projects.get(projectId,{omitCandidates:true}))! : await this.planSearch(projectId, options.sceneIds);
    if (!project || waitForNarration && project.scenes.some(scene => scene.includeInAssembly !== false && scene.documentary?.requirement.plannedBy !== "semantic")) throw new Error("Сначала подготовьте поисковой план");
    const visualScopeScenes=project.scenes.filter(scene=>(!options.sceneIds||options.sceneIds.includes(scene.id))
      &&scene.includeInAssembly!==false&&scene.documentary?.requirement.identityContextVersion===3
      &&scene.documentary.requirement.identities?.length&&!scene.documentary.requirement.visualScope
      &&!scene.documentary.verified&&!scene.documentary.pinned);
    if(visualScopeScenes.length&&this.intelligence?.resolveVisualScopes){
      const readyScript=project.videoBrief?.readyScript;
      await this.intelligence.resolveVisualScopes(project,visualScopeScenes,async plan=>{
        project=await this.projects.mutate(projectId,current=>{
          if(current.videoBrief?.readyScript!==readyScript)throw new Error('Сценарий изменился во время определения вида кадра');
          return {scenes:current.scenes.map(scene=>{
            const requirement=plan.get(scene.id);
            const original=visualScopeScenes.find(item=>item.id===scene.id);
            return requirement&&original&&scene.narration===original.narration
              &&JSON.stringify(scene.documentary?.requirement)===JSON.stringify(original.documentary?.requirement)
              &&!scene.documentary?.verified&&!scene.documentary?.pinned
              ?applyDocumentaryRequirement(scene,requirement):scene;
          })};
        },{candidateSceneIds:[]});
      },{shouldStop:()=>this.stopRequested.has(projectId),progress:message=>this.publish({projectId,phase:'preparing',completed:0,total:visualScopeScenes.length,selected:0,skipped:0,failed:0,message})});
    }
    const changeScene = (sceneId: string, change: (scene: Scene) => Scene) => this.changeScene(projectId, sceneId, change, Boolean(waitForNarration));
    project = await this.projects.mutate(projectId, current => ({ scenes: current.scenes.map(scene => {
      const issue = documentarySavedQualityIssue(current,scene)||documentarySavedIdentityIssue(scene)||documentarySavedContextIssue(current,scene);
      return issue && (!options.sceneIds || options.sceneIds.includes(scene.id))
        ? { ...scene, documentary: { ...scene.documentary!, verified: false, autoError: issue, reviewNote: issue } } : scene;
    }) }),{candidateSceneIds:[]});
    project=await this.projects.mutate(projectId,current=>({scenes:planDocumentaryMontage(current,true).map(scene=>!options.sceneIds||options.sceneIds.includes(scene.id)?scene:current.scenes.find(s=>s.id===scene.id)!)}),{candidateSceneIds:[]});
    if (!options.sceneIds && !waitForNarration) project = await this.applyPlannedEffects(projectId);
    const inScope = (scene: Scene) => !options.sceneIds || options.sceneIds.includes(scene.id);
    // Upgrade old source covers locally before checking visual variety. No AI,
    // no replacement of selected media, voice, trim positions or manual pins.
    const posters: Scene[] = [];
    for (const scene of project.scenes) if (scene.documentary?.verified && scene.videoPath) posters.push(await prepareDocumentaryRangePoster(this.storage.projectDirectory(projectId), scene));
    if (posters.length) project = await this.projects.mutate(projectId, current => ({ scenes: current.scenes.map(scene => {
      const source = project.scenes.find(item => item.id === scene.id), prepared = posters.find(item => item.id === scene.id);
      return prepared && source?.videoPath === scene.videoPath && source?.imagePath === scene.imagePath && source?.trimStartSeconds === scene.trimStartSeconds && source?.trimEndSeconds === scene.trimEndSeconds
        ? { ...scene, imagePath: prepared.imagePath, documentary: { ...scene.documentary!, visualReview: scene.documentary?.visualReview
          ? { ...scene.documentary.visualReview, frameHash: prepared.documentary?.visualReview?.frameHash } : undefined } } : scene;
    }) }),{candidateSceneIds:[]});
    project = await this.projects.mutate(projectId, current => {
      const checked = revalidateDocumentaryVariety(current);
      return { scenes: current.scenes.map((scene, index) => inScope(scene) ? checked[index]! : scene) };
    },{candidateSceneIds:[]});
    const scenes = project.scenes.filter(scene => inScope(scene) && scene.includeInAssembly !== false).sort((a, b) => a.order - b.order);
    if (scenes.length && (options.force || scenes.some(scene => !scene.documentary?.verified || documentaryNeedsVideo(scene))) && (!this.intelligence || !await this.intelligence.available())) throw new Error("Для проверки реальных кадров нужен доступный AnyModel");
    const failures: AutoStockSelectionResult["failures"] = [];
    const recoveredContext=await readDocumentaryContextRecovery(this.storage.projectDirectory(projectId));
    const blockedCatalogs = new Set<string>();
    const photoFirst = documentaryPhotoFirstScenes(project);
    let skipped = 0, completed = 0, selected = 0;
    const activeScenes = new Set<string>();
    const relatedSources=(scene:Scene,kind:'image'|'video')=>session.related(scene.documentary!.requirement,kind,query=>
      measureDocumentaryStage('search-related',{projectId,sceneId:scene.id},()=>this.searcher.search({query,kind,
        entities:documentarySearchSubjects(scene.documentary!.requirement),years:scene.documentary!.requirement.years,
        providers:['commons','internet-archive','local','pexels','pixabay',...(kind==='video'&&this.youtube?['youtube' as const]:[])]},true)));
    const selectScene = async (scene: Scene) => {
      if (this.stopRequested.has(projectId)) return;
      let project = (await this.projects.get(projectId,{omitCandidates:true}))!;
      if (videoOnly && documentaryVideoCoverage(project.scenes).percent >= project.settings.stockVideoPercent) { skipped++; completed++; return; }
      // An old approval needs current evidence, not another search/download.
      // Replay a completed actual-frame check first, with POSTs disabled.
      if(!scene.documentary?.verified&&!scene.documentary?.pinned&&scene.documentary?.visualReview?.status==='accepted'
        &&scene.documentary.selected&&this.intelligence?.inspectForSelection&&!options.force
        &&!documentaryContradictoryModelYear(scene.documentary.selected,scene.documentary.requirement,documentarySceneContext(project,scene))
        &&!documentarySavedIdentityIssue({...scene,documentary:{...scene.documentary,verified:true}})){
        try{
          this.publish({projectId,phase:'applying',completed,total:scenes.length,selected,skipped,failed:failures.length,currentSceneId:scene.id,
            message:`Кадр ${scene.order+1}: проверяю сохранённый анализ без нового платного запроса…`});
          let review:Awaited<ReturnType<DocumentaryIntelligence['inspectForSelection']>>['review']|undefined;
          try { review=(await this.intelligence.inspectForSelection(project,scene,undefined,()=>Boolean(fatal)||this.stopRequested.has(projectId),true)).review; }
          catch(error){ if(!(error instanceof DocumentaryCachedAnalysisMissing))throw error; }
          if((scene.documentary.selected.kind==='image'&&scene.imagePath
              ||scene.documentary.selected.kind==='video'&&scene.videoPath&&scene.documentary.selected.durationSeconds!==undefined
                &&scene.documentary.selected.durationSeconds<=45)
            &&!scene.documentary.visualReview.contextApproval
            &&(!review||review.status==='uncertain')&&!this.stopRequested.has(projectId)){
            this.publish({projectId,phase:'applying',completed,total:scenes.length,selected,skipped,failed:failures.length,currentSceneId:scene.id,
              message:`Кадр ${scene.order+1}: проверяю сохранённый оригинал по текущему тексту…`});
            review=(await this.intelligence.inspectForSelection(project,scene,undefined,()=>Boolean(fatal)||this.stopRequested.has(projectId),false,true)).review;
          }
          if(!review)throw new DocumentaryCachedAnalysisMissing('Готовой проверки сохранённого оригинала нет');
          const restored={...scene,trimStartSeconds:review.trimStartSeconds??0,trimEndSeconds:review.trimEndSeconds,
            documentary:{...scene.documentary,verified:review.status==='accepted',visualReview:review}};
          if(restored.documentary.verified&&review.contextApproval&&!documentarySavedContextIssue(project,restored)
            &&!documentaryVarietyIssue(project,restored)&&!documentaryReuseIssue(project,restored)){
            const prepared=await prepareDocumentaryRangePoster(this.storage.projectDirectory(projectId),restored);
            project=await changeScene(scene.id,latest=>{
              if(latest.documentary?.checksum!==scene.documentary?.checksum||latest.narration!==scene.narration||latest.documentary?.pinned!==scene.documentary?.pinned)return latest;
              const updated={...latest,imagePath:prepared.imagePath,trimStartSeconds:restored.trimStartSeconds,trimEndSeconds:restored.trimEndSeconds,
                documentary:{...latest.documentary!,verified:true,visualReview:prepared.documentary!.visualReview,reviewNote:review.reason,autoError:undefined}};
              return documentarySavedContextIssue(project,updated)?latest:updated;
            });
            scene=project.scenes.find(item=>item.id===scene.id)!;
          }
        }catch(error){
          if(this.stopRequested.has(projectId))return;
          recordDiagnosticEvent('info','documentary.analysis.saved-context-not-restored',{projectId,sceneId:scene.id,reason:error instanceof Error?error.name:'Error',paidRequests:0});
        }
      }
      const previousReady = Boolean(scene.documentary?.verified && scene.documentary.selected && await stat(scene.videoPath || scene.imagePath || "").then(() => true, () => false));
      // Ready photo fallbacks are useful. Upgrade them only in the measured
      // coverage pass, not on every resume merely because the planner wanted video.
      const upgradePhoto = previousReady && videoOnly;
      const varietyIssue = previousReady && (documentaryDistraction(scene, scene.documentary?.visualReview?.viewDescription ?? "") || documentaryVarietyIssue(project, scene));
      if (previousReady && (scene.documentary?.pinned || !options.force && !upgradePhoto && !varietyIssue)) { skipped++; completed++; return; }
      activeScenes.add(scene.id);
      let accepted = false, youtubeTimedOut = false, foundThisRun = false;
      this.publish({ projectId, phase: "searching", completed, total: scenes.length, selected, skipped, failed: failures.length,
        currentSceneId: scene.id, currentSceneNumber: scene.order + 1, message: `Ищу точный материал: ${scene.stockQuery || scene.title}` });
      try {
        const requirement = scene.documentary!.requirement;
        const searchSubjects = documentarySearchSubjects(requirement);
        // Reuse downloaded footage before repeating internet searches. A saved
        // photo remains in place while we try to upgrade it to verified video.
        const remoteStages = (kind: "video" | "image") => [
          { kind, localOnly: false, quick: true }, { kind, localOnly: false, quick: false }
        ];
        // General illustrations can be filled by short stock first. A long
        // already-downloaded documentary can require a costly new range index
        // for this unrelated scene; keep it as a fallback after stock search.
        const localVideo={kind:"video" as const,localOnly:true,quick:false};
        const videos=documentaryGeneralIllustration(scene)
          ?[...remoteStages('video'),localVideo]:[localVideo,...remoteStages('video')];
        const photos = remoteStages("image");
        const stages = videoOnly ? videos : photoFirst.has(scene.id)||documentaryPhotoFirstScenes(project).has(scene.id) ? [...photos, ...videos] : [...videos, ...photos];
        // Search rewrites change where we look, not what already-inspected
        // pixels show. Carry attempts across passes of this run. A changed
        // narrative target gets a fresh set; later manual resumes remain allowed.
        const scope=JSON.stringify([documentaryNarrationContext(project,scene),requirement.entities,requirement.identities,requirement.years,requirement.detail,scene.documentary?.motionGraphic]);
        const visualScopeParts=[scope,project.aspectRatio,requirement.preferredKind,scene.documentary?.layout];
        const oldRejectionScope=createHash('sha256').update(JSON.stringify(['visual-rejection-v1',...visualScopeParts])).digest('hex');
        // Old visual refusals on an audience CTA were based on the mistaken
        // demand to show a literal subscription action. Reconsider those
        // known refusals under the corrected on-topic background policy, but
        // retain unknown paid submissions under their original scope.
        const rejectionScope=documentaryCallToActionIllustration(scene)
          ?createHash('sha256').update(JSON.stringify(['visual-rejection-cta-v2',...visualScopeParts])).digest('hex')
          :oldRejectionScope;
        const rejectionPath=join(this.storage.projectDirectory(projectId),'Documentary',scene.id.replace(/[^a-zA-Z0-9_-]/g,'_'),'rejected-candidates.json');
        const rejectedCandidates=await readDocumentaryRejections(rejectionPath,rejectionScope);
        // A Creative Commons video's HD hint does not guarantee an MP4 format
        // the editor can use. A failed yt-dlp format selection is deterministic
        // for this selector; persist it across app restarts, but invalidate the
        // refusal if the accepted format policy changes.
        const requiresWideVideo=documentaryQualityPresentation(scene)!=='subject-card';
        const formatScope=createHash('sha256').update(JSON.stringify(['youtube-format-v1',documentaryYouTubeFormatSelector(requiresWideVideo)])).digest('hex');
        const formatPath=join(this.storage.projectDirectory(projectId),'Documentary',scene.id.replace(/[^a-zA-Z0-9_-]/g,'_'),'unavailable-formats.json');
        const unavailableFormats=await readDocumentaryRejections(formatPath,formatScope);
        const formatUnavailable=(candidate:DocumentaryCandidate)=>candidate.provider==='youtube'&&!candidate.localPath
          &&((requiresWideVideo&&documentaryLikelyPortraitShort(candidate))
            ||unavailableFormats.has(rejectedCandidateFingerprint(candidate))
            ||session.isUnavailableFormat(formatScope,rejectedCandidateFingerprint(candidate)));
        // A paid inspection with an unknown outcome is not a visual rejection:
        // keep the source for manual review, but never download it again merely
        // to rediscover the same pending/partial completion on auto resume.
        const uncertainPath=join(this.storage.projectDirectory(projectId),'Documentary',scene.id.replace(/[^a-zA-Z0-9_-]/g,'_'),'uncertain-candidates.json');
        const uncertainCandidates=await readDocumentaryRejections(uncertainPath,oldRejectionScope);
        const isUncertain=(candidate:DocumentaryCandidate)=>uncertainCandidateFingerprints(candidate).some(key=>uncertainCandidates.has(key));
        const rememberUncertain=async(candidate:DocumentaryCandidate,checksum?:string)=>{
          const keys=[...uncertainCandidateFingerprints(candidate),...(checksum?[uncertainFileFingerprint(checksum)]:[])];
          if(keys.every(key=>uncertainCandidates.has(key)))return;
          for(const key of keys)uncertainCandidates.add(key);
          await saveDocumentaryRejections(uncertainPath,oldRejectionScope,uncertainCandidates).catch(()=>{
            recordDiagnosticEvent('warn','documentary.search.uncertain-cache-write-failed',{projectId,sceneId:scene.id});
          });
        };
        const previousAttempts=attempts.get(scene.id);
        const tried=previousAttempts?.scope===scope?previousAttempts.keys:new Set<string>();
        const attemptState={scope,keys:tried,found:previousAttempts?.scope===scope&&previousAttempts.found||false};
        attempts.set(scene.id,attemptState);
        // The early stock attempt shares the existing remote review budget.
        // It must not add another set of paid checks before the broad fallback.
        const inspectionCounts = new Map<string, number>();
        const attemptCounts = new Map<string, number>();
        const deferredLocal = new Map<'image'|'video',DocumentaryCandidate[]>();
        // A successful photo search must not erase a video provider's outage.
        const sourceErrors: string[] = [];
        for (const { kind, localOnly, quick } of stages) {
          if (fatal || this.stopRequested.has(projectId)) return;
          if (accepted) break;
          if (!session.canAttempt(scene.id,kind)) continue;
          // The metadata shortcut explicitly rejects named identities/dates.
          // Do not wait for a stock-only pass that cannot accept any result;
          // the normal discovery includes the same providers concurrently.
          if (quick && (requirement.identities?.length !== 0 || requirement.years.length)) continue;
          const inspectionKey = `${kind}:${localOnly ? "local" : "remote"}`;
          const inspectionLimit = upgradePhoto ? 1 : kind === "video" ? 4 : 2;
          let inspections = inspectionCounts.get(inspectionKey) ?? 0;
          if (inspections >= inspectionLimit) continue;
          const pool: DocumentaryCandidate[] = !localOnly&&!quick?[...(deferredLocal.get(kind)??[])]:[];
          const searchStarted=Date.now();
          const context=documentarySceneContext(project,scene);
          const sourceQueries=documentarySearchQueries(requirement,kind,context);
          const plannedQueries=documentaryGeneralIllustration(scene)||kind==='image'&&documentaryGeneralDiagramScope(context,requirement.identities)?sourceQueries
            :documentaryDatedSearchQueries(sourceQueries,documentaryNarrationContext(project,scene));
          const linkedModelYear=kind==='video'?documentaryContinuityModelYear(requirement,context):undefined;
          const datedModel=linkedModelYear&&requirement.years.length===0&&requirement.identities?.length===1
            ?`${requirement.identities[0]!.name} ${linkedModelYear}`:undefined;
          const queries=datedModel&&!plannedQueries.some(query=>query.toLowerCase()===datedModel.toLowerCase())
            ?[datedModel,...plannedQueries].slice(0,4):plannedQueries;
          const discover = async (query: string, providers: NonNullable<DocumentarySearchInput["providers"]>) => {
            // Search results are transient until the final shortlist. Persisting
            // the whole project after EVERY provider query flooded the UI/IPC.
            const result = await measureDocumentaryStage("search", { projectId, sceneId: scene.id, providers }, () => this.searcher.search({ query, kind, providers, entities: searchSubjects, years: requirement.years },true));
            if(kind==='video'&&providers.includes('youtube'))session.rememberVideos(requirement,result.candidates);
            for (const source of result.sources.filter(source => source.error)) {
              const message = `${source.provider}: ${source.error}`;
              if (!sourceErrors.includes(message)) sourceErrors.push(message);
            }
            return result.candidates.filter(item => item.kind === kind && !tried.has(item.id)
              &&!rejectedCandidates.has(rejectedCandidateFingerprint(item))
              &&!isUncertain(item)&&!formatUnavailable(item));
          };
          if (localOnly) {
            const current = (await this.projects.get(projectId,{omitCandidates:true}))!;
            pool.push(...current.scenes.flatMap(item => item.documentary?.selected?.kind === "video" && item.documentary.selected.localPath ? [item.documentary.selected] : []));
            for (const query of queries) pool.push(...(await this.localCandidates(query)).filter(item => item.kind === "video"));
            if (pool.length) foundThisRun = true;
          }
          if (quick) {
            // These same queries/providers belong to the broad search below;
            // its existing provider cache reuses them if this attempt fails.
            // Only a locally obvious candidate is eligible, never a paid rank
            // against an incomplete pool. Actual-frame inspection is unchanged.
            const quickQueries = [...new Set([...(kind === "video" ? documentaryStockQueries(requirement) : []), ...queries])].slice(0, 2);
            const broad = kind === 'video' && documentaryGeneralIllustration(scene)
              && !documentaryGeneralActionIssue(scene) && !documentaryRequiredVisiblePart(scene.narration)
              ? documentaryBroadIllustrationStockQuery(requirement) : undefined;
            if (broad && !quickQueries.includes(broad)) quickQueries.push(broad);
            for (const query of quickQueries) {
              if (fatal || this.stopRequested.has(projectId)) return;
              pool.push(...await discover(query, ["pexels", "pixabay"]));
              if (pool.length) foundThisRun = true;
              if (documentaryMetadataShortlist(scene, pool).length) break;
            }
          }
          session.accountSearch(scene.id,kind,Date.now()-searchStarted);
          let waitingAt=Date.now();
          const requiredImagePart=kind==='image'&&documentaryGeneralDiagramScope(context,requirement.identities)
            ?documentaryRequiredVisiblePart(scene.narration):undefined;
          // Reuse only a concise, exact-title video that the existing local
          // shortlist can send straight to actual-frame review. A weaker
          // shared pool must not create a new paid ranking ahead of a saved
          // uncertain ranking for this scene.
          const completedRelated=kind==='video'&&requirement.identities?.length
            ?session.completedRelated(requirement,kind):undefined;
          const reusable=completedRelated?documentaryMetadataShortlist(scene,completedRelated.candidates.filter(item=>item.kind===kind
            &&!tried.has(documentaryCandidateKey(item))
            &&!rejectedCandidates.has(rejectedCandidateFingerprint(item))
            &&!isUncertain(item)&&!formatUnavailable(item))).map(item=>({...item,match:'unverified' as const})):undefined;
          const batches=localOnly||quick?(async function*(){yield [] as DocumentaryCandidate[];})():discoverDocumentarySourceBatches({kind,queries,
            coalesceMs:kind==='video'?200:0,
            reused:reusable,
            stockQueries:kind==='video'&&this.intelligence!.rankCandidates?documentaryStockQueries(requirement):[],
            // Preserve two precise searches for part/action/date scenes. A
            // single named establishing view may use its exact subject as the
            // second query before stale or weak captions dominate the pool.
            youtubeQueries:kind==='video'&&this.youtube?documentaryYouTubeQueries(requirement,queries,scene.narration):[],
            discover,stopped:()=>Boolean(fatal)||this.stopRequested.has(projectId)||session.searchRemaining(scene.id,kind)-(Date.now()-waitingAt)<=0,
            firstBatchReady:requiredImagePart&&this.intelligence!.rankCandidates
              ?first=>documentaryFirstImageBatchWorthInspecting(first,requiredImagePart)
              :kind==='video'&&this.youtube&&this.intelligence!.rankCandidates
              ?first=>session.searchRemaining(scene.id,kind)-(Date.now()-waitingAt)<10_000
                ||documentaryFirstVideoBatchWorthInspecting(first,requirement,scene.narration):undefined,
            deferredBatchReady:requiredImagePart&&this.intelligence!.rankCandidates
              ?batch=>documentaryFirstImageBatchWorthInspecting(batch,requiredImagePart)
              :kind==='video'&&this.youtube&&this.intelligence!.rankCandidates
                &&requirement.identities?.length===1&&!requirement.years.length
                &&!documentaryRequiredVisiblePart(scene.narration)
              ?batch=>Date.now()-searchStarted>=8000||documentaryFirstVideoBatchWorthInspecting(batch,requirement,scene.narration):undefined,
            supplement:async()=>{
              const shared=await relatedSources(scene,kind);
              for(const source of shared.sources.filter(source=>source.error)){
                const message=`${source.provider}: ${source.error}`;if(!sourceErrors.includes(message))sourceErrors.push(message);
              }
              return shared.candidates;
            }});
          let retryDirectStill=false;
          try {
          while(!accepted&&session.canAttempt(scene.id,kind)&&inspections<inspectionLimit&&(attemptCounts.get(inspectionKey)??0)<inspectionLimit){
          waitingAt=Date.now();
          let batch:IteratorResult<DocumentaryCandidate[]>;
          try { batch=await batches.next(); }
          finally { session.accountSearch(scene.id,kind,Date.now()-waitingAt); }
          if(batch.done){
            if(!retryDirectStill)break;
            // Reconsider the remaining pool normally when the exact still
            // failed and no further search result will arrive.
            retryDirectStill=false;
            batch={done:false,value:[]};
          }
          pool.push(...batch.value);
          if (batch.value.length) foundThisRun = true;
          const latestProject = (await this.projects.get(projectId,{omitCandidates:true}))!;
          const used = new Set(latestProject.scenes.filter(item => item.id !== scene.id).flatMap(item => item.documentary?.selected?.kind === "image" ? [item.documentary.selected.id] : []));
          const candidates = selectDocumentaryCandidates(pool.filter(candidate => !rejectedCandidates.has(rejectedCandidateFingerprint(candidate))
            &&!formatUnavailable(candidate)
            &&!isUncertain(candidate)
            &&!documentaryContradictoryModelYear(candidate,requirement,context)
            &&!recoveredContext.scenes[scene.id]?.sourceKeys.includes(documentaryCandidateKey(candidate))
            && !documentaryKnownQualityIssue(candidate,latestProject,scene)
            && !tried.has(documentaryCandidateKey(candidate)) && !blockedCatalogs.has(documentaryCandidateKey(candidate)) && (candidate.localPath || candidate.provider !== "youtube" || this.youtube?.downloadAvailable?.() !== false)
            && (candidate.kind !== "image" || !documentaryReuseIssue(latestProject, { ...scene, documentary: { ...scene.documentary!, selected: candidate, checksum: undefined, visualHash: undefined } }))
            && !documentaryVarietyIssue(latestProject, { ...scene, documentary: { ...scene.documentary!, selected: candidate, checksum: undefined, visualHash: undefined, visualReview: undefined } })), searchSubjects, used, requirement.years, Boolean(this.intelligence!.rankCandidates),
            kind==='image'&&documentaryGeneralDiagramScope(context,requirement.identities)?sourceQueries:requirement.queries, requirement);
          if(candidates.length)attemptState.found=true;
          const earlyCandidates = quick ? documentaryMetadataShortlist(scene, candidates).slice(0, 1) : [];
          if (quick && !earlyCandidates.length) continue;
          await changeScene(scene.id, current => ({ ...current, documentary: { ...current.documentary!,
            // A refined query may return only sources already tried in this
            // pass. Keep the previous shortlist available for manual review
            // when the narrative target has not changed.
            candidates:candidates.length?candidates:attemptState.found&&current.narration===scene.narration
              &&JSON.stringify(current.documentary?.requirement)===JSON.stringify(requirement)
              ?current.documentary?.candidates??[]:[],
            searchError: sourceErrors.join("\n") || undefined } }));
          let localOrder = localOnly ? [...candidates].sort((a, b) => documentaryDetailScore(b, requirement) - documentaryDetailScore(a, requirement)) : candidates;
          if (localOnly && this.intelligence!.rankLocalCandidates) {
            const ranked = await this.intelligence!.rankLocalCandidates(latestProject, scene, localOrder);
            const retained = new Set(ranked.map(documentaryCandidateKey));
            // Do not rediscover/reanalyse the same unsuitable saved source in
            // the remote stage immediately after excluding its known catalog.
            for (const candidate of localOrder) {
              const key = documentaryCandidateKey(candidate);
              if (!retained.has(key)) tried.add(key);
            }
            localOrder = ranked;
            // The early library pass is a shortcut only when actual indexed
            // frames suggest a match. Paying to rank and catalogue unrelated
            // old downloads can consume the entire video-search budget before
            // discovery even starts. Unknown sources remain untried and can
            // compete with internet results in the normal local+remote search.
            if(this.intelligence!.cataloguedCandidates){
              const catalogued=this.intelligence!.cataloguedCandidates(latestProject,scene,localOrder);
              const known=new Set(catalogued.map(documentaryCandidateKey));
              deferredLocal.set(kind,localOrder.filter(candidate=>!known.has(documentaryCandidateKey(candidate))));
              localOrder=catalogued;
            }
          }
          const directStill=!quick&&!localOnly&&kind==='image'&&this.intelligence!.rankCandidates
            ?documentaryExactNamedStillProbe(localOrder,requirement,scene.narration):undefined;
          retryDirectStill=Boolean(directStill);
          let attempts = directStill?[directStill]:quick ? earlyCandidates : documentaryCandidateAttempts(localOrder, searchSubjects);
          // A local source's old exact-metadata flag belongs to its ORIGINAL
          // search. Screen its relevance to this scene before analysing more
          // ranges of a long, already-downloaded but unrelated source.
          const requiredVideoPart=kind==='video'&&documentaryGeneralDiagramScope(context,requirement.identities)
            ?documentaryRequiredVisiblePart(scene.narration):undefined;
          if (!quick && !directStill && this.intelligence!.rankCandidates && localOrder.length && (localOnly || !hasExactDocumentaryVideoCandidate(localOrder, requirement, requiredVideoPart))) {
            if (fatal || this.stopRequested.has(projectId)) return;
            this.publish({ projectId, phase: "preparing", completed, total: scenes.length, selected, skipped, failed: failures.length, currentSceneId: scene.id,
              message: `Кадр ${scene.order + 1}: отбираю подходящие источники по смыслу…` });
            try { attempts = await this.intelligence!.rankCandidates(project, scene, localOrder,
              message=>this.publish({projectId,phase:'preparing',completed,total:scenes.length,selected,skipped,failed:failures.length,currentSceneId:scene.id,message}),
              ()=>Boolean(fatal)||this.stopRequested.has(projectId)); }
            catch (error) {
              if (!(error instanceof DocumentaryAnalysisError) || error.kind !== "pending") throw error;
              await changeScene(scene.id, current => ({ ...current, documentary: { ...current.documentary!, autoError: error.message } }));
              // Metadata ranking is optional. Keep the bounded local shortlist;
              // actual-frame validation below is still mandatory for approval.
            }
            if (!attempts.length) await changeScene(scene.id, current => ({ ...current, documentary: { ...current.documentary!, autoError: "В найденных источниках не подтверждается нужный предмет; продолжаю поиск другого вида материала." } }));
          }
          if(!quick&&!localOnly&&kind==='video'){
            const short=documentaryExactNamedShortVideoProbe(localOrder,requirement,scene.narration);
            if(short&&!attempts.some(candidate=>candidate.kind==='video'&&(candidate.durationSeconds??Infinity)<=120)
              &&!attempts.some(candidate=>documentaryCandidateKey(candidate)===documentaryCandidateKey(short))){
              attempts=[short,...attempts].slice(0,6);
              recordDiagnosticEvent('info','documentary.ranking.exact-short-probe',{projectId,sceneId:scene.id,provider:short.provider,durationSeconds:short.durationSeconds});
            }
          }
          for (const candidate of attempts) {
              if (fatal || this.stopRequested.has(projectId)) return;
              // A live scene spent successive 15-minute slots on slow originals.
              // After a timeout keep cached footage and other providers eligible,
              // then use the normal verified-photo fallback for this scene.
              if (youtubeTimedOut && candidate.provider === "youtube" && !candidate.localPath) continue;
              if (videoOnly && documentaryVideoCoverage((await this.projects.get(projectId,{omitCandidates:true}))!.scenes).percent >= project.settings.stockVideoPercent) break;
              // An already usable photo needs a quick improvement pass, not the
              // same exhaustive search as an empty scene. Keep its verified fallback.
              if (inspections >= inspectionLimit || (attemptCounts.get(inspectionKey) ?? 0) >= inspectionLimit
                || !session.canAttempt(scene.id,kind)) break;
              if(!session.takeAttempt(scene.id,kind))break;
              // Failed transfers and rejected technical quality also consume
              // the attempt budget; previously they bypassed every limit.
              attemptCounts.set(inspectionKey, (attemptCounts.get(inspectionKey) ?? 0) + 1);
              tried.add(documentaryCandidateKey(candidate));
              this.publish({ projectId, phase: "downloading", completed, total: scenes.length, selected, skipped, failed: failures.length, currentSceneId: scene.id, message: `Кадр ${scene.order + 1}: ${candidate.localPath ? "беру сохранённый материал" : `скачиваю ${kind === "video" ? "видео" : "фото"}`} и проверяю содержимое…` });
              try { project = await this.apply(projectId, scene.id, candidate, false, bytes => {
                this.publish({ projectId, phase: "downloading", completed, total: scenes.length, selected, skipped, failed: failures.length,
                  currentSceneId: scene.id, currentSceneNumber: scene.order + 1, message: `Кадр ${scene.order + 1}: загрузка YouTube · ${Math.floor(bytes / 1024 ** 2)} МБ` });
              }, seconds => this.publish({ projectId, phase: "downloading", completed, total: scenes.length, selected, skipped, failed: failures.length,
                currentSceneId: scene.id, currentSceneNumber: scene.order + 1,
                message: `Кадр ${scene.order + 1}: источник ограничил скачивание. Продолжу автоматически через ${seconds} с; ничего нажимать не нужно.` }), Date.now()+session.remaining(scene.id,kind),
                message=>this.publish({projectId,phase:'preparing',completed,total:scenes.length,selected,skipped,failed:failures.length,currentSceneId:scene.id,currentSceneNumber:scene.order+1,message:`Кадр ${scene.order+1}: ${message}`})); }
              catch (error) {
                if (error instanceof DocumentaryStorageUnavailableError || (error as NodeJS.ErrnoException)?.code === "ENOSPC") throw error;
                if(error instanceof DocumentaryAnalysisError&&error.kind!=='pending')throw error;
                if(error instanceof DocumentaryAnalysisError&&error.kind==='pending')await rememberUncertain(candidate);
                const message = error instanceof Error ? error.message : String(error);
                if(candidate.provider==='youtube'&&!candidate.localPath&&/Requested format is not available/i.test(message)){
                  const key=rejectedCandidateFingerprint(candidate);
                  unavailableFormats.add(key);
                  session.rememberUnavailableFormat(formatScope,key);
                  await saveDocumentaryRejections(formatPath,formatScope,unavailableFormats).catch(()=>{
                    recordDiagnosticEvent('warn','documentary.search.format-cache-write-failed',{projectId,sceneId:scene.id});
                  });
                }
                if (candidate.provider === "youtube" && documentaryDownloadTimedOut(error)) youtubeTimedOut = true;
                await changeScene(scene.id, current => ({ ...current, documentary: { ...current.documentary!, autoError: message } }));
                this.publish({ projectId, phase: "applying", completed, total: scenes.length, selected, skipped, failed: failures.length, currentSceneId: scene.id, message: `Кандидат не загружен: ${candidate.title.slice(0, 90)}. ${message.replace(/https?:\/\/\S+/g, "[адрес источника]")}` });
                continue;
              }
              let current = project.scenes.find(item => item.id === scene.id)!;
              // Judge a narrow photo at the size it will actually occupy in the
              // automatic portrait composition, before paying for visual review.
              const portraitTemplate=documentaryAutoPortraitTemplate(current,current.documentary?.selected,project.aspectRatio);
              if(portraitTemplate)current={...current,documentary:{...current.documentary!,template:portraitTemplate,templateOrigin:'automatic'}};
              const qualityIssue=documentarySourceQualityIssue(current.documentary?.selected,project.aspectRatio,documentaryQualityPresentation(current));
              if(qualityIssue){await changeScene(scene.id,latest=>({...latest,documentary:{...latest.documentary!,autoError:qualityIssue}}));continue;}
              // A different URL/provider can still resolve to the old source.
              // Check its immutable bytes before any paid preparation or review.
              const protectedChecksums=recoveredContext.scenes[scene.id]?.checksums??[];
              if(current.documentary?.checksum&&(protectedChecksums.includes(current.documentary.checksum)
                ||current.documentary.selected?.excerpt?.sourceChecksum&&protectedChecksums.includes(current.documentary.selected.excerpt.sourceChecksum))){
                await changeScene(scene.id,latest=>({...latest,documentary:{...latest.documentary!,autoError:'Поисковой план восстановлен. Ранее проверявшийся источник сохранён; повторный анализ с неизвестным результатом не отправляется.'}}));
                continue;
              }
              if (waitForNarration) {
                try {
                  await this.intelligence!.prepareSource?.(project, current, message => this.publish({ projectId, phase: "preparing", completed, total: scenes.length, selected, skipped, failed: failures.length, currentSceneId: scene.id, message }), () => Boolean(fatal) || this.stopRequested.has(projectId));
                } catch (error) {
                  if (!(error instanceof DocumentaryAnalysisError) || error.kind !== "pending") throw error;
                  blockedCatalogs.add(documentaryCandidateKey(candidate));
                  await rememberUncertain(candidate,current.documentary?.checksum);
                  await changeScene(scene.id, latest => ({ ...latest, documentary: { ...latest.documentary!, autoError: error.message } }));
                  continue;
                }
                const narrationWaitStarted = Date.now();
                try { await waitForNarration(scene.id); } catch (error) { fatal = error; throw error; }
                session.extend(scene.id,kind,Date.now()-narrationWaitStarted);
                if (this.stopRequested.has(projectId)) return;
                const voiced = (await this.projects.get(projectId,{omitCandidates:true}))!.scenes.find(item => item.id === scene.id)!;
                current = { ...current, audioPath: voiced.audioPath, narrationSlice: voiced.narrationSlice,
                  documentary: { ...current.documentary!, timing: voiced.documentary?.timing } };
              }
              // Download/catalog work is single-flight; scene-specific matching
              // does not hold the source lock across remote analysis.
              if (fatal || this.stopRequested.has(projectId)) return;
              const freshProject = (await this.projects.get(projectId,{omitCandidates:true}))!;
              project = { ...freshProject, scenes: freshProject.scenes.map(item => item.id === current.id ? current : item) };
              const duplicatePhoto = kind === "image" && documentaryReuseIssue((await this.projects.get(projectId,{omitCandidates:true}))!, current);
              if (duplicatePhoto) {
                await changeScene(scene.id, latest => ({ ...latest, documentary: { ...latest.documentary!, autoError: duplicatePhoto } }));
                continue;
              }
              let inspection: Awaited<ReturnType<DocumentaryIntelligence["inspectForSelection"]>>;
              try {
                inspection = this.intelligence!.inspectForSelection
                  ? await this.intelligence!.inspectForSelection(project, current, message => this.publish({ projectId, phase: "applying", completed, total: scenes.length, selected, skipped, failed: failures.length, currentSceneId: scene.id, message: `Кадр ${scene.order + 1}: ${message}` }), () => Boolean(fatal) || this.stopRequested.has(projectId))
                  : { review: await this.intelligence!.inspect(project, current), usedNewAnalysis: true };
              } catch (error) {
                if (!(error instanceof DocumentaryAnalysisError) || error.kind !== "pending") throw error;
                if (error.purpose === "video-catalog") blockedCatalogs.add(documentaryCandidateKey(candidate));
                await rememberUncertain(candidate,current.documentary?.checksum);
                await changeScene(scene.id, latest => ({ ...latest, documentary: { ...latest.documentary!, autoError: error.message } }));
                this.publish({ projectId, phase: "applying", completed, total: scenes.length, selected, skipped, failed: failures.length, currentSceneId: scene.id,
                  message: `Кадр ${scene.order + 1}: пропускаю «${candidate.title.slice(0, 90)}» — прежний анализ не завершён. Проверяю другой источник без повторной оплаты этого запроса.` });
                continue;
              }
              if (inspection.usedNewAnalysis) {
                inspections++;
                inspectionCounts.set(inspectionKey, inspections);
              }
              let { review } = inspection;
              const rangeScene = { ...current, trimStartSeconds: review.trimStartSeconds ?? 0, trimEndSeconds: review.trimEndSeconds,
                documentary: { ...current.documentary!, visualReview: review } };
              const prepared = review.status === "accepted" ? await prepareDocumentaryRangePoster(this.storage.projectDirectory(projectId), rangeScene) : rangeScene;
              review = prepared.documentary!.visualReview!;
              // Different downloads can contain the same photo or camera view.
              // Serialize only this short acceptance step, not paid analysis,
              // so concurrent workers recheck against every committed choice.
              const releaseSource = await this.reserveSource(`selection:${projectId}`);
              try {
              const latest = (await this.projects.get(projectId,{omitCandidates:true}))!;
              const duplicate = review.status === "accepted" && (documentaryReuseIssue(latest, prepared) || documentaryVarietyIssue(latest, prepared));
              if (duplicate) review = { ...review, status: "rejected", reason: duplicate };
              await atomicWrite(join(this.storage.projectDirectory(projectId), "Documentary", scene.id.replace(/[^a-zA-Z0-9_-]/g, "_"), `${current.documentary!.checksum}.review.json`), JSON.stringify({ candidateId: candidate.id, review }, null, 2));
              accepted = review.status === "accepted";
              project = await changeScene(scene.id, latest => {
                if (latest.documentary?.checksum !== scene.documentary?.checksum || latest.narration !== scene.narration || latest.documentary?.pinned !== scene.documentary?.pinned) throw new Error("Кадр изменился во время визуальной проверки; кандидат сохранён отдельно");
                if (!accepted) return { ...latest, documentary: { ...latest.documentary!, autoError: review.reason,
                  candidates: latest.documentary!.candidates.map(item => item.id === candidate.id ? { ...item, concerns: [...item.concerns, review.reason] } : item) } };
                return { ...latest, imagePath: prepared.imagePath, videoPath: current.videoPath, stockSource: current.stockSource, stockAlternates: [], sourceVolume: 0,
                  trimStartSeconds: review.trimStartSeconds ?? 0, trimEndSeconds: review.trimEndSeconds,
                  documentary: { ...latest.documentary!, selected: current.documentary!.selected, checksum: current.documentary!.checksum, visualHash: current.documentary!.visualHash,
                    ...(portraitTemplate?{template:portraitTemplate,templateOrigin:'automatic' as const}:{}),
                    pinned: false, illustrative: false, verified: true, visualReview: review, reviewNote: review.reason, autoError: undefined } };
              });
              if(!accepted&&inspection.review.status==='rejected'&&documentaryCacheableVisualRejection(candidate)){
                rejectedCandidates.add(rejectedCandidateFingerprint(candidate));
                await saveDocumentaryRejections(rejectionPath,rejectionScope,rejectedCandidates).catch(()=>{
                  recordDiagnosticEvent('warn','documentary.search.rejection-cache-write-failed',{projectId,sceneId:scene.id});
                });
              }
              if (accepted) { selected++; break; }
              } finally { releaseSource(); }
          }
          }
          } finally { await batches.return(undefined); }
        }
        if (!accepted && upgradePhoto) skipped++;
        else if (!accepted) {
          const message = "Не найден материал с подтверждённым объектом, качеством и правами. Проверьте кандидатов или уточните запрос."
            + (sourceErrors.length ? ` Недоступные источники: ${sourceErrors.join("; ")}` : "");
          failures.push({ sceneId: scene.id, sceneNumber: scene.order + 1, category: "no-results", message });
          // A failed scene has been processed, not queued. Persist the result
          // so gaps remain explainable after navigation or an app restart.
          await changeScene(scene.id, current => ({ ...current, documentary: { ...current.documentary!,
            searchError: sourceErrors.join("\n") || undefined,
            autoError: !foundThisRun && sourceErrors.length && !attemptState.found
              ?message:current.documentary?.autoError||message } }));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const stopsRun = error instanceof DocumentaryMemoryUnavailableError || error instanceof DocumentaryStorageUnavailableError || (error as NodeJS.ErrnoException)?.code === "ENOSPC" || error instanceof AnyModelModelUnavailableError || error instanceof DocumentaryAnalysisError && error.kind === "unavailable";
        if (stopsRun) {
          fatal ??= error;
          this.downloadControllers.get(projectId)?.abort();
          this.publish({projectId,phase:'preparing',completed,total:scenes.length,selected,skipped,failed:failures.length+1,
            message:`Производство остановлено: ${message}. Дожидаюсь уже отправленных ответов и сохраняю результаты…`});
        }
        failures.push({ sceneId: scene.id, sceneNumber: scene.order + 1, category: "unknown", message });
        await changeScene(scene.id, current => ({ ...current, documentary: { ...current.documentary!, autoError: message } }));
        if (stopsRun) throw error;
      }
      if (!accepted && previousReady) {
        project = await changeScene(scene.id, current => {
          if (current.documentary?.checksum !== scene.documentary?.checksum || current.narration !== scene.narration) return current;
          return { ...current, documentary: { ...current.documentary!,
              autoError: `Новая замена не подтверждена; сохранён предыдущий проверенный материал. ${current.documentary!.autoError ?? ""}` } };
        });
      }
      activeScenes.delete(scene.id);
      completed++;
      const remaining = scenes.filter(item => activeScenes.has(item.id));
      if (remaining.length) this.publish({ projectId, phase: "preparing", completed, total: scenes.length, selected, skipped, failed: failures.length,
        currentSceneId: remaining[0]!.id, currentSceneNumber: remaining[0]!.order + 1,
        message: `Продолжается подготовка материалов: кадры ${remaining.map(item => item.order + 1).join(", ")}. Завершённые проверки сохранены.` });
    };
    let fatal: unknown;
    // Drain in-flight work before reporting an outage; no orphan paid requests.
    let lastWorkers=0;
    await runDocumentarySelectionQueue(scenes,async scene=>{
      // Broad shared discovery is lazy: speculative archive queries occupied
      // the provider queue before a scene could try its precise first result.
      try { await measureDocumentaryStage('scene-selection',{projectId,sceneId:scene.id},()=>selectScene(scene)); } catch (error) { fatal ??= error; }
    },async()=>{
      const resources=await documentarySelectionResources();
      if(resources.workers!==lastWorkers){
        lastWorkers=resources.workers;
        this.publish({projectId,phase:'searching',completed,total:scenes.length,selected,skipped,failed:failures.length,message:`Подбор материалов: ${resources.workers} параллельных задач с учётом доступной памяти`});
      }
      return resources.workers;
    },()=>Boolean(fatal)||this.stopRequested.has(projectId));
    await session.drain();
    if (this.stopRequested.has(projectId)) throw new DOMException("Подбор остановлен пользователем", "AbortError");
    if (fatal) throw fatal;
    if (waitForNarration) {
      await waitForNarration();
      if (!options.sceneIds) await this.applyPlannedEffects(projectId);
    }
    project = (await this.projects.get(projectId,{omitCandidates:true}))!;
    // A photo fallback must not leave an otherwise ready project permanently
    // stuck at 89% when the user requested 90%. Try only unpinned photo scenes,
    // retaining their current material unless a real video passes inspection.
    // One bounded pass; do not recurse on a failed coverage pass or lower the goal.
    if (!videoOnly && !options.sceneIds && project.settings.stockVideoPercent >= 80
      && project.scenes.filter(scene => scene.includeInAssembly !== false).every(scene => scene.documentary?.verified)
      && documentaryVideoCoverage(project.scenes).percent < project.settings.stockVideoPercent) {
      const photoIds = project.scenes.filter(scene => scene.includeInAssembly !== false && !scene.documentary?.pinned && scene.documentary?.selected?.kind === "image").map(scene => scene.id);
      if (photoIds.length) {
        this.publish({ projectId, phase: "preparing", completed, total: scenes.length, selected, skipped, failed: failures.length,
          message: `Довожу долю настоящего видео до ${project.settings.stockVideoPercent}%; подтверждённые фотографии остаются до готовности замены…` });
        const upgraded = await this.selectAll(projectId, { sceneIds: photoIds }, true);
        project = upgraded.project;
        selected += upgraded.selected;
      }
    }
    project = await this.projects.mutate(projectId, current => ({ scenes: planDocumentaryMontage({ ...current, scenes: planDocumentaryComparisons(current) }).map(scene => inScope(scene) ? scene : current.scenes.find(item => item.id === scene.id)!) }),{candidateSceneIds:[]});
    project=await this.applyPlannedEffects(projectId,options.sceneIds);
    await this.storage.ensureProject(project);
    for (const scene of project.scenes.filter(scene => inScope(scene) && scene.includeInAssembly !== false && scene.documentary?.layout === "compare" && !scene.documentary.comparison)) {
      if (!failures.some(failure => failure.sceneId === scene.id)) failures.push({ sceneId: scene.id, sceneNumber: scene.order + 1, category: "no-results", message: scene.documentary!.autoError || "Нужен второй материал сравнения" });
    }
    const coverage = documentaryVideoCoverage(project.scenes);
    const videoTarget = Math.max(0, Math.min(100, Math.round(project.settings.stockVideoPercent || 0)));
    // A documentary request for mostly moving footage must not silently turn
    // into a photo montage just because every chosen still was individually
    // valid. Lower legacy ratios remain a preference, while 80–100% is an
    // explicit assembly gate with a concrete material-side explanation.
    if (!options.sceneIds && videoTarget >= 80 && coverage.totalSeconds > 0 && coverage.percent < videoTarget) {
      const photo = project.scenes.find(scene => scene.includeInAssembly !== false && scene.documentary?.selected?.kind === "image");
      failures.push({ sceneId: photo?.id ?? project.id, sceneNumber: (photo?.order ?? -1) + 1, category: "no-results",
        message: `Доля настоящего видео ${coverage.percent}% вместо выбранных ${videoTarget}%. Подходящих подтверждённых видео пока не хватает; фото не выданы за выполнение цели.` });
    }
    this.publish({ projectId, phase: "complete", completed, total: scenes.length, selected, skipped, failed: failures.length,
      message: `${failures.length ? `Не подтверждены сцены: ${[...new Set(failures.map(f=>f.sceneNumber).filter(n=>n>0))].map(n=>`№${n}`).join(', ') || 'проверьте долю видео'}` : "Проверенные материалы сохранены"}. Видео: ${coverage.percent}% длительности${videoTarget >= 80 ? ` (цель ${videoTarget}%)` : ""}.` });
    return { project, total: scenes.length, selected, skipped, failed: failures.length, failures };
  }

  async refreshMontage(projectId: string): Promise<Project> {
    if(this.autoRuns.has(projectId))throw new Error('Дождитесь завершения подбора материалов');
    await this.projects.mutate(projectId,current=>{
      if(current.mediaMode!=='stock'||current.settings.assembly.documentary?.version!==2)throw new Error('Откройте Stock Documentary v2');
      if(current.status==='generating'||current.status==='paused')throw new Error('Сначала завершите или остановите производство');
      return {scenes:revalidateDocumentaryContext(current)};
    },{candidateSceneIds:[]});
    const project=await this.projects.mutate(projectId,current=>{
      if(current.mediaMode!=='stock'||current.settings.assembly.documentary?.version!==2)throw new Error('Откройте Stock Documentary v2');
      if(current.status==='generating'||current.status==='paused')throw new Error('Сначала завершите или остановите производство');
      if(!current.scenes.length||current.scenes.some(s=>s.includeInAssembly!==false&&!s.documentary?.verified))throw new Error('Сначала подтвердите материалы всех включённых сцен');
      return {scenes:planDocumentaryMontage({...current,scenes:planDocumentaryComparisons(current)},false,true),status:'ready',outputPath:undefined,lastRender:undefined};
    });
    await this.storage.ensureProject(project);
    return this.applyPlannedEffects(projectId);
  }

  private async applyPlannedEffects(projectId: string,sceneIds?:string[]): Promise<Project> {
    let project = (await this.projects.get(projectId))!;
    const beforeMaps=project;
    const inScope=(scene:Scene)=>!sceneIds||sceneIds.includes(scene.id);
    const maps=await prepareDocumentaryMaps(this.storage.projectDirectory(projectId),project.scenes.filter(inScope));
    project=await this.projects.mutate(projectId,current=>({scenes:current.scenes.map(scene=>{
      const before=beforeMaps.scenes.find(s=>s.id===scene.id),prepared=maps.find(s=>s.id===scene.id);
      return prepared?.documentary&&scene.documentary&&JSON.stringify(scene.documentary.motionGraphic)===JSON.stringify(before?.documentary?.motionGraphic)
        ?{...scene,documentary:{...scene.documentary,motionGraphic:prepared.documentary.motionGraphic}}:scene;
    })}),{candidateSceneIds:[]});
    if (this.library) {
      const edited = await planDocumentaryEffects(project, this.library, this.storage, sceneIds);
      project = await this.projects.mutate(projectId, current => ({ scenes: current.scenes.map(scene => {
        const planned = edited.find(item => item.id === scene.id);
        return inScope(scene)&&planned?.documentary && scene.documentary && !scene.documentary.effects.length ? { ...scene, transition: planned.transition,
          autoTransition:planned.autoTransition,autoTransitionDurationSeconds:planned.autoTransitionDurationSeconds,
          documentary: { ...scene.documentary, effects: planned.documentary.effects, caption: scene.documentary.caption.enabled ? scene.documentary.caption : planned.documentary.caption } } : scene;
      }) }),{candidateSceneIds:[]});
      await this.storage.ensureProject(project);
    }
    return project;
  }

  private async apply(projectId: string, sceneId: string, candidate: DocumentaryCandidate, commit = true, onDownloadProgress?: (bytes: number) => void, onDownloadWait?: (seconds: number) => void, downloadDeadline?: number,onPreview?:(message:string)=>void): Promise<Project> {
    const key = `${projectId}:${sceneId}`;
    if (this.active.has(key)) throw new Error("Для этого кадра уже скачивается материал");
    this.active.add(key);
    let temporary = "";
    let releaseDownload: (() => void) | undefined;
    try {
      // The lock precedes the cache lookup and actual download. Parallel scenes
      // wait for one registered original, while unrelated sources stay parallel.
      releaseDownload = await this.reserveSource(`download:${candidate.kind}:${candidate.provider}:${candidate.id || candidate.downloadUrl}`);
      const signal = commit ? undefined : this.downloadControllers.get(projectId)?.signal;
      signal?.throwIfAborted();
      const { project, scene } = await this.editable(projectId, sceneId, !commit && this.narrationWaits.has(projectId), !commit);
      const requireHd = !commit && documentaryQualityPresentation(scene) !== 'subject-card';
      // Staged inspections need selected sources/timing, not all historical
      // search results. Never persist this light view as the recovery manifest.
      if(commit)await this.storage.ensureProject(project);
      const root = join(this.storage.projectDirectory(projectId), "Documentary", sceneId.replace(/[^a-zA-Z0-9_-]/g, "_"));
      await mkdir(root, { recursive: true });
      await ensureDocumentarySpace(root);
      temporary = join(root, `${randomUUID()}.download`);
      const previousSource = !candidate.localPath && candidate.downloadUrl ? project.scenes.map(scene => scene.documentary?.selected).find(source => source?.downloadUrl === candidate.downloadUrl && source.kind === candidate.kind && source.localPath && JSON.stringify(source.excerpt) === JSON.stringify(candidate.excerpt)) : undefined;
      const catalogSource = !candidate.localPath && !previousSource ? await this.cachedSource(candidate) : undefined;
      const existingCopy = candidate.localPath || previousSource?.localPath || catalogSource?.localPath;
      const catalogOriginal = existingCopy && !candidate.id.startsWith("manual:") && /^[a-f0-9]{64}\.[a-z0-9]+$/i.test(basename(existingCopy)) ? join(this.materialRoot, "Files", basename(existingCopy)) : undefined;
      const localSources = join(this.storage.projectDirectory(projectId), "Documentary", "Sources");
      const projectOriginal = existingCopy && /^[a-f0-9]{64}\.[a-z0-9]+$/i.test(basename(existingCopy)) ? join(localSources, basename(existingCopy)) : undefined;
      let localCopy: string | undefined;
      for (const copy of [candidate.localPath, projectOriginal, previousSource?.localPath, catalogOriginal, existingCopy]) {
        if (copy && await stat(copy).then(info => info.isFile(), () => false)) { localCopy = copy; break; }
      }
      let sourceRange:{start:number;end:number}|undefined;
      // For a short clip, three independently sought previews plus their paid
      // classification can cost more than downloading the original once.
      // Actual-frame, quality and identity checks still run on that original.
      const shortOriginal = candidate.kind==='video' && ((candidate.provider==='pexels'||candidate.provider==='pixabay')
        && (candidate.durationSeconds??Infinity)<=30 || candidate.provider==='youtube' && (candidate.durationSeconds??Infinity)<=90);
      if(!localCopy&&!commit&&candidate.kind==='video'&&(candidate.durationSeconds??0)>=12&&!shortOriginal&&this.intelligence?.inspectPreview
        &&(candidate.provider!=='youtube'||this.youtube?.preview)){
        const remaining=(downloadDeadline??Infinity)-Date.now();
        signal?.throwIfAborted();
        if(remaining>1000){
          const previewRoot=join(this.materialRoot,'Previews',documentaryPreviewKey(candidate));
          let preview:DocumentaryPreview|undefined;
          onPreview?.('Беру три коротких пробных участка до полной загрузки…');
          try {
            const previewSignal=AbortSignal.any([AbortSignal.timeout(Math.max(1,Math.min(45000,remaining))),...(signal?[signal]:[])]);
            preview=await measureDocumentaryStage('download-preview',{projectId,sceneId,provider:candidate.provider},()=>candidate.provider==='youtube'
              ?this.youtube!.preview!(candidate,previewRoot,previewSignal,requireHd)
              :downloadDirectDocumentaryPreview(candidate,previewRoot,previewSignal));
          } catch(error){
            signal?.throwIfAborted();
            if(error instanceof DocumentaryStorageUnavailableError||error instanceof DocumentaryYouTubeDefinitionError||(error as NodeJS.ErrnoException)?.code==='ENOSPC')throw error;
            // A long original can exceed the scene budget after an unavailable
            // preview. Try another source rather than spending that budget on
            // hundreds of megabytes without any view-level evidence.
            // A four-minute source whose three seek samples have already hit
            // the network timeout is unlikely to finish a full original in
            // the remaining scene budget. Keep the full-download fallback for
            // short sources and for fast preview failures (unsupported seek).
            if(!commit&&candidate.provider==='youtube'&&((candidate.durationSeconds??0)>=600
              ||(candidate.durationSeconds??0)>=180&&error instanceof Error&&error.name==='TimeoutError')){
              recordDiagnosticEvent('info','documentary.preview.long-original-deferred',{projectId,sceneId,provider:candidate.provider,durationSeconds:candidate.durationSeconds});
              throw new Error('Пробные участки долгого YouTube-видео недоступны; пропускаю автоматическую загрузку оригинала и проверяю другой источник.');
            }
            // An unavailable seek/preview is not evidence against the footage.
            // Original download retains the same total scene budget and guards.
            recordDiagnosticEvent('warn','documentary.preview.unavailable',{projectId,sceneId,provider:candidate.provider,message:String(error).replace(/https?:\/\/\S+/g,'[source]').slice(0,250)});
            onPreview?.('Пробные участки недоступны; проверю оригинал в оставшееся время.');
          }
          if(preview){
            onPreview?.('Проверяю пробные участки: реальное видео, игра или посторонний экран…');
            const screening=await this.intelligence.inspectPreview(projectId,documentaryPreviewKey(candidate),preview);
            recordDiagnosticEvent('info','documentary.preview.checked',{projectId,sceneId,provider:candidate.provider,rejected:screening.rejected,bytes:preview.bytes,downloadedBytes:preview.downloadedBytes});
            if(screening.rejected)throw new Error(screening.reason);
            if(!commit&&candidate.provider==='youtube'&&(candidate.durationSeconds??0)>=180
              &&(scene.documentary?.requirement.identities?.length||scene.documentary?.requirement.years.length)
              &&this.intelligence.inspectPreviewForScene){
              onPreview?.('Сверяю пробные кадры длинного видео с этой сценой до загрузки оригинала…');
              const match=await this.intelligence.inspectPreviewForScene(project,scene,candidate,preview);
              recordDiagnosticEvent('info','documentary.preview.scene-checked',{projectId,sceneId,provider:candidate.provider,
                selectedIndex:match.selectedIndex,sourceDurationSeconds:candidate.durationSeconds});
              if(match.selectedIndex<0)throw new Error(`В пробных кадрах длинного источника не подтверждён нужный предмет; проверяю другой источник. ${match.reason}`);
              const sceneDuration=Math.max(scene.durationOverrideSeconds??0,(scene.documentary?.timing?.durationInFrames??scene.durationSeconds*30)/30);
              sourceRange=documentaryPreviewDownloadRange(preview,match.selectedIndex,candidate.durationSeconds!,sceneDuration);
            }
          }
        }
      }
      let extension = extname(localCopy || new URL(candidate.downloadUrl).pathname).toLowerCase();
      if (!/^\.(?:jpe?g|png|webp|tiff?|mp4|mov|webm|mkv|wmv|ogv|avi)$/.test(extension)) extension = candidate.kind === "video" ? ".mp4" : ".jpg";
      if (localCopy) {
        const info = await stat(localCopy);
        if (!info.isFile() || info.size > 750 * 1024 * 1024) throw new Error("Выберите медиафайл не больше 750 МБ");
        const immutable = [join(this.materialRoot, "Files"), localSources, previousSource?.localPath && dirname(previousSource.localPath)].filter(Boolean)
          .some(directory => resolve(directory!).toLowerCase() === resolve(dirname(localCopy)).toLowerCase()) && /^[a-f0-9]{64}\.[a-z0-9]+$/i.test(basename(localCopy));
        if (immutable) await copyImmutableDocumentaryFile(localCopy, temporary);
        else { await ensureDocumentarySpace(root, info.size); await copyFile(localCopy, temporary); }
      } else await withDocumentaryDownloadBudget({ automatic: !commit, kind: candidate.kind, deadline: downloadDeadline, signal }, async downloadSignal => {
        if (candidate.provider === "youtube") {
          if (!this.youtube) throw new Error("Загрузчик YouTube недоступен");
          // A source may be retried by another scene after Stop. Use the shared
          // download lock and a stable path, not a fresh scene-local UUID.
          const downloads = join(this.materialRoot, "Downloads");
          await mkdir(downloads, { recursive: true });
          temporary = join(downloads, `youtube-${createHash("sha256").update(JSON.stringify([candidate.id,sourceRange])).digest("hex")}.download`);
          await measureDocumentaryStage("download", { projectId, sceneId, provider: candidate.provider }, () => this.youtube!.download(candidate, temporary, downloadSignal, onDownloadProgress, requireHd,sourceRange));
          extension = ".mp4";
        } else if (candidate.provider === "pexels" || candidate.provider === "pixabay") {
          const asset = { provider: candidate.provider, id: candidate.id.replace(/^[^:]+:/, ""), mediaType: candidate.kind, query: candidate.query,
            width: candidate.width || 0, height: candidate.height || 0, downloadUrl: candidate.downloadUrl, pageUrl: candidate.pageUrl,
            previewUrl: candidate.previewUrl || candidate.downloadUrl, author: candidate.author, attribution: candidate.attribution };
          if (this.stock.downloadToFile) {
            const available = await documentaryAvailableBytes(root);
            const downloaded = await measureDocumentaryStage("download", { projectId, sceneId, provider: candidate.provider }, () => this.stock.downloadToFile!(asset, temporary, available, downloadSignal));
            extension = downloaded.extension.startsWith(".") ? downloaded.extension : `.${downloaded.extension}`;
          } else {
            const downloaded = await measureDocumentaryStage("download", { projectId, sceneId, provider: candidate.provider }, () => this.stock.download(asset, downloadSignal));
            await ensureDocumentarySpace(root, downloaded.data.length);
            await writeFile(temporary, downloaded.data); extension = downloaded.extension.startsWith(".") ? downloaded.extension : `.${downloaded.extension}`;
          }
        } else await measureDocumentaryStage("download", { projectId, sceneId, provider: candidate.provider }, () => downloadDocumentaryFile(candidate.downloadUrl, temporary, downloadSignal, onDownloadWait));
      });
      // Scene copies are hard links to immutable originals. Re-reading hundreds
      // of megabytes for each scene adds no verification when this file identity
      // and revision have already been hashed during this process.
      const identity = await stat(temporary, { bigint: true });
      const revision = `${identity.dev}:${identity.ino}:${identity.size}:${identity.mtimeNs}`;
      const checksum = (identity.ino ? this.sourceChecksums.get(revision) : undefined) ?? await checksumFile(temporary);
      if (identity.ino) this.sourceChecksums.set(revision, checksum);
      const originalName = `${checksum}${extension}`, path = join(root, originalName);
      await mkdir(localSources, { recursive: true });
      const projectSource = join(localSources, originalName);
      await copyImmutableDocumentaryFile(temporary, projectSource);
      await copyImmutableDocumentaryFile(projectSource, path); await rm(temporary); temporary = "";
      const mediaAsset: EffectAsset = { id: checksum, version: 1, checksum, name: candidate.title, kind: candidate.kind, category: "review", tags: [], favorite: false,
        automatic: false, review: "pending", rights: "unknown", rightsNote: "", file: originalName, bytes: (await stat(path)).size, origins: [], state: "copied",
        defaults: { blend: "normal", opacity: 100, volume: 0, sourceAudio: false, trimStartSeconds: 0, fadeInSeconds: 0, fadeOutSeconds: 0 },
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      // The full remote original is intentionally not transferred for a verified
      // preview range. Its stable provider ID fingerprints reuse across clips;
      // the local file checksum above still protects the bytes we actually keep.
      const sourceCandidate:DocumentaryCandidate=sourceRange?{...candidate,excerpt:{sourceChecksum:createHash('sha256').update(candidate.id).digest('hex'),
        startSeconds:sourceRange.start,endSeconds:sourceRange.end,sourceDurationSeconds:candidate.durationSeconds!}}:candidate;
      const prepared = await measureDocumentaryStage("media-preparation", { projectId, sceneId, sourceCacheHit: Boolean(localCopy), checksum }, async () =>
        prepareDocumentaryDiagram(root,mediaAsset,sourceCandidate,await prepareDocumentaryMedia(root, mediaAsset, this.materialRoot, project.scenes, join(this.storage.projectDirectory(projectId), "Documentary"))));
      if (candidate.kind === "video" && !prepared.metadata?.videoCodec || candidate.kind === "image" && !prepared.metadata?.width) throw new Error("Оригинал не соответствует выбранному типу медиа");
      const selected = { ...sourceCandidate, localPath: path, bytes: mediaAsset.bytes, width: prepared.metadata?.width, height: prepared.metadata?.height, durationSeconds: prepared.metadata?.durationSeconds };
      const visualHash = prepared.poster ? await documentaryVisualHash(join(root, prepared.poster)) : undefined;
      const similar = project.scenes.filter(other => other.id !== sceneId && (other.documentary?.checksum === checksum || visualHash && other.documentary?.visualHash && visualHashDistance(visualHash, other.documentary.visualHash) <= 6));
      if (similar.length) selected.concerns = [...selected.concerns, `Похожий или повторный материал уже есть в кадрах: ${similar.map(other => other.order + 1).join(", ")}. Проверьте разнообразие и выбранный диапазон.`];
      await atomicWrite(join(root, `${checksum}.source.json`), JSON.stringify({ ...selected, checksum, metadata: prepared.metadata }, null, 2));
      const updateScene = (current: Scene): Scene => {
        if (current.narration !== scene.narration) throw new Error("Сцена изменилась во время загрузки; материал сохранён, выберите его заново");
        return { ...current, imagePath: candidate.kind === "image" ? prepared.proxy ? join(root, prepared.proxy) : path : prepared.poster ? join(root, prepared.poster) : undefined,
          videoPath: candidate.kind === "video" ? (prepared.proxy ? join(root, prepared.proxy) : path) : undefined,
          stockAlternates: [], trimStartSeconds: 0, trimEndSeconds: undefined, sourceVolume: 0,
          stockSource: { provider: selected.provider, assetId: selected.id, mediaType: selected.kind, query: selected.query, pageUrl: selected.pageUrl,
            author: selected.author, attribution: selected.attribution, licenseUrl: selected.licenseUrl, downloadedAt: new Date().toISOString() },
          documentary: { ...current.documentary!, selected, checksum, visualHash, verified: false, pinned: false, illustrative: false, reviewNote: "", visualReview: undefined, autoError: undefined } };
      };
      await mkdir(join(this.materialRoot, "Catalog"), { recursive: true });
      await mkdir(join(this.materialRoot, "Files"), { recursive: true });
      const libraryOriginal = join(this.materialRoot, "Files", originalName);
      await copyImmutableDocumentaryFile(path, libraryOriginal);
      const catalogFile = join(this.materialRoot, "Catalog", `${checksum}.json`);
      // A local-library selection must not erase the original provider's ID.
      if (candidate.provider !== "local" || !await stat(catalogFile).catch(() => undefined)) {
        await atomicWrite(catalogFile, JSON.stringify({ ...selected, localPath: libraryOriginal }, null, 2));
        this.catalogIndex = undefined;
      }
      // Prepare originals, provenance and derivatives before changing the user's selection.
      return commit ? await this.changeScene(projectId, sceneId, updateScene) : { ...project, scenes: project.scenes.map(item => item.id === sceneId ? updateScene(item) : item) };
    } finally {
      this.active.delete(key);
      if (temporary) await rm(temporary, { force: true }).catch(() => {});
      releaseDownload?.();
    }
  }

  private async editable(projectId: string, sceneId: string, duringNarration = false, omitCandidates = false) {
    const project = await this.projects.get(projectId,{omitCandidates});
    if (!project || project.mediaMode !== "stock" || project.settings.assembly.documentary?.version !== 2) throw new Error("Откройте проект Stock Documentary v2");
    if (!duringNarration && (project.status === "generating" || project.status === "paused")) throw new Error("Сначала остановите или завершите производство");
    const scene = project.scenes.find(scene => scene.id === sceneId);
    if (!scene?.documentary) throw new Error("Кадр Stock не найден");
    return { project, scene };
  }
  private async changeScene(projectId: string, sceneId: string, change: (scene: Scene) => Scene, duringNarration = false) {
    await this.editable(projectId, sceneId, duringNarration, true);
    const project = await this.projects.mutate(projectId, current => {
      if (!duringNarration && (current.status === "generating" || current.status === "paused")) throw new Error("Производство уже началось; правка не применена");
      if (!current.scenes.some(scene => scene.id === sceneId)) throw new Error("Кадр удалён во время операции");
      return { scenes: current.scenes.map(scene => scene.id === sceneId ? change(scene) : scene), outputPath: undefined, lastRender: undefined };
    }, {candidateSceneIds: [sceneId]});
    await this.storage.ensureProject(project);
    return project;
  }
}
