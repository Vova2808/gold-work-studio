import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, rmdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { DocumentaryCandidate } from "@gold-work/shared";
import type { YouTubeStore } from "./youtube-store.js";
import { ensureDocumentarySpace } from "./documentary-storage.js";
import { createAuthenticatedProxyBridge } from "./proxy-utils.js";
import { createYouTubeDnsBridge } from "./documentary-dns.js";
import ffmpegPath from 'ffmpeg-static';
import {effectFfmpeg,probeEffectMedia} from './effect-media.js';
import {withDocumentaryFrameSlot} from './documentary-resources.js';
import {documentaryPreviewRanges,readDocumentaryPreview,saveDocumentaryPreview,type DocumentaryPreview} from './documentary-preview.js';

type Video = { id?: string; snippet?: { title?: string; description?: string; channelTitle?: string; liveBroadcastContent?: string; thumbnails?: Record<string, { url?: string }> }; status?: { license?: string; privacyStatus?: string; uploadStatus?: string }; contentDetails?: { duration?: string; definition?: "hd" | "sd" } };
type Runner = (args: string[], destination: string, signal?: AbortSignal, onProgress?: (bytes: number) => void, partialDirectory?: string, maxBytes?:number) => Promise<void>;
const maximumBytes = 750 * 1024 * 1024;
const maximumSectionBytes = 160 * 1024 * 1024;
const maximumDownloadMs = 15 * 60_000;

export class DocumentaryYouTubeDefinitionError extends Error {}
export class DocumentaryYouTubeFormatUnavailableError extends Error {}

function requireHighDefinition(videos: Video[], id: string, required: boolean): void {
  if (required && videos.find(video => video.id === id)?.contentDetails?.definition === "sd")
    throw new DocumentaryYouTubeDefinitionError("YouTube помечает видео как SD. Для полноэкранного кадра нужен HD-исходник.");
}

async function downloadManifest(directory: string, name: string): Promise<string> {
  const lines = (await readFile(join(directory, name), "utf8")).trim().split(/\r?\n/);
  const file: unknown = JSON.parse(lines.at(-1)!);
  if (typeof file !== "string" || resolve(dirname(file)) !== resolve(directory) || !file.endsWith(".mp4")) {
    throw new Error("YouTube: неверный путь загруженного оригинала");
  }
  return file;
}

/** The active format is recorded before downloading; old formats must neither
 * be appended to a new stream nor count as progress for the current transfer. */
export async function documentaryDownloadBytes(destination: string, partialDirectory?: string): Promise<number> {
  const active = partialDirectory ? await downloadManifest(partialDirectory, "active.json").catch(() => undefined) : destination;
  if (!active) return 0;
  const complete = await stat(active).then(info => info.size, () => 0);
  if (complete) return complete;
  const part = `${basename(active)}.part`;
  const files = await readdir(dirname(active)).catch(() => [] as string[]);
  const sizes = await Promise.all(files.filter(name => name === part
    || name.startsWith(`${part}-Frag`) && /^\d+(?:\.part)?$/.test(name.slice(part.length + 5)))
    .map(name => stat(join(dirname(active), name)).then(info => info.size, () => 0)));
  return sizes.reduce((sum, bytes) => sum + bytes, 0);
}

/** A slow, growing original should not be discarded by the connection-start deadline. */
export class DocumentaryDownloadWatchdog {
  private bytes = 0;
  private lastProgress: number;
  constructor(private readonly startedAt = Date.now(),private readonly maxBytes=maximumBytes) { this.lastProgress = startedAt; }
  observe(bytes: number, now = Date.now()): string | undefined {
    if (bytes > this.maxBytes) return `Видео превышает ${Math.round(this.maxBytes/1024/1024)} МБ`;
    if (now - this.startedAt >= maximumDownloadMs) return "Загрузка YouTube превысила 15 минут; проверьте соединение";
    if (bytes > this.bytes) { this.bytes = bytes; this.lastProgress = now; }
    if (!this.bytes && now - this.startedAt >= 180_000) return "YouTube не начал передачу видео за 3 минуты; проверьте соединение или вход";
    if (this.bytes && now - this.lastProgress >= 90_000) return "Загрузка YouTube остановилась: новые данные не поступают 90 секунд";
  }
}
const validId = (id: unknown): id is string => typeof id === "string" && /^[a-zA-Z0-9_-]{11}$/.test(id);
const seconds = (value = "") => {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(value);
  return match ? Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0) : 0;
};

