import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readdir, readFile, writeFile, link, stat, utimes} from 'node:fs/promises';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {createDefaultProjectSettings, createDocumentarySettings, createVoiceCalibration, documentaryVideoCoverage, type Project, type Scene} from '@gold-work/shared';
import {AnyModelClient} from './anymodel-client.js';
import {DocumentaryAiQueryPlanner} from './documentary-ai-query-planner.js';
import {prepareDocumentaryScript} from './documentary-plan.js';
import {MemoryProjectRepository, MockDirectorProvider, ProjectService} from '@gold-work/core';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {DocumentarySearch} from './documentary-search.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {planFastDocumentaryScene} from './documentary-fast-plan.js';
import {prepareDocumentaryFootageRecovery} from './documentary-footage-recovery.js';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {effectFfmpeg} from './effect-media.js';
import {missingAssemblyInputs} from './assembly-readiness.js';
import {documentaryIllustrationApproval, documentarySavedContextIssue} from './documentary-context-approval.js';
import {withDocumentaryDecoderRecovery} from './documentary-renderer.js';

// Independent contract fixtures, not a measurement of real model/search quality.
for (const abortAt of ['before-first-attempt', 'retry-notice'] as const) {
  test(`Render recovery acceptance: cancellation at ${abortAt} starts no later attempt`, async () => {
    const controller = new AbortController();
    let attempts = 0;
    if (abortAt === 'before-first-attempt') controller.abort();
    await assert.rejects(withDocumentaryDecoderRecovery(async retry => {
      attempts++;
      if (!retry) throw new Error('No frame found at position 10752');
      return 'should not finish after cancellation';
    }, controller.signal, () => controller.abort()), {name: 'AbortError'});
    assert.equal(attempts, abortAt === 'before-first-attempt' ? 0 : 1);
  });
}

const topics = [
  {
    title: 'First jet engine', subject: 'Power Jets W.1', years: ['1941'],
    narration: [
      'In 1941 Frank Whittle tested the Power Jets W.1 in the Gloster E.28/39 at Cranwell.\r\n',
      'His engine used a centrifugal compressor. Its impeller pushed air outward.  ',
      'The narration is read by actor Frank Whittle, a different person with the same name.\n',
    ],
    target: 'Power Jets W.1 centrifugal compressor',
    images: ['Power Jets W.1 compressor 1941', 'Whittle W.1 Cranwell 1941'],
    videos: ['Power Jets W.1 impeller rotation'],
    fallback: ['centrifugal compressor impeller rotation'],
    fallbackTarget: 'centrifugal compressor rotating impeller',
  },
  {
    title: 'Passenger liner', subject: 'SS United States', years: ['1952'],
    narration: [
      'In 1952 SS United States departed New York for Southampton.\r\n',
      'Her four propellers drove the passenger liner across the Atlantic.  ',
      'She must not be confused with a container ship or a modern cruise liner.\n',
    ],
    target: 'SS United States departing New York 1952',
    images: ['SS United States New York 1952'],
    videos: ['SS United States departure 1952'],
    fallback: ['1950s passenger ocean liner underway'],
    fallbackTarget: '1950s passenger ocean liner at sea',
  },
] as const;

function fixture(topic: typeof topics[number]): Project {
  const settings = createDefaultProjectSettings();
  settings.assembly.documentary = createDocumentarySettings();
  const scenes = topic.narration.map((narration, order) => ({
    id: `existing-${order}`, order, narration, title: `Scene ${order}`, durationSeconds: 5,
    status: 'ready', imagePrompt: '', animationPrompt: '',
    documentary: {version: 2, requirement: {text: narration, entities: [], years: [], queries: ['old local query']},
      candidates: [], verified: false, pinned: false, illustrative: false, reviewNote: '', layout: 'full', effects: [],
      caption: {enabled: false, text: '', position: 'bottom', animation: 'fade', fontSize: 48, color: '#ffffff', backgroundColor: '#000000', opacity: .7}},
  } as Scene));
  return {id: `acceptance-${topic.title}`, title: topic.title, topic: topic.title, language: 'English',
    mediaMode: 'stock', status: 'ready', settings, scenes,
    videoBrief: {creationMode: 'script', readyScript: topic.narration.join('')},
  } as Project;
}

