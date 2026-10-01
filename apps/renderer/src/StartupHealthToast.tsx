import { useEffect, useMemo, useRef, useState } from "react";
import type { DesktopApi } from "@gold-work/shared";
import { APP_BUILD_ID } from "./generated-build-identity";
import { initialHealth, startupHealthMonitor } from "./startup-health";
import "./startup-health-toast.css";

export function StartupHealthToast({ api, onOpenSettings, openRequest = 0 }: { api: DesktopApi; onOpenSettings: () => void; openRequest?: number }) {
  const monitor = useMemo(() => startupHealthMonitor(api, APP_BUILD_ID), [api]);
  const [items, setItems] = useState(initialHealth);
  const [open, setOpen] = useState(true);
  const [launch, setLaunch] = useState(true);
  const dialog = useRef<HTMLDialogElement>(null);
  const completed = items.filter(i => i.tone !== "checking").length;
  const checking = completed < items.length;
  const problems = items.filter(i => i.tone === "error" || i.tone === "warning").length;
  const ready = items.filter(i => i.tone === "ok").length;
  const close = () => { setOpen(false); setLaunch(false); };
  useEffect(() => { const unsubscribe = monitor.subscribe(setItems); void monitor.run(); return unsubscribe; }, [monitor]);
  useEffect(() => { if (openRequest) { setOpen(true); setLaunch(false); } }, [openRequest]);
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close(); }, [open]);

  return <dialog ref={dialog} className={`startup-health-toast${launch ? " startup-launch" : ""}`} aria-labelledby="startup-heading" onCancel={event => { event.preventDefault(); close(); }}>
    <div className="startup-brand" aria-hidden="true"><span>GW</span><i /><i /></div>
    <header>
      <div><small>GOLD WORK STUDIO · РАБОЧЕЕ ПРОСТРАНСТВО</small>
        <h2 id="startup-heading">{launch ? "Готовим студию к работе" : "Состояние подключений"}</h2>
        <p>{checking ? "Проверяем доступность сервисов. Можно уже работать." : problems ? `Проверка завершена · требуют внимания: ${problems}` : `Проверка завершена · доступны: ${ready}`}</p>
      </div>
      <button type="button" className="icon-button" aria-label="Скрыть проверку подключений" onClick={close}>×</button>
    </header>
    <div className="startup-progress" role="progressbar" aria-label="Проверка подключений" aria-valuenow={completed} aria-valuemin={0} aria-valuemax={items.length}>
      <span style={{ width: `${completed / items.length * 100}%` }} />
    </div>
    <div className="startup-progress-caption" aria-live="polite">{completed} из {items.length} проверок · {Math.round(completed / items.length * 100)}%</div>
    <div className="startup-health-list">
      {items.map(item => <div className={`startup-health-row ${item.tone}`} key={item.id} data-service={item.id}>
        <i aria-hidden="true">{item.tone === "ok" ? "✓" : item.tone === "error" ? "!" : item.tone === "off" ? "−" : ""}</i>
        <span>{item.label}</span><small>{item.message}</small>
      </div>)}
    </div>
    <p className="startup-note">Без платной генерации. Доступ к API не гарантирует доступность каждой модели или квоту на генерацию. Неподключённые сервисы не мешают остальным.</p>
    <footer>
      <button type="button" className="secondary-button" onClick={() => { close(); onOpenSettings(); }}>Настройки</button>
      <button type="button" className="secondary-button" disabled={checking} onClick={() => void monitor.run(true)}>Проверить снова</button>
      <button type="button" className="primary-button" autoFocus onClick={close}>{launch ? "Открыть приложение" : "Скрыть"}</button>
    </footer>
    <small className="startup-restore-hint">Вернуться к результатам: «Подключения» в боковой панели.</small>
  </dialog>;
}
