import assert from "node:assert/strict";
import test from "node:test";
import { link, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryProjectRepository, MockDirectorProvider, ProjectService } from "@gold-work/core";
import { createVoiceCalibration, type DocumentaryCandidate, type Scene } from "@gold-work/shared";
import { scanWorkspaceUsage, workspaceUsagePath } from "./workspace-usage.js";
import { directCatalogChoices, representativeCatalogChoices, documentaryDistraction, documentaryCatalogIdentityConflict, documentaryRangeEditorialIssue } from "./documentary-visual-relevance.js";
import { DocumentaryProjectService, documentaryPhotoFirstScenes } from "./documentary-project-service.js";
import { DocumentarySearch } from "./documentary-search.js";
import { LocalProjectStorage } from "./local-project-storage.js";
import { prepareDocumentaryScript } from "./documentary-plan.js";
import { effectFfmpeg } from "./effect-media.js";
import { DocumentaryIntelligence } from "./documentary-intelligence.js";

test("range approval requires explicit real-camera and clean full-frame classification", () => {
  assert.equal(documentaryRangeEditorialIssue({ mediaType: "camera", presentation: "clean" }), undefined);
  assert.match(documentaryRangeEditorialIssue({ status: "accepted", isCameraFootage: true, mediaType: "render", presentation: "clean" })!, /визуализация/);
  assert.match(documentaryRangeEditorialIssue({ mediaType: "camera", presentation: "promo" })!, /Рекламная/);
  assert.ok(documentaryRangeEditorialIssue({ status: "accepted", isCameraFootage: true }));
  assert.match(documentaryRangeEditorialIssue({mediaType:'camera',presentation:'clean',
    narrativeEvidence:{evidence:'Shows the named rider shown on screen at an event.'}})!,/Съёмка экрана/);
  assert.match(documentaryRangeEditorialIssue({mediaType:'camera',presentation:'clean',filmedScreen:true})!,/Съёмка экрана/);
  assert.equal(documentaryRangeEditorialIssue({mediaType:'camera',presentation:'clean',
    physicalEvidence:'Film crew adjusting a camera, with an incidental monitor.'}),undefined);
});

test("photo-first search honors measured ratio and existing manual choices", () => {
  const scenes = Array.from({ length: 10 }, (_, i) => ({ id: String(i), durationSeconds: 99, documentary: { timing: { durationInFrames: 90 }, requirement: { preferredKind: i < 4 ? "image" : "video" } } }));
  const project = { scenes, settings: { stockVideoPercent: 90 } };
  assert.deepEqual([...documentaryPhotoFirstScenes(project as never)], ["0"]);
  assert.equal(documentaryPhotoFirstScenes({ ...project, settings: { stockVideoPercent: 100 } } as never).size, 0);
  assert.equal(documentaryPhotoFirstScenes({ ...project, settings: { stockVideoPercent: 0 } } as never).size, 10);
  Object.assign(scenes[0]!.documentary, { verified: true, pinned: true, selected: { kind: "image" } });
  assert.equal(documentaryPhotoFirstScenes(project as never).size, 0, "Pinned photo already consumes the available still share");
  Object.assign(scenes[4]!.documentary, { autoError: "Photo uncertain after exhausted video search", candidates: [{ kind: "image" }], requirement: { preferredKind: "video", searchRefined: true } });
  assert.deepEqual([...documentaryPhotoFirstScenes(project as never)], ["4"], "Resume the saved photo stage even when the later video-quota pass is still needed");
  Object.assign(scenes[4]!.documentary, { candidates: [{ kind: "video" }, { kind: "image" }] });
  assert.equal(documentaryPhotoFirstScenes(project as never).size, 0, "A mixed shortlist does not prove the video stage finished");
  Object.assign(scenes[4]!.documentary, { candidates: [{ kind: "image" }], pinned: true });
  assert.equal(documentaryPhotoFirstScenes(project as never).size, 0, "Do not replace a manual choice on resume");
});

