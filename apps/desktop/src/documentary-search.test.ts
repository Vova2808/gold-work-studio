import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {DocumentaryCandidate} from '@gold-work/shared';
import { commonsCandidates, DocumentarySearch, rankDocumentaryCandidates, documentaryExactQuery, documentaryLicense } from "./documentary-search.js";
import {documentaryRetryAfter} from "./documentary-download.js";
import {StockApiRateLimitError} from "./stock-client.js";
import { DocumentaryDownloadWatchdog, DocumentaryYouTube, DocumentaryYouTubeDefinitionError, documentaryLikelyPortraitShort, documentaryYouTubeFormatSelector, youtubeDocumentaryCandidates } from "./documentary-youtube.js";

test('a YouTube HD-labelled vertical Short is skipped before horizontal auto selection',()=>{
  const source={id:'youtube:C7BQcBG7ndo',provider:'youtube',kind:'video',videoDefinition:'hd',
    title:'Yamaha YZR M1 Quartararo MotoGP 2019 #short',durationSeconds:27} as DocumentaryCandidate;
  assert.equal(documentaryLikelyPortraitShort(source),true);
  assert.equal(documentaryLikelyPortraitShort({...source,title:'Yamaha YZR M1 short documentary'}),false);
  assert.equal(documentaryLikelyPortraitShort({...source,localPath:'D:/saved.mp4'}),false,
    'A saved/manual source remains available for frame inspection');
});

test('a split model suffix in an archive title matches the same machine, not a neighbouring code',()=>{
  const source={kind:'video',provider:'youtube',description:'Race motorcycle review',concerns:[],rights:'licensed'} as unknown as DocumentaryCandidate;
  const ranked=rankDocumentaryCandidates([
    {...source,id:'exact',title:'Honda RC211 V Valentino Rossi 2002'},
    {...source,id:'different',title:'Honda RC213 V race 2002'},
  ],{query:'Honda RC211V',kind:'video',entities:['Honda RC211V']});
  assert.equal(ranked[0]?.id,'exact');
  assert.equal(ranked[0]?.match,'exact-metadata');
  assert.equal(ranked[1]?.match,'unverified');
});

test('a daily YouTube quota refusal stops fresh queries but preserves other sources',async()=>{
  let calls=0,local=0;
  const search=new DocumentarySearch(undefined,globalThis.fetch,undefined,async()=>{local++;return [];},{search:async()=>{calls++;throw Error("YouTube 429: Quota exceeded for Search Queries per day");}});
  for(const query of ['Rossi Honda','Rossi Yamaha','Furusawa interview']){
    const result=await search.search({query,kind:'video',providers:['youtube','local']});
    assert.ok(result.sources.find(s=>s.provider==='youtube')?.error);
  }
  assert.equal(calls,1);assert.equal(local,3);
});

test('an expired exact-query YouTube cache remains a bounded discovery fallback during quota outage',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-youtube-stale-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const candidate:DocumentaryCandidate={id:'youtube:abcdefghijk',provider:'youtube',kind:'video',title:'Honda RC211V',description:'Motorcycle',
    pageUrl:'https://www.youtube.com/watch?v=abcdefghijk',downloadUrl:'https://www.youtube.com/watch?v=abcdefghijk',
    rights:'licensed',license:'Creative Commons Attribution (YouTube)',licenseUrl:'https://support.google.com/youtube/answer/2797468',
    attribution:'fixture · Honda RC211V',durationSeconds:60,author:'fixture',query:'Honda RC211V',
    retrievedAt:new Date().toISOString(),match:'unverified',concerns:[]};
  let calls=0;
  const search=new DocumentarySearch(undefined,globalThis.fetch,root,undefined,{search:async()=>{
    if(++calls===1)return [candidate];
    throw Error('YouTube 429: Quota exceeded for Search Queries per day');
  }});
  const input={query:'Honda RC211V',kind:'video' as const,providers:['youtube' as const]};
  assert.equal((await search.search(input,true)).candidates.length,1);
  const file=join(root,(await readdir(root))[0]!);
  const saved=JSON.parse(await readFile(file,'utf8'));saved.expiresAt=Date.now()-1000;
  saved.candidates.push({...candidate,id:'youtube:badbadbadba',pageUrl:'https://www.youtube.com/watch?v=badbadbadba',rights:'unknown'});
  await writeFile(file,JSON.stringify(saved));
  const fallback=await search.search(input,true);
  assert.equal(fallback.candidates.length,1,'expired search data cannot reintroduce unknown-rights sources');
  assert.equal(fallback.candidates[0]?.id,candidate.id);
  assert.equal(fallback.sources[0]?.error,undefined);
  assert.equal((await search.search(input,true)).candidates[0]?.id,candidate.id);
  assert.equal(calls,2,'a quota pause must not issue another search for the same saved query');
  saved.expiresAt=Date.now()-8*24*3600_000;await writeFile(file,JSON.stringify(saved));
  const tooOld=await search.search(input,true);
  assert.equal(tooOld.candidates.length,0);
  assert.match(tooOld.sources[0]?.error??'',/квоту/);
});

