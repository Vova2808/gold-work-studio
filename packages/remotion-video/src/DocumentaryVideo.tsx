import type { CSSProperties } from "react";
import {useMemo} from 'react';
import {DocumentaryMusicAudio} from './DocumentaryMusicAudio.js';
import {documentaryLayoutPreset,documentaryMotionPresetFor} from '@gold-work/shared';
import {DocumentaryMotionPreset} from './DocumentaryMotionPreset.js';
import {DocumentaryArgumentSequence} from './DocumentaryArgumentSequence.js';
import {DocumentaryExplanation} from './DocumentaryExplanation.js';
import {DocumentaryPhotoMoment} from './DocumentaryPhotoMoment.js';
import {DocumentaryPresetDecor} from './DocumentaryPresetDecor.js';
import {fitDocumentaryText} from './documentary-typography.js';
import { AbsoluteFill, Audio, Freeze, Img, OffthreadVideo, Sequence, Loop, useCurrentFrame } from "remotion";
import { resolveMediaSource } from "./MediaSurface.js";
import type { DocumentaryLayer, DocumentaryTimeline } from "./documentary-timeline.js";
import { documentaryDesign, documentaryEase, documentaryPhotoCutTransform, documentaryPhotoFocus, documentaryPhotoTransform } from "./documentary-design.js";
import type { DocumentaryTextClip } from "./documentary-timeline.js";
import { DocumentaryMotionGraphic, motionMediaStyle } from './DocumentaryMotionGraphic.js';
import {DocumentaryFocusPanels} from './DocumentaryFocusPanels.js';
import {DocumentaryDetail} from './DocumentaryDetail.js';
import {DocumentaryExplainer,DocumentaryAnnotations,documentarySingleImageCard} from './DocumentaryExplainer.js';
import {annotationInsets} from './documentary-annotation-position.js';
import {DocumentaryStyledMaterial,DocumentaryBackground} from './DocumentaryBackground.js';
import {DocumentaryEditorialGraphic} from './DocumentaryEditorialGraphic.js';
import {DocumentaryComparisonBoard} from './DocumentaryComparisonBoard.js';
import {DocumentaryEditorialScene} from './DocumentaryEditorialScene.js';
import {DocumentaryStudioScene} from './DocumentaryStudioScene.js';
import {isDocumentaryStudioTemplate} from '@gold-work/shared';
import {documentaryDramaticTreatment} from './documentary-dramatic-treatment.js';
import {DocumentaryMagnifier} from './DocumentaryMagnifier.js';
import {DocumentaryDiagram} from './DocumentaryDiagram.js';
import {DocumentaryObjectBoard,documentaryObjectBoard} from './DocumentaryObjectBoard.js';
import {DocumentaryArtwork} from './DocumentaryArtwork.js';
import {DocumentaryGlitchSeam} from './DocumentaryGlitchSeam.js';

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
function envelope(frame: number, duration: number, fadeIn: number, fadeOut: number) {
  return Math.min(fadeIn > 0 ? clamp(frame / fadeIn) : 1, fadeOut > 0 ? clamp((duration - 1 - frame) / fadeOut) : 1);
}
function Layer({ layer, timeline, narration }: { layer: DocumentaryLayer; timeline: DocumentaryTimeline; narration: boolean }) {
  const frame = useCurrentFrame();
  const length = Math.max(1, Math.round(layer.durationSeconds * timeline.fps));
  const fade = envelope(frame, length, layer.defaults.fadeInSeconds * timeline.fps, layer.defaults.fadeOutSeconds * timeline.fps);
  const volume = clamp(layer.defaults.volume / 100) * timeline.sfxVolume / 100 * (narration ? 0.6 : 1);
  const volumeAt = (f: number) => volume * envelope(f, length, layer.defaults.fadeInSeconds * timeline.fps, layer.defaults.fadeOutSeconds * timeline.fps);
  const start = Math.max(0, Math.round(layer.defaults.trimStartSeconds * timeline.fps));
  const end = layer.defaults.trimEndSeconds === undefined ? undefined : Math.max(start + 1, Math.round(layer.defaults.trimEndSeconds * timeline.fps));
  if (layer.kind === "audio") return <Audio src={resolveMediaSource(layer.filePath)} trimBefore={start} trimAfter={end} volume={volumeAt} />;
  const style: CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };
  return <AbsoluteFill style={{ opacity: clamp(layer.defaults.opacity / 100) * fade,
    mixBlendMode: layer.blend === "add" ? "plus-lighter" : layer.blend, transform: `translate(${layer.x}%,${layer.y}%) scale(${layer.scale})`, pointerEvents: "none" }}>
    {layer.kind === "image" ? <Img src={resolveMediaSource(layer.filePath)} style={style} />
      : layer.role==='background'&&end ? <Loop durationInFrames={end-start}><OffthreadVideo src={resolveMediaSource(layer.filePath)} trimBefore={start} trimAfter={end} muted style={style}/></Loop>
      : <OffthreadVideo src={resolveMediaSource(layer.filePath)} trimBefore={start} trimAfter={end} muted={layer.role==='background'||!layer.defaults.sourceAudio} volume={volumeAt} style={style} />}
  </AbsoluteFill>;
}
function Material({ videoPath, imagePath, start = 0, end, rate = 1, sourceDuration, muted = true, volume = 0, style }: { videoPath?: string; imagePath?: string; start?: number; end?: number; rate?: number; sourceDuration?: number; muted?: boolean; volume?: number; style: CSSProperties }) {
  const frame = useCurrentFrame();
  if (!videoPath) return imagePath ? <Img src={resolveMediaSource(imagePath)} style={style} /> : null;
  if (sourceDuration !== undefined) end = Math.min(end ?? sourceDuration, sourceDuration);
  const startFrame = Math.round(start * 30), endFrame = end === undefined ? undefined : Math.round(end * 30);
  const visibleFrames = Math.max(1, Math.ceil(((endFrame ?? 86400 * 30) - startFrame) / rate));
  const finalFrame = rate === 1
    ? Math.max(0, Math.floor(((end ?? sourceDuration ?? 86400) - start) * 30) - 1)
    : visibleFrames - 1;
  // OffthreadVideo's trimAfter bounds its Sequence in composition frames;
  // playbackRate only changes extraction time, not that Sequence's duration.
  const video = <OffthreadVideo src={resolveMediaSource(videoPath)} trimBefore={startFrame} trimAfter={endFrame === undefined ? undefined : startFrame + visibleFrames} playbackRate={rate} muted={muted || frame >= finalFrame} volume={volume} style={style} />;
  return frame > finalFrame ? <Freeze frame={finalFrame}>{video}</Freeze> : video;
}
function DocumentaryFrame({ scene, timeline, visualOnly = false }: { scene: DocumentaryTimeline["scenes"][number]; timeline: DocumentaryTimeline; visualOnly?: boolean }) {
  const frame = useCurrentFrame(), original = scene.documentary;
  const dramatic=documentaryDramaticTreatment(original?.semanticMontage,frame,scene.durationInFrames,timeline.fps,original?.motionGraphic?.enabled?original.motionGraphic.startSeconds:.25);
  const templateFrame=frame-Math.round((original?.templateTiming?.startSeconds??0)*30);
  const templateFrames=original?.templateTiming?Math.max(1,Math.round(original.templateTiming.durationSeconds*30)):scene.durationInFrames;
  const templateActive=!original?.templateTiming||templateFrame>=0&&templateFrame<templateFrames;
  const doc=!templateActive&&original?{...original,layout:'full' as const,template:'full' as const,comparison:undefined,caption:{...original.caption,enabled:false}}:original;
  const graphic=doc?.motionGraphic, graphicStart=Math.round((graphic?.startSeconds??0)*30);
  const graphicFrames=Math.min(Math.max(1,Math.round((graphic?.durationSeconds??0)*30)),scene.durationInFrames-graphicStart);
  const graphicActive=Boolean(graphic?.enabled&&frame>=graphicStart&&frame<graphicStart+graphicFrames);
  const graphicFrame=frame-graphicStart+(graphic?.sequenceOffsetFrames??0);
  const graphicTotal=graphic?.sequenceDurationFrames??graphicFrames;
  const standaloneArtwork=Boolean(graphic?.artwork?.layout==='full'&&!graphic.artwork.layers.some(layer=>layer.kind==='media'));
  // Material-bound comparisons belong to the image board. A text preset must
  // not silently discard the two sources resolved by the montage planner.
  const imageComparison=graphic?.kind==='explainer'&&graphic.boardLayout==='compare'&&(graphic.cards?.filter(card=>card.imagePath).length??0)>=2;
  const singleImageCard=graphic&&documentarySingleImageCard(graphic);
  const plannedMotionPreset=graphic?.artwork||graphic?.explanation?'board-cascade':imageComparison||singleImageCard?undefined:graphic?.argument&&graphic.origin==='automatic'?graphic.preset:graphic?documentaryMotionPresetFor(graphic):undefined;
  const motionPreset=graphicActive?plannedMotionPreset:undefined;
  // A source-backed accent borrows the scene's material environment. Its
  // entrance/exit must not remove contain fill or replace it with a matte.
  // Authored boards own their background and must not reveal rejected media.
  const sourceBackedPreset=Boolean(motionPreset&&graphic?.showSource!==false&&!graphic?.artwork&&!graphic?.explanation);
  const accent=/^#[0-9a-f]{6}$/i.test(graphic?.accentColor??'')?graphic!.accentColor!:timeline.accentColor;
  const statisticOnly=graphicActive&&graphic?.kind==='statistic'&&graphic.showSource===false;
  const board=graphicActive&&!motionPreset&&(graphic?.kind==='explainer'||graphic?.kind==='statistic'&&graphic.theme==='paper'&&!statisticOnly);
  const annotations=graphicActive&&graphic?.kind==='annotations';
  const annotationInset=annotationInsets(graphic??{});
  const editorial=graphicActive&&!motionPreset&&['subject-card','bar-chart','quote'].includes(graphic?.kind??'');
  const paper=board||graphicActive&&graphic?.theme==='paper'&&['statistic','feature-list'].includes(graphic.kind);
  const graphicMap=graphicActive&&graphic?.kind.startsWith('map-')&&graphic.mapStyle!=='inset';
  const focusPanels=graphicActive&&graphic?.kind==='feature-list'&&graphic.presentation==='panels'&&graphic.panels?.length===3;
  const cut = doc?.cuts?.find(cut=>frame>=cut.fromFrame&&frame<cut.fromFrame+cut.durationInFrames);
  const isVideo = Boolean(cut ? cut.videoPath : scene.videoPath), source = cut ? cut.videoPath || cut.imagePath : scene.videoPath || scene.imagePath;
  const template = (!templateActive?'full':doc?.template) ?? (doc?.layout === "compare" ? (scene.order % 2 ? "compare-cards" : "compare-clean")
    : doc?.layout === "contain" ? "contain"
    : doc?.caption.enabled && doc.caption.text.trim() && timeline.captionsEnabled ? (scene.order % 2 ? "fact" : "fact-large")
    : !isVideo && scene.motion && scene.kenBurnsDirection !== "off" ? (scene.order % 3 === 0 ? "archive" : scene.order % 3 === 1 ? "push" : "pull") : "full");
  const automaticVisuals=doc?.templateOrigin==='automatic'&&!doc.pinned;
  // A short phrase is an overlay, not a request to drop the TV/photo host.
  const templateVisualActive=!graphicActive||automaticVisuals&&!motionPreset&&graphic?.origin==='automatic'&&graphic.kind==='key-point'&&graphic.variant!=='poster';
  const studioScene=templateVisualActive&&isDocumentaryStudioTemplate(template);
  const editorialScene=templateVisualActive&&['editorial-shutters','editorial-orbit','editorial-film-gate','editorial-iris'].includes(template);
  const styled=studioScene||editorialScene||templateVisualActive&&['broadcast-crt','broadcast-scanlines','paper-grid','dark-grid','diagonal-card','contour-card','blueprint-board','archive-slide'].includes(template);
  const comparisonBoard=!graphicActive&&doc?.layout==='compare'&&['compare-grid','compare-dossier','compare-diagonal','compare-reveal','compare-filmstrip'].includes(template);
  const preset=templateVisualActive?documentaryLayoutPreset(template):undefined;
  const design = documentaryDesign(template, templateFrame, templateFrames, timeline.accentColor, doc?.templateMotion,
    !isVideo && !cut && doc?.selected?.width && doc.selected.height
      ? { width: doc.selected.width, height: doc.selected.height, canvasWidth: timeline.width, canvasHeight: timeline.height } : undefined,doc?.caption.color,true);
  const {moving,direction,transform:photoTransform}=documentaryPhotoTransform(scene,cut,frame);
  const geometry=cut??doc?.selected;
  const narrow = geometry?.width && geometry.height ? geometry.width / geometry.height < timeline.width / timeline.height * 0.88 : false;
  const mediaAspect=(geometry?.width??16)/(geometry?.height??9);
  const wideOverview=plannedMotionPreset&&mediaAspect/(timeline.width/timeline.height)>1.3;
  const fit = design.fit ?? (doc?.layout === "contain" || doc?.layout === "compare" || narrow || wideOverview ? "contain" : "cover");
  // Decorative frames cannot make a very wide document readable. Keep its
  // complete overview alongside the detail. Explicit contain stays untouched.
  const detail=Boolean(!automaticVisuals&&!isVideo&&!cut&&source&&!graphicActive&&doc?.layout!=='compare'&&
    (template==='detail-scan'||(['archive','archive-dark','gallery'].includes(template)&&mediaAspect>3.2)));
  const cutTransform=documentaryPhotoCutTransform(scene,cut,frame,template);
  const focus=geometry?.width&&geometry.height?documentaryPhotoFocus(scene,cut,template,mediaAspect,timeline.width/timeline.height,fit):undefined;
  const directionalCamera=automaticVisuals&&!(graphic?.enabled&&['annotations','callout'].includes(graphic.kind))
    &&['in','out','pan-left','pan-right','pan-up','pan-down'].includes(direction??'')&&['full','push','pull'].includes(template);
  const automaticPhotoCamera=Boolean((plannedMotionPreset&&graphic?.origin==='automatic'||focus||directionalCamera)&&moving&&doc?.templateMotion?.amountPercent!==0);
  const style: CSSProperties = { width: "100%", height: "100%", objectFit: fit, transform: cutTransform ?? (automaticPhotoCamera?photoTransform:design.mediaTransform??photoTransform), transformOrigin:focus?`${focus.x}% ${focus.y}%`:undefined,display: "block", backgroundColor: "transparent" };
  const caption = doc?.caption;
  const captionFont=useMemo(()=>{
    const size=clamp(caption?.fontSize??48,20,192)*timeline.width/1920;
    if(!preset||!caption)return size;
    return fitDocumentaryText(caption.text,size,
      (timeline.width*preset.text[2]/100-48)*.95,timeline.height*preset.text[3]/100-24);
  },[caption?.text,caption?.fontSize,preset,timeline.width,timeline.height]);
  const presetLabels=preset?.group==='compare'?[preset.main,preset.second].map(rect=>rect?{
    left:`${rect[0]+1}%`,width:`${rect[2]-2}%`,top:`${rect[1]+rect[3]-10}%`,boxSizing:'border-box' as const,
    color:preset.paper?'#152832':'#ffffff',backgroundColor:preset.paper?'#faf7efee':'#081019dd',textAlign:'center' as const
  }:{ }):undefined;
  const captionOpacity = envelope(templateFrame, templateFrames, 8, 8);
  const captionText = caption?.animation === "typing" ? caption.text.slice(0, Math.max(1, Math.ceil((templateFrame + 1) / Math.min(30, templateFrames * 0.3) * caption.text.length))) : caption?.text;
  const effects = (doc?.effects ?? []).filter(effect => effect.enabled && effect.durationSeconds > 0 && effect.kind !== "audio")
    .map(effect => visualOnly ? { ...effect, defaults: { ...effect.defaults, sourceAudio: false } } : effect);
  // Entering or leaving an editorial overlay must not reset the source camera.
  // The same scene clock, fit and photo transform continue beneath the graphic.
  const materialStyle=motionPreset?style:template.startsWith('broadcast-')?style:focusPanels||board||annotations||styled||editorial||comparisonBoard?{...style,objectFit:'contain' as const,transform:undefined}:style;
  const material=source
    ? cut ? <Sequence from={cut.fromFrame} durationInFrames={cut.durationInFrames} layout="none"><Material imagePath={cut.imagePath} videoPath={cut.videoPath} start={cut.trimStartSeconds} end={cut.trimEndSeconds} rate={cut.playbackRate} sourceDuration={cut.sourceDurationSeconds} muted={visualOnly || !scene.sourceVolume} volume={clamp((scene.sourceVolume ?? 0) / 100)} style={materialStyle} /></Sequence>
      : <Material imagePath={scene.imagePath} videoPath={scene.videoPath} start={scene.trimStartSeconds} end={scene.trimEndSeconds} rate={scene.playbackRate} sourceDuration={doc?.selected?.durationSeconds} muted={visualOnly || !scene.sourceVolume} volume={clamp((scene.sourceVolume ?? 0) / 100)} style={materialStyle} />
    : <AbsoluteFill style={{display:'flex',alignItems:'center',justifyContent:'center',color:'#adb9c4',fontSize:30}}>Материал не выбран</AbsoluteFill>;
  const artworkMaterials=Object.fromEntries(Object.entries(doc?.artworkMedia??{}).map(([id,asset])=>[id,{
    sourceAspect:asset.width/asset.height,actualVariant:asset.actualVariant,
    material:<Material imagePath={asset.kind==='image'?asset.path:undefined} videoPath={asset.kind==='video'?asset.path:undefined}
      start={asset.trimStartSeconds} end={asset.trimEndSeconds} rate={asset.playbackRate} sourceDuration={asset.kind==='video'?doc?.selected?.durationSeconds:undefined} muted
      style={{width:'100%',height:'100%',objectFit:'contain',display:'block'}}/>
  }]));
  return <AbsoluteFill style={{ backgroundColor: timeline.backgroundColor, overflow: "hidden", isolation: "isolate" }}>
    <AbsoluteFill style={{filter:dramatic.filter}}>
    {doc?.nativeFallback&&!source&&<DocumentaryBackground kind="grid-dark" frame={frame} accent={accent}/>}
    {effects.filter(layer => layer.role === "background").slice(0, 1).map(layer => <Sequence key={layer.id} from={Math.round(layer.startSeconds * 30)} durationInFrames={Math.max(1, Math.round(layer.durationSeconds * 30))}><Layer layer={layer} timeline={timeline} narration={scene.narrationEnabled} /></Sequence>)}
    {!statisticOnly&&!effects.some(e=>e.role==='background')&&(sourceBackedPreset||!motionPreset&&!preset&&!comparisonBoard&&!annotations&&!styled&&!detail&&!paper&&!editorial)&&(fit === "contain" || design.backdrop || graphicActive&&['statistic','feature-list'].includes(graphic?.kind??'')) && <AbsoluteFill data-source-backdrop style={{ filter: "blur(28px)", opacity: 0.48, transform: "scale(1.12)" }}>
      {(cut?.imagePath || scene.imagePath) && <Img src={resolveMediaSource(cut?.imagePath || scene.imagePath!)} style={{ position: "absolute", width: doc?.layout === "compare" ? "50%" : "100%", height: "100%", objectFit: "cover" }} />}
      {doc?.layout === "compare" && doc.comparison?.imagePath && <Img src={resolveMediaSource(doc.comparison.imagePath)} style={{ position: "absolute", left: "50%", width: "50%", height: "100%", objectFit: "cover" }} />}
    </AbsoluteFill>}
    {preset&&<DocumentaryPresetDecor enhanced template={template} frame={templateFrame} accent={accent} customBackground={effects.some(e=>e.role==='background')} motionEnabled={doc?.templateMotion?.amountPercent!==0}/>}
    {graphicActive&&!motionPreset&&!effects.some(e=>e.role==='background')&&!graphic?.kind.startsWith('map-')&&<AbsoluteFill style={{background:paper?'radial-gradient(ellipse at 74% 46%,#dcebdc 0%,#f2f3eb 48%,#faf9f3 100%)':'linear-gradient(110deg,#090f16cc,#090f1688)'}}/>}
    {annotations&&graphic?.cutoutPath&&!effects.some(e=>e.role==='background')&&<><AbsoluteFill style={{background:'#080e12'}}/><Img src={resolveMediaSource(graphic.cutoutPath)} style={{position:'absolute',width:'100%',height:'100%',objectFit:'contain',transform:'scale(1.35)',filter:'blur(3px)',opacity:.12}}/><AbsoluteFill style={{background:`radial-gradient(ellipse,transparent 25%,${accent}30 100%)`}}/></>}
    {focusPanels&&graphic&&<DocumentaryFocusPanels graphic={graphic} frame={graphicFrame} localFrame={frame-graphicStart} material={material}/>}
    {board&&graphic&&<DocumentaryExplainer graphic={graphic} frame={graphicFrame} frames={graphicTotal} material={material} customBackground={effects.some(e=>e.role==='background')} motionEnabled={doc?.templateMotion?.amountPercent!==0}/>}
    {editorialScene&&<DocumentaryEditorialScene template={template} frame={templateFrame} frames={templateFrames} material={material} accent={accent} motionEnabled={doc?.templateMotion?.amountPercent!==0} customBackground={effects.some(e=>e.role==='background')}/>}
    {studioScene&&<DocumentaryStudioScene enhanced template={template} frame={templateFrame} frames={templateFrames} material={material} accent={accent} customBackground={effects.some(e=>e.role==='background')} motionEnabled={doc?.templateMotion?.amountPercent!==0}/>}
    {styled&&!editorialScene&&!studioScene&&<DocumentaryStyledMaterial template={template} frame={templateFrame} frames={templateFrames} material={material} motionEnabled={doc?.templateMotion?.amountPercent!==0} customBackground={effects.some(e=>e.role==='background')}/>}
    {detail&&!board&&!annotations&&source&&<DocumentaryDetail source={source} aspect={mediaAspect} frame={frame} frames={scene.durationInFrames} width={timeline.width} height={timeline.height} accent={timeline.accentColor} moving={moving}/>}
    {annotations&&<div style={{position:'absolute',inset:`${annotationInset.vertical*100}% ${annotationInset.horizontal*100}%`,opacity:clamp(graphicFrame/14),filter:graphic?.cutoutPath?'drop-shadow(0 18px 22px #000a)':undefined}}>{graphic?.cutoutPath?<Img src={resolveMediaSource(graphic.cutoutPath)} style={{width:'100%',height:'100%',objectFit:'contain'}}/>:material}</div>}
    {comparisonBoard&&<DocumentaryComparisonBoard template={template} frame={templateFrame} frames={templateFrames} motionEnabled={doc?.templateMotion?.amountPercent!==0} left={material} right={<Material imagePath={doc?.comparison?.imagePath} videoPath={doc?.comparison?.videoPath} start={doc?.comparison?.trimStartSeconds} end={doc?.comparison?.trimEndSeconds} rate={doc?.comparison?.playbackRate} sourceDuration={doc?.comparison?.durationSeconds} style={materialStyle}/>} labels={[doc?.comparison?.leftLabel,doc?.comparison?.rightLabel]} accent={accent} customBackground={effects.some(e=>e.role==='background')}/>}
    {!motionPreset&&!statisticOnly&&!comparisonBoard&&!styled&&!detail&&!graphicMap&&!focusPanels&&!board&&!annotations&&!(doc?.nativeFallback&&!source)
      &&!(graphicActive&&graphic?.kind==='feature-list'&&graphic.presentation==='list'&&!source)
      &&(!editorial||graphic?.kind==='quote') && <AbsoluteFill style={{ ...(doc?.layout === "compare" ? { width: "49%", right: "auto" } : {}), ...design.main, ...(graphicActive&&graphic&&!editorial?motionMediaStyle(graphic.kind,graphicFrame/Math.max(1,graphicTotal-1),(doc?.selected?.width??16)/(doc?.selected?.height??9),timeline.width/timeline.height,graphicFrame,paper):{}) }}>{material}
    </AbsoluteFill>}
    {doc?.layout === "compare" && !graphicActive&&!comparisonBoard && <>
      <AbsoluteFill style={{ width: "49%", left: "51%", ...design.second }}><Material imagePath={doc.comparison?.imagePath} videoPath={doc.comparison?.videoPath} start={doc.comparison?.trimStartSeconds} end={doc.comparison?.trimEndSeconds} rate={doc.comparison?.playbackRate} sourceDuration={doc.comparison?.durationSeconds} style={{ ...style, transform: undefined }} /></AbsoluteFill>
      {template === "compare-clean" && <AbsoluteFill style={{ width: 3, left: "50%", backgroundColor: timeline.accentColor, top: "12%", bottom: "12%", height: "76%" }} />}
      {template === 'compare-cards' && <svg viewBox="0 0 1920 1080" width="100%" height="100%" style={{position:'absolute',pointerEvents:'none'}}><path d="M865 575H1055" pathLength={1} stroke={timeline.accentColor} strokeWidth="3" strokeDasharray="1" strokeDashoffset={1-documentaryEase((frame-12)/20)}/><circle cx="865" cy="575" r="7" fill={timeline.accentColor} opacity={documentaryEase((frame-12)/20)}/><circle cx="1055" cy="575" r="7" fill={timeline.accentColor} opacity={documentaryEase((frame-22)/16)}/></svg>}
      {[doc.comparison?.leftLabel, doc.comparison?.rightLabel].map((label, index) => label && <div key={index} style={{ position: "absolute", top: template === "compare-stack" ? `${index*49+5}%` : "7%", left: template === "compare-stack" ? "11%" : `${index * 51 + 3}%`, width: template === "compare-stack" ? "32%" : "43%", fontFamily: "Arial, sans-serif", textAlign: "center", fontSize: timeline.width / 44, fontWeight: 700, color: timeline.textColor, padding: 12, borderBottom: `3px solid ${timeline.accentColor}`, borderRadius: 8, backgroundColor: `${timeline.backgroundColor}bb`,...presetLabels?.[index], opacity: clamp((frame - index * 3) / 10), transform: `translateY(${(1 - clamp((frame - index * 3) / 12)) * 20}px)` }}>{label}</div>)}
    </>}
    {annotations&&source&&graphic?.variant==='magnifier'&&<DocumentaryMagnifier graphic={graphic} frame={frame-graphicStart} frames={graphicFrames} aspect={mediaAspect} width={timeline.width} height={timeline.height} accent={accent}
      material={graphic.cutoutPath?<Img src={resolveMediaSource(graphic.cutoutPath)} style={{width:'100%',height:'100%',objectFit:'contain'}}/>:<Material imagePath={scene.imagePath} videoPath={scene.videoPath} start={scene.trimStartSeconds} end={scene.trimEndSeconds} rate={scene.playbackRate} sourceDuration={doc?.selected?.durationSeconds} muted style={{width:'100%',height:'100%',objectFit:'contain'}}/>}/>}
    </AbsoluteFill>
    {motionPreset&&graphic&&(graphic.explanation
      ?<DocumentaryExplanation explanation={graphic.explanation} frame={graphicFrame+(graphic.explanation.sequence?.offsetFrames??0)} frames={graphic.explanation.sequence?.durationInFrames??graphicTotal} width={timeline.width} height={timeline.height} moving={doc?.templateMotion?.amountPercent!==0}/>
      :graphic.artwork
      ?<AbsoluteFill data-artwork-span={graphic.artworkSpan?'standalone':undefined} style={standaloneArtwork?{backgroundColor:graphic.artwork.palette.background}:undefined}>
        <DocumentaryArtwork artwork={graphic.artwork} frame={graphicFrame} frames={graphicTotal} skipEdgeFade={Boolean(graphic.artworkSpan)} material={standaloneArtwork?null:material} materials={artworkMaterials} width={timeline.width} height={timeline.height} moving={doc?.templateMotion?.amountPercent!==0}
          sourceAspect={mediaAspect} sourceFit={materialStyle.objectFit === 'contain' ? 'contain' : 'cover'}/>
        </AbsoluteFill>
      :graphic.diagram&&graphic.origin==='automatic'
      ?<DocumentaryDiagram graphic={graphic} frame={graphicFrame} frames={graphicTotal} material={material} accent={accent} moving={doc?.templateMotion?.amountPercent!==0} sourceFilter={dramatic.filter} portrait={timeline.height>timeline.width}/>
      :documentaryObjectBoard(graphic)
      ?<DocumentaryObjectBoard graphic={graphic} frame={graphicFrame} frames={graphicTotal} width={timeline.width} height={timeline.height} material={material} accent={accent} moving={doc?.templateMotion?.amountPercent!==0}/>
      :graphic.photoMoment&&graphic.origin==='automatic'
      ?<DocumentaryPhotoMoment graphic={graphic} frame={frame-graphicStart} sceneStart={graphicStart} width={timeline.width} height={timeline.height} material={material} accent={accent} moving={doc?.templateMotion?.amountPercent!==0}/>
      :graphic.argument&&graphic.origin==='automatic'
      ?<DocumentaryArgumentSequence argument={graphic.argument} frame={frame-graphicStart} frames={graphicFrames} width={timeline.width} height={timeline.height} material={material} accent={accent} moving={doc?.templateMotion?.amountPercent!==0}/>
      :<DocumentaryMotionPreset graphic={graphic} frame={graphicFrame} frames={graphicTotal} material={material} accent={accent} width={timeline.width} height={timeline.height} mediaAspect={mediaAspect} isVideo={isVideo} motionEnabled={doc?.templateMotion?.amountPercent!==0} customBackground={effects.some(e=>e.role==='background')} sourceFilter={dramatic.filter}
        stageAutomaticBoards={!doc?.pinned&&doc?.templateOrigin!=='manual'}/>)}
    {annotations&&graphic&&<DocumentaryAnnotations graphic={graphic} frame={frame-graphicStart} frames={graphicFrames} aspect={mediaAspect} containerAspect={timeline.width/timeline.height} accent={accent}/>}
    {editorial&&graphic&&<DocumentaryEditorialGraphic graphic={graphic} frame={graphicFrame} frames={graphicTotal} material={material} accent={accent} aspect={mediaAspect} containerAspect={timeline.width/timeline.height} customBackground={effects.some(e=>e.role==='background')} sourceFilter={dramatic.filter}/>}
    {graphicActive&&graphic&&!motionPreset&&!board&&!annotations&&!editorial&&<DocumentaryMotionGraphic graphic={graphic} frame={graphicFrame} frames={graphicTotal} accent={accent} textColor={timeline.textColor} customBackground={effects.some(e=>e.role==='background')} motionEnabled={doc?.templateMotion?.amountPercent!==0} allowAutomaticPhrase={Boolean(doc?.semanticMontage)&&!doc?.pinned&&doc?.templateOrigin!=='manual'}/>}
    {dramatic.vignette>0&&<AbsoluteFill style={{pointerEvents:'none',opacity:dramatic.vignette,background:'radial-gradient(ellipse at center,transparent 32%,#000 100%)'}}/>}
    {effects.filter(layer => layer.role !== "background").filter(layer => layer.kind === "audio" || layer.role === "sound" || layer.role === "overlay" || layer.role === "transition").map(layer =>
      <Sequence key={layer.id} from={Math.round(layer.startSeconds * 30)} durationInFrames={Math.max(1, Math.round(layer.durationSeconds * 30))}><Layer layer={layer} timeline={timeline} narration={scene.narrationEnabled} /></Sequence>)}
    {!graphicActive && timeline.captionsEnabled && caption?.enabled && caption.text.trim() && <AbsoluteFill style={{ padding: "7%", display: "flex", alignItems: "flex-start", justifyContent: caption.position === "top" ? "flex-start" : caption.position === "center" ? "center" : "flex-end", opacity: captionOpacity,
      transform: caption.animation === "slide" ? `translateY(${(1 - captionOpacity) * 14}px)` : undefined, fontSize: timeline.width / 96, ...design.text }}>
      <div style={{ fontFamily: "Arial, sans-serif", fontWeight: 700, fontSize: captionFont, lineHeight: 1.15, maxWidth: "88%", boxSizing:'border-box', color: caption.color,
        backgroundColor: `${caption.backgroundColor}${Math.round(clamp(caption.opacity / 100) * 255).toString(16).padStart(2, "0")}`, padding: "12px 20px", borderLeft: `5px solid ${timeline.accentColor}`, whiteSpace: "pre-line", overflowWrap: "break-word", ...design.textBox }}>{captionText}</div>
    </AbsoluteFill>}
    {doc?.illustrative&&doc.illustrationFact&&<div style={{position:'absolute',top:'6%',left:'6%',maxWidth:'68%',
      color:'#fff',fontFamily:'Arial,sans-serif',fontSize:Math.max(22,timeline.width/65),fontWeight:700,lineHeight:1.3,
      backgroundColor:'#08131de0',borderLeft:`6px solid ${timeline.accentColor}`,padding:'14px 20px',borderRadius:6,
      boxShadow:'0 12px 32px #0008',opacity:clamp(frame/12),transform:`translateY(${(1-clamp(frame/14))*18}px)`}}>{doc.illustrationFact}</div>}
    {[doc?.illustrative, doc?.layout === "compare" && doc.comparison?.illustrative].map((illustrative, index) => illustrative && <div key={`illustration-${index}`} style={{
      position: "absolute", bottom: "3%", right: doc?.layout === "compare" && index === 0 ? "54%" : "3%", maxWidth: doc?.layout === "compare" ? "43%" : "88%",
      fontFamily: "Arial, sans-serif", fontSize: timeline.width / 60, lineHeight: 1.2, color: "#ffffff", backgroundColor: "#000000cc", padding: "8px 12px"
    }}>{timeline.illustrationLabel}</div>)}
    {scene.fadeEdges && <AbsoluteFill style={{ backgroundColor: "black", opacity: 1 - envelope(frame, scene.durationInFrames, 7, 7) }} />}
    {!visualOnly && scene.narrationEnabled && doc?.timing?.audioPath && <Audio src={resolveMediaSource(doc.timing.audioPath)} trimBefore={Math.round((doc.timing.audioStartSeconds ?? 0) * timeline.fps)} trimAfter={doc.timing.audioEndSeconds === undefined ? undefined : Math.round(doc.timing.audioEndSeconds * timeline.fps)} volume={clamp((scene.narrationVolume ?? 100) / 100, 0, 1.5)} />}
  </AbsoluteFill>;
}

