import { join } from "node:path";
import type { DocumentaryTimeline } from "@gold-work/remotion-video";
import {documentaryMusicClipGainExpression} from '@gold-work/remotion-video';
import { atomicWrite } from "./fs-utils.js";
import { runFfmpeg } from "./standard-renderer.js";
import { probeEffectMedia } from "./effect-media.js";
import { masterDocumentaryAudio } from './documentary-audio-master.js';

type Shot = DocumentaryTimeline["scenes"][number];
/** Plain cover video and simple dissolves use FFmpeg. Graphics, photos and
 * complex transitions stay in the shared Remotion composition. */
export function isPlainDocumentaryShot(timeline: DocumentaryTimeline, index: number): boolean {
  const s = timeline.scenes[index]!, d = s.documentary, previous = timeline.scenes[index - 1];
  const styledTransition=(shot:Shot|undefined)=>['blur','glitch'].includes(shot?.documentary?.transitionStyle??shot?.documentary?.autoTransitionStyle??'clean');
  if (s.transitionFrames&&styledTransition(s)||previous?.transitionFrames&&styledTransition(previous)) return false;
  if(previous?.transitionFrames&&previous.transition==='mix'&&!plainSurface(timeline,index-1))return false;
  return plainSurface(timeline,index);
}
function plainSurface(timeline:DocumentaryTimeline,index:number):boolean {
  const s=timeline.scenes[index]!,d=s.documentary;
  const dimensions = d?.selected;
  return Boolean(s.videoPath && d?.layout === "full" && !d.illustrative && !s.fadeEdges
    && !d.cuts?.length
    && !d.motionGraphic?.enabled
    && !d.semanticMontage?.vignette && !d.semanticMontage?.monochrome
    && !timeline.scenes.some(scene=>scene.documentary?.texts?.some(text=>text.enabled&&text.text.trim()&&scene.fromFrame+text.startSeconds*30<s.fromFrame+s.durationInFrames&&scene.fromFrame+(text.startSeconds+text.durationSeconds)*30>s.fromFrame))
    && (!d.template || d.template === "full")
    && !(timeline.captionsEnabled && d.caption.enabled && d.caption.text.trim())
    && !d.effects.some(e => e.enabled && e.kind !== "audio" && e.durationSeconds > 0)
    && dimensions?.width && dimensions.height && dimensions.width / dimensions.height >= timeline.width / timeline.height * .88);
}

export async function renderPlainDocumentaryShot(timeline: DocumentaryTimeline, s: Shot, output: string, crf: number, signal?:AbortSignal) {
  const fps = timeline.fps, duration = s.durationInFrames / fps;
  const start = Math.max(0, Math.round((s.trimStartSeconds ?? 0) * fps) / fps), rate = s.playbackRate ?? 1;
  const end = Math.min(s.trimEndSeconds === undefined ? Infinity : Math.round(s.trimEndSeconds * fps) / fps, s.documentary?.selected?.durationSeconds ?? Infinity);
  const sourceLength = Math.max(1 / fps, Math.min(duration * rate, end - start));
  const index=timeline.scenes.findIndex(scene=>scene.id===s.id),previous=timeline.scenes[index-1];
  const incoming=(previous?.transitionFrames??0)/fps;
  const outgoing=s.transitionFrames/fps;
  const scale=`scale=${timeline.width}:${timeline.height}:force_original_aspect_ratio=increase,crop=${timeline.width}:${timeline.height},setsar=1`;
  let filter=`[0:v]setpts=(PTS-STARTPTS)/${rate},fps=${fps},${scale},tpad=stop_mode=clone:stop_duration=${duration}`;
  if(previous?.transition==='fade'&&incoming)filter+=`,fade=t=in:st=0:d=${incoming}`;
  if(s.transition==='fade'&&outgoing&&index<timeline.scenes.length-1)filter+=`,fade=t=out:st=${duration-outgoing}:d=${outgoing}`;
  const inputs=['-ss',String(start),'-t',String(sourceLength),'-i',s.videoPath!];
  if(previous?.transition==='mix'&&incoming){
    const previousStart=previous.trimStartSeconds??0,previousRate=previous.playbackRate??1;
    const previousEnd=Math.min(previous.trimEndSeconds??Infinity,previous.documentary?.selected?.durationSeconds??Infinity);
    const previousDuration=previous.durationInFrames/fps;
    const previousLength=Math.max(1/fps,Math.min(previousDuration*previousRate,previousEnd-previousStart));
    // Seeking to duration - 1/fps can land beyond the last frame of a 29.97fps
    // source. Decode the bounded previous shot and pad before taking its final
    // timeline frame, including when the source is shorter than the scene.
    inputs.push('-ss',String(previousStart),'-t',String(previousLength),'-i',previous.videoPath!);
    // Disabled blend passes its first input through. Keep the current shot
    // first so the per-pixel expression runs only during the dissolve.
    filter+=`[current];[1:v]setpts=(PTS-STARTPTS)/${previousRate},fps=${fps},${scale},tpad=stop_mode=clone:stop_duration=${previousDuration},trim=start_frame=${previous.durationInFrames-1}:end_frame=${previous.durationInFrames},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${duration},fps=${fps}[hold];[current][hold]blend=all_expr='A*min(T/${incoming},1)+B*(1-min(T/${incoming},1))':enable='lt(t,${incoming})'[out]`;
  }else filter+='[out]';
  await runFfmpeg(["-y", "-threads", "2", "-filter_complex_threads", "1", ...inputs,
    "-an", "-filter_complex",filter,'-map','[out]',
    "-frames:v", String(s.durationInFrames), "-c:v", "libx264", "-preset", "veryfast", "-crf", String(crf), "-threads", "2", "-pix_fmt", "yuv420p", "-video_track_timescale", "15360", output],undefined,signal);
}

