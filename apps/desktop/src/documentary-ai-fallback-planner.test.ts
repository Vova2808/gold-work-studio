import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Project, Scene } from '@gold-work/shared';
import { AnyModelCompletionUncertainError, AnyModelOutputFormatError, type AnyModelClient } from './anymodel-client.js';
import { DocumentaryAiQueryPlanner } from './documentary-ai-query-planner.js';

type Payload = { purpose?: string; inputHash?: string; originalScript: string;
  requestedScenes: Array<{ sceneId: string; narration: string; originalSearchPlan?: unknown }> };
type Call = { system: string; data: Payload };
const primary = (sceneId: string) => ({ sceneId, subject: 'Valentino Rossi Honda RC211V',
  visualTarget: 'Valentino Rossi Honda RC211V racing 2003', years: ['2003'], visualScope: 'exact', preferredKind: 'video',reservePolicy:'thematic',
  imageQueries: ['Valentino Rossi Honda RC211V 2003'], videoQueries: ['Valentino Rossi Honda RC211V racing 2003'],
  fallbackVisualTarget: 'Rossi Honda RC211V racing in 2003', fallbackVideoQueries: ['Rossi Honda RC211V racing in the 2003 season'] });
const generic = (sceneId: string) => ({ sceneId, fallbackVisualTarget: 'motorcycle racing on track',
  fallbackVideoQueries: ['motorcycle racing on track', 'motorcycle riders'] });
const answer = (entries: unknown[]) => JSON.stringify({ scenes: entries });

async function fixture(t: { after: (fn: () => Promise<void>) => void }, count = 1,
  handler: (call: Call, partial?: (text: string) => void) => Promise<string> = async call =>
    answer(call.data.requestedScenes.map(scene => generic(scene.sceneId))),prefix='') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gws-fallback-plan-'));
  const absoluteRoot = path.resolve(root), temporaryRoot = path.resolve(os.tmpdir());
  assert.ok(absoluteRoot.startsWith(temporaryRoot + path.sep) && path.basename(absoluteRoot).startsWith('gws-fallback-plan-'));
  t.after(async () => { await rm(absoluteRoot, { recursive: true, force: true }); });
  const calls: Call[] = [];
  const client = { documentaryQueryModel: async () => 'fixture/text-model',
    documentaryCompletion: async (system: string, text: string, images: string[], _signal: unknown,
      partial: ((text: string) => void) | undefined) => {
      assert.deepEqual(images, []);
      const call = { system, data: JSON.parse(text) as Payload };
      calls.push(call);
      return call.data.purpose ? handler(call, partial) : answer(call.data.requestedScenes.map(scene => primary(scene.sceneId)));
    } } as unknown as AnyModelClient;
  const planner = () => new DocumentaryAiQueryPlanner(client, () => root);
  const scenes = Array.from({ length: count }, (_, order) => ({ id: `scene-${order}`, order,
    narration: `${prefix}Rossi rode the Honda RC211V in 2003. Original unchanged narration ${order}.`,
    audioPath: `manual-audio-${order}.mp3`, imagePath: `manual-image-${order}.jpg` } as unknown as Scene));
  const project = { id: 'fixture', title: 'Fixture', topic: 'Motorcycle history', language: 'ru', scenes,
    videoBrief: { readyScript: `ENTIRE SOURCE: ${scenes.map(scene => scene.narration).join('\n')}` } } as Project;
  const requirements = await planner().plan(project, scenes);
  for (const scene of scenes) scene.documentary = { version: 2, verified: false, pinned: false,
    requirement: { ...requirements.get(scene.id)!, caption: 'Original manual caption' },
    selected: { id: `selected-${scene.id}` }, visualReview: { status: 'rejected' } } as Scene['documentary'];
  const files = async (directory = 'documentary-ai-fallback-plans') => (await readdir(path.join(root, directory)))
    .filter(file => file.endsWith('.json')).map(file => path.join(root, directory, file));
  return { root, calls, planner, scenes, project, files, fallbackCalls: () => calls.filter(call => Boolean(call.data.purpose)) };
}

