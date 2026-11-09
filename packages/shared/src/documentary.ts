import type { EffectBlend, EffectDefaults } from "./effect-library.js";
import type { Project } from "./index.js";
import type { DocumentaryMontageSettings, DocumentarySemanticMontage } from './documentary-montage.js';
export * from './documentary-montage.js';
export * from "./documentary-transitions.js";
import type { DocumentaryTemplate } from "./documentary-templates.js";
import type { DocumentaryMotionGraphic, DocumentaryAnnotation } from "./documentary-motion.js";
import type { DocumentaryPlace, DocumentaryMapDetail } from './documentary-motion.js';
export * from "./documentary-motion.js";
export { documentaryTemplates, documentaryLayoutPreset, documentaryLayoutPresets, documentaryStudioTemplates, isDocumentaryStudioTemplate, type DocumentaryLayoutPreset, type DocumentaryTemplate } from "./documentary-templates.js";

export type DocumentarySourceProvider = "commons" | "internet-archive" | "loc" | "youtube" | "web" | "local";
export interface DocumentaryResolvedBackground {
  assetId: string; path: string; kind: 'image' | 'video'; name: string; durationSeconds?: number;
}
/** A project-owned, checkpointed edit of the artwork actually in the montage. */
export interface DocumentaryArtworkFeedback {
  version: 1;
  operationKey: string;
  feedback: string;
  normalizedFeedback: string;
  protectedInputHash: string;
  baseArtworkHash: string;
  resultArtworkHash?: string;
  analysisKey?: string;
  status: 'prepared' | 'pending' | 'complete' | 'applied' | 'blocked';
  message: string;
  accepted?: number;
  attached?: number;
  used?: number;
}
/** An explicit set wins over the legacy single choice, including an empty set. */
export function selectedDocumentaryBackgroundIds(background?: {mode: string; assetId?: string; assetIds?: string[]}): string[] {
  if (background?.mode !== 'library') return [];
  return [...new Set((background.assetIds ?? (background.assetId ? [background.assetId] : [])).filter(Boolean))];
}
export interface DocumentarySettings {
  version: 2;
  /** New Stock projects narrate each scene independently; missing value preserves legacy shared tracks. */
  narrationMode?: "scene" | "continuous";
  /** Explicitly permits labelled generic B-roll instead of literal reenactment. */
  matchMode?: 'literal' | 'thematic';
  pace: "calm" | "balanced" | "dynamic";
  backgroundColor: string;
  accentColor: string;
  textColor: string;
  sfxVolume: number;
  captionsEnabled: boolean;
  autoEffects?: boolean;
  autoTransitions?: boolean;
  autoMotionGraphics?: boolean;
  montageDensity?: 'calm' | 'balanced' | 'rich';
  montage?: DocumentaryMontageSettings;
  /** Outcome is tied to source input, so an unavailable paid plan is not retried on export. */
  semanticMontageStatus?: { status: 'planned' | 'local'; inputHash: string; message: string };
  motionArtworkStatus?: { status: 'planned' | 'local'; inputHash: string; message: string; incomplete?: boolean };
  artworkFeedback?: DocumentaryArtworkFeedback;
  /** Last applied result remains active when a later request fails. */
  activeArtworkFeedback?: DocumentaryArtworkFeedback;
  /** Explicit local recovery of paid primary artwork; never a completed review. */
  offlinePrimaryRecovery?: {version:1;mode:'pre-revision';bindingSha256:string;sourceProjectSha256:string;
    semanticInputHash:string;artworkInputHash:string;wireResponseSha256:string[];accepted:number;attached:number;used:number};
  /** Resolved project-owned media; montage.background remains the user setting. */
  resolvedBackground?: DocumentaryResolvedBackground;
  resolvedBackgrounds?: DocumentaryResolvedBackground[];
  /** Manual selections remain available; this only restricts automatic layouts. */
  excludedTemplates?: DocumentaryTemplate[];
}
export function createDocumentarySettings(): DocumentarySettings {
  return { version: 2, narrationMode: "scene", pace: "dynamic", backgroundColor: "#161a20", accentColor: "#84c6db", textColor: "#ffffff", sfxVolume: 25, captionsEnabled: true, autoEffects: true, autoTransitions: true, autoMotionGraphics: true };
}

