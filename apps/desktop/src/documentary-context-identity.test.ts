import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { DocumentaryCandidate, DocumentaryRequirement, Project, Scene } from "@gold-work/shared";
import { DocumentaryIntelligence } from "./documentary-intelligence.js";
import { AnyModelCompletionUncertainError } from "./anymodel-client.js";
import { applyDocumentaryRequirement } from "./documentary-visual-relevance.js";
import { documentarySearchQueries, documentaryStockQueries } from "./documentary-project-service.js";
import { effectFfmpeg } from "./effect-media.js";
import { groundDocumentaryScenes } from "./documentary-comparison.js";

test('full-script semantic plans keep a new subject instead of inheriting an old component',()=>{
  for(const [previous,lead,tail,queries] of [
    ['тяговая батарея','На заводе кузовные панели соединяют, ','поверхности защищают от коррозии и окрашивают. ',['automotive paint shop car body coating']],
    ['Panama Canal','In the observatory, instruments measure ','the light emitted by distant stars. ',['observatory telescope stellar spectrum']],
  ] as const){
    const scene=(id:string,narration:string,entities:string[],search:string[])=>({id,order:Number(id),narration,documentary:{pinned:false,verified:false,
      requirement:{text:narration,entities,identities:entities.map(name=>({name,aliases:[]})),identityContextVersion:3,years:[],queries:search,plannedBy:'semantic'}}} as unknown as Scene);
    const input=[scene('0',`${previous}. `,[previous],[previous]),scene('1',lead,[],[...queries]),scene('2',tail,[],[...queries])];
    const output=groundDocumentaryScenes(input);
    assert.deepEqual(output.map(s=>s.documentary!.requirement),input.map(s=>s.documentary!.requirement));
    assert.deepEqual(groundDocumentaryScenes(output),output);
  }
});

test('semantic named referents are preserved even when their generic entities list is empty',()=>{
  const scene={id:'1',order:1,narration:'Its gates open. ',documentary:{verified:true,pinned:false,requirement:{text:'Its gates open. ',entities:[],
    identities:[{name:'Panama Canal',aliases:[]}],identityContextVersion:3,queries:['Panama Canal gates opening'],years:[],plannedBy:'semantic'}}} as unknown as Scene;
  const earlier={...structuredClone(scene),id:'0',order:0,narration:'The Suez Canal. ',documentary:{...scene.documentary!,
    requirement:{...scene.documentary!.requirement,entities:['Suez Canal'],identities:[{name:'Suez Canal',aliases:[]}]}}};
  assert.deepEqual(groundDocumentaryScenes([earlier,scene])[1],scene);
});

test("physical-subject discovery does not require an animation that the camera-footage reviewer rejects", () => {
  const requirement: DocumentaryRequirement = { text: "Power and exhaust strokes.", entities: ["четырёхтактный двигатель"], years: [],
    queries: ["four stroke engine cutaway animation", "engine power stroke exhaust valve", "internal combustion engine cycle animation"] };
  const before = structuredClone(requirement);
  for (const kind of ["video", "image"] as const) {
    assert.deepEqual(documentarySearchQueries(requirement, kind), ["four stroke engine cutaway", "engine power stroke exhaust valve", "internal combustion engine cycle", "четырёхтактный двигатель"]);
  }
  assert.deepEqual(documentaryStockQueries(requirement), ["four stroke engine cutaway", "engine power stroke exhaust valve"]);
  assert.deepEqual(requirement, before, "A saved plan and its paid analysis inputs remain intact");
  const otherTopic = { ...requirement, entities: ["tectonic plates"], queries: ["tectonic plates subduction 3D animation"] };
  assert.equal(documentarySearchQueries(otherTopic, "video")[0], "tectonic plates subduction");
});

test("animation remains searchable when it is the documentary subject or a mandatory name", () => {
  const requirement: DocumentaryRequirement = { text: "Inside the animation studio.", entities: ["студия анимации"], years: [], queries: ["stop motion animation studio footage"] };
  assert.equal(documentarySearchQueries(requirement, "video")[0], "stop motion animation studio footage");
  assert.equal(documentarySearchQueries(requirement, "image")[0], "stop motion animation studio");
  const named = { ...requirement, entities: ["студия"], identities: [{ name: "Walt Disney Animation Studios", aliases: [] }], queries: ["Walt Disney Animation Studios entrance"] };
  assert.equal(documentarySearchQueries(named, "video")[0], "Walt Disney Animation Studios entrance");
});

