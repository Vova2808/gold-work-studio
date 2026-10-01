import { app } from 'electron';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { Project } from '@gold-work/shared';
import { AnyModelClient } from '../src/anymodel-client.js';
import { AnyModelStore } from '../src/anymodel-store.js';
import { DocumentaryIntelligence } from '../src/documentary-intelligence.js';
import { documentaryIdentityMatches } from '../src/documentary-visual-relevance.js';

assert.ok(process.argv.includes('--paid'));
const profile = 'C:/Users/rosup/AppData/Roaming/@gold-work/desktop';
app.setPath('userData', profile);
app.whenReady().then(async () => {
  const out = resolve('captures/stock-context-identity-20260926');
  await mkdir(out, { recursive: true });
  const checkpoint = join(out, 'probe.json');
  assert.equal(await stat(checkpoint).catch(() => null), null, 'This bounded probe already ran; inspect its saved result');
  const before = await readFile(join(profile, 'projects.json'), 'utf8');
  const project = (JSON.parse(before) as Project[]).find(p => p.id === 'project_muihr14p_xsah7wf')!;
  const selected = project.scenes.filter(s => [23, 28, 34, 37].includes(s.order));
  assert.equal(selected.length, 4);
  const client = new AnyModelClient(new AnyModelStore(join(profile, 'credentials/anymodel.json')));
  const intelligence = new DocumentaryIntelligence(client, () => out);
  const startedAt = new Date().toISOString();
  await writeFile(checkpoint, JSON.stringify({ state: 'pending', startedAt, purpose: 'four narrative referents; no project mutation or TTS' }));
  try {
    let results: Array<{ scene: number; identities: unknown }> = [];
    await intelligence.resolveIdentities(project, selected, async plan => {
      results = selected.map(scene => ({ scene: scene.order + 1, identities: plan.get(scene.id)!.identities }));
      await writeFile(join(out, 'results.json'), JSON.stringify(results, null, 2));
      for (const scene of selected) {
        const expected = scene.order === 23 ? 'Cape Horn' : scene.order === 28 ? 'озеро Гатун' : 'Panama Canal';
        assert.ok(documentaryIdentityMatches(plan.get(scene.id)!, expected), `Scene ${scene.order + 1} lost ${expected}`);
      }
    });
    assert.equal(await readFile(join(profile, 'projects.json'), 'utf8'), before, 'Project registry changed');
    const result = { state: 'complete', startedAt, elapsedSeconds: (Date.now() - Date.parse(startedAt)) / 1000, results, registryUnchanged: true };
    await writeFile(checkpoint, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } catch (error) {
    await writeFile(checkpoint, JSON.stringify({ state: 'failed-or-uncertain', startedAt, error: String(error).replace(/https?:\/\/\S+/g, '[URL]') }, null, 2));
    throw error;
  }
}).then(() => app.exit(0), error => { console.error(String(error).replace(/https?:\/\/\S+/g, '[URL]')); app.exit(1); });
