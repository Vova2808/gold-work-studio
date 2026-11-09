import { useEffect, useRef, useState } from "react";
import { documentaryHookSeconds, type ProjectSettings } from "@gold-work/shared";
import { applyStockMontagePreset, patchStockMontage, selectedStockMontagePreset, stockMontagePresets, type StockMontagePreset } from "./stock-workflow-settings";
import "./stock-workflow.css";

const examples = {
  calm: new URL("./assets/stock-presets/calm.mp4", import.meta.url).href,
  expressive: new URL("./assets/stock-presets/expressive.mp4", import.meta.url).href,
};

export function StockMontageChoices({ assembly, onChange }: {
  assembly: ProjectSettings["assembly"];
  onChange: (assembly: ProjectSettings["assembly"]) => void;
}) {
  const selected = selectedStockMontagePreset(assembly);
  const [example, setExample] = useState<StockMontagePreset>();
  const [error, setError] = useState("");
  const player = useRef<HTMLVideoElement>(null);
  const stop = () => { const video = player.current; if (video) { video.pause(); video.currentTime = 0; } setExample(undefined); setError(""); };
  useEffect(() => {
    const video = player.current;
    if (!video || !example) return;
    void video.play().catch(() => setError("Нажмите воспроизведение в плеере."));
    return () => { video.pause(); video.removeAttribute("src"); video.load(); };
  }, [example]);
  useEffect(() => { const leave = () => { if (document.hidden) stop(); }; document.addEventListener("visibilitychange", leave); return () => document.removeEventListener("visibilitychange", leave); }, []);
  return <div className="stock-montage-choices">
    <div className="stock-montage-presets" role="group" aria-label="Характер монтажа">
      {stockMontagePresets.map(item => <div className="stock-montage-card" key={item.id}><button type="button" aria-pressed={selected === item.id} onClick={() => onChange(applyStockMontagePreset(assembly, item.id))}>
        <strong>{item.label}{selected === item.id && <span aria-hidden="true"> ✓</span>}</strong>
        <span>{item.description}</span><small>{item.detail}</small>
      </button><button type="button" className="outline-button small" aria-label={`Пример: ${item.label}`} onClick={() => { if (example === item.id) stop(); else { setError(""); setExample(item.id); } }}>{example === item.id ? "Остановить пример" : "Посмотреть пример"}</button></div>)}
    </div>
    {example && <div className="stock-montage-example">
      <strong>Пример · {stockMontagePresets.find(item => item.id === example)!.label}</strong>
      <video ref={player} key={example} controls playsInline preload="metadata" src={examples[example]} onEnded={stop} onError={() => setError("Не удалось воспроизвести локальный пример.")} aria-label={`Видеопример: ${example}`} />
      {error && <p role="status">{error}</p>}
      <small>10,2 с · один и тот же собственный демо-вход, 1280 × 720. Штатный локальный монтаж режима от 26.10.2026, без AI-плана, диктора и музыки. Показывает начало ролика; результат зависит от материалов. Просмотр не меняет настройки проекта.</small>
      <button type="button" className="outline-button small" onClick={stop}>Закрыть пример</button>
    </div>}
    {!selected && <p role="status">Сохранённый характер монтажа. Выбор выше применит новый характер к автоматическому монтажу.</p>}
    <label>Графические вставки <select aria-label="Графические вставки" value={assembly.documentary?.montage?.graphicsDensity ?? "rich"}
      onChange={event => onChange(patchStockMontage(assembly, { graphicsDensity: event.target.value as "sparse" | "rich" }))}>
      <option value="sparse">Редкие, только для объяснения</option><option value="rich">Насыщенные</option>
    </select></label>
    <label>Длительность вступления: {documentaryHookSeconds(assembly.documentary?.montage)} с <input type="range" aria-label="Длительность вступления, с" min={10} max={60} step={1}
      value={documentaryHookSeconds(assembly.documentary?.montage)}
      onChange={event => onChange(patchStockMontage(assembly, { hookSeconds: Number(event.target.value) }))} /></label>
    <p>Первые {documentaryHookSeconds(assembly.documentary?.montage)} секунд — активное вступление с перебивками по смыслу и коротким акцентом на главной мысли. Дальше — спокойнее, с редкими важными датами и пояснениями. Частота графики задаётся отдельно от ритма вступления.</p>
    <small>Ручные правки отдельных сцен сохраняются. Результат виден в предпросмотре после обновления монтажа.</small>
  </div>;
}
