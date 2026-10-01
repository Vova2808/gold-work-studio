import { app } from 'electron';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { Project } from '@gold-work/shared';
import { AnyModelClient } from '../src/anymodel-client.js';
import { AnyModelStore } from '../src/anymodel-store.js';
import { DocumentaryIntelligence } from '../src/documentary-intelligence.js';

assert.ok(process.argv.includes('--paid'));
const profile = 'C:/Users/rosup/AppData/Roaming/@gold-work/desktop';
app.setPath('userData', profile);
app.whenReady().then(async () => {
  const stillFrame = process.argv.includes('--still-frame');
  const out = resolve(`captures/stock-visual-subject-20260927${stillFrame ? '-frame' : ''}`);
  await mkdir(out, { recursive: true });
  const checkpoint = join(out, 'probe.json');
  assert.equal(await stat(checkpoint).catch(() => null), null, 'Inspect the saved probe; do not repeat an uncertain request');
  const before = await readFile(join(profile, 'projects.json'), 'utf8');
  const original = (JSON.parse(before) as Project[]).find(p => p.id === 'project_muihr14p_xsah7wf')!;
  const source = original.scenes.find(s => s.order === (stillFrame ? 30 : 29))!;
  assert.equal(source.documentary?.selected?.title, 'Panama Canal - at Miraflores Locks.webm');
  assert.ok(source.videoPath && source.documentary?.checksum);
  const narrated = original.scenes.find(s => s.order === 18)!;
  const scene = { ...source, id: narrated.id, order: narrated.order, narration: narrated.narration, ...(stillFrame ? { videoPath: undefined } : {}),
    documentary: { ...source.documentary!, verified: false, requirement: narrated.documentary!.requirement, timing: narrated.documentary!.timing,
      selected: { ...source.documentary!.selected!, ...(stillFrame ? { kind: 'image' as const, localPath: source.imagePath, durationSeconds: undefined } : {}) } } };
  assert.deepEqual(scene.documentary.requirement.entities, ['контейнеровоз']);
  assert.ok(scene.documentary.requirement.identities?.some(identity => identity.name === 'Панамский канал'));
  const project = { ...original, scenes: original.scenes.map(existing => existing.id === scene.id ? scene : existing) };
  const client = new AnyModelClient(new AnyModelStore(join(profile, 'credentials/anymodel.json')));
  let requests = 0;
  // Use the real checkpoint directory and shared source catalog, so changing
  // the probe's output folder cannot bypass a previous uncertain paid request.
  const intelligence = new DocumentaryIntelligence(client, () => join('D:/GoldWorkStorage/projects', original.id), async () => {
    assert.ok(++requests <= 3, 'Bounded visual probe reached its request limit');
  }, 'D:/GoldWorkStorage/Materials/VideoCatalog');
  const startedAt = new Date().toISOString();
  await writeFile(checkpoint, JSON.stringify({ state: 'pending', startedAt, purpose: 'Real source frames with generic detail and mandatory named place; no project mutation or TTS' }));
  try {
    const review = await intelligence.inspect(project, scene);
    await writeFile(join(out, 'review.json'), JSON.stringify(review, null, 2));
    assert.equal(await readFile(join(profile, 'projects.json'), 'utf8'), before, 'Project registry changed');
    assert.equal(review.status, 'accepted');
    assert.ok(['Панамский канал', 'Panama Canal'].includes(review.identifiedEntity ?? ''));
    const result = { state: 'complete', startedAt, elapsedSeconds: (Date.now() - Date.parse(startedAt)) / 1000, requests, review, registryUnchanged: true };
    await writeFile(checkpoint, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } catch (error) {
    await writeFile(checkpoint, JSON.stringify({ state: 'failed-or-uncertain', startedAt, requests, error: String(error).replace(/https?:\/\/\S+/g, '[URL]') }, null, 2));
    throw error;
  }
}).then(() => app.exit(0), error => { console.error(String(error).replace(/https?:\/\/\S+/g, '[URL]')); app.exit(1); });