export function youtubeDocumentaryCandidates(videos: Video[], query: string): DocumentaryCandidate[] {
  return videos.flatMap(video => {
    const duration = seconds(video.contentDetails?.duration);
    if (!validId(video.id) || video.status?.license !== "creativeCommon" || video.status.privacyStatus !== "public"
      || video.snippet?.liveBroadcastContent && video.snippet.liveBroadcastContent !== "none" || duration < 1.5 || duration > 1800) return [];
    const pageUrl = `https://www.youtube.com/watch?v=${video.id}`;
    const author = video.snippet?.channelTitle ?? "";
    return [{ id: `youtube:${video.id}`, provider: "youtube", kind: "video", title: video.snippet?.title || video.id,
      description: video.snippet?.description || "", author, pageUrl, downloadUrl: pageUrl,
      previewUrl: video.snippet?.thumbnails?.high?.url, durationSeconds: duration, videoDefinition: video.contentDetails?.definition,
      // The API identifies CC BY but does not expose the individual license version.
      license: "Creative Commons Attribution (YouTube)", licenseUrl: "https://support.google.com/youtube/answer/2797468", rights: "licensed",
      attribution: `${video.snippet?.title || video.id} · ${author} · ${pageUrl} · Creative Commons Attribution`, query, retrievedAt: new Date().toISOString(),
      match: "unverified", concerns: ["Лицензия проверена через YouTube; объект, выбранный диапазон и качество требуют проверки реальных кадров"] }];
  });
}

/** Negative search terms prevent a limited result page being filled by games
 * and miniatures. They are discovery hints, never approval of actual pixels. */
export function documentaryYouTubeCameraQuery(query:string):string {
  if(/\b(?:gameplay|gaming|simulator|diecast|scale model)\b/iu.test(query))return query;
  const suffix=' -gameplay -gaming -simulator -diecast -"scale model"';
  return query.length+suffix.length<=240?query+suffix:query;
}

export type DocumentaryYouTubeNetworkStore = Partial<Pick<YouTubeStore, 'proxyUrl' | 'downloadRoute'>>;

/** The selected download route also applies to public YouTube discovery. */
export async function documentaryYouTubePublicProxy(store?:DocumentaryYouTubeNetworkStore):Promise<string|undefined> {
  const route=await store?.downloadRoute?.();
  if(route && route!=='proxy')return undefined;
  const proxy=await store?.proxyUrl?.();
  if(route==='proxy'&&!proxy)throw Error('Для выбранного маршрута YouTube сохраните прокси');
  return proxy;
}

/** Fixed official hosts may resolve at the selected proxy. Arbitrary public
 * source URLs still require publicMediaUrl's local DNS/private-address check. */
export function officialYouTubePublicUrl(value:string):URL|undefined {
  try {
    const url=new URL(value),host=url.hostname;
    if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443'))return undefined;
    if(host==='youtube.com'||host.endsWith('.youtube.com')||host==='ytimg.com'||host.endsWith('.ytimg.com')
      ||host==='yt3.ggpht.com'||host==='yt3.googleusercontent.com'||host==='jnn-pa.googleapis.com'
      ||host==='fonts.gstatic.com'||host==='www.gstatic.com')return url;
  }catch{}
  return undefined;
}

export class DocumentaryYouTube {
  private downloadBlockedUntil = 0;
  private publicBlockedUntil = 0;
  downloadAvailable() { return Date.now() >= this.downloadBlockedUntil; }
  publicAvailable() { return Date.now() >= this.publicBlockedUntil; }
  constructor(private readonly store: Pick<YouTubeStore, "apiKey" | "resolveValidatedCookies"> & Partial<Pick<YouTubeStore, "proxyUrl" | "downloadRoute">>, private readonly fetcher: typeof fetch = globalThis.fetch, private readonly runner: Runner = downloadWithYtDlp,
    private readonly publicMetadata:typeof readPublicYouTubeMetadata=readPublicYouTubeMetadata) {}

