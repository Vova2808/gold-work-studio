import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MockDirectorProvider, ProjectService, normalizeProject} from '@gold-work/core';
import {channelMediaMode, documentaryAiPlanContext, type DocumentaryAiSearchPlan} from '@gold-work/shared';
import {FileProjectRepository} from './file-project-repository.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {currentDocumentaryAiSearchPlan} from './documentary-ai-plan-state.js';
import {planFastDocumentaryScene} from './documentary-fast-plan.js';

test('saved search plans survive disk roundtrip and feed distinct photo/video searches without touching media', async t => {
  const root = await mkdtemp(join(tmpdir(), 'gws-scene-editor-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const service = new ProjectService(new FileProjectRepository(join(root, 'projects.json')), new MockDirectorProvider());
  let project = await service.create({title: 'Railway', topic: 'Railway', language: 'English', aspectRatio: '16:9', mode: 'standard', mediaMode: 'stock'});
  project.scenes = [{id: 'scene-one', order: 0, title: 'Train', narration: 'A train crosses a bridge.',
    imagePrompt: 'Generation prompt must never become a search', animationPrompt: 'Camera moves', durationSeconds: 5,
    status: 'ready', audioPath: 'saved-voice.mp3', imagePath: 'saved-image.jpg', videoPath: 'saved-video.mp4'}];
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const model = 'saved-model';
  const inputHash = hash({version: 1, model, context: documentaryAiPlanContext(project)});
  const aiSearchPlan: DocumentaryAiSearchPlan = {version: 1, model, inputHash: hash({inputHash, sceneId: 'scene-one'}),
    subject: 'train', years: [], visualTarget: 'train crossing a bridge', visualScope: 'illustrative', preferredKind: 'video',
    imageQueries: ['railway bridge photograph'], videoQueries: ['train crossing bridge film'],
    fallbackVideoQueries: ['train moving'], fallbackVisualTarget: 'train in motion'};
  project.scenes[0]!.documentary = {version: 2, candidates: [], effects: [], reviewNote: '', illustrative: false, requirement: {text: project.scenes[0]!.narration, entities: [], years: [],
    queries: [...aiSearchPlan.videoQueries, ...aiSearchPlan.imageQueries], aiSearchPlan},
    caption: {text: '', enabled: false, position: 'bottom', animation: 'fade', fontSize: 32, color: '#ffffff', backgroundColor: '#000000', opacity: 1},
    layout: 'full', verified: true, pinned: true, selected: {id: 'selected-material', kind: 'video', provider: 'local', title: 'Manual material',
      description: '', pageUrl: '', downloadUrl: '', author: '', license: '', licenseUrl: '', rights: 'user-confirmed', attribution: '',
      query: '', retrievedAt: '2026-10-18T00:00:00Z', match: 'unverified', concerns: []}};
  project = await service.update(project.id, {scenes: project.scenes});
  const storage = new LocalProjectStorage(join(root, 'workspace'));
  const directory = await storage.ensureProject(project);
  const restored = await new ProjectService(new FileProjectRepository(join(root, 'projects.json')), new MockDirectorProvider()).get(project.id);
  assert.ok(restored);
  assert.deepEqual(restored.scenes, project.scenes);
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'project.json'), 'utf8')).scenes, project.scenes);
  const scene = restored.scenes[0]!;
  assert.deepEqual(currentDocumentaryAiSearchPlan(restored, scene), aiSearchPlan);
  assert.deepEqual(planFastDocumentaryScene(restored, scene, 'image').queries, aiSearchPlan.imageQueries);
  assert.deepEqual(planFastDocumentaryScene(restored, scene, 'video').queries, aiSearchPlan.videoQueries);
  assert.equal(normalizeProject({...restored, mediaMode: undefined, settings: {...restored.settings,
    video: {...restored.settings.video, enabled: true}}}).mediaMode, 'stock', 'Documentary settings identify a legacy project');
  assert.equal(normalizeProject({...restored, mediaMode: 'ai'}).mediaMode, 'ai', 'An explicit project mode wins');
  assert.equal(normalizeProject({...restored, mediaMode: 'mixed'}).mediaMode, 'mixed');
  const changed = {...restored, topic: 'Changed context'};
  assert.equal(currentDocumentaryAiSearchPlan(changed, scene), undefined);
  assert.deepEqual(planFastDocumentaryScene(changed, scene, 'video').queries, [], 'Stale plans must not become generated local queries');
  const narration = 'A passenger ship crosses the Atlantic.';
  const legacy = {...scene, narration, documentary: {...scene.documentary!, requirement: {...scene.documentary!.requirement,
    text: narration, aiSearchPlan: undefined, footageFallback: {version: 1 as const, target: 'ship', queries: ['ship sailing'],
      reason: 'legacy reserve', originalTarget: 'named ship'}}}};
  const legacyProject = {...restored, scenes: [legacy]};
  for (const kind of ['image', 'video'] as const) assert.deepEqual(planFastDocumentaryScene(legacyProject, legacy, kind).queries,
    ['passenger ship sailing', 'cruise ship'], 'Legacy stored reserve is an input, not a promise of the effective queries or media kind');
});

test('new channel videos follow the channel direction even when a legacy default disagrees', () => {
  assert.equal(channelMediaMode({direction: 'stock-documentary', defaultMediaMode: 'ai'}), 'stock');
  assert.equal(channelMediaMode({direction: 'ai-story', defaultMediaMode: 'stock'}), 'ai');
});
