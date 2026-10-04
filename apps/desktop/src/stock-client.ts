import { extname } from "node:path";
import { readFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type {
  StockAsset,
  StockMediaType,
  StockOrientation,
  StockProvider,
  StockSearchInput,
  StockSearchResult
} from "@gold-work/shared";
import { atomicWrite } from "./fs-utils.js";
import { parseProxyUrl, proxyFetch } from "./proxy-utils.js";

export interface StockKeyStore {
  apiKey(provider: StockProvider): Promise<string | undefined>;
  proxyUrl?(provider: StockProvider): Promise<string | undefined>;
}

export interface DownloadedStockAsset {
  data: Buffer;
  extension: string;
  contentType: string;
}

/** The provider supplied a definite retry time for an API search. */
export class StockApiRateLimitError extends Error {
  constructor(message: string, readonly retryAfterMs: number) {
    super(message);
    this.name = "StockApiRateLimitError";
  }
}

type StockFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type StockSleep = (milliseconds: number) => Promise<void>;

interface NormalizedSearch {
  provider: StockProvider;
  mediaType: StockMediaType;
  query: string;
  orientation: StockOrientation;
  page: number;
  perPage: number;
}

interface CachedSearch {
  expiresAt: number;
  value: StockSearchResult;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const PEXELS_API = "https://api.pexels.com";
const PIXABAY_API = "https://pixabay.com";
const NETWORK_ATTEMPTS = 3;

function clampInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value!)));
}