test('stock adapter 429 establishes the same shared cooldown as archive HTTP errors',async()=>{
  let calls=0;
  const search=new DocumentarySearch({search:async()=>{calls++;throw Error('Pixabay: исчерпан лимит запросов (status=429)');}});
  await search.search({query:'motorcycle race',kind:'video',providers:['pixabay']});
  await search.search({query:'motorcycle engine',kind:'image',providers:['pixabay']});
  assert.equal(calls,1);
});

test('stock search resumes after the provider retry time instead of a fixed two-minute block',async()=>{
  let calls=0;
  const search=new DocumentarySearch({search:async()=>{
    calls++;
    if(calls===1)throw new StockApiRateLimitError('Pixabay: исчерпан лимит запросов, повторите через 0,1 сек.',100);
    return {items:[]};
  }} as never);
  await search.search({query:'motorcycle race',kind:'video',providers:['pixabay']});
  await search.search({query:'motorcycle engine',kind:'video',providers:['pixabay']});
  assert.equal(calls,1,'scene searches during the stated cooldown do not hit Pixabay again');
  await new Promise(resolve=>setTimeout(resolve,120));
  const recovered=await search.search({query:'motorcycle track',kind:'video',providers:['pixabay']});
  assert.equal(calls,2);
  assert.equal(recovered.sources[0]?.error,undefined);
});

test("a growing documentary original survives three minutes, but a stalled transfer stops", () => {
  const watchdog = new DocumentaryDownloadWatchdog(0);
  for (let minute = 1; minute <= 8; minute++) assert.equal(watchdog.observe(minute * 35 * 1024 * 1024, minute * 60_000), undefined);
  assert.equal(watchdog.observe(8 * 35 * 1024 * 1024, 540_000), undefined);
  assert.match(watchdog.observe(8 * 35 * 1024 * 1024, 570_000)!, /90 секунд/);
});

test("documentary downloads still bound connection startup, total time and actual file size", () => {
  const waiting = new DocumentaryDownloadWatchdog(0);
  assert.equal(waiting.observe(0, 179_999), undefined);
  assert.match(waiting.observe(0, 180_000)!, /не начал передачу/);
  const growing = new DocumentaryDownloadWatchdog(0);
  for (let minute = 1; minute < 15; minute++) assert.equal(growing.observe(minute * 1024 * 1024, minute * 60_000), undefined);
  assert.match(growing.observe(15 * 1024 * 1024, 900_000)!, /15 минут/);
  assert.match(new DocumentaryDownloadWatchdog(0).observe(750 * 1024 * 1024 + 1, 1000)!, /750 МБ/);
  assert.match(new DocumentaryDownloadWatchdog(0,160*1024*1024).observe(160*1024*1024+1,1000)!,/160 МБ/);
});

test("YouTube discovery verifies public CC licenses and never turns upload dates into capture dates", async () => {
  const video = { id: "abcdefghijk", snippet: { title: "Tractor at work", channelTitle: "Farm", liveBroadcastContent: "none" }, status: { license: "creativeCommon", privacyStatus: "public" }, contentDetails: { duration: "PT1M20S" } };
  const candidates = youtubeDocumentaryCandidates([video, { ...video, id: "standard123", status: { ...video.status, license: "youtube" } }, { ...video, id: "private1234", status: { ...video.status, privacyStatus: "private" } }, { ...video, id: "bad/id" }, { ...video, id: "livestream1", snippet: { ...video.snippet, liveBroadcastContent: "live" } }], "tractor");
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.durationSeconds, 80);
  assert.equal(candidates[0]!.match, "unverified");
  assert.equal(candidates[0]!.capturedAt, undefined);
  assert.equal(candidates[0]!.author, "Farm");
  const calls: URL[] = [];
  const youtube = new DocumentaryYouTube({ apiKey: async () => "test-key", resolveValidatedCookies: async () => undefined }, async input => {
    const url = new URL(String(input)); calls.push(url);
    return Response.json({ items: url.pathname.endsWith("/search") ? [{ id: { videoId: video.id } }, { id: { videoId: "bad/id" } }] : [video] });
  });
  const search = new DocumentarySearch(undefined, undefined, undefined, undefined, youtube);
  const input = { query: "tractor", kind: "video" as const, providers: ["youtube" as const] };
  const [one, two] = await Promise.all([search.search(input), search.search(input)]);
  assert.equal(calls.length, 2, "Concurrent requests share one search and one license lookup");
  assert.equal(calls[0]!.searchParams.get("videoLicense"), "creativeCommon");
  assert.equal(calls[1]!.searchParams.get("id"), video.id);
  assert.equal(one.candidates.length, 1); assert.equal(two.candidates.length, 1);
  await search.search({ ...input, kind: "image" });
  assert.equal(calls.length, 2, "Photo searches do not consume YouTube quota");
});

