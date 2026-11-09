import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockDirectorProvider, ProjectService } from '@gold-work/core';
import type { Project, QueueTask } from '@gold-work/shared';
import { FileProjectRepository } from './file-project-repository.js';
import { prepareDocumentaryScript } from './documentary-plan.js';
import { runDocumentaryWorkflow, reconcileDocumentaryWorkflows, startDocumentaryWorkflowExport } from './documentary-workflow.js';

// Only orchestration/storage evidence. No generated audio, footage or live service is simulated as acceptance.
async function fixture(t: import('node:test').TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'gws-workflow-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const registry = join(root, 'projects.json');
  const open = () => new ProjectService(new FileProjectRepository(registry), new MockDirectorProvider());
  const projects = open();
  let project = await projects.create({ title: 'Workflow fixture', topic: 'Water', mediaMode: 'stock', mode: 'standard', language: 'English', aspectRatio: '16:9',
    videoBrief: { creationMode: 'script', readyScript: '  Water moves through the river.\n\nIt reaches the sea.  ', prompt: 'Water', competitorTranscripts: [] } });
  project = await projects.update(project.id, { settings: { ...project.settings, voice: { ...project.settings.voice, enabled: false } } });
  const prepareScript = async () => projects.mutate(project.id, current => ({ scenes: prepareDocumentaryScript(current), status: 'ready' }));
  const prepareProduction = async () => projects.mutate(project.id, current => ({ scenes: current.scenes.map(scene => ({ ...scene,
    imagePath: join(root, 'fixture.jpg'), documentary: { ...scene.documentary!, verified: true,
      selected: { id: 'fixture', kind: 'image', provider: 'local', rights: 'user-confirmed' } as NonNullable<typeof scene.documentary>['selected'] } })) }));
  const controller = new AbortController();
  const task = (status: QueueTask['status'] = 'pending') => ({ id: 'export', projectId: project.id, runId: 'run', kind: 'assemble', prepareOnly: false,
    status, createdAt: new Date().toISOString(), resultPath: join(root, 'Final.mp4') }) as QueueTask;
  return { root, projects, project, open, controller, prepareScript, prepareProduction, task };
}

test('empty scenes go from exact source to a persisted export intent with one call; no premature success', async t => {
  const f = await fixture(t), order: string[] = [];
  const tasks = await runDocumentaryWorkflow(f.project.id, { projects: f.projects, signal: f.controller.signal,
    prepareScript: async () => { order.push('script'); await f.prepareScript(); },
    prepareProduction: async () => { order.push('materials'); await f.prepareProduction(); },
    startExport: async () => {
      order.push('export');
      const reopened = (await f.open().get(f.project.id))!;
      assert.equal(reopened.stockProduction?.phase, 'export');
      assert.equal(reopened.stockProduction.status, 'running');
      assert.equal(reopened.scenes.map(scene => scene.narration).join(''), f.project.videoBrief!.readyScript);
      return [f.task()];
    } });
  assert.deepEqual(order, ['script', 'materials', 'export']);
  const saved = (await f.open().get(f.project.id))!;
  assert.equal(saved.videoBrief!.readyScript, f.project.videoBrief!.readyScript);
  assert.equal(saved.stockProduction?.assemblyTaskId, tasks[0]!.id);
  assert.equal(saved.stockProduction?.status, 'running');
  assert.equal(saved.outputPath, undefined);
});

test('resume preserves edited scenes and does not call script preparation or paid preparation again for export', async t => {
  const f = await fixture(t); await f.prepareScript(); await f.prepareProduction();
  await f.projects.mutate(f.project.id, current => ({ stockProduction: { phase: 'export', status: 'failed', message: 'Renderer stopped', updatedAt: new Date().toISOString() },
    scenes: current.scenes.map(scene => ({ ...scene, trimStartSeconds: 3, sourceVolume: 0.17 })) }));
  const before = (await f.projects.get(f.project.id))!;
  await runDocumentaryWorkflow(f.project.id, { projects: f.projects, signal: f.controller.signal,
    prepareScript: async () => { throw Error('must retain scenes'); }, prepareProduction: async () => { throw Error('no paid preparation on export recovery'); },
    startExport: async () => [f.task()] });
  assert.deepEqual((await f.projects.get(f.project.id))!.scenes, before.scenes);
});