/** A downloaded replacement is renderable while its approximate match remains under manual review. */
export function documentaryManualReviewReady(scene: Project['scenes'][number], fileAvailable: (path:string)=>boolean = () => true): boolean {
  const doc=scene.documentary,pending=doc?.manualReview,selected=doc?.selected;
  const path=selected?.kind==='video'?scene.videoPath:scene.imagePath;
  return Boolean(doc&&pending?.version===1&&pending.status==='pending'
    &&!doc?.verified&&!doc?.pinned&&selected?.provider===pending.provider&&selected.id===pending.candidateId
    &&selected.rights!=='unknown'
    &&selected.kind===pending.kind&&(!doc.selectionPlan||doc.selectionPlan.kind===pending.kind)
    &&selected.localPath&&doc.checksum&&doc.checksum===pending.checksum&&pending.narration===scene.narration
    &&path&&path===pending.mediaPath&&pending.reason.trim()&&fileAvailable(path));
}

export type DocumentaryFootageOrigin='camera'|'requested-depiction'|'non-camera'|'uncertain';

export function documentaryFootageOrigin(review:Record<string,unknown>):DocumentaryFootageOrigin {
  if(review.footageOrigin==='requested-depiction')return 'requested-depiction';
  if(review.footageOrigin==='non-camera'||review.isCameraFootage===false||['render','game','animation','graphic','slideshow','still'].includes(String(review.mediaType)))return 'non-camera';
  if(review.footageOrigin!==undefined)return review.footageOrigin==='camera'?'camera':'uncertain';
  return review.isCameraFootage===true||review.mediaType==='camera'?'camera':'uncertain';
}

export function documentaryVideoOriginIssue(origin:DocumentaryFootageOrigin):string|undefined {
  if(origin==='non-camera')return 'В проверенном отрезке распознана иллюстрация вместо натурной съёмки.';
  if(origin==='uncertain')return 'По сохранённому просмотру не подтверждено, что это натурная съёмка. Автоматический повтор не отправлен.';
}

export function documentaryMaterialUsable(scene: Project['scenes'][number], fileAvailable?: (path:string)=>boolean): boolean {
  const doc=scene.documentary;
  if(doc?.verified&&!doc.pinned&&doc.selected?.kind==='video'&&doc.visualReview?.illustrationApproval)
    return doc.visualReview.status==='accepted'&&!documentaryVideoOriginIssue(documentaryFootageOrigin(doc.visualReview));
  return Boolean(doc?.verified||documentaryManualReviewReady(scene,fileAvailable));
}

/** Exact serialized inputs for a locally proved, never-submitted review. */
export function documentaryGeminiRetryBinding(project:Project,scene:Project['scenes'][number]):string {
  return JSON.stringify([documentaryAiPlanContext(project),scene.id,scene.narration,scene.imagePath,scene.videoPath,
    scene.trimStartSeconds,scene.trimEndSeconds,scene.playbackRate,scene.durationSeconds,scene.durationOverrideSeconds,
    scene.documentary?.timing,scene.documentary?.requirement,scene.documentary?.selected,scene.documentary?.checksum]);
}

export function documentaryGeminiRetryAllowed(project:Project,scene:Project['scenes'][number]):boolean {
  const analysis=scene.documentary?.manualReview?.analysis,proof=analysis?.preSubmit;
  return Boolean(documentaryManualReviewReady(scene)&&analysis?.status==='error'&&proof?.version===1
    &&/^[a-f0-9]{64}$/.test(proof.checkpointKey)&&proof.fileRevision&&proof.binding===documentaryGeminiRetryBinding(project,scene));
}

