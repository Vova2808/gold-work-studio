import {createHash} from 'node:crypto';
import {mkdir,writeFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {freemem} from 'node:os';
import type {DocumentaryCandidate,Scene} from '@gold-work/shared';
import {rankDocumentaryLocalImages} from './documentary-local-vision.js';
import type {DocumentarySceneContext} from './documentary-scene-context.js';

const normalized=(text:string)=>text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
/** Exact source provenance only qualifies a download candidate. Neither this
 * check nor CLIP can approve the actual person/model/era or a video's range. */
export function documentaryLocalShortlistCandidates(scene:Scene,candidates:DocumentaryCandidate[],context?:DocumentarySceneContext):DocumentaryCandidate[]{
 const req=scene.documentary?.requirement;
 if(!req||req.identities?.length!==1)return [];
 // The planner can omit years while the original surrounding script dates the
 // event. CLIP sees the same rider/bike in 2004 and 2014 as similar. Keep these
 // candidates for semantic metadata ranking; do not guess a year across a
 // flashback, and do not buy full-frame reviews just to rediscover that mismatch.
 if(context&&[context.current,...context.preceding,...context.following,...context.earlierTimeReferences]
   .some(line=>/\b(?:1[0-9]|20)\d{2}\b/.test(line.text)))return [];
 const names=[req.identities[0]!.name,...req.identities[0]!.aliases].map(normalized)
   .filter(name=>name.split(' ').length>=2||name.length>=5&&/\d/.test(name));
 if(!names.length)return [];
 return candidates.filter(c=>{
   const title=` ${normalized(c.title)} `;
   return c.kind==='image'&&(c.previewUrl||c.localPath)&&names.some(name=>title.includes(` ${name} `))
     &&req.years.every(year=>`${c.title} ${c.description}`.includes(year));
 }).slice(0,8);
}

/** Downloads only bounded preview images, never original videos. Unavailable
 * previews, low similarity or low RAM use the existing semantic API ranking. */
export async function documentaryLocalShortlist(scene:Scene,candidates:DocumentaryCandidate[],root:string,notice:(s:string)=>void=()=>{},stopped:()=>boolean=()=>false,context?:DocumentarySceneContext):Promise<DocumentaryCandidate[]|undefined>{
 if(freemem()<2.5*1024**3||stopped())return;
 const eligible=documentaryLocalShortlistCandidates(scene,candidates,context);
 if(eligible.length<2)return;
 await mkdir(root,{recursive:true});
 const available:Array<{candidate:DocumentaryCandidate;path:string}>=[];
 for(let start=0;start<eligible.length&&!stopped();start+=2){
   const batch=await Promise.all(eligible.slice(start,start+2).map(async candidate=>{
     if(candidate.localPath)return {candidate,path:candidate.localPath};
     const path=join(root,`${createHash('sha256').update(candidate.previewUrl!).digest('hex')}.preview`);
     try{
       if(!await stat(path).then(s=>s.size>0,()=>false)){
         const response=await fetch(candidate.previewUrl!,{signal:AbortSignal.timeout(4000)});
         if(!response.ok||!response.body||!response.headers.get('content-type')?.startsWith('image/')||Number(response.headers.get('content-length')??0)>2*1024**2){
           await response.body?.cancel().catch(()=>{});return;
         }
         const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
         try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024**2)return;chunks.push(value);}}
         finally{await reader.cancel().catch(()=>{});}
         if(!size)return;await writeFile(path,Buffer.concat(chunks));
       }
       return {candidate,path};
     }catch{return;}
   }));
   available.push(...batch.filter((item):item is NonNullable<typeof item>=>Boolean(item)));
 }
 if(available.length<2||stopped())return;
 const req=scene.documentary!.requirement;
 const queries=[`a photograph of ${req.queries[0]??req.entities.join(' ')}`];
 const result=await rankDocumentaryLocalImages(available.map(item=>item.path),queries,join(root,'rgb'),notice);
 if(!result||stopped())return;
 const sorted=available.map((item,index)=>({...item,score:result.scores[index]?.[0]??0})).sort((a,b)=>b.score-a.score);
 // This threshold only decides whether to spend on the metadata shortlist.
 // Every returned original still undergoes the full existing visual review.
 if(sorted[0]!.score<.25)return;
 notice(`Локальный предварительный отбор: ${available.length} изображений за ${result.seconds.toFixed(1)} с. Проверяю оригиналы…`);
 return sorted.slice(0,4).map(item=>item.candidate);
}
