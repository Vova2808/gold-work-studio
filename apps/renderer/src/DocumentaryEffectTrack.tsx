import { useRef, useState, type PointerEvent } from "react";
import type { DocumentaryEffect, Scene } from "@gold-work/shared";

type Entry = { scene: Scene; start: number; duration: number };
type Clip = { entry: Entry; effect: DocumentaryEffect; start: number; lane: number };

export function documentaryEffectClips(layout: Entry[], audio: boolean): { clips: Clip[]; height: number } {
  const ends: number[] = [];
  const clips = layout.flatMap(entry => entry.scene.documentary?.effects.filter(effect => (effect.kind === "audio") === audio)
    .map(effect => ({ entry, effect, start: entry.start + effect.startSeconds })) ?? [])
    .sort((a, b) => a.start - b.start).map(clip => {
      let lane = ends.findIndex(end => end <= clip.start);
      if (lane < 0) lane = ends.length;
      ends[lane] = clip.start + clip.effect.durationSeconds;
      return { ...clip, lane };
    });
  return { clips, height: Math.max(1, ends.length) * 30 + 6 };
}

export function DocumentaryEffectTrack({ clips, height, duration, boundaries, busy, onChange, onSelect }: {
  clips: Clip[]; height: number; duration: number; boundaries: number[]; busy: boolean;
  onChange: (sceneId: string, effectId: string, effect: DocumentaryEffect | null) => void;
  onSelect: (sceneId: string) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ clip: Clip; x: number; mode: "move" | "left" | "right"; pixelsPerSecond: number } | null>(null);
  const draftRef = useRef<DocumentaryEffect | null>(null);
  const [draft, setDraft] = useState<DocumentaryEffect | null>(null);
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active) return;
    const { clip, mode, pixelsPerSecond } = active;
    const original = clip.effect;
    const delta = (event.clientX - active.x) / pixelsPerSecond;
    const low = original.kind === "audio" ? 0 : clip.entry.start;
    const high = original.kind === "audio" ? duration : clip.entry.start + clip.entry.duration;
    const snap = (time: number) => {
      const nearest = event.altKey ? undefined : boundaries.find(boundary => Math.abs(time - boundary) * pixelsPerSecond < 8);
      return Math.round((nearest ?? time) * 30) / 30;
    };
    let start = clip.start, end = start + original.durationSeconds;
    let trim = original.defaults.trimStartSeconds;
    const sourceEnd = original.defaults.trimEndSeconds ?? original.sourceDurationSeconds ?? trim + original.durationSeconds;
    if (mode === "move") {
      start = Math.max(low, Math.min(high - original.durationSeconds, snap(clip.start + delta)));
      end = start + original.durationSeconds;
    } else if (mode === "left") {
      start = Math.max(low, clip.start - trim, Math.min(end - 1 / 30, snap(clip.start + delta)));
      trim += start - clip.start;
    } else {
      end = Math.max(start + 1 / 30, Math.min(high, start + sourceEnd - trim, snap(end + delta)));
    }
    const length = end - start;
    const next = { ...original, startSeconds: start - clip.entry.start, durationSeconds: length,
      defaults: { ...original.defaults, trimStartSeconds: trim, fadeInSeconds: Math.min(original.defaults.fadeInSeconds, length), fadeOutSeconds: Math.min(original.defaults.fadeOutSeconds, length) } };
    draftRef.current = next; setDraft(next);
  };
  const finish = (commit: boolean) => {
    const active = drag.current, next = draftRef.current;
    drag.current = null; draftRef.current = null; setDraft(null);
    if (commit && active && next) onChange(active.clip.entry.scene.id, active.clip.effect.id, next);
  };
  return <div ref={track} className="timeline-grid-track documentary-effect-track" style={{ height }}>
    {!clips.length && <span className="documentary-empty-track">Добавьте эффект в свойствах кадра</span>}
    {clips.map(clip => {
      const effect = draft?.id === clip.effect.id ? draft : clip.effect;
      return <div key={`${clip.entry.scene.id}:${effect.id}`} role="button" tabIndex={busy ? -1 : 0}
        aria-label={`${effect.kind === "audio" ? "Звук" : "Эффект"}: ${effect.name}`}
        className={`documentary-effect-clip${effect.kind === "audio" ? " sound" : " visual"}${effect.enabled ? "" : " muted"}`}
        style={{ left: `${(clip.entry.start + effect.startSeconds) / duration * 100}%`, width: `${effect.durationSeconds / duration * 100}%`, top: clip.lane * 30 + 3 }}
        title={`${effect.name} · ${(clip.entry.start + effect.startSeconds).toFixed(2)}–${(clip.entry.start + effect.startSeconds + effect.durationSeconds).toFixed(2)} с. Потяните за края для обрезки. Alt — без привязки. M — вкл/выкл, Delete — убрать.`}
        onPointerDown={event => {
          if (busy || event.button !== 0) return;
          event.preventDefault(); event.stopPropagation();
          event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
          const edge = (event.target as HTMLElement).dataset.edge;
          drag.current = { clip, x: event.clientX, mode: edge === "left" || edge === "right" ? edge : "move", pixelsPerSecond: track.current!.clientWidth / duration };
          draftRef.current = null;
          onSelect(clip.entry.scene.id);
        }} onPointerMove={move} onPointerUp={() => finish(true)} onPointerCancel={() => finish(false)} onLostPointerCapture={() => finish(false)}
        onKeyDown={event => {
          if (busy || !["ArrowLeft", "ArrowRight", "Delete", "Backspace", "m", "M", "Escape"].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          if (event.key === "Escape") { finish(false); return; }
          if (event.key === "Delete" || event.key === "Backspace") { onChange(clip.entry.scene.id, effect.id, null); return; }
          if (event.key.toLowerCase() === "m") { onChange(clip.entry.scene.id, effect.id, { ...effect, enabled: !effect.enabled }); return; }
          const low = effect.kind === "audio" ? -clip.entry.start : 0;
          const high = (effect.kind === "audio" ? duration - clip.entry.start : clip.entry.duration) - effect.durationSeconds;
          onChange(clip.entry.scene.id, effect.id, { ...effect, startSeconds: Math.max(low, Math.min(high, effect.startSeconds + (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 1 : .1))) });
        }}>
        <span data-edge="left" className="documentary-trim-handle left" /><span className="documentary-effect-name">{effect.enabled ? "" : "⊘ "}{effect.name}</span><span data-edge="right" className="documentary-trim-handle right" />
      </div>;
    })}
  </div>;
}
