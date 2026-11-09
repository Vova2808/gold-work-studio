import {createHash} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
import {documentaryGeminiRetryBinding,type DocumentaryCandidate,type Project,type Scene} from '@gold-work/shared';
import {currentDocumentaryAiSearchPlan} from './documentary-ai-plan-state.js';
import {documentaryAutomaticMaterialReady} from './documentary-auto-readiness.js';
import {documentaryCheckedVideoCoverage} from './documentary-automatic-native-recovery.js';
import {claimDocumentaryThematicRecovery,documentaryAutomaticRecoveryPolicyIssue,documentaryThematicDiscoveryRequirement,documentaryThematicRecoveryBinding} from './documentary-automatic-thematic-recovery.js';
import {documentarySavedContextIssue} from './documentary-context-approval.js';
import {documentaryRequiredVisiblePart} from './documentary-detail-evidence.js';
import {documentaryCandidateKey} from './documentary-reuse.js';
import {atomicWrite} from './fs-utils.js';
import {checksumFile} from './effect-library.js';

type Review=NonNullable<NonNullable<Scene['documentary']>['visualReview']>;
/** Shared with the legacy quota selector: technical evidence/portraits stay stills. */
export function documentaryVideoQuotaProtectedTarget(scene:Scene):boolean {
  const req=scene.documentary?.requirement;
  const target=[scene.narration,req?.aiSearchPlan?.visualTarget,req?.detail,req?.footageFallback?.target].filter(Boolean).join(' ');
  return Boolean(documentaryRequiredVisiblePart(target)||/\b(?:diagram|cutaway|blueprint|document|portrait)\b|схем|чертеж|документ|портрет/iu.test(target));
}

export function documentaryVideoQuotaPhotoEligible(project:Project,scene:Scene):boolean {
  const doc=scene.documentary,plan=currentDocumentaryAiSearchPlan(project,scene);
  if(!doc||!documentaryAutomaticMaterialReady(scene)||doc.selected?.kind!=='image'||doc.selected.id.startsWith('manual:')
    ||!doc.visualReview?.illustrationApproval||!doc.visualReview.localReview||documentarySavedContextIssue(project,scene)
    ||!plan?.videoQueries.length||plan.videoQueries.some(query=>query.trim().length<2||query.length>240)
    ||doc.requirement.footageFallback||documentaryVideoQuotaProtectedTarget(scene))return false;
  // Evaluate the shared authored/composition policy without changing readiness.
  return !documentaryAutomaticRecoveryPolicyIssue(project,{...scene,documentary:{...doc,verified:false}});
}

export function documentaryVideoQuotaBinding(project:Project,scene:Scene):string {
  return createHash('sha256').update(JSON.stringify([documentaryThematicRecoveryBinding(project,scene),
    documentaryGeminiRetryBinding(project,scene),project.settings.stockVideoPercent,scene.audioPath,scene.narrationSlice,
    scene.documentary?.visualReview,scene.documentary?.manualReview,scene.documentary?.verified])).digest('hex');
}

export function documentaryVideoQuotaCurrent(project:Project,scene:Scene,binding:string):boolean {
  return documentaryVideoQuotaPhotoEligible(project,scene)&&documentaryVideoQuotaBinding(project,scene)===binding;
}

/** An authored reserve is a detached review task, never an unverified saved photo. */
export function documentaryVideoQuotaReserveScene(project:Project,scene:Scene,blockedSourceKeys:string[]=[]):Scene|undefined {
  if(!documentaryVideoQuotaPhotoEligible(project,scene))return;
  const projected=claimDocumentaryThematicRecovery(project,{...scene,documentary:{...scene.documentary!,verified:false}},blockedSourceKeys);
  if(documentaryThematicDiscoveryRequirement(project,projected)&&!documentaryVideoQuotaProtectedTarget(projected))return projected;
}

export function documentaryVideoQuotaMet(project:Project):boolean {
  const coverage=documentaryCheckedVideoCoverage(project);
  return project.settings.stockVideoPercent<=0||coverage.videoSeconds+1e-6>=coverage.totalSeconds*project.settings.stockVideoPercent/100;
}

async function currentFile(scene:Scene):Promise<boolean>{
  const file=scene.documentary?.selected?.kind==='video'?scene.videoPath:scene.imagePath,local=scene.documentary?.visualReview?.localReview;
  if(!file||!local)return false;
  const info=await stat(file,{bigint:true}).catch(()=>undefined);
  return Boolean(info?.isFile()&&info.size>0n&&local.size===String(info.size)&&local.mtimeNs===String(info.mtimeNs)&&local.ctimeNs===String(info.ctimeNs));
}