type Track = { path: string; at: number; start: number; duration: number; volume: number; rate?: number; fadeIn?: number; fadeOut?: number; envelopeDuration?: number; loop?:boolean; gainExpression?:string };
/** Audio is mixed once on the global timeline, so SFX can cross scene boundaries.
 * Batches keep Windows command lines, open decoders and memory bounded. */
export async function renderDocumentaryAudio(timeline: DocumentaryTimeline, directory: string, signal?:AbortSignal): Promise<string | undefined> {
  const tracks: Track[] = [], hasAudio = new Map<string, boolean>();
  const addSource = async (path: string, track: Omit<Track, "path">) => {
    if (!hasAudio.has(path)) hasAudio.set(path, (await probeEffectMedia(path,signal)).hasAudio ?? false);
    if (hasAudio.get(path)) tracks.push({ path, ...track });
  };
  for (const s of timeline.scenes) {
    const at = s.fromFrame / 30, duration = s.durationInFrames / 30, d = s.documentary;
    if (s.narrationEnabled && d?.timing?.audioPath) {
      const start = Math.round((d.timing.audioStartSeconds ?? 0) * 30) / 30;
      tracks.push({ path: d.timing.audioPath, at, start, duration: Math.min(duration, d.timing.audioEndSeconds === undefined ? Infinity : Math.round(d.timing.audioEndSeconds * 30) / 30 - start), volume: Math.max(0, Math.min(1.5, (s.narrationVolume ?? 100) / 100)) });
    }
    if (d?.cuts?.length && (s.sourceVolume ?? 0) > 0) {
      for (const cut of d.cuts) if (cut.videoPath) {
        const start = Math.round(cut.trimStartSeconds * 30) / 30;
        const end = Math.min(cut.trimEndSeconds ?? Infinity, cut.sourceDurationSeconds ?? Infinity);
        await addSource(cut.videoPath,{at:at+cut.fromFrame/30,start,rate:cut.playbackRate,
          duration:Math.min(cut.durationInFrames/30,Math.max(0,Math.floor((end-start)/cut.playbackRate*30)-1)/30),volume:Math.min(1,s.sourceVolume!/100)});
      }
    } else if (s.videoPath && (s.sourceVolume ?? 0) > 0) {
      const start = Math.round((s.trimStartSeconds ?? 0) * 30) / 30, rate = s.playbackRate ?? 1;
      await addSource(s.videoPath, { at, start, rate, duration: Math.min(duration, Math.max(0, Math.floor(((s.trimEndSeconds ?? d?.selected?.durationSeconds ?? Infinity) - start) / rate * 30) - 1) / 30), volume: Math.min(1, s.sourceVolume! / 100) });
    }
    for (const e of d?.effects ?? []) {
      if (!e.enabled || e.durationSeconds <= 0 || e.kind !== "audio" && !(e.kind === "video" && e.defaults.sourceAudio)) continue;
      const start = Math.round(e.defaults.trimStartSeconds * 30) / 30;
      const track = { at: at + Math.round(e.startSeconds * 30) / 30, start,
        duration: Math.min(e.durationSeconds, e.kind === "audio" ? Infinity : duration - e.startSeconds, e.defaults.trimEndSeconds === undefined ? Infinity : Math.round(e.defaults.trimEndSeconds * 30) / 30 - start),
        volume: Math.max(0, Math.min(1, e.defaults.volume / 100)) * timeline.sfxVolume / 100 * (s.narrationEnabled ? .6 : 1),
        fadeIn: e.defaults.fadeInSeconds, fadeOut: e.defaults.fadeOutSeconds, envelopeDuration: (Math.round(e.durationSeconds * 30) - 1) / 30 };
      if (e.kind === "video") await addSource(e.filePath,track); else tracks.push({path:e.filePath,...track});
    }
  }
  const music=timeline.music&&timeline.music.volume>0?timeline.music.clips.filter(clip=>clip.enabled&&clip.status==='ready'&&clip.path&&clip.volume>0):[];
  const musicDurations=new Map<string,number>();
  for(const clip of music){
    if(!musicDurations.has(clip.path!)){
      const info=await probeEffectMedia(clip.path!,signal);
      if(!info.hasAudio||!info.durationSeconds)throw Error('Файл музыкального фрагмента недоступен. Замените его или выключите фрагмент.');
      musicDurations.set(clip.path!,info.durationSeconds);
    }
    const sourceDuration=musicDurations.get(clip.path!)!;
    tracks.push({path:clip.path!,at:clip.startSeconds,start:clip.loop?clip.sourceOffsetSeconds%sourceDuration:clip.sourceOffsetSeconds,
      duration:clip.loop?clip.durationSeconds:Math.min(clip.durationSeconds,Math.max(0,sourceDuration-clip.sourceOffsetSeconds)),
      volume:clip.volume,loop:clip.loop,gainExpression:documentaryMusicClipGainExpression(timeline,clip)});
  }
  const active = tracks.filter(t => t.duration > 0 && t.volume > 0 && t.at + t.duration > 0);
  if (!active.length) return undefined;
  const stems: { path: string; at: number }[] = [];
  for (let offset = 0; offset < active.length; offset += 12) {
    const batch = active.slice(offset, offset + 12), at = Math.max(0, Math.min(...batch.map(t => t.at)));
    const args: string[] = ["-y", "-filter_complex_threads", "2"];
    const filters = batch.map((t, i) => {
      const rate = t.rate ?? 1;
      args.push("-threads", "1", ...(t.loop?["-stream_loop","-1"]:[]), "-ss", String(t.start), "-t", String(t.duration * rate), "-i", t.path);
      const tempo: string[] = []; let r = rate;
      while (r > 2) { tempo.push("atempo=2"); r /= 2; } while (r < .5) { tempo.push("atempo=.5"); r *= 2; }
      if (r !== 1) tempo.push(`atempo=${r}`);
      const gain = t.gainExpression ?? (t.envelopeDuration === undefined ? String(t.volume) : `${t.volume}*min(${t.fadeIn ? `min(1\,t/${t.fadeIn})` : "1"}\,${t.fadeOut ? `max(0\,min(1\,(${t.envelopeDuration}-t)/${t.fadeOut}))` : "1"})`);
      const delaySamples = Math.round(Math.max(0, t.at - at) * 48000);
      return `[${i}:a]asetpts=PTS-STARTPTS,${tempo.length ? tempo.join(",") + "," : ""}aresample=48000,aformat=channel_layouts=stereo,volume='${gain}':eval=frame,atrim=start=${Math.max(0,-t.at)}:end=${t.duration},asetpts=PTS-STARTPTS,adelay=${delaySamples}S:all=1[a${i}]`;
    });
    filters.push(`${batch.map((_,i)=>`[a${i}]`).join("")}amix=inputs=${batch.length}:normalize=0:dropout_transition=0[mix]`);
    const script = join(directory, `audio-${offset}.filter`), path = join(directory, `audio-${offset}.wav`);
    await atomicWrite(script, filters.join(";\n"));
    await runFfmpeg([...args, "-filter_complex_script", script, "-map", "[mix]", "-c:a", "pcm_s16le", path],undefined,signal);
    stems.push({ path, at });
  }
  const mixedPath = join(directory, "audio-mix.wav"), script = join(directory, "audio-mix.filter");
  const filters = stems.map((s,i)=>`[${i}:a]adelay=${Math.round(s.at*48000)}S:all=1[a${i}]`);
  filters.push(`${stems.map((_,i)=>`[a${i}]`).join("")}amix=inputs=${stems.length}:normalize=0:dropout_transition=0,alimiter=limit=0.95:level=false:latency=true,apad,atrim=0:${timeline.durationInFrames/30}[mix]`);
  await atomicWrite(script, filters.join(";\n"));
  await runFfmpeg(["-y", "-filter_complex_threads", "2", ...stems.flatMap(s=>["-i",s.path]), "-filter_complex_script", script, "-map", "[mix]", "-c:a", "pcm_s16le", mixedPath],undefined,signal);
  const path=join(directory,"audio.wav");
  await masterDocumentaryAudio(mixedPath,path,signal);
  return path;
}
