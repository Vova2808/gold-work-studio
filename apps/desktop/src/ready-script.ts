import {
  AI_STORY_HARD_MAX_SCENE_SECONDS,
  AI_STORY_ORDINARY_MAX_SCENE_SECONDS,
  AI_STORY_TARGET_SCENE_SECONDS,
  countNarrationCharacters,
  estimateNarrationDurationSeconds,
  type VoiceCalibration,
  type Project
} from "@gold-work/shared";

export interface ReadyScriptNarrationChunk {
  narration: string;
  durationSeconds: number;
}

/** Selected project snapshot only: changing the channel must not change an older video's identity. */
export function readyScriptChannelHeroContext(project: Pick<Project, "characterReference">): string {
  const hero = project.characterReference;
  if (!hero) return "";
  return [
    "ВЫБРАННЫЙ ГЛАВНЫЙ ГЕРОЙ КАНАЛА (только визуал, текст озвучки не менять):",
    JSON.stringify({ name: hero.name, aliases: hero.aliases ?? [], appearance: hero.characterPrompt || hero.prompt }),
    "В сценах с главным героем используй это точное имя и каноническую внешность. Не создавай ему другую личность или случайную одежду. Не добавляй героя в кадры, где по сюжету показаны только предметы, пейзажи или другие люди.",
  ].join("\n");
}

/** A ready script already has a story. Its visual context must not require another paid JSON plan. */
export function readyScriptVisualPlan(title: string, chunks: ReadyScriptNarrationChunk[]) {
  const excerpt = (text: string) => text.replace(/\s+/gu, " ").trim().slice(0, 260);
  const count = Math.min(chunks.length, Math.max(1, Math.ceil(chunks.length / 24)));
  const sections = Array.from({ length: count }, (_, index) => {
    const start = Math.floor(index * chunks.length / count);
    const end = Math.floor((index + 1) * chunks.length / count);
    const text = chunks.slice(start, end).map(chunk => chunk.narration).join("");
    return { title: `Кадры ${start + 1}–${end}`, goal: excerpt(text),
      keyPoints: [excerpt(text), excerpt(text.slice(Math.floor(text.length / 2))), excerpt(text.slice(-260))],
      transition: excerpt(chunks[end]?.narration ?? "Конец исходного текста") };
  });
  return { title, promise: excerpt(chunks[0]?.narration ?? ""), tone: "Сохранить тон исходного текста",
    visualBible: "Техника рисовки задаётся отдельно. Визуализировать конкретный смысл реплики; не добавлять ведущего в каждый кадр.",
    continuityRules: ["Исходный текст и порядок событий неизменны", "Внешность повторяющихся персонажей сохраняется"],
    requiredBeats: [], endingResolution: excerpt(chunks.at(-1)?.narration ?? ""), sections };
}

/**
 * Готовый пользовательский текст — источник истины. Функция сохранена для
 * совместимости со старыми вызовами, но намеренно не нормализует даже пробелы,
 * переносы строк, NBSP или Unicode-форму символов.
 */
export function normalizeReadyScriptText(value: string): string {
  return value;
}

/**
 * Бесплатно и детерминированно делит готовую озвучку по предложениям и паузам.
 * Размер кадра зависит от фактически измеренной скорости выбранного голоса.
 */
