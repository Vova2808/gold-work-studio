/** Progress belongs to its own preparation, never to whichever project happens to be open. */
export function scenarioProgressTopic(builds: Record<string, { running: boolean; projectId?: string }>, context?: { projectId?: string; topicId?: string }): string | undefined {
  const entries = Object.entries(builds).filter(([, state]) => state.running);
  if (context?.topicId) return builds[context.topicId]?.running ? context.topicId : undefined;
  if (context?.projectId) return entries.find(([, state]) => state.projectId === context.projectId)?.[0];
  return !context && entries.length === 1 ? entries[0]![0] : undefined;
}

/** Upcoming batch bounds are not completed frames. Unknown phases stay indeterminate. */
export function scenarioFrameProgress(stage: string): { done: number; total: number } | undefined {
  const initial = /Разбиваю готовый текст.*?:\s*(\d+) кадров/i.exec(stage);
  if (initial) return { done: 0, total: Number(initial[1]) };
  const range = /кадров?\s+(\d+)[–—-](\d+)\s+из\s+(\d+)/i.exec(stage);
  if (range) return { done: Math.max(0, Number(range[1]) - 1), total: Number(range[3]) };
  const completed = /(?:Готовы промпты:|Размечаю готовый сценарий:|Готово|Сохранено)\s*(\d+)\s+из\s+(\d+)\s*(?:кадр|сцен)/i.exec(stage);
  if (completed) return { done: Number(completed[1]), total: Number(completed[2]) };
  return undefined;
}