test('manual-review material stops automatic export and retains the actual reason in the project', async t => {
  const f = await fixture(t); let exports = 0;
  await assert.rejects(runDocumentaryWorkflow(f.project.id, { projects: f.projects, signal: f.controller.signal, prepareScript: f.prepareScript,
    prepareProduction: async () => { await f.prepareProduction(); await f.projects.mutate(f.project.id, current => ({
      scenes: current.scenes.map(scene => ({ ...scene, documentary: { ...scene.documentary!, verified: false } })) })); },
    startExport: async () => { exports++; return [f.task()]; } }), /Автоматический экспорт остановлен/);
  const saved = (await f.open().get(f.project.id))!;
  assert.equal(exports, 0); assert.equal(saved.stockProduction?.status, 'failed');
  assert.match(saved.stockProduction!.message, /№1/);
  assert.ok(saved.scenes.every(scene => scene.imagePath && !scene.documentary!.verified));
});

test('changing the continuous voice runs preparation; an unchanged paid track survives export recovery', async t => {
  const f = await fixture(t); await f.prepareScript(); await f.prepareProduction();
  const audioPath = join(f.root, 'voice.wav'); await writeFile(audioPath, 'paid track storage sentinel');
  await f.projects.mutate(f.project.id, current => ({
    settings: { ...current.settings, voice: { ...current.settings.voice, enabled: true, singleTrack: true, provider: 'elevenlabs', voice: 'new-voice' },
      assembly: { ...current.settings.assembly, documentary: { ...current.settings.assembly.documentary!, narrationMode: 'continuous' } } },
    scenes: current.scenes.map((scene, index) => ({ ...scene, audioPath,
      narrationSlice: { sourceSceneId: current.scenes[0]!.id, startSeconds: index, endSeconds: index + 1, last: index === current.scenes.length - 1 } })),
    stockProduction: { phase: 'export', status: 'complete', message: 'Old export', updatedAt: new Date().toISOString() }
  }));
  const saved = (await f.projects.get(f.project.id))!;
  const source = { text: saved.scenes.map(s => s.narration).join(''), sceneIds: saved.scenes.map(s => s.id), voice: 'old-voice', provider: 'elevenlabs' };
  await writeFile(`${audioPath}.json`, JSON.stringify(source));
  let preparations = 0;
  const run = () => runDocumentaryWorkflow(f.project.id, { projects: f.projects, signal: f.controller.signal,
    prepareScript: async () => { throw Error('Existing script must remain'); },
    prepareProduction: async () => { preparations++; await writeFile(`${audioPath}.json`, JSON.stringify({ ...source, voice: 'new-voice' })); },
    startExport: async () => [f.task()] });
  await run(); assert.equal(preparations, 1, 'A changed voice must not reuse stale narration');
  await run(); assert.equal(preparations, 1, 'The confirmed current voice must not be purchased twice');
});

