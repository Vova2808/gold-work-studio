import { useState } from "react";
import type { DesktopApi, DocumentaryArtwork, DocumentaryEffect, DocumentaryScene, EffectAsset, EffectLibrarySnapshot, Project, Scene } from "@gold-work/shared";
import { effectCategoryLabels, effectMediaUrl } from "./EffectLibraryPage";
import "./documentary.css";
import { documentaryTemplates, type DocumentaryTemplate } from "@gold-work/shared";
import { DocumentarySourcePicker, DocumentarySourcePreview } from "./DocumentarySourcePicker";
import { DocumentaryMotionInspector } from './DocumentaryMotionInspector';
import {DocumentaryTemplatePicker} from './DocumentaryTemplatePicker';

export function DocumentarySceneInspector({ api, project, scene, onChange, onArtworkChange }: { api: DesktopApi; project: Project; scene: Scene; onChange: (doc: DocumentaryScene) => void; onArtworkChange: (artwork: DocumentaryArtwork) => void }) {
  const doc = scene.documentary!;
  const [library, setLibrary] = useState<EffectLibrarySnapshot>();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [mediaKind, setMediaKind] = useState<"audio" | "visual">("audio");
  const [preview, setPreview] = useState<EffectAsset>();
  const [picker, setPicker] = useState(false);
  const [templatePicker,setTemplatePicker]=useState(false);
  const [replacing, setReplacing] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const duration = Math.max((doc.timing?.durationInFrames ?? Math.ceil(scene.durationSeconds * 30)) / 30, scene.durationOverrideSeconds ?? 0);
  const ordered = project.scenes.filter(item => item.includeInAssembly !== false).sort((a, b) => a.order - b.order);
  const seconds = (item: Scene) => Math.max((item.documentary?.timing?.durationInFrames ?? Math.ceil(item.durationSeconds * 30)) / 30, item.durationOverrideSeconds ?? 0);
  const sceneStart = ordered.slice(0, Math.max(0, ordered.findIndex(item => item.id === scene.id))).reduce((sum, item) => sum + seconds(item), 0);
  const remaining = ordered.reduce((sum, item) => sum + seconds(item), 0) - sceneStart;
  const patch = (input: Partial<DocumentaryScene>) => onChange({ ...doc, ...input });
  const caption = (input: Partial<DocumentaryScene["caption"]>) => patch({ caption: { ...doc.caption, ...input } });
  const chooseTemplate=(template?:DocumentaryTemplate)=>{
    const title=template?.startsWith('chapter');
    patch({template,templateOrigin:template?'manual':undefined,...(template?{layout:template.startsWith('compare-')?'compare':template==='contain'?'contain':'full'}:{}),
      ...(template&&doc.motionGraphic?{motionGraphic:{...doc.motionGraphic,enabled:false,origin:'manual'}}:{}),
      ...(title?{caption:{...doc.caption,enabled:true,text:doc.caption.text||doc.requirement.sectionTitle||'',position:'center',fontSize:Math.max(96,doc.caption.fontSize)}}:{})});
    setTemplatePicker(false);
  };
  const effect = (id: string, input: Partial<DocumentaryEffect>) => patch({ effects: doc.effects.map(item => item.id === id ? { ...item, ...input } : item) });
  const open = async (id?: string, kind: "audio" | "visual" = "audio") => {
    const previous = doc.effects.find(item => item.id === id);
    setMediaKind(previous ? previous.kind === "audio" ? "audio" : "visual" : kind);
    setCategory(""); setPreview(undefined);
    setReplacing(id); setPicker(true); setError("");
    try { setLibrary(await api.getEffectLibrary()); } catch (e) { setError(String(e)); }
  };
  const add = async (asset: EffectAsset) => {
    setBusy(true); setError("");
    try {
      const next = await api.prepareDocumentaryEffect(project.id, asset.id);
      const others = doc.effects.filter(item => item.id !== replacing);
      if (next.kind !== "audio" && next.role !== "background" && others.filter(item => item.kind !== "audio" && item.role !== "background").length >= 2) throw new Error("В кадре уже два визуальных наложения. Замените одно из них.");
      if (next.role === "background" && others.some(item => item.role === "background")) throw new Error("Замените существующий фон.");
      const previous = doc.effects.find(item => item.id === replacing);
      const maximum = next.kind === "audio" ? remaining : duration;
      if (next.kind === "audio" && next.durationSeconds > remaining + sceneStart) throw new Error("Этот звук длиннее всего ролика. Выберите короткий эффект или сначала задайте его обрезку в библиотеке.");
      const startSeconds = Math.max(next.kind === "audio" ? -sceneStart : 0, Math.min(previous?.startSeconds ?? 0, maximum - (next.kind === "audio" ? next.durationSeconds : .1)));
      const added = { ...next, startSeconds, durationSeconds: next.kind === "audio" ? next.durationSeconds : Math.min(next.durationSeconds, maximum - startSeconds) };
      patch({ effects: replacing ? doc.effects.map(item => item.id === replacing ? added : item) : [...others, added] });
      setPicker(false);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const items = library?.assets.filter(asset => !asset.deletedAt && asset.state === "ready" && asset.review !== "rejected" && (mediaKind === "audio" ? asset.kind === "audio" : asset.kind !== "audio") && (!category || asset.category === category) && `${asset.name} ${asset.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase())) ?? [];
  return <>
    {templatePicker&&<DocumentaryTemplatePicker value={doc.template} onChoose={chooseTemplate} onClose={()=>setTemplatePicker(false)}/>}
    <DocumentaryMotionInspector api={api} projectId={project.id} sceneId={scene.id} materials={project.scenes.filter(s=>s.documentary?.verified&&s.imagePath).map(s=>({id:s.id,title:`${s.order+1}. ${s.title}`}))} graphic={doc.motionGraphic} duration={duration} title={doc.caption.text||doc.requirement.sectionTitle||''} onChange={motionGraphic=>patch({motionGraphic})} onArtworkChange={onArtworkChange}/>
    <section className="documentary-inspector">
      <small>КАДР И СРАВНЕНИЕ</small>
      <label>Шаблон монтажа<select value={doc.template ?? "auto"} onChange={event=>chooseTemplate(event.target.value==='auto'?undefined:event.target.value as DocumentaryTemplate)}><option value="auto">Авто · по типу материала</option>{documentaryTemplates.map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <button type="button" className="outline-button" onClick={()=>setTemplatePicker(true)}>Выбрать по композиции · {documentaryTemplates.length}</button>
      <small>{documentaryTemplates.length} композиций. Выбор выключает текущую motion-графику; её можно снова включить выше. Текст задаётся в «Подпись / цифра», сравнение требует второго материала.</small>
      {doc.template?.startsWith("chapter-") && <div className="timeline-two-fields">
        <label>Сила движения, %<input type="range" min={0} max={40} value={doc.templateMotion?.amountPercent ?? 18} onChange={event=>patch({templateMotion:{amountPercent:Number(event.target.value),curve:doc.templateMotion?.curve??"smooth"}})} /></label>
        <label>Кривая движения<select value={doc.templateMotion?.curve??"smooth"} onChange={event=>patch({templateMotion:{amountPercent:doc.templateMotion?.amountPercent??18,curve:event.target.value as "smooth"|"dramatic"}})}><option value="smooth">Плавная S-кривая</option><option value="dramatic">Выраженное ускорение</option></select></label>
      </div>}
      {doc.narrationAlignment === "estimated" && <p className="documentary-photo-fallback">Озвучка готова. Привязка смены кадров к словам приблизительная; её нужно проверить на слух.</p>}
      {doc.selected?.kind === "image" && doc.requirement.preferredKind === "video" && <p className="documentary-photo-fallback">Фото вместо видео. Для этой сцены запрошено видео; сейчас выбрана фотография.</p>}
      <label>Размещение<select value={doc.layout} onChange={event => patch({ layout: event.target.value as DocumentaryScene["layout"], template: undefined })}><option value="full">Во весь кадр</option><option value="contain">Показать целиком</option><option value="compare">Два материала рядом</option></select></label>
      {doc.layout === "compare" && <>
        <label>Материал слева</label><DocumentarySourcePreview scene={scene} />
        <DocumentarySourcePicker label="Материал справа" scenes={project.scenes.filter(item => item.id !== scene.id && item.documentary?.verified)} value={doc.comparison?.sceneId ?? ""}
          onChange={next => patch({ comparison: { sceneId: next.id, leftLabel: doc.comparison?.leftLabel ?? "", rightLabel: doc.comparison?.rightLabel ?? "" } })} />
        {(["leftLabel", "rightLabel"] as const).map((key, i) => <label key={key}>{i ? "Подпись справа" : "Подпись слева"}<input maxLength={80} value={doc.comparison?.[key] ?? ""} onChange={event => patch({ comparison: { sceneId: doc.comparison?.sceneId ?? "", leftLabel: doc.comparison?.leftLabel ?? "", rightLabel: doc.comparison?.rightLabel ?? "", [key]: event.target.value } })} /></label>)}
      </>}
      <label><input type="checkbox" checked={doc.caption.enabled} onChange={event => caption({ enabled: event.target.checked })} /> Подпись / цифра</label>
      {doc.caption.enabled && <>
        <label>Текст<textarea rows={2} maxLength={160} value={doc.caption.text} onChange={event => caption({ text: event.target.value })} /></label>
        <div className="timeline-two-fields"><label>Положение<select value={doc.caption.position} onChange={event => caption({ position: event.target.value as DocumentaryScene["caption"]["position"] })}><option value="bottom">Снизу</option><option value="top">Сверху</option><option value="center">В центре</option></select></label>
          <label>Появление<select value={doc.caption.animation} onChange={event => caption({ animation: event.target.value as DocumentaryScene["caption"]["animation"] })}><option value="fade">Плавно</option><option value="slide">Сдвиг</option><option value="typing">Печать</option></select></label>
          <label>Размер<input type="number" min={20} max={192} value={doc.caption.fontSize} onChange={event => caption({ fontSize: Number(event.target.value) })} /></label>
          <label>Текст<input type="color" value={doc.caption.color} onChange={event => caption({ color: event.target.value })} /></label>
          <label>Подложка<input type="color" value={doc.caption.backgroundColor} onChange={event => caption({ backgroundColor: event.target.value })} /></label>
          <label>Плотность, %<input type="number" min={0} max={100} value={doc.caption.opacity} onChange={event => caption({ opacity: Number(event.target.value) })} /></label></div>
      </>}
    </section>
    <section className="documentary-inspector">
      <small>ЭФФЕКТЫ И ЗВУКИ</small><p className="timeline-live-note">Эффект копируется в проект. Звук футажа выключен; SFX приглушаются под озвучку.</p>
      {doc.effects.map(item => <details key={item.id} className="documentary-effect" open>
        <summary>{item.kind === "audio" ? "♫" : "▧"} {item.name}</summary>
        <label><input type="checkbox" checked={item.enabled} onChange={event => effect(item.id, { enabled: event.target.checked })} /> Включён</label>
        <div className="timeline-two-fields">
          <label>Начало от кадра, с<input type="number" min={item.kind === "audio" ? -sceneStart : 0} max={(item.kind === "audio" ? remaining : duration) - 0.1} step={0.1} value={item.startSeconds} onChange={event => { const maximum = item.kind === "audio" ? remaining : duration; const startSeconds = Math.max(item.kind === "audio" ? -sceneStart : 0, Math.min(maximum - 0.1, Number(event.target.value))); effect(item.id, { startSeconds, durationSeconds: Math.min(item.durationSeconds, maximum - startSeconds) }); }} /></label>
          <label>Длина, с<input type="number" min={0.1} max={(item.kind === "audio" ? remaining : duration) - item.startSeconds} step={0.1} value={item.durationSeconds} onChange={event => effect(item.id, { durationSeconds: Math.max(0.1, Math.min((item.kind === "audio" ? remaining : duration) - item.startSeconds, Number(event.target.value))) })} /></label>
          <label>Обрезка начала, с<input type="number" min={0} step={0.1} value={item.defaults.trimStartSeconds} onChange={event => effect(item.id, { defaults: { ...item.defaults, trimStartSeconds: Math.max(0, Number(event.target.value)), trimEndSeconds: undefined } })} /></label>
          <label>Громкость, %<input type="number" min={0} max={100} value={item.defaults.volume} onChange={event => effect(item.id, { defaults: { ...item.defaults, volume: Number(event.target.value) } })} /></label>
          {(["fadeInSeconds", "fadeOutSeconds"] as const).map((key, i) => <label key={key}>{i ? "Затухание, с" : "Нарастание, с"}<input type="number" min={0} max={item.durationSeconds} step={0.05} value={item.defaults[key]} onChange={event => effect(item.id, { defaults: { ...item.defaults, [key]: Math.max(0, Number(event.target.value)) } })} /></label>)}
        </div>
        {item.kind !== "audio" && <>
          <label>Слой<select value={item.role} onChange={event => effect(item.id, { role: event.target.value as DocumentaryEffect["role"] })}><option value="overlay">Наложение</option><option value="background">Фон</option><option value="transition">Переход</option></select></label>
          <label>Смешивание<select value={item.blend} onChange={event => effect(item.id, { blend: event.target.value as DocumentaryEffect["blend"] })}><option value="normal">Обычное</option><option value="screen">Screen</option><option value="add">Add</option><option value="multiply">Multiply</option></select></label>
          <label>Прозрачность, %<input type="range" min={0} max={100} value={item.defaults.opacity} onChange={event => effect(item.id, { defaults: { ...item.defaults, opacity: Number(event.target.value) } })} /></label>
          <div className="timeline-two-fields">{(["x", "y", "scale"] as const).map(key => <label key={key}>{key === "scale" ? "Масштаб" : `${key.toUpperCase()}, %`}<input type="number" min={key === "scale" ? 0.1 : -100} max={key === "scale" ? 4 : 100} step={key === "scale" ? 0.1 : 1} value={item[key]} onChange={event => effect(item.id, { [key]: Number(event.target.value) })} /></label>)}</div>
          {item.kind === "video" && <label><input type="checkbox" checked={item.defaults.sourceAudio} onChange={event => effect(item.id, { defaults: { ...item.defaults, sourceAudio: event.target.checked } })} /> Включить звук футажа</label>}
        </>}
        <div className="documentary-effect-actions"><button type="button" onClick={() => void open(item.id)}>Заменить</button><button type="button" onClick={() => patch({ effects: doc.effects.filter(other => other.id !== item.id) })}>Убрать</button></div>
      </details>)}
      <div className="documentary-effect-actions"><button type="button" onClick={() => void open(undefined, "audio")}>+ Звук</button><button type="button" onClick={() => void open(undefined, "visual")}>+ Визуальный эффект</button></div>
      {error && <p role="alert">{error}</p>}
    </section>
    {picker && <div className="documentary-effect-picker" role="dialog" aria-label="Выбор эффекта">
      <header><strong>{replacing ? "Заменить" : "Добавить"} {mediaKind === "audio" ? "звук" : "визуальный эффект"}</strong><button type="button" onClick={() => setPicker(false)}>Закрыть</button></header>
      <input aria-label="Поиск эффекта" placeholder="Клавиатура, click, transition…" value={query} onChange={event => setQuery(event.target.value)} />
      <select aria-label="Категория эффекта" value={category} onChange={event => setCategory(event.target.value)}><option value="">Все категории</option>{Object.entries(effectCategoryLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      <p>Прослушайте или просмотрите выбранный эффект. У непроверенных паков условия использования ещё не подтверждены.</p>
      {preview && library && <div className="documentary-effect-preview"><b>{preview.name}</b>{preview.kind === "audio" ? <audio controls src={effectMediaUrl(library.rootPath, preview.proxy ?? preview.file)} /> : preview.kind === "video" ? <video controls muted src={effectMediaUrl(library.rootPath, preview.proxy ?? preview.file)} /> : <img src={effectMediaUrl(library.rootPath, preview.file)} alt={preview.name} />}<button type="button" disabled={busy} onClick={() => void add(preview)}>{busy ? "Копирую…" : "Добавить в кадр"}</button></div>}
      <div className="documentary-effect-results">{items.slice(0, 120).map(asset => <button type="button" key={asset.id} onClick={() => setPreview(asset)}><img loading="lazy" src={effectMediaUrl(library!.rootPath, asset.poster ?? asset.waveform)} alt="" /><span>{asset.name}<small>{effectCategoryLabels[asset.category]} · {asset.review === "approved" ? "просмотрен" : "нужна проверка"}</small></span></button>)}</div>
      {error && <p role="alert">{error}</p>}
    </div>}
  </>;
}
