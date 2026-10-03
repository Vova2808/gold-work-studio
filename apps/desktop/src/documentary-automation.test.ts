import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, mkdir, writeFile, copyFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryProjectRepository, MockDirectorProvider, ProjectService } from "@gold-work/core";
import { createVoiceCalibration, type DocumentaryCandidate, type DocumentaryRequirement } from "@gold-work/shared";
import { DocumentaryIntelligence, documentaryJson, documentaryNarrationContext, resolveDocumentaryCandidateKeys, documentaryRankingPool } from "./documentary-intelligence.js";
import { AnyModelModelUnavailableError } from "./anymodel-text-fallback.js";
import { AnyModelProviderResponseError } from "./anymodel-client.js";
import { DocumentaryAnalysisError } from "./documentary-analysis-error.js";
import { ensureDocumentaryMemory, DOCUMENTARY_MEMORY_RESERVE, DocumentaryMemoryUnavailableError } from "./documentary-resources.js";
import { DocumentaryStorageUnavailableError } from "./documentary-storage.js";
import { prepareDocumentaryScript } from "./documentary-plan.js";
import { DocumentaryProjectService, documentaryCandidateAttempts, documentaryFirstVideoBatchWorthInspecting, documentarySearchQueries, documentaryStockQueries, hasExactDocumentaryVideoCandidate, selectDocumentaryCandidates } from "./documentary-project-service.js";
import { LocalProjectStorage } from "./local-project-storage.js";
import { DocumentarySearch } from "./documentary-search.js";
import { effectFfmpeg, probeEffectMedia } from "./effect-media.js";
import { documentaryNarrationText, distributeDocumentaryNarration, hasPreparedDocumentaryNarration } from "./documentary-narration.js";
import { MockGenerationPipeline } from "./mock-generation-pipeline.js";
import { StandardRenderer } from "./standard-renderer.js";
import { EffectLibrary } from "./effect-library.js";
import { planDocumentaryEffects } from "./documentary-effects.js";
import { FileTaskRepository } from "./file-task-repository.js";
import { documentaryComparisonSubjects, groundDocumentaryScenes, planDocumentaryComparisons } from "./documentary-comparison.js";
import { documentaryEditErrors } from "./documentary-validation.js";
import { prepareDocumentaryMedia, prepareDocumentaryImages } from "./documentary-media-cache.js";
import { prepareDocumentaryTiming } from "./documentary-timing.js";
import { copyImmutableDocumentaryFile, documentaryStorageBudget, DOCUMENTARY_STORAGE_RESERVE } from "./documentary-storage.js";

async function setup(text = "The red tractor works in a field. Its wheels grip the soil.") {
  const root = await mkdtemp(join(tmpdir(), "gws-documentary-auto-"));
  const projects = new ProjectService(new MemoryProjectRepository(), new MockDirectorProvider());
  let project = await projects.create({ title: "General topic", topic: "Machines", mediaMode: "stock", mode: "standard", language: "English", aspectRatio: "16:9" });
  project.videoBrief = { ...project.videoBrief!, creationMode: "script", readyScript: text };
  const calibration = createVoiceCalibration({ provider: "elevenlabs", voice: "fixture", language: "en", sampleText: "This is a measured voice for a local test.", audioDurationSeconds: 4 });
  project.scenes = prepareDocumentaryScript(project, calibration);
  project = await projects.update(project.id, project);
  return { root, projects, project };
}

test("a searched scene with no verified material keeps a visible failure after restart", async t => {
  const { root, projects, project } = await setup();
  t.after(() => rm(root, { recursive: true, force: true }));
  const scene = project.scenes[0]!;
  const searcher = new DocumentarySearch();
  searcher.search = async () => ({ candidates: [], sources: [] });
  const service = new DocumentaryProjectService(projects, new LocalProjectStorage(join(root, "workspace")), searcher, join(root, "Materials"),
    { download: async () => { throw new Error("No download expected"); } }, () => {}, {
      available: async () => true,
      plan: async (_project, scenes) => new Map(scenes.map(item => [item.id, { ...item.documentary!.requirement, plannedBy: "semantic" as const }])),
      inspect: async () => { throw new Error("No inspection expected"); },
    });
  const result = await service.autoSelect(project.id, { sceneIds: [scene.id] });
  assert.equal(result.failed, 1);
  assert.equal(result.project.scenes[0]!.documentary!.verified, false);
  assert.match((await projects.get(project.id))!.scenes[0]!.documentary!.autoError!, /Не найден материал с подтверждённым объектом/);
});

test("active list imagery requires direct item evidence and preserves the previous pending check", async () => {
  const {root,project}=await setup('Дождь пополняет запас воды.');
  const file=join(root,'rain-item.png');
  await effectFfmpeg(['-y','-f','lavfi','-i','color=c=gray:s=640x360','-frames:v','1',file]);
  const scene=project.scenes[0]!;
  scene.imagePath=file;
  scene.documentary={...scene.documentary!,checksum:'rain-item',requirement:{...scene.documentary!.requirement,entities:[],identities:[]},
    selected:{kind:'image',title:'Dam technical drawing',width:640,height:360} as never,
    motionGraphic:{kind:'feature-list',enabled:true,title:'Водная система',items:['дождь','водосбор','запас воды'],activeIndex:0,startSeconds:0,durationSeconds:3}};
  let oldKey='';
  const rejected=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(system,input,images)=>{
    assert.match(system,/activeItemMatch:boolean/);
    oldKey=createHash('sha256').update(JSON.stringify([2,'visual-overview',system.split(' Active-item evidence:')[0],input,images])).digest('hex');
    return JSON.stringify({status:'accepted',confidence:.95,reason:'Related dam infrastructure',quality:'clear',activeItemMatch:false,activeItemEvidence:'No rain is visible'});
  }},()=>root);
  assert.notEqual((await rejected.inspect(project,scene)).status,'accepted');
  const direct=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>JSON.stringify({status:'accepted',confidence:.95,reason:'Visible rainfall',quality:'clear',activeItemMatch:true,activeItemEvidence:'Rain streaks are visible'})},()=>join(root,'direct-item'));
  assert.equal((await direct.inspect(project,scene)).status,'accepted');
  const guardedRoot=join(root,'pending-before-item-policy');
  await mkdir(join(guardedRoot,'Documentary','Analysis'),{recursive:true});
  await writeFile(join(guardedRoot,'Documentary','Analysis',`${oldKey}.json`),JSON.stringify({state:'pending',purpose:'visual-overview'}));
  let submissions=0;
  const guarded=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{submissions++;throw new Error('Must not submit');}},()=>guardedRoot);
  await assert.rejects(guarded.inspect(project,scene),/неизвестный результат/);
  assert.equal(submissions,0);
});

test("map imagery must match narrated geography even without planned identities and keeps pending evidence", async () => {
  const {root,project}=await setup('A route connects ports on opposite sides of America.');
  const file=join(root,'map.png');
  await effectFfmpeg(['-y','-f','lavfi','-i','color=c=gray:s=640x360','-frames:v','1',file]);
  const scene=project.scenes[0]!;
  scene.imagePath=file;
  scene.documentary={...scene.documentary!,checksum:'map',requirement:{...scene.documentary!.requirement,entities:[],identities:[]},
    selected:{kind:'image',title:'World map with wooden ship markers',width:640,height:360} as never};
  let oldKey='';
  const rejected=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(system,input,images)=>{
    assert.match(system,/mapGeographyMatch:boolean/);
    oldKey=createHash('sha256').update(JSON.stringify([2,'visual-overview',system.split(' Map geography evidence:')[0],input,images])).digest('hex');
    return JSON.stringify({status:'accepted',confidence:.95,reason:'A map symbolizes travel',quality:'clear',mapGeographyMatch:false,mapGeographyEvidence:'Visible Mediterranean contradicts narrated America'});
  }},()=>root);
  assert.notEqual((await rejected.inspect(project,scene)).status,'accepted');
  const direct=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>JSON.stringify({status:'accepted',confidence:.95,reason:'American coastlines and Panama route',quality:'clear',mapGeographyMatch:true,mapGeographyEvidence:'North and South America are visible'})},()=>join(root,'correct-map'));
  assert.equal((await direct.inspect(project,scene)).status,'accepted');
  const guardedRoot=join(root,'pending-before-map-policy');
  await mkdir(join(guardedRoot,'Documentary','Analysis'),{recursive:true});
  await writeFile(join(guardedRoot,'Documentary','Analysis',`${oldKey}.json`),JSON.stringify({state:'pending',purpose:'visual-overview'}));
  const guarded=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{throw new Error('Must not submit');}},()=>guardedRoot);
  await assert.rejects(guarded.inspect(project,scene),/неизвестный результат/);
});

test("photo fallback preserves a video search quota failure and paid narration", async t => {
  const { root, projects, project } = await setup();
  t.after(() => rm(root, { recursive: true, force: true }));
  const scene = project.scenes[0]!;
  scene.audioPath = "saved-paid-voice.wav";
  scene.documentary!.requirement.plannedBy = "semantic";
  project.settings.stockVideoPercent = 85;
  await projects.update(project.id, project);
  const searcher = new DocumentarySearch();
  const kinds: string[] = [];
  searcher.search = async input => {
    kinds.push(input.kind);
    return { candidates: [], sources: input.kind === "video" ? [{ provider: "youtube", count: 0, error: "HTTP 429: daily Search Queries quota exceeded" }] : [] };
  };
  const service = new DocumentaryProjectService(projects, new LocalProjectStorage(join(root, "workspace")), searcher, join(root, "Materials"),
    { download: async () => { throw new Error("No candidate"); } }, () => {}, {
      available: async () => true, plan: async () => new Map(), inspect: async () => { throw new Error("No candidate"); },
    });
  const result = await service.autoSelect(project.id, { sceneIds: [scene.id] });
  assert.ok(kinds.includes("video") && kinds.includes("image"));
  const saved = result.project.scenes.find(item => item.id === scene.id)!;
  assert.match(saved.documentary!.searchError!, /daily Search Queries quota exceeded/);
  assert.equal(saved.documentary!.searchError!.split("HTTP 429").length - 1, 1, "Repeated provider errors are summarized once");
  assert.match(result.failures[0]!.message, /daily Search Queries quota exceeded/);
  assert.equal(saved.audioPath, scene.audioPath);
});

test("immutable media repairs partial derivatives and survives removal of the catalog entry", async () => {
  const { writeFile, rm, stat } = await import("node:fs/promises");
  const root = await mkdtemp(join(tmpdir(), "gws-documentary-storage-"));
  const original = join(root, "original.mp4"), selected = join(root, "selected.mp4");
  await writeFile(original, "Complete immutable media"); await writeFile(selected, "partial");
  await copyImmutableDocumentaryFile(original, selected);
  const before = await stat(original);
  await copyImmutableDocumentaryFile(original, selected);
  assert.equal((await stat(original)).mtimeMs, before.mtimeMs, "Reuse never overwrites the canonical file");
  await rm(original);
  assert.equal(await readFile(selected, "utf8"), "Complete immutable media", "A project keeps its media when the catalog link is removed");
  assert.equal(documentaryStorageBudget(DOCUMENTARY_STORAGE_RESERVE - 1), 0);
  assert.equal(documentaryStorageBudget(DOCUMENTARY_STORAGE_RESERVE + 42), 42);
});

test("semantic plans support arbitrary topics, resolve context and never rewrite narration; received results are cached", async () => {
  const { root, project } = await setup(); let requests = 0;
  const intelligence = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async (system, input) => {
    requests++;
    const data = JSON.parse(input); assert.equal(data.script, project.videoBrief!.readyScript);
    return JSON.stringify({ scenes: data.scenes.map((scene: { id: string }) => ({ id: scene.id, entities: ["tractor"], years: [], queries: ["red tractor working field", "tractor wheels soil"], preferredKind: "video", accent: "none" })) });
  } }, () => root);
  const first = await intelligence.plan(project, project.scenes), second = await intelligence.plan(project, project.scenes);
  assert.deepEqual(first, second); assert.equal(requests, 1);
  assert.equal([...first.values()].map(item => item.text).join(""), project.videoBrief!.readyScript);
  assert.ok([...first.values()].every(item => item.preferredKind === "video" && item.plannedBy === "semantic"));
});

test("script search planning does not announce material selection", async () => {
  const { root, projects, project } = await setup();
  const phases: string[] = [];
  const service = new DocumentaryProjectService(projects, new LocalProjectStorage(join(root, "workspace")), new DocumentarySearch(), join(root, "Materials"),
    { download: async () => { throw new Error("Planning must not download"); } }, progress => phases.push(progress.phase), {
      available: async () => true,
      plan: async (_project, scenes) => new Map(scenes.map(scene => [scene.id, { ...scene.documentary!.requirement, plannedBy: "semantic" as const }])),
      inspect: async () => { throw new Error("Planning must not inspect materials"); },
    });
  const planned = await service.planSearch(project.id);
  assert.ok(planned.scenes.every(scene => scene.documentary?.requirement.plannedBy === "semantic"));
  assert.deepEqual(phases, [], "No stock toast before the user starts production");
  assert.equal(planned.scenes.map(scene => scene.narration).join(""), project.videoBrief!.readyScript);
});

test("only a short first video with the named subject, year and detail merits early AI ranking", () => {
  const requirement={text:'Honda RC211V entered in 2002',entities:['Honda RC211V'],identities:[{name:'Honda RC211V',aliases:[]}],years:['2002'],
    queries:['Honda RC211V 2002 four-stroke race'],detail:'four-stroke racing regulations',preferredKind:'video',plannedBy:'semantic'} as DocumentaryRequirement;
  const clip={kind:'video',rights:'licensed',title:'Honda RC211V 2002 four-stroke race',description:'Racing archive',durationSeconds:30} as DocumentaryCandidate;
  assert.equal(documentaryFirstVideoBatchWorthInspecting([clip],requirement),true);
  assert.equal(documentaryFirstVideoBatchWorthInspecting([{...clip,durationSeconds:600}],requirement),false);
  assert.equal(documentaryFirstVideoBatchWorthInspecting([{...clip,title:'Honda RC211V 2014 four-stroke race'}],requirement),false);
  assert.equal(documentaryFirstVideoBatchWorthInspecting([{...clip,title:'Yamaha YZR-M1 2002 four-stroke race'}],requirement),false);
  assert.equal(documentaryFirstVideoBatchWorthInspecting([{...clip,rights:'unknown'}],requirement),false);
});

