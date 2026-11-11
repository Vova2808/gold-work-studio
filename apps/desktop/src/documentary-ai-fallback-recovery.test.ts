import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {createVoiceCalibration,documentaryVideoCoverage,type Project,type Scene,type DocumentaryCandidate} from '@gold-work/shared';
import {prepareDocumentaryScript} from './documentary-plan.js';
import {documentaryAiPlanContext} from './documentary-ai-plan-state.js';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {DocumentarySearch} from './documentary-search.js';
import {planFastDocumentaryScene} from './documentary-fast-plan.js';
import {documentaryIllustrationApproval,documentarySavedContextIssue,revalidateDocumentaryContext} from './documentary-context-approval.js';
import {DocumentaryAnalysisError} from './documentary-analysis-error.js';
import {documentaryNativeFallbackReady} from './documentary-native-fallback.js';
import {documentaryCheckedVideoCoverage} from './documentary-automatic-native-recovery.js';
import {documentaryAutomaticMaterialReady} from './documentary-auto-readiness.js';
import {assertDocumentaryAutoExport} from './documentary-workflow.js';
import {claimDocumentaryThematicRecovery,documentaryAutomaticThematicIssue,documentaryThematicDiscoveryRequirement,documentaryThematicRecoveryBinding} from './documentary-automatic-thematic-recovery.js';
import {documentaryFallbackNarrativeContext,documentaryFallbackNarrativeTask} from './documentary-fallback-narrative.js';
import {DocumentaryCachedAnalysisMissing} from './documentary-intelligence.js';
import {effectFfmpeg} from './effect-media.js';

const primary='Portrait of Captain Smith',reserve='sailing ship under restoration';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function fixture(t:test.TestContext){
 const root=await mkdtemp(join(tmpdir(),'gws-ai-reserve-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
 let project=await projects.create({title:'Ship preservation',topic:'Historic ships',mediaMode:'stock',mode:'standard',language:'English',aspectRatio:'16:9'});
 project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:'He and his wife helped secure her survival and restoration.'};
 project.settings.voice.enabled=false;project.settings.stockVideoPercent=60;
 project.settings.assembly.documentary!.autoMotionGraphics=false;project.settings.assembly.documentary!.autoEffects=false;
 project.scenes=prepareDocumentaryScript(project,createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:project.videoBrief.readyScript!,audioDurationSeconds:4})).slice(0,1);
 const scene=project.scenes[0]!;scene.audioPath='saved-voice.mp3';scene.durationSeconds=4;
 scene.documentary!.selectionPlan={kind:'video',videoPercent:60};
 scene.documentary!.requirement={text:scene.narration,entities:['Captain Smith'],identities:[{name:'Captain Smith',aliases:[]}],years:[],queries:['Captain Smith portrait'],preferredKind:'video',
  aiSearchPlan:{version:1,inputHash:hash({inputHash:hash({version:1,model:'fixture',context:documentaryAiPlanContext(project)}),sceneId:scene.id}),model:'fixture',
   subject:'Captain Smith',visualTarget:primary,years:[],visualScope:'exact',preferredKind:'video',imageQueries:['Captain Smith portrait'],videoQueries:['Captain Smith documentary'],
   fallbackVideoQueries:['sailing ship restoration'],fallbackVisualTarget:reserve}};
 project=await projects.mutate(project.id,()=>project);
 const file=join(root,'fixture.mp4');await writeFile(file,'Mock prepared original. These tests exercise orchestration, not pixel quality.');
 const source=(id:string):DocumentaryCandidate=>({id,provider:'commons',kind:'video',title:'Sailing ship under restoration',description:'A sailing ship hull being repaired',
  pageUrl:'https://example.test/'+id,downloadUrl:'https://example.test/'+id+'.mp4',localPath:file,author:'fixture',license:'fixture',licenseUrl:'',rights:'licensed',attribution:'fixture',
  width:1280,height:720,durationSeconds:20,query:'sailing ship restoration',retrievedAt:'now',match:'unverified',concerns:[]});
 const searches:Array<{query:string;target:string}>=[],prepared:string[]=[],reviews:Array<{id:string;target:string;cacheOnly:boolean}>=[];
 let provide:(p:Project)=>Promise<DocumentaryCandidate[]>=async()=>[];
 const approved=async(p:Project,s:Scene)=>{
  const info=await stat(s.videoPath!,{bigint:true}),target=planFastDocumentaryScene(p,s).visualTarget;
  const review:NonNullable<Scene['documentary']>['visualReview']={status:'accepted',confidence:1,reason:'Mock actual-file approval; orchestration only',quality:'',sampleSeconds:[0,1,2],checkedAt:'now',
   footageOrigin:'camera',viewDescription:'Sailing ship hull undergoing restoration',fastRelevance:{version:1,target,relevant:true,evidence:'Mock pixels show the requested target'},
   illustrationQualityVersion:1,targetVisibility:{version:1,target,visible:true,evidence:'Mock target visible'},sourceText:{version:1,kind:'none',text:''},
   localReview:{version:1,size:String(info.size),mtimeNs:String(info.mtimeNs),ctimeNs:String(info.ctimeNs)}};
  const narrative=documentaryFallbackNarrativeContext(p,s);
  if(narrative)review.narrativeFit={version:1,binding:narrative.binding,status:'supported',scriptQuote:s.narration.trim(),
    evidence:'Mock visible hull restoration illustrates the unchanged story about preserving and restoring the vessel.'};
  review.illustrationApproval=documentaryIllustrationApproval(p,{...s,documentary:{...s.documentary!,visualReview:review}});return review;
 };
 let inspect:(p:Project,s:Scene,cacheOnly:boolean)=>Promise<NonNullable<Scene['documentary']>['visualReview']>=async(p,s)=>approved(p,s);
 const search=new DocumentarySearch();search.search=async input=>{
  const current=(await projects.get(project.id))!;searches.push({query:input.query,target:planFastDocumentaryScene(current,current.scenes[0]!).visualTarget});
  return {candidates:await provide(current),sources:[]};
 };
 let plannerCalls=0;
 const service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,'projects')),search,join(root,'Materials'),
  {download:async()=>assert.fail('No live downloads')},()=>{},
  {simpleSelection:true,available:async()=>true,plan:async()=>new Map(),inspect:async()=>assert.fail('Use recipient inspection'),
   inspectForSelection:async(p,s,_progress,_stop,cacheOnly)=>{reviews.push({id:s.documentary!.selected!.id,target:planFastDocumentaryScene(p,s).visualTarget,cacheOnly:Boolean(cacheOnly)});
    return {review:(await inspect(p,s,Boolean(cacheOnly)))!,usedNewAnalysis:!cacheOnly};}},undefined,undefined,
  {plan:async()=>{plannerCalls++;return new Map();},planFallbacks:async()=>{plannerCalls++;return new Map();}});
 Reflect.set(service,'selectionResources',async()=>({workers:1}));service.localCandidates=async()=>[];
 Reflect.set(service,'apply',async(_id:string,sceneId:string,candidate:DocumentaryCandidate)=>{
  prepared.push(candidate.id);const current=(await projects.get(project.id))!;
  return {...current,scenes:current.scenes.map(s=>s.id===sceneId?{...s,videoPath:file,imagePath:undefined,documentary:{...s.documentary!,selected:{...candidate,localPath:file},checksum:hash(candidate.downloadUrl),verified:false}}:s)};
 });
 return {root,projects,project,scene:project.scenes[0]!,file,source,service,searches,prepared,reviews,approved,
  provide:(value:typeof provide)=>{provide=value;},inspect:(value:typeof inspect)=>{inspect=value;},plannerCalls:()=>plannerCalls};
}

