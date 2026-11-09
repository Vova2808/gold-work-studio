import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createDefaultProjectSettings, type Project} from '@gold-work/shared';
import {FileProjectRepository} from './file-project-repository.js';
import {recoverProjectRegistry} from './project-registry-recovery.js';

function project(id: string): Project {
  return {id, title: 'Сохранённый проект', topic: 'Local recovery', aspectRatio: '16:9', language: 'ru', mode: 'standard',
    status: 'draft', createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-01T10:00:00Z', settings: createDefaultProjectSettings(),
    scenes: [{id: 'scene', order: 0, title: 'Сцена', narration: 'Точная озвучка', imagePrompt: '', animationPrompt: '',
      durationSeconds: 5, status: 'draft', audioPath: 'paid-voice.wav',
      documentary: {candidates: [{id: 'paid', description: 'Existing evidence', analysis: {status: 'pending', requestId: 'do-not-resend'}}]}}]} as unknown as Project;
}

test('startup recovery preserves damaged bytes, full snapshots and trash; skips broken and misidentified snapshots', async t => {
  const root = await mkdtemp(join(tmpdir(), 'gws-registry-recover-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const path = join(root, 'projects.json'), snapshots = join(root, 'workspace', 'projects');
  const broken = Buffer.concat([Buffer.from('['), Buffer.alloc(32768)]);
  await writeFile(path, broken);
  for (const id of ['saved', 'deleted', 'bad', 'wrong', '.trash']) await mkdir(join(snapshots, id), {recursive: true});
  const saved = project('saved'), source = JSON.stringify(saved, null, 2);
  await writeFile(join(snapshots, 'saved', 'project.json'), source);
  await writeFile(join(snapshots, 'saved', 'scenario.json'), 'unchanged scenario');
  await writeFile(join(snapshots, 'deleted', 'project.json'), JSON.stringify(project('deleted')));
  await writeFile(join(snapshots, 'bad', 'project.json'), Buffer.alloc(32));
  await writeFile(join(snapshots, 'wrong', 'project.json'), JSON.stringify(project('different-id')));
  await writeFile(join(snapshots, '.trash', 'project.json'), JSON.stringify(project('.trash')));
  const trash = JSON.stringify([{trashId: 'trash', deletedAt: '2026-10-02', project: project('deleted')}]);
  await writeFile(`${path}.trash`, trash);
  const result = await recoverProjectRegistry(path, snapshots);
  assert.ok(result);
  assert.deepEqual(result.recoveredIds, ['saved']);
  assert.deepEqual(result.excludedDeletedIds, ['deleted']);
  assert.equal(result.skipped.length, 2);
  assert.deepEqual(await readFile(result.backupPath), broken);
  assert.deepEqual(await new FileProjectRepository(path).get('saved'), saved);
  assert.equal(await readFile(path, 'utf8'), `[${source}]`);
  assert.equal(await readFile(`${path}.trash`, 'utf8'), trash);
  assert.equal(await readFile(join(snapshots, 'saved', 'project.json'), 'utf8'), source);
  assert.equal(await readFile(join(snapshots, 'saved', 'scenario.json'), 'utf8'), 'unchanged scenario');
  assert.deepEqual(await readFile(join(snapshots, 'bad', 'project.json')), Buffer.alloc(32));
  assert.equal(JSON.parse(await readFile(result.reportPath, 'utf8')).phase, 'completed');
  // Second startup retains the recovered registry and does not create another backup.
  const files = await readdir(root);
  assert.equal(await recoverProjectRegistry(path, snapshots), undefined);
  assert.deepEqual(await readdir(root), files);
});

test('a healthy registry is never replaced by stale snapshots', async t => {
  const root = await mkdtemp(join(tmpdir(), 'gws-registry-healthy-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const path = join(root, 'projects.json'), raw = JSON.stringify([project('current')], null, 2);
  await writeFile(path, raw);
  assert.equal(await recoverProjectRegistry(path, join(root, 'does-not-exist')), undefined);
  assert.equal(await readFile(path, 'utf8'), raw);
  assert.deepEqual(await readdir(root), ['projects.json']);
});

test('no valid snapshots cannot overwrite the registry with an empty list', async t => {
  const root = await mkdtemp(join(tmpdir(), 'gws-registry-unrecoverable-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const path = join(root, 'projects.json'), snapshots = join(root, 'workspace');
  await writeFile(path, 'damaged');
  await mkdir(join(snapshots, 'bad'), {recursive: true});
  await writeFile(join(snapshots, 'bad', 'project.json'), '{}');
  await assert.rejects(recoverProjectRegistry(path, snapshots), /Не найдены целые файлы/);
  assert.equal(await readFile(path, 'utf8'), 'damaged');
  assert.deepEqual((await readdir(root)).sort(), ['projects.json', 'workspace']);
});

test('a damaged trash registry prevents resurrection of deleted projects', async t => {
  const root = await mkdtemp(join(tmpdir(), 'gws-registry-trash-safety-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const path = join(root, 'projects.json'), snapshots = join(root, 'workspace');
  await writeFile(path, '[');
  await writeFile(`${path}.trash`, 'damaged trash');
  await mkdir(join(snapshots, 'saved'), {recursive: true});
  await writeFile(join(snapshots, 'saved', 'project.json'), JSON.stringify(project('saved')));
  await assert.rejects(recoverProjectRegistry(path, snapshots), SyntaxError);
  assert.equal(await readFile(path, 'utf8'), '[');
  assert.equal(await readFile(`${path}.trash`, 'utf8'), 'damaged trash');
});
