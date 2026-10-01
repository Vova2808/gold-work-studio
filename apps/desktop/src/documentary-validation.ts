import type { Project } from "@gold-work/shared";
import {validDocumentaryPlace,documentaryRoutePlaces} from '@gold-work/shared';
import {documentaryRouteBounds,documentaryRouteKey} from '@gold-work/remotion-video';
import {documentarySavedQualityIssue} from './documentary-source-quality.js';

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
    const sourceQuality=doc.selected&&documentarySavedQualityIssue(project,scene);
    if(sourceQuality)issue(sourceQuality);
    const duration = Math.max((doc.timing?.durationInFrames ?? Math.ceil(scene.durationSeconds * 30)) / 30, scene.durationOverrideSeconds ?? 0);
    const range = (value: number, low: number, high: number) => Number.isFinite(value) && value >= low && value <= high;
    const graphic=doc.motionGraphic;
    if(graphic?.enabled){
      if(!range(graphic.startSeconds,0,duration)||!range(graphic.durationSeconds,.033,duration-graphic.startSeconds+.034)) issue('motion-графика выходит за границы сцены');
      if(graphic.kind.startsWith('map-')&&!validDocumentaryPlace(graphic.place)) issue('выберите место и корректные координаты карты');
      if(graphic.regionRadiusKm!==undefined&&!range(graphic.regionRadiusKm,0,50))issue('радиус выделения окрестностей должен быть от 0 до 50 км');
      if(graphic.kind==='map-route') {
        const points=documentaryRoutePlaces(graphic);
        try { documentaryRouteBounds(points); } catch { issue('укажите 2–8 корректных точек маршрута в пределах поддерживаемого спутникового охвата'); }
        if(graphic.detail?.kind!=='satellite'||!graphic.detail.bounds||graphic.detail.routeKey!==documentaryRouteKey(points))issue('загрузите спутниковый снимок для текущего маршрута');
      }
      if(graphic.kind==='map-locator'&&graphic.cityDetail!==false&&(
        graphic.detail?.kind!=='satellite'||!graphic.place||Math.abs(graphic.detail.latitude-graphic.place.latitude)>.0001||Math.abs(graphic.detail.longitude-graphic.place.longitude)>.0001||Math.abs(graphic.detail.radiusKm-(graphic.mapRadiusKm??35))>.01))issue('загрузите спутниковый снимок для выбранного места и охвата; схема вместо снимка не используется');
      if(graphic.kind==='chronology'&&!/^\d{3,4}$/.test(graphic.value??'')) issue('укажите год для шкалы времени');
      if(graphic.kind==='statistic'&&!/\d/.test(graphic.value??'')) issue('укажите число для счётчика');
      if(graphic.kind==='feature-list'&&!(graphic.items?.length&&graphic.items.length>=2)) issue('добавьте хотя бы два пункта списка');
      if(graphic.kind==='subject-card'&&!graphic.title.trim())issue('укажите имя героя или название объекта');
      if(graphic.kind==='quote'&&(!graphic.title.trim()||graphic.title.length>320||graphic.highlight&&!graphic.title.toLocaleLowerCase().includes(graphic.highlight.toLocaleLowerCase())))issue('цитата должна содержать выделяемую фразу и быть не длиннее 320 символов');
      if(graphic.kind==='bar-chart'){
        const cards=graphic.cards??[];
        if(cards.length<2||cards.length>5||cards.some(c=>!c.label.trim()||!/^\d+(?:[.,]\d+)?\s*[^\d]*$/u.test(c.value??'')))issue('диаграмме нужны 2–5 подписанных числовых значений');
        if(new Set(cards.map(c=>c.value?.replace(/^[\d.,]+\s*/u,'').toLocaleLowerCase())).size>1)issue('значения диаграммы должны иметь одинаковые единицы');
      }
      if(graphic.kind==='explainer'){
        if(!graphic.cards||graphic.cards.length<2||graphic.cards.length>5||graphic.cards.some(c=>!c.label.trim()))issue('добавьте от двух до пяти подписанных карточек разбора');
        if(graphic.cards?.some(card=>card.sceneId&&!project.scenes.some(s=>s.id===card.sceneId&&s.documentary?.verified&&s.imagePath)))issue('карточка разбора ссылается на неподтверждённый материал');
        if(graphic.boardLayout==='compare'&&graphic.cards?.some(card=>!card.sceneId))issue('для сравнения выберите проверенный материал каждой карточки');
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
        else if(graphic.panels.some(panel=>!project.scenes.some(source=>source.id===panel.sceneId&&source.documentary?.verified&&source.imagePath)))issue('панель ссылается на материал без подтверждённого постера');
      }
    }
    let cutEnd = 0;
    for (const cut of doc.cuts ?? []) {
      if (cut.fromFrame !== cutEnd || !Number.isInteger(cut.durationInFrames) || cut.durationInFrames < 1 || !range(cut.trimStartSeconds,0,86400) || !range(cut.playbackRate,.25,4)) issue("неверные границы разреза картинки");
      if (cut.sourceSceneId && !project.scenes.some(item=>item.id===cut.sourceSceneId&&item.documentary?.verified&&(item.imagePath||item.videoPath))) issue("материал одного из разрезов больше недоступен");
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
      if (!other?.documentary?.verified || !(other.imagePath || other.videoPath)) issue("выберите подтверждённый материал для сравнения");
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
