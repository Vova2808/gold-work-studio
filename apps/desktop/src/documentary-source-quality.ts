import type {DocumentaryCandidate,Project,Scene} from '@gold-work/shared';

/** Called with ffprobe dimensions of the downloaded original, never thumbnail
 * dimensions. Reject damaging enlargement before buying a visual review. */
export function documentarySourceQualityIssue(source:Pick<DocumentaryCandidate,'width'|'height'|'kind'>|undefined,aspectRatio='16:9',presentation?:'subject-card'|'portrait-card'):string|undefined{
  if(!source)return;
  const w=source.width??0,h=source.height??0;
  if(!(w>0&&h>0))return 'Не определено реальное разрешение оригинала; материал нельзя автоматически подтвердить.';
  const [a,b]=aspectRatio.split(':').map(Number),ratio=a&&b?a/b:16/9;
  const fullW=ratio>=1?1920:1080,fullH=Math.round(fullW/ratio);
  const canvasW=presentation?fullW*.43:fullW,canvasH=presentation?fullH*.92:fullH;
  const displayRatio=canvasW/canvasH,scale=Math.min(canvasW/w,canvasH/h),occupancy=Math.min((w/h)/displayRatio,displayRatio/(w/h));
  if(Math.min(w,h)<480||scale>1.5)return `Оригинал ${w}×${h} слишком мал для выпуска ${canvasW}×${canvasH}: увеличение ${scale.toFixed(1)}× размывает детали. Нужен более качественный исходник.`;
  // Subject isolation changes the occupied shape; its resulting pixel size is
  // checked after segmentation instead of rejecting a landscape source here.
  // Stills are already fitted without cropping in the portrait/contain layouts.
  // All detailed vertical stills fit there, including wider portraits that do
  // not need the separate narrow portrait-panel template. There must be no
  // rejection gap between that template's .85 ratio and half-frame occupancy.
  const detailedPortrait=source.kind==='image'&&w<h&&w>=960&&h>=1280;
  if(!presentation&&occupancy<.5&&!detailedPortrait)return `Формат оригинала ${w}×${h} занимает менее половины кадра ${aspectRatio}. Для крупного изображения нужен другой исходник без сильной обрезки.`;
}

/** The automatic portrait templates occupy a narrow, nearly full-height panel.
 * Rescue only photos that actually fit it; explicit edits keep their layout. */
export function documentaryAutoPortraitTemplate(scene:Scene,source:Pick<DocumentaryCandidate,'width'|'height'|'kind'>|undefined,aspectRatio:string):'portrait-stage'|undefined{
  const doc=scene.documentary,w=source?.width??0,h=source?.height??0;
  if(!doc||source?.kind!=='image'||!(w>0&&h>0)||w/h>=.85||doc.layout&&doc.layout!=='full'
    ||doc.template||doc.templateOrigin==='manual'||doc.motionGraphic?.enabled||doc.caption?.enabled
    ||doc.cuts?.length||doc.texts?.length||scene.includeInAssembly===false)return;
  if(!documentarySourceQualityIssue(source,aspectRatio)
    ||documentarySourceQualityIssue(source,aspectRatio,'portrait-card'))return;
  return 'portrait-stage';
}

