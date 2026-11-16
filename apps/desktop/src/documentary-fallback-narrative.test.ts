import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,copyFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createDefaultProjectSettings,createDocumentarySettings,createVoiceCalibration,type Project,type Scene} from '@gold-work/shared';
import {prepareDocumentaryScript} from './documentary-plan.js';
import {documentaryAiPlanContext} from './documentary-ai-plan-state.js';
import {DocumentaryCachedAnalysisMissing,DocumentaryIntelligence} from './documentary-intelligence.js';
import {DocumentaryAnalysisError} from './documentary-analysis-error.js';
import {AnyModelClient,AnyModelCompletionUncertainError} from './anymodel-client.js';
import {documentaryIllustrationApproval,documentarySavedContextIssue} from './documentary-context-approval.js';
import {claimDocumentaryThematicRecovery,documentaryThematicDiscoveryRequirement,documentaryThematicRecoveryBinding} from './documentary-automatic-thematic-recovery.js';
import {documentaryFallbackNarrativeContext,documentaryFallbackNarrativeFit,documentaryFallbackNarrativeIssue,documentaryFallbackNarrativeTask} from './documentary-fallback-narrative.js';
import {DocumentaryAiQueryPlanner} from './documentary-ai-query-planner.js';
import {effectFfmpeg} from './effect-media.js';
import {missingAssemblyInputs} from './assembly-readiness.js';
import {planDocumentaryMontage} from './documentary-montage.js';

const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
let root:string,video:string;
before(async()=>{root=await mkdtemp(join(tmpdir(),'gws-fallback-meaning-'));assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));video=join(root,'fixture.mp4');
 await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=s=1280x720:r=5','-t','4','-c:v','libx264','-pix_fmt','yuv420p',video]);});
