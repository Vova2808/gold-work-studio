import type {DocumentaryCandidate,DocumentaryRequirement,DocumentarySearchResult} from '@gold-work/shared';
import {documentaryCandidateKey} from './documentary-reuse.js';
import {documentaryWorkLimits,DocumentaryBudgetExhausted} from './documentary-work-budget.js';
import {documentaryDiscoveryName} from './documentary-named-search.js';

const transferRecoveryDelayMs=5*60_000;
export type DocumentarySelectionBudgetSnapshot=Array<{key:string;attempts:number;analyses:number;searchMs:number}>;

/** Share a timed-out original between scenes, with one late read-only recovery. */
export class DocumentaryTransferFailures {
  private readonly entries=new Map<string,{failedAt:number;recoveryUsed:boolean;reusable?:boolean}>();
  constructor(private readonly now=Date.now) {}
  get size(){return this.entries.size;}
  has(key:string):boolean {
    const entry=this.entries.get(key);
    return Boolean(entry&&!entry.reusable&&(entry.recoveryUsed||this.now()-entry.failedAt<transferRecoveryDelayMs));
  }
  add(key:string) {
    if(!this.entries.has(key))this.entries.set(key,{failedAt:this.now(),recoveryUsed:false});
  }
  /** Called under the original's source lock when its transfer starts. */
  takeAttempt(key:string):boolean {
    const entry=this.entries.get(key);
    if(!entry)return true;
    if(entry.recoveryUsed||this.has(key))return false;
    entry.recoveryUsed=true;
    return true;
  }
  /** The catalog can supply the recovered original without another transfer. */
  complete(key:string) {
    const entry=this.entries.get(key);
    if(entry?.recoveryUsed)entry.reusable=true;
  }
}

