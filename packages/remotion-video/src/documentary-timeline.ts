import { documentarySceneTransition, type ProjectSettings } from "@gold-work/shared";
/** Structural input keeps this composition independent of the app's storage and providers. */
export interface DocumentaryCaption {
  text: string; enabled: boolean; position: "top" | "bottom" | "center";
  animation: "fade" | "slide" | "typing"; fontSize: number; color: string; backgroundColor: string; opacity: number;
}
export interface DocumentaryTextClip extends Omit<DocumentaryCaption,"position"|"animation"> {
  backgroundOpacity?: number;
  id: string; startSeconds: number; durationSeconds: number; x: number; y: number;
  animation: "fade" | "slide" | "zoom" | "typing"; fadeInSeconds: number; fadeOutSeconds: number;
}
export interface DocumentaryVisualCut {
  id: string; fromFrame: number; durationInFrames: number; sourceSceneId?: string;
  trimStartSeconds: number; trimEndSeconds?: number; playbackRate: number;
  videoPath?: string; imagePath?: string; sourceDurationSeconds?: number;
}
export interface DocumentaryMotionGraphic {
  kind: 'map-locator' | 'map-route' | 'chapter-number' | 'chronology' | 'statistic' | 'feature-list' | 'callout' | 'quote' | 'key-point' | 'explainer' | 'annotations' | 'subject-card' | 'bar-chart';
  enabled: boolean; title: string; kicker?: string; value?: string; items?: string[]; activeIndex?: number;
  theme?: 'dark' | 'paper'; sequenceId?: string;
  background?: 'grid-light' | 'grid-dark' | 'diagonal' | 'contours' | 'spotlight';
  variant?: 'clean' | 'collage' | 'marker' | 'technical' | 'poster';
  highlight?: string; isolateSubject?: boolean; cutoutPath?:string;
  quoteMode?:'speech'|'phrase';reading?:{text:string;sourceKey?:string;words:Array<{text:string;startSeconds:number;endSeconds:number}>};readingError?:string;accentColor?:string;
  presentation?: 'list' | 'panels';
  panels?: Array<{sceneId:string;label:string;imagePath?:string}>;
  boardLayout?: 'parts' | 'steps' | 'compare';
  cards?:Array<{label:string;value?:string;sceneId?:string;imagePath?:string}>;
  annotations?:Array<{label:string;points:Array<{seconds:number;x:number;y:number}>}>;
  sourceChecksum?:string;
  sequenceOffsetFrames?: number; sequenceDurationFrames?: number;
  place?: {name:string;latitude:number;longitude:number;country?:string;source?:string};
  fromPlace?: {name:string;latitude:number;longitude:number;country?:string;source?:string};
  route?: Array<{name:string;latitude:number;longitude:number;country?:string;source?:string}>;
  startSeconds: number; durationSeconds: number; anchorX?: number; anchorY?: number; zoom?: number;
  mapStyle?: 'full' | 'inset';
  mapRadiusKm?: number;
  cameraZoom?: number;
  regionRadiusKm?: number;
  cityDetail?: boolean;
  detail?: {imagePath:string;latitude:number;longitude:number;radiusKm:number;featureCount:number;createdAt:string;kind?:'satellite';attribution?:string;imageryDate?:string;sourceUrl?:string;license?:string;bounds?:[number,number,number,number];routeKey?:string};
  detailError?: string;
  origin?: 'automatic' | 'manual';
}
export interface DocumentaryLayer {
  id: string; filePath: string; kind: "image" | "video" | "audio";
  role: "background" | "overlay" | "transition" | "sound"; enabled: boolean;
  startSeconds: number; durationSeconds: number; x: number; y: number; scale: number;
  blend: "normal" | "screen" | "add" | "multiply";
  defaults: { opacity: number; volume: number; sourceAudio: boolean; trimStartSeconds: number; trimEndSeconds?: number; fadeInSeconds: number; fadeOutSeconds: number };
}
export interface DocumentaryInputScene {
  id: string; order: number; durationSeconds: number; durationOverrideSeconds?: number; includeInAssembly?: boolean;
  imagePath?: string; videoPath?: string; audioPath?: string; narrationVolume?: number; sourceVolume?: number;
  trimStartSeconds?: number; trimEndSeconds?: number; playbackRate?: number; transition?: "none" | "fade" | "mix"; transitionDurationSeconds?: number;
  autoTransition?: "none" | "fade" | "mix"; autoTransitionDurationSeconds?: number;
  kenBurnsDirection?: "auto" | "in" | "out" | "off"; autoKenBurnsDirection?: "in" | "out" | "pan-left" | "pan-right"; kenBurnsZoom?: number; autoKenBurnsZoom?: number; fadeEdges?: boolean;
  documentary?: { layout: "full" | "contain" | "compare"; template?: string; templateMotion?: { amountPercent: number; curve: "smooth" | "dramatic" }; motionGraphic?: DocumentaryMotionGraphic; cuts?: DocumentaryVisualCut[]; texts?: DocumentaryTextClip[]; illustrative?: boolean; caption: DocumentaryCaption; effects: DocumentaryLayer[];
    transitionStyle?: 'clean'|'blur'; autoTransitionStyle?: 'clean'|'blur'; templateTiming?: {startSeconds:number;durationSeconds:number};
    comparison?: { sceneId: string; leftLabel: string; rightLabel: string; illustrative?: boolean; imagePath?: string; videoPath?: string; trimStartSeconds?: number; trimEndSeconds?: number; playbackRate?: number; durationSeconds?: number };
    timing?: { sourceKey: string; audioPath?: string; audioStartSeconds?: number; audioEndSeconds?: number; durationInFrames: number; speechSeconds: number };
    selected?: { width?: number; height?: number; durationSeconds?: number } };
}
export interface DocumentaryProjectInput {
  aspectRatio: string;
  language?: string;
  scenes: DocumentaryInputScene[];
  settings: { music?: ProjectSettings['music']; voice: { enabled: boolean }; assembly: { kenBurns: boolean; fadeTransitions?: boolean; transitionType?: "none" | "fade" | "mix"; transitionDurationSeconds?: number;
    documentary?: { version: 2; backgroundColor: string; textColor: string; accentColor: string; captionsEnabled: boolean; sfxVolume: number; autoTransitions?: boolean; autoEffects?: boolean } } };
}
export interface DocumentaryTimeline extends Record<string, unknown> {
  version: 2; fps: 30; width: number; height: number; durationInFrames: number;
  backgroundColor: string; textColor: string; accentColor: string; captionsEnabled: boolean; sfxVolume: number; illustrationLabel: string;
  music?: {path:string;volume:number;fadeInSeconds:number;fadeOutSeconds:number;ducking:boolean};
  scenes: Array<DocumentaryInputScene & { fromFrame: number; durationInFrames: number; transitionFrames: number; motion: boolean; narrationEnabled: boolean }>;
}
const safeColor = (value: string | undefined, fallback: string) => /^#[0-9a-f]{6}$/i.test(value ?? "") ? value! : fallback;

