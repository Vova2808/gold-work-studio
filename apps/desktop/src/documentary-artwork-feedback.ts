import {createHash} from 'node:crypto';
import {mkdir,open,readFile,readdir} from 'node:fs/promises';
import {isAbsolute,join,relative,resolve} from 'node:path';
import type {DocumentaryArtwork,DocumentaryArtworkFeedback,Project} from '@gold-work/shared';
import {documentaryAiPlanContext} from '@gold-work/shared';
import {atomicWrite} from './fs-utils.js';
import {documentaryCheckpointKey} from './documentary-checkpoint-key.js';
import {artworkSceneEditable,motionArtworkHash,validateMotionArtwork} from './documentary-artwork-plan.js';
import {artworkSourceCandidates,motionArtworkPreviews} from './documentary-artwork-previews.js';
import {artworkForRevision,motionArtworkFeedbackSystem,preserveArtworkManualLayers,validateArtworkRevisionPreviews,type ArtworkRevisionHooks} from './documentary-artwork-revision.js';
import {montageFrames} from './documentary-semantic-montage.js';
import {reviewArtworkTemporal} from './documentary-artwork-temporal-review.js';
import {assessArtworkReplacement} from './documentary-artwork-quality.js';

export type FeedbackRow={sceneId:string;artwork:DocumentaryArtwork;artworkSpan?:{endSceneId:string}};
type Parent={analysisKey:string;inputSha256:string;resultSha256:string;files:Array<{path:string;sha256:string}>};
type Request={version:1;operationKey:string;projectId:string;feedback:string;normalizedFeedback:string;
  protectedInput:unknown;protectedInputHash:string;base:FeedbackRow[];baseArtworkHash:string;parents:Parent[];
  system:string;input:string;images:string[];imageHashes:string[];inputSha256:string;analysisKey:string};
export type ArtworkFeedbackPlan={version:1;validationVersion:13;inputHash:string;model:string;scenes:FeedbackRow[];
  rejected:Array<{sceneId:string;reason:string}>;feedback:DocumentaryArtworkFeedback;retryLocalPreview?:boolean};
export type ArtworkFeedbackInput={feedback:string;assertCurrent?:()=>Promise<void>;onPrepared?:(pointer:DocumentaryArtworkFeedback)=>Promise<void>};
function fail(message:string):never{throw Error(`[no-retry] AI-графика: ${message}`);}
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
function stable(value:unknown):string{
  return JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)
    ?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
}
export const artworkFeedbackRowsHash=(rows:FeedbackRow[])=>sha(stable(rows));
const visualArtwork=(artwork:DocumentaryArtwork)=>{
  const {intent:_intent,direction:_direction,...visual}=artwork;return stable(visual);
};
export const normalizeArtworkFeedback=(text:string)=>text.normalize('NFC').replace(/\r\n?/gu,'\n').trim();
const operationDirectory=(root:string,key:string)=>{
  if(!/^[a-f0-9]{64}$/u.test(key))return fail('повреждён ключ сохранённой операции.');
  return join(root,'Documentary','Montage','feedback',key);
};
async function read<T>(file:string):Promise<T|undefined>{
  try{return JSON.parse(await readFile(file,'utf8')) as T;}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}
}

/** Read the rendered composition, including manual edits, never primary rows. */
export function appliedArtworkFeedbackRows(project:Project):FeedbackRow[]{
  const all=project.scenes.filter(s=>s.includeInAssembly!==false).sort((a,b)=>a.order-b.order),covered=new Set<string>();
  const rows:FeedbackRow[]=[];
  for(const scene of all){
    if(covered.has(scene.id))continue;
    const d=scene.documentary,g=d?.motionGraphic,direction=d?.semanticMontage;
    if(!g?.enabled||g.origin!=='automatic'||!g.artwork||!direction?.artwork||!artworkSceneEditable(scene))continue;
    const first=all.indexOf(scene),last=g.artworkSpan?all.findIndex(s=>s.id===g.artworkSpan!.endSceneId):first;
    const members=all.slice(first,last+1);
    if(last<first||members.some(s=>!artworkSceneEditable(s)||s.documentary?.templateMotion?.amountPercent===0
      ||!s.documentary?.motionGraphic?.enabled||s.documentary.motionGraphic.origin!=='automatic'
      ||stable(s.documentary.motionGraphic.artwork)!==stable(g.artwork)))continue;
    if(stable(direction.artwork)!==stable(g.artwork)||stable(direction.artworkSpan)!==stable(g.artworkSpan))
      fail('применённый рисунок и его сохранённое направление расходятся; исходный монтаж сохранён.');
    rows.push({sceneId:scene.id,artwork:structuredClone(g.artwork),...(g.artworkSpan?{artworkSpan:structuredClone(g.artworkSpan)}:{})});
    members.forEach(s=>covered.add(s.id));
  }
  return rows;
}

