import type { DocumentarySettings, ProjectSettings } from "@gold-work/shared";
import {documentaryTemplates} from '@gold-work/shared';
export function DocumentarySettingsPanel({ assembly, onChange }: { assembly: ProjectSettings["assembly"]; onChange: (assembly: ProjectSettings["assembly"]) => void }) {
  const doc = assembly.documentary!;
  const patch = (input: Partial<DocumentarySettings>) => onChange({ ...assembly, documentary: { ...doc, ...input } });
  return <section className="settings-panel documentary-settings"><h3>ДОКУМЕНТАЛЬНЫЙ МОНТАЖ</h3>
    <p>Программа составляет предметные запросы, ищет фото и видео, проверяет качество и объект на реальных кадрах. Сомнительный выбор остаётся виден для проверки.</p>
    <p className="timeline-live-note">Сцены уже подготовлены. Их длительность уточняется по озвучке; текущий темп: {doc.pace === "calm" ? "спокойный" : doc.pace === "balanced" ? "сбалансированный" : "динамичный"}. Изменять отдельные кадры можно в редакторе.</p>
    <label>Переход<select value={assembly.transitionType ?? "none"} onChange={event => onChange({ ...assembly, transitionType: event.target.value as "none" | "mix" | "fade", fadeTransitions: event.target.value !== "none" })}><option value="none">Склейка</option><option value="mix">Растворение</option><option value="fade">Через чёрный</option></select></label>
    {(assembly.transitionType ?? "none") !== "none" && <label>Длительность перехода, с<input type="number" min={0.1} max={1.5} step={0.05} value={assembly.transitionDurationSeconds ?? 0.35} onChange={event => onChange({ ...assembly, transitionDurationSeconds: Math.max(0.1, Math.min(1.5, Number(event.target.value))) })} /></label>}
    {(assembly.transitionType ?? "none") === "none" && <small>Склейка — мгновенная смена кадра, без длительности. Автоматические акценты ниже могут добавить отдельные переходы на сменах темы.</small>}
    <div className="timeline-two-fields">{(["backgroundColor", "accentColor", "textColor"] as const).map((key, index) => <label key={key}>{["Фон", "Акцент", "Текст сравнения"][index]}<input type="color" value={doc[key]} onChange={event => patch({ [key]: event.target.value })} /></label>)}</div>
    <label><input type="checkbox" checked={doc.captionsEnabled} onChange={event => patch({ captionsEnabled: event.target.checked })} /> Показывать добавленные подписи</label>
    <label><input type="checkbox" checked={doc.autoMotionGraphics !== false} onChange={event => patch({ autoMotionGraphics: event.target.checked })} /> Motion-графика по смыслу: карты, даты, числа, главы</label>
    <small>Для новых сцен — редкие акценты из исходного текста. Для загрузки спутниковой карты нужен интернет; сохранённая карта доступна без сети. Любую анимацию можно настроить в редакторе.</small>
    <details><summary>Шаблоны для автоматического выбора · исключено {doc.excludedTemplates?.length??0}</summary>
      <small>Отмеченные композиции софт может применять сам. Исключение не меняет сохранённые ручные правки; обновление автомонтажа применяет новый набор.</small>
      <div className="documentary-template-exclusions">{documentaryTemplates.filter(([id])=>id!=='full').map(([id,label])=><label key={id}><input type="checkbox" checked={!doc.excludedTemplates?.includes(id)} onChange={event=>patch({excludedTemplates:event.target.checked?(doc.excludedTemplates??[]).filter(item=>item!==id):[...doc.excludedTemplates??[],id]})}/>{label}</label>)}</div>
    </details>
    <label><input type="checkbox" checked={(doc.autoTransitions ?? doc.autoEffects) !== false} onChange={event => patch({ autoTransitions: event.target.checked })} /> Автоматические переходы между фото и видео</label>
    <label>Насыщенность монтажа<select value={doc.montageDensity??'rich'} onChange={e=>patch({montageDensity:e.target.value as 'calm'|'balanced'|'rich'})}><option value="calm">Спокойный · редкие акценты</option><option value="balanced">Умеренный</option><option value="rich">Насыщенный · переходы, вставки, экран</option></select></label>
    <small>Короткие растворения связывают фотографии одной темы; смены разделов получают отдельные акценты. Длительность речи сохраняется. Любой стык можно изменить кнопкой между кадрами в редакторе.</small>
    <label><input type="checkbox" checked={doc.autoEffects !== false} onChange={event => patch({ autoEffects: event.target.checked })} /> Редкие звуковые акценты по смыслу</label>
    <small>Только проверенные звуки у важных событий. Визуальный переход сам по себе не добавляет звук.</small>
    <label>Общая громкость эффектов · {doc.sfxVolume}%<input type="range" min={0} max={100} value={doc.sfxVolume} onChange={event => patch({ sfxVolume: Number(event.target.value) })} /></label>
    <small>Под озвучкой эффекты дополнительно приглушаются. Настройки отдельного кадра доступны в свойствах редактора.</small>
  </section>;
}
