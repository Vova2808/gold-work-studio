import {createHash} from 'node:crypto';
import {mkdir,rename,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {effectFfmpeg} from './effect-media.js';
import {withDocumentaryFrameSlot} from './documentary-resources.js';

const pending=new Map<string,Promise<string>>();
/** Timeline tiles never need to decode the full original photograph. */
export async function timelineThumbnail(source:string,cache:string, requestedWidth = 240):Promise<string>{
  const width = [240,640,1280].includes(requestedWidth) ? requestedWidth : 240;
  const info=await stat(source);
  const key=createHash('sha256').update(`${source}|${info.size}|${info.mtimeMs}|${width}-v2`).digest('hex');
  const output=join(cache,`${key}.jpg`);
  if(pending.has(output))return pending.get(output)!;
  if(await stat(output).then(s=>s.size>0,()=>false))return output;
  const existing=pending.get(output);if(existing)return existing;
  const job=withDocumentaryFrameSlot(async()=>{
    await mkdir(cache,{recursive:true});
    const temporary=join(cache,`${key}.tmp.jpg`);
    await effectFfmpeg(['-y','-threads','1','-i',source,'-frames:v','1','-vf',`scale=${width}:${Math.ceil(width*9/16)}:force_original_aspect_ratio=decrease`,'-q:v','3',temporary]);
    await rename(temporary,output);
    return output;
  });
  pending.set(output,job);
  try{return await job;}finally{pending.delete(output);}
}
