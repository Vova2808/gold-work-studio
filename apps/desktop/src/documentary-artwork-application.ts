import type {DocumentaryArtwork,Project} from '@gold-work/shared';
import {assessArtworkReplacement} from './documentary-artwork-quality.js';
import {allowedArtworkMediaSources,artworkForegroundAllowed} from './documentary-artwork-source-allowlist.js';

export interface DocumentaryArtworkSkipReason {code:string;message:string}

/** Keep commission, automatic staging and export on the same media policy. */
export function documentaryArtworkMediaIssue(project:Project,sceneId:string,artwork:DocumentaryArtwork):DocumentaryArtworkSkipReason|undefined {
  const media=artwork.layers.filter(layer=>layer.kind==='media');
  if(!media.length)return;
  const scene=project.scenes.find(s=>s.id===sceneId),direction=scene?.documentary?.semanticMontage;
  if(artwork.layout!=='full'||media.length>3||direction?.artworkSpan)
    return {code:'unsupported-photo-layout',message:'Фото-слои требуют одну сцену, полный кадр и не более трёх окон'};
  const allowed=new Map(allowedArtworkMediaSources(project,sceneId).map(source=>[source.id,source]));
  let videos=0;
  for(const layer of media){
    const source=allowed.get(layer.sourceSceneId??sceneId),window=layer.sourceWindow;
    if(!source)return {code:'unavailable-photo-source',message:'Источник фото-слоя отсутствует в разрешённых выбранных материалах'};
    if(layer.parentId||layer.clip&& !['rect','ellipse'].includes(layer.clip)
      ||window&&(![window.x,window.y,window.w,window.h].every(Number.isFinite)||window.x<0||window.y<0||window.w<=0||window.h<=0||window.x+window.w>1.000001||window.y+window.h>1.000001)
      ||layer.sourceVariant&& !['original','foreground'].includes(layer.sourceVariant))
      return {code:'unsupported-photo-viewport',message:'Неподдерживаемое окно фото-слоя'};
    if(layer.sourceVariant==='foreground'&&(!artworkForegroundAllowed(source)||window)
      ||source.videoPath&&(++videos>1||source.id!==sceneId||window||layer.sourceVariant==='foreground'||layer.clip==='ellipse'))
      return {code:'unsupported-photo-variant',message:'Вырезка и деталь требуют подтверждённого фото; видео допускает одно исходное окно'};
  }
}

export function documentaryArtworkSkipReason(project:Project,sceneId:string,artwork:DocumentaryArtwork):DocumentaryArtworkSkipReason {
  const scene=project.scenes.find(s=>s.id===sceneId),doc=scene?.documentary,settings=project.settings.assembly.documentary;
  if(!doc||scene?.includeInAssembly===false)return {code:'scene-excluded',message:'Сцена не включена в монтаж'};
  if(doc.pinned||doc.templateOrigin==='manual'||doc.motionGraphic?.origin==='manual'||doc.cuts?.length&&doc.cutsOrigin!=='automatic'||doc.texts?.length||doc.caption.enabled||doc.layout==='compare')
    return {code:'authored-presentation',message:'Сохранена закреплённая или ручная композиция'};
  if(settings?.autoMotionGraphics===false||settings?.montage?.style==='clean'||settings?.montage?.intensity!=='rich'||settings?.montageDensity==='calm')
    return {code:'graphics-disabled',message:'Текущий режим монтажа не применяет AI-графику'};
  const mediaIssue=documentaryArtworkMediaIssue(project,sceneId,artwork);if(mediaIssue)return mediaIssue;
  const quality=assessArtworkReplacement(artwork);
  if(!quality.allowReplacement)return {code:quality.reason,message:quality.reason==='no-illustrated-subject'?'Нет изображённого предмета: только текст и линии'
    :quality.reason==='single-source-annotation'?'Фото-слой содержит только подписи без смены фокуса':'Фото-слои образуют статичную доску без раскрытия'};
  return {code:'evidence-or-staging',message:'Сохранена доказательная графика, глава или соседняя смысловая композиция'};
}