test('fallback changes only two AI reserve fields, preserves source/audio/manual material and excludes accepted or pinned scenes', async t => {
  const f = await fixture(t, 5);
  f.scenes[1]!.documentary!.verified = true;
  f.scenes[2]!.documentary!.pinned = true;
  f.scenes[3]!.documentary!.visualReview!.status = 'accepted';
  delete f.scenes[4]!.documentary!.requirement.aiSearchPlan;
  const snapshot = structuredClone(f.project), original = structuredClone(f.scenes[0]!.documentary!.requirement);
  const result = await f.planner().planFallbacks(f.project, f.scenes);
  assert.deepEqual([...result.keys()], ['scene-0']);
  const changed = result.get('scene-0')!;
  assert.deepEqual(changed, { ...original, aiSearchPlan: { ...original.aiSearchPlan!,
    fallbackVideoQueries: generic('scene-0').fallbackVideoQueries, fallbackVisualTarget: generic('scene-0').fallbackVisualTarget } });
  assert.equal(changed.aiSearchPlan!.inputHash, original.aiSearchPlan!.inputHash);
  assert.deepEqual(f.project, snapshot);
  assert.equal(f.fallbackCalls().length, 1);
  const call = f.fallbackCalls()[0]!;
  assert.equal(call.data.originalScript, f.project.videoBrief!.readyScript);
  assert.deepEqual(call.data.requestedScenes.map(scene => scene.sceneId), ['scene-0']);
  assert.deepEqual(call.data.requestedScenes[0]!.originalSearchPlan, original.aiSearchPlan);
  assert.match(call.system, /2-5 words/);
  assert.match(call.system, /Never edit narration/);
  assert.match(call.system, /Require multiple objects in the same shot only if the point is inherently visual or the script explicitly requests that view/);
  assert.match(call.system, /Keep the same named referent when identity matters/);
  assert.match(call.system, /keep the meaningful object class and setting explicit in both its target and queries/);
  const receipt = JSON.parse(await readFile((await f.files())[0]!, 'utf8'));
  assert.equal(receipt.purpose, 'search-fallback-plan-v2');
  assert.deepEqual(receipt.sources['scene-0'], original.aiSearchPlan);
  assert.equal(receipt.attempts[0].status, 'complete');
  assert.equal(receipt.attempts[0].request.payload, JSON.stringify(call.data));
});

test('completed fallback overlays plan and readCached without POST or rewriting primary/sidecar receipts; overlay address stays stable', async t => {
  const f = await fixture(t);
  const primaryFile = (await f.files('documentary-ai-query-plans'))[0]!, originalBytes = await readFile(primaryFile);
  const repaired = await f.planner().planFallbacks(f.project, f.scenes);
  const fallbackFile = (await f.files())[0]!, fallbackBytes = await readFile(fallbackFile);
  f.scenes[0]!.documentary!.requirement = repaired.get('scene-0')!;
  for (const result of [await f.planner().planFallbacks(f.project, f.scenes),
    await f.planner().plan(f.project, f.scenes), await f.planner().readCached(f.project, f.scenes),
    await f.planner().readCachedFallbacks(f.project, f.scenes)]) {
    assert.deepEqual(result.get('scene-0')!.aiSearchPlan, repaired.get('scene-0')!.aiSearchPlan);
  }
  assert.equal(f.calls.length, 2, 'one original primary and one separate fallback completion');
  assert.equal((await f.files()).length, 1);
  assert.deepEqual(await readFile(primaryFile), originalBytes);
  assert.deepEqual(await readFile(fallbackFile), fallbackBytes);
});