test("stock searches retain an inherited named location instead of asking for unrelated generic locks", () => {
  const requirement: DocumentaryRequirement = { text: "The gates close.", entities: ["lock", "water"], years: [], queries: ["lock gates closing", "Panama Canal transit"], identities: [{ name: "Панамский канал", aliases: ["Panama Canal"] }] };
  assert.deepEqual(documentarySearchQueries(requirement), ["Panama Canal lock gates closing", "Panama Canal transit", "Panama Canal"]);
  assert.deepEqual(documentaryStockQueries(requirement), ["Panama Canal lock gates closing", "Panama Canal transit"]);
});

const scene = { id: "detail", order: 1, narration: "Its gates close.", audioPath: "saved.wav", videoPath: "german-lock.mp4",
  documentary: { verified: true, requirement: { text: "Its gates close.", entities: ["lock gates"], identities: [], years: [], queries: ["lock gates closing"], plannedBy: "semantic" } } } as unknown as Scene;

test("a measured range retains a verified action at the overview tail without bypassing an uncertain first check", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-action-tail-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const videoPath = join(root, "fixture.mp4");
  await effectFfmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=10:d=4", "-an", "-c:v", "libx264", videoPath]);
  const scoped = { ...scene, videoPath, audioPath: undefined, durationSeconds: 2,
    documentary: { ...scene.documentary!, verified: false, checksum: "fixture-tail",
      selected: { kind: "video", title: "Fixture", width: 640, height: 360, durationSeconds: 4 } as DocumentaryCandidate } };
  const project = { id: "tail", scenes: [scoped] } as unknown as Project;
  let calls = 0;
  const intelligence = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async (_system, input) => {
    calls++;
    const data = JSON.parse(input), overview = data.duration === 4;
    const action = overview || data.endSeconds === 4;
    return JSON.stringify({ status: action ? "accepted" : "rejected", confidence: .99, isCameraFootage: true,
      mediaType: "camera", presentation: "clean", actionMatch: action, actionEvidence: "Mock sequence contract only",
      reason: "Mock sequence contract only", startSeconds: 0, endSeconds: 4 });
  } }, () => root);
  const review = await intelligence.inspect(project, scoped);
  assert.equal(review.status, "accepted");
  assert.equal(review.trimEndSeconds, 4);
  assert.equal(review.trimEndSeconds! - review.trimStartSeconds!, 2);
  assert.equal(calls, 3, "Overview, original check, then one distinct tail interval");
  assert.deepEqual(await intelligence.inspect(project, scoped).then(value => value.sampleSeconds), review.sampleSeconds);
  assert.equal(calls, 3, "Completed range checks survive a resumed selection without new submissions");
  let guardedCalls = 0;
  const guarded = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async (_system, input) => {
    guardedCalls++;
    if (JSON.parse(input).duration !== 4) throw new AnyModelCompletionUncertainError("Disconnected", "");
    return JSON.stringify({ status: "accepted", confidence: .99, isCameraFootage: true, actionMatch: true,
      actionEvidence: "Mock", startSeconds: 0, endSeconds: 4 });
  } }, () => join(root, "guarded-tail"));
  await assert.rejects(guarded.inspect(project, scoped));
  await assert.rejects(guarded.inspect(project, scoped));
  assert.equal(guardedCalls, 2, "Unknown original range stops both tail fallback and repeat submission");
});

