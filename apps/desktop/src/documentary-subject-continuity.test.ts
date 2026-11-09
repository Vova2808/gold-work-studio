import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm,readFile,readdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createDefaultProjectSettings,documentaryAiPlanContext,type Project,type Scene} from '@gold-work/shared';
import {documentarySubjectContinuity} from './documentary-subject-continuity.js';
import {planFastDocumentaryScene} from './documentary-fast-plan.js';
import {DocumentaryAiQueryPlanner} from './documentary-ai-query-planner.js';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {documentarySavedContextIssue,revalidateDocumentaryContext} from './documentary-context-approval.js';
import {DocumentaryAnalysisError} from './documentary-analysis-error.js';
import {effectFfmpeg} from './effect-media.js';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function stamp(project:Project){
 const inputHash=hash({version:1,model:'fixture',context:documentaryAiPlanContext(project)});
 for(const scene of project.scenes)scene.documentary!.requirement.aiSearchPlan!.inputHash=hash({inputHash,sceneId:scene.id});
}
function fixture(){
 const rows:Array<[string,string,string]>=[
  ['Cutty Sark entered the Australian wool trade. ','Cutty Sark in the Australian wool trade','Cutty Sark ship, wool trade era depiction'],
  ['The route home offered something the China trade increasingly denied her: ','sailing ship favorable wind conditions','sailing ship under full sail in strong wind'],
 ];
 const scenes=rows.map(([narration,subject,visualTarget],order)=>({id:`scene-${order}`,order,narration,durationSeconds:4,
  documentary:{verified:false,requirement:{text:narration,entities:[subject],identities:[{name:subject,aliases:[]}],years:[],queries:[subject],
   visualScope:'illustrative',plannedBy:'semantic',aiSearchPlan:{version:1,model:'fixture',inputHash:'',subject,visualTarget,
    visualScope:'illustrative',preferredKind:'image',years:[],imageQueries:[order?'sailing ship under full sail':'Cutty Sark wool clipper painting'],
    videoQueries:[order?'sailing ship at sea':'Cutty Sark preserved ship Greenwich'],fallbackVisualTarget:'wool bales',fallbackVideoQueries:['wool bales']}}}} as unknown as Scene));
 const project={id:'continuity',title:'History',topic:'A ship',language:'en',mediaMode:'stock',aspectRatio:'16:9',
  settings:createDefaultProjectSettings(),scenes,videoBrief:{readyScript:scenes.map(s=>s.narration).join('\n')}} as Project;
 stamp(project);return {project,previous:scenes[0]!,scene:scenes[1]!};
}
function change(scene:Scene,narration:string,subject:string,target:string){
 scene.narration=narration;
 const req=scene.documentary!.requirement;req.text=narration;req.entities=[subject];req.identities=[{name:subject,aliases:[]}];
 Object.assign(req.aiSearchPlan!,{subject,visualTarget:target});
}
async function temp(t:test.TestContext){
 const root=await mkdtemp(join(tmpdir(),'gws-subject-continuity-'));
 assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));
 t.after(()=>rm(root,{recursive:true,force:true}));return root;
}

test('scene 45 keeps the preceding named referent in a cached illustrative plan without changing its paid payload',()=>{
 const {project,previous,scene}=fixture(),before=structuredClone(project);
 assert.deepEqual(documentarySubjectContinuity(project,scene),{subject:'Cutty Sark',antecedentSceneId:previous.id,antecedent:previous.narration,pronoun:'her'});
 for(const kind of ['image','video'] as const){
  const effective=planFastDocumentaryScene(project,scene,kind);
  assert.equal(effective.namedSubject,'Cutty Sark');assert.equal(effective.sourcePolicy,'specific');
  assert.deepEqual(effective.queries,kind==='image'?previous.documentary!.requirement.aiSearchPlan!.imageQueries:previous.documentary!.requirement.aiSearchPlan!.videoQueries);
 }
 assert.equal(planFastDocumentaryScene(project,scene,'image',false).namedSubject,undefined,'The exact former request remains available for receipt lookup');
 assert.deepEqual(project,before);
});