for (const revision of [2, 3, 4]) test(`an unchanged reserve reuses a matching completed revision ${revision} answer`, async t => {
  const f = await fixture(t), [scene] = f.scenes;
  const planned = await f.planner().planFallbacks(f.project, f.scenes);
  const requirement = planned.get(scene!.id)!, reserve = requirement.aiSearchPlan!;
  scene!.documentary!.requirement = { ...requirement, footageFallback: {
    version: 1, target: reserve.fallbackVisualTarget, queries: reserve.fallbackVideoQueries,
    reason: 'Fixture recovery', originalTarget: reserve.visualTarget, narration: scene!.narration,
    automaticRecovery: { version: 1, binding: 'fixture', startedAt: 'now', blockedSourceKeys: [] },
  } };
  const [sidecar] = await f.files();
  if (revision < 4) {
    const cache = JSON.parse(await readFile(sidecar!, 'utf8'));
    cache.plans = {};
    const request = cache.attempts[0].request;
    const firstNewRule = revision === 2 ? ' In subject-illustration and thematic modes, a causal, supply, or functional relationship'
      : ' In subject-illustration and thematic modes, each photo, video, or reserve query';
    request.system = request.system.split(firstNewRule)[0];
    request.promptRevision = revision;
    await writeFile(sidecar!, JSON.stringify(cache));
  }
  const retained = await readFile(sidecar!, 'utf8');
  const confirmations: string[][] = [];
  const options = { reviseLegacyReserve: true, onReserveUnchanged: (ids: string[]) => confirmations.push(ids) };
  assert.equal((await f.planner().planFallbacks(f.project, f.scenes, options)).size, 0);
  assert.deepEqual(confirmations, [[scene!.id]]);
  assert.equal(await readFile(sidecar!, 'utf8'), retained);

  await rm(sidecar!);
  assert.equal((await f.planner().planFallbacks(f.project, f.scenes, options)).size, 0);
  assert.deepEqual(confirmations, [[scene!.id], []]);
  assert.deepEqual(await f.files(), []);
  assert.equal(f.fallbackCalls().length, 1);
});

test('initial reserve is revised once after failed discovery instead of being mistaken for a completed feedback plan', async t => {
  const f = await fixture(t, 3);
  Object.assign(f.scenes[0]!.documentary!.requirement.aiSearchPlan!, {
    fallbackVisualTarget: 'aircraft fabric wing repair', fallbackVideoQueries: ['aircraft fabric wing repair'] });
  Object.assign(f.scenes[1]!.documentary!.requirement.aiSearchPlan!, {
    fallbackVisualTarget: 'steam train moving', fallbackVideoQueries: ['steam train moving'] });
  Object.assign(f.scenes[2]!.documentary!.requirement.aiSearchPlan!, { fallbackVisualTarget: '', fallbackVideoQueries: [] });
  const result = await f.planner().planFallbacks(f.project, f.scenes);
  assert.equal(result.size, 3);
  assert.equal(f.fallbackCalls().length, 1);
  for (const scene of f.scenes) assert.deepEqual(result.get(scene.id)!.aiSearchPlan!.fallbackVideoQueries, generic(scene.id).fallbackVideoQueries);
  await f.planner().planFallbacks(f.project, f.scenes);
  assert.equal(f.fallbackCalls().length, 1, 'A completed feedback plan survives resume without another payment');
});

test('an uncertain batch does not prevent planning unrelated unsent scenes and is not replayed on resume', async t => {
  const f=await fixture(t,24,async call=>{
    if(call.data.requestedScenes.some(scene=>scene.sceneId==='scene-0'))throw new AnyModelCompletionUncertainError('Closed after a heartbeat');
    return answer(call.data.requestedScenes.map(scene=>generic(scene.sceneId)));
  });
  await assert.rejects(f.planner().planFallbacks(f.project,f.scenes),/автоматически не повторяется/);
  const cached=await f.planner().readCachedFallbacks(f.project,f.scenes);
  assert.equal(cached.size,16,'Both unrelated batches finish despite the first failed response');
  assert.ok(cached.has('scene-23'));
  assert.equal(f.fallbackCalls().length,3);
  await assert.rejects(f.planner().planFallbacks(f.project,f.scenes),/автоматического платного повтора нет/);
  assert.equal(f.fallbackCalls().length,3);
});