test("YouTube retains its SD/HD hint so full-screen scenes can avoid unusable downloads", () => {
  const base = { id: "abcdefghijk", snippet: { title: "Motorcycle archive" }, status: { license: "creativeCommon", privacyStatus: "public" }, contentDetails: { duration: "PT20S", definition: "sd" as const } };
  const [sd, hd] = youtubeDocumentaryCandidates([base, { ...base, id: "lmnopqrstuv", contentDetails: { ...base.contentDetails, definition: "hd" as const } }], "motorcycle");
  assert.equal(sd?.videoDefinition, "sd");
  assert.equal(hd?.videoDefinition, "hd");
});

test('full-frame YouTube download excludes narrow portrait formats before transferring them',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-youtube-format-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const video={id:'abcdefghijk',snippet:{title:'Honda RC211V'},status:{license:'creativeCommon',privacyStatus:'public'},
    contentDetails:{duration:'PT1M',definition:'hd' as const}};
  const candidate=youtubeDocumentaryCandidates([video],'Honda RC211V')[0]!;
  let launched:string[]=[];
  const youtube=new DocumentaryYouTube({apiKey:async()=> 'test-key',resolveValidatedCookies:async()=>undefined},
    async()=>Response.json({items:[video]}),async args=>{launched=args;throw Error('format-only fixture');});
  await assert.rejects(youtube.download(candidate,join(root,'video.download'),undefined,undefined,true),/format-only fixture/);
  const selector=launched[launched.indexOf('-f')+1];
  assert.equal(selector,documentaryYouTubeFormatSelector(true));
  assert.match(selector,/bestvideo\[ext=mp4\]\[height<=1080\]\[width>=640\]/);
  assert.match(selector,/\/best\[ext=mp4\]\[height<=1080\]\[width>=640\]/);
  assert.doesNotMatch(documentaryYouTubeFormatSelector(false),/width>=640/);
  await assert.rejects(youtube.download(candidate,join(root,'range.download'),undefined,undefined,true,{start:10,end:20}),/format-only fixture/);
  assert.equal(launched[launched.indexOf('--download-sections')+1],'*10-20');
  assert.ok(launched.includes('--force-keyframes-at-cuts'));
  await assert.rejects(youtube.download(candidate,join(root,'invalid.download'),undefined,undefined,true,{start:10,end:70}),/Некорректный диапазон/);
});

test("YouTube download rechecks licensing and blocks injected source URLs before launching a downloader", async () => {
  const candidate = youtubeDocumentaryCandidates([{ id: "abcdefghijk", snippet: { title: "Tractor" }, status: { license: "creativeCommon", privacyStatus: "public" }, contentDetails: { duration: "PT20S" } }], "tractor")[0]!;
  let launched = false, calls = 0;
  const youtube = new DocumentaryYouTube({ apiKey: async () => "secret-test-key", resolveValidatedCookies: async () => undefined }, async () => { calls++; return Response.json({ items: [{ id: "abcdefghijk", status: { license: "youtube", privacyStatus: "public" }, contentDetails: { duration: "PT20S" } }] }); }, async () => { launched = true; });
  await assert.rejects(youtube.download({ ...candidate, pageUrl: "https://example.org/injected" }, "unused.mp4"), /Некорректный/);
  assert.equal(calls, 0);
  await assert.rejects(youtube.download(candidate, "unused.mp4"), /больше не подтверждает/);
  assert.equal(calls, 1); assert.equal(launched, false);
});

