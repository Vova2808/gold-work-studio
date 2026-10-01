export { MediaSurface, resolveMediaSource } from "./MediaSurface.js";
export { DocumentaryVideo } from "./DocumentaryVideo.js";
export {documentaryMusicGain,documentaryMusicGainExpression,documentarySpeechRanges} from './documentary-music.js';
export { documentaryRouteBounds, documentaryRouteKey, documentaryRouteGeometry, documentaryRouteLabels } from "./documentary-route.js";
export { buildDocumentaryTimeline, DEFAULT_DOCUMENTARY_TIMELINE, type DocumentaryTimeline, type DocumentaryProjectInput } from "./documentary-timeline.js";
export { RemotionRoot, UNIVERSAL_COMPOSITION_ID } from "./Root.js";
export { UniversalVideo } from "./UniversalVideo.js";
export {
  DOCUMENTARY_PALETTES,
  selectDocumentaryPalette,
  selectProjectDocumentaryPalette,
  type DocumentaryPalette,
} from "./palette.js";
export {
  CompareSplitTemplate,
  EvidenceCardTemplate,
  FactCardTemplate,
  FocusTextTemplate,
  FullMediaTemplate,
  QuickMontageTemplate,
  StatCalloutTemplate,
  EditorialPanelTemplate,
  ChapterCardTemplate,
  QuoteCardTemplate,
  ChecklistGridTemplate,
  TimelineLinksTemplate,
  UniversalTemplate,
} from "./templates.js";
export {
  DEFAULT_TIMELINE,
  classifyMediaSource,
  getBeatFrameRange,
  getTimelineDimensions,
  getTimelineDurationInFrames,
  normalizeUniversalTimeline,
  toStagedAssetPath,
} from "./timeline.js";
export {
  MOTION_KINDS,
  TRANSITION_KINDS,
  UNIVERSAL_TEMPLATE_IDS,
  type BeatMotion,
  type BeatTransition,
  type MotionKind,
  type TimelineDimensions,
  type TimelineMedia,
  type TimelineText,
  type TimelineTextItem,
  type TransitionKind,
  type UniversalTemplateId,
  type UniversalTimeline,
  type UniversalVisualBeat,
} from "./types.js";
