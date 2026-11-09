import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {createDefaultProjectSettings,documentaryAiPlanContext,type Project,type Scene} from '@gold-work/shared';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {DocumentaryAnalysisError} from './documentary-analysis-error.js';
import {documentarySavedContextIssue} from './documentary-context-approval.js';
import {documentaryRequiredLocation,documentaryUnresolvedLocationHint} from './documentary-location-review.js';
import {documentarySourceEvidence} from './documentary-source-evidence.js';
import {effectFfmpeg} from './effect-media.js';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const neutralTitle='A scenic view of a red boat cruising near a city with palm trees and vibrant architecture.';
const badPage='https://www.pexels.com/photo/a-motorboat-swimming-in-port-in-istanbul-16750112/?token=private#private';
async function fixture(t:test.TestContext,target='Suez Canal, historic images or modern view of the canal in Egypt',narration='The Suez Canal opened in 1869.'){
 const root=await mkdtemp(join(tmpdir(),'gws-location-review-'));assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));t.after(()=>rm(root,{recursive:true,force:true}));
 const file=join(root,'source.jpg');await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=s=1280x720:r=1','-frames:v','1',file]);
 const scene={id:'location',order:0,narration,durationSeconds:4,imagePath:file,documentary:{verified:false,
  checksum:createHash('sha256').update(await readFile(file)).digest('hex'),
  selected:{id:'local:source',provider:'local',kind:'image',title:neutralTitle,description:neutralTitle,pageUrl:badPage,localPath:file,
   downloadUrl:'',rights:'user-confirmed',author:'fixture',license:'user',licenseUrl:'',attribution:'fixture',retrievedAt:'now',query:'Suez Canal',match:'unverified',concerns:[]},
  requirement:{text:narration,entities:[],identities:[],years:[],queries:['Suez Canal'],detail:target,visualScope:'illustrative',plannedBy:'semantic',
   aiSearchPlan:{version:1,model:'fixture',inputHash:'',subject:'Visible task',visualTarget:target,visualScope:'illustrative',preferredKind:'image',years:[],
    imageQueries:['Suez Canal'],videoQueries:['Suez Canal'],fallbackVisualTarget:'waterway',fallbackVideoQueries:['waterway']}}}} as unknown as Scene;
 const project={id:'location-project',title:'History',topic:'History',language:'en',aspectRatio:'16:9',mediaMode:'stock',settings:createDefaultProjectSettings(),scenes:[scene],videoBrief:{readyScript:narration}} as Project;
 scene.documentary!.requirement.aiSearchPlan!.inputHash=hash({inputHash:hash({version:1,model:'fixture',context:documentaryAiPlanContext(project)}),sceneId:scene.id});
 const receipts=async()=>{const dir=join(root,'Documentary','Analysis');return Promise.all((await readdir(dir)).filter(name=>/^[a-f0-9]{64}\.json$/.test(name)).map(async name=>({path:join(dir,name),bytes:await readFile(join(dir,name),'utf8')})));};
 return {root,project,scene,receipts};
}
const answer=(overrides:Record<string,unknown>={})=>({description:'A steamship is visibly present on a lake.',suitable:true,
 targetVisible:true,targetEvidence:'The actual steamship, funnel and hull are visible.',sourceText:{kind:'none',text:''},reason:'Matches the supplied visual task.',...overrides});

for(const target of ['1860s-1870s steamship, the type of vessel that used the Suez Canal shortcut','Suez Canal, modern view of the canal'])
test(`single review sends the complete AI target without extracting a mandatory place: ${target}`,async t=>{
 const {root,project,scene,receipts}=await fixture(t,target);let calls=0;
 const client={configured:async()=>true,documentaryCompletion:async(system:string,input:string)=>{
  calls++;const data=JSON.parse(input);assert.equal(data.visualTarget,target);assert.equal(data.requiredLocation,undefined);
  assert.match(system,/COMPLETE current visualTarget/);assert.ok(!data.sourceEvidence.pageUrl.includes('private'));
  return JSON.stringify(answer({sourceLocation:{status:'conflict',place:'Lake Geneva',field:'description',quote:'Lake Geneva'}}));
 }};
 const first=await new DocumentaryIntelligence(client,()=>root).inspectForSelection(project,scene);
 assert.equal(first.review.status,'accepted');assert.equal(first.review.sourceLocation,undefined);
 scene.documentary!.visualReview=first.review;scene.documentary!.verified=true;
 assert.equal(documentarySavedContextIssue(project,scene),undefined,'Readiness does not reintroduce inferred geography');
 const before=await receipts(),again=await new DocumentaryIntelligence(client,()=>root).inspectForSelection(project,scene);
 assert.equal(again.review.status,'accepted');assert.equal(again.usedNewAnalysis,false);assert.equal(calls,1);assert.deepEqual(await receipts(),before);
});

