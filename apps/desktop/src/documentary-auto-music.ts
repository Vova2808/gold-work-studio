import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rm } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { importDocumentaryMusic, indexLegacyMusicImports, listImportedMusic, type ImportedMusicAsset, type MusicProvenance } from './documentary-music-import.js';
import { checksumFile } from './effect-library.js';
import { atomicWrite } from './fs-utils.js';
import { copyImmutableDocumentaryFile } from './documentary-storage.js';
import { probeEffectMedia } from './effect-media.js';
import { DOCUMENTARY_MUSIC_CATALOG, MUSIC_CATALOG_VERSION, catalogMusicForMood } from './documentary-music-catalog.js';
import type {DocumentaryMusicSection, MusicClip, Project} from '@gold-work/shared';
import {montageFrames} from './documentary-semantic-montage.js';

export const MUSIC_RETRIEVAL_BUDGET = { queries: 2, candidates: 8, downloads: 1, milliseconds: 25000, metadataMilliseconds: 5000, bytes: 64 * 1024 ** 2, cooldownMs: 30 * 60 * 1000 } as const;
export interface PrepareDocumentaryMusicInput {
  directory: string; projectDirectory: string; mode: 'auto' | 'off' | 'custom'; path?: string;
  theme?: string; emotion?: string; hook?: string; signal?: AbortSignal;
  mood?: Exclude<DocumentaryMusicSection['mood'], 'silence'>;
}
export interface PreparedDocumentaryMusic {
  status: 'ready' | 'local-fallback' | 'unavailable' | 'off'; message: string;
  diagnostics?: MusicRetrievalDiagnostics;
  music?: { path: string; name: string; assetId: string; sourcePage?: string; sourceDurationSeconds: number; volume: number;
    fadeInSeconds: number; fadeOutSeconds: number; ducking: true; enabled: true };
}
export interface MusicRetrievalDiagnostics {
  provider: 'commons';
  reason: 'downloaded' | 'cache' | 'no-results' | 'license' | 'mood' | 'metadata' | 'duration' | 'invalid-audio' | 'size' | 'source-error' | 'timeout';
  searches: number; downloads: number; pages: number; eligible: number; licenseRejected: number; moodRejected: number;
  httpStatus?: number; cached?: 'query' | 'project' | 'cooldown';
}
class MusicSourceError extends Error {
  constructor(readonly reason: MusicRetrievalDiagnostics['reason'], readonly httpStatus?: number) { super(reason); }
}
type Fetch = typeof globalThis.fetch;
interface Candidate { name: string; url: string; description: string; expectedSha1?: string; provenance: MusicProvenance }
type CommonsPage = { title?: string; imageinfo?: Array<{url?: string; descriptionurl?: string; mime?: string; size?: number; sha1?: string; duration?: number;
  extmetadata?: Record<string, {value?: string}>}> };
const plain = (value: string) => value.replace(/<[^>]*>/g, ' ').replace(/&(?:nbsp|amp|quot);/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3000);
const sfx = /\b(?:sound effects?|sfx|whoosh|impact|riser|subdrop|heartbeat|field recording|spoken|speech|vocals?|song|singing|anthem)\b|шум|щелч|звуковой эффект|песн|вокал/i;
const instrumental = /\b(?:instrumental|ambient|soundtrack|background music|piano|orchestral|electronic music)\b|инструменталь|фоновая музыка/i;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const queues = new Map<string, Promise<unknown>>();

export function documentaryMusicProfile(input: Pick<PrepareDocumentaryMusicInput, 'theme' | 'emotion' | 'hook' | 'mood'>): { mood: string; terms: string[] } {
  if(input.mood){
    const terms={tension:['suspense','tension','dark','mystery','ominous'],reflective:['reflective','melancholic','emotional','piano','ambient'],
      energetic:['energetic','driving','action','epic','electronic'],discovery:['discovery','futuristic','space','mystical','ambient'],calm:['calm','relaxed','peaceful','soft','ambient']};
    return {mood:input.mood,terms:terms[input.mood]};
  }
  const text = `${input.emotion ?? ''} ${input.hook ?? ''} ${input.theme ?? ''}`.toLowerCase();
  if (/true[ -]?crime|криминал|серийн.*убий|расслед.*убий/.test(text)) return { mood: 'tension', terms: ['suspense', 'tension', 'dark', 'mystery', 'ominous'] };
  if (/\b(?:traged\w*|sad|sadness|loss|war|wars|warfare|wartime)\b|траг|потер|гибел|войн|груст/.test(text)) return { mood: 'reflective', terms: ['piano', 'ambient', 'reflective', 'melancholic', 'emotional'] };
  if (/\b(?:danger\w*|mystery|tense|tension|conflict\w*)\b|тайн|опас|риск|расслед|напряж/.test(text)) return { mood: 'tension', terms: ['suspense', 'tension', 'dark', 'mystery', 'ominous'] };
  if (/\b(?:sport\w*|race\w*|racing|speed\w*|victory|motorsport\w*)\b|гонк|скорост|побед|спорт/.test(text)) return { mood: 'energetic', terms: ['cinematic', 'energetic', 'electronic', 'driving', 'epic'] };
  if (/science|space|tech|наук|космо|техно|будущ/.test(text)) return { mood: 'discovery', terms: ['ambient', 'electronic', 'space', 'minimal', 'discovery'] };
  return { mood: 'calm', terms: ['ambient', 'piano', 'calm', 'documentary', 'instrumental'] };
}

