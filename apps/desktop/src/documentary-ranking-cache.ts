import {createHash} from 'node:crypto';
import {readFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {atomicWrite} from './fs-utils.js';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Reuse only explicit completed ids:[] decisions. Nonselected members of a
 * positive top-six list are NOT negatives. Callers must retain the original
 * request in their pending guards before submitting a reduced mixed pool. */
export async function documentaryNegativeRankingCache(root:string,system:string,input:string){
  const request=JSON.parse(input),candidates=request.candidates as Array<Record<string,unknown>>;
  const {candidates:_,...context}=request;
  const directory=join(root,'Documentary','RankingNegatives'),path=join(directory,hash([1,system,context])+'.json');
  const keys=candidates.map(hash);
  let saved:string[]=[];
  try{const value=JSON.parse(await readFile(path,'utf8'));if(value.version===1&&Array.isArray(value.keys)&&value.keys.every((k:unknown)=>typeof k==='string'&&/^[a-f0-9]{64}$/.test(k)))saved=value.keys;}catch{}
  const known=new Set(saved);
  return {
    allRejected:keys.length>0&&keys.every(k=>known.has(k)),
    remainingCandidates:candidates.filter((_,i)=>!known.has(keys[i]!)),
    async rememberEmpty(){
      await mkdir(directory,{recursive:true});
      // Read again in case another identical scene completed while awaiting AI.
      try{const value=JSON.parse(await readFile(path,'utf8'));if(value.version===1&&Array.isArray(value.keys))for(const k of value.keys)if(typeof k==='string'&&/^[a-f0-9]{64}$/.test(k))known.add(k);}catch{}
      keys.forEach(k=>known.add(k));
      await atomicWrite(path,JSON.stringify({version:1,keys:[...known].slice(-2500)}));
    }
  };
}

/** A completed positive shortlist remains worth an actual-frame inspection
 * when a search wave adds other candidates. Store only hashes of the exact
 * source and metadata under the unchanged scene context and ranking policy.
 * An inspected/rejected source is removed by the caller's normal tried set. */
export async function documentaryPositiveRankingCache(root:string,system:string,input:string,sourceKey:(id:string)=>string|undefined){
  const request=JSON.parse(input),candidates=request.candidates as Array<Record<string,unknown>>;
  const {candidates:_,...context}=request;
  const directory=join(root,'Documentary','RankingPositives'),path=join(directory,hash([1,system,context])+'.json');
  const fingerprints=new Map<string,string>();
  for(const candidate of candidates){
    const id=typeof candidate.id==='string'?candidate.id:undefined;
    const key=id?sourceKey(id):undefined;
    if(!id||!key)continue;
    const {id:__,...metadata}=candidate;
    fingerprints.set(id,hash([key,metadata]));
  }
  const read=async():Promise<string[]>=>{
    try{
      const value=JSON.parse(await readFile(path,'utf8'));
      return value.version===1&&Array.isArray(value.selected)
        ?value.selected.filter((item:unknown):item is string=>typeof item==='string'&&/^[a-f0-9]{64}$/.test(item)):[];
    }catch{return [];}
  };
  const saved=await read();
  const selected=saved.flatMap(fingerprint=>{
    const match=[...fingerprints].find(([,value])=>value===fingerprint);
    return match?[match[0]]:[];
  }).slice(0,6);
  return {selected,
    async remember(ids:string[]){
      const current=ids.flatMap(id=>fingerprints.has(id)?[fingerprints.get(id)!]:[]);
      if(!current.length)return;
      await mkdir(directory,{recursive:true});
      const merged=[...new Set([...current,...await read()])].slice(0,24);
      await atomicWrite(path,JSON.stringify({version:1,selected:merged}));
    }};
}