test('uncertain streamed fallback preserves complete scene objects and never resubmits missing scenes across restart', async t => {
  const f = await fixture(t, 2, async (_call, partial) => {
    const text = `{"scenes":[${JSON.stringify(generic('scene-0'))},`;
    partial?.(text);
    throw new AnyModelCompletionUncertainError('Disconnected', text);
  });
  await assert.rejects(f.planner().planFallbacks(f.project, f.scenes), /автоматически не повторяется/);
  const file = (await f.files())[0]!, bytes = await readFile(file);
  const cached = await f.planner().readCachedFallbacks(f.project, f.scenes);
  assert.deepEqual([...cached.keys()], ['scene-0']);
  assert.deepEqual(cached.get('scene-0')!.aiSearchPlan!.fallbackVideoQueries, generic('scene-0').fallbackVideoQueries);
  await assert.rejects(f.planner().planFallbacks(f.project, f.scenes), /автоматического платного повтора нет/);
  assert.equal(f.fallbackCalls().length, 1);
  assert.deepEqual(await readFile(file), bytes);
});

test('pending fallback marker after interruption blocks a new paid submission', async t => {
  const f = await fixture(t);
  await f.planner().planFallbacks(f.project, f.scenes);
  const file = (await f.files())[0]!, cache = JSON.parse(await readFile(file, 'utf8'));
  cache.plans = {};
  cache.attempts[0].status = 'pending';
  await writeFile(file, JSON.stringify(cache));
  await assert.rejects(f.planner().planFallbacks(f.project, f.scenes), /автоматического платного повтора нет/);
  assert.equal(f.fallbackCalls().length, 1);
});

test('completed invalid reserve repairs only the invalid scene, with a durable maximum of two attempts', async t => {
  const f = await fixture(t, 2, async call => answer(call.data.requestedScenes.map(scene =>
    scene.sceneId === 'scene-0' ? generic(scene.sceneId) : { ...generic(scene.sceneId), fallbackVideoQueries: ['one two three four five six seven'] })));
  await assert.rejects(f.planner().planFallbacks(f.project, f.scenes), /исчерпаны/);
  await assert.rejects(f.planner().planFallbacks(f.project, f.scenes), /исчерпаны/);
  assert.equal(f.fallbackCalls().length, 2);
  assert.deepEqual(f.fallbackCalls()[1]!.data.requestedScenes.map(scene => scene.sceneId), ['scene-1']);
  assert.deepEqual([...(await f.planner().readCachedFallbacks(f.project, f.scenes)).keys()], ['scene-0']);
  const cache = JSON.parse(await readFile((await f.files())[0]!, 'utf8'));
  assert.ok(cache.attempts.every((attempt: { status: string; responseState: string }) =>
    attempt.status === 'invalid' && attempt.responseState === 'complete'));
});

test('only confirmed terminal format error permits a fallback repair; valid query remains the exact model output', async t => {
  let first = true;
  const f = await fixture(t, 1, async call => {
    if (first) { first = false; throw new AnyModelOutputFormatError('finish_reason:length', true); }
    return answer(call.data.requestedScenes.map(scene => generic(scene.sceneId)));
  });
  const result = await f.planner().planFallbacks(f.project, f.scenes);
  assert.equal(f.fallbackCalls().length, 2);
  assert.deepEqual(result.get('scene-0')!.aiSearchPlan!.fallbackVideoQueries, ['motorcycle racing on track', 'motorcycle riders']);
});