test("a legacy cached YouTube candidate is rejected as SD before preview analysis or original download", async () => {
  const source = { id: "abcdefghijk", snippet: { title: "Motorcycle archive" }, status: { license: "creativeCommon", privacyStatus: "public" }, contentDetails: { duration: "PT20S", definition: "sd" as const } };
  const candidate = youtubeDocumentaryCandidates([{ ...source, contentDetails: { duration: "PT20S" } }], "motorcycle")[0]!;
  let metadataCalls = 0, launched = false;
  const youtube = new DocumentaryYouTube({ apiKey: async () => "test-key", resolveValidatedCookies: async () => undefined }, async () => {
    metadataCalls++;
    return Response.json({ items: [source] });
  }, async () => { launched = true; });
  await assert.rejects(youtube.preview(candidate, "unused-preview-directory", undefined, true), DocumentaryYouTubeDefinitionError);
  await assert.rejects(youtube.download(candidate, "unused.mp4", undefined, undefined, true), DocumentaryYouTubeDefinitionError);
  assert.equal(metadataCalls, 2);
  assert.equal(launched, false);
});

test("legacy Creative Commons HTTP licenses remain recognizable; lookalikes and restrictive licenses are not approved", () => {
  assert.equal(documentaryLicense("http://creativecommons.org/licenses/publicdomain/").rights, "public-domain");
  assert.equal(documentaryLicense("http://creativecommons.org/licenses/by/4.0/").url, "https://creativecommons.org/licenses/by/4.0/");
  assert.equal(documentaryLicense("https://example.org/creativecommons.org/licenses/by/4.0/").rights, "unknown");
  assert.equal(documentaryLicense("https://creativecommons.org/licenses/by-nc-nd/4.0/").rights, "unknown");
});

test("a stock search query is never fabricated as source metadata", async () => {
  const search = new DocumentarySearch({ search: async () => ({ items: [{ id: "123", provider: "pexels", mediaType: "video", pageUrl: "https://www.pexels.com/video/123/", downloadUrl: "https://example.org/123.mp4", width: 1280, height: 720 }] }) } as never);
  const result = await search.search({ query: "specific rare machine", kind: "video", providers: ["pexels"], entities: ["specific rare machine"] });
  assert.equal(result.candidates[0]!.title, "pexels video 123");
  assert.equal(result.candidates[0]!.match, "unverified");
});

test("archive selection preserves array-valued licenses and prefers a usable original over the smallest proxy", async () => {
  const search = new DocumentarySearch(undefined, async input => {
    const url = new URL(String(input));
    if (url.pathname.includes("advancedsearch")) return Response.json({ response: { docs: [{ identifier: "tractor-film", title: "Tractor works in a field", creator: ["Archive author"], licenseurl: ["https://creativecommons.org/licenses/by/4.0/"] }] } });
    return Response.json({ metadata: {}, files: [{ name: "tractor_512kb.mp4", size: 2000, source: "derivative" }, { name: "tractor.mp4", size: 50000, source: "original" }] });
  });
  const result = await search.search({ query: "tractor", kind: "video", providers: ["internet-archive"] });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]!.rights, "licensed");
  assert.equal(result.candidates[0]!.author, "Archive author");
  assert.ok(result.candidates[0]!.downloadUrl.endsWith("/tractor.mp4"));
});

test("archive discovery searches declared reusable sources first and preserves the source shot list", async () => {
  const queries: string[] = [];
  const search = new DocumentarySearch(undefined, async input => {
    const url = new URL(String(input));
    if (url.pathname.includes("advancedsearch")) {
      queries.push(url.searchParams.get("q")!);
      return Response.json({ response: { docs: [{ identifier: "factory-film", title: "Factory film", licenseurl: "https://creativecommons.org/publicdomain/mark/1.0/" }] } });
    }
    return Response.json({ metadata: { description: "Factory tour", shotlist: "00:45 <b>Tractor assembly</b>" }, files: [{ name: "factory.mp4", size: 50000 }] });
  });
  const result = await search.search({ query: "tractor", kind: "video", providers: ["internet-archive"] });
  assert.equal(queries.length, 1);
  assert.match(queries[0]!, /licenseurl:http\*publicdomain\*/);
  assert.match(queries[0]!, /NOT licenseurl:http\*by-nc\*/);
  assert.ok(!queries[0]!.includes("/"), "Unescaped slash wildcard syntax is rejected by the live Archive query parser");
  assert.equal(result.candidates[0]!.description, "Factory tour\n00:45 Tractor assembly");
  assert.equal(result.candidates[0]!.rights, "public-domain");
  assert.equal(result.candidates[0]!.match, "unverified");
});