function answer(topic: {subject:string;target:string;years:readonly string[];images:readonly string[];videos:readonly string[];
  fallback:readonly string[];fallbackTarget:string;narration:readonly string[]}, sceneId: string) {
  return {sceneId, subject: topic.subject, visualTarget: topic.target, years: [...topic.years],
    visualScope: 'exact', preferredKind: 'video', reservePolicy: 'thematic', imageQueries: [...topic.images], videoQueries: [...topic.videos],
    fallbackVideoQueries: [...topic.fallback], fallbackVisualTarget: topic.fallbackTarget,
    grounding:{version:1,mandatory:[{kind:'identity',required:topic.subject,scriptQuote:topic.narration.join('')},
      ...topic.years.map(year=>({kind:'era',required:year,scriptQuote:topic.narration.join('')}))],
      illustrations:[topic.target],optionalDetails:[]}};
}

async function temporary(t: {after(fn: () => Promise<void>): void}) {
  const root = await mkdtemp(join(tmpdir(), 'gws-ai-query-acceptance-'));
  t.after(async () => {
    const absolute = resolve(root), parent = resolve(tmpdir());
    assert.ok(absolute.startsWith(parent + sep) && absolute !== parent, 'Cleanup stays in its own temporary fixture');
    await rm(absolute, {recursive: true, force: true});
  });
  return root;
}

for (const topic of topics) {
  test(`AI query acceptance: complete context and separate media lanes survive cache restart (${topic.title})`, async t => {
    const root = await temporary(t), project = fixture(topic), before = structuredClone(project);
    let calls = 0;
    const client = {
      documentaryQueryModel: async () => 'text-model-fixture',
      documentaryCompletion: async (_system: string, text: string, images: string[], _signal: unknown, _partial: unknown, model: string) => {
        calls++;
        const input = JSON.parse(text);
        assert.equal(input.originalScript, project.videoBrief!.readyScript);
        assert.deepEqual(input.contextScenes, project.scenes.map(s => ({sceneId: s.id, narration: s.narration})));
        assert.deepEqual(input.requestedScenes, [{sceneId: project.scenes[1]!.id, narration: project.scenes[1]!.narration}]);
        assert.deepEqual(images, []);
        assert.equal(model, 'text-model-fixture');
        return JSON.stringify({scenes: [answer(topic, project.scenes[1]!.id)]});
      },
    } as unknown as AnyModelClient;
    const planned = await new DocumentaryAiQueryPlanner(client, () => root).plan(project, [project.scenes[1]!]);
    const requirement = planned.get(project.scenes[1]!.id)!;
    assert.equal(requirement.text, project.scenes[1]!.narration);
    assert.deepEqual(requirement.aiSearchPlan!.imageQueries, topic.images);
    assert.deepEqual(requirement.aiSearchPlan!.videoQueries, topic.videos);
    assert.deepEqual(requirement.aiSearchPlan!.fallbackVideoQueries, topic.fallback);
    assert.deepEqual(requirement.aiSearchPlan!.years, topic.years);
    assert.equal(requirement.aiSearchPlan!.subject, topic.subject);
    assert.ok(!requirement.queries.includes(topic.fallback[0]));
    assert.match(requirement.aiSearchPlan!.inputHash, /^[a-f0-9]{64}$/);
    assert.deepEqual(await new DocumentaryAiQueryPlanner(client, () => root).plan(project, [project.scenes[1]!]), planned);
    assert.equal(calls, 1, 'A new planner instance reuses its durable paid response');
    assert.deepEqual(project, before, 'Planning cannot rewrite the project');
  });
}

