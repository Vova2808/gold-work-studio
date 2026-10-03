import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { effectFfmpeg } from '../src/effect-media.js';
import type { EffectAsset } from '@gold-work/shared';

const root = resolve('captures/motion-reference-20260926');
await mkdir(root, { recursive: true });
const source = 'C:/Users/rosup/Downloads/тестик ласт.mp4';
for (let page = 0; page < 3; page++) {
  await effectFfmpeg(['-y', '-ss', String(page * 48), '-i', source, '-t', '48', '-vf',
    'fps=1/4,scale=480:270,tile=3x4', '-frames:v', '1', join(root, `reference-${page + 1}.jpg`)]);
}
const catalog = 'D:/GoldWorkStorage/Library/Catalog/Assets';
const assets: EffectAsset[] = [];
for (const name of await readdir(catalog)) if (name.endsWith('.json')) {
  const asset = JSON.parse(await readFile(join(catalog, name), 'utf8')) as EffectAsset;
  if (!asset.deletedAt) assets.push(asset);
}
const counts: Record<string, { total: number; automatic: number }> = {};
for (const asset of assets) {
  const key = `${asset.kind}/${asset.category}`;
  const count = counts[key] ??= { total: 0, automatic: 0 };
  count.total++;
  if (asset.automatic && asset.review === 'approved' && asset.state === 'ready') count.automatic++;
}
await writeFile(join(root, 'library.json'), JSON.stringify(assets.map(a => ({ id:a.id, name:a.name, kind:a.kind, category:a.category, automatic:a.automatic, review:a.review, rights:a.rights, duration:a.metadata?.durationSeconds, peakDb:a.metadata?.peakDb, file:a.file, preview:a.preview, poster:a.poster, defaults:a.defaults, packs:a.origins.map(o=>o.pack) })), null, 2));
console.log(JSON.stringify({ root, total: assets.length, counts, packs: [...new Set(assets.flatMap(a=>a.origins.map(o=>o.pack)))] }));
