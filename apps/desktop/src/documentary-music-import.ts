import {createHash,randomUUID} from 'node:crypto';
import {constants,createReadStream} from 'node:fs';
import {copyFile,mkdir,readFile,readdir,rename,rm,stat} from 'node:fs/promises';
import {basename,extname,isAbsolute,join} from 'node:path';
import {probeEffectMedia} from './effect-media.js';
import {atomicWrite} from './fs-utils.js';
async function checksum(path:string){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}

export interface MusicProvenance {
  provider: 'local' | 'commons' | 'pixabay'; sourcePage?: string; sourceUrl?: string;
  license: string; licenseUrl?: string; author?: string; attribution?: string;
}
export interface ImportedMusicAsset {
  version: 1; id: string; file: string; name: string; durationSeconds: number;
  tags: string[]; importedAt: string; provenance: MusicProvenance;
}
export async function listImportedMusic(directory: string): Promise<ImportedMusicAsset[]> {
  const catalog = join(directory, 'Catalog');
  const names = await readdir(catalog).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  const assets: ImportedMusicAsset[] = [];
  for (const name of names.filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
    const asset = JSON.parse(await readFile(join(catalog, name), 'utf8')) as ImportedMusicAsset;
    if (asset.version !== 1 || !/^[a-f0-9]{64}$/.test(asset.id) || basename(asset.file) !== asset.file || !asset.file.startsWith(asset.id + '.')) continue;
    if (await stat(join(directory, asset.file)).then(info => info.isFile() && info.size > 0, () => false)) assets.push(asset);
  }
  return assets;
}

/** Old explicit Music imports predate the catalog. Never scan the effects library. */
export async function indexLegacyMusicImports(directory: string, signal?: AbortSignal): Promise<void> {
  const names = await readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  let indexed = 0;
  for (const file of names.filter(name => /^[a-f0-9]{64}\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(name))) {
    signal?.throwIfAborted();
    if (await stat(join(directory, 'Catalog', `${basename(file, extname(file))}.json`)).then(() => true, () => false)) continue;
    if (indexed++ >= 32) break;
    const source = await readFile(join(directory, `${file}.source.json`), 'utf8').then(text => JSON.parse(text) as {provider?:string;name?:string;sourcePage?:string;query?:string}).catch(error => {if(error.code==='ENOENT')return undefined;throw error;});
    const pixabay = source?.provider === 'pixabay' && /^https:\/\/(?:www\.)?pixabay\.com\//.test(source.sourcePage ?? '');
    await importDocumentaryMusic(join(directory, file), directory, { signal, name: source?.name ?? 'Импортированная музыка', tags: source?.query ? [source.query] : [],
      provenance: pixabay ? { provider: 'pixabay', sourcePage: source!.sourcePage, license: 'Pixabay Content License', licenseUrl: 'https://pixabay.com/service/license-summary/' } : undefined });
  }
}

/** Keep selected audio in the allowed media workspace, independent of Downloads. */
export async function importDocumentaryMusic(source:string,directory:string, metadata?: {name?:string;tags?:string[];provenance?:MusicProvenance;signal?:AbortSignal}):Promise<string>{
  metadata?.signal?.throwIfAborted();
  if(!isAbsolute(source)||!/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(source))throw Error('Выберите локальный аудиофайл');
  const info=await stat(source);if(!info.isFile()||!info.size||info.size>1024**3)throw Error('Музыкальный файл пустой или больше 1 ГБ');
  const media=await probeEffectMedia(source,metadata?.signal);if(!media.hasAudio||!media.durationSeconds)throw Error('В выбранном файле не найдена звуковая дорожка');
  const hash=await checksum(source);
  await mkdir(directory,{recursive:true});const target=join(directory,hash+extname(source).toLowerCase());
  const saveCatalog=async()=>{
    const catalog=join(directory,'Catalog',`${hash}.json`);
    // Reimport does not erase the original name, source or license.
    const previous=await readFile(catalog,'utf8').then(text=>JSON.parse(text) as ImportedMusicAsset).catch(error=>{if(error.code==='ENOENT')return undefined;throw error;});
    const asset:ImportedMusicAsset={version:1,id:hash,file:basename(target),name:metadata?.name??previous?.name??basename(source,extname(source)),durationSeconds:media.durationSeconds,
      tags:metadata?.tags??previous?.tags??[],importedAt:previous?.importedAt??new Date().toISOString(),
      provenance:metadata?.provenance??previous?.provenance??{provider:'local',license:'user-provided'}};
    await mkdir(join(directory,'Catalog'),{recursive:true});await atomicWrite(catalog,JSON.stringify(asset,null,2));
  };
  if(await checksum(target).catch(()=>undefined)===hash){await saveCatalog();return target;}
  const temporary=join(directory,`${hash}.${randomUUID()}.copy`);
  try{
    await copyFile(source,temporary,constants.COPYFILE_EXCL);
    if(await checksum(temporary)!==hash)throw Error('Исходный трек изменился во время копирования. Повторите импорт.');
    await rename(temporary,target);
    await saveCatalog();
  }finally{await rm(temporary,{force:true}).catch(()=>undefined);}
  return target;
}