export function normalizeStockSearchInput(input: StockSearchInput): NormalizedSearch {
  if (input.provider !== "pexels" && input.provider !== "pixabay") throw new Error("Неизвестный стоковый провайдер");
  if (input.mediaType !== "image" && input.mediaType !== "video") throw new Error("Неизвестный тип стокового материала");
  const query = String(input.query ?? "").replace(/\s+/g, " ").trim();
  if (query.length < 2) throw new Error("Введите поисковый запрос хотя бы из двух символов");
  // Pixabay ограничивает q ста символами; общий предел делает поведение провайдеров одинаковым.
  if (query.length > 100) throw new Error("Поисковый запрос слишком длинный (максимум 100 символов)");
  const orientation = input.orientation ?? "landscape";
  if (!["landscape", "portrait", "square"].includes(orientation)) throw new Error("Неизвестная ориентация стока");
  return {
    provider: input.provider,
    mediaType: input.mediaType,
    query,
    orientation,
    page: clampInteger(input.page, 1, 1, 10_000),
    // Pixabay требует не меньше 3, Pexels допускает до 80 — общий безопасный диапазон.
    perPage: clampInteger(input.perPage, 24, 3, 80)
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pageDescription(pageUrl: string): string {
  try {
    const parts = new URL(pageUrl).pathname.split("/").filter(Boolean);
    const slug = parts.at(-1)?.replace(/-?\d+$/, "").replace(/[-_]+/g, " ").trim();
    return slug ? decodeURIComponent(slug) : "";
  } catch {
    return "";
  }
}

function chooseEfficientVideoFile(candidates: Record<string, unknown>[]): Record<string, unknown> | undefined {
  const valid = candidates.filter((candidate) => text(candidate.url || candidate.link).startsWith("https://"));
  const measured = valid
    .map((candidate) => ({ candidate, width: number(candidate.width), height: number(candidate.height) }))
    .filter(({ width, height }) => width > 0 && height > 0);
  const hd = measured.filter(({ width, height }) => Math.min(width, height) >= 720 && Math.max(width, height) >= 1280);
  const fullHdOrSmaller = hd.filter(({ width, height }) => Math.min(width, height) <= 1080 && Math.max(width, height) <= 1920);
  const smallest = (items: typeof measured) => [...items].sort((left, right) => (left.width * left.height) - (right.width * right.height))[0]?.candidate;
  // 720p обычно достаточно для проекта и заметно легче 4K. Если HD нет — берём лучший доступный файл.
  return smallest(fullHdOrSmaller) ?? smallest(hd) ?? [...measured]
    .sort((left, right) => (right.width * right.height) - (left.width * left.height))[0]?.candidate ?? valid[0];
}

function bestPexelsVideoFile(value: unknown): Record<string, unknown> | undefined {
  const candidates = asArray(value)
    .map(asRecord)
    .filter((file) => text(file.link).startsWith("https://") && /video\/mp4/i.test(text(file.file_type)));
  return chooseEfficientVideoFile(candidates);
}

function normalizePexels(payload: unknown, input: NormalizedSearch): StockSearchResult {
  const root = asRecord(payload);
  const source = input.mediaType === "image" ? asArray(root.photos) : asArray(root.videos);
  const items = source.flatMap((raw): StockAsset[] => {
    const item = asRecord(raw);
    const id = String(item.id ?? "").trim();
    const pageUrl = text(item.url);
    const authorRecord = asRecord(item.user);
    const author = input.mediaType === "image" ? text(item.photographer) : text(authorRecord.name);
    const authorUrl = input.mediaType === "image" ? text(item.photographer_url) : text(authorRecord.url);
    let previewUrl = "";
    let downloadUrl = "";
    if (input.mediaType === "image") {
      const sources = asRecord(item.src);
      previewUrl = text(sources.medium) || text(sources.large);
      downloadUrl = text(sources.original) || text(sources.large2x) || text(sources.large);
    } else {
      const file = bestPexelsVideoFile(item.video_files);
      previewUrl = text(item.image);
      downloadUrl = text(file?.link);
    }
    if (!id || !previewUrl || !downloadUrl || !pageUrl) return [];
    return [{
      provider: "pexels",
      id,
      mediaType: input.mediaType,
      query: input.query,
      width: number(item.width),
      height: number(item.height),
      durationSeconds: input.mediaType === "video" ? number(item.duration) || undefined : undefined,
      previewUrl,
      downloadUrl,
      pageUrl,
      description: text(item.alt) || pageDescription(pageUrl) || undefined,
      author: author || "Pexels contributor",
      authorUrl: authorUrl || undefined,
      attribution: `${input.mediaType === "image" ? "Photo" : "Video"} by ${author || "Pexels contributor"} on Pexels`
    }];
  });
  const total = number(root.total_results);
  const page = number(root.page) || input.page;
  const perPage = number(root.per_page) || input.perPage;
  return { items, total, page, perPage, hasMore: page * perPage < total };
}

function bestPixabayVideo(value: unknown): Record<string, unknown> | undefined {
  const videos = asRecord(value);
  return chooseEfficientVideoFile([videos.medium, videos.small, videos.large, videos.tiny]
    .map(asRecord)
    .filter((candidate) => text(candidate.url).startsWith("https://")));
}

function pixabayVideoPreview(item: Record<string, unknown>, selected: Record<string, unknown> | undefined): string {
  const videos = asRecord(item.videos);
  const thumbnail = [selected, videos.medium, videos.small, videos.large, videos.tiny]
    .map(asRecord)
    .map((candidate) => text(candidate.thumbnail))
    .find((value) => value.startsWith("https://"));
  if (thumbnail) return thumbnail;
  // Документированный Pixabay picture_id соответствует постеру Vimeo CDN.
  const pictureId = String(item.picture_id ?? "").trim();
  return pictureId ? `https://i.vimeocdn.com/video/${encodeURIComponent(pictureId)}_640x360.jpg` : "";
}

function normalizePixabay(payload: unknown, input: NormalizedSearch): StockSearchResult {
  const root = asRecord(payload);
  const items = asArray(root.hits).flatMap((raw): StockAsset[] => {
    const item = asRecord(raw);
    const id = String(item.id ?? "").trim();
    const author = text(item.user) || "Pixabay contributor";
    const pageUrl = text(item.pageURL);
    const video = input.mediaType === "video" ? bestPixabayVideo(item.videos) : undefined;
    const downloadUrl = input.mediaType === "image"
      ? text(item.largeImageURL) || text(item.webformatURL)
      : text(video?.url);
    const previewUrl = input.mediaType === "image"
      ? text(item.webformatURL) || text(item.previewURL)
      : pixabayVideoPreview(item, video) || downloadUrl;
    if (!id || !downloadUrl || !previewUrl || !pageUrl) return [];
    const tags = text(item.tags).split(",").map((tag) => tag.trim()).filter(Boolean);
    return [{
      provider: "pixabay",
      id,
      mediaType: input.mediaType,
      query: input.query,
      width: input.mediaType === "image" ? number(item.imageWidth) : number(video?.width),
      height: input.mediaType === "image" ? number(item.imageHeight) : number(video?.height),
      durationSeconds: input.mediaType === "video" ? number(item.duration) || undefined : undefined,
      previewUrl,
      downloadUrl,
      pageUrl,
      description: tags.join(" ") || pageDescription(pageUrl) || undefined,
      tags: tags.length > 0 ? tags : undefined,
      author,
      attribution: `${input.mediaType === "image" ? "Image" : "Video"} by ${author} on Pixabay`
    }];
  });
  const total = number(root.totalHits) || number(root.total);
  return {
    items,
    total,
    page: input.page,
    perPage: input.perPage,
    hasMore: input.page * input.perPage < total
  };
}

function pixabayOrientation(orientation: StockOrientation): string {
  return orientation === "landscape" ? "horizontal" : orientation === "portrait" ? "vertical" : "all";
}

function providerLabel(provider: StockProvider): string {
  return provider === "pexels" ? "Pexels" : "Pixabay";
}

function safeHost(url: URL): string {
  return url.hostname.toLocaleLowerCase().replace(/[^a-z0-9.-]/g, "").slice(0, 120) || "unknown-host";
}

function safeCauseCode(error: unknown): string | undefined {
  const record = error && typeof error === "object" ? error as { code?: unknown; cause?: unknown } : undefined;
  const direct = typeof record?.code === "string" ? record.code : undefined;
  const nested = record?.cause && typeof record.cause === "object"
    ? (record.cause as { code?: unknown }).code
    : undefined;
  const value = direct ?? (typeof nested === "string" ? nested : undefined);
  return value?.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || undefined;
}

function retryDelay(attempt: number, retryAfter: string | null): number {
  const requestedSeconds = Number(retryAfter);
  if (Number.isFinite(requestedSeconds) && requestedSeconds > 0) {
    // Не замораживаем весь desktop на минуту: после короткой паузы сервис сможет
    // переключиться на другой результат или провайдер.
    return Math.min(1_000, Math.max(100, Math.round(requestedSeconds * 1_000)));
  }
  return Math.min(800, 200 * attempt);
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function expectedHost(provider: StockProvider, urlValue: string): URL {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    throw new Error("Сток вернул некорректную ссылку на файл");
  }
  const root = provider === "pexels" ? "pexels.com" : "pixabay.com";
  if (url.protocol !== "https:" || (url.hostname !== root && !url.hostname.endsWith(`.${root}`))) {
    throw new Error(`Небезопасная ссылка: файл должен находиться на домене ${root}`);
  }
  return url;
}

function expectedPreviewHost(provider: StockProvider, urlValue: string): URL {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    throw new Error("Сток вернул некорректную ссылку на постер");
  }
  const allowed = provider === "pexels"
    ? url.hostname === "pexels.com" || url.hostname.endsWith(".pexels.com")
    : url.hostname === "pixabay.com" || url.hostname.endsWith(".pixabay.com") || url.hostname === "i.vimeocdn.com";
  if (url.protocol !== "https:" || !allowed) throw new Error("Сток вернул небезопасную ссылку на постер");
  return url;
}

function extensionFor(contentType: string, url: URL, mediaType: StockMediaType): string {
  const known: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov"
  };
  const normalizedType = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (known[normalizedType]) return known[normalizedType]!;
  const candidate = extname(url.pathname).slice(1).toLowerCase();
  const allowed = mediaType === "image" ? ["jpg", "jpeg", "png", "webp"] : ["mp4", "webm", "mov"];
  if (allowed.includes(candidate)) return candidate === "jpeg" ? "jpg" : candidate;
  throw new Error("Сток вернул файл неподдерживаемого формата");
}