test('AI query acceptance: three valid queries normalize to two whole phrases without a paid repair or raw-response rewrite', async t => {
  const root = await temporary(t), topic = topics[1], project = fixture(topic), scene = project.scenes[0]!;
  const entry = {...answer(topic, scene.id),
    imageQueries: ['SS United States New York harbor departure 1952', 'SS United States Southampton passenger liner 1952', 'SS United States ocean liner historic photograph'],
    videoQueries: ['SS United States leaving New York harbor 1952', 'SS United States passenger liner underway', 'SS United States transatlantic crossing archive film'],
    fallbackVideoQueries: ['1950s passenger ocean liner underway', 'historic passenger liner sailing Atlantic Ocean', 'ocean liner leaving a harbor']};
  const raw = JSON.stringify({scenes: [entry]}); let calls = 0;
  const client = {documentaryQueryModel: async () => 'text-model-fixture',
    documentaryCompletion: async () => {calls++; return raw;}} as unknown as AnyModelClient;
  const result = await new DocumentaryAiQueryPlanner(client, () => root).plan(project, [scene]);
  const plan = result.get(scene.id)!.aiSearchPlan!;
  for (const lane of ['imageQueries', 'videoQueries', 'fallbackVideoQueries'] as const)
    assert.deepEqual(plan[lane], entry[lane].slice(0, 2), 'Keep complete ordered phrases, never truncated strings');
  assert.equal(calls, 1, 'A small valid surplus must not buy a second model response');
  const directory = join(root, 'documentary-ai-query-plans');
  const [name] = (await readdir(directory)).filter(name => name.endsWith('.json'));
  const file = join(directory, name!), before = await readFile(file);
  const receipt = JSON.parse(before.toString());
  assert.equal(receipt.attempts.length, 1);
  assert.equal(receipt.attempts[0].status, 'complete');
  assert.equal(receipt.attempts[0].rawResponse, raw, 'Paid raw response retains all three original queries');
  const restarted = new DocumentaryAiQueryPlanner(client, () => root);
  assert.deepEqual(await restarted.readCached(project, [scene]), result);
  assert.deepEqual(await restarted.plan(project, [scene]), result);
  assert.equal(calls, 1);
  assert.deepEqual(await readFile(file), before, 'Cache restart does not rewrite the paid checkpoint');
});

test('AI query acceptance: a partial uncertain response preserves accepted scenes and blocks resubmission after restart', async t => {
  const root = await temporary(t), project = fixture(topics[0]);
  let calls = 0;
  const client = {documentaryQueryModel: async () => 'text-model-fixture',
    documentaryCompletion: async (_system: string, _text: string, _images: unknown, _signal: unknown, onPartial: (text: string) => void) => {
      calls++;
      onPartial('{"scenes":[' + JSON.stringify(answer(topics[0], project.scenes[0]!.id)) + ',{"sceneId":');
      throw new Error('Simulated connection loss after paid submission');
    },
  } as unknown as AnyModelClient;
  await assert.rejects(new DocumentaryAiQueryPlanner(client, () => root).plan(project, project.scenes));
  const restarted = new DocumentaryAiQueryPlanner(client, () => root);
  const saved = await restarted.plan(project, [project.scenes[0]!]);
  assert.deepEqual(saved.get(project.scenes[0]!.id)!.aiSearchPlan!.videoQueries, topics[0].videos);
  await assert.rejects(restarted.plan(project, project.scenes), /неопределён|повтор/);
  assert.equal(calls, 1);
});

test('AI query acceptance: malformed completed output has a bounded repair and no endless paid retry', async t => {
  const root = await temporary(t), project = fixture(topics[1]);
  let calls = 0;
  const client = {documentaryQueryModel: async () => 'text-model-fixture',
    documentaryCompletion: async () => {calls++; return '{"scenes":[]}';},
  } as unknown as AnyModelClient;
  await assert.rejects(new DocumentaryAiQueryPlanner(client, () => root).plan(project, project.scenes));
  assert.equal(calls, 2);
  await assert.rejects(new DocumentaryAiQueryPlanner(client, () => root).plan(project, project.scenes));
  assert.equal(calls, 2);
});

test('AI query acceptance: simultaneous launches share a receipt; a completed partial answer repairs only missing IDs', async t => {
  const root = await temporary(t), project = fixture(topics[1]);
  const batches: string[][] = [];
  const client = {documentaryQueryModel: async () => 'text-model-fixture',
    documentaryCompletion: async (_system: string, text: string) => {
      const input = JSON.parse(text);
      const ids: string[] = input.requestedScenes.map((scene: {sceneId: string}) => scene.sceneId);
      batches.push(ids);
      assert.equal(input.originalScript, project.videoBrief!.readyScript);
      assert.equal(input.contextScenes.length, project.scenes.length);
      return JSON.stringify({scenes: (batches.length === 1 ? ids.slice(0, 1) : ids).map(id => answer(topics[1], id))});
    },
  } as unknown as AnyModelClient;
  const [first, second] = await Promise.all([
    new DocumentaryAiQueryPlanner(client, () => root).plan(project, project.scenes),
    new DocumentaryAiQueryPlanner(client, () => root).plan(project, project.scenes),
  ]);
  assert.deepEqual(first, second);
  assert.deepEqual(batches, [project.scenes.map(s => s.id), project.scenes.slice(1).map(s => s.id)]);
});

