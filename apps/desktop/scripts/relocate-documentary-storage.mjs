// Copy app-owned documentary data to D:, verify every file, retain C: originals.
// Existing absolute media paths keep working through directory junctions.
import assert from 'node:assert/strict';
import { constants, createReadStream } from 'node:fs';
import { copyFile, link, lstat, mkdir, readdir, rename, stat, statfs, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve, sep } from 'node:path';

const sourceRoot = resolve(process.env.APPDATA, '@gold-work/desktop/workspace');
const targetRoot = resolve('../../workspace-data/documentary-active');
assert.equal(targetRoot, 'D:\\Софт Gold Work Sudio\\workspace-data\\documentary-active');
const inside = (root, path) => { const r = relative(root, path); assert.ok(r && r !== '..' && !r.startsWith('..' + sep) && !r.includes(':') && !r.startsWith(sep)); };
const hash = async path => { const h = createHash('sha256'); for await (const chunk of createReadStream(path)) h.update(chunk); return h.digest('hex'); };
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
for (const subdir of ['projects/project_mu1sc77k_kyoo4o9', 'Materials']) {
  const source = resolve(sourceRoot, subdir), destination = resolve(targetRoot, subdir), backup = source + '.before-d-drive-' + stamp;
  inside(sourceRoot, source); inside(sourceRoot, backup); inside(targetRoot, destination);
  const rootStat = await lstat(source); assert.ok(rootStat.isDirectory() && !rootStat.isSymbolicLink());
  for (const path of [destination, backup]) assert.equal(await lstat(path).then(() => true, e => e.code === 'ENOENT' ? false : Promise.reject(e)), false, 'Destination must not exist');
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name); assert.ok(!entry.isSymbolicLink(), 'Unexpected link: ' + path);
      if (entry.isDirectory()) await walk(path);
      else { const metadata = await stat(path, { bigint: true }); files.push({ relative: relative(source, path), size: Number(metadata.size), inode: `${metadata.dev}:${metadata.ino}`, mtime: String(metadata.mtimeNs) }); }
    }
  }
  await walk(source);
  const uniqueSizes = new Map(files.map(file => [file.inode, file.size]));
  await mkdir(targetRoot, { recursive: true });
  const space = await statfs(targetRoot);
  const required = [...uniqueSizes.values()].reduce((sum, size) => sum + size, 0);
  assert.ok(space.bavail * space.bsize > required + 1024 ** 3, 'Keep 1 GiB reserve on D:');
  await mkdir(destination, { recursive: true });
  const copied = new Map(), manifest = [];
  for (const file of files) {
    const input = join(source, file.relative), output = join(destination, file.relative);
    await mkdir(dirname(output), { recursive: true });
    const existing = copied.get(file.inode);
    if (existing) await link(existing.path, output);
    else await copyFile(input, output, constants.COPYFILE_EXCL);
    const sourceHash = existing?.sha256 ?? await hash(input);
    assert.equal(await hash(output), sourceHash, 'Copy checksum: ' + file.relative);
    copied.set(file.inode, { path: output, sha256: sourceHash });
    manifest.push({ ...file, sha256: sourceHash });
  }
  for (const file of files) {
    const current = await stat(join(source, file.relative), { bigint: true });
    assert.equal(String(current.mtimeNs), file.mtime, 'Source changed');
    assert.equal(Number(current.size), file.size, 'Source changed');
  }
  await writeFile(join(targetRoot, subdir.replaceAll('/', '_') + '-relocation.json'), JSON.stringify({ source, destination, backup, requiredBytes: required, files: manifest }, null, 2), { flag: 'wx' });
  // Both resolved rename targets were checked within the exact app workspace.
  await rename(source, backup);
  try { await symlink(destination, source, 'junction'); }
  catch (error) { await rename(backup, source); throw error; }
  assert.ok((await lstat(source)).isSymbolicLink());
  console.log(JSON.stringify({ source, destination, preservedOriginal: backup, files: files.length, uniqueBytes: required }));
}
