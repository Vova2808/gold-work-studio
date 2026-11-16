import { documentaryMotionTiming, documentarySceneTransition, selectedDocumentaryBackgroundIds, resolveMusicClips, type DocumentaryArtworkPreparedMaterial, type DocumentaryMotionPresetId, type DocumentarySemanticMontage, type MusicClip, type ProjectSettings } from "@gold-work/shared";
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
  sequenceOffsetFrames?:number;sequenceDurationFrames?:number;
  motion?: 'none' | 'push' | 'pull';
  width?: number; height?: number;
  id: string; fromFrame: number; durationInFrames: number; sourceSceneId?: string;
  trimStartSeconds: number; trimEndSeconds?: number; playbackRate: number;
  videoPath?: string; imagePath?: string; sourceDurationSeconds?: number;
}
export interface DocumentaryMotionGraphic {
  routeComparison?: import('@gold-work/shared').DocumentaryRouteComparison;
  explanation?: import('@gold-work/shared').DocumentaryExplanation;
  artwork?: import('@gold-work/shared').DocumentaryArtwork;
  artworkSpan?: {endSceneId:string};
  diagram?: import('@gold-work/shared').DocumentaryMotionGraphic['diagram'];
  argument?: import('@gold-work/shared').DocumentaryArgument;
  photoMoment?: {captureFrame:number;consequence?:string;consequenceFrame?:number};
  showSource?: boolean;
  hideTitle?: boolean;
  kind: 'map-locator' | 'map-route' | 'chapter-number' | 'chronology' | 'statistic' | 'feature-list' | 'callout' | 'quote' | 'key-point' | 'explainer' | 'annotations' | 'subject-card' | 'bar-chart';
  enabled: boolean; title: string; kicker?: string; value?: string; items?: string[]; activeIndex?: number;
  theme?: 'dark' | 'paper'; sequenceId?: string;
  background?: 'grid-light' | 'grid-dark' | 'diagonal' | 'contours' | 'spotlight';
  variant?: 'clean' | 'collage' | 'marker' | 'technical' | 'poster' | 'date' | 'magnifier';
  preset?: DocumentaryMotionPresetId;
  highlight?: string; isolateSubject?: boolean; cutoutPath?:string;
  quoteMode?:'speech'|'phrase';reading?:{text:string;sourceKey?:string;words:Array<{text:string;startSeconds:number;endSeconds:number}>};readingError?:string;accentColor?:string;
  presentation?: 'list' | 'panels';
  panels?: Array<{sceneId:string;label:string;imagePath?:string}>;
  boardLayout?: 'parts' | 'steps' | 'compare';
  cards?:Array<{label:string;value?:string;sceneId?:string;imagePath?:string}>;
  annotations?:Array<{label:string;confidence?:number;points:Array<{seconds:number;x:number;y:number}>}>;
  sourceChecksum?:string;
  sourceTrimStartSeconds?:number;
  sourcePlaybackRate?:number;
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
  origin?: 'automatic' | 'manual';
  name?: string;
  boundary?: {from:string;to:string;origin:'manual'|'automatic'};
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
  kenBurnsDirection?: "auto" | "in" | "out" | "off"; autoKenBurnsDirection?: "in" | "out" | "pan-left" | "pan-right" | "pan-up" | "pan-down"; autoKenBurnsFocus?: {x:number;y:number}; kenBurnsZoom?: number; autoKenBurnsZoom?: number; fadeEdges?: boolean;
  documentary?: { layout: "full" | "contain" | "compare"; checksum?:string; template?: string; templateMotion?: { amountPercent: number; curve: "smooth" | "dramatic" }; motionGraphic?: DocumentaryMotionGraphic; nativeFallback?:boolean|{version:1}; cuts?: DocumentaryVisualCut[]; texts?: DocumentaryTextClip[]; illustrative?: boolean; illustrationLabelInEditorOnly?:boolean; illustrationFact?: string; requirement?: {visualScopeQuote?:string;illustrationFallbackVersion?:1}; caption: DocumentaryCaption; effects: DocumentaryLayer[];
    semanticMontage?: DocumentarySemanticMontage['scenes'][number]; pinned?:boolean; templateOrigin?:'manual'|'automatic'; cutsOrigin?:'manual'|'automatic';
    transitionStyle?: 'clean'|'blur'|'glitch'; autoTransitionStyle?: 'clean'|'blur'|'glitch'; templateTiming?: {startSeconds:number;durationSeconds:number};
    comparison?: { sceneId: string; leftLabel: string; rightLabel: string; illustrative?: boolean; imagePath?: string; videoPath?: string; trimStartSeconds?: number; trimEndSeconds?: number; playbackRate?: number; durationSeconds?: number };
    timing?: { sourceKey: string; audioPath?: string; audioStartSeconds?: number; audioEndSeconds?: number; durationInFrames: number; speechSeconds: number };
    /** Local render-only assets; never copied from persisted model/project data. */
    artworkMedia?:Record<string,DocumentaryArtworkPreparedMaterial>; artworkMediaFingerprint?:string;
    selected?: { width?: number; height?: number; durationSeconds?: number } };
}
export interface DocumentaryProjectInput {
  aspectRatio: string;
  language?: string;
  scenes: DocumentaryInputScene[];
  settings: { music?: ProjectSettings['music']; voice: { enabled: boolean }; assembly: { kenBurns: boolean; fadeTransitions?: boolean; transitionType?: "none" | "fade" | "mix"; transitionDurationSeconds?: number;
    documentary?: Pick<NonNullable<ProjectSettings['assembly']['documentary']>,'version'|'backgroundColor'|'textColor'|'accentColor'|'captionsEnabled'|'sfxVolume'|'autoTransitions'|'autoEffects'|'montage'|'resolvedBackground'|'resolvedBackgrounds'> } };
}
export interface DocumentaryTimeline extends Record<string, unknown> {
  version: 2; fps: 30; width: number; height: number; durationInFrames: number;
  backgroundColor: string; textColor: string; accentColor: string; captionsEnabled: boolean; sfxVolume: number; illustrationLabel: string;
  music?: {clips:MusicClip[];volume:number;fadeInSeconds:number;fadeOutSeconds:number;ducking:boolean};
  scenes: Array<DocumentaryInputScene & { fromFrame: number; durationInFrames: number; transitionFrames: number; motion: boolean; narrationEnabled: boolean }>;
}
const safeColor = (value: string | undefined, fallback: string) => /^#[0-9a-f]{6}$/i.test(value ?? "") ? value! : fallback;