test('AI query acceptance: cancellation before planning sends no request; text selection is separate from vision', async t => {
  const root = await temporary(t), project = fixture(topics[1]);
  let calls = 0;
  const client = new AnyModelClient({publicSettings: async () => ({baseUrl: 'https://anymodel.org', textModel: 'configured-text-model'})} as any);
  assert.equal(await client.documentaryQueryModel(), 'configured-text-model');
  assert.equal(await client.documentaryAnalysisModel('fast'), 'ag/gemini-3.8-flash-high');
  client.documentaryCompletion = async () => {calls++; throw new Error('No paid transport in acceptance');};
  await assert.rejects(new DocumentaryAiQueryPlanner(client, () => root).plan(project, project.scenes, {signal: AbortSignal.abort()}));
  assert.equal(calls, 0);
});

test('AI query acceptance: Stop during standalone script planning prevents the next paid batch', async t => {
  const root = await temporary(t), source = fixture(topics[1]);
  source.scenes = Array.from({length: 9}, (_, order) => ({...structuredClone(source.scenes[1]!), id: `stop-${order}`, order}));
  source.videoBrief!.readyScript = source.scenes.map(scene => scene.narration).join('');
  const projects = new ProjectService(new MemoryProjectRepository(), new MockDirectorProvider());
  const created = await projects.create({title: source.title, topic: source.topic, mode: 'standard', mediaMode: 'stock', language: 'English', aspectRatio: '16:9'});
  const project = await projects.update(created.id, {scenes: source.scenes, settings: source.settings, videoBrief: source.videoBrief});
  let entered!: () => void, release!: () => void, calls = 0;
  const started = new Promise<void>(resolve => {entered = resolve;});
  const resume = new Promise<void>(resolve => {release = resolve;});
  const client = {documentaryQueryModel: async () => 'text-model-fixture',
    documentaryCompletion: async (_system: string, text: string, _images: unknown, signal?: AbortSignal) => {
      calls++;
      if (calls === 1) {entered(); await resume;}
      signal?.throwIfAborted();
      return JSON.stringify({scenes: JSON.parse(text).requestedScenes.map((scene: {sceneId: string}) => answer(topics[1], scene.sceneId))});
    },
  } as unknown as AnyModelClient;
  const service = new DocumentaryProjectService(projects, new LocalProjectStorage(join(root, 'Projects')), new DocumentarySearch(),
    join(root, 'Materials'), {download: async () => {throw new Error('No external transfer');}}, () => {}, undefined, undefined, undefined,
    new DocumentaryAiQueryPlanner(client, () => root));
  const result = service.planSearch(project.id).then(() => undefined, error => error);
  await started;
  const stopping = service.stop(project.id);
  release();
  await stopping;
  await result;
  assert.equal(calls, 1, 'A direct planSearch run must be cancellable even without autoSelect');
});