/** A license URL alone is insufficient: require matching machine-readable license and attribution. */
export function commonsMusicCandidate(page: CommonsPage): Candidate | undefined {
  return inspectCommonsCandidate(page).candidate;
}
function inspectCommonsCandidate(page: CommonsPage): { candidate?: Candidate; rejected?: 'license' | 'metadata' | 'size' } {
  const info = page.imageinfo?.[0], fields = info?.extmetadata;
  if (info?.size && info.size > MUSIC_RETRIEVAL_BUDGET.bytes) return { rejected: 'size' };
  if (!info?.url || !fields || !(info.mime?.startsWith('audio/') || info.mime === 'application/ogg') || !info.size) return { rejected: 'metadata' };
  const value = (key: string) => plain(fields[key]?.value ?? '');
  const reviewed = DOCUMENTARY_MUSIC_CATALOG.find(track => track.title === page.title);
  const name = reviewed?.name ?? plain(page.title?.replace(/^File:/, '') ?? '');
  const description = reviewed?.description ?? `${name} ${value('ImageDescription')}`;
  const vocalEvidence = description.replace(/\b(?:no|without) vocals?\b|\bvocal[- ]free\b/gi, '');
  if (sfx.test(vocalEvidence) || !instrumental.test(description)) return { rejected: 'metadata' };
  let url: URL, source: URL, licenseUrl: URL | undefined;
  try { url = new URL(info.url); source = new URL(info.descriptionurl ?? ''); } catch { return { rejected: 'metadata' }; }
  // Commons now appends public analytics parameters to original-media URLs.
  // Strip only those; arbitrary query parameters/hosts are still rejected.
  for (const key of [...url.searchParams.keys()]) if (/^utm_(source|campaign|content)$/.test(key)) url.searchParams.delete(key);
  if (url.protocol !== 'https:' || url.hostname !== 'upload.wikimedia.org' || url.username || url.password || url.search || url.hash || url.port
    || source.protocol !== 'https:' || source.hostname !== 'commons.wikimedia.org' || !/\.(mp3|wav|ogg|flac|m4a)$/i.test(url.pathname)) return { rejected: 'metadata' };
  try { licenseUrl = fields.LicenseUrl?.value ? new URL(fields.LicenseUrl.value) : undefined; } catch { return { rejected: 'license' }; }
  const license = value('LicenseShortName'), author = value('Artist');
  if (reviewed && (url.toString() !== reviewed.url || info.sha1 !== reviewed.sha1 || author !== 'Kevin MacLeod'
    || !Number.isFinite(info.duration) || Math.abs(info.duration! - reviewed.durationSeconds) > 2)) return { rejected: 'metadata' };
  const ccUrl = licenseUrl?.hostname === 'creativecommons.org' && ['https:', 'http:'].includes(licenseUrl.protocol);
  const byVersion = /^CC BY (2\.0|2\.5|3\.0|4\.0)$/i.exec(license)?.[1];
  const ccBy = byVersion && ccUrl && licenseUrl!.pathname.replace(/\/$/, '') === `/licenses/by/${byVersion}` && !!author;
  const cc0 = /^CC0(?: 1\.0)?$/i.test(license) && ccUrl && licenseUrl!.pathname.replace(/\/$/, '') === '/publicdomain/zero/1.0';
  const pd = /^public domain$/i.test(license) && value('Copyrighted').toLowerCase() === 'false';
  if (!ccBy && !cc0 && !pd) return { rejected: 'license' };
  return { candidate: { name, url: url.toString(), description, expectedSha1: reviewed?.sha1, provenance: { provider: 'commons', sourceUrl: url.toString(), sourcePage: source.toString(),
    license, licenseUrl: licenseUrl?.toString(), author, attribution: value('Attribution') || `${name} — ${author || 'Wikimedia Commons'}, ${license}` } } };
}
function score(text: string, terms: string[]): number { return terms.reduce((total, term, i) => total + (text.toLowerCase().includes(term) ? 6 - i : 0), 0); }
function matchesMood(text: string, mood: string): boolean {
  const positive:Record<string,RegExp>={
    tension:/\b(?:suspense|tense|tension|dark|mystery|ominous|eerie)\b|напряж|тревож|мрачн|зловещ/i,
    reflective:/\b(?:reflective|melanchol\w*|emotional|somber|sad|mourn\w*)\b|задумчив|груст|печаль|меланхол/i,
    energetic:/\b(?:energetic|driving|action|epic|upbeat|intense)\b|энергич|драйв|эпич|бодр/i,
    discovery:/\b(?:discovery|futuristic|space|mystical|exploration)\b|открыти|космич|исследован|футурист/i,
    calm:/\b(?:calm\w*|relax\w*|peaceful|gentle|soft|serene)\b|спокойн|расслаб|умиротвор|мягк/i
  };
  const negative:Record<string,RegExp>={
    tension:/\b(?:calm\w*|relax\w*|cheerful|happy|comedy|uplifting)\b|спокойн|весёл|весел|расслаб/i,
    reflective:/\b(?:cheerful|happy|comedy|upbeat|action)\b|весёл|весел|бодр/i,
    energetic:/\b(?:calm\w*|relax\w*|peaceful|mourn\w*)\b|спокойн|расслаб|печаль/i,
    discovery:/\b(?:comedy|vocals?|song)\b|вокал|песн/i,
    calm:/\b(?:suspense|tense|tension|ominous|action|driving|intense)\b|напряж|тревож|драйв/i
  };
  return Boolean(positive[mood]?.test(text)&&!negative[mood]?.test(text));
}
function assetMatchesMood(asset:ImportedMusicAsset,mood:string):boolean{
  const reviewed=DOCUMENTARY_MUSIC_CATALOG.find(track=>track.url===asset.provenance.sourceUrl&&track.name===asset.name);
  return reviewed?(reviewed.moods as readonly string[]).includes(mood):matchesMood(`${asset.name} ${asset.tags.join(' ')}`,mood);
}
function musicOnly(asset: ImportedMusicAsset): boolean { return asset.durationSeconds >= 30 && asset.durationSeconds <= 1200 && !sfx.test(`${asset.name} ${asset.tags.join(' ')}`); }
function readyMusic(asset: ImportedMusicAsset, path: string): NonNullable<PreparedDocumentaryMusic['music']> {
  return { path, assetId: asset.id, name: asset.name, sourcePage: asset.provenance.sourcePage, sourceDurationSeconds: asset.durationSeconds, volume: 10,
    fadeInSeconds: 1.5, fadeOutSeconds: 3, ducking: true, enabled: true };
}
async function readJson<T>(path: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
}
async function responseBytes(response: Response, maximum: number): Promise<Uint8Array> {
  if (!response.ok) { await response.body?.cancel(); throw new MusicSourceError('source-error', response.status); }
  if (Number(response.headers.get('content-length')) > maximum) { await response.body?.cancel(); throw new MusicSourceError('size'); }
  const reader = response.body?.getReader(); if (!reader) throw new MusicSourceError('source-error');
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength;
    if (size > maximum) throw new MusicSourceError('size'); chunks.push(next.value); } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return Buffer.concat(chunks);
}
function failureMessage(reason: MusicRetrievalDiagnostics['reason']): string {
  const messages = {
    'no-results': 'Поиск Wikimedia Commons не нашёл музыкальных записей.',
    license: 'Wikimedia Commons: найденная музыка не прошла проверку лицензии и авторства.',
    mood: 'Wikimedia Commons: найденная музыка не соответствует настроению этого участка.',
    metadata: 'Wikimedia Commons: метаданные не подтверждают подходящую инструментальную музыку.',
    duration: 'Wikimedia Commons: длительность записи вне диапазона 30–1200 секунд.',
    'invalid-audio': 'Wikimedia Commons: загруженный файл не содержит пригодной аудиодорожки.',
    size: 'Wikimedia Commons: ответ или музыкальный файл превышает лимит размера.',
    timeout: 'Wikimedia Commons: превышен лимит времени подбора музыки.',
    'source-error': 'Wikimedia Commons недоступен: ошибка источника или загрузки.',
    downloaded: '', cache: ''
  };
  return messages[reason];
}
async function acquire(input: PrepareDocumentaryMusicInput, request: Fetch): Promise<{asset?: ImportedMusicAsset; message: string; fallback: boolean; diagnostics?: MusicRetrievalDiagnostics}> {
  // New catalog gets one fresh opportunity after the old metadata-only failure;
  // subsequent failures retain the normal cooldown. Existing project audio stays cached.
  const profile = documentaryMusicProfile(input), cachePath = join(input.directory, 'Queries', `${hash(`${MUSIC_CATALOG_VERSION}:${profile.mood}`)}.json`);
  await indexLegacyMusicImports(input.directory, input.signal);
  const catalog = await listImportedMusic(input.directory);
  const previous = await readJson<{assetId?: string; until: number; message: string; diagnostics?: MusicRetrievalDiagnostics}>(cachePath);
  const suitable = (asset: ImportedMusicAsset) => musicOnly(asset) && assetMatchesMood(asset, profile.mood);
  const diagnostics: MusicRetrievalDiagnostics = { provider: 'commons', reason: 'no-results', searches: 0, downloads: 0, pages: 0, eligible: 0, licenseRejected: 0, moodRejected: 0 };
  const cached = previous?.assetId ? catalog.find(asset => asset.id === previous.assetId && suitable(asset)) : undefined;
  if (cached && await checksumFile(join(input.directory, cached.file)).catch(() => '') === cached.id) return { asset: cached, message: 'Музыка из кеша Wikimedia Commons.', fallback: false, diagnostics: { ...diagnostics, reason: 'cache', cached: 'query' } };
  // Any suitable intact import is already usable. Do not query/download first
  // merely because this project's selection receipt has not been created yet.
  const local = catalog.filter(suitable).sort((a, b) => score(`${b.name} ${b.tags.join(' ')}`, profile.terms) - score(`${a.name} ${a.tags.join(' ')}`, profile.terms) || a.id.localeCompare(b.id));
  for(const asset of local)if(await checksumFile(join(input.directory,asset.file)).catch(()=> '')===asset.id)
    return {asset,message:'Подходящая музыка из локальной библиотеки.',fallback:false,diagnostics:{...diagnostics,reason:'cache',cached:'query'}};
  let message = previous && previous.until > Date.now() ? previous.message : '';
  if (message) { diagnostics.reason = previous?.diagnostics?.reason ?? 'source-error'; diagnostics.httpStatus = previous?.diagnostics?.httpStatus; diagnostics.cached = 'cooldown'; }
  if (!message) {
    const timeout = AbortSignal.timeout(MUSIC_RETRIEVAL_BUDGET.milliseconds);
    const signal = input.signal ? AbortSignal.any([timeout, input.signal]) : timeout;
    const headers = { 'User-Agent': 'GoldWorkStudio/0.2 (desktop documentary music selection)', 'Accept': 'application/json' };
    try {
      const candidates: Candidate[] = [];
      const reviewed = catalogMusicForMood(profile.mood);
      // Exact reviewed recording first; one discovery query if it was removed or
      // relicensed. This fits the existing two-request / one-download budget.
      for (let query = 0; query < MUSIC_RETRIEVAL_BUDGET.queries; query++) {
        const url = new URL('https://commons.wikimedia.org/w/api.php');
        const lookup = query === 0 && reviewed;
        url.search = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2',
          ...(lookup ? { titles: lookup.title } : { generator: 'search', gsrnamespace: '6', gsrsearch: `${profile.terms[0]} instrumental filetype:audio`, gsrlimit: String(MUSIC_RETRIEVAL_BUDGET.candidates) }),
          prop: 'imageinfo', iiprop: 'url|mime|size|sha1|extmetadata', iiextmetadatalanguage: 'en', maxlag: '5' }).toString();
        diagnostics.searches++;
        const metadataSignal = AbortSignal.any([signal, AbortSignal.timeout(MUSIC_RETRIEVAL_BUDGET.metadataMilliseconds)]);
        const response = await request(url, { headers, signal: metadataSignal, redirect: 'error', credentials: 'omit' });
        const payload = JSON.parse(Buffer.from(await responseBytes(response, 2 * 1024 ** 2)).toString('utf8')) as {error?:unknown; query?: {pages?: CommonsPage[]}};
        if (payload.error) throw new MusicSourceError('source-error');
        const pages = payload.query?.pages ?? [];
        if (!Array.isArray(pages)) throw new MusicSourceError('metadata');
        for (const page of pages.slice(0, MUSIC_RETRIEVAL_BUDGET.candidates)) {
          diagnostics.pages++;
          const inspected = inspectCommonsCandidate(page);
          if (!inspected.candidate) {
            if (inspected.rejected === 'license') diagnostics.licenseRejected++;
            diagnostics.reason = inspected.rejected ?? 'metadata';
          } else if (!matchesMood(inspected.candidate.description, profile.mood)) { diagnostics.moodRejected++; }
          else { diagnostics.eligible++; candidates.push(inspected.candidate); }
        }
        if (candidates.length) break;
      }
      candidates.sort((a, b) => score(b.description, profile.terms) - score(a.description, profile.terms) || a.url.localeCompare(b.url));
      const candidate = candidates[0];
      if (candidate) {
        let asset = catalog.find(item => item.provenance.sourceUrl === candidate.url && suitable(item));
        if (asset && await checksumFile(join(input.directory, asset.file)).catch(() => '') !== asset.id) asset = undefined;
        if (!asset) {
          const temporary = join(input.directory, 'Downloads', `${randomUUID()}${extname(new URL(candidate.url).pathname)}`);
          await mkdir(join(input.directory, 'Downloads'), { recursive: true });
          try {
            diagnostics.downloads++;
            const response = await request(candidate.url, { signal, redirect: 'error', credentials: 'omit', headers: { 'User-Agent': headers['User-Agent'] } });
            if (!response.ok || !response.body) { await response.body?.cancel(); throw new MusicSourceError('source-error', response.status); }
            if (Number(response.headers.get('content-length')) > MUSIC_RETRIEVAL_BUDGET.bytes) { await response.body.cancel(); throw new MusicSourceError('size'); }
            const file = await open(temporary, 'wx'); const reader = response.body.getReader(); let size = 0; const recordingHash = createHash('sha1');
            try { while (true) { signal.throwIfAborted(); const next = await reader.read(); if (next.done) break; size += next.value.byteLength;
              if (size > MUSIC_RETRIEVAL_BUDGET.bytes) throw new MusicSourceError('size'); recordingHash.update(next.value); await file.writeFile(next.value); } }
            finally { await reader.cancel().catch(() => {}); reader.releaseLock(); await file.close(); }
            if (candidate.expectedSha1 && recordingHash.digest('hex') !== candidate.expectedSha1) throw new MusicSourceError('invalid-audio');
            const media = await probeEffectMedia(temporary, signal).catch(() => { signal.throwIfAborted(); throw new MusicSourceError('invalid-audio'); });
            if (!media.hasAudio) throw new MusicSourceError('invalid-audio');
            if (!Number.isFinite(media.durationSeconds) || media.durationSeconds < 30 || media.durationSeconds > 1200) throw new MusicSourceError('duration');
            const path = await importDocumentaryMusic(temporary, input.directory, { name: candidate.name, tags: profile.terms.filter(term => candidate.description.toLowerCase().includes(term)), provenance: candidate.provenance, signal });
            asset = (await listImportedMusic(input.directory)).find(item => item.file === basename(path));
          } finally { await rm(temporary, { force: true }).catch(() => {}); }
        }
        if (asset) {
          diagnostics.reason = diagnostics.downloads ? 'downloaded' : 'cache';
          await mkdir(join(input.directory, 'Queries'), { recursive: true });
          await atomicWrite(cachePath, JSON.stringify({ assetId: asset.id, until: 0, message: '' }));
          return { asset, message: 'Музыка Wikimedia Commons: источник и лицензия сохранены.', fallback: false, diagnostics };
        }
      }
      if (diagnostics.moodRejected) diagnostics.reason = 'mood';
      else if (diagnostics.licenseRejected) diagnostics.reason = 'license';
      message = failureMessage(diagnostics.reason);
    } catch (error) {
      input.signal?.throwIfAborted();
      diagnostics.reason = timeout.aborted || error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : error instanceof MusicSourceError ? error.reason : 'source-error';
      if (error instanceof MusicSourceError) diagnostics.httpStatus = error.httpStatus;
      message = failureMessage(diagnostics.reason);
    }
    await mkdir(join(input.directory, 'Queries'), { recursive: true });
    await atomicWrite(cachePath, JSON.stringify({ until: Date.now() + MUSIC_RETRIEVAL_BUDGET.cooldownMs, message, diagnostics }));
  }
  // No unrelated fallback, and EffectLibrary/SFX are never scanned as music.
  return { message: `${message} Импортируйте музыкальный трек или выключите музыку.`, fallback: true, diagnostics };
}