test('planned static diagrams use the existing photo budget before a long video search', () => {
  const scenes = Array.from({ length: 4 }, (_, order) => ({ id: String(order), order, durationSeconds: 10,
    narration: order === 2 ? 'The shaft is rotating inside the engine. ' : 'The drawing labels the engine block. ',
    documentary: { requirement: { preferredKind: 'video', queries: [order === 3 ? 'car on road' : 'engine block cutaway diagram'] } } }));
  const p = { scenes, settings: { stockVideoPercent: 75 } };
  assert.deepEqual([...documentaryPhotoFirstScenes(p as never)], ['0']);
  assert.deepEqual([...documentaryPhotoFirstScenes({ ...p, settings: { stockVideoPercent: 100 } } as never)], []);
  Object.assign(scenes[0]!.documentary, { pinned: true });
  assert.deepEqual([...documentaryPhotoFirstScenes(p as never)], ['1']);
});

test('secured video share starts static explanations with photos but keeps physical actions on video',()=>{
  const scenes=Array.from({length:10},(_,order)=>({id:String(order),order,durationSeconds:10,narration:order===9?'Ворота открываются, пропуская судно. ':'Масштаб сооружения имеет экономическое значение. ',videoPath:order<5?'verified.mp4':undefined,
    documentary:{verified:order<5,selected:order<5?{kind:'video',durationSeconds:10}:undefined,candidates:[],requirement:{preferredKind:'video'},timing:{durationInFrames:300}}}));
  const project={scenes,settings:{stockVideoPercent:35}};
  assert.deepEqual([...documentaryPhotoFirstScenes(project as never)],['5','6','7','8']);
  assert.equal(documentaryPhotoFirstScenes({...project,settings:{stockVideoPercent:80}} as never).size,2,'Reserve the requested still duration before expensive video searches');
  const pinned={...scenes[5]!,documentary:{...scenes[5]!.documentary,pinned:true}};project.scenes[5]=pinned;
  assert.ok(!documentaryPhotoFirstScenes(project as never).has('5'));
});

test("a fresh project ranks shared source catalogs before it has any selected scenes", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-shared-rank-")); t.after(() => rm(root, { recursive: true, force: true }));
  const candidates = ["a", "b"].map(key => ({ id: `local:${key.repeat(64)}`, localPath: join(root, `${key.repeat(64)}.mp4`), kind: "video", title: "Tractor" })) as DocumentaryCandidate[];
  for (let i = 0; i < candidates.length; i++) {
    const hash = candidates[i]!.id.slice(6), directory = join(root, "catalog", hash); await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "catalog-v1.json"), JSON.stringify({ version: 1, checksum: hash, duration: 20, windows: [], segments: [{ id: 0, start: 0, end: 10, sample: 5, camera: true, usable: true, entities: ["Tractor"], description: i ? "Close up tractor wheels turning in soil" : "People talking in front of a tractor" }] }));
  }
  const intelligence = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async () => { throw new Error("No paid request in catalog ranking"); } }, id => join(root, id), async () => {}, join(root, "catalog"));
  const scene = { id: "fresh", durationSeconds: 3, narration: "The tractor wheels grip the soil.", documentary: { requirement: { entities: ["Tractor"], years: [], queries: ["Tractor wheels"], detail: "wheels turning" } } } as unknown as Scene;
  const ranked = await intelligence.rankLocalCandidates({ id: "new", scenes: [scene] } as never, scene, candidates);
  assert.equal(ranked[0]!.id, candidates[1]!.id);
  assert.deepEqual(intelligence.cataloguedCandidates({id:'new',scenes:[scene]} as never,scene,ranked),[candidates[1]],'Only catalogued matching detail belongs in the early local shortcut');
  const shortlist = await intelligence.rankCandidates({ id: "new", scenes: [scene] } as never, scene, ranked);
  assert.equal(shortlist[0]!.id, candidates[1]!.id, 'Known matching frames must not buy another metadata-ranking request');
  assert.equal(scene.documentary?.verified, undefined, 'Catalog shortlist must never approve footage');
  // A different script cannot inherit the previous scene's shortlist hint.
  let ordinaryRanking = false;
  Object.assign(intelligence, { complete: async () => { ordinaryRanking = true; return { ids: [] }; } });
  const changed = {...scene,narration:'The reactor control panel.',documentary:{...scene.documentary!,requirement:{...scene.documentary!.requirement,entities:['Reactor'],identities:[],queries:['reactor panel']}}};
  assert.deepEqual(intelligence.cataloguedCandidates({id:'new',scenes:[changed]} as never,changed,ranked),[]);
  ranked.forEach(c=>Object.assign(c,{description:'Tractor footage',provider:'local',author:'Archive',pageUrl:'https://example.test/source',downloadUrl:'https://example.test/source.mp4',concerns:[]}));
  await intelligence.rankCandidates({id:'new',scenes:[changed]} as never,changed,ranked);
  assert.equal(ordinaryRanking,true);
});