test('the ordinary selector searches YouTube for a claimed reserve and keeps its target binding intact',async t=>{
 const f=await fixture(t);
 await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=s=1280x720:r=5','-t','6','-c:v','libx264','-preset','ultrafast',f.file]);
 await f.projects.mutate(f.project.id,p=>({scenes:p.scenes.map(s=>claimDocumentaryThematicRecovery(p,s))}));
 f.provide(async()=>[f.source('reserve')]);
 const searcher=Reflect.get(f.service,'searcher') as DocumentarySearch;
 const search=searcher.search.bind(searcher);
 searcher.search=async(...args)=>args[0].providers?.includes('youtube')?search(...args):{candidates:[],sources:[]};
 const result=await f.service.autoSelect(f.project.id,{},async()=>{});
 assert.ok(f.searches.some(s=>s.query==='sailing ship restoration'));
 assert.ok(f.reviews.length>0,JSON.stringify(result.failures));
 assert.ok(f.reviews.every(review=>review.target===reserve));
 assert.equal(result.failed,0,JSON.stringify(result.failures));
 assert.equal(result.project.scenes[0]!.audioPath,'saved-voice.mp3');
 assert.ok(documentaryThematicDiscoveryRequirement(result.project,result.project.scenes[0]!));
});

test('mandatory source identity prevents claiming a wrong-object reserve and resuming a previously claimed one',async t=>{
 const f=await fixture(t),project=structuredClone(f.project),scene=project.scenes[0]!;
 scene.narration='Captain Smith became commander.';
 scene.documentary!.requirement.text=scene.narration;
 project.videoBrief!.readyScript=scene.narration;
 const plan=scene.documentary!.requirement.aiSearchPlan!;
 plan.inputHash=hash({inputHash:hash({version:1,model:'fixture',context:documentaryAiPlanContext(project)}),sceneId:scene.id});
 const oldClaim=claimDocumentaryThematicRecovery(project,scene);
 assert.ok(oldClaim.documentary!.requirement.footageFallback,'Old contextual plan could claim the reserve');
 plan.grounding={version:1,mandatory:[{kind:'identity',required:'Captain Smith',scriptQuote:scene.narration}],illustrations:['same captain portrait'],optionalDetails:[]};
 assert.match(documentaryAutomaticThematicIssue(project,scene)!,/обязательную идентичность/);
 assert.equal(claimDocumentaryThematicRecovery(project,scene),scene);
 oldClaim.documentary!.requirement.aiSearchPlan=plan;
 oldClaim.documentary!.requirement.footageFallback!.automaticRecovery!.binding=documentaryThematicRecoveryBinding(project,oldClaim);
 assert.equal(documentaryThematicDiscoveryRequirement(project,oldClaim),undefined);
 assert.deepEqual(f.searches,[]);assert.deepEqual(f.reviews,[]);
 assert.equal(scene.audioPath,'saved-voice.mp3');
});

test('production with narration waits does not plan reserves while primary queries are missing',async t=>{
 const f=await fixture(t);
 await f.projects.mutate(f.project.id,p=>({scenes:p.scenes.map(s=>{
  const scene=claimDocumentaryThematicRecovery(p,s);
  assert.ok(scene.documentary!.requirement.footageFallback?.automaticRecovery);
  delete scene.documentary!.requirement.aiSearchPlan;
  return scene;
 })}));
 await assert.rejects(f.service.autoSelect(f.project.id,{},async()=>{}),/Сначала подготовьте поисковой план/);
 assert.equal(f.plannerCalls(),0);
 assert.deepEqual(f.searches,[]);
});

test('automatic completion exhausts primary then reviews saved AI reserve under its own target, preserving primary/narration/audio',async t=>{
 const f=await fixture(t),before=structuredClone(f.scene);
 f.provide(async p=>p.scenes[0]!.documentary!.requirement.footageFallback?[f.source('reserve')]:[]);
 const result=await f.service.completeWithNativeFallback(f.project.id,undefined,undefined,true),scene=result.scenes[0]!;
 assert.ok(f.searches.some(row=>row.target===primary));assert.equal(f.searches.at(-1)?.target,reserve);
 assert.deepEqual(f.reviews,[{id:'reserve',target:reserve,cacheOnly:false}]);
 assert.equal(scene.documentary!.verified,true,scene.documentary!.autoError);assert.equal(documentarySavedContextIssue(result,scene),undefined);
 assert.equal(scene.audioPath,before.audioPath);assert.equal(scene.narration,before.narration);
 const {footageFallback,...persisted}=scene.documentary!.requirement;
 assert.deepEqual(persisted,before.documentary!.requirement);assert.equal(footageFallback!.originalTarget,primary);
 assert.match(scene.documentary!.reviewNote,/не архив/);assert.equal(scene.documentary!.illustrative,true);
 assert.equal(result.settings.stockVideoPercent,60);assert.equal(f.plannerCalls(),0,'Authored reserve needs no paid repair');
});

