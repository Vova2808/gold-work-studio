import {DocumentaryLegacyPreviewUnattributed} from './documentary-analysis-error.js';
import {needsRouteComparison,validateRouteComparison,attachRouteComparison,savedRouteComparisonIssue,routeComparisonContextHash,assertRouteComparisonIdentity,hasCompletedRouteComparison} from './documentary-route-comparison.js';
import {DocumentaryRouteGeometryError} from '@gold-work/remotion-video';
import { createHash, randomUUID } from "node:crypto";
import {semanticMontageHash,DocumentarySemanticMontageError,validateSemanticMontagePlan,readCompletedMontageBatches} from './documentary-semantic-montage.js';
import {artworkEnabled,motionArtworkHash,attachMotionArtwork,repairSavedMotionArtworkPlan} from './documentary-artwork-plan.js';
import {appliedArtworkFeedbackRows,artworkFeedbackRowsHash,artworkFeedbackProtectedInput,artworkFeedbackProjectState,normalizeArtworkFeedback,type ArtworkFeedbackPlan} from './documentary-artwork-feedback.js';
import {recoverOfflinePrimaryPlans,type OfflinePrimaryRecoveryBinding} from './documentary-offline-primary-recovery.js';
import {renderDocumentaryArtworkPhases} from './documentary-artwork-phase-renderer.js';
import {prepareDocumentaryMontageMedia} from './documentary-montage-media.js';
import { isDeepStrictEqual } from 'node:util';
import { restoreDocumentaryExcerptReviews } from './documentary-excerpts.js';
import {documentaryDatedSearchQueries} from './documentary-dated-search.js';
import {documentarySavedContextIssue,revalidateDocumentaryContext,documentaryMapActionIssue,documentaryRouteApprovalCandidate} from './documentary-context-approval.js';
import {documentaryFallbackNarrativeFit,documentaryFallbackNarrativeIssue,documentaryLegacyFallbackNarrativeApproval} from './documentary-fallback-narrative.js';
import {currentDocumentaryFootageFallback,fastDocumentaryCandidateScore,planFastDocumentaryScene,resetStaleDocumentaryFootageFallback,fastDocumentaryProviders} from './documentary-fast-plan.js';
import {QueryPlanIssuesError} from './documentary-ai-query-planner.js';
import {currentDocumentaryAiSearchPlan,documentaryAiPlanContext} from './documentary-ai-plan-state.js';
import {fastDocumentaryGraphicReady} from './documentary-fast-graphics.js';
import {documentaryFootageRecoveryScenes,prepareDocumentaryFootageRecovery,restoreDocumentaryFootageRecovery,documentaryPhotoRecoveryScenes,prepareDocumentaryPhotoRecovery} from './documentary-footage-recovery.js';
import {applyDocumentaryNativeFallback,documentaryNativeFallbackReady} from './documentary-native-fallback.js';
import {documentarySceneSeconds} from './documentary-sequences.js';
import {DocumentarySelectionSession,type DocumentaryTransferFailures} from './documentary-selection-session.js';
import {documentarySelectionFailure} from './documentary-selection-failure.js';
import {documentarySelectionRetry,DocumentarySelectionRetryProbePassed,readDocumentarySelectionRetryEvidence,type DocumentarySelectionRetryGrant} from './documentary-retry.js';
import {documentaryAutomaticMaterialReady,documentaryMissingSelectedMaterialMessage,documentarySelectedMaterialMissing} from './documentary-auto-readiness.js';
import {claimDocumentaryThematicRecovery,documentaryThematicRecoveryBinding,documentaryThematicDiscoveryRequirement,repairDocumentaryGeographicReserve} from './documentary-automatic-thematic-recovery.js';
import {applyDocumentaryAutomaticNativeFallback,documentaryCheckedVideoCoverage} from './documentary-automatic-native-recovery.js';
import {completeDocumentaryVideoQuota,documentaryVideoQuotaCurrent,documentaryVideoQuotaMet,documentaryVideoQuotaProtectedTarget} from './documentary-automatic-video-quota.js';
import {discoverDocumentaryQueryLanes} from './documentary-query-lanes.js';
import {documentaryDiscoveryCompleted} from './documentary-discovery-completion.js';
import {documentaryScriptEvidence,documentaryScriptEvidenceIssue,documentaryRecoveryQueries,documentaryScriptRequirements,documentaryRequirementQueries} from './documentary-script-evidence.js';
import {documentaryWorkLimits,DocumentaryCandidateRejected} from './documentary-work-budget.js';
import {documentaryPreviewKey,documentaryPreviewRanges,documentaryPreviewDownloadRange,readDocumentaryPreview,downloadDirectDocumentaryPreview,downloadDirectDocumentaryRange,type DocumentaryPreview} from './documentary-preview.js';
import {documentaryGeneralDiagramScope} from './documentary-general-diagram.js';
import {documentaryRequiredVisiblePart,documentaryVisiblePartInMetadata} from './documentary-detail-evidence.js';
import {documentaryExactNamedShortVideoProbe} from './documentary-exact-short-video.js';
import {documentaryGroundedThematicQuery,documentaryThematicMetadataIssue} from './documentary-illustration-fallback.js';
import {documentaryNamedDiscoveryQueries,documentaryNamedMetadataShortlist,documentaryExactRequirementForRetry,documentaryNamedMetadataIssue,documentaryYouTubeNameFallback,documentaryNamedVideo,documentaryCandidateSubjectIssue,documentaryPlannedDiscoveryRequirement,documentaryCommonsDiscoverySubjects} from './documentary-named-search.js';
import {documentaryContinuityModelYear,documentaryContradictoryModelYear} from './documentary-model-year.js';
import {documentaryMaterialMetadataIssue} from './documentary-material-metadata.js';
import {documentarySceneContext,documentaryGeneralIllustration,documentaryCallToActionIllustration,documentaryNamedListPortrait,type DocumentarySceneContext} from './documentary-scene-context.js';
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import {documentaryPhotoFallbackStatus} from './documentary-photo-fallback.js';
import type { ProjectService } from "@gold-work/core";
import type { AutoStockProgress, AutoStockSelectionOptions, AutoStockSelectionResult, DocumentaryApi, DocumentaryCandidate, DocumentaryQueryPlanIssue, DocumentaryRequirement, DocumentarySearchInput, EffectAsset, Project, Scene } from "@gold-work/shared";
import { documentaryMaterialUsable,documentaryManualReviewReady,documentaryGeminiRetryAllowed,documentaryGeminiRetryBinding,documentaryVideoCoverage,documentaryFixedRange,documentaryCandidateSelectionKey,validDocumentaryPlace,documentaryThematicReserveIssue,type DocumentaryMaterialStage } from "@gold-work/shared";
import type { LocalProjectStorage } from "./local-project-storage.js";
import type { StockClient } from "./stock-client.js";
import { checksumFile } from "./effect-library.js";
import { prepareDocumentaryMedia, prepareDocumentaryRangePoster,prepareDocumentaryDiagram } from "./documentary-media-cache.js";
import { DocumentarySearch, documentarySearchUnavailable, documentaryFuseModelSuffix } from "./documentary-search.js";
import { downloadDocumentaryFile, withDocumentaryDownloadBudget, documentaryDownloadTimedOut, documentaryDownloadProgress,
  documentaryMediaCooldownMs, DocumentaryMediaCooldownError, DocumentaryMediaRateLimitError } from "./documentary-download.js";
import { atomicWrite } from "./fs-utils.js";
import { measureDocumentaryStage } from "./documentary-metrics.js";
import {diagnoseFailure,recordDiagnosticEvent} from './diagnostics.js';
import {discoverDocumentarySourceBatches} from './documentary-discovery.js';
import { documentaryVisualHash, visualHashDistance } from "./documentary-visual-hash.js";
import { DocumentaryCachedAnalysisMissing, DocumentaryPreSubmitFailure, DocumentaryPlanIncompleteError, type DocumentaryIntelligence } from "./documentary-intelligence.js";
import {explanationFeedbackRequest,validateExplanationFeedback,type ExplanationFeedbackRequest} from './documentary-intelligence.js';
import {documentaryExplanationSpans} from './documentary-explanation.js';
import {documentaryNarrationContext,documentaryMetadataShortlist,documentaryLegacyMotionRefusals} from './documentary-intelligence.js';
import {documentaryRepresentationIssue} from './documentary-thematic.js';

import type { EffectLibrary } from "./effect-library.js";
import { planDocumentaryEffects } from "./documentary-effects.js";
import { groundDocumentaryScenes, planDocumentaryComparisons } from "./documentary-comparison.js";
import {recoverDocumentaryPlanContext,readDocumentaryContextRecovery} from './documentary-plan-recovery.js';
import {documentarySourceQualityIssue,documentaryQualityPresentation,documentarySavedQualityIssue,documentaryKnownQualityIssue,documentaryGameplayMetadataIssue,documentaryAutoPortraitTemplate} from './documentary-source-quality.js';
import { planDocumentaryMontage } from "./documentary-montage.js";
import {prepareDocumentaryMaps} from './documentary-map.js';
import { copyImmutableDocumentaryFile, documentaryAvailableBytes, ensureDocumentarySpace, DocumentaryStorageUnavailableError } from "./documentary-storage.js";
import { DocumentaryYouTubeDefinitionError, DocumentaryYouTubeFormatUnavailableError, documentaryLikelyPortraitShort, documentaryYouTubeFormatSelector, type DocumentaryYouTube } from "./documentary-youtube.js";
import { DocumentaryMemoryUnavailableError } from "./documentary-resources.js";
import {documentarySelectionResources,runDocumentarySelectionQueue} from './documentary-resources.js';
import { AnyModelModelUnavailableError } from "./anymodel-text-fallback.js";
import { AnyModelCompletionUncertainError } from './anymodel-client.js';
import { DocumentaryAnalysisError } from "./documentary-analysis-error.js";
import { documentaryDistraction, documentarySavedIdentityIssue, applyDocumentaryRequirement, documentaryProjectionIssue,documentaryGeneralActionIssue } from "./documentary-visual-relevance.js";
import { documentaryCandidateKey, documentaryReuseIssue, documentaryVarietyIssue, revalidateDocumentaryVariety,usedDocumentaryRanges } from "./documentary-reuse.js";
import { documentaryCandidateUses, documentaryFallbackVideoRange, documentaryRequiredSourceSeconds, preferUnusedDocumentaryCandidates } from './documentary-candidate-allocation.js';

const exhaustedVisionProvider=(error:unknown):error is DocumentaryAnalysisError=>error instanceof DocumentaryAnalysisError
  &&error.kind==='unavailable'&&error.serviceUnavailable&&!error.retryableTerminal;

type ExplanationFeedbackOperation={version:1;request:ExplanationFeedbackRequest;startedAt:string;analysisKey?:string;dispatchAt?:string;
  result?:Record<string,unknown>;resultAt?:string;afterHash?:string;appliedAt?:string};
const explanationFeedbackHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Persisted content only; UI timestamps/status and lazy candidate loading are not edits. */
function explanationFeedbackProjectHash(project:Project):string{
  const copy=structuredClone(project);
  delete copy.outputPath;delete copy.lastRender;
  delete (copy as Partial<Project>).status;delete (copy as Partial<Project>).updatedAt;delete (copy as Partial<Project>).createdAt;
  for(const scene of copy.scenes){
    delete (scene as Partial<Scene>).status;
    if(scene.documentary){scene.documentary.candidates=[];delete scene.documentary.candidateCount;delete scene.documentary.candidatesDeferred;}
  }
  return explanationFeedbackHash(JSON.parse(JSON.stringify(copy)));
}

const rejectedCandidateFingerprint=(candidate:DocumentaryCandidate)=>createHash('sha256').update(JSON.stringify([
  candidate.provider,candidate.id,candidate.excerpt?.sourceChecksum,candidate.excerpt?.startSeconds,candidate.excerpt?.endSeconds
])).digest('hex');
type SavedMotionArtwork=Parameters<typeof attachMotionArtwork>[1];
function motionArtworkApplication(project:Project,commission?:SavedMotionArtwork){
  const scenes=project.scenes.filter(s=>s.includeInAssembly!==false).sort((a,b)=>a.order-b.order);
  const rows=commission?.scenes??scenes.flatMap(s=>s.documentary?.semanticMontage?.artwork
    ?[{sceneId:s.id,artwork:s.documentary.semanticMontage.artwork,artworkSpan:s.documentary.semanticMontage.artworkSpan}]:[]);
  let attached=0,used=0;
  const skipped:Array<{sceneId:string;scene:number;stage:'attachment'|'montage'}>=[];
  for(const row of rows){
    const first=scenes.findIndex(s=>s.id===row.sceneId),scene=scenes[first],direction=scene?.documentary?.semanticMontage;
    const linked=Boolean(direction&&isDeepStrictEqual(direction.artwork,row.artwork)&&isDeepStrictEqual(direction.artworkSpan,row.artworkSpan));
    if(linked)attached++;
    const last=row.artworkSpan?scenes.findIndex(s=>s.id===row.artworkSpan!.endSceneId):first;
    const applied=linked&&first>=0&&last>=first&&scenes.slice(first,last+1).every(member=>{
      const graphic=member.documentary?.motionGraphic;
      return graphic?.enabled&&!graphic.explanation&&graphic.origin==='automatic'&&isDeepStrictEqual(graphic.artwork,row.artwork)
        &&isDeepStrictEqual(graphic.artworkSpan,row.artworkSpan);
    });
    if(applied)used++;
    else skipped.push({sceneId:row.sceneId,scene:(scene?.order??-1)+1,stage:linked?'montage':'attachment'});
  }
  return {accepted:commission?.scenes.length,attached,used,skipped};
}

const incompleteInputSnapshot=(project:Project,scenes:Scene[])=>({script:project.videoBrief?.readyScript,language:project.language,
  scenes:new Map(scenes.map(scene=>[scene.id,{narration:scene.narration,requirement:JSON.stringify(scene.documentary?.requirement),
    pinned:Boolean(scene.documentary?.pinned),verified:Boolean(scene.documentary?.verified)}]))});
const incompleteInputChanged=(project:Project,input:ReturnType<typeof incompleteInputSnapshot>,ids:string[])=>project.videoBrief?.readyScript!==input.script||project.language!==input.language
  ||ids.some(id=>{const before=input.scenes.get(id),scene=project.scenes.find(scene=>scene.id===id);
    return !before||!scene||scene.narration!==before.narration||JSON.stringify(scene.documentary?.requirement)!==before.requirement
      ||Boolean(scene.documentary?.pinned)!==before.pinned||Boolean(scene.documentary?.verified)!==before.verified;});
const uncertainFileFingerprint=(checksum:string)=>createHash('sha256').update(`uncertain-file:${checksum}`).digest('hex');
const documentaryAcceptedMaterialMetadata=(project:Project,scene:Scene,review:NonNullable<NonNullable<Scene['documentary']>['visualReview']>,simpleSelection:boolean)=>{
  const requirement=scene.documentary!.requirement,portrait=documentaryNamedListPortrait(project,scene);
  return {pinned:false,manualReview:undefined,illustrative:simpleSelection||Boolean(requirement.footageFallback)
    ||(requirement.aiSearchPlan?.visualScope??requirement.visualScope)==='illustrative'
    ||Boolean(requirement.scriptRequirements?.nonVisual.length)||Boolean(review.generalDiagram)||portrait,
    illustrationLabelInEditorOnly:true,
    reviewNote:requirement.footageFallback?`Тематический видеоряд; не архив названного события. ${review.reason}`
      :portrait?`Портрет названного человека вне даты события. ${review.reason}`:review.reason,
    autoError:undefined};
};
export function documentaryVisualRejectionKeys(candidate:DocumentaryCandidate,checksum?:string):string[]{
  const file=checksum??candidate.localPath?.match(/([a-f0-9]{64})\.[a-z0-9]+$/i)?.[1];
  const keys=[rejectedCandidateFingerprint(candidate)];
  if(file)keys.push(createHash('sha256').update(`rejected-file:${file}`).digest('hex'));
  // A still remains the same picture under its provider and library aliases.
  // A long video may contain another useful interval; never ban its whole URL.
  if(candidate.kind==='image'&&candidate.downloadUrl)keys.push(createHash('sha256').update(`rejected-image:${candidate.downloadUrl}`).digest('hex'));
  return keys;
}
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

export function documentaryNeedsSemanticRecovery(scene:Scene):boolean{
  // The explicit broad-topic mode needs another real-frame verdict after an
  // unrelated toy, not a paid opinion on captions of that same broad subject.
  if(scene.documentary?.requirement?.scriptRequirements?.mode==='thematic'
    &&!scene.documentary.requirement.identities?.length)return false;
  const evidence=scene.documentary?.searchRecovery?.scriptEvidence;
  return Boolean(evidence&&(!Array.isArray(evidence.checks)||!evidence.checks.length||evidence.checks.some(check=>check?.match!==true)));
}

export function documentaryCachedRangeMatches(source:DocumentaryCandidate,candidate:DocumentaryCandidate,reuseExcerptSeconds?:number):boolean{
  // Legacy downloads sometimes saved a ten-second clip without its origin
  // offset. It cannot masquerade as the entire ten-minute search result.
  if(source.kind==='video'&&!source.excerpt&&!candidate.excerpt&&source.durationSeconds&&candidate.durationSeconds
    &&candidate.durationSeconds-source.durationSeconds>Math.max(2,candidate.durationSeconds*.02))return false;
  return JSON.stringify(source.excerpt)===JSON.stringify(candidate.excerpt)
    ||reuseExcerptSeconds!==undefined&&candidate.kind==='video'&&!candidate.excerpt&&Boolean(source.excerpt)
      &&(source.durationSeconds??0)>=reuseExcerptSeconds;
}

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