test('editor export after an automatic failure replaces the failed attempt and reconciles the actual new file', async t => {
  const f = await fixture(t); const old = { ...f.task('failed'), id: 'old-export', error: 'Previous render failed' };
  await f.projects.mutate(f.project.id, () => ({ stockProduction: { phase: 'export', status: 'failed', message: old.error, assemblyTaskId: old.id, updatedAt: '2026-01-01' } }));
  const current = { ...f.task(), id: 'new-export' };
  await startDocumentaryWorkflowExport(f.project.id, f.projects, async () => {
    const intent = (await f.open().get(f.project.id))!.stockProduction!;
    assert.equal(intent.status, 'running'); assert.equal(intent.assemblyTaskId, undefined);
    return [current];
  });
  assert.equal((await f.open().get(f.project.id))!.stockProduction!.assemblyTaskId, current.id);
  await writeFile(current.resultPath!, 'new export storage sentinel');
  await f.projects.update(f.project.id, { status: 'complete', outputPath: current.resultPath });
  await reconcileDocumentaryWorkflows(f.open(), [old, { ...current, status: 'done' }]);
  assert.equal((await f.open().get(f.project.id))!.stockProduction!.status, 'complete');
});

test('unknown provider submission stays failed without an automatic second attempt', async t => {
  const f = await fixture(t); let attempts = 0;
  await assert.rejects(runDocumentaryWorkflow(f.project.id, { projects: f.projects, signal: f.controller.signal, prepareScript: f.prepareScript,
    prepareProduction: async () => { attempts++; throw Error('Неизвестный результат оплаченного запроса'); },
    startExport: async () => { throw Error('must not export'); } }), /Неизвестный результат/);
  assert.equal(attempts, 1);
  assert.match((await f.open().get(f.project.id))!.stockProduction!.message, /оплаченного запроса/);
});

test('Stop after preparation saves stopped state without dispatching export', async t => {
  const f = await fixture(t);
  await assert.rejects(runDocumentaryWorkflow(f.project.id, { projects: f.projects, signal: f.controller.signal, prepareScript: f.prepareScript,
    prepareProduction: async () => { await f.prepareProduction(); f.controller.abort(); },
    startExport: async () => { throw Error('must not export'); } }));
  const saved = (await f.open().get(f.project.id))!;
  assert.equal(saved.stockProduction?.status, 'stopped'); assert.ok(saved.scenes.every(scene => scene.imagePath));
});

test('startup restores interrupted planning and a paused export dispatched before its task ID was saved', async t => {
  const f = await fixture(t);
  await f.projects.mutate(f.project.id, () => ({ stockProduction: { phase: 'script', status: 'running', message: 'Planning', updatedAt: '2026-01-01' } }));
  await reconcileDocumentaryWorkflows(f.open(), [], true);
  assert.equal((await f.open().get(f.project.id))!.stockProduction?.status, 'interrupted');
  await f.projects.mutate(f.project.id, () => ({ stockProduction: { phase: 'export', status: 'running', message: 'Dispatching', updatedAt: '2026-01-01' } }));
  const paused = f.task('paused');
  await reconcileDocumentaryWorkflows(f.open(), [paused], true);
  let saved = (await f.open().get(f.project.id))!;
  assert.equal(saved.stockProduction?.status, 'interrupted'); assert.equal(saved.stockProduction.assemblyTaskId, paused.id);
  await reconcileDocumentaryWorkflows(f.open(), [{ ...paused, status: 'running' }]);
  saved = (await f.open().get(f.project.id))!; assert.equal(saved.stockProduction?.status, 'running');
});

test('queue done without the actual output file is never reported as completed', async t => {
  const f = await fixture(t); const done = f.task('done');
  const stage = async () => f.projects.mutate(f.project.id, () => ({ status: 'complete', outputPath: done.resultPath,
    stockProduction: { phase: 'export', status: 'running', message: 'Exporting', assemblyTaskId: done.id, updatedAt: '2026-01-01' } }));
  await stage(); await reconcileDocumentaryWorkflows(f.open(), [done]);
  assert.equal((await f.open().get(f.project.id))!.stockProduction?.status, 'failed');
  // A storage sentinel only, not an MP4 quality/render test.
  await writeFile(done.resultPath!, 'storage sentinel');
  await stage(); await reconcileDocumentaryWorkflows(f.open(), [done]);
  assert.equal((await f.open().get(f.project.id))!.stockProduction?.status, 'complete');
});