/** Count actual moving footage, not photos or the frozen tail of a short clip. */
export function documentaryVideoCoverage(scenes: Project["scenes"]): { videoSeconds: number; totalSeconds: number; percent: number } {
  let videoSeconds = 0, totalSeconds = 0;
  for (const scene of scenes.filter(item => item.includeInAssembly !== false)) {
    const duration = Math.max((scene.documentary?.timing?.durationInFrames ?? Math.ceil(scene.durationSeconds * 30)) / 30, scene.durationOverrideSeconds ?? 0);
    totalSeconds += duration;
    if (!scene.documentary || !documentaryMaterialUsable(scene)) continue;
    const cuts=scene.documentary.cuts?.length?scene.documentary.cuts:[{fromFrame:0,durationInFrames:duration*30,
      trimStartSeconds:scene.trimStartSeconds??0,trimEndSeconds:scene.trimEndSeconds,playbackRate:scene.playbackRate??1,sourceSceneId:scene.id}];
    const graphic=scene.documentary.motionGraphic;
    for(const cut of cuts){
      const source=cut.sourceSceneId?scenes.find(item=>item.id===cut.sourceSceneId):scene;
      if(!source||!documentaryMaterialUsable(source)||source.documentary?.selected?.kind!=='video'||!source.videoPath)continue;
      const sourceEnd=Math.min(cut.trimEndSeconds??Infinity,source.documentary.selected.durationSeconds??cut.trimEndSeconds??cut.trimStartSeconds);
      const available=Math.max(0,sourceEnd-cut.trimStartSeconds);
      const start=cut.fromFrame/30,end=Math.min(duration,start+cut.durationInFrames/30,start+available/Math.max(.1,cut.playbackRate));
      const moving=Math.max(0,end-start);
      const obscured=graphic?.enabled&&(graphic.kind==='bar-chart'||graphic.kind==='statistic'&&graphic.showSource===false||graphic.kind.startsWith('map-')&&graphic.mapStyle!=='inset')
        ?Math.max(0,Math.min(end,graphic.startSeconds+graphic.durationSeconds)-Math.max(start,graphic.startSeconds)):0;
      videoSeconds+=Math.max(0,moving-obscured);
    }
  }
  return { videoSeconds, totalSeconds, percent: totalSeconds ? Math.floor(videoSeconds / totalSeconds * 100) : 0 };
}
/** Candidate-independent requirements, frozen while planning the original script. */
export interface DocumentaryScriptRequirements {
  version: 1;
  mode?: 'thematic';
  scriptText: string;
  checks: Array<{ id: string; kind: 'object' | 'action' | 'condition'; scriptQuote: string; required: string }>;
  nonVisual: Array<{ scriptQuote: string; reason: string }>;
}
/** Contract revision belongs to both disk and scene-owned plan identities. */
export const DOCUMENTARY_QUERY_CONTRACT_VERSION = 6;
export function documentaryAiPlanContext(project: Project) {
  const contextScenes = [...project.scenes].sort((a, b) => a.order - b.order)
    .map(scene => ({sceneId: scene.id, narration: scene.narration}));
  return {title: project.title, topic: project.topic, language: project.language,
    originalScript: project.videoBrief?.readyScript || contextScenes.map(scene => scene.narration).join('\n'), contextScenes,
    queryContractVersion:DOCUMENTARY_QUERY_CONTRACT_VERSION,
    visualPolicy:{mode:project.settings?.assembly?.documentary?.matchMode??'subject-illustration'}};
}

/** Text-model search plan. Thematic queries are never evidence of the exact event. */
export interface DocumentaryAiSearchPlan {
  version: 1;
  inputHash: string;
  model: string;
  visualTarget: string;
  subject: string;
  years: string[];
  visualScope: "exact" | "illustrative";
  preferredKind: "image" | "video";
  /** Required in current AI answers; optional only for persisted legacy plans. */
  reservePolicy?: 'thematic' | 'primary-only';
  imageQueries: string[];
  videoQueries: string[];
  fallbackVideoQueries: string[];
  /** Empty together with fallbackVideoQueries when no honest thematic fallback exists. */
  fallbackVisualTarget: string;
}
/** One policy for automatic reserve planning, discovery and saved approvals.
 * Manual searches and primary material lanes do not use this gate. */