export class StockClient {
  private readonly cache = new Map<string, CachedSearch>();
  private cacheLoaded = false;
  private readonly apiQueues = new Map<StockProvider, Promise<unknown>>();
  private readonly apiCooldown = new Map<StockProvider, number>();

  constructor(
    private readonly store: StockKeyStore,
    private readonly fetcher: StockFetch = globalThis.fetch,
    private readonly cachePath?: string,
    private readonly now: () => number = Date.now,
    private readonly sleep: StockSleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    private readonly proxyFetcher: typeof proxyFetch = proxyFetch
  ) {}

  async test(provider: StockProvider): Promise<{ ok: boolean; message: string }> {
    try {
      await this.search({ provider, mediaType: "image", query: "nature", page: 1, perPage: 3 }, true);
      return { ok: true, message: `${providerLabel(provider)} подключён` };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async search(inputValue: StockSearchInput, bypassCache = false): Promise<StockSearchResult> {
    const input = normalizeStockSearchInput(inputValue);
    await this.loadCache();
    const cacheKey = JSON.stringify(input);
    const cached = this.cache.get(cacheKey);
    if (!bypassCache && cached && cached.expiresAt > this.now()) return structuredClone(cached.value);
    if (cached) this.cache.delete(cacheKey);

    const key = await this.requiredKey(input.provider);
    let url: URL;
    let headers: HeadersInit | undefined;
    if (input.provider === "pexels") {
      url = new URL(input.mediaType === "image" ? "/v1/search" : "/videos/search", PEXELS_API);
      url.searchParams.set("query", input.query);
      url.searchParams.set("orientation", input.orientation);
      url.searchParams.set("page", String(input.page));
      url.searchParams.set("per_page", String(input.perPage));
      headers = { Authorization: key };
    } else {
      url = new URL(input.mediaType === "image" ? "/api/" : "/api/videos/", PIXABAY_API);
      url.searchParams.set("key", key);
      url.searchParams.set("q", input.query);
      url.searchParams.set("orientation", pixabayOrientation(input.orientation));
      url.searchParams.set("page", String(input.page));
      url.searchParams.set("per_page", String(input.perPage));
      url.searchParams.set("safesearch", "true");
      if (input.mediaType === "image") url.searchParams.set("image_type", "photo");
      else url.searchParams.set("video_type", "film");
    }

    const payload = await this.fetchJson(url, input.provider, headers);
    const result = input.provider === "pexels" ? normalizePexels(payload, input) : normalizePixabay(payload, input);
    this.cache.set(cacheKey, { expiresAt: this.now() + CACHE_TTL_MS, value: result });
    await this.persistCache().catch(() => undefined);
    return structuredClone(result);
  }

  /** Скачивание вызывается только после явного выбора карточки пользователем. */
  async download(assetValue: StockAsset, signal?: AbortSignal): Promise<DownloadedStockAsset> {
    const { response, extension, contentType, limit } = await this.downloadResponse(assetValue, signal);
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length === 0) throw new Error("Сток вернул пустой файл");
    if (data.length > limit) throw new Error("Выбранный стоковый файл слишком большой");
    return { data, extension, contentType };
  }

  /** Large documentary sources are streamed to an app-owned staging file. */
  async downloadToFile(asset: StockAsset, destination: string, availableBytes: number, signal?: AbortSignal): Promise<{ bytes: number; extension: string; contentType: string }> {
    const { response, extension, contentType, limit } = await this.downloadResponse(asset, signal);
    const maximum = Math.min(limit, Math.max(0, availableBytes));
    if (!response.body || maximum <= 0 || Number(response.headers.get("content-length")) > maximum) {
      await response.body?.cancel();
      throw new Error("Недостаточно места для скачивания; предыдущие материалы сохранены");
    }
    let bytes = 0;
    const bounded = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > maximum ? new Error("Стоковый файл превысил допустимый размер или свободное место") : null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), bounded, createWriteStream(destination, { flags: "wx" }), { signal });
    if (!bytes) throw new Error("Сток вернул пустой файл");
    return { bytes, extension, contentType };
  }

  private async downloadResponse(assetValue: StockAsset, signal?: AbortSignal) {
    const asset = this.validateAsset(assetValue);
    const url = expectedHost(asset.provider, asset.downloadUrl);
    let response: Response | undefined;
    let causeCode: string | undefined;
    for (let attempt = 1; attempt <= NETWORK_ATTEMPTS; attempt += 1) {
      signal?.throwIfAborted();
      try {
        response = await this.providerFetch(asset.provider, url, { signal: AbortSignal.any([AbortSignal.timeout(120_000), ...(signal ? [signal] : [])]) });
      } catch (error) {
        signal?.throwIfAborted();
        causeCode = safeCauseCode(error);
        if (attempt < NETWORK_ATTEMPTS) {
          await this.sleep(retryDelay(attempt, null));
          continue;
        }
        throw new Error(
          `Не удалось скачать файл из ${providerLabel(asset.provider)} `
          + `(host=${safeHost(url)}${causeCode ? `, code=${causeCode}` : ""}) после ${NETWORK_ATTEMPTS} попыток`
        );
      }
      if (response.ok) break;
      if (isRetryableStatus(response.status) && attempt < NETWORK_ATTEMPTS) {
        await response.body?.cancel();
        await this.sleep(retryDelay(attempt, response.headers.get("retry-after")));
        continue;
      }
      await response.body?.cancel();
      throw this.httpError(asset.provider, response.status, response.headers.get("retry-after"), "download", url);
    }
    if (!response) {
      throw new Error(`Не удалось скачать файл из ${providerLabel(asset.provider)} (host=${safeHost(url)})`);
    }
    if (response.url) expectedHost(asset.provider, response.url);
    const contentType = response.headers.get("content-type") ?? "application/octet-stream";
    const declaredSize = Number(response.headers.get("content-length") ?? 0);
    const limit = asset.mediaType === "image" ? 50 * 1024 * 1024 : 750 * 1024 * 1024;
    if (declaredSize > limit) { await response.body?.cancel(); throw new Error("Выбранный стоковый файл слишком большой"); }
    return { response, limit, extension: extensionFor(contentType, url, asset.mediaType), contentType };
  }

  /** Постер улучшает превью video-сцены, но его сбой не должен мешать применению самого MP4. */
  async downloadPreview(assetValue: StockAsset): Promise<DownloadedStockAsset | undefined> {
    const asset = this.validateAsset(assetValue);
    if (asset.mediaType !== "video" || !asset.previewUrl || asset.previewUrl === asset.downloadUrl) return undefined;
    const url = expectedPreviewHost(asset.provider, asset.previewUrl);
    let response: Response | undefined;
    for (let attempt = 1; attempt <= NETWORK_ATTEMPTS; attempt += 1) {
      try {
        response = await this.providerFetch(asset.provider, url, { signal: AbortSignal.timeout(30_000) });
      } catch {
        if (attempt < NETWORK_ATTEMPTS) {
          await this.sleep(retryDelay(attempt, null));
          continue;
        }
        return undefined;
      }
      if (response.ok) break;
      if (isRetryableStatus(response.status) && attempt < NETWORK_ATTEMPTS) {
        await this.sleep(retryDelay(attempt, response.headers.get("retry-after")));
        continue;
      }
      return undefined;
    }
    if (!response?.ok) return undefined;
    if (response.url) expectedPreviewHost(asset.provider, response.url);
    const declaredSize = Number(response.headers.get("content-length") ?? 0);
    const limit = 20 * 1024 * 1024;
    if (declaredSize > limit) return undefined;
    const contentType = response.headers.get("content-type") ?? "application/octet-stream";
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length === 0 || data.length > limit) return undefined;
    return { data, extension: extensionFor(contentType, url, "image"), contentType };
  }

  private validateAsset(asset: StockAsset): StockAsset {
    if (!asset || (asset.provider !== "pexels" && asset.provider !== "pixabay")) throw new Error("Некорректный стоковый материал");
    if (asset.mediaType !== "image" && asset.mediaType !== "video") throw new Error("Некорректный тип стокового материала");
    if (!String(asset.id ?? "").trim() || !String(asset.pageUrl ?? "").trim() || !String(asset.downloadUrl ?? "").trim()) {
      throw new Error("В выбранном стоке не хватает ссылки или идентификатора");
    }
    expectedHost(asset.provider, asset.pageUrl);
    expectedHost(asset.provider, asset.downloadUrl);
    if (asset.authorUrl) expectedHost(asset.provider, asset.authorUrl);
    return { ...asset, id: String(asset.id).slice(0, 100), query: String(asset.query ?? "").slice(0, 200) };
  }

  private async requiredKey(provider: StockProvider): Promise<string> {
    const key = await this.store.apiKey(provider);
    if (!key?.trim()) throw new Error(`Добавьте API-ключ ${providerLabel(provider)} в настройках`);
    return key.trim();
  }

  private async fetchJson(url: URL, provider: StockProvider, headers?: HeadersInit): Promise<unknown> {
    const previous = this.apiQueues.get(provider);
    const run = (async () => {
      await previous?.catch(() => {});
      const remaining = (this.apiCooldown.get(provider) ?? 0) - this.now();
      if (remaining > 0) throw new StockApiRateLimitError(`${providerLabel(provider)}: исчерпан лимит запросов, повторите через ${Math.ceil(remaining / 1000)} сек.`, remaining);
      return this.requestJson(url, provider, headers);
    })();
    this.apiQueues.set(provider, run);
    try { return await run; } finally { if (this.apiQueues.get(provider) === run) this.apiQueues.delete(provider); }
  }

  private async requestJson(url: URL, provider: StockProvider, headers?: HeadersInit): Promise<unknown> {
    let response: Response | undefined;
    let causeCode: string | undefined;
    for (let attempt = 1; attempt <= NETWORK_ATTEMPTS; attempt += 1) {
      try {
        response = await this.providerFetch(provider, url, { headers, signal: AbortSignal.timeout(30_000) });
      } catch (error) {
        // URL Pixabay содержит ключ в query string, поэтому наружу отдаём только безопасный host и код причины.
        causeCode = safeCauseCode(error);
        if (attempt < NETWORK_ATTEMPTS) {
          await this.sleep(retryDelay(attempt, null));
          continue;
        }
        throw new Error(
          `${providerLabel(provider)} не отвечает `
          + `(host=${safeHost(url)}${causeCode ? `, code=${causeCode}` : ""}). Выполнено ${NETWORK_ATTEMPTS} попытки`
        );
      }
      if (response.ok) break;
      if (response.status === 429) {
        const now=this.now();
        const retryAfter = response.headers.get("retry-after");
        const requested = retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter ?? "") - now;
        const waitMs = Math.max(1000, Number.isFinite(requested) ? requested : 60000);
        // The last successful response may have announced a longer reset than
        // this 429's generic Retry-After. Keep the actual quota boundary.
        const until=Math.max(this.apiCooldown.get(provider)??0,now+waitMs);
        this.apiCooldown.set(provider,until);
        await response.body?.cancel();
        await this.persistCache().catch(()=>undefined);
        const remaining=until-now;
        throw new StockApiRateLimitError(`${providerLabel(provider)}: исчерпан лимит запросов, повторите через ${Math.ceil(remaining/1000)} сек. (host=${safeHost(url)}, status=429)`, remaining);
      }
      if (isRetryableStatus(response.status) && attempt < NETWORK_ATTEMPTS) {
        await this.sleep(retryDelay(attempt, response.headers.get("retry-after")));
        continue;
      }
      throw this.httpError(provider, response.status, response.headers.get("retry-after"), "api", url);
    }
    if (!response) throw new Error(`${providerLabel(provider)} не отвечает (host=${safeHost(url)})`);
    const remaining=Number(response.headers.get('x-ratelimit-remaining'));
    const reset=Number(response.headers.get('x-ratelimit-reset'));
    if(response.headers.has('x-ratelimit-remaining')&&Number.isFinite(remaining)&&remaining<=0
      &&Number.isFinite(reset)&&reset>0){
      // Pexels sends a Unix timestamp; Pixabay sends seconds until reset.
      const until=provider==='pexels'?reset*1000:this.now()+reset*1000;
      if(until>this.now()&&until-this.now()<=32*24*3600_000)
        this.apiCooldown.set(provider,Math.max(this.apiCooldown.get(provider)??0,until));
    }
    try {
      return await response.json();
    } catch {
      throw new Error(`${providerLabel(provider)} вернул некорректный ответ`);
    }
  }

  private httpError(
    provider: StockProvider,
    status: number,
    retryAfter: string | null,
    endpoint: "api" | "download",
    url: URL
  ): Error {
    const name = providerLabel(provider);
    const diagnostic = `host=${safeHost(url)}, status=${status}`;
    if (status === 401 || status === 403) {
      return endpoint === "api"
        ? new Error(`${name}: API-ключ недействителен или у него нет доступа (${diagnostic})`)
        : new Error(`${name}: CDN отказал в скачивании файла; попробуйте другой материал (${diagnostic})`);
    }
    if (status === 429) return new Error(`${name}: исчерпан лимит запросов${retryAfter ? `, повторите через ${retryAfter} сек.` : ""} (${diagnostic})`);
    if (status === 400 && endpoint === "api") return new Error(`${name}: проверьте поисковый запрос (${diagnostic})`);
    if (status >= 500) return new Error(`${name} временно недоступен после ${NETWORK_ATTEMPTS} попыток (${diagnostic})`);
    return new Error(`${name} вернул ошибку HTTP ${status} (${diagnostic})`);
  }

  private async providerFetch(provider: StockProvider, input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const readProxy = this.store.proxyUrl;
    const proxyUrl = typeof readProxy === "function" ? await readProxy.call(this.store, provider) : undefined;
    const proxy = parseProxyUrl(proxyUrl);
    return proxy ? this.proxyFetcher(input, init, proxy) : this.fetcher(input, init);
  }

  private async loadCache(): Promise<void> {
    if (this.cacheLoaded) return;
    this.cacheLoaded = true;
    if (!this.cachePath) return;
    try {
      const parsed = JSON.parse(await readFile(this.cachePath, "utf8")) as { entries?: Array<[string, CachedSearch]>; cooldowns?: Partial<Record<StockProvider, number>> };
      for (const [key, value] of parsed.entries ?? []) {
        if (value?.expiresAt > this.now() && value.value && Array.isArray(value.value.items)) this.cache.set(key, value);
      }
      for(const provider of ['pexels','pixabay'] as const){
        const until=parsed.cooldowns?.[provider];
        if(typeof until==='number'&&Number.isFinite(until)&&until>this.now())this.apiCooldown.set(provider,until);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.cache.clear();
    }
  }

  private async persistCache(): Promise<void> {
    if (!this.cachePath) return;
    const now = this.now();
    const entries = [...this.cache.entries()].filter(([, value]) => value.expiresAt > now).slice(-200);
    const cooldowns=Object.fromEntries([...this.apiCooldown].filter(([,until])=>until>now));
    await atomicWrite(this.cachePath, JSON.stringify({ version: 1, entries, cooldowns }, null, 2));
  }
}
