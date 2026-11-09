import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Project, Scene } from '@gold-work/shared';
import { AnyModelCompletionUncertainError, type AnyModelClient } from './anymodel-client.js';
import { DocumentaryAiQueryPlanner } from './documentary-ai-query-planner.js';

type Call = { system: string; data: { purpose?: string; inputHash?: string; originalScript: string;
  currentPlans?: Record<string, unknown>; allowedSavedAiGenericQueries?: string[];
  requestedScenes: Array<{ sceneId: string; narration: string; originalSearchPlan?: unknown }> } };
const TOPIC = 'search-topic-broll-plan';
const answer = (entries: unknown[]) => JSON.stringify({ scenes: entries });
const primary = (sceneId: string) => ({ sceneId, subject: 'Rossi Honda RC211V', years: ['2003'],
  visualTarget: 'Rossi Honda RC211V garage in 2003', preferredKind: 'video', visualScope: 'exact',reservePolicy:'thematic',
  imageQueries: ['Rossi Honda RC211V 2003'], videoQueries: ['Rossi Honda garage 2003'],
  fallbackVisualTarget: 'Honda garage mechanics 2003', fallbackVideoQueries: ['Honda garage mechanics 2003'] });
const reserve = (sceneId: string) => ({ sceneId, fallbackVisualTarget: 'motorcycle mechanics in garage',
  fallbackVideoQueries: ['motorcycle mechanic garage', 'motorcycle workshop repair'] });
const topic = (sceneId: string) => ({ sceneId, fallbackVisualTarget: 'motorcycles riding on track',
  fallbackVideoQueries: ['motorcycle racing', 'motorcycle riding on track'] });