export function documentaryThematicReserveIssue(plan: Pick<DocumentaryAiSearchPlan,'reservePolicy'> | undefined): string | undefined {
  if(plan?.reservePolicy==='primary-only')return 'AI-план требует сохранить основной смысл сравнения или схемы; автоматическое тематическое расширение запрещено.';
}
export interface DocumentaryRequirement {
  aiSearchPlan?: DocumentaryAiSearchPlan;
  /** Automatic thematic media after exact discovery failed; never archival proof. */
  footageFallback?: {version:1;target:string;queries:string[];reason:string;originalTarget:string;narration?:string;kind?:'video'|'image';
    /** One reserve pass per invocation. Persisted sources cannot be retried through an alias on resume. */
    automaticRecovery?: {version:1;binding:string;startedAt:string;blockedSourceKeys:string[]}};
  /** Local fast discovery target; never a paid semantic-planning approval. */
  fastVisualTarget?: string;
  fastSourcePolicy?: 'specific' | 'background';
  fastPlanVersion?: 1;
  scriptRequirements?: DocumentaryScriptRequirements;
  /** Event commentary illustrated by authentic media of a bounded period;
   * source capture date is retained, never relabelled as the event year. */
  historicalIllustration?: {scriptQuote:string;eventYear:number;startYear:number;endYear:number};
  /** Retain the exact plan when the user chooses faster thematic illustration. */
  literalRequirement?: DocumentaryRequirement;
  /** A bounded repair of a failed named-subject plan; never repeat on resume. */
  identityRepairVersion?: 1;
  /** Exact script excerpt. Metadata match is never proof of visual identity. */
  text: string;
  entities: string[];
  /** Named subjects only. Aliases are translations/names of that same subject,
   * never its category, location, parts or a similar object. Undefined = legacy. */
  identities?: Array<{ name: string; aliases: string[] }>;
  /** Version 2 resolves the named subject through the surrounding script, including its unnamed parts. */
  identityContextVersion?: 2 | 3;
  /** A thematic stock illustration is allowed only after a grounded scope decision.
   * The original story referent is retained separately for audit and re-planning. */
  visualScope?: "exact" | "illustrative";
  /** Re-evaluate unfinished legacy scopes when the scene-level illustration policy changes. */
  visualScopeVersion?: 2 | 3;
  /** One exhausted-exact-search fallback decision. It never asserts that thematic footage depicts the event. */
  illustrationFallbackVersion?: 1;
  visualScopeQuote?: string;
  illustrationQuery?: string;
  narrativeEntities?: string[];
  narrativeIdentities?: Array<{ name: string; aliases: string[] }>;
  narrativeYears?: string[];
  narrativeDetail?: string;
  narrativeQueries?: string[];
  years: string[];
  queries: string[];
  /** One bounded search revision per semantic plan; resumes must not buy it again. */
  searchRefined?: boolean;
  detail?: string;
  preferredKind?: "video" | "image";
  plannedBy?: "semantic";
  accent?: "none" | "transition" | "click" | "keyboard" | "ding";
  caption?: string;
  /** Short grounded heading only at an actual section change, otherwise empty. */
  sectionTitle?: string;
  motionGraphic?: DocumentaryMotionGraphic;
}
export interface DocumentaryCandidate {
  id: string;
  provider: DocumentarySourceProvider | "pexels" | "pixabay";
  kind: "image" | "video";
  title: string;
  description: string;
  /** Generated observations for local search/ranking only; never source provenance. */
  previousFrameSearchHint?: string;
  pageUrl: string;
  downloadUrl: string;
  previewUrl?: string;
  author: string;
  license: string;
  licenseUrl: string;
  rights: "licensed" | "public-domain" | "unknown" | "user-confirmed";
  attribution: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  /** YouTube API definition; metadata hint, never the original's measured dimensions. */
  videoDefinition?: "hd" | "sd";
  bytes?: number;
  localPath?: string;
  /** Retained raw excerpt, before templates/effects. Times refer to its downloaded source. */
  excerpt?: { sourceChecksum: string; startSeconds: number; endSeconds: number; sourceDurationSeconds: number };
  query: string;
  retrievedAt: string;
  /** Public page discovery; YouTube originals use page metadata rather than Data API. */
  discovery?: "public-web";
  capturedAt?: string;
  match: "exact-metadata" | "unverified";
  concerns: string[];
}
/** Project-owned copy; the renderer never downloads media or reads the original pack. */
export interface DocumentaryEffect {
  /** Missing origin preserves legacy/user-authored effects. */
  origin?: 'automatic' | 'manual';
  id: string;
  assetId: string;
  assetVersion: 1;
  name: string;
  filePath: string;
  kind: "image" | "video" | "audio";
  role: "background" | "overlay" | "transition" | "sound";
  /** Two trimmed halves of one visual transition share the same boundary. */
  boundary?: { from: string; to: string; origin: "manual" | "automatic" };
  enabled: boolean;
  startSeconds: number;
  durationSeconds: number;
  sourceDurationSeconds?: number;
  defaults: EffectDefaults;
  x: number;
  y: number;
  scale: number;
  blend: EffectBlend;
}
/** Visual cuts are independent of the exact narration and its paid source. */
export interface DocumentaryVisualCut {
  /** Automatic motion restarts at each cut; legacy cuts retain scene motion. */
  motion?: 'none' | 'push' | 'pull';
  id: string;
  fromFrame: number;
  durationInFrames: number;
  sourceSceneId?: string;
  trimStartSeconds: number;
  trimEndSeconds?: number;
  playbackRate: number;
}
export interface DocumentaryTextClip {
  id: string;
  text: string;
  enabled: boolean;
  startSeconds: number;
  durationSeconds: number;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  backgroundColor: string;
  backgroundOpacity?: number;
  opacity: number;
  animation: "fade" | "slide" | "zoom" | "typing";
  fadeInSeconds: number;
  fadeOutSeconds: number;
}
export interface DocumentaryScene {
  version: 2;
  /** Cached semantic direction, tied to the narration/source fingerprint. */
  semanticMontage?: DocumentarySemanticMontage['scenes'][number];
  /** Automatic cuts are replaceable; unmarked legacy cuts remain authored. */
  cutsOrigin?: 'automatic' | 'manual';
  semanticMontageInputHash?: string;
  narrationAlignment?: "audio-analysis" | "estimated";
  timing?: { sourceKey: string; audioPath?: string; audioStartSeconds?: number; audioEndSeconds?: number; durationInFrames: number; speechSeconds: number };
  requirement: DocumentaryRequirement;
  candidates: DocumentaryCandidate[];
  /** IPC display snapshot only; omitted candidates remain on the desktop. */
  candidatesDeferred?: boolean;
  candidateCount?: number;
  selected?: DocumentaryCandidate;
  verified: boolean;
  pinned: boolean;
  illustrative: boolean;
  /** Frozen automatic photo/video allocation; retries cannot relabel a fallback. */
  selectionPlan?: { kind: 'image' | 'video'; videoPercent: number };
  /** User-authorized fallback. Never set verified or manufacture a Gemini verdict. */
  manualReview?: {version:1;status:'pending';provider:DocumentaryCandidate['provider'];kind:'image'|'video';candidateId:string;
    checksum:string;mediaPath:string;narration:string;reason:string;
    /** Saved before inspection; pending/unknown must never authorize a blind resubmission. */
    analysis?: {status:'pending'|'error'|'unknown'|'accepted'|'rejected'|'uncertain';reason:string;
      /** Created only after receipt guards and a local preflight refusal, before pending/POST. */
      preSubmit?: {version:1;checkpointKey:string;binding:string;fileRevision:{size:string;mtimeNs:string;ctimeNs:string}}}};
  /** New automatic illustrations are labelled in the editor, without export text. */
  illustrationLabelInEditorOnly?: boolean;
  reviewNote: string;
  searchError?: string;
  checksum?: string;
  visualHash?: string;
  visualReview?: { status: "accepted" | "rejected" | "uncertain"; confidence: number; reason: string; checkedAt: string; sampleSeconds: number[]; quality: string; identifiedEntity?: string; trimStartSeconds?: number; trimEndSeconds?: number; viewDescription?: string; frameHash?: string; actionMatch?: boolean; actionEvidence?: string; annotations?:DocumentaryAnnotation[];
    /** Origin explicitly assessed on the ordered frames in this same review. */
    footageOrigin?: DocumentaryFootageOrigin;
    /** Source attribution checked in the same pixel review; URL-only hints are weak. */
    sourceLocation?: {version:1;sourceFingerprint:string;requiredLocation?:string;status:'unspecified'|'supported'|'hint'|'conflict';
      place?:string;field?:'title'|'description'|'location'|'pageUrl'|'urlSlug';quote?:string;strength?:'source'|'weak'};
    /** One fast relevance verdict; absent on old descriptive-only approvals. */
    fastRelevance?: {version:1;target:string;relevant:boolean;evidence:string;specificEvidence?:{subject:string;identityMatch:boolean;eraMatch:boolean;actionMatch:boolean;evidence:string;eraEvidenceQuote?:string}};
    /** Text actually seen in the source pixels, separate from our own captions. */
    illustrationQualityVersion?: 1;
    targetVisibility?: {version:1;target:string;visible:boolean;evidence:string};
    /** A simplified automatic reserve also has to preserve the original story point. */
    narrativeFit?: {version:1;binding:string;status:'supported'|'conflict'|'uncertain';scriptQuote:string;evidence:string};
    sourceText?: {version:1;kind:'none'|'physical'|'caption'|'promotion'|'uncertain';text:string;note?:string;relevant?:boolean;evidence?:string};
    /** Pixel-checked explanatory diagram; never proof of a particular model or event. */
    generalDiagram?: { isDiagram: true; illustrationOnly: true; scriptQuote: string; detailEvidence: string };
    /** Original-script requirements checked in the same final pixel review. */
    scriptEvidence?: { version: 1; scriptText: string; checks: Array<{ requirementId?: string; kind: 'object' | 'action' | 'condition'; scriptQuote: string; required: string; match: boolean | null; evidence: string;
      temporalEvidence?: { startState: string; endState: string; changed: boolean; sameSubject?: boolean;
        observations?: Array<{ seconds: number; subject: string; visible: boolean; state: string }> };
      operationEvidence?: { operation: 'remove' | 'install' | 'replace'; objectRequirementId: string; part: string;
        observations: Array<{ seconds: number; state: 'mounted' | 'detached' | 'replacement-mounted' | 'not-visible'; evidence: string }> }
      }>; nonVisual?: Array<{ scriptQuote: string; reason: string }> };
    nextSearchQueries?: string[];
    /** A cut inside the reviewed interval does not reject the entire source. */
    rangeIssue?: 'cut';
    /** Automatic acceptance of these pixels/interval in this original script context. */
    localReview?: {version:1;size:string;mtimeNs:string;ctimeNs:string};
    contextApproval?: { version: 1; fingerprint: string; evidence: { subjectMatch: true; eraMatch: true; detailMatch: true; requiredEra: string; observedEra: string; eraEvidenceQuote?: string; evidence: string } };
    /** One model verdict on the actual image or ordered video frames. */
    illustrationApproval?: { version: 1; fingerprint: string };
  };
  autoError?: string;
  /** Offline narration card after bounded source failures; never a pixel approval. */
  nativeFallback?: {version:1;narration:string;reason:string;
    /** Explicit transition after stock exhaustion; separately binds the native card's authored context. */
    automaticRecovery?: {version:1;binding:string};
    previousMaterial?: {selected?:DocumentaryCandidate;imagePath?:string;videoPath?:string;checksum?:string;visualHash?:string;visualReview?:DocumentaryScene['visualReview']}};
  searchRecovery?: { reason: string; queries: string[]; scriptEvidence?: NonNullable<DocumentaryScene['visualReview']>['scriptEvidence'];
    rejectedRanges: Array<{ checksum: string; start: number; end: number; sourceId?: string; sourceStart?: number; sourceEnd?: number }> };
  caption: { text: string; enabled: boolean; position: "top" | "bottom" | "center"; animation: "fade" | "slide" | "typing"; fontSize: number; color: string; backgroundColor: string; opacity: number };
  layout: "full" | "contain" | "compare";
  template?: DocumentaryTemplate;
  templateTiming?: {startSeconds:number;durationSeconds:number};
  /** Only explicit automatic ownership permits replanning after source changes. */
  templateOrigin?: 'automatic' | 'manual';
  /** Blur is a style of the existing timed dissolve, not extra scene time. */
  transitionStyle?: 'clean' | 'blur';
  autoTransitionStyle?: 'clean' | 'blur' | 'glitch';
  templateMotion?: { amountPercent: number; curve: "smooth" | "dramatic" };
  motionGraphic?: DocumentaryMotionGraphic;
  cuts?: DocumentaryVisualCut[];
  texts?: DocumentaryTextClip[];
  comparison?: { sceneId: string; leftLabel: string; rightLabel: string };
  effects: DocumentaryEffect[];
}
export interface DocumentarySearchResult {
  candidates: DocumentaryCandidate[];
  sources: { provider: DocumentaryCandidate["provider"]; count: number; error?: string }[];
}
export interface DocumentarySearchInput {
  query: string;
  kind: "image" | "video";
  providers?: DocumentaryCandidate["provider"][];
  entities?: string[];
  years?: string[];
}
export interface DocumentaryQueryPlanIssue {
  sceneId: string;
  sceneNumber: number;
  reason: string;
  cached?: true;
  canContinue?: true;
  /** Identifies the completed attempts for this scene in its current planning context. */
  retryToken?: string;
}