test('AI query acceptance: resume preserves ready legacy scenes without AI metadata and plans only unfinished scenes', async t => {
  const root = await temporary(t), source = fixture(topics[1]);
  source.title = source.topic = 'Motorcycle track riding';
  source.videoBrief!.readyScript = source.scenes.map(() => 'A motorcycle rider leans through a curve.').join('\n');
  for (const scene of source.scenes) {
    scene.narration = scene.documentary!.requirement.text = 'A motorcycle rider leans through a curve.';
    scene.documentary!.verified = true;
    scene.documentary!.pinned = false;
    scene.audioPath = `paid-${scene.id}.mp3`;
    scene.videoPath = join(root,`accepted-${scene.id}.mp4`);
    await writeFile(scene.videoPath,'existing accepted fixture bytes');
    scene.documentary!.caption.text = `Existing caption ${scene.id}`;
    scene.documentary!.selected = {id: scene.id, kind: 'video', provider: 'local', title: 'Motorcycle rider cornering',
      description: 'Motorcycle rider leans through a curve', rights: 'user-confirmed'} as any;
    scene.documentary!.checksum = 'a'.repeat(64);
    // Existing receipt fixture: this tests resume routing, not real visual quality.
    scene.documentary!.visualReview = {status: 'accepted', footageOrigin:'camera', viewDescription: 'Motorcycle rider leans through a curve.',
      fastRelevance: {version: 1, target: planFastDocumentaryScene(source, scene).visualTarget, relevant: true,
        evidence: 'Motorcycle rider leans through a curve.'}} as any;
    scene.documentary!.visualReview!.illustrationApproval = documentaryIllustrationApproval(source, scene);
    assert.equal(documentarySavedContextIssue(source, scene), undefined, 'Fixture has a valid saved approval without an AI query plan');
  }
  const projects = new ProjectService(new MemoryProjectRepository(), new MockDirectorProvider());
  const created = await projects.create({title: source.title, topic: source.topic, mode: 'standard', mediaMode: 'stock', language: 'English', aspectRatio: '16:9'});
  const before = await projects.update(created.id, {scenes: source.scenes, settings: source.settings, videoBrief: source.videoBrief});
  const batches: string[][] = [];
  const client = {documentaryQueryModel: async () => 'text-model-fixture',
    documentaryCompletion: async (_system: string, text: string) => {
      const ids = JSON.parse(text).requestedScenes.map((scene: {sceneId: string}) => scene.sceneId);
      batches.push(ids);
      return JSON.stringify({scenes: ids.map((id: string) => answer({...topics[1],subject:'Motorcycle rider',
        target:'Motorcycle rider leaning through a curve',years:[],narration:[source.videoBrief!.readyScript!]}, id))});
    },
  } as unknown as AnyModelClient;
  const service = new DocumentaryProjectService(projects, new LocalProjectStorage(join(root, 'Projects')), new DocumentarySearch(),
    join(root, 'Materials'), {download: async () => {throw new Error('No external transfer');}}, () => {}, undefined, undefined, undefined,
    new DocumentaryAiQueryPlanner(client, () => root));
  const resumed = await service.planSearch(before.id);
  assert.deepEqual(resumed.scenes, before.scenes);
  assert.deepEqual(batches, [], 'Missing AI-plan metadata does not invalidate ready material or pay for replanning');
  const pendingId = before.scenes[1]!.id;
  await projects.mutate(before.id, current => ({scenes: current.scenes.map(scene => scene.id === pendingId
    ? {...scene, documentary: {...scene.documentary!, verified: false}} : scene)}));
  const planned = await service.planSearch(before.id);
  assert.deepEqual(batches, [[pendingId]], 'Only an unfinished scene needs a new query plan');
  assert.deepEqual(planned.scenes.filter(scene => scene.id !== pendingId), before.scenes.filter(scene => scene.id !== pendingId));
});

test('AI query acceptance: repeated splitting preserves paid narration and manual media edits; photos do not satisfy 60% video', () => {
  const project = fixture(topics[1]);
  const scene = project.scenes[1]!;
  scene.audioPath = 'existing-paid-narration.mp3';
  scene.imagePath = 'manual-selected-image.jpg';
  scene.videoPath = 'photo-with-zoom.mp4';
  scene.documentary!.pinned = true;
  scene.documentary!.verified = true;
  scene.documentary!.selected = {id: 'manual', kind: 'image', durationSeconds: 5} as any;
  scene.documentary!.caption.text = 'Manual caption';
  const before = structuredClone(project);
  const calibration = createVoiceCalibration({provider: 'elevenlabs', voice: 'fixture', language: 'en',
    sampleText: 'This is an isolated calibration fixture only.', audioDurationSeconds: 5, calibratedAt: '2026-10-16T00:00:00Z'});
  assert.deepEqual(prepareDocumentaryScript(project, calibration), before.scenes);
  assert.deepEqual(project, before);
  assert.equal(project.settings.stockVideoPercent, 60);
  assert.equal(documentaryVideoCoverage(project.scenes).videoSeconds, 0);
});

