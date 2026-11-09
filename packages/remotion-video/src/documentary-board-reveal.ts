import type {DocumentaryMotionGraphic} from './documentary-timeline.js';

/** Editorial reading windows inside the existing graphic duration, not speech
 * timestamps. Authored/linked/measured choreography already owns its timing. */
export function automaticBoardRevealWindows(graphic: DocumentaryMotionGraphic, frames: number) {
  if (graphic.origin !== 'automatic' || !graphic.preset?.startsWith('board-') || frames < 90
    || graphic.reading || graphic.sequenceId || graphic.sequenceDurationFrames || graphic.activeIndex !== undefined
    || graphic.artwork || graphic.explanation || graphic.argument || graphic.diagram) return;
  const mode = graphic.boardLayout ?? (graphic.preset === 'board-staircase' ? 'steps' : graphic.preset === 'board-orbit' ? 'compare' : 'parts');
  // A reference chart/parts overview benefits from an early settled hold.
  // Only an ordered process or counterpoint asks for a later second observation.
  if (mode === 'parts') return;
  const cards = graphic.cards?.length ? graphic.cards.slice(0, 5) : graphic.items?.slice(0, 5).map(label => ({label}));
  if (!cards || cards.length < 2) return;
  const weights = cards.map(card => Math.max(1, [card.label, 'value' in card ? card.value : '']
    .filter(Boolean).join(' ').trim().split(/\s+/u).length) + 2);
  const available = frames - 1;
  const duration = Math.max(1, Math.round(Math.min(18, available * .12)));
  const first = Math.round(Math.min(12, available * .06));
  // Keep at least the last third for a complete, still-readable comparison.
  // A longer final label receives more time, never a later rushed entrance.
  const finalHold = Math.max(available * .32, Math.min(90, weights.at(-1)! * 9 + 18));
  const last = Math.floor(Math.min(available * .62, available - finalHold) - duration);
  if (last <= first) return;
  const total = weights.slice(0, -1).reduce((sum, weight) => sum + weight, 0);
  let prior = 0;
  return weights.map(weight => {
    const start = Math.round(first + (last - first) * prior / total);
    prior += weight;
    return {start, duration};
  });
}
