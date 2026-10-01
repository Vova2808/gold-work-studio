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
