import { useEffect, useState } from "react";
import type { WorkspaceUsage } from "@gold-work/shared";
import { fallbackApi } from "./fallback-api";

export const storageSize = (bytes: number) => `${(bytes / 1024 ** 3).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ГБ`;
export const storageUsageNeedsRefresh = (usage: WorkspaceUsage) => Date.now() - new Date(usage.scannedAt).getTime() > 60_000;
export const storageUsagePath = (path: string) => path.replaceAll("\\", "/");

export function StorageUsage({ projects }: { projects: Array<{ id: string; title: string }> }) {
  const api = window.goldWork ?? fallbackApi;
  const [usage, setUsage] = useState<WorkspaceUsage>();
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true; setBusy(true); setError("");
    void (async () => {
      try {
        const value = await api.getWorkspaceUsage(path, revision > 0);
        if (!active) return;
        setUsage(value);
        setError("");
        if (revision === 0 && storageUsageNeedsRefresh(value)) {
          const refreshed = await api.getWorkspaceUsage(path, true);
          if (active) { setUsage(refreshed); setError(""); }
        }
      } catch (reason) {
        if (active) setError(String(reason));
      } finally {
        if (active) setBusy(false);
      }
    })();
    return () => { active = false; };
  }, [path, revision]);
  const visibleUsage = usage && storageUsagePath(usage.path) === path ? usage : undefined;
  return <section className="storage-usage">
    <h3>Занято материалами {visibleUsage ? `· ${storageSize(visibleUsage.bytes)}` : ""}{busy ? visibleUsage ? " · обновляю…" : " · первое сканирование…" : ""}</h3>
    <p className="storage-help">Считаются уникальные файлы: несколько ссылок на одно видео не занимают место повторно. Размеры проектов с общими файлами нельзя складывать. Это объём данных, без служебных расходов файловой системы.</p>
    {visibleUsage && <p className="storage-help">{visibleUsage.files.toLocaleString("ru-RU")} файлов и ссылок. Сумма размеров по именам, как в Проводнике: {storageSize(visibleUsage.logicalBytes)}.</p>}
    <div className="provider-actions">
      {path && <button className="outline-button small" disabled={busy} onClick={() => { setRevision(0); setPath(path.split("/").slice(0, -1).join("/")); }}>← Выше</button>}
      <button className="outline-button small" disabled={busy} onClick={() => setRevision(value => value + 1)}>Обновить размер</button>
      <button className="outline-button small" onClick={() => void api.openWorkspaceFolder(path).catch(reason => setError(String(reason)))}>Открыть папку</button>
    </div>
    <small>{path || "Всё хранилище"}</small>
    {error && <p role="alert">{error}</p>}
    <div className="storage-usage-list" aria-busy={busy}>
      {visibleUsage?.entries.map(entry => <button key={entry.path} disabled={!entry.directory} onClick={() => { setRevision(0); setPath(storageUsagePath(entry.path)); }} title={entry.path}>
        <span>{entry.directory ? "📁 " : ""}{projects.find(project => storageUsagePath(entry.path) === `projects/${project.id}`)?.title ?? entry.label ?? entry.name}</span>
        <b>{storageSize(entry.bytes)}</b>
        {entry.logicalBytes > entry.bytes * 1.05 && <small>по именам: {storageSize(entry.logicalBytes)}</small>}
      </button>)}
    </div>
  </section>;
}
