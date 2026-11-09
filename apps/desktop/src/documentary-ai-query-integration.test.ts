import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir,mkdtemp,readFile,readdir,rename,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {createVoiceCalibration,type Project,type DocumentarySearchInput} from '@gold-work/shared';
import type {AnyModelClient} from './anymodel-client.js';
import {DocumentaryAiQueryPlanner} from './documentary-ai-query-planner.js';
import {currentDocumentaryAiSearchPlan} from './documentary-ai-plan-state.js';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {DocumentarySearch} from './documentary-search.js';
import {prepareDocumentaryScript} from './documentary-plan.js';
import {planFastDocumentaryScene} from './documentary-fast-plan.js';
import {prepareDocumentaryFootageRecovery} from './documentary-footage-recovery.js';
import {groundDocumentaryScenes} from './documentary-comparison.js';
import {effectFfmpeg} from './effect-media.js';
import {DocumentaryAnalysisError} from './documentary-analysis-error.js';

test('scoped planning refreshes a settled search failure and keeps plans after provider errors',async t=>{
 const root=await mkdtemp(join(tmpdir(),'gws-query-refresh-integration-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
 let project=await projects.create({title:'Ship',topic:'A historic ship',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
 const narrations=['A ship sailed.','Its crew worked.','The cargo was secure.','The deck was quiet.','The crew was ready.','It had a wooden rudder.'];
 project.videoBrief={creationMode:'script',readyScript:narrations.join(' ')} as Project['videoBrief'];
 const template=prepareDocumentaryScript(project)[0]!;
 project.scenes=narrations.map((narration,order)=>({
  ...structuredClone(template),id:`refresh-${order}`,order,narration,audioPath:join(root,`voice-${order}.mp3`),
 }));
 project=await projects.mutate(project.id,()=>project);
 const storage=new LocalProjectStorage(join(root,'projects')),home=storage.projectDirectory(project.id);
 let markStarted!:()=>void,release!:()=>void;
 const started=new Promise<void>(resolve=>{markStarted=resolve;}),resume=new Promise<void>(resolve=>{release=resolve;});
 const sent:string[][]=[];
 const client={documentaryQueryModel:async()=>'fixture',documentaryCompletion:async(_system:string,payload:string)=>{
  const requested=(JSON.parse(payload).requestedScenes as Array<{sceneId:string}>).map(s=>s.sceneId);
  sent.push(requested);
  if(sent.length===2){markStarted();await resume;}
  return JSON.stringify({scenes:requested.map(sceneId=>({sceneId,subject:'historic ship',
   visualTarget:sent.length===1?'entire historic ship with rudder':'attributed close-up of the historic ship rudder',
   years:[],visualScope:'illustrative',preferredKind:'image',reservePolicy:'thematic',imageQueries:['historic ship rudder'],
   videoQueries:[],fallbackVisualTarget:'',fallbackVideoQueries:[]}))});
 }} as unknown as AnyModelClient;
 const service=new DocumentaryProjectService(projects,storage,new DocumentarySearch(),join(root,'Materials'),
  {download:async()=>assert.fail('Offline planning test')},()=>{},
  {simpleSelection:true,available:async()=>true,plan:async()=>assert.fail('Use query planner'),inspect:async()=>assert.fail('Offline planning test'),
   inspectForSelection:async()=>assert.fail('The fixture observes the review boundary'),withSelectionBudget:async(_budget,work)=>work()},
  undefined,undefined,new DocumentaryAiQueryPlanner(client,()=>home));
 project=await service.planSearch(project.id);
 const priorFailures=['Prior failed selection',undefined,'Prior failed selection',
  'Анализ материала не завершён: AnyModel вернул ошибку генерации: HTTP 503', 'TimeoutError: provider did not respond', 'Prior failed selection'];
 project=await projects.mutate(project.id,current=>({scenes:current.scenes.map(scene=>({...scene,documentary:{...scene.documentary!,
  verified:scene.order===1,autoError:priorFailures[scene.order]}}))}));
 const previous=structuredClone(project.scenes);
 const cacheDir=join(home,'documentary-ai-query-plans'),[cacheName]=(await readdir(cacheDir)).filter(name=>name.endsWith('.json'));
 const cacheFile=join(cacheDir,cacheName!),cache=JSON.parse(await readFile(cacheFile,'utf8'));
 cache.attempts[0].request.promptRevision=8;
 await writeFile(cacheFile,JSON.stringify(cache));
 const analysis=join(home,'Documentary','Analysis');await mkdir(analysis,{recursive:true});
 const receipt=join(analysis,`${'a'.repeat(64)}.json`),receiptBytes=JSON.stringify({state:'received',purpose:'visual-illustration',
  singleReviewBinding:{quality:{narration:previous[2]!.narration,target:'entire historic ship with rudder'}}});
 await writeFile(receipt,receiptBytes);
 const observed:string[]=[];
 Reflect.set(service,'completeWithSourceFallback',async(current:Project,_signal:unknown,id:string)=>{
  observed.push(current.scenes.find(scene=>scene.id===id)!.documentary!.requirement.aiSearchPlan!.visualTarget);
  return current;
 });
 const plan=service.planSearch(project.id,previous.slice(0,-1).map(scene=>scene.id));
 await Promise.race([started,plan.then(()=>assert.fail('Expected a scoped refresh'))]);
 const retry=service.retryGemini(project.id,previous[0]!.id);
 try{
  await new Promise<void>(resolve=>setImmediate(resolve));
  assert.deepEqual(observed,[]);
  assert.deepEqual((await projects.get(project.id))!.scenes,previous);
 }finally{release();}
 const planned=await plan;await retry;
 assert.deepEqual(sent,[previous.map(scene=>scene.id),[previous[0]!.id]]);
 assert.equal(planned.scenes[0]!.documentary!.requirement.aiSearchPlan!.visualTarget,'attributed close-up of the historic ship rudder');
 assert.deepEqual(observed,['attributed close-up of the historic ship rudder']);
 assert.equal(planned.scenes[0]!.audioPath,previous[0]!.audioPath);
 assert.deepEqual(planned.scenes.slice(1),previous.slice(1));
 assert.equal(await readFile(receipt,'utf8'),receiptBytes);
});

for(const initial of ['accepted','rejected','pending'] as const)test(`simple selection sends an AI target's object alternative to pixel review (${initial})`,async t=>{
 const root=await mkdtemp(join(tmpdir(),'gws-ai-target-alternative-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const file=join(root,'source.jpg');
 await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=size=1280x720','-frames:v','1',file]);
 const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
 let project=await projects.create({title:'Ship owner',topic:'Cutty Sark',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
 project.videoBrief={creationMode:'script',readyScript:'Her owner, John Willis, was betting on speed.'} as Project['videoBrief'];
 project.scenes=[prepareDocumentaryScript(project)[0]!];project.settings.stockVideoPercent=0;project.settings.voice.enabled=false;
 project.settings.assembly.documentary!.autoMotionGraphics=false;
 project=await projects.mutate(project.id,()=>project);
 const target="A portrait of shipowner John Willis; alternatively, the preserved Cutty Sark's masts and rigging";
 const client={documentaryQueryModel:async()=>'fixture',documentaryCompletion:async(_system:string,input:string)=>JSON.stringify({scenes:JSON.parse(input).requestedScenes.map(({sceneId}:{sceneId:string})=>({
  sceneId,subject:'John Willis',visualTarget:target,years:[],visualScope:'exact',preferredKind:'image',reservePolicy:'thematic',
  imageQueries:['John Willis portrait','Cutty Sark masts rigging'],videoQueries:[],fallbackVideoQueries:[],fallbackVisualTarget:'',
 }))})} as unknown as AnyModelClient;
 const searcher=new DocumentarySearch();searcher.search=async()=>({candidates:[{
  id:'pexels:rigging',provider:'pexels',kind:'image',title:'Cutty Sark masts and rigging',description:'The preserved ship at Greenwich',
  width:1280,height:720,query:'Cutty Sark masts rigging',pageUrl:'https://example.test/ship',downloadUrl:'https://example.test/rigging.jpg',
  author:'Fixture',license:'Fixture',licenseUrl:'',attribution:'Fixture',rights:'licensed',retrievedAt:'now',match:'unverified',concerns:[],
 }],sources:[]});
 let reviews=0,verdict:string=initial,model='model-a',contract='contract-1';
 const service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,'projects')),searcher,join(root,'Materials'),
  {download:async()=>({data:await readFile(file),extension:'.jpg',contentType:'image/jpeg'})},()=>{},
  {simpleSelection:true,selectionReviewIdentity:async()=>({model,contract}),available:async()=>true,plan:async()=>{throw Error('No legacy planner');},inspect:async(_p,scene)=>{
   reviews++;assert.equal(scene.documentary!.requirement.aiSearchPlan!.visualTarget,target);
   if(verdict==='pending')throw new DocumentaryAnalysisError('Fixture unknown paid response','pending','visual-illustration');
   return {status:verdict==='accepted'?'accepted':'rejected',confidence:.99,reason:'Fixture pixel verdict; orchestration only',quality:'1280x720',checkedAt:'now',sampleSeconds:[]};
  }},undefined,undefined,new DocumentaryAiQueryPlanner(client,()=>root));
 const result=await service.autoSelect(project.id);
 assert.equal(reviews,1,'The local portrait/object keyword gate must not suppress an allowed alternative: '+JSON.stringify(result.failures));
 assert.equal(result.selected,initial==='accepted'?1:0);assert.equal(result.project.scenes[0]!.documentary!.verified,initial==='accepted');
 if(initial!=='accepted'){
  await service.autoSelect(project.id);assert.equal(reviews,1,'The same decision must not be submitted again');
  contract='contract-2';
  if(initial==='pending'){
   await service.autoSelect(project.id);assert.equal(reviews,1,'Changing the prompt never unlocks an unknown response from the same model');
   model='model-b';
  }
  verdict='accepted';
  const resumed=await service.autoSelect(project.id);
  assert.equal(reviews,2,'A revised complete decision or a different model may inspect the saved source');
  assert.equal(resumed.selected,1,JSON.stringify(resumed.failures));
 }
});

const primaryFields=(plan:NonNullable<NonNullable<Project['scenes'][number]['documentary']>['requirement']['aiSearchPlan']>)=>{
  const {fallbackVisualTarget:_target,fallbackVideoQueries:_queries,...primary}=plan;
  return primary;
};

test('real orchestration preserves AI media lanes, context binding, recovery and paid cache',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-ai-query-integration-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
  let project=await projects.create({title:'Hurricane',topic:'Aviation',mediaMode:'stock',mode:'standard',language:'English',aspectRatio:'16:9'});
  const lines=['The Hawker Hurricane first flew in 1935.','Its fabric wing was repaired by mechanics.'];
  project.videoBrief={creationMode:'script',readyScript:lines.join('')} as Project['videoBrief'];
  const calibration=createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:'A measured voice reads naturally.',audioDurationSeconds:3});
  const base=prepareDocumentaryScript(project,calibration)[0]!;
  project.scenes=lines.map((narration,order)=>({...structuredClone(base),id:`ai-${order}`,order,narration,audioPath:`existing-${order}.mp3`,
    documentary:{...structuredClone(base.documentary!),requirement:{...base.documentary!.requirement,text:narration}}}));
  project.settings.voice.enabled=false;
  project.settings.assembly.documentary!.autoMotionGraphics=false;
  project=await projects.mutate(project.id,()=>project);
  const paidPurposes:string[]=[];
  const client={documentaryQueryModel:async()=> 'fixture-text-model',documentaryCompletion:async(_system:string,input:string)=>{
    const payload=JSON.parse(input);paidPurposes.push(payload.purpose??'primary');
    assert.equal(payload.originalScript,lines.join(''));
    assert.equal(payload.contextScenes.length,2);
    if(payload.purpose==='search-topic-broll-plan'||payload.purpose==='search-fallback-plan-v2')return JSON.stringify({scenes:payload.requestedScenes.map((scene:{sceneId:string})=>({
      sceneId:scene.sceneId,fallbackVisualTarget:'aircraft in flight',fallbackVideoQueries:['aircraft flying','airplane in flight']}))});
    assert.equal(payload.purpose,undefined);
    return JSON.stringify({scenes:payload.requestedScenes.map((scene:{sceneId:string})=>({sceneId:scene.sceneId,
      subject:'Hawker Hurricane',visualTarget:'Hawker Hurricane fabric wing repair in garage',years:['1935'],visualScope:'exact',preferredKind:'video',reservePolicy:'thematic',
      imageQueries:['Hawker Hurricane fabric wing photograph'],videoQueries:['Hawker Hurricane wing repair film'],
      fallbackVisualTarget:'aircraft fabric wing repair',fallbackVideoQueries:['aircraft fabric wing repair']}))});
  }} as unknown as AnyModelClient;
  const planner=new DocumentaryAiQueryPlanner(client,id=>join(root,id));
  const searches:DocumentarySearchInput[]=[];
  const searcher=new DocumentarySearch();searcher.search=async input=>{searches.push(input);return {candidates:[],sources:[]};};
  const service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,'projects')),searcher,join(root,'Materials'),
    {download:async()=>{throw Error('Unexpected download');}},()=>{},
    {simpleSelection:true,available:async()=>true,plan:async()=>{throw Error('Legacy planner must not run');},inspect:async()=>{throw Error('No candidates to inspect');}},undefined,undefined,planner);
  Reflect.set(service,'selectionResources',async()=>({workers:1}));
  const planned=await service.planSearch(project.id);
  assert.deepEqual(paidPurposes,['primary']);
  for(const scene of planned.scenes){
    assert.ok(currentDocumentaryAiSearchPlan(planned,scene));
    assert.deepEqual(planFastDocumentaryScene(planned,scene,'image').queries,['Hawker Hurricane fabric wing photograph']);
    assert.deepEqual(planFastDocumentaryScene(planned,scene,'video').queries,['Hawker Hurricane wing repair film']);
    const grounded=groundDocumentaryScenes(planned.scenes).find(item=>item.id===scene.id)!;
    assert.deepEqual(grounded.documentary!.requirement,scene.documentary!.requirement);
    const fallback=prepareDocumentaryFootageRecovery(planned,scene);
    assert.deepEqual(fallback.documentary!.requirement.footageFallback!.queries,['aircraft fabric wing repair']);
    assert.equal(planFastDocumentaryScene(planned,fallback,'video').visualTarget,'aircraft fabric wing repair');
    assert.deepEqual(planFastDocumentaryScene(planned,fallback,'image').queries,[]);
    assert.equal(fallback.audioPath,scene.audioPath);
  }
  const result=await service.autoSelect(project.id);
  assert.ok(searches.length>0);
  for(const search of searches)assert.ok((search.kind==='image'?['Hawker Hurricane fabric wing photograph']:
    ['Hawker Hurricane wing repair film','aircraft fabric wing repair','aircraft flying','airplane in flight']).includes(search.query),`Unexpected ${search.kind} query: ${search.query}`);
  assert.deepEqual(paidPurposes,['primary','search-fallback-plan-v2'],'One feedback revision follows unsuccessful primary discovery');
  assert.ok(searches.some(search=>search.query==='aircraft flying'),'The feedback reserve is searched after primary discovery fails');
  for(const scene of result.project.scenes)assert.equal(scene.documentary!.requirement.detail,scene.documentary!.requirement.aiSearchPlan!.visualTarget,
    'autoSelect must not run legacy grounding that removes or substitutes the AI visual goal');
  assert.deepEqual(result.project.scenes.map(scene=>scene.audioPath),planned.scenes.map(scene=>scene.audioPath));
  const repeated=await service.planSearch(project.id);
  assert.deepEqual(paidPurposes,['primary','search-fallback-plan-v2']);
  assert.deepEqual(repeated.scenes.map(scene=>primaryFields(scene.documentary!.requirement.aiSearchPlan!)),
    planned.scenes.map(scene=>primaryFields(scene.documentary!.requirement.aiSearchPlan!)));
  assert.deepEqual(repeated.scenes.map(scene=>scene.documentary!.requirement.aiSearchPlan),result.project.scenes.map(scene=>scene.documentary!.requirement.aiSearchPlan));
  const edited={...repeated,scenes:repeated.scenes.map((scene,i)=>i?{...scene,narration:'A different aircraft landed.'}:scene)};
  assert.equal(currentDocumentaryAiSearchPlan(edited,edited.scenes[0]!),undefined,'A neighbouring edit invalidates the pronoun context');
  assert.deepEqual(planFastDocumentaryScene(edited,edited.scenes[0]!).queries,[],'Stale AI plans must not fall back to regex');
});