after(()=>rm(root,{recursive:true,force:true}));
// Expected judgments come from independent full03 pixel QA. These fixtures test
// preservation/acceptance plumbing, not a live model's semantic judgment.
const cases=[
 {scene:18,narration:'On the China route, sailing ships had to travel around the southern end of Africa. ',subject:'sea route from China to Britain around the Cape of Good Hope',primary:'map of the sailing route from China to Britain around the southern tip of Africa',target:'ocean waves breaking on rocky coastline',title:'Portugal Algarve Sagres rocky coast',status:'conflict',evidence:'The source attributes this coast to Portugal; generic cliffs neither establish southern Africa nor show the narrated route.'},
 {scene:27,narration:'Two ships, two crews and the same destination. ',subject:'Cutty Sark and Thermopylae clipper ships',primary:'Cutty Sark and Thermopylae as two rival sailing ships',target:'two sailboats sailing side by side',title:'Two modern sports yachts with stadium and skyscraper',status:'conflict',evidence:'Modern small racing yachts do not represent the historical tea-clipper class or the named rivals in this subject-illustration scene.'},
 {scene:34,narration:'The crew cut up a spare spar and used it to construct a replacement rudder at sea.\n\n',subject:'Cutty Sark rudder',primary:"Cutty Sark's rudder at the stern",target:'carpenter sawing wooden beam',title:'A carpenter using a hand saw',status:'supported',evidence:'Hands cutting a wooden beam with a hand saw honestly illustrate cutting the spar; the original crew, place, year and completed rudder are not claimed.'},
 {scene:51,narration:'Under his command, Cutty Sark completed a passage from Sydney to London in just 73 days.\n\n',subject:'Cutty Sark',primary:'Cutty Sark under full sail',target:'sailing ship at sea',title:'Five-masted ship at sea with furled sails',status:'conflict',evidence:'The visible five-masted vessel differs from the named Cutty Sark and tea-clipper referent. Full deployed sails are not themselves required by the narration.'},
 {scene:55,narration:'In 1922, damage brought her to Falmouth for repairs. ',subject:'Cutty Sark',primary:'Cutty Sark (Ferreira) at Falmouth',target:'boats moored in harbour',title:'Boats in an unspecified modern marina',status:'uncertain',evidence:'Boats are visible, but neither the generic marina nor its provenance establishes the Falmouth location central to this scene; 1922 capture is not demanded.'},
] as const;
async function fixture(row:typeof cases[number],mode?:'thematic'|'literal'){
 const directory=await mkdtemp(join(root,'case-')),file=join(directory,'source.mp4');await copyFile(video,file);
 const project={id:'fidelity',title:'Cutty Sark',topic:'History',language:'en',mediaMode:'stock',aspectRatio:'16:9',settings:createDefaultProjectSettings(),
  videoBrief:{readyScript:'Cutty Sark and Thermopylae were rival tea clippers.\n'+row.narration},scenes:[]} as unknown as Project;
 project.settings.assembly.documentary={...createDocumentarySettings(),...(mode?{matchMode:mode}:{})};
 const scene=prepareDocumentaryScript(project,createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:row.narration,audioDurationSeconds:4}))[0]!;
 scene.narration=row.narration;scene.durationSeconds=4;scene.videoPath=file;scene.trimStartSeconds=0;scene.trimEndSeconds=4;
 const doc=scene.documentary!;doc.verified=false;doc.pinned=false;doc.checksum=createHash('sha256').update(await readFile(file)).digest('hex');
 doc.requirement={text:row.narration,entities:[row.subject],identities:[{name:row.subject,aliases:[]}],years:[],queries:[row.target],
  aiSearchPlan:{version:1,inputHash:'',model:'fixture',subject:row.subject,visualTarget:row.primary,years:[],visualScope:'illustrative',preferredKind:'video',reservePolicy:'thematic',
   imageQueries:[row.primary],videoQueries:[row.primary],fallbackVisualTarget:row.target,fallbackVideoQueries:[row.target]}};
 doc.selected={id:'fixture:'+row.scene,provider:'local',kind:'video',title:row.title,description:row.title,localPath:file,pageUrl:'https://example.test/'+row.scene,downloadUrl:'',
  author:'fixture',license:'fixture',licenseUrl:'',rights:'user-confirmed',attribution:'fixture',retrievedAt:'now',query:row.target,match:'unverified',concerns:[],width:1280,height:720,durationSeconds:4};
 project.scenes=[scene];doc.requirement.aiSearchPlan!.inputHash=hash({inputHash:hash({version:1,model:'fixture',context:documentaryAiPlanContext(project)}),sceneId:scene.id});
 doc.requirement.footageFallback={version:1,target:row.target,queries:[row.target],originalTarget:row.primary,narration:row.narration,reason:'thematic',kind:'video',
  automaticRecovery:{version:1,binding:documentaryThematicRecoveryBinding(project,scene),startedAt:'now',blockedSourceKeys:[]}};
 return {directory,project,scene};
}
const baseAnswer={description:'Mock actual-frame description of the requested fallback.',suitable:true,targetVisible:true,
 targetEvidence:'Mock concrete evidence confirms the simplified fallback category and action.',reason:'Pixel task matches.',sourceText:{kind:'none',text:''},footageOrigin:'camera'};
function proof(project:Project,scene:Scene,status='supported',evidence='The visible timber-cutting action honestly illustrates the original repair step.'){
 return {version:1,binding:documentaryFallbackNarrativeContext(project,scene)!.binding,status,scriptQuote:scene.narration.trim().slice(0,160),evidence};
}

test('empty terminal video review is a known failure with one automatic retry and no invented verdict',async()=>{
 const {directory,project,scene}=await fixture(cases[2]);
 let calls=0;
 const store={publicSettings:async()=>({configured:true,baseUrl:'https://fixture.test/v1',textModel:'fixture'}),apiKey:async()=>'fixture'};
 const client=new AnyModelClient(store as never,async()=>{
  calls++;
  return new Response('data: {"choices":[{"delta":{"content":""},"finish_reason":"stop"}]}\n\n',
    {headers:{'content-type':'text/event-stream'}});
 });
 const inspect=()=>new DocumentaryIntelligence(client,()=>directory).inspectForSelection(project,scene);
 await assert.rejects(inspect(),error=>error instanceof DocumentaryAnalysisError&&error.kind==='empty');
 assert.equal(calls,2);
 scene.documentary!.selected!.title+=' (updated discovery metadata)';
 await assert.rejects(inspect(),error=>error instanceof DocumentaryAnalysisError&&error.kind==='empty');assert.equal(calls,2);
});

