import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChartNoAxesCombined, CircleAlert, ExternalLink, LoaderCircle, Pencil, Plus, RefreshCw, Trash2, X, Youtube } from "lucide-react";
import { ANALYTICS_AUTO_REFRESH_MS, type DesktopApi, type SaveTrackedChannelInput, type TrackedYouTubeChannel } from "@gold-work/shared";
import "./analytics.css";

type Metric = "views" | "subscribers" | "videos";
const metricNames: Record<Metric, string> = { views: "Просмотры", subscribers: "Подписчики", videos: "Видео" };
const number = (value: number | null | undefined) => value == null ? "—" : value.toLocaleString("ru-RU");
const stamp = (value?: string) => value ? new Date(value).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Ещё не обновлялся";
const emptyForm: SaveTrackedChannelInput = { url: "", name: "", group: "" };

export function AnalyticsPage({ api, onSettings }: { api: DesktopApi; onSettings: () => void }) {
  const [channels, setChannels] = useState<TrackedYouTubeChannel[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const [form, setForm] = useState<SaveTrackedChannelInput | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [group, setGroup] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [metric, setMetric] = useState<Metric>("views");
  const [days, setDays] = useState(30);
  const [difference, setDifference] = useState(false);
  const groups = useMemo(() => [...new Set(channels.map(c => c.group).filter(Boolean))].sort(), [channels]);
  const visible = channels.filter(c => !group || c.group === group);
  const selected = visible.find(c => c.id === selectedId) ?? visible[0];

  const refresh = useCallback(async (automatic = false) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setError("");
    try {
      const result = await api.refreshTrackedChannels({ automatic });
      if (!mounted.current) return;
      setChannels(result);
      if (!automatic) setNotice("Проверка завершена. Повторные запросы выполняются не чаще раза в 15 минут. Ошибки показаны у соответствующих каналов.");
    } catch (e) { if (mounted.current) setError(String(e)); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }, [api]);

  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    if (typeof api.listTrackedChannels !== "function") {
      setError("Перезапустите Gold Work Studio: для аналитики нужен обновлённый Electron, а не только новая страница интерфейса.");
      setLoaded(true);
      return () => { mounted.current = false; };
    }
    void Promise.all([api.listTrackedChannels(), api.getYouTubeSettings()]).then(([rows, settings]) => {
      if (disposed) return;
      setChannels(rows); setConfigured(settings.configured); setLoaded(true);
    }).catch(e => { if (!disposed) { setError(String(e)); setLoaded(true); } });
    return () => { disposed = true; mounted.current = false; };
  }, [api]);

  useEffect(() => {
    if (!loaded || !configured) return;
    const check = () => {
      if (channels.some(c => !c.lastAttemptAt || Date.now() - Date.parse(c.lastAttemptAt) >= ANALYTICS_AUTO_REFRESH_MS)) void refresh(true);
    };
    check();
    const timer = window.setInterval(check, 60_000);
    return () => window.clearInterval(timer);
  }, [channels, configured, loaded, refresh]);

  const save = async () => {
    if (!form || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      const rows = await api.saveTrackedChannel(form);
      if (!mounted.current) return;
      setChannels(rows); setGroup(""); setForm(null);
      setSelectedId(form.id ?? rows.at(-1)?.id ?? "");
      setNotice("Канал сохранён. История наблюдений хранится локально за последние 30 дней.");
    } catch (e) { if (mounted.current) setError(String(e)); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };

  const remove = async () => {
    if (!removeId || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      const rows = await api.removeTrackedChannel(removeId);
      if (!mounted.current) return;
      setChannels(rows); setRemoveId(null); setGroup("");
      setNotice("Канал и его история убраны только из аналитики. YouTube-канал и проекты не изменены.");
    } catch (e) { if (mounted.current) setError(String(e)); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };

  return <main className="analytics-page">
    <header className="analytics-heading">
      <div><span className="analytics-eyebrow">ВАША СЕТКА · YOUTUBE</span><h1><ChartNoAxesCombined size={26} /> Аналитика каналов</h1><p>Публичные показатели ваших каналов в одном месте.</p></div>
      <div className="analytics-actions">
        <button className="secondary-button" disabled={busy || !configured || !channels.length} onClick={() => void refresh()}>{busy ? <LoaderCircle className="analytics-spin" size={16} /> : <RefreshCw size={16} />}{busy ? "Обновляю…" : "Обновить"}</button>
        <button className="primary-button" disabled={!loaded} onClick={() => { setForm({ ...emptyForm }); setError(""); }}><Plus size={17} /> Добавить канал</button>
      </div>
    </header>
    {!configured && loaded && <div className="analytics-notice"><CircleAlert size={18} /><span>Для статистики нужен ключ YouTube Data API v3. Каналы можно сохранить уже сейчас. Вход в Google и AnyModel не нужны.</span><button className="secondary-button" onClick={onSettings}>Настройки → YouTube</button></div>}
    {error && <div className="analytics-error" role="alert">{error}</div>}
    {notice && <div className="analytics-feedback" role="status">{notice}<button className="icon-button" aria-label="Закрыть сообщение" onClick={() => setNotice("")}><X size={14} /></button></div>}
    {form && <form className="analytics-form" aria-label={form.id ? "Изменить канал" : "Добавить канал"} onSubmit={e => { e.preventDefault(); void save(); }}>
      <div className="analytics-form-title"><h2>{form.id ? "Название и группа" : "Новый канал в аналитике"}</h2><button type="button" className="icon-button" aria-label="Закрыть форму" onClick={() => setForm(null)}><X size={18} /></button></div>
      <div className="analytics-form-fields">
        <label>Ссылка YouTube<input name="channelUrl" required maxLength={500} value={form.url} readOnly={!!form.id} placeholder="https://www.youtube.com/@channel" onChange={e => setForm({ ...form, url: e.target.value })} /></label>
        <label>Ваше название<input name="channelName" required maxLength={120} value={form.name} placeholder="Например, Истории · EN" onChange={e => setForm({ ...form, name: e.target.value })} /></label>
        <label>Сетка / группа · необязательно<input name="channelGroup" maxLength={80} list="analytics-groups" value={form.group} placeholder="Например, Англоязычные" onChange={e => setForm({ ...form, group: e.target.value })} /><datalist id="analytics-groups">{groups.map(g => <option key={g} value={g} />)}</datalist></label>
      </div>
      <div className="analytics-actions"><small>Это отдельный список наблюдения, он не меняет каналы производства роликов.</small><button type="button" className="secondary-button" onClick={() => setForm(null)}>Отмена</button><button type="submit" className="primary-button" disabled={busy}>{busy ? "Сохраняю…" : "Сохранить канал"}</button></div>
    </form>}
    {!loaded ? <div className="analytics-empty" role="status">Загружаю сохранённые каналы…</div> : !channels.length ? <div className="analytics-empty"><Youtube size={42} /><h2>Все ваши каналы — на одном экране</h2><p>Добавьте ссылку, дайте название и при желании объедините каналы в группы.<br />Графики появятся по мере накопления реальных замеров.</p><button className="primary-button" onClick={() => setForm({ ...emptyForm })}><Plus size={16} /> Добавить первый канал</button></div> : <>
      <div className="analytics-toolbar"><label>Показать сетку<select aria-label="Сетка каналов" value={group} onChange={e => setGroup(e.target.value)}><option value="">Все каналы ({channels.length})</option>{groups.map(g => <option key={g} value={g}>{g}</option>)}</select></label><p>Автообновление раз в 6 часов, пока открыта эта вкладка.<br />История: последние 30 дней. При закрытом приложении замеры не выполняются.</p></div>
      <section className="analytics-totals" aria-label="Сводка сетки">
        {(["views", "subscribers", "videos"] as Metric[]).map(key => {
          const values = visible.map(c => c.snapshots.at(-1)?.[key]).filter((v): v is number => v != null);
          return <div key={key}><span>{metricNames[key]} · всего</span><strong>{number(values.length ? values.reduce((a, b) => a + b, 0) : null)}</strong><small>Есть данные: {values.length} из {visible.length} каналов</small></div>;
        })}
      </section>
      <div className="analytics-workspace">
        <section className="analytics-channel-list" aria-label="Отслеживаемые каналы">
          <h2>Каналы <small>{visible.length}</small></h2>
          {visible.map(c => <article key={c.id} className={`analytics-channel${c.id === selected?.id ? " selected" : ""}`}>
            <button className="analytics-channel-select" onClick={() => setSelectedId(c.id)} aria-pressed={c.id === selected?.id}><strong>{c.name}</strong><small>{c.group || c.youtubeTitle || c.url}</small><span>{number(c.snapshots.at(-1)?.views)} просмотров</span></button>
            <div className="analytics-channel-meta"><small>{stamp(c.snapshots.at(-1)?.capturedAt)}</small><button className="icon-button" aria-label={`Изменить ${c.name}`} onClick={() => setForm({ id: c.id, name: c.name, url: c.url, group: c.group })}><Pencil size={14} /></button><button className="icon-button" aria-label={`Убрать ${c.name}`} onClick={() => setRemoveId(c.id)}><Trash2 size={14} /></button></div>
            {c.lastError && <p className="analytics-channel-error"><CircleAlert size={13} />{c.lastError} Предыдущие замеры сохранены.</p>}
          </article>)}
        </section>
        {selected && <section className="analytics-chart-panel">
          <header><div><span className="analytics-eyebrow">ДИНАМИКА КАНАЛА</span><h2>{selected.name}</h2></div><a href={selected.url} onClick={e => { e.preventDefault(); void api.openExternal(selected.url).catch(e => setError(String(e))); }} title="Открыть канал на YouTube"><Youtube size={18} /><ExternalLink size={13} /></a></header>
          <div className="analytics-chart-controls"><label>Показатель<select aria-label="Показатель графика" value={metric} onChange={e => setMetric(e.target.value as Metric)}>{Object.entries(metricNames).map(([k, v]) => <option value={k} key={k}>{v}</option>)}</select></label><label>Период<select aria-label="Период графика" value={days} onChange={e => setDays(Number(e.target.value))}><option value={7}>7 дней</option><option value={30}>30 дней</option></select></label><label>Отображение<select aria-label="Режим графика" value={difference ? "delta" : "total"} onChange={e => setDifference(e.target.value === "delta")}><option value="total">Всего на момент замера</option><option value="delta">Изменение между замерами</option></select></label></div>
          <AnalyticsChart channel={selected} metric={metric} days={days} difference={difference} />
          <p className="analytics-caption">Это наблюдения публичных счётчиков, а не отчёт YouTube Studio. Прирост — разница между замерами, не точные просмотры за сутки. Пропуски не заменяются нулями. Подписчики могут быть округлены или скрыты; удаление видео и пересчёт YouTube могут уменьшать счётчики.</p>
        </section>}
      </div>
    </>}
    {removeId && <div className="analytics-modal-backdrop"><section className="analytics-confirm" role="dialog" aria-modal="true" aria-labelledby="analytics-delete-title"><h2 id="analytics-delete-title">Убрать канал из аналитики?</h2><p>«{channels.find(c => c.id === removeId)?.name}» и сохранённая история замеров будут удалены из этого списка. Сам YouTube-канал и проекты приложения останутся.</p><div className="analytics-actions"><button className="secondary-button" onClick={() => setRemoveId(null)}>Отмена</button><button className="primary-button" disabled={busy} onClick={() => void remove()}>Убрать из аналитики</button></div></section></div>}
  </main>;
}

function AnalyticsChart({ channel, metric, days, difference }: { channel: TrackedYouTubeChannel; metric: Metric; days: number; difference: boolean }) {
  const rows = channel.snapshots.filter(s => Date.parse(s.capturedAt) >= Date.now() - days * 86_400_000);
  const points = rows.flatMap((s, i) => {
    const current = s[metric], previous = rows[i - 1]?.[metric];
    const value = difference ? current == null || previous == null ? null : current - previous : current;
    return value === null ? [] : [{ time: Date.parse(s.capturedAt), date: s.capturedAt, value }];
  });
  const [hovered, setHovered] = useState<number | null>(null);
  useEffect(() => setHovered(null), [channel.id, metric, days, difference]);
  if (!points.length) return <div className="analytics-empty analytics-chart-empty"><ChartNoAxesCombined size={34} /><h3>{difference && rows.length < 2 ? "Для прироста нужны два замера" : "Пока нет данных для графика"}</h3><p>История начинается с первого успешного обновления.<br />Статистика до добавления канала не восстанавливается.</p></div>;
  const min = Math.min(...points.map(p => p.value)), max = Math.max(...points.map(p => p.value));
  const pad = Math.max(1, (max - min) * 0.1);
  const low = difference ? Math.min(0, min - pad) : Math.max(0, min - pad);
  const high = difference ? Math.max(0, max + pad) : max + pad;
  const width = 780, height = 270, left = 85, right = width - 18, top = 20, bottom = height - 38;
  const first = points[0]!, last = points.at(-1)!;
  const x = (t: number) => points.length === 1 ? (left + right) / 2 : left + (t - first.time) / Math.max(1, last.time - first.time) * (right - left);
  const y = (v: number) => bottom - (v - low) / Math.max(1, high - low) * (bottom - top);
  const active = points[hovered ?? points.length - 1] ?? last;
  return <div className="analytics-chart">
    <div className="analytics-chart-value" aria-live="polite"><strong>{number(active.value)}</strong><span>{metricNames[metric].toLowerCase()}{difference ? " · изменение" : " · всего"}<small>{stamp(active.date)}</small></span></div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${metricNames[metric]}: ${points.length} замеров. Последний ${number(last.value)}. Перечень доступен под графиком.`}>
      {[0, 1, 2, 3].map(i => { const value = low + (high - low) * i / 3; return <g key={i}><line x1={left} x2={right} y1={y(value)} y2={y(value)} className="analytics-grid-line" /><text x={left - 12} y={y(value) + 4} textAnchor="end">{Math.round(value).toLocaleString("ru-RU", { notation: "compact" })}</text></g>; })}
      {!difference && points.length > 1 && <polyline className="analytics-chart-line" points={points.map(p => `${x(p.time)},${y(p.value)}`).join(" ")} />}
      {points.map((p, i) => <g key={p.date} onMouseEnter={() => setHovered(i)} onFocus={() => setHovered(i)} tabIndex={0} aria-label={`${stamp(p.date)}: ${number(p.value)}`}>
        {difference && <line className="analytics-delta-line" x1={x(p.time)} x2={x(p.time)} y1={y(0)} y2={y(p.value)} />}
        <circle cx={x(p.time)} cy={y(p.value)} r={hovered === i ? 5 : 3} className="analytics-chart-dot" /><circle cx={x(p.time)} cy={y(p.value)} r={10} fill="transparent" /><title>{stamp(p.date)}: {number(p.value)}</title>
      </g>)}
      <text x={left} y={height - 10}>{stamp(first.date)}</text><text x={right} y={height - 10} textAnchor="end">{points.length > 1 ? stamp(last.date) : "Первый замер"}</text>
    </svg>
    {points.length === 1 && <p className="analytics-caption">Пока один замер. Линия появится после следующих обновлений.</p>}
    <details className="analytics-observations"><summary>Посмотреть числа · последние {Math.min(60, points.length)} замеров</summary><table><thead><tr><th>Время</th><th>{difference ? "Изменение" : metricNames[metric]}</th></tr></thead><tbody>{points.slice(-60).reverse().map(p => <tr key={p.date}><td>{stamp(p.date)}</td><td>{number(p.value)}</td></tr>)}</tbody></table></details>
  </div>;
}
