import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, isAbsolute, join } from "node:path";
import type { DocumentaryTimeline } from "@gold-work/remotion-video";
import { parseMediaByteRange } from "./media-range.js";
import { runFfmpeg } from "./standard-renderer.js";
import {probeEffectMedia} from './effect-media.js';
import {documentarySubjectCutout} from './documentary-subject-cutout.js';

/** Derived masks live with the project and are reused without changing sources. */
export async function prepareDocumentarySubjects(timeline:DocumentaryTimeline,directory:string,notice:(message:string)=>void,signal?:AbortSignal){
  const warnings:string[]=[];
  for(const scene of timeline.scenes){
    const graphic=scene.documentary?.motionGraphic;
    if(!graphic?.enabled||!graphic.isolateSubject||!['subject-card','annotations'].includes(graphic.kind))continue;
    // Always recompute the cache key from the actual source; a saved derivative
    // must never survive an edit that replaces the underlying photograph.
    graphic.cutoutPath=undefined;
    if(!scene.imagePath||scene.videoPath||scene.documentary?.cuts?.length)continue;
    try{const cutout=await documentarySubjectCutout(scene.imagePath,directory,graphic.kind==='subject-card',graphic.annotations?.flatMap(a=>a.points)??[],signal,notice);
      if(graphic.kind==='subject-card'){const size=await probeEffectMedia(cutout,signal);if(Math.min(timeline.width*.43/(size.width??1),timeline.height*.92/(size.height??1))>1.5)throw Error('Вырезанный предмет слишком мал для крупного плана');}
      graphic.cutoutPath=cutout;
    }
    catch(error){signal?.throwIfAborted();const message=`Сцена ${scene.order+1}: фон исходника сохранён. ${error instanceof Error?error.message:String(error)}`;warnings.push(message);notice(message);}
  }
  return warnings;
}

