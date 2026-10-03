import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DocumentaryCandidate, DocumentarySearchInput, DocumentarySearchResult } from "@gold-work/shared";
import { StockApiRateLimitError, type StockClient } from "./stock-client.js";
import { atomicWrite } from "./fs-utils.js";
import type { DocumentaryYouTube } from "./documentary-youtube.js";
import { documentaryCandidateKey } from "./documentary-reuse.js";
import {recordDiagnosticEvent} from './diagnostics.js';

type Fetcher = typeof globalThis.fetch;
type RecordValue = Record<string, unknown>;
export const documentarySearchUnavailable = (message?: string): boolean => Boolean(message && /\b(?:429|403|quota|ECONNRESET|ETIMEDOUT)\b|исчерпан.*лимит|исчерпал.*квот|ограничил|fetch failed|тайм.?аут|недоступ/iu.test(message));
const record = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const string = (value: unknown): string => typeof value === "string" ? value : "";
export const documentaryPlainText = (value: unknown): string => string(value).replace(/<[^>]*>/g, " ")
  .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
const safeHttps = (value: unknown): string => { try { const url = new URL(string(value)); return url.protocol === "https:" && !url.username && !url.password ? url.toString() : ""; } catch { return ""; } };
export function documentaryLicense(value: unknown): { url: string; label: string; rights: DocumentaryCandidate["rights"] } {
  try {
    const url = new URL(string(value));
    if (!["creativecommons.org", "www.creativecommons.org"].includes(url.hostname)) return { url: safeHttps(value), label: "Условия не подтверждены", rights: "unknown" };
    if (url.protocol === "http:") url.protocol = "https:";
    if (!safeHttps(url.toString())) throw new Error("Invalid license URL");
    const publicDomain = /^\/(?:publicdomain\/|licenses\/publicdomain\/)/i.test(url.pathname);
    const licensed = /^\/licenses\/by(?:-sa)?\/[\d.]+\/?$/i.test(url.pathname);
    return { url: url.toString(), label: publicDomain ? "Public domain (source declaration)" : licensed ? "Creative Commons Attribution" : "Условия не подтверждены", rights: publicDomain ? "public-domain" : licensed ? "licensed" : "unknown" };
  } catch { return { url: "", label: "Условия не подтверждены", rights: "unknown" }; }
}
const canonicalWords = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const metadataHas = (text: string, term: string) => ` ${canonicalWords(text)} `.includes(` ${canonicalWords(term)} `);
export function documentaryExactQuery(input: DocumentarySearchInput): string {
  let query = input.query.replace(/[“”]/g, '"').trim();
  for (const entity of [...(input.entities ?? [])].sort((a, b) => b.length - a.length)) {
    const index = query.toLowerCase().indexOf(entity.toLowerCase());
    if (index >= 0) {
      // Do not quote an overlapping entity inside an already quoted proper name.
      if (query.slice(0, index).split('"').length % 2 === 0) continue;
      query = `${query.slice(0, index)}"${query.slice(index, index + entity.length)}"${query.slice(index + entity.length)}`;
    }
  }
  return query;
}

export function rankDocumentaryCandidates(candidates: DocumentaryCandidate[], input: DocumentarySearchInput): DocumentaryCandidate[] {
  const unique = new Set<string>();
  return candidates.filter(candidate => {
    const key = documentaryCandidateKey(candidate);
    if (unique.has(key)) return false;
    unique.add(key); return true;
  }).map(candidate => {
    const metadata = `${candidate.title} ${candidate.description} ${candidate.capturedAt ?? ""}`;
    const missing = (input.entities ?? []).filter(entity => !metadataHas(metadata, entity));
    const years = (input.years ?? []).filter(year => !metadataHas(metadata, year));
    const titleShips = candidate.title.match(/\b[A-Z][a-z]+ of the Seas\b/g) ?? [];
    const conflictingShip = input.entities?.some(entity => /of the Seas$/i.test(entity)) && titleShips.length > 0 && !titleShips.some(ship => input.entities?.some(entity => metadataHas(ship, entity)));
    return { ...candidate, match: (input.entities?.length && !missing.length && !conflictingShip ? "exact-metadata" : "unverified") as DocumentaryCandidate["match"],
      concerns: [...new Set([...candidate.concerns,
        ...missing.map(entity => `В метаданных не подтверждён объект: ${entity}`),
        ...years.map(year => `Год ${year} требует проверки`),
        ...(conflictingShip ? [`В названии указан другой корабль: ${titleShips.join(", ")}`] : []),
        "Содержание изображения / фрагмента нужно проверить визуально",
        ...(candidate.rights === "unknown" ? ["Условия использования не подтверждены"] : [])])]
    };
  }).sort((a, b) => Number(b.match === "exact-metadata") - Number(a.match === "exact-metadata") || a.concerns.length - b.concerns.length);
}

