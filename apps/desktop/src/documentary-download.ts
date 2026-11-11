import { lookup } from "node:dns/promises";
import { createWriteStream } from "node:fs";
import { Transform, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isIP } from "node:net";
import { dirname } from "node:path";
import timers from "node:timers/promises";
import { documentaryAvailableBytes, DocumentaryStorageUnavailableError } from "./documentary-storage.js";
import {documentaryWorkLimits} from './documentary-work-budget.js';
const downloadCooldown = new Map<string, number>();
export interface DocumentaryMediaRequestOptions {fetcher?:typeof globalThis.fetch;availabilityWaitMs?:number}
export class DocumentaryMediaRateLimitError extends Error {
  readonly name='DocumentaryMediaRateLimitError';
  constructor(readonly retryAfterMs:number){super(`Источник ограничил скачивание (HTTP 429). Повторите через ${Math.ceil(retryAfterMs/1000)} с; предыдущие материалы сохранены.`);}
}

/** The selector found a known cooldown before starting any transfer. */
export class DocumentaryMediaCooldownError extends DocumentaryMediaRateLimitError {}

export class DocumentaryDownloadTimeoutError extends Error {
  constructor(message: string, readonly reason?: 'idle' | 'total') { super(message); }
}
// The stock stream receives this exact signal through the existing download API.
// Only received body bytes may extend its short window; headers do not count.
const downloadProgress = new WeakMap<AbortSignal, (bytes: number) => void>();
export function documentaryDownloadProgress(signal: AbortSignal | undefined): ((bytes: number) => void) | undefined {
  return signal && !signal.aborted ? downloadProgress.get(signal) : undefined;
}
export function documentaryDownloadTimedOut(error: unknown): boolean {
  return error instanceof DocumentaryDownloadTimeoutError || error instanceof Error
    && /тайм|time|превысил[аи]?|не начал передачу|новые данные не поступают/i.test(error.message);
}

/** Limit only read-only media transfers; never cancel an accepted paid analysis.
 * Manual imports retain their existing watchdog and resumable source behavior. */
export async function withDocumentaryDownloadBudget<T>(options: { automatic: boolean; kind: "image" | "video"; deadline?: number; transferMs?: number; progressAware?: boolean; signal?: AbortSignal }, work: (signal?: AbortSignal) => Promise<T>): Promise<T> {
  options.signal?.throwIfAborted();
  if (!options.automatic) return work(options.signal);
  const controller = new AbortController();
  const remaining = (options.deadline ?? Infinity) - Date.now() - documentaryWorkLimits.analysisReserveMs;
  const expired = (reason: 'idle' | 'total' = 'total') => new DocumentaryDownloadTimeoutError(
    reason === 'idle'
      ? "Источник превысил время автоматической загрузки: новые данные не поступают. Проверяю другие материалы; готовые результаты сохранены."
      : "Источник превысил время автоматической загрузки. Проверяю другие материалы; готовые результаты сохранены.", reason);
  if (remaining <= 0) throw expired();
  const signal = AbortSignal.any([controller.signal, ...(options.signal ? [options.signal] : [])]);
  const progressAware = options.progressAware === true && options.kind === 'video';
  // A healthy streaming transfer may outlast the old 35-second cutoff. Only
  // advancing body bytes extend the idle window; the scene/analysis reserve
  // and active-phase cap still bound the entire attempt.
  const totalMs = Math.min(progressAware ? documentaryWorkLimits.video.activeMs : documentaryWorkLimits[options.kind].downloadMs, remaining);
  const shortMs = options.transferMs ?? documentaryWorkLimits[options.kind].downloadMs;
  const timeout = setTimeout(() => controller.abort(expired()), totalMs);
  let shortTimeout: ReturnType<typeof setTimeout> | undefined;
  let lastProgressAt = Date.now(), receivedBytes = 0;
  if (shortMs < totalMs) {
    const checkIdle = () => {
      const left = shortMs - (Date.now() - lastProgressAt);
      if (left <= 0) controller.abort(expired(progressAware ? 'idle' : 'total'));
      else shortTimeout = setTimeout(checkIdle, left);
    };
    shortTimeout = setTimeout(checkIdle, shortMs);
  }
  if (progressAware) downloadProgress.set(signal, bytes => {
    if (!signal.aborted && Number.isFinite(bytes) && bytes > receivedBytes) {
      receivedBytes = bytes; lastProgressAt = Date.now();
    }
  });
  try {
    return await work(signal);
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason;
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timeout); clearTimeout(shortTimeout); downloadProgress.delete(signal);
  }
}

export function documentaryRetryAfter(value: string | null, now = Date.now()): number {
  const seconds = value && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : value ? (Date.parse(value) - now) / 1000 : 120;
  return Math.max(30, Math.min(3600, Number.isFinite(seconds) ? seconds : 120));
}

export function documentaryMediaCooldownMs(url:URL):number {
  return Math.max(0,(downloadCooldown.get(url.hostname)??0)-Date.now());
}

