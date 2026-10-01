import { countNarrationCharacters, type Scene } from "@gold-work/shared";

export interface NarrationTiming {
  durationSeconds: number;
  speechStartSeconds: number;
  speechEndSeconds: number;
  silences?: Array<{startSeconds: number; endSeconds: number}>;
}

/** Не ищет слова в аудио. Текст сопоставляется по длине, граница кадра по
 * возможности сдвигается в ближайшую паузу. Соседние аудиодиапазоны всегда
 * непрерывны: ни один отсчёт исходной реплики не пропускается/не повторяется. */
export function planNarrationSlices(narration: string, timing: NarrationTiming, visualBudgetSeconds = 9): Array<{
  narration: string;
  startSeconds: number;
  endSeconds: number;
  last: boolean;
}> {
  const {speechStartSeconds: start, speechEndSeconds: end} = timing;
  if (![start, end, timing.durationSeconds].every(Number.isFinite)
    || start < 0 || end <= start || end > timing.durationSeconds + 0.05) {
    throw new Error("Некорректные границы готовой озвучки");
  }
  const duration = end - start;
  const budget = Math.min(9, Math.max(1, Number.isFinite(visualBudgetSeconds) ? visualBudgetSeconds : 9));
  if (duration + 0.2 <= budget) return [{narration, startSeconds: start, endSeconds: end, last: true}];
  if (!narration.trim()) throw new Error("У длинной озвучки отсутствует текст сценария");
  // Запас до 9 с оставлен для конечной паузы и обычного визуального перехода.
  const maximum = Math.min(7.8, budget - 0.2);
  const count = Math.max(2, Math.ceil(duration / maximum), Math.round(duration / 5));
  if (count > 1600) throw new Error("Одна реплика требует больше 1600 кадров; проверьте исходный аудиофайл");
  const textParts = splitTextExactly(narration, count);
  const weights = textParts.map(part => Math.max(1, countNarrationCharacters(part)));
  const weight = weights.reduce((sum, value) => sum + value, 0);
  let usedWeight = 0;
  let previous = start;
  return textParts.map((text, index) => {
    const remaining = count - index - 1;
    usedWeight += weights[index]!;
    const lower = Math.max(previous + 0.5, end - remaining * maximum);
    const upper = Math.min(previous + maximum, end - remaining * 0.5);
    const desired = start + duration * usedWeight / weight;
    let boundary = remaining === 0 ? end : Math.min(upper, Math.max(lower, desired));
    if (remaining > 0) {
      const candidates = (timing.silences ?? [])
        .filter(silence => Number.isFinite(silence.startSeconds) && Number.isFinite(silence.endSeconds)
          && silence.endSeconds > silence.startSeconds)
        .map(silence => (silence.startSeconds + silence.endSeconds) / 2)
        .filter(point => point >= lower && point <= upper && Math.abs(point - boundary) <= 0.6)
        .sort((a, b) => Math.abs(a - boundary) - Math.abs(b - boundary));
      boundary = candidates[0] ?? boundary;
    }
    const part = {narration: text, startSeconds: previous, endSeconds: boundary, last: remaining === 0};
    previous = boundary;
    return part;
  });
}

function splitTextExactly(text: string, count: number): string[] {
  const graphemes = [...new Intl.Segmenter(undefined, {granularity: "grapheme"}).segment(text)];
  if (graphemes.length < count) throw new Error("Текст слишком короткий для длительности озвучки; проверьте соответствие файла сцене");
  const boundaries = [0];
  for (let index = 1; index < count; index++) {
    const minimum = boundaries[index - 1]! + 1;
    const maximum = graphemes.length - (count - index);
    const desired = Math.min(maximum, Math.max(minimum, Math.round(graphemes.length * index / count)));
    let cut = desired;
    let distance = Number.POSITIVE_INFINITY;
    for (let candidate = Math.max(minimum, desired - 24); candidate <= Math.min(maximum, desired + 24); candidate++) {
      if (/\s/u.test(graphemes[candidate - 1]!.segment) && Math.abs(candidate - desired) < distance) {
        cut = candidate;
        distance = Math.abs(candidate - desired);
      }
    }
    boundaries.push(cut);
  }
  boundaries.push(graphemes.length);
  return boundaries.slice(0, -1).map((start, index) =>
    text.slice(graphemes[start]!.index, graphemes[boundaries[index + 1]!]?.index ?? text.length));
}

export function applyNarrationSlice<T extends NarrationTiming>(scene: Scene, info: T): T {
  const slice = scene.narrationSlice;
  if (!slice) return info;
  if (![slice.startSeconds, slice.endSeconds].every(Number.isFinite)
    || slice.startSeconds < 0 || slice.endSeconds <= slice.startSeconds
    || slice.endSeconds > info.durationSeconds + 0.05) {
    throw new Error(`[no-retry] Повреждены границы озвучки сцены ${scene.order + 1}; исходный файл не изменён`);
  }
  return {...info, speechStartSeconds: slice.startSeconds, speechEndSeconds: slice.endSeconds};
}

export function narrationSliceTail(scene: Scene, normalTail: number): number {
  return scene.narrationSlice && !scene.narrationSlice.last ? 0 : normalTail;
}
