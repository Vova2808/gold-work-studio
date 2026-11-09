import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {existsSync} from 'node:fs';
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import {basename,dirname,join,resolve} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {bundle} from '@remotion/bundler';
import {makeCancelSignal,renderStill,selectComposition} from '@remotion/renderer';
import {buildDocumentaryTimeline} from '@gold-work/remotion-video';
import type {DocumentaryArtwork,Project} from '@gold-work/shared';
import type {ArtworkRevisionPreviewCallback,ArtworkRevisionPreviewRow} from './documentary-artwork-revision.js';
import {attachMotionArtwork,validateMotionArtwork} from './documentary-artwork-plan.js';
import {planDocumentaryMontage} from './documentary-montage.js';
import {montageFrames,semanticMontageHash} from './documentary-semantic-montage.js';
import {openDocumentaryRenderBrowser} from './documentary-renderer.js';
import {remotionBinariesDirectory} from './remotion-binaries.js';
import {serveDocumentaryRenderMedia} from './documentary-render-media.js';
import {documentaryExportProject,documentaryRenderCache} from './documentary-render-cache.js';
import {atomicWrite} from './fs-utils.js';
import {prepareDocumentaryArtworkMedia} from './documentary-artwork-materials.js';
import {recordDiagnosticEvent} from './diagnostics.js';
import {assessArtworkReplacement} from './documentary-artwork-quality.js';
import {artworkSourceCandidates} from './documentary-artwork-previews.js';
import {artworkTemporalSampleTimes} from './documentary-artwork-temporal-review.js';

const phaseTimes=[.04,.48,.88] as const;
type PreviewResult=Awaited<ReturnType<ArtworkRevisionPreviewCallback>>;
export interface ArtworkPhaseRendererOptions {projectDirectory:string;signal?:AbortSignal;entryPoint?:string;browserExecutable?:string}