test("exact video metadata skips a second metadata vote but still requires visual inspection", async () => {
  const { root, projects, project } = await setup();
  const video = join(root, "tractor.mp4");
  // The selection path requires an HD original; 640x360 is intentionally
  // rejected by source-quality before it ever reaches semantic inspection.
  await effectFfmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=30:d=3", "-an", "-c:v", "libx264", video]);
  project.scenes = [project.scenes[0]!];
  await projects.update(project.id, project);
  const candidate: DocumentaryCandidate = { id: "exact-tractor", provider: "commons", kind: "video", title: "Red tractor at work", description: "Field work", pageUrl: "https://example.test/tractor", downloadUrl: "", localPath: video,
    author: "Fixture", license: "CC0", licenseUrl: "https://example.test/license", rights: "public-domain", attribution: "Fixture", query: "tractor", retrievedAt: "now", match: "exact-metadata", concerns: [], width: 1280, height: 720, durationSeconds: 3 };
  assert.equal(hasExactDocumentaryVideoCandidate([candidate]), true);
  const engines = { text: "Her engines drive the ship.", entities: ["Example Vessel"], years: [], queries: ["Example Vessel engine room"], detail: "dual fuel engines and propulsion" };
  const dining = { ...candidate, localPath: undefined, title: "Example Vessel dining tour", description: "Restaurants and food", durationSeconds: 590 };
  assert.equal(hasExactDocumentaryVideoCandidate([dining], engines), false, "An exact subject name does not justify a long irrelevant download");
  assert.equal(hasExactDocumentaryVideoCandidate([candidate, dining], engines), false, "One cheap exact clip must not bypass screening of a different long download");
  assert.equal(hasExactDocumentaryVideoCandidate([{ ...dining, title: "Example Vessel dual fuel engines and propulsion" }], engines), true);
  const searcher = new DocumentarySearch();
  searcher.search = async () => ({ candidates: [candidate], sources: [] });
  let ranked = 0, inspected = 0;
  const service = new DocumentaryProjectService(projects, new LocalProjectStorage(join(root, "workspace")), searcher, join(root, "Materials"),
    { download: async () => { throw new Error("Exact local fixture should not download"); } }, () => {}, {
      available: async () => true,
      plan: async (_project, scenes) => new Map(scenes.map(scene => [scene.id, { ...scene.documentary!.requirement, entities: ["Red tractor"], queries: ["red tractor field"], preferredKind: "video" as const, plannedBy: "semantic" as const }])),
      rankCandidates: async () => { ranked++; throw new Error("Exact metadata must bypass the metadata-only ranking"); },
      inspect: async (_project, scene) => { inspected++; assert.ok(scene.videoPath); return { status: "accepted" as const, confidence: .99, reason: "Real fixture frames checked", checkedAt: "now", sampleSeconds: [.1, 1, 2], quality: "1280x720", trimStartSeconds: 0, trimEndSeconds: 2.5 }; },
    });
  const result = await service.autoSelect(project.id);
  assert.equal(result.selected, 1); assert.equal(result.failed, 0);
  assert.equal(ranked, 0); assert.equal(inspected, 1);
});

test("local sources with a stale exact match are screened before downloading or examining unrelated ranges", async t => {
  const { root, projects, project } = await setup('The car steering mechanism turns the wheels.');
  t.after(() => rm(root, { recursive: true, force: true }));
  project.scenes = [project.scenes[0]!];
  await projects.update(project.id, project);
  const unrelated: DocumentaryCandidate = { id: 'old-ship', provider: 'local', kind: 'video', title: 'Cruise ship tour', description: 'Steering and control mechanisms aboard a ship',
    pageUrl: 'https://example.test/ship', downloadUrl: '', author: 'Fixture', license: 'CC0', licenseUrl: '', attribution: 'Fixture', retrievedAt: 'now',
    localPath: join(root, 'must-not-be-opened.mp4'), durationSeconds: 600, rights: 'public-domain', match: 'exact-metadata', query: 'steering control', concerns: [] };
  const searcher = new DocumentarySearch();
  searcher.search = async () => ({ candidates: [], sources: [] });
  let ranked = 0, examined = 0;
  const service = new DocumentaryProjectService(projects, new LocalProjectStorage(join(root, 'workspace')), searcher, join(root, 'Materials'),
    { download: async () => { throw new Error('No download for rejected local metadata'); } }, () => {}, {
      available: async () => true,
      plan: async (_project, scenes) => new Map(scenes.map(scene => [scene.id, { ...scene.documentary!.requirement, entities: ['car'], queries: ['car steering mechanism'], preferredKind: 'video' as const, plannedBy: 'semantic' as const }])),
      rankCandidates: async (_project, _scene, candidates) => { ranked++; assert.deepEqual(candidates.map(c => c.id), ['old-ship']); return []; },
      inspect: async () => { examined++; throw new Error('No paid range inspection for an unrelated ship'); },
    });
  service.localCandidates = async () => [unrelated];
  Object.assign(service, { apply: async () => { examined++; throw new Error('No local copy/decode for rejected metadata'); } });
  const result = await service.autoSelect(project.id);
  assert.equal(ranked, 1); assert.equal(examined, 0); assert.equal(result.failed, 1);
});

test("low committed memory blocks a new paid request without creating a pending checkpoint", async () => {
  const { root, project } = await setup(); let submissions = 0;
  let available = DOCUMENTARY_MEMORY_RESERVE - 1;
  const client = { configured: async () => true, documentaryCompletion: async () => {
    submissions++;
    return JSON.stringify({ scenes: project.scenes.map(scene => ({ id: scene.id, entities: ["tractor"], queries: ["tractor field"], preferredKind: "video" })) });
  } };
  const intelligence = new DocumentaryIntelligence(client, () => root, () => ensureDocumentaryMemory(async () => available));
  await assert.rejects(intelligence.plan(project, project.scenes), /Недостаточно памяти/);
  assert.equal(submissions, 0);
  assert.deepEqual(await readdir(join(root, "Documentary", "Analysis")), []);
  available = DOCUMENTARY_MEMORY_RESERVE;
  await intelligence.plan(project, project.scenes);
  assert.equal(submissions, 1);
  available = 0;
  await intelligence.plan(project, project.scenes);
  assert.equal(submissions, 1, "Reading a paid cached answer needs no new request or memory reservation");
  await assert.rejects(ensureDocumentaryMemory(async () => Number.NaN), /Недостаточно памяти/);
});

test('failed search gets one persisted query revision while narration, identities and voice stay exact', async t => {
  const { root, projects, project } = await setup();
  t.after(() => rm(root, { recursive: true, force: true }));
  const scene = project.scenes[0]!;
  scene.audioPath = 'paid-voice-preserved.wav';
  scene.documentary!.requirement = { ...scene.documentary!.requirement, entities: ['Tractor Alpha'], identities: [{ name: 'Tractor Alpha', aliases: [] }],
    identityContextVersion: 3, plannedBy: 'semantic', queries: ['Tractor Alpha impossible overly specific query'] };
  await projects.update(project.id, project);
  const searcher = new DocumentarySearch();
  const searched: string[] = [];
  searcher.search = async input => { searched.push(input.query); return { candidates: [], sources: [] }; };
  let revisions = 0;
  const service = new DocumentaryProjectService(projects, new LocalProjectStorage(join(root, 'workspace')), searcher, join(root, 'Materials'),
    { download: async () => { throw new Error('No candidate'); } }, () => {}, {
      available: async () => true, plan: async () => new Map(), inspect: async () => { throw new Error('No candidate'); },
      refineQueries: async (_project, scenes) => { revisions++; return new Map(scenes.map(item => [item.id, ['Tractor Alpha engine']])); },
    });
  const options = { sceneIds: [scene.id] };
  await service.autoSelect(project.id, options);
  assert.equal(revisions, 1);
  assert.ok(searched.includes('Tractor Alpha engine'));
  const saved = (await projects.get(project.id))!.scenes[0]!;
  assert.equal(saved.audioPath, scene.audioPath);
  assert.equal(saved.narration, scene.narration);
  assert.deepEqual(saved.documentary!.requirement.identities, scene.documentary!.requirement.identities);
  assert.equal(saved.documentary!.requirement.searchRefined, true);
  await service.autoSelect(project.id, options);
  assert.equal(revisions, 1, 'Resume must not buy another revision');
});

test('query refinement saves the paid response and reuses it without new submissions', async () => {
  const { root, project } = await setup();
  let requests = 0;
  const intelligence = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async (_system, input) => {
    requests++;
    const data = JSON.parse(input);
    assert.equal(data.script, project.videoBrief!.readyScript);
    return JSON.stringify({ scenes: data.scenes.map((scene: { id: string }) => ({ id: scene.id, queries: ['Tractor Alpha engine'] })) });
  } }, () => root);
  const first = await intelligence.refineQueries(project, project.scenes);
  assert.deepEqual(await intelligence.refineQueries(project, project.scenes), first);
  assert.equal(requests, 1);
});

test("an old pending video inspection does not prevent an independently verified photo fallback", async () => {
  const { root, projects, project } = await setup();
  const video = join(root, "tractor.mp4"), photo = join(root, "tractor.png");
  // Keep the fixture above the production quality floor so this exercises
  // uncertain paid analysis/fallback instead of an earlier resolution rejection.
  await effectFfmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=8:d=3", "-an", "-c:v", "libx264", video]);
  await effectFfmpeg(["-y", "-i", video, "-frames:v", "1", photo]);
  const scene = project.scenes[0]!; scene.audioPath = "preserved-voice.mp3";
  await projects.update(project.id, project);
  const base: DocumentaryCandidate = { id: "pending-video", provider: "commons", kind: "video", title: "Red tractor", description: "Red tractor field",
    pageUrl: "https://example.test/tractor", downloadUrl: "", localPath: video, author: "Fixture", license: "CC0", licenseUrl: "https://example.test/license",
    rights: "public-domain", attribution: "Fixture", query: "tractor", retrievedAt: "now", match: "exact-metadata", concerns: [], width: 1280, height: 720, durationSeconds: 3 };
  const searcher = new DocumentarySearch();
  searcher.search = async input => ({ candidates: [input.kind === "image" ? { ...base, id: "usable-photo", kind: "image", localPath: photo } : base], sources: [] });
  const inspections: string[] = [];
  const service = new DocumentaryProjectService(projects, new LocalProjectStorage(join(root, "workspace")), searcher, join(root, "Materials"),
    { download: async () => { throw new Error("Fixtures are already local"); } }, () => {}, {
      available: async () => true,
      plan: async (_project, scenes) => new Map(scenes.map(item => [item.id, { ...item.documentary!.requirement, entities: ["Red tractor"], queries: ["red tractor field"], plannedBy: "semantic" as const }])),
      inspect: async (_project, current) => {
        inspections.push(current.documentary!.selected!.id);
        if (current.documentary!.selected!.kind === "video") throw new DocumentaryAnalysisError("Old uncertain request", "pending", "video-catalog");
        return { status: "accepted", confidence: .99, reason: "Independently checked photo", checkedAt: "now", sampleSeconds: [0], quality: "1280x720" };
      },
    });
  const result = await service.autoSelect(project.id, { sceneIds: [scene.id] });
  assert.equal(result.selected, 1, JSON.stringify({failures:result.failures,error:result.project.scenes[0]?.documentary?.autoError,inspections})); assert.equal(result.failed, 0);
  assert.deepEqual(inspections, ["pending-video", "usable-photo"]);
  assert.equal(result.project.scenes[0]!.audioPath, "preserved-voice.mp3");
  assert.equal(result.project.scenes[0]!.documentary!.selected!.kind, "image");
  assert.equal(result.project.videoBrief!.readyScript, project.videoBrief!.readyScript);
});

test("a timed-out YouTube original does not start another long YouTube download before the photo fallback", async t => {
  const { root, projects, project } = await setup();
  t.after(() => rm(root, { recursive: true, force: true }));
  const photo = join(root, "tractor.png");
  await effectFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=red:s=1280x720", "-frames:v", "1", photo]);
  const scene = project.scenes[0]!;
  const base: DocumentaryCandidate = { id: "youtube:first", provider: "youtube", kind: "video", title: "Red tractor", description: "Field work",
    pageUrl: "https://example.test/first", downloadUrl: "https://example.test/first", author: "Fixture", license: "CC BY", licenseUrl: "https://example.test/license",
    rights: "licensed", attribution: "Fixture", query: "tractor", retrievedAt: "now", match: "exact-metadata", concerns: [], width: 1280, height: 720, durationSeconds: 900 };
  const searcher = new DocumentarySearch();
  searcher.search = async input => ({ candidates: input.kind === "image"
    ? [{ ...base, provider: "commons", id: "photo", kind: "image", downloadUrl: "", localPath: photo }]
    : [base, { ...base, id: "youtube:second", downloadUrl: "https://example.test/second" }], sources: [] });
  let downloads = 0;
  const service = new DocumentaryProjectService(projects, new LocalProjectStorage(join(root, "workspace")), searcher, join(root, "Materials"),
    { download: async () => { throw new Error("No stock download expected"); } }, () => {}, {
      available: async () => true,
      plan: async (_project, scenes) => new Map(scenes.map(item => [item.id, { ...item.documentary!.requirement, entities: ["Red tractor"], queries: ["red tractor field"], plannedBy: "semantic" as const }])),
      inspect: async () => ({ status: "accepted", confidence: .99, reason: "Mock fallback review", checkedAt: "now", sampleSeconds: [0], quality: "1280x720" }),
    }, undefined, { download: async () => { downloads++; throw new Error("Загрузка YouTube превысила 15 минут; проверьте соединение"); } });
  const result = await service.autoSelect(project.id, { sceneIds: [scene.id] });
  assert.equal(result.selected, 1, JSON.stringify({failures:result.failures,error:result.project.scenes[0]?.documentary?.autoError,downloads}));
  assert.equal(result.project.scenes[0]!.documentary!.selected!.kind, "image");
  assert.equal(downloads, 1, "One stalled origin must not consume several consecutive fifteen-minute slots for the same scene");
  assert.equal(result.project.settings.stockVideoPercent, project.settings.stockVideoPercent);
});

