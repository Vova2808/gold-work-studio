import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFile,mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createDefaultProjectSettings,createDocumentarySettings,createVoiceCalibration,type Project} from '@gold-work/shared';
import {prepareDocumentaryScript} from './documentary-plan.js';
import {documentaryAiPlanContext} from './documentary-ai-plan-state.js';
import {claimDocumentaryThematicRecovery,documentaryThematicDiscoveryRequirement,documentaryThematicRecoveryBinding} from './documentary-automatic-thematic-recovery.js';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {DocumentaryAnalysisError} from './documentary-analysis-error.js';
import {documentarySavedContextIssue} from './documentary-context-approval.js';
import {documentaryIllustrationResponseInstruction,documentaryFallbackNarrativeResponseInstruction,documentaryIllustrationQualityInstructionV4} from './documentary-illustration-quality.js';
import {effectFfmpeg} from './effect-media.js';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
let root:string,video:string;
before(async()=>{
 root=await mkdtemp(join(tmpdir(),'gws-thematic-review-scope-'));video=join(root,'fixture.mp4');
 await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=s=1280x720:r=3','-t','4','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',video]);
});
after(async()=>{if(root){assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&root.includes('gws-thematic-review-scope-'));await rm(root,{recursive:true,force:true});}});
function stamp(project:Project){for(const scene of project.scenes){const ai=scene.documentary!.requirement.aiSearchPlan!;
 ai.inputHash=hash({inputHash:hash({version:1,model:ai.model,context:documentaryAiPlanContext(project)}),sceneId:scene.id});}}
async function fixture(number:31|45=31){
 const directory=await mkdtemp(join(root,'case-')),file=join(directory,'source.mp4');await copyFile(video,file);
 const narration=number===31?'The crew held her course with damaged steering.':'The route home offered something the China trade increasingly denied her: ';
 const project={id:'thematic-scope',title:'Cutty Sark',topic:'Cutty Sark history',language:'en',mediaMode:'stock',aspectRatio:'16:9',
  settings:createDefaultProjectSettings(),videoBrief:{readyScript:'Cutty Sark entered the Australian wool trade.\n'+narration},scenes:[]} as unknown as Project;
 project.settings.assembly.documentary={...createDocumentarySettings(),matchMode:'thematic'};
 const base=prepareDocumentaryScript(project,createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:narration,audioDurationSeconds:4}))[0]!;
 const rows=[{narration:'Cutty Sark entered the Australian wool trade.',subject:'Cutty Sark',target:'Cutty Sark ship in the wool trade'},
  {narration,subject:'sailing ship favorable wind conditions',target:number===31?'Sailing ship under canvas with damaged steering, crew at helm':'sailing ship under full sail in strong wind'}];
 project.scenes=rows.map((row,index)=>{
  const scene=structuredClone(base);scene.id='scene-'+(number-1+index);scene.order=number-2+index;scene.narration=row.narration;scene.durationSeconds=4;
  scene.documentary={...scene.documentary!,verified:false,pinned:false,timing:undefined,
   requirement:{text:row.narration,entities:[row.subject],identities:[{name:row.subject,aliases:[]}],years:index&&number===31?['1872']:[],queries:[row.target],detail:row.target,
    aiSearchPlan:{version:1,inputHash:'',model:'fixture',subject:row.subject,visualTarget:row.target,visualScope:'illustrative',preferredKind:'video',
     years:index&&number===31?['1872']:[],imageQueries:[row.target],videoQueries:[row.target],fallbackVisualTarget:number===31?"Sailors working ship's wheel and rigging":'sailing ship under full sail at sea',
     fallbackVideoQueries:[number===31?'sailors wheel rigging':'sailing ship full sail']}}};
  return scene;
 });
 let scene=project.scenes[1]!;scene.videoPath=file;scene.trimStartSeconds=0;scene.trimEndSeconds=4;
 scene.documentary!.checksum=createHash('sha256').update(await readFile(file)).digest('hex');
 scene.documentary!.selected={id:'local:fixture',provider:'local',kind:'video',title:'A sailing ship and crew',description:'Fixture source',localPath:file,
  durationSeconds:4,width:1280,height:720,pageUrl:'',downloadUrl:'',rights:'user-confirmed',author:'fixture',license:'user',licenseUrl:'',attribution:'fixture',retrievedAt:'now',query:'ship',match:'unverified',concerns:[]};
 stamp(project);scene=claimDocumentaryThematicRecovery(project,scene);project.scenes[1]=scene;
 assert.ok(documentaryThematicDiscoveryRequirement(project,scene));
 return {directory,project,scene};
}
const answer=(overrides:Record<string,unknown>={})=>({description:'Crew visibly work the wheel and rigging of a sailing ship.',suitable:false,
 reason:'Controlled fixture verdict, not a live pixel assessment.',footageOrigin:'camera',targetVisible:true,targetEvidence:'Wheel, crew and rigging are visible.',sourceText:{kind:'none',text:''},...overrides});
