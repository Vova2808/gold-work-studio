import type { DocumentaryCandidate, Project, Scene } from "@gold-work/shared";
import { visualHashDistance } from "./documentary-visual-hash.js";
import { documentaryRequiredSourceSeconds } from './documentary-candidate-allocation.js';

/** Several saved excerpts may share one source URL, but are different files. */
export function documentaryCandidateKey(candidate: DocumentaryCandidate): string {
  const source = candidate.downloadUrl || candidate.localPath || candidate.id;
  return candidate.excerpt ? `${source}#excerpt:${candidate.excerpt.sourceChecksum}:${candidate.excerpt.startSeconds}:${candidate.excerpt.endSeconds}` : source;
}

export function sameDocumentarySource(a: DocumentaryCandidate, b: DocumentaryCandidate): boolean {
  return a.kind === b.kind && (a.id === b.id
    || Boolean(a.excerpt?.sourceChecksum && a.excerpt.sourceChecksum === b.excerpt?.sourceChecksum)
    || Boolean(a.downloadUrl && a.downloadUrl === b.downloadUrl)
    || Boolean(a.localPath && a.localPath === b.localPath));
}

function sameMaterial(a: Scene, b: Scene): boolean {
  const left = a.documentary, right = b.documentary;
  if (!left?.selected || !right?.selected || left.selected.kind !== right.selected.kind) return false;
  const originalChecksum = (doc: NonNullable<Scene["documentary"]>) => doc.selected?.excerpt?.sourceChecksum || doc.checksum
    || doc.selected?.id.match(/^local:([a-f0-9]{64})$/i)?.[1];
  const leftSource = originalChecksum(left), rightSource = originalChecksum(right);
  if (leftSource && leftSource === rightSource) return true;
  if (left.checksum && left.checksum === right.checksum || sameDocumentarySource(left.selected, right.selected)) return true;
  // A video's poster says nothing about its selected range. Compare hashes only for photos.
  return left.selected.kind === "image" && Boolean(left.visualHash && right.visualHash && visualHashDistance(left.visualHash, right.visualHash) <= 6);
}

function range(scene: Scene) {
  const start = scene.trimStartSeconds ?? 0;
  const offset = scene.documentary?.selected?.excerpt?.startSeconds ?? 0;
  return { start: start + offset, end: (scene.trimEndSeconds ?? start + documentaryRequiredSourceSeconds(scene)) + offset };
}

export function usedDocumentaryRanges(project: Project, scene: Scene): Array<{ start: number; end: number }> {
  if (scene.documentary?.selected?.kind !== "video") return [];
  return project.scenes.filter(other => other.id !== scene.id && other.includeInAssembly !== false && other.documentary?.verified && sameMaterial(scene, other))
    .map(range).map(range => { const offset = scene.documentary?.selected?.excerpt?.startSeconds ?? 0; return { start: range.start - offset, end: range.end - offset }; }).sort((a, b) => a.start - b.start);
}

/** A range already in the film is unavailable, even far from its first use.
 * Different ranges of the same original remain eligible. */
export function unavailableDocumentaryRanges(project: Project, scene: Scene): Array<{start:number;end:number}> {
  return usedDocumentaryRanges(project, scene);
}

