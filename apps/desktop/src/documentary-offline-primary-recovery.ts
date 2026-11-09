import {createHash} from 'node:crypto';
import {readFile,mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {dirname,isAbsolute,join,relative,resolve} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import type {Project} from '@gold-work/shared';
import {documentaryAiPlanContext} from '@gold-work/shared';
import {readAnyModelCompletion} from './anymodel-client.js';
import {parseDocumentaryJson} from './documentary-json.js';
import {documentaryCheckpointKey} from './documentary-checkpoint-key.js';
import {createSemanticMontagePlan,semanticMontageHash,validateSemanticMontagePlan} from './documentary-semantic-montage.js';
import {createMotionArtworkPlan,motionArtworkHash,receivedMotionArtwork} from './documentary-artwork-plan.js';
import {motionArtworkPreviews} from './documentary-artwork-previews.js';

type BoundFile={file:string;sha256:string};
type BoundCompletion={analysis:BoundFile;wireIndex:number;fingerprint:string};
/** Paths are relative to an immutable input copy; hashes are supplied before recovery. */
export type OfflinePrimaryRecoveryBinding={version:1;project:BoundFile;ledger:BoundFile;
  semanticManifest:BoundFile;semantic:BoundCompletion[];primaryManifest:BoundFile;
  primary:Array<BoundCompletion&{from:number}>};
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
function fail(reason:string):never{throw new Error(`[no-retry] offline-primary-recovery:${reason}`);}
const validHash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);

/** No client, transport, settings, revision hooks or paid service is reachable here.
 * Reconstruct ordinary request keys and replay only exact COMPLETE wire receipts
 * through the existing response/parser/semantic/artwork validators. */