export interface DocumentaryApi {
  getDocumentaryQueryPlanIssues(projectId: string): Promise<DocumentaryQueryPlanIssue[]>;
  retryDocumentaryQueryPlan(projectId: string, sceneId: string, retryToken: string): Promise<Project>;
  stageDocumentaryCandidate(projectId:string,sceneId:string,candidateId:string,fullOriginal?:boolean):Promise<DocumentaryMaterialStage>;
  stageDocumentaryImport(projectId:string,sceneId:string,input:Parameters<DocumentaryApi['importDocumentaryMaterial']>[2]):Promise<DocumentaryMaterialStage>;
  applyDocumentaryStage(projectId:string,sceneId:string,input:{stageId:string;startSeconds:number;cutId?:string;illustrative:boolean;note:string;rightsConfirmed:boolean}):Promise<Project>;
  getDocumentaryCandidates(projectId: string, sceneId: string): Promise<DocumentaryCandidate[]>;
  prepareDocumentaryMap(projectId:string,place:DocumentaryPlace,radiusKm?:number,route?:DocumentaryPlace[]):Promise<DocumentaryMapDetail>;
  prepareDocumentaryPreview(projectId: string): Promise<Project>;
  prepareDocumentaryEffect(projectId: string, assetId: string): Promise<DocumentaryEffect>;
  searchDocumentary(projectId: string, sceneId: string, input: DocumentarySearchInput): Promise<{ project: Project; result: DocumentarySearchResult }>;
  applyDocumentaryCandidate(projectId: string, sceneId: string, candidateId: string): Promise<Project>;
  importDocumentaryMaterial(projectId: string, sceneId: string, input: { path?: string; downloadUrl?: string; pageUrl: string; title: string; author: string; license: string; licenseUrl: string }): Promise<Project>;
  reviewDocumentaryMaterial(projectId: string, sceneId: string, input: { verified: boolean; illustrative: boolean; note: string; rightsConfirmed: boolean }): Promise<Project>;
  retryDocumentaryGemini(projectId:string,sceneId:string):Promise<Project>;
}