test("a catalog action locator proposes one bounded interval and still requires its independent frame check", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-action-locator-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const videoPath = join(root, "fixture.mp4"), catalogRoot = join(root, "Documentary", "VideoCatalog", "locator");
  await effectFfmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=2:d=60", "-an", "-c:v", "libx264", videoPath]);
  await mkdir(catalogRoot, { recursive: true });
  const window = { id: 0, start: 0, end: 8, sample: 4 };
  await writeFile(join(catalogRoot, "catalog-v1.json"), JSON.stringify({ version: 1, checksum: "locator", duration: 60,
    windows: [window], segments: [{ ...window, description: "Canal lock gates", entities: [], camera: true, usable: true }] }));
  const scoped = { ...scene, videoPath, audioPath: undefined, durationSeconds: 2,
    documentary: { ...scene.documentary!, verified: false, checksum: "locator",
      selected: { kind: "video", title: "Fixture", width: 640, height: 360, durationSeconds: 60 } as DocumentaryCandidate } };
  const project = { id: "locator", scenes: [scoped] } as unknown as Project;
  let locations = 0, finalChecks = 0, calls = 0;
  const intelligence = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async (system, input, images) => {
    calls++;
    const data = JSON.parse(input);
    if (system.startsWith("Locate the narrated")) {
      locations++;
      assert.equal(images?.length, 7);
      assert.equal(data.regions.length, 1);
      assert.ok(data.regions[0].sampleSeconds[0] >= data.regions[0].start);
      assert.ok(data.regions[0].sampleSeconds.at(-1) <= data.regions[0].end);
      return JSON.stringify({ choice: { id: 0, startSeconds: 5 }, evidence: "Mock location, not approval" });
    }
    if (system.startsWith("Select up to")) return JSON.stringify({ choices: [{ id: 0, startSeconds: 1 }], detailMatch: "direct" });
    if (system.startsWith("Inspect independent groups")) {
      finalChecks++;
      assert.equal(images?.length, 5);
      assert.equal(data.groups.length, 1);
      return JSON.stringify({reviews:[{id:data.groups[0].id,status:"rejected",confidence:.99,isCameraFootage:true,
        mediaType:"camera",presentation:"clean",actionMatch:false,actionEvidence:"Mock initial range has no action"}]});
    }
    assert.ok(system.startsWith("Inspect the five"));
    finalChecks++;
    assert.equal(images?.length, 5);
    const action = data.startSeconds === 5;
    return JSON.stringify({ status: action ? "accepted" : "rejected", confidence: .99, isCameraFootage: true,
      mediaType: "camera", presentation: "clean", actionMatch: action, actionEvidence: "Mock check only", reason: "Mock check only" });
  } }, () => root);
  const review = await intelligence.inspect(project, scoped);
  assert.equal(review.status, "accepted");
  assert.equal(review.trimStartSeconds, 5);
  assert.equal(review.trimEndSeconds, 7);
  assert.equal(locations, 1);
  assert.equal(finalChecks, 2);
  const completedCalls = calls;
  assert.equal((await intelligence.inspect(project, scoped)).status, "accepted");
  assert.equal(calls, completedCalls, "Locator and final check both reuse completed checkpoints");
});

test("context identities may name the owner missing from a short slice without changing narration or search hints", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-context-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = { id: "context", videoBrief: { readyScript: "The Panama Canal lifts vessels. Its gates close." }, scenes: [scene] } as Project;
  let calls = 0, saved: DocumentaryRequirement | undefined;
  const intelligence = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async (_system, input) => {
    calls++;
    assert.equal(JSON.parse(input).script, project.videoBrief!.readyScript);
    return JSON.stringify({ scenes: [{ id: scene.id, identities: [{ name: "Panama Canal", aliases: ["Панамский канал"] }] }] });
  } }, () => root);
  await intelligence.resolveIdentities(project, [scene], async plan => { saved = plan.get(scene.id); });
  assert.equal(saved!.identityContextVersion, 3);
  assert.deepEqual(saved!.entities, ["lock gates"]);
  assert.equal(saved!.text, scene.narration);
  assert.deepEqual(saved!.queries, scene.documentary!.requirement.queries);
  const updated = applyDocumentaryRequirement(scene, saved!);
  assert.equal(updated.documentary!.verified, false);
  assert.equal(updated.audioPath, scene.audioPath);
  assert.equal(updated.videoPath, scene.videoPath);
  await intelligence.resolveIdentities(project, [scene], async () => {});
  assert.equal(calls, 1, "Completed identity analysis must be reused");
});

test("context migration preserves manual pins and approvals already checked for the same subject", () => {
  const requirement = { ...scene.documentary!.requirement, identities: [{ name: "Panama Canal", aliases: ["Панамский канал"] }], identityContextVersion: 2 as const };
  const pinned = { ...scene, documentary: { ...scene.documentary!, pinned: true } };
  assert.equal(applyDocumentaryRequirement(pinned, requirement), pinned);
  const scoped = { ...scene, documentary: { ...scene.documentary!, requirement: { ...requirement, identities: [{ name: "Панамский канал", aliases: [] }] } } };
  assert.equal(applyDocumentaryRequirement(scoped, requirement).documentary!.verified, true);
  assert.equal(applyDocumentaryRequirement(scene, { ...requirement, identities: [] }).documentary!.verified, true);
});