test('empty reserve performs one pass per invocation; a later explicit run can discover a new source',async t=>{
 const f=await fixture(t);let result=await f.service.completeWithNativeFallback(f.project.id,undefined,undefined,true);
 assert.equal(result.scenes[0]!.documentary!.verified,false);assert.ok(result.scenes[0]!.documentary!.requirement.footageFallback);
 const n=f.searches.length;
 f.provide(async()=>[f.source('later')]);result=await f.service.completeWithNativeFallback(f.project.id,undefined,undefined,true);
 assert.equal(result.scenes[0]!.documentary!.verified,true);assert.equal(f.searches.length,n+1);
 assert.equal(f.searches.at(-1)?.target,reserve);assert.equal(f.plannerCalls(),0);
});

test('unknown primary and its local alias stay held; new target receives own review; receipt bytes unchanged',async t=>{
 const f=await fixture(t),old=f.source('unknown'),checksum=hash(old.downloadUrl),receipt=join(f.root,'unknown-receipt.json');
 await writeFile(receipt,'{"state":"unknown","requestId":"keep"}');
 await f.projects.mutate(f.project.id,p=>({scenes:p.scenes.map(s=>({...s,videoPath:f.file,documentary:{...s.documentary!,selected:old,checksum,
  manualReview:{version:1,status:'pending',provider:old.provider,kind:'video',candidateId:old.id,checksum,mediaPath:f.file,narration:s.narration,reason:'Unknown primary request',
   analysis:{status:'unknown',reason:'No response yet'}}}}))}));
 const alias={...old,id:'local:'+checksum,provider:'local' as const};
 f.inspect(async(p,s,cacheOnly)=>{if(cacheOnly)throw new DocumentaryAnalysisError('Receipt still pending','pending');return f.approved(p,s);});
 f.provide(async p=>p.scenes[0]!.documentary!.requirement.footageFallback?[alias,f.source('fresh')]:[]);
 const result=await f.service.completeWithNativeFallback(f.project.id,undefined,undefined,true);
 assert.deepEqual(f.prepared,['fresh']);assert.equal(result.scenes[0]!.documentary!.verified,true);
 assert.equal(f.reviews.filter(row=>!row.cacheOnly).length,1);assert.equal(f.reviews.at(-1)!.target,reserve);
 assert.equal(await readFile(receipt,'utf8'),'{"state":"unknown","requestId":"keep"}');
 assert.ok(result.scenes[0]!.documentary!.requirement.footageFallback!.automaticRecovery!.blockedSourceKeys.length>=2);
});

test('three preparations share reserve deadline; saved keys prevent alias replay on resume without exhausting whole scene',async t=>{
 const f=await fixture(t);let elapsed=0;const now=Date.now;t.mock.method(Date,'now',()=>now()+elapsed);
 await f.projects.mutate(f.project.id,p=>({scenes:p.scenes.map(s=>claimDocumentaryThematicRecovery(p,s))}));
 const sources=[1,2,3,4].map(n=>f.source('source-'+n));f.provide(async()=>sources);
 f.inspect(async()=>{elapsed+=30_000;return {status:'uncertain',confidence:0,reason:'Uncertain pixels',quality:'',sampleSeconds:[],checkedAt:'now'};});
 let result=await f.service.completeWithNativeFallback(f.project.id,undefined,undefined,true);
 assert.deepEqual(f.prepared,['source-1','source-2','source-3']);assert.equal(result.scenes[0]!.documentary!.verified,false);
 f.inspect(async(p,s,cacheOnly)=>{if(cacheOnly)throw new DocumentaryAnalysisError('No different receipt','pending');return f.approved(p,s);});
 f.provide(async()=>[...sources.slice(0,3).map(s=>({...s,id:'local:'+hash(s.downloadUrl),provider:'local' as const})),sources[3]!]);
 result=await f.service.completeWithNativeFallback(f.project.id,undefined,undefined,true);
 assert.deepEqual(f.prepared,['source-1','source-2','source-3','source-4']);assert.equal(result.scenes[0]!.documentary!.verified,true);
});

for(const stage of ['primary','reserve'] as const)test('Stop during '+stage+' search keeps unused reserve available on resume',async t=>{
 const f=await fixture(t),abort=new AbortController();
 f.provide(async p=>{if((stage==='reserve')===Boolean(p.scenes[0]!.documentary!.requirement.footageFallback))abort.abort();return [];});
 await assert.rejects(f.service.completeWithNativeFallback(f.project.id,undefined,abort.signal,true),{name:'AbortError'});
 let scene=(await f.projects.get(f.project.id))!.scenes[0]!;
 assert.equal(Boolean(scene.documentary!.requirement.footageFallback),stage==='reserve');assert.equal(f.prepared.length,0);
 f.provide(async p=>p.scenes[0]!.documentary!.requirement.footageFallback?[f.source('after-stop')]:[]);
 scene=(await f.service.completeWithNativeFallback(f.project.id,undefined,undefined,true)).scenes[0]!;
 assert.equal(scene.documentary!.verified,true);assert.deepEqual(f.prepared,['after-stop']);
});

test('concurrent authored directive during reserve search prevents replacement',async t=>{
 const f=await fixture(t);
 f.provide(async p=>{if(!p.scenes[0]!.documentary!.requirement.footageFallback)return [];
  await f.projects.mutate(p.id,current=>({scenes:current.scenes.map(s=>({...s,imagePrompt:'[Visual: exact portrait of Captain Smith]'}))}));
  return [f.source('late')];});
 const result=await f.service.completeWithNativeFallback(f.project.id,undefined,undefined,true);
 assert.equal(f.prepared.length,0);assert.equal(f.reviews.length,0);assert.match(result.scenes[0]!.imagePrompt,/exact portrait/);
 assert.equal(result.scenes[0]!.documentary!.verified,false);
});