export interface DocumentaryMaterialStage { id:string; scene:Project['scenes'][number] }

/** Different excerpts of one remote video remain independently selectable. */
export function documentaryCandidateSelectionKey(candidate:DocumentaryCandidate) {
  return JSON.stringify([candidate.id,candidate.excerpt??null,candidate.localPath??null]);
}

/** A movable fixed window, measured in source seconds at the chosen playback rate. */
export function documentaryFixedRange(scene:Project['scenes'][number],startSeconds:number,sourceSeconds:number,cutId?:string) {
  const cut=cutId?scene.documentary?.cuts?.find(item=>item.id===cutId):undefined;
  if(cutId&&!cut)throw new Error('Выбранный визуальный клип изменился; откройте замену заново.');
  const seconds=cut?cut.durationInFrames/30:Math.max((scene.documentary?.timing?.durationInFrames??Math.ceil(scene.durationSeconds*30))/30,scene.durationOverrideSeconds??0);
  const length=seconds*(cut?.playbackRate??scene.playbackRate??1);
  if(!Number.isFinite(length)||length<=0)throw new Error('Для выбора отрезка нужна положительная длительность и скорость сцены.');
  if(!Number.isFinite(sourceSeconds)||sourceSeconds+.05<length)throw new Error(`Исходник слишком короткий: нужны ${length.toFixed(1)} с. Прежний материал сохранён.`);
  if(!Number.isFinite(startSeconds)||startSeconds<0||startSeconds+length>sourceSeconds+.05)throw new Error('Выберите отрезок целиком внутри исходного видео.');
  return {startSeconds,endSeconds:startSeconds+length,length,maxStart:Math.max(0,sourceSeconds-length)};
}