/** Protect exact content and every unaffected track. Only target drawing bytes and UI outcomes are excluded. */
export function artworkFeedbackProjectState(project:Project,rows:FeedbackRow[]){
  const copy=structuredClone(project),ids=new Set<string>();
  const ordered=copy.scenes.filter(s=>s.includeInAssembly!==false).sort((a,b)=>a.order-b.order);
  for(const row of rows){
    const first=ordered.findIndex(s=>s.id===row.sceneId),last=row.artworkSpan?ordered.findIndex(s=>s.id===row.artworkSpan!.endSceneId):first;
    ordered.slice(first,last+1).forEach(s=>ids.add(s.id));
  }
  for(const scene of copy.scenes){
    const d=scene.documentary;
    if(d){d.candidates=[];delete d.candidatesDeferred;delete d.candidateCount;
      if(ids.has(scene.id)){
        if(d.semanticMontage)delete d.semanticMontage.artwork;
        if(d.motionGraphic)delete d.motionGraphic.artwork;
      }
    }
    delete (scene as Partial<typeof scene>).status;
  }
  const settings=copy.settings,doc=settings.assembly.documentary;
  if(doc){delete doc.artworkFeedback;delete doc.activeArtworkFeedback;delete doc.motionArtworkStatus;delete doc.semanticMontageStatus;}
  // Repository projections can contain explicit undefined fields. Bind the persisted JSON meaning.
  return JSON.parse(JSON.stringify({script:copy.videoBrief,aspect:copy.aspectRatio,language:copy.language,mediaMode:copy.mediaMode,
    settings,scenes:copy.scenes,referenceAnalysis:copy.referenceAnalysis})) as Record<string,unknown>;
}
export async function artworkFeedbackProtectedInput(project:Project,rows:FeedbackRow[],root:string){
  const files=new Map<string,{path:string;sha256:string}>();
  const clean=async(value:unknown,key=''):Promise<unknown>=>{
    if(Array.isArray(value))return Promise.all(value.map(v=>clean(v,key)));
    if(value&&typeof value==='object'){
      const result:Record<string,unknown>={};
      for(const [k,v] of Object.entries(value))if(!['updatedAt','createdAt','outputFolder','outputDirectory'].includes(k))result[k]=await clean(v,k);
      return result;
    }
    if(typeof value==='string'&&isAbsolute(value)&&/(?:path|file)$/iu.test(key)){
      const path=resolve(value),rel=relative(resolve(root),path),identity=!rel.startsWith('..')&&!isAbsolute(rel)?`<project>/${rel.replace(/\\/gu,'/')}`:path;
      let digest:string;
      try{digest=sha(await readFile(path));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;digest='missing';}
      files.set(identity,{path:identity,sha256:digest});return identity;
    }
    return value;
  };
  const value=await clean(artworkFeedbackProjectState(project,rows));
  const snapshot={value,files:[...files.values()].sort((a,b)=>a.path.localeCompare(b.path))};
  return {value:snapshot,hash:sha(stable(snapshot))};
}