function client(onRequest:(system:string,input:Record<string,any>)=>void=()=>{},result:Record<string,unknown>=answer()){
 let calls=0;return {get calls(){return calls;},configured:async()=>true,documentaryCompletion:async(system:string,input:string,images?:string[])=>{
  calls++;assert.equal(images?.length,3);const data=JSON.parse(input);onRequest(system,data);
  const context=data.fallbackNarrativeContext;
  return JSON.stringify(context&&result.suitable===true?{...result,narrativeFit:{version:1,binding:context.binding,status:'supported',
   scriptQuote:context.narration.trim(),evidence:'Mock visible maritime action provides a related illustration of the unchanged story point.'}}:result);
 }};
}

for(const number of [31,45] as const)test(`actual final payload for generic thematic ${number} owns its task and preserves story context`,async()=>{
 const {directory,project,scene}=await fixture(number),before=structuredClone(project);
 const fake=client((system,input)=>{
  assert.equal(system,documentaryFallbackNarrativeResponseInstruction);assert.ok(system.length<5000);
  assert.match(system,/all conditions are required/);assert.match(system,/actual camera footage/);assert.match(system,/sourceText/);
  assert.equal(input.visualTarget,scene.documentary!.requirement.aiSearchPlan!.fallbackVisualTarget);assert.equal(input.sourcePolicy,'background');
  assert.equal(input.namedSubject,undefined);assert.equal(input.requiredSubject,undefined);assert.deepEqual(input.requiredYears,[]);
  assert.equal(input.narration,scene.narration);assert.equal(input.fullScript,project.videoBrief!.readyScript);assert.match(JSON.stringify(input.narrativeContext),/Cutty Sark/);
 });
 const result=await new DocumentaryIntelligence(fake,()=>directory).inspectForSelection(project,scene);
 assert.equal(result.review.status,'rejected');assert.equal(fake.calls,1);assert.deepEqual(project,before);
});

for(const mode of ['primary','literal','manual-directive','manual-source','manual-fallback','pinned','stale-binding','stale-target'] as const)
 test(`${mode} uses one target contract without a second identity gate`,async()=>{
  const {directory,project,scene}=await fixture(45),doc=scene.documentary!;
  if(mode==='primary')delete doc.requirement.footageFallback;
  if(mode==='literal')project.settings.assembly.documentary!.matchMode='literal';
  if(mode==='manual-directive')scene.imagePrompt='[Visual: exact Cutty Sark only]';
  if(mode==='manual-source')doc.selected!.id='manual:chosen';
  if(mode==='manual-fallback')delete doc.requirement.footageFallback!.automaticRecovery;
  if(mode==='pinned')doc.pinned=true;
  if(mode==='stale-binding')doc.requirement.footageFallback!.automaticRecovery!.binding='stale';
  if(mode==='stale-target')doc.requirement.footageFallback!.target='different reserve target';
  stamp(project);
  if(mode==='literal'||mode==='manual-directive'||mode==='pinned'){
   doc.requirement.footageFallback!.automaticRecovery!.binding=documentaryThematicRecoveryBinding(project,scene);
   assert.ok(documentaryThematicDiscoveryRequirement(project,scene),'Authored policy must hold even with a current reserve binding');
  }
  const fake=client((system,input)=>{
   assert.equal(system,documentaryIllustrationResponseInstruction);assert.equal(input.requiredSubject,undefined);
   assert.match(system,/different named person or object is a mismatch/);
  });
  const result=await new DocumentaryIntelligence(fake,()=>directory).inspectForSelection(project,scene);
  assert.equal(result.review.status,'rejected');assert.equal(fake.calls,1);
 });

