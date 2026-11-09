import { mkdir, readFile, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import type { EffectLibrary } from './effect-library.js';
import { checksumFile } from './effect-library.js';
import { atomicWrite } from './fs-utils.js';
import { copyImmutableDocumentaryFile } from './documentary-storage.js';
import { selectedDocumentaryBackgroundIds, type DocumentaryMontageSettings } from '@gold-work/shared';

export interface DocumentaryBackgroundAsset {
  assetId: string; path: string; kind: 'image' | 'video'; name: string;
}
/** Only explicit user choices are copied. Empty selection never expands to the library. */
export async function resolveDocumentaryBackgrounds(library: EffectLibrary, projectDirectory: string, background: DocumentaryMontageSettings['background']): Promise<DocumentaryBackgroundAsset[]> {
  const resolved: DocumentaryBackgroundAsset[] = [];
  for (const assetId of selectedDocumentaryBackgroundIds(background)) {
    resolved.push(await resolveDocumentaryBackground(library, projectDirectory, assetId));
  }
  return resolved;
}
function contained(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return !!rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\');
}

/** Project copies, including their provenance, outlive the library and original import. */
export async function resolveDocumentaryBackground(library: EffectLibrary, projectDirectory: string, assetId: string): Promise<DocumentaryBackgroundAsset> {
  if (!/^[a-f0-9]{64}$/.test(assetId)) throw new Error('Некорректный ID фона');
  const directory = join(projectDirectory, 'Documentary', 'Backgrounds');
  const manifest = join(directory, `${assetId}.source.json`);
  try {
    const saved = JSON.parse(await readFile(manifest, 'utf8')) as DocumentaryBackgroundAsset & { file: string; checksum: string };
    const path = join(directory, saved.file);
    if (saved.assetId === assetId && contained(directory, path) && ['image', 'video'].includes(saved.kind)
      && await stat(path).then(info => info.isFile(), () => false) && await checksumFile(path) === saved.checksum) {
      return { assetId, path, kind: saved.kind, name: saved.name };
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const asset = (await library.snapshot()).assets.find(item => item.id === assetId && item.category === 'background'
    && (item.kind === 'image' || item.kind === 'video') && item.state === 'ready' && !item.deletedAt);
  if (!asset || asset.kind === 'audio') throw new Error('Фон недоступен в библиотеке. Выберите другой фон.');
  const playable = asset.kind === 'image' || /\.(mp4|webm)$/i.test(asset.file) ? asset.file : asset.proxy ?? asset.file;
  const source = join(library.rootPath, playable);
  if (!contained(library.rootPath, source)) throw new Error('Некорректный путь фона');
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${assetId}-${basename(source)}`);
  await copyImmutableDocumentaryFile(source, path);
  const result: DocumentaryBackgroundAsset = { assetId, path, name: asset.name, kind: asset.kind };
  await atomicWrite(manifest, JSON.stringify({ ...result, path: undefined, file: basename(path), checksum: await checksumFile(path), source: asset }, null, 2));
  return result;
}
