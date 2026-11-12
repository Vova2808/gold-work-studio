import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {type DocumentaryCandidate} from '@gold-work/shared';
import {AnyModelCompletionUncertainError,type AnyModelClient} from './anymodel-client.js';
import {DocumentaryAiQueryPlanner} from './documentary-ai-query-planner.js';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {DocumentarySearch} from './documentary-search.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {prepareDocumentaryScript} from './documentary-plan.js';
import {effectFfmpeg} from './effect-media.js';
import {documentaryIllustrationQualityInstructionV4} from './documentary-illustration-quality.js';
import {DocumentaryRetryPermissions,listDocumentaryRecovery,readDocumentarySelectionRetryGrant} from './documentary-retry.js';

const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
for(const mode of ['exact','no-grant','changed-file','missing-file','changed-model','wrong-manifest','unknown-again','edit-before-dispatch','edit-during-dispatch-check','pin-during-dispatch-check','pinned','outside-scope'] as const)
test(`ordinary legacy selection performs only an existing authorized exact recovery before planning: ${mode}`,async t=>{
 const root=await mkdtemp(join(tmpdir(),'gws-legacy-exact-service-'));t.after(()=>rm(root,{recursive:true,force:true}));
 t.mock.method(globalThis,'fetch',async()=>assert.fail('Offline fixture: no HTTP'));
 const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
 let project=await projects.create({title:'Aurora',topic:'Aurora',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
 const narration='Aurora raised her red sails.';
 project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:narration};project.scenes=[prepareDocumentaryScript(project)[0]!];
 project.settings.voice.enabled=false;project.settings.assembly.documentary!.autoMotionGraphics=false;
 project.scenes[0]!.audioPath='previously-paid-voice.wav';project=await projects.mutate(project.id,()=>project);
 const storage=new LocalProjectStorage(join(root,'projects')),home=storage.projectDirectory(project.id);
 let planCalls=0,visualCalls=0,unknown=true,model='fixture';
 const planner=new DocumentaryAiQueryPlanner({documentaryQueryModel:async()=>'fixture',documentaryCompletion:async(_system,input)=>{
  planCalls++;const data=JSON.parse(input);return JSON.stringify({scenes:data.requestedScenes.map((s:{sceneId:string;narration:string})=>({
   sceneId:s.sceneId,subject:'Aurora',visualTarget:'Aurora with red sails',years:[],visualScope:'illustrative',preferredKind:'image',
   reservePolicy:'primary-only',imageQueries:['Aurora with red sails'],videoQueries:[],fallbackVideoQueries:[],fallbackVisualTarget:'',
   grounding:{version:1,mandatory:[{kind:'identity',required:'Aurora',scriptQuote:s.narration},{kind:'condition',required:'red sails',scriptQuote:s.narration}],
    illustrations:['The same ship with red sails visibly illustrates its sailcloth.'],optionalDetails:[]}}))});
 }} as AnyModelClient,()=>home);
 const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryAnalysisModel:async()=>model,
  documentaryCompletion:async()=>{visualCalls++;if(unknown)throw new AnyModelCompletionUncertainError('Fixture unknown after dispatch');
   return '{"suitable":true,"targetVisible":true,"description":"Fixture old positive answer","sourceText":{"kind":"none","text":""}}';}},()=>home);
 const service=new DocumentaryProjectService(projects,storage,new DocumentarySearch(),join(root,'Materials'),{download:async()=>assert.fail('No download')},()=>{},
  intelligence,undefined,undefined,planner);
 project=await service.planSearch(project.id);assert.equal(planCalls,1);
 const planRoot=join(home,'documentary-ai-query-plans'),planFile=join(planRoot,(await readdir(planRoot)).find(name=>name.endsWith('.json'))!);
 const cache=JSON.parse(await readFile(planFile,'utf8')),raw=JSON.parse(cache.attempts[0].rawResponse),sceneId=project.scenes[0]!.id;
 cache.attempts[0].request.promptRevision=10;delete raw.scenes[0].grounding;delete cache.plans[sceneId].grounding;
 cache.attempts[0].rawResponse=JSON.stringify(raw);await writeFile(planFile,JSON.stringify(cache));
 project=await projects.mutate(project.id,current=>({scenes:current.scenes.map(scene=>({...scene,documentary:{...scene.documentary!,autoError:'Previous source review did not finish',
  requirement:{...scene.documentary!.requirement,aiSearchPlan:cache.plans[scene.id]}}}))}));
 const scene=project.scenes[0]!,sceneRoot=join(home,'Documentary',sceneId);await mkdir(sceneRoot,{recursive:true});
 const file=join(sceneRoot,'source.jpg');await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=s=1280x720:r=1','-frames:v','1',file]);
 const checksum=createHash('sha256').update(await readFile(file)).digest('hex');
 const source:DocumentaryCandidate={id:'commons:fixture',provider:'commons',kind:'image',title:'Aurora under sail',description:'Archived photograph',localPath:file,
  width:1280,height:720,pageUrl:'https://example.test/source',downloadUrl:'',rights:'public-domain',author:'fixture',license:'public domain',licenseUrl:'',
  attribution:'fixture',retrievedAt:'fixture',query:'Aurora',match:'unverified',concerns:[]};
 const manifest=join(sceneRoot,checksum+'.source.json');await writeFile(manifest,JSON.stringify({...source,checksum}));
 const quarantinePath=join(sceneRoot,'uncertain-candidates.json'),quarantine=JSON.stringify({version:1,keys:[
  hash(JSON.stringify(['commons','commons:fixture',undefined,undefined,undefined])),hash('uncertain-file:'+checksum)]});await writeFile(quarantinePath,quarantine);
 const prepared={...scene,imagePath:file,documentary:{...scene.documentary!,selected:source,checksum}};
 const complete=Reflect.get(intelligence,'complete').bind(intelligence);
 let captured:{images:string[];previous:Array<{system:string;input:string}>}|undefined;
 Reflect.set(intelligence,'complete',async(_id:string,_purpose:string,_system:string,_input:string,images:string[],previous:Array<{system:string;input:string}>)=>{
  captured={images,previous};throw Error('Fixture request capture');});
 await assert.rejects(intelligence.inspectForSelection(project,prepared),/Fixture request capture/);Reflect.set(intelligence,'complete',complete);
 assert.ok(captured);const old=captured.previous.find(row=>row.system.endsWith(documentaryIllustrationQualityInstructionV4)&&JSON.parse(row.input).analysisModel==='fixture');assert.ok(old);
 await assert.rejects(complete(project.id,'visual-illustration',old.system,old.input,captured.images));assert.equal(visualCalls,1);
 const [item]=await listDocumentaryRecovery(home);assert.ok(item);const analysis=join(home,'Documentary','Analysis'),receiptPath=join(analysis,item.id+'.json');
 const pending=await readFile(receiptPath,'utf8');
 if(mode!=='no-grant')await new DocumentaryRetryPermissions().authorize(home,[item]);
 if(mode==='changed-file')await writeFile(file,'Changed bytes');
 if(mode==='missing-file')await rm(file);
 if(mode==='changed-model')model='other-model';
 if(mode==='wrong-manifest')await writeFile(manifest,JSON.stringify({...source,checksum,id:'commons:unrelated',title:'Different object'}));
 if(mode==='pinned')await projects.mutate(project.id,current=>({scenes:current.scenes.map(s=>({...s,documentary:{...s.documentary!,pinned:true}}))}));
 const receiptBefore=await readFile(receiptPath,'utf8');unknown=mode==='unknown-again';
 if(mode==='edit-before-dispatch'){
  const withBudget=intelligence.withSelectionBudget.bind(intelligence);let edit=true;
  t.mock.method(intelligence,'withSelectionBudget',async<T>(budget:Parameters<typeof intelligence.withSelectionBudget>[0],run:()=>Promise<T>)=>withBudget({...budget,beforeSubmit:async()=>{
   if(edit){edit=false;await projects.mutate(project.id,current=>({scenes:current.scenes.map(s=>({...s,durationOverrideSeconds:7}))}));}
   await budget.beforeSubmit?.();
  }},run));
 }
 if(mode==='edit-during-dispatch-check'||mode==='pin-during-dispatch-check'){
  const withBudget=intelligence.withSelectionBudget.bind(intelligence),identity=intelligence.selectionReviewIdentity.bind(intelligence);
  let checkingDispatch=false,edit=true,checks=0;
  t.mock.method(intelligence,'selectionReviewIdentity',async()=>{
   const value=await identity();
   if(checkingDispatch&&edit){edit=false;await projects.mutate(project.id,current=>({scenes:current.scenes.map(s=>mode==='pin-during-dispatch-check'
    ?{...s,documentary:{...s.documentary!,pinned:true}}:{...s,durationOverrideSeconds:7})}));}
   return value;
  });
  t.mock.method(intelligence,'withSelectionBudget',async<T>(budget:Parameters<typeof intelligence.withSelectionBudget>[0],run:()=>Promise<T>)=>withBudget({...budget,beforeSubmit:async()=>{
   checkingDispatch=++checks===2;try{await budget.beforeSubmit?.();}finally{checkingDispatch=false;}
  }},run));
 }
 // Keep this regression at the requested boundary. The real normal planner
 // must run; later discovery/new visual tasks are a separate selection phase.
 const planSearch=service.planSearch.bind(service);let normalPlanCompleted=false;
 t.mock.method(service,'planSearch',async(...args:Parameters<typeof service.planSearch>)=>{
  await planSearch(...args);normalPlanCompleted=true;throw Error('Fixture ends after normal plan completion');
 });
 await assert.rejects(service.autoSelect(project.id,{sceneIds:mode==='outside-scope'?[]:[sceneId]}));
 const saved=(await projects.get(project.id))!;
 assert.equal(saved.scenes[0]!.audioPath,'previously-paid-voice.wav');assert.notEqual(saved.scenes[0]!.documentary!.verified,true);
 assert.equal(await readFile(quarantinePath,'utf8'),quarantine);
 if(mode==='exact'){
  assert.equal(visualCalls,2);assert.equal(planCalls,2);assert.equal(normalPlanCompleted,true);
  assert.ok(saved.scenes[0]!.documentary!.requirement.aiSearchPlan!.grounding);
  assert.equal(JSON.parse(await readFile(receiptPath,'utf8')).state,'complete');
  assert.equal(await readFile(join(analysis,'RetryHistory',`${item.id}-${item.revision}.json`),'utf8'),pending);
 }else if(mode==='unknown-again'){
  assert.equal(visualCalls,2);assert.equal(planCalls,1);assert.equal(normalPlanCompleted,false);
  const repeated=await readFile(receiptPath,'utf8');await assert.rejects(service.autoSelect(project.id,{sceneIds:[sceneId]}));
  assert.equal(visualCalls,2);assert.equal(planCalls,1);assert.equal(await readFile(receiptPath,'utf8'),repeated);
 }else if(mode==='edit-before-dispatch'||mode==='edit-during-dispatch-check'||mode==='pin-during-dispatch-check'){
  assert.equal(visualCalls,1);assert.equal(planCalls,1);assert.equal(normalPlanCompleted,false);
  assert.ok(await readDocumentarySelectionRetryGrant(analysis,item.id),'A proven zero-POST edit cannot consume the permission');
  assert.equal(JSON.parse(await readFile(receiptPath,'utf8')).rejection,'local-admission-not-dispatched');
  await projects.mutate(project.id,current=>({scenes:current.scenes.map(s=>({...s,durationOverrideSeconds:undefined,documentary:{...s.documentary!,pinned:false}}))}));
  await assert.rejects(service.autoSelect(project.id,{sceneIds:[sceneId]}));
  assert.equal(visualCalls,2);assert.equal(planCalls,2);assert.equal(normalPlanCompleted,true);
  assert.equal(JSON.parse(await readFile(receiptPath,'utf8')).state,'complete');
 }else{
  assert.equal(visualCalls,1);assert.equal(planCalls,1);assert.equal(await readFile(receiptPath,'utf8'),receiptBefore);
 }
});