test('an explicitly named, dated and detailed reserve retains those own constraints',async()=>{
 const {directory,project,scene}=await fixture(),doc=scene.documentary!,ai=doc.requirement.aiSearchPlan!;
 ai.fallbackVisualTarget='Cutty Sark stern and rudder during repairs in 1872';ai.fallbackVideoQueries=['Cutty Sark rudder repair 1872'];
 Object.assign(doc.requirement.footageFallback!,{target:ai.fallbackVisualTarget,queries:ai.fallbackVideoQueries});
 doc.requirement.footageFallback!.automaticRecovery!.binding=documentaryThematicRecoveryBinding(project,scene);
 const fake=client((system,input)=>{
  assert.equal(system,documentaryFallbackNarrativeResponseInstruction);assert.equal(input.visualTarget,ai.fallbackVisualTarget);assert.deepEqual(input.requiredYears,['1872']);
  assert.match(system,/Evaluate every requested identity, material, technology, state, action, direction, place and appearance/);
 });
 assert.equal((await new DocumentaryIntelligence(fake,()=>directory).inspectForSelection(project,scene)).review.status,'rejected');
});

for(const [target,evidence] of [
 ['steam-powered ship at sea','Only a modern motor cargo ship is established; steam propulsion is not established.'],
 ['sailing ship under sail','The ship is in dry dock and its sails are stowed.'],
 ['coal being unloaded at a port','Bulk material could be moving into or out of the hold; coal and unloading are not established.'],
] as const)test(`the single reserve verdict must establish every condition of ${target}`,async()=>{
 const {directory,project,scene}=await fixture(),doc=scene.documentary!,ai=doc.requirement.aiSearchPlan!;
 ai.fallbackVisualTarget=target;ai.fallbackVideoQueries=[target];
 Object.assign(doc.requirement.footageFallback!,{target,queries:[target]});
 doc.requirement.footageFallback!.automaticRecovery!.binding=documentaryThematicRecoveryBinding(project,scene);
 const fake=client((system,input)=>{
  assert.equal(input.visualTarget,target);assert.equal(system,documentaryFallbackNarrativeResponseInstruction);
  assert.match(system,/COMPLETE current visualTarget/);assert.match(system,/every requested identity, material, technology, state, action, direction/);
  assert.match(system,/modern museum view does not substitute for a requested action or state/);
  assert.match(system,/any condition is absent or unproven/);
 },answer({suitable:true,targetVisible:false,targetEvidence:evidence}));
 const result=await new DocumentaryIntelligence(fake,()=>directory).inspectForSelection(project,scene);
 assert.equal(result.review.status,'rejected');assert.ok(result.review.reason.includes(evidence));
 assert.equal(result.review.illustrationApproval,undefined);assert.equal(fake.calls,1,'A contradictory suitable flag never requests another analysis');
});

