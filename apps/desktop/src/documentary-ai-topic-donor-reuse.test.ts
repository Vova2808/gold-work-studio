import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Project, Scene } from '@gold-work/shared';
import { AnyModelCompletionUncertainError, type AnyModelClient } from './anymodel-client.js';
import { DocumentaryAiQueryPlanner } from './documentary-ai-query-planner.js';

const generic = { fallbackVisualTarget: 'motorcycle racing on track', fallbackVideoQueries: ['motorcycle racing'] };
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = path.resolve(await mkdtemp(path.join(os.tmpdir(), 'gws-topic-donor-')));
  assert.ok(root.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(root).startsWith('gws-topic-donor-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  const calls: string[] = [];
  const scenes = ['Honda motorcycle engineering in 2003.', 'Motorcycle racing on a track.', 'Mechanics work on a motorcycle.']
    .map((narration, order) => ({ id: `scene-${order}`, order, narration, audioPath: `original-voice-${order}.mp3` } as Scene));
  const project = { id: 'donor-fixture', title: 'Fixture', topic: 'Motorcycle engineering', language: 'en', scenes,
    videoBrief: { readyScript: scenes.map(scene => scene.narration).join('\n') } } as Project;
  const client = { documentaryQueryModel: async () => 'fixture/text', documentaryCompletion: async (_system: string, payload: string) => {
    const input = JSON.parse(payload); calls.push(input.purpose ?? 'primary');
    if (input.purpose) throw new AnyModelCompletionUncertainError('socket hangup', '');
    return JSON.stringify({ scenes: input.requestedScenes.map((scene: { sceneId: string }) => ({ sceneId: scene.sceneId,
      subject: 'Honda racing motorcycle', visualTarget: 'Honda motorcycle engineering 2003', years: ['2003'],
      visualScope: 'exact', preferredKind: 'video', reservePolicy:'thematic', imageQueries: ['Honda motorcycle 2003'], videoQueries: ['Honda motorcycle engine 2003'],
      ...(scene.sceneId === 'scene-1' ? generic : scene.sceneId === 'scene-2'
        ? { fallbackVisualTarget: 'mechanics working on motorcycle', fallbackVideoQueries: ['motorcycle mechanic'] }
        : { fallbackVisualTarget: 'Honda garage in 2003', fallbackVideoQueries: ['Honda garage 2003'] }) })) });
  } } as unknown as AnyModelClient;
  const planner = () => new DocumentaryAiQueryPlanner(client, () => root);
  const planned = await planner().plan(project, scenes);
  for (const scene of scenes) {
    const donor = scene.id !== 'scene-0', requirement = planned.get(scene.id)!;
    const ai = requirement.aiSearchPlan!;
    if (donor) requirement.footageFallback = { version: 1, target: ai.fallbackVisualTarget,
      queries: [...ai.fallbackVideoQueries], originalTarget: ai.visualTarget, reason: 'Literal discovery failed' };
    scene.documentary = { version: 2, requirement, verified: donor, pinned: false, checksum: donor ? `sha-${scene.id}` : undefined,
      selected: donor ? { provider: 'local', kind: 'video', query: ai.fallbackVideoQueries[0],
        pageUrl: 'https://www.pexels.com/video/fixture/', downloadUrl: 'https://videos.pexels.com/fixture.mp4' } : undefined,
      visualReview: { status: donor ? 'accepted' : 'rejected', fastRelevance: { version: 1, relevant: donor,
        target: ai.fallbackVisualTarget, evidence: 'Mock video pixels contain the target' } } } as Scene['documentary'];
    if (donor) scene.videoPath = path.join(root, `${scene.id}.mp4`);
  }
  const file = async (namespace: string) => path.join(root, namespace, (await readdir(path.join(root, namespace))).find(name => name.endsWith('.json'))!);
  return { root, project, scenes, planner, calls, file, recipient: scenes[0]!, donor: scenes[1]!, detailDonor: scenes[2]! };
}

test('unknown topic reuses a whole accepted AI donor without POST on resume; preserves primary, audio and unknown receipt', async t => {
  const f = await fixture(t), snapshot = structuredClone(f.project);
  const original = structuredClone(f.recipient.documentary!.requirement);
  const first = await f.planner().planTopicFallbacks(f.project, [f.recipient]);
  assert.deepEqual(first.get(f.recipient.id), { ...original, aiSearchPlan: { ...original.aiSearchPlan!, ...generic } });
  assert.deepEqual(f.project, snapshot);
  const topicFile = await f.file('documentary-ai-topic-broll-plans'), bytes = await readFile(topicFile);
  assert.equal(JSON.parse(bytes.toString()).attempts[0].status, 'uncertain');
  assert.deepEqual(JSON.parse(bytes.toString()).plans, {});
  for (const result of [await f.planner().readCachedTopicFallbacks(f.project, [f.recipient]),
    await f.planner().planTopicFallbacks(f.project, [f.recipient])]) assert.deepEqual(result, first);
  assert.deepEqual(await readFile(topicFile), bytes);
  assert.deepEqual(f.calls, ['primary', 'search-topic-broll-plan']);
  assert.equal(f.recipient.documentary!.verified, false);
});

test('normal cached planning keeps the same copied donor reserve with stable overlay and unchanged primary/topic receipts', async t => {
  const f = await fixture(t);
  const reused = await f.planner().planTopicFallbacks(f.project, [f.recipient]);
  f.recipient.documentary!.requirement = reused.get(f.recipient.id)!;
  const files = [await f.file('documentary-ai-query-plans'), await f.file('documentary-ai-topic-broll-plans')];
  const bytes = await Promise.all(files.map(file => readFile(file)));
  for (const result of [await f.planner().plan(f.project, [f.recipient]), await f.planner().readCached(f.project, [f.recipient])]) {
    assert.deepEqual(result.get(f.recipient.id)!.aiSearchPlan, reused.get(f.recipient.id)!.aiSearchPlan);
  }
  assert.deepEqual(await Promise.all(files.map(file => readFile(file))), bytes);
  assert.deepEqual(f.calls, ['primary', 'search-topic-broll-plan']);
});

test('manual, local-primary, legacy, mismatched, incompatible and invalid donors leave an honest unknown and never repeat POST', async t => {
  const mutations: Array<(f: Awaited<ReturnType<typeof fixture>>) => void> = [
    f => { f.donor.documentary!.pinned = true; },
    f => { delete f.donor.documentary!.requirement.footageFallback; },
    f => { delete f.donor.documentary!.requirement.aiSearchPlan; },
    f => { f.donor.documentary!.requirement.plannedBy = 'local' as never; },
    f => { f.donor.documentary!.visualReview!.fastRelevance!.target = 'other target'; },
    f => { f.donor.documentary!.selected!.query = 'manual local query'; },
    f => { f.donor.documentary!.selected!.pageUrl = 'file:///manual.mp4'; f.donor.documentary!.selected!.downloadUrl = ''; },
    f => { delete f.donor.documentary!.checksum; },
    f => { f.recipient.narration = 'An aircraft airplane is flying.'; },
    f => { f.donor.documentary!.requirement.aiSearchPlan!.fallbackVideoQueries = ['Honda motorcycle 2003']; },
  ];
  for (const mutate of mutations) {
    const f = await fixture(t);
    f.detailDonor.documentary!.pinned = true;
    mutate(f);
    await assert.rejects(f.planner().planTopicFallbacks(f.project, [f.recipient]), /автоматически не повторяется/);
    const topicFile = await f.file('documentary-ai-topic-broll-plans'), bytes = await readFile(topicFile);
    assert.equal((await f.planner().readCachedTopicFallbacks(f.project, [f.recipient])).size, 0);
    await assert.rejects(f.planner().planTopicFallbacks(f.project, [f.recipient]), /автоматического платного повтора нет/);
    assert.deepEqual(await readFile(topicFile), bytes);
    assert.equal(f.calls.filter(purpose => purpose === 'search-topic-broll-plan').length, 1);
  }
});

test('a valid bound donor entry in a settled invalid batch is reusable; partial/unknown raw or duplicate invalid entry is not provenance', async t => {
  for (const state of ['settled-invalid', 'partial', 'uncertain', 'invalid-entry', 'unbound-entry']) {
    const f = await fixture(t);
    f.detailDonor.documentary!.pinned = true;
    const primaryFile = await f.file('documentary-ai-query-plans'), cache = JSON.parse(await readFile(primaryFile, 'utf8'));
    cache.attempts[0].status = state === 'uncertain' ? 'uncertain' : 'invalid';
    cache.attempts[0].responseState = state === 'partial' ? 'partial' : 'complete';
    if (state === 'invalid-entry') {
      const raw = JSON.parse(cache.attempts[0].rawResponse);
      raw.scenes.push(raw.scenes.find((entry: { sceneId: string }) => entry.sceneId === f.donor.id));
      cache.attempts[0].rawResponse = JSON.stringify(raw);
    }
    if (state === 'unbound-entry') {
      const payload = JSON.parse(cache.attempts[0].request.payload);
      payload.requestedScenes.find((entry: { sceneId: string }) => entry.sceneId === f.donor.id).narration += ' changed';
      cache.attempts[0].request.payload = JSON.stringify(payload);
    }
    await writeFile(primaryFile, JSON.stringify(cache));
    if (state === 'settled-invalid') {
      const result = await f.planner().planTopicFallbacks(f.project, [f.recipient]);
      assert.deepEqual(result.get(f.recipient.id)!.aiSearchPlan!.fallbackVideoQueries, generic.fallbackVideoQueries);
    } else {
      await assert.rejects(f.planner().planTopicFallbacks(f.project, [f.recipient]), /автоматически не повторяется/);
      assert.equal((await f.planner().readCachedTopicFallbacks(f.project, [f.recipient])).size, 0);
    }
    assert.equal(f.calls.filter(purpose => purpose === 'search-topic-broll-plan').length, 1);
  }
});
