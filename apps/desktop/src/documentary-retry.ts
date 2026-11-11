import {createHash} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {mkdir,readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import type {DocumentaryAiSearchPlan,DocumentaryAiPlanGrounding,DocumentaryRecoveryItem} from '@gold-work/shared';
import {documentaryAiPlanGroundingIssue} from '@gold-work/shared';
import {documentaryJsonFormatIssue} from './documentary-json.js';
import {atomicWrite} from './fs-utils.js';
import {documentaryJson} from './documentary-intelligence.js';
import {DocumentaryAnalysisError} from './documentary-analysis-error.js';
import {documentaryCheckpointKey} from './documentary-checkpoint-key.js';

const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
async function routeRequestKeys(root:string):Promise<Set<string>> {
  const directory=join(root,'Documentary','RouteComparisons');
  const files=await readdir(directory).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return [];throw e;});
  const keys=new Set<string>();
  for(const file of files){
    const match=/^([a-f0-9]{64})-(primary|correction)-request\.json$/.exec(file);
    if(!match)continue;
    try{
      const request=JSON.parse(await readFile(join(directory,file),'utf8'));
      if(request?.binding!==match[1]||typeof request.system!=='string'||typeof request.input!=='string')continue;
      const input=JSON.parse(request.input);
      if(input?.routeComparison!==1||typeof input.sceneId!=='string'||!input.sceneId
        ||(match[2]==='correction'?input.routeComparisonCorrection!==1:input.routeComparisonCorrection!==undefined))continue;
      keys.add(documentaryCheckpointKey('semantic-montage',request.system,request.input,[]));
    }catch(error){if(error instanceof SyntaxError)continue;throw error;}
  }
  return keys;
}
export type DocumentarySelectionRetryGrant = {
  id: string;
  revision: string;
  approvedAt: string;
  priorState: 'pending'|'partial'|'received';
  model: string;
  binding: {checksum:string;taskKey:string;start:number;end:number};
  /** Only a terminal, incomplete response with the original narrated task. */
  groundedNarration?:string;
};

async function readSelectionAuthorization(directory:string,id:string):Promise<
  {grant:DocumentarySelectionRetryGrant;available:boolean;completed:boolean}|undefined
>{
  if(!/^[a-f0-9]{64}$/.test(id))return;
  const read=async(file:string)=>readFile(file,'utf8').catch((error:NodeJS.ErrnoException)=>{
    if(error.code==='ENOENT')return undefined;
    throw error;
  });
  const [stateText,grantText]=await Promise.all([read(join(directory,id+'.json')),read(join(directory,id+'.retry-authorization.json'))]);
  if(!stateText||!grantText)return;
  try {
    const state=JSON.parse(stateText),grant=JSON.parse(grantText);
    if(state?.purpose!=='visual-illustration'||typeof grant?.approvedAt!=='string'||!grant.approvedAt
      ||grant.maxAttempts!==1||typeof grant.replacesRevision!=='string'||!/^[a-f0-9]{64}$/.test(grant.replacesRevision))return;
    const available=state.state==='failed'&&state.approvedRetryAt===grant.approvedAt
      &&state.previousRevision===grant.replacesRevision&&grant.consumedAt===undefined;
    const completed=state.state==='complete'&&Boolean(state.result)&&typeof grant.consumedAt==='string'&&Boolean(grant.consumedAt);
    if(!available&&!completed)return;
    const archived=await read(join(directory,'RetryHistory',`${id}-${grant.replacesRevision}.json`));
    if(!archived||digest(archived)!==grant.replacesRevision)return;
    const prior=JSON.parse(archived),binding=prior?.singleReviewBinding;
    if(prior?.purpose!==state.purpose||!['pending','partial','received'].includes(prior.state)
      ||typeof prior.model!=='string'||!prior.model||typeof binding?.checksum!=='string'||!/^[a-f0-9]{64}$/.test(binding.checksum)
      ||typeof binding.taskKey!=='string'||!/^[a-f0-9]{64}$/.test(binding.taskKey)
      ||!Number.isFinite(binding.start)||!Number.isFinite(binding.end)||binding.start<0||binding.end<binding.start)return;
    if(prior.state==='received'){
      if(typeof prior.raw!=='string')return;
      try{documentaryJson(prior.raw);return;}catch{/* Only an unresolved response is eligible. */}
    }
    return {available,completed,grant:{id,revision:grant.replacesRevision,approvedAt:grant.approvedAt,priorState:prior.state,model:prior.model,
      binding:{checksum:binding.checksum,taskKey:binding.taskKey,start:binding.start,end:binding.end},
      ...(prior.state==='received'&&documentaryJsonFormatIssue(prior.raw)==='incomplete-json'
        &&typeof binding.quality?.narration==='string'&&binding.quality.narration.trim()
        ?{groundedNarration:binding.quality.narration}:{})}};
  } catch(error) {
    if(error instanceof SyntaxError)return;
    throw error;
  }
}

export async function readDocumentarySelectionRetryGrant(directory:string,id:string):Promise<DocumentarySelectionRetryGrant|undefined>{
  const authorization=await readSelectionAuthorization(directory,id);
  if(authorization?.available)return authorization.grant;
}

export const documentarySelectionRetry = new AsyncLocalStorage<
  {grant:DocumentarySelectionRetryGrant;probe:boolean}|{cached:{matched:boolean}}
>();
export class DocumentarySelectionRetryProbePassed extends Error {}

