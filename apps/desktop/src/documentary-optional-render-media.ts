import {stat} from 'node:fs/promises';
import type {DocumentaryTimeline} from '@gold-work/remotion-video';

/** Optional copied decorations may disappear independently of the source film.
 * Omit a broken pair coherently in the render snapshot; preserve saved edits. */
export async function prepareDocumentaryOptionalRenderMedia(timeline:DocumentaryTimeline):Promise<string[]> {
  const warnings:string[]=[],missing=new Set<string>(),checked=new Map<string,boolean>();
  const available=async(path:string)=>{
    if(!checked.has(path))checked.set(path,await stat(path).then(s=>s.isFile()&&s.size>0,error=>{
      if(['ENOENT','ENOTDIR'].includes((error as NodeJS.ErrnoException).code??''))return false;
      throw error;
    }));
    return checked.get(path)!;
  };
  const pair=(e:{boundary?:{from:string;to:string}})=>e.boundary?`${e.boundary.from}:${e.boundary.to}`:undefined;
  for(const scene of timeline.scenes)for(const effect of scene.documentary?.effects??[]){
    if(effect.enabled&&!await available(effect.filePath)){missing.add(effect.filePath);const key=pair(effect);if(key)missing.add(key);}
  }
  for(const scene of timeline.scenes){
    const doc=scene.documentary;if(!doc)continue;
    doc.effects=doc.effects.filter(effect=>{
      const omit=effect.enabled&&(missing.has(effect.filePath)||Boolean(pair(effect)&&missing.has(pair(effect)!)));
      if(omit)warnings.push(`Сцена ${scene.order+1}: необязательный эффект «${effect.name??effect.role}» недоступен; пропущен${effect.boundary?' с обеих сторон стыка':''}.`);
      return !omit;
    });
    const g=doc.motionGraphic;if(!g)continue;
    if(g.cutoutPath&&!await available(g.cutoutPath)){
      g.cutoutPath=undefined;warnings.push(`Сцена ${scene.order+1}: вырезанный объект недоступен; сохранён исходный материал.`);
    }
    let missingCard=false;
    for(const card of [...(g.cards??[]),...(g.panels??[])]){
      if(card.sceneId&&(!card.imagePath||!await available(card.imagePath)))missingCard=true;
    }
    if(missingCard){
      doc.motionGraphic=g.title.trim()&&g.title.length<=80?{kind:'key-point',enabled:g.enabled,title:g.title,variant:'marker',origin:g.origin,
        startSeconds:0,durationSeconds:Math.min(3,scene.durationInFrames/timeline.fps),accentColor:g.accentColor}:undefined;
      warnings.push(`Сцена ${scene.order+1}: изображение карточки недоступно; сохранён основной материал без пустых карточек.`);
    }
    if(g.detail?.imagePath&&!await available(g.detail.imagePath)){
      g.detail=undefined;warnings.push(`Сцена ${scene.order+1}: необязательное изображение карты недоступно; использована базовая карта.`);
    }
  }
  return warnings;
}
