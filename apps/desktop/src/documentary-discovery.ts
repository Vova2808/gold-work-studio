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
  /** Defer a weak precise batch until the broader pool is available. */
  firstBatchReady?:(candidates:DocumentaryCandidate[])=>boolean;
}):AsyncGenerator<DocumentaryCandidate[],void>{
  if(input.stopped())return;
  const youtube=input.kind==='video'&&input.youtubeQueries.length>0;
  const query=youtube?input.youtubeQueries[0]:input.queries[0];
  if(query){
    const first=await input.discover(query,youtube?['youtube']:input.kind==='image'?['commons']:['pexels','pixabay']);
    if(first.length&&input.firstBatchReady?.(first)!==false)yield first;
  }
  if(input.stopped())return;
  // Existing provider cache/single-flight reuses the first query. Archives,
  // alternate queries and shared media remain available when they are needed.
  const results=await Promise.allSettled([discoverDocumentarySources(input),input.supplement?.()??Promise.resolve([])]);
  const found:DocumentaryCandidate[]=[];
  for(const result of results){if(result.status==='rejected')throw result.reason;found.push(...result.value);}
  if(found.length)yield found;
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