test('primary-only prevents ordinary/topic fallback planner calls while allowing a manual search',async t=>{
 const f=await fixture(t);
 await f.projects.mutate(f.project.id,p=>({scenes:p.scenes.map(s=>({...s,documentary:{...s.documentary!,
  requirement:{...s.documentary!.requirement,aiSearchPlan:{...s.documentary!.requirement.aiSearchPlan!,reservePolicy:'primary-only'}}}}))}));
 let automaticCalls=0;
 Reflect.set(f.service,'queryPlanner',{plan:async()=>new Map(),planFallbacks:async()=>{automaticCalls++;return new Map();},
  planTopicFallbacks:async()=>{automaticCalls++;return new Map();}});
 for(const topic of [false,true])assert.deepEqual(await Reflect.get(f.service,'prepareAiFootageFallbacks').call(f.service,f.project.id,[f.scene.id],topic),[]);
 assert.equal(automaticCalls,0);
 await f.service.search(f.project.id,f.scene.id,{query:'my custom sailing ship search',providers:['commons'],kind:'video'});
 assert.equal(f.searches.length,1);assert.equal(f.searches[0]!.query,'my custom sailing ship search');
});

test('policy protects literal directives/composition/stale context; AI exact and generated prompt text alone are eligible',async t=>{
 const f=await fixture(t),p=f.project,s=f.scene;
 assert.equal(documentaryAutomaticThematicIssue(p,s),undefined);
 assert.equal(documentaryAutomaticThematicIssue(p,{...s,imagePrompt:'A dramatic cinematic ship restoration scene'}),undefined);
 for(const update of [(v:Project)=>{v.settings.assembly.documentary!.matchMode='literal';},
  (v:Project)=>{v.scenes[0]!.documentary!.pinned=true;},
  (v:Project)=>{v.scenes[0]!.documentary!.caption.enabled=true;},
  (v:Project)=>{v.scenes[0]!.imagePrompt='[Visual: the actual captain at the wheel]';},
  (v:Project)=>{v.scenes[0]!.documentary!.requirement.scriptRequirements={version:1,scriptText:s.narration,checks:[{id:'x',kind:'object',scriptQuote:'He',required:'Exact captain portrait'}],nonVisual:[]};},
  (v:Project)=>{v.scenes[0]!.narration+=' Edited.';}] ){
  const copy=structuredClone(p);update(copy);assert.ok(documentaryAutomaticThematicIssue(copy,copy.scenes[0]!));
 }
 const claimed=claimDocumentaryThematicRecovery(p,s),project={...p,scenes:[claimed]};
 assert.equal(planFastDocumentaryScene(project,claimed).visualTarget,reserve);
 assert.deepEqual(documentaryThematicDiscoveryRequirement(project,claimed)!.identities,[]);
 assert.deepEqual(claimed.documentary!.requirement.identities,s.documentary!.requirement.identities);
 assert.equal(claimed.documentary!.visualReview,undefined);assert.equal(claimed.documentary!.verified,false);
});

test('manual completion and failed-only provider do not activate automatic reserve',async t=>{
 const f=await fixture(t);
 let result=await f.service.completeWithNativeFallback(f.project.id);
 assert.equal(result.scenes[0]!.documentary!.requirement.footageFallback,undefined);
 const search=Reflect.get(f.service,'searcher') as DocumentarySearch;
 search.search=async()=>({candidates:[],sources:[{provider:'commons',query:'fixture',count:0,error:'Temporary outage'}]});
 result=await f.service.completeWithNativeFallback(f.project.id,undefined,undefined,true);
 assert.equal(result.scenes[0]!.documentary!.requirement.footageFallback,undefined);assert.equal(f.plannerCalls(),0);
});


test('explicit archival instructions are binding; ordinary narration and generated prompts are not directives',async t=>{
 const f=await fixture(t);
 for(const prompt of ['Show only archival footage','Do not use generic footage','Покажи только исторические кадры','не использовать тематические иллюстрации','Shot: actual captain portrait',
  'Only use archival footage.','Use archival footage only.','Используйте исключительно архивные кадры.','Используйте только архивное видео.']){
  const p=structuredClone(f.project);p.videoBrief!.prompt=prompt;
  assert.match(documentaryAutomaticThematicIssue(p,p.scenes[0]!)??'',/указания|запрет/,prompt);
  assert.equal(claimDocumentaryThematicRecovery(p,p.scenes[0]!),p.scenes[0],prompt+' must not activate a reserve');
 }
 for(const prompt of ['He showed the ship to his wife.','The story uses historical records.',
  'They only use archival footage in their museum.','He chose to use archival footage only.',
  'Они использовали исключительно архивные кадры.','Историки показывали только архивное видео.']){
  const p=structuredClone(f.project);p.videoBrief!.prompt=prompt;
  assert.equal(documentaryAutomaticThematicIssue(p,p.scenes[0]!),undefined,prompt);
 }
 const claimed=claimDocumentaryThematicRecovery(f.project,f.scene),p={...f.project,scenes:[claimed],videoBrief:{...f.project.videoBrief!,prompt:'Do not use generic footage'}};
 assert.equal(documentaryThematicDiscoveryRequirement(p,claimed),undefined,'Changed explicit brief invalidates an already-active target');
});

test('primary success prevents reserve activation and preserves unrelated ready scenes',async t=>{
 const f=await fixture(t);
 f.provide(async()=>[{...f.source('primary'),title:'Captain Smith portrait',description:'Captain Smith'}]);
 const result=await f.service.completeWithNativeFallback(f.project.id,undefined,undefined,true);
 assert.equal(result.scenes[0]!.documentary!.verified,true);assert.equal(result.scenes[0]!.documentary!.requirement.footageFallback,undefined);
 assert.ok(f.reviews.length===1&&f.reviews[0]!.target===primary);
});

