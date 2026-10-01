import {readFile,readdir,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import type {DocumentaryCandidate,DocumentaryRequirement,Project} from '@gold-work/shared';
import {atomicWrite} from './fs-utils.js';
import {documentaryCandidateKey} from './documentary-reuse.js';

type Recovery={previous:DocumentaryRequirement;restored:DocumentaryRequirement;sourceKeys:string[];checksums:string[]};
type Ledger={version:1;scenes:Record<string,Recovery>};
const ledgerPath=(root:string)=>join(root,'Documentary','context-recovery.json');
export async function readDocumentaryContextRecovery(root:string):Promise<Ledger>{
  return readFile(ledgerPath(root),'utf8').then(text=>JSON.parse(text) as Ledger,error=>{
    if(error.code==='ENOENT')return {version:1,scenes:{}};throw error;
  });
}

/** Restore only the exact footprint of the old inheritance bug, from paid
 * completed plans. Keep a before-image and quarantine previously considered
 * sources: a corrected context must not resend an unknown old visual request. */
export async function recoverDocumentaryPlanContext(project:Project,root:string,sceneIds?:string[]):Promise<Map<string,Recovery>>{
  const affected=project.scenes.filter(scene=>{
    const d=scene.documentary,r=d?.requirement;
    return d&&!d.pinned&&(!sceneIds||sceneIds.includes(scene.id))&&r?.plannedBy==='semantic'&&r.identityContextVersion===3
      &&r.text===scene.narration&&r.entities.length>0
      &&r.detail===`View of ${r.entities.join(' / ')} for the original narration's continuing reference`;
  });
  const result=new Map<string,Recovery>();if(!affected.length)return result;
  const ledger=await readDocumentaryContextRecovery(root);
  const plans=new Map<string,Array<Pick<DocumentaryRequirement,'entities'|'identities'|'queries'|'detail'>>>();
  const refinements=new Map<string,string[][]>();
  const analysis=join(root,'Documentary','Analysis');
  for(const file of await readdir(analysis).catch(error=>{if(error.code==='ENOENT')return [];throw error;})){
    if(!/^[a-f0-9]{64}\.json$/.test(file))continue;
    const saved=JSON.parse(await readFile(join(analysis,file),'utf8'));
    if(saved.state!=='complete'||!Array.isArray(saved.result?.scenes))continue;
    if(saved.purpose==='search-refinement'){
      for(const row of saved.result.scenes)if(typeof row.id==='string'&&Array.isArray(row.queries)&&row.queries.every((q:unknown)=>typeof q==='string')){
        const values=refinements.get(row.id)??[];values.push([...new Set<string>(row.queries.map((q:string)=>q.trim()).filter(Boolean).slice(0,3))]);refinements.set(row.id,values);
      }
      continue;
    }
    if(saved.purpose!=='search-plan')continue;
    for(const row of saved.result.scenes){
      if(!affected.some(s=>s.id===row.id)||!Array.isArray(row.entities)||row.entities.length||!Array.isArray(row.identities)||row.identities.length
        ||!Array.isArray(row.queries)||!row.queries.length||!row.queries.every((q:unknown)=>typeof q==='string'&&q.trim())||typeof row.detail!=='string')continue;
      const value={entities:[],identities:[],queries:row.queries.slice(0,3),detail:row.detail.slice(0,160)};
      const values=plans.get(row.id)??[];
      if(!values.some(v=>JSON.stringify(v)===JSON.stringify(value)))values.push(value);
      plans.set(row.id,values);
    }
  }
  for(const scene of affected){
    const d=scene.documentary!,previous=d.requirement,rows=plans.get(scene.id);
    if(rows?.length!==1)continue; // Ambiguous or missing history stays untouched.
    const refined=previous.searchRefined&&refinements.get(scene.id)?.some(queries=>JSON.stringify(queries)===JSON.stringify(previous.queries));
    if(!refined&&JSON.stringify(previous.queries)!==JSON.stringify(previous.entities.slice(0,3)))continue;
    const existing=ledger.scenes[scene.id];
    if(existing){if(JSON.stringify(existing.previous)===JSON.stringify(previous))result.set(scene.id,existing);continue;}
    const sourceKeys=new Set(d.candidates.map(documentaryCandidateKey));
    if(d.selected)sourceKeys.add(documentaryCandidateKey(d.selected));
    const checksums=new Set(d.checksum?[d.checksum]:[]);
    const directory=join(root,'Documentary',scene.id.replace(/[^a-zA-Z0-9_-]/g,'_'));
    for(const file of await readdir(directory).catch(error=>{if(error.code==='ENOENT')return [];throw error;})){
      const match=file.match(/^([a-f0-9]{64})\.source\.json$/);if(!match)continue;
      const source=JSON.parse(await readFile(join(directory,file),'utf8')) as DocumentaryCandidate;
      checksums.add(match[1]!);sourceKeys.add(documentaryCandidateKey(source));
    }
    const recovered:Recovery={previous,restored:{...previous,...rows[0],...(refined?{queries:previous.queries}:{})},sourceKeys:[...sourceKeys],checksums:[...checksums]};
    ledger.scenes[scene.id]=recovered;result.set(scene.id,recovered);
  }
  if(result.size){await mkdir(join(root,'Documentary'),{recursive:true});await atomicWrite(ledgerPath(root),JSON.stringify(ledger,null,2));}
  return result;
}