function commonsAttributionLicense(candidate: DocumentaryCandidate): DocumentaryCandidate {
  // The exact Commons license tag refers to Template:Attribution_only_license,
  // which explicitly permits derivatives and commercial reuse with credit.
  // Do not infer this from free-form "attribution required" descriptions.
  if (candidate.provider === "commons" && candidate.rights === "unknown" && candidate.license === "Attribution"
    && candidate.author.trim() && /^https:\/\/commons\.wikimedia\.org\/wiki\/File[:%]/i.test(candidate.pageUrl)) {
    return { ...candidate, rights: "licensed", licenseUrl: "https://commons.wikimedia.org/wiki/Template:Attribution_only_license" };
  }
  return candidate;
}

export function commonsCandidates(payload: unknown, query: string): DocumentaryCandidate[] {
  return list(record(record(payload).query).pages).flatMap<DocumentaryCandidate>(pageValue => {
    const page = record(pageValue), info = record(list(page.imageinfo)[0]), ext = record(info.extmetadata);
    const meta = (key: string) => documentaryPlainText(record(ext[key]).value);
    const mime = string(info.mime);
    // Commons supplies a server-rendered PNG for SVG. Never feed downloaded
    // SVG markup to the renderer or upscale a tiny raster as if it were HD.
    const vector = mime === 'image/svg+xml';
    const rendered = safeHttps(info.thumburl);
    const vectorRaster = vector && /\.png(?:\?|$)/i.test(rendered) && Number(info.thumbwidth)>=1200 && Number(info.thumbheight)>=350;
    const kind = /^video\//.test(mime) ? "video" : /^image\/(?:jpeg|png|webp|tiff)/.test(mime)||vectorRaster ? "image" : undefined;
    const downloadUrl = vectorRaster ? rendered : safeHttps(info.url), pageUrl = safeHttps(info.descriptionurl);
    if (!kind || !downloadUrl || !pageUrl) return [];
    const license = meta("LicenseShortName") || meta("UsageTerms");
    const rights = /^(?:CC0|Public domain|PDM)/i.test(license) ? "public-domain" as const
      : /^(?:CC BY(?:-SA)? [\d.]+|FAL|GFDL)$/i.test(license) ? "licensed" as const : "unknown" as const;
    const author = meta("Artist");
    return [{ id: `commons:${String(page.pageid)}`, provider: "commons" as const, kind, title: string(page.title).replace(/^File:/, ""),
      description: meta("ImageDescription"), pageUrl, downloadUrl, previewUrl: safeHttps(info.thumburl) || undefined,
      author, license, licenseUrl: safeHttps(record(ext.LicenseUrl).value), rights,
      attribution: [author, meta("Credit"), license, pageUrl].filter(Boolean).join(" · "), width: Number(vectorRaster?info.thumbwidth:info.width) || undefined, height: Number(vectorRaster?info.thumbheight:info.height) || undefined,
      durationSeconds: Number(info.duration) || undefined, bytes: vectorRaster?undefined:Number(info.size) || undefined, query, retrievedAt: new Date().toISOString(), capturedAt: meta("DateTimeOriginal") || meta("DateTime") || undefined, match: "unverified" as const, concerns: vectorRaster?['PNG-визуализация исходной SVG-схемы Wikimedia Commons; содержание требует проверки']:[] }];
  }).map(commonsAttributionLicense);
}

export class DocumentarySearch {
  private inFlight = new Map<string, Promise<DocumentaryCandidate[]>>();
  private cooldown = new Map<string, number>();
  private quotaBlocked = new Map<string,number>();
  private providerWork = new Map<string,Set<Promise<DocumentaryCandidate[]>>>();
  constructor(private readonly stock?: Pick<StockClient, "search">, private readonly fetcher: Fetcher = globalThis.fetch,
    private readonly cachePath?: string, private readonly local: (query: string) => Promise<DocumentaryCandidate[]> = async () => [],
    private readonly youtube?: Pick<DocumentaryYouTube, "search">) {}