test('new reserve recursion stays scoped; an already active peer receives only one pass',async t=>{
 const f=await fixture(t);
 await f.projects.mutate(f.project.id,current=>{
  const peer=structuredClone(current.scenes[0]!);peer.id='peer';peer.order=1;peer.narration='The second scene concerns a harbor.';
  peer.documentary!.requirement.text=peer.narration;
  peer.documentary!.requirement.aiSearchPlan!.fallbackVisualTarget='harbor docks';peer.documentary!.requirement.aiSearchPlan!.fallbackVideoQueries=['harbor reserve'];
  const p={...current,scenes:[current.scenes[0]!,peer]};
  for(const s of p.scenes)s.documentary!.requirement.aiSearchPlan!.inputHash=hash({inputHash:hash({version:1,model:'fixture',context:documentaryAiPlanContext(p)}),sceneId:s.id});
  p.scenes[1]=claimDocumentaryThematicRecovery(p,peer);return p;
 });
 const result=await f.service.completeWithNativeFallback(f.project.id,undefined,undefined,true);
 assert.equal(f.searches.filter(row=>row.query==='harbor reserve').length,1);
 assert.ok(result.scenes.every(s=>s.documentary!.requirement.footageFallback));assert.equal(f.reviews.length,0);
});

test('Stop after an actual reserve attempt preserves source quarantine and allows a different source on resume',async t=>{
 const f=await fixture(t),abort=new AbortController();
 await f.projects.mutate(f.project.id,p=>({scenes:p.scenes.map(s=>claimDocumentaryThematicRecovery(p,s))}));
 f.provide(async()=>[f.source('stopped-source')]);
 f.inspect(async()=>{abort.abort();throw new DocumentaryAnalysisError('Already submitted, response pending','pending');});
 await assert.rejects(f.service.completeWithNativeFallback(f.project.id,undefined,abort.signal,true),{name:'AbortError'});
 f.inspect(async(p,s,cacheOnly)=>{if(cacheOnly)throw new DocumentaryAnalysisError('Still pending','pending');return f.approved(p,s);});
 const old=f.source('stopped-source');f.provide(async()=>[{...old,id:'local:'+hash(old.downloadUrl),provider:'local'},f.source('new-after-stop')]);
 const result=await f.service.completeWithNativeFallback(f.project.id,undefined,undefined,true);
 assert.deepEqual(f.prepared,['stopped-source','new-after-stop']);assert.equal(result.scenes[0]!.documentary!.verified,true);
});

for(const edit of ['imagePrompt','narration'] as const)test('an authored '+edit+' edit during async reserve review cannot attach or promote the old verdict',async t=>{
 const f=await fixture(t),receipt=join(f.root,'paid-complete-receipt.json'),receiptBytes='{"state":"complete","target":"old reserve","result":"accepted"}';
 await f.projects.mutate(f.project.id,p=>({scenes:p.scenes.map(s=>claimDocumentaryThematicRecovery(p,s))}));
 f.provide(async()=>[f.source('reviewed-before-edit')]);
 f.inspect(async(p,s)=>{
  const review=await f.approved(p,s);await writeFile(receipt,receiptBytes);
  await f.projects.mutate(p.id,current=>({scenes:current.scenes.map(scene=>({...scene,
   ...(edit==='imagePrompt'?{imagePrompt:'[Visual: exact portrait of Captain Smith]'}:{narration:scene.narration+' Edited.'})}))}));
  return review;
 });
 const result=await f.service.completeWithNativeFallback(f.project.id,undefined,undefined,true),scene=result.scenes[0]!;
 assert.equal(scene.documentary!.verified,false);assert.equal(scene.documentary!.visualReview,undefined,'Old-target verdict must stay in its receipt, not attach to the edited scene');
 assert.equal(scene.documentary!.manualReview!.analysis!.status,'pending');
 assert.equal(scene.documentary!.selected!.id,'reviewed-before-edit');assert.equal(scene.videoPath,f.file);assert.equal(scene.audioPath,f.scene.audioPath);
 assert.equal(await readFile(receipt,'utf8'),receiptBytes);assert.equal(f.reviews.length,1);
});

test('authored edit between review attachment and atomic promotion cannot mark the reserve ready',async t=>{
 const f=await fixture(t),mutate=f.projects.mutate.bind(f.projects);let injected=false;
 await mutate(f.project.id,p=>({scenes:p.scenes.map(s=>claimDocumentaryThematicRecovery(p,s))}));
 f.provide(async()=>[f.source('promotion-race')]);
 t.mock.method(f.projects,'mutate',async(...args:Parameters<ProjectService['mutate']>)=>{
  const saved=(await f.projects.get(f.project.id))!,scene=saved.scenes[0]!;
  if(!injected&&!scene.documentary!.verified&&scene.documentary!.manualReview?.analysis?.status==='accepted'){
   injected=true;
   await mutate(f.project.id,current=>({scenes:current.scenes.map(s=>({...s,imagePrompt:'[Visual: exact portrait of Captain Smith]'}))}));
  }
  return mutate(...args);
 });
 const result=await f.service.completeWithNativeFallback(f.project.id,undefined,undefined,true),scene=result.scenes[0]!;
 assert.equal(injected,true);assert.equal(scene.documentary!.verified,false);assert.match(scene.imagePrompt,/exact portrait/);
 assert.equal(scene.documentary!.visualReview!.status,'accepted','Preserve the completed old-context answer');
 assert.equal(scene.documentary!.selected!.id,'promotion-race');assert.equal(f.reviews.length,1);
 assert.match(documentarySavedContextIssue(result,{...scene,documentary:{...scene.documentary!,verified:true}})??'',/Визуальное задание тематического резерва изменилось/);
});