function documentaryTimelineLayers(scene:DocumentaryInputScene,settings:DocumentaryProjectInput['settings']['assembly']['documentary'],frames:number):DocumentaryLayer[]{
  const layers=scene.documentary?.effects??[],choice=settings?.montage?.background;
  if(choice?.mode==='off')return layers.filter(e=>e.role!=='background'||e.origin!=='automatic');
  if(choice?.mode!=='library')return layers;
  if(layers.some(e=>e.role==='background'&&e.enabled&&e.origin!=='automatic'))return layers;
  const ids=selectedDocumentaryBackgroundIds(choice),requested=ids[((scene.order%ids.length)+ids.length)%ids.length];
  const background=(settings?.resolvedBackgrounds??(settings?.resolvedBackground?[settings.resolvedBackground]:[])).find(item=>item.assetId===requested);
  if(!background)return layers.filter(e=>e.role!=='background'||e.origin!=='automatic');
  const visible=scene.documentary?.layout!=='full'||scene.documentary?.template&&scene.documentary.template!=='full'||scene.documentary?.motionGraphic?.enabled;
  if(!visible)return layers.filter(e=>e.role!=='background');
  return [{id:`montage-background-${background.assetId}`,filePath:background.path,kind:background.kind,role:'background',origin:'automatic',enabled:true,
    startSeconds:0,durationSeconds:frames/30,x:0,y:0,scale:1,blend:'normal',defaults:{opacity:100,volume:0,sourceAudio:false,trimStartSeconds:0,
      trimEndSeconds:background.durationSeconds,fadeInSeconds:0,fadeOutSeconds:0}},...layers.filter(e=>e.role!=='background')];
}