/** Derive every sample from the same mounted artwork and shared clock as Final. */
export function planArtworkPhases(project:Project,rows:ArtworkRevisionPreviewRow[],projectDirectory?:string){
  if(new Set(rows.map(row=>row.sceneId)).size!==rows.length)throw Error('Повторные композиции в визуальной доработке.');
  const input=structuredClone(projectDirectory?documentaryExportProject(project,projectDirectory):project),hash=semanticMontageHash(input);
  const editorDrafts=new Map<string,DocumentaryArtwork>();
  const ordered=input.scenes.filter(scene=>scene.includeInAssembly!==false).sort((a,b)=>a.order-b.order);
  for(const row of rows){
    if(row.endSceneId||assessArtworkReplacement(row.artwork).allowReplacement)continue;
    const index=ordered.findIndex(scene=>scene.id===row.sceneId),scene=ordered[index];
    if(!scene)throw Error(`Сцена ${row.sceneId}: отсутствует draft для editor preview.`);
    const context=ordered.slice(Math.max(0,index-1),index+2).map(scene=>scene.narration).join(' ');
    const checked=validateMotionArtwork(row.artwork,context,montageFrames(scene)/30,Boolean(scene.imagePath||scene.videoPath),
      input.aspectRatio==='9:16'?9/16:input.aspectRatio==='1:1'?1:16/9,
      {...scene.documentary?.selected,contain:scene.documentary?.layout==='contain'||scene.documentary?.layout==='compare',
        mediaAllowed:Boolean(scene.documentary?.semanticMontage?.artworkBrief)||scene.documentary?.semanticMontage?.artworkMode!=='standalone',
        currentSceneId:scene.id,allowedSources:artworkSourceCandidates(input,scene.id)});
    if(!checked.artwork||!isDeepStrictEqual(checked.artwork,row.artwork))
      throw Error(`Сцена ${row.sceneId}: draft для editor preview не прошёл проверку (${checked.issue??'рисунок не нормализован'}).`);
    editorDrafts.set(row.sceneId,row.artwork);
  }
  const base={version:1 as const,inputHash:hash,model:'artwork-preview',hookSeconds:input.settings.assembly.documentary?.montage?.hookSeconds??16,
    scenes:input.scenes.filter(s=>s.includeInAssembly!==false).map(s=>s.documentary?.semanticMontage??{
      sceneId:s.id,subject:'',beat:'explain' as const,treatment:'footage' as const,cutawaySceneIds:[]})};
  const directions=new Map(attachMotionArtwork(base,{version:1,inputHash:hash,model:'artwork-preview',rejected:[],
    scenes:rows.map(row=>({sceneId:row.sceneId,artwork:row.artwork,...(row.endSceneId?{artworkSpan:{endSceneId:row.endSceneId}}:{})}))},input).scenes.map(row=>[row.sceneId,row]));
  input.scenes=input.scenes.map(s=>s.documentary&&directions.has(s.id)?{...s,documentary:{...s.documentary,semanticMontage:directions.get(s.id)}}:s);
  const timeline=buildDocumentaryTimeline({...input,scenes:planDocumentaryMontage(input,false,false,editorDrafts)});
  const items=rows.map(row=>{
    const first=timeline.scenes.findIndex(s=>s.id===row.sceneId),last=row.endSceneId?timeline.scenes.findIndex(s=>s.id===row.endSceneId):first;
    const scene=timeline.scenes[first],g=scene?.documentary?.motionGraphic;
    const media=row.artwork.layers.filter(layer=>layer.kind==='media');
    if(first<0||last<first||!scene||!g?.enabled||g.explanation||g.origin!=='automatic'||g.artwork?.layout!=='full'
      ||!isDeepStrictEqual(g.artwork,row.artwork)
      ||media.length>0&&(media.length>3||media.some(layer=>layer.parentId)||last!==first||!(scene.imagePath||scene.videoPath))
      ||timeline.scenes.slice(first,last+1).some(s=>s.documentary?.pinned||s.documentary?.templateMotion?.amountPercent===0
        ||s.documentary?.motionGraphic?.origin!=='automatic'||!isDeepStrictEqual(s.documentary.motionGraphic.artwork,row.artwork)))
      throw Error(`Сцена ${row.sceneId}: рисунок не применяется как поддерживаемая автоматическая композиция.`);
    const start=scene.fromFrame+Math.round(g.startSeconds*timeline.fps);
    const frames=g.sequenceDurationFrames??Math.min(Math.max(1,Math.round(g.durationSeconds*timeline.fps)),scene.durationInFrames-Math.round(g.startSeconds*timeline.fps));
    // Keep the established observation phases and inspect the most consequential
    // action/contact or span boundary on both sides of its actual shared clock.
    const risk=row.artwork.actions?.length||row.artwork.camera?.path==='continuous'||row.artwork.direction?.beats.length;
    const boundary=last>first&&risk?timeline.scenes.slice(first+1,last+1).map(s=>(s.fromFrame-start)/Math.max(1,frames-1)):undefined;
    const samples=risk?artworkTemporalSampleTimes(row.artwork,frames,boundary):[...phaseTimes];
    const phases=[...new Set(samples.map(t=>Math.round(t*Math.max(0,frames-1))))].sort((a,b)=>a-b).map(artworkFrame=>{
      const globalFrame=start+artworkFrame;
      const member=timeline.scenes.find(s=>globalFrame>=s.fromFrame&&globalFrame<s.fromFrame+s.durationInFrames),graphic=member?.documentary?.motionGraphic;
      if(!member||!graphic||!isDeepStrictEqual(graphic.artwork,row.artwork)
        ||globalFrame-member.fromFrame-Math.round(graphic.startSeconds*timeline.fps)+(graphic.sequenceOffsetFrames??0)!==artworkFrame)
        throw Error('Визуальная доработка: нарушено общее время композиции.');
      return {t:artworkFrame/Math.max(1,frames-1),artworkFrame,globalFrame};
    });
    return {sceneId:row.sceneId,first,last,frames,phases};
  });
  // Stills keep production visual geometry while avoiding all audio decoding.
  timeline.music=undefined;
  for(const scene of timeline.scenes){scene.narrationEnabled=false;scene.audioPath=undefined;scene.sourceVolume=0;
    if(scene.documentary){scene.documentary.effects=scene.documentary.effects.filter(e=>e.kind!=='audio');
      if(scene.documentary.timing)scene.documentary.timing.audioPath=undefined;}}
  return {timeline,items};
}

let previewQueue:Promise<void>=Promise.resolve();
/** One browser per batch; its lifetime ends before the caller can submit a revision. */
export async function renderDocumentaryArtworkPhases(project:Project,rows:ArtworkRevisionPreviewRow[],options:ArtworkPhaseRendererOptions):Promise<PreviewResult>{
  const previous=previewQueue;let release!:()=>void;
  previewQueue=new Promise<void>(done=>{release=done;});
  await previous;
  try{return await renderPhases(project,rows,options);}finally{release();}
}