const fileRevision=(info:{size:bigint;mtimeNs:bigint;ctimeNs:bigint})=>JSON.stringify([String(info.size),String(info.mtimeNs),String(info.ctimeNs)]);
async function photoRevision(scene:Scene):Promise<string|undefined>{
  const file=scene.imagePath,doc=scene.documentary,local=doc?.visualReview?.localReview;
  if(!file||doc?.selected?.kind!=='image'||!local)return;
  const info=await stat(file,{bigint:true}).catch(()=>undefined);
  if(!info?.isFile()||info.size<=0n||local.size!==String(info.size)||local.mtimeNs!==String(info.mtimeNs))return;
  if(local.ctimeNs!==String(info.ctimeNs)){
    // Library maintenance may only change old-photo metadata. Prove identical
    // bytes once, then bind every new dispatch to this current full revision.
    if(!doc.checksum||await checksumFile(file)!==doc.checksum)return;
    const after=await stat(file,{bigint:true}).catch(()=>undefined);
    if(!after||fileRevision(after)!==fileRevision(info))return;
  }
  return fileRevision(info);
}
export async function documentaryQuotaPhotoFileCurrent(scene:Scene):Promise<boolean>{return Boolean(await photoRevision(scene));}

export interface DocumentaryQuotaBudget {
  photoBinding:string;
  deadline:number;
  signal:AbortSignal;
  remaining:()=>number;
  beforeSubmit:()=>Promise<void>;
  submit:()=>void;
}

export interface DocumentaryVideoQuotaRuntime {
  read:()=>Promise<Project>;
  guardPath:(sceneId:string,binding:string)=>string;
  sourceKeys:(candidate:DocumentaryCandidate,checksum?:string)=>string[];
  discover:(project:Project,scene:Scene,query:string,signal:AbortSignal)=>Promise<DocumentaryCandidate[]>;
  prepare:(project:Project,scene:Scene,candidate:DocumentaryCandidate,budget:DocumentaryQuotaBudget)=>Promise<Scene>;
  inspect:(project:Project,scene:Scene,budget:DocumentaryQuotaBudget)=>Promise<Review>;
  commit:(sceneId:string,binding:string,accepted:Scene,beforeCommit:()=>Promise<void>)=>Promise<boolean>;
  progress?:(scene:Scene,project:Project,result?:string)=>void;
}

