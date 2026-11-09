import type {DocumentaryMotionGraphic} from './documentary-motion.js';

/** Optional direction for the existing motion model, never a second timeline. */
export type DocumentaryMontageComposition = Pick<DocumentaryMotionGraphic,'kind'> & Partial<Pick<DocumentaryMotionGraphic,
  'variant'|'title'|'kicker'|'value'|'items'|'cards'|'boardLayout'|'highlight'|'ratioGroups'>>;

/** Optional v1 extension. Missing fields preserve legacy projects and manual edits. */
export interface DocumentaryMontageSettings {
  version: 1;
  style: 'clean' | 'editorial' | 'cinematic';
  intensity: 'calm' | 'balanced' | 'rich';
  /** Independent of camera/transition energy; absent retains saved legacy edits. */
  graphicsDensity?: 'sparse' | 'rich';
  /** Automatic opening rhythm; defaults to 30, clamped to 10–60 seconds. */
  hookSeconds?: number;
  background?: { mode: 'automatic' | 'off' | 'library'; assetId?: string; assetIds?: string[] };
  /** Preserve uses the existing project.settings.music unchanged. */
  musicPolicy?: 'preserve' | 'off' | 'automatic';
}

export function documentaryHookSeconds(settings?: Pick<DocumentaryMontageSettings, 'hookSeconds'>): number {
  const value = settings?.hookSeconds;
  return Math.max(10, Math.min(60, Number.isFinite(value) ? value! : 30));
}

/** A few narrative spans, expressed against the real scene order, not audio speed. */
export interface DocumentaryMusicSection {
  startSceneId: string;
  endSceneId: string;
  role: 'hook' | 'narration' | 'turn' | 'climax' | 'resolution';
  /** Silence is deliberate; an unavailable requested mood becomes a missing clip. */
  mood: 'tension' | 'reflective' | 'energetic' | 'discovery' | 'calm' | 'silence';
}

/** Editorial decisions from the ordinary full-story pass. These are production
 * notes, never captions, coordinates, new facts or a second timeline. */
export interface DocumentarySceneDirection {
  alternatives: Array<{id:string;idea:string;action:string;staging:string}>;
  selectedId: string;
  reason: string;
  storyboard: {
    entry:string;
    focus:string;
    states:Array<{at:number;object:string;change:string}>;
    camera:{mode:'hold'|'follow'|'reveal';purpose:string};
    depth:{mode:'flat'|'layered';purpose:string};
    typography:{mode:'none'|'label'|'action';purpose:string};
    exit:string;
    join:string;
    sound:'none'|'click'|'transition';
  };
}

export interface DocumentarySemanticMontage {
  version: 1;
  inputHash: string;
  model: string;
  hookSeconds: number;
  /** The confirmed base remains usable when the optional concept pass fails. */
  conceptWarning?: string;
  musicSections?: DocumentaryMusicSection[];
  scenes: Array<{
    sceneId: string;
    /** Quotes and labels must be grounded in the original narration. */
    subject: string;
    location?: string;
    beat: 'establish' | 'conflict' | 'evidence' | 'explain' | 'turn' | 'resolve';
    emphasis?: string;
    /** Exact narrated content; source IDs belong to the existing local allowlist. */
    composition?: DocumentaryMontageComposition;
    /** Visible evidence stays photographic; unseen mechanisms/relations use a separate explanation. */
    artworkMode?: 'photographic' | 'standalone';
    /** Grounded visual commission for the drawing pass; quotes come from this complete thought. */
    artworkBrief?: {view:'object'|'cutaway'|'system'|'sequence'|'comparison';subjectQuote:string;phaseQuotes:string[];endSceneId?:string};
    sceneDirection?: DocumentarySceneDirection;
    /** Only the first scene commissions the span; local planning carries its clock. */
    explanation?: Omit<import('./documentary-explanation.js').DocumentaryExplanation,'sequence'> & {endSceneId?:string};
    artwork?: import('./documentary-artwork.js').DocumentaryArtwork;
    /** One standalone drawing from this scene through the included end scene. */
    artworkSpan?: {endSceneId:string};
    language?: string;
    chapter?: { title: string; number?: string; scriptOffset: number; startSeconds: number };
    vignette?: boolean;
    monochrome?: boolean;
    /** Editorial onset within this scene, not a measured word timestamp. */
    monochromeStartSeconds?: number;
    /** Stored on the first scene of a section so saved plans need no new project container. */
    musicSection?: DocumentaryMusicSection;
    treatment: 'footage' | 'archive' | 'television' | 'map' | 'subject' | 'statistic' | 'quote';
    /** Only approved, already selected local sources. No new discovery. */
    cutawaySceneIds: string[];
    /** One reviewed illustrative source covers the scene without changing its selection. */
    cutawayMode?: 'replace';
  }>;
}
