import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import {existsSync} from 'node:fs';
import {freemem} from 'node:os';
import { join } from "node:path";
import { bundle } from "@remotion/bundler";
import { openBrowser, renderMedia, selectComposition, makeCancelSignal } from "@remotion/renderer";
import { buildDocumentaryTimeline } from "@gold-work/remotion-video";
import {resolveMusicClips} from '@gold-work/shared';
import type { MontageRenderInput, MontageRenderResult } from "./standard-renderer.js";
import { runFfmpeg } from "./standard-renderer.js";
import { atomicWrite } from "./fs-utils.js";
import { documentaryEditErrors } from "./documentary-validation.js";
import { prepareDocumentaryRenderMedia, prepareDocumentarySubjects, serveDocumentaryRenderMedia } from "./documentary-render-media.js";
import { ensureDocumentarySpace } from "./documentary-storage.js";
import { isPlainDocumentaryShot, renderDocumentaryAudio, renderPlainDocumentaryShot } from "./documentary-fast-render.js";
import { documentaryRenderCache, documentaryExportProject } from "./documentary-render-cache.js";
import {documentaryRenderResources} from './documentary-resources.js';
import {startDocumentaryMetrics,addDocumentaryInterval,finishDocumentaryMetrics} from './documentary-metrics.js';
import {prepareDocumentaryReading} from './documentary-reading.js';
import {probeEffectMedia} from './effect-media.js';
import {documentaryVideoCuts} from './documentary-video-catalog.js';
import {documentaryRepresentationIssue} from './documentary-thematic.js';
import {documentarySavedContextIssue} from './documentary-context-approval.js';
import {documentaryMaterialUsable,documentaryManualReviewReady} from '@gold-work/shared';
import {documentaryStandaloneArtworkReady} from './documentary-source-eligibility.js';
import {documentarySavedQualityIssue} from './documentary-source-quality.js';
import {recordDiagnosticEvent} from './diagnostics.js';
import {assertDocumentaryStreamDuration} from './documentary-render-validation.js';
import {prepareDocumentaryOptionalRenderMedia} from './documentary-optional-render-media.js';
import {prepareDocumentaryArtworkMedia} from './documentary-artwork-materials.js';
import {prepareDocumentaryDiagrams} from './documentary-media-cache.js';
import {remotionBinariesDirectory} from './remotion-binaries.js';
import {projectForDisplay} from './project-display.js';

/** A failed system Chrome launch must not strand an otherwise renderable film. */
export async function openDocumentaryRenderBrowser(executable?:string,signal?:AbortSignal,open:typeof openBrowser=openBrowser) {
  signal?.throwIfAborted();
  // Remotion serializes browser checks: a rejected missing-path check can
  // poison its subsequent launch attempts, so bypass missing executables.
  const usableExecutable=executable&&existsSync(executable)?executable:undefined;
  const primary=usableExecutable?{browserExecutable:usableExecutable,chromeMode:'chrome-for-testing' as const}:{chromeMode:'headless-shell' as const};
  try {return {instance:await open('chrome',primary),options:primary};}
  catch(primaryError){
    signal?.throwIfAborted();
    if(!usableExecutable)throw primaryError;
    recordDiagnosticEvent('warn','documentary.render.browser-fallback',{from:'system-chrome',to:'headless-shell'});
    const fallback={chromeMode:'headless-shell' as const};
    try {return {instance:await open('chrome',fallback),options:fallback};}
    catch(fallbackError){throw new AggregateError([primaryError,fallbackError],'Не удалось запустить основной и резервный браузер для монтажа. Готовые материалы и озвучка сохранены.');}
  }
}

export function documentaryDecoderResources(width:number,height:number,availableBytes:number) {
  const mib=1024*1024;
  const available=Number.isFinite(availableBytes)?Math.max(0,availableBytes):1024*mib;
  const frameBytes=Math.max(1,width)*Math.max(1,height)*4;
  const desired=Math.max(512*mib,frameBytes*48);
  return {cacheBytes:Math.max(64*mib,Math.min(1024*mib,desired,Math.floor(available/2))),
    threads:available<4*1024*mib?1:2};
}