  async publicCandidate(url:string,query:string,signal?:AbortSignal):Promise<DocumentaryCandidate[]> {
    if(Date.now()<this.publicBlockedUntil)throw Error('Публичный YouTube недоступен: действует пауза после ограничения сайта.');
    const parsed=new URL(url),id=parsed.searchParams.get('v');
    if(parsed.hostname!=='www.youtube.com'||parsed.pathname!=='/watch'||!validId(id))throw Error('Некорректная публичная ссылка YouTube');
    const proxy=await documentaryYouTubePublicProxy(this.store);
    const cookies=await this.store.resolveValidatedCookies();
    const info=await this.publicMetadata(`https://www.youtube.com/watch?v=${id}`,signal,proxy,cookies).catch(error=>{
      if(/not a bot|captcha|\b429\b|\b403\b|security challenge/i.test(String(error)))this.publicBlockedUntil=Date.now()+5*60000;
      throw error;
    });
    if(info.id!==id||info.is_live||info.live_status==='is_live'||!Number.isFinite(info.duration)||info.duration<1.5||info.duration>1800)return [];
    const cc=/^Creative Commons(?: Attribution)?(?: license)?(?: \(reuse allowed\))?$/i.test(info.license??'');
    const pageUrl=`https://www.youtube.com/watch?v=${id}`,author=info.channel||info.uploader||'';
    return [{id:`youtube:${id}`,provider:'youtube',kind:'video',title:info.title||id,description:info.description||'',author,pageUrl,downloadUrl:pageUrl,
      durationSeconds:info.duration,previewUrl:info.thumbnail,videoDefinition:info.height?info.height>=720?'hd':'sd':undefined,
      license:cc?'Creative Commons Attribution (YouTube)':info.license||'Условия не подтверждены',licenseUrl:cc?'https://support.google.com/youtube/answer/2797468':'',rights:cc?'licensed':'unknown',
      attribution:[info.title||id,author,pageUrl,info.license].filter(Boolean).join(' · '),query,retrievedAt:new Date().toISOString(),discovery:'public-web',match:'unverified',
      concerns:['Метаданные публичной страницы через yt-dlp; объект, дата, выбранный диапазон и качество требуют проверки оригинала']}];
  }

  private async validateSource(candidate:DocumentaryCandidate,signal?:AbortSignal,requireHd=false):Promise<void>{
    const id=candidate.id.replace(/^youtube:/,'');
    if(candidate.discovery==='public-web'){
      const found=await this.publicCandidate(candidate.pageUrl,candidate.query,signal);
      const current=found.find(item=>item.id===candidate.id);
      if(!current)throw Error('Публичное видео YouTube больше недоступно');
      if(candidate.rights==='licensed'&&current.rights!=='licensed')throw Error('YouTube больше не подтверждает указанную Creative Commons лицензию');
      if(requireHd&&current.videoDefinition==='sd')throw new DocumentaryYouTubeDefinitionError('Публичное видео YouTube помечено как SD; нужен HD-исходник.');
    }else{
      const videos=await this.api('videos',{part:'snippet,status,contentDetails',id},signal);
      if(!youtubeDocumentaryCandidates(videos,candidate.query).some(video=>video.id===candidate.id))throw Error('YouTube больше не подтверждает публичное видео с лицензией Creative Commons; загрузка отменена');
      requireHighDefinition(videos,id,requireHd);
    }
  }

  private async api(resource: string, params: Record<string, string>, signal?: AbortSignal): Promise<Video[]> {
    signal?.throwIfAborted();
    const key = await this.store.apiKey();
    if (!key) throw new Error("Для поиска видео YouTube добавьте ключ в существующих настройках YouTube");
    const url = new URL(`https://www.googleapis.com/youtube/v3/${resource}`);
    for (const [name, value] of Object.entries({ ...params, key })) url.searchParams.set(name, value);
    const response = await this.fetcher(url, { signal: AbortSignal.any([AbortSignal.timeout(18000), ...(signal ? [signal] : [])]) });
    const body = await response.json() as { items?: Video[]; error?: { message?: string } };
    if (!response.ok) throw new Error(`YouTube ${response.status}: ${(body.error?.message || "Источник недоступен").replaceAll(key, "[скрыто]").slice(0, 400)}`);
    return body.items ?? [];
  }

  async search(query: string): Promise<DocumentaryCandidate[]> {
    if (query.trim().length < 2 || query.length > 240) throw new Error("Некорректный запрос YouTube");
    // One search request retrieves a broader pool; local filtering then
    // removes games/irrelevant titles before any download or paid inspection.
    const hits = await this.api("search", { part: "id", type: "video", q: query, videoLicense: "creativeCommon", maxResults: "24" }) as unknown as { id?: { videoId?: string } }[];
    const ids = hits.map(item => item.id?.videoId).filter(validId);
    return ids.length ? youtubeDocumentaryCandidates(await this.api("videos", { part: "snippet,status,contentDetails", id: ids.join(",") }), query) : [];
  }

