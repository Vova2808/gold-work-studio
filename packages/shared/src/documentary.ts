import type { EffectBlend, EffectDefaults } from "./effect-library.js";
import type { Project } from "./index.js";
export * from "./documentary-transitions.js";
import type { DocumentaryTemplate } from "./documentary-templates.js";
import type { DocumentaryMotionGraphic, DocumentaryAnnotation } from "./documentary-motion.js";
import type { DocumentaryPlace, DocumentaryMapDetail } from './documentary-motion.js';
export * from "./documentary-motion.js";
export { documentaryTemplates, documentaryLayoutPreset, documentaryLayoutPresets, documentaryStudioTemplates, isDocumentaryStudioTemplate, type DocumentaryLayoutPreset, type DocumentaryTemplate } from "./documentary-templates.js";

export type DocumentarySourceProvider = "commons" | "internet-archive" | "loc" | "youtube" | "web" | "local";
export interface DocumentarySettings {
  version: 2;
  /** New Stock projects narrate each scene independently; missing value preserves legacy shared tracks. */
  narrationMode?: "scene" | "continuous";
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
  /** Manual selections remain available; this only restricts automatic layouts. */
  excludedTemplates?: DocumentaryTemplate[];
}
export function createDocumentarySettings(): DocumentarySettings {
  return { version: 2, narrationMode: "scene", pace: "dynamic", backgroundColor: "#161a20", accentColor: "#84c6db", textColor: "#ffffff", sfxVolume: 25, captionsEnabled: true, autoEffects: true, autoTransitions: true, autoMotionGraphics: true };
}

/** Count actual moving footage, not photos or the frozen tail of a short clip. */
export function documentaryVideoCoverage(scenes: Project["scenes"]): { videoSeconds: number; totalSeconds: number; percent: number } {
  let videoSeconds = 0, totalSeconds = 0;
  for (const scene of scenes.filter(item => item.includeInAssembly !== false)) {
    const duration = Math.max((scene.documentary?.timing?.durationInFrames ?? Math.ceil(scene.durationSeconds * 30)) / 30, scene.durationOverrideSeconds ?? 0);
    totalSeconds += duration;
    if (!scene.documentary?.verified || scene.documentary.selected?.kind !== "video" || !scene.videoPath) continue;
    const available = Math.max(0, (scene.trimEndSeconds ?? scene.documentary.selected.durationSeconds ?? 0) - (scene.trimStartSeconds ?? 0));
    const moving=Math.min(duration, available / Math.max(.1, scene.playbackRate ?? 1));
    const graphic=scene.documentary.motionGraphic;
    const obscured=graphic?.enabled&&(graphic.kind==='bar-chart'||graphic.kind.startsWith('map-')&&graphic.mapStyle!=='inset')
      ? Math.max(0,Math.min(moving,graphic.startSeconds+graphic.durationSeconds)-Math.max(0,graphic.startSeconds)):0;
    videoSeconds += Math.max(0,moving-obscured);
  }
  return { videoSeconds, totalSeconds, percent: totalSeconds ? Math.floor(videoSeconds / totalSeconds * 100) : 0 };
}
export interface DocumentaryRequirement {
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
  capturedAt?: string;
  match: "exact-metadata" | "unverified";
  concerns: string[];
}
/** Project-owned copy; the renderer never downloads media or reads the original pack. */
export interface DocumentaryEffect {
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
  reviewNote: string;
  searchError?: string;
  checksum?: string;
  visualHash?: string;
  visualReview?: { status: "accepted" | "rejected" | "uncertain"; confidence: number; reason: string; checkedAt: string; sampleSeconds: number[]; quality: string; identifiedEntity?: string; trimStartSeconds?: number; trimEndSeconds?: number; viewDescription?: string; frameHash?: string; actionMatch?: boolean; actionEvidence?: string; annotations?:DocumentaryAnnotation[];
    /** Automatic acceptance of these pixels/interval in this original script context. */
    contextApproval?: { version: 1; fingerprint: string; evidence: { subjectMatch: true; eraMatch: true; detailMatch: true; requiredEra: string; observedEra: string; eraEvidenceQuote?: string; evidence: string } };
  };
  autoError?: string;
  caption: { text: string; enabled: boolean; position: "top" | "bottom" | "center"; animation: "fade" | "slide" | "typing"; fontSize: number; color: string; backgroundColor: string; opacity: number };
  layout: "full" | "contain" | "compare";
  template?: DocumentaryTemplate;
  templateTiming?: {startSeconds:number;durationSeconds:number};
  /** Only explicit automatic ownership permits replanning after source changes. */
  templateOrigin?: 'automatic' | 'manual';
  /** Blur is a style of the existing timed dissolve, not extra scene time. */
  transitionStyle?: 'clean' | 'blur';
  autoTransitionStyle?: 'clean' | 'blur';
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
export interface DocumentaryApi {
  getDocumentaryCandidates(projectId: string, sceneId: string): Promise<DocumentaryCandidate[]>;
  prepareDocumentaryMap(projectId:string,place:DocumentaryPlace,radiusKm?:number,route?:DocumentaryPlace[]):Promise<DocumentaryMapDetail>;
  prepareDocumentaryPreview(projectId: string): Promise<Project>;
  prepareDocumentaryEffect(projectId: string, assetId: string): Promise<DocumentaryEffect>;
  searchDocumentary(projectId: string, sceneId: string, input: DocumentarySearchInput): Promise<{ project: Project; result: DocumentarySearchResult }>;
  applyDocumentaryCandidate(projectId: string, sceneId: string, candidateId: string): Promise<Project>;
  importDocumentaryMaterial(projectId: string, sceneId: string, input: { path?: string; downloadUrl?: string; pageUrl: string; title: string; author: string; license: string; licenseUrl: string }): Promise<Project>;
  reviewDocumentaryMaterial(projectId: string, sceneId: string, input: { verified: boolean; illustrative: boolean; note: string; rightsConfirmed: boolean }): Promise<Project>;
}
