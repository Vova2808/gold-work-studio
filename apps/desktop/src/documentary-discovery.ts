import type {DocumentaryCandidate,DocumentarySearchInput} from '@gold-work/shared';

type DiscoveryInput={
  queries:string[];stockQueries:string[];youtubeQueries:string[];
  discover:(query:string,providers:NonNullable<DocumentarySearchInput['providers']>)=>Promise<DocumentaryCandidate[]>;
  stopped:()=>boolean;
};

/** The consumer requests the broad wave only after rejecting precise results.
 * Accepting a source never starts unused archive queries or background jobs. */
export async function* discoverDocumentarySourceBatches(input:DiscoveryInput&{
  kind:'image'|'video';supplement?:()=>Promise<DocumentaryCandidate[]>;
  /** Previously completed discovery can be inspected before a fresh query. */
  reused?:DocumentaryCandidate[];
  /** Defer a weak precise batch until the broader pool is available. */
  firstBatchReady?:(candidates:DocumentaryCandidate[])=>boolean;
  /** For a detail-critical image, keep accumulating instead of paying to rank
   * successive batches that still contain no plausible depiction. */
  deferredBatchReady?:(candidates:DocumentaryCandidate[])=>boolean;
  /** Briefly combine already-running source families before paid ranking. */
  coalesceMs?:number;
}):AsyncGenerator<DocumentaryCandidate[],void>{
  if(input.stopped())return;
  const youtube=input.kind==='video'&&input.youtubeQueries.length>0;
  const query=youtube?input.youtubeQueries[0]:input.queries[0];
  let deferred:DocumentaryCandidate[]=[];
  const yielded=new Set<string>();
  const fresh=(candidates:DocumentaryCandidate[])=>{
    const seen=new Set(yielded);
    return candidates.filter(candidate=>!seen.has(candidate.id)&&(seen.add(candidate.id),true));
  };
  if(input.reused?.length){
    if(input.firstBatchReady?.(input.reused)===false)deferred=input.reused;
    else {const batch=fresh(input.reused);batch.forEach(candidate=>yielded.add(candidate.id));if(batch.length)yield batch;}
  }
  if(input.stopped())return;
  if(query){
    const first=await input.discover(query,youtube?['youtube']:input.kind==='image'?['commons']:['pexels','pixabay']);
    if(first.length){
      const combined=[...deferred,...first];
      if(input.firstBatchReady?.(combined)===false)deferred=combined;
      else {deferred=[];const batch=fresh(combined);batch.forEach(candidate=>yielded.add(candidate.id));if(batch.length)yield batch;}
    }
  }
  if(input.stopped())return;
  // Inspect each completed source wave while slower providers keep searching.
  // A rejected first batch is held until another source adds a new candidate.
  // Returning after acceptance prevents dispatch of further query waves.
  const lanes=[
    {queries:input.stockQueries,providers:['pexels','pixabay'] as NonNullable<DocumentarySearchInput['providers']>,offset:0},
    {queries:input.queries,providers:['commons','internet-archive','local','pexels','pixabay'] as NonNullable<DocumentarySearchInput['providers']>,offset:0},
    // The first YouTube query already completed above with this same provider.
    // Repeating it here adds no candidates and can spend scarce search quota.
    {queries:input.youtubeQueries,providers:['youtube'] as NonNullable<DocumentarySearchInput['providers']>,offset:youtube?1:0},
  ];
  type Batch={index:number;candidates:DocumentaryCandidate[];error?:unknown};
  const pending=new Map<number,Promise<Batch>>();
  let cancelled=false,supplementStarted=false;
  const stopped=()=>cancelled||input.stopped();
  const schedule=(index:number)=>{
    if(stopped())return;
    if(index===lanes.length){
      if(supplementStarted||!input.supplement)return;
      supplementStarted=true;
      pending.set(index,input.supplement().then(candidates=>({index,candidates}),error=>({index,candidates:[],error})));
      return;
    }
    const lane=lanes[index]!;
    if(lane.offset>=lane.queries.length)return;
    const queries=lane.queries.slice(lane.offset,lane.offset+2);lane.offset+=2;
    pending.set(index,Promise.allSettled(queries.map(q=>input.discover(q,lane.providers))).then(results=>{
      const candidates:DocumentaryCandidate[]=[];
      for(const result of results){if(result.status==='rejected')return {index,candidates:[],error:result.reason};candidates.push(...result.value);}
      return {index,candidates};
    }));
  };
  for(let index=0;index<=lanes.length;index++)schedule(index);
  try{
    while(pending.size&&!stopped()){
      const batch=await Promise.race(pending.values());pending.delete(batch.index);
      const wave=[batch],until=Date.now()+Math.min(500,Math.max(0,input.coalesceMs??0));
      // Do not dispatch the next query wave until the consumer rejects this
      // one. Only combine requests that were already in flight; a slow archive
      // can delay a ready stock clip by at most this small window.
      while(pending.size&&!stopped()&&Date.now()<until){
        let timer:ReturnType<typeof setTimeout>|undefined;
        const timeout=new Promise<undefined>(resolve=>{timer=setTimeout(()=>resolve(undefined),until-Date.now());});
        const next=await Promise.race<Batch|undefined>([...pending.values(),timeout]);
        if(timer)clearTimeout(timer);
        if(!next)break;
        pending.delete(next.index);wave.push(next);
      }
      if(batch.error)throw batch.error;
      const laterError=wave.slice(1).find(part=>part.error)?.error;
      const discovered=wave.flatMap(part=>part.candidates);
      if(discovered.length){
        if(deferred.length){
          const oldIds=new Set(deferred.map(candidate=>candidate.id));
          if(discovered.some(candidate=>!oldIds.has(candidate.id))){
            const combined=fresh([...deferred,...discovered]);deferred=[];
            if(!laterError&&input.deferredBatchReady?.(combined)===false)deferred=combined;
            else {combined.forEach(candidate=>yielded.add(candidate.id));if(combined.length)yield combined;}
          }
        }else {const novel=fresh(discovered);novel.forEach(candidate=>yielded.add(candidate.id));if(novel.length)yield novel;}
      }
      // A simultaneous provider failure must not hide a ready usable source.
      // Surface the error only if the consumer rejects that source and asks
      // for another wave; accepting it closes the iterator before this line.
      if(laterError)throw laterError;
      for(const part of wave)schedule(part.index);
    }
    if(deferred.length&&!stopped()){const batch=fresh(deferred);if(batch.length)yield batch;}
  }finally{cancelled=true;}
}

/** Independent source families overlap instead of waiting for slow archives.
 * Query order/count stay unchanged, so metadata checkpoint inputs remain stable. */
export async function discoverDocumentarySources(input:DiscoveryInput):Promise<DocumentaryCandidate[]>{
  const lane=async(queries:string[],providers:NonNullable<DocumentarySearchInput['providers']>)=>{
    const result:DocumentaryCandidate[]=[];
    for(let offset=0;offset<queries.length&&!input.stopped();offset+=2){
      const batch=await Promise.allSettled(queries.slice(offset,offset+2).map(query=>input.discover(query,providers)));
      for(const item of batch){if(item.status==='rejected')throw item.reason;result.push(...item.value);}
    }
    return result;
  };
  const results=await Promise.allSettled([
    lane(input.stockQueries,['pexels','pixabay']),
    lane(input.queries,['commons','internet-archive','local','pexels','pixabay']),
    lane(input.youtubeQueries,['youtube']),
  ]);
  const found:DocumentaryCandidate[]=[];
  for(const result of results){if(result.status==='rejected')throw result.reason;found.push(...result.value);}
  return found;
}
