import type { Project } from "@gold-work/shared";
import {documentaryMaterialUsable,validDocumentaryPlace,documentaryRoutePlaces,groundedDocumentaryMotion} from '@gold-work/shared';
import {documentaryRouteBounds,documentaryRouteKey} from '@gold-work/remotion-video';
import {validateMotionArtwork} from './documentary-artwork-plan.js';
import {artworkSourceCandidates} from './documentary-artwork-previews.js';
import {documentaryDiagram} from './documentary-diagram-plan.js';
import {isDeepStrictEqual} from 'node:util';
import {documentaryVisualSourceIssue} from './documentary-source-eligibility.js';
import {documentarySavedQualityIssue} from './documentary-source-quality.js';
import {savedRouteComparisonIssue} from './documentary-route-comparison.js';

/** Fail visibly before rendering invalid edits; never silently drop an effect or a comparison. */
export function documentaryEditErrors(project: Project): string[] {
  if (project.mediaMode !== "stock" || project.settings.assembly.documentary?.version !== 2) return [];
  const errors: string[] = [];
  const included = project.scenes.filter(scene => scene.includeInAssembly !== false).sort((a, b) => a.order - b.order);
  const durationOf = (scene: Project["scenes"][number]) => Math.max((scene.documentary?.timing?.durationInFrames ?? Math.ceil(scene.durationSeconds * 30)) / 30, scene.durationOverrideSeconds ?? 0);
  const totalSeconds = included.reduce((sum, scene) => sum + durationOf(scene), 0);
  let cursor = 0;
  for (const scene of included) {
    const sceneStart = cursor;
    cursor += durationOf(scene);
    const doc = scene.documentary;
    const issue = (text: string) => errors.push(`сцена ${scene.order + 1}: ${text}`);
    if (!doc) { issue("нет плана Stock"); continue; }
    const qualityIssue=documentarySavedQualityIssue(project,scene);
    if(qualityIssue)issue(qualityIssue);
    const sourceIssue=documentaryVisualSourceIssue(scene,project.scenes);
    if(sourceIssue)issue(sourceIssue);
    const duration = Math.max((doc.timing?.durationInFrames ?? Math.ceil(scene.durationSeconds * 30)) / 30, scene.durationOverrideSeconds ?? 0);
    const range = (value: number, low: number, high: number) => Number.isFinite(value) && value >= low && value <= high;
    const graphic=doc.motionGraphic;
    if(graphic?.enabled){
      // The composition already bounds automatic graphics to the measured
      // scene. A saved pre-narration duration must not block reassembly; manual
      // edits and invalid numeric values still require correction.
      const renderedDuration=graphic.origin==='automatic'&&Number.isFinite(graphic.durationSeconds)&&graphic.durationSeconds>0
        ?Math.min(graphic.durationSeconds,duration-graphic.startSeconds):graphic.durationSeconds;
      if(!range(graphic.startSeconds,0,duration)||!range(renderedDuration,.033,duration-graphic.startSeconds+.034)) issue('motion-графика выходит за границы сцены');
      if(graphic.routeComparison){
        const problem=savedRouteComparisonIssue(project,scene);if(problem)issue(problem);
        if(graphic.kind!=='map-route'||scene.imagePath||scene.videoPath||doc.selected)issue('схема маршрутов не должна объявляться стоковым материалом');
      }else if(graphic.artwork){
        const members=graphic.artworkSpan&&graphic.sequenceId
          ?included.filter(s=>s.documentary?.motionGraphic?.sequenceId===graphic.sequenceId):[scene];
        const first=included.indexOf(members[0]!),last=included.indexOf(members.at(-1)!);
        const context=included.slice(Math.max(0,first-1),last+2).map(s=>s.narration).join(' ');
        const artworkDuration=members.reduce((sum,s)=>sum+durationOf(s),0);
        const [w,h]=project.aspectRatio.split(':').map(Number);
        const checked=validateMotionArtwork(graphic.artwork,context,artworkDuration,Boolean(scene.imagePath||scene.videoPath),w!/h!,
          {...doc.selected,contain:doc.layout==='contain'||doc.layout==='compare',
            mediaAllowed:Boolean(doc.semanticMontage?.artworkBrief)||doc.semanticMontage?.artworkMode!=='standalone',
            currentSceneId:scene.id,allowedSources:artworkSourceCandidates(project,scene.id)},Boolean(graphic.artworkSpan));
        if(checked.issue)issue(`некорректная AI-композиция: ${checked.issue}`);
      }else if(graphic.explanation){
        const explanation=graphic.explanation,sequence=explanation.sequence;
        const members=sequence?included.filter(s=>s.documentary?.motionGraphic?.explanation?.sequence?.id===sequence.id):[scene];
        const canonical=(text:string)=>text.toLocaleLowerCase().replace(/\s+/gu,' ').trim();
        const context=canonical(members.map(s=>s.narration).join(' '));
        const literal=(text:unknown)=>typeof text==='string'&&text.trim().length>0&&text.length<=60&&context.includes(canonical(text));
        const nodes=explanation.nodes;
        if(!['flow','branch','merge','exchange','cycle','contrast'].includes(explanation.kind)||!Array.isArray(nodes)
          ||nodes.length<2||nodes.length>4||explanation.kind==='exchange'&&nodes.length!==2
          ||['branch','merge'].includes(explanation.kind)&&nodes.length<3
          ||nodes.some(n=>!n||typeof n.id!=='string'||!n.id||n.id.length>30||!literal(n.label)
            ||!['person','team','machine','motorcycle','signal','energy','document','place','time','generic'].includes(n.symbol)
            ||n.objectType!==undefined&&(n.objectType!=='motorcycle'||n.symbol!=='motorcycle'))
          ||new Set(nodes.map(n=>n.id)).size!==nodes.length||new Set(nodes.map(n=>canonical(n.label))).size!==nodes.length
          ||explanation.emphasis!==undefined&&!literal(explanation.emphasis)
          ||explanation.signal!==undefined&&!['steady','interrupted'].includes(explanation.signal))issue('проверьте узлы, подписи и тип объяснения');
        if(sequence){
          let offset=0;const total=members.reduce((sum,s)=>sum+Math.round(durationOf(s)*30),0),first=included.indexOf(members[0]!);
          const valid=typeof sequence.id==='string'&&Boolean(sequence.id)&&Number.isInteger(sequence.offsetFrames)&&Number.isInteger(sequence.durationInFrames)
            &&sequence.offsetFrames>=0&&sequence.durationInFrames>0&&members.every((s,i)=>{
            const value=s.documentary!.motionGraphic!.explanation!,clock=value.sequence!;
            const matches=included[first+i]===s&&clock.offsetFrames===offset&&clock.durationInFrames===total
              &&isDeepStrictEqual({...value,sequence:undefined},{...explanation,sequence:undefined});
            offset+=Math.round(durationOf(s)*30);return matches;
          });
          if(!valid)issue('нарушена непрерывность объяснения между сценами');
        }
      }else if(graphic.diagram&&graphic.origin==='automatic'){
        if(!isDeepStrictEqual(documentaryDiagram(scene,graphic),graphic.diagram))issue('диаграмма не соответствует числам и единицам озвучки');
      }else{
      if(graphic.kind.startsWith('map-')&&!validDocumentaryPlace(graphic.place)) issue('выберите место и корректные координаты карты');
      if(graphic.regionRadiusKm!==undefined&&!range(graphic.regionRadiusKm,0,50))issue('радиус выделения окрестностей должен быть от 0 до 50 км');
      if(graphic.kind==='map-route') {
        const points=documentaryRoutePlaces(graphic);
        try { documentaryRouteBounds(points); } catch { issue('укажите 2–8 корректных точек маршрута в пределах поддерживаемого спутникового охвата'); }
        if(graphic.detail?.kind!=='satellite'||!graphic.detail.bounds||graphic.detail.routeKey!==documentaryRouteKey(points))issue('загрузите спутниковый снимок для текущего маршрута');
      }
      if(graphic.kind==='map-locator'&&graphic.cityDetail!==false&&(
        graphic.detail?.kind!=='satellite'||!graphic.place||Math.abs(graphic.detail.latitude-graphic.place.latitude)>.0001||Math.abs(graphic.detail.longitude-graphic.place.longitude)>.0001||Math.abs(graphic.detail.radiusKm-(graphic.mapRadiusKm??35))>.01))issue('загрузите спутниковый снимок для выбранного места и охвата; схема вместо снимка не используется');
      if(graphic.kind==='chronology'){
        // Date cards render their complete literal value; ordinary timelines
        // still require a bare year. Reuse the planner's existing date format.
        const valid=graphic.variant==='date'
          ?groundedDocumentaryMotion({kind:'chronology',variant:'date',value:graphic.value},graphic.value??'',graphic.value??'')
          :/^\d{3,4}$/.test(graphic.value??'');
        if(!valid)issue(graphic.variant==='date'?'укажите дату с годом для карточки даты':'укажите год для шкалы времени');
      }
      if(graphic.kind==='statistic'&&!/\d/.test(graphic.value??'')&&!groundedDocumentaryMotion({kind:'statistic',value:graphic.value},graphic.value??'',graphic.value??'')) issue('укажите число для счётчика');
      if(graphic.kind==='feature-list'&&!(graphic.items?.length&&graphic.items.length>=2)) issue('добавьте хотя бы два пункта списка');
      if(graphic.kind==='subject-card'&&!graphic.title.trim())issue('укажите имя героя или название объекта');
      if(graphic.kind==='quote'&&(!graphic.title.trim()||graphic.title.length>320||graphic.highlight&&!graphic.title.toLocaleLowerCase().includes(graphic.highlight.toLocaleLowerCase())))issue('цитата должна содержать выделяемую фразу и быть не длиннее 320 символов');
      if(graphic.kind==='bar-chart'){
        const cards=graphic.cards??[];
        if(cards.length<2||cards.length>5||cards.some(c=>!c.label.trim()||!/^\d+(?:[.,]\d+)?\s*[^\d]*$/u.test(c.value??'')))issue('диаграмме нужны 2–5 подписанных числовых значений');
        if(new Set(cards.map(c=>c.value?.replace(/^[\d.,]+\s*/u,'').toLocaleLowerCase())).size>1)issue('значения диаграммы должны иметь одинаковые единицы');
      }
      if(graphic.kind==='explainer'){
        // A single illustrated evidence card is supported by the planner and
        // renderer; a comparison or an unillustrated list still needs two.
        const minimumCards=graphic.boardLayout!=='compare'&&graphic.cards?.[0]?.sceneId?1:2;
        if(!graphic.cards||graphic.cards.length<minimumCards||graphic.cards.length>5||graphic.cards.some(c=>!c.label.trim()))issue('добавьте от двух до пяти подписанных карточек разбора или одну карточку с материалом');
        if(graphic.cards?.some(card=>card.sceneId&&!project.scenes.some(s=>s.id===card.sceneId&&documentaryMaterialUsable(s)&&s.imagePath)))issue('карточка разбора ссылается на недоступный материал');
        // A typographic comparison has no source identity to verify. Once any
        // card uses footage, all cards still need their reviewed materials.
        if(graphic.boardLayout==='compare'&&graphic.cards?.some(card=>card.sceneId)&&graphic.cards.some(card=>!card.sceneId))issue('для сравнения выберите проверенный материал каждой карточки');
      }
      if(graphic.kind==='annotations'){
        if(!graphic.annotations?.length||graphic.annotations.length>3)issue('добавьте от одной до трёх выносок');
        if(graphic.origin==='automatic'&&graphic.sourceChecksum!==doc.checksum)issue('выноски относятся к другому исходнику; обновите разбор');
        for(const annotation of graphic.annotations??[]){
          if(!annotation.label.trim()||annotation.label.length>48||!annotation.points.length||annotation.points.some((p,i)=>!range(p.x,0,100)||!range(p.y,0,100)||!range(p.seconds,0,graphic.durationSeconds+.2)||(i>0&&p.seconds<=annotation.points[i-1]!.seconds)))issue('проверьте текст, время и координаты выноски');
        }
      }
      if(graphic.presentation==='panels'){
        if(graphic.kind!=='feature-list'||graphic.panels?.length!==3||!Number.isInteger(graphic.activeIndex)||!range(graphic.activeIndex!,0,2))issue('для трёх панелей выберите три материала и активный пункт');
        else if(graphic.panels.some(panel=>!project.scenes.some(source=>source.id===panel.sceneId&&documentaryMaterialUsable(source)&&source.imagePath)))issue('панель ссылается на материал без доступного постера');
      }
      }
    }
    let cutEnd = 0;
    for (const cut of doc.cuts ?? []) {
      if (cut.fromFrame !== cutEnd || !Number.isInteger(cut.durationInFrames) || cut.durationInFrames < 1 || !range(cut.trimStartSeconds,0,86400) || !range(cut.playbackRate,.25,4)) issue("неверные границы разреза картинки");
      if (cut.sourceSceneId && !project.scenes.some(item=>item.id===cut.sourceSceneId&&documentaryMaterialUsable(item)&&(item.imagePath||item.videoPath))) issue("материал одного из разрезов больше недоступен");
      const source = cut.sourceSceneId ? project.scenes.find(item=>item.id===cut.sourceSceneId) : scene;
      const sourceEnd = source?.documentary?.selected?.durationSeconds;
      if (source?.videoPath && (cut.trimEndSeconds !== undefined && !(cut.trimEndSeconds > cut.trimStartSeconds) || sourceEnd !== undefined && cut.trimStartSeconds >= sourceEnd)) issue("начало фрагмента выходит за исходное видео");
      cutEnd = cut.fromFrame + cut.durationInFrames;
    }
    if (doc.cuts?.length && cutEnd !== Math.round(duration * 30)) issue("разрезы картинки должны покрывать всю длительность сцены");
    for (const text of doc.texts ?? []) if (text.enabled) {
      if (!range(text.startSeconds,-sceneStart,totalSeconds-sceneStart) || !range(text.durationSeconds,1/30,totalSeconds-sceneStart-text.startSeconds+.034) || !range(text.x,0,100) || !range(text.y,0,100) || !range(text.fontSize,20,192)) issue("проверьте длительность и положение текста");
      if (!range(text.fadeInSeconds,0,86400) || !range(text.fadeOutSeconds,0,86400) || !range(text.opacity,0,100) || !range(text.backgroundOpacity??0,0,100)) issue("проверьте плавность и прозрачность текста");
    }
    if (doc.layout === "compare") {
      const other = project.scenes.find(other => other.id === doc.comparison?.sceneId && other.id !== scene.id);
      if (!other || !documentaryMaterialUsable(other) || !(other.imagePath || other.videoPath)) issue("выберите доступный материал для сравнения");
    }
    if (scene.videoPath) {
      const end = scene.trimEndSeconds ?? doc.selected?.durationSeconds;
      if (end !== undefined && !(end > (scene.trimStartSeconds ?? 0))) issue("обрезка видео выходит за длительность оригинала");
      if (scene.trimEndSeconds !== undefined && doc.selected?.durationSeconds && scene.trimEndSeconds > doc.selected.durationSeconds + 0.05) issue("конец видео выходит за оригинал");
    }
    const enabled = doc.effects.filter(effect => effect.enabled);
    if (enabled.filter(effect => effect.kind !== "audio" && effect.role !== "background").length > 2) issue("оставьте не более двух визуальных наложений");
    if (enabled.filter(effect => effect.role === "background").length > 1) issue("оставьте один фон");
    for (const effect of enabled) {
      const lower = effect.kind === "audio" ? -sceneStart : 0;
      const upper = effect.kind === "audio" ? totalSeconds - sceneStart : duration;
      if (!effect.filePath || !range(effect.startSeconds, lower, upper) || !range(effect.durationSeconds, 0.033, upper - effect.startSeconds + 0.034)) issue(`«${effect.name}»: слой выходит за границы ${effect.kind === "audio" ? "ролика" : "кадра"}`);
      if (!range(effect.scale, 0.1, 4) || !range(effect.x, -100, 100) || !range(effect.y, -100, 100)) issue(`«${effect.name}»: неверные размеры или положение`);
      const defaults = effect.defaults;
      if (!range(defaults.volume, 0, 100) || !range(defaults.opacity, 0, 100) || !range(defaults.fadeInSeconds, 0, effect.durationSeconds) || !range(defaults.fadeOutSeconds, 0, effect.durationSeconds) || !range(defaults.trimStartSeconds, 0, 86400) || defaults.trimEndSeconds !== undefined && !(defaults.trimEndSeconds > defaults.trimStartSeconds)) issue(`«${effect.name}»: проверьте обрезку, громкость и плавность`);
    }
  }
  return errors;
}
