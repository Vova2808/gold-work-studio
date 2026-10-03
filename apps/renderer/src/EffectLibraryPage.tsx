import { useEffect, useState } from "react";
import { EFFECT_CATEGORIES, type DesktopApi, type EffectAsset, type EffectCategory, type EffectImportProgress, type EffectLibrarySnapshot } from "@gold-work/shared";
import "./effect-library.css";

export const effectCategoryLabels: Record<EffectCategory, string> = {
  background: "Фоны", particles: "Частицы", smoke: "Дым", "light-leak": "Блики", transition: "Переходы", riser: "Risers",
  impact: "Impacts", subdrop: "Subdrops", glitch: "Glitch / VHS / Noise", keyboard: "Клавиатура", click: "Щелчки мыши",
  ding: "Ding", dramatic: "Драматические", review: "Проверить композицию"
};
export function effectMediaUrl(root: string, path?: string): string | undefined {
  return path ? `gw-media://local/${encodeURIComponent(`${root}/${path}`)}` : undefined;
}
export function EffectLibraryPage({ api }: { api: DesktopApi }) {
  const [library, setLibrary] = useState<EffectLibrarySnapshot>();
  const [progress, setProgress] = useState<EffectImportProgress>();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [category, setCategory] = useState("");
  const [selected, setSelected] = useState<EffectAsset>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const snapshot = await api.getEffectLibrary();
    setLibrary(snapshot); setProgress(snapshot.importProgress);
  };
  useEffect(() => {
    void load().catch(error => setError(String(error)));
    return api.onEffectImportProgress(next => {
      setProgress(next);
      if (next.status === "complete" || next.status === "cancelled" || next.status === "error" || next.processed % 10 === 0) {
        void api.getEffectLibrary().then(setLibrary).catch(error => setError(String(error)));
      }
    });
  }, [api]);
  const run = async (work: () => Promise<void>) => {
    setError(""); setNotice(""); setBusy(true);
    try { await work(); } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const importing = progress?.status === "scanning" || progress?.status === "importing";
  const assets = library?.assets ?? [];
  const shown = assets.filter(asset => {
    if (filter === "trash" ? !asset.deletedAt : Boolean(asset.deletedAt)) return false;
    if (category && asset.category !== category) return false;
    if (filter === "popular" && !asset.tags.includes("популярные")) return false;
    if (filter === "favorites" && !asset.favorite) return false;
    if (filter === "audio" && asset.kind !== "audio") return false;
    if (filter === "visual" && asset.kind === "audio") return false;
    if (filter === "review" && asset.review === "approved") return false;
    return `${asset.name} ${asset.tags.join(" ")} ${effectCategoryLabels[asset.category]}`.toLowerCase().includes(query.toLowerCase());
  });
  const patchSelected = (patch: Partial<EffectAsset>) => setSelected(current => current ? { ...current, ...patch } : current);
  const patchDefaults = (patch: Partial<EffectAsset["defaults"]>) => setSelected(current => current ? { ...current, defaults: { ...current.defaults, ...patch } } : current);
  return <section className="effect-library" data-testid="effect-library">
    <header className="effect-library-header"><div><h1>Библиотека эффектов</h1><p>{library?.rootPath}</p></div>
      <button onClick={() => void run(() => api.openEffectLibrary())}>Открыть папку</button>
      <button className="primary-button" disabled={busy || importing} onClick={() => void run(async () => {
        const roots = await api.chooseEffectFolders(); if (roots.length) setProgress(await api.importEffectFolders(roots));
      })}>Добавить папку</button>
    </header>
    <p>Оригиналы копируются в рабочее пространство. Для автоподбора отметьте проверенные эффекты и условия использования.</p>
    {error && <p role="alert" className="effect-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {progress && <div className="effect-import" aria-live="polite">
      <strong>{importing ? "Импорт" : progress.status === "complete" ? "Импорт завершён" : progress.status === "cancelled" ? "Импорт прерван" : "Ошибка импорта"}: {progress.processed} / {progress.total}</strong>
      <span>Добавлено: {progress.added} · Дубли: {progress.duplicates} · Служебные: {progress.ignored} · Ошибки: {progress.errors.length}</span>
      {progress.current && <small>{progress.current}</small>}
      {importing ? <button onClick={() => void run(() => api.cancelEffectImport())}>Остановить импорт</button>
        : <button disabled={busy} onClick={() => void run(async () => { setProgress(await api.importEffectFolders(progress.roots)); })}>Продолжить / проверить папки</button>}
      {progress.errors.length > 0 && <details><summary>Причины ошибок</summary>{progress.errors.map((item, index) => <p key={index}>{item.path}: {item.message}</p>)}</details>}
    </div>}
    <div className="effect-filters">
      <input aria-label="Поиск эффектов" placeholder="Название или тег" value={query} onChange={event => setQuery(event.target.value)} />
      <select aria-label="Подборка" value={filter} onChange={event => setFilter(event.target.value)}>
        <option value="all">Все эффекты</option><option value="popular">Популярные</option><option value="favorites">Избранное</option>
        <option value="visual">Визуальные</option><option value="audio">Звуки</option><option value="review">Нужна проверка</option><option value="trash">Удалённые</option>
      </select>
      <select aria-label="Категория эффектов" value={category} onChange={event => setCategory(event.target.value)}><option value="">Все категории</option>{EFFECT_CATEGORIES.map(item => <option key={item} value={item}>{effectCategoryLabels[item]}</option>)}</select>
      <span>{shown.length} из {assets.length}</span>
    </div>
    <div className="effect-library-body">
      <div className="effect-grid" role="list" aria-label="Эффекты">
        {shown.length === 0 && <p>Нет эффектов в этой подборке. Добавьте папку или измените фильтр.</p>}
        {shown.map(asset => <button role="listitem" key={asset.id} className={`effect-card${selected?.id === asset.id ? " selected" : ""}`} onClick={() => { setSelected(structuredClone(asset)); setNotice(""); }}>
          {asset.poster || asset.waveform ? <img loading="lazy" src={effectMediaUrl(library!.rootPath, asset.poster ?? asset.waveform)} alt="" /> : <div className="effect-placeholder">{asset.kind === "audio" ? "♫" : "▧"}</div>}
          <strong>{asset.name}</strong><small>{effectCategoryLabels[asset.category]} · {asset.metadata?.durationSeconds.toFixed(1) ?? "—"} с</small>
          <small>{asset.state === "ready" ? asset.review === "approved" ? "Проверен" : "Нужна проверка" : asset.state === "error" ? "Ошибка медиа" : "Готовится"}{asset.automatic ? " · Авто" : ""}{asset.favorite ? " ★" : ""}</small>
        </button>)}
      </div>
      {selected && library && <aside className="effect-inspector" aria-label="Свойства эффекта" key={selected.id}>
        <h2>{selected.name}</h2>
        {selected.kind === "audio" ? <audio controls src={effectMediaUrl(library.rootPath, selected.proxy ?? selected.file)} />
          : selected.kind === "video" ? <video controls muted={!selected.defaults.sourceAudio} playsInline src={effectMediaUrl(library.rootPath, selected.proxy ?? selected.file)} poster={effectMediaUrl(library.rootPath, selected.poster)} />
          : <img src={effectMediaUrl(library.rootPath, selected.file)} alt={selected.name} />}
        {selected.error && <p role="alert" className="effect-error">{selected.error}</p>}
        <label>Название<input value={selected.name} onChange={event => patchSelected({ name: event.target.value })} /></label>
        <label>Категория<select value={selected.category} onChange={event => patchSelected({ category: event.target.value as EffectCategory })}>{EFFECT_CATEGORIES.map(item => <option key={item} value={item}>{effectCategoryLabels[item]}</option>)}</select></label>
        <label>Теги через запятую<input value={selected.tags.join(", ")} onChange={event => patchSelected({ tags: event.target.value.split(",") })} /></label>
        <label><input type="checkbox" checked={selected.favorite} onChange={event => patchSelected({ favorite: event.target.checked })} /> Избранное</label>
        <label>Проверка<select value={selected.review} onChange={event => patchSelected({ review: event.target.value as EffectAsset["review"] })}><option value="pending">Нужна проверка</option><option value="approved">Просмотрен / прослушан</option><option value="rejected">Не подходит</option></select></label>
        <button disabled={busy} onClick={() => void run(async () => { const result = await api.analyzeEffect(selected.id); setNotice(`${result.suitable ? "Подходит для короткого акцента" : "Автоматически применять не рекомендуется"}: ${result.description}`); })}>Проверить содержимое с AI</button>
        <label><input type="checkbox" checked={selected.rights === "user-confirmed"} onChange={event => patchSelected({ rights: event.target.checked ? "user-confirmed" : "unknown" })} /> Условия использования проверены</label>
        <label>Источник и условия<input value={selected.rightsNote} onChange={event => patchSelected({ rightsNote: event.target.value })} /></label>
        <label><input type="checkbox" checked={selected.automatic} onChange={event => patchSelected({ automatic: event.target.checked })} /> Разрешить автоподбор</label>
        {selected.kind !== "audio" && <><label>Смешивание<select value={selected.defaults.blend} onChange={event => patchDefaults({ blend: event.target.value as EffectAsset["defaults"]["blend"] })}><option value="normal">Обычный</option><option value="screen">Screen — осветление</option><option value="add">Add — сложение</option><option value="multiply">Multiply — умножение</option></select></label>
          <label>Прозрачность {selected.defaults.opacity}%<input type="range" min="0" max="100" value={selected.defaults.opacity} onChange={event => patchDefaults({ opacity: Number(event.target.value) })} /></label>
          <small>{selected.metadata?.hasAlpha ? "Есть alpha-канал" : "Без alpha-канала; чёрный фон сам по себе не прозрачен"}</small>
          {selected.metadata?.hasAudio && <label><input type="checkbox" checked={selected.defaults.sourceAudio} onChange={event => patchDefaults({ sourceAudio: event.target.checked })} /> Использовать звук оригинального футажа</label>}
        </>}
        <label>Громкость {selected.defaults.volume}%<input type="range" min="0" max="100" value={selected.defaults.volume} onChange={event => patchDefaults({ volume: Number(event.target.value) })} /></label>
        <div className="effect-fields"><label>Начало, с<input type="number" min="0" step="0.05" value={selected.defaults.trimStartSeconds} onChange={event => patchDefaults({ trimStartSeconds: Number(event.target.value) })} /></label>
          <label>Конец, с<input type="number" min="0" step="0.05" value={selected.defaults.trimEndSeconds ?? ""} placeholder={String(selected.metadata?.durationSeconds ?? "")} onChange={event => patchDefaults({ trimEndSeconds: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>
          <label>Появление, с<input type="number" min="0" max="30" step="0.05" value={selected.defaults.fadeInSeconds} onChange={event => patchDefaults({ fadeInSeconds: Number(event.target.value) })} /></label>
          <label>Затухание, с<input type="number" min="0" max="30" step="0.05" value={selected.defaults.fadeOutSeconds} onChange={event => patchDefaults({ fadeOutSeconds: Number(event.target.value) })} /></label></div>
        <small>Рекомендации для новых вставок. Сохранённые ролики сохраняют собственные параметры.</small>
        <button className="primary-button" disabled={busy} onClick={() => void run(async () => { const saved = await api.updateEffect(selected.id, selected); setSelected(saved); await load(); setNotice("Свойства сохранены"); })}>Сохранить свойства</button>
        <button disabled={busy} onClick={() => void run(async () => { const saved = await api.trashEffect(selected.id, !selected.deletedAt); setSelected(saved); await load(); })}>{selected.deletedAt ? "Восстановить" : "Убрать из библиотеки"}</button>
        <details><summary>Оригиналы и метаданные</summary><p>{selected.bytes.toLocaleString()} байт · {selected.metadata?.width} × {selected.metadata?.height} · {selected.metadata?.videoCodec ?? selected.metadata?.audioCodec}</p>
          {selected.origins.map(origin => <p key={origin.originalPath}>{origin.pack}: {origin.originalPath}</p>)}<small>Файлы роликов сохраняются при удалении эффекта из подборки.</small></details>
      </aside>}
    </div>
  </section>;
}