function checkedReplacement(project:Project,base:FeedbackRow,proposal:unknown):DocumentaryArtwork|undefined{
  const all=project.scenes.filter(s=>s.includeInAssembly!==false).sort((a,b)=>a.order-b.order);
  const first=all.findIndex(s=>s.id===base.sceneId),last=base.artworkSpan?all.findIndex(s=>s.id===base.artworkSpan!.endSceneId):first,scene=all[first];
  if(!scene||last<first||(proposal as DocumentaryArtwork)?.motionCoordinates!=='absolute')return undefined;
  const frozen=preserveArtworkManualLayers(base.artwork,proposal as DocumentaryArtwork);if(!frozen)return undefined;
  // A frozen layer's palette token must not silently repaint a manually edited object.
  if(base.artwork.layers.some(l=>l.editTransform||l.fillOrigin==='manual'||l.framingBeforeEdit))frozen.palette={...base.artwork.palette};
  const context=all.slice(Math.max(0,first-1),Math.min(all.length,last+2)).map(s=>s.narration).join(' ');
  const [w,h]=project.aspectRatio.split(':').map(Number);
  const checked=validateMotionArtwork(frozen,context,all.slice(first,last+1).reduce((n,s)=>n+montageFrames(s)/30,0),
    Boolean(scene.imagePath||scene.videoPath),w!/h!,{...scene.documentary?.selected,
      contain:scene.documentary?.layout==='contain'||scene.documentary?.layout==='compare',
      mediaAllowed:Boolean(scene.documentary?.semanticMontage?.artworkBrief)||scene.documentary?.semanticMontage?.artworkMode!=='standalone',
      currentSceneId:scene.id,allowedSources:artworkSourceCandidates(project,scene.id)},Boolean(base.artworkSpan)).artwork;
  if(!checked||base.artworkSpan&&(checked.layout!=='full'||checked.layers.some(l=>l.kind==='media'))||!assessArtworkReplacement(checked).allowReplacement)return undefined;
  const failures=reviewArtworkTemporal(checked,scene.documentary?.semanticMontage?.sceneDirection).findings
    .filter(f=>['no-object-state-change','invisible-action','missing-beat-object'].includes(f.code));
  return failures.length?undefined:checked;
}

async function verifyParents(root:string,parents:Parent[]){
  if(!Array.isArray(parents)||!parents.length)fail('нет завершённого родителя.');
  for(const parent of parents){
    if(!/^[a-f0-9]{64}$/u.test(parent.analysisKey)||!parent.files?.length)fail('повреждена связь с родителем.');
    for(const file of parent.files){
      if(!/^Documentary\/(?:Analysis|Montage)\/[a-zA-Z0-9/._-]+$/u.test(file.path)||file.path.split('/').includes('..'))fail('повреждён путь родителя.');
      if(sha(await readFile(join(root,file.path)))!==file.sha256)fail('изменился сохранённый родитель; повторная отправка отключена.');
    }
    const checkpoint=await read<{state:string;result?:Record<string,unknown>}>(join(root,'Documentary','Analysis',parent.analysisKey+'.json'));
    if(checkpoint?.state!=='complete'||!checkpoint.result||sha(stable(checkpoint.result))!==parent.resultSha256)fail('родитель не COMPLETE или результат не совпадает.');
  }
}

