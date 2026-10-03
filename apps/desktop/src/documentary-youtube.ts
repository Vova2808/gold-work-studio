import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, rmdir, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { DocumentaryCandidate } from "@gold-work/shared";
import type { YouTubeStore } from "./youtube-store.js";
import { ensureDocumentarySpace } from "./documentary-storage.js";
import { createAuthenticatedProxyBridge } from "./proxy-utils.js";
import { createYouTubeDnsBridge } from "./documentary-dns.js";
import ffmpegPath from 'ffmpeg-static';
import {documentaryPreviewRanges,readDocumentaryPreview,saveDocumentaryPreview,type DocumentaryPreview} from './documentary-preview.js';

type Video = { id?: string; snippet?: { title?: string; description?: string; channelTitle?: string; liveBroadcastContent?: string; thumbnails?: Record<string, { url?: string }> }; status?: { license?: string; privacyStatus?: string; uploadStatus?: string }; contentDetails?: { duration?: string; definition?: "hd" | "sd" } };
type Runner = (args: string[], destination: string, signal?: AbortSignal, onProgress?: (bytes: number) => void, partialDirectory?: string) => Promise<void>;
const maximumBytes = 750 * 1024 * 1024;
const maximumDownloadMs = 15 * 60_000;

export class DocumentaryYouTubeDefinitionError extends Error {}

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
  constructor(private readonly startedAt = Date.now()) { this.lastProgress = startedAt; }
  observe(bytes: number, now = Date.now()): string | undefined {
    if (bytes > maximumBytes) return "Видео превышает 750 МБ";
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

export class DocumentaryYouTube {
  private downloadBlockedUntil = 0;
  downloadAvailable() { return Date.now() >= this.downloadBlockedUntil; }
  constructor(private readonly store: Pick<YouTubeStore, "apiKey" | "resolveValidatedCookies"> & Partial<Pick<YouTubeStore, "proxyUrl" | "downloadRoute">>, private readonly fetcher: typeof fetch = globalThis.fetch, private readonly runner: Runner = downloadWithYtDlp) {}

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
    const hits = await this.api("search", { part: "id", type: "video", q: query, videoLicense: "creativeCommon", maxResults: "12" }) as unknown as { id?: { videoId?: string } }[];
    const ids = hits.map(item => item.id?.videoId).filter(validId);
    return ids.length ? youtubeDocumentaryCandidates(await this.api("videos", { part: "snippet,status,contentDetails", id: ids.join(",") }), query) : [];
  }

  async download(candidate: DocumentaryCandidate, destination: string, signal?: AbortSignal, onProgress?: (bytes: number) => void, requireHd = false): Promise<void> {
    signal?.throwIfAborted();
    const id = candidate.id.replace(/^youtube:/, "");
    if (candidate.provider !== "youtube" || !validId(id) || candidate.pageUrl !== `https://www.youtube.com/watch?v=${id}`) throw new Error("Некорректный источник YouTube");
    if (Date.now() < this.downloadBlockedUntil) throw new Error("Загрузка YouTube временно недоступна в этой сети. Сохранённые оригиналы можно использовать; следующая проверка соединения — через несколько минут.");
    const videos = await this.api("videos", { part: "snippet,status,contentDetails", id }, signal);
    if (!youtubeDocumentaryCandidates(videos, candidate.query).some(video => video.id === candidate.id)) throw new Error("YouTube больше не подтверждает публичное видео с лицензией Creative Commons; загрузка отменена");
    requireHighDefinition(videos, id, requireHd);
    await ensureDocumentarySpace(dirname(destination), maximumBytes);
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
      "--concurrent-fragments", "4", "--js-runtimes", "node", "--max-filesize", String(maximumBytes), "-f", "bestvideo[ext=mp4][height<=1080]/best[ext=mp4][height<=1080]",
      "--restrict-filenames", "--no-simulate", "--print-to-file", "before_dl:%(filename)j", join(partialDirectory, "active.json"),
      "--print-to-file", "after_move:%(filepath)j", join(partialDirectory, "complete.json"),
      ...(bridge ? ["--proxy", bridge.proxyUrl] : []), ...(cookies ? ["--cookies", cookies] : []),
      "-o", join(partialDirectory, "%(format_id)s.%(ext)s"), "--", candidate.pageUrl], destination, signal, onProgress, partialDirectory); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/getaddrinfo|failed to resolve|name resolution|connection.{0,30}(?:timed out|refused)|sign in to confirm/i.test(message)) this.downloadBlockedUntil = Date.now() + 5 * 60000;
      throw error;
    } finally { await bridge?.close(); }
    const completed = await downloadManifest(partialDirectory, "complete.json");
    const info = await stat(completed);
    if (!info.isFile() || !info.size || info.size > maximumBytes) throw new Error("YouTube: оригинал пуст или превышает 750 МБ");
    await rename(completed, destination);
    for (const name of ["active.json", "complete.json"]) await rm(join(partialDirectory, name), { force: true });
    await rmdir(partialDirectory).catch(() => {}); // Other format fragments, if any, remain resumable.
  }

  /** Low-resolution disjoint samples are kept outside the original/resume paths.
   * A successful preview is NOT a selected source or a semantic approval. */
  async preview(candidate:DocumentaryCandidate,directory:string,signal?:AbortSignal,requireHd=false):Promise<DocumentaryPreview> {
    signal?.throwIfAborted();
    const id=candidate.id.replace(/^youtube:/,'');
    if(candidate.provider!=='youtube'||!validId(id)||candidate.pageUrl!==`https://www.youtube.com/watch?v=${id}`)throw Error('Некорректный источник YouTube');
    const ranges=documentaryPreviewRanges(candidate.durationSeconds??0);
    if(!ranges.length)throw Error('Для пробной загрузки нужна длительность источника');
    const cached=await readDocumentaryPreview(directory);
    if(cached&&(!requireHd||candidate.videoDefinition==='hd'))return cached;
    const videos=await this.api('videos',{part:'snippet,status,contentDetails',id},signal);
    if(!youtubeDocumentaryCandidates(videos,candidate.query).some(video=>video.id===candidate.id))throw Error('YouTube больше не подтверждает публичное видео с лицензией Creative Commons');
    requireHighDefinition(videos,id,requireHd);
    if(cached)return cached;
    await mkdir(directory,{recursive:true});
    await ensureDocumentarySpace(directory,32*1024*1024);
    const cookies=await this.store.resolveValidatedCookies(),proxyUrl=await this.store.proxyUrl?.();
    const route=await this.store.downloadRoute?.()??(proxyUrl?'proxy':'system');
    if(route==='proxy'&&!proxyUrl)throw Error('Для выбранного маршрута YouTube сохраните прокси');
    const bridge=route==='public-dns'?await createYouTubeDnsBridge():route==='proxy'?await createAuthenticatedProxyBridge(proxyUrl!,{host:'www.youtube.com',port:443}):undefined;
    try {
      // These are preview receipts only; full original/partial receipts survive.
      for(const name of ['active.json','complete.json'])await rm(join(directory,name),{force:true});
      await this.runner(['--ignore-config','--no-playlist','--no-progress','--no-part','--force-overwrites','--socket-timeout','10','--retries','0','--fragment-retries','0','--extractor-retries','0',
        '--js-runtimes','node','--ffmpeg-location',ffmpegPath!.replace('app.asar','app.asar.unpacked'),
        '-f','bestvideo[ext=mp4][height<=480]/best[ext=mp4][height<=480]',
        // Stream-copying a four-second section between distant keyframes can
        // report success with an empty MP4 (observed: 262 bytes, no video).
        // Decode only these low-resolution samples to keep all three useful.
        '--force-keyframes-at-cuts',
        ...ranges.flatMap(range=>['--download-sections',`*${range.start}-${range.end}`]),
        '--restrict-filenames','--no-simulate','--print-to-file','before_dl:%(filename)j',join(directory,'active.json'),
        '--print-to-file','after_move:%(filepath)j',join(directory,'complete.json'),
        ...(bridge?['--proxy',bridge.proxyUrl]:[]),...(cookies?['--cookies',cookies]:[]),
        '-o',join(directory,'sample-%(section_start).3f-%(format_id)s.%(ext)s'),'--',candidate.pageUrl],join(directory,'preview.download'),signal,undefined,directory);
      const paths=(await readFile(join(directory,'complete.json'),'utf8')).trim().split(/\r?\n/).map(line=>JSON.parse(line));
      if(paths.length!==ranges.length||new Set(paths).size!==3||paths.some(path=>typeof path!=='string'||resolve(dirname(path))!==resolve(directory)||!path.endsWith('.mp4')))throw Error('Не получены все три пробных участка видео');
      return await saveDocumentaryPreview(directory,ranges.map((range,index)=>({...range,path:paths[index]})),signal);
    } finally {await bridge?.close();}
  }
}

export async function downloadWithYtDlp(args: string[], destination: string, signal?: AbortSignal, onProgress?: (bytes: number) => void, partialDirectory?: string): Promise<void> {
  const bundled = join(process.resourcesPath || "", "bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
  const commands = [
    ...(process.env.YT_DLP_PATH ? [{ executable: process.env.YT_DLP_PATH, prefix: [] as string[] }] : []),
    ...(existsSync(bundled) ? [{ executable: bundled, prefix: [] as string[] }] : []),
    { executable: "yt-dlp", prefix: [] as string[] }, { executable: "python", prefix: ["-m", "yt_dlp"] }
  ];
  for (const command of commands) {
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
        const watchdog = new DocumentaryDownloadWatchdog();
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