test('the referent repair is not ship-specific',()=>{
 const {project,previous,scene}=fixture();
 change(previous,'Airbus A320 entered service.','Airbus A320 passenger aircraft','Airbus A320 aircraft at an airport');
 change(scene,'It could use shorter runways.','passenger aircraft','passenger aircraft taking off');stamp(project);
 assert.equal(documentarySubjectContinuity(project,scene)?.subject,'Airbus A320');
});

test('background targets, explicit new subjects, ambiguous antecedents and standalone narration retain their own task',()=>{
 for(const target of ['map of the route home','wind conditions over the ocean','close-up of ship rigging','wool bales in a warehouse','sailing routes across the sea']){
  const {project,scene}=fixture();scene.documentary!.requirement.aiSearchPlan!.visualTarget=target;
  assert.equal(documentarySubjectContinuity(project,scene),undefined,target);
 }
 {
  const {project,scene}=fixture();change(scene,'RMS Olympic followed her.','RMS Olympic','passenger ship at sea');stamp(project);
  assert.equal(documentarySubjectContinuity(project,scene),undefined);
 }
 for(const narration of ['Another ship overtook her.','The weather changed. It made the ship faster.']){
  const {project,scene}=fixture();scene.narration=narration;scene.documentary!.requirement.text=narration;stamp(project);
  assert.equal(documentarySubjectContinuity(project,scene),undefined);
 }
 for(const narration of ['Cutty Sark and Thermopylae entered the wool trade.','Cutty Sark raced against Thermopylae.']){
  const {project,previous,scene}=fixture();previous.narration=narration;previous.documentary!.requirement.text=narration;stamp(project);
  assert.equal(documentarySubjectContinuity(project,scene),undefined);
 }
 {
  const {project,scene}=fixture();scene.narration='Favorable winds helped sailing ships compete.';scene.documentary!.requirement.text=scene.narration;stamp(project);
  assert.equal(documentarySubjectContinuity(project,scene),undefined);
 }
 {
  const {project,scene}=fixture();scene.documentary!.requirement.footageFallback={target:'wool bales',queries:['wool bales']} as never;
  assert.equal(documentarySubjectContinuity(project,scene),undefined,'An explicitly labelled reserve retains its independent visible task');
 }
});

test('existing exact named tasks and named details keep their original constraint without acquiring an extra proof gate',()=>{
 for(const target of ['Cutty Sark ship at the museum','Cutty Sark rudder close-up']){
  const {project,scene}=fixture(),ai=scene.documentary!.requirement.aiSearchPlan!;
  ai.subject='Cutty Sark';ai.visualScope='exact';ai.visualTarget=target;
  assert.equal(documentarySubjectContinuity(project,scene),undefined);
  const plan=planFastDocumentaryScene(project,scene);
  assert.equal(plan.namedSubject,'Cutty Sark');assert.equal(plan.sourcePolicy,'specific');assert.equal(plan.visualTarget,target);
 }
});

test('cold planner and persistent prepared cache both retain the same computed subject constraint',async t=>{
 const root=await temp(t),{project,scene}=fixture();let calls=0;
 const entries=project.scenes.map(item=>({sceneId:item.id,...item.documentary!.requirement.aiSearchPlan}));
 project.scenes.forEach(item=>{delete item.documentary!.requirement.aiSearchPlan;});
 const planner=new DocumentaryAiQueryPlanner({documentaryQueryModel:async()=>'fixture',documentaryCompletion:async()=>{
  calls++;return JSON.stringify({scenes:entries});
 }} as never,()=>root);
 const apply=(requirements:Awaited<ReturnType<typeof planner.plan>>)=>{for(const item of project.scenes)item.documentary!.requirement=requirements.get(item.id)!;};
 apply(await planner.plan(project,project.scenes));
 assert.equal(documentarySubjectContinuity(project,scene)?.subject,'Cutty Sark');assert.equal(calls,1);
 apply((await planner.readCached(project,project.scenes))!);
 assert.equal(planFastDocumentaryScene(project,scene).namedSubject,'Cutty Sark');assert.equal(calls,1);
});