  async search(input: DocumentarySearchInput, licensedOnly = false): Promise<DocumentarySearchResult> {
    if (!input || typeof input.query !== "string" || input.query.trim().length < 2 || input.query.length > 240) throw new Error("Введите запрос от 2 до 240 символов");
    if (input.kind !== "image" && input.kind !== "video") throw new Error("Некорректный тип медиа");
    const providers = [...new Set<DocumentaryCandidate["provider"]>(input.providers ?? ["commons", "internet-archive", "loc", "local"])];
    if (providers.some(provider => !["commons", "internet-archive", "loc", "pexels", "pixabay", "youtube", "local"].includes(provider))) throw new Error("Этот источник открывается отдельно: импортируйте разрешённый оригинал");
    const candidates: DocumentaryCandidate[] = [], sources: DocumentarySearchResult["sources"] = [];
    // Independent adapters fail independently. At most one request per provider/key is in flight.
    await Promise.all(providers.map(async provider => {
      try {
        const found = await this.cached(provider, provider === "commons" || provider === "internet-archive" || provider === "loc" ? documentaryExactQuery(input) : input.query.replace(/["“”]/g, "").trim(), input.kind, licensedOnly);
        const matching = found.filter(candidate => candidate.kind === input.kind);
        candidates.push(...matching); sources.push({ provider, count: matching.length });
      } catch (error) { sources.push({ provider, count: 0, error: error instanceof Error ? error.message : String(error) }); }
    }));
    return { candidates: rankDocumentaryCandidates(candidates, input), sources };
  }

  private async cached(provider: string, query: string, kind: string, licensedOnly: boolean): Promise<DocumentaryCandidate[]> {
    if (provider === "local") return this.local(query);
    // LOC currently exposes only unknown-rights candidates. Automatic
    // selection cannot use them, but manual discovery still can.
    if (licensedOnly && provider === "loc") return [];
    const key = createHash("sha256").update(JSON.stringify([provider === "internet-archive" ? 5 : provider==='commons'?4:["pexels", "pixabay", "youtube"].includes(provider) ? 3 : 2, provider, query, kind,
      ...(licensedOnly && provider === "internet-archive" ? ["licensed-only"] : [])])).digest("hex");
    const existing = this.inFlight.get(key); if (existing) return existing;
    const work = (async () => {
      const file = this.cachePath ? join(this.cachePath, `${key}.json`) : undefined;
      let staleYouTube:DocumentaryCandidate[]|undefined;
      if (file) {
        try {
          const data = JSON.parse(await readFile(file, "utf8"));
          if (data.expiresAt > Date.now() && Array.isArray(data.candidates)) return (data.candidates as DocumentaryCandidate[]).map(commonsAttributionLicense);
          // Search quota can expire hours after an otherwise valid result.
          // These are discovery hints only: preview/download recheck YouTube's
          // current public Creative Commons status before using any original.
          if(provider==='youtube'&&Number.isFinite(data.expiresAt)&&data.expiresAt>Date.now()-7*24*3600_000&&Array.isArray(data.candidates))
            staleYouTube=(data.candidates as DocumentaryCandidate[]).filter(candidate=>candidate.provider==='youtube'&&candidate.kind==='video'&&candidate.rights==='licensed'
              &&/^youtube:[a-zA-Z0-9_-]{11}$/.test(candidate.id)&&candidate.pageUrl===`https://www.youtube.com/watch?v=${candidate.id.slice(8)}`);
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) throw error; }
      }
      const useStale=(reason:string)=>{
        if(!staleYouTube?.length)return undefined;
        recordDiagnosticEvent('warn','documentary.search.stale-cache',{provider,kind,candidates:staleYouTube.length,reason});
        return staleYouTube;
      };
      if ((this.quotaBlocked.get(provider)??0)>Date.now()) {const fallback=useStale('quota');if(fallback)return fallback;throw new Error("Источник исчерпал суточную квоту поиска. Проверка доступности — через час; сохранённые результаты доступны.");}
      if ((this.cooldown.get(provider) ?? 0) > Date.now()) {const fallback=useStale('cooldown');if(fallback)return fallback;throw new Error("Источник ограничил запросы. Повторите через несколько минут или выберите другой источник.");}
      const active=this.providerWork.get(provider)??new Set<Promise<DocumentaryCandidate[]>>();this.providerWork.set(provider,active);
      // Four scene workers share this cap. Parallel discovery must not multiply
      // requests to the same provider or bypass the existing cache/cooldown.
      while(active.size>=4)await Promise.race([...active].map(job=>job.catch(()=>[])));
      if ((this.quotaBlocked.get(provider)??0)>Date.now()) {const fallback=useStale('quota');if(fallback)return fallback;throw new Error("Источник исчерпал суточную квоту поиска. Проверка доступности — через час; сохранённые результаты доступны.");}
      if ((this.cooldown.get(provider) ?? 0) > Date.now()) {const fallback=useStale('cooldown');if(fallback)return fallback;throw new Error("Источник ограничил запросы. Повторите через несколько минут или выберите другой источник.");}
      const job=this.providerSearch(provider,query,kind,licensedOnly);active.add(job);
      let result:DocumentaryCandidate[];
      try { result=await job; }
      catch (error) {
        const message=error instanceof Error?error.message:String(error);
        // Adapters (YouTube/stock) do not go through json(). Respect their
        // refusals too, instead of retrying the same depleted service per scene.
        if (/quotaExceeded|dailyLimitExceeded|quota.*(?:per day|daily)|суточн.*квот/iu.test(message)) this.quotaBlocked.set(provider,Date.now()+3600000);
        else if (error instanceof StockApiRateLimitError) this.cooldown.set(provider,Math.max(this.cooldown.get(provider)??0,Date.now()+error.retryAfterMs));
        else if (/\b429\b|исчерпан.*лимит/iu.test(message)) this.cooldown.set(provider,Date.now()+120000);
        const fallback=useStale('provider-error');
        if(fallback)return fallback;
        throw error;
      } finally { active.delete(job); }
      if (file) await atomicWrite(file, JSON.stringify({ expiresAt: Date.now() + 24 * 3600_000, candidates: result }));
      return result;
    })();
    this.inFlight.set(key, work);
    try { return await work; } finally { this.inFlight.delete(key); }
  }

  private async json(url: URL, provider: string): Promise<unknown> {
    const response = await this.fetcher(url, { headers: { "User-Agent": "GoldWorkStudio/0.2 (local documentary editor)", Accept: "application/json" }, signal: AbortSignal.timeout(25000) });
    if (response.status === 429 || response.status === 403) {
      this.cooldown.set(provider, Date.now() + 120000);
      throw new Error(`Источник ограничил доступ (HTTP ${response.status}); результат сохранён у других источников.`);
    }
    if (!response.ok) throw new Error(`Источник недоступен (HTTP ${response.status})`);
    const payload = await response.json();
    if (record(payload).error) throw new Error(`Ошибка источника: ${(documentaryPlainText(record(record(payload).error).info) || documentaryPlainText(record(payload).error)).slice(0, 300)}`);
    return payload;
  }

  private async providerSearch(provider: string, query: string, kind: string, licensedOnly: boolean): Promise<DocumentaryCandidate[]> {
    if (provider === "youtube") {
      if (kind !== "video") return [];
      if (!this.youtube) throw new Error("Источник YouTube недоступен");
      return this.youtube.search(query);
    }
    if (provider === "commons") {
      const url = new URL("https://commons.wikimedia.org/w/api.php");
      for (const [key, value] of Object.entries({ action: "query", format: "json", formatversion: "2", generator: "search", gsrsearch: kind === "video" ? `${query} filetype:video` : query,
        gsrnamespace: "6", gsrlimit: "24", prop: "imageinfo", iiprop: "url|extmetadata|size|mime", iiurlwidth: "640" })) url.searchParams.set(key, value);
      const payload=await this.json(url,provider);
      const pages=list(record(record(payload).query).pages);
      const vectors=kind==='image'?pages.filter(page=>string(record(list(record(page).imageinfo)[0]).mime)==='image/svg+xml'):[];
      if(vectors.length){
        const rasterUrl=new URL('https://commons.wikimedia.org/w/api.php');
        for(const [key,value] of Object.entries({action:'query',format:'json',formatversion:'2',pageids:vectors.map(page=>String(record(page).pageid)).join('|'),
          prop:'imageinfo',iiprop:'url|size|mime',iiurlwidth:'1600'}))rasterUrl.searchParams.set(key,value);
        // One bounded metadata request for every SVG in this search. Original
        // raster thumbnails keep their small size; no paid model call is added.
        const rendered=await this.json(rasterUrl,provider).catch(error=>{
          recordDiagnosticEvent('warn','documentary.search.svg-preview-unavailable',{provider,message:String(error).slice(0,250)});
          return undefined;
        });
        const rasterPages=list(record(record(rendered).query).pages);
        for(const page of vectors){
          const replacement=rasterPages.find(item=>record(item).pageid===record(page).pageid);
          if(replacement){
            const original=record(list(record(page).imageinfo)[0]);
            record(page).imageinfo=[{...original,...record(list(record(replacement).imageinfo)[0])}];
          }
        }
      }
      return commonsCandidates(payload, query);
    }
    if (provider === "pexels" || provider === "pixabay") {
      if (!this.stock) throw new Error("Stock API не настроен");
      const results = await this.stock.search({ provider, query: query.slice(0, 100), mediaType: kind as "image" | "video", perPage: 20 });
      return results.items.map(asset => ({ id: `${provider}:${asset.id}`, provider, kind: asset.mediaType, title: asset.description || `${provider} ${asset.mediaType} ${asset.id}`,
        description: asset.description || "", pageUrl: asset.pageUrl, downloadUrl: asset.downloadUrl, previewUrl: asset.previewUrl,
        author: asset.author, attribution: asset.attribution, license: provider === "pexels" ? "Pexels License" : "Pixabay Content License", licenseUrl: provider === "pexels" ? "https://www.pexels.com/license/" : "https://pixabay.com/service/license-summary/",
        rights: "licensed", query, retrievedAt: new Date().toISOString(), width: asset.width, height: asset.height, durationSeconds: asset.durationSeconds,
        match: "unverified", concerns: [] }));
    }
    if (provider === "loc") {
      const url = new URL(kind === "video" ? "https://www.loc.gov/film-and-videos/" : "https://www.loc.gov/photos/");
      url.searchParams.set("fo", "json"); url.searchParams.set("q", query); url.searchParams.set("c", "16");
      const payload = record(await this.json(url, provider));
      return list(payload.results).flatMap(value => {
        const item = record(value), images = list(item.image_url).map(string).filter(url => /\.jpe?g(?:\?|$)/i.test(url));
        const url = images.at(-1)?.replace(/^http:/, "https:");
        if (!url || kind !== "image") return [];
        return [{ id: `loc:${string(item.id)}`, provider: "loc" as const, kind: "image" as const, title: documentaryPlainText(item.title),
          description: list(item.description).map(documentaryPlainText).join(" "), pageUrl: safeHttps(item.id) || string(item.id).replace(/^http:/, "https:"),
          downloadUrl: url, previewUrl: images[0]?.replace(/^http:/, "https:"), author: list(item.contributor).map(string).join(", "),
          license: "Проверьте Rights & Access на странице материала", licenseUrl: string(item.id), rights: "unknown" as const,
          attribution: [documentaryPlainText(item.title), "Library of Congress", string(item.id)].join(" · "), query,
          retrievedAt: new Date().toISOString(), match: "unverified" as const,
          concerns: item.access_restricted ? ["Ограниченный доступ; доступное изображение может быть только миниатюрой"] : [] }];
      });
    }
    if (provider === "internet-archive") {
      const url = new URL("https://archive.org/advancedsearch.php");
      const terms = query.replace(/[():]/g, " ").match(/"[^"]+"|\S+/g) ?? [];
      const phrase = terms.join(" AND ");
      const topicQuery = `(title:(${phrase}) OR description:(${phrase}) OR subject:(${phrase})) AND mediatype:${kind === "video" ? "movies" : "image"}`;
      // Fetch declared reusable works first; a page of unlicensed TV captures must not
      // exhaust the metadata budget before licensed footage can be considered.
      const rightsQuery = `((licenseurl:http*publicdomain* OR licenseurl:http*by* OR rights:"Public Domain" OR rights:CC0) AND NOT licenseurl:http*by-nc* AND NOT licenseurl:http*by-nd*)`;
      url.searchParams.set("q", `${topicQuery} AND ${rightsQuery}`);
      for (const field of ["identifier", "title", "description", "creator", "licenseurl"]) url.searchParams.append("fl[]", field);
      url.searchParams.set("rows", "6"); url.searchParams.set("output", "json");
      let payload = record(await this.json(url, provider));
      if (!licensedOnly && !list(record(payload.response).docs).length) {
        // Keep manual discovery available when the index has no rights declaration.
        // Individual metadata is still checked below; unknown rights stay unknown.
        url.searchParams.set("q", topicQuery);
        payload = record(await this.json(url, provider));
      }
      const candidates: DocumentaryCandidate[] = [];
      const items = list(record(payload.response).docs);
      const errors: unknown[] = [];
      for (let offset = 0; offset < items.length; offset += 3) {
        const results = await Promise.allSettled(items.slice(offset, offset + 3).map(async itemValue => {
        const item = record(itemValue), id = string(item.identifier);
        if (!id || !/^[a-zA-Z0-9_.-]+$/.test(id)) return;
        const metadata = record(await this.json(new URL(`https://archive.org/metadata/${encodeURIComponent(id)}`), provider));
        const metadataFields = record(metadata.metadata);
        const parsedLicense = documentaryLicense(string(item.licenseurl) || list(item.licenseurl)[0] || string(metadataFields.licenseurl) || list(metadataFields.licenseurl)[0]);
        const licenseUrl = parsedLicense.url;
        const rightsStatement = documentaryPlainText(metadataFields.rights);
        const license = parsedLicense.rights !== "unknown" ? parsedLicense.label : /^(?:Public Domain|CC0)(?:\s|$)/i.test(rightsStatement) ? "Public domain (source declaration)" : "Условия не подтверждены";
        const file = list(metadata.files).map(record).filter(file => kind === "video" ? /\.mp4$/i.test(string(file.name)) : /\.jpe?g$/i.test(string(file.name)))
          .filter(file => Number(file.size) > 0 && Number(file.size) < 750 * 1024 * 1024 && !/(?:thumb|itemimage|__ia_thumb)/i.test(string(file.name)))
          .sort((a, b) => Number(/512kb|256kb|240p|160p|small/i.test(string(a.name))) - Number(/512kb|256kb|240p|160p|small/i.test(string(b.name))) || Number(b.source === "original") - Number(a.source === "original") || Number(b.size) - Number(a.size))[0];
        if (!file) return;
        const pageUrl = `https://archive.org/details/${encodeURIComponent(id)}`;
        candidates.push({ id: `internet-archive:${id}:${string(file.name)}`, provider: "internet-archive", kind: kind as "image" | "video", title: documentaryPlainText(item.title),
          description: [...new Set([documentaryPlainText(metadataFields.description) || documentaryPlainText(item.description), documentaryPlainText(metadataFields.shotlist)].filter(Boolean))].join("\n").slice(0, 16000), pageUrl, downloadUrl: `https://archive.org/download/${encodeURIComponent(id)}/${string(file.name).split("/").map(encodeURIComponent).join("/")}`,
          previewUrl: `https://archive.org/services/img/${encodeURIComponent(id)}`, author: documentaryPlainText(item.creator) || list(item.creator).map(documentaryPlainText).join(", "), license, licenseUrl,
          rights: license.startsWith("Public domain") ? "public-domain" : license.startsWith("Creative Commons") ? "licensed" : "unknown", attribution: `${documentaryPlainText(item.creator)} · ${pageUrl} · ${licenseUrl}`,
          bytes: Number(file.size) || undefined, query, retrievedAt: new Date().toISOString(), match: "unverified", concerns: ["Проверьте выбранный диапазон: архивный файл может содержать несколько сюжетов"] });
        }));
        errors.push(...results.flatMap(result => result.status === "rejected" ? [result.reason] : []));
      }
      if (!candidates.length && errors.length) throw errors[0];
      return licensedOnly ? candidates.filter(candidate => candidate.rights !== "unknown") : candidates;
    }
    return [];
  }
}
