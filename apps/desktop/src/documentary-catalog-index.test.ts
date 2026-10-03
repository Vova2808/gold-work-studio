import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {DocumentaryCandidate} from '@gold-work/shared';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {DocumentarySearch} from './documentary-search.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {atomicWrite} from './fs-utils.js';

test('incremental local search sees new/replaced/deleted evidence and never reuses caller mutations', async t => {
  const root = await mkdtemp(join(tmpdir(), 'gws-local-index-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const catalog = join(root, 'Catalog'); await mkdir(catalog);
  const media = join(root, 'original.mp4'); await writeFile(media, 'local fixture');
  const asset = {id: 'original', title: 'Honda racing engine', description: '', localPath: media,
    kind: 'video', provider: 'commons', concerns: [], query: 'unrelated old phrase'} as unknown as DocumentaryCandidate;
  const path = (letter: string) => join(catalog, `${letter.repeat(64)}.json`);
  await atomicWrite(path('a'), JSON.stringify(asset));
  const service = new DocumentaryProjectService({list: async () => []} as never, new LocalProjectStorage(root), new DocumentarySearch(), root, {} as never);
  const first = await service.localCandidates('Honda engine');
  assert.equal(first.length, 1); first[0]!.title = 'Caller change';
  assert.equal((await service.localCandidates('Honda engine'))[0]!.title, asset.title);
  await atomicWrite(path('b'), JSON.stringify({...asset, title: 'Yamaha racing engine'}));
  assert.equal((await service.localCandidates('Yamaha engine')).length, 1);
  await atomicWrite(path('a'), JSON.stringify({...asset, title: 'Ducati racing engine'}));
  assert.equal((await service.localCandidates('Honda engine')).length, 0);
  assert.equal((await service.localCandidates('Ducati engine')).length, 1);
  await rm(path('b'));
  assert.equal((await service.localCandidates('Yamaha engine')).length, 0);
  await rm(media);
  assert.equal((await service.localCandidates('Ducati engine')).length, 0, 'Removed original cannot be offered from cached metadata');
});