test("known catalog without the requested detail is skipped, while unknown sources and representative statistics remain eligible", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-catalog-shortlist-")); t.after(() => rm(root, { recursive: true, force: true }));
  const checksum = "a".repeat(64), directory = join(root, "catalog", checksum); await mkdir(directory, { recursive: true });
  const segments = Array.from({ length: 24 }, (_, id) => ({ id, start: id * 8, end: id * 8 + 8, sample: id * 8 + 4, camera: true, usable: true, entities: ["Tractor Alpha"], description: "Wide exterior side view of Tractor Alpha in a field" }));
  await writeFile(join(directory, "catalog-v1.json"), JSON.stringify({ version: 1, checksum, duration: 192, windows: segments, segments }));
  const known = { id: `local:${checksum}`, title: "Tractor Alpha", kind: "video" } as DocumentaryCandidate;
  const unknown = { ...known, id: `local:${"b".repeat(64)}` };
  const intelligence = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async () => { throw new Error("Shortlisting must not pay for range choice"); } }, id => join(root, id), async () => {}, join(root, "catalog"));
  const scene = { id: "detail", durationSeconds: 3, narration: "The transmission gears change the torque.", documentary: { requirement: { entities: ["Tractor Alpha"], queries: ["Tractor Alpha transmission gears"], detail: "gearbox mechanism" } } } as Scene;
  const project = { id: "new", scenes: [scene] } as never;
  assert.deepEqual((await intelligence.rankLocalCandidates(project, scene, [known, unknown])).map(item => item.id), [unknown.id]);
  const shortChecksum = "c".repeat(64), partialChecksum = "d".repeat(64);
  for (const [checksum, windows] of [[shortChecksum, segments.slice(0, 17)], [partialChecksum, segments.slice(0, 18)]] as const) {
    const shortDirectory = join(root, "catalog", checksum);
    await mkdir(shortDirectory, { recursive: true });
    await writeFile(join(shortDirectory, "catalog-v1.json"), JSON.stringify({
      version: 1, checksum, duration: 144, windows, segments: segments.slice(0, 17),
    }));
  }
  const completeShort = { ...known, id: `local:${shortChecksum}` };
  const partialShort = { ...known, id: `local:${partialChecksum}` };
  assert.deepEqual((await intelligence.rankLocalCandidates(project, scene, [completeShort, partialShort, unknown])).map(item => item.id),
    [partialShort.id, unknown.id], "A complete 17-window unrelated catalog should not enter the local shortcut; a partial one remains eligible");
  const statistics = { ...scene, narration: "The tractor weighs six tons.", documentary: { ...scene.documentary!, requirement: { ...scene.documentary!.requirement, detail: "weight and dimensions" } } };
  assert.equal((await intelligence.rankLocalCandidates(project, statistics, [known]))[0]?.id, known.id);
});