  async download(candidate: DocumentaryCandidate, destination: string, signal?: AbortSignal, onProgress?: (bytes: number) => void, requireHd = false,
    range?:{start:number;end:number}): Promise<void> {
    signal?.throwIfAborted();
    const id = candidate.id.replace(/^youtube:/, "");
    if (candidate.provider !== "youtube" || !validId(id) || candidate.pageUrl !== `https://www.youtube.com/watch?v=${id}`) throw new Error("Некорректный источник YouTube");
    if (Date.now() < this.downloadBlockedUntil) throw new Error("Загрузка YouTube временно недоступна в этой сети. Сохранённые оригиналы можно использовать; следующая проверка соединения — через несколько минут.");
    await this.validateSource(candidate,signal,requireHd);
    if(range&&(!Number.isFinite(range.start)||!Number.isFinite(range.end)||range.start<0||range.end<=range.start
      ||range.end>(candidate.durationSeconds??0)+.1))throw Error('Некорректный диапазон YouTube-видео');
    // A checked 10–18 second section cannot justify reserving space for the
    // entire 750 MB original; retain the global 512 MB safety reserve.
    await ensureDocumentarySpace(dirname(destination), range ? maximumSectionBytes : maximumBytes);
    // Preserve the user's explicitly supplied downloader cookie file. The
    // isolated search browser never reads a Chrome profile or this file.
    const cookies = await this.store.resolveValidatedCookies();
    const proxyUrl = await this.store.proxyUrl?.();
    const route = await this.store.downloadRoute?.() ?? (proxyUrl ? "proxy" : "system");
    if (route === "proxy" && !proxyUrl) throw new Error("Для выбранного маршрута YouTube сохраните прокси");
    const partialDirectory = `${resolve(destination)}.resume`;
    await mkdir(partialDirectory, { recursive: true });
    // Only these per-attempt receipts are reset. Media and yt-dlp fragment
    // checkpoints survive Stop, errors and application restarts.
    for (const name of ["active.json", "complete.json"]) await rm(join(partialDirectory, name), { force: true });
    const bridge = route === "public-dns" ? await createYouTubeDnsBridge() : route === "proxy" ? await createAuthenticatedProxyBridge(proxyUrl!, { host: "www.youtube.com", port: 443 }) : undefined;
    try { await this.runner(["--ignore-config", "--no-playlist", "--part", "--continue", "--no-mtime", "--no-progress", "--socket-timeout", "15", "--retries", "1", "--fragment-retries", "1", "--extractor-retries", "1",
      "--concurrent-fragments", "4", "--js-runtimes", "node", "--max-filesize", String(maximumBytes), "-f", documentaryYouTubeFormatSelector(requireHd,Boolean(range)),
      ...(range?["--ffmpeg-location",ffmpegPath!.replace('app.asar','app.asar.unpacked'),"--force-keyframes-at-cuts","--download-sections",`*${range.start}-${range.end}`]:[]),
      "--restrict-filenames", "--no-simulate", "--print-to-file", "before_dl:%(filename)j", join(partialDirectory, "active.json"),
      "--print-to-file", "after_move:%(filepath)j", join(partialDirectory, "complete.json"),
      ...(bridge ? ["--proxy", bridge.proxyUrl] : []), ...(cookies ? ["--cookies", cookies] : []),
      "-o", join(partialDirectory, "%(format_id)s.%(ext)s"), "--", candidate.pageUrl], destination, signal, onProgress, partialDirectory,range?maximumSectionBytes:undefined); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/getaddrinfo|failed to resolve|name resolution|connection.{0,30}(?:timed out|refused)|sign in to confirm|\b(?:403|429)\b/i.test(message)) this.downloadBlockedUntil = Date.now() + 5 * 60000;
      if (!signal?.aborted && /Requested format is not available/i.test(message)) {
        throw new DocumentaryYouTubeFormatUnavailableError(requireHd
          ? 'YouTube: нет доступного формата для горизонтального кадра до 1080p. Источник может быть вертикальным или ограничивать загрузку; нужен другой материал.'
          : 'YouTube: нет доступного видео подходящего формата. Нужен другой материал или ручная загрузка доступного оригинала.');
      }
      throw error;
    } finally { await bridge?.close(); }
    const completed = await downloadManifest(partialDirectory, "complete.json");
    const info = await stat(completed);
    if (!info.isFile() || !info.size || info.size > maximumBytes) throw new Error("YouTube: оригинал пуст или превышает 750 МБ");
    await rename(completed, destination);
    for (const name of ["active.json", "complete.json"]) await rm(join(partialDirectory, name), { force: true });
    await rmdir(partialDirectory).catch(() => {}); // Other format fragments, if any, remain resumable.
  }

  /** Low-resolution samples are kept outside the original/resume paths.
   * A successful preview is NOT a selected source or a semantic approval. */
  async preview(candidate:DocumentaryCandidate,directory:string,signal?:AbortSignal,requireHd=false):Promise<DocumentaryPreview> {
    signal?.throwIfAborted();
    const id=candidate.id.replace(/^youtube:/,'');
    if(candidate.provider!=='youtube'||!validId(id)||candidate.pageUrl!==`https://www.youtube.com/watch?v=${id}`)throw Error('Некорректный источник YouTube');
    const duration=candidate.durationSeconds??0;
    // Long HLS originals and three distant seeks both exhausted the live
    // preview budget. Inspect one bounded middle window in one remote seek.
    // Three local samples still need a scene vote and a separate final HD vote.
    const window=duration>300?{start:Math.round(duration*.48*1000)/1000,end:Math.round((duration*.48+12)*1000)/1000}:undefined;
    const ranges=window?[0,4,8].map(offset=>({start:window.start+offset,end:window.start+offset+4})):documentaryPreviewRanges(duration);
    if(!ranges.length)throw Error('Для пробной загрузки нужна длительность источника');
    const cached=await readDocumentaryPreview(directory);
    if(cached&&(!requireHd||candidate.videoDefinition==='hd'))return cached;
    await this.validateSource(candidate,signal,requireHd);
    if(cached)return cached;
    await mkdir(directory,{recursive:true});
    await ensureDocumentarySpace(directory,32*1024*1024);
    const cookies=await this.store.resolveValidatedCookies(),proxyUrl=await this.store.proxyUrl?.();
    const route=await this.store.downloadRoute?.()??(proxyUrl?'proxy':'system');
    if(route==='proxy'&&!proxyUrl)throw Error('Для выбранного маршрута YouTube сохраните прокси');
    const bridge=route==='public-dns'?await createYouTubeDnsBridge():route==='proxy'?await createAuthenticatedProxyBridge(proxyUrl!,{host:'www.youtube.com',port:443}):undefined;
    try {
      // Three remote seeks each reopen the stream and run FFmpeg. Download one
      // small original or one bounded window, then cut all samples locally.
      // This file remains a preview only; production still downloads HD and
      // checks actual frames, identity, action and quality in the final range.
      {
        const original=join(directory,window?'preview-window-mid.mp4':'preview-original.mp4'),limit=32*1024*1024;
        const valid=await stat(original).then(info=>info.size>0&&info.size<=limit,()=>false)
          &&await probeEffectMedia(original,signal).then(media=>Boolean(media.videoCodec&&media.durationSeconds>=(window?12:duration)-1),()=>false);
        if(!valid){
          for(const name of ['active.json','complete.json'])await rm(join(directory,name),{force:true});
          await this.runner(['--ignore-config','--no-playlist','--no-progress','--part','--continue','--socket-timeout','10','--retries','0','--fragment-retries','0','--extractor-retries','0',
            '--js-runtimes','node','--max-filesize',String(limit),'-f','best[protocol=https][ext=mp4][height<=360]/bestvideo[protocol=https][ext=mp4][height<=360]/best[ext=mp4][height<=360]/bestvideo[ext=mp4][height<=360]',
            ...(window?['--ffmpeg-location',ffmpegPath!.replace('app.asar','app.asar.unpacked'),'--force-keyframes-at-cuts','--download-sections',`*${window.start}-${window.end}`]:[]),
            '--restrict-filenames','--no-simulate','--print-to-file','before_dl:%(filename)j',join(directory,'active.json'),
            '--print-to-file','after_move:%(filepath)j',join(directory,'complete.json'),
            ...(bridge?['--proxy',bridge.proxyUrl]:[]),...(cookies?['--cookies',cookies]:[]),
            '-o',original,'--',candidate.pageUrl],original,signal,undefined,directory,limit);
          if(await downloadManifest(directory,'complete.json')!==resolve(original))throw Error('Неверный путь пробного оригинала');
        }
        const originalInfo=await stat(original);
        if(!originalInfo.isFile()||!originalInfo.size||originalInfo.size>limit)throw Error('Пробное видео пусто или превышает 32 МБ');
        const segments=[];
        for(const [index,range] of ranges.entries()){
          const path=join(directory,`sample-local-${index}.mp4`);
          await withDocumentaryFrameSlot(()=>effectFfmpeg(['-y','-ss',String(range.start-(window?.start??0)),'-i',original,'-t',String(range.end-range.start),'-map','0:v:0','-an',
            '-c:v','libx264','-preset','ultrafast','-crf','28','-movflags','+faststart',path],signal));
          segments.push({...range,path});
        }
        return await saveDocumentaryPreview(directory,segments,signal,(await stat(original)).size);
      }
    } finally {await bridge?.close();}
  }
}

