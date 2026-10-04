import type {DocumentaryCandidate,DocumentaryRequirement,DocumentarySearchResult} from '@gold-work/shared';
import {documentaryCandidateKey} from './documentary-reuse.js';

/** Only discovery is shared. Identity, quality, trim and reuse are checked per scene. */
export class DocumentarySelectionSession {
  private searches=new Map<string,Promise<DocumentarySearchResult>>();
  private completedSearches=new Map<string,DocumentarySearchResult>();
  private completedVideos=new Map<string,DocumentaryCandidate[]>();
  private budgets=new Map<string,{started:number;attempts:number;searchMs:number}>();
  constructor(private readonly now=Date.now) {}
  group(requirement:DocumentaryRequirement,kind:'image'|'video') {
    const names=[...(requirement.identities?.map(item=>item.name)??[])].map(name=>name.trim().toLowerCase()).sort();
    const query=names.length?names.join(' '):requirement.queries[0]?.trim();
    return query?{key:JSON.stringify([kind,names.length?names:query,[...requirement.years].sort()]),query:[query,...requirement.years].join(' ').slice(0,240)}:undefined;
  }
  related(requirement:DocumentaryRequirement,kind:'image'|'video',search:(query:string)=>Promise<DocumentarySearchResult>):Promise<DocumentarySearchResult> {
    const group=this.group(requirement,kind);
    if(!group)return Promise.resolve({candidates:[],sources:[]});
    let job=this.searches.get(group.key);
    if(!job){
      job=search(group.query).then(result=>{
        const seen=new Set<string>();
        const completed={...result,candidates:result.candidates.filter(candidate=>{
          const key=documentaryCandidateKey(candidate);if(seen.has(key))return false;seen.add(key);return true;
        }).slice(0,64)};
        this.completedSearches.set(group.key,completed);
        return completed;
      });
      this.searches.set(group.key,job);
    }
    // Callers must not mutate another scene's provenance/concerns/approval.
    return job.then(result=>structuredClone(result));
  }
  /** A completed scene search may already contain a short exact source for a
   * later scene about the same named subject. No search is started here. */
  rememberVideos(requirement:DocumentaryRequirement,candidates:DocumentaryCandidate[]) {
    if(!requirement.identities?.length)return;
    const group=this.group(requirement,'video');
    if(!group)return;
    const previous=this.completedVideos.get(group.key)??[];
    const seen=new Set(previous.map(documentaryCandidateKey));
    const next=[...previous];
    for(const candidate of candidates){
      if(next.length>=24)break;
      if(candidate.kind!=='video'||candidate.provider!=='youtube'||candidate.rights==='unknown')continue;
      const key=documentaryCandidateKey(candidate);
      if(seen.has(key))continue;
      seen.add(key);next.push(structuredClone(candidate));
    }
    if(next.length)this.completedVideos.set(group.key,next);
  }
  /** Reuse a completed shared search before spending another provider query.
   * An in-flight search never delays the current scene. */
  completedRelated(requirement:DocumentaryRequirement,kind:'image'|'video'):DocumentarySearchResult|undefined {
    const group=this.group(requirement,kind);
    const result=group&&this.completedSearches.get(group.key);
    const videos=kind==='video'&&group?this.completedVideos.get(group.key):undefined;
    if(!result&&!videos?.length)return undefined;
    const seen=new Set<string>();
    const candidates=[...(videos??[]),...(result?.candidates??[])].filter(candidate=>{
      const key=documentaryCandidateKey(candidate);if(seen.has(key))return false;seen.add(key);return true;
    }).slice(0,64);
    return structuredClone({candidates,sources:result?.sources??[]});
  }
  budget(sceneId:string,kind:'image'|'video') {
    const key=`${sceneId}:${kind}`;
    let value=this.budgets.get(key);if(!value){value={started:this.now(),attempts:0,searchMs:0};this.budgets.set(key,value);}
    return value;
  }
  remaining(sceneId:string,kind:'image'|'video') {
    return Math.max(0,(kind==='video'?120_000:60_000)-(this.now()-this.budget(sceneId,kind).started));
  }
  canAttempt(sceneId:string,kind:'image'|'video') {
    return this.remaining(sceneId,kind)>0&&this.budget(sceneId,kind).attempts<(kind==='video'?3:2);
  }
  takeAttempt(sceneId:string,kind:'image'|'video') {
    const budget=this.budget(sceneId,kind);
    if(!this.canAttempt(sceneId,kind))return false;
    budget.attempts++;return true;
  }
  extend(sceneId:string,kind:'image'|'video',ms:number) {this.budget(sceneId,kind).started+=ms;}
  searchRemaining(sceneId:string,kind:'image'|'video') {
    return Math.max(0,(kind==='video'?90_000:60_000)-this.budget(sceneId,kind).searchMs);
  }
  accountSearch(sceneId:string,kind:'image'|'video',ms:number) {
    const budget=this.budget(sceneId,kind),elapsed=Math.max(0,ms);
    budget.searchMs+=elapsed;budget.started+=elapsed;
  }
  async drain(){await Promise.allSettled(this.searches.values());}
}
