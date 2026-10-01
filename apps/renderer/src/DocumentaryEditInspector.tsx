import type { DocumentaryTextClip, DocumentaryVisualCut, Scene } from "@gold-work/shared";
import { DocumentarySourcePicker } from "./DocumentarySourcePicker";

export function DocumentaryTextInspector({ text, sceneStart, duration, onChange, onDelete }: {
  text: DocumentaryTextClip; sceneStart: number; duration: number;
  onChange: (text: DocumentaryTextClip) => void; onDelete: () => void;
}) {
  const patch = (value: Partial<DocumentaryTextClip>) => onChange({ ...text, ...value });
  const start = sceneStart + text.startSeconds;
  return <section className="documentary-edit-inspector"><small>ТЕКСТОВЫЙ КЛИП</small>
    <label>Текст<textarea aria-label="Текст клипа" rows={3} value={text.text} onChange={e => patch({ text: e.target.value })} /></label>
    <div className="timeline-two-fields">
      <label>Начало, с<input type="number" min={0} max={duration-text.durationSeconds} step={1/30} value={Number(start.toFixed(2))} onChange={e => patch({ startSeconds: Math.max(0, Math.min(duration-text.durationSeconds, Number(e.target.value)))-sceneStart })} /></label>
      <label>Длительность, с<input type="number" min={1/30} max={duration-start} step={.1} value={Number(text.durationSeconds.toFixed(2))} onChange={e => patch({ durationSeconds: Math.max(1/30, Math.min(duration-start, Number(e.target.value))) })} /></label>
      <label>Размер<input type="number" min={20} max={192} value={text.fontSize} onChange={e => patch({ fontSize: Math.max(20, Math.min(192, Number(e.target.value))) })} /></label>
      <label>Цвет<input type="color" value={text.color} onChange={e => patch({ color: e.target.value })} /></label>
      <label>X, %<input type="number" min={0} max={100} value={text.x} onChange={e => patch({ x: Math.max(0, Math.min(100, Number(e.target.value))) })} /></label>
      <label>Y, %<input type="number" min={0} max={100} value={text.y} onChange={e => patch({ y: Math.max(0, Math.min(100, Number(e.target.value))) })} /></label>
      <label>Появление, с<input type="number" min={0} max={text.durationSeconds/2} step={.05} value={text.fadeInSeconds} onChange={e => patch({ fadeInSeconds: Math.max(0, Math.min(text.durationSeconds/2, Number(e.target.value))) })} /></label>
      <label>Исчезание, с<input type="number" min={0} max={text.durationSeconds/2} step={.05} value={text.fadeOutSeconds} onChange={e => patch({ fadeOutSeconds: Math.max(0, Math.min(text.durationSeconds/2, Number(e.target.value))) })} /></label>
    </div>
    <label>Анимация<select value={text.animation} onChange={e => patch({ animation: e.target.value as DocumentaryTextClip["animation"] })}>
      <option value="fade">Проявление</option><option value="slide">Плавный подъём</option><option value="zoom">Плавный наезд</option><option value="typing">Печатная машинка</option>
    </select></label>
    <label>Непрозрачность, {text.opacity}%<input type="range" min={0} max={100} value={text.opacity} onChange={e => patch({ opacity: Number(e.target.value) })} /></label>
    <label>Подложка, {text.backgroundOpacity ?? 0}%<input type="range" min={0} max={100} value={text.backgroundOpacity ?? 0} onChange={e => patch({ backgroundOpacity: Number(e.target.value) })} /></label>
    <div className="timeline-audio-actions"><button onClick={() => patch({ enabled: !text.enabled })}>{text.enabled ? "Скрыть текст" : "Показать текст"}</button><button onClick={onDelete}>Удалить текст</button></div>
    <p className="timeline-live-note">Перетаскивайте клип и его края на дорожке «Текст». Alt отключает привязку к границам сцен. M — скрыть, Delete — удалить.</p>
  </section>;
}

export function DocumentaryCutInspector({cut, scene, scenes, onChange, onMerge, onReset}: {
  cut: DocumentaryVisualCut; scene: Scene; scenes: Scene[];
  onChange: (cut: DocumentaryVisualCut) => void; onMerge: () => void; onReset: () => void;
}) {
  const source = scenes.find(s => s.id === cut.sourceSceneId) ?? scene;
  const maxStart = Math.max(0, (source.documentary?.selected?.durationSeconds ?? 86400) - 1/30);
  return <section className="documentary-edit-inspector"><small>ФРАГМЕНТ ВИДЕОРЯДА · {(cut.durationInFrames/30).toFixed(2)} С</small>
    <DocumentarySourcePicker label="Материал фрагмента" scenes={scenes.filter(s => s.id===scene.id || s.documentary?.verified && (s.videoPath || s.imagePath))} value={source.id}
      start={cut.trimStartSeconds} end={cut.trimEndSeconds ?? cut.trimStartSeconds + cut.durationInFrames / 30 * cut.playbackRate}
      onChange={next => onChange({...cut,sourceSceneId:next.id===scene.id?undefined:next.id,trimStartSeconds:next.trimStartSeconds ?? 0,trimEndSeconds:next.trimEndSeconds})} />
    <div className="timeline-two-fields"><label>Начало в исходнике, с<input aria-label="Начало фрагмента" type="number" min={0} max={maxStart} step={.1} value={Number(cut.trimStartSeconds.toFixed(2))} onChange={e => onChange({...cut,trimStartSeconds:Math.max(0,Math.min(maxStart,Number(e.target.value))),trimEndSeconds:undefined})}/></label>
      <label>Скорость<select value={cut.playbackRate} onChange={e=>onChange({...cut,playbackRate:Number(e.target.value),trimEndSeconds:undefined})}>{[.25,.5,.75,1,1.25,1.5,2,4].map(rate=><option key={rate} value={rate}>{rate}×</option>)}</select></label></div>
    <div className="timeline-audio-actions"><button disabled={cut.fromFrame===0} onClick={onMerge}>Слить с предыдущим</button><button onClick={onReset}>Убрать разрезы</button></div>
    <p className="timeline-live-note">Разрезы меняют только картинку, речь остаётся целой. Края двигают стык; Alt + перетаскивание сдвигает содержимое.</p>
  </section>;
}
