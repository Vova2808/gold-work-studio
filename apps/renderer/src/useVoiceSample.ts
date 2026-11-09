import { useCallback, useEffect, useRef, useState } from 'react';

let activeStop: (() => void) | undefined;
export function stopVoiceSample(): void { activeStop?.(); }

/** One preview across dialogs, with cancellation of late calibration responses. */
export function useVoiceSample(scope: string) {
  const [playing, setPlaying] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const audioRef = useRef<HTMLAudioElement | undefined>(undefined);
  const requestRef = useRef(0);
  const cacheRef = useRef<string | undefined>(undefined);
  const stop = useCallback(() => {
    requestRef.current++;
    const audio = audioRef.current;
    audioRef.current = undefined;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    if (activeStop === stop) activeStop = undefined;
    setPlaying(false);
    setPreparing(false);
  }, []);
  useEffect(() => {
    cacheRef.current = undefined;
    return stop;
  }, [scope, stop]);

  async function toggle(load: (isCurrent: () => boolean) => Promise<string | undefined>): Promise<void> {
    if (activeStop === stop) { stop(); return; }
    stopVoiceSample();
    const request = ++requestRef.current;
    const isCurrent = () => requestRef.current === request;
    activeStop = stop;
    setPreparing(true);
    try {
      const sample = cacheRef.current ?? await load(isCurrent);
      if (!isCurrent()) return;
      if (!sample) { stop(); return; }
      cacheRef.current = sample;
      setPreparing(false);
      const audio = new Audio(`data:audio/mpeg;base64,${sample}`);
      audioRef.current = audio;
      audio.onended = stop;
      audio.onerror = stop;
      setPlaying(true);
      await audio.play();
    } catch (error) {
      if (!isCurrent()) return;
      stop();
      throw error;
    }
  }
  return { playing, preparing, toggle, stop };
}