async function fixture(t: { after: (fn: () => Promise<void>) => void }, count = 1,
  handler: (call: Call) => Promise<string> = async call => answer(call.data.requestedScenes.map(scene =>
    call.data.purpose === TOPIC ? topic(scene.sceneId) : reserve(scene.sceneId)))) {
  const root = path.resolve(await mkdtemp(path.join(os.tmpdir(), 'gws-topic-plan-')));
  assert.ok(root.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(root).startsWith('gws-topic-plan-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  const calls: Call[] = [];
  const client = { documentaryQueryModel: async () => 'fixture/topic-text-model',
    documentaryCompletion: async (system: string, text: string, images: string[]) => {
      assert.deepEqual(images, []);
      const call = { system, data: JSON.parse(text) as Call['data'] };
      calls.push(call);
      return call.data.purpose ? handler(call) : answer(call.data.requestedScenes.map(scene => primary(scene.sceneId)));
    } } as unknown as AnyModelClient;
  const planner = () => new DocumentaryAiQueryPlanner(client, () => root);
  const scenes = Array.from({ length: count }, (_, order) => ({ id: `scene-${order}`, order,
    narration: `Rossi Honda RC211V engineering in 2003. Original narration ${order}.`,
    audioPath: `manual-voice-${order}.mp3`, imagePath: `manual-material-${order}.jpg` } as unknown as Scene));
  const project = { id: 'topic-fixture', title: 'Fixture', topic: 'Motorcycle engineering', language: 'ru', scenes,
    videoBrief: { readyScript: `ENTIRE ORIGINAL SCRIPT\n${scenes.map(scene => scene.narration).join('\n')}` } } as Project;
  const planned = await planner().plan(project, scenes);
  for (const scene of scenes) scene.documentary = { version: 2, verified: false, pinned: false,
    requirement: { ...planned.get(scene.id)!, caption: 'Manual caption' }, selected: { id: `material-${scene.id}` },
    visualReview: { status: 'rejected' } } as Scene['documentary'];
  const file = async (namespace: string) => path.join(root, namespace, (await readdir(path.join(root, namespace)))
    .find(name => name.endsWith('.json'))!);
  return { root, calls, scenes, project, planner, file, topicCalls: () => calls.filter(call => call.data.purpose === TOPIC) };
}

test('topic API has a separate purpose/namespace/revision, complete source and saved AI queries; preserves primary, audio and materials', async t => {
  const f = await fixture(t, 5);
  f.scenes[1]!.documentary!.verified = true;
  Object.assign(f.scenes[1]!.documentary!.requirement.aiSearchPlan!, reserve('scene-1'));
  f.scenes[2]!.documentary!.pinned = true;
  f.scenes[3]!.documentary!.visualReview!.status = 'accepted';
  delete f.scenes[4]!.documentary!.requirement.aiSearchPlan;
  const snapshot = structuredClone(f.project), original = structuredClone(f.scenes[0]!.documentary!.requirement);
  const result = await f.planner().planTopicFallbacks(f.project, f.scenes);
  assert.deepEqual([...result.keys()], ['scene-0']);
  assert.deepEqual(result.get('scene-0'), { ...original, aiSearchPlan: { ...original.aiSearchPlan!,
    fallbackVisualTarget: topic('scene-0').fallbackVisualTarget, fallbackVideoQueries: topic('scene-0').fallbackVideoQueries } });
  assert.deepEqual(f.project, snapshot);
  const call = f.topicCalls()[0]!;
  assert.equal(call.data.originalScript, f.project.videoBrief!.readyScript);
  assert.deepEqual(call.data.requestedScenes.map(scene => scene.sceneId), ['scene-0']);
  assert.deepEqual(call.data.requestedScenes[0]!.originalSearchPlan, original.aiSearchPlan);
  assert.deepEqual(call.data.currentPlans!['scene-0'], original.aiSearchPlan);
  assert.deepEqual(call.data.allowedSavedAiGenericQueries, [...primary('scene-0').fallbackVideoQueries,...reserve('scene-1').fallbackVideoQueries]);
  assert.match(call.system, /Broaden failed staging or unavailable detail without losing the subject of the scene/);
  assert.match(call.system, /keep the meaningful object class and setting explicit in both its target and queries/);
  const cache = JSON.parse(await readFile(await f.file('documentary-ai-topic-broll-plans'), 'utf8'));
  assert.equal(cache.purpose, TOPIC);
  assert.equal(cache.attempts[0].request.promptRevision, 4);
  assert.equal(cache.attempts[0].request.system, call.system);
  assert.equal(result.get('scene-0')!.aiSearchPlan!.inputHash, original.aiSearchPlan!.inputHash);
});

test('topic cache overlays older reserve with priority on normal plan/readCached, stays stable and never POSTs or rewrites old receipts', async t => {
  const f = await fixture(t);
  f.scenes[0]!.documentary!.requirement = (await f.planner().planFallbacks(f.project, f.scenes)).get('scene-0')!;
  const primaryFile = await f.file('documentary-ai-query-plans'), fallbackFile = await f.file('documentary-ai-fallback-plans');
  const beforePrimary = await readFile(primaryFile), beforeFallback = await readFile(fallbackFile);
  const repaired = await f.planner().planTopicFallbacks(f.project, f.scenes);
  f.scenes[0]!.documentary!.requirement = repaired.get('scene-0')!;
  const topicFile = await f.file('documentary-ai-topic-broll-plans'), beforeTopic = await readFile(topicFile);
  for (const result of [await f.planner().readCachedTopicFallbacks(f.project, f.scenes),
    await f.planner().planTopicFallbacks(f.project, f.scenes), await f.planner().plan(f.project, f.scenes),
    await f.planner().readCached(f.project, f.scenes)]) {
    assert.deepEqual(result.get('scene-0')!.aiSearchPlan, repaired.get('scene-0')!.aiSearchPlan);
  }
  assert.equal(f.calls.length, 3, 'one primary, one old reserve, one explicit topic stage');
  assert.deepEqual(await readFile(primaryFile), beforePrimary);
  assert.deepEqual(await readFile(fallbackFile), beforeFallback);
  assert.deepEqual(await readFile(topicFile), beforeTopic);
});

test('old invalid and unknown fallback receipts remain byte-identical and are never replayed by the separate topic stage', async t => {
  for (const unknown of [false, true]) {
    const f = await fixture(t, 1, async call => {
      if (call.data.purpose === TOPIC) return answer(call.data.requestedScenes.map(scene => topic(scene.sceneId)));
      if (unknown) throw new AnyModelCompletionUncertainError('Disconnected', 'unfinished');
      return answer(call.data.requestedScenes.map(scene => ({ ...reserve(scene.sceneId), fallbackVideoQueries: ['Honda garage mechanics working together during the entire 2003 season'] })));
    });
    await assert.rejects(f.planner().planFallbacks(f.project, f.scenes), unknown ? /автоматически не повторяется/ : /исчерпаны/);
    const oldFile = await f.file('documentary-ai-fallback-plans'), before = await readFile(oldFile);
    const oldCalls = f.calls.filter(call => call.data.purpose === 'search-fallback-plan-v2').length;
    assert.equal((await f.planner().planTopicFallbacks(f.project, f.scenes)).size, 1);
    assert.equal((await f.planner().readCached(f.project, f.scenes)).size, 1);
    assert.deepEqual(await readFile(oldFile), before);
    assert.equal(f.calls.filter(call => call.data.purpose === 'search-fallback-plan-v2').length, oldCalls);
    assert.equal(f.topicCalls().length, 1);
  }
});

test('an unknown topic request blocks a second POST across planner restart', async t => {
  const f = await fixture(t, 1, async () => { throw new AnyModelCompletionUncertainError('Topic disconnected', 'unfinished'); });
  await assert.rejects(f.planner().planTopicFallbacks(f.project, f.scenes), /автоматически не повторяется/);
  const file = await f.file('documentary-ai-topic-broll-plans'), before = await readFile(file);
  await assert.rejects(f.planner().planTopicFallbacks(f.project, f.scenes), /автоматического платного повтора нет/);
  assert.equal((await f.planner().readCachedTopicFallbacks(f.project, f.scenes)).size, 0);
  assert.equal(f.topicCalls().length, 1);
  assert.deepEqual(await readFile(file), before);
});

test('topic accepts exactly the AI-authored pair of 2-5 word queries, repairs a settled overlong query and preserves primary fields', async t => {
  let requests = 0;
  const f = await fixture(t, 1, async call => {
    requests++;
    return answer(call.data.requestedScenes.map(scene => requests === 1 ? { ...topic(scene.sceneId),
      fallbackVideoQueries: ['motorcycle racing moving around the track', 'motorcycle riding'] } : topic(scene.sceneId)));
  });
  const original = structuredClone(f.scenes[0]!.documentary!.requirement.aiSearchPlan!);
  const result = await f.planner().planTopicFallbacks(f.project, f.scenes);
  assert.equal(f.topicCalls().length, 2);
  assert.deepEqual(result.get('scene-0')!.aiSearchPlan, { ...original,
    fallbackVisualTarget: 'motorcycles riding on track', fallbackVideoQueries: ['motorcycle racing', 'motorcycle riding on track'] });
});

test('topic API requires an unchanged ready script and does not silently repeat the same failed target/query pair', async t => {
  const f = await fixture(t, 1, async call => answer(call.data.requestedScenes.map(scene => reserve(scene.sceneId))));
  Object.assign(f.scenes[0]!.documentary!.requirement.aiSearchPlan!, reserve('scene-0'));
  await assert.rejects(f.planner().planTopicFallbacks(f.project, f.scenes), /исчерпаны/);
  assert.equal(f.topicCalls().length, 2);
  f.project.videoBrief!.readyScript = '';
  assert.equal((await f.planner().planTopicFallbacks(f.project, f.scenes)).size, 0);
  assert.equal((await f.planner().readCachedTopicFallbacks(f.project, f.scenes)).size, 0);
  assert.equal(f.topicCalls().length, 2);
});