/** Only discovery is shared. Identity, quality, trim and reuse are checked per scene. */
export class DocumentarySelectionSession {
  private searches=new Map<string,Promise<DocumentarySearchResult>>();
  private completedSearches=new Map<string,DocumentarySearchResult>();
  private completedVideos=new Map<string,DocumentaryCandidate[]>();
  private unavailableFormats=new Map<string,Set<string>>();
  private budgets=new Map<string,{started:number;attempts:number;searchMs:number;analyses:number}>();
  private paused=new Map<string,number>();
  private sceneStarted=new Map<string,number>();
  private blockedPhotoFallbacks=new Set<string>();
  private timedOutDownloads=new Set<string>();
  private debitWrites=Promise.resolve();
  /** Network failures expire with the run; a repaired proxy may retry next time. */
  readonly failedTransfers:DocumentaryTransferFailures;
  rememberDownloadTimeout(sceneId:string,provider:DocumentaryCandidate['provider']) {this.timedOutDownloads.add(`${sceneId}:${provider}`);}
  downloadTimedOut(sceneId:string,provider:DocumentaryCandidate['provider']) {return this.timedOutDownloads.has(`${sceneId}:${provider}`);}
  blockPhotoFallback(sceneId:string) {this.blockedPhotoFallbacks.add(sceneId);}
  photoFallbackBlocked(sceneId:string) {return this.blockedPhotoFallbacks.has(sceneId);}
  constructor(private readonly now=Date.now,persisted?:unknown,
    private readonly onDebit?:(snapshot:DocumentarySelectionBudgetSnapshot)=>Promise<void>) {
    this.failedTransfers=new DocumentaryTransferFailures(now);
    if(persisted===undefined)return;
    if(!Array.isArray(persisted))throw new DocumentaryBudgetExhausted('Сохранённый бюджет подбора повреждён; платный запрос не отправлен.');
    for(const row of persisted){
      if(!row||typeof row.key!=='string'||!/^.+:(?:image|video)$/.test(row.key)
        ||![row.attempts,row.analyses].every(value=>Number.isSafeInteger(value)&&value>=0)
        ||this.budgets.has(row.key))throw new DocumentaryBudgetExhausted('Сохранённый бюджет подбора повреждён; платный запрос не отправлен.');
      // Downtime is not active work, and provider search time is per run.
      this.budgets.set(row.key,{started:now(),attempts:row.attempts,analyses:row.analyses,searchMs:0});
    }
  }
  group(requirement:DocumentaryRequirement,kind:'image'|'video') {
    const names=[...(requirement.identities?.map(documentaryDiscoveryName)??[])].map(name=>name.trim().toLowerCase());
    const query=names.length?names[0]:requirement.queries[0]?.trim();
    return query?{key:JSON.stringify([kind,query,[...requirement.years].sort()]),query:[query,...requirement.years].join(' ').slice(0,240)}:undefined;
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
  rememberUnavailableFormat(selectorScope:string,candidateKey:string) {
    let keys=this.unavailableFormats.get(selectorScope);
    if(!keys){keys=new Set();this.unavailableFormats.set(selectorScope,keys);}
    keys.add(candidateKey);
  }
  isUnavailableFormat(selectorScope:string,candidateKey:string) {
    return this.unavailableFormats.get(selectorScope)?.has(candidateKey)??false;
  }
  budget(sceneId:string,kind:'image'|'video') {
    if(!this.sceneStarted.has(sceneId))this.sceneStarted.set(sceneId,this.paused.get(sceneId)??this.now());
    const key=`${sceneId}:${kind}`;
    let value=this.budgets.get(key);if(!value){value={started:this.paused.get(sceneId)??this.now(),attempts:0,searchMs:0,analyses:0};this.budgets.set(key,value);}
    return value;
  }
  remaining(sceneId:string,kind:'image'|'video') {
    const budget=this.budget(sceneId,kind),now=this.paused.get(sceneId)??this.now();
    return Math.max(0,Math.min(documentaryWorkLimits[kind].activeMs-(now-budget.started),
      documentaryWorkLimits.sceneMs-(now-this.sceneStarted.get(sceneId)!)));
  }
  canAttempt(sceneId:string,kind:'image'|'video') {
    return this.remaining(sceneId,kind)>0&&this.budget(sceneId,kind).attempts<documentaryWorkLimits[kind].attempts;
  }
  takeAttempt(sceneId:string,kind:'image'|'video') {
    const budget=this.budget(sceneId,kind);
    if(!this.canAttempt(sceneId,kind))return false;
    budget.attempts++;return true;
  }
  reuseAttempt(sceneId:string,kind:'image'|'video') {
    const budget=this.budget(sceneId,kind);budget.attempts=Math.max(0,budget.attempts-1);
  }
  extend(sceneId:string,kind:'image'|'video',ms:number) {this.budget(sceneId,kind).started+=ms;}
  pause(sceneId:string) {if(!this.paused.has(sceneId))this.paused.set(sceneId,this.now());}
  resume(sceneId:string) {
    const paused=this.paused.get(sceneId);if(paused===undefined)return;
    if(this.sceneStarted.has(sceneId))this.sceneStarted.set(sceneId,this.sceneStarted.get(sceneId)!+this.now()-paused);
    for(const kind of ['video','image'] as const){const value=this.budgets.get(`${sceneId}:${kind}`);if(value)value.started+=this.now()-paused;}
    this.paused.delete(sceneId);
  }
  async takeAnalysis(sceneId:string,kind:'image'|'video') {
    const budget=this.budget(sceneId,kind);
    if(this.remaining(sceneId,kind)<=0||budget.analyses>=documentaryWorkLimits[kind].analyses)throw new DocumentaryBudgetExhausted();
    budget.analyses++;
    // Persist the reservation before a paid dispatch. Keep failed debits spent:
    // an uncertain disk/network boundary must never silently replenish money.
    if(this.onDebit){
      const snapshot=this.snapshot();
      this.debitWrites=this.debitWrites.then(()=>this.onDebit!(snapshot));
      await this.debitWrites;
    }
  }
  snapshot():DocumentarySelectionBudgetSnapshot {return [...this.budgets].map(([key,value])=>({key,attempts:value.attempts,analyses:value.analyses,searchMs:value.searchMs}));}
  searchRemaining(sceneId:string,kind:'image'|'video') {
    return Math.max(0,documentaryWorkLimits[kind].searchMs-this.budget(sceneId,kind).searchMs);
  }
  accountSearch(sceneId:string,kind:'image'|'video',ms:number) {
    const budget=this.budget(sceneId,kind),elapsed=Math.max(0,ms);
    budget.searchMs+=elapsed;budget.started+=elapsed;
  }
  async drain(){
    await Promise.allSettled(this.searches.values());
    await this.debitWrites;
    if(this.onDebit)await this.onDebit(this.snapshot());
  }
}