/** Only the compositor's transient frame-cache failure permits one local retry. */
export async function withDocumentaryDecoderRecovery<T>(render:(retry:boolean)=>Promise<T>,signal?:AbortSignal,notice?:()=>void):Promise<T> {
  signal?.throwIfAborted();
  try{return await render(false);}
  catch(error){
    signal?.throwIfAborted();
    if(!(error instanceof Error)||!/No frame found at position/i.test(error.message))throw error;
    notice?.();
    signal?.throwIfAborted();
    return render(true);
  }
}

export async function renderDocumentary(input: MontageRenderInput, options: { projectDirectory: string; entryPoint: string; browserExecutable?: string; renderWorkers?: number; decoderCacheBytes?: number }): Promise<MontageRenderResult> {
  const started=Date.now(),metrics:Record<string,unknown>={};
  // Local render preparation can mutate derived graphic fields. Bind the
  // publication to its original persisted inputs, without candidate histories.
  const publicationProject = input.beforePublish ? structuredClone(projectForDisplay(input.project)) : undefined;
  let project = documentaryExportProject(input.project,options.projectDirectory);
  await startDocumentaryMetrics(project.id,options.projectDirectory,'export');
  const trackedRenderStart=Date.now();
  let workDirectory:string|undefined;
  let closeMedia: (() => Promise<void>) | undefined;
  let renderBrowser: Awaited<ReturnType<typeof openBrowser>> | undefined;
  const cancellation=makeCancelSignal();
  input.signal?.addEventListener('abort',cancellation.cancel,{once:true});
  const ffmpeg=(args:string[])=>runFfmpeg(args,undefined,input.signal);
  try {
  input.signal?.throwIfAborted();
  project={...project,scenes:await prepareDocumentaryDiagrams(options.projectDirectory,project.scenes,input.signal)};
  const editErrors = documentaryEditErrors(project);
  if (editErrors.length) throw new Error(editErrors.join("\n"));
  const included = project.scenes.filter(scene => scene.includeInAssembly !== false);
  if (!included.length) throw new Error("Нет включённых кадров Stock");
  if (included.some(scene => !documentaryStandaloneArtworkReady(scene)&&!documentaryMaterialUsable(scene))) throw new Error("Подтвердите материалы всех кадров Stock");
  for(const scene of included.filter(scene=>!documentaryStandaloneArtworkReady(scene)&&documentaryManualReviewReady(scene))){
    const pending=scene.documentary!.manualReview!;
    const media=await probeEffectMedia(pending.mediaPath,input.signal);
    if(!media.width||!media.height||pending.kind==='video'&&(!media.videoCodec||!media.durationSeconds))
      throw new Error(`Сцена ${scene.order+1}: запасной файл Pexels не читается.`);
  }
  // Simple Stock selection already records the user's accepted suitable result.
  // Export checks edit/media integrity without re-running semantic cascades.
  for (const scene of project.mediaMode==='stock'?[]:included) {
    const issue = documentarySavedContextIssue(project, scene)||documentarySavedQualityIssue(project,scene);
    if (issue) throw new Error(`Сцена ${scene.order + 1}: ${issue}`);
  }
  if (included.some(scene => project.settings.voice.enabled && (!scene.documentary?.timing?.audioPath || !scene.audioPath))) throw new Error("Сначала подготовьте измеренную озвучку Stock");
  for(const scene of project.mediaMode==='stock'?[]:included){
    if(!scene.videoPath||scene.documentary?.pinned||scene.documentary?.cuts?.length||scene.documentary?.visualReview?.illustrationApproval)continue;
    const representationIssue=documentaryRepresentationIssue(scene.narration,scene.documentary?.visualReview);
    if(representationIssue)throw new Error(`Сцена ${scene.order+1}: ${representationIssue}`);
    const start=scene.trimStartSeconds??0,end=scene.trimEndSeconds??start+(scene.documentary!.timing?.durationInFrames??scene.durationSeconds*30)/30;
    if((await documentaryVideoCuts(scene.videoPath,start,end)).length)
      throw new Error(`Сцена ${scene.order+1}: внутри выбранного видео найдена склейка. Продолжите автоподбор для выбора непрерывного участка.`);
  }
  const musicDuration=included.reduce((sum,scene)=>sum+Math.max((scene.documentary?.timing?.durationInFrames??Math.ceil(scene.durationSeconds*30))/30,scene.durationOverrideSeconds??0),0);
  const musicFiles=project.settings.music.enabled!==false&&project.settings.music.volume>0
    ?resolveMusicClips(project.settings.music,musicDuration).filter(clip=>clip.enabled&&clip.status==='ready'&&clip.volume>0).flatMap(clip=>clip.path?[clip.path]:[]):[];
  for(const path of new Set(musicFiles)){
    try{const info=await probeEffectMedia(path,input.signal);if(!info.hasAudio||!info.durationSeconds)throw Error('Нет аудио');}
    catch{input.signal?.throwIfAborted();throw Error('Фоновая музыка недоступна. Выберите существующий аудиофайл или выключите музыку перед сборкой.');}
  }
  await mkdir(options.projectDirectory, { recursive: true });
  await ensureDocumentarySpace(options.projectDirectory);
  const directory = workDirectory = await mkdtemp(join(options.projectDirectory, "documentary-render-"));
    const reading=await prepareDocumentaryReading(project,join(options.projectDirectory,'Documentary','Reading'),message=>input.onProgress?.(message,1),input.signal);
    project={...project,scenes:reading.scenes};
    const sourceTimeline = buildDocumentaryTimeline(project);
    const subjectWarnings=await prepareDocumentaryOptionalRenderMedia(sourceTimeline);
    subjectWarnings.push(...await prepareDocumentarySubjects(sourceTimeline,join(options.projectDirectory,'Documentary','Cutouts'),message=>input.onProgress?.(message,1),input.signal));
    subjectWarnings.push(...await prepareDocumentaryArtworkMedia(sourceTimeline,project,options.projectDirectory,message=>input.onProgress?.(message,1),input.signal));
    subjectWarnings.push(...reading.warnings);
    await atomicWrite(join(options.projectDirectory,'Documentary','subject-preparation.json'),JSON.stringify({at:new Date().toISOString(),warnings:subjectWarnings,
      prepared:sourceTimeline.scenes.filter(s=>s.documentary?.motionGraphic?.cutoutPath).length,
      artworkMedia:sourceTimeline.scenes.flatMap(scene=>scene.documentary?.artworkMedia?[{sceneId:scene.id,materials:scene.documentary.artworkMedia,fingerprint:scene.documentary.artworkMediaFingerprint}]:[])},null,2));
    const timeline = structuredClone(sourceTimeline);
    await atomicWrite(join(options.projectDirectory, "Documentary", "timeline.json"), JSON.stringify(sourceTimeline, null, 2));
    const credits = new Map(included.filter(scene => scene.documentary?.selected).map(scene => {
      const source = scene.documentary!.selected!;
      return [source.pageUrl || source.id, `${source.title}\nAuthor: ${source.author || "see original source"}\nSource: ${source.pageUrl || "local import"}\nLicense: ${source.license}\nLicense URL: ${source.licenseUrl}\nAttribution: ${source.attribution}\nChanges: edited into documentary; may be trimmed, resized, cropped or animated; captions may be added.\n`];
    }));
    const mapCredits=[...new Set(included.flatMap(s=>{const g=s.documentary?.motionGraphic;if(!g?.enabled||!g.kind.startsWith('map-'))return [];
      return [g.detail?.kind==='satellite'?`${g.detail.attribution}. License: CC BY 4.0 https://creativecommons.org/licenses/by/4.0/ . Changes: geographic crop, animated camera and city label. Source/provenance: Documentary/Maps.`:'Maps: Natural Earth (public domain); legacy city data © OpenStreetMap contributors, ODbL 1.0 — https://www.openstreetmap.org/copyright'];}))].join('\n');
    await atomicWrite(join(options.projectDirectory, "Documentary", "credits.txt"), [...credits.values()].join("\n")+mapCredits);
    const fastScenes = timeline.scenes.map((_, index) => isPlainDocumentaryShot(timeline, index));
    const rendered = join(directory, "rendered.mp4");
    const crf = project.settings.assembly.quality === "preview" ? 28 : 20;
    const createRenderer = async () => {
      const resource=await documentaryRenderResources();
      const concurrency=options.renderWorkers===undefined?resource.workers:Math.max(1,Math.min(resource.workers,6,Math.floor(options.renderWorkers)));
      const decoder=documentaryDecoderResources(timeline.width,timeline.height,resource.physicalBytes);
      if(options.decoderCacheBytes!==undefined){decoder.cacheBytes=Math.max(64*1024*1024,Math.min(decoder.cacheBytes,options.decoderCacheBytes));decoder.threads=1;}
      metrics.resources={...resource,workers:concurrency,decoder};
      input.onProgress?.("Монтаж: подготавливаю графику, подписи и движение",12);
      closeMedia = await serveDocumentaryRenderMedia(timeline);
      const serveUrl = await bundle({ entryPoint: options.entryPoint, publicDir: null, outDir: join(directory, "bundle"), enableCaching: true });
      input.signal?.throwIfAborted();
      const opened=await openDocumentaryRenderBrowser(options.browserExecutable,input.signal);
      const browser={...opened.options,binariesDirectory:remotionBinariesDirectory()};
      renderBrowser=opened.instance;
      const composition = await selectComposition({ serveUrl, id: "GoldWorkDocumentaryV2", inputProps: timeline, logLevel: "warn", ...browser, puppeteerInstance: renderBrowser });
      input.signal?.throwIfAborted();
      return { serveUrl, composition, inputProps: timeline, codec: "h264" as const, pixelFormat: "yuv420p" as const, crf,
        outputLocation: rendered, concurrency, muted: true, audioCodec: "aac" as const, logLevel: "warn" as const, ...browser, puppeteerInstance: renderBrowser, cancelSignal:cancellation.cancelSignal,
        offthreadVideoCacheSizeInBytes: decoder.cacheBytes, mediaCacheSizeInBytes: 128 * 1024 * 1024, offthreadVideoThreads: decoder.threads };
    };
    let mixedAudio: string | undefined;
    const cache = await documentaryRenderCache(options.projectDirectory, options.entryPoint);
    {
      const parts: { first: number; last: number; fast: boolean; path: string; cached?: string; ready?: boolean }[] = [];
      for (let i = 0; i < timeline.scenes.length; i++) {
        const previous = parts.at(-1);
        if (!fastScenes[i] && previous && !previous.fast && timeline.scenes[i]!.fromFrame + timeline.scenes[i]!.durationInFrames - timeline.scenes[previous.first]!.fromFrame <= 30 * 15) previous.last = i;
        else parts.push({ first: i, last: i, fast: fastScenes[i]!, path: join(directory, `part-${parts.length}.mp4`) });
      }
      const prepare = new Set<number>();
      for (const part of parts) {
        input.signal?.throwIfAborted();
        part.cached = await cache.path(sourceTimeline, part.first, part.last, crf,part.fast);
        part.ready = await cache.restore(part.cached, part.path);
        if(part.ready){
          const first=sourceTimeline.scenes[part.first]!,last=sourceTimeline.scenes[part.last]!;
          try{await assertDocumentaryStreamDuration(part.path,'video',(last.fromFrame+last.durationInFrames-first.fromFrame)/timeline.fps,input.signal);}
          catch{input.signal?.throwIfAborted();await rm(part.path);part.ready=false;
            recordDiagnosticEvent('warn','documentary.render.invalid-cache',{firstScene:part.first+1,lastScene:part.last+1});}
        }
        if (!part.fast && !part.ready) {
          for (let i = part.first; i <= part.last; i++) prepare.add(i);
          if (part.first > 0 && timeline.scenes[part.first-1]!.transitionFrames > 0) prepare.add(part.first-1);
        }
      }
      // A warm rebuild must not extract the same clips or launch Chromium again.
      metrics.parts={total:parts.length,cached:parts.filter(p=>p.ready).length,plain:parts.filter(p=>p.fast).length};
      const prepareStarted=Date.now();
      const complexTimeline = { ...timeline, scenes: timeline.scenes.filter((_, index) => prepare.has(index)) };
      await prepareDocumentaryRenderMedia(complexTimeline, join(directory, "clips"), (done, total) => input.onProgress?.(`Монтаж: подготовлено фрагментов с графикой ${done}/${total}`, Math.round(done / total * 10)),input.signal);
      const renderOptions = prepare.size ? await createRenderer() : undefined;
      metrics.prepareSeconds=(Date.now()-prepareStarted)/1000;
      const pictureStarted=Date.now();
      let doneFrames = 0, cursor = 0;
      const partTimings:Array<{firstScene:number;lastScene:number;videoSeconds:number;engine:string;cached:boolean;elapsedSeconds:number}>=[];
      const recordPart=(part:typeof parts[number],at:number)=>{
        const first=sourceTimeline.scenes[part.first]!,last=sourceTimeline.scenes[part.last]!;
        partTimings.push({firstScene:part.first+1,lastScene:part.last+1,videoSeconds:(last.fromFrame+last.durationInFrames-first.fromFrame)/30,
          engine:part.fast?'ffmpeg':'remotion',cached:Boolean(part.ready),elapsedSeconds:(Date.now()-at)/1000});
      };
      const progress = (frames: number, stage: string) => input.onProgress?.(stage, 17 + Math.round((doneFrames + frames) / timeline.durationInFrames * 70));
      const plain = parts.filter(p => p.fast);
      const worker = async () => { for (;;) {
        const part = plain[cursor++]; if (!part) return;
        input.signal?.throwIfAborted();
        const partStarted=Date.now();
        const scene = sourceTimeline.scenes[part.first]!;
        progress(0, `Монтаж: сцена ${part.first + 1} из ${timeline.scenes.length} · кадр и движение`);
        if (!part.ready) { await renderPlainDocumentaryShot(sourceTimeline, scene, part.path, crf,input.signal);
          await assertDocumentaryStreamDuration(part.path,'video',scene.durationInFrames/timeline.fps,input.signal);await cache.save(part.path, part.cached!); }
        recordPart(part,partStarted);
        doneFrames += scene.durationInFrames; progress(0, `Монтаж: готово ${Math.round(doneFrames / 30)} из ${Math.round(timeline.durationInFrames / 30)} секунд видеоряда`);
      } };
      const workers = await Promise.allSettled([worker(), worker()]);
      const failed = workers.find(result => result.status === "rejected"); if (failed?.status === "rejected") throw failed.reason;
      for (const part of parts.filter(p => !p.fast)) {
        input.signal?.throwIfAborted();
        const partStarted=Date.now();
        const first = timeline.scenes[part.first]!, last = timeline.scenes[part.last]!;
        const frames = last.fromFrame + last.durationInFrames - first.fromFrame;
        if(part.ready){recordPart(part,partStarted);doneFrames+=frames;progress(0,`Монтаж: сцены ${part.first + 1}–${part.last + 1} из ${timeline.scenes.length} · сохранённый результат`);continue;}
        const raw = `${part.path}.raw.mp4`;
        await withDocumentaryDecoderRecovery(retry=>renderMedia({ ...renderOptions!,
          ...(retry?{concurrency:1,offthreadVideoThreads:1}:{}),
          outputLocation: raw, muted: true, frameRange: [first.fromFrame, first.fromFrame + frames - 1],
          onProgress: ({ progress: fraction }) => progress(frames * fraction, `Монтаж: сцены ${part.first + 1}–${part.last + 1} из ${timeline.scenes.length} · графика и переходы · ${Math.round(fraction * 100)}% фрагмента`) }),input.signal,
          ()=>{recordDiagnosticEvent('warn','documentary.render.decoder-recovery',{firstScene:part.first+1,lastScene:part.last+1});
            progress(0,`Монтаж: повторяю декодирование сцен ${part.first+1}–${part.last+1}; готовые фрагменты сохранены`);});
        await ffmpeg(["-y", "-i", raw, "-an", "-c:v", "copy", "-video_track_timescale", "15360", part.path]);
        await assertDocumentaryStreamDuration(part.path,'video',frames/timeline.fps,input.signal);
        await cache.save(part.path,part.cached!);
        await rm(raw); doneFrames += frames;
        recordPart(part,partStarted);
      }
      const list = join(directory, "parts.txt");
      metrics.pictureSeconds=(Date.now()-pictureStarted)/1000;
      metrics.partTimings=partTimings.sort((a,b)=>a.firstScene-b.firstScene);
      await atomicWrite(list, parts.map(part => `file '${part.path.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"));
      await ffmpeg(["-y", "-f", "concat", "-safe", "0", "-i", list, "-map", "0:v:0", "-c:v", "copy", rendered]);
      await assertDocumentaryStreamDuration(rendered,'video',timeline.durationInFrames/timeline.fps,input.signal);
      input.onProgress?.("Монтаж: свожу диктора, музыку и звуковые акценты", 90);
      const audioStarted=Date.now();
      const audioCache = await cache.audioPath(sourceTimeline);
      const audioOutput = join(directory, "cached-mix.wav");
      if (await cache.restore(audioCache, audioOutput)) {
        try {
          await assertDocumentaryStreamDuration(audioOutput,'audio',sourceTimeline.durationInFrames/sourceTimeline.fps,input.signal);
          mixedAudio = audioOutput;
        } catch {
          input.signal?.throwIfAborted();
          recordDiagnosticEvent('warn','documentary.render.invalid-audio-cache',{});
        }
      }
      if (mixedAudio) input.onProgress?.("Монтаж: звуковая дорожка готова",94);
      else {
        mixedAudio = await renderDocumentaryAudio(sourceTimeline, directory,input.signal);
        if (mixedAudio) await cache.save(mixedAudio, audioCache);
      }
      metrics.audioSeconds=(Date.now()-audioStarted)/1000;
    }
    const checked = join(directory, "Final.mp4");
    // All visual parts are muted. A wholly muted project intentionally has no
    // audio stream even when voice/effects are enabled in its settings.
    const hasAudio = Boolean(mixedAudio);
    input.onProgress?.("Экспорт: сохраняю готовый видеоряд и звук в Final.mp4", 95);
    await ffmpeg(["-y", "-i", rendered, ...(mixedAudio ? ["-i", mixedAudio] : []), "-map", "0:v:0", "-map", mixedAudio ? "1:a:0" : "0:a:0?", "-c:v", "copy", ...(hasAudio ? ["-af", "alimiter=limit=0.95:level=false:latency=true", "-c:a", "aac", "-b:a", "192k"] : ["-c:a", "copy"]), "-t", (timeline.durationInFrames / timeline.fps).toFixed(6), "-movflags", "+faststart", checked]);
    await assertDocumentaryStreamDuration(checked,'video',timeline.durationInFrames/timeline.fps,input.signal);
    if(hasAudio)await assertDocumentaryStreamDuration(checked,'audio',timeline.durationInFrames/timeline.fps,input.signal);
    input.signal?.throwIfAborted();
    input.onProgress?.("Экспорт: завершаю сохранение файла", 99);
    if (publicationProject) await input.beforePublish?.(publicationProject);
    input.signal?.throwIfAborted();
    await rename(checked, input.outputPath);
    addDocumentaryInterval(project.id,'render',trackedRenderStart,Date.now());
    await finishDocumentaryMetrics(project.id,'complete');
    await atomicWrite(join(options.projectDirectory,'Documentary','last-render-metrics.json'),JSON.stringify({...metrics,completedAt:new Date().toISOString(),totalSeconds:(Date.now()-started)/1000,videoSeconds:timeline.durationInFrames/timeline.fps},null,2)).catch(()=>{});
    await cache.prune().catch(() => {}); // Reproducible cache cleanup cannot invalidate a ready Final.
    input.onProgress?.(subjectWarnings.length?`Экспорт: Final.mp4 готов. В ${subjectWarnings.length} сценах сохранён фон исходника; подробности в отчёте.`:"Экспорт: Final.mp4 готов", 100);
    return { outputPath: input.outputPath, warnings:subjectWarnings,requestedPlanner: "local", plannerUsed: "local", visualBeatCount: timeline.scenes.length, templates: ["full-media"],
      stockVideoCount: included.filter(scene => scene.videoPath).length, stockImageCount: included.filter(scene => !scene.videoPath && scene.imagePath).length };
  } catch(error){
    addDocumentaryInterval(project.id,'render',trackedRenderStart,Date.now(),false);
    await finishDocumentaryMetrics(project.id,'failed');throw error;
  } finally {
    input.signal?.removeEventListener('abort',cancellation.cancel);
    await renderBrowser?.close({silent:true}).catch(()=>{});
    await closeMedia?.();
    // mkdtemp result is an explicit child of the project directory; never touches originals.
    if(workDirectory)await rm(workDirectory, { recursive: true, force: true }).catch(() => {});
  }
}