test("metadata screening receives the inherited subject before buying an unrelated download", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-context-rank-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const scoped = { ...scene, documentary: { ...scene.documentary!, requirement: { ...scene.documentary!.requirement, identities: [{ name: "Panama Canal", aliases: [] }] } } };
  const project = { id: "context", scenes: [scoped] } as unknown as Project;
  const intelligence = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async (_system, input) => {
    assert.equal(JSON.parse(input).requiredIdentities[0].name, "Panama Canal");
    return JSON.stringify({ ids: [] });
  } }, () => root);
  const candidate = { id: "german", provider: "pexels", kind: "video", title: "German canal locks", description: "", author: "" } as DocumentaryCandidate;
  assert.deepEqual(await intelligence.rankCandidates(project, scoped, [candidate]), []);
});

test("an interrupted paid context migration cannot be replayed", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-context-pending-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let calls = 0;
  const intelligence = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async () => {
    calls++; throw new AnyModelCompletionUncertainError("Disconnected", '{"scenes":[');
  } }, () => root);
  const project = { id: "context", videoBrief: { readyScript: "The canal. Its gates close." }, scenes: [scene] } as Project;
  await assert.rejects(intelligence.resolveIdentities(project, [scene], async () => {}));
  await assert.rejects(intelligence.resolveIdentities(project, [scene], async () => {}));
  assert.equal(calls, 1);
});

test("visual identity answers name the required place, while retaining generic details and previous paid guards", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-visual-subject-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const imagePath = join(root, "fixture.png");
  await effectFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=red:s=640x360", "-frames:v", "1", imagePath]);
  const scoped = { ...scene, videoPath: undefined, imagePath, durationSeconds: 2,
    documentary: { ...scene.documentary!, checksum: "fixture", requirement: { ...scene.documentary!.requirement,
      entities: ["container ship"], identities: [{ name: "Panama Canal", aliases: ["Панамский канал"] }] },
      selected: { kind: "image", title: "Fixture", width: 640, height: 360 } as DocumentaryCandidate } };
  const project = { id: "context", scenes: [scoped] } as unknown as Project;
  let oldKey = "", calls = 0;
  const intelligence = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async (system, input, images) => {
    calls++;
    const data = JSON.parse(input);
    assert.deepEqual(data.entities, ["Panama Canal"], "Generic categories must not compete with the mandatory identity in the answer field");
    assert.deepEqual(data.detailEntities, ["container ship"]);
    const { detailEntities, ...previousInput } = data;
    previousInput.entities = detailEntities;
    oldKey = createHash("sha256").update(JSON.stringify([2, "visual-overview", system.split(" Identity answer names:")[0], JSON.stringify(previousInput), images])).digest("hex");
    assert.match(system, /actionMatch:boolean/);
    return JSON.stringify({ status: "accepted", confidence: .95, identityMatch: true, identifiedEntity: "Panama Canal", actionMatch: true, actionEvidence: "Mock ordered-frame evidence for contract test only", reason: "Mock for request contract only" });
  } }, () => root);
  assert.equal((await intelligence.inspect(project, scoped)).status, "accepted");
  assert.equal((await intelligence.inspect(project, scoped)).status, "accepted");
  assert.equal(calls, 1);
  const noAction = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async () => JSON.stringify({
    status: "accepted", confidence: .99, identityMatch: true, identifiedEntity: "Panama Canal", actionMatch: false, actionEvidence: "Gates stay closed; only the ship moves.", reason: "Place matches."
  }) }, () => join(root, "no-action"));
  const rejectedAction = await noAction.inspect(project, scoped);
  assert.equal(rejectedAction.status, "uncertain");
  assert.equal(rejectedAction.actionMatch, false);
  assert.match(rejectedAction.reason, /Не подтверждено названное действие/);
  const guardedRoot = join(root, "guarded");
  await mkdir(join(guardedRoot, "Documentary", "Analysis"), { recursive: true });
  await writeFile(join(guardedRoot, "Documentary", "Analysis", `${oldKey}.json`), JSON.stringify({ state: "pending", purpose: "visual-overview" }));
  const guarded = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async () => { throw new Error("Must not submit"); } }, () => guardedRoot);
  await assert.rejects(guarded.inspect(project, scoped), /неизвестный результат/);
});