function timelineSemanticMontage(scene:DocumentaryInputScene){
  const doc=scene.documentary;
  if(!doc||doc.pinned||doc.layout==='compare'&&doc.comparison||doc.templateOrigin==='manual'
    ||doc.template&&doc.templateOrigin!=='automatic'||doc.motionGraphic&&doc.motionGraphic.origin!=='automatic'
    ||doc.cuts?.length&&doc.cutsOrigin!=='automatic'||doc.texts?.length||doc.caption.enabled
    ||doc.effects.some(effect=>effect.enabled&&effect.kind!=='audio'&&effect.origin!=='automatic'))return undefined;
  return doc.semanticMontage?{...doc.semanticMontage}:undefined;
}

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
      playbackRate: scene.playbackRate, kenBurnsDirection: scene.kenBurnsDirection, autoKenBurnsDirection:scene.autoKenBurnsDirection, autoKenBurnsFocus:scene.autoKenBurnsFocus, kenBurnsZoom: scene.kenBurnsZoom, autoKenBurnsZoom: scene.autoKenBurnsZoom, fadeEdges: scene.fadeEdges,
      fromFrame: cursor, durationInFrames, transitionFrames, transition, motion: project.settings.assembly.kenBurns, narrationEnabled: project.settings.voice.enabled,
      imagePath: scene.imagePath ? mediaUrl(scene.imagePath) : undefined, videoPath: scene.videoPath ? mediaUrl(scene.videoPath) : undefined,
      audioPath: scene.audioPath ? mediaUrl(scene.audioPath) : undefined,
      documentary: scene.documentary ? { layout: scene.documentary.layout, template: scene.documentary.template, templateMotion: scene.documentary.templateMotion, nativeFallback:Boolean(scene.documentary.nativeFallback), illustrative: scene.documentary.illustrative&&!scene.documentary.illustrationLabelInEditorOnly,
        templateOrigin:scene.documentary.templateOrigin,pinned:scene.documentary.pinned,cutsOrigin:scene.documentary.cutsOrigin,
        semanticMontage:timelineSemanticMontage(scene),
        illustrationFact:scene.documentary.illustrative&&!scene.documentary.illustrationLabelInEditorOnly&&scene.documentary.requirement?.illustrationFallbackVersion===1
          ?scene.documentary.requirement.visualScopeQuote:undefined,caption: { ...scene.documentary.caption },
        templateTiming: scene.documentary.templateTiming ? {...scene.documentary.templateTiming} : undefined,
        transitionStyle: scene.transition !== undefined ? scene.documentary.transitionStyle ?? 'clean'
          : (settings?.autoTransitions ?? settings?.autoEffects) !== false && scene.autoTransition !== undefined ? scene.documentary.autoTransitionStyle ?? 'clean' : 'clean',
        texts: scene.documentary.texts?.map(text=>({...text})), motionGraphic: scene.documentary.motionGraphic ? {...scene.documentary.motionGraphic,
          ...documentaryMotionTiming(scene.documentary.motionGraphic,durationInFrames/30),
          enabled:scene.documentary.motionGraphic.enabled&&!(scene.documentary.motionGraphic.kind==='annotations'&&
            (scene.documentary.cuts?.length||scene.documentary.motionGraphic.sourceChecksum&&scene.documentary.motionGraphic.sourceChecksum!==scene.documentary.checksum)),
          annotations:scene.documentary.motionGraphic.annotations?.map(annotation=>({...annotation,
            confidence:scene.documentary?.motionGraphic?.origin==='automatic'&&scene.videoPath&&
              (scene.documentary?.motionGraphic?.sourceTrimStartSeconds!==(scene.trimStartSeconds??0)||scene.documentary?.motionGraphic?.sourcePlaybackRate!==(scene.playbackRate??1))
              ?undefined:annotation.confidence})),
          // Automatic pointers stay on the original image, without an expensive
          // segmentation pass or a second coordinate system.
          reading: scene.documentary.motionGraphic.reading?.sourceKey && scene.documentary.motionGraphic.reading.sourceKey === scene.documentary.timing?.sourceKey
            ? scene.documentary.motionGraphic.reading : undefined,
          isolateSubject:scene.documentary.motionGraphic.kind==='annotations'&&scene.documentary.motionGraphic.origin==='automatic'?false:scene.documentary.motionGraphic.isolateSubject,
          cutoutPath:scene.documentary.motionGraphic.cutoutPath&&!(scene.documentary.motionGraphic.kind==='annotations'&&scene.documentary.motionGraphic.origin==='automatic')?mediaUrl(scene.documentary.motionGraphic.cutoutPath):undefined,
          panels:scene.documentary.motionGraphic.panels?.map(panel=>{const source=project.scenes.find(s=>s.id===panel.sceneId);return {...panel,imagePath:source?.imagePath?mediaUrl(source.imagePath):undefined};}),
          cards:scene.documentary.motionGraphic.cards?.map(card=>{const source=project.scenes.find(s=>s.id===card.sceneId);const image=scene.documentary?.motionGraphic?.isolateSubject?source?.documentary?.motionGraphic?.cutoutPath??source?.imagePath:source?.imagePath;return {...card,imagePath:image?mediaUrl(image):undefined};}),
          detail:scene.documentary.motionGraphic.detail?{...scene.documentary.motionGraphic.detail,imagePath:mediaUrl(scene.documentary.motionGraphic.detail.imagePath)}:undefined}:undefined,
        cuts: scene.documentary.cuts?.map(cut=>{
          const source = cut.sourceSceneId ? project.scenes.find(item=>item.id===cut.sourceSceneId) : scene;
          return {...cut,width:source?.documentary?.selected?.width,height:source?.documentary?.selected?.height,videoPath:source?.videoPath?mediaUrl(source.videoPath):undefined,imagePath:source?.imagePath?mediaUrl(source.imagePath):undefined,sourceDurationSeconds:source?.documentary?.selected?.durationSeconds};
        }),
        selected: scene.documentary.selected ? { width: scene.documentary.selected.width, height: scene.documentary.selected.height, durationSeconds: scene.documentary.selected.durationSeconds } : undefined,
        timing: scene.documentary.timing ? { ...scene.documentary.timing, audioPath: scene.documentary.timing.audioPath ? mediaUrl(scene.documentary.timing.audioPath) : undefined } : undefined,
        comparison: comparison ? { ...comparison, illustrative: comparisonScene?.documentary?.illustrative === true&&!comparisonScene.documentary.illustrationLabelInEditorOnly, imagePath: comparisonScene?.imagePath ? mediaUrl(comparisonScene.imagePath) : undefined,
          videoPath: comparisonScene?.videoPath ? mediaUrl(comparisonScene.videoPath) : undefined, trimStartSeconds: comparisonScene?.trimStartSeconds,
          trimEndSeconds: comparisonScene?.trimEndSeconds, playbackRate: comparisonScene?.playbackRate, durationSeconds: comparisonScene?.documentary?.selected?.durationSeconds } : undefined,
        effects: documentaryTimelineLayers(scene,settings,durationInFrames).map(effect => ({ ...effect, defaults: { ...effect.defaults }, filePath: mediaUrl(effect.filePath) })) } : undefined };
    cursor += durationInFrames;
    return mapped;
  });
  // Both sides need a readable hold. A short incoming shot must not end
  // while it is still dissolving from the previous one. Use included order.
  for(let index=0;index+1<scenes.length;index++){
    scenes[index]!.transitionFrames=Math.min(scenes[index]!.transitionFrames,Math.floor(scenes[index+1]!.durationInFrames/3));
  }
  // A full illustrative insert may continue into the same adjacent photo.
  // Reuse one camera clock so that a scene boundary cannot reset its crop.
  const photoCuts=scenes.flatMap(s=>(s.documentary?.cuts??[]).map(c=>({scene:s,cut:c,from:s.fromFrame+c.fromFrame})))
    .sort((a,b)=>a.from-b.from);
  for(const p of photoCuts){delete p.cut.sequenceOffsetFrames;delete p.cut.sequenceDurationFrames;}
  for(let first=0;first<photoCuts.length;first++){
    const start=photoCuts[first]!;
    if(!start.scene.documentary?.semanticMontage||!start.cut.imagePath||start.cut.videoPath||start.cut.motion!=='push')continue;
    let last=first;
    while(last+1<photoCuts.length){
      const left=photoCuts[last]!,right=photoCuts[last+1]!;
      if(!right.scene.documentary?.semanticMontage||left.from+left.cut.durationInFrames!==right.from||right.cut.imagePath!==start.cut.imagePath||right.cut.videoPath||right.cut.motion!=='push')break;
      last++;
    }
    if(last>first&&photoCuts.slice(first,last+1).some(p=>p.scene.documentary?.semanticMontage?.cutawayMode==='replace')){
      const end=photoCuts[last]!.from+photoCuts[last]!.cut.durationInFrames;
      for(let i=first;i<=last;i++){photoCuts[i]!.cut.sequenceOffsetFrames=photoCuts[i]!.from-start.from;photoCuts[i]!.cut.sequenceDurationFrames=end-start.from;}
    }
    first=last;
  }
  // Derive from the current order and measured voice, never persist stale offsets.
  // Whole-object edits retain an artwork span's clock while marking it manual
  // so later automatic planning cannot replace the user's drawing.
  const sequenceKey = (g?: DocumentaryMotionGraphic) => g?.enabled && !g.argument && !g.explanation && g.kind!=='chapter-number' && g.sequenceId && (g.origin === 'automatic' || g.artwork) && g.startSeconds === 0
    ? JSON.stringify([g.sequenceId,g.kind,g.title,g.value,g.items,g.theme,g.variant,g.preset,g.highlight,g.accentColor,g.quoteMode,g.presentation,g.panels?.map(p=>[p.sceneId,p.label]),g.cards,g.boardLayout,g.route,g.artwork,g.artworkSpan]) : undefined;
  for(const scene of scenes){
    const g=scene.documentary?.motionGraphic;
    if(g){delete g.sequenceOffsetFrames;delete g.sequenceDurationFrames;}
  }
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
        if(g.artworkSpan&&i<last){s.transition='none';s.transitionFrames=0;}
      }
    }
    first=last+1;
  }
  return { version: 2, fps: 30, width: project.aspectRatio === "9:16" ? 720 : project.aspectRatio === "1:1" ? 900 : 1920,
    height: project.aspectRatio === "9:16" ? 1280 : project.aspectRatio === "1:1" ? 900 : 1080, durationInFrames: Math.max(1, cursor), scenes,
    music: project.settings.music && project.settings.music.enabled !== false ? {
      clips:resolveMusicClips(project.settings.music,cursor/30).map(clip=>({...clip,path:clip.path?mediaUrl(clip.path):undefined})),
      volume:Math.max(0,Math.min(100,project.settings.music.volume)),
      fadeInSeconds:Math.max(0,Math.min(cursor/60,project.settings.music.fadeInSeconds??1)),
      fadeOutSeconds:Math.max(0,Math.min(cursor/60,project.settings.music.fadeOutSeconds??2)),ducking:project.settings.music.ducking!==false
    }:undefined,
    backgroundColor: safeColor(settings?.backgroundColor, "#161a20"), textColor: safeColor(settings?.textColor, "#ffffff"), accentColor: safeColor(settings?.accentColor, "#84c6db"),
    illustrationLabel: /^(ru(?:[-_]|$)|russian$|рус)/i.test(project.language ?? "ru") ? "Иллюстрация" : "Illustration",
    captionsEnabled: settings?.captionsEnabled ?? true, sfxVolume: Math.max(0, Math.min(100, settings?.sfxVolume ?? 25)) };
}
export const DEFAULT_DOCUMENTARY_TIMELINE = buildDocumentaryTimeline({ aspectRatio: "16:9", scenes: [], settings: { voice: { enabled: false }, assembly: { kenBurns: false } } });