/** YouTube's HD flag includes portrait 480×854. A normal full-frame video
 * cannot use that narrow original; reject its formats before transferring it. */
export function documentaryYouTubeFormatSelector(requireHd:boolean,shortRange=false):string{
  const minimumWidth=requireHd?'[width>=640]':'';
  const hdRange=requireHd&&shortRange?'bestvideo[ext=mp4][height=720][width>=1280]/best[ext=mp4][height=720][width>=1280]/':'';
  return `${hdRange}bestvideo[ext=mp4][height<=1080]${minimumWidth}/best[ext=mp4][height<=1080]${minimumWidth}`;
}

/** The YouTube API can label a vertical Short as HD even when every MP4
 * version below 1080 pixels high is too narrow for a horizontal full-frame
 * documentary shot. This is only an automatic discovery hint: the manual
 * picker can still offer the source, and unlabelled videos keep their normal
 * actual-format check. */
export function documentaryLikelyPortraitShort(candidate:DocumentaryCandidate):boolean{
  return candidate.provider==='youtube'&&candidate.kind==='video'&&!candidate.localPath
    &&/(?:^|\s)#shorts?\b/iu.test(candidate.title);
}

type PublicYouTubeMetadata={id:string;title?:string;description?:string;channel?:string;uploader?:string;license?:string;thumbnail?:string;duration:number;height?:number;is_live?:boolean;live_status?:string};