test('AI query acceptance: current three-frame review does not repay unchanged media after a hardlink or timestamp touch', async t => {
  const root = await temporary(t), project = fixture(topics[1]);
  const video = join(root, 'motion.mp4');
  await effectFfmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=10', '-t', '4', '-c:v', 'libx264', '-threads', '1', '-preset', 'ultrafast', video]);
  const scene = project.scenes[0]!;
  scene.narration = 'A bird moves in a tree.';
  scene.durationSeconds = 4;
  scene.videoPath = video;
  project.title = project.topic = 'Bird';
  project.scenes = [scene];
  project.videoBrief!.readyScript = scene.narration;
  scene.documentary!.checksum = createHash('sha256').update(await readFile(video)).digest('hex');
  scene.documentary!.selected = {id: 'fixture-bird', kind: 'video', provider: 'local', title: 'Bird', description: 'Bird',
    durationSeconds: 4, width: 1280, height: 720, localPath: video, rights: 'user-confirmed'} as any;
  let calls = 0;
  const client = {configured: async () => true, documentaryCompletion: async (_system: string, input: string, images?: string[]) => {
    calls++;
    const data = JSON.parse(input);
    assert.equal(images!.length, 3, 'Use the CURRENT three-frame contract');
    return JSON.stringify({target: data.visualTarget, description: 'A bird moves in a tree.', relevant: true,
      footageOrigin: 'camera', targetVisible: true, targetEvidence: 'Mock bird visibly moves in a tree.', sourceText: {kind: 'none', text: ''},
      evidence: 'A bird visibly moves between tree branches.',
      sampleChecks: data.sampleSeconds.map((seconds: number) => ({seconds, targetVisible: true, evidence: 'Mock bird moves in tree'})),
      motion: {motionType: 'live-footage', confidence: 1, cameraMoves: false, subjectMoves: true, globalTransformOnly: false,
        subjectMotionEvidence: 'Mock subject movement relative to branches', evidence: 'Mock orchestration response, not visual quality evidence'}});
  }};
  const first = await new DocumentaryIntelligence(client, () => root).inspectForSelection(project, scene);
  assert.equal(first.review.status, 'accepted', first.review.reason);
  scene.documentary!.visualReview = first.review;
  scene.documentary!.verified = true;
  scene.trimStartSeconds = first.review.trimStartSeconds;
  scene.trimEndSeconds = first.review.trimEndSeconds;
  let stableSourceReads = 0;
  const createReadStream = fs.createReadStream;
  try {
    fs.createReadStream = ((...args: Parameters<typeof createReadStream>) => {
      if (typeof args[0] === 'string' && resolve(args[0]) === resolve(video)) stableSourceReads++;
      return createReadStream(...args);
    }) as typeof createReadStream;
    syncBuiltinESMExports();
    assert.equal(await new DocumentaryIntelligence(client, () => root).savedMotionIssue(project, scene), undefined);
    assert.equal(stableSourceReads, 0, 'Stable size/mtime/ctime must not trigger a full source hash on ordinary ready resume');
  } finally {
    fs.createReadStream = createReadStream;
    syncBuiltinESMExports();
  }
  const before = await stat(video, {bigint: true});
  await link(video, join(root, 'same-media.mp4'));
  const after = await stat(video, {bigint: true});
  assert.notEqual(after.ctimeNs, before.ctimeNs);
  assert.equal(after.mtimeNs, before.mtimeNs);
  const repeated = await new DocumentaryIntelligence(client, () => root).inspectForSelection(project, scene);
  assert.equal(repeated.review.status, 'accepted');
  assert.equal(calls, 1, 'A metadata-only hardlink must not send the same paid visual review twice');
  assert.equal(repeated.usedNewAnalysis, false);
  const untouchedBytes = await readFile(video);
  const touchedBefore = await stat(video);
  await utimes(video, touchedBefore.atime, new Date(touchedBefore.mtimeMs + 2000));
  assert.deepEqual(await readFile(video), untouchedBytes, 'Touch changes metadata, not reviewed content');
  const restarted = new DocumentaryIntelligence(client, () => root);
  assert.equal(await restarted.savedMotionIssue(project, scene), undefined, 'Unchanged bytes retain the saved approval after a timestamp touch');
  const touched = await restarted.inspectForSelection(project, scene, () => {}, () => false, true);
  assert.equal(touched.review.status, 'accepted');
  assert.equal(touched.usedNewAnalysis, false);
  assert.equal(calls, 1, 'Metadata-only mtime drift must not require a new paid review');
});