test('an indexed montage about a different person is not an early paid shortcut for a named engineer',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-person-catalog-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const checksum='e'.repeat(64),directory=join(root,'catalog',checksum);await mkdir(directory,{recursive:true});
  const segments=Array.from({length:24},(_,id)=>({id,start:id*8,end:id*8+8,sample:id*8+4,camera:true,usable:true,
    entities:id%3===0?['Valentino Rossi']:[],description:'Yamaha motorcycle riders on track'}));
  const catalog={version:1,checksum,duration:192,windows:segments,segments};
  const path=join(directory,'catalog-v1.json');await writeFile(path,JSON.stringify(catalog));
  const known={id:`local:${checksum}`,kind:'video',title:'Valentino Rossi best moments',description:'Rossi race montage'} as DocumentaryCandidate;
  const unknown={...known,id:`local:${'f'.repeat(64)}`,title:'Masao Furusawa interview'};
  const scene={id:'furusawa',durationSeconds:3,narration:'Everyone turned and looked at Furawa, the man who had thought of it.',documentary:{requirement:{
    entities:['Masao Furusawa'],identities:[{name:'Masao Furusawa',aliases:['Furusawa']}],years:[],
    queries:['Masao Furusawa Yamaha engineer'],detail:"Masao Furusawa, head of Yamaha's racing and technology development"}}} as unknown as Scene;
  const project={id:'same',scenes:[scene]} as never;
  const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{throw Error('No paid ranking');}},
    id=>join(root,id),async()=>{},join(root,'catalog'));
  assert.deepEqual((await intelligence.rankLocalCandidates(project,scene,[known,unknown])).map(item=>item.id),[unknown.id]);
  catalog.segments=segments.slice(0,20);
  await writeFile(path,JSON.stringify(catalog));
  assert.equal((await intelligence.rankLocalCandidates(project,scene,[{...known,title:'MotoGP paddock coverage'}])).length,1,
    'An untitled catalog may contain the person in unindexed frames');
  segments[12]={...segments[12]!,entities:['Masao Furusawa'],description:'Masao Furusawa engineer speaking in Yamaha garage'};
  catalog.segments=segments.slice(0,20);
  await writeFile(path,JSON.stringify(catalog));
  assert.equal((await intelligence.rankLocalCandidates(project,scene,[known])).length,1,'Actual indexed person evidence remains eligible');
});

test('generic track footage stays available but does not receive an early paid shortcut for a named machine',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-model-catalog-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const checksum='9'.repeat(64),directory=join(root,'catalog',checksum);await mkdir(directory,{recursive:true});
  const segments=Array.from({length:24},(_,id)=>({id,start:id*8,end:id*8+8,sample:id*8+4,camera:true,usable:true,
    entities:[],description:id===8?'Onboard camera speed display during MotoGP race straight':'Motorcycle riders cornering on track'}));
  await writeFile(join(directory,'catalog-v1.json'),JSON.stringify({version:1,checksum,duration:520,windows:Array.from({length:65}),segments}));
  const source={id:`local:${checksum}`,kind:'video',title:'Valentino Rossi best moments',description:'Motorcycle racing highlights'} as DocumentaryCandidate;
  const scene={id:'honda-speed',durationSeconds:4,narration:'On the straights the Honda had the edge in top speed.',documentary:{requirement:{
    entities:['Honda RC211V'],identities:[{name:'Honda RC211V',aliases:[]}],years:[],
    queries:['Honda RC211V top speed straight MotoGP footage'],detail:'top speed on the straight'}}} as unknown as Scene;
  const project={id:'same',scenes:[scene]} as never;
  const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{throw Error('No paid range check');}},
    id=>join(root,id),async()=>{},join(root,'catalog'));
  const ranked=await intelligence.rankLocalCandidates(project,scene,[source]);
  assert.deepEqual(ranked,[source],'The source can still compete in normal discovery');
  assert.deepEqual(intelligence.cataloguedCandidates(project,scene,ranked),[],'A speed keyword cannot establish RC211V identity');
  const named={...source,title:'Honda RC211V race footage'};
  assert.deepEqual(intelligence.cataloguedCandidates(project,scene,await intelligence.rankLocalCandidates(project,scene,[named])),[named],
    'An explicitly named source keeps the fast catalog path');
  const split={...source,title:'Honda RC211 V race footage'};
  assert.deepEqual(intelligence.cataloguedCandidates(project,scene,await intelligence.rankLocalCandidates(project,scene,[split])),[split]);
});