for(const row of cases)test(`full03 scene ${row.scene}: a true simplified pixel verdict still requires original narrative fit`,async()=>{
 const {directory,project,scene}=await fixture(row);let calls=0;
 const client={configured:async()=>true,documentaryCompletion:async(system:string,input:string,images:string[])=>{
  calls++;const data=JSON.parse(input);assert.equal(images.length,3);
  assert.equal(data.fallbackNarrativeContext.primarySubject,row.subject);assert.equal(data.fallbackNarrativeContext.primaryTarget,row.primary);
  assert.equal(data.fallbackNarrativeContext.mode,'subject-illustration');assert.equal(data.visualTarget,row.target);
  assert.match(system,/Set suitable=true only when targetVisible=true and narrativeFit.status="supported"/);
  assert.match(system,/quantity or relationship attributed to a specific subject must stay attached to that subject/);
  assert.match(system,/another performer or place can demonstrate it when the change does not alter the claim/);
  assert.doesNotMatch(system,/provide context only/);assert.match(system,/Editor-only notes are not visible disclosure/);
  return JSON.stringify({...baseAnswer,narrativeFit:proof(project,scene,row.status,row.evidence)});
 }};
 const result=await new DocumentaryIntelligence(client,()=>directory).inspectForSelection(project,scene);
 assert.equal(result.review.status,row.status==='supported'?'accepted':row.status==='conflict'?'rejected':'uncertain');assert.equal(calls,1);
 assert.equal(result.review.narrativeFit!.status,row.status);assert.equal(Boolean(result.review.illustrationApproval),row.status==='supported');
});

test('both full03 reserve stages get original referents and send only the new grounded queries to discovery',async()=>{
 const fixtures=await Promise.all(cases.map(row=>fixture(row)));
 const {directory,project}=fixtures[0]!;
 project.scenes=fixtures.map(({scene},index)=>({...scene,id:`scene-${cases[index]!.scene}`,order:index}));
 project.videoBrief!.readyScript='Cutty Sark and Thermopylae were rival tea clippers.\n'+cases.map(row=>row.narration).join('\n');
 const originalInput=hash({version:1,model:'fixture',context:documentaryAiPlanContext(project)});
 for(const scene of project.scenes){
   scene.documentary!.requirement.aiSearchPlan!.inputHash=hash({inputHash:originalInput,sceneId:scene.id});
   delete scene.documentary!.requirement.footageFallback;
 }
 const anchors=[['',[]],['historic tea clipper ships',['historical tea clipper ships','two sailing tea clippers']],
   ['hands sawing wooden timber',['hands sawing wood timber','cutting timber hand saw']],['Cutty Sark clipper',['Cutty Sark clipper','Cutty Sark ship']],
   ['Falmouth harbour',['Falmouth harbour boats','Falmouth port footage']]] as const;
 let calls=0;
 const planner=new DocumentaryAiQueryPlanner({documentaryQueryModel:async()=> 'fixture',documentaryCompletion:async(system:string,payload:string)=>{
  calls++;const input=JSON.parse(payload);
  assert.equal(input.visualPolicy.mode,'subject-illustration');assert.equal(input.originalScript,project.videoBrief!.readyScript);
  assert.match(system,/every reserve target AND each query/);assert.match(system,/retain the central physical referent, necessary named location and meaningful object class/);
  assert.match(system,/Use a common related action when the action is itself the point/);
  assert.match(system,/If the core relation cannot survive available real footage, return an empty reserve/);
  assert.doesNotMatch(system,/No (?:person|named person).*\bplace\b/);
  assert.ok(input.requestedScenes.length<=4,'Reserve planning keeps the same bounded batch size as primary planning');
  return JSON.stringify({scenes:input.requestedScenes.map((request:{sceneId:string;narration:string;originalSearchPlan:any})=>{
   const index=cases.findIndex(row=>request.sceneId===`scene-${row.scene}`),row=cases[index]!;
   assert.ok(row);const [fallbackVisualTarget,fallbackVideoQueries]=anchors[index]!;
   assert.equal(request.sceneId,`scene-${row.scene}`);assert.equal(request.narration,row.narration);
   assert.equal(request.originalSearchPlan.subject,row.subject);assert.equal(request.originalSearchPlan.visualTarget,row.primary);
   assert.equal(request.originalSearchPlan.fallbackVisualTarget,row.target);
   return {sceneId:request.sceneId,fallbackVisualTarget,fallbackVideoQueries};
  })});
 }} as unknown as AnyModelClient,()=>directory);
 for(const plans of [await planner.planFallbacks(project,project.scenes),await planner.planTopicFallbacks(project,project.scenes)]){
   for(const [index,scene] of project.scenes.entries()){
     const requirement=plans.get(scene.id)!;assert.equal(requirement.aiSearchPlan!.visualTarget,cases[index]!.primary);
     const claimed=claimDocumentaryThematicRecovery(project,{...scene,documentary:{...scene.documentary!,requirement}});
     const discovery=documentaryThematicDiscoveryRequirement(project,claimed),[target,queries]=anchors[index]!;
     if(!target){assert.equal(discovery,undefined);continue;}
     assert.equal(discovery?.detail,target);assert.deepEqual(discovery?.queries,queries);
     assert.ok(!discovery!.queries.includes(cases[index]!.target));
   }
 }
 assert.equal(calls,4,'two bounded batches per reserve stage; no primary submission');
});