test('late authored edit invalidates saved automatic reserve approval without changing the source or paid response',async t=>{
 const f=await fixture(t),receipt=join(f.root,'paid-response.json'),receiptBytes='{"state":"complete","result":"accepted","target":"sailing ship under restoration"}';
 f.provide(async p=>p.scenes[0]!.documentary!.requirement.footageFallback?[f.source('accepted-reserve')]:[]);
 const accepted=await f.service.completeWithNativeFallback(f.project.id,undefined,undefined,true),before=structuredClone(accepted.scenes[0]!);
 assert.equal(before.documentary!.verified,true);await writeFile(receipt,receiptBytes);
 const edited=await f.projects.mutate(f.project.id,current=>({scenes:current.scenes.map(s=>({...s,imagePrompt:'[Visual: exact portrait of Captain Smith]'}))}));
 assert.match(documentarySavedContextIssue(edited,edited.scenes[0]!)??'',/Визуальное задание тематического резерва изменилось/);
 const revalidated=revalidateDocumentaryContext(edited)[0]!;
 assert.equal(revalidated.documentary!.verified,false);assert.deepEqual(revalidated.documentary!.visualReview,before.documentary!.visualReview);
 const reviewsBefore=f.reviews.length;
 const result=await f.service.completeWithNativeFallback(f.project.id,undefined,undefined,true),scene=result.scenes[0]!;
 assert.equal(scene.documentary!.verified,false);assert.equal(scene.videoPath,before.videoPath);assert.equal(scene.audioPath,before.audioPath);
 assert.deepEqual(scene.documentary!.selected,before.documentary!.selected);assert.equal(scene.documentary!.checksum,before.documentary!.checksum);
 assert.deepEqual(scene.documentary!.visualReview,before.documentary!.visualReview);assert.equal(await readFile(receipt,'utf8'),receiptBytes);
 assert.equal(f.reviews.length,reviewsBefore,'Invalid authored scope must not dispatch another review');
});

for(const priorRevision of [0,1,2] as const)test(`explicit autoSelect checks a ${priorRevision?'v'+priorRevision+' semantic':'pre-semantic'} approval on its saved file; passive revalidation does not submit`,async t=>{
 const f=await fixture(t);
 await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=s=1280x720:r=5','-t','6','-c:v','libx264','-preset','ultrafast',f.file]);
 const checksum=createHash('sha256').update(await readFile(f.file)).digest('hex');
 const p=structuredClone(f.project),source=f.source('legacy-approved');
 const scene=claimDocumentaryThematicRecovery(p,p.scenes[0]!);
 scene.videoPath=f.file;scene.trimStartSeconds=0;scene.trimEndSeconds=4;
 scene.documentary!.selected=source;scene.documentary!.checksum=checksum;p.scenes=[scene];
 const approval=(await f.approved(p,scene))!;assert.ok(approval.illustrationApproval);
 if(priorRevision)approval.narrativeFit!.binding=documentaryFallbackNarrativeTask(p,scene,priorRevision)!.binding;
 else delete approval.narrativeFit;
 scene.documentary!.visualReview=approval;scene.documentary!.verified=true;
 await f.projects.mutate(p.id,()=>p);
 assert.equal(revalidateDocumentaryContext(p)[0]!.documentary!.verified,false);
 assert.equal(f.reviews.length,0);
 f.inspect(async(project,original,cacheOnly)=>{
   assert.equal(original.videoPath,f.file);assert.equal(original.documentary!.checksum,checksum);
   if(cacheOnly)throw new DocumentaryCachedAnalysisMissing('No new meaning receipt yet');
   return {...(await f.approved(project,original))!,trimStartSeconds:original.trimStartSeconds,trimEndSeconds:original.trimEndSeconds};
 });
 const result=await f.service.autoSelect(p.id,{sceneIds:[scene.id]});
 const checked=result.project.scenes[0]!;
 assert.equal(checked.documentary!.verified,true,JSON.stringify({reviews:f.reviews,searches:f.searches,error:checked.documentary!.autoError}));
 assert.equal(checked.documentary!.visualReview!.narrativeFit!.status,'supported');
 assert.equal(checked.videoPath,f.file);assert.equal(checked.audioPath,scene.audioPath);
 assert.deepEqual(f.reviews.map(review=>review.cacheOnly),[true,false]);
 assert.deepEqual(f.searches,[]);assert.deepEqual(f.prepared,[]);
 await f.service.autoSelect(p.id,{sceneIds:[scene.id]});
 assert.equal(f.reviews.length,2);
});

for(const outcome of ['pending','throws','unconfirmed','unchanged'] as const)test(`production handles ${outcome} reserve revision after rejecting the saved original`,async t=>{
 const f=await fixture(t);
 await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=s=1280x720:r=5','-t','6','-c:v','libx264','-preset','ultrafast',f.file]);
 const original=await readFile(f.file),checksum=createHash('sha256').update(original).digest('hex');
 const p=structuredClone(f.project),scene=claimDocumentaryThematicRecovery(p,p.scenes[0]!);
 scene.videoPath=f.file;scene.trimStartSeconds=0;scene.trimEndSeconds=4;
 scene.documentary!.selected=f.source('legacy-approved');scene.documentary!.checksum=checksum;p.scenes=[scene];
 const approval=(await f.approved(p,scene))!;
 approval.narrativeFit!.binding=documentaryFallbackNarrativeTask(p,scene,2)!.binding;
 scene.documentary!.visualReview=approval;scene.documentary!.verified=true;
 await f.projects.mutate(p.id,()=>p);
 f.inspect(async(project,selected,cacheOnly)=>{
   assert.equal(selected.videoPath,f.file);
   if(cacheOnly)throw new DocumentaryCachedAnalysisMissing('No current receipt');
   const review=(await f.approved(project,selected))!;
   return {...review,status:'rejected',reason:'Different named subject',
    narrativeFit:{...review.narrativeFit!,status:'conflict',evidence:'The visible vessel differs from the one identified in the narration.'}};
 });
 const pending='Запрос пересмотра уже отправлен, результат неизвестен.';
 const unavailable='Не удалось подтвердить актуальный AI-план резерва. Поиск по прежнему резерву приостановлен.';
 const planner=Reflect.get(f.service,'queryPlanner') as NonNullable<ConstructorParameters<typeof DocumentaryProjectService>[9]>;
 let revisions=0;
 planner.planFallbacks=async(_project,scenes,options)=>{
   revisions++;
   assert.deepEqual(scenes.map(s=>[s.id,s.documentary?.verified]),[[scene.id,false]]);
   assert.deepEqual(f.reviews.map(review=>review.cacheOnly),[true,false]);
   assert.deepEqual(f.searches,[]);
   assert.equal(options?.reviseLegacyReserve,true);
   if(outcome==='throws')throw new Error('Кеш AI-запросов повреждён или недоступен');
   if(outcome==='pending')options?.onReserveIssues?.([{sceneId:scene.id,sceneNumber:1,reason:pending}]);
   if(outcome==='unchanged')options?.onReserveUnchanged?.([scene.id]);
   return new Map();
 };
 const result=await f.service.autoSelect(p.id,{sceneIds:[scene.id]},async()=>{}),checked=result.project.scenes[0]!;
 assert.equal(revisions,1);
 assert.equal(result.failed,1);
 if(outcome==='unchanged')assert.ok(f.searches.some(item=>item.target===reserve));
 else{
   const message=outcome==='pending'?pending:unavailable;
   assert.deepEqual(result.failures,[{sceneId:scene.id,sceneNumber:1,category:'analysis',message}]);
   assert.equal(checked.documentary!.autoError,message);
   assert.deepEqual(f.searches,[]);
 }
 assert.equal(checked.documentary!.verified,false);
 assert.deepEqual(checked.documentary!.visualReview,approval);
 assert.equal(checked.videoPath,f.file);
 assert.deepEqual(await readFile(f.file),original);
});