test("an unavailable preview of a long YouTube source skips the original download", async t => {
  const { root, projects, project } = await setup();
  t.after(() => rm(root, { recursive: true, force: true }));
  const photo = join(root, "tractor-preview-fallback.png");
  await effectFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=red:s=1280x720", "-frames:v", "1", photo]);
  const scene = project.scenes[0]!;
  const video: DocumentaryCandidate = { id: "youtube:long-preview", provider: "youtube", kind: "video", title: "Red tractor documentary", description: "Field work",
    pageUrl: "https://example.test/long-preview", downloadUrl: "https://example.test/long-preview", author: "Fixture", license: "CC BY", licenseUrl: "https://example.test/license",
    rights: "licensed", attribution: "Fixture", query: "tractor", retrievedAt: "now", match: "exact-metadata", concerns: [], width: 1280, height: 720, durationSeconds: 611 };
  const searcher = new DocumentarySearch();
  searcher.search = async input => ({ candidates: input.kind === "image"
    ? [{ ...video, provider: "commons", id: "fallback-photo", kind: "image", downloadUrl: "", localPath: photo }]
    : [video], sources: [] });
  let previews = 0, downloads = 0;
  const service = new DocumentaryProjectService(projects, new LocalProjectStorage(join(root, "workspace")), searcher, join(root, "Materials"),
    { download: async () => { throw new Error("No stock download expected"); } }, () => {}, {
      available: async () => true,
      plan: async (_project, scenes) => new Map(scenes.map(item => [item.id, { ...item.documentary!.requirement, entities: ["Red tractor"], queries: ["red tractor field"], plannedBy: "semantic" as const }])),
      inspectPreview: async () => { throw new Error("Preview inspection must not run"); },
      inspect: async () => ({ status: "accepted", confidence: .99, reason: "Mock fallback review", checkedAt: "now", sampleSeconds: [0], quality: "1280x720" }),
    }, undefined, {
      preview: async () => { previews++; throw new Error("Preview unavailable"); },
      download: async () => { downloads++; throw new Error("Long original must not download"); },
    });
  const result = await service.autoSelect(project.id, { sceneIds: [scene.id] });
  assert.equal(previews, 1);
  assert.equal(downloads, 0);
  assert.equal(result.selected, 1, JSON.stringify(result.failures));
  assert.equal(result.project.scenes[0]!.documentary!.selected!.kind, "image");
});

test("a long named YouTube source needs scene evidence in its preview before downloading", async t => {
  const { root, projects, project } = await setup();
  t.after(() => rm(root, { recursive: true, force: true }));
  const photo = join(root, "tractor-scene-fallback.png");
  await effectFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=red:s=1280x720", "-frames:v", "1", photo]);
  const scene = project.scenes[0]!;
  const video: DocumentaryCandidate = { id: "youtube:long-generic", provider: "youtube", kind: "video", title: "Tractor history compilation", description: "Many tractor models and years",
    pageUrl: "https://example.test/long-generic", downloadUrl: "https://example.test/long-generic", author: "Fixture", license: "CC BY", licenseUrl: "https://example.test/license",
    rights: "licensed", attribution: "Fixture", query: "tractor", retrievedAt: "now", match: "exact-metadata", concerns: [], width: 1280, height: 720, durationSeconds: 611 };
  const searcher = new DocumentarySearch();
  searcher.search = async input => ({ candidates: input.kind === "image"
    ? [{ ...video, provider: "commons", id: "fallback-photo-scene", kind: "image", downloadUrl: "", localPath: photo }]
    : [video], sources: [] });
  let previews = 0, sceneReviews = 0, downloads = 0;
  const service = new DocumentaryProjectService(projects, new LocalProjectStorage(join(root, "workspace")), searcher, join(root, "Materials"),
    { download: async () => { throw new Error("No stock download expected"); } }, () => {}, {
      available: async () => true,
      plan: async (_project, scenes) => new Map(scenes.map(item => [item.id, { ...item.documentary!.requirement,
        entities: ["Red tractor"], identities: [{ name: "Red tractor", aliases: [] }], years: ["2002"], queries: ["red tractor 2002"], plannedBy: "semantic" as const }])),
      inspectPreview: async () => ({ rejected: false, reason: "Camera footage" }),
      inspectPreviewForScene: async () => { sceneReviews++; return { selectedIndex: -1, reason: "Only unrelated models in the three samples" }; },
      inspect: async () => ({ status: "accepted", confidence: .99, reason: "Mock fallback review", checkedAt: "now", sampleSeconds: [0], quality: "1280x720" }),
    }, undefined, {
      preview: async () => { previews++; return { segments: [0, 1, 2].map(index => ({ path: `sample-${index}.mp4`, start: index * 100, end: index * 100 + 4 })), bytes: 1024 }; },
      download: async () => { downloads++; throw new Error("Irrelevant long original must not download"); },
    });
  const result = await service.autoSelect(project.id, { sceneIds: [scene.id] });
  assert.equal(previews, 1);
  assert.equal(sceneReviews, 1);
  assert.equal(downloads, 0);
  assert.equal(result.selected, 1, JSON.stringify(result.failures));
  assert.equal(result.project.scenes[0]!.documentary!.selected!.kind, "image");
});

test("local stock lookup ignores stopwords and old search queries, ranking actual source metadata", async () => {
  const { root, projects } = await setup();
  const materialRoot = join(root, "Materials"); await mkdir(join(materialRoot, "Catalog"), { recursive: true });
  for (const [id, title, description, query] of [
    ["a", "The teacher", "One of the students", "Icon of the Seas"],
    ["b", "Weather in the Atlantic", "Wind and rain", "SS United States"],
    ["c", "Icon of the Seas", "Cruise ship exterior", "ship"],
    ["d", "Dockside view", "Icon of the Seas at a pier", "pier"],
  ]) {
    const localPath = join(root, `${id}.mp4`); await writeFile(localPath, "metadata lookup fixture");
    await writeFile(join(materialRoot, "Catalog", `${id!.repeat(64)}.json`), JSON.stringify({ title, description, query, kind: "video", localPath }));
  }
  const service = new DocumentaryProjectService(projects, new LocalProjectStorage(join(root, "workspace")), new DocumentarySearch(), materialRoot,
    { download: async () => { throw new Error("No downloads expected"); } });
  assert.deepEqual((await service.localCandidates("Icon of the Seas video")).map(item => item.title), ["Icon of the Seas", "Dockside view"]);
  assert.deepEqual(await service.localCandidates("SS United States"), []);
  assert.deepEqual(await service.localCandidates("the of video"), []);
});

test("resume revisits a repetitive accepted sequence while preserving old material and manual pins", async () => {
  const { root, projects, project } = await setup();
  const video = join(root, "old-wide.mp4");
  await effectFfmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=8:d=9", "-an", "-c:v", "libx264", video]);
  const template = project.scenes[0]!;
  project.scenes = [0, 1, 2].map(order => ({ ...structuredClone(template), id: `wide-${order}`, order, videoPath: video, audioPath: `saved-${order}.mp3`, trimStartSeconds: order * 3, trimEndSeconds: order * 3 + 2,
    documentary: { ...structuredClone(template.documentary!), verified: true, checksum: "wide-source", selected: { kind: "video", id: "old-source", title: "Tractor", description: "Tractor field", provider: "local",
      localPath: video, durationSeconds: 9, width: 640, height: 360, downloadUrl: "", pageUrl: "", author: "Fixture", license: "Owned", licenseUrl: "", rights: "user-confirmed", attribution: "Fixture", query: "tractor", retrievedAt: "now", match: "exact-metadata", concerns: [] },
      requirement: { ...template.documentary!.requirement, plannedBy: "semantic" },
      visualReview: { status: "accepted", confidence: .99, reason: "Aerial view of tractor field", checkedAt: "now", quality: "good", sampleSeconds: [] } } }));
  await projects.update(project.id, project);
  let searches = 0;
  const searcher = new DocumentarySearch(); searcher.search = async () => { searches++; return { candidates: [], sources: [] }; };
  const service = new DocumentaryProjectService(projects, new LocalProjectStorage(join(root, "workspace")), searcher, join(root, "Materials"),
    { download: async () => { throw new Error("No download expected"); } }, () => {}, {
      available: async () => true, plan: async () => { throw new Error("The original plan stays intact"); },
      inspect: async () => ({ status: "rejected", confidence: .99, reason: "Repeated wide view", checkedAt: "now", quality: "good", sampleSeconds: [] }),
    });
  const options = { sceneIds: ["wide-1"] };
  const result = await service.autoSelect(project.id, options);
  assert.ok(searches > 0, "Verified-but-repetitive footage must not be silently skipped on resume");
  assert.equal(result.failed, 1);
  const kept = result.project.scenes[1]!;
  assert.equal(kept.videoPath, video); assert.equal(kept.audioPath, "saved-1.mp3");
  assert.equal(kept.trimStartSeconds, 3); assert.equal(kept.trimEndSeconds, 5);
  assert.match(kept.documentary!.autoError!, /сохранён предыдущий/);
  assert.notEqual(kept.imagePath, result.project.scenes[0]!.imagePath, "Selected excerpts have different cached covers");
  await projects.mutate(project.id, current => ({ scenes: current.scenes.map(scene => scene.id === "wide-1" ? { ...scene, documentary: { ...scene.documentary!, pinned: true } } : scene) }));
  searches = 0;
  assert.equal((await service.autoSelect(project.id, options)).failed, 0);
  assert.equal(searches, 0, "Manual pins are never automatically replaced");
});