export function splitReadyScriptNarration(
  value: string,
  calibration: Pick<VoiceCalibration, "charactersPerSecond">,
  preferredSceneSeconds = AI_STORY_TARGET_SCENE_SECONDS,
  maximumScenes = 1_600
): ReadyScriptNarrationChunk[] {
  const script = normalizeReadyScriptText(value);
  if (!script.trim()) throw new Error("Вставьте готовый сценарий");
  if (!Number.isFinite(calibration.charactersPerSecond) || calibration.charactersPerSecond <= 0) {
    throw new Error("Сначала измерьте скорость выбранного голоса");
  }

  const sceneLimit = Math.max(1, Math.floor(Number.isFinite(maximumScenes) ? maximumScenes : 200));
  const estimatedSeconds = estimateNarrationDurationSeconds(script, calibration);
  const requiredAverageSeconds = estimatedSeconds / sceneLimit;
  if (requiredAverageSeconds > AI_STORY_HARD_MAX_SCENE_SECONDS) {
    throw new Error(
      `Готовый сценарий требует больше ${sceneLimit} кадров: при этом ограничении кадр длился бы ${roundTenths(requiredAverageSeconds)} с вместо допустимых ${AI_STORY_HARD_MAX_SCENE_SECONDS} с`
    );
  }
  const requestedSeconds = Number.isFinite(preferredSceneSeconds)
    ? Math.max(1, preferredSceneSeconds)
    : AI_STORY_TARGET_SCENE_SECONDS;
  const sceneSeconds = Math.min(
    AI_STORY_HARD_MAX_SCENE_SECONDS,
    Math.max(requestedSeconds, requiredAverageSeconds)
  );
  const targetCharacters = Math.max(12, Math.round(calibration.charactersPerSecond * sceneSeconds));
  const ordinaryMaximumCharacters = Math.max(
    targetCharacters,
    Math.floor(calibration.charactersPerSecond * AI_STORY_ORDINARY_MAX_SCENE_SECONDS)
  );
  const hardMaximumCharacters = Math.max(
    ordinaryMaximumCharacters,
    Math.floor(calibration.charactersPerSecond * AI_STORY_HARD_MAX_SCENE_SECONDS)
  );
  const minimumCharacters = Math.max(18, Math.round(targetCharacters * 0.45));
  const sentences = splitSentencesPreservingText(script)
    .flatMap((sentence) => splitOversizedSentence(
      sentence,
      targetCharacters,
      ordinaryMaximumCharacters,
      hardMaximumCharacters
    ))
    .filter(Boolean);
  const groups: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (!current) {
      current = sentence;
      continue;
    }
    const combined = `${current}${sentence}`;
    const combinedLength = countNarrationCharacters(combined);
    const currentLength = countNarrationCharacters(current);
    if (combinedLength <= targetCharacters
      || (currentLength < minimumCharacters && combinedLength <= ordinaryMaximumCharacters)) {
      current = combined;
    } else {
      groups.push(current);
      current = sentence;
    }
  }
  if (current) groups.push(current);

  // При явном низком лимите объединяем только соседние фрагменты, которые всё
  // ещё помещаются в абсолютные девять секунд. Narration не переставляется.
  while (groups.length > sceneLimit) {
    let mergeAt = -1;
    let shortestPair = Number.POSITIVE_INFINITY;
    for (let index = 0; index < groups.length - 1; index += 1) {
      const pairLength = countNarrationCharacters(`${groups[index]}${groups[index + 1]}`);
      if (pairLength <= hardMaximumCharacters && pairLength < shortestPair) {
        shortestPair = pairLength;
        mergeAt = index;
      }
    }
    if (mergeAt < 0) {
      throw new Error(
        `Готовый сценарий нельзя безопасно уложить в ${sceneLimit} кадров без превышения ${AI_STORY_HARD_MAX_SCENE_SECONDS} секунд на кадр`
      );
    }
    groups.splice(mergeAt, 2, `${groups[mergeAt]}${groups[mergeAt + 1]}`);
  }

  if (groups.length > 1 && countNarrationCharacters(groups.at(-1)!) < minimumCharacters) {
    const tail = groups.pop()!;
    const combined = `${groups.at(-1)!}${tail}`;
    if (countNarrationCharacters(combined) <= hardMaximumCharacters) {
      groups[groups.length - 1] = combined;
    } else {
      groups.push(tail);
    }
  }

  const chunks = groups.map((narration) => ({
    narration,
    durationSeconds: Math.max(0.001, roundMillis(countNarrationCharacters(narration) / calibration.charactersPerSecond))
  }));
  // Оценщик TTS сворачивает пробелы внутри полной строки, но отбрасывает их на
  // границах отдельных фрагментов. Распределяем разницу равномерно, в целых
  // миллисекундах: короткая фраза не должна поглощать паузы всего ролика.
  let correction = Math.round((estimatedSeconds - chunks.reduce((sum, chunk) => sum + chunk.durationSeconds, 0)) * 1000);
  while (correction !== 0) {
    const direction = Math.sign(correction);
    const available = chunks.filter(chunk => direction > 0
      ? chunk.durationSeconds < AI_STORY_HARD_MAX_SCENE_SECONDS : chunk.durationSeconds > 0.001);
    if (!available.length) throw new Error("Недостаточно места для безопасного распределения тайминга готового текста");
    const share = Math.ceil(Math.abs(correction) / available.length);
    for (const chunk of available) {
      const capacity = Math.round((direction > 0 ? AI_STORY_HARD_MAX_SCENE_SECONDS - chunk.durationSeconds : chunk.durationSeconds - 0.001) * 1000);
      const change = direction * Math.min(Math.abs(correction), share, capacity);
      chunk.durationSeconds = roundMillis(chunk.durationSeconds + change / 1000);
      correction -= change;
      if (correction === 0) break;
    }
  }
  const overlong = chunks.find((chunk) => chunk.durationSeconds > AI_STORY_HARD_MAX_SCENE_SECONDS);
  if (overlong) {
    throw new Error(
      `Не удалось безопасно разделить готовый сценарий: один кадр занял ${overlong.durationSeconds} с при максимуме ${AI_STORY_HARD_MAX_SCENE_SECONDS} с`
    );
  }
  return chunks;
}