export async function recoverOfflinePrimaryPlans(project:Project,inputDirectory:string,outputRoot:string,binding:OfflinePrimaryRecoveryBinding,signal?:AbortSignal){
  if(binding?.version!==1||!binding.semantic?.length||!binding.primary?.length)fail('binding');
  if(new Set([...binding.semantic,...binding.primary].map(entry=>entry.wireIndex)).size!==binding.semantic.length+binding.primary.length)fail('duplicate-wire-binding');
  const outside=(a:string,b:string)=>{const sub=relative(resolve(a),resolve(b));return sub.startsWith('..')||isAbsolute(sub);};
  if(!outside(inputDirectory,outputRoot)||!outside(outputRoot,inputDirectory))fail('input-output-overlap');
  const readBound=async(entry:BoundFile)=>{
    if(!entry||!validHash(entry.sha256)||typeof entry.file!=='string'||isAbsolute(entry.file))fail('bound-file');
    const path=resolve(inputDirectory,entry.file),sub=relative(resolve(inputDirectory),path);
    if(!sub||sub.startsWith('..')||isAbsolute(sub))fail('bound-path');
    const bytes=await readFile(path);if(sha(bytes)!==entry.sha256)fail('file-hash');return bytes;
  };
  const source=await readBound(binding.project);
  if(!isDeepStrictEqual(JSON.parse(source.toString()),project))fail('project-snapshot');
  const ledger=JSON.parse((await readBound(binding.ledger)).toString()) as {version?:number;rows?:Array<{index:number;stage:string;state:string;status:number;fingerprint:string;receipt:string;responseSha256:string;
    headers?:Record<string,string>;responseRead?:{state:string;capturedBytes:number;observedBytes:number;truncated:boolean}}>};
  if(ledger.version!==1||!Array.isArray(ledger.rows))fail('ledger');
  const used=new Set<number>(),wireHashes:string[]=[],wireFiles:BoundFile[]=[];
  const completion=async(entry:BoundCompletion,stage:'semantic'|'artwork')=>{
    const row=ledger.rows![entry.wireIndex];
    if(!Number.isSafeInteger(entry.wireIndex)||used.has(entry.wireIndex)||!validHash(entry.fingerprint)
      ||!row||row.index!==entry.wireIndex||row.stage!==stage||row.fingerprint!==entry.fingerprint||row.state!=='complete'||row.status!==200
      ||row.receipt!==`response-${row.index}.bin`||!validHash(row.responseSha256)||row.responseRead?.state!=='complete'||row.responseRead.truncated)fail('incomplete-wire-binding');
    const wireFile={file:join(dirname(binding.ledger.file),row.receipt),sha256:row.responseSha256},wire=await readBound(wireFile);wireFiles.push(wireFile);
    if(wire.length!==row.responseRead.capturedBytes||wire.length!==row.responseRead.observedBytes)fail('wire-length');
    const response=await readAnyModelCompletion(new Response(wire,{headers:row.headers}));
    if(response.finishReason!=='stop')fail('wire-terminal');
    const result=parseDocumentaryJson(response.content)?.result??(stage==='artwork'?receivedMotionArtwork(response.content):undefined);
    const analysis=JSON.parse((await readBound(entry.analysis)).toString()) as {state?:string;purpose?:string;model?:string;result?:Record<string,unknown>};
    if(!result||analysis.state!=='complete'||analysis.purpose!=='semantic-montage'||typeof analysis.model!=='string'
      ||!isDeepStrictEqual(result,analysis.result))fail('analysis-wire-mismatch');
    const key=/^([a-f0-9]{64})\.json$/u.exec(entry.analysis.file.replaceAll('\\','/').split('/').at(-1)??'')?.[1];
    if(!key)fail('analysis-key');used.add(entry.wireIndex);wireHashes.push(row.responseSha256);
    return {key,result,model:analysis.model,analysisBytes:await readBound(entry.analysis)};
  };
  const semantic=await Promise.all(binding.semantic.map(entry=>completion(entry,'semantic')));
  const primary=await Promise.all(binding.primary.map(async entry=>({...await completion(entry,'artwork'),from:entry.from})));
  if(new Set(primary.map(entry=>entry.from)).size!==primary.length||primary.some(entry=>!Number.isSafeInteger(entry.from)||entry.from<0))fail('primary-batches');
  const semanticHash=semanticMontageHash(project),semanticManifest=await readBound(binding.semanticManifest),sm=JSON.parse(semanticManifest.toString());
  if(sm.version!==2||sm.inputHash!==semanticHash||!isDeepStrictEqual(sm.storyContext,JSON.parse(JSON.stringify(documentaryAiPlanContext(project)))))fail('semantic-input-lineage');
  await mkdir(outputRoot,{recursive:true});
  const work=await mkdtemp(join(outputRoot,'offline-primary-')),montage=join(work,'Documentary','Montage'),analysis=join(work,'Documentary','Analysis');
  await mkdir(montage,{recursive:true});await mkdir(analysis,{recursive:true});
  await writeFile(join(montage,`${semanticHash}-batches.json`),semanticManifest);
  for(const entry of [...semantic,...primary])await writeFile(join(analysis,`${entry.key}.json`),entry.analysisBytes);
  const consumed=new Set<string>();
  const plan=await createSemanticMontagePlan(project,work,async(system,input)=>{
    const key=documentaryCheckpointKey('semantic-montage',system,input,[]),saved=semantic.find(entry=>entry.key===key);
    if(!saved||consumed.has(key))fail('semantic-exact-input');consumed.add(key);return saved.result;
  },semantic[0]!.model,signal);
  if(semantic.some(entry=>!consumed.has(entry.key!)))fail('semantic-unused-completion');
  validateSemanticMontagePlan(plan,project);
  const directions=new Map(plan.scenes.map(scene=>[scene.sceneId,scene]));
  const input={...project,scenes:project.scenes.map(scene=>scene.documentary&&directions.has(scene.id)
    ?{...scene,documentary:{...scene.documentary,semanticMontage:directions.get(scene.id)}}:scene)};
  const artworkHash=motionArtworkHash(input),primaryManifest=await readBound(binding.primaryManifest),pm=JSON.parse(primaryManifest.toString());
  if(pm.version!==1||pm.inputHash!==artworkHash||!isDeepStrictEqual(pm.storyContext,JSON.parse(JSON.stringify(documentaryAiPlanContext(input)))))fail('primary-input-lineage');
  await writeFile(join(montage,`${artworkHash}-artwork-batches.json`),primaryManifest);
  const usedPrimary=new Set<number>();
  const artwork=await createMotionArtworkPlan(input,work,async()=>fail('dispatch-forbidden'),primary[0]!.model,signal,{offlinePrimary:{read:async(system,request,from)=>{
    const saved=primary.find(entry=>entry.from===from);if(!saved||usedPrimary.has(from))fail('missing-primary-batch');
    const preview=await motionArtworkPreviews(input,request,work,signal);
    if(documentaryCheckpointKey('semantic-montage',system,preview.input,preview.images)!==saved.key)fail('primary-exact-input');
    usedPrimary.add(from);return saved.result;
  }}});
  if(primary.some(entry=>!usedPrimary.has(entry.from)))fail('primary-unused-completion');
  // Input files are still immutable when the recoverable result is handed off.
  for(const entry of [binding.project,binding.ledger,binding.semanticManifest,binding.primaryManifest,...wireFiles,...binding.semantic.map(entry=>entry.analysis),...binding.primary.map(entry=>entry.analysis)])await readBound(entry);
  return {plan,artwork,work,provenance:{version:1 as const,mode:'pre-revision' as const,bindingSha256:sha(JSON.stringify(binding)),
    sourceProjectSha256:binding.project.sha256,semanticInputHash:semanticHash,artworkInputHash:artworkHash,wireResponseSha256:wireHashes}};
}