for (const [label, Failure] of [["low memory", DocumentaryMemoryUnavailableError], ["full storage", DocumentaryStorageUnavailableError], ["unavailable provider models", AnyModelModelUnavailableError], ["analysis service failure", DocumentaryAnalysisError]] as ReadonlyArray<readonly [string,new(message:string)=>Error]>) test(`automatic selection stops at ${label} and leaves later scenes untouched`, async () => {
  const { root, projects, project } = await setup();
  project.scenes = Array.from({ length: 12 }, (_, order) => ({ ...structuredClone(project.scenes[0]!), id: `stop-${order}`, order }));
  await projects.update(project.id, project);
  let ranked = 0;
  const failedSceneIds = new Set<string>();
  const candidate: DocumentaryCandidate = { id: "commons:tractor", provider: "commons", kind: "video", title: "Red tractor field", description: "Red tractor",
    downloadUrl: "https://upload.wikimedia.org/tractor.mp4", pageUrl: "https://commons.wikimedia.org/wiki/File:tractor", author: "Fixture", license: "CC0", rights: "public-domain",
    attribution: "Fixture", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/", query: "tractor", retrievedAt: "2026-09-15", match: "unverified", concerns: [], width: 1280, height: 720, durationSeconds: 10 };
  const searcher = new DocumentarySearch();
  searcher.search = async () => ({ candidates: [candidate], sources: [{ provider: "commons", count: 1 }] });
  const service = new DocumentaryProjectService(projects, new LocalProjectStorage(join(root, "projects")), searcher, join(root, "materials"),
    { download: async () => { throw new Error("No download expected"); } }, () => {}, {
      available: async () => true,
      plan: async (_project, scenes) => new Map(scenes.map(scene => [scene.id, { ...scene.documentary!.requirement, entities: ["tractor"], queries: ["tractor"], preferredKind: "video", plannedBy: "semantic" }])),
      rankCandidates: async (_project, scene) => { ranked++; failedSceneIds.add(scene.id); throw new Failure(`Preparation stopped: ${label}`); },
      inspect: async () => { throw new Error("No inspection expected"); },
    });
  await assert.rejects(service.autoSelect(project.id), Failure);
  assert.ok(ranked >= 1 && ranked <= 8, "Only already-started workers may reach the failing boundary (at most eight)");
  const saved = (await projects.get(project.id))!;
  // Parallel scenes can reach this boundary in either order. The actual failing
  // scene gets the reason; no later paid inspection or download is launched.
  for (const id of failedSceneIds) assert.equal(saved.scenes.find(scene => scene.id === id)!.documentary!.autoError, `Preparation stopped: ${label}`);
  assert.ok(saved.scenes.filter(scene => !failedSceneIds.has(scene.id)).every(scene => scene.documentary!.autoError === undefined));
  assert.ok(saved.scenes.slice(8).every(scene => !failedSceneIds.has(scene.id)), "Do not launch queued scenes after the first fatal failure");
  assert.equal(saved.videoBrief!.readyScript, project.videoBrief!.readyScript);
});

test("YouTube receives the planned scene detail and year, plus only one subject fallback", async () => {
  const { root, projects, project } = await setup();
  const queries: string[] = [];
  const searcher = new DocumentarySearch();
  searcher.search = async input => {
    if (input.providers?.includes("youtube")) queries.push(input.query);
    return { candidates: [], sources: [] };
  };
  const service = new DocumentaryProjectService(projects, new LocalProjectStorage(join(root, "projects")), searcher, join(root, "materials"),
    { download: async () => { throw new Error("No downloads expected"); } }, () => {}, {
      available: async () => true,
      plan: async (_project, scenes) => new Map(scenes.map(scene => [scene.id, { ...scene.documentary!.requirement, entities: ["Tractor Alpha", "Maker"], queries: ["Tractor Alpha field tests 1960", "Tractor Alpha engine", "farm machinery"], preferredKind: "video", plannedBy: "semantic" }])),
      inspect: async () => { throw new Error("No inspection expected"); },
    }, undefined, { download: async () => { throw new Error("No videos found"); } });
  await service.autoSelect(project.id, { sceneIds: [project.scenes[0]!.id] });
  assert.deepEqual(queries, ["Tractor Alpha field tests 1960", "Tractor Alpha"]);
  assert.equal((await projects.get(project.id))!.videoBrief!.readyScript, project.videoBrief!.readyScript);
});

test("an uncertain paid analysis submission is not retried after service restart", async () => {
  const { root, project } = await setup(); let submissions = 0;
  const client = { configured: async () => true, documentaryCompletion: async () => { submissions++; throw new Error("Connection lost after submission"); } };
  await assert.rejects(new DocumentaryIntelligence(client, () => root).plan(project, project.scenes), /Connection lost/);
  await assert.rejects(new DocumentaryIntelligence(client, () => root).plan(project, project.scenes), /Автоповтор отключён/);
  assert.equal(submissions, 1);
  const checkpoint = (await readdir(join(root, "Documentary", "Analysis")))[0]!;
  assert.equal(JSON.parse(await readFile(join(root, "Documentary", "Analysis", checkpoint), "utf8")).state, "pending");
});

test("fenced JSON with trailing explanation is parsed without inventing a selection", () => {
  const raw = '```json\n{\n  "choices": [],\n  "reason": "Construction footage only, no maiden voyage",\n  "detailMatch": "none"\n}\n```\n\nThe source shows ship construction, not its maiden cruise.';
  assert.deepEqual(documentaryJson(raw), { choices: [], reason: "Construction footage only, no maiden voyage", detailMatch: "none" });
  assert.throws(() => documentaryJson('```json\n{"choices": []}\n```\n```json\n{"choices": [1]}\n```'), /несколько/);
  assert.throws(() => documentaryJson('```json\n{"choices": [}\n```'));
  assert.throws(() => documentaryJson('{"choices": []} {"choices": [1]}'));
  assert.throws(() => documentaryJson('```json\n[]\n```'));
  assert.deepEqual(documentaryJson('All groups show an unrelated boot review.\n\n{"reviews":[{"id":0,"status":"rejected"}]}'),{reviews:[{id:0,status:'rejected'}]});
  for(const raw of ['Explanation [{"status":"accepted"}]','Explanation {"outer":{"status":"accepted"}', 'Explanation {"status":"rejected"} {"status":"accepted"}', 'Explanation {"description":"the ""CARLTON"" sign"}'])assert.throws(()=>documentaryJson(raw));
});

test("a received answer is recovered from its raw checkpoint without another paid request", async () => {
  const { root, project } = await setup(); let submissions = 0;
  const client = { configured: async () => true, documentaryCompletion: async () => { submissions++; throw new Error("Connection lost"); } };
  const intelligence = new DocumentaryIntelligence(client, () => root);
  await assert.rejects(intelligence.plan(project, project.scenes), /Connection lost/);
  const path = join(root, "Documentary", "Analysis", (await readdir(join(root, "Documentary", "Analysis")))[0]!);
  const result = { scenes: project.scenes.map(scene => ({ id: scene.id, entities: ["tractor"], queries: ["tractor field"], preferredKind: "video" })) };
  const raw = 'Completed analysis follows.\n' + JSON.stringify(result) + '\nExplanation after JSON.';
  await writeFile(path, JSON.stringify({ state: "received", purpose: "search-plan", raw }));
  assert.equal((await intelligence.plan(project, project.scenes)).size, project.scenes.length);
  assert.equal(submissions, 1, "Recovery only parses the stored response");
  const saved = JSON.parse(await readFile(path, "utf8"));
  assert.equal(saved.state, "complete"); assert.equal(saved.raw, raw); assert.deepEqual(saved.result, result);
});

test("a transient terminal provider failure is persisted before one bounded retry", async () => {
  const { root, project } = await setup(); let submissions = 0;
  const client = { configured: async () => true, documentaryCompletion: async () => {
    submissions++;
    if (submissions === 1) throw new AnyModelProviderResponseError("The upstream provider timed out. Try again.");
    return JSON.stringify({ scenes: project.scenes.map(scene => ({ id: scene.id, entities: ["tractor"], queries: ["tractor field"], preferredKind: "video" })) });
  } };
  let waits=0;
  await new DocumentaryIntelligence(client, () => root,async()=>{},undefined,async()=>{
    waits++;const path=join(root,'Documentary','Analysis',(await readdir(join(root,'Documentary','Analysis')))[0]!);
    assert.equal(JSON.parse(await readFile(path,'utf8')).state,'failed');
  }).plan(project, project.scenes);
  assert.equal(waits,32);assert.equal(submissions, 2, "Only the explicitly failed request is retried");
  const path = join(root, "Documentary", "Analysis", (await readdir(join(root, "Documentary", "Analysis")))[0]!);
  assert.equal(JSON.parse(await readFile(path, "utf8")).state, "complete");
});

test("automatic selection downloads real video, runs content inspection, preserves voice and exposes rejected subjects", async () => {
  const { root, projects, project } = await setup();
  const video = join(root, "tractor-fixture.mp4");
  await effectFfmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=4", "-an", "-c:v", "libx264", video]);
  const storage = new LocalProjectStorage(join(root, "projects"));
  let inspections = 0, rankings = 0, acceptFirst = true;
  let preservedSelection: string | undefined;
  const service = new DocumentaryProjectService(projects, storage, new DocumentarySearch(undefined, async () => new Response('{}', { status: 200 }), undefined, async query => ["missing", "fixture-video"].map(id => ({ id, provider: "local", kind: "video", title: "Tractor fixture", description: "Synthetic test, not provider evidence", pageUrl: "", downloadUrl: "", localPath: id === "missing" ? join(root, "missing.mp4") : video, author: "test", license: "Own fixture", licenseUrl: "", rights: "user-confirmed", attribution: "test", query, retrievedAt: "now", match: "unverified", concerns: [] }))), join(root, "Materials"), { download: async () => { throw new Error("not used"); } }, () => {}, {
    available: async () => true,
    rankCandidates: async (_project, _scene, candidates) => { rankings++; return candidates; },
    plan: async (_project, scenes) => new Map(scenes.map(scene => [scene.id, { text: scene.narration, entities: ["tractor"], years: [], queries: ["tractor"], preferredKind: "video", plannedBy: "semantic", accent: "none" }])),
    inspect: async (_project, scene) => {
      inspections++; assert.ok(scene.videoPath);
      const saved = (await projects.get(project.id))!.scenes.find(item => item.id === scene.id)!;
      if (scene.order === 0 && preservedSelection) {
        assert.equal(saved.documentary!.verified, true, "Previous selection remains ready during candidate analysis, including on interruption");
        assert.equal(saved.documentary!.checksum, preservedSelection);
      } else assert.equal(saved.videoPath, undefined, "Unverified candidates are staged outside the selected scene");
      return { status: scene.order === 0 && acceptFirst ? "accepted" : "rejected", confidence: .98, reason: scene.order === 0 && acceptFirst ? "fixture accepted" : "Wrong object", checkedAt: "now", sampleSeconds: [.2, 1, 2], quality: "640x360", trimStartSeconds: .1, trimEndSeconds: 3.5 };
    },
  });
  const original = project.scenes.map(scene => scene.narration).join("");
  const result = await service.autoSelect(project.id);
  assert.equal(result.selected, 1); assert.ok(result.failed > 0); assert.ok(inspections >= project.scenes.length);
  assert.equal(rankings, 0, "A saved local candidate goes straight to the required actual-frame inspection instead of a metadata-only vote");
  assert.ok(result.project.scenes[0]!.videoPath); assert.equal(result.project.scenes[0]!.documentary!.verified, true);
  assert.equal(result.project.scenes[1]!.documentary!.verified, false); assert.equal(result.project.scenes[1]!.documentary!.autoError, "Wrong object");
  assert.equal(result.project.scenes.map(scene => scene.narration).join(""), original);
  const resumed = await service.autoSelect(project.id);
  assert.equal(resumed.skipped, 1, "Normal resume keeps accepted material");
  acceptFirst = false;
  preservedSelection = result.project.scenes[0]!.documentary!.checksum;
  const replaced = await service.autoSelect(project.id, { force: true });
  assert.equal(replaced.skipped, 0, "Explicit replacement reaches already filled scenes");
  assert.equal(replaced.project.scenes[0]!.documentary!.verified, true, "A rejected replacement must not discard the previous verified source");
  assert.equal(replaced.project.scenes[0]!.videoPath, result.project.scenes[0]!.videoPath);
  assert.equal(replaced.project.scenes[0]!.trimEndSeconds, 3.5);
  assert.match(replaced.project.scenes[0]!.documentary!.autoError!, /сохранён предыдущий/);
  assert.equal(replaced.project.scenes[0]!.documentary!.visualReview?.reason, "fixture accepted");
  const untouched = structuredClone(replaced.project.scenes.slice(1));
  const beforeScoped = inspections;
  const scoped = await service.autoSelect(project.id, { force: true, sceneIds: [project.scenes[0]!.id] });
  assert.equal(scoped.total, 1); assert.ok(inspections >= beforeScoped + 1, "A scoped replacement may reject several candidates, but it must inspect the requested scene");
  assert.deepEqual(scoped.project.scenes.slice(1), untouched, "Single-scene replacement leaves every other scene untouched");
  assert.equal((await service.autoSelect(project.id, { force: true, sceneIds: [] })).total, 0);
  await assert.rejects(service.autoSelect(project.id, { sceneIds: ["missing-scene"] }), /больше не существует/);
  const checksum = result.project.scenes[0]!.documentary!.checksum!;
  const { stat } = await import("node:fs/promises");
  const sceneOriginal = await stat(result.project.scenes[0]!.documentary!.selected!.localPath!);
  const libraryOriginal = await stat(join(root, "Materials", "Files", `${checksum}.mp4`));
  assert.equal(sceneOriginal.ino, libraryOriginal.ino, "Same-volume scene and library originals share storage");
  const copyRoot = join(root, "reused-derivatives");
  assert.equal(result.project.scenes[0]!.videoPath, result.project.scenes[0]!.documentary!.selected!.localPath, "Playable documentary video stays in its original format instead of transcoding the entire source");
  // The original is deliberately absent here: cached metadata and poster must be reused without decoding it again.
  const reused = await prepareDocumentaryMedia(copyRoot, { id: checksum, checksum, kind: "video", file: "absent-original.mp4" } as never, join(root, "Materials"), []);
  assert.equal(reused.state, "ready");
  assert.equal(reused.proxy, undefined);
  assert.ok((await readFile(join(copyRoot, reused.poster!))).length > 0);
});

test("cached rejected sources do not consume the allowance for new visual checks on resume", async () => {
  const { root, projects, project } = await setup();
  const photo = join(root, "fixture.png");
  await effectFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=red:s=640x360", "-frames:v", "1", photo]);
  const candidates: DocumentaryCandidate[] = [];
  for (let index = 0; index < 5; index++) {
    const path = join(root, `candidate-${index}.png`); await copyFile(photo, path);
    candidates.push({ id: `candidate-${index}`, provider: "local", kind: "image", title: `Tractor ${index}`, description: "Synthetic fixture", pageUrl: "", downloadUrl: "", localPath: path,
      author: "test", license: "Own fixture", licenseUrl: "", rights: "user-confirmed", attribution: "test", query: "tractor", retrievedAt: "now", match: "unverified", concerns: [] });
  }
  const visited: string[] = []; let acceptThird = true;
  const intelligence = {
    available: async () => true,
    plan: async (_project: typeof project, scenes: typeof project.scenes) => new Map(scenes.map(scene => [scene.id, { ...scene.documentary!.requirement, entities: ["tractor"], queries: ["tractor"], preferredKind: "image" as const, plannedBy: "semantic" as const }])),
    rankCandidates: async (_project: typeof project, _scene: typeof project.scenes[number], pool: DocumentaryCandidate[]) => pool,
    inspect: async () => { throw new Error("Selection should use inspection cache accounting"); },
    inspectForSelection: async (_project: typeof project, scene: typeof project.scenes[number]) => {
      const id = scene.documentary!.selected!.id; visited.push(id);
      return { usedNewAnalysis: !["candidate-0", "candidate-1"].includes(id), review: {
        status: id === "candidate-4" || acceptThird && id === "candidate-2" ? "accepted" as const : "rejected" as const,
        confidence: .99, reason: "Fixture result", checkedAt: "now", sampleSeconds: [], quality: "640x360",
      } };
    },
  };
  const service = new DocumentaryProjectService(projects, new LocalProjectStorage(join(root, "projects")),
    new DocumentarySearch(undefined, async () => new Response('{}'), undefined, async () => candidates), join(root, "Materials"),
    { download: async () => { throw new Error("Local fixture only"); } }, () => {}, intelligence);
  const options = { sceneIds: [project.scenes[0]!.id], force: true };
  const result = await service.autoSelect(project.id, options);
  assert.equal(result.selected, 1);
  assert.deepEqual(visited, ["candidate-0", "candidate-1", "candidate-2"]);
  assert.equal(result.project.scenes[0]!.documentary!.selected!.id, "candidate-2");
  visited.length = 0; acceptThird = false;
  const limited = await service.autoSelect(project.id, options);
  assert.equal(limited.selected, 0);
  assert.deepEqual(visited, ["candidate-0", "candidate-1", "candidate-2", "candidate-3"]);
  assert.equal(limited.project.scenes[0]!.documentary!.selected!.id, "candidate-2", "Prior verified selection survives a rejected replacement");
});

test("photo verification passes explicit media kind without a fake clip duration", async () => {
  const { root, project } = await setup();
  const photo = join(root, "photo.png");
  await effectFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=red:s=640x360", "-frames:v", "1", photo]);
  const scene = project.scenes[0]!;
  scene.imagePath = photo;
  scene.documentary = { ...scene.documentary!, checksum: "photo-fixture", requirement: { ...scene.documentary!.requirement, preferredKind: "video" }, selected: { kind: "image", title: "Fixture", description: "Synthetic test", width: 640, height: 360, durationSeconds: .04 } as never };
  let requests = 0;
  let legacyKey = "";
  const intelligence = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async (system, input, images) => {
    requests++; const data = JSON.parse(input);
    assert.equal(data.mediaKind, "image"); assert.equal(data.duration, null);
    assert.equal(data.requirement, undefined, "Generated search suggestions must not become extra acceptance restrictions"); assert.equal(images!.length, 1);
    assert.equal(data.narration, scene.narration); assert.deepEqual(data.entities, scene.documentary!.requirement.entities);
    assert.equal(data.narrationContext, documentaryNarrationContext(project, scene));
    const { narrationContext: _context, ...legacyInput } = data;
    const legacySystem = system.split(" The narration field is an exact short editing slice,")[0]!;
    legacyKey = createHash("sha256").update(JSON.stringify([2, "visual-overview", legacySystem, JSON.stringify(legacyInput), images])).digest("hex");
    assert.match(system, /photograph is an allowed fallback/);
    return JSON.stringify({ status: "accepted", confidence: .99, reason: "Fixture only", quality: "fixture" });
  } }, () => root);
  const inspection = await intelligence.inspectForSelection(project, scene);
  const { review } = inspection;
  assert.equal(inspection.usedNewAnalysis, true);
  const cached = await intelligence.inspectForSelection(project, scene);
  assert.equal(cached.usedNewAnalysis, false);
  assert.deepEqual({ ...cached.review, checkedAt: undefined }, { ...review, checkedAt: undefined });
  assert.equal(review.status, "accepted"); assert.equal(requests, 1);
  assert.equal(review.trimEndSeconds, undefined);
  const legacyRoot = join(root, "legacy"); await mkdir(join(legacyRoot, "Documentary", "Analysis"), { recursive: true });
  const checkpoint = join(legacyRoot, "Documentary", "Analysis", `${legacyKey}.json`);
  await writeFile(checkpoint, JSON.stringify({ state: "pending", purpose: "visual-overview" }));
  let repeated = 0;
  const guarded = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async () => { repeated++; throw new Error("Must not be submitted"); } }, () => legacyRoot);
  await assert.rejects(guarded.inspect(project, scene), /неизвестный результат/);
  assert.equal(repeated, 0, "Adding context does not bypass a previous uncertain paid inspection");
  await writeFile(checkpoint, '{"state":');
  await assert.rejects(guarded.inspect(project, scene), /повреждена/);
  assert.equal(repeated, 0, "A damaged checkpoint cannot silently order the analysis again");
});