test('explicit thematic mode is passed faithfully; action illustrations and grounded generic footage are not blanket-rejected',async()=>{
 const {project,scene}=await fixture(cases[1],'thematic');const value={narrativeFit:proof(project,scene,'supported','Explicit thematic mode permits this modern regatta as a general illustration of two crews competing, without claiming to show either original clipper.')};
 assert.equal(documentaryFallbackNarrativeContext(project,scene)!.mode,'thematic');assert.equal(documentaryFallbackNarrativeIssue(project,scene,value),undefined);
});

test('saved narrative proof is bound to mode, original subject and scene/script; manual approvals remain controlled by the user',async()=>{
 const {project,scene}=await fixture(cases[2]),value={narrativeFit:proof(project,scene)};
 assert.equal(documentaryFallbackNarrativeIssue(project,scene,value),undefined);
 for(const change of [(p:Project)=>{p.settings.assembly.documentary!.matchMode='literal';},
  (p:Project)=>{p.scenes[0]!.documentary!.requirement.aiSearchPlan!.subject='another ship';},
  (p:Project)=>{p.videoBrief!.readyScript+='Another original fact.';}]){
  const edited=structuredClone(project);change(edited);assert.equal(documentaryFallbackNarrativeFit(edited,edited.scenes[0]!,value),undefined);
 }
 const drifted=structuredClone(project);drifted.scenes[0]!.documentary!.selected!.title+=' (updated discovery title)';
 assert.equal(documentaryFallbackNarrativeIssue(drifted,drifted.scenes[0]!,value),undefined,'A mutable discovery title is not a new paid visual task');
 const malformed={narrativeFit:{...proof(project,scene),scriptQuote:'invented quotation'}};assert.equal(documentaryFallbackNarrativeFit(project,scene,malformed),undefined);
 scene.documentary!.verified=true;scene.documentary!.visualReview={status:'accepted',confidence:1,reason:'Old approval',quality:'',sampleSeconds:[0],checkedAt:'old'};
 assert.match(documentarySavedContextIssue(project,scene)!,/смысла исходной сцены/);
 scene.documentary!.pinned=true;assert.equal(documentarySavedContextIssue(project,scene),undefined);
});

