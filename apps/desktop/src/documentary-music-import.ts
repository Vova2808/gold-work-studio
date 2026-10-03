import {createHash,randomUUID} from 'node:crypto';
import {constants,createReadStream} from 'node:fs';
import {copyFile,mkdir,rename,rm,stat} from 'node:fs/promises';
import {extname,isAbsolute,join} from 'node:path';
import {probeEffectMedia} from './effect-media.js';
async function checksum(path:string){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}

/** Keep selected audio in the allowed media workspace, independent of Downloads. */
export async function importDocumentaryMusic(source:string,directory:string):Promise<string>{
  if(!isAbsolute(source)||!/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(source))throw Error('Выберите локальный аудиофайл');
  const info=await stat(source);if(!info.isFile()||!info.size||info.size>1024**3)throw Error('Музыкальный файл пустой или больше 1 ГБ');
  const media=await probeEffectMedia(source);if(!media.hasAudio||!media.durationSeconds)throw Error('В выбранном файле не найдена звуковая дорожка');
  const hash=await checksum(source);
  await mkdir(directory,{recursive:true});const target=join(directory,hash+extname(source).toLowerCase());
  if(await checksum(target).catch(()=>undefined)===hash)return target;
  const temporary=join(directory,`${hash}.${randomUUID()}.copy`);
  try{
    await copyFile(source,temporary,constants.COPYFILE_EXCL);
    if(await checksum(temporary)!==hash)throw Error('Исходный трек изменился во время копирования. Повторите импорт.');
    await rename(temporary,target);
  }finally{await rm(temporary,{force:true}).catch(()=>undefined);}
  return target;
}