test('a distributed non-camera catalog avoids paid reuse ranking but does not reject mixed or unknown sources',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-non-camera-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const checksum='c'.repeat(64),directory=join(root,'catalog',checksum);await mkdir(directory,{recursive:true});
  const segments=Array.from({length:8},(_,id)=>({id,start:id*10,end:id*10+8,sample:id*10+4,camera:false,usable:true,entities:['Tractor'],description:'Racing game interface'}));
  const catalog={version:1,checksum,duration:160,windows:Array.from({length:16}),segments};
  const path=join(directory,'catalog-v1.json');await writeFile(path,JSON.stringify(catalog));
  const known={id:`local:${checksum}`,title:'Tractor',kind:'video'} as DocumentaryCandidate;
  const unknown={...known,id:'remote:new'};
  const scene={id:'s',durationSeconds:3,narration:'The tractor weighs six tons.',documentary:{requirement:{entities:['Tractor'],queries:['tractor'],detail:'weight'}}} as Scene;
  const project={id:'p',scenes:[scene]} as never;
  const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{throw Error('No paid analysis for a known game');}},id=>join(root,id),async()=>{},join(root,'catalog'));
  assert.deepEqual(await intelligence.rankLocalCandidates(project,scene,[known,unknown]),[unknown]);
  Object.assign(segments[0]!,{camera:true,description:'Wide exterior view of Tractor in field'});
  await writeFile(path,JSON.stringify(catalog));
  assert.ok((await intelligence.rankLocalCandidates(project,scene,[known])).length===1);
});

test("indexed long sources do not extract discarded overview frames", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-no-overview-")); t.after(() => rm(root, { recursive: true, force: true }));
  const intelligence = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async () => { throw new Error("No overview request"); } }, () => root);
  let catalogCalls = 0;
  Object.assign(intelligence, { inspectCatalogRange: async () => { catalogCalls++; return { status: "accepted" }; } });
  // A missing source guarantees an unwanted FFmpeg overview would fail.
  const scene = { id: "one", order: 0, durationSeconds: 3, narration: "A tractor works.", videoPath: join(root, "not-needed.mp4"), documentary: { checksum: "a".repeat(64), requirement: { text: "A tractor works.", entities: ["Tractor"], years: [], queries: [] }, selected: { id: "local:a", kind: "video", durationSeconds: 600, width: 1920, height: 1080 }, candidates: [] } } as unknown as Scene;
  // The stub lacks narrative approval; selection must hold it for review while
  // still taking the indexed path instead of extracting overview frames.
  assert.equal((await intelligence.inspect({ id: "project", scenes: [scene] } as never, scene)).status, "uncertain");
  assert.equal(catalogCalls, 1);
});

