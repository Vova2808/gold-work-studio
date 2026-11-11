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
/** Archive titles often split a trailing model letter: "RC211 V" is RC211V. */
export const documentaryFuseModelSuffix = (value: string): string => value.replace(/\b([A-Za-z]{1,5}\d{2,})\s+([A-Za-z])\b/g, "$1$2");
const metadataHas = (text: string, term: string) => ` ${canonicalWords(documentaryFuseModelSuffix(text))} `
  .includes(` ${canonicalWords(documentaryFuseModelSuffix(term))} `);

/** A requested name appearing only as a production company is not a subject
 * match. Sparse captions stay eligible; this requires an explicit credit. */
function documentaryStudioCreditOnly(candidate:DocumentaryCandidate,input:DocumentarySearchInput):boolean {
  const requested=[input.query,...(input.entities??[])].map(canonicalWords);
  const metadata=` ${canonicalWords(`${candidate.title} ${candidate.description}`)} `;
  const names=new Set<string>();
  for(const text of requested){
    const words=text.split(' ');
    for(let length=Math.min(5,words.length);length>=2;length--)
      for(let start=0;start+length<=words.length;start++)names.add(words.slice(start,start+length).join(' '));
    if(words.length===1&&text.length>=3)names.add(text);
  }
  for(const name of names){
    const roles=['studio','studios','productions','production company'];
    const credits=roles.map(role=>` ${name} ${role} `).filter(credit=>metadata.includes(credit));
    if(!credits.length||credits.some(credit=>requested.some(text=>` ${text} `.includes(credit))))continue;
    const subject=credits.reduce((text,credit)=>text.replaceAll(credit,' '),metadata);
    if(subject.includes(` ${name} `))continue;
    const nameWords=new Set(name.split(' '));
    const generic=/^(?:the|and|with|from|this|that|video|videos|film|films|footage|documentary|official|historic|modern|preserved|view|illustration)$/;
    const cues=requested.flatMap(text=>text.split(' ')).filter(word=>word.length>=4&&!nameWords.has(word)&&!generic.test(word));
    if(cues.some(word=>subject.includes(` ${word} `)))continue;
    return true;
  }
  return false;
}

/** Only explicit foreign subjects in a maritime search. Missing ship words
 * alone are not a contradiction; mixed subjects and OR alternatives survive. */
function documentaryMaritimeContradiction(candidate:DocumentaryCandidate,input:DocumentarySearchInput):string|undefined {
  const requested=[input.query,...(input.entities??[])].join(' ');
  const maritime=/\b(?:ships?|vessels?|boats?|yachts?|sailboats?|clippers?|sails?|rigging|hulls?|winch(?:es)?|capstans?|cargo hold|lower deck)\b/iu;
  if(!maritime.test(requested)||/\bor\b|(?:^|\s)(?:или|либо)(?:\s|$)/iu.test(requested))return;
  const metadata=`${candidate.title} ${candidate.description}`;
  if(maritime.test(metadata))return;
  const foreign=[
    {name:'crustacean',pattern:/\b(?:crabs?|lobsters?|crustaceans?)\b/iu},
    {name:'kitchen appliance',pattern:/\b(?:toasters?|kitchen appliances?)\b/iu},
    {name:'urban alley',pattern:/\balley(?:way)?s?\b/iu,context:/\b(?:streets?|city|urban|neighbou?rhood)\b/iu},
    {name:'aircraft',pattern:/\b(?:aircraft|airplanes?|aeroplanes?|aviation)\b/iu},
  ].filter(subject=>subject.pattern.test(metadata)&&(!subject.context||subject.context.test(metadata)));
  if(foreign.some(subject=>subject.pattern.test(requested)))return;
  return foreign[0]?.name;
}
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

/** Prefer a title phrase only for one caller-supplied image identity; an
 * explicitly quoted subject may still broaden an empty native query.
 * Neither infers a name from unquoted words or proves the depicted identity. */
