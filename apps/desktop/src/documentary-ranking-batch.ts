import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {atomicWrite} from './fs-utils.js';
import {AnyModelOutputFormatError} from './anymodel-client.js';

type Item={system:string;input:string;onPartial:(raw:string)=>void;onBatch:(file:string,member:number)=>Promise<void>;resolve:(raw:string)=>void;reject:(error:unknown)=>void};
export const documentaryRankingResponseInstruction=' This request ranks METADATA ONLY: return exactly {"ids":["up to six supplied IDs"],"reason":"at most 20 words"}. No markdown or other fields. Visual-review schemas in the instructions apply only to the later actual-frame inspection: do not fill generalDiagram, identityMatch, narrativeEvidence, annotations or technicalQuality from titles/descriptions.';
/** Each caller already saved its own pending checkpoint before joining. A
 * broken batch never transfers another member's text/IDs into that checkpoint. */
export class DocumentaryRankingBatch {
  private queues=new Map<string,{items:Item[];timer:ReturnType<typeof setTimeout>}>();
  constructor(private readonly send:(system:string,input:string,model:string|undefined,onPartial:(raw:string)=>void)=>Promise<string>,
    private readonly rootFor:(projectId:string)=>string) {}
  request(projectId:string,model:string|undefined,system:string,input:string,onPartial:(raw:string)=>void,onBatch:Item['onBatch']):Promise<string> {
    return new Promise((resolve,reject)=>{
      const key=JSON.stringify([projectId,model]);
      let queue=this.queues.get(key);
      if(!queue){queue={items:[],timer:setTimeout(()=>void this.flush(key,projectId,model),40)};this.queues.set(key,queue);}
      queue.items.push({system,input,onPartial,onBatch,resolve,reject});
      if(queue.items.length>=4)void this.flush(key,projectId,model);
    });
  }
  private async flush(key:string,projectId:string,model:string|undefined) {
    const queue=this.queues.get(key);if(!queue)return;
    this.queues.delete(key);clearTimeout(queue.timer);
    const items=queue.items;
    if(items.length===1){
      const item=items[0]!;
      // Add a response hint only when submitting, after the caller checked its
      // existing checkpoint. Never repay an old request to change formatting.
      try{item.resolve(await this.send(item.system+documentaryRankingResponseInstruction,item.input,model,item.onPartial));}catch(error){item.reject(error);}
      return;
    }
    const content=JSON.stringify({requests:items.map((item,id)=>({id,instructions:item.system,data:JSON.parse(item.input)}))});
    const batchId=createHash('sha256').update(JSON.stringify([model,content])).digest('hex');
    const path=join(this.rootFor(projectId),'Documentary','Analysis',`ranking-batch-${batchId}.json`);
    let raw='';
    try {
      await Promise.all(items.map((item,id)=>item.onBatch(`ranking-batch-${batchId}.json`,id)));
      await atomicWrite(path,JSON.stringify({state:'pending',model,members:items.length,createdAt:new Date().toISOString()}));
      raw=await this.send('Rank the candidates for EACH independent request using its instructions and data. Return JSON only: {"results":[{"id":0,"ids":["candidate id from THIS request only"]}]}. Include each request id exactly once, with at most six candidate IDs. Never transfer a subject, constraint or candidate between requests. An empty ids array is a valid rejection. Metadata is a download shortlist, not visual approval. No explanations or markdown.',content,model,value=>{raw=value;});
      await atomicWrite(path,JSON.stringify({state:'received',model,members:items.length,raw}));
      const value=JSON.parse(raw.replace(/^\s*```(?:json)?\s*/i,'').replace(/\s*```\s*$/,''));
      if(!Array.isArray(value.results)||value.results.length!==items.length)throw new Error('Incomplete ranking batch');
      const outputs=items.map((item,id)=>{
        const rows=value.results.filter((row:any)=>row.id===id);
        const allowed=new Set(JSON.parse(item.input).candidates.map((candidate:any)=>candidate.id));
        if(rows.length!==1||!Array.isArray(rows[0].ids)||rows[0].ids.length>6||rows[0].ids.some((candidate:unknown)=>typeof candidate!=='string'||!allowed.has(candidate)))throw new Error('Invalid ranking member');
        return JSON.stringify({ids:rows[0].ids});
      });
      await atomicWrite(path,JSON.stringify({state:'complete',model,members:items.length,raw,outputs:outputs.map(value=>JSON.parse(value))}));
      items.forEach((item,index)=>item.resolve(outputs[index]!));
    } catch(error) {
      if(raw)await atomicWrite(path,JSON.stringify({state:'received',model,members:items.length,raw,error:String(error)})).catch(()=>{});
      // An output/transport error leaves every child pending. A definite HTTP
      // refusal remains definite and may follow the existing bounded retry.
      const failure=raw?new AnyModelOutputFormatError('Пакет предварительного отбора не завершён; ответ сохранён без повторной оплаты'):error;
      for(const item of items)item.reject(failure);
    }
  }
}
