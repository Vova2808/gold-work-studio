import { useState } from "react";
import type { ConsoleLogEntry } from "@gold-work/shared";

export function incidentEntries(entry: ConsoleLogEntry, entries: ConsoleLogEntry[]): ConsoleLogEntry[] {
  const d = entry.details ?? {};
  const position = entries.findIndex(e => e.id === entry.id);
  const preceding = position < 0 ? entries : entries.slice(0, position + 1);
  const matches = preceding.filter(e => e.id === entry.id ||
    (d.operationId && e.details?.operationId === d.operationId) || (d.taskId && e.details?.taskId === d.taskId));
  return d.operationId || d.taskId ? matches.slice(-80) : [entry];
}

export function LogFailureDetails({ entry, entries, onTrace }: { entry: ConsoleLogEntry; entries: ConsoleLogEntry[]; onTrace: (query: string) => void }) {
  const [copyState, setCopyState] = useState("");
  if (entry.level !== "error" && entry.level !== "warn") return null;
  const d = entry.details ?? {};
  const diagnostic = d.diagnostic && typeof d.diagnostic === "object" ? d.diagnostic as Record<string, unknown> : {};
  const error = d.error && typeof d.error === "object" ? d.error as Record<string, unknown> : {};
  const summary = String(diagnostic.summary ?? error.message ?? d.error ?? "Подробности в данных события");
  const trace = String(d.operationId ?? d.taskId ?? "");
  const copy = async () => {
    try {
      const report = ["Gold Work Studio · отчёт о сбое", `Событие: ${entry.id}`, "Последние связанные события из загруженного журнала (до 80). Полная история — в файлах логов.",
        ...incidentEntries(entry, entries).map(e => `${e.timestamp} [${e.level}] ${e.message} ${JSON.stringify(e.details ?? {})}`)].join("\n");
      await navigator.clipboard.writeText(report); setCopyState("Отчёт скопирован");
    } catch { setCopyState("Не удалось скопировать. Откройте файл лога кнопкой папки."); }
  };
  return <div className="console-failure">
    <span>{summary}</span>
    {Boolean(diagnostic.nextAction) && <small>{String(diagnostic.nextAction)}</small>}
    <div>{trace && <button type="button" onClick={() => onTrace(trace)} title={trace}>События операции</button>}
      <button type="button" onClick={() => void copy()}>Скопировать сбой</button>
      <small role="status">{copyState}</small></div>
  </div>;
}