test('restart with 67 of 68 applied plans offers local completion from the saved response and preserves accepted media',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-local-plan-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
  let project=await projects.create({title:'Tea clippers',topic:'Ships',mediaMode:'stock',mode:'standard',language:'English',aspectRatio:'16:9'});
  const lines=Array.from({length:68},(_,i)=>`Ship ${i+1} sails. `);
  project.videoBrief={creationMode:'script',readyScript:lines.join('')} as Project['videoBrief'];
  const base=prepareDocumentaryScript(project)[0]!;
  project=await projects.mutate(project.id,()=>({...project,scenes:lines.map((narration,order)=>({
    ...structuredClone(base),id:'ship-'+order,order,narration,audioPath:'saved-'+order+'.mp3',
    documentary:{...structuredClone(base.documentary!),requirement:{...base.documentary!.requirement,text:narration}},
  }))}));
  let completions=0,model='fixture-model';
  const client={documentaryQueryModel:async()=>model,documentaryCompletion:async(_system:string,input:string)=>{
    completions++;
    return JSON.stringify({scenes:JSON.parse(input).requestedScenes.map(({sceneId}:{sceneId:string})=>({
      sceneId,subject:'Cutty Sark',visualTarget:'Cutty Sark at sea',years:[],visualScope:'exact',preferredKind:'image',reservePolicy:'thematic',
      imageQueries:['Cutty Sark'],videoQueries:[],fallbackVideoQueries:[],fallbackVisualTarget:'',
    }))});
  }} as unknown as AnyModelClient;
  const storage=new LocalProjectStorage(join(root,'projects'));
  const restart=()=>new DocumentaryProjectService(projects,storage,new DocumentarySearch(),join(root,'materials'),
    {download:async()=>{throw Error('Unexpected download');}},()=>{},undefined,undefined,undefined,
    new DocumentaryAiQueryPlanner(client,()=>root));
  const service=restart();
  assert.deepEqual(await service.getDocumentaryQueryPlanIssues(project.id),[],'A manual project with no receipts can proceed');
  const complete=await service.planSearch(project.id);
  const missing=project.scenes[67]!;
  const partial=await projects.mutate(project.id,()=>({scenes:complete.scenes.map((s,i)=>i===67?missing:i===0
    ?{...s,imagePath:'accepted.jpg',documentary:{...s.documentary!,verified:true,reviewNote:'Accepted by user'}}:s)}));
  const dir=join(root,'documentary-ai-query-plans'),file=join(dir,(await readdir(dir))[0]!);
  const cache=JSON.parse(await readFile(file,'utf8'));
  delete cache.plans[missing.id];
  cache.attempts.at(-1).status='invalid';
  const receipt=JSON.stringify(cache);
  await writeFile(file,receipt);
  const resumed=restart(),before=completions;
  const issues=await resumed.getDocumentaryQueryPlanIssues(project.id);
  assert.deepEqual(issues.map(row=>[row.sceneNumber,row.cached,row.retryToken]),[[68,true,undefined]]);
  assert.equal((await projects.get(project.id))!.scenes[67]!.documentary!.requirement.aiSearchPlan,undefined,'Opening the screen only inspects');
  const applied=await resumed.planSearch(project.id,undefined,undefined,{cachedOnly:true});
  assert.ok(applied.scenes.every(s=>currentDocumentaryAiSearchPlan(applied,s)));
  assert.deepEqual(applied.scenes.slice(0,67),partial.scenes.slice(0,67));
  assert.deepEqual(await resumed.getDocumentaryQueryPlanIssues(project.id),[]);
  assert.equal(JSON.parse(await readFile(join(storage.projectDirectory(project.id),'Documentary','Plans','ai-query-status.json'),'utf8')).state,'complete');
  // A manually accepted image does not require an AI plan to leave the preparation screen.
  const manual={...missing,imagePath:'manual.jpg',documentary:{...missing.documentary!,verified:true,reviewNote:'Keep my image'}};
  await projects.mutate(project.id,()=>({scenes:[...applied.scenes.slice(0,67),manual]}));
  assert.deepEqual(await resumed.getDocumentaryQueryPlanIssues(project.id),[]);
  assert.deepEqual((await resumed.planSearch(project.id,undefined,undefined,{cachedOnly:true})).scenes[67],manual);
  model='';
  assert.deepEqual(await resumed.getDocumentaryQueryPlanIssues(project.id),[],'Manual mode without a selected AI model');
  assert.equal(await readFile(file,'utf8'),receipt);assert.equal(completions,before);
});