test('AI query acceptance: saved illustration approval rejects changed bytes at the same file size without a paid call', async t => {
  const root = await temporary(t), project = fixture(topics[1]), scene = project.scenes[0]!;
  const video = join(root, 'changed-source.mp4');
  await effectFfmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=10', '-t', '4', '-c:v', 'libx264', '-threads', '1', '-preset', 'ultrafast', video]);
  scene.narration = scene.documentary!.requirement.text = 'A bird moves in a tree.';
  scene.durationSeconds = 4; scene.videoPath = video;
  project.title = project.topic = 'Bird'; project.scenes = [scene]; project.videoBrief!.readyScript = scene.narration;
  const fixedTime = new Date('2026-10-01T00:00:00.000Z');
  await utimes(video, fixedTime, fixedTime);
  const original = await readFile(video);
  scene.documentary!.checksum = createHash('sha256').update(original).digest('hex');
  scene.documentary!.selected = {id: 'changed-source', kind: 'video', provider: 'local', title: 'Bird', description: 'Bird',
    durationSeconds: 4, width: 1280, height: 720, localPath: video, rights: 'user-confirmed'} as any;
  let calls = 0;
  const client = {configured: async () => true, documentaryCompletion: async (_system: string, text: string) => {
    calls++; const input = JSON.parse(text);
    return JSON.stringify({target: input.visualTarget, relevant: true, description: 'A bird moves in a tree.', evidence: 'A bird visibly moves on branches.',
      footageOrigin: 'camera', targetVisible: true, targetEvidence: 'Mock bird visibly moves on branches.', sourceText: {kind: 'none', text: ''},
      sampleChecks: input.sampleSeconds.map((seconds: number) => ({seconds, targetVisible: true, evidence: 'Mock bird changes position'})),
      motion: {motionType: 'live-footage', confidence: 1, cameraMoves: false, subjectMoves: true, globalTransformOnly: false,
        subjectMotionEvidence: 'Mock bird changes position relative to branches', evidence: 'Mock receipt for a local cache regression'}});
  }};
  const intelligence = new DocumentaryIntelligence(client, () => root);
  const first = await intelligence.inspectForSelection(project, scene);
  assert.equal(first.review.status, 'accepted');
  scene.trimStartSeconds = first.review.trimStartSeconds; scene.trimEndSeconds = first.review.trimEndSeconds;
  scene.documentary!.visualReview = first.review; scene.documentary!.verified = true;
  const before = await stat(video);
  const beforeRevision = await stat(video, {bigint: true});
  const changed = Buffer.from(original); changed[changed.length - 1] = changed[changed.length - 1]! ^ 1;
  await writeFile(video, changed); await utimes(video, before.atime, before.mtime);
  assert.equal((await stat(video)).size, before.size, 'Equal size cannot establish content identity');
  const afterRevision = await stat(video, {bigint: true});
  assert.equal(afterRevision.mtimeNs, beforeRevision.mtimeNs, 'Restored mtime is exact, not rounded to a different millisecond');
  assert.notEqual(afterRevision.ctimeNs, beforeRevision.ctimeNs);
  assert.notEqual(createHash('sha256').update(await readFile(video)).digest('hex'), scene.documentary!.checksum);
  assert.match((await new DocumentaryIntelligence(client, () => root).savedMotionIssue(project, scene)) ?? '', /изменился локальный файл/,
    'A saved illustration receipt cannot approve different current source bytes');
  assert.equal(calls, 1, 'Local invalidation does not send another model request');
});

test('AI query acceptance: confirmed photos can assemble without a video quota; missing or unverified media still block', () => {
  const project = fixture(topics[1]);
  project.settings.voice.enabled = false;
  for (const scene of project.scenes) {
    scene.imagePath = `manual-${scene.id}.jpg`;
    scene.documentary!.selected = {id: scene.id, kind: 'image', localPath: scene.imagePath} as any;
    scene.documentary!.verified = true;
    scene.documentary!.pinned = true;
  }
  assert.equal(documentaryVideoCoverage(project.scenes).percent, 0);
  assert.deepEqual(missingAssemblyInputs(project, [], () => true), [],
    'The 18 October contract permits confirmed photos without a mandatory video minimum');
  assert.ok(missingAssemblyInputs(project, [], () => false).length > 0, 'Missing files still block assembly');
  const unverified=structuredClone(project);
  unverified.scenes[0]!.documentary!.verified=false;
  assert.ok(missingAssemblyInputs(unverified, [], () => true).length > 0, 'Unverified material still blocks assembly');
  const pending=project.scenes.map(scene=>({projectId:project.id,sceneId:scene.id,kind:'image',status:'pending'}));
  assert.deepEqual(missingAssemblyInputs(project,pending as any,()=>false),[], 'Scheduled replacements may supply missing files');
  for(const status of ['failed','cancelled'])assert.ok(missingAssemblyInputs(project,pending.map(task=>({...task,status})) as any,()=>false).length>0,
    'Failed or cancelled work cannot supply missing files');
  assert.deepEqual(missingAssemblyInputs({...project, mediaMode: 'ai'}, [], () => true), [],
    'AI Story remains unaffected');
});