// A new search timestamp is not a new original. Changed URL, declared size or
// rendition/content revision can still recover within the same selection run.
export const documentaryTransferFingerprint=(candidate:DocumentaryCandidate)=>createHash('sha256')
  .update(JSON.stringify([candidate.provider,candidate.id,candidate.kind,candidate.downloadUrl,candidate.bytes,
    candidate.width,candidate.height,candidate.durationSeconds,candidate.excerpt?.sourceChecksum])).digest('hex');

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
  if(documentaryRequiredVisiblePart(requirement.text)||/firing (?:order|interval)|поряд\p{L}*\s+(?:работ\p{L}*|зажига\p{L}*)|big bang engine/iu.test(requirement.text))
    result=result.replace(/\b(?:sound|audio|noise)\b/gi," ");
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
    const principle=documentaryGeneralDiagramScope(context,requirement.identities)?.principle;
    const principleQuery=principle&&part?`${principle} ${part.replace(/-/g,' ')}`:undefined;
    return [...new Set([principleQuery,requirement.queries[0],partQuery,...concise,...requirement.queries,...documentarySearchQueries(requirement,kind)]
      .filter((query):query is string=>Boolean(query)).map(query=>documentaryQueryForKind(query,requirement,kind)).filter(Boolean))].slice(0,4);
  }
  if (kind) {
    // Video-only vocabulary needlessly excludes still evidence in full-text
    // indexes. Keep the named subject and the actual action/detail intact.
    return [...new Set(documentarySearchQueries(requirement).map(query => documentaryQueryForKind(query, requirement, kind)).filter(Boolean))];
  }
  requirement={...requirement,queries:[...new Set([...documentaryRequirementQueries(requirement.scriptRequirements),...requirement.queries])]};
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
  return [...new Set([...documentaryRequirementQueries(requirement.scriptRequirements),...requirement.queries.map(query => {
    let generic = documentaryQueryForKind(query, requirement, "video");
    for (const entity of [...requirement.entities].sort((a, b) => b.length - a.length)) generic = generic.replace(new RegExp(entity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ");
    const words = generic.match(/[\p{L}]+/gu)?.filter(word => !ignored.has(word.toLowerCase())) ?? [];
    return words.length >= 2 ? words.join(" ").slice(0, 100) : "";
  }).filter(Boolean)])].slice(0, 2);
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
  let words = (first.match(/[\p{L}\p{N}]+/gu) ?? []).filter(word => !modifiers.has(word.toLowerCase()));
  const vehicle=words.find(word=>/^(?:motorcycle|motorbike|car|aircraft|ship|train)$/i.test(word));
  const component=words.find(word=>/^(?:engine|garage|workshop|crankshaft|camshaft|piston|valve)$/i.test(word));
  // Truncating to the first three words turned a pit-garage request into
  // "motogp race motorcycle" and discarded the very object we needed.
  words=vehicle&&component?[vehicle,component]:words.slice(0,3);
  const broad = words.join(' ');
  return words.length >= 2 && broad.toLowerCase() !== first.toLowerCase() ? broad : undefined;
}

export function documentaryCandidateAttempts(candidates: DocumentaryCandidate[], entities: string[] = [], preferred:DocumentaryCandidate[]=[]): DocumentaryCandidate[] {
  const words = (text: string) => (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(word => !["the", "of", "and"].includes(word));
  const primary = words(entities[0] ?? "");
  const ready = candidates.filter(candidate => candidate.localPath && primary.length && primary.every(word => words(`${candidate.title} ${candidate.description}`).includes(word))).slice(0, 1);
  const seen = new Set<string>();
  return [...preferred,...ready, ...candidates.slice(0, 3), ...candidates.filter(candidate => candidate.localPath), ...candidates.slice(3)]
    .filter(candidate => { const key = documentaryCandidateKey(candidate); return !seen.has(key) && Boolean(seen.add(key)); }).slice(0, 6);
}

export function documentaryNeedsVideo(scene: Scene): boolean {
  return Boolean(scene.documentary?.verified && !scene.documentary.pinned && scene.documentary.selected?.kind === "image" && scene.documentary.requirement.preferredKind !== "image");
}

/** Upgrade only the minimum automatic stills needed by duration; keep manual and technical plates. */
export function documentaryQuotaUpgradeScenes(project:Project):string[]{
  const coverage=documentaryVideoCoverage(project.scenes),target=project.settings.stockVideoPercent;
  if(target<=0||coverage.percent>=target)return [];
  let missing=coverage.totalSeconds*target/100-coverage.videoSeconds;
  const ids:string[]=[];
  for(const scene of [...project.scenes].sort((a,b)=>b.order-a.order)){
    const doc=scene.documentary;
    if(scene.includeInAssembly===false||!doc?.verified||doc.pinned||doc.selected?.kind!=='image'
      ||documentaryVideoQuotaProtectedTarget(scene))continue;
    ids.push(scene.id);missing-=Math.max((doc.timing?.durationInFrames??scene.durationSeconds*30)/30,scene.durationOverrideSeconds??0);
    if(missing<=.001)break;
  }
  return ids;
}

/** Spend the requested photo share on documentary evidence first instead of
 * searching several long videos for a document/reference that wants a still. */
export function documentaryPhotoFirstScenes(project: Project, simple=false): Set<string> {
  const included = project.scenes.filter(scene => scene.includeInAssembly !== false);
  if(project.settings.stockVideoPercent<=0)return new Set(included.filter(scene=>!scene.documentary?.verified&&!scene.documentary?.pinned).map(scene=>scene.id));
  if(project.settings.stockVideoPercent>=100)return new Set();
  const seconds = (scene: Scene) => Math.max((scene.documentary?.timing?.durationInFrames ?? scene.durationSeconds * 30) / 30,scene.durationOverrideSeconds??0);
  let budget = included.reduce((sum, scene) => sum + seconds(scene), 0) * (100 - project.settings.stockVideoPercent) / 100;
  budget -= included.filter(scene => scene.documentary?.verified && scene.documentary.selected?.kind === "image").reduce((sum, scene) => sum + seconds(scene), 0);
  const result = new Set<string>();
  if(simple){
    // Reserve the only searchable kind first. Scenes with both primary lanes
    // can then supply the remaining share without skipping exact AI queries.
    const flexible:Scene[]=[];
    for(const scene of included){
      const doc=scene.documentary;
      if(doc?.pinned||doc?.verified)continue;
      const fallback=currentDocumentaryFootageFallback(scene);
      const ai=currentDocumentaryAiSearchPlan(project,scene);
      let kind:'image'|'video'|undefined;
      if(documentaryManualReviewReady(scene))kind=doc!.selected!.kind;
      else if(fallback)kind=fallback.kind??'video';
      else if(ai?.imageQueries.length&&!ai.videoQueries.length)kind='image';
      else if(ai?.videoQueries.length&&!ai.imageQueries.length)kind='video';
      if(kind==='image'){result.add(scene.id);budget-=seconds(scene);}
      else if(!kind)flexible.push(scene);
    }
    const prefersImage=(scene:Scene)=>{
      const doc=scene.documentary,slot=doc?.selectionPlan;
      return (slot?.videoPercent===project.settings.stockVideoPercent?slot.kind:doc?.requirement.preferredKind)==='image';
    };
    flexible.sort((a,b)=>Number(prefersImage(b))-Number(prefersImage(a))
      ||(a.order*.61803398875%1)-(b.order*.61803398875%1));
    for(const scene of flexible)if(Math.abs(budget-seconds(scene))<Math.abs(budget)){
      result.add(scene.id);budget-=seconds(scene);
    }
    return result;
  }
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

/** Stock APIs already rank the supplied thematic query. A short clean clip
 * with a sparse caption deserves one actual-frame check before we download
 * unrelated long archival videos for an intentionally general illustration. */
export function documentaryThematicStockProbe(candidates:DocumentaryCandidate[],requirement:DocumentaryRequirement,recoveryQueries:string[]=[],requiredObjects:string[]=[]):DocumentaryCandidate|undefined{
  if(requirement.visualScope!=='illustrative')return;
  const targetWords=new Set([requirement.illustrationQuery??'',...requirement.queries,...recoveryQueries,...requiredObjects].join(' ').toLowerCase().match(/[\p{L}]{2,}/gu)??[]);
  const tokens=(text:string)=>(text.toLowerCase().match(/[\p{L}]{2,}/gu)??[]).filter(word=>!['the','and','of','on','at','in','with','before'].includes(word))
    .map(word=>targetWords.has(word)?word:word.endsWith('es')&&targetWords.has(word.slice(0,-2))?word.slice(0,-2)
      :word.length>3&&word.endsWith('s')&&!word.endsWith('ss')?word.slice(0,-1):word);
  const words=new Set(tokens(documentaryRequirementQueries(requirement.scriptRequirements)[0]??requirement.illustrationQuery??requirement.queries[0]??''));
  const missing=new Set(tokens(recoveryQueries.join(' ')));
  const objects=new Set(tokens(requiredObjects.join(' ')));
  const eligible=candidates.filter(candidate=>candidate.kind==='video'
    &&(candidate.provider==='pexels'||candidate.provider==='pixabay')
    &&candidate.rights!=='unknown'
    &&(candidate.durationSeconds??0)>=3&&(candidate.durationSeconds??Infinity)<=120
    &&(candidate.width??0)>=1280&&(candidate.height??0)>=720);
  // Provider order is not a quality ranking: a dark 720p cruiser can precede
  // several clear 1080p racing clips for the same motorcycle query.
  const descriptions=eligible.map(candidate=>new Set(tokens(`${candidate.title} ${candidate.description}`)));
  const weight=(word:string)=>Math.log(1+eligible.length/(1+descriptions.filter(words=>words.has(word)).length));
  const score=(candidate:DocumentaryCandidate)=>{
    const title=new Set(tokens(`${candidate.title} ${candidate.description}`));
    const overlap=[...words].filter(word=>title.has(word)).reduce((sum,word)=>sum+weight(word),0);
    return [...objects].filter(word=>title.has(word)).length*10+overlap*2+[...missing].filter(word=>title.has(word)).reduce((sum,word)=>sum+weight(word),0)*3+Math.min(1,(candidate.width??0)*(candidate.height??0)/(1920*1080))
      +((candidate.durationSeconds??0)>=8?.15:0);
  };
  return eligible.sort((a,b)=>score(b)-score(a))[0];
}

/** Stock search already used the scene's thematic query. For a broad shot,
 * try two short, usable originals directly against their actual pixels instead
 * of paying for a second opinion on captions first. Specific claims keep the
 * normal semantic shortlist. This only orders candidates, never approves one. */
export function documentaryFastThematicCandidates(scene:Scene,candidates:DocumentaryCandidate[]):DocumentaryCandidate[]{
  if(!documentaryGeneralIllustration(scene)||documentaryGeneralActionIssue(scene)
    ||documentaryRequiredVisiblePart(scene.narration)||documentaryMetadataShortlist(scene,candidates).length)return [];
  const stock=candidates.filter(candidate=>(candidate.provider==='pexels'||candidate.provider==='pixabay')
    &&!documentaryRepresentationIssue(scene.narration,{reason:candidate.title})
    &&candidate.rights!=='unknown'
    &&Math.max(candidate.width??0,candidate.height??0)>=1280
    &&Math.min(candidate.width??0,candidate.height??0)>=720
    &&(candidate.kind==='image'||(candidate.durationSeconds??Infinity)>=3&&(candidate.durationSeconds??Infinity)<=120));
  const wordsOf=(value:string)=>new Set((value.toLowerCase().match(/[\p{L}]{4,}/gu)??[]).map(word=>word.replace(/s$/,'')));
  const words=wordsOf(documentaryRequirementQueries(scene.documentary!.requirement.scriptRequirements)[0]
    ??scene.documentary!.requirement.illustrationQuery??scene.documentary!.requirement.queries[0]??'');
  const match=(candidate:DocumentaryCandidate)=>{
    const title=wordsOf(candidate.title);
    return [...words].filter(word=>title.has(word)).length;
  };
  const ordered=stock.filter(candidate=>match(candidate)>0).sort((a,b)=>match(b)-match(a)
    ||Math.min(1,(b.width??0)*(b.height??0)/(1920*1080))-Math.min(1,(a.width??0)*(a.height??0)/(1920*1080)));
  if(!ordered.length)return [];
  const archive=candidates.find(candidate=>candidate.provider!=='pexels'&&candidate.provider!=='pixabay'
    &&candidate.rights!=='unknown'&&(candidate.kind==='image'||candidate.localPath||(candidate.durationSeconds??Infinity)<=60));
  const shortlist=[ordered[0]!,...(archive?[archive]:ordered.slice(1,2))];
  const seen=new Set<string>();
  return shortlist.filter(candidate=>{const key=documentaryCandidateKey(candidate);return !seen.has(key)&&Boolean(seen.add(key));});
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
  const personName=(name:string)=>/^\p{Lu}\p{Ll}[\p{L}'’-]+(?:\s+\p{Lu}\p{Ll}[\p{L}'’-]+){1,3}$/u.test(name);
  // A bare person's name often returns helmets, fan montages and merchandise.
  // Spend the existing request on a likely visible face, keeping the other
  // listed subject and every unchanged pixel/era/action check.
  const canShowPortrait=!requirement.years.length&&!documentaryRequiredVisiblePart(narration)
    &&!documentaryGeneralActionIssue({narration});
  if(!identity&&canShowPortrait&&requirement.identities?.length
    &&/\b(?:people|riders|drivers|engineers)\b|люд[иьяе]|гонщик|инженер/iu.test(narration)){
    const person=requirement.identities.find(item=>personName(item.name)&&planned[0]?.trim()===item.name);
    if(person)return [`${person.name} interview`,...planned.slice(1)];
  }
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
  if(canShowPortrait&&personName(name))return [planned[0]!,`${name} interview`];
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

/** Preserve provider order. Gemini decides suitability from the actual media. */
function formatQueryIssues(issues:DocumentaryQueryPlanIssue[]):string {
  const groups=new Map<string,string[]>();
  for(const issue of issues){
    const numbers=groups.get(issue.reason)??[];
    numbers.push('№'+issue.sceneNumber);
    groups.set(issue.reason,numbers);
  }
  return [...groups].map(([reason,numbers])=>numbers.join(', ')+' — '+reason).join(' ');
}

export class DocumentaryPlanningIncompleteError extends Error {
  readonly recoverable=true;
  constructor(message:string){super(message);this.name='DocumentaryPlanningIncompleteError';}
}

function samePlannedVisualTask(previous:Scene,next:Scene):boolean {
  const before=previous.documentary?.requirement,after=next.documentary?.requirement;
  const old=before?.aiSearchPlan,plan=after?.aiSearchPlan;
  return Boolean(old&&plan&&before?.text===after?.text&&old.visualTarget===plan.visualTarget
    &&old.subject===plan.subject&&old.visualScope===plan.visualScope&&isDeepStrictEqual(old.years,plan.years)
    &&isDeepStrictEqual(before?.footageFallback,after?.footageFallback));
}

export interface DocumentaryCandidatePriority {
  queries:string[];
  visualTarget:string;
  subjects:string[];
}

/** Rank the active task, never a provider's shortened retrieval query. */
export function documentarySimpleCandidatePriority(project:Project,scene:Scene,kind:'image'|'video'):DocumentaryCandidatePriority {
  const plan=planFastDocumentaryScene(project,scene,kind),ai=currentDocumentaryAiSearchPlan(project,scene);
  const fallback=currentDocumentaryFootageFallback(scene);
  const thematic=fallback&&(!ai||fallback.target===ai.fallbackVisualTarget&&JSON.stringify(fallback.queries)===JSON.stringify(ai.fallbackVideoQueries));
  return {queries:plan.queries,visualTarget:plan.visualTarget,
    subjects:thematic?[]:plan.namedSubject?[plan.namedSubject]:ai?[ai.subject]:documentarySearchSubjects(scene.documentary!.requirement)};
}

// OR is an alternative only outside a quoted title/name. Each authored query
// is also an alternative; missing words from another query cannot dilute it.
function catalogAlternatives(query:string):string[] {
  // Keep a shared subject/date around an OR group in every alternative.
  for(const match of query.matchAll(/"[^"]*"|\([^()]*\)/gu)){
    if(match[0].startsWith('"'))continue;
    const branches=catalogAlternatives(match[0].slice(1,-1));
    if(branches.length>1)return branches.flatMap(branch=>catalogAlternatives(
      query.slice(0,match.index)+branch+query.slice(match.index!+match[0].length)));
  }
  const alternatives:string[]=[];let start=0;
  for(const match of query.matchAll(/"[^"]*"|\bOR\b/giu)){
    if(match[0].startsWith('"'))continue;
    alternatives.push(query.slice(start,match.index));start=match.index!+match[0].length;
  }
  return [...alternatives,query.slice(start)].filter(value=>value.trim());
}

export function documentaryCandidatePriorityScore(candidate:DocumentaryCandidate,priority:DocumentaryCandidatePriority):number {
  const modifier=(word:string)=>catalogPeriodWord(word)||/^(?:victorian|edwardian|georgian|medieval|renaissance|ancient|modern|contemporary|era|period|image|picture|illustration)$/.test(word);
  const subject=new Set((priority.subjects.length?priority.subjects:[priority.visualTarget]).flatMap(catalogTerms).filter(word=>
    priority.subjects.length||!modifier(word)));
  const metadata=new Set(catalogWords(`${candidate.title} ${candidate.description??''}`));
  const queries=priority.queries.length?priority.queries:[priority.visualTarget];
  return Math.max(0,...queries.flatMap(catalogAlternatives).map(query=>{
    let total=0,matched=0;
    for(const term of catalogTerms(query)){
      const weight=modifier(term)?0.25:subject.has(term)?4:1;
      total+=weight;if(metadata.has(term))matched+=weight;
    }
    return total?matched/total:0;
  }));
}

export function selectSimpleDocumentaryCandidates(candidates: DocumentaryCandidate[],priority?:DocumentaryCandidatePriority): DocumentaryCandidate[] {
  const seen=new Set<string>();
  return candidates.filter(candidate=>{
    const key=documentaryCandidateKey(candidate);
    if(seen.has(key)||candidate.rights==='unknown'||(candidate.bytes??0)>750*1024*1024)return false;
    seen.add(key);
    // Active-task ordering keeps sparse and modifier-only captions available
    // for pixel review. Missing metadata is not a visual rejection.
    if(priority)return true;
    const terms=catalogTerms(candidate.query??''),metadata=new Set(catalogWords(`${candidate.title} ${candidate.description??''}`));
    return !onlyPeriodMatches(terms,terms.filter(term=>metadata.has(term)));
  }).sort((a,b)=>{
    const score=(candidate:DocumentaryCandidate)=>{
      if(priority)return documentaryCandidatePriorityScore(candidate,priority);
      const terms=catalogTerms(candidate.query??'').filter(term=>!catalogPeriodWord(term));
      const metadata=new Set(catalogWords(`${candidate.title} ${candidate.description??''}`));
      return terms.length?terms.filter(term=>metadata.has(term)).length/terms.length:0;
    };
    return score(b)-score(a);
  });
}

const catalogStopWords=new Set(['the','of','and','at','in','on','a','an','with','for','to','by','from','view','video','footage','photo','photograph','archive','archival']);
const catalogWords=(text:string)=>(text.toLowerCase().match(/[\p{L}\p{N}]+/gu)??[]).map(word=>
  /^(?:open|opens|opened|opening)$/.test(word)?'open'
    :/^(?:close|closes|closed|closing)$/.test(word)?'close'
    :/^(?:dredge|dredges|dredged|dredging|dredger|dredgers)$/.test(word)?'dredge':word);
const catalogTerms=(query:string)=>[...new Set(catalogWords(query).filter(word=>!catalogStopWords.has(word)))];
const catalogPeriodWord=(word:string)=>/^(?:\d{1,2}(?:st|nd|rd|th)|(?:1\d{3}|20\d{2})s?|century|centuries|historic|historical|vintage|early|mid|late)$/.test(word);
// "19th" and "century" describe one period. They cannot establish the subject.
const onlyPeriodMatches=(terms:string[],matches:string[])=>matches.length>0&&matches.every(catalogPeriodWord)&&terms.some(term=>!catalogPeriodWord(term));

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
  private readonly incompleteInputs=new WeakMap<DocumentaryPlanIncompleteError,ReturnType<typeof incompleteInputSnapshot>>();
  private selectionResources=documentarySelectionResources;
  private manualStages=new Map<string,{projectId:string;sceneId:string;revision:string;scene:Scene}>();
  private manualRevision(scene:Scene) {
    return createHash('sha256').update(JSON.stringify([scene.narration,scene.videoPath,scene.imagePath,scene.trimStartSeconds,scene.trimEndSeconds,
      scene.playbackRate,scene.durationOverrideSeconds,scene.documentary?.timing,scene.documentary?.checksum,scene.documentary?.pinned,scene.documentary?.cuts])).digest('hex');
  }
  private async stage(projectId:string,sceneId:string,candidate:DocumentaryCandidate):Promise<DocumentaryMaterialStage> {
    const {scene}=await this.editable(projectId,sceneId);
    const prepared=await this.apply(projectId,sceneId,candidate,false,undefined,undefined,undefined,undefined,true);
    const id=randomUUID(),selected=prepared.scenes.find(item=>item.id===sceneId)!;
    for(const [key,value] of this.manualStages)if(value.projectId===projectId&&value.sceneId===sceneId)this.manualStages.delete(key);
    this.manualStages.set(id,{projectId,sceneId,revision:this.manualRevision(scene),scene:selected});
    return {id,scene:selected};
  }
  async stageCandidate(projectId:string,sceneId:string,candidateId:string,fullOriginal=false):Promise<DocumentaryMaterialStage> {
    const {scene,project}=await this.editable(projectId,sceneId);
    const sources=project.scenes.filter(item=>item.id===sceneId||scene.documentary?.cuts?.some(cut=>cut.sourceSceneId===item.id));
    const pool=[...sources.flatMap(item=>item.documentary?.selected?[item.documentary.selected]:[]),...scene.documentary!.candidates];
    let candidate=pool.find(item=>documentaryCandidateSelectionKey(item)===candidateId)??pool.find(item=>item.id===candidateId);
    if(!candidate)throw new Error('Кандидат больше не доступен; повторите поиск.');
    if(fullOriginal&&candidate.excerpt){
      const checksum=candidate.id.match(/^local:([a-f0-9]{64})$/)?.[1]??sources.find(item=>item.documentary?.selected===candidate)?.documentary?.checksum;
      if(candidate.provider==='local'&&checksum){
        const origin=await readFile(join(this.materialRoot,'Catalog',`${checksum}.json`),'utf8').then(JSON.parse);
        if(origin.provider!=='local')candidate=origin;
      }
      if(!candidate?.downloadUrl||candidate.provider==='local')throw new Error('Полный оригинал недоступен по сохранённой ссылке. Выберите файл или найдите источник.');
      candidate={...candidate,localPath:undefined,durationSeconds:candidate.excerpt?.sourceDurationSeconds,excerpt:undefined};
    }
    return this.stage(projectId,sceneId,candidate);
  }
  async stageImport(projectId:string,sceneId:string,input:Parameters<DocumentaryApi['importDocumentaryMaterial']>[2]):Promise<DocumentaryMaterialStage> {
    if((!input.path&&!input.downloadUrl)||!input.title.trim())throw new Error('Выберите файл или прямую ссылку и укажите название.');
    const extension=extname(input.path??new URL(input.downloadUrl!).pathname).toLowerCase();
    const candidate:DocumentaryCandidate={id:`manual:${randomUUID()}`,provider:input.path?'local':'web',kind:/\.(mp4|mov|webm|mkv|wmv|avi|ogv)$/.test(extension)?'video':'image',
      title:input.title,description:input.title,pageUrl:input.pageUrl,downloadUrl:input.downloadUrl??'',localPath:input.path,author:input.author,
      license:input.license,licenseUrl:input.licenseUrl,rights:'unknown',attribution:[input.author,input.pageUrl,input.license].filter(Boolean).join(' · '),
      query:input.title,retrievedAt:new Date().toISOString(),match:'unverified',concerns:[]};
    return this.stage(projectId,sceneId,candidate);
  }
  async applyStage(projectId:string,sceneId:string,input:Parameters<DocumentaryApi['applyDocumentaryStage']>[2]):Promise<Project> {
    const stage=this.manualStages.get(input.stageId);
    if(!stage||stage.projectId!==projectId||stage.sceneId!==sceneId)throw new Error('Подготовленная замена недоступна. Скачайте материал снова.');
    const {scene}=await this.editable(projectId,sceneId);
    if(this.manualRevision(scene)!==stage.revision)throw new Error('Сцена изменилась во время выбора. Исходник сохранён; откройте замену заново.');
    const source=stage.scene.documentary!.selected!;
    if(input.cutId&&!scene.documentary?.cuts?.some(cut=>cut.id===input.cutId))throw new Error('Выбранный клип изменился; откройте замену заново.');
    if(source.rights==='unknown'&&!input.rightsConfirmed)throw new Error('Подтвердите условия использования материала.');
    if(input.illustrative&&!input.note.trim())throw new Error('Укажите отличие иллюстрации от текста.');
    const range=source.kind==='video'?documentaryFixedRange(scene,input.startSeconds,source.durationSeconds??0,input.cutId):undefined;
    const exists=await stat(stage.scene.videoPath||stage.scene.imagePath||'').then(info=>info.isFile(),()=>false);
    if(!exists)throw new Error('Подготовленный файл недоступен; прежний материал сохранён.');
    const prepared=range?await prepareDocumentaryRangePoster(this.storage.projectDirectory(projectId),{...stage.scene,trimStartSeconds:range.startSeconds,trimEndSeconds:range.endSeconds}):stage.scene;
    const updated=await this.projects.mutate(projectId,current=>{
      if(current.status==='generating'||current.status==='paused')throw new Error('Производство уже началось; замена не применена.');
      const latest=current.scenes.find(item=>item.id===sceneId);
      if(!latest||this.manualRevision(latest)!==stage.revision)throw new Error('Сцена изменилась; прежняя замена не применена.');
      const cuts=latest.documentary?.cuts?.map(cut=>{
        if(cut.sourceSceneId&&cut.sourceSceneId!==sceneId)return cut;
        const offset=(range?.startSeconds??0)-(latest.trimStartSeconds??0);
        return {...cut,trimStartSeconds:Math.max(0,cut.trimStartSeconds+offset),trimEndSeconds:source.kind==='video'?Math.max(0,(cut.trimEndSeconds??cut.trimStartSeconds+cut.durationInFrames/30*cut.playbackRate)+offset):undefined};
      });
      if(!input.cutId&&source.kind==='video'&&cuts?.some(cut=>(!cut.sourceSceneId||cut.sourceSceneId===sceneId)
        &&(cut.trimEndSeconds??0)>(source.durationSeconds??0)+.05))throw new Error('Исходник слишком короткий для текущих клипов. Замените отдельный клип.');
      const doc={...latest.documentary!,cuts,selected:{...source,rights:input.rightsConfirmed?'user-confirmed' as const:source.rights},
        checksum:stage.scene.documentary!.checksum,visualHash:stage.scene.documentary!.visualHash,visualReview:undefined,
        verified:true,pinned:true,manualReview:undefined,illustrative:input.illustrative,illustrationLabelInEditorOnly:true,reviewNote:input.note.slice(0,2000),autoError:undefined};
      const media={imagePath:prepared.imagePath,videoPath:prepared.videoPath,stockSource:prepared.stockSource,stockAlternates:[],sourceVolume:0};
      if(input.cutId){
        const sourceId=randomUUID();
        const sourceScene:Scene={...prepared,id:sourceId,order:current.scenes.length,narration:'',audioPath:undefined,narrationSlice:undefined,
          includeInAssembly:false,documentary:{...doc,cuts:undefined,comparison:undefined,caption:{...doc.caption,enabled:false},effects:[]}};
        return {outputPath:undefined,lastRender:undefined,scenes:[...current.scenes.map(item=>item.id===sceneId?{...item,documentary:{...item.documentary!,pinned:item.documentary!.verified||item.documentary!.pinned,cuts:item.documentary!.cuts!.map(cut=>cut.id===input.cutId
          ?{...cut,sourceSceneId:sourceId,trimStartSeconds:range?.startSeconds??0,trimEndSeconds:range?.endSeconds}:cut)}}:item),sourceScene]};
      }
      return {outputPath:undefined,lastRender:undefined,scenes:current.scenes.map(item=>item.id===sceneId?{...item,...media,trimStartSeconds:range?.startSeconds??0,trimEndSeconds:range?.endSeconds,documentary:doc}:item)};
    });
    this.manualStages.delete(input.stageId);
    await this.storage.ensureProject(updated);
    if(input.rightsConfirmed){
      const path=join(this.materialRoot,'Catalog',`${stage.scene.documentary!.checksum}.json`);
      const catalog=await readFile(path,'utf8').then(text=>JSON.parse(text) as DocumentaryCandidate,()=>undefined);
      if(catalog){await atomicWrite(path,JSON.stringify({...catalog,rights:'user-confirmed'},null,2));this.catalogIndex=undefined;}
    }
    return updated;
  }
  private active = new Set<string>();
  private autoRuns = new Map<string, Promise<AutoStockSelectionResult>>();
  private planningRuns=new Map<string,Set<Promise<Project>>>();
  private planningControllers=new Map<string,Set<AbortController>>();
  isSelecting(projectId:string) { return this.autoRuns.has(projectId); }
  private stopRequested = new Set<string>();
  private downloadControllers = new Map<string, AbortController>();
  private narrationWaits = new Map<string, (sceneId?: string) => Promise<void>>();
  /** An exhausted, unchanged selection resumes its saved fallback instead of
   * repeating discovery or submitting another paid review. Explicit scene
   * searches still use autoSelect; changed scripts/plans use normal planning. */
  get automaticVideoQuotaRequired():boolean {return Boolean(this.intelligence?.simpleSelection);}

  async canResumeNativeFallback(projectId:string):Promise<boolean> {
    if(!this.intelligence?.simpleSelection)return false;
    const project=await this.projects.get(projectId,{omitCandidates:true});
    if(!project||project.mediaMode!=='stock'||project.settings.assembly.documentary?.version!==2)return false;
    let exhausted=0;
    for(const scene of project.scenes.filter(item=>item.includeInAssembly!==false)){
      const doc=scene.documentary;
      if(!doc)return false;
      if(!doc.pinned&&(!currentDocumentaryAiSearchPlan(project,scene)
        ||doc.selectionPlan?.videoPercent!==project.settings.stockVideoPercent))return false;
      if(documentaryAutomaticMaterialReady(scene)){
        if(documentarySavedContextIssue(project,scene))return false;
        const path=doc.selected?.kind==='video'?scene.videoPath:scene.imagePath;
        if(!path||!await stat(path).then(info=>info.isFile()&&info.size>0,()=>false))return false;
      }else{
        if(doc.pinned||!this.exhaustedNativeFallback(scene))return false;
        exhausted++;
      }
    }
    return exhausted>0;
  }

  async completeWithNativeFallback(projectId:string,sourceOutage?:string,signal?:AbortSignal,automaticRecovery=false):Promise<Project> {
    let project=await this.projects.mutate(projectId,current=>({scenes:current.scenes.map(scene=>{
      const doc=scene.documentary,g=doc?.motionGraphic;
      // A stale automatically generated map with no coordinates is an invalid
      // overlay, not a reason to discard an already accepted photograph.
      if(doc?.verified&&!doc.pinned&&doc.selected&&g?.enabled&&g.kind.startsWith('map-')&&!validDocumentaryPlace(g.place)
        &&(g.origin==='automatic'||g.kind==='map-locator'&&!g.place&&!g.title.trim()))
        return {...scene,documentary:{...doc,motionGraphic:{...g,enabled:false},reviewNote:[doc.reviewNote,'Незаполненная карта отключена; выбранный материал сохранён. Заполните место, чтобы включить карту.'].filter(Boolean).join(' ')}};
      // Recheck saved automatic evidence locally; no second paid review is needed.
      // Pinned/manual material remains under the user's control.
      const stale=doc?.verified&&!doc.pinned&&(doc.visualReview?.illustrationApproval||doc.nativeFallback?.automaticRecovery)?documentarySavedContextIssue(current,scene):undefined;
      const pending=stale&&doc?{...scene,documentary:{...doc,verified:false,autoError:stale}}
        :sourceOutage&&doc&&!doc.verified&&!doc.autoError?{...scene,documentary:{...doc,autoError:sourceOutage}}:scene;
      return this.intelligence?.simpleSelection?pending:applyDocumentaryNativeFallback(current,pending);
    })}));
    if(this.intelligence?.simpleSelection){
      const exhausted=new Map<string,string>();
      project=await this.completeWithSourceFallback(project,signal,undefined,automaticRecovery,undefined,exhausted);
      signal?.throwIfAborted();
      if(automaticRecovery)project=await this.completeWithVideoQuota(project,signal);
      signal?.throwIfAborted();
      if(automaticRecovery&&exhausted.size)project=await this.projects.mutate(projectId,current=>{
        signal?.throwIfAborted();
        const coverage=documentaryCheckedVideoCoverage(current);
        const quotaMet=coverage.totalSeconds>0&&coverage.videoSeconds+1e-6>=coverage.totalSeconds*current.settings.stockVideoPercent/100;
        return {scenes:current.scenes.map(scene=>applyDocumentaryAutomaticNativeFallback(current,scene,exhausted.get(scene.id),quotaMet))};
      });
    }
    await this.storage.ensureProject(project);
    return project;
  }

  async completeWithVideoQuota(project:Project,signal?:AbortSignal):Promise<Project>{
    if(!this.intelligence?.simpleSelection||!this.intelligence.inspectForSelection||!this.intelligence.withSelectionBudget)return project;
    const projectId=project.id,intelligence=this.intelligence;
    return completeDocumentaryVideoQuota({
      read:async()=>(await this.projects.get(projectId))!,
      progress:(scene,current,result)=>{
        const coverage=documentaryCheckedVideoCoverage(current);
        this.publish({projectId,phase:'applying',currentSceneId:scene.id,completed:0,total:current.scenes.length,selected:0,skipped:0,failed:0,
          message:`Сцена ${scene.order+1}: ${result??'добор реального видео'}. Видео ${coverage.percent}% из ${current.settings.stockVideoPercent}%; проверенное фото сохранено до принятия замены.`});
        if(result)recordDiagnosticEvent('info','documentary.quota.result',{projectId,sceneId:scene.id,message:result,videoPercent:coverage.percent});
      },
      guardPath:(sceneId,binding)=>join(this.storage.projectDirectory(projectId),'Documentary',sceneId.replace(/[^a-zA-Z0-9_-]/g,'_'),'VideoQuota',binding+'.json'),
      sourceKeys:(candidate,checksum)=>[...uncertainCandidateFingerprints(candidate),...(checksum?[uncertainFileFingerprint(checksum)]:[])],
      discover:async(current,scene,query,stop)=>{
        const plan=planFastDocumentaryScene(current,scene,'video');
        const requirement=documentaryThematicDiscoveryRequirement(current,scene)
          ??documentaryPlannedDiscoveryRequirement(scene.documentary!.requirement,currentDocumentaryAiSearchPlan(current,scene));
        this.publish({projectId,phase:'searching',currentSceneId:scene.id,completed:0,total:current.scenes.length,selected:0,skipped:0,failed:0,
          message:`Сцена ${scene.order+1}: добираю реальное видео; проверенное фото сохранено`});
        const result=await this.searcher.search({query,kind:'video',entities:documentarySearchSubjects(requirement),
          years:requirement.years,providers:fastDocumentaryProviders(plan,'video')},true,stop,true);
        const videos=result.candidates.filter(candidate=>candidate.kind==='video');
        return preferUnusedDocumentaryCandidates(current,scene,requirement.identities?.length
          ?documentaryNamedMetadataShortlist(videos,requirement,scene.narration,true):videos,true,candidate=>fastDocumentaryCandidateScore(plan,candidate));
      },
      prepare:async(current,scene,candidate,budget)=>intelligence.withSelectionBudget!(budget,async()=>{
        const thematicProjection=documentaryThematicDiscoveryRequirement(current,scene)?{scene,binding:budget.photoBinding}:undefined;
        const prepared=await this.apply(projectId,scene.id,candidate,false,undefined,undefined,budget.deadline,undefined,false,{signal:budget.signal,thematicProjection});
        const replacement=prepared.scenes.find(item=>item.id===scene.id)!;
        return {...replacement,...documentaryFallbackVideoRange(current,replacement,true)};
      }),
      inspect:async(current,scene,budget)=>intelligence.withSelectionBudget!(budget,async()=>
        (await intelligence.inspectForSelection!(current,scene,undefined,()=>budget.signal.aborted)).review),
      commit:async(sceneId,binding,accepted,beforeCommit)=>{
        signal?.throwIfAborted();
        const prepared=await prepareDocumentaryRangePoster(this.storage.projectDirectory(projectId),accepted);
        await beforeCommit();
        let committed=false;
        await this.projects.mutate(projectId,current=>({scenes:current.scenes.map(latest=>{
          if(latest.id!==sceneId||signal?.aborted||!documentaryVideoQuotaCurrent(current,latest,binding)||documentaryVideoQuotaMet(current))return latest;
          const replacement={...latest,imagePath:prepared.imagePath,videoPath:prepared.videoPath,stockSource:prepared.stockSource,stockAlternates:[],sourceVolume:0,
            trimStartSeconds:prepared.trimStartSeconds,trimEndSeconds:prepared.trimEndSeconds,
            documentary:{...latest.documentary!,requirement:prepared.documentary!.requirement,
              selected:prepared.documentary!.selected,checksum:prepared.documentary!.checksum,
              visualHash:prepared.documentary!.visualHash,visualReview:prepared.documentary!.visualReview,verified:true,
              ...documentaryAcceptedMaterialMetadata(current,prepared,prepared.documentary!.visualReview!,true),
              selectionPlan:{kind:'video' as const,videoPercent:current.settings.stockVideoPercent}}};
          const trial={...current,scenes:current.scenes.map(scene=>scene.id===sceneId?replacement:scene)};
          if(documentarySavedContextIssue(trial,replacement)||documentaryReuseIssue(current,replacement)
            ||documentaryCheckedVideoCoverage(trial).videoSeconds<=documentaryCheckedVideoCoverage(current).videoSeconds)return latest;
          committed=true;return replacement;
        })}));
        return committed;
      }
    },signal);
  }

  private exhaustedNativeFallback(scene:Scene):boolean {
    return Boolean(scene.documentary?.requirement.footageFallback?.automaticRecovery||scene.documentary?.autoError?.startsWith('Запасной материал недоступен:')
      ||scene.documentary?.autoError?.startsWith('Запасной материал Pexels недоступен'));
  }

  private readonly geminiRetries=new Map<string,Promise<Project>>();
  retryGemini(projectId:string,sceneId:string):Promise<Project> {
    const key=JSON.stringify([projectId,sceneId]),active=this.geminiRetries.get(key);
    if(active)return active;
    const run=(async()=>{
      const release=await this.reserveSource(`query-target:${projectId}`);
      try{
        const {project}=await this.editable(projectId,sceneId);
        if(!this.intelligence?.inspectForSelection||!this.intelligence.withSelectionBudget)throw Error('Штатная проверка Gemini недоступна.');
        const result=await this.completeWithSourceFallback(project,undefined,sceneId);
        await this.storage.ensureProject(result);return result;
      }finally{release();}
    })();
    this.geminiRetries.set(key,run);
    void run.finally(()=>{if(this.geminiRetries.get(key)===run)this.geminiRetries.delete(key);}).catch(()=>{});
    return run;
  }

  private async completeWithSourceFallback(project:Project,signal?:AbortSignal,retrySceneId?:string,automaticRecovery=false,thematicSceneIds?:ReadonlySet<string>,exhaustedScenes?:Map<string,string>):Promise<Project> {
    const photoFirst=documentaryPhotoFirstScenes(project,true);
    const projectId=project.id;
    const ready=automaticRecovery?documentaryAutomaticMaterialReady:documentaryMaterialUsable;
    const inScope=(scene:Scene)=>!thematicSceneIds||thematicSceneIds.has(scene.id);
    const recoveryBindings=new Map(project.scenes.filter(inScope).map(scene=>[scene.id,documentaryThematicRecoveryBinding(project,scene)]));
    const primaryBindings=new Map(project.scenes.filter(scene=>inScope(scene)&&!scene.documentary?.requirement.footageFallback)
      .map(scene=>[scene.id,documentaryThematicRecoveryBinding(project,scene)]));
    const completedDiscovery=new Set<string>();
    const discoveryFor=(current:Project,scene:Scene)=>automaticRecovery
      ?documentaryThematicDiscoveryRequirement(current,scene)??documentaryPlannedDiscoveryRequirement(scene.documentary!.requirement,currentDocumentaryAiSearchPlan(current,scene))
      :scene.documentary!.requirement;
    const activeThematic=(current:Project,scene:Scene)=>automaticRecovery&&Boolean(documentaryThematicDiscoveryRequirement(current,scene));
    // Unfinished/settled-unusable reviews are not approval and must not be
    // submitted again under a library alias while looking for another source.
    const heldSources=new Map<string,Set<string>>();
    const recoverySourceKeys=(source:DocumentaryCandidate,checksum?:string)=>documentaryVisualRejectionKeys(source,
      checksum??(automaticRecovery?/^local:([a-f0-9]{64})$/.exec(source.id)?.[1]:undefined));
    const holdSource=(scene:Scene)=>{
      const doc=scene.documentary;
      if(!automaticRecovery||!doc?.selected||!doc.manualReview?.analysis||ready(scene))return;
      const keys=heldSources.get(scene.id)??new Set<string>();
      recoverySourceKeys(doc.selected,doc.checksum).forEach(key=>keys.add(key));heldSources.set(scene.id,keys);
    };
    const held=(sceneId:string,source:DocumentaryCandidate,checksum?:string)=>recoverySourceKeys(source,checksum)
      .some(key=>heldSources.get(sceneId)?.has(key));
    project.scenes.forEach(scene=>{
      if(automaticRecovery&&scene.documentary?.requirement.footageFallback?.automaticRecovery)
        heldSources.set(scene.id,new Set(scene.documentary.requirement.footageFallback.automaticRecovery.blockedSourceKeys));
      holdSource(scene);
    });
    const checkThematicCurrent=async(scene:Scene)=>{
      if(!automaticRecovery||!scene.documentary?.requirement.footageFallback?.automaticRecovery)return;
      const current=(await this.projects.get(projectId))!,latest=current.scenes.find(item=>item.id===scene.id);
      if(!latest||!inScope(latest)||latest.documentary?.pinned||latest.documentary?.verified||latest.includeInAssembly===false
        ||!documentaryThematicDiscoveryRequirement(current,latest)
        ||this.manualRevision(latest)!==this.manualRevision(scene))throw Error('Сцена изменилась во время тематического подбора.');
    };
    // Persist only actual source attempts, before I/O; Stop before the first
    // attempt leaves the entire next invocation available. Receipts stay intact.
    const rememberThematicSource=async(scene:Scene,source:DocumentaryCandidate,checksum?:string)=>{
      if(!automaticRecovery||!scene.documentary?.requirement.footageFallback?.automaticRecovery)return;
      await checkThematicCurrent(scene);
      const keys=recoverySourceKeys(source,checksum);
      await this.projects.mutate(projectId,current=>({scenes:current.scenes.map(latest=>{
        if(latest.id!==scene.id||!documentaryThematicDiscoveryRequirement(current,latest))return latest;
        const doc=latest.documentary!,fallback=doc.requirement.footageFallback!,state=fallback.automaticRecovery!;
        return {...latest,documentary:{...doc,requirement:{...doc.requirement,footageFallback:{...fallback,
          automaticRecovery:{...state,blockedSourceKeys:[...new Set([...state.blockedSourceKeys,...keys])]}}}}};
      })}));
    };
    const budgets=new Map<string,{remaining:number;attempted:Set<string>;
      active?:{deadline:number;signal:AbortSignal;timer:ReturnType<typeof setTimeout>}}>();
    const budgetFor=(sceneId:string)=>{
      let budget=budgets.get(sceneId);
      if(!budget){
        budget={remaining:90_000,attempted:new Set()};
        budgets.set(sceneId,budget);
      }
      if(!budget.active){
        const timeout=new AbortController(),timer=setTimeout(()=>timeout.abort(new DOMException('Время подбора сцены исчерпано.','TimeoutError')),Math.ceil(budget.remaining));
        timer.unref();
        if(budget.remaining<=0)timeout.abort(new DOMException('Время подбора сцены исчерпано.','TimeoutError'));
        budget.active={deadline:Date.now()+budget.remaining,signal:signal?AbortSignal.any([signal,timeout.signal]):timeout.signal,timer};
      }
      return {...budget.active,attempted:budget.attempted};
    };
    const pauseBudget=(sceneId:string)=>{
      const budget=budgets.get(sceneId),active=budget?.active;
      if(!budget||!active)return;
      // The later donor pass shares the recipient's remaining active time and
      // attempts. Work on other scenes must not expire its timeout signal.
      budget.remaining=active.signal.aborted?0:Math.max(0,Math.min(budget.remaining,active.deadline-Date.now()));
      clearTimeout(active.timer);budget.active=undefined;
    };
    const fallbackKind=(current:Project,scene:Scene)=>{
      if(activeThematic(current,scene))return 'video' as const;
      const plan=currentDocumentaryAiSearchPlan(current,scene);
      const desired=automaticRecovery&&plan?.visualScope==='illustrative'&&plan.preferredKind==='image'&&plan.imageQueries.length
        ?'image':scene.documentary!.selectionPlan?.kind??(photoFirst.has(scene.id)?'image':'video');
      if(!plan)return desired;
      const allowed=(kind:'image'|'video')=>(kind==='image'?plan.imageQueries:plan.videoQueries).length>0;
      return allowed(desired)?desired:allowed(plan.preferredKind)?plan.preferredKind:allowed('image')?'image':allowed('video')?'video':undefined;
    };
    const rank=(current:Project,scene:Scene,candidates:DocumentaryCandidate[])=>{
      if(candidates.some(candidate=>candidate.provider==='local')){
        const requirement=scene.documentary!.requirement,plan=currentDocumentaryAiSearchPlan(current,scene);
        const queries=activeThematic(current,scene)?requirement.footageFallback!.queries:plan?(candidates[0]?.kind==='image'?plan.imageQueries:[...plan.videoQueries,...plan.fallbackVideoQueries]):requirement.queries;
        const lanes=queries.map(catalogTerms);
        if(lanes.some(terms=>terms.some(catalogPeriodWord)))candidates=candidates.filter(candidate=>{
          if(candidate.provider!=='local')return true;
          const evidence=new Set(catalogWords([candidate.title,candidate.description,candidate.previousFrameSearchHint].filter(Boolean).join(' ')));
          const overlaps=lanes.map(terms=>({terms,matches:terms.filter(word=>evidence.has(word))})).filter(hit=>hit.matches.length);
          return !overlaps.length||overlaps.some(hit=>!onlyPeriodMatches(hit.terms,hit.matches));
        });
      }
      const requirement=scene.documentary!.requirement;
      const discovery=discoveryFor(current,scene);
      const named=documentaryNamedMetadataShortlist(candidates,discovery,scene.narration,automaticRecovery);
      const names=new Set(named.map(documentaryCandidateKey));
      const relevant=new Set(documentaryMetadataShortlist(scene,candidates).map(documentaryCandidateKey));
      // For otherwise equivalent backups prefer captions that describe the
      // planned shot. An old local file can arrive first solely due to latency.
      const fast=scene.documentary!.requirement.aiSearchPlan&&candidates.length>1?planFastDocumentaryScene(current,scene,candidates[0]!.kind):undefined;
      const score=fast?.aiPlanned?(candidate:DocumentaryCandidate)=>fastDocumentaryCandidateScore(fast,{title:candidate.title,description:candidate.description??''}):undefined;
      const remaining=candidates.filter(candidate=>!names.has(documentaryCandidateKey(candidate)));
      return [...named,...preferUnusedDocumentaryCandidates(current,scene,remaining.filter(candidate=>relevant.has(documentaryCandidateKey(candidate))),true,score),
        ...preferUnusedDocumentaryCandidates(current,scene,remaining.filter(candidate=>!relevant.has(documentaryCandidateKey(candidate))),true,score)];
    };
    const rejectionsFor=async(current:Project,scene:Scene)=>{
      const requirement=scene.documentary!.requirement;
      // Same simple-selection scope as the ordinary selector: a changed target
      // can reconsider pixels, a provider/file alias cannot erase a refusal.
      const scope=JSON.stringify([documentaryNarrationContext(current,scene),requirement.entities,requirement.identities,requirement.years,requirement.detail,scene.documentary?.motionGraphic]);
      let rejectionScope=createHash('sha256').update(JSON.stringify(['visual-illustration-v1',scope,current.aspectRatio,requirement.preferredKind,scene.documentary?.layout])).digest('hex');
      if(activeThematic(current,scene))rejectionScope=createHash('sha256').update(JSON.stringify([rejectionScope,'automatic-thematic-v1',requirement.footageFallback!.target])).digest('hex');
      if((await documentaryLegacyMotionRefusals(this.storage.projectDirectory(projectId),scene)).size)
        rejectionScope=createHash('sha256').update(JSON.stringify([rejectionScope,'physical-subject-motion-v2'])).digest('hex');
      const path=join(this.storage.projectDirectory(projectId),'Documentary',scene.id.replace(/[^a-zA-Z0-9_-]/g,'_'),'rejected-candidates.json');
      return {path,scope:rejectionScope,keys:await readDocumentaryRejections(path,rejectionScope)};
    };
    const savePrepared=async(original:Scene,prepared:Project,kind:'image'|'video',reason:string)=>{
      const replacement=prepared.scenes.find(scene=>scene.id===original.id)!;
      const mediaPath=kind==='video'?replacement.videoPath:replacement.imagePath;
      if(!mediaPath||!await stat(mediaPath).then(info=>info.isFile()&&info.size>0,()=>false))throw Error('Скачанный запасной файл недоступен.');
      signal?.throwIfAborted();
      const revision=this.manualRevision(original);
      return this.projects.mutate(projectId,current=>({scenes:current.scenes.map(scene=>{
        if(scene.id!==original.id)return scene;
        if(this.manualRevision(scene)!==revision||scene.narration!==original.narration||scene.documentary?.verified||scene.documentary?.pinned)
          throw Error('Сцена изменилась во время запасного подбора.');
        if(automaticRecovery&&original.documentary?.requirement.footageFallback?.automaticRecovery
          &&!documentaryThematicDiscoveryRequirement(current,scene))throw Error('Визуальное задание изменилось во время тематического подбора.');
        const sameFile=Boolean(scene.documentary?.checksum&&scene.documentary.checksum===replacement.documentary?.checksum
          &&scene.documentary.selected?.kind===kind);
        const range=sameFile&&(scene.trimEndSeconds!==undefined||scene.trimStartSeconds)
          ?{trimStartSeconds:scene.trimStartSeconds,trimEndSeconds:scene.trimEndSeconds}
          :documentaryFallbackVideoRange(current,{...scene,...replacement,trimStartSeconds:0,trimEndSeconds:undefined},automaticRecovery);
        return {...scene,imagePath:replacement.imagePath,videoPath:replacement.videoPath,stockSource:replacement.stockSource,
          stockAlternates:[],...range,
          documentary:{...scene.documentary!,selected:replacement.documentary!.selected,checksum:replacement.documentary!.checksum,
            visualHash:replacement.documentary!.visualHash,visualReview:undefined,nativeFallback:undefined,verified:false,pinned:false,
            selectionPlan:{kind,videoPercent:current.settings.stockVideoPercent},illustrative:true,illustrationLabelInEditorOnly:true,
            autoError:undefined,reviewNote:`Проверить вручную. ${reason}`,
            manualReview:{version:1,status:'pending',provider:replacement.documentary!.selected!.provider,kind,candidateId:replacement.documentary!.selected!.id,
              checksum:replacement.documentary!.checksum!,mediaPath,narration:scene.narration,reason}}};
      })}));
    };
    const promotePreparedReview=async(sceneId:string)=>{
      const current=(await this.projects.get(projectId))!,scene=current.scenes.find(item=>item.id===sceneId),doc=scene?.documentary;
      if(!scene||!doc||doc.pinned||!documentaryManualReviewReady(scene)||doc.manualReview?.analysis?.status!=='accepted'
        ||doc.visualReview?.status!=='accepted'||!doc.visualReview.illustrationApproval||!doc.visualReview.localReview)return;
      if(doc.requirement.footageFallback?.automaticRecovery&&!documentaryThematicDiscoveryRequirement(current,scene))return;
      const file=doc.selected?.kind==='video'?scene.videoPath:scene.imagePath;
      if(!file)return;
      const info=await stat(file,{bigint:true}).catch(()=>undefined),local=doc.visualReview.localReview;
      if(!info?.isFile()||String(info.size)!==local.size||String(info.mtimeNs)!==local.mtimeNs||String(info.ctimeNs)!==local.ctimeNs)return;
      const accepted={...scene,status:'ready' as const,documentary:{...doc,verified:true,
        ...documentaryAcceptedMaterialMetadata(current,scene,doc.visualReview,true)}};
      if(documentarySavedContextIssue(current,accepted))return;
      const revision=this.manualRevision(scene),binding=documentaryGeminiRetryBinding(current,scene);
      await this.projects.mutate(projectId,saved=>({scenes:saved.scenes.map(latest=>latest.id===sceneId
        &&this.manualRevision(latest)===revision&&documentaryGeminiRetryBinding(saved,latest)===binding
        &&(!doc.requirement.footageFallback?.automaticRecovery||Boolean(documentaryThematicDiscoveryRequirement(saved,latest)))
        &&isDeepStrictEqual(latest.documentary?.visualReview,doc.visualReview)
        ?{...latest,status:'ready' as const,documentary:{...latest.documentary!,verified:true,
          ...documentaryAcceptedMaterialMetadata(saved,latest,doc.visualReview!,true)}}:latest)}));
    };
    const reviewPrepared=async(sceneId:string,explicitRetry=false,selectionDeadline?:number)=>{
      signal?.throwIfAborted();
      await promotePreparedReview(sceneId);
      let retryFileRevision:{size:string;mtimeNs:string;ctimeNs:string}|undefined;
      if(explicitRetry){
        const initial=(await this.projects.get(projectId))!.scenes.find(item=>item.id===sceneId);
        if(initial?.documentary?.verified&&!initial.documentary.pinned&&initial.documentary.visualReview?.illustrationApproval)return;
        if(!initial?.documentary?.manualReview?.analysis)throw Error('Нет сохранённой ошибки до отправки; повтор запрещён.');
        // Completed receipts always win. This recursive entry is cache-only
        // for every persisted analysis; it never spends the explicit retry.
        await reviewPrepared(sceneId);
        const saved=(await this.projects.get(projectId))!,scene=saved.scenes.find(item=>item.id===sceneId)!;
        if(scene.documentary?.verified)return;
        if(['accepted','rejected','uncertain'].includes(scene.documentary?.manualReview?.analysis?.status??''))return;
        if(!documentaryGeminiRetryAllowed(saved,scene))throw Error('Нет доказанной ошибки до отправки для текущего материала.');
        const proof=scene.documentary!.manualReview!.analysis!.preSubmit!,file=scene.documentary!.selected!.kind==='video'?scene.videoPath:scene.imagePath;
        retryFileRevision=proof.fileRevision;
        const info=await stat(file!,{bigint:true});
        if(JSON.stringify({size:String(info.size),mtimeNs:String(info.mtimeNs),ctimeNs:String(info.ctimeNs)})!==JSON.stringify(proof.fileRevision))
          throw Error('Локальный файл изменился; прежнее разрешение повтора недействительно.');
        const receipt=join(this.storage.projectDirectory(projectId),'Documentary','Analysis',`${proof.checkpointKey}.json`);
        if(await stat(receipt).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;}))
          throw Error('Существует receipt прежнего запроса; повторная отправка запрещена.');
        if(!await this.intelligence!.available())throw Error('Gemini недоступен; устраните ошибку перед повтором.');
      }
      let claimed=false;
      // Claim durably before entering the paid boundary. A saved unfinished
      // claim permits only free recovery from the intelligence checkpoints.
      let current=await this.projects.mutate(projectId,saved=>({scenes:saved.scenes.map(scene=>{
        if(scene.id!==sceneId||!documentaryManualReviewReady(scene))return scene;
        if(scene.documentary!.requirement.footageFallback?.automaticRecovery&&!documentaryThematicDiscoveryRequirement(saved,scene))return scene;
        if(explicitRetry){
          if(saved.status==='generating'||saved.status==='paused'||!documentaryGeminiRetryAllowed(saved,scene))
            throw Error('Сцена изменилась или проверка уже начата; повтор не отправлен.');
        }else if(scene.documentary!.manualReview!.analysis)return scene;
        claimed=true;
        return {...scene,documentary:{...scene.documentary!,manualReview:{...scene.documentary!.manualReview!,
          analysis:{status:'pending' as const,reason:'Просмотр фактического файла начат; завершённого результата пока нет.'}}}};
      })}));
      const original=current.scenes.find(scene=>scene.id===sceneId);
      if(!original||!documentaryManualReviewReady(original))return;
      if(original.documentary!.requirement.footageFallback?.automaticRecovery&&!documentaryThematicDiscoveryRequirement(current,original))return;
      const cacheOnly=!claimed;
      if(cacheOnly&&(!this.intelligence!.inspectForSelection
        ||!['pending','unknown','error'].includes(original.documentary!.manualReview!.analysis?.status??'')))return;
      const revision=this.manualRevision(original);
      let review:NonNullable<Scene['documentary']>['visualReview'];
      let analysis:NonNullable<NonNullable<Scene['documentary']>['manualReview']>['analysis'];
      try{
        if(!cacheOnly&&!explicitRetry&&!await this.intelligence!.available())throw new DocumentaryAnalysisError('Gemini недоступен; файл оставлен для ручной проверки.');
        signal?.throwIfAborted();
        this.publish({projectId,phase:'applying',currentSceneId:sceneId,completed:0,total:current.scenes.length,selected:0,skipped:0,failed:0,
          message:`Сцена ${original.order+1}: ${cacheOnly?'восстанавливаю сохранённую проверку':'проверяю фактический запасной материал Gemini'}`});
        const inspect=async()=>this.intelligence!.inspectForSelection
          ?(await this.intelligence!.inspectForSelection(current,original,undefined,()=>Boolean(signal?.aborted),cacheOnly)).review
          :this.intelligence!.inspect(current,original);
        let submissions=0;
        const deadline=selectionDeadline??Date.now()+90_000;
        review=this.intelligence!.withSelectionBudget?await this.intelligence!.withSelectionBudget({
          remaining:()=>signal?.aborted?0:deadline-Date.now(),capturePreSubmitFailure:!cacheOnly,beforeSubmit:async()=>{
            if(retryFileRevision){
              const file=original.documentary!.selected!.kind==='video'?original.videoPath:original.imagePath,info=await stat(file!,{bigint:true});
              if(JSON.stringify({size:String(info.size),mtimeNs:String(info.mtimeNs),ctimeNs:String(info.ctimeNs)})!==JSON.stringify(retryFileRevision))
                throw Error('Локальный файл изменился до отправки; запрос не отправлен.');
            }
            // Read the scene after the last file await: manual edits during stat
            // must be observed before this single-review guard allows dispatch.
            const saved=(await this.projects.get(projectId))!,scene=saved.scenes.find(item=>item.id===sceneId);
            if(!scene||!documentaryManualReviewReady(scene)
              ||documentaryGeminiRetryBinding(saved,scene)!==documentaryGeminiRetryBinding(current,original)
              ||original.documentary!.requirement.footageFallback?.automaticRecovery&&!documentaryThematicDiscoveryRequirement(saved,scene))
              throw Error('Сцена изменилась до отправки проверки; запрос не отправлен.');
          },submit:()=>{
            if(cacheOnly)throw new DocumentaryCachedAnalysisMissing('Cache-only восстановление не разрешает новую отправку.');
            if(submissions++>=1)throw new DocumentaryAnalysisError('Лимит одного просмотра запасного материала исчерпан; повтор не отправлен.');
          }},inspect):await inspect();
        analysis={status:review.status,reason:review.reason};
      }catch(error){
        if(cacheOnly){signal?.throwIfAborted();return;}
        analysis={status:error instanceof DocumentaryAnalysisError?(error.kind==='pending'?'pending':'error')
          :error instanceof AnyModelCompletionUncertainError?'unknown':'error',
          reason:error instanceof Error?error.message:String(error),
          ...(error instanceof DocumentaryPreSubmitFailure?{preSubmit:{version:1 as const,checkpointKey:error.checkpointKey,
            fileRevision:error.fileRevision,binding:documentaryGeminiRetryBinding(current,original)}}:{})};
      }
      current=await this.projects.mutate(projectId,saved=>({scenes:saved.scenes.map(scene=>{
        // A manual replacement, changed narration or reviewed interval owns the
        // scene. Never attach an old verdict to those new pixels.
        if(scene.id!==sceneId||this.manualRevision(scene)!==revision||!documentaryManualReviewReady(scene)
          ||documentaryGeminiRetryBinding(saved,scene)!==documentaryGeminiRetryBinding(current,original)
          ||original.documentary!.requirement.footageFallback?.automaticRecovery&&!documentaryThematicDiscoveryRequirement(saved,scene)
          ||scene.documentary!.manualReview!.candidateId!==original.documentary!.manualReview!.candidateId)return scene;
        return {...scene,documentary:{...scene.documentary!,visualReview:review,reviewNote:`Проверить вручную. ${analysis.reason}`,
          manualReview:{...scene.documentary!.manualReview!,analysis}}};
      })}));
      await promotePreparedReview(sceneId);
      signal?.throwIfAborted();
    };
    if(retrySceneId){await reviewPrepared(retrySceneId,true);return (await this.projects.get(projectId))!;}
    const reuseLocalSource=async(original:Scene,current:Project,kind:'image'|'video')=>{
      const requirement=original.documentary!.requirement;
      const discovery=discoveryFor(current,original);
      const donors=current.scenes.filter(scene=>scene.id!==original.id&&documentaryMaterialUsable(scene)&&scene.documentary?.selected
        &&(scene.documentary.verified||scene.documentary.manualReview?.analysis?.status==='accepted')
        &&scene.documentary.visualReview?.status!=='rejected'
        &&scene.documentary.selected.rights!=='unknown'&&scene.documentary.selected.kind===kind
        &&!documentaryCandidateSubjectIssue(scene.documentary.selected,original.documentary!.requirement,original.narration,automaticRecovery)
        &&(!automaticRecovery||!discovery.identities?.length||documentaryNamedMetadataShortlist([scene.documentary.selected],discovery,original.narration).length>0)
        &&!held(original.id,scene.documentary.selected,scene.documentary.checksum));
      const rejected=await rejectionsFor(current,original);
      const sources=rank(current,original,donors.filter(scene=>!documentaryVisualRejectionKeys(scene.documentary!.selected!,scene.documentary!.checksum)
        .some(key=>rejected.keys.has(key))).map(scene=>scene.documentary!.selected!));
      const pool=sources.filter((source,index)=>sources.findIndex(other=>documentaryCandidateKey(other)===documentaryCandidateKey(source))===index)
        .map(source=>donors.find(scene=>scene.documentary!.selected===source)!);
      const {deadline,signal:reuseSignal,attempted}=budgetFor(original.id);
      let recipient=original;
      for(const donor of pool){
        signal?.throwIfAborted();if(reuseSignal.aborted||Date.now()>=deadline||attempted.size>=3)break;
        const source=donor.documentary!.selected!,localPath=source.localPath||(kind==='video'?donor.videoPath:donor.imagePath);
        if(attempted.has(documentaryCandidateKey(source)))continue;
        if(!localPath||!await stat(localPath).then(info=>info.isFile()&&info.size>0,()=>false))continue;
        attempted.add(documentaryCandidateKey(source));
        try{
          await rememberThematicSource(recipient,source,donor.documentary!.checksum);
          const prepared=await this.apply(projectId,original.id,{...source,localPath},false,undefined,undefined,deadline,undefined,true,{signal:reuseSignal});
          const replacement=prepared.scenes.find(scene=>scene.id===original.id)!;
          if(held(original.id,replacement.documentary!.selected!,replacement.documentary!.checksum))continue;
          if(documentaryVisualRejectionKeys(replacement.documentary!.selected!,replacement.documentary!.checksum).some(key=>rejected.keys.has(key)))continue;
          const reason=`Повторно использован запасной материал (${source.provider}) из сцены ${donor.order+1} этого проекта после ошибки источника.`;
          await checkThematicCurrent(recipient);
          const saved=await savePrepared(recipient,prepared,kind,reason),savedScene=saved.scenes.find(scene=>scene.id===original.id)!;
          await reviewPrepared(original.id,false,deadline);
          const reviewed=(await this.projects.get(projectId))!.scenes.find(scene=>scene.id===original.id)!;
          holdSource(reviewed);
          if(this.manualRevision(reviewed)!==this.manualRevision(savedScene)||reviewed.documentary?.verified||reviewed.documentary?.pinned
            ||!automaticRecovery&&reviewed.documentary?.manualReview?.analysis?.status!=='rejected')return true;
          recipient=reviewed;
          if(reviewed.documentary?.manualReview?.analysis?.status==='rejected'&&documentaryCacheableVisualRejection(reviewed.documentary.selected!)){
            documentaryVisualRejectionKeys(reviewed.documentary.selected!,reviewed.documentary.checksum).forEach(key=>rejected.keys.add(key));
            await saveDocumentaryRejections(rejected.path,rejected.scope,rejected.keys);
          }
        }catch{signal?.throwIfAborted();}
      }
      const final=(await this.projects.get(projectId))!.scenes.find(scene=>scene.id===original.id)!;
      return ready(final)&&final.documentary?.manualReview?.analysis?.status!=='rejected';
    };
    await runDocumentarySelectionQueue(project.scenes,async item=>{
      try {
      signal?.throwIfAborted();
      // Each worker reads the latest saved scene; mutations merge through the
      // repository so another worker's completed result cannot be overwritten.
      let project=(await this.projects.get(projectId))!;
      let original=project.scenes.find(scene=>scene.id===item.id);
      if(!original||!inScope(original))return;
      let doc=original.documentary;
      if(original.includeInAssembly===false||!doc||doc.pinned||doc.verified)return;
      if(automaticRecovery&&doc.nativeFallback?.automaticRecovery)return;
      if(automaticRecovery&&doc.requirement.footageFallback?.automaticRecovery&&!activeThematic(project,original))return;
      const file=doc.selected?.kind==='video'?original.videoPath:original.imagePath;
      if(documentaryManualReviewReady(original)&&file&&await stat(file).then(info=>info.isFile()&&info.size>0,()=>false)){
        // A first review of saved pixels spends the same automatic recovery
        // time as later preparation/reviews; persisted analyses stay cache-only.
        const deadline=automaticRecovery&&!doc.manualReview?.analysis?budgetFor(original.id).deadline:undefined;
        await reviewPrepared(original.id,false,deadline);
        project=(await this.projects.get(projectId))!;original=project.scenes.find(scene=>scene.id===item.id)!;doc=original.documentary!;
        holdSource(original);
        if(ready(original)||doc.pinned||!automaticRecovery&&doc.manualReview?.analysis?.status!=='rejected')return;
      }
      const desiredKind=fallbackKind(project,original);
      if(!desiredKind)return;
      let kind:'image'|'video'=desiredKind;
      const plan=currentDocumentaryAiSearchPlan(project,original);
      const thematic=activeThematic(project,original),discovery=discoveryFor(project,original);
      const exactFirst=Boolean(plan||doc.requirement.identities?.length);
      // The current plan already permits and prefers this photo lane. Give
      // compatible local photos a chance before unrelated video recovery can
      // spend the same three attempts; each recipient still needs its review.
      if(automaticRecovery&&kind==='image'&&doc.selectionPlan?.kind==='video'&&plan?.visualScope==='illustrative'&&plan.preferredKind==='image'
        &&await reuseLocalSource(original,project,kind))return;
      project=(await this.projects.get(projectId))!;original=project.scenes.find(scene=>scene.id===item.id)!;doc=original.documentary!;
      // A persisted exhausted fallback has already spent its bounded network
      // attempt. Resume can use a local donor before repeating that attempt.
      if(!exactFirst&&this.exhaustedNativeFallback(original)&&await reuseLocalSource(original,project,kind))return;
      const queries=thematic?doc.requirement.footageFallback!.queries:doc.requirement.aiSearchPlan
        ?plan?kind==='video'?[...plan.videoQueries,...plan.fallbackVideoQueries]:plan.imageQueries:[]
        :doc.requirement.queries;
      const validQuery=(value:string)=>value&&value.trim().length>=2&&value.trim().length<=240;
      const query=queries.find(validQuery)?.trim();
      const reserve=!thematic&&kind==='video'?plan?.fallbackVideoQueries.find(validQuery)?.trim():undefined;
      const namedTarget=Boolean(discovery.identities?.length);
      const exactPhotos=kind==='video'&&namedTarget?plan?.imageQueries.filter(validQuery)??[]:[];
      // One exact video candidate, then the planned exact photographs before
      // the untried video candidates and generic B-roll. The empty-query lane
      // reuses the saved response within the same three transfers and deadline.
      const searchQueries:Array<{query:string;kind:'image'|'video';reserve?:boolean;limit?:number}>=thematic
        ?queries.filter(validQuery).map(query=>({query,kind:'video' as const,reserve:true})):plan
        ?[...(query?[{query,kind,limit:exactPhotos.length?1:3}]:[]),
          ...exactPhotos.map(query=>({query,kind:'image' as const})),
          ...(exactPhotos.length?[{query:'',kind:'video' as const}]:[]),
          ...(kind==='image'?plan.imageQueries:plan.videoQueries).filter(value=>validQuery(value)&&value!==query).map(query=>({query,kind})),
          ...(reserve?[{query:reserve,kind:'video' as const,reserve:true}]:[])]
        :query?[{query,kind}]:[];
      const reason='После основного поиска выбран запасной материал.';
      const revision=this.manualRevision(original);
      if(!automaticRecovery&&doc.manualReview&&doc.manualReview.analysis?.status!=='rejected')project=await this.projects.mutate(project.id,current=>({scenes:current.scenes.map(scene=>scene.id===original.id&&this.manualRevision(scene)===revision
        ?{...scene,documentary:{...scene.documentary!,manualReview:undefined}}:scene)}));
      this.publish({projectId:project.id,phase:'downloading',currentSceneId:original.id,completed:project.scenes.filter(scene=>ready(scene)).length,
        total:project.scenes.filter(scene=>scene.includeInAssembly!==false).length,selected:0,skipped:0,failed:0,message:`Сцена ${original.order+1}: ${automaticRecovery?'подбираю другой материал':'запасной материал для ручной проверки'}`});
      let error='Источники не вернули материал нужного типа.';
      const {deadline,signal:fallbackSignal,attempted}=budgetFor(original.id);
      try {
        const rejected=await rejectionsFor(project,original);
        if(doc.manualReview?.analysis?.status==='rejected'&&doc.selected){
          attempted.add(documentaryCandidateKey(doc.selected));
          if(documentaryCacheableVisualRejection(doc.selected)){
            documentaryVisualRejectionKeys(doc.selected,doc.checksum).forEach(key=>rejected.keys.add(key));
            await saveDocumentaryRejections(rejected.path,rejected.scope,rejected.keys);
          }
        }
        const eligible=(candidates:DocumentaryCandidate[])=>candidates
          .filter((candidate,index,all)=>candidate.kind===kind&&candidate.rights!=='unknown'
            &&!documentaryCandidateSubjectIssue(candidate,doc.requirement,original.narration,automaticRecovery)
            &&!held(original.id,candidate)
            &&!documentaryVisualRejectionKeys(candidate).some(key=>rejected.keys.has(key))
            &&all.findIndex(other=>documentaryCandidateKey(other)===documentaryCandidateKey(candidate))===index);
        const savedSources=[...(doc.selected?[doc.selected]:[]),...doc.candidates];
        const saved=eligible(savedSources);
        let selectionOriginal=original,keepSearching=true;
        let repeated:Project|undefined;
        const preparePool=async(candidates:DocumentaryCandidate[],limit=3)=>{
          const available=eligible(candidates).filter(candidate=>!attempted.has(documentaryCandidateKey(candidate)));
          const pool=rank(project,original,namedTarget?documentaryNamedMetadataShortlist(available,discovery,original.narration,automaticRecovery):available)
            .slice(0,Math.min(limit,3-attempted.size));
          for(const [index,candidate] of pool.entries()){
            signal?.throwIfAborted();
            if(Date.now()>=deadline)break;
            if(documentaryVisualRejectionKeys(candidate).some(key=>rejected.keys.has(key)))continue;
            attempted.add(documentaryCandidateKey(candidate));
            try {
              await rememberThematicSource(selectionOriginal,candidate);
              const prepared=await this.apply(project.id,original.id,candidate,false,undefined,undefined,deadline,undefined,true,{signal:fallbackSignal});
              const replacement=prepared.scenes.find(scene=>scene.id===original.id)!;
              if(held(original.id,replacement.documentary!.selected!,replacement.documentary!.checksum))continue;
              if(documentaryVisualRejectionKeys(replacement.documentary!.selected!,replacement.documentary!.checksum).some(key=>rejected.keys.has(key)))continue;
              await rememberThematicSource(selectionOriginal,replacement.documentary!.selected!,replacement.documentary!.checksum);
              // An alias can reveal the same file only after preparation. Keep
              // it as a usable last resort within the original three attempts.
              if(documentaryCandidateUses(project,original,replacement.documentary!.selected!,replacement.documentary!.checksum).length
                &&pool.slice(index+1).some(next=>!documentaryCandidateUses(project,original,next).length
                  &&rank(project,original,[replacement.documentary!.selected!,next])[0]===next)){
                repeated??=prepared;continue;
              }
              project=await savePrepared(selectionOriginal,prepared,kind,reason);
              const savedScene=project.scenes.find(scene=>scene.id===original.id)!;
              await reviewPrepared(original.id,false,deadline);
              project=(await this.projects.get(projectId))!;
              const reviewed=project.scenes.find(scene=>scene.id===original.id)!;
              holdSource(reviewed);
              keepSearching=this.manualRevision(reviewed)===this.manualRevision(savedScene)&&!reviewed.documentary?.verified&&!reviewed.documentary?.pinned
                &&(automaticRecovery||reviewed.documentary?.manualReview?.analysis?.status==='rejected');
              if(!keepSearching)break;
              selectionOriginal=reviewed;
              if(reviewed.documentary?.manualReview?.analysis?.status==='rejected'&&documentaryCacheableVisualRejection(reviewed.documentary!.selected!)){
                documentaryVisualRejectionKeys(reviewed.documentary!.selected!,reviewed.documentary!.checksum).forEach(key=>rejected.keys.add(key));
                await saveDocumentaryRejections(rejected.path,rejected.scope,rejected.keys);
              }
            }catch(cause){signal?.throwIfAborted();error=cause instanceof Error?cause.message:String(cause);}
          }
          if(repeated&&!ready(project.scenes.find(scene=>scene.id===original.id)!)){
            await checkThematicCurrent(selectionOriginal);
            project=await savePrepared(selectionOriginal,repeated,kind,reason);await reviewPrepared(original.id,false,deadline);
            project=(await this.projects.get(projectId))!;
            const reviewed=project.scenes.find(scene=>scene.id===original.id)!;holdSource(reviewed);repeated=undefined;
            keepSearching=automaticRecovery&&!ready(reviewed)&&!reviewed.documentary?.pinned;
          }
        };
        // Legacy unqualified scenes retain local-first recovery. A current AI
        // target or named subject gets its exact source search before this pool.
        const local=await Promise.all(saved.map(async candidate=>candidate.localPath
          &&await stat(candidate.localPath).then(info=>info.isFile()&&info.size>0,()=>false)?candidate:undefined));
        if(!exactFirst)await preparePool(local.filter((candidate):candidate is DocumentaryCandidate=>Boolean(candidate)));
        for(const lane of (searchQueries.length?searchQueries:[{query:'',kind}])){
          if(!keepSearching||attempted.size>=3||Date.now()>=deadline)break;
          if(kind!==lane.kind)repeated=undefined;
          kind=lane.kind;
          // Primary same-object query first; the saved thematic video reserve
          // shares the original preparation count and deadline.
          const result=lane.query?await this.searcher.search({query:lane.query,kind,entities:lane.reserve?[]:documentarySearchSubjects(discovery),years:lane.reserve?[]:doc.requirement.years,
            providers:kind==='video'?['youtube','commons','pexels','pixabay','web','local']:['commons','pexels','pixabay','web','local']},true,fallbackSignal,true).catch(cause=>{
            signal?.throwIfAborted();error=cause instanceof Error?cause.message:String(cause);return undefined;
          }):undefined;
          signal?.throwIfAborted();
          if(result?.sources[0]?.error)error=result.sources[0].error;
          if(result&&documentaryDiscoveryCompleted(result))completedDiscovery.add(original.id);
          savedSources.unshift(...(result?.candidates??[]));
          await preparePool(eligible(savedSources),lane.limit);
        }
      }catch(cause){signal?.throwIfAborted();error=cause instanceof Error?cause.message:String(cause);}
      if(!ready(project.scenes.find(scene=>scene.id===original.id)!))
        project=await this.projects.mutate(project.id,current=>({scenes:current.scenes.map(scene=>scene.id===original.id&&this.manualRevision(scene)===revision
          ?{...scene,documentary:{...scene.documentary!,autoError:`Запасной материал недоступен: ${error}`}}:scene)}));
      } finally { pauseBudget(item.id); }
    // The live transfer comparison did not establish a two-stream gain.
    },async()=>Math.min(1,(await this.selectionResources()).workers),()=>Boolean(signal?.aborted));
    signal?.throwIfAborted();
    project=(await this.projects.get(projectId))!;
    // Only after every ordinary attempt has finished, reuse readable licensed
    // originals in this project. Each recipient keeps its own visual verdict.
    for(const item of project.scenes){
      signal?.throwIfAborted();
      project=(await this.projects.get(projectId))!;
      const original=project.scenes.find(scene=>scene.id===item.id),doc=original?.documentary;
      if(!original||!inScope(original)||original.includeInAssembly===false||!doc||doc.pinned||doc.verified||ready(original))continue;
      if(automaticRecovery&&doc.nativeFallback?.automaticRecovery)continue;
      if(automaticRecovery&&doc.requirement.footageFallback?.automaticRecovery&&!activeThematic(project,original))continue;
      const kind=fallbackKind(project,original);
      if(!kind)continue;
      try { await reuseLocalSource(original,project,kind); }
      finally { pauseBudget(original.id); }
    }
    project=await this.projects.mutate(projectId,current=>({scenes:current.scenes.map(scene=>{
      const doc=scene.documentary;
      if(!inScope(scene)||scene.includeInAssembly===false||!doc||doc.pinned||doc.verified)return scene;
      if(doc.manualReview?.analysis?.status==='rejected')return {...scene,status:'failed' as const,documentary:{...doc,
        // Keep the file, selected source, model verdict and paid receipt as evidence,
        // but a rejected fallback is no longer a renderable manual-review result.
        manualReview:undefined,autoError:`Запасной материал отклонён: ${doc.manualReview.analysis.reason}`,
        reviewNote:doc.manualReview.analysis.reason}};
      return ready(scene)?scene:{...scene,status:'failed' as const};
    })}));
    if(automaticRecovery)for(const scene of project.scenes){
      if(!inScope(scene))continue;
      const binding=documentaryThematicRecoveryBinding(project,scene);
      if(recoveryBindings.get(scene.id)===binding&&(completedDiscovery.has(scene.id)||(budgets.get(scene.id)?.attempted.size??0)>=3))
        exhaustedScenes?.set(scene.id,binding);
      else exhaustedScenes?.delete(scene.id);
    }
    if(automaticRecovery&&!thematicSceneIds){
      signal?.throwIfAborted();
      const ids=new Set<string>();
      project=await this.projects.mutate(projectId,current=>({scenes:current.scenes.map(scene=>{
        if(signal?.aborted||!primaryBindings.has(scene.id)||primaryBindings.get(scene.id)!==documentaryThematicRecoveryBinding(current,scene)
          ||!completedDiscovery.has(scene.id)&&(budgets.get(scene.id)?.attempted.size??0)<3)return scene;
        const keys=[...(heldSources.get(scene.id)??[])];
        const next=claimDocumentaryThematicRecovery(current,scene,keys);
        if(next!==scene){ids.add(scene.id);exhaustedScenes?.delete(scene.id);}
        return next;
      })}));
      if(ids.size)return this.completeWithSourceFallback(project,signal,undefined,true,ids,exhaustedScenes);
    }
    const included=project.scenes.filter(scene=>scene.includeInAssembly!==false),readyCount=included.filter(scene=>ready(scene)).length;
    this.publish({projectId:project.id,phase:readyCount===included.length?'complete':'failed',completed:included.length,total:included.length,
      selected:readyCount,skipped:0,failed:included.length-readyCount,message:readyCount===included.length
        ?`Материалы готовы. Проверить вручную: ${included.filter(scene=>documentaryManualReviewReady(scene)).length}`:'Не удалось скачать запасной материал.'});
    return project;
  }

  async stop(projectId: string): Promise<void> {
    const run = this.autoRuns.get(projectId);
    const planning=this.planningRuns.get(projectId);
    if (!run&&!planning?.size) return;
    this.stopRequested.add(projectId);
    this.downloadControllers.get(projectId)?.abort();
    for(const controller of this.planningControllers.get(projectId)??[])controller.abort();
    // Keep receiving an already-paid response and save it before stopping.
    await Promise.all([...(run?[run]:[]),...(planning??[])].map(promise=>promise.catch(()=>{})));
  }
  private sourceSelections = new Map<string, Promise<void>>();
  private sourceChecksums = new Map<string, string>();
  private selectionResumeBinding(project:Project,scene:Scene) {
    return createHash('sha256').update(JSON.stringify([scene.narration,scene.documentary?.requirement,
      documentarySceneContext(project,scene),project.aspectRatio,scene.documentary?.layout])).digest('hex');
  }
  private stockRangePausedUntil = new Map<string, number>();
  private selectedEvidence?: Promise<Map<string, string>>;
  private selectedSearchHint(scene:Scene) {
    const doc=scene.documentary,review=doc?.visualReview;
    if(!doc?.verified||!doc.checksum||review?.status!=='accepted')return;
    // Only saved observations are discovery hints. Requirement names and
    // narration are not observations, and nothing here is source provenance.
    const hint=[review.viewDescription,
      review.actionMatch&&review.actionEvidence?`Verified action in previous frame review: ${review.actionEvidence}`:undefined,
      ...(review.scriptEvidence?.checks.filter(check=>check.match===true).map(check=>check.evidence)??[])]
      .filter(Boolean).join('\n').slice(0,2400);
    return hint?{checksum:doc.checksum,hint}:undefined;
  }
  private async rememberSelectedEvidence(scene:Scene) {
    const entry=this.selectedSearchHint(scene);
    if(!entry||!this.selectedEvidence)return;
    const evidence=await this.selectedEvidence,previous=evidence.get(entry.checksum);
    if(!previous?.includes(entry.hint))evidence.set(entry.checksum,[entry.hint,previous].filter(Boolean).join('\n').slice(0,2400));
  }
  private selectedFrameEvidence() {
    return this.selectedEvidence ??= (async () => {
      const evidence = new Map<string, string>();
      // Older excerpts can have only a generic source title in the catalog.
      // Recover exact-file search hints from saved accepted frame reviews. They
      // never transfer approval, voice, timing or an original's full range.
      for (const project of await this.projects.list?.({omitCandidates:true}) ?? []) {
        if (project.mediaMode !== "stock") continue;
        for (const scene of project.scenes) {
          const entry=this.selectedSearchHint(scene);
          if(entry)evidence.set(entry.checksum,[entry.hint,evidence.get(entry.checksum)].filter(Boolean).join('\n').slice(0,2400));
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
    private readonly searcher: DocumentarySearch, private readonly materialRoot: string, private readonly stock: Pick<StockClient, "download"> & Partial<Pick<StockClient, "downloadToFile"|"downloadRangeToFile">>,
    private readonly publish: (progress: AutoStockProgress) => void = () => {},
    private readonly intelligence?: Pick<DocumentaryIntelligence, "plan" | "inspect" | "available"> & Partial<Pick<DocumentaryIntelligence, "reviseExplanation" | "planSemanticMontage" | "planMotionArtwork" | "simpleSelection" | "selectionReviewIdentity" | "rankCandidates" | "rankLocalCandidates" | "cataloguedCandidates" | "inspectForSelection" | "inspectPreview" | "inspectPreviewForScene" | "inspectCombinedPreview" | "cachedPreviewForScene" | "withSelectionBudget" | "resolveIdentities" | "resolveThematicTargets" | "resolveScriptRequirements" | "resolveVisualScopes" | "resolveIllustrationFallbacks" | "prepareSource" | "refineQueries" | "savedMotionIssue">>,
    private readonly library?: EffectLibrary,
    private readonly youtube?: Pick<DocumentaryYouTube, "download"> & Partial<Pick<DocumentaryYouTube, "downloadAvailable"|"preview">>,
    private readonly queryPlanner?: {readIssues?(project:Project,scenes:Scene[]):Promise<DocumentaryQueryPlanIssue[]>;
      plan(project:Project,scenes:Scene[],options?:{signal?:AbortSignal;progress?:(message:string)=>void;retryToken?:string;refreshSceneIds?:ReadonlySet<string>}):Promise<Map<string,DocumentaryRequirement>>;
      readCached?(project:Project,scenes:Scene[]):Promise<Map<string,DocumentaryRequirement>>;
      planFallbacks?(project:Project,scenes:Scene[],options?:{signal?:AbortSignal;progress?:(message:string)=>void;reviseLegacyReserve?:boolean;
        onReserveIssues?:(issues:DocumentaryQueryPlanIssue[])=>void;onReserveUnchanged?:(sceneIds:string[])=>void}):Promise<Map<string,DocumentaryRequirement>>;
      readCachedFallbacks?(project:Project,scenes:Scene[]):Promise<Map<string,DocumentaryRequirement>>;
      planTopicFallbacks?(project:Project,scenes:Scene[],options?:{signal?:AbortSignal;progress?:(message:string)=>void}):Promise<Map<string,DocumentaryRequirement>>;
      readCachedTopicFallbacks?(project:Project,scenes:Scene[]):Promise<Map<string,DocumentaryRequirement>>},
    private readonly artworkPhaseRenderer:typeof renderDocumentaryArtworkPhases=renderDocumentaryArtworkPhases,
    private readonly publicMediaFetcher:typeof globalThis.fetch=globalThis.fetch) {}

  async localCandidates(query: string): Promise<DocumentaryCandidate[]> {
    const candidates: Array<{ asset: DocumentaryCandidate; score: number }> = [];
    const terms=catalogTerms(query);
    if (!terms.length) return [];
    const evidence = await this.selectedFrameEvidence();
    for (const { file, asset } of await this.catalogEntries()) {
      // A previous search query is not evidence about the downloaded content.
      const hint = evidence.get(file.slice(0, -5));
      const enriched = hint ? { ...asset, previousFrameSearchHint: hint.slice(0, 1800) } : asset;
      let indexed = this.catalogWords.get(asset);
      if (!indexed || indexed.hint !== hint) {
        indexed = {hint, title: new Set(catalogWords(asset.title)), description: new Set(catalogWords(asset.description ?? '')), observed: new Set(catalogWords(hint ?? ''))};
        this.catalogWords.set(asset, indexed);
      }
      const {title, description, observed} = indexed;
      const matches = terms.filter(term => title.has(term) || description.has(term) || observed.has(term));
      if (matches.length >= Math.min(2, terms.length)&&!onlyPeriodMatches(terms,matches)) candidates.push({ asset: { ...enriched, id: `local:${file.slice(0, -5)}`, provider: "local", query },
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

  private async cachedSource(candidate: DocumentaryCandidate,reuseExcerptSeconds?:number,allowed:(source:DocumentaryCandidate)=>boolean=()=>true): Promise<DocumentaryCandidate | undefined> {
    for (const { asset: source } of await this.catalogEntries()) {
      // Reuse by stable source identity, not by whatever search phrase found it.
      const rangeMatches=documentaryCachedRangeMatches(source,candidate,reuseExcerptSeconds);
      if (source.kind === candidate.kind && source.localPath && rangeMatches && allowed(source) && (source.provider === candidate.provider && source.id === candidate.id
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
      verified: Boolean(input.verified), manualReview:undefined, illustrative: Boolean(input.illustrative), reviewNote: input.note.slice(0, 2000),
      pinned: Boolean(input.verified), selected: { ...current.documentary!.selected!, rights: input.rightsConfirmed ? "user-confirmed" : current.documentary!.selected!.rights } } };
    });
    if (input.rightsConfirmed) {
      const path = join(this.materialRoot, "Catalog", `${scene.documentary.checksum}.json`);
      const catalog = await readFile(path, "utf8").then(text => JSON.parse(text) as DocumentaryCandidate, () => undefined);
      if (catalog) await atomicWrite(path, JSON.stringify({ ...catalog, rights: "user-confirmed" }, null, 2));
    }
    return reviewed;
  }

  async getDocumentaryQueryPlanIssues(projectId:string):Promise<DocumentaryQueryPlanIssue[]> {
    const project=await this.projects.get(projectId,{omitCandidates:true});
    if(!project||!this.queryPlanner?.readIssues||project.mediaMode!=='stock'||project.settings.assembly.documentary?.version!==2)return [];
    return this.queryPlanner.readIssues(project,project.scenes.filter(scene=>scene.includeInAssembly!==false&&!scene.documentary?.pinned&&!documentaryMaterialUsable(scene)));
  }

  retryDocumentaryQueryPlan(projectId:string,sceneId:string,retryToken:string):Promise<Project> {
    if(!this.queryPlanner||!sceneId||typeof retryToken!=='string'||!retryToken)throw new Error('Выберите завершённую попытку одной сцены.');
    return this.planSearch(projectId,[sceneId],undefined,{refreshReady:true,retryToken});
  }

  async planSearch(projectId: string, sceneIds?: string[],signal?:AbortSignal,options?:{refreshReady?:boolean;retryToken?:string;cachedOnly?:boolean;beforeSelection?:boolean;allowActiveNarration?:boolean}): Promise<Project> {
    const controller=new AbortController();
    const controllers=this.planningControllers.get(projectId)??new Set<AbortController>();
    const runs=this.planningRuns.get(projectId)??new Set<Promise<Project>>();
    if(!this.autoRuns.has(projectId)&&!runs.size)this.stopRequested.delete(projectId);
    controllers.add(controller);this.planningControllers.set(projectId,controllers);
    const parent=this.downloadControllers.get(projectId)?.signal;
    const runSignal=AbortSignal.any([controller.signal,...(signal?[signal]:[]),...(parent?[parent]:[])]);
    // Serialize the project mutation and status report as well as the provider call.
    const run=Promise.allSettled([...runs]).then(async()=>{
      const release=await this.reserveSource(`query-target:${projectId}`);
      try{return await this.planSearchPrepared(projectId,sceneIds,runSignal,options);}
      finally{release();}
    });
    runs.add(run);this.planningRuns.set(projectId,runs);
    try{return await run;}finally{
      controllers.delete(controller);runs.delete(run);
      if(!controllers.size)this.planningControllers.delete(projectId);
      if(!runs.size)this.planningRuns.delete(projectId);
    }
  }

  private async queryRefreshScope(project:Project,scenes:Scene[],signal?:AbortSignal):Promise<Set<string>>{
    const eligible=scenes.filter(scene=>{
      const doc=scene.documentary;
      if(!doc?.autoError||doc.autoError===documentaryMissingSelectedMaterialMessage||doc.verified||doc.pinned||doc.manualReview||doc.visualReview?.status==='accepted'
        ||!currentDocumentaryAiSearchPlan(project,scene))return false;
      // A transient service or transfer error says nothing about the settled search goal.
      const {category}=documentarySelectionFailure(scene,{fallbackCategory:'no-results'});
      return category==='content-rejected'||category==='no-results'&&diagnoseFailure(doc.autoError).category==='unknown';
    });
    const ids=new Set(eligible.map(scene=>scene.id));
    if(!ids.size)return ids;
    const root=this.storage.projectDirectory(project.id);
    const checkpoints=async (directory:string)=>(await readdir(directory).catch((error:NodeJS.ErrnoException)=>{
      if(error.code==='ENOENT')return [];
      throw error;
    })).filter(name=>/^[a-f0-9]{64}\.json$/.test(name));
    try{
      // Different planner purposes and old input hashes can still own a submitted request for this scene.
      for(const namespace of ['documentary-ai-query-plans','documentary-ai-fallback-plans','documentary-ai-topic-broll-plans']){
        const directory=join(root,namespace);
        for(const name of await checkpoints(directory)){
          signal?.throwIfAborted();
          const saved=JSON.parse(await readFile(join(directory,name),'utf8'));
          if(!Array.isArray(saved?.attempts))return new Set();
          for(const attempt of saved.attempts){
            if(attempt?.responseState==='complete'&&['complete','invalid'].includes(attempt.status))continue;
            if(!Array.isArray(attempt?.ids)||!attempt.ids.every((id:unknown)=>typeof id==='string'))return new Set();
            for(const id of attempt.ids)ids.delete(id);
          }
        }
      }
      const analysis=join(root,'Documentary','Analysis');
      for(const name of await checkpoints(analysis)){
        signal?.throwIfAborted();
        if(!ids.size)return ids;
        const saved=JSON.parse(await readFile(join(analysis,name),'utf8'));
        if(saved?.state==='complete'&&saved.result||['failed','rejected','invalid'].includes(saved?.state))continue;
        const narration=saved?.singleReviewBinding?.quality?.narration;
        if(typeof narration!=='string'||!project.scenes.some(scene=>scene.narration===narration))return new Set();
        for(const scene of eligible)if(scene.narration===narration)ids.delete(scene.id);
      }
      for(const scene of eligible){
        if(!ids.has(scene.id))continue;
        for(const name of ['uncertain-candidates.json','primary-photo-uncertain-candidates.json']){
          const file=join(root,'Documentary',scene.id.replace(/[^a-zA-Z0-9_-]/g,'_'),name);
          const raw=await readFile(file,'utf8').catch((error:NodeJS.ErrnoException)=>{
            if(error.code==='ENOENT')return undefined;
            throw error;
          });
          if(raw===undefined)continue;
          const saved=JSON.parse(raw);
          if(saved?.version!==1||!Array.isArray(saved.keys)||saved.keys.length)ids.delete(scene.id);
        }
      }
    }catch(error){
      signal?.throwIfAborted();
      recordDiagnosticEvent('warn','documentary.query-refresh.checkpoints-unavailable',{projectId:project.id});
      return new Set();
    }
    return ids;
  }

  private async markMissingAutomaticMaterials(project:Project,sceneIds?:string[],signal?:AbortSignal):Promise<Project>{
    const missing=new Map<string,Scene>();
    for(const scene of project.scenes){
      signal?.throwIfAborted();
      if(scene.includeInAssembly!==false&&(!sceneIds||sceneIds.includes(scene.id))&&scene.documentary?.verified
        &&!scene.documentary.pinned&&await documentarySelectedMaterialMissing(scene))missing.set(scene.id,scene);
    }
    if(!missing.size)return project;
    return this.projects.mutate(project.id,current=>{
      signal?.throwIfAborted();
      return {scenes:current.scenes.map(scene=>{
        const before=missing.get(scene.id),doc=scene.documentary;
        if(!before||!doc?.verified||doc.pinned||scene.includeInAssembly===false||scene.imagePath!==before.imagePath
          ||scene.videoPath!==before.videoPath||doc.checksum!==before.documentary?.checksum
          ||doc.selected?.kind!==before.documentary?.selected?.kind)return scene;
        return {...scene,documentary:{...doc,verified:false,autoError:documentaryMissingSelectedMaterialMessage}};
      })};
    },{candidateSceneIds:[]});
  }

  private async planSearchPrepared(projectId:string,sceneIds?:string[],signal?:AbortSignal,options:{refreshReady?:boolean;retryToken?:string;cachedOnly?:boolean;beforeSelection?:boolean;allowActiveNarration?:boolean}={}):Promise<Project>{
    const {refreshReady,retryToken,cachedOnly}=options;
    signal?.throwIfAborted();
    let project = await this.projects.get(projectId);
    if (!project) throw new Error("Проект не найден");
    if (project.mediaMode !== "stock" || project.settings.assembly.documentary?.version !== 2) throw new Error("Откройте Stock Documentary v2");
    const busy = (current: Project) => !options.allowActiveNarration && ['generating','paused'].includes(current.status);
    if (busy(project)) throw new Error("Сначала остановите производство");
    if (sceneIds?.some(id => !project!.scenes.some(scene => scene.id === id))) throw new Error("Сцена для подбора больше не существует");
    const inScope = (scene: Scene) => !sceneIds || sceneIds.includes(scene.id);
    if(cachedOnly&&(!this.queryPlanner?.readCached||!this.queryPlanner.readIssues))throw new Error('Чтение сохранённых AI-планов недоступно.');
    if(!cachedOnly)project=await this.markMissingAutomaticMaterials(project,sceneIds,signal);
    const recoverableRoutes=new Map<string,Scene>();
    if(!refreshReady&&!cachedOnly)for(const scene of project.scenes){
      if(!inScope(scene)||documentaryRouteApprovalCandidate(project,scene)===scene)continue;
      if(await hasCompletedRouteComparison(this.storage.projectDirectory(projectId),project,scene))recoverableRoutes.set(scene.id,scene);
      signal?.throwIfAborted();
    }
    if(recoverableRoutes.size){
      project=await this.projects.mutate(projectId,current=>{
        signal?.throwIfAborted();
        if(busy(current))throw new Error('Сначала остановите производство');
        return {scenes:current.scenes.map(scene=>isDeepStrictEqual(scene,recoverableRoutes.get(scene.id))?documentaryRouteApprovalCandidate(current,scene):scene)};
      },{candidateSceneIds:[...recoverableRoutes.keys()]});
    }
    if(this.queryPlanner){
      const input=JSON.stringify(documentaryAiPlanContext(project));
      const preservedReady=new Set(!refreshReady?project.scenes.filter(scene=>documentaryMaterialUsable(scene)&&(cachedOnly||!documentarySavedContextIssue(project!,scene))).map(scene=>scene.id):[]);
      const pending=project.scenes.filter(scene=>inScope(scene)&&scene.includeInAssembly!==false&&!scene.documentary?.pinned&&!preservedReady.has(scene.id)
        &&(refreshReady||!documentaryLegacyFallbackNarrativeApproval(project!,scene)));
      if(!pending.length)return project;
      const refreshSceneIds=!refreshReady&&!retryToken&&!cachedOnly&&(!this.autoRuns.has(projectId)||options.beforeSelection)
        ?await this.queryRefreshScope(project,pending,signal):new Set<string>();
      const toApply=cachedOnly?new Set((await this.queryPlanner.readIssues!(project,pending)).filter(row=>row.cached).map(row=>row.sceneId)):undefined;
      let plan:Map<string,DocumentaryRequirement>,planningError:string|undefined;
      let issues:DocumentaryQueryPlanIssue[]=[];
      try{plan=cachedOnly?await this.queryPlanner.readCached!(project,pending):await this.queryPlanner.plan(project,pending,{signal,retryToken,refreshSceneIds,
        progress:message=>this.publish({projectId,phase:'preparing',completed:0,total:pending.length,selected:0,skipped:0,failed:0,message})});}
      catch(error){
        signal?.throwIfAborted();
        if(cachedOnly)throw error;
        plan=await this.queryPlanner.readCached?.(project,pending)??new Map<string,DocumentaryRequirement>();
        if(error instanceof QueryPlanIssuesError)issues=error.issues;
        planningError=String(error).replace(/https?:\/\/\S+/g,'[URL]').slice(0,1200);
      }
      const missing=pending.filter(scene=>!plan.has(scene.id));
      const reason=issues.length?` ${formatQueryIssues(issues)}`:planningError?` Причина: ${planningError.replace(/^Error:\s*/, '').slice(0,300)}`:'';
      project=await this.projects.mutate(projectId,current=>{
        signal?.throwIfAborted();
        if(JSON.stringify(documentaryAiPlanContext(current))!==input
          ||busy(current))throw new Error('Проект изменился во время подготовки AI-запросов');
        const stalePlans=new Map<string,Scene>();
        const scenes=groundDocumentaryScenes(current.scenes).map(scene=>{
          const requirement=plan.get(scene.id),original=current.scenes.find(item=>item.id===scene.id)!;
          if(!inScope(scene)||scene.includeInAssembly===false||scene.documentary?.pinned)return original;
          if(refreshSceneIds.has(scene.id)){
            const before=pending.find(item=>item.id===scene.id),doc=original.documentary;
            if(!doc||doc.verified||doc.pinned||doc.manualReview||doc.visualReview?.status==='accepted'
              ||!isDeepStrictEqual(doc.requirement,before?.documentary?.requirement))return original;
          }
          if(preservedReady.has(scene.id)&&documentaryMaterialUsable(original)&&!documentarySavedContextIssue(current,original))return original;
          if(!requirement)return original;
          if(toApply&&(!toApply.has(scene.id)||documentaryMaterialUsable(original)))return original;
          if(requirement.text!==scene.narration)throw new Error('Текст AI-плана не соответствует текущей реплике; материалы сохранены.');
          const fallback=requirement.footageFallback,ai=requirement.aiSearchPlan;
          const normalized={...requirement};
          if(fallback&&(!ai||fallback.target!==ai.fallbackVisualTarget||JSON.stringify(fallback.queries)!==JSON.stringify(ai.fallbackVideoQueries)
            ||(fallback.narration??requirement.text)!==scene.narration))delete normalized.footageFallback;
          const updated=applyDocumentaryRequirement(scene,normalized);
          if(!currentDocumentaryAiSearchPlan(current,updated))throw new Error('AI-план не соответствует текущему сценарию. Материалы и озвучка сохранены.');
          if(original.documentary?.requirement.aiSearchPlan&&!currentDocumentaryAiSearchPlan(current,original))stalePlans.set(scene.id,original);
          return updated;
        });
        const updatedProject={...current,scenes};
        return {scenes:scenes.map(scene=>{
          const original=stalePlans.get(scene.id),doc=scene.documentary;
          if(!original||!doc||doc.pinned)return scene;
          if(doc.verified&&doc.selected&&samePlannedVisualTask(original,scene)&&!documentarySavedContextIssue(updatedProject,scene))return scene;
          return {...scene,documentary:{...doc,verified:false,
            autoError:'Контекст сценария изменился. Материал и озвучка сохранены; требуется проверка новой цели.'}};
        })};
      },{candidateSceneIds:[]});
      await this.storage.ensureProject(project);
      let reportPlans=plan,reportMissing=missing,reportIssues=issues;
      if(sceneIds&&this.queryPlanner.readCached&&this.queryPlanner.readIssues){
        const scope=project.scenes.filter(scene=>scene.includeInAssembly!==false&&!scene.documentary?.pinned);
        reportPlans=await this.queryPlanner.readCached(project,scope);
        reportIssues=await this.queryPlanner.readIssues(project,scope.filter(scene=>!documentaryMaterialUsable(scene)));
        const problemIds=new Set(reportIssues.map(issue=>issue.sceneId));
        reportMissing=scope.filter(scene=>problemIds.has(scene.id)||(!reportPlans.has(scene.id)&&!documentaryMaterialUsable(scene)));
      }
      const missingIds=new Set(reportMissing.map(scene=>scene.id));
      await atomicWrite(join(this.storage.projectDirectory(projectId),'Documentary','Plans','ai-query-status.json'),JSON.stringify({
        state:reportMissing.length?'partial':'complete',savedAt:new Date().toISOString(),aiSceneIds:[...reportPlans.keys()].filter(id=>!missingIds.has(id)),missingSceneIds:[...missingIds],
        issues:reportIssues,localFallbackSceneIds:[],error:planningError??(reportIssues.length?formatQueryIssues(reportIssues):undefined),
        policy:'Keep validated AI plans and completed media. Missing AI queries require resuming planning; never substitute heuristic queries. Unknown paid receipts remain protected.'}));
      if(missing.length){
        this.publish({projectId,phase:'preparing',completed:plan.size,total:pending.length,selected:0,skipped:0,failed:missing.length,
          message:`AI-запросы сохранены для ${plan.size} сцен. Для ${missing.length} сцен план ещё не готов; уже полученные результаты сохранены.${reason}`});
        throw new DocumentaryPlanningIncompleteError(`AI-план поисковых запросов не готов для сцен ${missing.map(scene=>'№'+(scene.order+1)).join(', ')}. Уже полученные результаты сохранены.${reason||' Продолжите подготовку плана.'}`);
      }
      return project;
    }
    if(this.intelligence?.simpleSelection){
      project=await this.projects.mutate(projectId,current=>({scenes:groundDocumentaryScenes(current.scenes).map(scene=>{
        const original=current.scenes.find(item=>item.id===scene.id)!;
        scene=resetStaleDocumentaryFootageFallback(scene);
        if(!inScope(scene)||scene.includeInAssembly===false||scene.documentary?.pinned)return original;
        if(scene.documentary?.verified)return scene;
        const doc=scene.documentary!;
        const plan=planFastDocumentaryScene(current,scene);
        return {...scene,stockQuery:plan.queries[0],documentary:{...doc,requirement:{...doc.requirement,text:scene.narration,
          queries:plan.queries,preferredKind:plan.preferredKind,years:plan.requiredYears??doc.requirement.years,fastVisualTarget:plan.visualTarget,fastSourcePolicy:plan.sourcePolicy,fastPlanVersion:1}}};
      })}),{candidateSceneIds:[]});
      await this.storage.ensureProject(project);
      return project;
    }
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
      if (current.videoBrief?.readyScript !== project!.videoBrief?.readyScript || busy(current)) throw new Error("Проект изменился во время анализа");
      return { scenes: groundDocumentaryScenes(current.scenes.map(scene => {
        const requirement = plan.get(scene.id);
        return requirement && scene.narration === requirement.text && scene.documentary && !scene.documentary.pinned
          ? applyDocumentaryRequirement(scene, requirement) : scene;
      })).map(scene => inScope(scene) ? scene : current.scenes.find(item => item.id === scene.id)!) };
    },{candidateSceneIds:[]});
    if (pending.length) {
      const input=incompleteInputSnapshot(project,pending);
      try{
        const plan = await this.intelligence.plan(project, pending, async batch => { await saveBatch(batch); },{
          shouldStop:()=>this.stopRequested.has(projectId),progress:message=>this.publish({projectId,phase:'preparing',completed:0,total:pending.length,selected:0,skipped:0,failed:0,message})});
        project = await saveBatch(plan);
      }catch(error){await this.throwCurrentIncomplete(projectId,error,input);}
    }
    const legacy = project.scenes.filter(scene => inScope(scene) && scene.includeInAssembly !== false && scene.documentary && !scene.documentary.pinned && scene.documentary.requirement.identityContextVersion !== 3);
    if (legacy.length && this.intelligence.resolveIdentities) {
      await this.intelligence.resolveIdentities(project, legacy, async batch => { project = await saveBatch(batch); },{
        shouldStop:()=>this.stopRequested.has(projectId),progress:message=>this.publish({projectId,phase:'preparing',completed:0,total:legacy.length,selected:0,skipped:0,failed:0,message})});
    }
    return project;
  }

  private async prepareAiFootageFallbacks(projectId:string,ids:string[],topic=false,held?:Map<string,DocumentaryQueryPlanIssue>,confirmUnchanged=false):Promise<string[]>{
    const reviseLegacyReserve=Boolean(held);
    const planner=topic?this.queryPlanner?.planTopicFallbacks:this.queryPlanner?.planFallbacks;
    const readCached=topic?this.queryPlanner?.readCachedTopicFallbacks:this.queryPlanner?.readCachedFallbacks;
    if(!planner||!ids.length||this.stopRequested.has(projectId))return [];
    const before=await this.projects.get(projectId,{omitCandidates:true});if(!before)return [];
    const scenes=before.scenes.filter(scene=>ids.includes(scene.id)&&scene.documentary?.requirement.aiSearchPlan
      &&!documentaryThematicReserveIssue(scene.documentary.requirement.aiSearchPlan)
      &&(!scene.documentary.verified||documentaryNativeFallbackReady(before,scene))&&!scene.documentary.pinned)
      .map(scene=>documentaryNativeFallbackReady(before,scene)?{...scene,documentary:{...scene.documentary!,verified:false}}:scene);
    if(!scenes.length)return [];
    // Once authored, the final topic reserve also owns photo and resume searches.
    // Replacing it with the older reserve would invalidate the photo marker in planSearch.
    const plans=!topic&&!reviseLegacyReserve&&this.queryPlanner?.readCachedTopicFallbacks
      ?await this.queryPlanner.readCachedTopicFallbacks(before,scenes):new Map<string,DocumentaryRequirement>();
    const issues=new Map<string,DocumentaryQueryPlanIssue>();
    const unchanged=new Set<string>();
    const pending=scenes.filter(scene=>!plans.has(scene.id));
    try{if(pending.length)for(const [id,plan]of await planner.call(this.queryPlanner,before,pending,{
      signal:this.downloadControllers.get(projectId)?.signal,
      ...(reviseLegacyReserve?{reviseLegacyReserve:true,onReserveIssues:(rows:DocumentaryQueryPlanIssue[])=>{
        for(const issue of rows)issues.set(issue.sceneId,issue);
      },...(confirmUnchanged?{onReserveUnchanged:(sceneIds:string[])=>{for(const id of sceneIds)unchanged.add(id);}}:{})}:{}),
      progress:message=>this.publish({projectId,phase:'preparing',completed:0,total:scenes.length,selected:0,skipped:0,failed:0,message}),
    }))plans.set(id,plan);}
    catch(error){
      if(this.stopRequested.has(projectId))throw error;
      unchanged.clear();
      if(!reviseLegacyReserve){
        if(!readCached)throw error;
        for(const [id,plan]of await readCached.call(this.queryPlanner,before,pending))plans.set(id,plan);
      }
      this.publish({projectId,phase:'preparing',completed:plans.size,total:scenes.length,selected:0,skipped:0,failed:scenes.length-plans.size,
        message:'AI-план резерва неполон. Готовые части сохранены; запросы с неизвестным результатом не повторяются.'});
    }
    if(this.stopRequested.has(projectId))throw new DOMException('Подбор остановлен пользователем','AbortError');
    if(confirmUnchanged)for(const scene of pending){
      if(!plans.has(scene.id)&&!unchanged.has(scene.id)&&!issues.has(scene.id))issues.set(scene.id,{sceneId:scene.id,sceneNumber:scene.order+1,
        reason:'Не удалось подтвердить актуальный AI-план резерва. Поиск по прежнему резерву приостановлен.'});
    }
    const ready=new Set<string>();
    await this.projects.mutate(projectId,current=>({scenes:current.scenes.map(scene=>{
      const source=scenes.find(item=>item.id===scene.id),doc=scene.documentary;
      const fallback=plans.get(scene.id)?.aiSearchPlan;
      const issue=issues.get(scene.id);
      if(!source||!doc||(!fallback&&!issue&&!unchanged.has(scene.id))||doc.verified&&!documentaryNativeFallbackReady(current,scene)||doc.pinned||scene.narration!==source.narration
        ||JSON.stringify(doc.requirement.aiSearchPlan)!==JSON.stringify(source.documentary!.requirement.aiSearchPlan))return scene;
      const ai=doc.requirement.aiSearchPlan!;
      if(documentaryThematicReserveIssue(ai))return scene;
      if(reviseLegacyReserve&&(!doc.requirement.footageFallback?.automaticRecovery
        ||!documentaryThematicDiscoveryRequirement(current,scene)||doc.manualReview
        ||doc.checksum!==source.documentary?.checksum||doc.selected?.id!==source.documentary?.selected?.id
        ||scene.trimStartSeconds!==source.trimStartSeconds||scene.trimEndSeconds!==source.trimEndSeconds))return scene;
      if(!fallback){
        if(!issue){ready.add(scene.id);return scene;}
        held?.set(scene.id,issue);
        return {...scene,status:'failed' as const,documentary:{...doc,autoError:issue.reason}};
      }
      ready.add(scene.id);
      const existing=doc.requirement.footageFallback;
      const footageFallback=existing?.target===fallback.fallbackVisualTarget&&JSON.stringify(existing.queries)===JSON.stringify(fallback.fallbackVideoQueries)?existing:undefined;
      const updated={...scene,documentary:{...doc,requirement:{...doc.requirement,footageFallback,
        aiSearchPlan:{...ai,fallbackVideoQueries:[...fallback.fallbackVideoQueries],fallbackVisualTarget:fallback.fallbackVisualTarget}}}};
      if(!reviseLegacyReserve)return updated;
      const rebound=claimDocumentaryThematicRecovery(current,updated);
      if(rebound!==updated)return rebound;
      return {...updated,documentary:{...updated.documentary,visualReview:undefined,
        autoError:'Нет тематического резерва, сохраняющего смысл исходной сцены.'}};
    })}),{candidateSceneIds:[]});
    return [...ready];
  }

  async autoSelect(projectId: string, options: AutoStockSelectionOptions = {}, waitForNarration?: (sceneId?: string) => Promise<void>): Promise<AutoStockSelectionResult> {
    const active=this.autoRuns.get(projectId);if(active)return active;
    this.selectedEvidence=undefined;
    this.stopRequested.delete(projectId);
    this.downloadControllers.set(projectId,new AbortController());
    if(waitForNarration)this.narrationWaits.set(projectId,waitForNarration);
    const session=new DocumentarySelectionSession();
    const attempts=new Map<string,{scope:string;keys:Set<string>;found:boolean}>();
    let total=0;
    const run=(async()=>{
      // A selector starting during a refresh reads only after the new target has been applied.
      const release=await this.reserveSource(`query-target:${projectId}`);release();
      if(this.stopRequested.has(projectId))throw new DOMException('Подбор остановлен пользователем','AbortError');
      const initial=await this.projects.get(projectId,{omitCandidates:true});
      if(!initial)throw new Error('Проект не найден');
      const scoped=initial.scenes.filter(scene=>scene.includeInAssembly!==false&&(!options.sceneIds||options.sceneIds.includes(scene.id)));
      total=scoped.length;
      for(const scene of initial.scenes)session.pause(scene.id);
      const held=new Map<string,DocumentaryQueryPlanIssue>();
      // Production normally awaits planSearch before starting narration. A
      // caller still preparing primary plans must not open reserve planning.
      const primaryStillPreparing=waitForNarration&&scoped.some(scene=>!scene.documentary?.pinned
        &&!documentaryMaterialUsable(scene)&&!currentDocumentaryAiSearchPlan(initial,scene));
      if(!primaryStillPreparing&&this.intelligence?.simpleSelection&&this.queryPlanner?.planFallbacks){
        const legacyIds=scoped.filter(scene=>!scene.documentary?.verified
          &&!scene.documentary?.pinned&&documentaryThematicDiscoveryRequirement(initial,scene)).map(scene=>scene.id);
        await this.prepareAiFootageFallbacks(projectId,legacyIds,false,held);
      }
      // One parallel queue and one targeted query revision. Both share the same
      // active-time/attempt budget; ready scenes never enter the second queue.
      const availableIds=held.size?scoped.filter(scene=>!held.has(scene.id)).map(scene=>scene.id):undefined;
      const deferredLegacy=new Set<string>();
      let result:AutoStockSelectionResult=availableIds?.length===0
        ?{project:(await this.projects.get(projectId,{omitCandidates:true}))!,total:0,selected:0,skipped:0,failed:0,failures:[]}
        :await this.selectAll(projectId,availableIds?{...options,sceneIds:availableIds}:options,false,attempts,session,true,deferredLegacy);
      const retryIds:string[]=[];
      if(deferredLegacy.size&&!this.stopRequested.has(projectId)){
        retryIds.push(...await this.prepareAiFootageFallbacks(projectId,[...deferredLegacy],false,held,true));
        result={...result,project:(await this.projects.get(projectId,{omitCandidates:true}))!};
      }
      if(held.size){
        const failures=new Map(result.failures.map(item=>[item.sceneId,item]));
        for(const {sceneId,sceneNumber,reason} of held.values())failures.set(sceneId,{sceneId,sceneNumber,category:'analysis',message:reason});
        result={...result,total,failed:failures.size,failures:[...failures.values()]};
      }
      const failedIds=result.project.scenes.filter(scene=>scene.includeInAssembly!==false
        &&(!options.sceneIds||options.sceneIds.includes(scene.id))&&!scene.documentary?.pinned
        &&!held.has(scene.id)&&!deferredLegacy.has(scene.id)
        &&!documentaryAutomaticMaterialReady(scene)
        &&(session.canAttempt(scene.id,'video')||session.canAttempt(scene.id,'image'))).map(scene=>scene.id);
      if(failedIds.length&&!this.stopRequested.has(projectId)){
        if(this.intelligence?.simpleSelection&&this.queryPlanner){
          const revised=await this.prepareAiFootageFallbacks(projectId,failedIds);
          await this.projects.mutate(projectId,current=>({scenes:current.scenes.map(scene=>{
            if(!revised.includes(scene.id))return scene;
            const next=claimDocumentaryThematicRecovery(current,scene);
            if(next!==scene)retryIds.push(scene.id);
            return next;
          })}),{candidateSceneIds:[]});
        }else if(this.intelligence?.refineQueries){
          const before=(await this.projects.get(projectId,{omitCandidates:true}))!;
          const failed=before.scenes.filter(scene=>failedIds.includes(scene.id));
          const queries=await this.intelligence.refineQueries(before,failed.slice(0,24));
          await this.projects.mutate(projectId,current=>({scenes:current.scenes.map(scene=>{
            const original=failed.find(item=>item.id===scene.id),next=queries.get(scene.id),doc=scene.documentary;
            if(!original||!doc||doc.verified||doc.pinned||!next?.length
              ||JSON.stringify(doc.requirement)!==JSON.stringify(original.documentary?.requirement)
              ||JSON.stringify(next)===JSON.stringify(doc.requirement.queries))return scene;
            retryIds.push(scene.id);
            return {...scene,stockQuery:next[0],documentary:{...doc,requirement:{...doc.requirement,queries:next,searchRefined:true}}};
          })}),{candidateSceneIds:[]});
        }
      }
      if(retryIds.length&&!this.stopRequested.has(projectId)){
        this.publish({projectId,phase:'searching',completed:result.total-result.failed,total:result.total,
          selected:result.selected,skipped:result.skipped,failed:result.failed,
          message:`Продолжаю подбор для ${retryIds.length} сцен в оставшемся бюджете.`});
        const retried=await this.selectAll(projectId,{...options,sceneIds:retryIds,force:false},false,attempts,session);
        const failures=new Map(result.failures.filter(item=>!retryIds.includes(item.sceneId)).map(item=>[item.sceneId,item]));
        for(const item of retried.failures)failures.set(item.sceneId,item);
        for(const scene of retried.project.scenes)if(documentaryAutomaticMaterialReady(scene)
          &&failures.get(scene.id)?.message!==documentaryMissingSelectedMaterialMessage)failures.delete(scene.id);
        result={...result,project:retried.project,selected:result.selected+retried.selected,
          failures:[...failures.values()],failed:failures.size};
      }
      if(this.stopRequested.has(projectId))throw new DOMException('Подбор остановлен пользователем','AbortError');
      if(!waitForNarration){
        const current=await this.projects.get(projectId,{omitCandidates:true});
        if(current&&!['generating','paused','complete'].includes(current.status))
          result={...result,project:await this.projects.mutate(projectId,()=>({status:result.failed?'failed':'ready'}),{candidateSceneIds:[]})};
      }
      await this.storage.ensureProject(result.project);
      this.publish({projectId,phase:result.failed?'failed':'complete',completed:result.total,total:result.total,
        selected:result.selected,skipped:result.skipped,failed:result.failed,
        message:result.failed?`Не подтверждены материалы ${result.failed} сцен. Готовые кадры сохранены.`:'Все материалы проверены и сохранены.'});
      return result;
    })();
    this.autoRuns.set(projectId,run);
    try{return await run;}
    catch(error){
      const stopped=this.stopRequested.has(projectId)||error instanceof Error&&error.name==='AbortError';
      this.publish({projectId,phase:stopped?'stopped':'failed',completed:0,total,selected:0,skipped:0,failed:0,
        message:stopped?'Подбор остановлен. Готовые материалы сохранены.':error instanceof Error?error.message:String(error)});
      throw error;
    }
    finally{
      await session.drain();
      try{
        const root=join(this.storage.projectDirectory(projectId),'Documentary');await mkdir(root,{recursive:true});
        await atomicWrite(join(root,'selection-budget.json'),JSON.stringify({version:1,limits:documentaryWorkLimits,scenes:session.snapshot()},null,2));
      }catch{recordDiagnosticEvent('warn','documentary.selection.budget-report-unavailable',{projectId});}
      this.autoRuns.delete(projectId);this.downloadControllers.delete(projectId);this.narrationWaits.delete(projectId);
    }
  }

  private async repairFailedIdentities(projectId: string, sceneIds?: string[]): Promise<string[]> {
    if (!this.intelligence?.resolveIdentities) return [];
    const project = await this.projects.get(projectId);
    if (!project) return [];
    const failed = project.scenes.filter(scene => scene.includeInAssembly !== false && (!sceneIds || sceneIds.includes(scene.id))
      && !scene.documentary?.verified && !scene.documentary?.pinned && scene.documentary?.requirement.identities?.length
      && !documentarySearchUnavailable(scene.documentary.searchError)
      && !scene.documentary.requirement.identityRepairVersion
      && /именованн|identity|identifiedEntity|requiredIdentity/i.test(scene.documentary.autoError ?? ''));
    if (!failed.length) return [];
    const changedIds:string[]=[];
    await this.intelligence.resolveIdentities(project, failed, async plan => {
      await this.projects.mutate(projectId, current => ({scenes:current.scenes.map(scene => {
        const before=failed.find(item=>item.id===scene.id), next=plan.get(scene.id), doc=scene.documentary;
        if (!before || !next || !doc || doc.verified || doc.pinned || scene.narration!==before.narration
          || JSON.stringify(doc.requirement)!==JSON.stringify(before.documentary!.requirement)) return scene;
        if(JSON.stringify(next.identities)!==JSON.stringify(doc.requirement.identities))changedIds.push(scene.id);
        return {...scene,documentary:{...doc,requirement:{...next,identityRepairVersion:1}}};
      })}),{candidateSceneIds:[]});
    }, {shouldStop:()=>this.stopRequested.has(projectId),progress:message=>this.publish({projectId,phase:'preparing',completed:project.scenes.filter(s=>s.documentary?.verified).length,total:project.scenes.length,selected:0,skipped:0,failed:failed.length,message})});
    return changedIds;
  }

  private async throwCurrentIncomplete(projectId:string,error:unknown,input:ReturnType<typeof incompleteInputSnapshot>):Promise<never>{
    if(error instanceof DocumentaryPlanIncompleteError){
      this.incompleteInputs.set(error,input);
      const current=await this.projects.get(projectId,{omitCandidates:true});
      if(!current||incompleteInputChanged(current,input,error.failedSceneIds))throw new Error('Проект изменился во время анализа');
    }
    throw error;
  }

  private async selectAll(projectId: string, options: AutoStockSelectionOptions, videoOnly = false, attempts = new Map<string,{scope:string;keys:Set<string>;found:boolean}>(),session=new DocumentarySelectionSession(),reserveFallback=false,deferredLegacy?:Set<string>): Promise<AutoStockSelectionResult> {
    const waitForNarration = this.narrationWaits.get(projectId);
    const initial=await this.projects.get(projectId,{omitCandidates:true});
    const initialInput=initial?incompleteInputSnapshot(initial,initial.scenes):undefined;
    const context=initial?{script:initial.videoBrief?.readyScript,language:initial.language,
      scenes:new Map(initial.scenes.filter(scene=>!options.sceneIds||options.sceneIds.includes(scene.id)).map(scene=>[scene.id,{narration:scene.narration,pinned:Boolean(scene.documentary?.pinned),included:scene.includeInAssembly!==false}]))}:undefined;
    try{return await this.selectPrepared(projectId,options,videoOnly,attempts,session,reserveFallback,deferredLegacy);}
    catch(error){
      if(!(error instanceof DocumentaryPlanIncompleteError)||waitForNarration||this.stopRequested.has(projectId))throw error;
      const saved=await this.projects.get(projectId,{omitCandidates:true});
      if(!saved||['generating','paused'].includes(saved.status))throw error;
      const failureInput=this.incompleteInputs.get(error)??initialInput;
      if(!failureInput||incompleteInputChanged(saved,failureInput,error.failedSceneIds))throw new Error('Проект изменился во время анализа');
      if(!context||context.script!==saved.videoBrief?.readyScript||context.language!==saved.language
        ||[...context.scenes].some(([id,before])=>{const current=saved.scenes.find(scene=>scene.id===id);return !current||current.narration!==before.narration
          ||Boolean(current.documentary?.pinned)!==before.pinned||(current.includeInAssembly!==false)!==before.included;}))
        throw new Error('Проект изменился во время анализа');
      const scoped=saved.scenes.filter(scene=>scene.includeInAssembly!==false&&(!options.sceneIds||options.sceneIds.includes(scene.id)));
      const blocked=new Set(error.failedSceneIds);
      const healthy=scoped.filter(scene=>!blocked.has(scene.id)&&(scene.documentary?.pinned||scene.documentary?.requirement.plannedBy==='semantic')).map(scene=>scene.id);
      const failed=scoped.filter(scene=>blocked.has(scene.id));
      if(!failed.length)throw error;
      const message='Требования сцены не завершены: получен невалидный ответ даже на отдельную сцену. Остальные сцены продолжают подбор.';
      await this.projects.mutate(projectId,current=>{
        if(current.videoBrief?.readyScript!==saved.videoBrief?.readyScript||['generating','paused'].includes(current.status))throw new Error('Проект изменился во время анализа');
        if(incompleteInputChanged(current,failureInput,error.failedSceneIds))throw new Error('Проект изменился во время анализа');
        return {scenes:current.scenes.map(scene=>{
          const before=failed.find(item=>item.id===scene.id),doc=scene.documentary;
          return before&&doc&&!doc.pinned&&scene.narration===before.narration
            &&isDeepStrictEqual(doc.requirement,before.documentary?.requirement)
            ?{...scene,documentary:{...doc,verified:false,autoError:message,reviewNote:message}}:scene;
        })};
      },{candidateSceneIds:[]});
      const partial=healthy.length?await this.selectAll(projectId,{...options,sceneIds:healthy},videoOnly,attempts,session,reserveFallback,deferredLegacy)
        :{project:(await this.projects.get(projectId,{omitCandidates:true}))!,total:0,selected:0,skipped:0,failed:0,failures:[]} as AutoStockSelectionResult;
      const failures=[...partial.failures,...failed.map(scene=>({sceneId:scene.id,sceneNumber:scene.order+1,category:'no-results' as const,message}))];
      return {...partial,total:scoped.length,failed:failures.length,failures};
    }
  }

  private async selectPrepared(projectId:string,options:AutoStockSelectionOptions,videoOnly:boolean,attempts:Map<string,{scope:string;keys:Set<string>;found:boolean}>,session:DocumentarySelectionSession,reserveFallback:boolean,deferredLegacy?:Set<string>):Promise<AutoStockSelectionResult>{
    this.publish({ projectId, phase: "preparing", completed: 0, total: 0, selected: 0, skipped: 0, failed: 0, message: "Подготавливаю поиск и проверку материалов…" });
    const waitForNarration=this.narrationWaits.get(projectId);
    let project=waitForNarration?(await this.projects.get(projectId,{omitCandidates:true}))!:await this.planSearch(projectId,options.sceneIds,undefined,{beforeSelection:reserveFallback&&!videoOnly});
    if(waitForNarration&&project)project=await this.markMissingAutomaticMaterials(project,options.sceneIds,this.downloadControllers.get(projectId)?.signal);
    // Production with parallel narration needs the same current local targets.
    if(waitForNarration&&!this.queryPlanner&&this.intelligence?.simpleSelection)project=await this.projects.mutate(projectId,current=>({scenes:current.scenes.map(scene=>{
      if(!options.sceneIds||options.sceneIds.includes(scene.id))scene=resetStaleDocumentaryFootageFallback(scene);
      const doc=scene.documentary;
      if(!doc||doc.pinned||documentaryMaterialUsable(scene)||scene.includeInAssembly===false||options.sceneIds&&!options.sceneIds.includes(scene.id))return scene;
      const plan=planFastDocumentaryScene(current,scene);
      return {...scene,stockQuery:plan.queries[0],documentary:{...doc,requirement:{...doc.requirement,text:scene.narration,queries:plan.queries,preferredKind:plan.preferredKind,
        years:plan.requiredYears??doc.requirement.years,fastVisualTarget:plan.visualTarget,fastSourcePolicy:plan.sourcePolicy,fastPlanVersion:1}}};
    })}),{candidateSceneIds:[]});
    if (!project) throw new Error('Проект не найден');
    if (waitForNarration && project.scenes.some(scene => {
      if(scene.includeInAssembly===false||scene.documentary?.pinned||documentaryMaterialUsable(scene)
        ||options.sceneIds&&!options.sceneIds.includes(scene.id))return false;
      const requirement=scene.documentary?.requirement;
      // Fast planning is local: readiness is the current narration and its
      // saved queries, not the old paid semantic-planning marker.
      return this.intelligence?.simpleSelection
        ?this.queryPlanner?!currentDocumentaryAiSearchPlan(project,scene):requirement?.text!==scene.narration||!requirement?.queries.some(query=>query.trim())
        :requirement?.plannedBy!=='semantic';
    })) throw new Error("Сначала подготовьте поисковой план");
    const beforeExcerptRepair=project.scenes;
    const restoredExcerpts=await restoreDocumentaryExcerptReviews(project,this.storage.projectDirectory(projectId));
    if(restoredExcerpts.some((scene,index)=>scene!==beforeExcerptRepair[index]))
      project=await this.projects.mutate(projectId,current=>({scenes:current.scenes.map(scene=>{
        const index=beforeExcerptRepair.findIndex(before=>before.id===scene.id);
        return index>=0&&isDeepStrictEqual(scene,beforeExcerptRepair[index])?restoredExcerpts[index]!:scene;
      })}),{candidateSceneIds:[]});
    const thematic=project.settings.assembly.documentary?.matchMode==='thematic';
    if(!this.intelligence?.simpleSelection&&!thematic&&project.scenes.some(scene=>scene.documentary?.requirement.literalRequirement))
      project=await this.projects.mutate(projectId,current=>({scenes:current.scenes.map(scene=>{
        const doc=scene.documentary;
        if(!doc?.requirement.literalRequirement||doc.pinned||options.sceneIds&&!options.sceneIds.includes(scene.id))return scene;
        return {...applyDocumentaryRequirement(scene,doc.requirement.literalRequirement),documentary:{...doc,
          requirement:doc.requirement.literalRequirement,verified:false,illustrative:false,
          autoError:'Включено точное соответствие: тематический кадр требует новой проверки.'}};
      })}),{candidateSceneIds:[]});
    const thematicScenes=thematic?project.scenes.filter(scene=>(!options.sceneIds||options.sceneIds.includes(scene.id))
      &&scene.includeInAssembly!==false&&scene.documentary&&!scene.documentary.verified&&!scene.documentary.pinned
      &&scene.documentary.requirement.scriptRequirements?.mode!=='thematic'):[];
    if(!this.intelligence?.simpleSelection&&thematicScenes.length&&this.intelligence?.resolveThematicTargets){
      await this.intelligence.resolveThematicTargets(project,thematicScenes,async plan=>{
        project=await this.projects.mutate(projectId,current=>({scenes:current.scenes.map(scene=>{
          const req=plan.get(scene.id),before=thematicScenes.find(item=>item.id===scene.id),doc=scene.documentary;
          if(current.settings.assembly.documentary?.matchMode!=='thematic'||!req||!before||!doc||doc.verified||doc.pinned
            ||scene.narration!==before.narration||JSON.stringify(doc.requirement)!==JSON.stringify(before.documentary!.requirement))return scene;
          return {...applyDocumentaryRequirement(scene,req),documentary:{...doc,requirement:req,illustrative:true,
            searchRecovery:undefined,autoError:undefined,searchError:undefined}};
        })}),{candidateSceneIds:[]});
      },{shouldStop:()=>this.stopRequested.has(projectId),progress:message=>this.publish({projectId,phase:'preparing',completed:0,total:thematicScenes.length,selected:0,skipped:0,failed:0,message})});
    }
    const visualScopeScenes=project.scenes.filter(scene=>(!options.sceneIds||options.sceneIds.includes(scene.id))
      &&scene.includeInAssembly!==false&&scene.documentary?.requirement.identityContextVersion===3
      &&scene.documentary.requirement.identities?.length
      &&(!scene.documentary.requirement.visualScope || scene.documentary.requirement.visualScope==='exact' && scene.documentary.requirement.visualScopeVersion!==3)
      &&!scene.documentary.verified&&!scene.documentary.pinned);
    if(!this.intelligence?.simpleSelection&&visualScopeScenes.length&&this.intelligence?.resolveVisualScopes){
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
    const missingRequirements=project.scenes.filter(scene=>(!options.sceneIds||options.sceneIds.includes(scene.id))
      &&scene.includeInAssembly!==false&&scene.documentary&&!scene.documentary.pinned
      &&!documentaryScriptRequirements(scene.documentary.requirement.scriptRequirements,scene.narration,thematic));
    if(!this.intelligence?.simpleSelection&&missingRequirements.length&&this.intelligence?.resolveScriptRequirements){
      const input=incompleteInputSnapshot(project,missingRequirements);
      try{await this.intelligence.resolveScriptRequirements(project,missingRequirements,async plan=>{
        project=await this.projects.mutate(projectId,current=>({scenes:current.scenes.map(scene=>{
          const requirement=plan.get(scene.id),before=missingRequirements.find(item=>item.id===scene.id);
          return requirement&&before&&scene.documentary&&!scene.documentary.pinned&&scene.narration===before.narration
            &&JSON.stringify(scene.documentary.requirement)===JSON.stringify(before.documentary!.requirement)
            ?{...scene,documentary:{...scene.documentary,requirement}}:scene;
        })}),{candidateSceneIds:[]});
      },{shouldStop:()=>this.stopRequested.has(projectId),progress:message=>this.publish({projectId,phase:'preparing',completed:0,total:missingRequirements.length,selected:0,skipped:0,failed:0,message})});}
      catch(error){await this.throwCurrentIncomplete(projectId,error,input);}
    }
    const changeScene = (sceneId: string, change: (scene: Scene) => Scene) => this.changeScene(projectId, sceneId, change, Boolean(waitForNarration));
    const savedReviewIssues=new Map<string,string>();
    for(const scene of project.scenes){
      if(options.sceneIds&&!options.sceneIds.includes(scene.id)||!scene.documentary?.verified||scene.documentary.pinned||scene.documentary.visualReview?.illustrationApproval||!scene.documentary.visualReview?.scriptEvidence)continue;
      const evidence=documentaryScriptEvidence(scene.documentary.visualReview as unknown as Record<string,unknown>,scene.narration);
      const issue=evidence?documentaryScriptEvidenceIssue(evidence,scene.documentary.selected?.kind==='video',scene.documentary.visualReview.sampleSeconds,scene.documentary.requirement.scriptRequirements):'Сохранённая проверка не соответствует исходному тексту.';
      if(issue)savedReviewIssues.set(scene.id,issue);
    }
    if(this.intelligence?.savedMotionIssue)for(const scene of project.scenes){
      if(options.sceneIds&&!options.sceneIds.includes(scene.id)||scene.includeInAssembly===false)continue;
      const work=async()=>await this.intelligence!.savedMotionIssue?.(project,scene);
      const kind=scene.documentary?.selected?.kind??'video';session.resume(scene.id);
      try{
        const issue=this.intelligence.withSelectionBudget?await this.intelligence.withSelectionBudget({
          remaining:()=>session.remaining(scene.id,kind),submit:()=>session.takeAnalysis(scene.id,kind),
          extend:ms=>session.extend(scene.id,kind,ms),
        },work):await work();
        if(issue)savedReviewIssues.set(scene.id,issue);
      }finally{session.pause(scene.id);}
    }
    project = await this.projects.mutate(projectId, current => {
      const scenes=current.scenes.map(scene => {
      const issue = savedReviewIssues.get(scene.id)||documentarySavedQualityIssue(current,scene)||documentarySavedIdentityIssue(scene)||documentarySavedContextIssue(current,scene);
      const legacyNarrative=issue&&documentaryLegacyFallbackNarrativeApproval(current,scene)
        &&issue===documentaryFallbackNarrativeIssue(current,scene,scene.documentary?.visualReview)?.reason;
      return issue && (!options.sceneIds || options.sceneIds.includes(scene.id))
        ? { ...scene, documentary: { ...scene.documentary!, verified: false, autoError: issue, reviewNote: issue,
          ...(!legacyNarrative&&(savedReviewIssues.has(scene.id)||scene.documentary?.visualReview?.illustrationApproval)&&scene.documentary?.visualReview?{visualReview:{...scene.documentary.visualReview,status:'rejected' as const,reason:issue,annotations:[],contextApproval:undefined}}:{}) } } : scene;
      });
      // Persist the readiness downgrade together with revoked evidence. A
      // later provider error must not leave a partial project falsely ready.
      return {scenes,...(['ready','complete'].includes(current.status)&&scenes.some(scene=>scene.includeInAssembly!==false&&!documentaryMaterialUsable(scene))?{status:'failed' as const}:{})};
    },{candidateSceneIds:[]});
    const inScope = (scene: Scene) => !options.sceneIds || options.sceneIds.includes(scene.id);
    project=await this.projects.mutate(projectId,current=>({scenes:current.scenes.map(scene=>inScope(scene)
      ?repairDocumentaryGeographicReserve(current,scene):scene)}),{candidateSceneIds:[]});
    if(!this.queryPlanner&&this.intelligence?.simpleSelection)project=await this.projects.mutate(projectId,current=>({scenes:current.scenes.map(scene=>{
      const doc=scene.documentary;
      if(!doc||doc.pinned||documentaryMaterialUsable(scene)||!inScope(scene)||scene.includeInAssembly===false)return scene;
      const plan=planFastDocumentaryScene(current,scene);
      return {...scene,stockQuery:plan.queries[0],documentary:{...doc,requirement:{...doc.requirement,text:scene.narration,queries:plan.queries,preferredKind:plan.preferredKind,
        years:plan.requiredYears??doc.requirement.years,fastVisualTarget:plan.visualTarget,fastSourcePolicy:plan.sourcePolicy,fastPlanVersion:1}}};
    })}),{candidateSceneIds:[]});
    // Keep existing graphics; creating replacements requires an explicit policy.
    const preservedMontage=new Set(project.scenes.filter(scene=>(documentaryMaterialUsable(scene)||documentaryThematicDiscoveryRequirement(project,scene))&&!options.force).map(scene=>scene.id));
    const montageScope=project.scenes.filter(scene=>inScope(scene)&&!preservedMontage.has(scene.id)).map(scene=>scene.id);
    project=await this.projects.mutate(projectId,current=>({scenes:planDocumentaryMontage(current,true).map(scene=>inScope(scene)&&!preservedMontage.has(scene.id)?scene:current.scenes.find(s=>s.id===scene.id)!)}),{candidateSceneIds:[]});
    if (!options.sceneIds && !waitForNarration) project = await this.applyPlannedEffects(projectId,montageScope);
    // Upgrade old source covers locally before checking visual variety. No AI,
    // no replacement of selected media, voice, trim positions or manual pins.
    const posters: Scene[] = [];
    for (const scene of project.scenes) if (inScope(scene) && scene.includeInAssembly !== false && scene.documentary?.verified && scene.videoPath) posters.push(await prepareDocumentaryRangePoster(this.storage.projectDirectory(projectId), scene));
    if (posters.length) project = await this.projects.mutate(projectId, current => ({ scenes: current.scenes.map(scene => {
      const source = project.scenes.find(item => item.id === scene.id), prepared = posters.find(item => item.id === scene.id);
      return prepared && source?.videoPath === scene.videoPath && source?.imagePath === scene.imagePath && source?.trimStartSeconds === scene.trimStartSeconds && source?.trimEndSeconds === scene.trimEndSeconds
        ? { ...scene, imagePath: prepared.imagePath, documentary: { ...scene.documentary!, visualReview: scene.documentary?.visualReview
          ? { ...scene.documentary.visualReview, frameHash: prepared.documentary?.visualReview?.frameHash } : undefined } } : scene;
    }) }),{candidateSceneIds:[]});
    project = await this.projects.mutate(projectId, current => {
      const checked = this.intelligence?.simpleSelection?current.scenes:revalidateDocumentaryVariety(current);
      return { scenes: current.scenes.map((scene, index) => inScope(scene) ? checked[index]! : scene) };
    },{candidateSceneIds:[]});
    const scenes = project.scenes.filter(scene => inScope(scene) && scene.includeInAssembly !== false).sort((a, b) => a.order - b.order);
    if (scenes.length && (options.force || scenes.some(scene => !documentaryMaterialUsable(scene))) && (!this.intelligence || !await this.intelligence.available())) throw new DocumentaryAnalysisError("Для проверки реальных кадров нужен доступный AnyModel",'unavailable');
    const failures: AutoStockSelectionResult["failures"] = [];
    const recoveredContext=await readDocumentaryContextRecovery(this.storage.projectDirectory(projectId));
    const reviewIdentity=this.intelligence?.simpleSelection?await this.intelligence.selectionReviewIdentity?.():undefined;
    const retryEvidence=reviewIdentity&&this.intelligence?.inspectForSelection
      ?await readDocumentarySelectionRetryEvidence(this.storage.projectDirectory(projectId),reviewIdentity.model):undefined;
    const blockedCatalogs = new Set<string>();
    project=await this.projects.mutate(projectId,current=>{
      const videoPercent=current.settings.stockVideoPercent;
      const photoFirst=documentaryPhotoFirstScenes(current,Boolean(this.intelligence?.simpleSelection));
      return {scenes:current.scenes.map(scene=>{
        const doc=scene.documentary;
        if(!doc||!inScope(scene)||scene.includeInAssembly===false)return scene;
        const kind=photoFirst.has(scene.id)?'image' as const:'video' as const;
        if(doc.selectionPlan?.videoPercent===videoPercent){
          if(doc.selectionPlan.kind===kind||!this.intelligence?.simpleSelection||videoPercent<=0||videoPercent>=100
            ||!doc.requirement.aiSearchPlan||doc.requirement.footageFallback||doc.pinned||documentaryMaterialUsable(scene))return scene;
        }
        return {...scene,documentary:{...doc,selectionPlan:{kind,videoPercent}}};
      })};
    },{candidateSceneIds:[]});
    let skipped = 0, completed = 0, selected = 0;
    // Read the persisted shortlist once, before concurrent workers mutate the
    // project. Display views intentionally omit it; an empty display array is
    // not evidence that discovery has never completed for this scene.
    const savedCandidatePools=new Map<string,{binding:string;candidates:DocumentaryCandidate[]}>();
    if(!options.force){
      const saved=await this.projects.get(projectId);
      for(const scene of saved?.scenes??[])if(scene.documentary&&inScope(scene)&&scene.includeInAssembly!==false
        &&!scene.documentary.pinned&&!documentaryMaterialUsable(scene))
        savedCandidatePools.set(scene.id,{binding:this.selectionResumeBinding(saved!,scene),candidates:scene.documentary.candidates});
    }
    const activeScenes = new Set<string>();
    const budgetKinds=new Map<string,'image'|'video'>();
    const canAttempt=(sceneId:string,kind:'image'|'video')=>session.canAttempt(sceneId,kind)
      &&(!reserveFallback||session.budget(sceneId,kind).attempts<documentaryWorkLimits[kind].attempts-1
        &&(!this.intelligence?.simpleSelection||session.remaining(sceneId,kind)>30_000));
    const relatedSources=(scene:Scene,kind:'image'|'video')=>session.related(scene.documentary!.requirement,kind,query=>
      measureDocumentaryStage('search-related',{projectId,sceneId:scene.id},()=>this.searcher.search({query,kind,
        entities:documentarySearchSubjects(scene.documentary!.requirement),years:scene.documentary!.requirement.years,
        providers:['web','local',...(!scene.documentary!.requirement.identities?.length?['pexels' as const,'pixabay' as const]:[])]},true,this.downloadControllers.get(projectId)?.signal)));
    const selectScene = async (scene: Scene) => {
      let preparedAnalyses=0,preparedSubmissionAttempted=false;
      let preparedKind:'image'|'video'|undefined;
      let pendingVideoReview=false;
      if (this.stopRequested.has(projectId)) return;
      let project = (await this.projects.get(projectId,{omitCandidates:true}))!;
      scene=project.scenes.find(item=>item.id===scene.id)!;
      if(scene.documentary?.pinned&&await documentarySelectedMaterialMissing(scene)){
        failures.push(documentarySelectionFailure(scene,{message:documentaryMissingSelectedMaterialMessage,fallbackCategory:'download'}));
        completed++;
        return;
      }
      if(!this.intelligence?.simpleSelection&&!options.force&&documentaryManualReviewReady(scene)){
        const path=scene.documentary!.manualReview!.mediaPath;
        if(await stat(path).then(info=>info.isFile()&&info.size>0,()=>false)){skipped++;completed++;return;}
      }
      if(scene.documentary?.verified&&!scene.documentary.selected&&scene.documentary.motionGraphic?.origin==='automatic'
        &&!documentarySavedContextIssue(project,scene)){
        skipped++;
        completed++;return;
      }
      const savedIssue=scene.documentary?.verified&&!scene.documentary.pinned?documentarySavedContextIssue(project,scene):undefined;
      if(savedIssue){
        project=await changeScene(scene.id,current=>({...current,documentary:{...current.documentary!,verified:false,autoError:savedIssue,
          visualReview:current.documentary?.visualReview?{...current.documentary.visualReview,status:'rejected',reason:savedIssue}:undefined}}));
        scene=project.scenes.find(item=>item.id===scene.id)!;
      }
      if (videoOnly && documentaryVideoCoverage(project.scenes).percent >= project.settings.stockVideoPercent) { skipped++; completed++; return; }
      // An old approval needs current evidence, not another search/download.
      // Replay a completed actual-frame check first, with POSTs disabled.
      if(scene.documentary&&!scene.documentary.verified&&!scene.documentary.pinned&&(!scene.documentary.visualReview||scene.documentary.visualReview.status==='accepted')
        &&scene.documentary.selected&&this.intelligence?.inspectForSelection&&!options.force
        &&!await documentarySelectedMaterialMissing(scene)
        &&(this.intelligence.simpleSelection||!documentaryContradictoryModelYear(scene.documentary.selected,scene.documentary.requirement,documentarySceneContext(project,scene)))
        &&!documentarySavedIdentityIssue({...scene,documentary:{...scene.documentary,verified:true}})){
        try{
          this.publish({projectId,phase:'applying',completed,total:scenes.length,selected,skipped,failed:failures.length,currentSceneId:scene.id,
            message:`Кадр ${scene.order+1}: проверяю сохранённый анализ без нового платного запроса…`});
          let review:Awaited<ReturnType<DocumentaryIntelligence['inspectForSelection']>>['review']|undefined;
          try { review=(await this.intelligence.inspectForSelection(project,scene,undefined,()=>Boolean(fatal)||this.stopRequested.has(projectId),true)).review; }
          catch(error){
            if(!(error instanceof DocumentaryCachedAnalysisMissing))throw error;
            const source=scene.documentary.selected,file=source.kind==='video'?scene.videoPath:scene.imagePath;
            const legacyNarrative=!videoOnly&&documentaryLegacyFallbackNarrativeApproval(project,scene);
            // Stop may leave an immutable prepared original BEFORE its first review.
            // Inspect that file under the same budget instead of redownloading/searching.
            // Pending/partial receipts throw above and never enter this branch.
            if((legacyNarrative||!scene.documentary.visualReview&&!scene.documentary.manualReview?.analysis&&!scene.documentary.requirement.footageFallback?.automaticRecovery)
              &&file&&await stat(file).then(info=>info.isFile(),()=>false)
              &&(!legacyNarrative||await checksumFile(file)===scene.documentary.checksum)
              &&(this.intelligence.simpleSelection||!documentaryCandidateSubjectIssue(source,scene.documentary.requirement,scene.narration))
              &&canAttempt(scene.id,source.kind)&&session.takeAttempt(scene.id,source.kind)){
              preparedKind=source.kind;budgetKinds.set(scene.id,source.kind);preparedSubmissionAttempted=true;preparedAnalyses=1;
              this.publish({projectId,phase:'applying',completed,total:scenes.length,selected,skipped,failed:failures.length,currentSceneId:scene.id,
                message:`Кадр ${scene.order+1}: проверяю подготовленный оригинал без повторного скачивания…`});
              const inspection=await this.intelligence.inspectForSelection(project,scene,undefined,()=>Boolean(fatal)||this.stopRequested.has(projectId));
              review=inspection.review;preparedAnalyses=inspection.usedNewAnalysis?1:0;
            }
          }
          if((scene.documentary.selected.kind==='image'&&scene.imagePath
              ||scene.documentary.selected.kind==='video'&&scene.videoPath&&scene.documentary.selected.durationSeconds!==undefined
                &&scene.documentary.selected.durationSeconds<=45)
            &&!this.intelligence.simpleSelection&&!scene.documentary.visualReview?.contextApproval
            &&(!review||review.status==='uncertain')&&!this.stopRequested.has(projectId)){
            this.publish({projectId,phase:'applying',completed,total:scenes.length,selected,skipped,failed:failures.length,currentSceneId:scene.id,
              message:`Кадр ${scene.order+1}: проверяю сохранённый оригинал по текущему тексту…`});
            review=(await this.intelligence.inspectForSelection(project,scene,undefined,()=>Boolean(fatal)||this.stopRequested.has(projectId),false,true)).review;
          }
          if(!review)throw new DocumentaryCachedAnalysisMissing('Готовой проверки сохранённого оригинала нет');
          if(deferredLegacy&&this.queryPlanner?.planFallbacks&&review.status!=='accepted'
            &&documentaryLegacyFallbackNarrativeApproval(project,scene)){
            const fit=documentaryFallbackNarrativeFit(project,scene,review);
            if(fit&&fit.status!=='supported'){
              // The first settled refusal may have arrived in this run. Give
              // the existing bounded replan its turn before searching again.
              deferredLegacy.add(scene.id);
              failures.push({sceneId:scene.id,sceneNumber:scene.order+1,category:'analysis',message:review.reason});
              completed++;
              return;
            }
          }
          const restored={...scene,trimStartSeconds:review.trimStartSeconds??0,trimEndSeconds:review.trimEndSeconds,
            documentary:{...scene.documentary,...(review.status==='accepted'?documentaryAcceptedMaterialMetadata(project,scene,review,Boolean(this.intelligence.simpleSelection)):{}),
              verified:review.status==='accepted',visualReview:review}};
          if(restored.documentary.verified&&(review.contextApproval||review.illustrationApproval)&&!documentarySavedContextIssue(project,restored)
            &&(this.intelligence.simpleSelection||!documentaryVarietyIssue(project,restored)&&!documentaryReuseIssue(project,restored))){
            const prepared=await prepareDocumentaryRangePoster(this.storage.projectDirectory(projectId),restored);
            project=await changeScene(scene.id,latest=>{
              if(latest.documentary?.checksum!==scene.documentary?.checksum||latest.narration!==scene.narration||latest.documentary?.pinned!==scene.documentary?.pinned)return latest;
              const updated={...latest,imagePath:prepared.imagePath,trimStartSeconds:restored.trimStartSeconds,trimEndSeconds:restored.trimEndSeconds,
                documentary:{...latest.documentary!,...documentaryAcceptedMaterialMetadata(project,latest,review,Boolean(this.intelligence!.simpleSelection)),
                  verified:true,visualReview:prepared.documentary!.visualReview}};
              return documentarySavedContextIssue(project,updated)?latest:updated;
            });
            scene=project.scenes.find(item=>item.id===scene.id)!;
            await this.rememberSelectedEvidence(scene);
          }
        }catch(error){
          if(this.stopRequested.has(projectId))return;
          if(exhaustedVisionProvider(error)){
            await changeScene(scene.id,current=>({...current,documentary:{...current.documentary!,autoError:error.message}}));
            throw error;
          }
          pendingVideoReview=scene.documentary?.selected?.kind==='video'&&error instanceof DocumentaryAnalysisError&&error.kind==='pending';
          recordDiagnosticEvent('info','documentary.analysis.saved-context-not-restored',{projectId,sceneId:scene.id,reason:error instanceof Error?error.name:'Error',paidRequests:preparedSubmissionAttempted?'unknown':0});
        }
      }
      const previousReady = Boolean(scene.documentary?.verified && scene.documentary.selected
        && await stat((scene.documentary.selected.kind==='video'?scene.videoPath:scene.imagePath) || "").then(info => info.isFile(), () => false));
      // Ready photo fallbacks are useful. Upgrade them only in the measured
      // coverage pass, not on every resume merely because the planner wanted video.
      const upgradePhoto = previousReady && videoOnly;
      const varietyIssue = !this.intelligence?.simpleSelection && previousReady && !scene.documentary?.visualReview?.illustrationApproval && (documentaryDistraction(scene, scene.documentary?.visualReview?.viewDescription ?? "") || documentaryVarietyIssue(project, scene));
      if (previousReady && (scene.documentary?.pinned || !options.force && !upgradePhoto && !varietyIssue)) {
        const doc=scene.documentary!;
        // Older automatic prepared resumes kept the receipt but missed the editor label.
        // Repair only explicitly thematic, unpinned, currently approved material locally.
        if(!doc.pinned&&doc.visualReview?.status==='accepted'
          &&(doc.requirement.aiSearchPlan?.visualScope==='illustrative'||doc.requirement.footageFallback)){
          const labels=documentaryAcceptedMaterialMetadata(project,scene,doc.visualReview,Boolean(this.intelligence?.simpleSelection));
          if(doc.illustrative!==labels.illustrative||doc.illustrationLabelInEditorOnly!==labels.illustrationLabelInEditorOnly||doc.reviewNote!==labels.reviewNote)
            project=await changeScene(scene.id,latest=>{
              const current=latest.documentary;
              if(!current?.verified||current.pinned||current.checksum!==doc.checksum||current.visualReview?.status!=='accepted'
                ||documentarySavedContextIssue(project,latest))return latest;
              return {...latest,documentary:{...current,...documentaryAcceptedMaterialMetadata(project,latest,current.visualReview,Boolean(this.intelligence?.simpleSelection))}};
            });
        }
        if(preparedAnalyses)selected++;else skipped++; completed++; return;
      }
      activeScenes.add(scene.id);
      let accepted = false, youtubeTimedOut = session.downloadTimedOut(scene.id,'youtube'), foundThisRun = false,videoOperationalError=false;
      this.publish({ projectId, phase: "searching", completed, total: scenes.length, selected, skipped, failed: failures.length,
        currentSceneId: scene.id, currentSceneNumber: scene.order + 1, message: `Ищу ${this.intelligence?.simpleSelection?'футаж':'точный материал'}: ${scene.stockQuery || scene.title}` });
      try {
        const thematicRequirement=documentaryThematicDiscoveryRequirement(project,scene);
        const discoveryRequirement=thematicRequirement??scene.documentary!.requirement;
        const semanticRecovery=documentaryNeedsSemanticRecovery(scene);
        // Reuse the structured evidence of the latest known refusal. Old
        // receipts stay on disk; query repair needs no new pixel submission.
        for(const range of [...(scene.documentary?.searchRecovery?.rejectedRanges??[])].reverse()){
          if(!/^[a-f0-9]{64}$/i.test(range.checksum))continue;
          const saved=await readFile(join(this.storage.projectDirectory(projectId),'Documentary',scene.id.replace(/[^a-zA-Z0-9_-]/g,'_'),`${range.checksum}.review.json`),'utf8')
            .then(text=>JSON.parse(text) as {review:Record<string,unknown>},error=>{if(error.code==='ENOENT')return undefined;throw error;});
          if(!saved||!documentaryScriptEvidence(saved.review,scene.narration))continue;
          const queries=documentaryRecoveryQueries(saved.review);
          if(queries.length&&(JSON.stringify(queries)!==JSON.stringify(scene.documentary!.searchRecovery!.queries)||!scene.documentary!.searchRecovery!.scriptEvidence)){
            project=await changeScene(scene.id,current=>({...current,documentary:{...current.documentary!,searchRecovery:{...current.documentary!.searchRecovery!,queries,
              scriptEvidence:documentaryScriptEvidence(saved.review,scene.narration)}}}));
            scene=project.scenes.find(item=>item.id===scene.id)!;
          }
          break;
        }
        // Older completed refusals lack structured feedback. Refine their
        // recorded reason once, keeping the same requirements and paid cache.
        if(!this.intelligence?.simpleSelection&&scene.documentary?.visualReview?.status==='rejected'&&!scene.documentary.searchRecovery&&this.intelligence?.refineQueries){
          const recovered=(await this.intelligence.refineQueries(project,[scene])).get(scene.id)??[];
          project=await changeScene(scene.id,current=>({...current,documentary:{...current.documentary!,searchRecovery:{
            reason:scene.documentary!.visualReview!.reason,queries:recovered.slice(0,2),rejectedRanges:[]}}}));
          scene=project.scenes.find(item=>item.id===scene.id)!;
        }
        let recoveryQueries=scene.documentary?.searchRecovery?.queries??[];
        const takeRecoveryQueries=()=>{const result=recoveryQueries;recoveryQueries=[];return result;};
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
        const stockStage=(kind:'video'|'image')=>({kind,localOnly:false,quick:false});
        const simpleKind=videoOnly||this.intelligence!.simpleSelection&&project.settings.stockVideoPercent>=100
          ?'video':scene.documentary?.selectionPlan?.kind??'video';
        const primaryPhotoFallback=!videoOnly&&simpleKind==='video'&&project.settings.stockVideoPercent<100
          &&Boolean(currentDocumentaryAiSearchPlan(project,scene)?.imageQueries.length);
        const primaryPhotoAfterReserve=Boolean(this.intelligence!.simpleSelection&&primaryPhotoFallback
          &&thematicRequirement&&!previousReady);
        const projectPrimaryPhoto=(source:Scene):Scene=>({...source,documentary:{...source.documentary!,
          requirement:{...source.documentary!.requirement,footageFallback:undefined},searchRecovery:undefined}});
        const stages = this.intelligence?.simpleSelection
          ?[stockStage(simpleKind),...(primaryPhotoFallback&&(!currentDocumentaryFootageFallback(scene)||primaryPhotoAfterReserve)?[stockStage('image')]:[])]
          :videoOnly ? videos : scene.documentary?.selectionPlan?.kind==='image' ? [...photos,...videos] : [...videos,...photos];
        // Search rewrites change where we look, not what already-inspected
        // pixels show. Carry attempts across passes of this run. A changed
        // narrative target gets a fresh set; later manual resumes remain allowed.
        const scopeFor=(source:Scene,requirement:DocumentaryRequirement)=>JSON.stringify([documentaryNarrationContext(project,source),
          requirement.entities,requirement.identities,requirement.years,requirement.detail,source.documentary?.motionGraphic]);
        const scope=scopeFor(scene,discoveryRequirement);
        const visualScopeParts=[scope,project.aspectRatio,discoveryRequirement.preferredKind,scene.documentary?.layout];
        const oldRejectionScope=createHash('sha256').update(JSON.stringify(['visual-rejection-v1',...visualScopeParts])).digest('hex');
        // Old visual refusals on an audience CTA were based on the mistaken
        // demand to show a literal subscription action. Reconsider those
        // known refusals under the corrected on-topic background policy, but
        // retain unknown paid submissions under their original scope.
        let rejectionScope=discoveryRequirement.scriptRequirements?.mode==='thematic'
          ?createHash('sha256').update(JSON.stringify(['visual-rejection-thematic-v2',...visualScopeParts,discoveryRequirement.scriptRequirements])).digest('hex')
          :documentaryCallToActionIllustration(scene)
          ?createHash('sha256').update(JSON.stringify(['visual-rejection-cta-v2',...visualScopeParts])).digest('hex')
          :documentaryGeneralDiagramScope(documentarySceneContext(project,scene),discoveryRequirement.identities)?.principle
            ?createHash('sha256').update(JSON.stringify(['visual-rejection-diagram-v2',...visualScopeParts])).digest('hex')
          :documentaryNamedListPortrait(project,scene)
            ?createHash('sha256').update(JSON.stringify(['visual-rejection-portrait-v1',...visualScopeParts])).digest('hex')
            :oldRejectionScope;
        if(this.intelligence!.simpleSelection)
          rejectionScope=createHash('sha256').update(JSON.stringify(['visual-illustration-v1',...visualScopeParts,...(reviewIdentity?[reviewIdentity]:[])])).digest('hex');
        if((await documentaryLegacyMotionRefusals(this.storage.projectDirectory(projectId),scene)).size)
          rejectionScope=createHash('sha256').update(JSON.stringify([rejectionScope,'physical-subject-motion-v2'])).digest('hex');
        const sceneRoot=join(this.storage.projectDirectory(projectId),'Documentary',scene.id.replace(/[^a-zA-Z0-9_-]/g,'_'));
        const preparedSources:Array<DocumentaryCandidate&{checksum:string;selectionBinding?:string}>=[];
        if(!options.force)for(const name of await readdir(sceneRoot).catch(error=>{if(error.code==='ENOENT')return [];throw error;})){
          if(!/^[a-f0-9]{64}\.source\.json$/.test(name))continue;
          const source=await readFile(join(sceneRoot,name),'utf8').then(text=>{
            try{return JSON.parse(text) as DocumentaryCandidate&{checksum:string;selectionBinding?:string};}catch{return undefined;}
          });
          if(source&&source.checksum===name.slice(0,64)&&source.localPath&&typeof source.id==='string'
            &&(source.kind==='video'||source.kind==='image')&&Array.isArray(source.concerns)
            &&await stat(source.localPath).then(info=>info.isFile()&&info.size>0,()=>false))preparedSources.push(source);
        }
        let rejectionPath=join(sceneRoot,'rejected-candidates.json');
        let rejectedCandidates=await readDocumentaryRejections(rejectionPath,rejectionScope);
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
        let uncertainPath=join(sceneRoot,'uncertain-candidates.json');
        // A different model may inspect this source; an unknown response from
        // the same model remains protected across prompt revisions.
        const uncertaintyFor=(scope:string)=>reviewIdentity?createHash('sha256').update(JSON.stringify([scope,reviewIdentity.model])).digest('hex'):scope;
        let uncertainScope=uncertaintyFor(oldRejectionScope);
        let uncertainCandidates=await readDocumentaryRejections(uncertainPath,uncertainScope);
        const failedTransfers=session.failedTransfers;
        const transferFailed=(candidate:DocumentaryCandidate)=>!candidate.localPath&&failedTransfers.has(documentaryTransferFingerprint(candidate));
        const retryCandidateKey=(candidate:DocumentaryCandidate)=>JSON.stringify([candidate.id,candidate.localPath]);
        const admittedRetries=new Map<string,{checksum:string;grant?:DocumentarySelectionRetryGrant}>();
        const retryProbes=new Map<string,Promise<void>>();
        const retryFor=(candidate:DocumentaryCandidate)=>admittedRetries.get(retryCandidateKey(candidate));
        const isUncertain=(candidate:DocumentaryCandidate)=>!retryFor(candidate)&&uncertainCandidateFingerprints(candidate).some(key=>uncertainCandidates.has(key));
        const probeRetry=(candidate:DocumentaryCandidate,taskScene:Scene):Promise<void>|undefined=>{
          const checksum=/^local:([a-f0-9]{64})$/.exec(candidate.id)?.[1],file=candidate.localPath;
          if(candidate.provider!=='local'||!checksum||!file||!uncertainCandidates.has(uncertainFileFingerprint(checksum)))return;
          const grants=retryEvidence?.grants.filter(grant=>grant.binding.checksum===checksum)??[];
          const canReadCache=retryEvidence?.cachedChecksums.has(checksum);
          if(!grants.length&&!canReadCache)return;
          const key=retryCandidateKey(candidate),prior=retryProbes.get(key);
          if(prior)return prior;
          const work=(async()=>{
            if(await checksumFile(file).catch(()=>undefined)!==checksum)return;
            const prepared={...taskScene,trimStartSeconds:0,trimEndSeconds:undefined,
              videoPath:candidate.kind==='video'?file:undefined,imagePath:candidate.kind==='image'?file:undefined,
              documentary:{...taskScene.documentary!,selected:candidate,checksum,verified:false,visualReview:undefined}};
            const inspect=()=>this.intelligence!.inspectForSelection!(project,prepared,undefined,
              ()=>Boolean(fatal)||this.stopRequested.has(projectId),true);
            if(canReadCache)try {
              const cached={matched:false};
              const result=await documentarySelectionRetry.run({cached},inspect);
              if(cached.matched&&!result.usedNewAnalysis&&result.review.status==='accepted'){
                admittedRetries.set(key,{checksum});return;
              }
            } catch(error) {
              if(error instanceof Error&&error.name==='AbortError')throw error;
            }
            for(const grant of grants)try {
              await documentarySelectionRetry.run({grant,probe:true},inspect);
            } catch(error) {
              if(error instanceof DocumentarySelectionRetryProbePassed){admittedRetries.set(key,{checksum,grant});return;}
              if(error instanceof Error&&error.name==='AbortError')throw error;
              // Keep the quarantine when the canonical request cannot be proved.
            }
          })();
          retryProbes.set(key,work);
          return work;
        };
        const rememberUncertain=async(candidate:DocumentaryCandidate,checksum?:string)=>{
          const keys=[...uncertainCandidateFingerprints(candidate),...(checksum?[uncertainFileFingerprint(checksum)]:[])];
          if(keys.every(key=>uncertainCandidates.has(key)))return;
          for(const key of keys)uncertainCandidates.add(key);
          await saveDocumentaryRejections(uncertainPath,uncertainScope,uncertainCandidates).catch(()=>{
            recordDiagnosticEvent('warn','documentary.search.uncertain-cache-write-failed',{projectId,sceneId:scene.id});
          });
        };
        if(this.intelligence!.simpleSelection&&documentaryManualReviewReady(scene)&&scene.documentary?.manualReview?.analysis&&scene.documentary.selected)
          await rememberUncertain(scene.documentary.selected,scene.documentary.checksum);
        const previousAttempts=attempts.get(scene.id);
        const tried=previousAttempts?.scope===scope?previousAttempts.keys:new Set<string>();
        if(options.force&&scene.documentary?.selected)tried.add(documentaryCandidateKey(scene.documentary.selected));
        const attemptState={scope,keys:tried,found:previousAttempts?.scope===scope&&previousAttempts.found||false};
        attempts.set(scene.id,attemptState);
        // The early stock attempt shares the existing remote review budget.
        // It must not add another set of paid checks before the broad fallback.
        const inspectionCounts = new Map<string, number>(preparedAnalyses&&preparedKind?[[`${preparedKind}:remote`,preparedAnalyses]]:[]);
        const retriedRanges=new Set<string>();
        const refusedFiles=new Set<string>();
        const attemptCounts = new Map<string, number>();
        const deferredLocal = new Map<'image'|'video',DocumentaryCandidate[]>();
        // A successful photo search must not erase a video provider's outage.
        const sourceErrors: string[] = [];
        let primaryPhotoRejection: string | undefined;
        const slowStockProviders = new Set<string>();
        for (const { kind, localOnly, quick } of stages) {
          if (fatal || this.stopRequested.has(projectId)) return;
          if (accepted) break;
          if(kind==='video'&&sourceErrors.length)session.blockPhotoFallback(scene.id);
          if(!this.intelligence!.simpleSelection&&kind==='image'&&scene.documentary?.selectionPlan?.kind==='video'
            &&(videoOperationalError||session.photoFallbackBlocked(scene.id)||sourceErrors.length||!documentaryPhotoFallbackStatus((await this.projects.get(projectId,{omitCandidates:true}))!,scene.id).allowed))continue;
          budgetKinds.set(scene.id,kind);
          if (!canAttempt(scene.id,kind)) continue;
          const reservePhoto=kind==='image'&&primaryPhotoAfterReserve;
          if(reservePhoto&&(pendingVideoReview||session.budget(scene.id,'image').attempts))break;
          const taskScene=reservePhoto?projectPrimaryPhoto(scene):scene;
          const requirement=reservePhoto?taskScene.documentary!.requirement:discoveryRequirement;
          const resumeBinding=this.selectionResumeBinding(project,taskScene);
          const savedPool=savedCandidatePools.get(scene.id);
          const previousCandidates=savedPool?.binding===resumeBinding?savedPool.candidates:[];
          const sameDiscoverySource=(candidate:DocumentaryCandidate,source:DocumentaryCandidate)=>candidate.id===source.id
            &&candidate.provider===source.provider&&candidate.kind===source.kind&&candidate.downloadUrl===source.downloadUrl;
          const savedSources=preparedSources.filter(source=>source.kind===kind
            &&(source.selectionBinding?source.selectionBinding===resumeBinding:previousCandidates.some(candidate=>sameDiscoverySource(candidate,source))));
          const savedChecksums=new Map(savedSources.map(source=>[retryCandidateKey(source),source.checksum]));
          const resumedCandidates=[...savedSources,...previousCandidates.filter(candidate=>candidate.kind===kind
            &&!savedSources.some(source=>sameDiscoverySource(candidate,source)))];
          const searchSubjects=documentarySearchSubjects(requirement);
          if(reservePhoto){
            const parts=[scopeFor(taskScene,requirement),project.aspectRatio,requirement.preferredKind,taskScene.documentary?.layout];
            rejectionScope=createHash('sha256').update(JSON.stringify(['visual-illustration-v1',...parts,...(reviewIdentity?[reviewIdentity]:[])])).digest('hex');
            if((await documentaryLegacyMotionRefusals(this.storage.projectDirectory(projectId),taskScene)).size)
              rejectionScope=createHash('sha256').update(JSON.stringify([rejectionScope,'physical-subject-motion-v2'])).digest('hex');
            uncertainScope=uncertaintyFor(createHash('sha256').update(JSON.stringify(['visual-rejection-v1',...parts])).digest('hex'));
            // Keep both task scopes on disk; a photo may not erase the
            // unresolved paid checkpoints and source refusals of the reserve.
            const primaryRejections=await readDocumentaryRejections(rejectionPath,rejectionScope);
            const primaryUncertain=await readDocumentaryRejections(uncertainPath,uncertainScope);
            rejectionPath=join(sceneRoot,'primary-photo-rejected-candidates.json');
            uncertainPath=join(sceneRoot,'primary-photo-uncertain-candidates.json');
            rejectedCandidates=new Set([...primaryRejections,...await readDocumentaryRejections(rejectionPath,rejectionScope)]);
            uncertainCandidates=new Set([...primaryUncertain,...await readDocumentaryRejections(uncertainPath,uncertainScope)]);
          }
          if(quick&&semanticRecovery)continue;
          // The metadata shortcut explicitly rejects named identities/dates.
          // Do not wait for a stock-only pass that cannot accept any result;
          // the normal discovery includes the same providers concurrently.
          if (!this.intelligence!.simpleSelection && quick && (requirement.identities?.length !== 0 || requirement.years.length)) continue;
          const inspectionKey = `${kind}:${localOnly ? "local" : "remote"}`;
          const videoInspectionLimit=reserveFallback?3:2;
          const inspectionLimit = this.intelligence?.simpleSelection
            ?kind==='video'?videoInspectionLimit-Number(primaryPhotoAfterReserve):reservePhoto?1:2
            :upgradePhoto?1:kind === "video" ? 4 : 2;
          let inspections = inspectionCounts.get(inspectionKey) ?? 0;
          if (inspections >= inspectionLimit) continue;
          const pool: DocumentaryCandidate[] = !localOnly&&!quick?[...(deferredLocal.get(kind)??[])]:[];
          const searchStarted=Date.now();
          const context=documentarySceneContext(project,taskScene);
          const sourceQueries=documentaryNamedDiscoveryQueries(requirement,[...(taskScene.documentary?.searchRecovery?.queries??[]),...documentarySearchQueries(requirement,kind,context)],taskScene.narration);
          const plannedQueries=documentaryGeneralIllustration(scene)||kind==='image'&&documentaryGeneralDiagramScope(context,requirement.identities)?sourceQueries
            :documentaryDatedSearchQueries(sourceQueries,documentaryNarrationContext(project,scene));
          const linkedModelYear=kind==='video'?documentaryContinuityModelYear(requirement,context):undefined;
          const datedModel=linkedModelYear&&requirement.years.length===0&&requirement.identities?.length===1
            ?`${requirement.identities[0]!.name} ${linkedModelYear}`:undefined;
          const queries=datedModel&&!plannedQueries.some(query=>query.toLowerCase()===datedModel.toLowerCase())
            ?[datedModel,...plannedQueries].slice(0,4):plannedQueries;
          const discover = async (query: string, providers: NonNullable<DocumentarySearchInput["providers"]>,signal=this.downloadControllers.get(projectId)?.signal) => {
            // Search results are transient until the final shortlist. Persisting
            // the whole project after EVERY provider query flooded the UI/IPC.
            const discoveryEntities=this.intelligence?.simpleSelection&&providers.includes('commons')
              ?documentaryCommonsDiscoverySubjects(requirement,currentDocumentaryAiSearchPlan(project,scene),query):[];
            const result = await measureDocumentaryStage("search", { projectId, sceneId: scene.id, providers }, () => this.searcher.search({ query, kind, providers,
              entities:this.intelligence?.simpleSelection?discoveryEntities:searchSubjects,
              years:this.intelligence?.simpleSelection?[]:requirement.years },true,signal,Boolean(this.intelligence?.simpleSelection)));
            if(kind==='video'&&providers.includes('web'))session.rememberVideos(requirement,result.candidates);
            for (const source of result.sources.filter(source => source.error)) {
              const message = `${source.provider}: ${source.error}`;
              if (!sourceErrors.includes(message)) sourceErrors.push(message);
            }
            const found=result.candidates.filter(item => item.kind === kind && !tried.has(item.id)
              &&!transferFailed(item)
              &&!documentaryVisualRejectionKeys(item).some(key=>rejectedCandidates.has(key))
              &&!formatUnavailable(item));
            if(retryEvidence&&providers.includes('local'))for(const item of found)if(isUncertain(item))await probeRetry(item,taskScene);
            return found.filter(item=>!isUncertain(item));
          };
          if (localOnly) {
            const current = (await this.projects.get(projectId,{omitCandidates:true}))!;
            pool.push(...current.scenes.flatMap(item => item.documentary?.selected?.kind === "video" && item.documentary.selected.localPath ? [item.documentary.selected] : []));
            for (const query of queries) pool.push(...(await this.localCandidates(query)).filter(item => item.kind === "video"));
            if (pool.length) foundThisRun = true;
          }
          if (quick&&!resumedCandidates.length) {
            // These same queries/providers belong to the broad search below;
            // its existing provider cache reuses them if this attempt fails.
            // Only a locally obvious candidate is eligible, never a paid rank
            // against an incomplete pool. Actual-frame inspection is unchanged.
            const quickQueries = [...new Set([...(scene.documentary?.searchRecovery?.queries??[]),...(kind === "video" ? documentaryStockQueries(requirement) : []), ...queries])].slice(0, 2);
            const broad = kind === 'video' && documentaryGeneralIllustration(scene)
              && !documentaryGeneralActionIssue(scene) && !documentaryRequiredVisiblePart(scene.narration)
              ? documentaryBroadIllustrationStockQuery(requirement) : undefined;
            if (broad && !quickQueries.includes(broad)) quickQueries.push(broad);
            if(!semanticRecovery&&documentaryGeneralIllustration(scene))for(const query of quickQueries){
              pool.push(...(await this.localCandidates(query)).filter(item=>item.kind===kind
                &&!documentaryRepresentationIssue(scene.narration,{reason:item.title})
                &&!documentaryVisualRejectionKeys(item).some(key=>rejectedCandidates.has(key))&&!isUncertain(item)));
              if(documentaryMetadataShortlist(scene,pool).length)break;
            }
            for (const query of quickQueries) {
              if (fatal || this.stopRequested.has(projectId)) return;
              if(documentaryMetadataShortlist(scene,pool).some(item=>item.localPath)){foundThisRun=true;break;}
              pool.push(...await discover(query, ["pexels", "pixabay"]));
              if (pool.length) foundThisRun = true;
              if (documentaryMetadataShortlist(scene, pool).length) break;
            }
          }
          session.accountSearch(scene.id,kind,Date.now()-searchStarted);
          let waitingAt=Date.now();
          const requiredImagePart=kind==='image'?(requirement.aiSearchPlan?documentaryRequiredVisiblePart(planFastDocumentaryScene(project,taskScene,kind).visualTarget)
            :documentaryGeneralDiagramScope(context,requirement.identities)?documentaryRequiredVisiblePart(scene.narration):undefined):undefined;
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
          // Reconsider two more distinct short stock clips already returned by
          // the same search before paying for a long YouTube preview/download.
          // The ordinary per-scene inspection budget and pixel review still apply.
          const fastPlan=planFastDocumentaryScene(project,taskScene,kind);
          const fastQueries=fastPlan.queries;
          const candidatePriority=documentarySimpleCandidatePriority(project,taskScene,kind);
          const availableForReview=(candidate:DocumentaryCandidate)=>{
            const key=documentaryCandidateKey(candidate);
            return !tried.has(key)&&!blockedCatalogs.has(key)&&!recoveredContext.scenes[scene.id]?.sourceKeys.includes(key)
              &&(candidate.localPath||candidate.provider!=='youtube'||!youtubeTimedOut&&this.youtube?.downloadAvailable?.()!==false)
              &&(!this.intelligence!.simpleSelection||candidate.kind!=='video'||!candidate.durationSeconds
                ||candidate.durationSeconds>=documentaryRequiredSourceSeconds(scene)-.05);
          };
          // Each source has its own query lane. A slow public page does not
          // hold up another stock query, download or the single frame review.
          const fastSources=(service:DocumentaryProjectService)=>{
            const providers=fastDocumentaryProviders(fastPlan,kind);
            const nameFallback=kind==='video'?documentaryYouTubeNameFallback(requirement,fastQueries):undefined;
            return discoverDocumentaryQueryLanes({
              lanes:providers.map(provider=>({provider,queries:fastQueries.slice(0,provider==='youtube'&&nameFallback?1:provider==='pexels'||provider==='pixabay'?3:2)})),
              searchMs:Math.max(1,Math.min(45_000,session.searchRemaining(scene.id,kind))),
              signal:service.downloadControllers.get(projectId)?.signal,
              stopped:()=>Boolean(fatal)||service.stopRequested.has(projectId),
              discover:async(query,provider,signal)=>{
                const first=await discover(query,[provider],signal);
                if(provider!=='youtube'||!nameFallback||signal.aborted)return first;
                const named=selectSimpleDocumentaryCandidates(first.filter(item=>availableForReview(item)&&documentaryNamedVideo(item,nameFallback)),candidatePriority);
                if(named.length>=inspectionLimit)return first;
                return [...first,...await discover(nameFallback,[provider],signal)];
              },
            });
          };
          const fastBatches=this.intelligence?.simpleSelection?fastSources(this):undefined;
          const batches=fastBatches??(localOnly||quick?(async function*(){
            for(let i=0;i<(quick&&kind==='video'&&documentaryGeneralIllustration(scene)?3:1);i++){
              if(i>0)for(const query of takeRecoveryQueries())pool.push(...await discover(query,['pexels','pixabay']));
              yield [] as DocumentaryCandidate[];
            }
          })():discoverDocumentarySourceBatches({kind,queries,named:Boolean(requirement.identities?.length),
            takeRecoveryQueries,
            coalesceMs:kind==='video'?200:0,
            reused:reusable,
            stockQueries:kind==='video'&&this.intelligence!.rankCandidates&&(this.intelligence!.simpleSelection||!requirement.identities?.length)?documentaryStockQueries(requirement):[],
            // Preserve two precise searches for part/action/date scenes. A
            // single named establishing view may use its exact subject as the
            // second query before stale or weak captions dominate the pool.
            youtubeQueries:kind==='video'?documentaryYouTubeQueries(requirement,queries,scene.narration):[],
            discover,stopped:()=>Boolean(fatal)||this.stopRequested.has(projectId)||session.searchRemaining(scene.id,kind)-(Date.now()-waitingAt)<=0,
            firstBatchReady:this.intelligence!.simpleSelection?undefined:requiredImagePart&&this.intelligence!.rankCandidates
              ?first=>documentaryFirstImageBatchWorthInspecting(first,requiredImagePart)
              :kind==='video'&&this.intelligence!.rankCandidates
              ?first=>session.searchRemaining(scene.id,kind)-(Date.now()-waitingAt)<10_000
                ||documentaryFirstVideoBatchWorthInspecting(first,requirement,scene.narration):undefined,
            deferredBatchReady:this.intelligence!.simpleSelection?undefined:requiredImagePart&&this.intelligence!.rankCandidates
              ?batch=>documentaryFirstImageBatchWorthInspecting(batch,requiredImagePart)
              :kind==='video'&&this.intelligence!.rankCandidates
                &&requirement.identities?.length===1&&!requirement.years.length
                &&!documentaryRequiredVisiblePart(scene.narration)
              ?batch=>Date.now()-searchStarted>=8000||documentaryFirstVideoBatchWorthInspecting(batch,requirement,scene.narration):undefined,
            supplement:async()=>{
              const shared=await relatedSources(scene,kind);
              for(const source of shared.sources.filter(source=>source.error)){
                const message=`${source.provider}: ${source.error}`;if(!sourceErrors.includes(message))sourceErrors.push(message);
              }
              return shared.candidates;
            }}));
          let retryDirectStill=false;
          let waitedForNamedSource=false;
          let readyBatch:DocumentaryCandidate[]|undefined;
          // Both provider generators are lazy. Let saved candidates reach the
          // existing download/cache/inspection gates before starting discovery.
          let resumeBatch=resumedCandidates.length?resumedCandidates:undefined;
          try {
          selectionBatches: while(!accepted&&canAttempt(scene.id,kind)&&inspections<inspectionLimit&&(attemptCounts.get(inspectionKey)??0)<inspectionLimit){
          waitingAt=Date.now();
          let batch:IteratorResult<DocumentaryCandidate[]>;
          try { batch=resumeBatch?{done:false,value:resumeBatch}:readyBatch?{done:false,value:readyBatch}:await batches.next();resumeBatch=undefined;readyBatch=undefined; }
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
          const used = new Set(latestProject.scenes.filter(item => item.id !== scene.id&&item.documentary?.verified).flatMap(item => item.documentary?.selected?.kind === "image" ? [item.documentary.selected.id] : []));
          const eligible = pool.filter(candidate => !documentaryVisualRejectionKeys(candidate).some(key=>rejectedCandidates.has(key))
            &&(this.intelligence!.simpleSelection||!documentaryCandidateSubjectIssue(candidate,requirement,scene.narration))
            &&!transferFailed(candidate)
            &&(!slowStockProviders.has(candidate.provider)||candidate.localPath||(candidate.durationSeconds??Infinity)<=12)
            &&!formatUnavailable(candidate)
            &&!isUncertain(candidate)
            &&availableForReview(candidate)
            &&(this.intelligence!.simpleSelection||!documentaryContradictoryModelYear(candidate,requirement,context))
            &&(this.intelligence!.simpleSelection||!documentaryMaterialMetadataIssue(scene,candidate))
            &&(this.intelligence!.simpleSelection||!(requirement.identities?.length&&documentaryNamedMetadataIssue(candidate)))
            &&(this.intelligence!.simpleSelection?!documentaryGameplayMetadataIssue(candidate,fastPlan.visualTarget)
              :!documentaryKnownQualityIssue(candidate,latestProject,scene))
            && (candidate.kind !== "image" || !documentaryReuseIssue(latestProject, { ...scene, documentary: { ...scene.documentary!, selected: candidate, checksum: undefined, visualHash: undefined } }))
            && (this.intelligence!.simpleSelection||!documentaryVarietyIssue(latestProject, { ...scene, documentary: { ...scene.documentary!, selected: candidate, checksum: undefined, visualHash: undefined, visualReview: undefined } })));
          const candidates = this.intelligence!.simpleSelection?selectSimpleDocumentaryCandidates(eligible,candidatePriority)
            :selectDocumentaryCandidates(eligible,searchSubjects,used,requirement.years,Boolean(this.intelligence!.rankCandidates),
              kind==='image'&&documentaryGeneralDiagramScope(context,requirement.identities)?sourceQueries:requirement.queries,requirement)
              .sort((a,b)=>Number(slowStockProviders.has(a.provider))-Number(slowStockProviders.has(b.provider)));
          if(candidates.length)attemptState.found=true;
          const feedbackProbe=kind==='video'&&scene.documentary?.searchRecovery?.queries.length
            ?documentaryThematicStockProbe(candidates,requirement,scene.documentary.searchRecovery.queries,
              scene.documentary.searchRecovery.scriptEvidence?.checks.filter(check=>check.kind==='object').map(check=>check.required)):undefined;
          const shortProbe=!this.intelligence!.simpleSelection&&kind==='video'&&failedTransfers.size&&!semanticRecovery
            ?documentaryThematicStockProbe(candidates.filter(candidate=>(candidate.durationSeconds??Infinity)<=12
              &&!slowStockProviders.has(candidate.provider)),requirement):undefined;
          const responsiveCandidates=candidates.filter(candidate=>!slowStockProviders.has(candidate.provider));
          const quickPool=responsiveCandidates.length?responsiveCandidates:candidates;
          const ordinaryFirst=!semanticRecovery&&documentaryGeneralIllustration(scene)
            ?documentaryMetadataShortlist(scene,quickPool)[0]:undefined;
          const earlyCandidates = quick ? [feedbackProbe??ordinaryFirst??shortProbe??documentaryMetadataShortlist(scene, quickPool)[0]
            ??(kind==='video'?documentaryThematicStockProbe(quickPool,requirement):undefined)]
            .filter((candidate):candidate is DocumentaryCandidate=>Boolean(candidate)) : [];
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
          if (!this.intelligence!.simpleSelection && localOnly && this.intelligence!.rankLocalCandidates) {
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
          const directStill=!this.intelligence!.simpleSelection&&!quick&&!localOnly&&kind==='image'&&this.intelligence!.rankCandidates
            ?documentaryExactNamedStillProbe(localOrder,requirement,scene.narration):undefined;
          const fastThematic=!quick&&!localOnly&&!semanticRecovery?documentaryFastThematicCandidates(scene,localOrder):[];
          const discovery=this.intelligence!.simpleSelection?documentaryPlannedDiscoveryRequirement(requirement,currentDocumentaryAiSearchPlan(latestProject,scene)):requirement;
          const namedShortlist=!quick&&!localOnly?documentaryNamedMetadataShortlist(localOrder,discovery,scene.narration):[];
          retryDirectStill=Boolean(directStill);
          let attempts = this.intelligence!.simpleSelection?preferUnusedDocumentaryCandidates(latestProject,scene,
            selectSimpleDocumentaryCandidates([...namedShortlist,...localOrder],candidatePriority)):(namedShortlist.length?documentaryCandidateAttempts(localOrder,searchSubjects,namedShortlist):directStill?[directStill]:quick ? earlyCandidates : fastThematic.length?fastThematic:documentaryCandidateAttempts(localOrder, searchSubjects))
            .filter(candidate=>!documentaryThematicMetadataIssue(requirement,candidate,project.videoBrief?.readyScript??''))
            .sort((a,b)=>Number(slowStockProviders.has(a.provider))-Number(slowStockProviders.has(b.provider)));
          if(!quick&&!localOnly&&shortProbe&&!attempts.includes(shortProbe))attempts.unshift(shortProbe);
          // A local source's old exact-metadata flag belongs to its ORIGINAL
          // search. Screen its relevance to this scene before analysing more
          // ranges of a long, already-downloaded but unrelated source.
          const requiredVideoPart=kind==='video'?(requirement.aiSearchPlan?documentaryRequiredVisiblePart(fastPlan.visualTarget)
            :documentaryGeneralDiagramScope(context,requirement.identities)?documentaryRequiredVisiblePart(scene.narration):undefined):undefined;
          if (!this.intelligence!.simpleSelection && !quick && !directStill && !namedShortlist.length && !fastThematic.length && this.intelligence!.rankCandidates && localOrder.length && (semanticRecovery || localOnly || !hasExactDocumentaryVideoCandidate(localOrder, requirement, requiredVideoPart))) {
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
            if (!attempts.length) await changeScene(scene.id, current => ({ ...current, documentary: { ...current.documentary!,
              autoError:sourceErrors.some(documentarySearchUnavailable)&&!attemptState.found
                ?"Поиск ограничен источниками; полный набор кандидатов ещё не проверен. Продолжите подбор после восстановления доступа."
                :"В найденных источниках не подтверждается нужный предмет; продолжаю поиск другого вида материала." } }));
          }
          if(!this.intelligence!.simpleSelection&&!quick&&!localOnly&&kind==='video'){
            const short=documentaryExactNamedShortVideoProbe(localOrder,requirement,scene.narration);
            if(short&&!attempts.some(candidate=>candidate.kind==='video'&&(candidate.durationSeconds??Infinity)<=120)
              &&!attempts.some(candidate=>documentaryCandidateKey(candidate)===documentaryCandidateKey(short))){
              attempts=[short,...attempts].slice(0,6);
              recordDiagnosticEvent('info','documentary.ranking.exact-short-probe',{projectId,sceneId:scene.id,provider:short.provider,durationSeconds:short.durationSeconds});
            }
          }
          for (const candidate of attempts) {
              if (fatal || this.stopRequested.has(projectId)) return;
              if(!this.intelligence!.simpleSelection&&documentaryCandidateSubjectIssue(candidate,requirement,scene.narration))continue;
              // Source searches continue during download/review. Rebuild the
              // eligible pool before spending the next attempt, including the
              // first attempt when another source was already cached.
              let ready=fastBatches?.takeReady();
              // Hold only the final generic attempt for an already-running
              // named-source search. Its original timeout and budget still apply.
              if(fastBatches&&!ready?.length&&!waitedForNamedSource&&!namedShortlist.length
                &&(attemptCounts.get(inspectionKey)??0)>=inspectionLimit-1
                &&(fastPlan.namedSubject||requirement.identities?.some(id=>/\p{Lu}[\p{L}\d-]+\s+[\p{Lu}\d]/u.test(id.name)))){
                waitedForNamedSource=true;
                const started=Date.now();
                await fastBatches.waitFor(kind==='video'?'youtube':'commons');
                session.accountSearch(scene.id,kind,Date.now()-started);
                ready=fastBatches.takeReady();
              }
              if(ready?.length){readyBatch=ready;continue selectionBatches;}
              if(slowStockProviders.has(candidate.provider)&&!candidate.localPath&&(candidate.durationSeconds??Infinity)>12)continue;
              // A live scene spent successive 15-minute slots on slow originals.
              // After a timeout keep cached footage and other providers eligible,
              // then use the normal verified-photo fallback for this scene.
              if (youtubeTimedOut && candidate.provider === "youtube" && !candidate.localPath) continue;
              if (videoOnly && documentaryVideoCoverage((await this.projects.get(projectId,{omitCandidates:true}))!.scenes).percent >= project.settings.stockVideoPercent) break;
              // An already usable photo needs a quick improvement pass, not the
              // same exhaustive search as an empty scene. Keep its verified fallback.
              if (inspections >= inspectionLimit || (attemptCounts.get(inspectionKey) ?? 0) >= inspectionLimit
                || !canAttempt(scene.id,kind)) break;
              if(!session.takeAttempt(scene.id,kind))break;
              // Transfers count unless the source has no eligible format.
              // Known unavailable formats are cached below; elapsed time stays bounded.
              attemptCounts.set(inspectionKey, (attemptCounts.get(inspectionKey) ?? 0) + 1);
              tried.add(documentaryCandidateKey(candidate));
              const selectionRetry=retryFor(candidate);
              let reusedLocalCopy=false;
              this.publish({ projectId, phase: "downloading", completed, total: scenes.length, selected, skipped, failed: failures.length, currentSceneId: scene.id, message: `Кадр ${scene.order + 1}: ${candidate.localPath ? "беру сохранённый материал" : `скачиваю ${kind === "video" ? "видео" : "фото"}`} и проверяю содержимое…` });
              try { project = await this.apply(projectId, scene.id, candidate, false, bytes => {
                this.publish({ projectId, phase: "downloading", completed, total: scenes.length, selected, skipped, failed: failures.length,
                  currentSceneId: scene.id, currentSceneNumber: scene.order + 1, message: `Кадр ${scene.order + 1}: загрузка YouTube · ${Math.floor(bytes / 1024 ** 2)} МБ` });
              }, seconds => this.publish({ projectId, phase: "downloading", completed, total: scenes.length, selected, skipped, failed: failures.length,
                currentSceneId: scene.id, currentSceneNumber: scene.order + 1,
                message: `Кадр ${scene.order + 1}: источник ограничил скачивание. Продолжу автоматически через ${seconds} с; ничего нажимать не нужно.` }), Date.now()+session.remaining(scene.id,kind),
                message=>this.publish({projectId,phase:'preparing',completed,total:scenes.length,selected,skipped,failed:failures.length,currentSceneId:scene.id,currentSceneNumber:scene.order+1,message:`Кадр ${scene.order+1}: ${message}`}),false,undefined,failedTransfers,
                {retryChecksum:selectionRetry?.checksum??savedChecksums.get(retryCandidateKey(candidate)),binding:resumeBinding,onLocalReuse:reservePhoto?()=>{reusedLocalCopy=true;}:undefined}); }
              catch (error) {
                if (error instanceof DocumentaryStorageUnavailableError || (error as NodeJS.ErrnoException)?.code === "ENOSPC") throw error;
                if(error instanceof DocumentaryAnalysisError&&error.kind!=='pending')throw error;
                if(error instanceof DocumentaryAnalysisError&&error.kind==='pending'){
                  if(kind==='video')pendingVideoReview=true;
                  await rememberUncertain(candidate);
                }
                const message = error instanceof Error ? error.message : String(error);
                if(kind==='video'&&(candidate.provider==='pexels'||candidate.provider==='pixabay')&&!candidate.localPath
                  &&documentaryDownloadTimedOut(error)){
                  slowStockProviders.add(candidate.provider);
                  recordDiagnosticEvent('info','documentary.download.provider-short-only',{projectId,sceneId:scene.id,provider:candidate.provider});
                }
                if(kind==='video'&&!(error instanceof DocumentaryCandidateRejected)){
                  videoOperationalError=true;
                  session.blockPhotoFallback(scene.id);
                }
                const unavailableFormat=candidate.provider==='youtube'&&!candidate.localPath
                  &&(error instanceof DocumentaryYouTubeFormatUnavailableError||/Requested format is not available/i.test(message));
                if(unavailableFormat){
                  const key=rejectedCandidateFingerprint(candidate);
                  unavailableFormats.add(key);
                  session.rememberUnavailableFormat(formatScope,key);
                  await saveDocumentaryRejections(formatPath,formatScope,unavailableFormats).catch(()=>{
                    recordDiagnosticEvent('warn','documentary.search.format-cache-write-failed',{projectId,sceneId:scene.id});
                  });
                  recordDiagnosticEvent('info','documentary.download.format-unavailable',{projectId,sceneId:scene.id,provider:candidate.provider});
                }
                const skippedTransfer=unavailableFormat||error instanceof DocumentaryMediaCooldownError;
                if(skippedTransfer)session.reuseAttempt(scene.id,kind);
                // An actual 429 still uses a transfer attempt. The reserved
                // photo slot belongs to a prepared source, not the failed GET.
                if(skippedTransfer||reservePhoto&&error instanceof DocumentaryMediaRateLimitError){
                  attemptCounts.set(inspectionKey,Math.max(0,(attemptCounts.get(inspectionKey)??0)-1));
                }
                if (candidate.provider === "youtube" && documentaryDownloadTimedOut(error)) {
                  youtubeTimedOut = true;
                  // Query repair and video-coverage passes share this session.
                  // A failed connection must not consume another 45s slot on
                  // every pass. A later user run may resume the saved partial.
                  session.rememberDownloadTimeout(scene.id,'youtube');
                }
                primaryPhotoRejection = undefined;
                await changeScene(scene.id, current => ({ ...current, documentary: { ...current.documentary!, autoError: message } }));
                this.publish({ projectId, phase: "applying", completed, total: scenes.length, selected, skipped, failed: failures.length, currentSceneId: scene.id, message: `Кандидат не загружен: ${candidate.title.slice(0, 90)}. ${message.replace(/https?:\/\/\S+/g, "[адрес источника]")}` });
                continue;
              }
              let current = project.scenes.find(item => item.id === scene.id)!;
              if(selectionRetry?current.documentary?.checksum!==selectionRetry.checksum
                :current.documentary?.checksum&&uncertainCandidates.has(uncertainFileFingerprint(current.documentary.checksum)))continue;
              if(current.documentary?.checksum&&refusedFiles.has(current.documentary.checksum)){
                // Another library/provider alias is not a new candidate view.
                // Keep the source/ranges on disk, prefer other files this run.
                session.reuseAttempt(scene.id,kind);
                attemptCounts.set(inspectionKey,Math.max(0,(attemptCounts.get(inspectionKey)??0)-1));
                continue;
              }
              if(current.documentary?.selected&&documentaryVisualRejectionKeys(current.documentary.selected,current.documentary.checksum).some(key=>rejectedCandidates.has(key))){
                recordDiagnosticEvent('info','documentary.selection.rejected-file-cache',{projectId,sceneId:scene.id});
                continue;
              }
              // Judge a narrow photo at the size it will actually occupy in the
              // automatic portrait composition, before paying for visual review.
              const portraitTemplate=documentaryAutoPortraitTemplate(current,current.documentary?.selected,project.aspectRatio);
              if(portraitTemplate)current={...current,documentary:{...current.documentary!,template:portraitTemplate,templateOrigin:'automatic'}};
              const qualityIssue=this.intelligence!.simpleSelection?undefined:documentarySourceQualityIssue(current.documentary?.selected,project.aspectRatio,documentaryQualityPresentation(current));
              if(qualityIssue){await changeScene(scene.id,latest=>({...latest,documentary:{...latest.documentary!,autoError:qualityIssue}}));continue;}
              if(options.force&&current.documentary?.checksum===scene.documentary?.checksum){
                await changeScene(scene.id,latest=>({...latest,documentary:{...latest.documentary!,autoError:'Для замены нужен другой материал; прежний оригинал сохранён.'}}));continue;
              }
              // A different URL/provider can still resolve to the old source.
              // Check its immutable bytes before any paid preparation or review.
              const protectedChecksums=recoveredContext.scenes[scene.id]?.checksums??[];
              if(current.documentary?.checksum&&(protectedChecksums.includes(current.documentary.checksum)
                ||current.documentary.selected?.excerpt?.sourceChecksum&&protectedChecksums.includes(current.documentary.selected.excerpt.sourceChecksum))){
                await changeScene(scene.id,latest=>({...latest,documentary:{...latest.documentary!,autoError:'Поисковой план восстановлен. Ранее проверявшийся источник сохранён; повторный анализ с неизвестным результатом не отправляется.'}}));
                continue;
              }
              // The illustration image request and its approval bind text and
              // immutable pixels, not voice duration. Commit merges the latest
              // scene, and the all-voices barrier below still precedes montage.
              // Video ranges and legacy timing-bound reviews must wait for TTS.
              const imageReviewWithoutVoice=kind==='image'&&this.intelligence!.simpleSelection&&Boolean(this.intelligence!.inspectForSelection);
              if (waitForNarration&&!imageReviewWithoutVoice) {
                try {
                  if(!selectionRetry)await this.intelligence!.prepareSource?.(project, current, message => this.publish({ projectId, phase: "preparing", completed, total: scenes.length, selected, skipped, failed: failures.length, currentSceneId: scene.id, message }), () => Boolean(fatal) || this.stopRequested.has(projectId));
                } catch (error) {
                  if (!(error instanceof DocumentaryAnalysisError) || error.kind !== "pending") throw error;
                  if(kind==='video'){pendingVideoReview=true;session.blockPhotoFallback(scene.id);}
                  blockedCatalogs.add(documentaryCandidateKey(candidate));
                  await rememberUncertain(candidate,current.documentary?.checksum);
                  await changeScene(scene.id, latest => ({ ...latest, documentary: { ...latest.documentary!, autoError: error.message } }));
                  continue;
                }
                const narrationWaitStarted = Date.now();
                try { await waitForNarration(scene.id); }
                finally { session.extend(scene.id,kind,Date.now()-narrationWaitStarted); }
                if (this.stopRequested.has(projectId)) return;
                const voiced = (await this.projects.get(projectId,{omitCandidates:true}))!.scenes.find(item => item.id === scene.id)!;
                current = { ...current, audioPath: voiced.audioPath, narrationSlice: voiced.narrationSlice,
                  documentary: { ...current.documentary!, timing: voiced.documentary?.timing } };
              }
              // Allocate/review the same immutable source sequentially so the
              // next scene sees its committed range before paying for frames.
              // Downloads and reviews of unrelated sources remain parallel.
              const reviewSource=current.documentary?.selected?.excerpt?.sourceChecksum||current.documentary?.checksum||documentaryCandidateKey(candidate);
              const releaseReview=this.intelligence!.simpleSelection?await this.reserveSource(`review:${projectId}:${reviewSource}`):()=>{};
              try {
              if (fatal || this.stopRequested.has(projectId)) return;
              const freshProject = (await this.projects.get(projectId,{omitCandidates:true}))!;
              if(selectionRetry){
                const latest=freshProject.scenes.find(item=>item.id===scene.id);
                if(!latest||latest.documentary?.pinned||latest.narration!==current.narration
                  ||JSON.stringify(latest.documentary?.requirement)!==JSON.stringify(current.documentary?.requirement))continue;
              }
              if(reservePhoto){
                const latest=freshProject.scenes.find(item=>item.id===scene.id);
                if(!latest||latest.documentary?.pinned||freshProject.settings.stockVideoPercent>=100
                  ||latest.narration!==scene.narration||!currentDocumentaryAiSearchPlan(freshProject,latest)
                  ||JSON.stringify(latest.documentary?.requirement)!==JSON.stringify(scene.documentary?.requirement))continue;
                current=projectPrimaryPhoto(current);
              }
              project = { ...freshProject, scenes: freshProject.scenes.map(item => item.id === current.id ? current : item) };
              const duplicatePhoto = kind === "image" && documentaryReuseIssue(project, current);
              if (duplicatePhoto) {
                if (reservePhoto) {
                  // A downloaded duplicate still costs a transfer, but it never reached review.
                  if(reusedLocalCopy)session.reuseAttempt(scene.id,kind);
                  attemptCounts.set(inspectionKey,Math.max(0,(attemptCounts.get(inspectionKey)??0)-1));
                }
                await changeScene(scene.id, latest => ({ ...latest, documentary: { ...latest.documentary!, autoError: duplicatePhoto } }));
                continue;
              }
              let inspection: Awaited<ReturnType<DocumentaryIntelligence["inspectForSelection"]>>;
              try {
                const inspectSelection=(cacheOnly=false)=>this.intelligence!.inspectForSelection!(project, current, message => this.publish({ projectId, phase: "applying", completed, total: scenes.length, selected, skipped, failed: failures.length, currentSceneId: scene.id, message: `Кадр ${scene.order + 1}: ${message}` }), () => Boolean(fatal) || this.stopRequested.has(projectId),cacheOnly);
                if(selectionRetry?.grant){
                  inspection=await documentarySelectionRetry.run({grant:selectionRetry.grant,probe:false},inspectSelection);
                }else if(selectionRetry){
                  const cached={matched:false};
                  try{inspection=await documentarySelectionRetry.run({cached},()=>inspectSelection(true));}
                  catch(error){if(error instanceof DocumentaryCachedAnalysisMissing)continue;throw error;}
                  if(!cached.matched||inspection.usedNewAnalysis||inspection.review.status!=='accepted')continue;
                }else{
                  inspection=this.intelligence!.inspectForSelection?await inspectSelection()
                    :{review:await this.intelligence!.inspect(project,current),usedNewAnalysis:true};
                }
              } catch (error) {
                if (!(error instanceof DocumentaryAnalysisError) || error.kind !== "pending") throw error;
                if(kind==='video'){pendingVideoReview=true;session.blockPhotoFallback(scene.id);}
                if (error.purpose === "video-catalog") blockedCatalogs.add(documentaryCandidateKey(candidate));
                await rememberUncertain(candidate,current.documentary?.checksum);
                primaryPhotoRejection = undefined;
                await changeScene(scene.id, latest => ({ ...latest, documentary: { ...latest.documentary!, autoError: error.message } }));
                this.publish({ projectId, phase: "applying", completed, total: scenes.length, selected, skipped, failed: failures.length, currentSceneId: scene.id,
                  message: `Кадр ${scene.order + 1}: пропускаю «${candidate.title.slice(0, 90)}». ${error.message.slice(0,250)} Проверяю другой источник без повторной оплаты этого запроса.` });
                continue;
              }
              if (inspection.usedNewAnalysis) {
                inspections++;
                inspectionCounts.set(inspectionKey, inspections);
              }else if(inspection.review.status!=='accepted'){
                session.reuseAttempt(scene.id,kind);
                attemptCounts.set(inspectionKey,Math.max(0,(attemptCounts.get(inspectionKey)??0)-1));
              }
              let { review } = inspection;
              if(review.status!=='accepted'&&review.nextSearchQueries?.length)recoveryQueries=review.nextSearchQueries;
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
              const duplicate = review.status === "accepted" && (documentaryReuseIssue(latest, prepared) || !this.intelligence!.simpleSelection && documentaryVarietyIssue(latest, prepared));
              if (duplicate) review = { ...review, status: "rejected", reason: duplicate };
              if(!this.intelligence!.simpleSelection&&review.status==='accepted'&&kind==='image'&&scene.documentary?.selectionPlan?.kind==='video'
                &&!documentaryPhotoFallbackStatus(latest,scene.id).allowed)
                review={...review,status:'rejected',reason:'Достигнут предел фото вместо видео: не более 10% запланированных видеосцен.'};
              await atomicWrite(join(this.storage.projectDirectory(projectId), "Documentary", scene.id.replace(/[^a-zA-Z0-9_-]/g, "_"), `${current.documentary!.checksum}.review.json`), JSON.stringify({ candidateId: candidate.id, motionPolicyVersion:2,review }, null, 2));
              accepted = review.status === "accepted";
              project = await changeScene(scene.id, latest => {
                if (latest.documentary?.checksum !== scene.documentary?.checksum || latest.narration !== scene.narration || latest.documentary?.pinned !== scene.documentary?.pinned) throw new Error("Кадр изменился во время визуальной проверки; кандидат сохранён отдельно");
                if(reservePhoto&&JSON.stringify(latest.documentary?.requirement)!==JSON.stringify(scene.documentary?.requirement))
                  throw new Error('План сцены изменился во время проверки фото; кандидат сохранён отдельно.');
                if (!accepted) return { ...latest, documentary: { ...latest.documentary!, autoError: review.reason,
                  searchRecovery:reservePhoto?latest.documentary!.searchRecovery:{reason:review.reason,queries:review.nextSearchQueries?.length?review.nextSearchQueries:latest.documentary!.searchRecovery?.queries??[],
                    scriptEvidence:review.scriptEvidence??latest.documentary!.searchRecovery?.scriptEvidence,
                    rejectedRanges:[...(latest.documentary!.searchRecovery?.rejectedRanges??[]),
                      ...(review.status==='rejected'&&kind==='video'&&current.documentary?.checksum&&review.trimStartSeconds!==undefined&&review.trimEndSeconds!==undefined
                        ?[{checksum:current.documentary.checksum,start:review.trimStartSeconds,end:review.trimEndSeconds,sourceId:candidate.id,
                          sourceStart:(current.documentary.selected?.excerpt?.startSeconds??0)+review.trimStartSeconds,
                          sourceEnd:(current.documentary.selected?.excerpt?.startSeconds??0)+review.trimEndSeconds}]:[])].slice(-24)},
                  candidates: latest.documentary!.candidates.map(item => item.id === candidate.id ? { ...item, concerns: [...item.concerns, review.reason] } : item) } };
                return { ...latest, imagePath: prepared.imagePath, videoPath: current.videoPath, stockSource: current.stockSource, stockAlternates: [], sourceVolume: 0,
                  trimStartSeconds: review.trimStartSeconds ?? 0, trimEndSeconds: review.trimEndSeconds,
                  documentary: { ...latest.documentary!, selected: current.documentary!.selected, checksum: current.documentary!.checksum, visualHash: current.documentary!.visualHash,
                    ...(reservePhoto?{requirement:current.documentary!.requirement}:{}),
                    ...(portraitTemplate?{template:portraitTemplate,templateOrigin:'automatic' as const}:{}),
                    ...documentaryAcceptedMaterialMetadata(project,current,review,Boolean(this.intelligence!.simpleSelection)),verified: true, visualReview: review,
                    layout:review.generalDiagram?'contain':current.documentary!.layout,
                    ...(requirement.footageFallback?{nativeFallback:undefined,
                      motionGraphic:latest.documentary?.motionGraphic?.origin==='automatic'?undefined:latest.documentary?.motionGraphic}:{}),
                    searchRecovery:undefined } };
              });
              primaryPhotoRejection = reservePhoto && inspection.review.status === 'rejected' && inspection.review.localReview
                ? review.reason : undefined;
              await this.rememberSelectedEvidence(project.scenes.find(item=>item.id===scene.id)!);
              const checks=review.scriptEvidence?.checks;
              const unprovenAction=checks?.some(check=>check.kind==='action'&&(check.match!==true||check.temporalEvidence?.changed!==true
                ||check.temporalEvidence.sameSubject!==true||!check.temporalEvidence.observations?.length));
              const matchingObjects=checks?.some(check=>check.kind==='object')&&checks.filter(check=>check.kind==='object').every(check=>check.match===true);
              const rangeLimitedFailure=kind==='video'&&(review.rangeIssue==='cut'
                ||matchingObjects&&(unprovenAction||checks?.some(check=>check.kind==='condition'&&check.match!==true)));
              if(!accepted&&!rangeLimitedFailure&&inspection.review.status==='rejected'&&documentaryCacheableVisualRejection(candidate)){
                for(const key of documentaryVisualRejectionKeys(candidate,current.documentary?.checksum))rejectedCandidates.add(key);
                await saveDocumentaryRejections(rejectionPath,rejectionScope,rejectedCandidates).catch(()=>{
                  recordDiagnosticEvent('warn','documentary.search.rejection-cache-write-failed',{projectId,sceneId:scene.id});
                });
              }
              if (accepted) { selected++; break; }
              scene={...scene,documentary:{...scene.documentary!,searchRecovery:project.scenes.find(item=>item.id===scene.id)?.documentary?.searchRecovery}};
              // A cut or missing action in a matching interval does not
              // disqualify the whole source. Try one NEW interval first,
              // charged to the same remaining download/analysis budgets.
              const tryOtherRange=rangeLimitedFailure
                &&(candidate.durationSeconds??0)>12
                &&!retriedRanges.has(candidate.id)&&canAttempt(scene.id,kind);
              if(!accepted&&current.documentary?.checksum&&!tryOtherRange)refusedFiles.add(current.documentary.checksum);
              if(tryOtherRange){
                retriedRanges.add(candidate.id);attempts.splice(attempts.indexOf(candidate)+1,0,candidate);
              }
              } finally { releaseSource(); }
              } finally { releaseReview(); }
          }
          // A concrete pixel refusal needs targeted multi-provider discovery,
          // not three more guesses from the same initial stock pool.
          if(quick&&recoveryQueries.length)break;
          }
          } finally { await batches.return(undefined); }
        }
        if (!accepted && upgradePhoto) skipped++;
        else if (!accepted) {
          // A partial rate limit still leaves one source's search space
          // unexamined. Resume once its announced window closes; persisted
          // candidate rejections and paid checkpoints prevent re-buying the
          // same failed reviews. This keeps an unattended production alive.
          const temporarilyUnavailable=sourceErrors.some(documentarySearchUnavailable);
          const message=(temporarilyUnavailable
            ?"Поисковые источники ограничили доступ; подбор этой сцены не завершён. Повторите после восстановления источников."
            :"Не найден материал с подтверждённым объектом, качеством и правами. Проверьте кандидатов или уточните запрос.")
            + (sourceErrors.length ? ` Недоступные источники: ${sourceErrors.join("; ")}` : "");
          // A failed scene has been processed, not queued. Persist the result
          // so gaps remain explainable after navigation or an app restart.
          const failedProject=await changeScene(scene.id, current => {
            const prior=current.documentary?.autoError;
            const staleQuota=prior&&/^(?:Поиск ограничен источниками|Поисковые источники ограничили доступ)/.test(prior);
            return { ...current, documentary: { ...current.documentary!,
              searchError: sourceErrors.join("\n") || undefined,
              autoError:!foundThisRun&&temporarilyUnavailable?message:prior&&!staleQuota?prior:message } };
          });
          const failedScene = failedProject.scenes.find(item => item.id === scene.id)!;
          // The photo's rejection belongs to the primary task. Its reason is
          // intentionally absent from the retained video search recovery.
          const fallbackCategory = primaryPhotoRejection && primaryPhotoRejection === failedScene.documentary?.autoError
            ? 'content-rejected' : undefined;
          failures.push(documentarySelectionFailure(failedScene, { sourceErrors, fallbackCategory }));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const providerUnavailable = exhaustedVisionProvider(error);
        const stopsRun = providerUnavailable || error instanceof DocumentaryStorageUnavailableError || (error as NodeJS.ErrnoException)?.code === "ENOSPC"
          ||!this.intelligence?.simpleSelection&&(error instanceof DocumentaryMemoryUnavailableError || error instanceof AnyModelModelUnavailableError || error instanceof DocumentaryAnalysisError && error.kind === "unavailable");
        if (stopsRun) {
          fatal ??= error;
          if (!providerUnavailable) this.downloadControllers.get(projectId)?.abort();
          this.publish({projectId,phase:'preparing',completed,total:scenes.length,selected,skipped,failed:failures.length+1,
            message:`Производство остановлено: ${message}. Дожидаюсь уже отправленных ответов и сохраняю результаты…`});
        }
        failures.push(documentarySelectionFailure(scene,{message,error,fallbackCategory:'unknown'}));
        await changeScene(scene.id, current => ({ ...current, documentary: { ...current.documentary!,
          autoError:fatal&&/abort|отмен/iu.test(message)
            ?current.documentary?.searchRecovery?.reason??'Подбор остановлен из-за общей ошибки. Готовые результаты и прежние отказы сохранены.'
            :message } }));
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
    const ordinarySelection=Boolean(this.intelligence?.simpleSelection)||scenes.every(scene=>documentaryGeneralIllustration(scene)
      &&!documentaryGeneralActionIssue(scene)&&!documentaryRequiredVisiblePart(scene.narration));
    await runDocumentarySelectionQueue(scenes,async scene=>{
      // Broad shared discovery is lazy: speculative archive queries occupied
      // the provider queue before a scene could try its precise first result.
      const budgetKind=()=>budgetKinds.get(scene.id)??scene.documentary?.selected?.kind??'video';
      const work=()=>measureDocumentaryStage('scene-selection',{projectId,sceneId:scene.id},()=>selectScene(scene));
      session.resume(scene.id);
      try {
        if(this.intelligence?.withSelectionBudget)await this.intelligence.withSelectionBudget({
          remaining:()=>session.remaining(scene.id,budgetKind()),submit:()=>session.takeAnalysis(scene.id,budgetKind()),
          extend:ms=>session.extend(scene.id,budgetKind(),ms),
        },work);else await work();
      } catch (error) { fatal ??= error; }
      finally { session.pause(scene.id); }
    },async()=>{
      const resources=await this.selectionResources(ordinarySelection);
      if(this.intelligence?.simpleSelection)resources.workers=Math.min(4,resources.workers);
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
      const nativeBeforeVoice=new Map(project.scenes.filter(scene=>inScope(scene)&&scene.documentary?.verified
        &&fastDocumentaryGraphicReady(project,scene)).map(scene=>[scene.id,JSON.stringify(scene.documentary!.motionGraphic)]));
      await waitForNarration();
      if(nativeBeforeVoice.size)project=await this.projects.mutate(projectId,current=>({scenes:current.scenes.map(scene=>{
        const doc=scene.documentary,graphic=doc?.motionGraphic;
        if(!doc||doc.pinned||doc.selected||scene.imagePath||scene.videoPath||!graphic
          ||!nativeBeforeVoice.has(scene.id)||JSON.stringify(graphic)!==nativeBeforeVoice.get(scene.id))return scene;
        return {...scene,documentary:{...doc,motionGraphic:{...graphic,durationSeconds:documentarySceneSeconds(scene)}}};
      })}),{candidateSceneIds:[]});
      if (!options.sceneIds) await this.applyPlannedEffects(projectId);
    }
    project = (await this.projects.get(projectId,{omitCandidates:true}))!;
    project = await this.projects.mutate(projectId, current => ({ scenes: planDocumentaryMontage(this.intelligence?.simpleSelection?current:{ ...current, scenes: planDocumentaryComparisons(current) }).map(scene => inScope(scene)&&!preservedMontage.has(scene.id) ? scene : current.scenes.find(item => item.id === scene.id)!) }),{candidateSceneIds:[]});
    project=await this.applyPlannedEffects(projectId,montageScope);
    await this.storage.ensureProject(project);
    if(this.intelligence?.simpleSelection)for(const scene of project.scenes.filter(scene=>inScope(scene)&&scene.includeInAssembly!==false&&!documentaryAutomaticMaterialReady(scene))){
      if(!failures.some(failure=>failure.sceneId===scene.id))failures.push({sceneId:scene.id,sceneNumber:scene.order+1,category:'unknown',
        message:scene.documentary?.manualReview?.analysis?.reason||scene.documentary?.autoError||'Материал сохранён, но автоматическая проверка не завершена.'});
    }
    for (const scene of project.scenes.filter(scene => inScope(scene) && scene.includeInAssembly !== false && scene.documentary?.layout === "compare" && !scene.documentary.comparison)) {
      if (!failures.some(failure => failure.sceneId === scene.id)) failures.push({ sceneId: scene.id, sceneNumber: scene.order + 1, category: "no-results", message: scene.documentary!.autoError || "Нужен второй материал сравнения" });
    }
    const coverage = documentaryVideoCoverage(project.scenes);
    const videoTarget = Math.max(0, Math.min(100, Math.round(project.settings.stockVideoPercent || 0)));
    const photoFallback=documentaryPhotoFallbackStatus(project);
    // The user's duration preference stays visible. Only the agreed rare
    // automatic photo fallback relaxes it; retries do not buy it back to 100%.
    if (!this.intelligence?.simpleSelection && !options.sceneIds && photoFallback.used>photoFallback.limit) {
      const photo = project.scenes.find(scene => scene.includeInAssembly !== false && scene.documentary?.selected?.kind === "image");
      failures.push({ sceneId: photo?.id ?? project.id, sceneNumber: (photo?.order ?? -1) + 1, category: "no-results",
        message: `Фото заменили ${photoFallback.used} видеосцен при пределе ${photoFallback.limit} из ${photoFallback.planned}. Доля видео ${coverage.percent}% при цели ${videoTarget}%. Нужны подходящие видео или ручная замена.` });
    }
    this.publish({ projectId, phase: failures.length ? "failed" : "complete", completed, total: scenes.length, selected, skipped, failed: failures.length,
      message: `${failures.length ? `Не подтверждены сцены: ${[...new Set(failures.map(f=>f.sceneNumber).filter(n=>n>0))].map(n=>`№${n}`).join(', ') || 'проверьте долю видео'}` : "Проверенные материалы сохранены"}. Видео: ${coverage.percent}% длительности${videoTarget >= 80 ? ` (цель ${videoTarget}%)` : ""}.` });
    return { project, total: scenes.length, selected, skipped, failed: failures.length, failures };
  }

  /** Explicit local recovery. Does not enter Intelligence, revision or ordinary
   * prepareMontage; the pending commission remains incomplete and immutable. */
  async recoverOfflinePrimaryMontage(projectId:string,source:{directory:string;binding:OfflinePrimaryRecoveryBinding},signal?:AbortSignal):Promise<Project>{
    const before=await this.projects.get(projectId);
    if(!before)throw new Error('Проект не найден');
    if((before.settings.assembly.documentary?.montage?.musicPolicy??'preserve')!=='preserve')
      throw new Error('[no-retry] Offline primary recovery preserves existing local music only.');
    const recovered=await recoverOfflinePrimaryPlans(before,source.directory,this.storage.projectDirectory(projectId),source.binding,signal);
    const plan=attachMotionArtwork(recovered.plan,recovered.artwork,before);
    const prepared=await prepareDocumentaryMontageMedia(before,this.storage.projectDirectory(projectId),this.materialRoot,this.library,signal,plan);
    const directions=new Map(plan.scenes.map(scene=>[scene.sceneId,scene]));
    const project=await this.projects.mutate(projectId,current=>{
      if(!isDeepStrictEqual(current,before))throw new Error('[no-retry] Project changed during offline primary recovery.');
      const scenes=current.scenes.map(scene=>scene.documentary&&directions.has(scene.id)?{...scene,documentary:{...scene.documentary,
        semanticMontage:directions.get(scene.id),semanticMontageInputHash:recovered.plan.inputHash}}:scene);
      const settings={...prepared.settings,assembly:{...prepared.settings.assembly,documentary:{...prepared.settings.assembly.documentary!,
        semanticMontageStatus:{status:'planned' as const,inputHash:recovered.plan.inputHash,message:'Смысловой монтаж восстановлен из завершённого локального ответа.'},
        motionArtworkStatus:{status:'planned' as const,inputHash:recovered.artwork.inputHash,incomplete:true,message:recovered.artwork.incomplete!}}}};
      const mounted=planDocumentaryMontage({...current,settings,scenes}),application=motionArtworkApplication({...current,scenes:mounted},recovered.artwork);
      if(!application.accepted||application.skipped.length||application.used!==application.accepted)
        throw new Error('[no-retry] Offline primary artwork was not applied by the ordinary montage.');
      const audio=(rows:Scene[])=>rows.map(scene=>[scene.id,scene.order,scene.narration,scene.audioPath,scene.documentary?.effects.filter(effect=>effect.kind==='audio')]);
      if(!isDeepStrictEqual(audio(mounted),audio(before.scenes))||!isDeepStrictEqual(settings.music,before.settings.music))
        throw new Error('[no-retry] Offline primary recovery must preserve narration, music and sound effects.');
      settings.assembly.documentary.offlinePrimaryRecovery={...recovered.provenance,accepted:application.accepted,attached:application.attached,used:application.used};
      return {settings,scenes:mounted};
    },{candidateSceneIds:[]});
    // Persist the applied project, not merely a plan held in memory. Existing
    // soundtrack/effects are preserved rather than recommissioned/replanned.
    await this.storage.ensureProject(project);return project;
  }

  private readonly explanationFeedbackRuns=new Map<string,{sceneId:string;feedback:string;task:Promise<Project>}>();
  private assertExplanationFeedbackEligible(project:Project):void{
    if(project.status==='generating'||project.status==='paused'||this.autoRuns.has(project.id))
      throw Error('Дождитесь завершения подбора материалов или остановите производство перед доработкой explanation.');
  }
  /** One natural-language edit to an existing explanation; no source/artwork refresh. */
  reviseExplanation(projectId:string,input:{sceneId:string;feedback:string}):Promise<Project>{
    const feedback=typeof input?.feedback==='string'?input.feedback.replace(/\s+/gu,' ').trim():'';
    const running=this.explanationFeedbackRuns.get(projectId);
    if(running)return running.sceneId===input?.sceneId&&running.feedback===feedback?running.task
      :Promise.reject(Error('Предыдущая доработка explanation ещё обрабатывается.'));
    const task=this.reviseNativeExplanation(projectId,{sceneId:input?.sceneId,feedback}).finally(()=>{
      if(this.explanationFeedbackRuns.get(projectId)?.task===task)this.explanationFeedbackRuns.delete(projectId);
    });
    this.explanationFeedbackRuns.set(projectId,{sceneId:input?.sceneId,feedback,task});return task;
  }
  private async reviseNativeExplanation(projectId:string,input:{sceneId:string;feedback:string}):Promise<Project>{
    const before=await this.projects.get(projectId,{omitCandidates:true});
    if(!before||before.mediaMode!=='stock'||!before.settings.assembly.documentary?.montage)throw Error('Stock-проект не найден.');
    this.assertExplanationFeedbackEligible(before);
    if(!this.intelligence?.reviseExplanation)throw Error('Сервис доработки explanation недоступен.');
    const root=this.storage.projectDirectory(projectId),directory=join(root,'Documentary','Montage','explanation-feedback');
    const names=await readdir(directory).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
    const operations:ExplanationFeedbackOperation[]=[];
    for(const name of names.filter(n=>n.endsWith('.json'))){
      const op=JSON.parse(await readFile(join(directory,name),'utf8')) as ExplanationFeedbackOperation;
      const {operationKey,...body}=op.request??{};
      if(op.version!==1||op.request?.projectId!==projectId||!operationKey||name!==`${operationKey}.json`||explanationFeedbackHash(body)!==operationKey)
        throw Error('Неполная запись explanation feedback; новая оплата заблокирована.');
      operations.push(op);
    }
    const unresolved=operations.filter(op=>!op.appliedAt);
    if(unresolved.length>1||unresolved.some(op=>op.request.sceneId!==input.sceneId||op.request.feedback!==input.feedback))
      throw Error('Исход предыдущей доработки explanation не установлен. Новый текст или модель не разрешают повторную отправку.');
    let operation=unresolved[0]??operations.filter(op=>op.request.sceneId===input.sceneId&&op.request.feedback===input.feedback)
      .sort((a,b)=>b.startedAt.localeCompare(a.startedAt))[0];
    const initialHash=explanationFeedbackProjectHash(before),resuming=Boolean(operation);
    if(operation&&initialHash!==operation.request.beforeHash&&initialHash!==operation.afterHash)
      throw Error('Проект изменился после explanation feedback. Ответ сохранён; устаревшая доработка не применяется.');
    if(!operation){
      const request=explanationFeedbackRequest(before,input.sceneId,input.feedback,initialHash);
      operation={version:1,request,startedAt:new Date().toISOString()};
    }
    const op=operation,path=join(directory,op.request.operationKey+'.json');
    const save=()=>atomicWrite(path,JSON.stringify(op),{durable:true,allowCopyFallback:false});
    const unchanged=(current:Project)=>{this.assertExplanationFeedbackEligible(current);if(explanationFeedbackProjectHash(current)!==initialHash)
      throw Error('Сценарий, материалы, настройки или explanation изменились. Ответ сохранён; проект не изменён.');};
    const assertCurrent=async()=>{const current=await this.projects.get(projectId,{omitCandidates:true});if(!current)throw Error('Проект не найден.');unchanged(current);};
    if(resuming){
      if(!op.analysisKey)throw Error('Сохранён start без точного Analysis key. Исход неизвестен; новая отправка заблокирована.');
      const receipt=await readFile(join(root,'Documentary','Analysis',op.analysisKey+'.json'),'utf8').then(JSON.parse,error=>{
        if(error.code==='ENOENT')throw Error('Отсутствует trustworthy Analysis receipt; новая отправка заблокирована.');throw error;
      });
      if(receipt.state!=='complete'||!receipt.result||receipt.purpose!=='semantic-montage'||op.result&&!isDeepStrictEqual(receipt.result,op.result))
        throw Error('Analysis receipt не подтверждает COMPLETE explanation feedback; повторная отправка заблокирована.');
    }else{
      await assertCurrent();await mkdir(directory,{recursive:true});await save();
    }
    const result=await this.intelligence.reviseExplanation(before,op.request,{resumeOnly:resuming,assertCurrent,
      onIdentity:async key=>{
        if(op.analysisKey&&op.analysisKey!==key)throw Error('Изменился exact Analysis key; повторная отправка заблокирована.');
        if(!op.analysisKey){await assertCurrent();op.analysisKey=key;await save();}
      },
      onDispatch:async key=>{
        if(resuming||op.dispatchAt||key!==op.analysisKey)throw Error('Единственная отправка explanation feedback уже начата или не привязана.');
        await assertCurrent();op.dispatchAt=new Date().toISOString();await save();
      }});
    await assertCurrent();
    if(op.result&&!isDeepStrictEqual(op.result,result))throw Error('COMPLETE response не соответствует сохранённому результату.');
    op.result=result;op.resultAt??=new Date().toISOString();await save();
    const explanation=validateExplanationFeedback(result,op.request,before);
    if(op.afterHash===initialHash){
      // Repository save may have succeeded before the project-file/application
      // receipt. Finish that local persistence without submitting the output.
      if(!op.appliedAt){await this.storage.ensureProject(before);op.appliedAt=new Date().toISOString();await save();}
      return before;
    }
    if(op.appliedAt||initialHash!==op.request.beforeHash)throw Error('Применённая explanation больше не соответствует проекту.');
    const scenes=before.scenes.map(scene=>scene.id===op.request.sceneId?{...scene,documentary:{...scene.documentary!,
      semanticMontage:{...scene.documentary!.semanticMontage!,explanation}}}:scene);
    const spans=documentaryExplanationSpans({...before,scenes});
    const revised=scenes.map(scene=>{
      if(!op.request.sceneIds.includes(scene.id))return scene;
      const native=spans.get(scene.id);
      if(!native||native.sequence?.id!==`explanation:${op.request.sceneId}:${op.request.sceneIds.at(-1)}`)
        throw Error('Native presentation не соответствует frozen span.');
      return {...scene,documentary:{...scene.documentary!,motionGraphic:{...scene.documentary!.motionGraphic!,explanation:native,sequenceId:native.sequence.id}}};
    });
    const afterHash=explanationFeedbackProjectHash({...before,scenes:revised});
    if(op.afterHash&&op.afterHash!==afterHash)throw Error('Сохранённый результат не совпадает с application binding.');
    op.afterHash=afterHash;await save();await assertCurrent();
    const updated=await this.projects.mutate(projectId,current=>{
      unchanged(current);
      const changed=new Map(revised.filter(s=>op.request.sceneIds.includes(s.id)).map(s=>[s.id,s.documentary!]));
      // Preserve full repository candidate records while changing only these two native fields.
      return {outputPath:undefined,lastRender:undefined,scenes:current.scenes.map(scene=>{
        const d=changed.get(scene.id);if(!d)return scene;
        return {...scene,documentary:{...scene.documentary!,semanticMontage:d.semanticMontage,motionGraphic:d.motionGraphic}};
      })};
    },{candidateSceneIds:[]});
    await this.storage.ensureProject(updated);
    op.appliedAt=new Date().toISOString();await save();return updated;
  }

  private readonly artworkFeedbackRuns=new Map<string,{feedback:string;task:Promise<Project>}>();
  /** A text edit changes only applied drawings; it never rebuilds the film's other tracks. */
  reviseArtwork(projectId:string,input:{feedback:string}):Promise<Project>{
    const feedback=typeof input?.feedback==='string'?normalizeArtworkFeedback(input.feedback):'';
    const running=this.artworkFeedbackRuns.get(projectId);
    if(running)return running.feedback===feedback?running.task:Promise.reject(Error('Предыдущее замечание ещё обрабатывается; дождитесь результата.'));
    const task=this.reviseAppliedArtwork(projectId,input).finally(()=>{if(this.artworkFeedbackRuns.get(projectId)?.task===task)this.artworkFeedbackRuns.delete(projectId);});
    this.artworkFeedbackRuns.set(projectId,{feedback,task});return task;
  }
  private async reviseAppliedArtwork(projectId:string,input:{feedback:string}):Promise<Project>{
    if(typeof input?.feedback!=='string')throw Error('Введите замечание к AI-графике.');
    const before=await this.projects.get(projectId,{omitCandidates:true});
    if(!before||before.mediaMode!=='stock'||!before.settings.assembly.documentary?.montage)throw Error('Stock-проект не найден.');
    if(!this.intelligence?.planMotionArtwork)throw Error('Сервис доработки AI-графики недоступен.');
    const root=this.storage.projectDirectory(projectId),base=appliedArtworkFeedbackRows(before),baseHash=artworkFeedbackRowsHash(base);
    const state=artworkFeedbackProjectState(before,base),protectedInput=await artworkFeedbackProtectedInput(before,base,root);
    const unchanged=(current:Project)=>{
      if(!isDeepStrictEqual(artworkFeedbackProjectState(current,base),state)||artworkFeedbackRowsHash(appliedArtworkFeedbackRows(current))!==baseHash)
        throw Error('Сценарий, материалы, настройки или применённая графика изменились. Оплаченный ответ сохранён для локального применения; новый запрос не отправлен.');
    };
    const assertCurrent=async()=>{
      const current=await this.projects.get(projectId,{omitCandidates:true});if(!current)throw Error('Проект не найден.');unchanged(current);
      if((await artworkFeedbackProtectedInput(current,base,root)).hash!==protectedInput.hash)throw Error('Исходный медиафайл изменился. Ответ сохранён; устаревшая доработка не применяется.');
    };
    try{
      const plan=await this.intelligence.planMotionArtwork(before,undefined,{feedback:{feedback:input.feedback,assertCurrent,
        onPrepared:async pointer=>{await assertCurrent();await this.projects.mutate(projectId,current=>{
          unchanged(current);return {settings:{...current.settings,assembly:{...current.settings.assembly,
            documentary:{...current.settings.assembly.documentary!,artworkFeedback:pointer}}}};
        },{candidateSceneIds:[]});}},revisionPreview:(rows,signal)=>this.artworkPhaseRenderer(before,rows,{projectDirectory:root,signal})}) as ArtworkFeedbackPlan;
      await assertCurrent();
      const updated=await this.projects.mutate(projectId,current=>{
        unchanged(current);
        const feedback={...plan.feedback};
        if(!feedback.accepted)return {settings:{...current.settings,assembly:{...current.settings.assembly,
          documentary:{...current.settings.assembly.documentary!,artworkFeedback:feedback}}}};
        const semantic={version:1 as const,inputHash:semanticMontageHash(current),model:plan.model,
          hookSeconds:current.settings.assembly.documentary!.montage!.hookSeconds??16,
          scenes:current.scenes.filter(s=>s.includeInAssembly!==false).sort((a,b)=>a.order-b.order).map(s=>s.documentary!.semanticMontage!)};
        const attached=attachMotionArtwork(semantic,plan,current),directions=new Map(attached.scenes.map(d=>[d.sceneId,d]));
        const covered=new Map<string,ArtworkFeedbackPlan['scenes'][number]>();
        const ordered=current.scenes.filter(s=>s.includeInAssembly!==false).sort((a,b)=>a.order-b.order);
        for(const row of plan.scenes){
          const first=ordered.findIndex(s=>s.id===row.sceneId),last=row.artworkSpan?ordered.findIndex(s=>s.id===row.artworkSpan!.endSceneId):first;
          ordered.slice(first,last+1).forEach(s=>covered.set(s.id,row));
        }
        const scenes=current.scenes.map(scene=>{
          const row=covered.get(scene.id),d=scene.documentary;if(!row||!d?.motionGraphic)return scene;
          return {...scene,documentary:{...d,semanticMontage:directions.get(scene.id)??d.semanticMontage,
            motionGraphic:{...d.motionGraphic,artwork:row.artwork}}};
        });
        const candidate={...current,scenes},application=motionArtworkApplication(candidate,plan);
        if(!isDeepStrictEqual(artworkFeedbackProjectState(candidate,base),state)||application.attached!==plan.scenes.length||application.used!==plan.scenes.length)
          throw Error('Доработка не сохранила остальные дорожки или не применилась целиком. Ответ сохранён; исходный монтаж оставлен.');
        feedback.status='applied';feedback.attached=application.attached;feedback.used=application.used;
        feedback.message+=` Прикреплено ${application.attached}, в монтаже ${application.used}.`;
        return {scenes,settings:{...current.settings,assembly:{...current.settings.assembly,documentary:{...current.settings.assembly.documentary!,
          artworkFeedback:feedback,activeArtworkFeedback:feedback}}}};
      },{candidateSceneIds:[]});
      await this.storage.ensureProject(updated);
      const feedback=updated.settings.assembly.documentary!.artworkFeedback!;
      await atomicWrite(join(root,'Documentary','Montage','feedback',feedback.operationKey,'application.json'),JSON.stringify({version:1,
        status:feedback.status,accepted:feedback.accepted,attached:feedback.attached,used:feedback.used,resultArtworkHash:feedback.resultArtworkHash}));
      return updated;
    }catch(error){
      const message=error instanceof Error?error.message:String(error);
      const blocked=await this.projects.mutate(projectId,current=>{
        const doc=current.settings.assembly.documentary,pointer=doc?.artworkFeedback;
        if(!pointer)return {};
        return {settings:{...current.settings,assembly:{...current.settings.assembly,documentary:{...doc!,
          artworkFeedback:{...pointer,status:'blocked',message:`Доработка AI-графики остановлена. ${message}`}}}}};
      },{candidateSceneIds:[]});
      await this.storage.ensureProject(blocked);
      throw error;
    }
  }

  async prepareRouteComparisons(projectId:string,failures:Array<{sceneId:string;category:string;message?:string}>,signal?:AbortSignal):Promise<Project>{
    const before=await this.projects.get(projectId,{omitCandidates:true});if(!before)throw Error('Проект не найден');
    const settings=before.settings.assembly.documentary;
    if(before.mediaMode!=='stock'||settings?.version!==2||settings.autoMotionGraphics!==true||settings.excludedTemplates?.includes('full'))return before;
    const planner=this.intelligence as Partial<DocumentaryIntelligence>|undefined;
    const exhausted=new Map(failures.filter(f=>['no-results','provider-temporary','content-rejected','download'].includes(f.category)).map(f=>[f.sceneId,f]));
    const replacements=new Map<string,Scene>();
    for(const scene of before.scenes){
      signal?.throwIfAborted();const doc=scene.documentary;if(!doc||scene.includeInAssembly===false)continue;
      if(doc.motionGraphic?.routeComparison){
        const restored=documentaryRouteApprovalCandidate(before,scene);
        if(restored!==scene&&await hasCompletedRouteComparison(this.storage.projectDirectory(projectId),before,scene))replacements.set(scene.id,restored);
        else{
          const issue=savedRouteComparisonIssue(before,scene);
          if(issue)replacements.set(scene.id,{...scene,documentary:{...doc,verified:false,autoError:issue}});
        }
        continue;
      }
      if(!exhausted.has(scene.id)||doc.verified||doc.pinned||doc.manualReview||!doc.autoError||!currentDocumentaryAiSearchPlan(before,scene)||!needsRouteComparison(scene)||!planner?.planRouteComparison
        ||settings.matchMode==='literal'||doc.caption.enabled||doc.texts?.length||doc.cuts?.length||doc.comparison||doc.layout!=='full'||doc.templateOrigin==='manual'||doc.motionGraphic
        ||doc.requirement.scriptRequirements?.checks.length)continue;
      try{
        const response=await planner.planRouteComparison(before,scene,signal);let comparison;
        try{comparison=validateRouteComparison(before,scene,response.raw,response.model);}
        catch(error){
          if(!(error instanceof DocumentaryRouteGeometryError)||!error.correctable||!planner.correctRouteComparison)throw error;
          const corrected=await planner.correctRouteComparison(before,scene,response.raw,error.message,signal);
          assertRouteComparisonIdentity(response.raw,corrected.raw);
          comparison=validateRouteComparison(before,scene,corrected.raw,corrected.model);
        }
        const failure=exhausted.get(scene.id)!;comparison.selectionFailure={category:failure.category,message:failure.message??doc.autoError!};
        signal?.throwIfAborted();
        const key=createHash('sha256').update(JSON.stringify(comparison)).digest('hex'),directory=join(this.storage.projectDirectory(projectId),'Documentary','RouteComparisons');
        await mkdir(directory,{recursive:true});await atomicWrite(join(directory,key+'.json'),JSON.stringify({version:1,origin:'generated-route-schematic',sceneId:scene.id,comparison},null,2));
        replacements.set(scene.id,attachRouteComparison(before,scene,comparison));
      }catch(error){
        signal?.throwIfAborted();if(['ENOSPC','EACCES','EPERM','EIO','EROFS'].includes((error as NodeJS.ErrnoException)?.code??''))throw error;
        const failure=exhausted.get(scene.id)!;
        replacements.set(scene.id,{...scene,documentary:{...doc,autoError:`Схема сравнения маршрутов не готова: ${error instanceof Error?error.message:String(error)} Исходный подбор (${failure.category}): ${failure.message??doc.autoError}`}});
      }
    }
    if(!replacements.size)return before;
    return this.projects.mutate(projectId,current=>{
      signal?.throwIfAborted();if(routeComparisonContextHash(current)!==routeComparisonContextHash(before))throw Error('Сценарий изменился во время подготовки схемы; ответ сохранён.');
      if(!isDeepStrictEqual(current.settings,before.settings))throw Error('Настройки изменены во время подготовки схемы; текущие правки и ответ сохранены.');
      return {scenes:current.scenes.map(scene=>{
        const next=replacements.get(scene.id),prior=before.scenes.find(s=>s.id===scene.id);
        if(!next||!prior)return scene;
        if(!isDeepStrictEqual(scene,prior))throw Error('Сцена изменена во время подготовки схемы; текущие правки сохранены.');
        return next;
      })};
    },{candidateSceneIds:[]});
  }

  async prepareMontage(projectId:string,signal?:AbortSignal,options:{refreshSemantic?:boolean;reviseSavedArtwork?:boolean}={}):Promise<Project>{
    const before=await this.projects.get(projectId,{omitCandidates:true});
    if(!before)throw new Error('Проект не найден');
    if(!before.settings.assembly.documentary?.montage)return before;
    signal?.throwIfAborted();
    const hash=semanticMontageHash(before);
    const cached=before.scenes.filter(s=>s.includeInAssembly!==false).every(s=>s.documentary?.semanticMontageInputHash===hash&&s.documentary.semanticMontage);
    // Feedback is editable saved artwork, not a validity stamp for later source edits.
    // Music/manual drawing changes keep the semantic stamps; new scenes, narration,
    // sources and timing must still pass through the ordinary guarded preparation.
    const acceptedFeedback=before.settings.assembly.documentary.activeArtworkFeedback??before.settings.assembly.documentary.artworkFeedback;
    const keepArtwork=acceptedFeedback?.status==='applied';
    const mounted=before.scenes.filter(s=>s.includeInAssembly!==false).every(s=>{
      const doc=s.documentary,graphic=doc?.motionGraphic;
      return !doc?.semanticMontage?.artwork||graphic&&(graphic.enabled===false||graphic.origin!=='automatic'||graphic.artwork);
    });
    if(keepArtwork&&cached&&mounted&&!options.refreshSemantic&&!options.reviseSavedArtwork)return before;
    const retained=new Map(keepArtwork?before.scenes.filter(s=>s.includeInAssembly!==false&&s.documentary?.motionGraphic?.artwork&&s.documentary.semanticMontage)
      .map(s=>[s.id,s.documentary!] as const):[]);
    const retainArtwork=(value:NonNullable<Awaited<ReturnType<DocumentaryIntelligence['planSemanticMontage']>>>)=>({...value,scenes:value.scenes.map(direction=>{
      const doc=retained.get(direction.sceneId),saved=doc?.semanticMontage;
      return saved?(doc.pinned?saved:{...direction,artwork:saved.artwork,artworkSpan:saved.artworkSpan}):direction;
    })});
    let outcome=before.settings.assembly.documentary.semanticMontageStatus;
    if(outcome?.inputHash!==hash)outcome=undefined;
    if(cached){
      const previousArtwork=before.settings.assembly.documentary.motionArtworkStatus?.message;
      // Keep a saved partial-success warning on routine assembly. Artwork's
      // separate status is appended below, exactly once, with its current value.
      let message=outcome?.status==='planned'?outcome.message:'Смысловой AI-монтаж подготовлен.';
      if(previousArtwork&&message.endsWith(` ${previousArtwork}`))message=message.slice(0,-previousArtwork.length-1);
      outcome={status:'planned',inputHash:hash,message};
    }
    let plan:Awaited<ReturnType<DocumentaryIntelligence['planSemanticMontage']>>|undefined;
    const unchanged=(current:Project)=>{
      if(semanticMontageHash(current)!==hash||!isDeepStrictEqual(current.settings.assembly.documentary?.montage,before.settings.assembly.documentary?.montage))throw new Error('Сценарий, материалы или настройки изменились во время планирования монтажа. План сохранён; повторите сборку.');
      if([...retained].some(([id,saved])=>{
        const now=current.scenes.find(s=>s.id===id)?.documentary;
        return !isDeepStrictEqual(now?.motionGraphic,saved.motionGraphic)||!isDeepStrictEqual(now?.semanticMontage?.artwork,saved.semanticMontage?.artwork)
          ||!isDeepStrictEqual(now?.semanticMontage?.artworkSpan,saved.semanticMontage?.artworkSpan);
      }))throw new Error('Применённая графика изменилась во время подготовки. Текущие правки сохранены; повторите сборку.');
    };
    const recoverCompletedBatches=async()=>{
      let saved=await readCompletedMontageBatches(before,this.storage.projectDirectory(projectId),signal);
      // Preview/excerpt conversion rebases attached stamps, not disk receipts.
      // Keep that partial decision only for the exact current input; a real
      // source edit invalidates outcome above and cannot enter this fallback.
      if(!saved&&outcome?.status==='local'&&outcome.inputHash===hash){
        const scenes=before.scenes.filter(scene=>scene.includeInAssembly!==false
          &&scene.documentary?.semanticMontageInputHash===hash&&scene.documentary.semanticMontage?.sceneId===scene.id)
          .map(scene=>scene.documentary!.semanticMontage!);
        if(scenes.length)saved={inputHash:hash,scenes};
      }
      if(!saved)return;
      const directions=new Map(saved.scenes.map(direction=>[direction.sceneId,direction]));
      signal?.throwIfAborted();
      const recovered=await this.projects.mutate(projectId,current=>{
        unchanged(current);
        const scenes=current.scenes.map(scene=>{
          const doc=scene.documentary;if(!doc||doc.pinned||scene.includeInAssembly===false)return scene;
          const direction=directions.get(scene.id),retainedDirection=retained.get(scene.id)?.semanticMontage;
          if(!direction)return retainedDirection?scene:{...scene,documentary:{...doc,semanticMontage:undefined,semanticMontageInputHash:undefined}};
          return {...scene,documentary:{...doc,semanticMontage:retainedDirection
            ?{...direction,artwork:retainedDirection.artwork,artworkSpan:retainedDirection.artworkSpan}:direction,semanticMontageInputHash:hash}};
        });
        const mounted=planDocumentaryMontage({...current,scenes}).map(scene=>retained.has(scene.id)
          ?{...scene,documentary:{...scene.documentary!,motionGraphic:retained.get(scene.id)!.motionGraphic}}:scene);
        const included=mounted.filter(scene=>scene.includeInAssembly!==false);
        const ai=included.filter(scene=>scene.documentary?.semanticMontageInputHash===hash&&scene.documentary.semanticMontage).length;
        const reason=outcome?.message.replace(/^Сохранён AI-монтаж \d+\/\d+ сцен; \d+ сцен оформлены локально\. Незавершённый запрос не повторялся\.\s*/u,'')
          .replace(/^AI-монтаж недоступен, использован локальный\.\s*/u,'');
        const partial={status:'local' as const,inputHash:hash,message:
          `Сохранён AI-монтаж ${ai}/${included.length} сцен; ${included.length-ai} сцен оформлены локально. Незавершённый запрос не повторялся.${reason?` ${reason}`:''}`};
        // Recovery edits directions only. Existing music, backgrounds, artwork
        // and source/audio files do not need another media/commission pass.
        return {scenes:mounted,settings:{...current.settings,assembly:{...current.settings.assembly,
          documentary:{...current.settings.assembly.documentary!,semanticMontageStatus:partial}}}};
      },{candidateSceneIds:[]});
      await this.storage.ensureProject(recovered);
      return recovered;
    };
    if(!cached&&outcome?.status==='local'){
      const recovered=await recoverCompletedBatches();if(recovered)return recovered;
    }
    // For an uncached source edit, explicit refresh revisits the planner, whose
    // checkpoint guard requires authorization before an unknown request replays.
    // Routine assembly retains the saved local outcome and never retries it.
    if(!cached&&(options.refreshSemantic||!(outcome?.status==='local'&&outcome.inputHash===hash))){
      try{
        if(!this.intelligence?.planSemanticMontage)throw new DocumentarySemanticMontageError('Сервис смыслового монтажа недоступен.');
        plan=await this.intelligence.planSemanticMontage(before,signal);
        validateSemanticMontagePlan(plan,before);
        outcome={status:'planned',inputHash:hash,message:plan.conceptWarning
          ?`Базовый AI-монтаж сохранён, концептуальные вставки недоступны. ${plan.conceptWarning}`
          :'Смысловой AI-монтаж подготовлен.'};
      }catch(error){
        signal?.throwIfAborted();
        if(!(error instanceof DocumentaryAnalysisError||error instanceof DocumentarySemanticMontageError||error instanceof AnyModelModelUnavailableError))throw error;
        plan=undefined;
        outcome={status:'local',inputHash:hash,message:`AI-монтаж недоступен, использован локальный. ${error.message}`};
        // Persist before media preparation: a later disk/media failure must not buy this plan again.
        await this.projects.mutate(projectId,current=>{
          unchanged(current);
          return {settings:{...current.settings,assembly:{...current.settings.assembly,documentary:{...current.settings.assembly.documentary!,semanticMontageStatus:outcome}}}};
        },{candidateSceneIds:[]});
        const recovered=await recoverCompletedBatches();if(recovered)return recovered;
      }
    }
    signal?.throwIfAborted();
    let artworkOutcome=before.settings.assembly.documentary.motionArtworkStatus;
    const artworkHash=motionArtworkHash(before);
    if(artworkOutcome?.inputHash!==artworkHash)artworkOutcome=undefined;
    let commissionedArtwork:SavedMotionArtwork|undefined;
    // A completed commission can be absent from scene directions after an old
    // attachment bug. Reattach its saved validated result locally, even when
    // all semantic stamps are current. Never submit or replay a provider job.
    if(!keepArtwork&&artworkEnabled(before)&&artworkOutcome?.status==='planned'&&(plan||cached)){
      const file=join(this.storage.projectDirectory(projectId),'Documentary','Montage',`${artworkHash}-artwork-v1.json`);
      let saved=await readFile(file,'utf8').then(JSON.parse).catch((error:NodeJS.ErrnoException)=>{
        if(error.code==='ENOENT')return undefined;throw error;
      }) as Parameters<typeof attachMotionArtwork>[1]|undefined;
      if(saved?.version===1&&saved.inputHash===artworkHash&&Array.isArray(saved.scenes)){
        // Older validation rejected separate property tracks at the same instant.
        // Revalidate only the already-paid Montage receipts; this path cannot submit a model request.
        saved=await repairSavedMotionArtworkPlan(before,this.storage.projectDirectory(projectId),signal)??saved;
        commissionedArtwork=saved;
        const base=plan??{version:1 as const,inputHash:hash,model:saved.model,
          hookSeconds:before.settings.assembly.documentary.montage.hookSeconds??16,
          scenes:before.scenes.filter(s=>s.includeInAssembly!==false).map(s=>s.documentary!.semanticMontage!)};
        plan=attachMotionArtwork(base,saved,before);
      }
    }
    // The semantic checkpoint predates the separate artwork commission. When
    // it is rehydrated, keep completed artwork for this exact source edit;
    // a planned status alone must not replace its drawing with the base plan.
    if(!keepArtwork&&plan&&artworkOutcome?.status==='planned'){
      // Recovered/revised receipt data is authoritative. The old project may
      // still hold a superseded drawing, including inside the new shared span.
      const covered=new Set<string>();
      for(const [index,direction] of plan.scenes.entries()){
        if(!direction.artwork)continue;
        const end=direction.artworkSpan?plan.scenes.findIndex(s=>s.sceneId===direction.artworkSpan!.endSceneId):index;
        for(const member of plan.scenes.slice(index,Math.max(index,end)+1))covered.add(member.sceneId);
      }
      const saved=before.scenes.flatMap(s=>{
        const d=s.documentary,direction=d?.semanticMontage;
        return !covered.has(s.id)&&d?.semanticMontageInputHash===hash&&direction?.artwork
          ?[{sceneId:s.id,artwork:direction.artwork,...(direction.artworkSpan?{artworkSpan:direction.artworkSpan}:{})}]:[];
      });
      if(saved.length)plan=attachMotionArtwork(plan,{version:1,inputHash:artworkHash,model:plan.model,scenes:saved,rejected:[]},before);
    }
    if(plan&&retained.size)plan=retainArtwork(plan);
    // Older semantic plans are deliberately reusable. Artwork is a separately
    // checkpointed, bounded design pass, including on already assembled films.
    if(artworkEnabled(before)&&(plan||cached)&&this.intelligence?.planMotionArtwork
      &&(!artworkOutcome||options.reviseSavedArtwork===true||options.refreshSemantic&&(artworkOutcome.status==='local'||artworkOutcome.incomplete))){
      try{
        const directions=new Map(plan?.scenes.map(s=>[s.sceneId,s])??[]);
        const input={...before,scenes:before.scenes.map(s=>directions.has(s.id)&&s.documentary?{...s,documentary:{...s.documentary,semanticMontage:directions.get(s.id)}}:s)};
        const artwork=await this.intelligence.planMotionArtwork(input,signal,{resumeUnavailable:options.refreshSemantic,reviseSavedArtwork:options.reviseSavedArtwork===true,
          revisionPreview:(rows,previewSignal)=>this.artworkPhaseRenderer(input,rows,{
            projectDirectory:this.storage.projectDirectory(projectId),signal:previewSignal??signal})});
        commissionedArtwork=artwork;
        const base=plan??{version:1 as const,inputHash:hash,model:artwork.model,hookSeconds:before.settings.assembly.documentary.montage.hookSeconds??16,
          scenes:before.scenes.filter(s=>s.includeInAssembly!==false).map(s=>s.documentary!.semanticMontage!)};
        plan=attachMotionArtwork(base,artwork,input);
        if(retained.size)plan=retainArtwork(plan);
        artworkOutcome={status:'planned',inputHash:artworkHash,...(artwork.incomplete?{incomplete:true}:{}),message:`AI-графика: принято ${artwork.scenes.length} · ${artwork.model}. Применение в монтаже ещё не проверено.${artwork.incomplete?` План частичный: ${artwork.incomplete}`:''}`};
      }catch(error){
        signal?.throwIfAborted();
        if(!(error instanceof DocumentaryAnalysisError||error instanceof DocumentarySemanticMontageError||error instanceof AnyModelModelUnavailableError))throw error;
        artworkOutcome={status:'local',inputHash:artworkHash,message:`AI-графика недоступна; сохранён базовый монтаж. ${error.message}`};
      }
      // A later render/media error must not cause an unknown paid request to replay.
      await this.projects.mutate(projectId,current=>{
        unchanged(current);
        const savedDirections=new Map(plan?.scenes.map(s=>[s.sceneId,s])??[]);
        return {settings:{...current.settings,assembly:{...current.settings.assembly,documentary:{...current.settings.assembly.documentary!,semanticMontageStatus:outcome,motionArtworkStatus:artworkOutcome}}},
          scenes:current.scenes.map(s=>s.documentary&&savedDirections.has(s.id)?{...s,documentary:{...s.documentary,semanticMontage:savedDirections.get(s.id),semanticMontageInputHash:hash}}:s)};
      },{candidateSceneIds:[]});
    }
    const prepared=await prepareDocumentaryMontageMedia(before,this.storage.projectDirectory(projectId),this.materialRoot,this.library,signal,plan);
    let application:ReturnType<typeof motionArtworkApplication>|undefined;
    let project=await this.projects.mutate(projectId,current=>{
      unchanged(current);
      const directions=new Map(plan?.scenes.map(s=>[s.sceneId,s])??[]);
      const scenes=current.scenes.map(scene=>!scene.documentary?scene:directions.has(scene.id)
        ?{...scene,documentary:{...scene.documentary,semanticMontage:directions.get(scene.id),semanticMontageInputHash:hash}}
        :retained.has(scene.id)?scene
        :outcome?.status==='local'||scene.documentary.semanticMontageInputHash!==hash
          ?{...scene,documentary:{...scene.documentary,semanticMontage:undefined,semanticMontageInputHash:undefined}}:scene);
      const preserveMusic=(before.settings.assembly.documentary!.montage!.musicPolicy??'preserve')==='preserve';
      if(!preserveMusic&&!isDeepStrictEqual(current.settings.music,before.settings.music))throw new Error('Настройки музыки изменились во время планирования. Подготовленные файлы сохранены; повторите сборку.');
      const settings={...current.settings,music:preserveMusic?current.settings.music:prepared.settings.music,assembly:{...current.settings.assembly,documentary:{...current.settings.assembly.documentary!,semanticMontageStatus:outcome,motionArtworkStatus:artworkOutcome,resolvedBackground:prepared.settings.assembly.documentary?.resolvedBackground,resolvedBackgrounds:prepared.settings.assembly.documentary?.resolvedBackgrounds}}};
      const mounted=planDocumentaryMontage({...current,settings,scenes}).map(scene=>{
        const saved=retained.get(scene.id),doc=scene.documentary;
        if(saved?.pinned)return {...scene,documentary:{...saved,semanticMontageInputHash:hash}};
        return saved&&doc?{...scene,documentary:{...doc,motionGraphic:saved.motionGraphic,
          semanticMontage:doc.semanticMontage?{...doc.semanticMontage,artwork:saved.semanticMontage!.artwork,artworkSpan:saved.semanticMontage!.artworkSpan}:doc.semanticMontage}}:scene;
      });
      if(artworkOutcome?.status==='planned'){
        application=motionArtworkApplication({...current,scenes:mounted},commissionedArtwork);
        const {accepted,attached,used,skipped}=application;
        const partial=commissionedArtwork?.incomplete??(artworkOutcome.incomplete
          ?artworkOutcome.message.match(/План частичный: ([\s\S]*)$/u)?.[1]??'сохранена доступная часть плана.':undefined);
        artworkOutcome={...artworkOutcome,message:`AI-графика: ${accepted===undefined?'':`принято ${accepted}, `}прикреплено ${attached}, в монтаже ${used}${commissionedArtwork?` · ${commissionedArtwork.model}`:''}.`
          +(skipped.length?` Не применены: ${skipped.slice(0,3).map(row=>row.scene?`сцена ${row.scene}`:row.sceneId).join(', ')}${skipped.length>3?`; ещё ${skipped.length-3}`:''}; ответы сохранены.`:'')
          +(commissionedArtwork?.rejected.length?` Отклонено при проверке: ${commissionedArtwork.rejected.length}.`:'')
          +(partial?` План частичный: ${partial}`:'')};
      }
      settings.assembly.documentary.motionArtworkStatus=artworkOutcome;
      settings.assembly.documentary.semanticMontageStatus=outcome&&artworkOutcome?{...outcome,message:`${outcome.message} ${artworkOutcome.message}`}:outcome;
      return {settings,scenes:mounted};
    },{candidateSceneIds:[]});
    if(application)recordDiagnosticEvent(application.skipped.length?'warn':'info','documentary.artwork.application',{
      projectId,inputHash:artworkHash,model:commissionedArtwork?.model,...application});
    project=await this.applyPlannedEffects(projectId);
    await this.storage.ensureProject(project);return project;
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
      if(!current.scenes.length||current.scenes.some(s=>s.includeInAssembly!==false&&!documentaryMaterialUsable(s)))throw new Error('Сначала подтвердите материалы всех включённых сцен');
      return {scenes:planDocumentaryMontage({...current,scenes:planDocumentaryComparisons(current)},false,true),status:'ready',outputPath:undefined,lastRender:undefined};
    });
    await this.storage.ensureProject(project);
    return project.settings.assembly.documentary?.montage?this.prepareMontage(projectId,undefined,{refreshSemantic:true}):this.applyPlannedEffects(projectId);
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
        return inScope(scene)&&planned?.documentary && scene.documentary && isDeepStrictEqual(scene.documentary.effects,project.scenes.find(s=>s.id===scene.id)?.documentary?.effects) ? { ...scene, transition: planned.transition,
          autoTransition:planned.autoTransition,autoTransitionDurationSeconds:planned.autoTransitionDurationSeconds,
          documentary: { ...scene.documentary, effects: planned.documentary.effects, caption: scene.documentary.caption.enabled ? scene.documentary.caption : planned.documentary.caption } } : scene;
      }) }),{candidateSceneIds:[]});
      await this.storage.ensureProject(project);
    }
    return project;
  }

  private async apply(projectId: string, sceneId: string, candidate: DocumentaryCandidate, commit = true, onDownloadProgress?: (bytes: number) => void, onDownloadWait?: (seconds: number) => void, downloadDeadline?: number,onPreview?:(message:string)=>void,manualStage=false,fallback?:{signal?:AbortSignal;thematicProjection?:{scene:Scene;binding:string}},failedTransfers?:DocumentaryTransferFailures,selection?:{retryChecksum?:string;binding?:string;onLocalReuse?:()=>void}): Promise<Project> {
    const key = `${projectId}:${sceneId}`;
    if (this.active.has(key)) throw new Error("Для этого кадра уже скачивается материал");
    this.active.add(key);
    let temporary = "";
    let releaseDownload: (() => void) | undefined;
    let remoteTransferStartedAt:number|undefined;
    try {
      // The lock precedes the cache lookup and actual download. Parallel scenes
      // wait for one registered original, while unrelated sources stay parallel.
      releaseDownload = await this.reserveSource(`download:${candidate.kind}:${candidate.provider}:${candidate.id || candidate.downloadUrl}`);
      const signal = fallback?.signal??(commit||manualStage ? undefined : this.downloadControllers.get(projectId)?.signal);
      signal?.throwIfAborted();
      const saved = await this.editable(projectId, sceneId, Boolean(fallback)||!commit && this.narrationWaits.has(projectId), !commit);
      const projection=fallback?.thematicProjection;
      if(projection&&(commit||manualStage||projection.scene.id!==sceneId
        ||!documentaryVideoQuotaCurrent(saved.project,saved.scene,projection.binding)
        ||!documentaryThematicDiscoveryRequirement(saved.project,projection.scene)
        ||documentaryThematicRecoveryBinding(saved.project,saved.scene)!==projection.scene.documentary!.requirement.footageFallback!.automaticRecovery!.binding))
        throw Error('Сцена изменилась до подготовки тематического видео.');
      const scene=projection?.scene??saved.scene;
      const project=projection?{...saved.project,scenes:saved.project.scenes.map(item=>item.id===sceneId?scene:item)}:saved.project;
      const requireHd = !commit && documentaryQualityPresentation(scene) !== 'subject-card';
      // Staged inspections need selected sources/timing, not all historical
      // search results. Never persist this light view as the recovery manifest.
      if(commit)await this.storage.ensureProject(project);
      const root = join(this.storage.projectDirectory(projectId), "Documentary", sceneId.replace(/[^a-zA-Z0-9_-]/g, "_"));
      await mkdir(root, { recursive: true });
      await ensureDocumentarySpace(root);
      temporary = join(root, `${randomUUID()}.download`);
      const legacyMotionRefusals=await documentaryLegacyMotionRefusals(this.storage.projectDirectory(projectId),scene);
      const rejectedRanges=scene.documentary?.searchRecovery?.rejectedRanges.filter(range=>range.sourceId===candidate.id&&!legacyMotionRefusals.has(range.checksum))??[];
      const occupied=candidate.kind==='video'&&!commit&&!manualStage?usedDocumentaryRanges(project,{...scene,
        documentary:{...scene.documentary!,selected:{...candidate,excerpt:undefined},checksum:undefined}}):[];
      const availableRange=(start:number,end:number)=>!rejectedRanges.some(range=>range.sourceStart!==undefined&&range.sourceEnd!==undefined&&start<range.sourceEnd&&end>range.sourceStart)
        &&!occupied.some(range=>start<range.end&&end>range.start);
      const canReuseSource=(source:DocumentaryCandidate)=>!source.excerpt||availableRange(source.excerpt.startSeconds,source.excerpt.endSeconds);
      const previousSource = !candidate.localPath && candidate.downloadUrl ? project.scenes.map(scene => scene.documentary?.selected).find(source => source?.downloadUrl === candidate.downloadUrl && source.kind === candidate.kind && source.localPath && documentaryCachedRangeMatches(source,candidate)&&canReuseSource(source)) : undefined;
      const desiredSeconds=documentaryRequiredSourceSeconds(scene);
      const catalogSource = !candidate.localPath && !previousSource ? await this.cachedSource(candidate,commit||manualStage?undefined:desiredSeconds,canReuseSource) : undefined;
      const existingCopy = candidate.localPath || previousSource?.localPath || catalogSource?.localPath;
      const catalogOriginal = existingCopy && !candidate.id.startsWith("manual:") && /^[a-f0-9]{64}\.[a-z0-9]+$/i.test(basename(existingCopy)) ? join(this.materialRoot, "Files", basename(existingCopy)) : undefined;
      const localSources = join(this.storage.projectDirectory(projectId), "Documentary", "Sources");
      const projectOriginal = existingCopy && /^[a-f0-9]{64}\.[a-z0-9]+$/i.test(basename(existingCopy)) ? join(localSources, basename(existingCopy)) : undefined;
      let localCopy: string | undefined;
      for (const copy of [candidate.localPath, projectOriginal, previousSource?.localPath, catalogOriginal, existingCopy]) {
        if (copy && await stat(copy).then(info => info.isFile(), () => false)) { localCopy = copy; break; }
      }
      if(selection?.retryChecksum&&(!localCopy||await checksumFile(localCopy)!==selection.retryChecksum))
        throw new DocumentaryCandidateRejected('Локальный оригинал разрешённой проверки изменился или недоступен.');
      let sourceRange:{start:number;end:number}|undefined;
      let previewStart:number|undefined;
      const simpleRemoteVideo=this.intelligence?.simpleSelection&&!commit&&!manualStage&&!localCopy&&!candidate.excerpt&&desiredSeconds<=11&&candidate.kind==='video'
        &&candidate.provider!=='pexels'&&candidate.provider!=='pixabay';
      const simpleRangeSeconds=Math.min(12,desiredSeconds+1);
      const sourceDuration=candidate.durationSeconds??0;
      // A paid scene-specific preview already on disk can point past an intro.
      // Read that exact receipt only: this shortcut never downloads samples or
      // submits a new model request, and unknown old receipts retain their guard.
      if(simpleRemoteVideo&&this.intelligence?.cachedPreviewForScene){
        const savedPreview=await readDocumentaryPreview(join(this.materialRoot,'Previews',documentaryPreviewKey(candidate)));
        if(savedPreview){
          const match=await this.intelligence.cachedPreviewForScene(project,scene,candidate,savedPreview);
          if(match?.rejected||match&&match.selectedIndex<0)throw new DocumentaryCandidateRejected(match.reason);
          if(match){
            const range=documentaryPreviewDownloadRange(savedPreview,match.selectedIndex,candidate.durationSeconds!,desiredSeconds);
            if(range&&availableRange(range.start,range.end)){sourceRange=range;previewStart=Math.max(0,savedPreview.segments[match.selectedIndex]!.start-range.start);}
          }
        }
      }
      if(simpleRemoteVideo&&!sourceRange&&sourceDuration>simpleRangeSeconds){
        let start=0;
        if(candidate.provider==='youtube'||candidate.provider==='commons'||candidate.provider==='internet-archive'){
          // These providers support absolute range downloads. Even short
          // named videos can open with a location or title card.
          // Propose an untried interval, bounded by the actual source length;
          // only the later frame review can approve its contents.
          const [opening,middle,late]=documentaryPreviewRanges(sourceDuration);
          const starts=[...new Set([middle,late,opening,{start:0},...occupied.map(range=>({start:range.end+.25}))].flatMap(range=>range
            ?[Math.max(0,Math.min(range.start,sourceDuration-simpleRangeSeconds))]:[]))];
          const next=starts.find(start=>availableRange(start,start+simpleRangeSeconds));
          if(next===undefined)throw new DocumentaryCandidateRejected('Проверенные участки этого видео уже отклонены.');
          start=next;
        }
        sourceRange={start,end:start+simpleRangeSeconds};
      }
      // For a short clip, three independently sought previews plus their paid
      // classification can cost more than downloading the original once.
      // Actual-frame, quality and identity checks still run on that original.
      const ordinaryShortStock=candidate.kind==='video'&&(candidate.provider==='pexels'||candidate.provider==='pixabay')
        &&(candidate.durationSeconds??Infinity)>30&&(candidate.durationSeconds??Infinity)<=120
        &&desiredSeconds<=(candidate.durationSeconds??0)-.2
        &&documentaryGeneralIllustration(scene)&&!documentaryGeneralActionIssue(scene)
        &&!documentaryRequiredVisiblePart(scene.narration);
      // Keep an already prepared preview on its old path: its paid checkpoint
      // may be complete, rejected or unknown. Only new short-stock discovery
      // goes straight to the final three-frame check of the spoken interval.
      const existingPreview=ordinaryShortStock&&await stat(join(this.materialRoot,'Previews',documentaryPreviewKey(candidate),'preview.json'))
        .then(()=>true,error=>(error as NodeJS.ErrnoException).code!=='ENOENT');
      const shortOriginal = candidate.kind==='video' && ((candidate.provider==='pexels'||candidate.provider==='pixabay')
        && (candidate.durationSeconds??Infinity)<=30 || candidate.provider==='youtube' && (candidate.durationSeconds??Infinity)<=90
        ||ordinaryShortStock&&!existingPreview);
      if(ordinaryShortStock&&!existingPreview)recordDiagnosticEvent('info','documentary.preview.short-stock-direct',{projectId,sceneId,provider:candidate.provider,durationSeconds:candidate.durationSeconds});
      if(!this.intelligence?.simpleSelection&&!localCopy&&!commit&&!manualStage&&candidate.kind==='video'&&(candidate.durationSeconds??0)>=12&&!shortOriginal&&this.intelligence?.inspectPreview
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
            try {
            // The immutable preview is already shared. Paid scene matching must
            // not hold the media-transfer lock for other scenes.
            releaseDownload?.();releaseDownload=undefined;
            onPreview?.('Проверяю пробные участки: реальное видео, игра или посторонний экран…');
            const scenePreview=candidate.provider==='youtube'&&(candidate.durationSeconds??0)>90
              &&Boolean(scene.documentary?.requirement.identities?.length||scene.documentary?.requirement.years.length);
            const combined=scenePreview&&this.intelligence.inspectCombinedPreview
              ?await this.intelligence.inspectCombinedPreview(project,scene,candidate,preview):undefined;
            const screening=combined??await this.intelligence.inspectPreview(projectId,documentaryPreviewKey(candidate),preview);
            recordDiagnosticEvent('info','documentary.preview.checked',{projectId,sceneId,provider:candidate.provider,rejected:screening.rejected,bytes:preview.bytes,downloadedBytes:preview.downloadedBytes});
            if(screening.rejected)throw new DocumentaryCandidateRejected(screening.reason);
            if(!commit&&scenePreview
              &&(scene.documentary?.requirement.identities?.length||scene.documentary?.requirement.years.length)
              &&this.intelligence.inspectPreviewForScene){
              onPreview?.('Сверяю пробные кадры с этой сценой до загрузки выбранного диапазона…');
              const match=combined??await this.intelligence.inspectPreviewForScene(project,scene,candidate,preview);
              recordDiagnosticEvent('info','documentary.preview.scene-checked',{projectId,sceneId,provider:candidate.provider,
                selectedIndex:match.selectedIndex,sourceDurationSeconds:candidate.durationSeconds});
              if(match.selectedIndex<0)throw new DocumentaryCandidateRejected(`В пробных кадрах длинного источника не подтверждён нужный предмет; проверяю другой источник. ${match.reason}`);
              const sceneDuration=Math.max(scene.durationOverrideSeconds??0,(scene.documentary?.timing?.durationInFrames??scene.durationSeconds*30)/30);
              sourceRange=documentaryPreviewDownloadRange(preview,match.selectedIndex,candidate.durationSeconds!,sceneDuration);
              if(sourceRange)previewStart=Math.max(0,preview.segments[match.selectedIndex]!.start-sourceRange.start);
            }
            } catch(error){
              if(!(error instanceof DocumentaryLegacyPreviewUnattributed))throw error;
              recordDiagnosticEvent('warn','documentary.preview.legacy-original-fallback',{projectId,sceneId,provider:candidate.provider,historyIncomplete:error.historyIncomplete});
              onPreview?.('Прежняя preview-проверка не привязана к источнику; проверяю оригинал в оставшемся бюджете.');
            }
          }
        }
      }
      if(!releaseDownload){
        releaseDownload=await this.reserveSource(`download:${candidate.kind}:${candidate.provider}:${candidate.id||candidate.downloadUrl}`);
        signal?.throwIfAborted();
        const cached=await this.cachedSource(sourceRange?{...candidate,excerpt:{sourceChecksum:createHash('sha256').update(candidate.id).digest('hex'),startSeconds:sourceRange.start,endSeconds:sourceRange.end,sourceDurationSeconds:candidate.durationSeconds!}}:candidate,undefined,canReuseSource);
        if(cached?.localPath)localCopy=cached.localPath;
      }
      // A sibling may have timed out while this scene waited for the source
      // lock. Prefer any completed local copy, otherwise recheck its failure.
      const transferKey=failedTransfers&&!localCopy?documentaryTransferFingerprint(candidate):undefined;
      const deferredTransfer=()=>new DocumentaryCandidateRejected('Этот оригинал уже достиг лимита загрузки в текущем подборе; проверяю другой источник.');
      if(transferKey&&failedTransfers!.has(transferKey))throw deferredTransfer();
      const beginStockTransfer=()=>{
        if(remoteTransferStartedAt!==undefined)return;
        if(transferKey&&!failedTransfers!.takeAttempt(transferKey))throw deferredTransfer();
        remoteTransferStartedAt=Date.now();
      };
      let extension = extname(localCopy || new URL(candidate.downloadUrl).pathname).toLowerCase();
      if (!/^\.(?:jpe?g|png|webp|tiff?|mp4|mov|webm|mkv|wmv|ogv|avi)$/.test(extension)) extension = candidate.kind === "video" ? ".mp4" : ".jpg";
      if (localCopy) {
        const info = await stat(localCopy);
        if (!info.isFile() || info.size > 750 * 1024 * 1024) throw new Error("Выберите медиафайл не больше 750 МБ");
        const immutable = [join(this.materialRoot, "Files"), localSources, previousSource?.localPath && dirname(previousSource.localPath)].filter(Boolean)
          .some(directory => resolve(directory!).toLowerCase() === resolve(dirname(localCopy)).toLowerCase()) && /^[a-f0-9]{64}\.[a-z0-9]+$/i.test(basename(localCopy));
        if (immutable) await copyImmutableDocumentaryFile(localCopy, temporary);
        else { await ensureDocumentarySpace(root, info.size); await copyFile(localCopy, temporary); }
        selection?.onLocalReuse?.();
      } else await withDocumentaryDownloadBudget({ automatic: !commit && (!manualStage || Boolean(fallback)), kind: candidate.kind, deadline: downloadDeadline,
        // Start the short transfer timer only after the source lock/cache lookup.
        // Waiting still consumes the absolute scene deadline passed by selection.
        transferMs:this.intelligence?.simpleSelection?(candidate.kind==='video'?(candidate.provider==='youtube'?35_000:20_000):12_000):undefined,
        progressAware:Boolean(this.intelligence?.simpleSelection&&candidate.kind==='video'
          &&(candidate.provider==='pexels'||candidate.provider==='pixabay'||candidate.provider==='youtube')), signal }, async downloadSignal => {
        if (candidate.provider === "youtube") {
          if (!this.youtube) throw new Error("Загрузчик YouTube недоступен");
          // A source may be retried by another scene after Stop. Use the shared
          // download lock and a stable path, not a fresh scene-local UUID.
          const downloads = join(this.materialRoot, "Downloads");
          await mkdir(downloads, { recursive: true });
          temporary = join(downloads, `youtube-${createHash("sha256").update(JSON.stringify([candidate.id,sourceRange])).digest("hex")}.download`);
          await measureDocumentaryStage("download", { projectId, sceneId, provider: candidate.provider }, () => this.youtube!.download(candidate, temporary, downloadSignal, bytes => {
            documentaryDownloadProgress(downloadSignal)?.(bytes); onDownloadProgress?.(bytes);
          }, requireHd,sourceRange));
          extension = ".mp4";
        } else if (candidate.provider === "pexels" || candidate.provider === "pixabay") {
          const asset = { provider: candidate.provider, id: candidate.id.replace(/^[^:]+:/, ""), mediaType: candidate.kind, query: candidate.query,
            width: candidate.width || 0, height: candidate.height || 0, downloadUrl: candidate.downloadUrl, pageUrl: candidate.pageUrl,
            previewUrl: candidate.previewUrl || candidate.downloadUrl, author: candidate.author, attribution: candidate.attribution };
          // A new general stock shot needs this spoken-length interval, not
          // every second of an unused original. Cached/full/manual/strict
          // sources keep their established path and paid-checkpoint guards.
          const rangeSeconds=desiredSeconds;
          if(this.stock.downloadRangeToFile&&(this.stockRangePausedUntil.get(candidate.provider)??0)<=Date.now()
            &&!commit&&!manualStage&&shortOriginal&&!existingPreview&&!candidate.excerpt
            &&candidate.kind==='video'&&(candidate.durationSeconds??0)>=20&&rangeSeconds<=10
            &&rangeSeconds*3<=(candidate.durationSeconds??0)&&documentaryGeneralIllustration(scene)
            &&!documentaryGeneralActionIssue(scene)&&!documentaryRequiredVisiblePart(scene.narration)){
            const length=Math.max(2,rangeSeconds+1),lastStart=Math.max(0,(candidate.durationSeconds??0)-length);
            const rejected=scene.documentary?.searchRecovery?.rejectedRanges.filter(range=>range.sourceId===candidate.id&&range.sourceStart!==undefined&&range.sourceEnd!==undefined)??[];
            const start=[lastStart/2,0,lastStart,lastStart/4,lastStart*.75]
              .find(start=>!rejected.some(range=>start<range.sourceEnd!&&start+length>range.sourceStart!));
            if(start===undefined)throw new DocumentaryCandidateRejected('В доступных коротких отрезках этого источника уже сохранены отказы. Проверяю другой материал.');
            const range={start:Math.round(start*1000)/1000,end:Math.round((start+length)*1000)/1000};
            const rangeSignal=AbortSignal.any([AbortSignal.timeout(12_000),...(downloadSignal?[downloadSignal]:[])]);
            beginStockTransfer();
            try{
              const downloaded=await measureDocumentaryStage('download-range',{projectId,sceneId,provider:candidate.provider},()=>this.stock.downloadRangeToFile!(asset,temporary,range,rangeSignal));
              sourceRange=range;extension='.mp4';
              recordDiagnosticEvent('info','documentary.download.range',{projectId,sceneId,provider:candidate.provider,bytes:downloaded.bytes,downloadedBytes:downloaded.downloadedBytes,sourceDurationSeconds:candidate.durationSeconds,rangeSeconds:length});
              return;
            }catch(error){
              downloadSignal?.throwIfAborted();
              await rm(temporary,{force:true});
              if(rangeSignal.aborted)this.stockRangePausedUntil.set(candidate.provider,Date.now()+120_000);
              recordDiagnosticEvent('info','documentary.download.range-unavailable',{projectId,sceneId,provider:candidate.provider,timedOut:rangeSignal.aborted});
              // A slow/unsupported seek is not a content rejection. Fall back to
              // the original within the SAME transfer/scene time limit.
              // Pause this provider's range shortcut briefly so subsequent
              // candidates do not each waste the same 12 seconds.
            }
          }
          if (this.stock.downloadToFile) {
            const available = await documentaryAvailableBytes(root);
            beginStockTransfer();
            const downloaded = await measureDocumentaryStage("download", { projectId, sceneId, provider: candidate.provider }, () => this.stock.downloadToFile!(asset, temporary, available, downloadSignal));
            extension = downloaded.extension.startsWith(".") ? downloaded.extension : `.${downloaded.extension}`;
          } else {
            beginStockTransfer();
            const downloaded = await measureDocumentaryStage("download", { projectId, sceneId, provider: candidate.provider }, () => this.stock.download(asset, downloadSignal));
            await ensureDocumentarySpace(root, downloaded.data.length);
            await writeFile(temporary, downloaded.data); extension = downloaded.extension.startsWith(".") ? downloaded.extension : `.${downloaded.extension}`;
          }
        } else if(simpleRemoteVideo){
          // Local copies were considered above. A cooled origin should leave
          // the attempt available for a candidate from another host.
          const cooldown=failedTransfers?documentaryMediaCooldownMs(new URL(candidate.downloadUrl)):0;
          if(cooldown>0)throw new DocumentaryMediaCooldownError(cooldown);
          await measureDocumentaryStage('download-range',{projectId,sceneId,provider:candidate.provider},()=>downloadDirectDocumentaryRange(candidate.downloadUrl,temporary,sourceRange??{start:0,end:simpleRangeSeconds},downloadSignal,this.publicMediaFetcher));
          extension='.mp4';
        } else await measureDocumentaryStage("download", { projectId, sceneId, provider: candidate.provider }, () => downloadDocumentaryFile(candidate.downloadUrl, temporary, downloadSignal, onDownloadWait,
          {fetcher:this.publicMediaFetcher,availabilityWaitMs:this.intelligence?.simpleSelection&&candidate.kind==='image'?12_000:undefined}));
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
        startSeconds:sourceRange.start,endSeconds:sourceRange.end,sourceDurationSeconds:candidate.durationSeconds!}}:catalogSource?.excerpt&&!candidate.excerpt?{...candidate,excerpt:catalogSource.excerpt}:candidate;
      const prepared = await measureDocumentaryStage("media-preparation", { projectId, sceneId, sourceCacheHit: Boolean(localCopy), checksum }, async () =>
        prepareDocumentaryDiagram(root,mediaAsset,sourceCandidate,await prepareDocumentaryMedia(root, mediaAsset, this.materialRoot, project.scenes, join(this.storage.projectDirectory(projectId), "Documentary"))));
      if (candidate.kind === "video" && !prepared.metadata?.videoCodec || candidate.kind === "image" && !prepared.metadata?.width) throw new Error("Оригинал не соответствует выбранному типу медиа");
      const selected = { ...sourceCandidate, localPath: path, bytes: mediaAsset.bytes, width: prepared.metadata?.width, height: prepared.metadata?.height, durationSeconds: prepared.metadata?.durationSeconds };
      const visualHash = prepared.poster ? await documentaryVisualHash(join(root, prepared.poster)) : undefined;
      const similar = project.scenes.filter(other => other.id !== sceneId && (other.documentary?.checksum === checksum || visualHash && other.documentary?.visualHash && visualHashDistance(visualHash, other.documentary.visualHash) <= 6));
      if (similar.length) selected.concerns = [...selected.concerns, `Похожий или повторный материал уже есть в кадрах: ${similar.map(other => other.order + 1).join(", ")}. Проверьте разнообразие и выбранный диапазон.`];
      await atomicWrite(join(root, `${checksum}.source.json`), JSON.stringify({ ...selected, checksum, metadata: prepared.metadata,
        selectionBinding:selection?.binding??this.selectionResumeBinding(project,scene) }, null, 2));
      const updateScene = (current: Scene): Scene => {
        if (current.narration !== scene.narration) throw new Error("Сцена изменилась во время загрузки; материал сохранён, выберите его заново");
        return { ...current, imagePath: candidate.kind === "image" ? prepared.proxy ? join(root, prepared.proxy) : path : prepared.poster ? join(root, prepared.poster) : undefined,
          videoPath: candidate.kind === "video" ? (prepared.proxy ? join(root, prepared.proxy) : path) : undefined,
          stockAlternates: [], trimStartSeconds: previewStart??0, trimEndSeconds: undefined, sourceVolume: 0,
          stockSource: { provider: selected.provider, assetId: selected.id, mediaType: selected.kind, query: selected.query, pageUrl: selected.pageUrl,
            author: selected.author, attribution: selected.attribution, licenseUrl: selected.licenseUrl, downloadedAt: new Date().toISOString() },
          documentary: { ...current.documentary!, selected, checksum, visualHash, verified: false, pinned: false, manualReview:undefined, illustrative: false, reviewNote: "", visualReview: undefined, autoError: undefined } };
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
      if(transferKey)failedTransfers!.complete(transferKey);
      // Prepare originals, provenance and derivatives before changing the user's selection.
      return commit ? await this.changeScene(projectId, sceneId, updateScene) : { ...project, scenes: project.scenes.map(item => item.id === sceneId ? updateScene(item) : item) };
    } catch(error) {
      // Publish the failure before releasing the source lock. A queued scene
      // must see it before its own guard; exhausted waits are not transfers.
      if(failedTransfers&&remoteTransferStartedAt!==undefined&&Date.now()-remoteTransferStartedAt>1000
        &&candidate.kind==='video'&&(candidate.provider==='pexels'||candidate.provider==='pixabay')&&documentaryDownloadTimedOut(error))
        failedTransfers.add(documentaryTransferFingerprint(candidate));
      throw error;
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