test('default automatic full template preserves reviewed thematic footage without accepting changed evidence',async()=>{
 const {directory,project,scene}=await fixture(cases[2]);
 project.settings.assembly.documentary!.montage={version:1,style:'editorial',intensity:'rich',graphicsDensity:'sparse'};
 project.settings.video.enabled=true;
 const client={configured:async()=>true,documentaryCompletion:async()=>JSON.stringify({...baseAnswer,narrativeFit:proof(project,scene)})};
 scene.documentary!.visualReview=(await new DocumentaryIntelligence(client,()=>directory).inspectForSelection(project,scene)).review;
 scene.documentary!.verified=true;
 scene.audioPath='existing.mp3';
 assert.equal(scene.documentary!.template,undefined);
 assert.equal(documentarySavedContextIssue(project,scene),undefined);
 const mounted={...project,scenes:planDocumentaryMontage(project)};
 const planned=mounted.scenes[0]!;
 assert.equal(planned.documentary!.template,'full');
 assert.equal(planned.documentary!.templateOrigin,'automatic');
 assert.deepEqual(planned.documentary!.requirement,scene.documentary!.requirement);
 assert.deepEqual(planned.documentary!.visualReview,scene.documentary!.visualReview);
 assert.equal(documentaryThematicDiscoveryRequirement(mounted,planned),undefined,'Discovery still requires an exact current binding');
 assert.equal(documentarySavedContextIssue(mounted,planned),undefined);
 assert.deepEqual(missingAssemblyInputs(mounted),[]);
 const currentFit=scene.documentary!.visualReview!.narrativeFit!;
 const oldTask=documentaryFallbackNarrativeTask(project,scene,2)!;
 for(const narrativeFit of [{...currentFit,binding:oldTask.binding},undefined]){
  const changed=structuredClone(mounted),item=changed.scenes[0]!,review=item.documentary!.visualReview!;
  review.narrativeFit=narrativeFit;
  // Preserve the matching frame fingerprint a previous build could have stored.
  review.illustrationApproval=documentaryIllustrationApproval(changed,item);
  assert.ok(review.illustrationApproval);
  assert.match(documentarySavedContextIssue(changed,item)!,/Не подтверждено сохранение смысла/);
  assert.ok(missingAssemblyInputs(changed).length);
 }
 const edits:Array<(item:Scene)=>void>=[
  item=>{item.narration+=' An unrelated event.';},
  item=>{item.documentary!.requirement.footageFallback!.target='metal being cut';},
  item=>{item.documentary!.requirement.aiSearchPlan!.visualTarget='a different subject';},
  item=>{item.documentary!.selected!.id='another-source';},
  item=>{item.documentary!.checksum='different-bytes';},
  item=>{item.trimStartSeconds=.3;},
  item=>{item.trimEndSeconds=3.2;},
  item=>{item.documentary!.templateOrigin='manual';},
  item=>{item.documentary!.template='contain';},
 ];
 for(const edit of edits){
  const changed=structuredClone(mounted),item=changed.scenes[0]!;
  edit(item);
  assert.ok(documentarySavedContextIssue(changed,item));
  assert.ok(missingAssemblyInputs(changed).length);
 }
});

for(const uncertain of [false,true])test(`old complete stays intact; explicit new semantic binding submits once and ${uncertain?'holds unknown':'reuses complete'} across restart`,async()=>{
 const {directory,project,scene}=await fixture(cases[2]);let calls=0;
 const client={configured:async()=>true,documentaryCompletion:async(_system:string,input:string,_images:string[],_signal?:AbortSignal,onPartial?:(raw:string)=>void)=>{
  calls++;const data=JSON.parse(input);
  if(!data.fallbackNarrativeContext)return JSON.stringify(baseAnswer);
  if(uncertain){onPartial?.('{"narrativeFit":');throw new AnyModelCompletionUncertainError('Fixture new criterion unknown','{"narrativeFit":');}
  return JSON.stringify({...baseAnswer,narrativeFit:proof(project,scene)});
 }};
 const old=new DocumentaryIntelligence(client,()=>directory),complete=Reflect.get(old,'complete').bind(old);
 Reflect.set(old,'complete',(...args:unknown[])=>{const input=JSON.parse(args[3] as string);delete input.fallbackNarrativeContext;
  return complete(args[0],args[1],args[2],JSON.stringify(input),args[4],[]);});
 await old.inspectForSelection(project,scene);assert.equal(calls,1);
 const dir=join(directory,'Documentary','Analysis'),oldFiles=(await readdir(dir)).filter(f=>/^[a-f0-9]{64}\.json$/.test(f));assert.equal(oldFiles.length,1);
 const oldFile=join(dir,oldFiles[0]!),oldBytes=await readFile(oldFile,'utf8');
 scene.documentary!.verified=true;scene.documentary!.visualReview={status:'accepted',confidence:1,reason:'Historical stored approval',quality:'',sampleSeconds:[0],checkedAt:'old'};
 assert.ok(documentarySavedContextIssue(project,scene));assert.equal(calls,1,'Passive readiness never calls the API');
 const passive=await new DocumentaryIntelligence(client,()=>directory).inspectForSelection(project,scene,undefined,undefined,true)
  .catch(error=>{assert.ok(error instanceof DocumentaryCachedAnalysisMissing);return undefined;});
 assert.notEqual(passive?.review.status,'accepted');
 assert.equal(calls,1,'Cache-only read cannot dispatch the new criterion');assert.equal(await readFile(oldFile,'utf8'),oldBytes);
 if(uncertain){await assert.rejects(new DocumentaryIntelligence(client,()=>directory).inspectForSelection(project,scene));
  scene.documentary!.selected!.title+=' (later discovery title)';
  await assert.rejects(new DocumentaryIntelligence(client,()=>directory).inspectForSelection(project,scene));}
 else{for(let i=0;i<2;i++)assert.equal((await new DocumentaryIntelligence(client,()=>directory).inspectForSelection(project,scene)).review.status,'accepted');}
 assert.equal(calls,2,'Exactly one new semantic request; restarts cannot replay it');assert.equal(await readFile(oldFile,'utf8'),oldBytes);
 assert.equal((await readdir(dir)).filter(f=>/^[a-f0-9]{64}\.json$/.test(f)).length,2,'Old and new receipts coexist');
});

