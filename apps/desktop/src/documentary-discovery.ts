import type {DocumentaryCandidate,DocumentarySearchInput} from '@gold-work/shared';

/** Independent source families overlap instead of waiting for slow archives.
 * Query order/count stay unchanged, so metadata checkpoint inputs remain stable. */
export async function discoverDocumentarySources(input:{
  queries:string[];stockQueries:string[];youtubeQueries:string[];
  discover:(query:string,providers:NonNullable<DocumentarySearchInput['providers']>)=>Promise<DocumentaryCandidate[]>;
  stopped:()=>boolean;
}):Promise<DocumentaryCandidate[]>{
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