test('malformed query lengths and non-English phrases never enter the reserve', async t => {
  for (const invalid of ['motorcycle', 'one two three four five six seven', 'гонки мотоциклов', 'x'.repeat(101)]) {
    const f = await fixture(t, 1, async () => answer([{ ...generic('scene-0'), fallbackVideoQueries: [invalid] }]));
    await assert.rejects(f.planner().planFallbacks(f.project, f.scenes), /исчерпаны/, invalid);
    assert.equal(f.fallbackCalls().length, 2, invalid);
    assert.equal((await f.planner().readCachedFallbacks(f.project, f.scenes)).size, 0, invalid);
  }
});

test('ordinary capitalized narration words do not reject an AI-authored query',async t=>{
  const f=await fixture(t,1,async()=>answer([{sceneId:'scene-0',fallbackVisualTarget:'Sailing ship on the ocean',fallbackVideoQueries:['sailing ship ocean','ship sails wind']}]),'Sailing ships cross an ocean. ');
  const result=await f.planner().planFallbacks(f.project,f.scenes);
  assert.equal(f.fallbackCalls().length,1);
  assert.deepEqual(result.get('scene-0')!.aiSearchPlan!.fallbackVideoQueries,['sailing ship ocean','ship sails wind']);
});

test('empty fallback response is honest and cached; a changed primary gets a distinct bound receipt', async t => {
  const f = await fixture(t, 1, async call => answer(call.data.requestedScenes.map(scene => ({ sceneId: scene.sceneId,
    fallbackVisualTarget: '', fallbackVideoQueries: [] }))));
  const result = await f.planner().planFallbacks(f.project, f.scenes);
  assert.deepEqual(result.get('scene-0')!.aiSearchPlan!.fallbackVideoQueries, []);
  f.scenes[0]!.documentary!.requirement.aiSearchPlan!.visualTarget += ' motorcycle engine';
  await f.planner().planFallbacks(f.project, f.scenes);
  assert.equal(f.fallbackCalls().length, 2);
  assert.equal((await f.files()).length, 2);
});

test('concurrent fallback planner instances share the existing project lock', async t => {
  const f = await fixture(t);
  const results = await Promise.all([f.planner().planFallbacks(f.project, f.scenes), f.planner().planFallbacks(f.project, f.scenes)]);
  assert.equal(f.fallbackCalls().length, 1);
  assert.equal(results[0].size, 1);
  assert.deepEqual(results[0], results[1]);
});

test('terminal invalid fallback does not block an independent never-attempted scene; reports incomplete after finishing it', async t => {
  const f = await fixture(t, 9, async call => answer(call.data.requestedScenes.map(scene => scene.sceneId === 'scene-0'
    ? { ...generic(scene.sceneId), fallbackVideoQueries: ['one two three four five six seven'] } : generic(scene.sceneId))));
  await assert.rejects(f.planner().planFallbacks(f.project, f.scenes.slice(0, 8)), /исчерпаны/);
  assert.equal(f.fallbackCalls().length, 2);
  await assert.rejects(f.planner().planFallbacks(f.project, f.scenes), /исчерпаны/);
  assert.equal(f.fallbackCalls().length, 3);
  assert.deepEqual(f.fallbackCalls()[2]!.data.requestedScenes.map(scene => scene.sceneId), ['scene-8']);
  const cached = await f.planner().readCachedFallbacks(f.project, f.scenes);
  assert.equal(cached.size, 8);
  assert.ok(cached.has('scene-8'));
  assert.ok(!cached.has('scene-0'));
  await assert.rejects(f.planner().planFallbacks(f.project, f.scenes), /исчерпаны/);
  assert.equal(f.fallbackCalls().length, 3);
});