test('primary planning drains independent batches, then retries only a displayed completed scene across clicks and restarts',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-targeted-query-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
  let project=await projects.create({title:'Railway',topic:'Steam trains',mediaMode:'stock',mode:'standard',language:'English',aspectRatio:'16:9'});
  const lines=Array.from({length:19},(_,i)=>`Steam locomotive number ${i+1} pulls a train.`);
  project.videoBrief={creationMode:'script',readyScript:lines.join(' ')} as Project['videoBrief'];
  const base=prepareDocumentaryScript(project)[0]!;
  project=await projects.mutate(project.id,()=>({...project,scenes:lines.map((narration,order)=>({
    ...structuredClone(base),id:`scene-${order}`,order,narration,audioPath:`paid-${order}.mp3`,
    documentary:{...structuredClone(base.documentary!),requirement:{...base.documentary!.requirement,text:narration}},
  }))}));
  const bad=new Set(['scene-0','scene-1']), calls:string[][]=[];
  let disconnect=false, entered!:()=>void, release!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;});
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const client={documentaryQueryModel:async()=>'fixture-model',documentaryCompletion:async(_system:string,payload:string)=>{
    const data=JSON.parse(payload);
    assert.equal(data.contextScenes.length,19);
    assert.equal(data.purpose,undefined);
    const ids=data.requestedScenes.map((s:{sceneId:string})=>s.sceneId) as string[];
    calls.push(ids);
    if(disconnect){entered();await gate;throw new Error('Fixture connection closed');}
    return JSON.stringify({scenes:ids.filter(id=>!bad.has(id)).map(sceneId=>({sceneId,subject:'steam locomotive',
      visualTarget:'steam locomotive pulling a train',years:[],visualScope:'illustrative',preferredKind:'video',reservePolicy:'thematic',
      imageQueries:['steam locomotive photograph'],videoQueries:['steam locomotive pulling train'],
      fallbackVisualTarget:'',fallbackVideoQueries:[]}))});
  }} as unknown as AnyModelClient;
  const storage=new LocalProjectStorage(join(root,'projects'));
  const restart=()=>new DocumentaryProjectService(projects,storage,new DocumentarySearch(),join(root,'materials'),
    {download:async()=>{throw Error('Unexpected download');}},()=>{},undefined,undefined,undefined,
    new DocumentaryAiQueryPlanner(client,()=>root));
  let service=restart();
  const status=async()=>JSON.parse(await readFile(join(storage.projectDirectory(project.id),'Documentary','Plans','ai-query-status.json'),'utf8'));
  await assert.rejects(service.planSearch(project.id),/№1, №2 — .*Модель пропустила сцену/);
  assert.equal(calls.length,3);
  assert.deepEqual(calls.flat().filter(id=>bad.has(id)),['scene-0','scene-1','scene-0','scene-1']);
  const saved=(await projects.get(project.id))!;
  assert.deepEqual(saved.scenes.filter(s=>currentDocumentaryAiSearchPlan(saved,s)).map(s=>s.id),project.scenes.slice(2).map(s=>s.id));
  assert.deepEqual(saved.scenes.map(s=>s.audioPath),project.scenes.map(s=>s.audioPath));
  const receiptDir=join(root,'documentary-ai-query-plans');
  const receipt=join(receiptDir,(await readdir(receiptDir))[0]!);
  const originalReceipt=await readFile(receipt,'utf8');
  service=restart();
  const [first,second]=await service.getDocumentaryQueryPlanIssues(project.id);
  assert.ok(first?.retryToken&&second?.retryToken);
  assert.equal(first.sceneNumber,1);assert.equal(second.sceneNumber,2);
  await assert.rejects(service.planSearch(project.id),/исчерпаны/);
  assert.equal(await readFile(receipt,'utf8'),originalReceipt);
  await rename(receipt,receipt+'.bak');
  await assert.rejects(service.retryDocumentaryQueryPlan(project.id,first.sceneId,first.retryToken),/Состояние попыток изменилось/);
  await rename(receipt+'.bak',receipt);
  await assert.rejects(service.retryDocumentaryQueryPlan(project.id,second.sceneId,first.retryToken),/Состояние попыток изменилось/);
  assert.equal(calls.length,3);
  // A duplicate click cannot spend a fourth attempt even when the third also fails validation.
  const retry=()=>service.retryDocumentaryQueryPlan(project.id,first.sceneId,first.retryToken!);
  const clicks=await Promise.allSettled([retry(),retry()]);
  assert.deepEqual(clicks.map(item=>item.status),['rejected','rejected']);
  assert.deepEqual(calls.slice(3),[['scene-0']]);
  service=restart();
  const afterInvalid=await service.getDocumentaryQueryPlanIssues(project.id);
  assert.ok(afterInvalid[0]?.retryToken&&afterInvalid[0].retryToken!==first.retryToken);
  assert.equal(afterInvalid[1]?.retryToken,second.retryToken);
  bad.delete(first.sceneId);
  const repaired=await service.retryDocumentaryQueryPlan(project.id,first.sceneId,afterInvalid[0].retryToken);
  assert.ok(currentDocumentaryAiSearchPlan(repaired,repaired.scenes[0]!));
  assert.deepEqual(repaired.scenes.slice(1),saved.scenes.slice(1));
  assert.deepEqual((await status()).missingSceneIds,[second.sceneId]);
  assert.deepEqual(calls.slice(4),[[first.sceneId]]);
  // Inspecting a durable pending marker never waits for the provider or enables a second payment.
  disconnect=true;
  const pending=service.retryDocumentaryQueryPlan(project.id,second.sceneId,second.retryToken);
  await started;
  assert.equal((await restart().getDocumentaryQueryPlanIssues(project.id))[0]?.retryToken,undefined);
  const duplicate=service.retryDocumentaryQueryPlan(project.id,second.sceneId,second.retryToken);
  release();
  const disconnected=await Promise.allSettled([pending,duplicate]);
  assert.deepEqual(disconnected.map(item=>item.status),['rejected','rejected']);
  service=restart();
  const protectedIssues=await service.getDocumentaryQueryPlanIssues(project.id);
  assert.equal(protectedIssues.length,1);assert.equal(protectedIssues[0]?.retryToken,undefined);
  assert.match(protectedIssues[0]!.reason,/не подтверждён/);
  await assert.rejects(service.retryDocumentaryQueryPlan(project.id,second.sceneId,second.retryToken),/Состояние попыток изменилось/);
  assert.deepEqual(calls.slice(5),[[second.sceneId]]);
});

