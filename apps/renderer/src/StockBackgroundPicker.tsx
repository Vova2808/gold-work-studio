import { useEffect, useState } from "react";
import { selectedDocumentaryBackgroundIds, type DesktopApi, type DocumentaryMontageSettings, type EffectImportProgress, type EffectLibrarySnapshot } from "@gold-work/shared";
import { libraryMediaUrl, selectableStockBackgrounds, toggleStockBackground } from "./stock-backgrounds";
import "./stock-workflow.css";

type Background = NonNullable<DocumentaryMontageSettings["background"]>;

export function StockBackgroundPicker({ api, value, onChange, onLibrary }: {
  api: DesktopApi;
  value: Background | undefined;
  onChange: (value: Background) => void;
  onLibrary?: () => void;
}) {
  const [library, setLibrary] = useState<EffectLibrarySnapshot>();
  const [progress, setProgress] = useState<EffectImportProgress>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(value?.mode === "library");
  const load = async () => {
    const snapshot = await api.getEffectLibrary();
    setLibrary(snapshot); setProgress(snapshot.importProgress);
  };
  useEffect(() => {
    let active = true;
    const refresh = () => api.getEffectLibrary().then(snapshot => { if (active) { setLibrary(snapshot); setProgress(snapshot.importProgress); } }).catch(reason => { if (active) setError(String(reason)); });
    void refresh();
    const unsubscribe = api.onEffectImportProgress(next => {
      if (!active) return;
      setProgress(next);
      if (["complete", "cancelled", "error"].includes(next.status)) void refresh();
    });
    return () => { active = false; unsubscribe(); };
  }, [api]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const assets = selectableStockBackgrounds(library?.assets ?? []);
  const selectedIds = selectedDocumentaryBackgroundIds(value);
  const selected = selectedIds.map(id => assets.find(asset => asset.id === id)).find(Boolean);
  const unavailable = selectedIds.filter(id => !assets.some(asset => asset.id === id));
  const mode = value?.mode ?? "automatic";
  const importing = progress?.status === "scanning" || progress?.status === "importing";
  return <div className="stock-background-picker">
    <div className="stock-workflow-actions" role="group" aria-label="Фон ролика">
      <button type="button" aria-pressed={mode === "automatic"} onClick={() => { onChange({ mode: "automatic" }); setExpanded(false); }}>Автоматически</button>
      <button type="button" aria-pressed={mode === "off"} onClick={() => { onChange({ mode: "off" }); setExpanded(false); }}>Без фонового материала</button>
      <button type="button" aria-pressed={mode === "library"} aria-expanded={expanded} onClick={() => setExpanded(current => !current)}>Из библиотеки{selectedIds.length > 1 ? ` · ${selectedIds.length} выбрано` : selected ? ` · ${selected.name}` : ""}</button>
    </div>
    <small>Выберите один или несколько фонов. Они чередуются за фотографиями и в композициях; короткие видео повторяются без звука.</small>
    {mode === "library" && !selectedIds.length && <p role="status">Выберите хотя бы один фон или включите «Без фонового материала».</p>}
    {unavailable.length > 0 && library && <>
      <p role="status">Недоступно в библиотеке: {unavailable.length}. Выбор сохранён; при сборке будут использованы готовые копии проекта.</p>
      <div className="stock-workflow-actions">{unavailable.map(id => <button type="button" key={id} onClick={() => onChange(toggleStockBackground(value,id))}>Убрать недоступный фон {selectedIds.indexOf(id)+1}</button>)}</div>
    </>}
    {expanded && <div className="stock-background-catalog">
      <div className="stock-workflow-actions">
        <button type="button" className="outline-button small" disabled={busy || importing} onClick={() => void run(async () => {
          const paths = await api.chooseBackgroundFiles();
          if (paths.length) { setProgress(await api.importBackgroundFiles(paths)); await load(); }
        })}>{busy ? "Добавляю…" : "Импортировать фото или видео"}</button>
        <button type="button" className="ghost-button" disabled={busy} onClick={() => void run(load)}>Обновить</button>
        {onLibrary && <button type="button" className="ghost-button" onClick={onLibrary}>Открыть библиотеку</button>}
      </div>
      {importing && <p role="status">Готовлю превью: {progress?.processed} / {progress?.total}</p>}
      {progress?.status === "error" && <p role="alert">Не удалось завершить импорт фонов. Подробности доступны в библиотеке.</p>}
      {!library && !error && <p role="status">Загружаю фоны…</p>}
      {library && !assets.length && <p>В категории «Фоны» пока нет готовых материалов. Импортируйте фото или видео, затем выберите его здесь.</p>}
      <div className="stock-background-grid" role="group" aria-label="Фоны из библиотеки">
        {assets.map(asset => <button key={asset.id} type="button" aria-pressed={selectedIds.includes(asset.id)} onClick={() => onChange(toggleStockBackground(value, asset.id))}>
          {asset.poster || asset.kind === "image" ? <img loading="lazy" src={libraryMediaUrl(library!.rootPath, asset.poster ?? asset.file)} alt="" />
            : <video muted playsInline preload="metadata" src={libraryMediaUrl(library!.rootPath, asset.proxy ?? asset.file)} />}
          <strong>{asset.name}</strong><small>{asset.kind === "video" ? "Видео" : "Изображение"}{selectedIds.includes(asset.id) ? ` · ✓ ${selectedIds.indexOf(asset.id) + 1}` : ""}</small>
        </button>)}
      </div>
    </div>}
    {selected && library && <figure className="stock-background-preview">
      {selected.kind === "video" ? <video key={selected.id} controls muted playsInline loop preload="metadata" src={libraryMediaUrl(library.rootPath, selected.proxy ?? selected.file)} poster={libraryMediaUrl(library.rootPath, selected.poster)} />
        : <img src={libraryMediaUrl(library.rootPath, selected.file)} alt={selected.name} />}
      <figcaption>{selected.name} · исходный фон</figcaption>
    </figure>}
    {error && <p role="alert" className="stock-workflow-error">{error}</p>}
  </div>;
}