export function buildDocumentaryTimeline(project: DocumentaryProjectInput, mediaUrl: (path: string) => string = path => path): DocumentaryTimeline {
  const settings = project.settings.assembly.documentary;
  let cursor = 0;
  const scenes = [...project.scenes].sort((a, b) => a.order - b.order).filter(scene => scene.includeInAssembly !== false).map(scene => {
    const minimum = scene.documentary?.timing?.durationInFrames ?? Math.ceil(scene.durationSeconds * 30);
    const durationInFrames = Math.max(1, minimum, Math.ceil((scene.durationOverrideSeconds ?? 0) * 30));
    const resolved = documentarySceneTransition(scene, project.settings.assembly), transition = resolved.kind;
    const transitionFrames = transition === "none" ? 0 : Math.min(Math.floor(durationInFrames / 3), Math.round(resolved.durationSeconds * 30));
    const comparisonScene = project.scenes.find(other => other.id === scene.documentary?.comparison?.sceneId);
    const comparison = scene.documentary?.comparison;
    // The renderer needs editing/timing fields, never search candidates, reviews,
    // source responses or the full script. Do not spread the persisted Scene.
    const mapped = { id: scene.id, order: scene.order, durationSeconds: scene.durationSeconds, durationOverrideSeconds: scene.durationOverrideSeconds,
      narrationVolume: scene.narrationVolume, sourceVolume: scene.sourceVolume, trimStartSeconds: scene.trimStartSeconds, trimEndSeconds: scene.trimEndSeconds,
      playbackRate: scene.playbackRate, kenBurnsDirection: scene.kenBurnsDirection, autoKenBurnsDirection:scene.autoKenBurnsDirection, kenBurnsZoom: scene.kenBurnsZoom, autoKenBurnsZoom: scene.autoKenBurnsZoom, fadeEdges: scene.fadeEdges,
      fromFrame: cursor, durationInFrames, transitionFrames, transition, motion: project.settings.assembly.kenBurns, narrationEnabled: project.settings.voice.enabled,
      imagePath: scene.imagePath ? mediaUrl(scene.imagePath) : undefined, videoPath: scene.videoPath ? mediaUrl(scene.videoPath) : undefined,
      audioPath: scene.audioPath ? mediaUrl(scene.audioPath) : undefined,
      documentary: scene.documentary ? { layout: scene.documentary.layout, template: scene.documentary.template, templateMotion: scene.documentary.templateMotion, illustrative: scene.documentary.illustrative, caption: { ...scene.documentary.caption },
        templateTiming: scene.documentary.templateTiming ? {...scene.documentary.templateTiming} : undefined,
        transitionStyle: scene.transition !== undefined ? scene.documentary.transitionStyle ?? 'clean'
          : (settings?.autoTransitions ?? settings?.autoEffects) !== false && scene.autoTransition !== undefined ? scene.documentary.autoTransitionStyle ?? 'clean' : 'clean',
        texts: scene.documentary.texts?.map(text=>({...text})), motionGraphic: scene.documentary.motionGraphic ? {...scene.documentary.motionGraphic,
          reading: scene.documentary.motionGraphic.reading?.sourceKey && scene.documentary.motionGraphic.reading.sourceKey === scene.documentary.timing?.sourceKey
            ? scene.documentary.motionGraphic.reading : undefined,
          cutoutPath:scene.documentary.motionGraphic.cutoutPath?mediaUrl(scene.documentary.motionGraphic.cutoutPath):undefined,
          panels:scene.documentary.motionGraphic.panels?.map(panel=>{const source=project.scenes.find(s=>s.id===panel.sceneId);return {...panel,imagePath:source?.imagePath?mediaUrl(source.imagePath):undefined};}),
          cards:scene.documentary.motionGraphic.cards?.map(card=>{const source=project.scenes.find(s=>s.id===card.sceneId);return {...card,imagePath:source?.imagePath?mediaUrl(source.imagePath):undefined};}),
          detail:scene.documentary.motionGraphic.detail?{...scene.documentary.motionGraphic.detail,imagePath:mediaUrl(scene.documentary.motionGraphic.detail.imagePath)}:undefined}:undefined,
        cuts: scene.documentary.cuts?.map(cut=>{
          const source = cut.sourceSceneId ? project.scenes.find(item=>item.id===cut.sourceSceneId) : scene;
          return {...cut,videoPath:source?.videoPath?mediaUrl(source.videoPath):undefined,imagePath:source?.imagePath?mediaUrl(source.imagePath):undefined,sourceDurationSeconds:source?.documentary?.selected?.durationSeconds};
        }),
        selected: scene.documentary.selected ? { width: scene.documentary.selected.width, height: scene.documentary.selected.height, durationSeconds: scene.documentary.selected.durationSeconds } : undefined,
        timing: scene.documentary.timing ? { ...scene.documentary.timing, audioPath: scene.documentary.timing.audioPath ? mediaUrl(scene.documentary.timing.audioPath) : undefined } : undefined,
        comparison: comparison ? { ...comparison, illustrative: comparisonScene?.documentary?.illustrative === true, imagePath: comparisonScene?.imagePath ? mediaUrl(comparisonScene.imagePath) : undefined,
          videoPath: comparisonScene?.videoPath ? mediaUrl(comparisonScene.videoPath) : undefined, trimStartSeconds: comparisonScene?.trimStartSeconds,
          trimEndSeconds: comparisonScene?.trimEndSeconds, playbackRate: comparisonScene?.playbackRate, durationSeconds: comparisonScene?.documentary?.selected?.durationSeconds } : undefined,
        effects: scene.documentary.effects.map(effect => ({ ...effect, defaults: { ...effect.defaults }, filePath: mediaUrl(effect.filePath) })) } : undefined };
    cursor += durationInFrames;
    return mapped;
  });
  // Derive from the current order and measured voice, never persist stale offsets.
  const sequenceKey = (g?: DocumentaryMotionGraphic) => g?.enabled && g.sequenceId && g.origin === 'automatic' && g.startSeconds === 0
    ? JSON.stringify([g.sequenceId,g.kind,g.title,g.value,g.items,g.theme,g.presentation,g.panels?.map(p=>[p.sceneId,p.label]),g.cards,g.boardLayout,g.route]) : undefined;
  for (let first=0;first<scenes.length;) {
    const key=sequenceKey(scenes[first]!.documentary?.motionGraphic);
    if (!key) { first++; continue; }
    let last=first;
    while(last+1<scenes.length&&sequenceKey(scenes[last+1]!.documentary?.motionGraphic)===key)last++;
    if(last>first){
      const start=scenes[first]!.fromFrame,end=scenes[last]!.fromFrame+scenes[last]!.durationInFrames;
      for(let i=first;i<=last;i++){
        const s=scenes[i]!,g=s.documentary!.motionGraphic!;
        g.sequenceOffsetFrames=s.fromFrame-start;g.sequenceDurationFrames=end-start;
      }
    }
    first=last+1;
  }
  return { version: 2, fps: 30, width: project.aspectRatio === "9:16" ? 720 : project.aspectRatio === "1:1" ? 900 : 1920,
    height: project.aspectRatio === "9:16" ? 1280 : project.aspectRatio === "1:1" ? 900 : 1080, durationInFrames: Math.max(1, cursor), scenes,
    music: project.settings.music?.enabled !== false && project.settings.music?.path?.trim() ? {
      path:mediaUrl(project.settings.music.path),volume:Math.max(0,Math.min(100,project.settings.music.volume)),
      fadeInSeconds:Math.max(0,Math.min(cursor/60,project.settings.music.fadeInSeconds??1)),
      fadeOutSeconds:Math.max(0,Math.min(cursor/60,project.settings.music.fadeOutSeconds??2)),ducking:project.settings.music.ducking!==false
    }:undefined,
    backgroundColor: safeColor(settings?.backgroundColor, "#161a20"), textColor: safeColor(settings?.textColor, "#ffffff"), accentColor: safeColor(settings?.accentColor, "#84c6db"),
    illustrationLabel: /^(ru(?:[-_]|$)|russian$|рус)/i.test(project.language ?? "ru") ? "Иллюстративные кадры" : "Illustrative footage",
    captionsEnabled: settings?.captionsEnabled ?? true, sfxVolume: Math.max(0, Math.min(100, settings?.sfxVolume ?? 25)) };
}
export const DEFAULT_DOCUMENTARY_TIMELINE = buildDocumentaryTimeline({ aspectRatio: "16:9", scenes: [], settings: { voice: { enabled: false }, assembly: { kenBurns: false } } });