/** Range-level similarity, never the source's common poster or a global file-use limit. */
export function documentaryVarietyIssue(project: Project, scene: Scene): string | undefined {
  if (scene.documentary?.selected?.kind !== "video") return;
  const ordered = project.scenes.filter(item => item.includeInAssembly !== false).sort((a, b) => a.order - b.order);
  const index = ordered.findIndex(item => item.id === scene.id);
  const starts = new Map<string, number>();
  let elapsed = 0;
  for (const item of ordered) {
    starts.set(item.id, elapsed);
    elapsed += Math.max((item.documentary?.timing?.durationInFrames ?? item.durationSeconds * 30) / 30, item.durationOverrideSeconds ?? 0);
  }
  const nearby = (item: Scene) => Math.abs((starts.get(item.id) ?? 0) - (starts.get(scene.id) ?? 0)) < 90;
  const review = scene.documentary.visualReview;
  const adjacent = [ordered[index - 1], ordered[index + 1]].filter((item): item is Scene => Boolean(item?.documentary?.verified));
  const sameSource = ordered.filter(item => item.id !== scene.id && item.documentary?.verified && sameMaterial(scene, item));
  const view = (item: Scene) => item.documentary?.visualReview?.viewDescription?.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const currentView = view(scene);
  const sameView = currentView ? sameSource.filter(item => view(item) === currentView) : [];
  if (sameView.some(item => adjacent.includes(item))) return "Соседние фрагменты повторяют один ракурс из каталога: нужен другой план или деталь.";
  if (sameView.some(nearby)) return "Этот ракурс уже показан менее полутора минут назад; нужен другой план или деталь.";
  if (sameView.length >= 2) return "Один ракурс из каталога уже показан два раза; другие таймкоды не добавляют разнообразия.";
  const source = scene.documentary.selected;
  const sourceDuration = source.excerpt?.sourceDurationSeconds ?? source.durationSeconds;
  // A pan/zoom can change a small dHash completely without introducing a new
  // shot. A short unindexed clip is not a new view merely because its time
  // range differs. Indexed, described details remain eligible below.
  if (!currentView && sourceDuration && sourceDuration <= 45 && sameSource.some(nearby)) {
    return "Короткий исходник уже показан менее полутора минут назад; без подтверждённого другого ракурса нужен другой материал.";
  }
  // Short stock clips have no shot catalog. Slicing one into many disjoint
  // intervals must not fill the film with the same camera setup. Long indexed
  // sources remain available for arbitrarily many genuinely different views.
  if (!currentView && sourceDuration && sourceDuration <= 45 && sameSource.length >= 3) {
    return "Короткий исходник уже показан три раза; нужен другой источник или подтверждённый каталогом другой ракурс.";
  }
  if (review?.frameHash && adjacent.some(item => item.documentary?.selected?.kind === "video" && item.documentary.visualReview?.frameHash
    // Moving ships/lights change a few edge bits inside the same fixed shot.
    // The live night-lock regression differs by 11 bits despite the same view.
    && visualHashDistance(review.frameHash!, item.documentary.visualReview.frameHash) <= (sameMaterial(scene, item) ? 12 : 8))) {
    return "Соседние видеофрагменты визуально почти одинаковы: нужен другой ракурс или деталь.";
  }
  const similar = review?.frameHash ? ordered.filter(item => item.id !== scene.id && item.documentary?.verified && item.documentary.selected?.kind === "video"
    && item.documentary.visualReview?.frameHash && visualHashDistance(review.frameHash!, item.documentary.visualReview.frameHash) <= (sameMaterial(scene, item) ? 12 : 6)) : [];
  if (similar.some(nearby)) return "Видеофрагменты визуально почти одинаковы и повторяются менее чем через полторы минуты: нужен другой ракурс или деталь.";
  if (similar.length >= 2) {
    return "Почти одинаковый ракурс уже показан два раза; выберите другую деталь или план, даже если таймкоды отличаются.";
  }
  const wide = (item: Scene) => {
    const description = item.documentary?.visualReview?.viewDescription || item.documentary?.visualReview?.reason || "";
    return /\b(aerial|drone|wide|exterior|establishing)\b|общий план|общего плана|обл[её]т/i.test(description)
      && !/\b(close[- ]?up|interior|inside|macro)\b|крупный план|интерьер/i.test(description);
  };
  if (!wide(scene)) return;
  // Two adjacent establishing views can form a sequence; a third must add a
  // different view. Details/interiors from the same long source remain usable.
  for (let start = Math.max(0, index - 2); start <= index && start + 2 < ordered.length; start++) {
    const neighbors = ordered.slice(start, start + 3).filter(item => item.id !== scene.id);
    if (neighbors.length === 2 && neighbors.every(item => item.documentary?.verified && sameMaterial(scene, item) && wide(item))) {
      return "Три общих плана одного источника подряд: нужен другой ракурс, деталь, архивный кадр или другой источник.";
    }
  }
}