/** Full files and the local Range relay use the same origin cooldown. */
export function rememberDocumentaryMediaRateLimit(url:URL,response:Response):DocumentaryMediaRateLimitError {
  const until=Date.now()+documentaryRetryAfter(response.headers.get('retry-after'))*1000;
  downloadCooldown.set(url.hostname,Math.max(downloadCooldown.get(url.hostname)??0,until));
  return new DocumentaryMediaRateLimitError(documentaryMediaCooldownMs(url));
}

/** Retry only a read-only media GET after the source's explicit cooldown.
 * Workers share the deadline, and Stop also interrupts the wait. */
export async function requestDocumentaryMedia(url: URL, signal?: AbortSignal, onWait?: (seconds: number) => void,options:DocumentaryMediaRequestOptions={}): Promise<Response> {
  let waited = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    let lastNotice = -Infinity;
    for (;;) {
      signal?.throwIfAborted();
      const remaining = documentaryMediaCooldownMs(url);
      if (remaining <= 0) break;
      if (waited + remaining > (options.availabilityWaitMs??documentaryWorkLimits.availabilityWaitMs)) {
        if(attempt===0)throw new DocumentaryMediaCooldownError(remaining);
        throw new DocumentaryMediaRateLimitError(remaining);
      }
      if (Date.now() - lastNotice >= 5000) { onWait?.(Math.ceil(remaining / 1000)); lastNotice = Date.now(); }
      const pause = Math.min(remaining, 250);
      const started = Date.now();
      await timers.setTimeout(pause, undefined, { signal });
      waited += Math.max(pause, Date.now() - started);
    }
    const response = await (options.fetcher??globalThis.fetch)(url, { redirect: "manual", headers: { "User-Agent": "GoldWorkStudio/0.2 (local documentary editor)" }, signal: AbortSignal.any([AbortSignal.timeout(120000), ...(signal ? [signal] : [])]) });
    if (response.status !== 429) return response;
    const limited=rememberDocumentaryMediaRateLimit(url,response);
    await response.body?.cancel();
    if (attempt === 2) throw new Error(`Источник продолжает ограничивать скачивание (HTTP 429). Повторите через ${Math.ceil(limited.retryAfterMs/1000)} с; предыдущие материалы сохранены.`);
  }
  throw new Error("Источник недоступен после ограниченного повтора");
}

function privateAddress(address: string): boolean {
  if (address.includes(":")) return /^(?:::|::1$|fe[89ab]|f[cd]|::ffff:)/i.test(address);
  const parts = address.split(".").map(Number), first = parts[0]!, second = parts[1]!;
  return first === 0 || first === 10 || first === 127 || first >= 224 || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168) || (first === 100 && second >= 64 && second <= 127);
}
export async function publicMediaUrl(value: string): Promise<URL> {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) throw new Error("Нужна прямая HTTPS-ссылка на публичный оригинал");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || (isIP(host) && privateAddress(host))) throw new Error("Локальные сетевые адреса не являются веб-источниками");
  const addresses = await lookup(host, { all: true });
  if (!addresses.length || addresses.some(item => privateAddress(item.address))) throw new Error("Ссылка ведёт в частную сеть");
  return url;
}

/** Bounded streaming copy. Redirects are checked before requesting each new host. */
export async function downloadDocumentaryFile(value: string, destination: string, signal?: AbortSignal, onWait?: (seconds: number) => void,options:DocumentaryMediaRequestOptions={}): Promise<{ contentType: string; bytes: number }> {
  signal?.throwIfAborted();
  let url = await publicMediaUrl(value);
  for (let redirects = 0; redirects <= 4; redirects++) {
    const response = await requestDocumentaryMedia(url, signal, onWait,options).catch(error=>{
      // A redirect already used a GET even when its next host is cooling.
      if(redirects>0&&error instanceof DocumentaryMediaCooldownError)throw new DocumentaryMediaRateLimitError(error.retryAfterMs);
      throw error;
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location) throw new Error("Источник вернул редирект без адреса");
      url = await publicMediaUrl(new URL(location, url).toString()); continue;
    }
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error(`Оригинал недоступен (HTTP ${response.status})`); }
    const limit = 750 * 1024 * 1024;
    if (Number(response.headers.get("content-length")) > limit) { await response.body.cancel(); throw new Error("Файл больше 750 МБ; выберите разрешённый короткий фрагмент"); }
    const available = await documentaryAvailableBytes(dirname(destination));
    if (available <= 0 || Number(response.headers.get("content-length")) > available) { await response.body.cancel(); throw new DocumentaryStorageUnavailableError("Недостаточно места для скачивания; предыдущие материалы сохранены"); }
    const contentType = response.headers.get("content-type") ?? "";
    if (/text\/html|application\/json/i.test(contentType)) { await response.body.cancel(); throw new Error("Ссылка вернула страницу, а не оригинальный медиафайл"); }
    let bytes = 0;
    const bound = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > limit ? new Error("Файл больше 750 МБ") : bytes > available ? new DocumentaryStorageUnavailableError("Недостаточно места для скачивания; предыдущие материалы сохранены") : null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), bound, createWriteStream(destination), { signal });
    if (!bytes) throw new Error("Источник вернул пустой файл");
    return { contentType, bytes };
  }
  throw new Error("Слишком много перенаправлений источника");
}
