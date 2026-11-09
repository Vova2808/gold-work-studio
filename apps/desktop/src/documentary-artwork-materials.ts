import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir,readFile,stat,rename,rm} from 'node:fs/promises';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import type {DocumentaryArtworkPreparedMaterial,Project,Scene} from '@gold-work/shared';
import type {DocumentaryTimeline} from '@gold-work/remotion-video';
import {allowedArtworkMediaSources,artworkForegroundAllowed} from './documentary-artwork-source-allowlist.js';
export {allowedArtworkMediaSources} from './documentary-artwork-source-allowlist.js';
import {documentaryExportProject} from './documentary-render-cache.js';
import {documentarySubjectCutout,subjectMattingModelAvailable} from './documentary-subject-cutout.js';
import {effectFfmpeg,probeEffectMedia} from './effect-media.js';
import {atomicWrite} from './fs-utils.js';

interface MaterialDependencies {
  modelAvailable:()=>Promise<boolean>;
  cutout:(source:string,directory:string,signal?:AbortSignal)=>Promise<string>;
  probe:(path:string,signal?:AbortSignal)=>Promise<{width?:number;height?:number}>;
}

/** Derived assets belong to the render timeline, never the project or semantic hash. */
export async function prepareDocumentaryArtworkMedia(timeline:DocumentaryTimeline,project:Project,projectDirectory:string,
  notice:(message:string)=>void=()=>{},signal?:AbortSignal,dependencies:Partial<MaterialDependencies>={}):Promise<string[]>{
  const originals=documentaryExportProject(project,projectDirectory),directory=resolve(projectDirectory,'Documentary','Cutouts');
  const warnings:string[]=[],identities=new Map<string,Promise<string>>();
  const identity=(path:string)=>{
    if(!identities.has(path))identities.set(path,(async()=>{
      if(!isAbsolute(path))throw Error('Artwork принимает только выбранные локальные материалы.');
      const digest=createHash('sha256');for await(const chunk of createReadStream(path)){signal?.throwIfAborted();digest.update(chunk);}return digest.digest('hex');
    })());
    return identities.get(path)!;
  };
  const probe=dependencies.probe??probeEffectMedia;
  let modelAvailable:Promise<boolean>|undefined;
  const prepareForeground=async(source:Scene,path:string,sourceIdentity:string):Promise<DocumentaryArtworkPreparedMaterial>=>{
    await mkdir(directory,{recursive:true});
    const key=createHash('sha256').update(JSON.stringify(['artwork-foreground-v1','isnet-v4',sourceIdentity])).digest('hex');
    const receipt=join(directory,`${key}.artwork-material.json`);
    const saved=await readFile(receipt,'utf8').then(JSON.parse).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT'||error instanceof SyntaxError)return undefined;throw error;}) as DocumentaryArtworkPreparedMaterial|undefined;
    if(saved?.sourceIdentity===sourceIdentity&&saved.kind==='image'&&saved.width>0&&saved.height>0
      &&(saved.actualVariant==='original'&&saved.path===path||saved.actualVariant==='foreground'&&dirname(resolve(saved.path))===directory)
      &&await stat(saved.path).then(info=>info.isFile()&&info.size>0,()=>false))return {...saved,sourceSceneId:source.id};
    let prepared:DocumentaryArtworkPreparedMaterial;
    try{
      modelAvailable??=(dependencies.modelAvailable??subjectMattingModelAvailable)();
      if(!await modelAvailable)throw Error('Локальные веса отделения фона недоступны; автоматическая загрузка отключена.');
      const cutout=await (dependencies.cutout??((file,dir,abort)=>documentarySubjectCutout(file,dir,true,[],abort,notice)))(path,directory,signal);
      if(dirname(resolve(cutout))!==directory)throw Error('Вырезка находится вне каталога производных материалов.');
      const size=await probe(cutout,signal);
      if(!size.width||!size.height)throw Error('Не определён размер вырезанного объекта.');
      prepared={sourceSceneId:source.id,kind:'image',path:cutout,width:size.width,height:size.height,actualVariant:'foreground',sourceIdentity};
    }catch(error){
      signal?.throwIfAborted();
      const size=source.documentary?.selected;
      prepared={sourceSceneId:source.id,kind:'image',path,width:size?.width??0,height:size?.height??0,actualVariant:'original',sourceIdentity,
        fallbackReason:`Фон сохранён: ${error instanceof Error?error.message:String(error)}`};
    }
    // Persist fallback too: preview and Final must not silently choose different variants.
    await atomicWrite(receipt,JSON.stringify(prepared));return prepared;
  };
  for(const scene of timeline.scenes){
    signal?.throwIfAborted();
    const doc=scene.documentary,g=doc?.motionGraphic,artwork=g?.artwork;
    if(!doc)continue;
    doc.artworkMedia=undefined;doc.artworkMediaFingerprint=undefined;
    // Resolve already-authored assets, including a user's pinned/static copy;
    // never commission, replace or alter the protected artwork itself.
    if(!g?.enabled||!artwork)continue;
    const layers=artwork.layers.filter(layer=>layer.kind==='media');if(!layers.length)continue;
    if(artwork.layout!=='full'||layers.length>3||g.artworkSpan||g.sequenceId)throw Error(`Сцена ${scene.id}: media artwork допускает одну сцену и до трёх viewport.`);
    const allowed=new Map(allowedArtworkMediaSources(originals,scene.id).map(source=>[source.id,source]));
    const materials:Record<string,DocumentaryArtworkPreparedMaterial>={},fingerprints:unknown[]=[];
    let videos=0;
    for(const layer of layers){
      if(layer.parentId)throw Error('Media viewport должен быть корневым слоем.');
      const source=allowed.get(layer.sourceSceneId??scene.id);
      if(!source)throw Error(`Сцена ${scene.id}: источник artwork не входит в выбранный разрешённый набор.`);
      const video=Boolean(source.videoPath),path=source.videoPath||source.imagePath!,window=layer.sourceWindow;
      if(layer.sourceVariant==='foreground'&&!artworkForegroundAllowed(source))throw Error('Foreground требует подтверждённого выбранного неподвижного источника.');
      if(window&&(![window.x,window.y,window.w,window.h].every(Number.isFinite)||window.x<0||window.y<0||window.w<=0||window.h<=0||window.x+window.w>1.000001||window.y+window.h>1.000001))throw Error('Некорректное окно исходного изображения.');
      if(layer.clip&&layer.clip!=='rect'&&layer.clip!=='ellipse'||layer.sourceVariant&&layer.sourceVariant!=='original'&&layer.sourceVariant!=='foreground')throw Error('Неподдерживаемый вариант media viewport.');
      if(layer.sourceVariant==='foreground'&&window||video&&(++videos>1||source.id!==scene.id||window||layer.sourceVariant==='foreground'||layer.clip==='ellipse'))throw Error('Видео допускает один текущий original viewport; foreground/detail требуют неподвижный источник.');
      const sourceIdentity=await identity(path),size=source.documentary?.selected;
      let prepared:DocumentaryArtworkPreparedMaterial={sourceSceneId:source.id,kind:video?'video':'image',path,width:size?.width??0,height:size?.height??0,
        actualVariant:'original',sourceIdentity,...(video?{trimStartSeconds:source.trimStartSeconds,trimEndSeconds:source.trimEndSeconds,playbackRate:source.playbackRate}:{})};
      if(layer.sourceVariant==='foreground')prepared=await prepareForeground(source,path,sourceIdentity);
      if(!prepared.width||!prepared.height){const measured=await probe(prepared.path,signal);prepared.width=measured.width??0;prepared.height=measured.height??0;}
      if(!prepared.width||!prepared.height)throw Error('Размер выбранного artwork-материала неизвестен.');
      const limit=Math.max(timeline.width,timeline.height)*2;
      if(prepared.kind==='image'&&Math.max(prepared.width,prepared.height)>limit){
        const outputDirectory=resolve(projectDirectory,'Documentary','ArtworkMedia');await mkdir(outputDirectory,{recursive:true});
        const key=createHash('sha256').update(JSON.stringify(['image-v1',await identity(prepared.path),limit])).digest('hex');
        const output=join(outputDirectory,`${key}.png`),partial=join(outputDirectory,`${key}.partial.png`);
        if(!await stat(output).then(info=>info.size>0,()=>false)){
          try{await effectFfmpeg(['-y','-threads','2','-i',prepared.path,'-frames:v','1','-vf',`scale=${limit}:${limit}:force_original_aspect_ratio=decrease`,'-threads','2',partial],signal);await rename(partial,output);}
          finally{await rm(partial,{force:true});}
        }
        const measured=await probe(output,signal);prepared={...prepared,path:output,width:measured.width??0,height:measured.height??0};
        if(!prepared.width||!prepared.height)throw Error('Размер подготовленного artwork-материала неизвестен.');
      }
      materials[layer.id]=prepared;
      fingerprints.push({id:layer.id,prepared,asset:await identity(prepared.path),window,clip:layer.clip??'rect'});
      if(prepared.fallbackReason){const message=`Сцена ${scene.order+1}: ${prepared.fallbackReason}`;warnings.push(message);notice(message);}
    }
    doc.artworkMedia=materials;
    doc.artworkMediaFingerprint=createHash('sha256').update(JSON.stringify(fingerprints)).digest('hex');
  }
  return warnings;
}