/** One bounded pass; stop as soon as the saved timeline meets the quota. */
export async function completeDocumentaryVideoQuota(runtime:DocumentaryVideoQuotaRuntime,signal?:AbortSignal):Promise<Project>{
  const initial=await runtime.read();
  if(documentaryVideoQuotaMet(initial))return initial;
  const seconds=(scene:Scene)=>Math.max((scene.documentary?.timing?.durationInFrames??scene.durationSeconds*30)/30,scene.durationOverrideSeconds??0);
  const ids=initial.scenes.filter(scene=>documentaryVideoQuotaPhotoEligible(initial,scene))
    .sort((a,b)=>seconds(b)-seconds(a)||a.order-b.order).map(scene=>scene.id);
  const coverage=documentaryCheckedVideoCoverage(initial);
  if(initial.scenes.some(scene=>scene.includeInAssembly!==false&&!documentaryAutomaticMaterialReady(scene))
    ||coverage.videoSeconds+initial.scenes.filter(scene=>ids.includes(scene.id)).reduce((sum,scene)=>sum+seconds(scene),0)+1e-6
      <coverage.totalSeconds*initial.settings.stockVideoPercent/100)return initial;
  for(const id of ids){
    signal?.throwIfAborted();
    let project=await runtime.read();
    if(documentaryVideoQuotaMet(project))break;
    const original=project.scenes.find(scene=>scene.id===id);
    if(!original||!documentaryVideoQuotaPhotoEligible(project,original))continue;
    const reserve=Boolean(documentaryVideoQuotaReserveScene(project,original));
    const photoFile=await photoRevision(original);if(!photoFile)continue;
    runtime.progress?.(original,project);
    const binding=documentaryVideoQuotaBinding(project,original),file=runtime.guardPath(id,binding);
    const stored=await readFile(file,'utf8').then(text=>JSON.parse(text) as {version:number;keys:string[]},error=>{
      if(error.code==='ENOENT')return {version:1,keys:[]};throw error;
    });
    if(stored.version!==1||!Array.isArray(stored.keys)||stored.keys.some(key=>typeof key!=='string'))throw Error('Некорректный журнал попыток добора видео.');
    const blocked=new Set(stored.keys),durable=new Set(stored.keys);
    const target=reserve?documentaryVideoQuotaReserveScene(project,original,[...blocked])!:original;
    const queries=reserve?target.documentary!.requirement.footageFallback!.queries:currentDocumentaryAiSearchPlan(project,original)!.videoQueries;
    if(reserve)runtime.progress?.(original,project,'Добор по сохранённому AI-резерву (до 90 секунд / 3 источников)');
    const projected=(current:Project)=>({...current,scenes:current.scenes.map(scene=>scene.id===id?target:scene)});
    const remember=async(keys:string[])=>{keys.forEach(key=>durable.add(key));await atomicWrite(file,JSON.stringify({version:1,keys:[...durable]}),{durable:true,allowCopyFallback:false});};
    const timeout=new AbortController(),deadline=Date.now()+90_000;
    const timer=setTimeout(()=>timeout.abort(new DOMException('Время добора видео исчерпано.','TimeoutError')),90_000);timer.unref();
    const stopped=signal?AbortSignal.any([signal,timeout.signal]):timeout.signal;
    let attempts=0,submissions=0,accepted=false;
    const check=async()=>{
      stopped.throwIfAborted();
      if(Date.now()>=deadline)throw new DOMException('Время добора видео исчерпано.','TimeoutError');
      const latest=await runtime.read(),scene=latest.scenes.find(item=>item.id===id);
      const info=scene?.imagePath?await stat(scene.imagePath,{bigint:true}).catch(()=>undefined):undefined;
      if(!scene||!documentaryVideoQuotaCurrent(latest,scene,binding)||!info?.isFile()||fileRevision(info)!==photoFile)throw Error('Сцена изменилась во время добора видео.');
      return latest;
    };
    const budget:DocumentaryQuotaBudget={photoBinding:binding,deadline,signal:stopped,remaining:()=>stopped.aborted?0:Math.max(0,deadline-Date.now()),beforeSubmit:async()=>{await check();},
      submit:()=>{stopped.throwIfAborted();if(Date.now()>=deadline||submissions>=3)throw Error('Лимит добора видео исчерпан.');submissions++;}};
    try{
      const seen=new Set<string>();
      for(const query of queries){
        if(attempts>=3||accepted)break;
        project=await check();
        if(documentaryVideoQuotaMet(project)||attempts>=3||accepted)break;
        const candidates=await runtime.discover(projected(project),target,query,stopped);
        for(const candidate of candidates){
          if(attempts>=3||accepted||Date.now()>=deadline)break;
          project=await check();if(documentaryVideoQuotaMet(project))break;
          const key=documentaryCandidateKey(candidate),keys=runtime.sourceKeys(candidate);
          if(candidate.kind!=='video'||candidate.rights==='unknown'||seen.has(key)||keys.some(value=>blocked.has(value)))continue;
          seen.add(key);attempts++;
          await remember(keys); // Durably quarantine before preparation or paid I/O.
          let allKeys=keys;
          try{
            const prepared=await runtime.prepare(projected(project),target,candidate,budget);
            const doc=prepared.documentary;
            if(!doc?.selected||doc.selected.kind!=='video'||!prepared.videoPath||!doc.checksum)continue;
            allKeys=[...keys,...runtime.sourceKeys(doc.selected,doc.checksum)];
            if(allKeys.some(value=>blocked.has(value)))continue;
            await remember(allKeys);
            project=await check();
            if(!isDeepStrictEqual(doc.requirement,target.documentary!.requirement)||prepared.narration!==original.narration)continue;
            const candidateInfo=await stat(prepared.videoPath,{bigint:true}),candidateRevision=fileRevision(candidateInfo);
            if(!candidateInfo.isFile()||candidateInfo.size<=0n)continue;
            const candidateCheck=async()=>{
              const latest=await check();
              if(documentaryVideoQuotaMet(latest))throw Error('Требуемая доля видео уже достигнута.');
              const info=await stat(prepared.videoPath!,{bigint:true});
              if(!info.isFile()||fileRevision(info)!==candidateRevision)throw Error('Подготовленный видеофайл изменился до принятия.');
            };
            const review=await runtime.inspect({...project,scenes:project.scenes.map(scene=>scene.id===id?prepared:scene)},prepared,{...budget,beforeSubmit:candidateCheck});
            project=await check();
            if(review.status!=='accepted'||!review.illustrationApproval||!review.localReview)continue;
            const replacement:Scene={...original,imagePath:prepared.imagePath,videoPath:prepared.videoPath,stockSource:prepared.stockSource,stockAlternates:[],
              trimStartSeconds:review.trimStartSeconds??0,trimEndSeconds:review.trimEndSeconds,
              documentary:{...original.documentary!,requirement:target.documentary!.requirement,selected:doc.selected,checksum:doc.checksum,visualHash:doc.visualHash,visualReview:review,
                manualReview:undefined,nativeFallback:undefined,verified:true}};
            const trial={...project,scenes:project.scenes.map(scene=>scene.id===id?replacement:scene)};
            if(documentarySavedContextIssue(trial,replacement)||!await currentFile(replacement)
              ||documentaryCheckedVideoCoverage(trial).videoSeconds<=documentaryCheckedVideoCoverage(project).videoSeconds)continue;
            await check();
            accepted=await runtime.commit(id,binding,replacement,candidateCheck);
          }catch(error){signal?.throwIfAborted();runtime.progress?.(original,await runtime.read(),error instanceof Error?error.message:String(error));}
          finally{allKeys.forEach(value=>blocked.add(value));}
        }
      }
    }catch(error){signal?.throwIfAborted();runtime.progress?.(original,await runtime.read(),error instanceof Error?error.message:String(error));}
    finally{clearTimeout(timer);runtime.progress?.(original,await runtime.read(),accepted?'Видео принято':'Проверенное фото сохранено');}
  }
  signal?.throwIfAborted();
  return runtime.read();
}