test("parallel selections download a shared provider source once and stale local catalog entries disappear", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-download-singleflight-")); t.after(() => rm(root, { recursive: true, force: true }));
  const projects = new ProjectService(new MemoryProjectRepository(), new MockDirectorProvider());
  let project = await projects.create({ title: "Download", topic: "Test", mediaMode: "stock", mode: "standard", language: "English", aspectRatio: "16:9" });
  project.videoBrief = { ...project.videoBrief!, creationMode: "script", readyScript: "The red tractor works in a field. Its blue wheels grip the soil." };
  const calibration = createVoiceCalibration({ provider: "elevenlabs", voice: "fixture", language: "en", sampleText: "This is a measured voice for a local test.", audioDurationSeconds: 4 });
  project.scenes = prepareDocumentaryScript(project, calibration).slice(0, 2); assert.equal(project.scenes.length, 2);
  const candidate: DocumentaryCandidate = { id: "pexels:one", provider: "pexels", kind: "image", title: "Red tractor", description: "Red tractor", downloadUrl: "https://example.invalid/tractor.png", pageUrl: "", author: "fixture", license: "fixture", licenseUrl: "", rights: "user-confirmed", attribution: "fixture", query: "Red tractor", retrievedAt: "now", match: "exact-metadata", concerns: [] };
  project.scenes = project.scenes.map(scene => ({ ...scene, documentary: { ...scene.documentary!, candidates: [candidate] } }));
  project = await projects.update(project.id, project);
  const image = join(root, "source.png");
  await effectFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=red:s=640x360", "-frames:v", "1", image]);
  const data = await readFile(image); let downloads = 0;
  const service = new DocumentaryProjectService(projects, new LocalProjectStorage(join(root, "projects")), new DocumentarySearch(), join(root, "Materials"), {
    download: async () => { downloads++; await new Promise(resolve => setTimeout(resolve, 80)); return { data, extension: ".png", contentType: "image/png" }; }
  });
  await Promise.all(project.scenes.map(scene => service.applyCandidate(project.id, scene.id, candidate.id)));
  assert.equal(downloads, 1);
  assert.equal((await projects.get(project.id))!.scenes.filter(scene => scene.documentary?.selected).length, 2);
  const catalog = await service.localCandidates("Red tractor"); assert.equal(catalog.length, 1);
  await rm(catalog[0]!.localPath!);
  assert.equal((await service.localCandidates("Red tractor")).length, 0, "Cleanup must not leave selectable missing files");
});

test("storage counts hardlinks once and exposes project/folder/file sizes without reading media", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-usage-")); t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, "projects", "one"); await mkdir(project, { recursive: true });
  await writeFile(join(project, "source.mp4"), Buffer.alloc(100)); await link(join(project, "source.mp4"), join(project, "scene.mp4"));
  await mkdir(join(root, "Materials")); await link(join(project, "source.mp4"), join(root, "Materials", "cached.mp4"));
  const all = await scanWorkspaceUsage(root);
  assert.equal(all.bytes, 100); assert.equal(all.logicalBytes, 300); assert.equal(all.projects[0]!.bytes, 100);
  const details = await scanWorkspaceUsage(root, "projects/one");
  assert.equal(details.entries.length, 2); assert.equal(details.bytes, 100); assert.equal(details.logicalBytes, 200);
  assert.throws(() => workspaceUsagePath(root, "../outside"));
});