type RetryRequest={id:string;purpose:string;model?:string;binding?:{checksum:string;taskKey?:string;start:number;end:number};legacyTaskKey?:string;existing:boolean;
  groundedTask?:{sceneId:string;narration:string;originalScript:string;grounding:DocumentaryAiPlanGrounding}};

/** The caller supplies the canonical request, after the ordinary unknown guards. */
export async function checkDocumentarySelectionRetry(directory:string,request:RetryRequest):Promise<'exact'|'narrative'|'grounded'|undefined>{
  const scope=documentarySelectionRetry.getStore();
  if(!scope||!('grant' in scope))return;
  const {grant}=scope,binding=request.binding;
  const mismatch=()=>new DocumentaryAnalysisError('Разрешение повтора не совпадает с текущим запросом проверки материала. Оплата не выполнена.','pending',request.purpose);
  if(request.purpose!=='visual-illustration'||request.model!==grant.model||!binding
    ||binding.checksum!==grant.binding.checksum||binding.start!==grant.binding.start||binding.end!==grant.binding.end)throw mismatch();
  const exact=request.id===grant.id&&binding.taskKey===grant.binding.taskKey;
  // Only a received terminal answer can release the old source quarantine for
  // the same visual question with the newly added narrative criterion.
  const narrative=request.id!==grant.id&&!request.existing&&grant.priorState==='received'&&Boolean(binding.taskKey)
    &&binding.taskKey!==grant.binding.taskKey&&request.legacyTaskKey===grant.binding.taskKey;
  const task=request.groundedTask;
  const grounded=request.id!==grant.id&&!request.existing&&grant.priorState==='received'&&Boolean(binding.taskKey)
    &&binding.taskKey!==grant.binding.taskKey&&Boolean(grant.groundedNarration)&&task
    &&typeof task.sceneId==='string'&&Boolean(task.sceneId.trim())&&task.narration===grant.groundedNarration
    &&typeof task.originalScript==='string'&&task.originalScript.includes(task.narration)
    &&!documentaryAiPlanGroundingIssue({grounding:task.grounding,years:[]} as unknown as DocumentaryAiSearchPlan,task.originalScript);
  if(!exact&&!narrative&&!grounded)throw mismatch();
  const current=await readDocumentarySelectionRetryGrant(directory,grant.id);
  if(!current||current.revision!==grant.revision||current.approvedAt!==grant.approvedAt)throw mismatch();
  if(narrative||grounded){
    // A different file revision or prompt key must not commission this same
    // narrative check a second time after its first dispatch.
    for(const file of await readdir(directory)){
      if(!/^[a-f0-9]{64}\.json$/.test(file))continue;
      const receipt=JSON.parse(await readFile(join(directory,file),'utf8'));
      const prior=receipt?.singleReviewBinding;
      if(receipt?.purpose===request.purpose&&receipt.model===request.model&&prior?.checksum===binding.checksum
        &&prior.start===binding.start&&prior.end===binding.end
        &&(prior.taskKey===binding.taskKey||grounded&&prior.groundedRetryOrigin===grant.id))throw mismatch();
    }
  }
  if(scope.probe)throw new DocumentarySelectionRetryProbePassed();
  return exact?'exact':grounded?'grounded':'narrative';
}

export async function readDocumentarySelectionRetryEvidence(root:string,model:string){
  const directory=join(root,'Documentary','Analysis');
  const files=await readdir(directory).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return [];throw error;});
  const ids=files.flatMap(file=>/^([a-f0-9]{64})\.retry-authorization\.json$/.exec(file)?.[1]??[]);
  const grants:DocumentarySelectionRetryGrant[]=[];
  const cachedChecksums=new Set<string>();
  for(const authorization of await Promise.all(ids.map(id=>readSelectionAuthorization(directory,id)))){
    if(!authorization||authorization.grant.model!==model)continue;
    const {grant,available,completed}=authorization;
    if(available)grants.push(grant);
    // The completed narrative evaluation has a separate receipt, so its
    // former received grant is still available. Only a cache probe can admit it.
    if(completed||available&&grant.priorState==='received')cachedChecksums.add(grant.binding.checksum);
  }
  return {grants,cachedChecksums};
}

/** Explicit, revision-bound permission. A stale dialog cannot release a newer
 * uncertain submission. Keep the exact old response and its receipt. */
export async function listDocumentaryRecovery(root:string):Promise<DocumentaryRecoveryItem[]> {
  const directory=join(root,'Documentary','Analysis');
  const files=await readdir(directory).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return [];throw e;});
  // Route receipts deliberately forbid automatic retries even after a definite
  // failure. Their durable request manifests identify the two eligible tasks.
  const routeKeys=await routeRequestKeys(root);
  const result:DocumentaryRecoveryItem[]=[];
  for(const file of files.filter(f=>/^[a-f0-9]{64}\.json$/.test(f))){
    const raw=await readFile(join(directory,file),'utf8'),value=JSON.parse(raw);
    // A complete received response can be recovered locally by the normal
    // checkpoint reader. Never offer to pay for that response again.
    if(value.state==='received'&&typeof value.raw==='string'){
      try{documentaryJson(value.raw);continue;}catch{/* A malformed complete response still needs explicit recovery. */}
    }
    if(['pending','partial','received'].includes(value.state)
      ||value.state==='failed'&&value.purpose==='semantic-montage'&&routeKeys.has(file.slice(0,-5)))result.push({id:file.slice(0,-5),revision:digest(raw),purpose:value.purpose??'analysis',state:value.state,
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
    if(!requested.length||requested.length>1000)throw Error('Выберите сохранённые запросы для одного повтора.');
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