for(const suitable of [false,true])test(`an explicit wrong-place target verdict stays rejected even if suitable=${suitable}`,async t=>{
 const {root,project,scene}=await fixture(t,'Suez Canal');let calls=0;
 const result=await new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(_system,input)=>{
  calls++;const data=JSON.parse(input);assert.equal(data.visualTarget,'Suez Canal');assert.equal(data.requiredLocation,undefined);
  return JSON.stringify(answer({suitable,targetVisible:false,targetEvidence:'The image shows a lake, not the requested Suez Canal.'}));
 }},()=>root).inspectForSelection(project,scene);
 assert.equal(result.review.status,'rejected');assert.equal(result.review.illustrationApproval,undefined);assert.equal(calls,1);
});

for(const state of ['complete','pending','partial','received'])test(`removing local location inference preserves ${state} receipt semantics`,async t=>{
 const {root,project,scene,receipts}=await fixture(t);let calls=0;
 const client={configured:async()=>true,documentaryCompletion:async()=>{calls++;return JSON.stringify(answer());}};
 const old=new DocumentaryIntelligence(client,()=>root),complete=Reflect.get(old,'complete').bind(old);
 Reflect.set(old,'complete',(...args:unknown[])=>complete(args[0],args[1],args[2],JSON.stringify({...JSON.parse(String(args[3])),requiredLocation:'Suez Canal'}),args[4],[]));
 await old.inspectForSelection(project,scene);assert.equal(calls,1);
 const prior=(await receipts())[0]!,receipt=JSON.parse(prior.bytes);
 if(state!=='complete')await writeFile(prior.path,JSON.stringify({...receipt,state,result:undefined,raw:undefined}));
 const before=await readFile(prior.path,'utf8');
 const current=new DocumentaryIntelligence(client,()=>root);
 if(state==='complete'){
  const fresh=await current.inspectForSelection(project,scene);assert.equal(fresh.review.status,'accepted');assert.equal(fresh.usedNewAnalysis,true);assert.equal(calls,2);
  const cached=await current.inspectForSelection(project,scene);assert.equal(cached.usedNewAnalysis,false);assert.equal(calls,2);
 }else{
  await assert.rejects(current.inspectForSelection(project,scene),DocumentaryAnalysisError);assert.equal(calls,1);
 }
 assert.equal(await readFile(prior.path,'utf8'),before,'Original receipt stays immutable');
});

test('a new authored visual target has an independent answer for the same source',async t=>{
 const {root,project,scene}=await fixture(t);let calls=0;
 const client={configured:async()=>true,documentaryCompletion:async()=>{calls++;return JSON.stringify(answer());}};
 const first=await new DocumentaryIntelligence(client,()=>root).inspectForSelection(project,scene);assert.equal(first.review.status,'accepted');
 scene.documentary!.requirement.aiSearchPlan!.visualTarget='a boat and palm trees at a harbor';
 const changed=await new DocumentaryIntelligence(client,()=>root).inspectForSelection(project,scene);
 assert.equal(changed.review.status,'accepted');assert.equal(changed.usedNewAnalysis,true);assert.equal(calls,2);
});

test('legacy location helpers remain unchanged outside the single-review path',()=>{
 const scene={documentary:{requirement:{detail:'Panama Canal, modern waterway'}}} as Scene;
 const source=documentarySourceEvidence({title:'A boat next to trees',pageUrl:'https://www.pexels.com/photo/boat-in-rotterdam-321/'});
 assert.equal(documentaryRequiredLocation(scene),'Panama Canal');assert.ok(documentaryUnresolvedLocationHint(scene,source,'A boat on the Panama Canal.'));
 scene.documentary!.requirement.detail='A boat next to trees';assert.equal(documentaryUnresolvedLocationHint(scene,source,'A boat.'),undefined);
});
