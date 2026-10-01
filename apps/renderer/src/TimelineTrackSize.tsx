import { useCallback, useRef, useState, type CSSProperties, type ReactNode } from "react";

type Track = "video" | "voice" | "templates" | "text" | "sound" | "effects" | "music";
type Heights = Partial<Record<Track, number>>;
const storageKey = "gws-timeline-track-heights-v1";
const tracks: Track[] = ["video", "voice", "templates", "text", "sound", "effects", "music"];
const minimum = (track: Track) => track === "video" ? 48 : 32;
const bounded = (track: Track, value: number) => Math.round(Math.max(minimum(track), Math.min(320, value)));
const variable = (track: Track) => `--timeline-${track}-row`;

export function useTimelineTrackSizes() {
  const [heights, setHeights] = useState<Heights>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
      return Object.fromEntries(tracks.filter(track => Number.isFinite(saved?.[track])).map(track => [track, bounded(track, saved[track])]));
    } catch { return {}; }
  });
  const save = useCallback((track: Track, height: number | undefined) => {
    setHeights(current => {
      const next = { ...current };
      if (height === undefined) delete next[track];
      else next[track] = bounded(track, height);
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Keep session preferences. */ }
      return next;
    });
  }, []);
  const style = Object.fromEntries(Object.entries(heights).map(([track, height]) => [variable(track as Track), `${height}px`])) as CSSProperties;
  const row = (track: Track, fallback: number) => `var(${variable(track)}, ${Math.max(minimum(track), fallback)}px)`;
  return { heights, style, row, save };
}

/** Resizing changes only CSS during the drag, without rerendering hundreds of clips. */
export function TimelineTrackLabel({ track, label, children, height, fallback, onChange, onResizeStart }: {
  track: Track; label: string; children: ReactNode; height?: number; fallback: number;
  onChange: (track: Track, height: number | undefined) => void; onResizeStart: () => void;
}) {
  const drag = useRef<{ y: number; height: number; value: number; sequencer: HTMLElement } | null>(null);
  const current = height ?? Math.max(minimum(track), fallback);
  const finish = () => {
    if (!drag.current) return;
    const value = drag.current.value;
    drag.current = null;
    onChange(track, value);
  };
  return <strong className="timeline-track-label" data-track={track}>
    {children}{label}
    <div className="timeline-track-resize" role="separator" tabIndex={0} aria-label={`Высота дорожки «${label}»`}
      aria-orientation="horizontal" aria-valuemin={minimum(track)} aria-valuemax={Math.max(320, current)} aria-valuenow={current}
      title="Потяните вверх или вниз. Стрелки — изменить высоту, двойной щелчок — сбросить."
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault(); event.stopPropagation(); onResizeStart();
        const sequencer = event.currentTarget.closest<HTMLElement>(".timeline-sequencer")!;
        const actual = event.currentTarget.parentElement!.getBoundingClientRect().height;
        drag.current = { y: event.clientY, height: actual, value: actual, sequencer };
        event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerMove={event => {
        if (!drag.current) return;
        drag.current.value = bounded(track, drag.current.height + event.clientY - drag.current.y);
        drag.current.sequencer.style.setProperty(variable(track), `${drag.current.value}px`);
      }} onPointerUp={finish} onLostPointerCapture={finish}
      onDoubleClick={event => {
        event.preventDefault(); event.stopPropagation();
        event.currentTarget.closest<HTMLElement>(".timeline-sequencer")?.style.removeProperty(variable(track));
        onChange(track, undefined);
      }} onKeyDown={event => {
        if (!["ArrowUp", "ArrowDown", "Home"].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation(); onResizeStart();
        onChange(track, event.key === "Home" ? undefined : current + (event.key === "ArrowDown" ? 16 : -16));
      }} />
  </strong>;
}