/** Explicit game labels are enough to skip transfer for a live-action task. */
export function documentaryGameplayMetadataIssue(candidate:DocumentaryCandidate,visualTarget=''):string|undefined{
  if(candidate.kind!=='video'||/\b(?:gameplay|(?:in[- ])?game footage|video[- ]game|game trailer)\b|геймплей|игровой процесс/iu.test(visualTarget))return;
  // A real-vs-game comparison can still contain camera footage worth inspecting.
  const metadata=`${candidate.title} ${candidate.description}`;
  if(/\breal\s*(?:vs\.?|versus)\b|\b(?:real life|real footage)\b.*\bcomparison\b|сравнен\S*\s+с\s+реальн/iu.test(metadata))return;
  if(/\b(?:gameplay|in[- ]game footage|game (?:footage|recording|capture|walkthrough)|career mode|season mode|let'?s play)\b|геймплей|игровой процесс|запись (?:видео)?игры/iu.test(metadata))
    return 'Источник помечен как запись видеоигры. Для документального кадра нужна натурная съёмка.';
  // A launch trailer can be an ordinary film. Require game release copy.
  if(/\bvideo[- ]game trailer\b/iu.test(candidate.title)||/\blaunch trailer\b/iu.test(candidate.title)
    &&/\bedition includes\b[^.!?\r\n]{0,64}\bgame\b[^.!?\r\n]{0,64}\bDLC\b/iu.test(candidate.description))
    return 'Источник описан как трейлер видеоигры. Для документального кадра нужна натурная съёмка.';
}

/** Stock adapters and catalogued local originals supply source dimensions.
 * YouTube thumbnail dimensions are not original dimensions. Unknown geometry
 * still reaches download + ffprobe, never a metadata approval. */
export function documentaryKnownQualityIssue(candidate:DocumentaryCandidate,project:Pick<Project,'aspectRatio'>,scene:Scene):string|undefined{
  // The YouTube API already reports SD before a costly original download.
  // Small subject cards may still use it; ffprobe decides their real quality.
  if(candidate.provider==='youtube'&&candidate.kind==='video'&&candidate.videoDefinition==='sd'
    &&documentaryQualityPresentation(scene)!=='subject-card')
    return 'YouTube помечает видео как SD. Для полноэкранного кадра нужен HD-исходник.';
  const gameplayIssue=documentaryGameplayMetadataIssue(candidate);
  if(gameplayIssue)return gameplayIssue;
  if(!candidate.width||!candidate.height||!(['commons','pexels','pixabay'].includes(candidate.provider)
    || Boolean(candidate.localPath)))return;
  return documentarySourceQualityIssue(candidate,project.aspectRatio,
    documentaryQualityPresentation(scene)??(documentaryAutoPortraitTemplate(scene,candidate,project.aspectRatio)?'portrait-card':undefined));
}

export function documentaryQualityPresentation(scene:Scene):'subject-card'|'portrait-card'|undefined{
  const g=scene.documentary?.motionGraphic;
  const duration=Math.max((scene.documentary?.timing?.durationInFrames??scene.durationSeconds*30)/30,scene.durationOverrideSeconds??0);
  if(g?.enabled&&g.kind==='subject-card'&&g.startSeconds===0&&g.durationSeconds>=duration-.034)return 'subject-card';
  return ['portrait-stage','portrait-arch'].includes(scene.documentary?.template??'')?'portrait-card':undefined;
}

/** Selected media dimensions describe the downloaded original. Keep this
 * local check identical before first review and before skipping saved media. */
export function documentaryKnownOriginalGeometryIssue(project:Pick<Project,'aspectRatio'>,scene:Scene):string|undefined{
  const doc=scene.documentary,source=doc?.selected;
  if(doc?.pinned||!source?.width||!source.height)return;
  return documentarySourceQualityIssue(source,project.aspectRatio,documentaryQualityPresentation(scene));
}

export const documentaryTechnicalQualityInstruction=' Technical quality is mandatory for each new visual review (each reviews[] entry separately): return technicalQuality:{detail:"clear|soft|unusable",compression:"clean|visible|severe",pixelated:boolean,evidence:string,orientation:"upright|sideways|upside-down|uncertain",continuousShot:boolean}. Inspect actual edges, small details and block/ringing artifacts, not the file dimensions or title. Upscaled/pixelated footage, severe compression, unreadably blurred main subjects or unusably soft details must be rejected, even when subject identity is correct. A sharp subject with intentional blurred background is acceptable; do not confuse bokeh, film grain or natural motion blur with an unusable source. An archive label is not an exemption for footage too poor to understand. Inspect the actual scene orientation: a sideways horizon or landscape rolled about 90 degrees is sideways even in a landscape-sized file. continuousShot=false for an obvious abrupt change of location/view between ordered samples; normal camera movement or slight lighting variation is allowed. For a single photograph continuousShot=true. Use the same supplied frames; never request another analysis merely for these fields.';

export const documentarySourceTextInstruction=' In the SAME actual-frame review optionally return sourceText:{kind:"none|physical|caption|promotion|uncertain",text:"exact visible source words, or empty"}. Read text in ALL supplied frames. Only if the absence of source text is confirmed in ALL supplied frames return kind:"none",text:"". If you cannot establish the presence/content of incidental text, omit this auxiliary field or use kind:"uncertain",text:""; never assert that text is absent without evidence. Never return kind:"caption" with empty text; caption requires actual visible editorial words. An explicitly requested inscription/text still needs its frozen visible check. Burned-in Please Subscribe, Like and Subscribe, follow/social prompts, publisher/channel branding and advertising stickers/logos are promotion, even if small, outside the main subject or over real camera footage: reject that interval. Never crop, erase or cover a source watermark. Natural road/shop signs, nameplates and markings on the filmed subject are physical and may be kept. Factual editorial subtitles are caption and must agree with the current original narration; unrelated captions are rejected. Our app overlays are not present in these original source frames. Do not classify visibly printed promotion as clean merely because the camera footage is real.';

const unconfirmedSourceText='Наличие и содержание надписей исходника не подтверждены моделью.';

export function documentarySourceText(value:Record<string,unknown>):NonNullable<NonNullable<Scene['documentary']>['visualReview']>['sourceText']{
  const source=value.sourceText;
  if(!source||typeof source!=='object'||Array.isArray(source))return;
  const row=source as Record<string,unknown>;
  const text=row.kind==='none'&&!Object.hasOwn(row,'text')?'':row.text;
  if((row.kind==='caption'||row.kind==='uncertain')&&typeof text==='string'&&!text.trim())
    return {version:1,kind:'uncertain',text:'',note:unconfirmedSourceText};
  if(typeof row.kind!=='string'||!['none','physical','caption','promotion','uncertain'].includes(row.kind)||typeof text!=='string'
    ||row.kind==='none'&&text.trim()||row.kind!=='none'&&!text.trim())return;
  return {version:1,kind:row.kind as 'none'|'physical'|'caption'|'promotion'|'uncertain',text:text.slice(0,600),
    ...(typeof row.relevant==='boolean'?{relevant:row.relevant}:{}),
    ...(typeof row.evidence==='string'&&row.evidence.trim()?{evidence:row.evidence.trim().slice(0,1200)}:{})};
}

export function documentarySourceTextIssue(value:Record<string,unknown>,required=false):string|undefined{
  const source=documentarySourceText(value);
  if(!source)return required?'Анализ не подтвердил отсутствие рекламных надписей исходника. Ответ сохранён без повторной оплаты.':undefined;
  if(source.kind==='promotion')return `В исходнике видна рекламная надпись или маркировка автора: ${source.text}. Нужен чистый футаж.`;
  if(source.kind==='uncertain'&&(required||source.text.trim()))return 'Не определён характер видимой надписи исходника; материал не подтверждён.';
}

/** A completed source-only OCR answer may describe our three frames separately. */
export function receivedDocumentarySourceText(raw:string):Record<string,unknown>|undefined{
  const fences=[...raw.matchAll(/```(?:json)?[ \t]*\r?\n([\s\S]*?)```/gi)];if(fences.length>1)return;
  let value:unknown;try{value=JSON.parse(fences.length?fences[0]![1]!:raw.trim());}catch{return;}
  if(!Array.isArray(value)||value.length!==3)return;
  const rows=value.map(row=>row&&typeof row==='object'&&!Array.isArray(row)?documentarySourceText(row as Record<string,unknown>):undefined);
  if(rows.some(row=>!row))return;
  const valid=rows as Array<NonNullable<ReturnType<typeof documentarySourceText>>>;
  const kind=(['promotion','uncertain','caption','physical','none'] as const).find(kind=>valid.some(row=>row.kind===kind))!;
  return {sourceText:{kind,text:[...new Set(valid.map(row=>row.text).filter(Boolean))].join('; ')}};
}

export function enforceDocumentaryTechnicalQuality(value:Record<string,unknown>,required=false,ordinaryVisual=false,sourceTextRequired=false):Record<string,unknown>{
  if(Array.isArray(value.reviews))return {...value,reviews:value.reviews.map(row=>row&&typeof row==='object'?enforceDocumentaryTechnicalQuality(row as Record<string,unknown>,required,ordinaryVisual,sourceTextRequired):row)};
  if(required&&!sourceTextRequired&&value.status==='accepted'){
    const sourceText=documentarySourceText(value);
    // Preserve missing/empty incidental OCR as uncertainty, never as "none".
    // Other malformed fields and explicitly seen promotion remain blocking.
    if(value.sourceText===undefined||sourceText?.kind==='uncertain'&&!sourceText.text)
      value={...value,sourceText:sourceText??{version:1,kind:'uncertain',text:'',note:unconfirmedSourceText},
        quality:[value.quality,unconfirmedSourceText].filter(Boolean).join(' ')};
    else if(!sourceText)return {...value,status:'uncertain',annotations:[],reason:'Некорректная классификация видимых надписей исходника. Ответ сохранён без повторной оплаты.'};
  }
  const sourceIssue=value.status==='accepted'&&documentarySourceTextIssue(value,sourceTextRequired);
  if(sourceIssue)return {...value,status:documentarySourceText(value)?.kind==='promotion'?'rejected':'uncertain',annotations:[],reason:sourceIssue};
  if(required&&value.status!==undefined&&!['accepted','rejected','uncertain'].includes(String(value.status)))
    return {...value,status:'uncertain',annotations:[],reason:'Анализ вернул неподдерживаемый статус результата. Ответ сохранён; положительный текст причины не является подтверждением качества.'};
  const quality=value.technicalQuality as {detail?:string;compression?:string;pixelated?:boolean;evidence?:string;orientation?:string;continuousShot?:boolean}|undefined;
  if(required&&value.status==='accepted'&&(!quality||!['clear','soft','unusable'].includes(quality.detail??'')||!['clean','visible','severe'].includes(quality.compression??'')||typeof quality.pixelated!=='boolean'||typeof quality.evidence!=='string'||!quality.evidence.trim()))
    return {...value,status:'uncertain',annotations:[],reason:'Анализ не подтвердил техническое качество исходника. Ответ сохранён; повторная оплата этого запроса не требуется.'};
  if(ordinaryVisual&&value.status==='accepted'&&(quality?.orientation!=='upright'||quality.continuousShot!==true))
    return {...value,status:quality?.orientation==='sideways'||quality?.orientation==='upside-down'||quality?.continuousShot===false?'rejected':'uncertain',annotations:[],
      reason:documentaryRangeIssue(value)==='cut'
        ?'Внутри выбранного отрезка обнаружена склейка. Нужен другой непрерывный участок этого источника.'
        :quality?.orientation==='sideways'||quality?.orientation==='upside-down'
          ?'Выбранный кадр повёрнут набок или перевёрнут. Нужен правильно ориентированный материал.'
          :'Анализ не подтвердил ориентацию и непрерывность выбранного кадра. Ответ сохранён без повторной оплаты.'};
  if(value.status==='accepted'&&quality&&(quality.pixelated===true||quality.detail==='unusable'||quality.compression==='severe'))
    return {...value,status:'rejected',annotations:[],reason:`Недостаточное качество исходника: ${String(quality.evidence??'пикселизация, размытие или сильное сжатие').slice(0,400)}`};
  return value;
}

export function documentaryRangeIssue(value:Record<string,unknown>):'cut'|undefined{
  const quality=value.technicalQuality;
  if(!quality||typeof quality!=='object'||Array.isArray(quality))return;
  const row=quality as Record<string,unknown>;
  return row.orientation==='upright'&&row.continuousShot===false?'cut':undefined;
}

export function documentarySavedQualityIssue(project:Pick<Project,'aspectRatio'>,scene:Scene):string|undefined{
  const doc=scene.documentary;if(!doc?.verified||doc.pinned)return;
  if(!doc.selected&&doc.motionGraphic?.origin==='automatic')return;
  const geometryIssue=documentaryKnownOriginalGeometryIssue(project,scene);
  if(geometryIssue)return geometryIssue;
  if(doc.visualReview?.illustrationApproval)return;
  return documentarySourceTextIssue((doc.visualReview??{}) as unknown as Record<string,unknown>)
    ||documentarySourceQualityIssue(doc.selected,project.aspectRatio,documentaryQualityPresentation(scene));
}
