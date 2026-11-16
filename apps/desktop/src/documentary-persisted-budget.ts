import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {atomicWrite} from './fs-utils.js';
import {DocumentarySelectionSession,type DocumentarySelectionBudgetSnapshot} from './documentary-selection-session.js';
import {DocumentaryBudgetExhausted,documentaryWorkLimits} from './documentary-work-budget.js';
import {readDocumentaryRequestJournal,type DocumentaryJournalReceipt} from './documentary-request-journal.js';
import {documentaryAdmissionNotDispatched} from './documentary-retry.js';

const writes=new Map<string,Promise<unknown>>();
type ReceiptMigration={version:1;scannedReceipts:number;attributedRequests:number;unattributedRequests:number};
type SavedBudget={version:1|2;scenes:DocumentarySelectionBudgetSnapshot;receiptMigration?:ReceiptMigration};
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');

async function readBudget(file:string):Promise<SavedBudget> {
  const raw=await readFile(file,'utf8').catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return;throw error;});
  if(raw===undefined)return {version:1,scenes:[]};
  const invalid=()=>new Error('Не удалось прочитать сохранённый бюджет проверок. Новые платные проверки остановлены; восстановите selection-budget.json.');
  let value;try{value=JSON.parse(raw);}catch{throw invalid();}
  if(![1,2].includes(value?.version)||value.version===2&&value.receiptMigration?.version!==1||!Array.isArray(value.scenes)||value.scenes.some((row:any)=>
    typeof row?.key!=='string'||!/:image$|:video$/.test(row.key)
    ||!Number.isSafeInteger(row.analyses)||row.analyses<0||!Number.isSafeInteger(row.attempts)||row.attempts<0))
    throw invalid();
  if(new Set(value.scenes.map((row:any)=>row.key)).size!==value.scenes.length)throw invalid();
  return value;
}

/** Import only requests with their own recoverable owner. A foreign/unbound
 * receipt cannot spend another scene's budget. Archived copies of the same
 * submission share identity; an actual authorized retry has a new createdAt. */
export async function documentaryHistoricalReviewBudget(root:string):Promise<{scenes:DocumentarySelectionBudgetSnapshot;migration:ReceiptMigration}> {
  const directory=join(root,'Documentary','Analysis');
  const project=await readFile(join(root,'project.json'),'utf8').then(raw=>{
    try{return JSON.parse(raw);}catch{return undefined;}
  },(error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return undefined;throw error;});
  const scenes:Array<{id:string;narration:string}>=Array.isArray(project?.scenes)?project.scenes.filter((row:any)=>typeof row?.id==='string'&&typeof row.narration==='string'):[];
  const entries=await readDocumentaryRequestJournal(directory);
  const history=join(directory,'RetryHistory');
  for(const name of await readdir(history).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return [];throw error;})){
    const match=/^([a-f0-9]{64})-([a-f0-9]{64})\.json$/.exec(name);if(!match)continue;
    const raw=await readFile(join(history,name),'utf8');
    let receipt:DocumentaryJournalReceipt|undefined;
    if(digest(raw)===match[2])try{const value=JSON.parse(raw);if(value&&typeof value.state==='string')receipt=value;}catch{/* Preserve an unattributed history entry. */}
    entries.push({key:match[1]!,revision:match[2]!,...(receipt?{receipt}:{corrupt:true})});
  }
  const requests=new Set<string>(),counts=new Map<string,number>();
  const migration:ReceiptMigration={version:1,scannedReceipts:entries.length,attributedRequests:0,unattributedRequests:0};
  for(const {key,revision,receipt} of entries){
    if(!receipt){migration.unattributedRequests++;continue;}
    if(!/^(?:visual-|catalog-|video-)/.test(receipt.purpose??''))continue;
    // Authorization is not a dispatch. Its archived prior receipt accounts for
    // the old payment whether or not the one-shot grant has been consumed.
    if(receipt.state==='failed'&&receipt.approvedRetryAt&&receipt.previousRevision&&!receipt.model&&!receipt.singleReviewBinding&&!receipt.raw)continue;
    if(await documentaryAdmissionNotDispatched(directory,key,receipt))continue;
    // The transport proof needs its original live verifier. Without that
    // verifier, an unsigned local-pre-dispatch marker cannot replenish budget.
    const identity=key+':'+(typeof receipt.createdAt==='string'&&receipt.createdAt?receipt.createdAt:revision);
    if(requests.has(identity))continue;requests.add(identity);
    const binding=receipt.singleReviewBinding,quality=binding?.quality;
    const explicit=quality?.sceneId??binding?.sceneId??receipt.sceneId;
    const owners=typeof explicit==='string'&&explicit?[explicit]:typeof quality?.narration==='string'
      ?[...new Set(scenes.filter(scene=>scene.narration===quality.narration).map(scene=>scene.id))]:[];
    const kind=binding?.mediaKind??receipt.mediaKind??(Number.isFinite(binding?.start)&&Number.isFinite(binding?.end)&&binding.start>=0
      ?binding.end>binding.start?'video':binding.start===0&&binding.end===0?'image':undefined:undefined);
    if(owners.length!==1||!['image','video'].includes(kind)){migration.unattributedRequests++;continue;}
    const budgetKey=owners[0]+':'+kind;counts.set(budgetKey,(counts.get(budgetKey)??0)+1);migration.attributedRequests++;
  }
  return {scenes:[...counts].map(([key,analyses])=>({key,analyses,attempts:0,searchMs:0})),migration};
}