test("visual context uses the complete original sentence while the edit slice stays exact", async () => {
  const { project } = await setup();
  const template = project.scenes[0]!;
  const narrations = ["The first fact ends here. ", "They describe internal volume under different ", "measurement systems. ", "The next fact starts here."];
  project.scenes = narrations.map((narration, order) => ({ ...template, id: `part-${order}`, order, narration }));
  assert.equal(documentaryNarrationContext(project, project.scenes[1]!), narrations[1]! + narrations[2]!);
  assert.equal(documentaryNarrationContext(project, project.scenes[2]!), narrations[1]! + narrations[2]!);
  assert.deepEqual(project.scenes.map(scene => scene.narration), narrations);
});

test("dynamic documentary pacing is faster without changing original text", async () => {
  const { project } = await setup("A machine works in the field while the camera follows its movement. The wheels turn and the soil falls behind it. The next close view shows the moving parts and their purpose. ");
  const calibration = createVoiceCalibration({ provider: "elevenlabs", voice: "fixture", language: "en", sampleText: "This is a measured voice for a local test.", audioDurationSeconds: 4 });
  project.settings.assembly.documentary!.pace = "calm";
  const calm = prepareDocumentaryScript(project, calibration);
  project.settings.assembly.documentary!.pace = "dynamic";
  const fast = prepareDocumentaryScript(project, calibration);
  assert.ok(fast.length > calm.length);
  assert.equal(fast.map(scene => scene.narration).join(""), project.videoBrief!.readyScript);
  assert.ok(fast.every(scene => scene.durationSeconds >= 1.1));
  const remembered = { ...fast.at(-1)!, documentary: { ...fast.at(-1)!.documentary!, requirement: { ...fast.at(-1)!.documentary!.requirement, plannedBy: "semantic" as const } } };
  project.scenes = [remembered];
  assert.equal(prepareDocumentaryScript(project, calibration).at(-1)!.id, remembered.id);
  assert.equal(prepareDocumentaryScript(project, calibration).at(-1)!.documentary!.requirement.plannedBy, "semantic");
});

test("video range verification samples the actual short edit, not a much longer model suggestion", async () => {
  const { root, project } = await setup();
  const video = join(root, "range-fixture.mp4");
  await effectFfmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=4", "-an", "-c:v", "libx264", video]);
  const scene = project.scenes[0]!; scene.durationSeconds = 2; scene.videoPath = video;
  scene.documentary = { ...scene.documentary!, checksum: "range-fixture", selected: { kind: "video", title: "Fixture", description: "Synthetic test", width: 640, height: 360, durationSeconds: 4 } as never };
  let requests = 0;
  let priorRangeKey = "";
  const intelligence = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async (system, input, images) => {
    const data = JSON.parse(input); requests++;
    if (requests === 2) {
      assert.equal(data.startSeconds, .2); assert.equal(data.endSeconds, 2.2);
      assert.ok(data.sampleSeconds.every((time: number) => time >= .2 && time <= 2.2));
      assert.equal(data.earlierOverview, undefined); assert.equal(data.source, undefined);
      assert.match(system, /one actual seat can illustrate seating capacity/);
      assert.match(system, /contradictory brand\/logo\/model means reject/);
      const previousPolicySystem = system.split(" Before deciding relevance, independently inspect")[0]!;
      const priorSystem = previousPolicySystem.slice(0, previousPolicySystem.indexOf(" Only the supplied frames")) + previousPolicySystem.slice(previousPolicySystem.indexOf(" The narration field is an exact short editing slice"));
      const { startSeconds, endSeconds, sampleSeconds, narrationContext, ...request } = data;
      const priorInput = { ...request, source: { title: "Fixture", description: "Synthetic test" }, startSeconds, endSeconds, sampleSeconds, narrationContext };
      priorRangeKey = createHash("sha256").update(JSON.stringify([2, "visual-range", priorSystem, JSON.stringify(priorInput), images])).digest("hex");
    }
    return JSON.stringify({ status: "accepted", isCameraFootage: true, mediaType: "camera", presentation: "clean", confidence: .85, reason: "Fixture", quality: "fixture", startSeconds: .2, endSeconds: 999 });
  } }, () => root);
  const review = await intelligence.inspect(project, scene);
  assert.equal(review.status, "accepted", "An explicit high-confidence approval must not be discarded for an arbitrary extra three points");
  assert.equal(requests, 2); assert.equal(review.trimEndSeconds, 2.2);
  assert.ok(review.sampleSeconds.every(time => time <= 2.2));
  const analysis = join(root, "Documentary", "Analysis"), guardedRoot = join(root, "prior-range");
  const guardedAnalysis = join(guardedRoot, "Documentary", "Analysis"); await mkdir(guardedAnalysis, { recursive: true });
  for (const name of await readdir(analysis)) {
    const saved = await readFile(join(analysis, name), "utf8");
    if (JSON.parse(saved).purpose === "visual-overview") await writeFile(join(guardedAnalysis, name), saved);
  }
  await writeFile(join(guardedAnalysis, `${priorRangeKey}.json`), JSON.stringify({ state: "pending", purpose: "visual-range" }));
  let submissions = 0;
  const guarded = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async () => { submissions++; throw new Error("Must not submit"); } }, () => guardedRoot);
  await assert.rejects(guarded.inspect(project, scene), /неизвестный результат/);
  assert.equal(submissions, 0, "Changing identity evidence must not resubmit an uncertain final range check");
  for (const verdict of [{ status: "accepted", confidence: .82 }, { status: "uncertain", confidence: .95 }, { status: "rejected", confidence: .99 }]) {
    const check = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async () => JSON.stringify({ ...verdict, isCameraFootage: true, reason: "Fixture", quality: "fixture", startSeconds: .2, endSeconds: 2.2 }) }, () => join(root, `verdict-${verdict.status}`));
    const rejected = await check.inspect(project, scene);
    assert.notEqual(rejected.status, "accepted");
    if (verdict.confidence === .82) assert.match(rejected.reason, /Недостаточная уверенность проверки \(82%\)/);
  }
});

for (const detailMatch of ["direct", "general"]) test(`long footage verifies a ${detailMatch} choice before extending its catalogue`, async () => {
  const { root, project } = await setup();
  const video = join(root, "long-range-fixture.mp4");
  await effectFfmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=8:d=96", "-an", "-c:v", "libx264", video]);
  const scene = project.scenes[0]!; scene.durationSeconds = 2; scene.videoPath = video;
  scene.documentary = { ...scene.documentary!, checksum: "long-range-fixture", selected: { kind: "video", title: "Long fixture", description: "Synthetic test", width: 640, height: 360, durationSeconds: 96 } as never };
  const requests: string[] = [];
  const intelligence = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async (system, input) => {
    requests.push(system);
    const data = JSON.parse(input);
    if (system.includes("reusable footage index")) return JSON.stringify({ segments: data.frames.map((frame: { id: number }) => ({ id: frame.id, description: "fixture camera footage", entities: [], camera: true, usable: true })) });
    if (system.includes("Select up to 3 different useful video ranges")) return JSON.stringify({ choices: [{ id: 0, startSeconds: .2 }], detailMatch, reason: "Fixture range" });
    if (system.includes("Inspect the five ACTUAL frames")) return JSON.stringify({ status: "accepted", isCameraFootage: true, mediaType: "camera", presentation: "clean", confidence: .99, identifiedEntity: undefined, reason: "Fixture frames", quality: "640x360" });
    throw new Error("Long fixture must use the catalogue path");
  } }, () => root);
  const review = await intelligence.inspect(project, scene);
  assert.equal(review.status, "accepted");
  assert.equal(requests.length, 3);
  assert.match(requests[0]!, /reusable footage index/);
  assert.match(requests[1]!, /Select up to 3 different useful video ranges/);
  assert.match(requests[2]!, /Inspect the five ACTUAL frames/);
  const path = join(root, "Documentary", "VideoCatalog", "long-range-fixture", "catalog-v1.json");
  const catalog = JSON.parse(await readFile(path, "utf8"));
  assert.ok(catalog.segments.length < catalog.windows.length, "Unused portions do not delay a usable representative view");
  catalog.pendingIds = [catalog.windows.find((window: { id: number }) => !catalog.segments.some((segment: { id: number }) => segment.id === window.id)).id];
  await writeFile(path, JSON.stringify(catalog));
  assert.equal((await intelligence.inspect(project, scene)).status, "accepted", "A later pending catalogue page does not block already described footage");
  assert.equal(requests.length, 3, "Cached inspection does not resubmit the pending page");
});

test("CGI and an omitted footage verdict cannot be approved, and old pending checks survive the policy change", async () => {
  const { root, project } = await setup();
  const video = join(root, "footage-fixture.mp4");
  await effectFfmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=4", "-an", "-c:v", "libx264", video]);
  const scene = project.scenes[0]!; scene.durationSeconds = 2; scene.videoPath = video;
  scene.documentary = { ...scene.documentary!, checksum: "footage-fixture", selected: { kind: "video", title: "Fixture", width: 640, height: 360, durationSeconds: 4 } as never };
  let overview: { system: string; input: string; images: string[] } | undefined;
  for (const finalFootage of [false, undefined]) {
    let calls = 0;
    const intelligence = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async (system, input, images) => {
      calls++;
      if (calls === 1) overview = { system, input, images: images ?? [] };
      return JSON.stringify({ status: "accepted", confidence: .99, isCameraFootage: calls === 1 ? true : finalFootage, reason: "Computer-rendered model", quality: "sharp", startSeconds: .2, endSeconds: 2.2 });
    } }, () => join(root, String(finalFootage)));
    const review = await intelligence.inspect(project, scene);
    assert.equal(calls, 2); assert.equal(review.status, "uncertain");
    assert.match(review.reason, /не подтверждён как натурная съёмка/);
  }
  assert.ok(overview);
  const originalSystem = overview.system.slice(0, overview.system.indexOf(" Also return isCameraFootage:")) + overview.system.slice(overview.system.indexOf(" The narration field is an exact short editing slice"));
  const legacyKey = createHash("sha256").update(JSON.stringify([2, "visual-overview", originalSystem, overview.input, overview.images])).digest("hex");
  const guardRoot = join(root, "legacy-unknown"); await mkdir(join(guardRoot, "Documentary", "Analysis"), { recursive: true });
  await writeFile(join(guardRoot, "Documentary", "Analysis", `${legacyKey}.json`), JSON.stringify({ state: "pending", purpose: "visual-overview" }));
  let submissions = 0;
  const guarded = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async () => { submissions++; throw new Error("Must not submit"); } }, () => guardRoot);
  await assert.rejects(guarded.inspect(project, scene), /неизвестный результат/);
  assert.equal(submissions, 0);
  const refusalPath = join(guardRoot, "Documentary", "Analysis", `${legacyKey}.json`);
  await writeFile(refusalPath, JSON.stringify({ state: "rejected", purpose: "visual-overview", rejection: "model-unavailable" }));
  const resumed = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async () => { submissions++; return JSON.stringify({ status: "accepted", confidence: .95, isCameraFootage: true, mediaType: "camera", presentation: "clean", reason: "Fixture", quality: "fixture", startSeconds: .2, endSeconds: 2.2 }); } }, () => guardRoot);
  assert.equal((await resumed.inspect(project, scene)).status, "accepted");
  assert.equal(submissions, 2, "An explicit historical refusal permits a bounded later attempt; it is not an uncertain charge");
  assert.equal(JSON.parse(await readFile(refusalPath, "utf8")).state, "rejected", "Preserve the old refusal record");
});

