import { app } from 'electron';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import type { Project } from '@gold-work/shared';
import { AnyModelClient } from '../src/anymodel-client.js';
import { AnyModelStore } from '../src/anymodel-store.js';
import { DocumentaryIntelligence } from '../src/documentary-intelligence.js';
import { DocumentarySearch } from '../src/documentary-search.js';
import { downloadDocumentaryFile } from '../src/documentary-download.js';

assert.ok(process.argv.includes('--paid'));
const profile = 'C:/Users/rosup/AppData/Roaming/@gold-work/desktop';
app.setPath('userData', profile);
app.whenReady().then(async () => {
  const out = resolve('captures/stock-class-photo-20260927');
  await mkdir(out, { recursive: true });
  const checkpoint = join(out, 'probe.json');
  assert.equal(await stat(checkpoint).catch(() => null), null, 'Read saved evidence; never repeat an uncertain probe');
  const registry = join(profile, 'projects.json'), before = await readFile(registry, 'utf8');
  const project = (JSON.parse(before) as Project[]).find(p => p.id === 'project_muihr14p_xsah7wf')!;
  const scene = structuredClone(project.scenes.find(s => s.order === 83)!);
  const result = await new DocumentarySearch().search({ query: 'Agua Clara Locks 09 2019 0744', kind: 'image', providers: ['commons'] });
  const candidate = result.candidates.find(c => c.title === 'Agua Clara Locks 09 2019 0744.jpg');
  assert.ok(candidate && candidate.rights === 'licensed');
  const file = join(out, 'original.jpg');
  await downloadDocumentaryFile(candidate.downloadUrl, file);
  const checksum = createHash('sha256').update(await readFile(file)).digest('hex');
  scene.imagePath = file; scene.videoPath = undefined;
  scene.documentary = { ...scene.documentary!, selected: { ...candidate, localPath: file }, checksum, verified: false };
  const client = new AnyModelClient(new AnyModelStore(join(profile, 'credentials/anymodel.json')));
  let requests = 0;
  const intelligence = new DocumentaryIntelligence(client, () => join('D:/GoldWorkStorage/projects', project.id), async () => {
    assert.ok(++requests <= 1, 'One actual-image request only');
  }, 'D:/GoldWorkStorage/Materials/VideoCatalog');
  const startedAt = new Date().toISOString();
  await writeFile(checkpoint, JSON.stringify({ state: 'pending', startedAt, checksum }));
  try {
    const review = await intelligence.inspect(project, scene);
    assert.equal(await readFile(registry, 'utf8'), before);
    const evidence = { state: 'complete', startedAt, elapsedSeconds: (Date.now() - Date.parse(startedAt)) / 1000, requests, checksum, review, registryUnchanged: true };
    await writeFile(checkpoint, JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence));
  } catch (error) {
    await writeFile(checkpoint, JSON.stringify({ state: 'failed-or-uncertain', startedAt, requests, error: String(error).replace(/https?:\/\/\S+/g, '[URL]') }));
    throw error;
  }
}).then(() => app.exit(0), error => { console.error(String(error).replace(/https?:\/\/\S+/g, '[URL]')); app.exit(1); });