async function predecessor(project:Project,root:string,base:FeedbackRow[]):Promise<Parent[]>{
  const active=project.settings.assembly.documentary?.activeArtworkFeedback??project.settings.assembly.documentary?.artworkFeedback;
  if(active?.resultArtworkHash===artworkFeedbackRowsHash(base)){
    const request=await loadRequest(root,active.operationKey);
    const result=await read<ArtworkFeedbackPlan>(join(operationDirectory(root,active.operationKey),'result.json'));
    if(!result||artworkFeedbackRowsHash(result.scenes)!==active.resultArtworkHash)fail('повреждён результат родительской доработки.');
    const receiptPath=`Documentary/Analysis/${request.analysisKey}.json`,bytes=await readFile(join(root,receiptPath));
    const checkpoint=JSON.parse(bytes.toString()) as {state:string;result?:Record<string,unknown>};
    if(checkpoint.state!=='complete'||!checkpoint.result)fail('родительская доработка не COMPLETE.');
    return [{analysisKey:request.analysisKey,inputSha256:request.inputSha256,resultSha256:sha(stable(checkpoint.result)),files:[
      {path:receiptPath,sha256:sha(bytes)},...await Promise.all(['request.json','result.json'].map(async name=>{
        const path=`Documentary/Montage/feedback/${active.operationKey}/${name}`;return {path,sha256:sha(await readFile(join(root,path)))};
      }))]}];
  }
  const hash=motionArtworkHash(project),dir=join(root,'Documentary','Montage'),remaining=new Set(base.map(r=>r.sceneId)),parents:Parent[]=[];
  for(const name of (await readdir(dir)).sort()){
    if(!new RegExp(`^${hash}-artwork-revision-v2-\\d+\\.attempt\\.json$`,'u').test(name))continue;
    const attempt=await read<{version:number;inputHash:string;from:number;inputSha256:string;analysisKey:string}>(join(dir,name));
    if(!attempt||attempt.version!==1||attempt.inputHash!==hash||!Number.isSafeInteger(attempt.from)
      ||!['analysisKey','inputSha256'].every(k=>/^[a-f0-9]{64}$/u.test(String(attempt[k as 'analysisKey']))))continue;
    const rawName=name.replace('.attempt.json','.json'),raw=await read<Record<string,unknown>>(join(dir,rawName));
    const checkpoint=await read<{state:string;result?:Record<string,unknown>}>(join(root,'Documentary','Analysis',attempt.analysisKey+'.json'));
    if(!raw||checkpoint?.state!=='complete'||!checkpoint.result||stable(checkpoint.result)!==stable(raw)||!Array.isArray(raw.scenes))continue;
    let matched=false;
    for(const row of base.filter(r=>remaining.has(r.sceneId))){
      const proposal=(raw.scenes as FeedbackRow[]).find(r=>r.sceneId===row.sceneId);
      const normalized=proposal&&checkedReplacement(project,row,proposal.artwork);
      if(normalized&&stable(normalized)===stable(row.artwork)){remaining.delete(row.sceneId);matched=true;}
    }
    if(matched){
      const paths=[`Documentary/Montage/${name}`,`Documentary/Montage/${rawName}`,`Documentary/Analysis/${attempt.analysisKey}.json`];
      parents.push({analysisKey:attempt.analysisKey,inputSha256:attempt.inputSha256,resultSha256:sha(stable(checkpoint.result)),
        files:await Promise.all(paths.map(async path=>({path,sha256:sha(await readFile(join(root,path)))})))});
    }
  }
  if(remaining.size)fail('для текущей применённой графики не найден точный COMPLETE predecessor; новая отправка остановлена.');
  return parents;
}

async function loadRequest(root:string,key:string):Promise<Request>{
  const request=await read<Request>(join(operationDirectory(root,key),'request.json'));
  if(!request||request.version!==1||request.operationKey!==key||!Array.isArray(request.images)
    ||request.inputSha256!==sha(request.input)||stable(request.imageHashes)!==stable(request.images.map(sha))
    ||request.analysisKey!==documentaryCheckpointKey('semantic-montage',request.system,request.input,request.images)
    ||request.baseArtworkHash!==artworkFeedbackRowsHash(request.base)||request.protectedInputHash!==sha(stable(request.protectedInput))
    ||key!==sha(stable({contract:1,feedback:request.normalizedFeedback,protectedInput:request.protectedInputHash,base:request.baseArtworkHash,parents:request.parents})))
    return fail('повреждён frozen request; новый платный запрос отключён.');
  const input=JSON.parse(request.input) as Record<string,unknown>;
  if(input.operationKey!==key||input.userFeedback!==request.normalizedFeedback||input.protectedInputHash!==request.protectedInputHash
    ||input.baseArtworkHash!==request.baseArtworkHash||stable(input.parents)!==stable(request.parents))fail('frozen input не совпадает с операцией.');
  await verifyParents(root,request.parents);return request;
}

