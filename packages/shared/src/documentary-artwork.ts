/** Declarative artwork authored for one narration beat. No executable code or URLs. */
/** Photographic staging belongs to the native montage catalogue in automatic edits. */
export function documentaryArtworkUsesMedia(artwork?:{layers:ReadonlyArray<{kind:string}>}):boolean {
  return Boolean(artwork?.layers.some(layer=>layer.kind==='media'));
}

export interface DocumentaryArtworkKeyframe {
  t: number;
  x?: number; y?: number; rotation?: number; scale?: number; opacity?: number; draw?: number;
  /** Easing into this key. Linear for continuous physical motion, eased for staging. */
  ease?: 'linear' | 'out' | 'inOut';
}
/** Coordinates of a detail window in the uncropped original still image. */
export interface DocumentaryArtworkSourceWindow {x:number; y:number; w:number; h:number}
export interface DocumentaryArtworkLayer {
  id: string;
  kind: 'path' | 'rect' | 'ellipse' | 'text' | 'group' | 'media';
  /** Group transforms are inherited; all boxes still use the same canvas coordinates. */
  parentId?: string;
  /** Relative 2.5D parallax, -1 (back) .. 1 (front). Inherited through groups;
   * never changes paint order or claims physical 3D. */
  depth?: number;
  x: number; y: number; w: number; h: number;
  /** SVG path in local canvas units (0..w, 0..h), translated by x/y. */
  path?: string;
  text?: string;
  fill?: string; stroke?: string; strokeWidth?: number; radius?: number;
  /** Explicit inspector text colour takes precedence over automatic contrast repair. */
  fillOrigin?: 'manual';
  /** Original stroke bounds, retained once before manual stroke edits so scene
   * auto-framing stays unchanged. Box geometry and authored keys remain intact. */
  framingBeforeEdit?: {stroke?: string; strokeWidth?: number};
  fontSize?: number; weight?: number; align?: 'left' | 'center' | 'right';
  keyframes?: DocumentaryArtworkKeyframe[];
  /** Manual whole-object transform, outside the authored animation (and inherited by group children).
   * Offsets use the parent canvas axes; scale/rotation use the original box centre.
   * Keep geometry and keyframes unchanged. Absent means identity. */
  editTransform?: {x: number; y: number; scale: number; rotation: number};
  repeat?: number;
  /** Optional restrained depth treatment for the principal illustrated objects. */
  shading?: 'soft';
  shadow?: boolean;
  /** Media references are resolved against the supplied selected-source allowlist. */
  sourceSceneId?: string;
  sourceVariant?: 'original' | 'foreground';
  sourceWindow?: DocumentaryArtworkSourceWindow;
  clip?: 'rect' | 'ellipse';
}
/** Prepared locally for preview/export; never accepted from model-authored JSON. */
export interface DocumentaryArtworkPreparedMaterial {
  sourceSceneId:string;
  kind:'image'|'video';
  path:string;
  width:number;
  height:number;
  actualVariant:'original'|'foreground';
  /** Original source identity for a derived-asset render fingerprint. */
  sourceIdentity:string;
  /** Foreground can fall back to original when masking is unavailable. */
  fallbackReason?:string;
  trimStartSeconds?:number;
  trimEndSeconds?:number;
  playbackRate?:number;
}
/** A conceptual slider-crank study. All connected parts derive from one angle. */
export interface DocumentaryLinkedMechanism {
  kind: 'slider-crank';
  centerX: number; centerY: number;
  crankRadius: number; rodLength: number;
  pistonWidth: number; pistonHeight: number;
  /** Angle measured from top dead centre; motion is in complete revolutions. */
  startAngle?: number; turns?: number;
  /** Conceptual, unscaled annotations attached to the moving part and shaft. */
  annotations?: {reciprocatingForce?: boolean; crankTorque?: boolean;
    /** Normalized onset of each cue on the artwork's whole timeline. */
    forceAt?: number; torqueAt?: number};
}
export interface DocumentaryArtwork {
  version: 1;
  /** Authored positions are normalized to relative offsets before storage. */
  motionCoordinates?: 'absolute' | 'relative';
  /** Editorial explanation for review; never burned into the film. */
  intent: string;
  layout: 'full' | 'left' | 'right' | 'overlay';
  canvas: {width: number; height: number};
  palette: {background: string; ink: string; accent: string; secondary: string};
  /** Fixed canvas camera: x/y are the view centre, scale is magnification. */
  camera?: {/** Absent preserves the original segment easing and 1..1.18 zoom. */
    path?: 'continuous';
    keyframes: Array<{t: number; x: number; y: number; scale: number; rotation?: number;
      /** Continuous-path velocity in canvas units (scale/degrees) per whole normalized clock. */
      velocity?: {x?: number; y?: number; scale?: number; rotation?: number}}>};
  /** Ordered causal actions on the SAME artwork/span clock. from/to use the
   * artwork motionCoordinates, just like layer keys. Manual edits stay outside. */
  actions?: Array<{id:string;layerId:string;after?:string;start:number;end:number;
    from:Omit<DocumentaryArtworkKeyframe,'t'|'ease'>;to:Omit<DocumentaryArtworkKeyframe,'t'|'ease'>;
    ease?:'linear'|'out'|'inOut';sound?:'click'|'transition'}>;
  /** Short production storyboard, retained for editing/review, never displayed as a title. */
  direction?: {concept: string; alternatives: string[];
    /** Existing layer IDs bind the proposed observation to executable objects. */
    beats: Array<{at: number; action: string; layerIds?:string[]}>;
    entry?:string;exit?:string;cameraPurpose?:string;depthPurpose?:string;typographyPurpose?:string};
  layers: DocumentaryArtworkLayer[];
  linkedMechanism?: DocumentaryLinkedMechanism;
  /** Scene-local range, constrained to the existing narration timing. */
  startSeconds: number;
  durationSeconds: number;
}