test("catalog shortlist prefers visible detail and rejects incidental background subject", () => {
  const scene = { narration: "The vessel is 1,196 feet long.", documentary: { requirement: { entities: ["Example Vessel"], queries: ["Example Vessel full profile"], detail: "Full profile length" } } } as Scene;
  assert.ok(documentaryDistraction(scene, "Group toasting drinks with a ship hull behind them"));
  assert.ok(documentaryDistraction(scene, "Person lying on back in a transparent waterslide"));
  const people = { ...scene, narration: "Passengers toast drinks at a bar." };
  assert.equal(documentaryDistraction(people, "Group toasting drinks at a bar"), undefined);
  const ranges = [{ id: 0, start: 20, end: 28, sample: 24, camera: true, usable: true, entities: [], description: "Full profile view from port" }];
  assert.deepEqual(directCatalogChoices(scene, ranges), [{ id: 0, startSeconds: 20 }]);
  assert.deepEqual(representativeCatalogChoices(scene,[{...ranges[0]!,entities:["Example Vessel"],description:"Wide exterior full-length view"},
    {...ranges[0]!,description:"Wide view of distant ship behind foreground signage"},
    {...ranges[0]!,entities:["Example Vessel"],description:"Close-up of branded merchandise with Example Vessel text"}]),[{id:0,startSeconds:20}]);
  assert.deepEqual(representativeCatalogChoices({...scene,narration:"The engine drives the propeller.",documentary:{...scene.documentary!,requirement:{...scene.documentary!.requirement,detail:"engine mechanism"}}},ranges),[]);
  const comparison = { ...scene, narration: "Compare Example Vessel beside Another Vessel.", documentary: { ...scene.documentary!, selected: { title: "Example Vessel" } as DocumentaryCandidate,
    requirement: { ...scene.documentary!.requirement, text: "Compare Example Vessel beside Another Vessel.", entities: ["Example Vessel", "Another Vessel"], detail: "Comparison" } } };
  assert.deepEqual(representativeCatalogChoices(comparison, [{ ...ranges[0]!, description: "Wide ship view", entities: [] }]), [{ id: 0, startSeconds: 20 }]);
  assert.deepEqual(representativeCatalogChoices(comparison, [{ ...ranges[0]!, description: "Wide ship view", entities: ["Wrong Vessel"] }]), []);
  const engine={...scene,documentary:{...scene.documentary!,requirement:{...scene.documentary!.requirement,detail:"modern cruise ship propulsion system",queries:["Example Vessel exterior"]}}};
  assert.deepEqual(directCatalogChoices(engine,Array.from({length:20},(_,id)=>({...ranges[0]!,id,description:"Modern cruise ship exterior aerial view"}))),[],"Category words must not pretend that an exterior depicts the propulsion detail");
  const stopping = { ...scene, narration: "The rider tried to stop the bike at the corner.", documentary: { ...scene.documentary!, requirement: {
    ...scene.documentary!.requirement, detail: "the bike driving forward while the rider tried to stop", queries: ["motorcycle rider crash braking into corner"],
  } } };
  const cornering = { ...ranges[0]!, description: "Motorcycles leaning hard into a corner side by side, another rider trailing behind" };
  assert.deepEqual(directCatalogChoices(stopping, [cornering]), [], "A corner and rider alone do not show the requested stopping action");
  assert.equal(directCatalogChoices(stopping, [{ ...cornering, description: "Motorcycle rider braking hard into the corner" }]).length, 1,
    "Visible braking remains eligible for the actual-frame check");
  const unnamed={...ranges[0]!,id:42,sample:264,entities:[]};
  const other={...ranges[0]!,id:43,sample:271,entities:["Different Vessel"]};
  assert.equal(documentaryCatalogIdentityConflict(scene,unnamed,[unnamed,other]),true,"A named different ship in the adjacent indexed shot must defeat a misleading source title");
  assert.equal(documentaryCatalogIdentityConflict(scene,{...unnamed,entities:["Example Vessel"]},[unnamed,other]),false);
  const news = Array.from({ length: 8 }, (_, id) => ({ ...unnamed, id, sample: id * 8 + 4, entities: ["CB24"], description: "Aerial view of container ship in canal lock, assisted by tugboats" }));
  assert.equal(documentaryCatalogIdentityConflict(scene, news[0]!, news), false, "A repeated broadcaster watermark must not discard every actual ship shot before vision");
  assert.equal(representativeCatalogChoices(comparison, news).length, 3, "Allow a bounded actual-frame check from the named source, without approving the footage");
  const larger = { ...scene, narration: "позволили принимать более крупные суда", documentary: { ...scene.documentary!, selected: { title: "Example Vessel" } as DocumentaryCandidate, requirement: { ...scene.documentary!.requirement, detail: "larger ships now able to transit" } } };
  assert.equal(representativeCatalogChoices(larger, news).length, 3, "Comparative size is a representative view, not an unavailable mechanical action");
  const explicitlyDifferent = news.map(item => ({ ...item, entities: ["Different Vessel"], description: "Wide view of Different Vessel transiting canal" }));
  assert.equal(documentaryCatalogIdentityConflict(scene, explicitlyDifferent[0]!, explicitlyDifferent), true, "Repeated explicit subject names still contradict the requested vessel");
  const omittedEntity={...unnamed,description:"Close view of Different Vessel beside the dock",entities:[]};
  const corroborated={...other,id:50,sample:500,entities:["Different Vessel"],description:"Different Vessel leaves the port"};
  assert.equal(documentaryCatalogIdentityConflict(scene,omittedEntity,[omittedEntity,corroborated]),true,
    "A visible competing name in prose is a conflict when another frame independently names it");
  assert.equal(documentaryCatalogIdentityConflict(scene,{...omittedEntity,description:"Example Vessel beside Different Vessel"},[omittedEntity,corroborated]),false,
    "A frame mentioning the requested vessel as well still gets its actual-frame review");
  const m1={...scene,documentary:{...scene.documentary!,requirement:{...scene.documentary!.requirement,
    entities:["Yamaha YZR-M1"],identities:[{name:"Yamaha YZR-M1",aliases:[]}]}}};
  const honda={...unnamed,description:"Close-up of Repsol Honda RC211V motorcycle",entities:[]};
  assert.equal(documentaryCatalogIdentityConflict(m1,honda,[honda,{...other,entities:["Honda"],description:"Honda RC211V racing motorcycle"}]),true,
    "A Honda catalog shot cannot spend Yamaha's range-analysis budget when its prose clearly identifies Honda");
});

