// One-time recovery of the explicit, recorded model refusal from 2026-09-15.
// This does not clear or retry checkpoints whose remote outcome is unknown.
import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';

const control = resolve('captures/documentary-control');
const result = JSON.parse(await readFile(join(control, 'automatic-results.json'), 'utf8'));
assert.equal(result.project.id, 'project_mu1sc77k_kyoo4o9');
assert.equal(result.selected, 0);
assert.equal(result.failed, 1);
assert.deepEqual(result.failures, [{
  sceneId: 'doc-64418fbde6c165f42183', sceneNumber: 19, category: 'unknown',
  message: 'Stock: AnyModel явно отклонил запрос: модель ограничена или недоступна.',
}]);
const name = '2a00cf4a9358f15f8da8e191e048d2aefe493876270ae45060eeb2108fda96c5.json';
const checkpoint = join(process.env.APPDATA, '@gold-work', 'desktop', 'workspace', 'projects', result.project.id, 'Documentary', 'Analysis', name);
const original = await readFile(checkpoint, 'utf8');
assert.deepEqual(JSON.parse(original), {
  state: 'pending', purpose: 'candidate-relevance', createdAt: '2026-09-15T12:59:19.026Z',
});
const backup = join(control, 'explicit-model-refusal-backup');
await mkdir(backup, { recursive: true });
await copyFile(checkpoint, join(backup, name), constants.COPYFILE_EXCL);
await copyFile(join(control, 'automatic-results.json'), join(backup, 'automatic-results.json'), constants.COPYFILE_EXCL);
assert.equal(await readFile(checkpoint, 'utf8'), original, 'Checkpoint changed during recovery');
const repaired = {
  ...JSON.parse(original), state: 'rejected', rejection: 'model-unavailable',
  recoveredAt: new Date().toISOString(),
  recoveryEvidence: 'Scoped scene 19 run at 2026-09-15T12:59:08.876Z ended in the explicit AnyModel model-unavailable error, emitted before output/usage. Original checkpoint and result preserved in explicit-model-refusal-backup.',
};
const temporary = checkpoint + '.explicit-refusal-recovery';
await writeFile(temporary, JSON.stringify(repaired, null, 2), { flag: 'wx' });
await rename(temporary, checkpoint);
console.log(JSON.stringify({ recovered: name, state: repaired.state, backup }));
