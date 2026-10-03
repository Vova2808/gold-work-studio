// Read-only production snapshot audit. The completion transport cannot POST.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import type {Project} from '@gold-work/shared';
import {documentarySavedContextIssue,revalidateDocumentaryContext} from '../src/documentary-context-approval.js';
import {DocumentaryIntelligence} from '../src/documentary-intelligence.js';

const snapshot=process.argv[2],output=process.argv[3];
assert.ok(snapshot&&output,'Pass a saved QA project.json and output directory');
const registry=join(process.env.APPDATA!,'@gold-work/desktop/projects.json');
const hash=async(file:string)=>createHash('sha256').update(await readFile(file)).digest('hex');
const before=await hash(registry),snapshotHash=await hash(snapshot);
const project=JSON.parse(await readFile(snapshot,'utf8')) as Project;
const storage=JSON.parse(await readFile(join(process.env.APPDATA!,'@gold-work/desktop/storage-location.json'),'utf8'));
const projectRoot=join(storage.activePath,'projects',project.id);
let preventedRequests=0;
const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{
  preventedRequests++;throw new Error('Offline audit: no paid request is allowed');
}},()=>projectRoot);
const migrated=revalidateDocumentaryContext(project);
const changed=migrated.filter((s,index)=>s.documentary?.verified!==project.scenes[index]?.documentary?.verified).map(s=>s.order+1);
for(const [index,scene] of migrated.entries()){
  const original=project.scenes[index]!;
  for(const key of ['imagePath','videoPath','audioPath','trimStartSeconds','trimEndSeconds'] as const)assert.equal(scene[key],original[key]);
  assert.strictEqual(scene.documentary?.selected,original.documentary?.selected);
  if(original.documentary?.pinned)assert.equal(scene.documentary?.verified,original.documentary.verified);
}
const preservedVoices=(await Promise.all(project.scenes.filter(s=>s.audioPath).map(async s=>({number:s.order+1,exists:await stat(s.audioPath!).then(x=>x.size>0).catch(()=>false)}))));
// Known legacy wrong-era approval and the last accepted general diagram.
const samples=[];
for(const number of [227,139]){
  const scene=project.scenes.find(s=>s.order+1===number);if(!scene)continue;
  let replay:Record<string,unknown>;
  try{
    const result=await intelligence.inspectForSelection(project,scene,undefined,undefined,true);
    const checked={...scene,trimStartSeconds:result.review.trimStartSeconds??0,trimEndSeconds:result.review.trimEndSeconds,
      documentary:{...scene.documentary!,verified:result.review.status==='accepted',visualReview:result.review}};
    replay={status:result.review.status,usedNewAnalysis:result.usedNewAnalysis,contextApproval:Boolean(result.review.contextApproval),
      savedIssue:documentarySavedContextIssue(project,checked),reason:result.review.reason};
  }catch(error){replay={error:String(error).replace(/https?:\/\/\S+/g,'[source]').slice(0,800)};}
  samples.push({number,previousVerified:scene.documentary?.verified,localIssue:documentarySavedContextIssue(project,scene),replay});
}
assert.equal(await hash(registry),before);assert.equal(await hash(snapshot),snapshotHash);
const report={at:new Date().toISOString(),projectId:project.id,sceneCount:project.scenes.length,paidRequests:0,preventedRequests,
  registryHash:before,snapshotPreserved:true,voiceCount:preservedVoices.length,missingVoices:preservedVoices.filter(v=>!v.exists),
  oldAutomaticApprovalsHeld:changed,samples};
await mkdir(resolve(output),{recursive:true});await writeFile(join(output,'result.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