async function serialized<T>(file:string,work:()=>Promise<T>):Promise<T> {
  const prior=writes.get(file)??Promise.resolve(),write=prior.catch(()=>{}).then(work);writes.set(file,write);
  try{return await write;}finally{if(writes.get(file)===write)writes.delete(file);}
}

/** Persist each new paid debit before dispatch, merging concurrent scene sessions. */
export async function persistentDocumentarySelectionSession(root:string,timed=true):Promise<DocumentarySelectionSession> {
  const file=join(root,'Documentary','selection-budget.json');
  const initial=await serialized(file,async()=>{
    const saved=await readBudget(file);
    if(saved.version===2)return saved.scenes;
    const historical=await documentaryHistoricalReviewBudget(root),merged=new Map(saved.scenes.map(row=>[row.key,row]));
    for(const row of historical.scenes){
      const before=merged.get(row.key);merged.set(row.key,before?{...before,analyses:Math.max(before.analyses,row.analyses)}:row);
    }
    const scenes=[...merged.values()];
    await atomicWrite(file,JSON.stringify({version:2,receiptMigration:historical.migration,limits:documentaryWorkLimits,scenes},null,2),{durable:true,allowCopyFallback:false});
    return scenes;
  }),accounted=new Map(initial.map(row=>[row.key,row.analyses]));
  return new DocumentarySelectionSession(timed?Date.now:()=>0,initial,async snapshot=>{
    await serialized(file,async()=>{
      const ledger=await readBudget(file),saved=new Map(ledger.scenes.map(row=>[row.key,row]));
      for(const row of snapshot){
        const delta=Math.max(0,row.analyses-(accounted.get(row.key)??0));
        const before=saved.get(row.key)??{key:row.key,attempts:0,analyses:0,searchMs:0};
        const kind=row.key.endsWith(':image')?'image':'video';
        if(delta&&before.analyses+delta>documentaryWorkLimits[kind].analyses)
          throw new DocumentaryBudgetExhausted('Общий лимит платных проверок этой сцены исчерпан. Готовые ответы сохранены; выберите материал вручную.');
        saved.set(row.key,{...row,attempts:Math.max(before.attempts,row.attempts),analyses:before.analyses+delta});
      }
      await atomicWrite(file,JSON.stringify({version:2,receiptMigration:ledger.receiptMigration,limits:documentaryWorkLimits,scenes:[...saved.values()]},null,2),
        {durable:true,allowCopyFallback:false});
      for(const row of snapshot)accounted.set(row.key,row.analyses);
    });
  });
}
