import type { Project } from "@gold-work/shared";

const editable = ["title", "topic", "language", "aspectRatio", "mode", "mediaMode", "settings", "chatTopicId"] as const;
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function mergeValue(local: unknown, previous: unknown, incoming: unknown): unknown {
  if (JSON.stringify(local) === JSON.stringify(previous)) return structuredClone(incoming);
  // Arrays are an explicit user choice, not a list to concatenate with remote data.
  if (!isRecord(local) || !isRecord(previous) || !isRecord(incoming)) return structuredClone(local);
  const merged: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(local), ...Object.keys(previous), ...Object.keys(incoming)])) {
    const value = mergeValue(local[key], previous[key], incoming[key]);
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

/** Keep real local edits, not a stale settings snapshot from before a backend update. */
export function mergeProjectEditorDraft(local: Project | null, previous: Project | undefined, incoming: Project): Project {
  if (!local || !previous || local.id !== incoming.id || previous.id !== incoming.id) return structuredClone(incoming);
  const merged = structuredClone(incoming);
  for (const key of editable) {
    Object.assign(merged, { [key]: mergeValue(local[key], previous[key], incoming[key]) });
  }
  return merged;
}