test("semantic candidate ranking keeps stable paid checkpoints and cannot invent a source or approve frames", async () => {
  const { project, root } = await setup();
  const scene = project.scenes[0]!;
  scene.documentary!.requirement.entities = ["Tractor Alpha"];
  const source = (id: string, title: string): DocumentaryCandidate => ({ id, title, provider: "commons", kind: "video", description: "Source description",
    pageUrl: `https://example.org/${id}`, downloadUrl: `https://example.org/${id}.mp4`, author: "Source author", license: "CC BY", licenseUrl: "", rights: "licensed", attribution: "", query: "Tractor Alpha", retrievedAt: "", match: "unverified", concerns: [] });
  const unrelated = source("unrelated", "Statue of Liberty"), relevant = source("relevant", "Tractor Alpha at work");
  let calls = 0;
  let rankingRequest: { system: string; input: string } | undefined;
  const intelligence = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async (system, input, media) => {
    calls++; assert.equal(media?.length, 0); assert.match(system, /does not approve contents/);
    rankingRequest = { system, input };
    const data = JSON.parse(input);
    assert.ok(data.candidates.every((item: { id: string }) => /^[a-f0-9]{8}$/.test(item.id)), "Do not ask the model to copy 64-digit hashes");
    assert.equal(data.narration, scene.narration); assert.deepEqual(data.entities, ["Tractor Alpha"]);
    return JSON.stringify({ ids: [data.candidates.find((item: { title: string }) => item.title === relevant.title).id.slice(0, 8) + "..."], reason: "Metadata plausibility only" });
  } }, () => root);
  assert.deepEqual((await intelligence.rankCandidates(project, scene, [unrelated, relevant])).map(item => item.id), ["relevant"]);
  assert.deepEqual((await intelligence.rankCandidates(project, scene, [relevant, unrelated])).map(item => item.id), ["relevant"]);
  assert.equal(calls, 1, "A different search-result order must not submit the paid selection again");
  assert.equal(scene.documentary!.verified, false);
  const legacyInput = JSON.parse(rankingRequest!.input);
  for (const item of legacyInput.candidates) item.id = createHash("sha256").update([unrelated, relevant].find(candidate => candidate.title === item.title)!.downloadUrl!).digest("hex");
  const legacyKey = createHash("sha256").update(JSON.stringify([2, "candidate-relevance", rankingRequest!.system, JSON.stringify(legacyInput), []])).digest("hex");
  const legacyRoot = join(root, "long-id-checkpoint"), legacyPath = join(legacyRoot, "Documentary", "Analysis", `${legacyKey}.json`);
  await mkdir(join(legacyRoot, "Documentary", "Analysis"), { recursive: true });
  let migrationCalls = 0;
  const migrated = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async () => { migrationCalls++; throw new Error("Must not submit"); } }, () => legacyRoot);
  await writeFile(legacyPath, JSON.stringify({ state: "pending", purpose: "candidate-relevance" }));
  await assert.rejects(migrated.rankCandidates(project, scene, [unrelated, relevant]), /неизвестный результат/);
  await writeFile(legacyPath, JSON.stringify({ state: "complete", purpose: "candidate-relevance", result: { ids: [legacyInput.candidates.find((item: { title: string }) => item.title === relevant.title).id] } }));
  assert.equal((await migrated.rankCandidates(project, scene, [unrelated, relevant]))[0]!.id, relevant.id);
  assert.equal(migrationCalls, 0, "Neither an uncertain charge nor a correct completed legacy ranking is submitted again");
  const invalid = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async () => JSON.stringify({ ids: ["invented-source"] }) }, () => join(root, "invalid"));
  await assert.rejects(invalid.rankCandidates(project, scene, [relevant]), /неизвестный материал/);
  let uncertainCalls = 0;
  const uncertain = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async () => { uncertainCalls++; throw new Error("Connection interrupted"); } }, () => join(root, "uncertain-ranking"));
  await assert.rejects(uncertain.rankCandidates(project, scene, [relevant]), /interrupted/);
  await assert.rejects(uncertain.rankCandidates(project, scene, [relevant]), /Автоповтор отключён/);
  assert.equal(uncertainCalls, 1);
  let rejectedCalls = 0;
  const declined = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async (_system, input) => {
    rejectedCalls++;
    if (rejectedCalls === 1) throw new AnyModelModelUnavailableError("Explicit model rejection before any completion");
    return JSON.stringify({ ids: [JSON.parse(input).candidates[0].id] });
  } }, () => join(root, "known-rejection"));
  await assert.rejects(declined.rankCandidates(project, scene, [relevant]), AnyModelModelUnavailableError);
  assert.equal((await declined.rankCandidates(project, scene, [relevant]))[0]!.id, relevant.id);
  assert.equal(rejectedCalls, 2, "A known refusal is distinct from an uncertain paid submission");
});

test('English diagram captions reach semantic review for non-Latin scene subjects', () => {
  const diagram: DocumentaryCandidate = { id: 'diagram', provider: 'commons', kind: 'image', title: 'Model T Power Plant - Semi-sectional',
    description: 'Engine cutaway showing pistons and connecting rods', pageUrl: '', downloadUrl: '', author: '', license: 'PD', licenseUrl: '',
    rights: 'public-domain', attribution: '', retrievedAt: 'now', query: 'engine pistons connecting rods crankshaft cutaway', match: 'unverified', concerns: [] };
  const subjects = ['поршни', 'шатуны', 'коленчатый вал'];
  assert.deepEqual(selectDocumentaryCandidates([diagram], subjects, new Set()), [], 'Keep literal filtering without a semantic reviewer');
  assert.deepEqual(selectDocumentaryCandidates([diagram], subjects, new Set(), [], true), [diagram]);
  assert.equal(diagram.match, 'unverified', 'Discovery never approves the diagram');
  assert.deepEqual(selectDocumentaryCandidates([{ ...diagram, rights: 'unknown' }], subjects, new Set(), [], true), []);
  assert.deepEqual(selectDocumentaryCandidates([{ ...diagram, width: 120, height: 80 }], subjects, new Set(), [], true), []);
});

test("abbreviated candidate IDs resolve only exact unique prefixes, never guessed sources", () => {
  const first = "0bc892d9" + "1".repeat(56), collision = "0bc892d9" + "2".repeat(56), other = "fb15e92e" + "3".repeat(56);
  assert.deepEqual(resolveDocumentaryCandidateKeys(["0bc892d9...", "fb15e92e", first], [first, other]), [first, other]);
  assert.deepEqual(resolveDocumentaryCandidateKeys(["0bc892", "fb15e9"], [first, other]), [first, other], "A live saved answer shortened six supplied hashes to six unique hex digits");
  assert.deepEqual(resolveDocumentaryCandidateKeys([first], [first, collision]), [first]);
  assert.deepEqual(resolveDocumentaryCandidateKeys(["invented", "0bc892d8...", other], [first, other]), [other]);
  assert.deepEqual(resolveDocumentaryCandidateKeys(["0bc892d9...", other], [first, collision, other]), [other]);
  assert.throws(() => resolveDocumentaryCandidateKeys(["0bc892d9..."], [first, collision]), /неизвестный материал/);
  assert.throws(() => resolveDocumentaryCandidateKeys(["0bc89..."], [first]), /неизвестный материал/);
  assert.throws(() => resolveDocumentaryCandidateKeys(["0bc892"], [first, collision]), /неизвестный материал/);
  assert.throws(() => resolveDocumentaryCandidateKeys(["0bc892d8..."], [first]), /неизвестный материал/);
});

test("named subjects prioritize the exact-query pool before generic search results consume checks", () => {
  const dredger = { text: "Земснаряды убирают отложения", entities: ["земснаряд"], identities: [{ name: "Панамский канал", aliases: ["Panama Canal"] }], years: [], queries: ["Panama Canal dredging operation footage"] };
  assert.deepEqual(documentarySearchQueries(dredger, "image"), ["Panama Canal dredging", "Panama Canal"]);
  assert.deepEqual(documentarySearchQueries(dredger, "video"), ["Panama Canal dredging operation footage", "Panama Canal"]);
  const refined = { ...dredger, identities: [{ name: "Неопанамакс", aliases: ["Neopanamax"] }], queries: ["Neopanamax ship Agua Clara locks", "Cocoli locks large container ship"], searchRefined: true };
  assert.deepEqual(documentarySearchQueries(refined), ["Neopanamax ship Agua Clara locks", "Neopanamax Cocoli locks large container ship", "Neopanamax ship", "Cocoli locks large container ship"]);
  const machinery = { ...dredger, searchRefined: true, queries: ["dredger vessel Gatun Lake", "Panama Canal dredging operation footage"] };
  assert.ok(documentarySearchQueries(machinery, "image").includes("Panama Canal dredger"), "An over-specific location chain must leave a bounded named-subject + actual detail fallback");
  assert.deepEqual(documentarySearchQueries({ text: "Built at the factory", entities: ["Factory", "Company"], years: [],
    queries: ["Factory location", "Exact machine assembly footage", "Machine detail at factory"] }), ["Factory location", "Exact machine assembly footage", "Machine detail at factory", "Factory"], "A contextual company name must not displace the generated exact-object footage query");
  const base = { provider: "local" as const, kind: "video" as const, description: "", pageUrl: "", downloadUrl: "", author: "", license: "Own", licenseUrl: "", rights: "user-confirmed" as const, attribution: "", query: "SS United States", retrievedAt: "", concerns: [] };
  const result = selectDocumentaryCandidates([{ ...base, id: "wrong", title: "Statue of Liberty", match: "unverified" }, { ...base, id: "right", title: "SS United States underway", match: "exact-metadata" }], ["SS United States"], new Set());
  assert.deepEqual(result.map(item => item.id), ["right"]);
  const classPhoto = { ...base, id: "locks-photo", kind: "image" as const, title: "Container ship entering the new Cocoli locks of the Panama Canal", query: "Cocoli locks large container ship", match: "unverified" as const };
  assert.equal(selectDocumentaryCandidates([classPhoto], ["Neopanamax"], new Set()).length, 0);
  const admitted = selectDocumentaryCandidates([classPhoto], ["Neopanamax"], new Set(), [], true, [classPhoto.query]);
  assert.equal(admitted.length, 1); assert.equal(admitted[0]!.match, "unverified", "A scoped semantic search result still needs actual identity review");
  assert.equal(selectDocumentaryCandidates([{ ...classPhoto, rights: "unknown" }], ["Neopanamax"], new Set(), [], true, [classPhoto.query]).length, 0);
  const noisyPhotos = Array.from({ length: 45 }, (_, i) => ({ ...classPhoto, id: `generic-${i}`, title: "Container ship in a foreign port" }));
  const shortList = selectDocumentaryCandidates([...noisyPhotos, classPhoto], ["Neopanamax"], new Set(), [], true, [classPhoto.query]);
  assert.equal(shortList[0]!.id, classPhoto.id, "A source matching the refined place must reach the 40-item semantic shortlist ahead of generic stock noise");
  const archives = Array.from({ length: 24 }, (_, i) => ({ ...classPhoto, id: `archive-${i}`, provider: "commons" as const }));
  const mixed = documentaryRankingPool([...noisyPhotos.map(c => ({ ...c, provider: "pixabay" as const })), ...archives]);
  assert.equal(mixed.length, 40);
  assert.ok(mixed.some(c => c.id === archives.at(-1)!.id), "The documented dredger must not disappear behind a large generic stock response");
  assert.equal(mixed.filter(c => c.provider === "pixabay").length, 16, "Stock alternatives remain eligible, not globally excluded");
  const namesakes = [
    { ...base, id: "country", title: "Empire State Building, United States", match: "unverified" as const },
    { ...base, id: "suffix", title: "Glass United States lighthouse", match: "unverified" as const },
    { ...base, id: "dotted", title: "S.S. United States underway", match: "unverified" as const },
    result[0]!
  ];
  assert.deepEqual(selectDocumentaryCandidates(namesakes, ["SS United States"], new Set()).map(item => item.id), ["right", "dotted"], "A country match cannot consume a ship's bounded visual checks; punctuation in its prefix is harmless");
  const remote = Array.from({ length: 8 }, (_, index) => ({ ...base, id: `remote-${index}`, title: "Subject", match: "unverified" as const }));
  const cached = { ...base, id: "cached", title: "Subject", localPath: "owned.mp4", match: "unverified" as const };
  assert.deepEqual(documentaryCandidateAttempts([...remote, cached]).map(item => item.id), ["remote-0", "remote-1", "remote-2", "cached", "remote-3", "remote-4"], "Unavailable remote originals must not crowd every usable cached candidate out of the bounded attempts");
  assert.equal(documentaryCandidateAttempts([...remote, cached], ["Subject"])[0]!.id, "cached", "A named cached source can be verified before waiting for remote downloads");
  assert.equal(documentaryCandidateAttempts([remote[0]!, { ...cached, title: "Statue of Liberty United States" }], ["SS United States"])[0]!.id, "remote-0", "A country name alone cannot prioritize a different cached object");
  assert.deepEqual(selectDocumentaryCandidates([{ ...base, id: "tiny", title: "SS United States", width: 320, height: 180, match: "exact-metadata" }, result[0]!], ["SS United States"], new Set()).map(item => item.id), ["right"]);
  assert.deepEqual(selectDocumentaryCandidates([{ ...base, id: "huge", title: "SS United States", bytes: 900 * 1024 * 1024, match: "exact-metadata" }, result[0]!], ["SS United States"], new Set()).map(item => item.id), ["right"]);
  const partial = selectDocumentaryCandidates([{ ...base, id: "yard", title: "Perno shipyard, Turku, Finland", match: "unverified" }], ["Meyer Turku"], new Set());
  assert.equal(partial.length, 1, "Metadata missing a brand may still lead to real frames that show it");
  assert.equal(partial[0]!.match, "unverified", "Partial wording is never visual approval");
  const related = { ...base, id: "related", title: "Different machine", description: "Compared with SS United States", match: "exact-metadata" as const };
  assert.equal(selectDocumentaryCandidates([related, { ...base, id: "exact", title: "SS United States", match: "unverified" }], ["SS United States"], new Set(["exact"]))[0]!.id, "exact");
  assert.equal(selectDocumentaryCandidates([{ ...base, id: "modern", title: "SS United States 2009", match: "exact-metadata" }, { ...base, id: "historical", title: "SS United States 1952", match: "exact-metadata" }], ["SS United States"], new Set(["historical"]), ["1952"])[0]!.id, "historical");
});

test("generic stock queries admit unlabelled videos for inspection without approving identity or unknown rights", () => {
  const requirement = { text: "Tractor Alpha works in the field", entities: ["Tractor Alpha"], years: [], queries: ["Tractor Alpha tractor working field", "Tractor Alpha farm aerial footage"] };
  assert.deepEqual(documentaryStockQueries(requirement), ["tractor working field", "farm aerial"]);
  assert.deepEqual(documentaryStockQueries({ ...requirement, entities: ["C++"], queries: ["C++ code editor screen"] }), ["code editor screen"]);
  const video: DocumentaryCandidate = { id: "generic", provider: "pexels", kind: "video", title: "Green tractor in a field", description: "", downloadUrl: "https://example.org/tractor.mp4", pageUrl: "https://example.org/tractor", author: "Fixture author", license: "Fixture license", licenseUrl: "", attribution: "Fixture", query: "tractor field", retrievedAt: "", rights: "licensed", width: 1280, height: 720, durationSeconds: 8, match: "unverified", concerns: [] };
  assert.equal(selectDocumentaryCandidates([video], ["Alpha Machine"], new Set()).length, 0);
  const discovered = selectDocumentaryCandidates([video], ["Alpha Machine"], new Set(), [], true);
  assert.equal(discovered.length, 1); assert.equal(discovered[0]!.match, "unverified");
  assert.equal(selectDocumentaryCandidates([{ ...video, rights: "unknown" }], ["Alpha Machine"], new Set(), [], true).length, 0);
  assert.equal(selectDocumentaryCandidates([{ ...video, provider: "commons", title: "Statue of Liberty" }], ["SS United States"], new Set(), [], true).length, 0);
  const saved = { ...video, provider: "commons" as const, title: "Canal transit", localPath: "D:/saved/transit.mp4" };
  assert.equal(selectDocumentaryCandidates([saved], ["Gatun Lake"], new Set(), [], true)[0]?.match, "unverified", "Saved footage reaches catalog ranking even when only an interior range names the lake");
  assert.equal(selectDocumentaryCandidates([{ ...saved, rights: "unknown" }], ["Gatun Lake"], new Set(), [], true).length, 0);
  assert.equal(selectDocumentaryCandidates([{ ...saved, title: "Panama Canal | 360º Video" }], ["Panama Canal"], new Set(), [], true).length, 0, "Spherical saved footage cannot bypass projection checks via local admission");
});