test("two different scene sources inspect concurrently and save both selections", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-parallel-stock-")); t.after(() => rm(root, { recursive: true, force: true }));
  const projects = new ProjectService(new MemoryProjectRepository(), new MockDirectorProvider());
  let project = await projects.create({ title: "Parallel", topic: "Test", mediaMode: "stock", mode: "standard", language: "English", aspectRatio: "16:9" });
  project.videoBrief = { ...project.videoBrief!, creationMode: "script", readyScript: "The red tractor works in a field. Its blue wheels grip the soil." };
  const calibration = createVoiceCalibration({ provider: "elevenlabs", voice: "fixture", language: "en", sampleText: "This is a measured voice for a local test.", audioDurationSeconds: 4 });
  project.scenes = prepareDocumentaryScript(project, calibration).slice(0, 2); assert.equal(project.scenes.length, 2);
  project.settings.stockVideoPercent = 0; project = await projects.update(project.id, project);
  const candidates: DocumentaryCandidate[] = [];
  for (let i = 0; i < 2; i++) {
    const file = join(root, `${i}.png`);
    await effectFfmpeg(["-y", "-f", "lavfi", "-i", 'testsrc2=s=1920x1080',...(i?['-vf','hflip']:[]), "-frames:v", "1", file]);
    candidates.push({ id: `source-${i}`, provider: "local", kind: "image", title: `Object${i}`, description: `Object${i}`, localPath: file, downloadUrl: "", pageUrl: "", author: "test", license: "Own fixture", licenseUrl: "", rights: "user-confirmed", attribution: "fixture", query: "", retrievedAt: "now", match: "exact-metadata", concerns: [] });
  }
  let active = 0, peak = 0;
  let release!: () => void; const both = new Promise<void>(resolve => { release = resolve; });
  const service = new DocumentaryProjectService(projects, new LocalProjectStorage(join(root, "projects")),
    new DocumentarySearch(undefined, async () => new Response('{}'), undefined, async query => candidates.filter(candidate => query.includes(candidate.title))),
    join(root, "Materials"), { download: async () => { throw new Error("Local-only fixture"); } }, () => {}, {
      available: async () => true,
      plan: async (_project, scenes) => new Map(scenes.map(scene => [scene.id, { ...scene.documentary!.requirement, entities: [`Object${scene.order}`], queries: [`Object${scene.order}`], preferredKind: "image", plannedBy: "semantic" }])),
      inspect: async () => {
        active++; peak = Math.max(peak, active); if (active === 2) release();
        let timeout: ReturnType<typeof setTimeout>;
        await Promise.race([both, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Second independent source did not run")), 5000); })]).finally(() => clearTimeout(timeout));
        active--; return { status: "accepted", confidence: .99, reason: "fixture", checkedAt: "now", sampleSeconds: [], quality: "640x360" };
      }
    });
  const result = await service.autoSelect(project.id);
  assert.equal(peak, 2, JSON.stringify(result.project.scenes.map(s=>s.documentary?.autoError))); assert.equal(result.selected, 2); assert.equal(result.project.scenes.filter(scene => scene.documentary?.verified).length, 2);
  assert.equal(result.project.scenes.map(scene => scene.narration).join(""), project.scenes.map(scene => scene.narration).join(""));
});
