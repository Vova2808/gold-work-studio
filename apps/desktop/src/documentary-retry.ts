import {createHash} from 'node:crypto';
import {mkdir,readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import type {DocumentaryRecoveryItem} from '@gold-work/shared';
import {atomicWrite} from './fs-utils.js';
import {documentaryJson} from './documentary-intelligence.js';

const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
/** Explicit, revision-bound permission. A stale dialog cannot release a newer
 * uncertain submission. Keep the exact old response and its receipt. */
export async function listDocumentaryRecovery(root:string):Promise<DocumentaryRecoveryItem[]> {
  const directory=join(root,'Documentary','Analysis');
  const files=await readdir(directory).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return [];throw e;});
  const result:DocumentaryRecoveryItem[]=[];
  for(const file of files.filter(f=>/^[a-f0-9]{64}\.json$/.test(f))){
    const raw=await readFile(join(directory,file),'utf8'),value=JSON.parse(raw);
    // A complete received response can be recovered locally by the normal
    // checkpoint reader. Never offer to pay for that response again.
    if(value.state==='received'&&typeof value.raw==='string'){
      try{documentaryJson(value.raw);continue;}catch{/* A malformed complete response still needs explicit recovery. */}
    }
    if(['pending','partial','received'].includes(value.state))result.push({id:file.slice(0,-5),revision:digest(raw),purpose:value.purpose??'analysis',state:value.state,
      characters:typeof value.raw==='string'?value.raw.length:0,createdAt:value.createdAt??''});
  }
  return result;
}
export class DocumentaryRetryPermissions {
  private runs=new Map<string,Promise<number>>();
  authorize(root:string,requested:DocumentaryRecoveryItem[]):Promise<number>{
    const active=this.runs.get(root);if(active)return active;
    const run=this.write(root,requested).finally(()=>{if(this.runs.get(root)===run)this.runs.delete(root);});
    this.runs.set(root,run);return run;
  }
  private async write(root:string,requested:DocumentaryRecoveryItem[]):Promise<number>{
    if(!requested.length||requested.length>1000)throw Error('Выберите незавершённые запросы для одного повтора.');
    const current=await listDocumentaryRecovery(root),directory=join(root,'Documentary','Analysis');
    const unique=[...new Map(requested.map(item=>[item.id,item])).values()];
    for(const item of unique)if(!current.some(c=>c.id===item.id&&c.revision===item.revision))throw Error('Состояние запросов изменилось. Обновите список перед подтверждением.');
    const approvedAt=new Date().toISOString();
    await mkdir(join(directory,'RetryHistory'),{recursive:true});
    for(const item of unique){
      const path=join(directory,`${item.id}.json`),raw=await readFile(path,'utf8');
      if(digest(raw)!==item.revision)throw Error('Запрос изменился; повтор не разрешён.');
      await atomicWrite(join(directory,'RetryHistory',`${item.id}-${item.revision}.json`),raw);
      await atomicWrite(join(directory,`${item.id}.retry-authorization.json`),JSON.stringify({approvedAt,maxAttempts:1,replacesRevision:item.revision}));
      await atomicWrite(path,JSON.stringify({state:'failed',purpose:item.purpose,approvedRetryAt:approvedAt,previousRevision:item.revision}));
    }
    return unique.length;
  }
}