test('partial 1/3 AI planning saves valid work and stops without heuristic substitution or paid resubmission',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-ai-query-partial-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
  let p=await projects.create({title:'Railway',topic:'Steam railway',mediaMode:'stock',mode:'standard',language:'English',aspectRatio:'16:9'});
  const lines=['A steam locomotive pulls a train.','Passengers wait on the platform.','The train passes a bridge.'];
  p.videoBrief={creationMode:'script',readyScript:lines.join('')} as Project['videoBrief'];
  const calibration=createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:'A measured voice reads naturally.',audioDurationSeconds:3});
  const base=prepareDocumentaryScript(p,calibration)[0]!;
  p.scenes=lines.map((narration,order)=>({...structuredClone(base),id:`partial-${order}`,order,narration,audioPath:`paid-${order}.mp3`,
    documentary:{...structuredClone(base.documentary!),requirement:{...base.documentary!.requirement,text:narration}}}));
  p.settings.voice.enabled=false;p.settings.assembly.documentary!.autoMotionGraphics=false;p=await projects.mutate(p.id,()=>p);
  const purposes:string[]=[];
  const client={documentaryQueryModel:async()=> 'partial-text-model',documentaryCompletion:async(_system:string,input:string,_images:any,_signal:any,onPartial:(text:string)=>void)=>{
    const payload=JSON.parse(input);purposes.push(payload.purpose??'primary');const first=payload.requestedScenes[0];
    if(payload.purpose==='search-topic-broll-plan'){
      assert.deepEqual(payload.requestedScenes.map((scene:{sceneId:string})=>scene.sceneId),['partial-0']);
      return JSON.stringify({scenes:[{sceneId:first.sceneId,fallbackVisualTarget:'railway train moving',fallbackVideoQueries:['railway train moving','train on rails']}]});
    }
    assert.equal(payload.purpose,undefined);
    onPartial(JSON.stringify({scenes:[{sceneId:first.sceneId,subject:'steam locomotive',visualTarget:'steam locomotive pulling a passenger train',years:[],visualScope:'illustrative',preferredKind:'video',reservePolicy:'thematic',
      imageQueries:['steam locomotive passenger train photo'],videoQueries:['steam locomotive pulling passenger train'],fallbackVisualTarget:'steam train moving',fallbackVideoQueries:['steam train moving']}]}));
    throw Error('Unknown paid response');
  }} as unknown as AnyModelClient;
  const planner=new DocumentaryAiQueryPlanner(client,id=>join(root,id));
  const search=new DocumentarySearch(),observed:string[]=[];search.search=async input=>{observed.push(input.query);return {candidates:[],sources:[]};};
  const service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,'projects')),search,join(root,'Materials'),{download:async()=>{throw Error('No download');}},()=>{},
    {simpleSelection:true,available:async()=>true,plan:async()=>new Map(),inspect:async()=>{throw Error('No candidates');}},undefined,undefined,planner);
  Reflect.set(service,'selectionResources',async()=>({workers:1}));
  await assert.rejects(service.planSearch(p.id),/AI-план поисковых запросов не готов/);
  const planned=(await projects.get(p.id))!;
  assert.deepEqual(purposes,['primary']);assert.ok(planned.scenes[0]!.documentary!.requirement.aiSearchPlan);
  const primaryDirectory=join(root,p.id,'documentary-ai-query-plans');
  const primaryFiles=await readdir(primaryDirectory);
  const receipts=await Promise.all(primaryFiles.map(async name=>[name,await readFile(join(primaryDirectory,name),'utf8')] as const));
  const ai=structuredClone(planned.scenes[0]!.documentary!.requirement.aiSearchPlan);
  for(const scene of planned.scenes.slice(1)){
    assert.equal(scene.documentary!.requirement.aiSearchPlan,undefined);assert.equal(scene.documentary!.requirement.plannedBy,undefined);
    assert.equal(scene.documentary!.requirement.fastPlanVersion,undefined);assert.equal(scene.documentary!.verified,false);
    assert.deepEqual(scene.documentary!.requirement.queries,p.scenes[scene.order]!.documentary!.requirement.queries);
  }
  await assert.rejects(service.autoSelect(p.id),/AI-план поисковых запросов не готов/);
  assert.deepEqual(purposes,['primary']);assert.deepEqual(observed,[]);
  const resumed=(await projects.get(p.id))!;
  assert.deepEqual(primaryFields(resumed.scenes[0]!.documentary!.requirement.aiSearchPlan!),primaryFields(ai!));
  await assert.rejects(service.planSearch(p.id),/AI-план поисковых запросов не готов/);assert.deepEqual(purposes,['primary']);
  for(const [name,receipt]of receipts)assert.equal(await readFile(join(primaryDirectory,name),'utf8'),receipt,'An uncertain primary receipt must remain immutable and must not be resubmitted');
  assert.deepEqual(resumed.scenes.map(s=>s.audioPath),p.scenes.map(s=>s.audioPath));
});
