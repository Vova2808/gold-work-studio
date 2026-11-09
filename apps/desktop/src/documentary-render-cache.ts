import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DocumentaryTimeline } from "@gold-work/remotion-video";
import type { Project } from "@gold-work/shared";
import {documentaryManualReviewReady} from '@gold-work/shared';
import { copyImmutableDocumentaryFile } from "./documentary-storage.js";

/** Preview proxies are transient views of originals, not new export sources. */
export function documentaryExportProject(project:Project,projectDirectory:string):Project {
  return {...project,scenes:project.scenes.map(scene=>{
    const doc=scene.documentary;
    const preview=doc?.checksum?join(projectDirectory,'Documentary','Playback',`${doc.checksum}-3840.png`):undefined;
    return !scene.videoPath&&preview!==undefined&&scene.imagePath===preview&&doc?.selected?.kind==='image'&&doc.selected.localPath
      ?{...scene,imagePath:doc.selected.localPath,documentary:documentaryManualReviewReady(scene)
        ?{...doc,manualReview:{...doc.manualReview!,mediaPath:doc.selected.localPath}}:doc}:scene;
  })};
}

/** Completed visual chunks survive a failed assembly. No originals live here. */
export async function documentaryRenderCache(projectDirectory: string, entryPoint: string) {
  const root = join(projectDirectory, "Documentary", "RenderCache"); await mkdir(root,{recursive:true});
  const plainRenderer = 'ffmpeg-plain-v2-transitions';
  const hash = createHash("sha256").update(plainRenderer);
  // Hash the compiled composition, not the startup timestamp: a restart alone
  // must not invalidate good frames, while a template implementation change must.
  for (const name of (await readdir(dirname(entryPoint))).filter(n=>n.endsWith(".js")).sort()) hash.update(await readFile(join(dirname(entryPoint),name)));
  const renderer = hash.digest("hex"), used = new Set<string>();
  const fileIdentity = async (key: ReturnType<typeof createHash>, files: Iterable<string>) => {
    for (const file of [...new Set(files)].sort()) {
      const info = await stat(file, { bigint: true });
      key.update(`${file}:${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}`);
    }
  };
  return {
    async audioPath(timeline: DocumentaryTimeline) {
      const tracks = timeline.scenes.map(scene => ({ at: scene.fromFrame, duration: scene.durationInFrames,
        voice: scene.narrationEnabled ? { timing: scene.documentary?.timing, volume: scene.narrationVolume } : undefined,
        source: scene.sourceVolume ? { path: scene.videoPath, volume: scene.sourceVolume, start: scene.trimStartSeconds, end: scene.trimEndSeconds, rate: scene.playbackRate, cuts: scene.documentary?.cuts } : undefined,
        effects: scene.documentary?.effects.filter(effect => effect.enabled && (effect.kind === "audio" || effect.kind === "video" && effect.defaults.sourceAudio)) }));
      const key = createHash("sha256").update(JSON.stringify({ version: 5, tracks, music:timeline.music, duration: timeline.durationInFrames, sfx: timeline.sfxVolume }));
      if(timeline.music?.volume)await fileIdentity(key,timeline.music.clips.filter(clip=>clip.enabled&&clip.status==='ready'&&clip.volume>0).flatMap(clip=>clip.path?[clip.path]:[]));
      await fileIdentity(key, tracks.flatMap(track => [track.voice?.timing?.audioPath, track.source?.path, ...(track.source?.cuts?.map(cut=>cut.videoPath)??[]), ...(track.effects?.map(effect => effect.filePath) ?? [])]).filter((file): file is string => Boolean(file)));
      const name = `audio-${key.digest("hex")}.wav`; used.add(name); return join(root, name);
    },
    async path(timeline: DocumentaryTimeline, first: number, last: number, crf: number, plain=false) {
      const start=timeline.scenes[first]!.fromFrame,end=timeline.scenes[last]!.fromFrame+timeline.scenes[last]!.durationInFrames;
      const dependencyStart = first > 0 && timeline.scenes[first-1]!.transitionFrames > 0 ? first-1 : first;
      // The plain FFmpeg path never paints a poster. Remotion can use it as
      // the blurred backdrop of a narrow video/card, so keep that dependency.
      const scenes = timeline.scenes.slice(dependencyStart,last+1).map(scene=>({...scene,fromFrame:scene.fromFrame-start,imagePath:plain&&scene.videoPath?undefined:scene.imagePath,audioPath:undefined,narrationEnabled:false,narrationVolume:undefined,
        documentary:scene.documentary?{...scene.documentary,timing:undefined,effects:scene.documentary.effects.filter(e=>e.enabled&&e.kind!=="audio")}:undefined}));
      const files = new Set(scenes.flatMap(s=>[s.videoPath,s.imagePath,s.documentary?.motionGraphic?.detail?.imagePath,s.documentary?.comparison?.videoPath,s.documentary?.comparison?.imagePath,...(s.documentary?.cuts?.flatMap(cut=>[cut.videoPath,cut.imagePath])??[]),...(s.documentary?.effects.map(e=>e.filePath)??[])]).filter((p):p is string=>Boolean(p)));
      for(const scene of scenes)for(const panel of scene.documentary?.motionGraphic?.panels??[])if(panel.imagePath)files.add(panel.imagePath);
      for(const scene of scenes)for(const card of scene.documentary?.motionGraphic?.cards??[])if(card.imagePath)files.add(card.imagePath);
      for(const scene of scenes)if(scene.documentary?.motionGraphic?.cutoutPath)files.add(scene.documentary.motionGraphic.cutoutPath);
      for(const scene of scenes)for(const material of Object.values(scene.documentary?.artworkMedia??{}))files.add(material.path);
      const texts=timeline.scenes.flatMap(s=>(s.documentary?.texts??[]).map(text=>({...text,fromFrame:s.fromFrame+text.startSeconds*30}))).filter(text=>text.enabled&&text.fromFrame<end&&text.fromFrame+text.durationSeconds*30>start).map(text=>({...text,fromFrame:text.fromFrame-start}));
      // Moving an unchanged shot later does not change its pixels. Include only
      // intersecting global text; sequence offsets remain explicit dependencies.
      const key=createHash("sha256").update(JSON.stringify({renderer:plain?plainRenderer:renderer,crf,texts,isFinal:last===timeline.scenes.length-1,timeline:{...timeline,music:undefined,durationInFrames:end-start,scenes,sfxVolume:0}}));
      for(const file of [...files].sort()){const info=await stat(file,{bigint:true});key.update(`${file}:${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}`);}
      const name=`${key.digest("hex")}.mp4`;used.add(name);return join(root,name);
    },
    async restore(cachePath:string,output:string){if(!await stat(cachePath).then(s=>s.size>0,()=>false))return false;await copyImmutableDocumentaryFile(cachePath,output);return true;},
    async save(output:string,cachePath:string){await copyImmutableDocumentaryFile(output,cachePath);},
    async prune(){for(const name of await readdir(root))if(/^(?:[a-f0-9]{64}\.mp4|audio-[a-f0-9]{64}\.wav)$/.test(name)&&!used.has(name))await rm(join(root,name));}
  };
}