test("empty reusable archive search falls back to discovery without approving unknown rights", async () => {
  const queries: string[] = [];
  const search = new DocumentarySearch(undefined, async input => {
    const url = new URL(String(input));
    if (url.pathname.includes("advancedsearch")) {
      const query = url.searchParams.get("q")!; queries.push(query);
      return Response.json({ response: { docs: query.includes("licenseurl:") ? [] : [{ identifier: "unknown-film", title: "Tractor film" }] } });
    }
    return Response.json({ metadata: {}, files: [{ name: "tractor.mp4", size: 50000 }] });
  });
  const result = await search.search({ query: "tractor", kind: "video", providers: ["internet-archive"] });
  assert.equal(queries.length, 2);
  assert.ok(!queries[1]!.includes("licenseurl:"));
  assert.equal(result.candidates[0]!.rights, "unknown");
});

test("automatic stock skips unlicensed archive fallback and LOC while manual search keeps both", async t => {
  const cache = await mkdtemp(join(tmpdir(), "gws-licensed-search-"));
  t.after(() => rm(cache, { recursive: true, force: true }));
  let archiveSearches = 0, metadata = 0, loc = 0;
  const search = new DocumentarySearch(undefined, async input => {
    const url = new URL(String(input));
    if (url.pathname.includes("advancedsearch")) {
      archiveSearches++;
      const licensed = url.searchParams.get("q")!.includes("licenseurl:");
      const known = url.searchParams.get("q")!.includes("licensed-tractor");
      return Response.json({ response: { docs: known && licensed
        ? [{ identifier: "licensed-film", title: "Licensed tractor", licenseurl: "https://creativecommons.org/licenses/by/4.0/" }]
        : licensed ? [] : [{ identifier: "unknown-film", title: "Unlicensed tractor" }] } });
    }
    if (url.pathname.includes("/metadata/")) {
      metadata++;
      return Response.json({ metadata: {}, files: [{ name: "tractor.mp4", size: 50000 }] });
    }
    loc++;
    return Response.json({ results: [] });
  }, cache);
  const input = { query: "tractor", kind: "video" as const, providers: ["internet-archive" as const] };
  assert.equal((await search.search(input)).candidates[0]!.rights, "unknown");
  assert.equal(archiveSearches, 2);
  assert.equal(metadata, 1);
  assert.deepEqual((await search.search({ ...input, providers: ["internet-archive", "loc"] }, true)).candidates, []);
  assert.equal(archiveSearches, 3, "Auto must use a separate rights-only cache key and skip the unlicensed second page");
  assert.equal(metadata, 1, "Auto must not inspect unusable unknown-rights files");
  assert.equal(loc, 0, "LOC currently returns only unknown-rights records in this adapter");
  await search.search(input, true);
  assert.equal(archiveSearches, 3, "The rights-only empty result is cached");
  const approved = await search.search({ ...input, query: "licensed-tractor" }, true);
  assert.equal(approved.candidates.length, 1);
  assert.equal(approved.candidates[0]!.rights, "licensed");
});

const payload = { query: { pages: [{ pageid: 1, title: "File:SS United States 1952.jpg", imageinfo: [{ url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/example.jpg",
  descriptionurl: "https://commons.wikimedia.org/wiki/File:Example.jpg", thumburl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/example.jpg/640px-example.jpg",
  width: 1920, height: 1080, mime: "image/jpeg", extmetadata: { LicenseShortName: { value: "CC BY-SA 4.0" }, LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0/" },
    Artist: { value: "<a href='example'>Photographer</a>" }, ImageDescription: { value: "SS United States in 1952, four propellers" } } }] }] } };

test("Commons preserves per-file origin and license, removes markup, never approves visual identity", () => {
  const candidates = commonsCandidates(payload, "SS United States");
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.rights, "licensed");
  assert.equal(candidates[0]?.author, "Photographer");
  assert.equal(candidates[0]?.match, "unverified");
  assert.match(candidates[0]!.attribution, /CC BY-SA 4.0/);
  const ranked = rankDocumentaryCandidates(candidates, { query: "SS United States", kind: "image", entities: ["SS United States"], years: ["1952"] });
  assert.equal(ranked[0]?.match, "exact-metadata");
  assert.ok(ranked[0]?.concerns.some(message => /визуально/.test(message)));
});