/** Only selected excerpts enter Remotion, never a full long source per scene. */
export async function prepareDocumentaryRenderMedia(timeline: DocumentaryTimeline, directory: string, progress: (done: number, total: number) => void, signal?:AbortSignal) {
  await mkdir(directory, { recursive: true });
  signal?.throwIfAborted();
  const images=new Map<string,Promise<string>>();
  const image=async(file:string)=>{
    if(!/\.(?:jpe?g|png|webp|bmp|tiff?)$/i.test(file))return file;
    let job=images.get(file);
    if(!job){job=(async()=>{
      signal?.throwIfAborted();
      const size=await probeEffectMedia(file,signal);
      const limit=Math.max(timeline.width,timeline.height)*2;
      if(Math.max(size.width??0,size.height??0)<=limit)return file;
      const output=join(directory,`${createHash('sha256').update(file).digest('hex')}.png`);
      await runFfmpeg(['-y','-threads','2','-i',file,'-frames:v','1','-vf',`scale=${limit}:${limit}:force_original_aspect_ratio=decrease`,'-threads','2',output],undefined,signal);
      return output;
    })();images.set(file,job);}
    return job;
  };
  const clips = new Map<string, Promise<{ path: string; duration: number }>>();
  const excerpt = async (file: string, start: number, end: number | undefined, duration: number, rate: number, sourceDuration?: number) => {
    const info = await stat(file, { bigint: true });
    // Match the composition's frame-rounded trim, retaining its playback rate.
    start = Math.max(0, Math.round(start * 30) / 30);
    const stop = Math.min(start + duration * rate, end === undefined ? Infinity : Math.round(end * 30) / 30, sourceDuration ?? Infinity);
    const length = Math.max(1 / 30, stop - start);
    const key = createHash("sha256").update(`${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${start}:${length}`).digest("hex");
    let job = clips.get(key);
    if (!job) {
      job = (async () => {
        const path = join(directory, `${key}.mp4`);
        await runFfmpeg(["-y", "-threads", "2", "-ss", String(start), "-i", file, "-t", String(length), "-map", "0:v:0", "-map", "0:a:0?",
          "-vf", `fps=30,scale=w='min(iw,${timeline.width})':h='min(ih,${timeline.height})':force_original_aspect_ratio=decrease:force_divisible_by=2`,
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-threads", "2", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", path],undefined,signal);
        return { path, duration: length };
      })();
      clips.set(key, job);
    }
    return job;
  };
  let cursor = 0, done = 0;
  const worker = async () => {
    for (;;) {
      const scene = timeline.scenes[cursor++];
      if (!scene) return;
      signal?.throwIfAborted();
      if(scene.imagePath)scene.imagePath=await image(scene.imagePath);
      const graphic=scene.documentary?.motionGraphic;
      if(graphic?.cutoutPath)graphic.cutoutPath=await image(graphic.cutoutPath);
      for(const cut of scene.documentary?.cuts??[])if(cut.imagePath)cut.imagePath=await image(cut.imagePath);
      for(const panel of scene.documentary?.motionGraphic?.panels??[])if(panel.imagePath)panel.imagePath=await image(panel.imagePath);
      for(const card of scene.documentary?.motionGraphic?.cards??[])if(card.imagePath)card.imagePath=await image(card.imagePath);
      if(scene.documentary?.comparison?.imagePath)scene.documentary.comparison.imagePath=await image(scene.documentary.comparison.imagePath);
      const duration = scene.durationInFrames / timeline.fps;
      for (const cut of scene.documentary?.cuts ?? []) if (cut.videoPath) {
        const clip = await excerpt(cut.videoPath, cut.trimStartSeconds, cut.trimEndSeconds, cut.durationInFrames / timeline.fps, cut.playbackRate, cut.sourceDurationSeconds);
        cut.videoPath = clip.path; cut.trimStartSeconds = 0; cut.trimEndSeconds = clip.duration; cut.sourceDurationSeconds = clip.duration;
      }
      if (scene.videoPath && !scene.documentary?.cuts?.length) {
        const clip = await excerpt(scene.videoPath, scene.trimStartSeconds ?? 0, scene.trimEndSeconds, duration, scene.playbackRate ?? 1, scene.documentary?.selected?.durationSeconds);
        scene.videoPath = clip.path; scene.trimStartSeconds = 0; scene.trimEndSeconds = clip.duration;
        if (scene.documentary?.selected) scene.documentary.selected.durationSeconds = clip.duration;
      }
      const comparison = scene.documentary?.comparison;
      if (comparison?.videoPath) {
        const clip = await excerpt(comparison.videoPath, comparison.trimStartSeconds ?? 0, comparison.trimEndSeconds, duration, comparison.playbackRate ?? 1, comparison.durationSeconds);
        comparison.videoPath = clip.path; comparison.trimStartSeconds = 0; comparison.trimEndSeconds = clip.duration; comparison.durationSeconds = clip.duration;
      }
      progress(++done, timeline.scenes.length);
    }
  };
  // Wait for both workers even on failure before the caller removes temporary files.
  const results = await Promise.allSettled([worker(), worker()]);
  const failed = results.find(result => result.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
}

/** Whitelisted loopback media server: bundler must not copy the public directory. */
export async function serveDocumentaryRenderMedia(timeline: DocumentaryTimeline) {
  const files = new Map<string, { path: string; size: number }>();
  const urls = new Map<string, string>(), token = randomUUID();
  for (const scene of timeline.scenes) {
    for (const file of [timeline.music?.path,scene.imagePath, scene.videoPath, scene.documentary?.motionGraphic?.cutoutPath, scene.documentary?.motionGraphic?.detail?.imagePath, scene.documentary?.timing?.audioPath, scene.documentary?.comparison?.imagePath, scene.documentary?.comparison?.videoPath,
      ...(scene.documentary?.cuts?.flatMap(cut=>[cut.imagePath,cut.videoPath])??[]),
      ...(scene.documentary?.motionGraphic?.panels?.map(panel=>panel.imagePath)??[]),
      ...(scene.documentary?.motionGraphic?.cards?.map(card=>card.imagePath)??[]),
      ...(scene.documentary?.effects.filter(effect => effect.enabled).map(effect => effect.filePath) ?? [])]) {
      if (!file || urls.has(file)) continue;
      if (!isAbsolute(file)) throw new Error("Рендер принимает только проверенные локальные файлы");
      const info = await stat(file, { bigint: true });
      if (!info.isFile() || !info.size) throw new Error("Один из файлов монтажа недоступен");
      const id = createHash("sha256").update(`${info.dev}:${info.ino}`).digest("hex") + extname(file);
      const route = `/${token}/${id}`;
      files.set(route, { path: file, size: Number(info.size) }); urls.set(file, route);
    }
  }
  const server = createServer((req, res) => {
    const file = files.get(req.url ?? "");
    if (!file || req.method !== "GET" && req.method !== "HEAD") { res.writeHead(404); res.end(); return; }
    const range = parseMediaByteRange(req.headers.range ?? null, file.size);
    if (range === null) { res.writeHead(416, { "Content-Range": `bytes */${file.size}` }); res.end(); return; }
    const start = range?.start ?? 0, end = range?.end ?? file.size - 1;
    const mime = ({ ".svg":"image/svg+xml", ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" } as Record<string, string>)[extname(file.path).toLowerCase()] ?? "application/octet-stream";
    res.writeHead(range ? 206 : 200, { "Content-Type": mime, "Content-Length": end - start + 1, "Accept-Ranges": "bytes", "Access-Control-Allow-Origin": "*", ...(range ? { "Content-Range": `bytes ${start}-${end}/${file.size}` } : {}) });
    if (req.method === "HEAD") { res.end(); return; }
    const stream = createReadStream(file.path, { start, end, highWaterMark: 64 * 1024 });
    stream.on("error", error => res.destroy(error)); res.on("close", () => stream.destroy()); stream.pipe(res);
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Не удалось открыть локальные материалы рендера");
  const url = (path: string) => `http://127.0.0.1:${address.port}${urls.get(path) ?? "/disabled"}`;
  if(timeline.music)timeline.music.path=url(timeline.music.path);
  for (const scene of timeline.scenes) {
    if (scene.imagePath) scene.imagePath = url(scene.imagePath);
    if (scene.videoPath) scene.videoPath = url(scene.videoPath);
    const doc = scene.documentary;
    if(doc?.motionGraphic?.cutoutPath)doc.motionGraphic.cutoutPath=url(doc.motionGraphic.cutoutPath);
    if(doc?.motionGraphic?.detail)doc.motionGraphic.detail.imagePath=url(doc.motionGraphic.detail.imagePath);
    for (const cut of doc?.cuts ?? []) {
      if(cut.videoPath)cut.videoPath=url(cut.videoPath);
      if(cut.imagePath)cut.imagePath=url(cut.imagePath);
    }
    if (doc?.timing?.audioPath) doc.timing.audioPath = url(doc.timing.audioPath);
    if (doc?.comparison?.imagePath) doc.comparison.imagePath = url(doc.comparison.imagePath);
    if (doc?.comparison?.videoPath) doc.comparison.videoPath = url(doc.comparison.videoPath);
    for(const panel of doc?.motionGraphic?.panels??[])if(panel.imagePath)panel.imagePath=url(panel.imagePath);
    for(const card of doc?.motionGraphic?.cards??[])if(card.imagePath)card.imagePath=url(card.imagePath);
    for (const effect of doc?.effects ?? []) effect.filePath = url(effect.filePath);
  }
  return async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); };
}