/** Engine calls this before building the timeline; paths always belong to the project. */
export async function prepareDocumentaryMusic(input: PrepareDocumentaryMusicInput, dependencies: {fetch?: Fetch} = {}): Promise<PreparedDocumentaryMusic> {
  input.signal?.throwIfAborted();
  if (input.mode === 'off') return { status: 'off', message: 'Музыка выключена.' };
  const key = resolve(input.directory), previous = queues.get(key) ?? Promise.resolve();
  const job = previous.catch(() => {}).then(async (): Promise<PreparedDocumentaryMusic> => {
    input.signal?.throwIfAborted();
    const directory = join(input.projectDirectory, 'Documentary', 'Music');
    const selectionKey = hash(JSON.stringify([input.mode, input.theme ?? '', input.emotion ?? '', input.hook ?? '',...(input.mood?[input.mood]:[])]));
    const selectionPath=join(directory,input.mood?`selection-${input.mood}.json`:'selection.json');
    const saved = input.mode === 'auto' ? await readJson<{key: string; asset: ImportedMusicAsset; status: 'ready' | 'local-fallback'; message: string; diagnostics?: MusicRetrievalDiagnostics}>(selectionPath) : undefined;
    if (saved?.key === selectionKey && /^[a-f0-9]{64}$/.test(saved.asset.id) && basename(saved.asset.file) === saved.asset.file && saved.asset.file.startsWith(saved.asset.id + '.')
      && musicOnly(saved.asset) && assetMatchesMood(saved.asset, documentaryMusicProfile(input).mood)) {
      const path = join(directory, saved.asset.file);
      if (await checksumFile(path).catch(() => '') === saved.asset.id) return { status: saved.status, message: saved.message, music: readyMusic(saved.asset, path),
        diagnostics: saved.diagnostics ? { ...saved.diagnostics, reason: saved.status === 'ready' ? 'cache' : saved.diagnostics.reason, cached: 'project', searches: 0, downloads: 0, pages: 0, eligible: 0, licenseRejected: 0, moodRejected: 0 } : undefined };
    }
    await mkdir(input.directory, { recursive: true });
    let selection: Awaited<ReturnType<typeof acquire>>;
    if (input.mode === 'custom') {
      if (!input.path) return { status: 'unavailable', message: 'Выберите свой музыкальный файл.' };
      const path = await importDocumentaryMusic(input.path, input.directory, { signal: input.signal });
      selection = { asset: (await listImportedMusic(input.directory)).find(asset => asset.file === basename(path)), message: 'Выбран ваш музыкальный файл.', fallback: false };
    } else selection = await acquire(input, dependencies.fetch ?? globalThis.fetch);
    input.signal?.throwIfAborted();
    const asset = selection.asset;
    if (!asset) return { status: 'unavailable', message: selection.message, diagnostics: selection.diagnostics };
    await mkdir(directory, { recursive: true });
    const path = join(directory, asset.file);
    await copyImmutableDocumentaryFile(join(input.directory, asset.file), path);
    await atomicWrite(join(directory, `${asset.id}.source.json`), JSON.stringify(asset, null, 2));
    await atomicWrite(join(directory, `${asset.id}.attribution.txt`), [asset.name, asset.provenance.attribution || asset.provenance.author || '',
      asset.provenance.sourcePage || '', asset.provenance.license, asset.provenance.licenseUrl || '', 'Used as background soundtrack: looped, faded and ducked under narration.'].filter(Boolean).join('\n'));
    const status = selection.fallback ? 'local-fallback' : 'ready';
    if (input.mode === 'auto') await atomicWrite(selectionPath, JSON.stringify({ key: selectionKey, asset, status, message: selection.message, diagnostics: selection.diagnostics }));
    return { status, message: selection.message, music: readyMusic(asset, path), diagnostics: selection.diagnostics };
  });
  queues.set(key, job);
  try { return await job; } finally { if (queues.get(key) === job) queues.delete(key); }
}