test('old completed invalid MotoGP category and ordinary mechanism answers reuse raw with zero POST and unchanged receipt SHA', async t => {
  const f = await fixture(t, 2);
  await f.planner().planFallbacks(f.project, f.scenes);
  const file = (await f.files())[0]!, cache = JSON.parse(await readFile(file, 'utf8'));
  const oldEntries = [
    { sceneId: 'scene-0', fallbackVisualTarget: 'MotoGP team garage', fallbackVideoQueries: ['MotoGP team garage'] },
    { sceneId: 'scene-1', fallbackVisualTarget: 'engine crankshaft mechanism', fallbackVideoQueries: ['engine crankshaft mechanism'] },
  ];
  cache.plans = {};
  cache.attempts[0].status = 'invalid';
  cache.attempts[0].rawResponse = answer(oldEntries);
  await writeFile(file, JSON.stringify(cache));
  const sha = async () => createHash('sha256').update(await readFile(file)).digest('hex');
  const originalSha = await sha(), beforePosts = f.fallbackCalls().length;
  for (const plans of [await f.planner().readCachedFallbacks(f.project, f.scenes), await f.planner().planFallbacks(f.project, f.scenes)]) {
    assert.equal(plans.size, 2);
    for (const entry of oldEntries) assert.deepEqual(plans.get(entry.sceneId)!.aiSearchPlan!.fallbackVideoQueries, entry.fallbackVideoQueries);
  }
  assert.equal(f.fallbackCalls().length, beforePosts);
  assert.equal(await sha(), originalSha);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).attempts[0].status, 'invalid');
});

test('unknown or partial raw fallback is never locally promoted or submitted again', async t => {
  for (const [status, responseState] of [['pending', 'complete'], ['uncertain', 'complete'], ['invalid', 'partial']]) {
    const f = await fixture(t);
    await f.planner().planFallbacks(f.project, f.scenes);
    const file = (await f.files())[0]!, cache = JSON.parse(await readFile(file, 'utf8'));
    cache.plans = {};
    Object.assign(cache.attempts[0], { status, responseState, rawResponse: answer([{
      sceneId: 'scene-0', fallbackVisualTarget: 'MotoGP team garage', fallbackVideoQueries: ['MotoGP team garage'],
    }]) });
    await writeFile(file, JSON.stringify(cache));
    assert.equal((await f.planner().readCachedFallbacks(f.project, f.scenes)).size, 0);
    await assert.rejects(f.planner().planFallbacks(f.project, f.scenes), /автоматического платного повтора нет/);
    assert.equal(f.fallbackCalls().length, 1);
    assert.equal((await f.planner().readCachedFallbacks(f.project, f.scenes)).size, 0);
  }
});

test('raw fallback recovery requires exact prompt, revision, context, requested ids, narration and immutable original plan', async t => {
  const f = await fixture(t);
  await f.planner().planFallbacks(f.project, f.scenes);
  const file = (await f.files())[0]!, original = JSON.parse(await readFile(file, 'utf8'));
  original.plans = {};
  original.attempts[0].status = 'invalid';
  type MutableReceipt = typeof original;
  const mutations: Array<(cache: MutableReceipt) => void> = [
    cache => { cache.attempts[0].request.system += ' changed'; },
    cache => { cache.attempts[0].request.promptRevision = 1; },
    cache => { cache.attempts[0].ids = ['other']; },
    cache => { cache.attempts[0].rawResponse = answer([generic('scene-0'), generic('scene-0')]); },
    ...['purpose', 'inputHash', 'originalScript', 'narration', 'originalSearchPlan'].map(field => (cache: MutableReceipt) => {
      const payload = JSON.parse(cache.attempts[0].request.payload);
      if (field === 'narration') payload.requestedScenes[0].narration += ' changed';
      else if (field === 'originalSearchPlan') payload.requestedScenes[0].originalSearchPlan.fallbackVisualTarget += ' changed';
      else payload[field] += ' changed';
      cache.attempts[0].request.payload = JSON.stringify(payload);
    }),
  ];
  for (const mutate of mutations) {
    const cache = structuredClone(original);
    mutate(cache);
    const bytes = JSON.stringify(cache);
    await writeFile(file, bytes);
    assert.equal((await f.planner().readCachedFallbacks(f.project, f.scenes)).size, 0);
    assert.equal(await readFile(file, 'utf8'), bytes);
  }
  assert.equal(f.fallbackCalls().length, 1);
});
