import {createRequire} from 'node:module';
import {spawnSync, execFileSync} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {copyFile, mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join, resolve} from 'node:path';

// Run from apps/desktop. Only isolated copies are mutated; there are no provider calls.
const require = createRequire(import.meta.url), {build} = createRequire(require.resolve('electron-vite'))('esbuild');
const baselineRef = process.argv[2] ?? '749e713';
const root = resolve(`captures/stock-speed-20261003/registry-benchmark-${Date.now()}`);
const original = join(process.env.APPDATA, '@gold-work', 'desktop', 'projects.json');
const hashFile = async path => { const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex'); };
const originalSha256 = await hashFile(original);
const baselineSource = execFileSync('git', ['show', `${baselineRef}:apps/desktop/src/file-project-repository.ts`], {encoding: 'utf8'});
await mkdir(root, {recursive: true});
const bundles = {};
for (const variant of ['baseline', 'indexed']) {
  const directory = join(root, variant);
  await mkdir(directory);
  const copy = join(directory, 'projects.json');
  await copyFile(original, copy);
  const bundle = join(root, `${variant}.mjs`);
  await build({entryPoints: ['scripts/project-registry-benchmark.ts'], outfile: bundle, bundle: true, platform: 'node', format: 'esm', packages: 'external',
    plugins: variant === 'baseline' ? [{name: 'baseline-repository', setup(build) {
      build.onLoad({filter: /file-project-repository\.ts$/}, () => ({contents: baselineSource, loader: 'ts', resolveDir: resolve('src')}));
    }}] : []});
  bundles[variant] = bundle;
  const result = spawnSync(process.execPath, ['--expose-gc', bundle, 'measure', copy, join(directory, 'measurement.json')], {stdio: 'inherit', windowsHide: true});
  if (result.status !== 0) throw new Error(`${variant} measurement failed (${result.status})`);
}
for (const variant of ['baseline', 'indexed']) {
  const directory = join(root, variant);
  const result = spawnSync(process.execPath, [bundles.indexed, 'verify', join(directory, 'projects.json'), join(directory, 'integrity.json'), original], {stdio: 'inherit', windowsHide: true});
  if (result.status !== 0) throw new Error(`${variant} integrity failed (${result.status})`);
}
const unchanged = originalSha256 === await hashFile(original);
await writeFile(join(root, 'summary.json'), JSON.stringify({baselineRef, originalSha256, originalUnchanged: unchanged, root, paidRequests: 0}, null, 2));
if (!unchanged) throw new Error('Original registry changed during the benchmark; compare cannot be accepted');
console.log(JSON.stringify({root, originalUnchanged: unchanged}));
