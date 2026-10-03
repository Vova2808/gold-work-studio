import { lookup } from "node:dns/promises";
import { createWriteStream } from "node:fs";
import { Transform, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isIP } from "node:net";
import { dirname } from "node:path";
import timers from "node:timers/promises";
import { documentaryAvailableBytes, DocumentaryStorageUnavailableError } from "./documentary-storage.js";
const downloadCooldown = new Map<string, number>();

export class DocumentaryDownloadTimeoutError extends Error {}
export function documentaryDownloadTimedOut(error: unknown): boolean {
  return error instanceof DocumentaryDownloadTimeoutError || error instanceof Error
    && /тайм|time|превысил[аи]?|не начал передачу|новые данные не поступают/i.test(error.message);
}

/** Limit only read-only media transfers; never cancel an accepted paid analysis.
 * Manual imports retain their existing watchdog and resumable source behavior. */
export async function withDocumentaryDownloadBudget<T>(options: { automatic: boolean; kind: "image" | "video"; deadline?: number; signal?: AbortSignal }, work: (signal?: AbortSignal) => Promise<T>): Promise<T> {
  options.signal?.throwIfAborted();
  if (!options.automatic) return work(options.signal);
  const controller = new AbortController();
  const remaining = (options.deadline ?? Infinity) - Date.now();
  const expired = () => new DocumentaryDownloadTimeoutError("Источник превысил время автоматической загрузки. Проверяю другие материалы; готовые результаты сохранены.");
  if (remaining <= 0) throw expired();
  const timeout = setTimeout(() => controller.abort(), Math.min(options.kind === "image" ? 30_000 : 120_000, remaining));
  try {
    return await work(AbortSignal.any([controller.signal, ...(options.signal ? [options.signal] : [])]));
  } catch (error) {
    if (controller.signal.aborted && !options.signal?.aborted) throw expired();
    throw error;
  } finally { clearTimeout(timeout); }
}

export function documentaryRetryAfter(value: string | null, now = Date.now()): number {
  const seconds = value && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : value ? (Date.parse(value) - now) / 1000 : 120;
  return Math.max(30, Math.min(3600, Number.isFinite(seconds) ? seconds : 120));
}

/** Retry only a read-only media GET after the source's explicit cooldown.
 * Workers share the deadline, and Stop also interrupts the wait. */
export async function requestDocumentaryMedia(url: URL, signal?: AbortSignal, onWait?: (seconds: number) => void): Promise<Response> {
  let waited = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    let lastNotice = -Infinity;
    for (;;) {
      signal?.throwIfAborted();
      const remaining = (downloadCooldown.get(url.hostname) ?? 0) - Date.now();
      if (remaining <= 0) break;
      if (waited + remaining > 120_000) throw new Error(`Источник ограничил скачивание (HTTP 429). Повторите через ${Math.ceil(remaining / 1000)} с; предыдущие материалы сохранены.`);
      if (Date.now() - lastNotice >= 5000) { onWait?.(Math.ceil(remaining / 1000)); lastNotice = Date.now(); }
      const pause = Math.min(remaining, 250);
      const started = Date.now();
      await timers.setTimeout(pause, undefined, { signal });
      waited += Math.max(pause, Date.now() - started);
    }
    const response = await fetch(url, { redirect: "manual", headers: { "User-Agent": "GoldWorkStudio/0.2 (local documentary editor)" }, signal: AbortSignal.any([AbortSignal.timeout(120000), ...(signal ? [signal] : [])]) });
    if (response.status !== 429) return response;
    const seconds = documentaryRetryAfter(response.headers.get("retry-after"));
    downloadCooldown.set(url.hostname, Math.max(downloadCooldown.get(url.hostname) ?? 0, Date.now() + seconds * 1000));
    await response.body?.cancel();
    if (attempt === 2) throw new Error(`Источник продолжает ограничивать скачивание (HTTP 429). Повторите через ${Math.ceil(seconds)} с; предыдущие материалы сохранены.`);
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
export async function downloadDocumentaryFile(value: string, destination: string, signal?: AbortSignal, onWait?: (seconds: number) => void): Promise<{ contentType: string; bytes: number }> {
  signal?.throwIfAborted();
  let url = await publicMediaUrl(value);
  for (let redirects = 0; redirects <= 4; redirects++) {
    const response = await requestDocumentaryMedia(url, signal, onWait);
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
