import { useEffect, useState } from "react";
import type { AppUpdateState, DesktopApi } from "@gold-work/shared";
import "./app-updates.css";

export function AppUpdatePanel({ api, compact = false }: { api: DesktopApi; compact?: boolean }) {
  const [state, setState] = useState<AppUpdateState>();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let alive = true;
    const unsubscribe = api.onAppUpdateState(value => { if (alive) setState(value); });
    void api.getAppUpdateState().then(value => { if (alive) setState(value); }).catch(() => {});
    return () => { alive = false; unsubscribe(); };
  }, [api]);
  if (!state || compact && !["downloading", "downloaded", "installing"].includes(state.status)) return null;
  const busy = pending || ["checking", "downloading", "installing"].includes(state.status);
  const act = async () => {
    setPending(true); setError("");
    try { setState(await (state.status === "downloaded" ? api.installAppUpdate() : api.checkAppUpdates())); }
    catch (reason) { setError(reason instanceof Error ? reason.message.replace(/^Error invoking remote method[^:]+:\s*/, "") : "Не удалось выполнить обновление."); }
    finally { setPending(false); }
  };
  return <section className={`app-update-panel${compact ? " compact" : ""}`} aria-label="Обновления приложения" aria-live="polite">
    <div><strong>{state.availableVersion ? `Обновление ${state.availableVersion}` : `Gold Work Studio ${state.currentVersion}`}</strong>
      <p>{error || state.message}</p>
      {state.status === "downloading" && <progress max={100} value={state.percent ?? 0} aria-label="Загрузка обновления" />}
    </div>
    {state.status !== "unsupported" && <button className="outline-button small" onClick={() => void act()} disabled={busy}>
      {state.status === "downloaded" ? "Перезапустить и установить" : state.status === "checking" ? "Проверяю…" : state.status === "downloading" ? `${state.percent ?? 0}%` : state.status === "installing" ? "Устанавливаю…" : "Проверить обновления"}
    </button>}
  </section>;
}