/** Возвращает непересекающиеся срезы, конкатенация которых равна source byte-for-byte. */
function splitSentencesPreservingText(source: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  const boundary = /[.!?…]+(?:["'»”\)\]]*)?\s+|(?:\r\n|\r|\n){2,}/gu;
  for (const match of source.matchAll(boundary)) {
    const end = (match.index ?? 0) + match[0].length;
    if (end > start) chunks.push(source.slice(start, end));
    start = end;
  }
  if (start < source.length) chunks.push(source.slice(start));
  return chunks;
}

function splitOversizedSentence(
  value: string,
  targetCharacters: number,
  ordinaryMaximumCharacters: number,
  hardMaximumCharacters: number
): string[] {
  const sentence = value;
  if (countNarrationCharacters(sentence) <= ordinaryMaximumCharacters) return sentence ? [sentence] : [];
  const chunks: string[] = [];
  let rest = sentence;
  while (countNarrationCharacters(rest) > ordinaryMaximumCharacters) {
    // A single unusually long token may use the one-second emergency margin;
    // normal phrases are split at punctuation/whitespace before eight seconds.
    if (countNarrationCharacters(rest) <= hardMaximumCharacters && !/\s/u.test(rest)) {
      chunks.push(rest);
      rest = "";
      break;
    }
    const cut = semanticCutIndex(rest, targetCharacters, ordinaryMaximumCharacters);
    const piece = rest.slice(0, cut);
    if (!piece || countNarrationCharacters(piece) === 0) break;
    chunks.push(piece);
    rest = rest.slice(cut);
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function semanticCutIndex(value: string, targetCharacters: number, maximumCharacters: number): number {
  const minimumCharacters = Math.max(1, Math.floor(targetCharacters * 0.55));
  const candidates: Array<{ index: number; characters: number; priority: number }> = [];
  const collect = (expression: RegExp, priority: number): void => {
    for (const match of value.matchAll(expression)) {
      const index = (match.index ?? 0) + match[0].length;
      if (index <= 0 || index >= value.length) continue;
      const characters = countNarrationCharacters(value.slice(0, index));
      if (characters < minimumCharacters || characters > maximumCharacters) continue;
      candidates.push({ index, characters, priority });
    }
  };
  collect(/[,;:](?:\s+)?|\s+[—–-]\s+/gu, 0);
  collect(/\s+/gu, 1);
  candidates.sort((left, right) => (
    left.priority - right.priority
    || Math.abs(left.characters - targetCharacters) - Math.abs(right.characters - targetCharacters)
    || left.index - right.index
  ));
  return candidates[0]?.index ?? maximumSafeCutIndex(value, maximumCharacters);
}

function maximumSafeCutIndex(value: string, maximumCharacters: number): number {
  const positions = [0];
  let offset = 0;
  for (const point of value) {
    offset += point.length;
    positions.push(offset);
  }
  let low = 1;
  let high = positions.length - 1;
  let best = positions[1] ?? value.length;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const index = positions[middle]!;
    if (countNarrationCharacters(value.slice(0, index)) <= maximumCharacters) {
      best = index;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return best;
}

function roundTenths(value: number): number {
  return Math.round(value * 10) / 10;
}

function roundMillis(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