/** Build editable cues from one existing semantic plan; silence produces no clip. */
export async function prepareDocumentaryMusicSections(project:Project,sections:DocumentaryMusicSection[]|undefined,input:Pick<PrepareDocumentaryMusicInput,'directory'|'projectDirectory'|'signal'>,
  prepare:typeof prepareDocumentaryMusic=prepareDocumentaryMusic):Promise<Project['settings']['music']>{
  const music=project.settings.music;
  if(music.manualEdits||music.clips?.length===0)return music;
  const scenes=project.scenes.filter(s=>s.includeInAssembly!==false).sort((a,b)=>a.order-b.order);
  let total=0;const positions=new Map(scenes.map(scene=>{const start=total;total+=montageFrames(scene)/30;return [scene.id,{start,end:total}];}));
  if(!total)return music;
  const manual=music.clips?.filter(clip=>clip.origin==='manual')??[];
  if(sections?.length===0)return {...music,clips:manual,selectionStatus:'off',selectionMessage:'В плане предусмотрена тишина.'};
  const generatedPlan=sections===undefined;
  const plannedSections=sections??fallbackMusicSections(scenes);
  const prepared=new Map<string,PreparedDocumentaryMusic>(),automatic:MusicClip[]=[];
  const addMissing=(start:number,end:number,message:string,key:string)=>automatic.push({id:`music-auto-${hash(key).slice(0,16)}`,startSeconds:start,durationSeconds:end-start,
    sourceOffsetSeconds:0,volume:100,enabled:true,origin:'automatic',status:'missing',message});
  // An absent model plan gets a small deterministic chapter/phrase plan. Empty is
  // deliberately different: the caller has a valid plan with no requested cues.
  let cursor=0;
  for(const section of plannedSections){
    const first=positions.get(section.startSceneId),last=positions.get(section.endSceneId);
    if(!first||!last||first.start<cursor||last.end<=first.start)continue;
    if(first.start>cursor)addMissing(cursor,first.start,'Музыкальный участок не определён в сохранённом плане.',`gap:${cursor}:${first.start}`);
    cursor=last.end;
    if(section.mood==='silence')continue;
    input.signal?.throwIfAborted();
    // Selection is shared by the same mood within this pass, not requested for
    // every five-second scene. Cached imports also survive following passes.
    let selected=prepared.get(section.mood);
    if(!selected){selected=await prepare({...input,mode:'auto',mood:section.mood});prepared.set(section.mood,selected);}
    const sectionEnd=generatedPlan?last.end-Math.min(1.25,(last.end-first.start)*.2):last.end;
    const key=`${section.startSceneId}:${section.endSceneId}:${section.role}:${section.mood}`;
    if(!selected.music){addMissing(first.start,sectionEnd,selected.message,key);continue;}
    const source=selected.music;
    automatic.push({id:`music-auto-${hash(key).slice(0,16)}`,path:source.path,name:source.name,assetId:source.assetId,sourcePage:source.sourcePage,
      startSeconds:first.start,durationSeconds:sectionEnd-first.start,sourceOffsetSeconds:0,sourceDurationSeconds:source.sourceDurationSeconds,volume:100,enabled:true,
      origin:'automatic',status:'ready',loop:sectionEnd-first.start>source.sourceDurationSeconds});
  }
  if(cursor<total)addMissing(cursor,total,'Музыкальный участок не определён в сохранённом плане.',`gap:${cursor}:${total}`);
  // Preserve individually authored clips and their full ranges. In normal UI
  // editing manualEdits protects the entire arrangement, including deleted gaps.
  const clipped=automatic.flatMap(clip=>{
    let spans=[{start:clip.startSeconds,end:clip.startSeconds+clip.durationSeconds}];
    for(const authored of manual){const left=authored.startSeconds,right=left+authored.durationSeconds;
      spans=spans.flatMap(span=>right<=span.start||left>=span.end?[span]:[{start:span.start,end:Math.min(left,span.end)},{start:Math.max(right,span.start),end:span.end}].filter(s=>s.end>s.start));}
    return spans.map((span,i)=>({...clip,id:spans.length===1&&span.start===clip.startSeconds?clip.id:`${clip.id}-${i}`,startSeconds:span.start,durationSeconds:span.end-span.start,
      sourceOffsetSeconds:clip.sourceOffsetSeconds+span.start-clip.startSeconds}));
  });
  const clips=[...manual,...clipped].sort((a,b)=>a.startSeconds-b.startSeconds),missing=clips.filter(c=>c.status==='missing').length;
  return {...music,clips,selectionStatus:missing?'unavailable':clips.length?'ready':'off',
    selectionMessage:missing?`Не найдена музыка для ${missing} участков. Метки сохранены на дорожке.`:clips.length?'Музыкальные участки подготовлены.':'В плане предусмотрена тишина.'};
}