for(const priorRevision of [1,2] as const)for(const interrupted of [false,true])test(`revision 3 cannot reuse a revision ${priorRevision} false approval or bypass its ${interrupted?'unknown':'completed'} receipt`,async()=>{
 const {directory,project,scene}=await fixture(cases[1]);
 const priorTask=documentaryFallbackNarrativeTask(project,scene,priorRevision)!;
 const priorProof={...proof(project,scene),binding:priorTask.binding};
 let calls=0;
 const client={configured:async()=>true,documentaryCompletion:async(_system:string,input:string,_images:string[],_signal?:AbortSignal,onPartial?:(raw:string)=>void)=>{
  calls++;const data=JSON.parse(input);
  if(data.fallbackNarrativeContext.version===priorRevision){
   if(interrupted){const raw='{"description":"partial';onPartial?.(raw);throw new AnyModelCompletionUncertainError('old response interrupted',raw);}
   return JSON.stringify({...baseAnswer,narrativeFit:priorProof});
  }
  assert.equal(data.fallbackNarrativeContext.version,3);
  return JSON.stringify({...baseAnswer,suitable:false,narrativeFit:proof(project,scene,'conflict','The modern sports boats visibly replace the historical tea clipper class.')});
 }};
 const old=new DocumentaryIntelligence(client,()=>directory),complete=Reflect.get(old,'complete').bind(old);
 Reflect.set(old,'complete',(...args:unknown[])=>{const input=JSON.parse(args[3] as string);input.fallbackNarrativeContext=priorTask;
  return complete(args[0],args[1],args[2],JSON.stringify(input),args[4],[]);});
 if(interrupted)await assert.rejects(old.inspectForSelection(project,scene));else await old.inspectForSelection(project,scene);
 const dir=join(directory,'Documentary','Analysis'),[name]=await readdir(dir),bytes=await readFile(join(dir,name!),'utf8');
 const inspect=(cacheOnly=false)=>new DocumentaryIntelligence(client,()=>directory).inspectForSelection(project,scene,undefined,undefined,cacheOnly);
 if(interrupted)await assert.rejects(inspect(true));else assert.notEqual((await inspect(true)).review.status,'accepted');assert.equal(calls,1);
 if(interrupted)await assert.rejects(inspect());else{
  assert.notEqual((await inspect()).review.status,'accepted');
  assert.notEqual((await inspect()).review.status,'accepted');
 }
 assert.equal(calls,1,'Changing rule wording never buys a second vote; missing current proof remains unapproved');assert.equal(await readFile(join(dir,name!),'utf8'),bytes);
});
