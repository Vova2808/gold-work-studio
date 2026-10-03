import assert from 'node:assert/strict';
import {access, open, writeFile} from 'node:fs/promises';
import {dirname, isAbsolute, relative, resolve} from 'node:path';
import {monitorEventLoopDelay, performance} from 'node:perf_hooks';
import {setTimeout} from 'node:timers/promises';
import {FileProjectRepository} from '../src/file-project-repository.js';
import {indexProjectRegistry, readRegistryProject} from '../src/project-registry.js';

const [mode, fileArg, outputArg, originalArg] = process.argv.slice(2);
if (!fileArg || !outputArg || !['measure', 'verify'].includes(mode!)) throw new Error('Expected measure/verify, isolated projects.json, report.json');
const file = resolve(fileArg), output = resolve(outputArg);
const captureRoot = resolve('captures/stock-speed-20261003');
const relativeFile = relative(captureRoot, file);
if (relativeFile.startsWith('..') || isAbsolute(relativeFile) || dirname(file) !== dirname(output)) throw new Error('Writes are restricted to an isolated capture directory');
const projectId = 'project_mun42rx8_1jcven5';

if (mode === 'measure') {
  const repository = new FileProjectRepository(file);
  const lag = monitorEventLoopDelay({resolution: 10});
  lag.enable();
  const memory = () => ({rssMiB: process.memoryUsage().rss / 2 ** 20, heapMiB: process.memoryUsage().heapUsed / 2 ** 20,
    processPeakRssMiB: process.resourceUsage().maxRSS / 1024});
  const phases: unknown[] = [];
  const phase = async (name: string, action: () => Promise<void>) => {
    // Arm the monitor before synchronous parsing and give its delayed timer
    // a chance to run afterwards. A single setImmediate missed cold parse stalls.
    await setTimeout(20);
    lag.reset();
    const started = performance.now();
    await action();
    const elapsedMs = performance.now() - started;
    await setTimeout(20);
    const beforeGc = memory();
    global.gc?.();
    phases.push({name, elapsedMs, beforeGc, retained: memory(), eventLoopMaxMs: lag.max / 1e6});
  };
  await phase('coldDisplay', async () => { assert.equal((await repository.listForDisplay()).projects.length, 35); });
  await phase('tenDisplayReads', async () => {
    for (let i = 0; i < 10; i++) assert.equal((await repository.get(projectId, {omitCandidates: true}))!.scenes.length, 246);
  });
  const title = (await repository.get(projectId, {omitCandidates: true}))!.title;
  await phase('fourOneSceneMutations', async () => {
    for (let i = 0; i < 4; i++) {
      await repository.mutate(projectId, p => ({...p, title: i === 3 ? title : `${title} [isolated benchmark ${i}]`}), {candidateSceneIds: []});
    }
  });
  lag.disable();
  await writeFile(output, JSON.stringify({node: process.version, phases, registryPath: file}, null, 2));
  console.log(JSON.stringify({output, phases}));
} else {
  if (!originalArg) throw new Error('Expected read-only original path');
  const original = await open(resolve(originalArg), 'r'), saved = await open(file, 'r');
  let projects = 0, candidates = 0, paidVoices = 0, missingVoices = 0;
  try {
    const before = await indexProjectRegistry(original), after = await indexProjectRegistry(saved);
    assert.equal(after.length, before.length);
    for (const entry of before) {
      const copied = after.find(item => item.display.id === entry.display.id);
      assert.ok(copied);
      const expected = await readRegistryProject(original, entry), actual = await readRegistryProject(saved, copied);
      assert.deepEqual(actual, expected, `All persisted fields must survive for ${expected.id}`);
      projects++;
      candidates += actual.scenes.reduce((sum, scene) => sum + (scene.documentary?.candidates.length ?? 0), 0);
      if (actual.id === projectId) for (const scene of actual.scenes) if (scene.audioPath) {
        paidVoices++;
        try { await access(scene.audioPath); } catch { missingVoices++; }
      }
    }
  } finally { await original.close(); await saved.close(); }
  assert.equal(paidVoices, 246);
  assert.equal(missingVoices, 0);
  const result = {projects, candidates, paidVoices, missingVoices, allProjectFieldsIdentical: true};
  await writeFile(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
