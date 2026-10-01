import { useEffect, useState } from "react";
import {LocalMediaImage} from './LocalMediaImage';
import type { Scene } from "@gold-work/shared";

const mediaUrl = (path: string) => `gw-media://local/${encodeURIComponent(path)}`;
export function DocumentarySourcePreview({ scene, start, end }: { scene?: Scene; start?: number; end?: number }) {
  const [playing, setPlaying] = useState(false);
  const from = start ?? scene?.trimStartSeconds ?? 0;
  const to = end ?? scene?.trimEndSeconds ?? from + (scene?.documentary?.timing?.durationInFrames ?? (scene?.durationSeconds ?? 0) * 30) / 30;
  useEffect(() => setPlaying(false), [scene?.id, scene?.videoPath, from, to]);
  if (!scene) return null;
  return <div className="documentary-source-preview">
    {playing && scene.videoPath ? <video key={`${scene.videoPath}:${from}:${to}`} controls muted autoPlay preload="metadata" src={mediaUrl(scene.videoPath)}
      onLoadedMetadata={e => { e.currentTarget.currentTime = Math.min(from, Math.max(0, e.currentTarget.duration - .05)); }}
      onTimeUpdate={e => { if (e.currentTarget.currentTime >= to) { e.currentTarget.pause(); setPlaying(false); } }} />
      : <button type="button" disabled={!scene.videoPath} onClick={() => setPlaying(true)} title={scene.videoPath ? "Посмотреть выбранный диапазон" : "Фотография"}>
        {scene.imagePath && <LocalMediaImage src={mediaUrl(scene.imagePath)} alt="" />}{scene.videoPath && <span>▶ Посмотреть фрагмент</span>}
      </button>}
    <small>{scene.documentary?.selected?.title ?? scene.title}{scene.videoPath && ` · ${from.toFixed(1)}–${to.toFixed(1)} с`}</small>
  </div>;
}

export function DocumentarySourcePicker({ label, scenes, value, onChange, start, end }: {
  label: string; scenes: Scene[]; value: string; onChange: (scene: Scene) => void; start?: number; end?: number;
}) {
  const [query, setQuery] = useState("");
  const selected = scenes.find(scene => scene.id === value);
  const filtered = scenes.filter(scene => `${scene.order + 1} ${scene.title} ${scene.documentary?.selected?.title ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="documentary-source-picker">
    <label>{label}<select aria-label={label} value={value} onChange={e => { const next = scenes.find(scene => scene.id === e.target.value); if (next) onChange(next); }}>
      {!selected && <option value="">Выберите подтверждённый материал</option>}
      {scenes.map(scene => <option value={scene.id} key={scene.id}>{scene.order + 1}. {scene.title}</option>)}
    </select></label>
    <DocumentarySourcePreview scene={selected} start={start} end={end} />
    <details><summary>Выбрать по миниатюрам · {scenes.length}</summary>
      <input aria-label="Найти материал" placeholder="Название или номер сцены" value={query} onChange={e => setQuery(e.target.value)} />
      <div className="documentary-source-grid">{filtered.map(scene => <button key={scene.id} type="button" className={scene.id === value ? "selected" : ""} onClick={() => onChange(scene)}>
        {scene.imagePath && <img loading="lazy" decoding="async" src={`${mediaUrl(scene.imagePath)}?thumbnail=240`} alt="" />}<span>{scene.order + 1}. {scene.documentary?.selected?.title ?? scene.title}</span>
        <small>{scene.videoPath ? `${(scene.trimStartSeconds ?? 0).toFixed(1)}–${(scene.trimEndSeconds ?? (scene.trimStartSeconds ?? 0) + scene.durationSeconds).toFixed(1)} с` : "Фото"}</small>
      </button>)}</div>
    </details>
  </div>;
}