for (const topic of topics) {
  test(`AI query acceptance: real service uses AI lanes through selectAll and thematic recovery (${topic.title})`, async t => {
    const root = await temporary(t);
    const projects = new ProjectService(new MemoryProjectRepository(), new MockDirectorProvider());
    const created = await projects.create({title: topic.title, topic: topic.title, mode: 'standard', mediaMode: 'stock', language: 'English', aspectRatio: '16:9'});
    const source = fixture(topic);
    source.scenes[0]!.audioPath = 'existing-paid-voice.mp3';
    source.scenes[2]!.documentary!.pinned = true;
    source.scenes[2]!.documentary!.caption.text = 'Keep this manual caption';
    let project = await projects.update(created.id, {scenes: source.scenes, settings: source.settings, videoBrief: source.videoBrief});
    const preserved = structuredClone(project.scenes[2]);
    let calls = 0;
    const client = {documentaryQueryModel: async () => 'text-model-fixture',
      documentaryCompletion: async (_system: string, text: string) => {
        calls++;
        const request = JSON.parse(text);
        return JSON.stringify({scenes: request.requestedScenes.map((scene: {sceneId: string}) => ({
          ...answer(topic, scene.sceneId), preferredKind: scene.sceneId === source.scenes[0]!.id ? 'image' : 'video',
        }))});
      },
    } as unknown as AnyModelClient;
    const requests: {query: string; kind: string}[] = [];
    const search = new DocumentarySearch();
    search.search = async input => {requests.push({query: input.query, kind: input.kind!}); return {candidates: [], sources: []};};
    const service = new DocumentaryProjectService(projects, new LocalProjectStorage(join(root, 'Projects')), search,
      join(root, 'Materials'), {download: async () => {throw new Error('No external transfer in acceptance');}}, () => {},
      {simpleSelection: true, available: async () => true, plan: async () => {throw new Error('Legacy semantic planner must not run');},
        inspect: async () => {throw new Error('No candidates to inspect');}}, undefined, undefined,
      new DocumentaryAiQueryPlanner(client, () => root));
    project = await service.planSearch(project.id);
    const id = project.scenes[1]!.id;
    assert.deepEqual(project.scenes[2], preserved);
    assert.equal(project.scenes[0]!.audioPath, 'existing-paid-voice.mp3');
    assert.equal(project.videoBrief!.readyScript, source.videoBrief!.readyScript);
    assert.deepEqual(project.scenes.map(s => [s.id, s.narration]), source.scenes.map(s => [s.id, s.narration]));
    assert.deepEqual(planFastDocumentaryScene(project, project.scenes[1]!, 'image').queries, topic.images);
    assert.deepEqual(planFastDocumentaryScene(project, project.scenes[1]!, 'video').queries, topic.videos);
    // Exercise the actual selection/source loop, with only external search replaced.
    await (service as any).selectAll(project.id, {sceneIds: [source.scenes[0]!.id, id]});
    assert.ok(requests.some(request => request.kind === 'video'));
    assert.ok(requests.some(request => request.kind === 'image'));
    for (const request of requests) {
      assert.ok((request.kind === 'video' ? [...topic.videos] : [...topic.images]).includes(request.query as never), JSON.stringify(request));
    }
    assert.equal(calls, 1, 'Selection reuses planning cache');
    project = (await projects.get(project.id))!;
    const recovery = prepareDocumentaryFootageRecovery(project, project.scenes[1]!);
    assert.deepEqual(recovery.documentary!.requirement.aiSearchPlan!.videoQueries, topic.videos);
    assert.deepEqual(recovery.documentary!.requirement.footageFallback!.queries, topic.fallback);
    project = await projects.update(project.id, {scenes: project.scenes.map(s => s.id === id ? recovery : s)});
    requests.length = 0;
    await (service as any).selectAll(project.id, {sceneIds: [id]}, true);
    assert.ok(requests.length > 0, 'Fallback reaches the actual sources');
    assert.ok(requests.every(request => request.kind === 'video' && [...topic.fallback].includes(request.query as never)), JSON.stringify(requests));
    assert.equal(calls, 1, 'Recovery cannot charge for the same plan again');
    const changed = structuredClone(project);
    changed.scenes[0]!.narration += ' The setting has changed.';
    assert.deepEqual(planFastDocumentaryScene(changed, changed.scenes[1]!, 'video').queries, [],
      'Changed context must not silently reuse or locally rewrite a stale paid plan');
  });
}
