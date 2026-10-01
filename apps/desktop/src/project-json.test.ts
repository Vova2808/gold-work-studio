import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Project} from '@gold-work/shared';
import {projectJsonChunks,registryJsonChunks} from './project-json.js';
import {atomicWrite} from './fs-utils.js';

test('chunked registry and project backups preserve JSON exactly, including large scene evidence', async t => {
  const root = await mkdtemp(join(tmpdir(), 'gws-project-chunks-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const project = {id: 'one', title: 'Кадр 🚗 "имя"\nстрока', optional: undefined,
    scenes: Array.from({length: 24}, (_, i) => ({id: `s${i}`, narration: 'Original',
      documentary: {candidates: [{description: 'metadata '.repeat(16000), rights: 'unknown'}]}}))} as unknown as Project;
  const path = join(root, 'projects.json');
  let ticks = 0;
  const timer = setInterval(() => ticks++, 0);
  try { await atomicWrite(path, registryJsonChunks([project, {...project, id: 'two'}])); }
  finally { clearInterval(timer); }
  assert.equal(await readFile(path, 'utf8'), JSON.stringify([project, {...project, id: 'two'}]));
  assert.ok(ticks > 1, 'Serialization must yield so progress/Stop callbacks can run');
  await atomicWrite(path, projectJsonChunks(project));
  assert.equal(await readFile(path, 'utf8'), JSON.stringify(project));
  await atomicWrite(path, registryJsonChunks([]));
  assert.equal(await readFile(path, 'utf8'), '[]');
});

test('a failed chunk producer keeps the previous checkpoint and removes its partial file', async t => {
  const root = await mkdtemp(join(tmpdir(), 'gws-project-chunk-failure-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const path = join(root, 'projects.json');
  await atomicWrite(path, '[{"id":"paid-checkpoint"}]');
  async function* broken() { yield '[{"id":"partial"}'; throw new Error('Interrupted serialization'); }
  await assert.rejects(atomicWrite(path, broken()), /Interrupted serialization/);
  assert.equal(await readFile(path, 'utf8'), '[{"id":"paid-checkpoint"}]');
  assert.deepEqual(await readdir(root), ['projects.json']);
});