test("abstract editorial queries keep the actual subjects and explicit dates without rewriting narration", async () => {
  const { project } = await setup();
  // This tests cross-scene context, not how calibration splits the short fixture.
  project.scenes=[project.scenes[0]!,{...structuredClone(project.scenes[0]!),id:'temporal-transition',order:1}];
  project.scenes[0]!.documentary!.requirement = { text: project.scenes[0]!.narration, entities: ["Tractor A", "Tractor B"], years: [], queries: ["Tractor A"], plannedBy: "semantic" };
  project.scenes[1]!.narration = "Separated by decades, from 1952 onward.";
  project.scenes[1]!.documentary!.requirement = { text: project.scenes[1]!.narration, entities: [], years: [], queries: ["historical timeline"], detail: "Temporal transition", plannedBy: "semantic" };
  const grounded = groundDocumentaryScenes(project.scenes);
  assert.deepEqual(grounded[1]!.documentary!.requirement.entities, ["Tractor A", "Tractor B"]);
  assert.deepEqual(grounded[1]!.documentary!.requirement.years, ["1952"]);
  assert.equal(grounded[1]!.narration, project.scenes[1]!.narration);
  assert.deepEqual(groundDocumentaryScenes(grounded), grounded);
});

test("continuing references cannot approve an unrelated object after losing their named subject", async () => {
  const { project } = await setup();
  const first = project.scenes[0]!;
  const named = { ...first, id: "named", order: 0, narration: "Tractor Alpha has a large engine. ", documentary: { ...first.documentary!, requirement: { text: "Tractor Alpha has a large engine. ", entities: ["Tractor Alpha"], years: [], queries: ["Tractor Alpha"], plannedBy: "semantic" as const } } };
  const referential = { ...first, id: "ref", order: 1, narration: "Its capacity is not its weight. ", documentary: { ...first.documentary!, verified: true, pinned: false, requirement: { text: "Its capacity is not its weight. ", entities: [], years: [], queries: ["generic tractor"], plannedBy: "semantic" as const, preferredKind: "video" as const } } };
  const grounded = groundDocumentaryScenes([named, referential]);
  assert.deepEqual(grounded[1]!.documentary!.requirement.entities, ["Tractor Alpha"]);
  assert.equal(grounded[1]!.documentary!.verified, false, "Old context-free approval cannot be used in the final movie");
  assert.equal(grounded[1]!.documentary!.requirement.preferredKind, "video");
  assert.equal(grounded[1]!.narration, referential.narration);
  assert.deepEqual(groundDocumentaryScenes(grounded), grounded);
  const pinned = groundDocumentaryScenes([named, { ...referential, documentary: { ...referential.documentary, pinned: true } }]);
  assert.equal(pinned[1]!.documentary!.verified, true, "An explicit manual choice is preserved");
  const continuation = groundDocumentaryScenes([named,
    { ...referential, narration: "They describe its capacity under ", documentary: { ...referential.documentary, verified: false } },
    { ...referential, id: "tail", order: 2, narration: "different measurement systems. ", documentary: { ...referential.documentary, verified: false } }
  ]);
  assert.deepEqual(continuation[2]!.documentary!.requirement.entities, ["Tractor Alpha"], "A cut in the middle of a sentence preserves its subject even without another pronoun");
});

test('an alternative longer route does not create a mandatory two-source comparison', async () => {
  const { project } = await setup();
  const scene = project.scenes[0]!;
  scene.documentary!.requirement = { ...scene.documentary!.requirement, entities: ['Cape Horn route', 'Panama Canal'], detail: 'alternative longer route around the continent' };
  scene.documentary!.verified = true;
  scene.documentary!.layout = 'compare';
  scene.documentary!.autoError = 'Для сравнения нужен отдельно проверенный материал: Cape Horn route';
  assert.deepEqual(documentaryComparisonSubjects(scene.documentary!.requirement), []);
  assert.equal(planDocumentaryComparisons(project)[0]!.documentary!.layout, 'full');
  scene.documentary!.pinned = true;
  assert.equal(planDocumentaryComparisons(project)[0]!.documentary!.layout, 'compare');
});

test("comparison connects two separately verified objects and remains blocked without the second source", async () => {
  const { project } = await setup();
  const first = project.scenes[0]!, second = project.scenes[1]!;
  first.documentary = { ...first.documentary!, verified: true, requirement: { ...first.documentary!.requirement, entities: ["Tractor A", "Tractor B"], detail: "Both tractors side by side" }, visualReview: { status: "accepted", confidence: .98, reason: "fixture", checkedAt: "now", sampleSeconds: [0], quality: "fixture", identifiedEntity: "Tractor A" } };
  assert.equal(documentaryComparisonSubjects(first.documentary.requirement).length, 2);
  assert.equal(documentaryComparisonSubjects({ ...first.documentary.requirement, detail: "Size advantage", text: "That makes this one fifth longer." }).length, 2);
  project.scenes = planDocumentaryComparisons(project);
  assert.ok(documentaryEditErrors(project).some(error => error.includes("сравнения")));
  second.imagePath = "fixture.png";
  second.documentary = { ...second.documentary!, verified: true, requirement: { ...second.documentary!.requirement, entities: ["Tractor B"] }, selected: { title: "Tractor B", description: "Tractor B at work" } as never };
  project.scenes[1] = second;
  project.scenes = planDocumentaryComparisons(project);
  assert.equal(project.scenes[0]!.documentary!.comparison?.sceneId, second.id);
  assert.equal(documentaryEditErrors(project).length, 0);
  const pairs = [0, 1, 2].flatMap(index => [
    { ...first, id: `left-${index}`, order: index * 2, documentary: { ...first.documentary!, comparison: undefined } },
    { ...second, id: `right-${index}`, order: index * 2 + 1 },
  ]);
  const varied = planDocumentaryComparisons({ ...project, scenes: pairs });
  assert.deepEqual(varied.filter(scene => scene.id.startsWith("left-")).map(scene => scene.documentary!.comparison!.sceneId), ["right-0", "right-1", "right-2"], "Comparisons must not all replay the first source");
  assert.deepEqual(planDocumentaryComparisons({ ...project, scenes: varied }), varied, "Already saved/user-edited comparisons stay intact");
});

test("continuous narration preserves all samples across rapid cuts and rejects a changed scene order", async () => {
  const { project } = await setup();
  const ids = project.scenes.map(scene => scene.id);
  assert.equal(documentaryNarrationText(project, { narrationSceneIds: ids }), project.videoBrief!.readyScript);
  const scenes = distributeDocumentaryNarration(project, ids, "original.mp3", { durationSeconds: 10.3, speechStartSeconds: .12, speechEndSeconds: 10, silences: [{ startSeconds: 4.8, endSeconds: 5 }] });
  assert.equal(scenes[0]!.narrationSlice!.startSeconds, .1);
  for (let i = 1; i < scenes.length; i++) assert.equal(scenes[i]!.narrationSlice!.startSeconds, scenes[i - 1]!.narrationSlice!.endSeconds);
  assert.equal(scenes.at(-1)!.narrationSlice!.endSeconds, 10);
  assert.equal(scenes.map(scene => scene.narration).join(""), project.videoBrief!.readyScript);
  assert.throws(() => documentaryNarrationText({ ...project, scenes: [...project.scenes].reverse().map((scene, order) => ({ ...scene, order })) }, { narrationSceneIds: ids }), /порядок/);
  const starts = ids.map((_, i) => i === 0 ? .1 : 8 * i / ids.length);
  const aligned = distributeDocumentaryNarration(project, ids, "original.mp3", { durationSeconds: 10.3, speechStartSeconds: .12, speechEndSeconds: 10, silences: [] }, starts);
  assert.equal(aligned[0]!.narrationSlice!.endSeconds, Math.round(starts[1]! * 30) / 30);
  assert.equal(aligned[0]!.documentary!.narrationAlignment, "audio-analysis");
  assert.throws(() => distributeDocumentaryNarration(project, ids, "original.mp3", { durationSeconds: 10, speechStartSeconds: 0, speechEndSeconds: 10 }, [0, 0]), /привязка/);
});

test("continuous preview shares one normalized voice and keeps adjacent sample ranges", async () => {
  const { root, project } = await setup();
  const audio = join(root, "track.wav");
  await effectFfmpeg(["-y", "-f", "lavfi", "-i", "sine=f=440:d=6", audio]);
  project.settings.voice.enabled = true; project.settings.assembly.audioNormalize = true;
  project.scenes = distributeDocumentaryNarration(project, project.scenes.map(scene => scene.id), audio,
    { durationSeconds: 6, speechStartSeconds: 0, speechEndSeconds: 6 });
  const storage = new LocalProjectStorage(join(root, "workspace"));
  const scenes = await prepareDocumentaryTiming(project, storage);
  assert.equal(new Set(scenes.map(scene => scene.documentary!.timing!.audioPath)).size, 1);
  assert.equal(scenes[0]!.documentary!.timing!.audioStartSeconds, 0);
  assert.equal(scenes.at(-1)!.documentary!.timing!.audioEndSeconds, 6);
  for (let i = 1; i < scenes.length; i++) assert.equal(scenes[i]!.documentary!.timing!.audioStartSeconds, scenes[i - 1]!.documentary!.timing!.audioEndSeconds);
  const files = await readdir(join(storage.projectDirectory(project.id), "Documentary", "Narration"));
  assert.equal(files.filter(file => file.endsWith('.wav')).length, 1);
  assert.deepEqual(await prepareDocumentaryTiming({ ...project, scenes }, storage), scenes);
});

test("scene narration is measured for material selection before its render WAV is prepared", async () => {
  const { root, project } = await setup();
  const audio = join(root, "scene.mp3");
  await effectFfmpeg(["-y", "-f", "lavfi", "-i", "sine=f=440:d=1", "-c:a", "libmp3lame", audio]);
  project.settings.voice.enabled = true;
  project.scenes = [{ ...project.scenes[0]!, audioPath: audio }];
  const storage = new LocalProjectStorage(join(root, "workspace"));
  const measured = await prepareDocumentaryTiming(project, storage, { prepareAudio: false });
  const timing = measured[0]!.documentary!.timing!;
  assert.equal(timing.audioPath, audio);
  assert.ok(timing.speechSeconds > .9);
  assert.ok(timing.durationInFrames >= 30);
  assert.deepEqual((await readdir(join(storage.projectDirectory(project.id), "Documentary", "Narration"))).filter(file => file.endsWith(".wav")), []);
  const prepared = await prepareDocumentaryTiming({ ...project, scenes: measured }, storage);
  assert.notEqual(prepared[0]!.documentary!.timing!.sourceKey, timing.sourceKey);
  assert.match(prepared[0]!.documentary!.timing!.audioPath!, /\.wav$/);
  assert.deepEqual(await prepareDocumentaryTiming({ ...project, scenes: prepared }, storage, {prepareAudio:false}),prepared,"Returning to material selection must preserve prepared voice checkpoints");
  assert.deepEqual(await prepareDocumentaryTiming({ ...project, scenes: prepared }, storage),prepared,"A retry must keep the same measured WAV, not regenerate it");
});

test("large documentary photos use a bounded working copy without changing the original or review", async () => {
  const { root, project } = await setup();
  const original = join(root, "large.png");
  await effectFfmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=s=5000x400", "-frames:v", "1", original]);
  const before = await readFile(original), checksum = createHash('sha256').update(before).digest('hex');
  const scene = { ...project.scenes[0]!, imagePath: original, documentary: { ...project.scenes[0]!.documentary!, checksum, verified: true, selected: { id: 'large', kind: 'image', width: 5000, height: 400, localPath: original } as never } };
  const [prepared] = await prepareDocumentaryImages(root, [scene]);
  assert.notEqual(prepared!.imagePath, original);
  assert.equal((await probeEffectMedia(prepared!.imagePath!)).width, 3840);
  assert.deepEqual(await readFile(original), before);
  assert.deepEqual(prepared!.documentary, scene.documentary);
  assert.deepEqual(await prepareDocumentaryImages(root, [prepared!]), [prepared]);
  await rm(prepared!.imagePath!);
  const [restored] = await prepareDocumentaryImages(root, [prepared!]);
  assert.equal(restored!.imagePath, prepared!.imagePath);
  assert.equal((await probeEffectMedia(restored!.imagePath!)).width, 3840);
  assert.deepEqual(await readFile(original), before);
});

test("uncertain audio alignment keeps the original and received answer without another paid analysis", async () => {
  const { root, project } = await setup();
  const audioPath = join(root, "unaligned.mp3");
  await effectFfmpeg(["-y", "-f", "lavfi", "-i", "sine=f=220:d=1", "-c:a", "libmp3lame", audioPath]);
  const original = await readFile(audioPath); let requests = 0;
  const intelligence = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async () => { requests++; return JSON.stringify({ complete: false, confidence: .3, starts: [] }); } }, () => root);
  const timing = { durationSeconds: 1, speechStartSeconds: 0, speechEndSeconds: 1 };
  await assert.rejects(intelligence.alignNarration(project, audioPath, timing), /уверенно/);
  await assert.rejects(intelligence.alignNarration(project, audioPath, timing), /уверенно/);
  assert.equal(requests, 1);
  assert.deepEqual(await readFile(audioPath), original);
});