async function mediaFixture(t:test.TestContext){
 const root=await temp(t),f=fixture(),file=join(root,'ship.jpg');
 await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=s=1280x720:r=1','-frames:v','1',file]);
 f.scene.imagePath=file;
 const doc=f.scene.documentary!;doc.checksum=createHash('sha256').update(await readFile(file)).digest('hex');
 doc.selected={id:'local:ship',provider:'local',kind:'image',title:'A sailing ship',description:'A two-masted schooner',localPath:file,
  pageUrl:'',downloadUrl:'',rights:'user-confirmed',author:'fixture',license:'user',licenseUrl:'',attribution:'fixture',retrievedAt:'now',query:'sailing ship',match:'unverified',concerns:[]};
 return {root,...f};
}
const genericAnswer={description:'A two-masted schooner in a harbor.',suitable:true,reason:'A sailing ship fits the generic target.'};

for(const suitable of [true,false])test(`single target OR alternative uses one model verdict suitable=${suitable} without a second identity gate`,async t=>{
 const {root,project,previous,scene}=await mediaFixture(t);
 change(previous,'John Willis owned the clipper.','John Willis','portrait of John Willis');
 const target='portrait of shipowner John Willis OR preserved Cutty Sark rigging and masts';
 change(scene,'He was betting on speed.','shipowner',target);stamp(project);
 assert.equal(documentarySubjectContinuity(project,scene)?.subject,'John Willis','The former local gate would require the person even for allowed rigging');
 let calls=0;
 const intel=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(_system,input)=>{
  calls++;const data=JSON.parse(input);assert.equal(data.visualTarget,target);assert.equal(data.requiredSubject,undefined);
  return JSON.stringify({description:suitable?'Preserved Cutty Sark masts and rigging.':'Portrait of John Willis Clark, a different person.',suitable,
   targetVisible:suitable,targetEvidence:suitable?'The permitted rigging alternative is visible.':'The named shipowner is not depicted.',
   reason:suitable?'One explicitly permitted alternative is present.':'The portrait depicts a different person.',sourceText:{kind:'none',text:''}});
 }},()=>root);
 const result=await intel.inspectForSelection(project,scene);assert.equal(result.review.status,suitable?'accepted':'rejected');assert.equal(calls,1);
 if(suitable){scene.documentary!.visualReview=result.review;scene.documentary!.verified=true;assert.equal(documentarySavedContextIssue(project,scene),undefined);}
 else assert.equal(result.review.illustrationApproval,undefined);
});

test('single review keeps the authored target without an inherited identity gate; missing pixel proof remains uncertain',async t=>{
 const {root,project,scene}=await mediaFixture(t);let calls=0;
 const intel=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(system,input,images)=>{
  calls++;assert.equal(images?.length,1);assert.equal(JSON.parse(input).requiredSubject,undefined);
  assert.match(system,/visualTarget is the binding task/);return JSON.stringify(genericAnswer);
 }},()=>root);
 const first=await intel.inspectForSelection(project,scene);
 assert.equal(first.review.status,'uncertain');assert.equal(first.review.illustrationApproval,undefined);assert.match(first.review.reason,/видимость|объект/);
 const replay=await intel.inspectForSelection(project,scene);assert.equal(replay.review.status,'uncertain');assert.equal(replay.usedNewAnalysis,false);assert.equal(calls,1);
});