async function nativeFixture(t:test.TestContext,seconds=8,reserveAllowed=false){
 const f=await fixture(t);
 const p=structuredClone(f.project),scene=p.scenes[0]!,donor=structuredClone(scene);
 p.settings.assembly.documentary!.autoMotionGraphics=true;p.settings.assembly.documentary!.excludedTemplates=[];
 if(!reserveAllowed){scene.documentary!.requirement.aiSearchPlan!.fallbackVisualTarget='';scene.documentary!.requirement.aiSearchPlan!.fallbackVideoQueries=[];}
 donor.id='approved-video';donor.order=1;donor.narration='The sailing ship survives.';donor.durationSeconds=seconds;
 donor.trimStartSeconds=0;donor.trimEndSeconds=seconds;donor.videoPath=f.file;
 donor.documentary!.requirement.text=donor.narration;donor.documentary!.verified=true;
 donor.documentary!.selected=f.source('approved-video');donor.documentary!.checksum=hash(donor.documentary!.selected.downloadUrl);
 p.scenes=[scene,donor];
 for(const s of p.scenes)s.documentary!.requirement.aiSearchPlan!.inputHash=hash({inputHash:hash({version:1,model:'fixture',context:documentaryAiPlanContext(p)}),sceneId:s.id});
 donor.documentary!.visualReview=await f.approved(p,donor);
 await f.projects.mutate(p.id,()=>p);
 f.inspect(async()=>({status:'uncertain',confidence:0,reason:'Mock donor pixels do not establish this recipient target',quality:'',sampleSeconds:[],checkedAt:'now'}));
 return f;
}

for(const reserveAllowed of [false,true])test('native card after exhausted '+(reserveAllowed?'thematic':'primary with no AI reserve')+' pass respects checked video quota and has independent readiness',async t=>{
 const f=await nativeFixture(t,8,reserveAllowed),before=(await f.projects.get(f.project.id))!,voice=before.scenes[0]!.audioPath;
 assert.equal(documentaryCheckedVideoCoverage(before).percent,66);
 const result=await f.service.completeWithNativeFallback(f.project.id,undefined,undefined,true),scene=result.scenes[0]!;
 assert.equal(scene.narration,before.scenes[0]!.narration);assert.equal(scene.audioPath,voice);
 assert.equal(scene.documentary!.verified,true);assert.equal(scene.documentary!.selected,undefined);assert.equal(scene.documentary!.visualReview,undefined);
 assert.equal(scene.documentary!.motionGraphic!.kind,'quote');assert.equal(scene.documentary!.motionGraphic!.quoteMode,'speech');
 assert.equal(documentaryNativeFallbackReady(result,scene),true);assert.equal(documentarySavedContextIssue(result,scene),undefined);
 assert.equal(revalidateDocumentaryContext(result)[0]!.documentary!.verified,true);
 assert.ok(result.scenes.every(documentaryAutomaticMaterialReady));assert.doesNotThrow(()=>assertDocumentaryAutoExport(result));
 assert.equal(documentaryCheckedVideoCoverage(result).videoSeconds,8);assert.equal(documentaryVideoCoverage(result.scenes).percent,66);
 assert.equal(result.settings.stockVideoPercent,60);assert.equal(f.reviews.length,reserveAllowed?1:0);assert.equal(f.plannerCalls(),0);
 if(reserveAllowed){
  assert.ok(scene.documentary!.requirement.footageFallback!.automaticRecovery,'Retain the original thematic audit/used-source marker');
  assert.ok(scene.documentary!.nativeFallback!.automaticRecovery,'Native transition has its own binding');
  assert.equal(documentaryThematicDiscoveryRequirement(result,scene),undefined,'Old footage composition is no longer active');
  assert.equal(f.searches.filter(row=>row.target===reserve).length,1);
 }
 for(const kind of ['directive','literal'] as const){
  const edited=structuredClone(result);
  if(kind==='directive')edited.scenes[0]!.imagePrompt='[Visual: exact portrait of Captain Smith]';
  else edited.settings.assembly.documentary!.matchMode='literal';
  assert.equal(documentaryNativeFallbackReady(edited,edited.scenes[0]!),false);
  assert.match(documentarySavedContextIssue(edited,edited.scenes[0]!)??'',/Визуальное задание/);
  assert.equal(revalidateDocumentaryContext(edited)[0]!.documentary!.verified,false);
 }
 const searches=f.searches.length;
 await f.projects.mutate(result.id,current=>({scenes:current.scenes.map(s=>s.id===scene.id?{...s,imagePrompt:'[Visual: exact portrait of Captain Smith]'}:s)}));
 const held=await f.service.completeWithNativeFallback(result.id,undefined,undefined,true);
 assert.equal(held.scenes[0]!.documentary!.verified,false);assert.equal(f.searches.length,searches,'Late authored edit cannot be silently rebound');
});