/** Exact attribution only; never an authorization to repeat an uncertain request. */
export async function knownArtworkFeedbackAttempts(project:Project,root:string):Promise<Set<string>>{
  const keys=new Set<string>();
  const dir=join(root,'Documentary','Montage','feedback');
  const names=await readdir(dir).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return [];throw e;});
  if(!names.length)return keys;
  const base=appliedArtworkFeedbackRows(project),hash=artworkFeedbackRowsHash(base);
  const protectedHash=(await artworkFeedbackProtectedInput(project,base,root)).hash;
  for(const key of names){
    if(!/^[a-f0-9]{64}$/u.test(key))continue;
    try{
      const r=await loadRequest(root,key),result=await read<ArtworkFeedbackPlan>(join(dir,key,'result.json'));
      const attempt=await read<{version:number;operationKey:string;analysisKey:string;inputSha256:string;imageHashes:string[]}>(join(dir,key,'attempt.json'));
      if(!attempt||attempt.version!==1||attempt.operationKey!==key||attempt.analysisKey!==r.analysisKey
        ||attempt.inputSha256!==r.inputSha256||stable(attempt.imageHashes)!==stable(r.imageHashes))continue;
      if(r.projectId===project.id&&r.protectedInputHash===protectedHash&&(r.baseArtworkHash===hash
        ||result?.feedback.resultArtworkHash===hash&&artworkFeedbackRowsHash(result.scenes)===hash))keys.add(r.analysisKey);
    }catch{/* A malformed/unrelated operation cannot whitelist an orphan. */}
  }
  return keys;
}

export async function readActiveArtworkFeedback(project:Project,root:string):Promise<ArtworkFeedbackPlan|undefined>{
  const pointer=project.settings.assembly.documentary?.activeArtworkFeedback??project.settings.assembly.documentary?.artworkFeedback;if(pointer?.status!=='applied')return;
  const request=await loadRequest(root,pointer.operationKey),result=await read<ArtworkFeedbackPlan>(join(operationDirectory(root,pointer.operationKey),'result.json'));
  const rows=appliedArtworkFeedbackRows(project),protectedInput=await artworkFeedbackProtectedInput(project,request.base,root);
  if(request.projectId!==project.id||protectedInput.hash!==request.protectedInputHash||!result
    ||result.feedback.resultArtworkHash!==pointer.resultArtworkHash||artworkFeedbackRowsHash(result.scenes)!==pointer.resultArtworkHash
    ||artworkFeedbackRowsHash(rows)!==pointer.resultArtworkHash)fail('применённая доработка не соответствует текущим входам; старый cache не применён.');
  const check=await read<{status:string;artworkSha256:string}>(join(operationDirectory(root,pointer.operationKey),'render-check.json'));
  const validation=await read<{resultArtworkHash:string;accepted:number}>(join(operationDirectory(root,pointer.operationKey),'validation.json'));
  if(check?.status!=='rendered'||check.artworkSha256!==pointer.resultArtworkHash||validation?.resultArtworkHash!==pointer.resultArtworkHash
    ||validation.accepted!==pointer.accepted)fail('нет технической проверки сохранённого результата.');
  await verifySavedResult(project,root,request,result);return result;
}
async function verifyComplete(root:string,request:Request){
  const checkpoint=await read<{state:string;result?:Record<string,unknown>}>(join(root,'Documentary','Analysis',request.analysisKey+'.json'));
  const response=await read<Record<string,unknown>>(join(operationDirectory(root,request.operationKey),'response.json'));
  if(checkpoint?.state!=='complete'||!checkpoint.result||!response||stable(checkpoint.result)!==stable(response))fail('COMPLETE receipt доработки отсутствует или не совпадает.');
  return response;
}
async function verifySavedResult(project:Project,root:string,request:Request,result:ArtworkFeedbackPlan){
  const response=await verifyComplete(root,request),pointer=result.feedback;
  if(!Array.isArray(result.scenes)||pointer?.operationKey!==request.operationKey||pointer.baseArtworkHash!==request.baseArtworkHash
    ||pointer.protectedInputHash!==request.protectedInputHash||pointer.resultArtworkHash!==artworkFeedbackRowsHash(result.scenes)
    ||result.scenes.length!==request.base.length)fail('повреждён сохранённый результат операции.');
  let changed=0;
  for(const [i,row] of result.scenes.entries()){
    const base=request.base[i]!;
    if(row.sceneId!==base.sceneId||stable(row.artworkSpan)!==stable(base.artworkSpan))fail('изменены сохранённые сцены/интервалы результата.');
    if(stable(row.artwork)===stable(base.artwork))continue;
    const proposals=Array.isArray(response.scenes)?(response.scenes as FeedbackRow[]).filter(p=>p?.sceneId===row.sceneId):[];
    if(proposals.length!==1||stable(checkedReplacement(project,base,proposals[0]!.artwork))!==stable(row.artwork))fail('результат не соответствует COMPLETE ответу.');
    changed++;
  }
  if(changed!==pointer.accepted)fail('счётчик принятых рисунков не совпадает с результатом.');
  if(changed){
    const check=await read<{status:string;artworkSha256:string}>(join(operationDirectory(root,request.operationKey),'render-check.json'));
    if(check?.status!=='rendered'||check.artworkSha256!==pointer.resultArtworkHash)fail('нет native preview сохранённого результата.');
  }
}

