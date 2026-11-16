import {readFile,readdir,stat} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {atomicWrite} from './fs-utils.js';

// A small derived index over the original receipts. It never authorizes a
// submission: matching paid receipts and grants are still read at dispatch.
// Corruption is scoped to its own exact key, not every scene in the project.
export type DocumentaryJournalReceipt=Record<string,any>;
type Entry={key:string;revision:string;receipt?:DocumentaryJournalReceipt;corrupt?:boolean};
const cache=new Map<string,Map<string,{signature:string;entry:Entry}>>();
const runs=new Map<string,Promise<Entry[]>>();
export function readDocumentaryRequestJournal(directory:string):Promise<Entry[]> {
  const previous=runs.get(directory);
  const run=(async()=>{
    await previous?.catch(()=>{});
    const files=(await readdir(directory).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return [];throw error;}))
      .filter(name=>/^[a-f0-9]{64}\.json$/.test(name)).sort();
    const saved=cache.get(directory)??new Map<string,{signature:string;entry:Entry}>();
    const next=new Map<string,{signature:string;entry:Entry}>();
    let changed=saved.size!==files.length;
    for(const name of files){
      const path=join(directory,name),info=await stat(path,{bigint:true});
      const signature=[info.size,info.mtimeNs,info.ctimeNs].join(':');
      let row=saved.get(name);
      if(row?.signature!==signature){
        const raw=await readFile(path,'utf8'),key=name.slice(0,-5),revision=createHash('sha256').update(raw).digest('hex');
        let receipt:DocumentaryJournalReceipt|undefined;
        try{const value=JSON.parse(raw);if(value&&typeof value==='object'&&typeof value.state==='string')receipt=value;}catch{/* Keep a visible corrupt entry. */}
        row={signature,entry:{key,revision,...(receipt?{receipt}:{corrupt:true})}};changed=true;
      }
      next.set(name,row!);
    }
    cache.set(directory,next);
    const entries=[...next.values()].map(row=>row.entry);
    if(changed){
      const requests=entries.map(({key,revision,receipt,corrupt})=>({key,revision,...(corrupt?{state:'corrupt'}:{
        state:receipt!.state,purpose:receipt!.purpose,model:receipt!.model,checksum:receipt!.singleReviewBinding?.checksum,
        start:receipt!.singleReviewBinding?.start,end:receipt!.singleReviewBinding?.end,
        sceneId:receipt!.singleReviewBinding?.quality?.sceneId,narration:receipt!.singleReviewBinding?.quality?.narration,
        taskKey:receipt!.singleReviewBinding?.taskKey,verdictKey:receipt!.singleReviewBinding?.verdictKey,
        rejection:receipt!.rejection,createdAt:receipt!.createdAt,completedAt:receipt!.completedAt})}));
      // Keep the derived index outside Analysis: legacy readers enumerate that
      // directory as paid receipts, including versions that do not filter IDs.
      await atomicWrite(join(dirname(directory),'request-journal.json'),JSON.stringify({version:1,requests}),{durable:true,allowCopyFallback:false});
    }
    return entries;
  })();
  runs.set(directory,run);
  return run.finally(()=>{if(runs.get(directory)===run)runs.delete(directory);});
}

/** Terminal 200/DONE without a model result. A partial stream is never empty. */
export function documentaryKnownEmptyReceipt(receipt:DocumentaryJournalReceipt|undefined):boolean {
  return receipt?.purpose==='visual-illustration'&&receipt.raw===''
    &&receipt.completion?.disposition==='empty'&&receipt.completion.receivedCharacters===0
    &&typeof receipt.completedAt==='string'&&Number.isFinite(Date.parse(receipt.completedAt))
    &&(receipt.state==='rejected'&&receipt.rejection==='empty-response'||receipt.state==='complete'&&receipt.result?.status==='uncertain');
}