async function renderPhases(project:Project,rows:ArtworkRevisionPreviewRow[],options:ArtworkPhaseRendererOptions):Promise<PreviewResult>{
  options.signal?.throwIfAborted();
  if(!rows.length)return [];
  const {timeline,items}=planArtworkPhases(project,rows,options.projectDirectory);
  const warnings=await prepareDocumentaryArtworkMedia(timeline,project,options.projectDirectory,
    message=>recordDiagnosticEvent('warn','documentary.artwork.material-fallback',{message}),options.signal);
  const preparedMaterials=new Map(timeline.scenes.map(scene=>[scene.id,structuredClone(scene.documentary?.artworkMedia)]));
  const reference=typeof __filename==='string'?__filename:import.meta.url;
  const resolved=options.entryPoint??createRequire(reference).resolve('@gold-work/remotion-video/entry');
  const unpacked=resolved.replace('app.asar','app.asar.unpacked'),entryPoint=existsSync(unpacked)?unpacked:resolved;
  const directory=resolve(options.projectDirectory,'Documentary','ArtworkPreviews');
  await mkdir(directory,{recursive:true});
  const cache=await documentaryRenderCache(options.projectDirectory,entryPoint);
  const pending:Array<{item:typeof items[number];files:string[]}> = [],result=new Map<string,PreviewResult[number]>();
  const readImages=async(files:string[])=>Promise.all(files.map(async file=>{
    const bytes=await readFile(file);
    if(bytes.length<4||bytes.length>1024*1024||bytes[0]!==0xff||bytes[1]!==0xd8)throw Error('Повреждён кадр preview.');
    return 'data:image/jpeg;base64,'+bytes.toString('base64');
  }));
  for(const item of items){
    const visualKey=await cache.path(timeline,item.first,item.last,26);
    const key=createHash('sha256').update(JSON.stringify({version:1,visualKey,phases:item.phases,scale:.5,quality:78})).digest('hex');
    const files=item.phases.map((_,i)=>join(directory,`${key}-${i}.jpg`));
    const images=await readImages(files).catch(error=>{if(error.code==='ENOENT'||error.message==='Повреждён кадр preview.')return undefined;throw error;});
    if(images)result.set(item.sceneId,{sceneId:item.sceneId,frames:item.phases.map((phase,i)=>({t:phase.t,image:images[i]!}))});
    else pending.push({item,files});
  }
  if(!pending.length)return items.map(item=>result.get(item.sceneId)!);
  let workDirectory:string|undefined,closeMedia:(()=>Promise<void>)|undefined;
  let browser:Awaited<ReturnType<typeof openDocumentaryRenderBrowser>>|undefined;
  const cancellation=makeCancelSignal();options.signal?.addEventListener('abort',cancellation.cancel,{once:true});
  try{
    workDirectory=await mkdtemp(join(directory,'render-'));
    closeMedia=await serveDocumentaryRenderMedia(timeline);
    const serveUrl=await bundle({entryPoint,publicDir:null,outDir:join(workDirectory,'bundle'),enableCaching:true});
    options.signal?.throwIfAborted();
    browser=await openDocumentaryRenderBrowser(options.browserExecutable,options.signal);
    const common={serveUrl,inputProps:timeline,puppeteerInstance:browser.instance,...browser.options,logLevel:'warn' as const,binariesDirectory:remotionBinariesDirectory()};
    const composition=await selectComposition({...common,id:'GoldWorkDocumentaryV2'});
    for(const {item,files} of pending){
      for(const [i,phase] of item.phases.entries()){
        options.signal?.throwIfAborted();
        await renderStill({...common,composition,output:files[i]!,frame:phase.globalFrame,imageFormat:'jpeg',jpegQuality:78,scale:.5,
          cancelSignal:cancellation.cancelSignal,offthreadVideoThreads:1,offthreadVideoCacheSizeInBytes:64*1024*1024,mediaCacheSizeInBytes:64*1024*1024});
      }
      const images=await readImages(files);
      result.set(item.sceneId,{sceneId:item.sceneId,frames:item.phases.map((phase,i)=>({t:phase.t,image:images[i]!}))});
      await atomicWrite(files[0]!.replace(/-0\.jpg$/u,'.json'),JSON.stringify({version:1,sceneId:item.sceneId,frames:item.frames,phases:item.phases,files,width:timeline.width/2,height:timeline.height/2,
        materials:preparedMaterials.get(item.sceneId),warnings}));
    }
    return items.map(item=>result.get(item.sceneId)!);
  }finally{
    options.signal?.removeEventListener('abort',cancellation.cancel);
    await browser?.instance.close({silent:true}).catch(()=>{});
    await closeMedia?.();
    if(workDirectory&&dirname(workDirectory)===directory&&basename(workDirectory).startsWith('render-'))await rm(workDirectory,{recursive:true,force:true});
  }
}
