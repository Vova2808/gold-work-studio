import { app } from 'electron';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import type { Project } from '@gold-work/shared';
import { AnyModelClient } from '../src/anymodel-client.js';
import { AnyModelStore } from '../src/anymodel-store.js';
import { DocumentaryIntelligence } from '../src/documentary-intelligence.js';
import { effectFfmpeg, probeEffectMedia } from '../src/effect-media.js';

assert.ok(process.argv.includes('--paid'));
const profile = 'C:/Users/rosup/AppData/Roaming/@gold-work/desktop';
app.setPath('userData', profile);
app.whenReady().then(async () => {
  const isolatedSequence = process.argv.includes('--sequence');
  const out = resolve(`captures/stock-action-proof-20260927${isolatedSequence ? '-sequence' : ''}`);
  await mkdir(out, { recursive: true });
  const checkpoint = join(out, 'probe.json');
  assert.equal(await stat(checkpoint).catch(() => null), null, 'Inspect saved evidence; no uncertain probe retry');
  const registry = join(profile, 'projects.json'), before = await readFile(registry, 'utf8');
  const project = (JSON.parse(before) as Project[]).find(p => p.id === 'project_muihr14p_xsah7wf')!;
  const scene = structuredClone(project.scenes.find(s => s.order === 111)!);
  assert.ok(scene.videoPath && scene.documentary?.selected);
  assert.equal(scene.documentary.selected.title, 'Panama Canal Timelapse- Caribbean to Pacific.webm');
  const file = join(out, 'closed-gates-actual.mp4');
  await effectFfmpeg(['-y', '-ss', '10.905877192982457', '-i', scene.videoPath, '-t', '2.166666666666667', '-an', '-vf', 'scale=960:-2', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', file]);
  const media = await probeEffectMedia(file);
  const checksum = createHash('sha256').update(await readFile(file)).digest('hex');
  scene.videoPath = file; scene.trimStartSeconds = 0; scene.trimEndSeconds = undefined;
  scene.documentary = { ...scene.documentary, selected: { ...scene.documentary.selected, localPath: file, durationSeconds: media.durationSeconds, width: media.width, height: media.height }, checksum, verified: false };
  const client = new AnyModelClient(new AnyModelStore(join(profile, 'credentials/anymodel.json')));
  let requests = 0;
  const intelligence = new DocumentaryIntelligence(client, () => join('D:/GoldWorkStorage/projects', project.id), async () => {
    assert.ok(++requests <= 2, 'At most overview and final actual-range review');
  }, 'D:/GoldWorkStorage/Materials/VideoCatalog');
  const startedAt = new Date().toISOString();
  await writeFile(checkpoint, JSON.stringify({ state: 'pending', startedAt, checksum }));
  try {
    // This derived 2 s diagnostic file has its own clock; the original
    // project's 146 s source ranges do not describe its used intervals.
    const review = await intelligence.inspect(isolatedSequence ? { ...project, scenes: [scene] } : project, scene);
    assert.equal(await readFile(registry, 'utf8'), before);
    const evidence = { state: 'complete', startedAt, elapsedSeconds: (Date.now() - Date.parse(startedAt)) / 1000, requests, checksum, review, registryUnchanged: true };
    await writeFile(checkpoint, JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence));
    assert.notEqual(review.status, 'accepted', 'Unchanging closed gates must not illustrate gates closing');
    assert.equal(review.actionMatch, false);
    if (isolatedSequence) assert.ok(review.sampleSeconds.length >= 3, 'The action probe must inspect a sequence, not one collapsed sample');
  } catch (error) {
    await writeFile(join(out, 'failure.json'), JSON.stringify({ startedAt, requests, error: String(error).replace(/https?:\/\/\S+/g, '[URL]') }));
    throw error;
  }
}).then(() => app.exit(0), error => { console.error(String(error).replace(/https?:\/\/\S+/g, '[URL]')); app.exit(1); });