test("Commons exact Attribution license retains credit and permits inspection without approving the image", () => {
  const metadata = structuredClone(payload);
  metadata.query.pages[0]!.imageinfo[0]!.extmetadata.LicenseShortName.value = "Attribution";
  const result = commonsCandidates(metadata, "Panama Canal dredging")[0]!;
  assert.equal(result.rights, "licensed");
  assert.equal(result.licenseUrl, "https://commons.wikimedia.org/wiki/Template:Attribution_only_license");
  assert.equal(result.author, "Photographer");
  assert.match(result.attribution, /Photographer.*Attribution/);
  assert.equal(result.match, "unverified");
  metadata.query.pages[0]!.imageinfo[0]!.extmetadata.LicenseShortName.value = "Attribution required, non-commercial";
  assert.equal(commonsCandidates(metadata, "dredging")[0]!.rights, "unknown");
});

test("different ship and wrong era remain unverified; duplicate original URLs collapse", () => {
  const candidate = commonsCandidates(payload, "SS United States")[0]!;
  const wrong = { ...candidate, id: "wrong", title: "Modern cruise ship", description: "Icon of the Seas in 2024", downloadUrl: "https://example.org/another.jpg" };
  const result = rankDocumentaryCandidates([wrong, candidate, { ...candidate, id: "duplicate" }], { query: "SS United States 1952", kind: "image", entities: ["SS United States"], years: ["1952"] });
  assert.equal(result.length, 2);
  assert.equal(result[0]?.id, candidate.id);
  assert.equal(result[1]?.match, "unverified");
  assert.ok(result[1]?.concerns.some(message => message.includes("SS United States")));
  assert.ok(result[1]?.concerns.some(message => message.includes("1952")));
});

test("one unavailable source does not erase successful results; concurrent same search shares requests", async () => {
  let commonsCalls = 0, locCalls = 0;
  const search = new DocumentarySearch(undefined, (async input => {
    const url = new URL(String(input));
    if (url.hostname === "commons.wikimedia.org") {
      commonsCalls++;
      if (url.searchParams.get("gsrsearch") !== "Another ship") assert.equal(url.searchParams.get("gsrsearch"), '"SS United States" 1952');
      await new Promise(resolve => setTimeout(resolve, 5));
      return Response.json(payload);
    }
    locCalls++; return new Response("Restricted", { status: 403 });
  }) as typeof fetch);
  const input = { query: "SS United States 1952", kind: "image" as const, providers: ["commons", "loc"] as ("commons" | "loc")[], entities: ["SS United States"], years: ["1952"] };
  const [one, two] = await Promise.all([search.search(input), search.search(input)]);
  assert.equal(commonsCalls, 1); assert.equal(locCalls, 1);
  assert.equal(one.candidates.length, 1); assert.equal(two.candidates.length, 1);
  assert.match(one.sources.find(source => source.provider === "loc")!.error!, /403/);
  await search.search({ ...input, query: "Another ship" });
  assert.equal(locCalls, 1, "403 opens a cooldown rather than repeatedly hitting the same source");
});

test("proper names are literal archive queries and a sister ship is not an exact subject match", () => {
  assert.equal(documentaryExactQuery({ query: 'Icon of the Seas construction', kind: "video", entities: ["Icon of the Seas"] }), '"Icon of the Seas" construction');
  assert.equal(documentaryExactQuery({ query: '"SS United States" 1952', kind: "image", entities: ["SS United States"] }), '"SS United States" 1952');
  const candidate = { ...commonsCandidates(payload, "Icon of the Seas")[0]!, title: "Star of the Seas at Cadiz", description: "Star of the Seas, sister of Icon of the Seas" };
  const ranked = rankDocumentaryCandidates([candidate], { query: "Icon of the Seas", kind: "image", entities: ["Icon of the Seas"] });
  assert.equal(ranked[0]!.match, "unverified");
  assert.ok(ranked[0]!.concerns.some(concern => concern.includes("другой корабль")));
});

test("download backoff honors Retry-After seconds and dates with a bounded fallback", () => {
  assert.equal(documentaryRetryAfter("300"), 300);
  assert.equal(documentaryRetryAfter("Wed, 15 Sep 2027 12:02:00 GMT", Date.parse("2027-09-15T12:00:00Z")), 120);
  assert.equal(documentaryRetryAfter(null), 120);
  assert.equal(documentaryRetryAfter("unexpected"), 120);
  assert.equal(documentaryRetryAfter("0"), 30);
});
