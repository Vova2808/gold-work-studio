import type {DocumentaryCandidate,Project,Scene} from '@gold-work/shared';

/** Called with ffprobe dimensions of the downloaded original, never thumbnail
 * dimensions. Reject damaging enlargement before buying a visual review. */
export function documentarySourceQualityIssue(source:Pick<DocumentaryCandidate,'width'|'height'|'kind'>|undefined,aspectRatio='16:9',presentation?:'subject-card'):string|undefined{
  if(!source)return;
  const w=source.width??0,h=source.height??0;
  if(!(w>0&&h>0))return 'Не определено реальное разрешение оригинала; материал нельзя автоматически подтвердить.';
  const [a,b]=aspectRatio.split(':').map(Number),ratio=a&&b?a/b:16/9;
  const fullW=ratio>=1?1920:1080,fullH=Math.round(fullW/ratio);
  const canvasW=presentation==='subject-card'?fullW*.43:fullW,canvasH=presentation==='subject-card'?fullH*.92:fullH;
  const displayRatio=canvasW/canvasH,scale=Math.min(canvasW/w,canvasH/h),occupancy=Math.min((w/h)/displayRatio,displayRatio/(w/h));
  if(Math.min(w,h)<480||scale>1.5)return `Оригинал ${w}×${h} слишком мал для выпуска ${canvasW}×${canvasH}: увеличение ${scale.toFixed(1)}× размывает детали. Нужен более качественный исходник.`;
  // Subject isolation changes the occupied shape; its resulting pixel size is
  // checked after segmentation instead of rejecting a landscape source here.
  // Stills are already fitted without cropping in the portrait/contain layouts.
  // A detailed portrait is usable there; aspect ratio alone is not bad quality.
  const detailedPortrait=source.kind==='image'&&w/h<.85&&w>=960&&h>=1280;
  if(presentation!=='subject-card'&&occupancy<.5&&!detailedPortrait)return `Формат оригинала ${w}×${h} занимает менее половины кадра ${aspectRatio}. Для крупного изображения нужен другой исходник без сильной обрезки.`;
}

/** Only these adapters supply original/download dimensions, not preview sizes.
 * Unknown geometry still reaches download + ffprobe, never a metadata approval. */
export function documentaryKnownQualityIssue(candidate:DocumentaryCandidate,project:Pick<Project,'aspectRatio'>,scene:Scene):string|undefined{
  // Do not download hundreds of MB for a source explicitly labelled gameplay.
  // A real-vs-game comparison can still contain camera footage worth inspecting.
  const metadata=`${candidate.title} ${candidate.description}`;
  if(candidate.kind==='video'&&/\bgameplay\b|\bin[- ]game footage\b|геймплей|игровой процесс|#motogp\d{2}\b/iu.test(metadata)
    &&!/\breal\s*(?:vs\.?|versus)\b|\b(?:real life|real footage)\b.*\bcomparison\b|сравнен\S*\s+с\s+реальн/iu.test(metadata))
    return 'Источник помечен как запись видеоигры. Для документального кадра нужна натурная съёмка.';
  if(!candidate.width||!candidate.height||!['commons','pexels','pixabay'].includes(candidate.provider))return;
  return documentarySourceQualityIssue(candidate,project.aspectRatio,documentaryQualityPresentation(scene));
}

export function documentaryQualityPresentation(scene:Scene):'subject-card'|undefined{
  const g=scene.documentary?.motionGraphic;
  const duration=Math.max((scene.documentary?.timing?.durationInFrames??scene.durationSeconds*30)/30,scene.durationOverrideSeconds??0);
  return g?.enabled&&g.kind==='subject-card'&&g.startSeconds===0&&g.durationSeconds>=duration-.034?'subject-card':undefined;
}

export const documentaryTechnicalQualityInstruction=' Technical quality is mandatory for each new visual review (each reviews[] entry separately): return technicalQuality:{detail:"clear|soft|unusable",compression:"clean|visible|severe",pixelated:boolean,evidence:string}. Inspect actual edges, small details and block/ringing artifacts, not the file dimensions or title. Upscaled/pixelated footage, severe compression, unreadably blurred main subjects or unusably soft details must be rejected, even when subject identity is correct. A sharp subject with intentional blurred background is acceptable; do not confuse bokeh, film grain or natural motion blur with an unusable source. An archive label is not an exemption for footage too poor to understand. Use the same supplied frames; never request another analysis merely for these fields.';

export function enforceDocumentaryTechnicalQuality(value:Record<string,unknown>,required=false):Record<string,unknown>{
  if(Array.isArray(value.reviews))return {...value,reviews:value.reviews.map(row=>row&&typeof row==='object'?enforceDocumentaryTechnicalQuality(row as Record<string,unknown>,required):row)};
  const quality=value.technicalQuality as {detail?:string;compression?:string;pixelated?:boolean;evidence?:string}|undefined;
  if(required&&value.status==='accepted'&&(!quality||!['clear','soft','unusable'].includes(quality.detail??'')||!['clean','visible','severe'].includes(quality.compression??'')||typeof quality.pixelated!=='boolean'||typeof quality.evidence!=='string'||!quality.evidence.trim()))
    return {...value,status:'uncertain',annotations:[],reason:'Анализ не подтвердил техническое качество исходника. Ответ сохранён; повторная оплата этого запроса не требуется.'};
  if(value.status==='accepted'&&quality&&(quality.pixelated===true||quality.detail==='unusable'||quality.compression==='severe'))
    return {...value,status:'rejected',annotations:[],reason:`Недостаточное качество исходника: ${String(quality.evidence??'пикселизация, размытие или сильное сжатие').slice(0,400)}`};
  return value;
}

export function documentarySavedQualityIssue(project:Pick<Project,'aspectRatio'>,scene:Scene):string|undefined{
  const doc=scene.documentary;if(!doc?.verified||doc.pinned)return;
  return documentarySourceQualityIssue(doc.selected,project.aspectRatio,documentaryQualityPresentation(scene));
}