export async function createArtworkFeedbackPlan(project:Project,root:string,feedback:string,hooks:ArtworkRevisionHooks,model:string,
  signal?:AbortSignal,assertCurrent?:()=>Promise<void>,onPrepared?:ArtworkFeedbackInput['onPrepared']):Promise<ArtworkFeedbackPlan>{
  const normalizedFeedback=normalizeArtworkFeedback(feedback);
  if(!normalizedFeedback||normalizedFeedback.length>12000)fail('введите замечание длиной от 1 до 12000 знаков.');
  const base=appliedArtworkFeedbackRows(project);if(!base.length)fail('нет применённой автоматической AI-графики для доработки.');
  const protectedInput=await artworkFeedbackProtectedInput(project,base,root),baseHash=artworkFeedbackRowsHash(base);
  const directory=join(root,'Documentary','Montage','feedback');await mkdir(directory,{recursive:true});
  // Search saved intents before creating a new output-as-base operation.
  let request:Request|undefined;
  for(const key of await readdir(directory)){
    if(!/^[a-f0-9]{64}$/u.test(key))continue;
    const prior=await loadRequest(root,key);
    if(prior.projectId!==project.id)fail('операция принадлежит другому проекту.');
    const result=await read<ArtworkFeedbackPlan>(join(directory,key,'result.json'));
    const matches=prior.protectedInputHash===protectedInput.hash&&(prior.baseArtworkHash===baseHash
      ||result?.feedback.resultArtworkHash===baseHash&&artworkFeedbackRowsHash(result.scenes)===baseHash);
    if(matches&&prior.normalizedFeedback===normalizedFeedback){request=prior;break;}
    const dispatch=await read<unknown>(join(directory,key,'attempt.json'));
    if(dispatch!==undefined){
      const checkpoint=await read<{state:string}>(join(root,'Documentary','Analysis',prior.analysisKey+'.json'));
      if(checkpoint?.state!=='complete')fail('есть незавершённая доработка; смена текста или базы не разрешает повторную оплату.');
    }
  }
  if(!request){
    // No uncertain semantic receipt is silently made safe by this new operation.
    const analysis=join(root,'Documentary','Analysis');
    for(const name of await readdir(analysis).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return [];throw e;})){
      if(!/^[a-f0-9]{64}\.json$/u.test(name))continue;
      const receipt=await read<{state:string;purpose?:string}>(join(analysis,name));
      if(!receipt||typeof receipt.state!=='string'||receipt.purpose==='semantic-montage'&&!['complete','failed'].includes(receipt.state))fail('сохранён неопределённый монтажный запрос; новая отправка остановлена.');
    }
    const parents=await predecessor(project,root,base),operationKey=sha(stable({contract:1,feedback:normalizedFeedback,protectedInput:protectedInput.hash,base:baseHash,parents}));
    const dir=operationDirectory(root,operationKey);
    try{await mkdir(dir);}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')return fail('эта операция уже подготавливается или прервана; повторная отправка отключена.');throw error;}
    await onPrepared?.({version:1,operationKey,feedback,normalizedFeedback,protectedInputHash:protectedInput.hash,
      baseArtworkHash:baseHash,status:'prepared',message:'Доработка AI-графики: замечание сохранено, готовится технический предпросмотр.'});
    const previews=await hooks.preview(base.map(r=>({sceneId:r.sceneId,artwork:r.artwork,...(r.artworkSpan?{endSceneId:r.artworkSpan.endSceneId}:{})})),signal);
    validateArtworkRevisionPreviews(base,previews);
    const images:string[]=[],all=project.scenes.filter(s=>s.includeInAssembly!==false).sort((a,b)=>a.order-b.order);
    const scenes=base.map(row=>{
      const frames=previews.find(p=>p.sceneId===row.sceneId)!.frames;
      const previewImages=frames.map(frame=>{images.push(frame.image);return {number:images.length,t:frame.t};});
      return {...row,artwork:artworkForRevision(row.artwork),previewImages,
        sceneDirection:all.find(s=>s.id===row.sceneId)?.documentary?.semanticMontage?.sceneDirection,
        temporalReview:reviewArtworkTemporal(row.artwork,all.find(s=>s.id===row.sceneId)?.documentary?.semanticMontage?.sceneDirection,undefined,frames.map(f=>f.t))};
    });
    const sources=await motionArtworkPreviews(project,JSON.stringify({scenes:base.map(r=>({sceneId:r.sceneId,editable:true}))}),root,signal);
    const sourceRows=JSON.parse(sources.input).scenes as Array<{sourceCatalog?:Array<{previewImage:number}>}>;
    const offset=images.length;
    const sourceCatalog=sourceRows.map((r,i)=>({sceneId:base[i]!.sceneId,sources:r.sourceCatalog?.map(s=>({...s,previewImage:s.previewImage+offset}))}));
    images.push(...sources.images);
    const input=JSON.stringify({version:1,motionArtwork:1,motionArtworkRevision:1,artworkFeedback:1,operationKey,userFeedback:normalizedFeedback,
      baseArtworkHash:baseHash,protectedInputHash:protectedInput.hash,parents,aspect:project.aspectRatio,language:project.language,
      originalScript:project.videoBrief?.readyScript,storyContext:documentaryAiPlanContext(project),
      narration:all.map(s=>({sceneId:s.id,narration:s.narration})),scenes,sourceCatalog});
    request={version:1,operationKey,projectId:project.id,feedback,normalizedFeedback,protectedInput:protectedInput.value,protectedInputHash:protectedInput.hash,
      base,baseArtworkHash:baseHash,parents,system:motionArtworkFeedbackSystem,input,images,imageHashes:images.map(sha),inputSha256:sha(input),
      analysisKey:documentaryCheckpointKey('semantic-montage',motionArtworkFeedbackSystem,input,images)};
    await atomicWrite(join(dir,'request.json'),JSON.stringify(request));
  }
  const dir=operationDirectory(root,request.operationKey),pointer:DocumentaryArtworkFeedback={version:1,operationKey:request.operationKey,feedback:request.feedback,
    normalizedFeedback:request.normalizedFeedback,protectedInputHash:request.protectedInputHash,baseArtworkHash:request.baseArtworkHash,
    analysisKey:request.analysisKey,status:'pending',message:'Доработка AI-графики: запрос сохранён.'};
  const attempt=await read<{version?:number;operationKey?:string;analysisKey?:string;inputSha256?:string;imageHashes?:string[]}>(join(dir,'attempt.json'));
  if(attempt!==undefined&&(!attempt||attempt.version!==1||attempt.operationKey!==request.operationKey||attempt.analysisKey!==request.analysisKey
    ||attempt.inputSha256!==request.inputSha256||stable(attempt.imageHashes)!==stable(request.imageHashes)))fail('повреждён attempt; платный повтор отключён.');
  const prior=await read<ArtworkFeedbackPlan>(join(dir,'result.json'));
  if(prior&&!prior.retryLocalPreview){if(!attempt)fail('нет attempt сохранённого результата.');await verifySavedResult(project,root,request,prior);return prior;}
  await onPrepared?.(pointer);
  let response:Record<string,unknown>;
  const checkpoint=await read<{state:string;result?:Record<string,unknown>}>(join(root,'Documentary','Analysis',request.analysisKey+'.json'));
  if(checkpoint){
    if(checkpoint.state!=='complete'||!checkpoint.result)fail('сохранённый запрос не COMPLETE; повторная отправка отключена.');
    if(!attempt)fail('нет attempt завершённого запроса.');
    response=checkpoint.result!;
  }else{
    signal?.throwIfAborted();await assertCurrent?.();await verifyParents(root,request.parents);
    let claim;
    try{claim=await open(join(dir,'attempt.json'),'wx');}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')return fail('предыдущая отправка имеет неизвестный результат; автоматический повтор отключён.');throw error;}
    try{await claim.writeFile(JSON.stringify({version:1,operationKey:request.operationKey,analysisKey:request.analysisKey,inputSha256:request.inputSha256,imageHashes:request.imageHashes}));await claim.sync();}finally{await claim.close();}
    response=await hooks.complete(request.system,request.input,request.images);
    // The production completion writes COMPLETE first. A mock must do the same.
    const complete=await read<{state:string;result?:Record<string,unknown>}>(join(root,'Documentary','Analysis',request.analysisKey+'.json'));
    if(complete?.state!=='complete'||stable(complete.result)!==stable(response))fail('ответ получен без соответствующего COMPLETE receipt; он не применяется и не повторяется.');
  }
  await atomicWrite(join(dir,'response.json'),JSON.stringify(response));
  const result:ArtworkFeedbackPlan={version:1,validationVersion:13,inputHash:motionArtworkHash(project),model,scenes:structuredClone(request.base),rejected:[],feedback:pointer};
  const proposed=Array.isArray(response.scenes)?response.scenes as Array<{sceneId?:string;artwork?:unknown;artworkSpan?:{endSceneId?:string}}>:[];
  const changed:FeedbackRow[]=[];
  for(const baseRow of request.base){
    const matches=proposed.filter(p=>p?.sceneId===baseRow.sceneId),p=matches[0];
    const artwork=matches.length===1&&(!p?.artworkSpan||p.artworkSpan.endSceneId===baseRow.artworkSpan?.endSceneId)
      ?checkedReplacement(project,baseRow,p?.artwork):undefined;
    if(!artwork){result.rejected.push({sceneId:baseRow.sceneId,reason:'замена отсутствует или не прошла штатную structural/span/source/manual/temporal проверку'});continue;}
    if(visualArtwork(artwork)===visualArtwork(baseRow.artwork)){result.rejected.push({sceneId:baseRow.sceneId,reason:'модель вернула прежний рисунок без изменения'});continue;}
    changed.push({...baseRow,artwork});
  }
  if(changed.length){
    try{
      const rows=changed.map(r=>({sceneId:r.sceneId,artwork:r.artwork,...(r.artworkSpan?{endSceneId:r.artworkSpan.endSceneId}:{})}));
      const previews=await hooks.preview(rows,signal);validateArtworkRevisionPreviews(rows,previews);
      await atomicWrite(join(dir,'render-check.json'),JSON.stringify({version:1,artworkSha256:artworkFeedbackRowsHash(result.scenes.map(r=>changed.find(c=>c.sceneId===r.sceneId)??r)),status:'rendered',
        scope:'technical-native-preview-not-artistic-verdict',scenes:previews.map(p=>({sceneId:p.sceneId,frames:p.frames.map(f=>({t:f.t,sha256:sha(f.image)}))}))}));
      result.scenes=result.scenes.map(r=>changed.find(c=>c.sceneId===r.sceneId)??r);pointer.accepted=changed.length;
    }catch(error){
      result.retryLocalPreview=true;pointer.accepted=0;
      result.rejected.push({sceneId:'preview',reason:error instanceof Error?error.message:String(error)});
      await atomicWrite(join(dir,'render-check.json'),JSON.stringify({version:1,status:'failed',message:result.rejected.at(-1)!.reason}));
    }
  }
  pointer.resultArtworkHash=artworkFeedbackRowsHash(result.scenes);pointer.accepted??=0;
  pointer.status=pointer.accepted?'complete':'blocked';
  pointer.message=`Доработка AI-графики: принято ${pointer.accepted}.`+(result.rejected.length?` Исходные рисунки сохранены: ${result.rejected.map(r=>r.reason).slice(0,3).join('; ')}.`:' Технический предпросмотр пройден.');
  await atomicWrite(join(dir,'validation.json'),JSON.stringify({version:1,accepted:pointer.accepted,rejected:result.rejected,resultArtworkHash:pointer.resultArtworkHash}));
  await atomicWrite(join(dir,'result.json'),JSON.stringify(result));return result;
}