for(const oldSuitable of [false,true])test(`the new target contract replaces completed V4 suitable=${oldSuitable} once and preserves unknown guards`,async()=>{
 const {directory,project,scene}=await fixture(),doc=scene.documentary!,ai=doc.requirement.aiSearchPlan!;
 ai.fallbackVisualTarget='open ocean waves';ai.fallbackVideoQueries=['open ocean waves'];
 Object.assign(doc.requirement.footageFallback!,{target:ai.fallbackVisualTarget,queries:ai.fallbackVideoQueries});
 doc.requirement.footageFallback!.automaticRecovery!.binding=documentaryThematicRecoveryBinding(project,scene);
 const fake=client((system,input)=>{
  assert.equal(input.visualTarget,'open ocean waves');assert.deepEqual(input.requiredYears,[]);assert.equal(input.requiredSubject,undefined);
  assert.match(system,/visualTarget defines targetVisible/);
  assert.match(system,/original narration and fallbackNarrativeContext define the meaning that must survive/);
  assert.match(system,/generic target with no historical condition may use modern material/);
 },answer({suitable:true,description:'Open ocean waves viewed past a modern ship bow.',targetEvidence:'Open ocean and waves are directly visible.'}));
 const intel=new DocumentaryIntelligence(fake,()=>directory),first=await intel.inspectForSelection(project,scene);
 assert.equal(first.review.status,'accepted');assert.equal(fake.calls,1);
 // The corrected semantic contract has its own deterministic paid checkpoint.
 // Old completed output is retained as evidence, not reused as the new verdict.
 const previousDirectory=join(directory,'previous');
 const prior=new DocumentaryIntelligence(client(()=>{},answer({suitable:oldSuitable,targetVisible:true,reason:'Old target interpretation.'})),()=>previousDirectory);
 const priorComplete=Reflect.get(prior,'complete').bind(prior);
 Reflect.set(prior,'complete',(...args:any[])=>{const old=args[5].find((r:any)=>r.system.endsWith(documentaryIllustrationQualityInstructionV4));return priorComplete(args[0],args[1],old.system,old.input,args[4],[]);});
 await prior.inspectForSelection(project,scene);
 const analysis=join(previousDirectory,'Documentary','Analysis'),names=(await readdir(analysis)).filter(name=>/^[a-f0-9]{64}\.json$/.test(name));
 const path=join(analysis,names[0]!),oldBytes=await readFile(path,'utf8'),receipt=JSON.parse(oldBytes);
 const fresh=client(()=>{},answer({suitable:!oldSuitable,targetVisible:!oldSuitable,reason:'New complete target assessment.'}));
 const expected=oldSuitable?'rejected':'accepted';
 const updated=await new DocumentaryIntelligence(fresh,()=>previousDirectory).inspectForSelection(project,scene);
 assert.equal(updated.review.status,expected);assert.equal(updated.usedNewAnalysis,true);assert.equal(fresh.calls,1);
 const resumed=await new DocumentaryIntelligence(fresh,()=>previousDirectory).inspectForSelection(project,scene);
 assert.equal(resumed.review.status,expected);assert.equal(resumed.usedNewAnalysis,false);assert.equal(fresh.calls,1);
 assert.equal(await readFile(path,'utf8'),oldBytes,'Completed V4 evidence is never overwritten');
 const newName=(await readdir(analysis)).find(name=>/^[a-f0-9]{64}\.json$/.test(name)&&name!==names[0])!;
 assert.ok(newName);const newPath=join(analysis,newName),newReceipt=JSON.parse(await readFile(newPath,'utf8'));
 for(const state of ['pending','partial','received']){
  await writeFile(newPath,JSON.stringify({...newReceipt,state,result:undefined,raw:undefined}));
  await assert.rejects(new DocumentaryIntelligence(fresh,()=>previousDirectory).inspectForSelection(project,scene),DocumentaryAnalysisError);
  assert.equal(fresh.calls,1,'An unfinished new-policy job is never resubmitted');
 }
 await rm(newPath);
 for(const state of ['pending','partial','received']){
  await writeFile(path,JSON.stringify({...receipt,state,result:undefined,raw:undefined}));
  await assert.rejects(new DocumentaryIntelligence(fresh,()=>previousDirectory).inspectForSelection(project,scene),DocumentaryAnalysisError);
  assert.equal(fresh.calls,1,'A policy version never bypasses an unfinished old job');
 }
});

test('a new generic approval retains current file/context evidence and resumes without another request',async()=>{
 const {directory,project,scene}=await fixture(),fake=client(()=>{},answer({suitable:true}));
 const first=await new DocumentaryIntelligence(fake,()=>directory).inspectForSelection(project,scene);
 assert.equal(first.review.status,'accepted');assert.ok(first.review.illustrationApproval);assert.ok(first.review.localReview);
 scene.documentary!.visualReview=first.review;scene.documentary!.verified=true;
 assert.equal(documentarySavedContextIssue(project,scene),undefined);
 const resumed=await new DocumentaryIntelligence(fake,()=>directory).inspectForSelection(project,scene,undefined,undefined,true);
 assert.equal(resumed.review.status,'accepted');assert.equal(resumed.usedNewAnalysis,false);assert.equal(fake.calls,1);
 assert.deepEqual(resumed.review.illustrationApproval,first.review.illustrationApproval);
 scene.imagePrompt='[Visual: exact original subject only]';assert.match(documentarySavedContextIssue(project,scene)!,/изменилось/);
});