/** yt-dlp writes its cookie jar on exit, including --skip-download. Never give
 * it the user's imported file; discard updates to this per-request copy. */
export async function withDocumentaryYouTubeCookies<T>(source:string|undefined,work:(copy?:string)=>Promise<T>):Promise<T> {
  if(!source)return work();
  let directory:string;
  try{directory=await mkdtemp(join(tmpdir(),'goldwork-youtube-metadata-'));}
  catch{throw Error('Не удалось создать временную копию cookies YouTube');}
  const copy=join(directory,'cookies.txt');
  try{
    try{await copyFile(source,copy);}catch{throw Error('Не удалось прочитать сохранённые cookies YouTube');}
    return await work(copy);
  }finally{
    try{await rm(copy,{force:true});await rmdir(directory);}
    catch{throw Error('Не удалось удалить временную копию cookies YouTube');}
  }
}

export async function readPublicYouTubeMetadata(url:string,signal?:AbortSignal,proxyUrl?:string,cookiesFilePath?:string):Promise<PublicYouTubeMetadata>{
  if(!/^https:\/\/www\.youtube\.com\/watch\?v=[a-zA-Z0-9_-]{11}$/.test(url))throw Error('Некорректная публичная ссылка YouTube');
  signal?.throwIfAborted();
  return withDocumentaryYouTubeCookies(cookiesFilePath,async cookies=>{
  signal?.throwIfAborted();
  const bridge=proxyUrl?await createAuthenticatedProxyBridge(proxyUrl,{host:'www.youtube.com',port:443}):undefined;
  try {
  for(const command of youtubeCommands()){
    signal?.throwIfAborted();
    try{return await new Promise<PublicYouTubeMetadata>((done,reject)=>{
      const child=spawn(command.executable,[...command.prefix,'--ignore-config','--no-playlist','--skip-download','--dump-single-json','--no-warnings','--socket-timeout','10','--retries','0','--extractor-retries','0','--js-runtimes','node',...(bridge?['--proxy',bridge.proxyUrl]:[]),...(cookies?['--cookies',cookies]:[]),'--',url],{windowsHide:true,stdio:['ignore','pipe','pipe']});
      let output='',failure='',finished=false;
      let stopFinished=Promise.resolve();
      const stop=()=>{if(process.platform==='win32'&&child.pid){stopFinished=new Promise<void>(resolve=>{
        const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
        killer.once('error',()=>{child.kill();resolve();});killer.once('close',()=>resolve());
      });}else child.kill();};const timer=setTimeout(stop,25000);signal?.addEventListener('abort',stop,{once:true});
      const clear=()=>{clearTimeout(timer);signal?.removeEventListener('abort',stop);};
      child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
      child.stdout.on('data',(part:string)=>{output+=part;if(output.length>8*1024*1024)stop();});
      child.stderr.on('data',(part:string)=>{failure=(failure+part).slice(-1400);});
      child.once('error',error=>{finished=true;clear();reject(error);});
      child.once('close',async code=>{if(finished)return;clear();await stopFinished;if(signal?.aborted){reject(signal.reason);return;}
        if(code!==0){
          let detail=failure.replace(/https?:\/\/\S+/g,'[страница]');
          if(cookies)detail=detail.replaceAll(cookies,'[cookies]').replaceAll(cookies.replaceAll('\\','\\\\'),'[cookies]');
          reject(Error('Публичная страница YouTube недоступна: '+(detail.slice(0,700)||'таймаут yt-dlp')));return;
        }
        try{const info=JSON.parse(output);done(info);}catch{reject(Error('YouTube: неверные метаданные публичной страницы'));}
      });
    });}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  }
  throw Error('Для чтения публичной страницы YouTube нужен установленный yt-dlp');
  }finally{await bridge?.close();}
  });
}