test("Stock prepares one voice before missing materials and retains it when alignment is unavailable", async () => {
  const { root, projects, project } = await setup();
  const audioPath = join(root, "voice.mp3");
  await effectFfmpeg(["-y", "-f", "lavfi", "-i", "sine=f=330:d=6", "-c:a", "libmp3lame", audioPath]);
  project.settings.voice = { ...project.settings.voice, enabled: true, provider: "elevenlabs", voice: "fixture", singleTrack: true };
  project.settings.assembly.documentary = { ...project.settings.assembly.documentary!, narrationMode: "continuous" };
  project.scenes[0]!.imagePath = "preserve-an-existing-image.png";
  await projects.update(project.id, project);
  const storage = new LocalProjectStorage(join(root, "workspace"));
  const renderer = new StandardRenderer(storage); renderer.isAvailable = () => false;
  let requests = 0;
  const voice = { configured: async () => true, tts: async (text: string) => {
    requests++; assert.equal(text, project.videoBrief!.readyScript); return readFile(audioPath);
  } };
  const analyzer = { configured: async () => true, documentaryCompletion: async () => { throw new AnyModelModelUnavailableError("Model unavailable"); } };
  const repository = new FileTaskRepository(join(root, "tasks.json"));
  const pipeline = new MockGenerationPipeline(repository, projects, storage, renderer, undefined, undefined, analyzer as never, voice as never);
  const tasks = await pipeline.start(project.id, "narration");
  assert.equal(tasks.length, 1); assert.equal(tasks[0]!.kind, "speech");
  await pipeline.drain(10);
  const saved = (await projects.get(project.id))!;
  assert.ok(saved.scenes.every(scene => scene.audioPath && scene.narrationSlice && scene.documentary?.narrationAlignment === "estimated"));
  assert.equal(saved.scenes[0]!.imagePath, "preserve-an-existing-image.png");
  assert.equal(saved.outputPath, undefined);
  assert.equal(await hasPreparedDocumentaryNarration(saved), true);
  const restarted = new MockGenerationPipeline(repository, projects, storage, renderer, undefined, undefined, analyzer as never, voice as never);
  assert.deepEqual(await restarted.start(project.id, "narration"), []);
  await assert.rejects(restarted.start(project.id), /Стоковый режим/);
  assert.equal(requests, 1, "neither restart nor missing materials may order the same voice twice");
  assert.equal(await hasPreparedDocumentaryNarration({ ...saved, settings: { ...saved.settings, voice: { ...saved.settings.voice, voice: "changed" } } }), false);
  const image = join(root, "image.png");
  await effectFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=blue:s=640x360", "-frames:v", "1", image]);
  await projects.update(project.id, { scenes: saved.scenes.map(scene => ({ ...scene, imagePath: image, documentary: { ...scene.documentary!, verified: true }, stockSource: { provider: "local", assetId: "fixture", mediaType: "image", query: "", pageUrl: "", author: "fixture", attribution: "fixture", licenseUrl: "", downloadedAt: "now" } })) });
  assert.deepEqual((await restarted.start(project.id)).map(task => task.kind), ["assemble"]);
  assert.ok((await projects.get(project.id))!.scenes.every(scene => scene.audioPath && scene.narrationSlice));
});

test("new Stock projects narrate scenes independently and expose a settled project after the queue", async () => {
  const { root, projects, project } = await setup();
  const audioPath = join(root, "scene-voice.mp3");
  await effectFfmpeg(["-y", "-f", "lavfi", "-i", "sine=f=330:d=1", "-c:a", "libmp3lame", audioPath]);
  assert.equal(project.settings.assembly.documentary?.narrationMode, "scene");
  project.settings.voice = { ...project.settings.voice, enabled: true, provider: "elevenlabs", voice: "fixture", singleTrack: false };
  await projects.update(project.id, project);
  const storage = new LocalProjectStorage(join(root, "workspace"));
  const renderer = new StandardRenderer(storage); renderer.isAvailable = () => false;
  const requests: string[] = [];
  const voice = { configured: async () => true, tts: async (text: string) => { requests.push(text); return readFile(audioPath); } };
  const pipeline = new MockGenerationPipeline(new FileTaskRepository(join(root, "tasks.json")), projects, storage, renderer, undefined, undefined, undefined, voice as never);
  const tasks = await pipeline.start(project.id, "narration");
  assert.equal(tasks.length, project.scenes.length);
  assert.ok(tasks.every(task => task.kind === "speech" && task.sceneId && !task.narrationSceneIds));
  await pipeline.drain(20);
  assert.ok((await pipeline.list()).every(task => task.status === "done"));
  const saved = (await projects.get(project.id))!;
  assert.equal(saved.status, "ready");
  assert.ok(saved.scenes.every(scene => scene.audioPath && !scene.narrationSlice));
  assert.deepEqual([...requests].sort(), project.scenes.map(scene => scene.narration).sort());
});

test("a 90% Stock request stays visibly incomplete when only an accepted photo is available", async () => {
  const { root, projects, project } = await setup();
  const image = join(root, "only-photo.png");
  await effectFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=blue:s=640x360", "-frames:v", "1", image]);
  project.settings.stockVideoPercent = 90;
  project.scenes = project.scenes.map((scene, index) => ({ ...scene, includeInAssembly: index === 0 }));
  await projects.update(project.id, project);
  const source = { id: "photo", provider: "local" as const, kind: "image" as const, title: "Only verified photo", description: "Fixture", pageUrl: "", downloadUrl: "", localPath: image,
    author: "test", license: "Owned", licenseUrl: "", rights: "user-confirmed" as const, attribution: "test", query: "fixture", retrievedAt: "now", match: "unverified" as const, concerns: [] };
  let sources: DocumentaryCandidate[] = [source];
  const service = new DocumentaryProjectService(projects, new LocalProjectStorage(join(root, "workspace")),
    new DocumentarySearch(undefined, async () => new Response("{}", { status: 200 }), undefined, async () => sources), join(root, "Materials"),
    { download: async () => { throw new Error("not used"); } }, () => {}, {
      available: async () => true,
      plan: async (_project, scenes) => new Map(scenes.map(scene => [scene.id, { ...scene.documentary!.requirement, queries: ["fixture"], preferredKind: "image" as const, plannedBy: "semantic" as const }])),
      inspect: async () => ({ status: "accepted" as const, confidence: .99, reason: "Fixture accepted", checkedAt: "now", sampleSeconds: [], quality: "640x360", trimStartSeconds: 0, trimEndSeconds: 12 }),
    });
  const result = await service.autoSelect(project.id);
  assert.equal(result.selected, 1);
  assert.equal(result.failed, 1);
  assert.match(result.failures[0]!.message, /0% вместо выбранных 90%/);
  const video = join(root, "available-later.mp4");
  await effectFfmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=8:d=12", "-an", "-c:v", "libx264", video]);
  sources = [...sources, { ...source, id: "video", kind: "video", localPath: video }];
  const resumed = await service.autoSelect(project.id);
  assert.equal(resumed.failed, 0, "The ratio pass must upgrade even a semantically preferred photo instead of staying blocked forever");
  assert.equal(resumed.project.scenes[0]!.documentary!.selected!.kind, "video");
  assert.equal(resumed.project.scenes[0]!.narration, project.scenes[0]!.narration);
});

test("continuous voice download retry uses all narration scenes and keeps its known order", async () => {
  const { root, projects, project } = await setup();
  project.settings.voice = { ...project.settings.voice, enabled: true, singleTrack: true };
  project.settings.assembly.documentary = { ...project.settings.assembly.documentary!, narrationMode: "continuous" };
  await projects.update(project.id, project);
  const repository = new FileTaskRepository(join(root, "tasks.json"));
  const storage = new LocalProjectStorage(join(root, "workspace"));
  const pipeline = new MockGenerationPipeline(repository, projects, storage, new StandardRenderer(storage));
  const [speech] = await pipeline.start(project.id, "narration");
  assert.ok(speech?.narrationSceneIds && speech.narrationSceneIds.length > 1);
  const order = { orderId: "existing-paid-order", inputFingerprint: "saved-fingerprint" };
  await repository.replace([{ ...speech, status: "failed", error: "Download returned HTTP 403", lumeanOrder: order }]);
  const restarted = new MockGenerationPipeline(repository, projects, storage, new StandardRenderer(storage));
  const retried = await restarted.retry(speech.id);
  assert.equal(retried.status, "pending"); assert.deepEqual(retried.lumeanOrder, order);
  await repository.replace([{ ...retried, status: "failed" }]);
  await projects.update(project.id, { status: "failed" });
  await projects.update(project.id, { scenes: [...project.scenes].reverse().map((scene, index) => ({ ...scene, order: index })) });
  const changed = new MockGenerationPipeline(repository, projects, storage, new StandardRenderer(storage));
  await assert.rejects(changed.retry(speech.id), /порядок/);
});

test("Stock production queues one full Lumean order, measures its real audio and keeps every scene connected", async () => {
  const { root, projects, project } = await setup();
  const audioPath = join(root, "continuous.mp3"), image = join(root, "image.png");
  await effectFfmpeg(["-y", "-f", "lavfi", "-i", "sine=f=330:d=6", "-c:a", "libmp3lame", audioPath]);
  await effectFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=blue:s=640x360", "-frames:v", "1", image]);
  project.settings.voice = { ...project.settings.voice, enabled: true, provider: "elevenlabs", voice: "fixture", singleTrack: true };
  project.settings.assembly.documentary = { ...project.settings.assembly.documentary!, narrationMode: "continuous" };
  project.scenes = project.scenes.map(scene => ({ ...scene, imagePath: image, documentary: { ...scene.documentary!, verified: true }, stockSource: { provider: "local", assetId: "test", mediaType: "image", query: "", pageUrl: "", author: "test", attribution: "test", licenseUrl: "", downloadedAt: "now" } }));
  await projects.update(project.id, project);
  const storage = new LocalProjectStorage(join(root, "workspace"));
  const renderer = new StandardRenderer(storage);
  renderer.isAvailable = () => false;
  renderer.render = async rendered => { assert.ok(rendered.scenes.every(scene => scene.audioPath && scene.narrationSlice && scene.documentary?.timing?.audioPath && scene.documentary.narrationAlignment === "audio-analysis")); return image; };
  let requests = 0;
  const tasksRepository = new FileTaskRepository(join(root, "tasks.json"));
  const voice = {
    configured: async () => true,
    tts: async (text: string, _voice: string, _signal: AbortSignal, lifecycle: { onBeforeOrderCreate: () => Promise<void>; onOrderKnown: (id: string) => Promise<void> }) => {
      requests++; assert.equal(text, project.videoBrief!.readyScript); await lifecycle.onBeforeOrderCreate(); await lifecycle.onOrderKnown("single-order"); return readFile(audioPath);
    },
  };
  let alignments = 0;
  const analyzer = { configured: async () => true, documentaryCompletion: async (_system: string, input: string, media: string[]) => {
    alignments++; assert.ok(media[0]!.startsWith("data:audio/mpeg;base64,"));
    const data = JSON.parse(input) as { scenes: Array<{ index: number; text: string }> };
    return JSON.stringify({ complete: true, confidence: .99, starts: data.scenes.map(scene => ({ index: scene.index, seconds: scene.index === 0 ? 0 : scene.index * 6 / data.scenes.length + .2, heard: scene.text.trim() })) });
  } };
  const pipeline = new MockGenerationPipeline(tasksRepository, projects, storage, renderer, undefined, undefined, analyzer as never, voice as never);
  const tasks = await pipeline.start(project.id);
  assert.equal(tasks.filter(task => task.kind === "speech").length, 1);
  await pipeline.drain(10);
  assert.equal(requests, 1);
  assert.equal(alignments, 1);
  assert.ok((await pipeline.list()).every(task => task.status === "done"));
  const saved = (await projects.get(project.id))!;
  assert.equal(new Set(saved.scenes.map(scene => scene.audioPath)).size, 1);
  assert.equal(saved.scenes.map(scene => scene.narration).join(""), project.videoBrief!.readyScript);
  await tasksRepository.replace((await pipeline.list()).map(task => task.kind === "assemble" ? { ...task, status: "paused", pausedFrom: "pending" } : task));
  const resumed = new MockGenerationPipeline(new FileTaskRepository(join(root, "tasks.json")), projects, storage, renderer, undefined, undefined, analyzer as never, voice as never);
  await resumed.initialize();
  assert.equal((await resumed.list()).length, 2, "Stock restart must not create AI image jobs for narration slices");
  await resumed.resume(project.id);
  await resumed.drain(10);
  assert.equal(requests, 1, "Existing completed TTS is reused after restart");
  assert.equal(alignments, 1, "Saved audio alignment is reused after restart");
  assert.ok((await resumed.list()).every(task => task.status === "done"));
});

test("automatic accents only copy approved assets, avoid repeating one sound, and preserve manual effects", async () => {
  const { root, project } = await setup();
  const originals = join(root, "originals"); await mkdir(originals);
  const source = join(originals, "Keyboard.wav"); await effectFfmpeg(["-y", "-f", "lavfi", "-i", "sine=f=900:d=1", source]);
  const library = new EffectLibrary(join(root, "Library"));
  await library.startImport([originals]); await library.waitForImport();
  const asset = (await library.snapshot()).assets.find(asset => asset.kind === "audio")!;
  const storage = new LocalProjectStorage(join(root, "workspace"));
  project.scenes = Array.from({ length: 14 }, (_, order) => ({ ...project.scenes[0]!, id: `shot-${order}`, order, durationSeconds: 3, documentary: { ...project.scenes[0]!.documentary!, requirement: { ...project.scenes[0]!.documentary!.requirement, accent: "keyboard" as const } } }));
  assert.ok((await planDocumentaryEffects(project, library, storage)).every(scene => !scene.documentary!.effects.length));
  await library.update(asset.id, { ...asset, automatic: true, review: "approved", rights: "user-confirmed" });
  const scenes = await planDocumentaryEffects(project, library, storage);
  assert.deepEqual(scenes.filter(scene => scene.documentary!.effects.length).map(scene => scene.order), [0]);
  assert.ok((await readFile(scenes[0]!.documentary!.effects[0]!.filePath)).length > 0);
  project.scenes = scenes;
  assert.deepEqual(await planDocumentaryEffects(project, library, storage), scenes);
  const late = {...project,scenes:[{...scenes[0]!,durationSeconds:.3,documentary:{...scenes[0]!.documentary!,effects:[]}}]};
  assert.equal((await planDocumentaryEffects(late,library,storage))[0]!.documentary!.effects.length,0,"A one-second sound must not be auto-chopped into a 0.3-second ending");
});