async function receiptWithoutModelInput(){
 const f=await fixture(),fake={...client(()=>{},answer({suitable:true})),documentaryAnalysisModel:async()=> 'model-A'};
 const intel=new DocumentaryIntelligence(fake,()=>f.directory),complete=Reflect.get(intel,'complete').bind(intel);
 Reflect.set(intel,'complete',(...args:unknown[])=>{
  const input=JSON.parse(String(args[3]));delete input.analysisModel;
  return complete(args[0],args[1],args[2],JSON.stringify(input),args[4],[]);
 });
 assert.equal((await intel.inspectForSelection(f.project,f.scene)).review.status,'accepted');
 const analysis=join(f.directory,'Documentary','Analysis'),names=(await readdir(analysis)).filter(name=>/^[a-f0-9]{64}\.json$/.test(name));
 assert.equal(names.length,1);const path=join(analysis,names[0]!),bytes=await readFile(path,'utf8'),receipt=JSON.parse(bytes);
 assert.equal(receipt.model,'model-A');return {...f,analysis,path,bytes,receipt};
}

test('single review model A completion cannot approve model B; B sends once and resumes its own receipt',async()=>{
 const f=await receiptWithoutModelInput();
 const same=client(()=>{},answer({suitable:false}));Reflect.set(same,'documentaryAnalysisModel',async()=> 'model-A');
 assert.equal((await new DocumentaryIntelligence(same,()=>f.directory).inspectForSelection(f.project,f.scene)).review.status,'accepted');
 assert.equal(same.calls,0,'A pre-model-input completed receipt is reusable by its actual model');
 const next=client((_system,input)=>assert.equal(input.analysisModel,'model-B'),answer({suitable:false,targetVisible:false}));
 Reflect.set(next,'documentaryAnalysisModel',async()=> 'model-B');
 const intel=new DocumentaryIntelligence(next,()=>f.directory),first=await intel.inspectForSelection(f.project,f.scene);
 assert.equal(first.review.status,'rejected');assert.equal(first.usedNewAnalysis,true);assert.equal(next.calls,1);
 const resumed=await new DocumentaryIntelligence(next,()=>f.directory).inspectForSelection(f.project,f.scene);
 assert.equal(resumed.review.status,'rejected');assert.equal(resumed.usedNewAnalysis,false);assert.equal(next.calls,1);
 assert.equal(await readFile(f.path,'utf8'),f.bytes,'The former completed receipt is immutable');
 const files=(await readdir(f.analysis)).filter(name=>/^[a-f0-9]{64}\.json$/.test(name));assert.equal(files.length,2);
 const newer=JSON.parse(await readFile(join(f.analysis,files.find(name=>join(f.analysis,name)!==f.path)!),'utf8'));
 assert.equal(newer.model,'model-B');assert.notEqual(newer.singleReviewBinding.taskKey,f.receipt.singleReviewBinding.taskKey);
});

test('same-model unknown single review remains blocked across model-key migration; another model is independent',async()=>{
 const f=await receiptWithoutModelInput(),same=client();Reflect.set(same,'documentaryAnalysisModel',async()=> 'model-A');
 for(const state of ['pending','partial','received']){
  const bytes=JSON.stringify({...f.receipt,state,result:undefined,raw:state==='partial'?'unfinished':undefined});await writeFile(f.path,bytes);
  await assert.rejects(new DocumentaryIntelligence(same,()=>f.directory).inspectForSelection(f.project,f.scene),DocumentaryAnalysisError);
  assert.equal(same.calls,0);assert.equal(await readFile(f.path,'utf8'),bytes);
 }
 const oldBytes=await readFile(f.path,'utf8'),next=client(()=>{},answer({suitable:true}));Reflect.set(next,'documentaryAnalysisModel',async()=> 'model-B');
 assert.equal((await new DocumentaryIntelligence(next,()=>f.directory).inspectForSelection(f.project,f.scene)).review.status,'accepted');
 assert.equal(next.calls,1);assert.equal(await readFile(f.path,'utf8'),oldBytes);
 const name=(await readdir(f.analysis)).find(name=>/^[a-f0-9]{64}\.json$/.test(name)&&join(f.analysis,name)!==f.path)!;
 const path=join(f.analysis,name),receipt=JSON.parse(await readFile(path,'utf8'));
 for(const state of ['pending','partial','received']){
  const bytes=JSON.stringify({...receipt,state,result:undefined});await writeFile(path,bytes);
  await assert.rejects(new DocumentaryIntelligence(next,()=>f.directory).inspectForSelection(f.project,f.scene),DocumentaryAnalysisError);
  assert.equal(next.calls,1);assert.equal(await readFile(path,'utf8'),bytes);
 }
});