function youtubeCommands(){
  const bundled = join(process.resourcesPath || "", "bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
  return [
    ...(process.env.YT_DLP_PATH ? [{ executable: process.env.YT_DLP_PATH, prefix: [] as string[] }] : []),
    ...(existsSync(bundled) ? [{ executable: bundled, prefix: [] as string[] }] : []),
    { executable: "yt-dlp", prefix: [] as string[] }, { executable: "python", prefix: ["-m", "yt_dlp"] }
  ];
}
export async function downloadWithYtDlp(args: string[], destination: string, signal?: AbortSignal, onProgress?: (bytes: number) => void, partialDirectory?: string,maxBytes=maximumBytes): Promise<void> {
  for (const command of youtubeCommands()) {
    signal?.throwIfAborted();
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(command.executable, [...command.prefix, ...args], { cwd: dirname(destination), windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
        let failure = "", stopped = false;
        let stopFinished = Promise.resolve();
        const stop = (message: string) => {
          if (stopped) return;
          stopped = true; failure = message;
          // The bundled Windows executable has a launcher and a downloader
          // child. Killing only the launcher leaves a writer on the checkpoint.
          if (process.platform === "win32" && child.pid) {
            stopFinished = new Promise<void>(done => {
              const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
              killer.once("error", () => { child.kill(); done(); });
              killer.once("close", () => done());
            });
          } else child.kill();
        };
        const abort = () => stop("Загрузка остановлена пользователем");
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
        const watchdog = new DocumentaryDownloadWatchdog(Date.now(),maxBytes);
        let lastReportedAt = 0;
        const timeout = setTimeout(() => stop("Загрузка YouTube превысила 15 минут; проверьте соединение"), maximumDownloadMs);
        const budget = setInterval(() => {
          void documentaryDownloadBytes(destination, partialDirectory).then(bytes => {
            const reason = watchdog.observe(bytes);
            if (reason) stop(reason);
            else if (!stopped && bytes > 0 && Date.now() - lastReportedAt >= 2000) {
              lastReportedAt = Date.now(); onProgress?.(bytes);
            }
          });
        }, 500);
        const clear = () => { clearTimeout(timeout); clearInterval(budget); signal?.removeEventListener("abort", abort); };
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk: string) => { if (!stopped) failure = `${failure}${chunk}`.replace(/https?:\/\/\S+/g, "[адрес источника]").slice(-1400); });
        child.once("error", error => { clear(); reject(error); });
        child.once("exit", code => {
          clear();
          void stopFinished.then(() => code === 0 && !stopped ? resolve() : reject(signal?.aborted ? signal.reason : new Error(failure || "Не удалось загрузить оригинал YouTube")));
        });
      });
      return;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  throw new Error("Для загрузки YouTube нужен установленный yt-dlp");
}