/** The same frame/audio composition runs in Player and renderMedia; no template cycle. */
export function DocumentaryVideo(timeline: DocumentaryTimeline) {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{ backgroundColor: timeline.backgroundColor }}><DocumentaryMusicAudio timeline={timeline}/>{timeline.scenes.map((scene, index) => {
    const next = timeline.scenes[index + 1], previous = timeline.scenes[index - 1];
    // A long film otherwise mounts hundreds of Sequence context consumers for
    // every exported frame. Keep the outgoing frozen shot through its overlap;
    // the original index still supplies the incoming transition's predecessor.
    if (frame < scene.fromFrame || frame >= scene.fromFrame + scene.durationInFrames + (next ? scene.transitionFrames : 0)) return null;
    return <Sequence key={scene.id} from={scene.fromFrame} durationInFrames={scene.durationInFrames + (next ? scene.transitionFrames : 0)}>
      <Sequence durationInFrames={scene.durationInFrames}><SceneWithTransition scene={scene} previous={previous} timeline={timeline} /></Sequence>
      {next && scene.transitionFrames > 0 && <Sequence from={scene.durationInFrames} durationInFrames={scene.transitionFrames}><OutgoingFrame scene={scene} timeline={timeline}/></Sequence>}
    </Sequence>;
  })}{timeline.scenes.flatMap(scene => (scene.documentary?.effects ?? []).filter(layer => layer.enabled && layer.kind === "audio" && layer.durationSeconds > 0).map(layer =>
    <Sequence key={`${scene.id}:${layer.id}`} from={scene.fromFrame + Math.round(layer.startSeconds * timeline.fps)} durationInFrames={Math.max(1, Math.round(layer.durationSeconds * timeline.fps))}>
      <Layer layer={layer} timeline={timeline} narration={scene.narrationEnabled} />
    </Sequence>))}{timeline.scenes.flatMap(scene=>(scene.documentary?.texts??[]).filter(text=>text.enabled&&text.text.trim()&&text.durationSeconds>0).map(text=>
      <Sequence key={`text-${scene.id}-${text.id}`} from={scene.fromFrame+Math.round(text.startSeconds*timeline.fps)} durationInFrames={Math.max(1,Math.round(text.durationSeconds*timeline.fps))}><TextClip text={text} width={timeline.width} /></Sequence>
    ))}</AbsoluteFill>;
}
function TextClip({text,width}:{text:DocumentaryTextClip;width:number}) {
  const frame=useCurrentFrame(),frames=Math.max(1,Math.round(text.durationSeconds*30));
  const opacity=envelope(frame,frames,text.fadeInSeconds*30,text.fadeOutSeconds*30);
  const enter=documentaryEase(frame/Math.max(1,text.fadeInSeconds*30));
  const content=text.animation==="typing"?text.text.slice(0,Math.ceil(enter*text.text.length)):text.text;
  return <AbsoluteFill style={{pointerEvents:"none",opacity:opacity*clamp(text.opacity/100)}}><div style={{position:"absolute",left:`${text.x}%`,top:`${text.y}%`,
    transform:`translate(-50%,-50%) translateY(${text.animation==="slide"?(1-enter)*40:0}px) scale(${text.animation==="zoom"?.85+.15*enter:1})`,
    fontFamily:"Arial, sans-serif",fontWeight:800,fontSize:clamp(text.fontSize,20,192)*width/1920,lineHeight:1.14,textAlign:"center",maxWidth:"86%",width:"max-content",whiteSpace:"pre-line",overflowWrap:"break-word",
    color:text.color,backgroundColor:`${text.backgroundColor}${Math.round(clamp((text.backgroundOpacity??0)/100)*255).toString(16).padStart(2,"0")}`,padding:"12px 20px",borderRadius:10,textShadow:"0 3px 16px #000b"}}>{content}</div></AbsoluteFill>;
}
function OutgoingFrame({scene,timeline}:{scene:DocumentaryTimeline['scenes'][number];timeline:DocumentaryTimeline}) {
  const frame=useCurrentFrame(),style=scene.documentary?.transitionStyle??scene.documentary?.autoTransitionStyle,blur=scene.transition==='mix'&&style==='blur';
  return <AbsoluteFill style={{filter:blur?`blur(${12*clamp(frame/Math.max(1,scene.transitionFrames))}px)`:undefined}}><DocumentaryGlitchSeam frame={frame} frames={scene.transitionFrames} enabled={scene.transition==='mix'&&style==='glitch'}><Freeze frame={scene.durationInFrames-1}><DocumentaryFrame scene={scene} timeline={timeline} visualOnly/></Freeze></DocumentaryGlitchSeam></AbsoluteFill>;
}
function SceneWithTransition({ scene, previous, timeline }: { scene: DocumentaryTimeline["scenes"][number]; previous?: DocumentaryTimeline["scenes"][number]; timeline: DocumentaryTimeline }) {
  const frame = useCurrentFrame();
  const t = previous?.transitionFrames ?? 0;
  const opacity = previous?.transition === "mix" && t > 0 ? clamp(frame / t) : 1;
  const transitionStyle=(s:typeof scene|undefined)=>s?.documentary?.transitionStyle??s?.documentary?.autoTransitionStyle;
  const inBlur=previous?.transition==='mix'&&transitionStyle(previous)==='blur'&&t>0?12*(1-clamp(frame/t)):0;
  const dip = previous?.transition === "fade" && t > 0 ? 1 - clamp(frame / t) : 0;
  const outDip = scene.transition === "fade" && scene.transitionFrames > 0 && timeline.scenes.at(-1)?.id !== scene.id ? clamp((frame - (scene.durationInFrames - scene.transitionFrames)) / scene.transitionFrames) : 0;
  return <AbsoluteFill style={{ opacity }}><AbsoluteFill style={{filter:inBlur>0?`blur(${inBlur}px)`:undefined}}><DocumentaryGlitchSeam frame={frame} frames={t} enabled={previous?.transition==='mix'&&transitionStyle(previous)==='glitch'}><DocumentaryFrame scene={scene} timeline={timeline} /></DocumentaryGlitchSeam></AbsoluteFill>{Math.max(dip, outDip) > 0 && <AbsoluteFill style={{ backgroundColor: "black", opacity: Math.max(dip, outDip) }} />}</AbsoluteFill>;
}