function fallbackMusicSections(scenes:Project['scenes']):DocumentaryMusicSection[]{
  const vocab:Record<Exclude<DocumentaryMusicSection['mood'],'silence'>,string[]>={
    tension:['danger','crash','fail','risk','fear','conflict','threat','crisis','fight','pressure','угроз','опас','авари','провал','страх','конфликт','напряж','борьб','кризис','peligro','riesgo','miedo','conflicto','tension','crisis'],
    reflective:['remember','loss','legacy','memory','grief','killed','tragic','tragedy','farewell','memorial','retire','reflection','памят','наслед','потер','утрат','смерт','умер','погиб','трагед','прощан','скорб','recuerdo','legado','perdid','duelo','muerte','murio','fallec','tragedia','despedid'],
    energetic:['victory','race','fast','launch','breakthrough','speed','triumph','championship','побед','скорост','гонк','старт','прорыв','триумф','чемпион','victoria','carrera','rapido','avance','triunfo','campeon'],
    discovery:['discover','unknown','explor','reveal','discovery','откры','неизвест','исслед','разоблач','descubr','explor','revel'],
    calm:[]
  };
  const moods=['tension','reflective','energetic','discovery'] as const;
  const exact:Partial<Record<typeof moods[number],Set<string>>>= {
    reflective:new Set(['die','dies','died','death','deaths','dead']),
    energetic:new Set(['win','won','winner','winners','winning'])
  };
  const wordTokens=(text:string)=>text.toLocaleLowerCase().normalize('NFD').replace(/\p{M}/gu,'').match(/[\p{L}\p{N}]+/gu)??[];
  const signals=(tokens:string[])=>Object.fromEntries(moods.map(mood=>[mood,tokens.reduce((count,word)=>count+Number(exact[mood]?.has(word)||vocab[mood].some(stem=>word.startsWith(stem))),0)])) as Record<typeof moods[number],number>;
  const turnWords=new Set(['however','but','instead','yet','then','nevertheless','однако','но','зато','вместо','тем','embargo','pero','aunque','sin']);
  let activeChapter='';
  const cues=scenes.map((scene,index)=>{
    const tokens=wordTokens(scene.narration),beat=scene.documentary?.semanticMontage?.beat;
    const graphic=scene.documentary?.motionGraphic;
    const header=/^(?:chapter|глава)\s+([\p{N}]+|[ivxlcdm]+)(?:\s*[:.\-–—]\s*([^\r\n]+))?/imu.exec(scene.narration);
    const scriptChapter=header?`${header[1]}:${header[2]?.trim()??''}`:undefined;
    const chapterTitle=scene.documentary?.semanticMontage?.chapter?.title
      ||(graphic?.kind==='chapter-number'&&graphic.origin==='automatic'?graphic.title:undefined)
      ||scriptChapter;
    if(chapterTitle)activeChapter=chapterTitle;
    const pivot=beat==='turn'||beat==='resolve'||tokens.some(word=>turnWords.has(word));
    const role:DocumentaryMusicSection['role']=beat==='turn'||tokens.some(word=>turnWords.has(word))?'turn':beat==='resolve'?'resolution':beat==='conflict'?'hook':index===0?'hook':'narration';
    return {scene,chapter:activeChapter,seconds:montageFrames(scene)/30,pivot,role,score:signals(tokens)};
  });
  const sections:DocumentaryMusicSection[]=[];
  let index=0;
  while(index<cues.length){
    const first=cues[index]!;let naturalEnd=index,naturalSeconds=0;
    while(naturalEnd<cues.length){const cue=cues[naturalEnd]!;
      if(naturalEnd>index&&naturalSeconds>=20&&(cue.chapter!==first.chapter||cue.pivot))break;
      naturalSeconds+=cue.seconds;naturalEnd++;
    }
    const blockCount=Math.max(1,Math.ceil(naturalSeconds/40));
    let blockStart=index,remainingSeconds=naturalSeconds,remainingBlocks=blockCount;
    while(blockStart<naturalEnd){
      const target=remainingSeconds/remainingBlocks;
      let end=blockStart,seconds=0,bestEnd=blockStart,bestDistance=Infinity;
      const blocksAfter=remainingBlocks-1;
      while(end<naturalEnd){
        seconds+=cues[end]!.seconds;end++;
        const rest=remainingSeconds-seconds;
        const feasible=remainingBlocks===1?seconds<=40+1e-6
          :seconds>=20&&seconds<=40&&rest>=20*blocksAfter&&rest<=40*blocksAfter;
        if(feasible&&Math.abs(seconds-target)<bestDistance){bestEnd=end;bestDistance=Math.abs(seconds-target);}
        if(seconds>40)break;
      }
      if(bestEnd===blockStart){bestEnd=end;}
      const score={tension:0,reflective:0,energetic:0,discovery:0};
      for(let at=blockStart;at<bestEnd;at++)for(const mood of moods)score[mood]+=Math.min(2,cues[at]!.score[mood]);
      const last=cues[bestEnd-1]!;
      const mood=score.reflective>0&&last.scene===scenes.at(-1)&&last.score.reflective>0?'reflective'
        :Object.values(score).every(value=>value===0)?'calm'
        :moods.reduce((best,current)=>score[current]>score[best]?current:best,'tension' as typeof moods[number]);
      sections.push({startSceneId:cues[blockStart]!.scene.id,endSceneId:last.scene.id,mood,role:cues[blockStart]!.role});
      const blockSeconds=cues.slice(blockStart,bestEnd).reduce((sum,cue)=>sum+cue.seconds,0);
      blockStart=bestEnd;remainingSeconds-=blockSeconds;remainingBlocks--;
    }
    index=naturalEnd;
  }
  return sections;
}