test('native card retains hidden unknown source and paid receipt without approving its pixels',async t=>{
 const f=await nativeFixture(t),source=f.source('held-source'),checksum=hash(source.downloadUrl),receipt=join(f.root,'native-unknown.json'),bytes='{"state":"unknown","requestId":"preserve"}';
 await writeFile(receipt,bytes);
 await f.projects.mutate(f.project.id,current=>({scenes:current.scenes.map((s,index)=>index? s:{...s,videoPath:f.file,documentary:{...s.documentary!,selected:source,checksum,
  manualReview:{version:1,status:'pending',kind:'video',provider:source.provider,candidateId:source.id,checksum,mediaPath:f.file,narration:s.narration,reason:'Unknown prior review',analysis:{status:'unknown',reason:'No response'}}}})}));
 f.inspect(async()=>{throw new DocumentaryAnalysisError('Unknown prior review','pending');});
 const result=await f.service.completeWithNativeFallback(f.project.id,undefined,undefined,true),scene=result.scenes[0]!,previous=scene.documentary!.nativeFallback!.previousMaterial!;
 assert.equal(documentaryNativeFallbackReady(result,scene),true);assert.equal(scene.videoPath,undefined);assert.equal(scene.documentary!.visualReview,undefined);
 assert.deepEqual(previous.selected,source);assert.equal(previous.videoPath,f.file);assert.equal(previous.checksum,checksum);
 assert.equal(scene.documentary!.manualReview!.analysis!.status,'unknown');assert.equal(await readFile(receipt,'utf8'),bytes);
 assert.ok(f.reviews.every(row=>row.cacheOnly),'Native path must not buy an approval for held pixels');
});

test('insufficient checked video leaves stock recovery available; a later sufficient verified video allows the card',async t=>{
 const f=await nativeFixture(t,2);
 let result=await f.service.completeWithNativeFallback(f.project.id,undefined,undefined,true);
 assert.equal(documentaryCheckedVideoCoverage(result).percent,33);assert.equal(result.scenes[0]!.documentary!.verified,false);
 assert.equal(result.scenes[0]!.documentary!.nativeFallback,undefined);assert.equal(result.settings.stockVideoPercent,60);
 const p=structuredClone(result),donor=p.scenes[1]!;donor.durationSeconds=8;donor.trimEndSeconds=8;donor.documentary!.visualReview=await f.approved(p,donor);
 await f.projects.mutate(result.id,()=>p);
 result=await f.service.completeWithNativeFallback(f.project.id,undefined,undefined,true);
 assert.equal(documentaryNativeFallbackReady(result,result.scenes[0]!),true);assert.equal(documentaryCheckedVideoCoverage(result).percent,66);
});

for(const blocker of ['disabled','excluded','literal','directive','pinned','caption','outage','thematic-outage'] as const)test('automatic native card respects '+blocker,async t=>{
 const f=await nativeFixture(t,8,blocker==='thematic-outage');
 await f.projects.mutate(f.project.id,current=>{
  if(blocker==='disabled')current.settings.assembly.documentary!.autoMotionGraphics=false;
  if(blocker==='excluded')current.settings.assembly.documentary!.excludedTemplates=['full'];
  if(blocker==='literal')current.settings.assembly.documentary!.matchMode='literal';
  if(blocker==='directive')current.scenes[0]!.imagePrompt='[Visual: exact portrait of Captain Smith]';
  if(blocker==='pinned')current.scenes[0]!.documentary!.pinned=true;
  if(blocker==='caption')current.scenes[0]!.documentary!.caption.enabled=true;
  return current;
 });
 if(blocker.endsWith('outage')){
  const search=Reflect.get(f.service,'searcher') as DocumentarySearch;
  search.search=async()=>{
   const p=(await f.projects.get(f.project.id))!,fail=blocker==='outage'||Boolean(p.scenes[0]!.documentary!.requirement.footageFallback);
   return {candidates:[],sources:fail?[{provider:'commons',query:'fixture',count:0,error:'Provider temporarily unavailable'}]:[]};
  };
 }
 const result=await f.service.completeWithNativeFallback(f.project.id,undefined,undefined,true);
 assert.equal(result.scenes[0]!.documentary!.nativeFallback,undefined);assert.equal(result.scenes[0]!.documentary!.verified,false);
});

test('native quota ignores unverified manual footage and missing or modified approved originals',async t=>{
 const f=await nativeFixture(t),p=(await f.projects.get(f.project.id))!,donor=p.scenes[1]!;
 assert.equal(documentaryCheckedVideoCoverage(p).percent,66);
 const metadataOnly=structuredClone(p),stored=metadataOnly.scenes[1]!;
 stored.documentary!.visualReview!.localReview!.ctimeNs='0';
 stored.documentary!.visualReview!.illustrationApproval=documentaryIllustrationApproval(metadataOnly,stored);
 assert.equal(documentaryCheckedVideoCoverage(metadataOnly).percent,66,'Metadata-only ctime change does not erase an existing pixel approval');
 const missing=structuredClone(p);missing.scenes[1]!.videoPath=join(f.root,'missing.mp4');assert.equal(documentaryCheckedVideoCoverage(missing).percent,0);
 const pending=structuredClone(p),s=pending.scenes[1]!,source=s.documentary!.selected!;
 s.documentary!.verified=false;s.documentary!.manualReview={version:1,status:'pending',provider:source.provider,kind:'video',candidateId:source.id,checksum:s.documentary!.checksum!,
  mediaPath:s.videoPath!,narration:s.narration,reason:'Unreviewed file'};
 assert.equal(documentaryVideoCoverage(pending.scenes).percent,66,'Legacy editable coverage can include manual material');
 assert.equal(documentaryCheckedVideoCoverage(pending).percent,0,'Automatic native quota cannot');
 await writeFile(donor.videoPath!,'Different bytes after approval');assert.equal(documentaryCheckedVideoCoverage(p).percent,0);
});
