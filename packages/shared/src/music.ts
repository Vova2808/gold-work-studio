/** Serialized music fragment. Times are seconds on the complete film/source. */
export interface MusicClip {
  id: string;
  path?: string;
  name?: string;
  startSeconds: number;
  durationSeconds: number;
  sourceOffsetSeconds: number;
  sourceDurationSeconds?: number;
  volume: number;
  enabled: boolean;
  origin: 'automatic' | 'manual';
  status: 'ready' | 'missing';
  message?: string;
  /** Explicit looping, principally for the legacy whole-film bed. */
  loop?: boolean;
  assetId?: string;
  sourcePage?: string;
}

export interface MusicSettings {
  selectionStatus?: 'ready' | 'local-fallback' | 'unavailable' | 'off';
  selectionMessage?: string;
  assetId?: string;
  path?: string;
  name?: string;
  sourcePage?: string;
  volume: number;
  fadeInSeconds?: number;
  fadeOutSeconds?: number;
  ducking?: boolean;
  enabled?: boolean;
  /** undefined = legacy path; [] = intentional empty track, never a fallback. */
  clips?: MusicClip[];
  /** Protect the edited arrangement, including deleted clips and silence. */
  manualEdits?: boolean;
}

const finite = (n: number | undefined, fallback = 0) => Number.isFinite(n) ? n! : fallback;
const frame = (n: number) => Math.round(n * 30) / 30;
export const MUSIC_MIN_SECONDS = 1 / 30;

/** Read-only adapter: opening an old project never writes a migration. */
export function resolveMusicClips(music: MusicSettings | undefined, durationSeconds: number): MusicClip[] {
  if (!music) return [];
  const clips: MusicClip[] = music.clips ?? (music.path?.trim() ? [{
    id: 'legacy-music', path: music.path, name: music.name, sourcePage: music.sourcePage, assetId: music.assetId,
    startSeconds: 0, durationSeconds, sourceOffsetSeconds: 0, volume: 100, enabled: true,
    origin: 'manual', status: 'ready', loop: true,
  }] : []);
  return clips.map(clip => {
    const startSeconds = Math.max(0, frame(finite(clip.startSeconds)));
    const duration = Math.min(Math.max(0, frame(finite(clip.durationSeconds))), Math.max(0, durationSeconds - startSeconds));
    return { ...clip, startSeconds, durationSeconds: duration,
      sourceOffsetSeconds: Math.max(0, frame(finite(clip.sourceOffsetSeconds))),
      volume: Math.max(0, Math.min(100, finite(clip.volume, 100))),
    };
  }).filter(clip => clip.durationSeconds >= MUSIC_MIN_SECONDS - 1e-6);
}

export function moveMusicClip(clip: MusicClip, startSeconds: number, duration: number): MusicClip {
  return { ...clip, origin: 'manual', startSeconds: frame(Math.max(0, Math.min(duration - clip.durationSeconds, startSeconds))) };
}

/** Left trim preserves the original source-to-timeline mapping. */
export function trimMusicClip(clip: MusicClip, edge: 'left' | 'right', seconds: number, duration: number): MusicClip {
  const end = clip.startSeconds + clip.durationSeconds;
  if (edge === 'left') {
    const start = frame(Math.max(0, clip.status === 'missing' ? 0 : clip.startSeconds - clip.sourceOffsetSeconds, Math.min(end - MUSIC_MIN_SECONDS, seconds)));
    return { ...clip, origin: 'manual', startSeconds: start, durationSeconds: end - start,
      sourceOffsetSeconds: Math.max(0,clip.sourceOffsetSeconds + start - clip.startSeconds) };
  }
  const sourceEnd = !clip.loop && clip.sourceDurationSeconds !== undefined
    ? clip.startSeconds + Math.max(0, clip.sourceDurationSeconds - clip.sourceOffsetSeconds) : duration;
  const nextEnd = Math.max(clip.startSeconds + MUSIC_MIN_SECONDS, Math.min(duration, sourceEnd, frame(seconds)));
  return { ...clip, origin: 'manual', durationSeconds: nextEnd - clip.startSeconds };
}

export function splitMusicClip(clip: MusicClip, seconds: number, rightId: string): [MusicClip, MusicClip] | undefined {
  const at = frame(seconds), leftDuration = at - clip.startSeconds;
  if (leftDuration < MUSIC_MIN_SECONDS - 1e-6 || clip.durationSeconds - leftDuration < MUSIC_MIN_SECONDS - 1e-6) return undefined;
  return [
    { ...clip, origin: 'manual', durationSeconds: leftDuration },
    { ...clip, id: rightId, origin: 'manual', startSeconds: at, durationSeconds: clip.durationSeconds - leftDuration,
      sourceOffsetSeconds: clip.sourceOffsetSeconds + leftDuration },
  ];
}

export function editMusicClips(music: MusicSettings, clips: MusicClip[]): MusicSettings {
  return { ...music, clips, manualEdits: true, selectionStatus: undefined, selectionMessage: undefined };
}

export function musicHasAudio(music:MusicSettings):boolean {
  return music.enabled!==false && music.volume>0 && (music.clips===undefined?Boolean(music.path?.trim())
    :music.clips.some(clip=>clip.enabled&&clip.status==='ready'&&clip.path&&clip.volume>0&&clip.durationSeconds>0));
}