type DocumentaryDiscoveryInput=DocumentarySearchInput&{visualConstraints?:string[]};
function commonsSubjectQuery(input:DocumentaryDiscoveryInput):string|undefined{
  const entities=[...new Set((input.entities??[]).map(value=>value.trim()).filter(Boolean))];
  const quoted=[...input.query.replace(/[“”]/g,'"').matchAll(/"([^"]+)"/g)].map(match=>match[1]!.trim());
  const subject=entities.length===1?entities[0]:!entities.length&&quoted.length===1
    &&(input.query.replace(/[“”]/g,'"').match(/"/g)?.length??0)===2?quoted[0]:undefined;
  if(!subject||subject.length<2||subject.length>100||!/\p{L}/u.test(subject)||/["\r\n]/.test(subject)
    ||!metadataHas(input.query,subject))return;
  // A subject-only fallback loses the very feature that distinguishes suitable
  // illustrations (e.g. sailcloth from bare rigging). Keep content terms from
  // the script-grounded action/condition, not optional style or date hints.
  // OR broadens retrieval only; every original requirement still goes to vision.
  const boilerplate=new Set(['the','a','an','and','or','of','in','on','at','to','for','with','from','by','is','are','be','being',
    'all','fully','full','set','spread','visible','show','shows','showing','shown','view','image','photograph','photo','footage',
    'и','или','на','в','с','со','для','из','все','полностью','виден','видна','видны','изображение','фотография']);
  const identityWords=new Set(subject.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu)??[]);
  const terms=[...new Set((input.visualConstraints??[]).join(' ').normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu)??[])]
    .filter(word=>word.length>1&&!boilerplate.has(word)&&!identityWords.has(word)).slice(0,8);
  const titlePrefix=input.kind==='image'&&entities.length===1?'intitle:':'';
  return `${titlePrefix}"${subject}"`+(terms.length?` (${terms.join(' OR ')})`:'');
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

export function commonsCandidates(payload: unknown, query: string, automatic=false): DocumentaryCandidate[] {
  return list(record(record(payload).query).pages).flatMap<DocumentaryCandidate>(pageValue => {
    const page = record(pageValue), info = record(list(page.imageinfo)[0]), ext = record(info.extmetadata);
    const meta = (key: string) => documentaryPlainText(record(ext[key]).value);
    const mime = string(info.mime);
    // Commons supplies a server-rendered PNG for SVG. Never feed downloaded
    // SVG markup to the renderer or upscale a tiny raster as if it were HD.
    const vector = mime === 'image/svg+xml';
    const rendered = safeHttps(info.thumburl);
    const vectorRaster = vector && /\.png(?:\?|$)/i.test(rendered) && Number(info.thumbwidth)>=1200 && Number(info.thumbheight)>=350;
    let rasterCopy=false;
    if(automatic&&!vector&&/^image\/(?:jpeg|png|webp|tiff)/.test(mime)&&rendered){
      const original=new URL(safeHttps(info.url)||'https://invalid.example/'),thumb=new URL(rendered);
      const file=original.pathname.match(/^\/wikipedia\/commons\/([a-f0-9]\/[^/]+\/[^/]+)$/i)?.[1];
      rasterCopy=original.hostname==='upload.wikimedia.org'&&Boolean(file)
        &&['upload.wikimedia.org','thumb.wikimedia.org'].includes(thumb.hostname)
        &&thumb.pathname.startsWith(`/wikipedia/commons/thumb/${file}/`)
        &&Number(info.thumbwidth)>=1920&&Number(info.thumbheight)>=1080
        &&Number(info.thumbwidth)<=Number(info.width)&&Number(info.thumbheight)<=Number(info.height)
        &&Math.abs(Number(info.width)/Number(info.height)-Number(info.thumbwidth)/Number(info.thumbheight))<.01;
    }
    const kind = /^video\//.test(mime) ? "video" : /^image\/(?:jpeg|png|webp|tiff)/.test(mime)||vectorRaster ? "image" : undefined;
    const workingRaster=vectorRaster||rasterCopy;
    const downloadUrl = workingRaster ? rendered : safeHttps(info.url), pageUrl = safeHttps(info.descriptionurl);
    if (!kind || !downloadUrl || !pageUrl) return [];
    const license = meta("LicenseShortName") || meta("UsageTerms");
    const rights = /^(?:CC0|Public domain|PDM)/i.test(license) ? "public-domain" as const
      : /^(?:CC BY(?:-SA)? [\d.]+|FAL|GFDL)$/i.test(license) ? "licensed" as const : "unknown" as const;
    const author = meta("Artist");
    return [{ id: `commons:${String(page.pageid)}`, provider: "commons" as const, kind, title: string(page.title).replace(/^File:/, ""),
      description: meta("ImageDescription"), pageUrl, downloadUrl, previewUrl: safeHttps(info.thumburl) || undefined,
      author, license, licenseUrl: safeHttps(record(ext.LicenseUrl).value), rights,
      attribution: [author, meta("Credit"), license, pageUrl].filter(Boolean).join(" · "), width: Number(workingRaster?info.thumbwidth:info.width) || undefined, height: Number(workingRaster?info.thumbheight:info.height) || undefined,
      durationSeconds: Number(info.duration) || undefined, bytes: workingRaster?undefined:Number(info.size) || undefined, query, retrievedAt: new Date().toISOString(), capturedAt: meta("DateTimeOriginal") || meta("DateTime") || undefined, match: "unverified" as const, concerns: vectorRaster?['PNG-визуализация исходной SVG-схемы Wikimedia Commons; содержание требует проверки']:[] }];
  }).map(commonsAttributionLicense);
}

export class DocumentarySearch {
  private webWarnings=new Map<string,string>();
  private webWarningKey(query:string,kind:string){return JSON.stringify([query.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase(),kind]);}
  private inFlight = new Map<string, Promise<DocumentaryCandidate[]>>();
  private cooldown = new Map<string, number>();
  private quotaBlocked = new Map<string,number>();
  private providerWork = new Map<string,Set<Promise<DocumentaryCandidate[]>>>();
  private signalIds = new WeakMap<AbortSignal,number>();
  private nextSignalId = 0;
  private commonsNativeCache=new Map<string,{expiresAt:number;candidates:DocumentaryCandidate[]}>();
  private commonsNativeInFlight=new Map<string,{controller:AbortController;subscribers:number;work:Promise<DocumentaryCandidate[]>}>();
  constructor(private readonly stock?: Pick<StockClient, "search">, private readonly fetcher: Fetcher = globalThis.fetch,
    private readonly cachePath?: string, private readonly local: (query: string) => Promise<DocumentaryCandidate[]> = async () => [],
    private readonly youtube?: Pick<DocumentaryYouTube, "search">,
    private readonly web?: {search(query:string,kind?:"image"|"video",signal?:AbortSignal):Promise<DocumentaryCandidate[]>;searchWithSources?(query:string,kind?:"image"|"video",signal?:AbortSignal,source?:DocumentaryCandidate['provider']):Promise<{candidates:DocumentaryCandidate[];errors:string[]}>}) {}

  /** Earliest known source recovery; used only by unattended production retries. */
  nextRetryDelayMs(): number {
    const now = Date.now();
    const waits = [...this.cooldown.values(), ...this.quotaBlocked.values()]
      .filter(until => until > now).map(until => until - now);
    return Math.max(30_000, waits.length ? Math.min(...waits) : 60_000);
  }

  async search(input: DocumentaryDiscoveryInput, licensedOnly = false,signal?:AbortSignal,independentPublicSources=false): Promise<DocumentarySearchResult> {
    signal?.throwIfAborted();
    if (!input || typeof input.query !== "string" || input.query.trim().length < 2 || input.query.length > 240) throw new Error("Введите запрос от 2 до 240 символов");
    if (input.kind !== "image" && input.kind !== "video") throw new Error("Некорректный тип медиа");
    const requested = input.providers ?? ["pexels", "pixabay", "web", "local"];
    if (requested.some(provider => !["commons", "internet-archive", "loc", "pexels", "pixabay", "youtube", "web", "local"].includes(provider))) throw new Error("Неизвестный источник материалов");
    // Persisted source choices remain readable; new searches use the public web route.
    const providers = [...new Set<DocumentaryCandidate["provider"]>(requested.map(provider =>
      !independentPublicSources && ["commons", "internet-archive", "loc", "youtube"].includes(provider) ? "web" : provider as DocumentaryCandidate["provider"]))];
    const candidates: DocumentaryCandidate[] = [], sources: DocumentarySearchResult["sources"] = [];
    // Independent adapters fail independently. At most one request per provider/key is in flight.
    await Promise.all(providers.map(async provider => {
      let query=input.query;
      try {
        const publicSource=provider==='web'||independentPublicSources&&['commons','internet-archive','loc','youtube'].includes(provider);
        query = publicSource ? documentaryExactQuery(input) : input.query.replace(/["“”]/g, "").trim();
        // StockClient accepts at most 100 characters. Never silently remove
        // a model/year at the end, including when reading an older cache entry.
        if ((provider === 'pexels' || provider === 'pixabay') && query.length > 100) {
          throw new Error('Этот сток принимает запросы до 100 символов. Полный запрос сохранён для остальных источников; для стока используйте более короткую точную формулировку.');
        }
        const subjectQuery=independentPublicSources&&provider==='commons'?commonsSubjectQuery(input):undefined;
        const found = await this.cached(provider,query,input.kind,licensedOnly,signal,independentPublicSources,subjectQuery);
        const matching = found.filter(candidate => {
          if(candidate.kind!==input.kind)return false;
          if(documentaryStudioCreditOnly(candidate,input)){
            recordDiagnosticEvent('info','documentary.search.credit-only',{provider,candidateId:candidate.id});
            return false;
          }
          const foreign=documentaryMaritimeContradiction(candidate,input);
          if(!foreign)return true;
          recordDiagnosticEvent('info','documentary.search.foreign-subject',{provider,candidateId:candidate.id,subject:foreign});
          return false;
        });
        const warning=this.webWarnings.get(this.webWarningKey(query,input.kind)+ (independentPublicSources?':'+provider:''));
        candidates.push(...matching); sources.push({ provider, count: matching.length,...(publicSource&&warning?{error:warning}:{}) });
      } catch (error) {
        const warning=this.webWarnings.get(this.webWarningKey(query,input.kind)+(independentPublicSources?':'+provider:''));
        sources.push({ provider, count: 0, error: [warning,error instanceof Error ? error.message : String(error)].filter(Boolean).join('; ').slice(0,1600) });
      }
    }));
    return { candidates: rankDocumentaryCandidates(candidates, input), sources };
  }

  private async cached(provider: string, query: string, kind: string, licensedOnly: boolean,signal?:AbortSignal,independentPublicSources=false,subjectQuery?:string): Promise<DocumentaryCandidate[]> {
    signal?.throwIfAborted();
    if (provider === "local") return this.local(query);
    // LOC currently exposes only unknown-rights candidates. Automatic
    // selection cannot use them, but manual discovery still can.
    if (licensedOnly && provider === "loc") return [];
    const isolatedPublic=independentPublicSources&&['web','commons','internet-archive','loc','youtube'].includes(provider);
    const warningKey=this.webWarningKey(query,kind)+(independentPublicSources?':'+provider:'');
    // Earlier public-only YouTube results must not hide the configured API.
    const publicCacheVersion=provider==='commons'?(kind==='image'?'commons-native-rendition-3':'commons-native-subject-2')
      :provider==='youtube'&&kind==='video'?'youtube-api-public-cc-2':'public-source-2';
    // subjectQuery includes the title-first mode and feature terms, so old
    // broad metadata batches cannot mask a newly focused image search.
    const cacheKey=(text:string)=>createHash("sha256").update(JSON.stringify([isolatedPublic?publicCacheVersion:provider === "internet-archive" ? 5 : provider==='commons'?4:["pexels", "pixabay", "youtube"].includes(provider) ? 3 : 2, provider, text, kind,
      ...(licensedOnly && provider === "internet-archive" ? ["licensed-only"] : []),
      ...(isolatedPublic&&provider==='commons'?[licensedOnly?'licensed-only':'all-rights',subjectQuery?.toLowerCase()??'']:[])])).digest("hex");
    const legacyKey=cacheKey(query);
    const key=cacheKey(query.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase());
    // Cancelling a completed scene's search must not cancel another scene's
    // request for the same query. Completed disk results still share one key.
    if(independentPublicSources&&signal&&!this.signalIds.has(signal))this.signalIds.set(signal,++this.nextSignalId);
    const flightKey=independentPublicSources&&signal?`${key}:${this.signalIds.get(signal)}`:key;
    const existing = this.inFlight.get(flightKey); if (existing) return existing;
    const work = (async () => {
      const file = this.cachePath ? join(this.cachePath, `${key}.json`) : undefined;
      let staleYouTube:DocumentaryCandidate[]|undefined;
      if (file) {
        try {
          const raw=await readFile(file,'utf8').catch(error=>{
            if(error.code==='ENOENT'&&legacyKey!==key)return readFile(join(this.cachePath!,`${legacyKey}.json`),'utf8');
            throw error;
          });
          const data = JSON.parse(raw);
          if (data.expiresAt > Date.now() && Array.isArray(data.candidates)) {
            if(provider==='web'||isolatedPublic)this.webWarnings.set(warningKey,typeof data.warning==='string'?data.warning:'');
            return (data.candidates as DocumentaryCandidate[]).map(commonsAttributionLicense);
          }
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
      while(active.size>=4){
        signal?.throwIfAborted();
        const ready=Promise.race([...active].map(job=>job.catch(()=>[])));
        if(independentPublicSources&&provider==='commons'&&signal){
          let abort:()=>void=()=>{};
          try{await Promise.race([ready,new Promise<never>((_resolve,reject)=>{
            abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});
            if(signal.aborted)abort();
          })]);}finally{signal.removeEventListener('abort',abort);}
        }else await ready;
      }
      if ((this.quotaBlocked.get(provider)??0)>Date.now()) {const fallback=useStale('quota');if(fallback)return fallback;throw new Error("Источник исчерпал суточную квоту поиска. Проверка доступности — через час; сохранённые результаты доступны.");}
      if ((this.cooldown.get(provider) ?? 0) > Date.now()) {const fallback=useStale('cooldown');if(fallback)return fallback;throw new Error("Источник ограничил запросы. Повторите через несколько минут или выберите другой источник.");}
      const job=this.providerSearch(provider,query,kind,licensedOnly,signal,independentPublicSources,subjectQuery);active.add(job);
      let result:DocumentaryCandidate[];
      try { result=await job; }
      catch (error) {
        const message=error instanceof Error?error.message:String(error);
        // Adapters (YouTube/stock) do not go through json(). Respect their
        // refusals too, instead of retrying the same depleted service per scene.
        if (/quotaExceeded|dailyLimitExceeded|quota.*(?:per day|daily)|суточн.*квот/iu.test(message)) this.quotaBlocked.set(provider,Date.now()+3600000);
        else if (error instanceof StockApiRateLimitError) this.cooldown.set(provider,Math.max(this.cooldown.get(provider)??0,Date.now()+error.retryAfterMs));
        else if (/\b429\b|исчерпан.*лимит/iu.test(message)) this.cooldown.set(provider,Math.max(this.cooldown.get(provider)??0,Date.now()+120000));
        const fallback=useStale('provider-error');
        if(fallback)return fallback;
        throw error;
      } finally { active.delete(job); }
      const partialWeb=(provider==='web'||isolatedPublic)&&this.webWarnings.get(warningKey);
      if (file) await atomicWrite(file, JSON.stringify({ expiresAt: Date.now() + (partialWeb?300000:24*3600_000), candidates: result,...(provider==='web'||isolatedPublic?{warning:this.webWarnings.get(warningKey)}:{}) }));
      return result;
    })();
    this.inFlight.set(flightKey, work);
    try { return await work; } finally { this.inFlight.delete(flightKey); }
  }

  private async json(url: URL, provider: string, signal?:AbortSignal): Promise<unknown> {
    signal?.throwIfAborted();
    // An adapter may issue a second metadata request (SVGs/archive pages).
    // A concurrent search's refusal applies to those requests as well.
    const remaining = (this.cooldown.get(provider) ?? 0) - Date.now();
    if (remaining > 0) throw new StockApiRateLimitError("Источник ограничил запросы. Сохранённые результаты доступны.", remaining);
    const timeout=AbortSignal.timeout(25000);
    const requestSignal=signal?AbortSignal.any([signal,timeout]):timeout;
    const response = await this.fetcher(url, { headers: { "User-Agent": "GoldWorkStudio/0.2 (local documentary editor)", Accept: "application/json" }, signal: requestSignal })
      .catch(error=>{if(requestSignal.aborted)throw requestSignal.reason;throw error;});
    signal?.throwIfAborted();
    if (response.status === 429 || response.status === 403) {
      const now = Date.now(), retryAfter = response.headers.get("retry-after")?.trim();
      const requested = retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter)
        ? Number(retryAfter) * 1000 : Date.parse(retryAfter ?? "") - now;
      const wait = Number.isFinite(requested) && requested > 0 ? Math.max(1000, requested) : 120000;
      const until = Math.max(this.cooldown.get(provider) ?? 0, now + wait);
      this.cooldown.set(provider, until);
      await response.body?.cancel();
      throw new StockApiRateLimitError(`Источник ограничил доступ (HTTP ${response.status}); результат сохранён у других источников.`, until - now);
    }
    if (!response.ok) throw new Error(`Источник недоступен (HTTP ${response.status})`);
    const payload = await response.json();
    signal?.throwIfAborted();
    if (record(payload).error) throw new Error(`Ошибка источника: ${(documentaryPlainText(record(record(payload).error).info) || documentaryPlainText(record(payload).error)).slice(0, 300)}`);
    return payload;
  }

  private async commonsSearch(query:string,kind:string,signal?:AbortSignal,automatic=false):Promise<DocumentaryCandidate[]>{
    if(!automatic)return this.fetchCommons(query,kind,signal,automatic);
    signal?.throwIfAborted();
    // Different scene queries can reduce to the same title/feature lookup.
    // Share only this native response, never their distinct web fallbacks.
    // Keep the memo short-lived and in-memory; discovery can refresh after a
    // minute, and manual searches retain their original request behavior.
    const key=JSON.stringify([query,kind,automatic]),now=Date.now();
    for(const [entry,value]of this.commonsNativeCache)if(value.expiresAt<=now)this.commonsNativeCache.delete(entry);
    const cached=this.commonsNativeCache.get(key);
    if(cached)return structuredClone(cached.candidates);
    let flight=this.commonsNativeInFlight.get(key);
    if(!flight){
      const controller=new AbortController();
      const work=this.fetchCommons(query,kind,controller.signal,automatic).then(candidates=>{
        if(!controller.signal.aborted){
          while(this.commonsNativeCache.size>=64)this.commonsNativeCache.delete(this.commonsNativeCache.keys().next().value!);
          this.commonsNativeCache.set(key,{expiresAt:Date.now()+60_000,candidates:structuredClone(candidates)});
        }
        return candidates;
      }).finally(()=>{if(this.commonsNativeInFlight.get(key)===flight)this.commonsNativeInFlight.delete(key);});
      flight={controller,subscribers:0,work};this.commonsNativeInFlight.set(key,flight);
    }
    flight.subscribers++;
    let abort:()=>void=()=>{};
    try{
      const result=await (signal?Promise.race([flight.work,new Promise<never>((_resolve,reject)=>{
        abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});
        if(signal.aborted)abort();
      })]):flight.work);
      signal?.throwIfAborted();
      return structuredClone(result);
    }finally{
      signal?.removeEventListener('abort',abort);flight.subscribers--;
      // One scene's cancellation must not cancel a sibling's shared request.
      if(!flight.subscribers&&this.commonsNativeInFlight.get(key)===flight){
        this.commonsNativeInFlight.delete(key);
        flight.controller.abort(new DOMException('Поиск остановлен','AbortError'));
      }
    }
  }

  private async fetchCommons(query:string,kind:string,signal?:AbortSignal,automatic=false):Promise<DocumentaryCandidate[]>{
    const provider='commons',url=new URL('https://commons.wikimedia.org/w/api.php');
    for(const [key,value] of Object.entries({action:'query',format:'json',formatversion:'2',generator:'search',
      // Identity refusals and already-used sources can exhaust the first eight.
      // One bounded metadata page keeps alternatives available without adding
      // provider requests, downloads or paid-analysis slots.
      gsrsearch:kind==='video'?`${query} filetype:video`:query,gsrnamespace:'6',gsrlimit:'24',
      prop:'imageinfo',iiprop:'url|extmetadata|size|mime',iiurlwidth:automatic?(kind==='image'?'1920':'1600'):'640'}))url.searchParams.set(key,value);
    const payload=await this.json(url,provider,signal);
    const pages=list(record(record(payload).query).pages);
    const vectors=kind==='image'?pages.filter(page=>string(record(list(record(page).imageinfo)[0]).mime)==='image/svg+xml'):[];
    if(vectors.length&&!automatic){
      const rasterUrl=new URL('https://commons.wikimedia.org/w/api.php');
      for(const [key,value] of Object.entries({action:'query',format:'json',formatversion:'2',pageids:vectors.map(page=>String(record(page).pageid)).join('|'),
        prop:'imageinfo',iiprop:'url|size|mime',iiurlwidth:'1600'}))rasterUrl.searchParams.set(key,value);
      // At most one metadata request renders all SVGs; original rasters retain
      // their dimensions and every request shares the scene's cancellation.
      const rendered=await this.json(rasterUrl,provider,signal).catch(error=>{
        signal?.throwIfAborted();
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
    return commonsCandidates(payload,query,automatic);
  }

  private async providerSearch(provider: string, query: string, kind: string, licensedOnly: boolean,signal?:AbortSignal,independentPublicSources=false,subjectQuery?:string): Promise<DocumentaryCandidate[]> {
    let nativeWarning='';
    if(independentPublicSources&&provider==='commons'){
      try{
        const eligible=(found:DocumentaryCandidate[])=>found.filter(candidate=>candidate.kind===kind&&(!licensedOnly||candidate.rights!=='unknown'));
        // A required name mentioned only in another subject's description is
        // a poor first batch. Search the title first, retaining script-grounded
        // feature terms. This is discovery only; pixels still need inspection.
        const titleQuery=kind==='image'&&subjectQuery?.startsWith('intitle:')?subjectQuery:undefined;
        const primaryQuery=titleQuery??query;
        const fallbackQuery=titleQuery?titleQuery.slice('intitle:'.length):subjectQuery;
        let candidates=eligible(await this.commonsSearch(primaryQuery,kind,signal,true));
        // A second GET is allowed only after a successful empty result and
        // only for an explicit subject. Its metadata is still ranked against
        // the original requirement; this does not relax identity/year review.
        if(!candidates.length&&fallbackQuery&&canonicalWords(fallbackQuery)!==canonicalWords(primaryQuery)){
          signal?.throwIfAborted();
          candidates=eligible(await this.commonsSearch(fallbackQuery,kind,signal,true));
        }
        if(candidates.length){
          this.webWarnings.delete(this.webWarningKey(query,kind)+':commons');
          return candidates;
        }
      }catch(error){
        signal?.throwIfAborted();
        // An explicit refusal pauses this source; a web fallback must not
        // immediately request Commons pages during its 429/403 cooldown.
        const code=string(record(error).code)||string(record(record(error).cause).code);
        if(error instanceof StockApiRateLimitError||error instanceof Error
          &&(['AbortError','TimeoutError'].includes(error.name)||/ETIMEDOUT|TIMEOUT/i.test(code)||/\btimeout\b|timed out|тайм.?аут|HTTP (?:408|504)/iu.test(error.message)))throw error;
        nativeWarning=error instanceof Error?error.message:String(error);
      }
      signal?.throwIfAborted();
      // Another in-flight search may have paused Commons while native HTTP
      // was pending. Recheck before starting any source-specific web request.
      const now=Date.now();
      if((this.quotaBlocked.get(provider)??0)>now)throw new Error("Источник исчерпал суточную квоту поиска. Проверка доступности — через час; сохранённые результаты доступны.");
      const remaining=(this.cooldown.get(provider)??0)-now;
      if(remaining>0)throw new StockApiRateLimitError("Источник ограничил запросы. Сохранённые результаты доступны.",remaining);
      // One existing source-specific web lookup after empty/failed API search.
    }
    if(independentPublicSources&&provider==='youtube'&&kind==='video'&&this.youtube){
      try{
        // search() reads the saved API key and fails before HTTP if absent.
        const candidates=await this.youtube.search(query);
        signal?.throwIfAborted();
        if(candidates.length){
          this.webWarnings.delete(this.webWarningKey(query,kind)+':youtube');
          return candidates;
        }
      }catch(error){signal?.throwIfAborted();nativeWarning=error instanceof Error?error.message:String(error);}
      // Missing key, API refusal or no CC results: retain public discovery.
    }
    if (provider === "web"||independentPublicSources&&['commons','internet-archive','loc','youtube'].includes(provider)) {
      if (!this.web) throw new Error(nativeWarning||"Веб-поиск недоступен");
      // Keep native API warnings visible without classifying them as failures
      // of the separate public route (e.g. API quota must not ban the website).
      this.webWarnings.set(this.webWarningKey(query,kind)+(independentPublicSources?':'+provider:''),nativeWarning);
      if(this.web.searchWithSources){let result;
        try{result=await this.web.searchWithSources(query,kind as 'image'|'video',signal,
          independentPublicSources?provider as DocumentaryCandidate['provider']:undefined);}
        catch(error){signal?.throwIfAborted();throw error;}
        this.webWarnings.set(this.webWarningKey(query,kind)+(independentPublicSources?':'+provider:''),[nativeWarning,...result.errors].filter(Boolean).join('; ').slice(0,1600));return result.candidates;}
      const candidates=await this.web.search(query, kind as "image" | "video",signal);
      if(independentPublicSources&&['commons','youtube'].includes(provider))this.webWarnings.set(this.webWarningKey(query,kind)+':'+provider,nativeWarning.slice(0,1600));
      return candidates;
    }
    if (provider === "youtube") {
      if (kind !== "video") return [];
      if (!this.youtube) throw new Error("Источник YouTube недоступен");
      return this.youtube.search(query);
    }
    if (provider === "commons") return this.commonsSearch(query,kind);
    if (provider === "pexels" || provider === "pixabay") {
      if (!this.stock) throw new Error("Stock API не настроен");
      const results = await this.stock.search({ provider, query, mediaType: kind as "image" | "video", perPage: 20 },false,signal);
      return results.items.map(asset => ({ id: `${provider}:${asset.id}`, provider, kind: asset.mediaType, title: asset.description || `${provider} ${asset.mediaType} ${asset.id}`,
        description: asset.description || "", pageUrl: asset.pageUrl, downloadUrl: asset.optimizedDownloadUrl || asset.downloadUrl, previewUrl: asset.previewUrl,
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
      // A name in title and the year in subject still refer to one archive
      // item. Do not require every term in the same metadata field.
      const phrase = terms.map(term=>`(title:${term} OR description:${term} OR subject:${term})`).join(" AND ");
      const topicQuery = `(${phrase}) AND mediatype:${kind === "video" ? "movies" : "image"}`;
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