test('modern same-object evidence is approved once and survives a prepared resume',async t=>{
 const {root,project,scene}=await mediaFixture(t);let calls=0;
 const client={configured:async()=>true,documentaryCompletion:async()=>{
  calls++;return JSON.stringify({description:'Modern museum view of the preserved Cutty Sark.',suitable:true,identifiedEntity:'Cutty Sark',targetVisible:true,targetEvidence:'The museum ship hull and masts are visible.',sourceText:{kind:'none',text:''},reason:'Modern illustration of the same named object, not the historical event.'});
 }};
 const first=await new DocumentaryIntelligence(client,()=>root).inspectForSelection(project,scene);
 assert.equal(first.review.status,'accepted');assert.ok(first.review.illustrationApproval);
 scene.documentary!.visualReview=first.review;scene.documentary!.verified=true;
 assert.equal(documentarySavedContextIssue(project,scene),undefined);
 const next=await new DocumentaryIntelligence(client,()=>root).inspectForSelection(project,scene,undefined,undefined,true);
 assert.equal(next.usedNewAnalysis,false);assert.equal(next.review.status,'accepted');assert.equal(calls,1);
 assert.deepEqual(next.review.illustrationApproval,first.review.illustrationApproval);
});

test('old COMPLETE generic approval is invalidated, reviewed under the new contract once, and unknown states remain blocked',async t=>{
 const {root,project,scene}=await mediaFixture(t);let calls=0;
 const client={configured:async()=>true,documentaryCompletion:async()=>{calls++;return JSON.stringify(genericAnswer);}};
 const intel=new DocumentaryIntelligence(client,()=>root),complete=Reflect.get(intel,'complete').bind(intel);
 // Recreate the exact pre-policy request/receipt, not a mock of cache reuse.
 Reflect.set(intel,'complete',(...args:unknown[])=>{
  const previous=args[5] as Array<{system:string;input:string}>;
  const old=previous.slice().reverse().find(request=>{const data=JSON.parse(request.input);return !data.sourceEvidence&&!data.requiredSubject;})!;
  return complete(args[0],args[1],old.system,old.input,args[4],[]);
 });
 const reviewed=await intel.inspectForSelection(project,scene);
 const doc=scene.documentary!;
 doc.visualReview={...reviewed.review,status:'accepted',viewDescription:genericAnswer.description,
  fastRelevance:{version:1,target:doc.requirement.aiSearchPlan!.visualTarget,relevant:true,evidence:genericAnswer.reason}};
 // The old fingerprint omitted the inherited subject entirely.
 doc.visualReview.illustrationApproval={version:1,fingerprint:hash({version:1,narration:scene.narration,
  source:{id:doc.selected!.id,provider:doc.selected!.provider,kind:doc.selected!.kind},checksum:doc.checksum,interval:null,localReview:doc.visualReview.localReview})};
 doc.verified=true;assert.ok(documentarySavedContextIssue(project,scene));
 assert.equal(revalidateDocumentaryContext(project)[1]!.documentary!.verified,false);
 const directory=join(root,'Documentary','Analysis'),files=(await readdir(directory)).filter(name=>/^[a-f0-9]{64}\.json$/.test(name));
 assert.equal(files.length,1);const path=join(directory,files[0]!),bytes=await readFile(path,'utf8'),receipt=JSON.parse(bytes);
 const resumed=await new DocumentaryIntelligence(client,()=>root).inspectForSelection(project,scene);
 assert.equal(resumed.usedNewAnalysis,true);assert.equal(resumed.review.status,'uncertain');assert.equal(calls,2);assert.equal(await readFile(path,'utf8'),bytes);
 doc.selected!.description='Discovery metadata drift must not buy a new review';
 const drifted=await new DocumentaryIntelligence(client,()=>root).inspectForSelection(project,scene);
 assert.equal(drifted.review.status,'uncertain');assert.equal(drifted.usedNewAnalysis,false);assert.equal(calls,2);assert.equal(await readFile(path,'utf8'),bytes);
 // Remove the current completed successor to isolate the unknown predecessor guard.
 doc.selected!.description='A two-masted schooner';
 for(const name of await readdir(directory))if(/^[a-f0-9]{64}\.json$/.test(name)&&join(directory,name)!==path)await rm(join(directory,name));
 for(const state of ['pending','partial','received']){
  const pending=JSON.stringify({...receipt,state,result:undefined});await writeFile(path,pending);
  await assert.rejects(new DocumentaryIntelligence(client,()=>root).inspectForSelection(project,scene),DocumentaryAnalysisError);
  assert.equal(calls,2);assert.equal(await readFile(path,'utf8'),pending);
 }
});