/** Apply the same rules to resumed projects, retaining the earliest valid
 * choices and every manual pin. Do not revoke both sides of a repetition. */
export function revalidateDocumentaryVariety(project: Project): Scene[] {
  const checked = { ...project, scenes: project.scenes.map(scene => scene.documentary?.verified && !scene.documentary.pinned
    ? { ...scene, documentary: { ...scene.documentary, verified: false } } : scene) };
  for (const original of [...project.scenes].sort((a, b) => a.order - b.order)) {
    if (!original.documentary?.verified || original.documentary.pinned || original.includeInAssembly === false) continue;
    const issue = documentaryReuseIssue(checked, original) || documentaryVarietyIssue(checked, original);
    const index = checked.scenes.findIndex(scene => scene.id === original.id);
    checked.scenes[index] = issue ? { ...original, documentary: { ...original.documentary, verified: false, autoError: issue, reviewNote: issue } } : original;
  }
  return checked.scenes;
}

/** Auto-selection only. A manual choice remains possible and is never silently replaced. */
export function documentaryReuseIssue(project: Project, scene: Scene): string | undefined {
  const ordered = project.scenes.filter(item => item.includeInAssembly !== false).sort((a, b) => a.order - b.order);
  const index = ordered.findIndex(item => item.id === scene.id);
  const current = range(scene);
  const repeated = ordered.filter(other => {
    if (other.id === scene.id || !other.documentary?.verified || !sameMaterial(scene, other)) return false;
    if (scene.documentary?.selected?.kind === "image") return true;
    const previous = range(other);
    return Math.min(current.end, previous.end) - Math.max(current.start, previous.start) > .25;
  });
  const adjacent = repeated.find(other => other.id === ordered[index - 1]?.id || other.id === ordered[index + 1]?.id);
  if (adjacent) return `Повтор материала в соседнем кадре ${adjacent.order + 1}: нужен другой ракурс или непересекающийся фрагмент.`;
  if (repeated.length) return `Этот снимок или фрагмент уже использован в кадре ${repeated[0]!.order + 1}. Нужен другой снимок или непересекающийся отрезок видео.`;
}

/** Spread samples over unused portions; keep the original overview when the source is new. */
export function documentarySampleTimes(duration: number, desired: number, used: Array<{ start: number; end: number }>, legacyCenters = false): number[] {
  const count = Math.min(16, Math.max(3, Math.ceil(duration / 10)));
  const fraction = (index: number) => legacyCenters ? (index + .5) / count : .03 + .94 * index / (count - 1);
  // Samples describe frames, not centers of possible full-length clips. Keep
  // both ends visible so a short action near the tail is not missed.
  if (!used.length) return Array.from({ length: count }, (_, i) => Math.max(0, (legacyCenters ? duration - .2 : duration) * fraction(i)));
  const gaps: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const interval of used) {
    if (interval.start > cursor) gaps.push({ start: cursor, end: Math.min(duration, interval.start) });
    cursor = Math.max(cursor, interval.end);
  }
  if (cursor < duration) gaps.push({ start: cursor, end: duration });
  const usable = gaps.filter(gap => gap.end - gap.start >= desired);
  const available = usable.reduce((sum, gap) => sum + gap.end - gap.start, 0);
  if (!available) return [];
  return Array.from({ length: count }, (_, i) => {
    let offset = available * fraction(i);
    for (const gap of usable) {
      const length = gap.end - gap.start;
      if (offset <= length) return legacyCenters
        ? Math.max(gap.start + desired / 2, Math.min(gap.end - desired / 2, gap.start + offset))
        : Math.max(gap.start + .01, Math.min(gap.end - .01, gap.start + offset));
      offset -= length;
    }
    return usable.at(-1)!.end - desired / 2;
  }).filter((time, i, all) => all.findIndex(other => Math.abs(other - time) < .2) === i);
}