for(const [name,value] of [
 ['unrelated-object',{suitable:false,targetVisible:false,reason:'Only a modern motorized cargo ship is visible.'}],
 ['missing-action',{suitable:false,reason:'No crew working the wheel or rigging is visible.'}],
 ['unseen-target',{suitable:true,targetVisible:false}],
 ['non-camera',{suitable:true,footageOrigin:'non-camera'}],
 ['unrelated-caption',{suitable:true,sourceText:{kind:'caption',text:'Unrelated advertisement',relevant:false,evidence:'Advertises another product.'}}],
] as const)test(`${name} remains rejected under thematic scope`,async()=>{
 const {directory,project,scene}=await fixture(),fake=client(()=>{},answer(value));
 const result=await new DocumentaryIntelligence(fake,()=>directory).inspectForSelection(project,scene);
 assert.equal(result.review.status,'rejected');assert.equal(result.review.illustrationApproval,undefined);assert.equal(fake.calls,1);
});

async function oldReceiptFixture(result:Record<string,unknown>){
 const f=await fixture(),fake=client(()=>{},result),intel=new DocumentaryIntelligence(fake,()=>f.directory);
 await intel.inspectForSelection(f.project,f.scene);
 const analysis=join(f.directory,'Documentary','Analysis'),files=(await readdir(analysis)).filter(name=>/^[a-f0-9]{64}\.json$/.test(name));
 assert.equal(files.length,1);const path=join(analysis,files[0]!),bytes=await readFile(path,'utf8');
 return {...f,fake,analysis,path,bytes,receipt:JSON.parse(bytes)};
}
for(const uncertain of [false,true])test(`old complete ${uncertain?'unknown verdict':'refusal'} is reused unchanged, never promoted or repaid`,async()=>{
 const f=await oldReceiptFixture(answer(uncertain?{suitable:undefined}:{suitable:false}));
 const result=await new DocumentaryIntelligence(f.fake,()=>f.directory).inspectForSelection(f.project,f.scene);
 assert.equal(result.review.status,uncertain?'uncertain':'rejected');assert.equal(result.review.illustrationApproval,undefined);
 assert.equal(result.usedNewAnalysis,false);assert.equal(f.fake.calls,1);assert.equal(await readFile(f.path,'utf8'),f.bytes);
 assert.equal((await readdir(f.analysis)).length,1);
 f.scene.documentary!.selected!.description='Changed discovery metadata';
 const drift=await new DocumentaryIntelligence(f.fake,()=>f.directory).inspectForSelection(f.project,f.scene);
 assert.notEqual(drift.review.status,'accepted');assert.equal(drift.usedNewAnalysis,false);assert.equal(f.fake.calls,1);assert.equal(await readFile(f.path,'utf8'),f.bytes);
});

for(const state of ['pending','partial','received'])test(`old ${state} paid receipt blocks the changed prompt without a new request`,async()=>{
 const f=await oldReceiptFixture(answer());
 const bytes=JSON.stringify({...f.receipt,state,result:undefined});await writeFile(f.path,bytes);
 f.scene.documentary!.selected!.description='Metadata drift cannot bypass unknown work';
 await assert.rejects(new DocumentaryIntelligence(f.fake,()=>f.directory).inspectForSelection(f.project,f.scene),DocumentaryAnalysisError);
 assert.equal(f.fake.calls,1);assert.equal(await readFile(f.path,'utf8'),bytes);assert.equal((await readdir(f.analysis)).length,1);
});
