import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm,mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {MemoryTaskRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {createDefaultProjectSettings,createDocumentarySettings,documentaryVideoCoverage,type Project,type Scene} from '@gold-work/shared';
import {validateRouteComparison,attachRouteComparison,savedRouteComparisonIssue,needsRouteComparison,routeComparisonRequestBinding,routeComparisonContext,routeComparisonTarget,assertRouteComparisonCorrection,hasCompletedRouteComparison} from './documentary-route-comparison.js';
import {documentaryAiPlanContext} from './documentary-ai-plan-state.js';
import {documentaryIllustrationApproval,documentarySavedContextIssue,documentaryRouteApprovalCandidate} from './documentary-context-approval.js';
import {documentaryAutomaticMaterialReady} from './documentary-auto-readiness.js';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {documentaryEditErrors} from './documentary-validation.js';
import {missingAssemblyInputs} from './assembly-readiness.js';
import {enrichSemanticMontage} from './documentary-semantic-montage.js';
import {planDocumentaryMontage} from './documentary-montage.js';
import {documentaryRouteComparisonGeometry} from '@gold-work/remotion-video';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {AnyModelProviderResponseError} from './anymodel-client.js';
import {documentaryCheckpointKey} from './documentary-checkpoint-key.js';
import {DocumentaryRetryPermissions,listDocumentaryRecovery} from './documentary-retry.js';
import {FileProjectRepository} from './file-project-repository.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {MockGenerationPipeline} from './mock-generation-pipeline.js';
import type {StandardRenderer} from './standard-renderer.js';

export function routeFixture(){
  const context='Britain. Ships sailed from London to Shanghai. The route around the Cape of Good Hope was longer. The Suez Canal gave ships a shortcut. How could the sailing ships compete?';
  const settings=createDefaultProjectSettings();settings.assembly.documentary={...createDocumentarySettings(),autoMotionGraphics:true};
  const s={id:'s6',order:5,durationSeconds:5,includeInAssembly:true,narration:context,status:'failed',imagePrompt:'',animationPrompt:'',documentary:{version:2,verified:false,pinned:false,layout:'full',caption:{enabled:false,text:''},effects:[],candidates:[],autoError:'No comparison map found',timing:{sourceKey:'voice',durationInFrames:150,speechSeconds:4.8},requirement:{text:context,entities:[],years:[],queries:[],preferredKind:'image',detail:'Map comparing two sea routes around Africa versus Suez'}}} as unknown as Scene;
  const p={id:'route-test',mediaMode:'stock',aspectRatio:'16:9',language:'en',videoBrief:{readyScript:context},settings,scenes:[s]} as unknown as Project;
  const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
  s.documentary!.requirement.aiSearchPlan={version:1,model:'fixture',inputHash:hash({inputHash:hash({version:1,model:'fixture',context:documentaryAiPlanContext(p)}),sceneId:s.id}),visualTarget:s.documentary!.requirement.detail??'',subject:'routes',years:[],visualScope:'illustrative',preferredKind:'image',imageQueries:[],videoQueries:[],fallbackVideoQueries:[],fallbackVisualTarget:'',reservePolicy:'primary-only'};
  const london={name:'London',country:'United Kingdom',quote:'Ships sailed from London to Shanghai.'},shanghai={name:'Shanghai',country:'China',quote:'Ships sailed from London to Shanghai.'};
  const start=[{stop:0},{bend:[1.5,52]},{bend:[1.5,51]},{bend:[-5,49]}],end=[{bend:[80,0]},{bend:[94,4]},{bend:[98,5]},{bend:[104,1]},{bend:[110,7]},{bend:[120,15]},{bend:[125,22]},{bend:[125,29]},{stop:2}];
  const raw={comparisonQuotes:['The route around the Cape of Good Hope was longer.','The Suez Canal gave ships a shortcut.'],routes:[
    {label:'Cape of Good Hope',quote:'The route around the Cape of Good Hope was longer.',stops:[london,{name:'Cape of Good Hope',quote:'The route around the Cape of Good Hope was longer.'},shanghai],points:[...start,{bend:[-15,25]},{bend:[-20,8]},{bend:[-10,-15]},{bend:[10,-36]},{stop:1},{bend:[24,-37]},{bend:[55,-25]},...end]},
    {label:'Suez Canal',quote:'The Suez Canal gave ships a shortcut.',stops:[london,{name:'Suez Canal',quote:'The Suez Canal gave ships a shortcut.'},shanghai],points:[...start,{bend:[-12,45]},{bend:[-12,36]},{bend:[-6,36]},{bend:[0,38]},{bend:[12,37]},{bend:[25,34]},{bend:[31.5,32]},{stop:1},{bend:[34,27]},{bend:[39,18]},{bend:[44,12]},{bend:[58,9]},...end]},
  ]};return {project:p,scene:s,raw};
}
test('route eligibility includes the actual distance comparison map but excludes ordinary maps and single directions',()=>{
  const check=(target:string)=>{const {scene}=routeFixture();scene.documentary!.requirement.aiSearchPlan!.visualTarget=target;return needsRouteComparison(scene);};
  assert.equal(check('route comparison map of Britain to China via Suez Canal versus around Cape of Good Hope'),true);
  assert.equal(check('distance comparison map of Europe to Asia via Suez Canal versus around Africa'),true);
  assert.equal(check('comparison diagram from A to B through the canal vs around the continent'),true);
  for(const target of ['political map of Europe and Asia','distance map of Europe to Asia via Suez Canal','comparison map of Europe versus Asia','comparison map around 1850 versus around 1900','Cutty Sark sailing vessel under sail'])assert.equal(check(target),false,target);
});
test('primary-only route comparison becomes a distinct native graphic, preserving voice and contributing zero stock video',()=>{
  const {project,scene,raw}=routeFixture(),value=validateRouteComparison(project,scene,raw,'fixture'),next=attachRouteComparison(project,scene,value);
  project.scenes=[next];assert.equal(savedRouteComparisonIssue(project,next),undefined);
  assert.equal(documentaryVideoCoverage(project.scenes).videoSeconds,0);assert.equal(next.audioPath,scene.audioPath);assert.deepEqual(next.documentary!.timing,scene.documentary!.timing);
  assert.deepEqual(documentaryEditErrors(project),[]);assert.equal(next.documentary!.motionGraphic!.routeComparison!.origin,'generated-route-schematic');
  assert.deepEqual(planDocumentaryMontage(project)[0]!.documentary!.motionGraphic,next.documentary!.motionGraphic);
  assert.deepEqual(enrichSemanticMontage(project)[0]!.documentary!.motionGraphic,next.documentary!.motionGraphic);
  const rendered={...next,videoPath:'rendered-scheme.mp4',documentary:{...next.documentary!,selected:{kind:'video',durationSeconds:5}}} as Scene;
  assert.equal(documentaryVideoCoverage([rendered]).videoSeconds,0,'Rendering a full native map into video does not turn it into moving stock footage');
});
test('assembly accepts an approved standalone route with its voice and rejects invalid or unapproved graphics',()=>{
  const {project,scene,raw}=routeFixture();
  project.settings.voice.enabled=true;
  const approved=attachRouteComparison(project,{...scene,audioPath:'voice.mp3'},validateRouteComparison(project,scene,raw,'fixture'));
  project.scenes=[approved];
  const onlyVoice=(path:string)=>path==='voice.mp3';
  assert.deepEqual(missingAssemblyInputs(project,[],onlyVoice),[]);
  assert.deepEqual(missingAssemblyInputs(project,[],()=>false),['сцена 6: озвучка']);
  const rejectedEdits:Array<(scene:Scene)=>void>=[
    edited=>{edited.documentary!.verified=false;},
    edited=>{edited.documentary!.motionGraphic!.enabled=false;},
    edited=>{edited.documentary!.motionGraphic!.routeComparison=undefined;},
    edited=>{edited.documentary!.motionGraphic!.routeComparison!.routes[0]!.points[1]!.longitude=999;},
    edited=>{edited.narration+=' Another voyage.';},
  ];
  for(const edit of rejectedEdits){
    const edited=structuredClone(approved);edit(edited);
    assert.ok(missingAssemblyInputs({...project,scenes:[edited]},[],onlyVoice).length);
  }
});
test('first assembly attempt compares map preparation against the persisted montage',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-route-queue-snapshot-'));
  assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const {project,scene,raw}=routeFixture();
  project.settings.voice.enabled=false;
  project.settings.assembly.documentary!.montage={version:1,style:'editorial',intensity:'rich',graphicsDensity:'sparse'};
  const imagePath=join(root,'saved.jpg');await writeFile(imagePath,'saved image fixture');
  const photo={id:'photo',order:6,narration:'The ship set sail.',durationSeconds:4,status:'ready',imagePath,
    documentary:{version:2,verified:true,pinned:false,layout:'full',caption:{enabled:false,text:''},effects:[],candidates:[],
      checksum:'fixture',requirement:{text:'The ship set sail.',entities:[],years:[],queries:[]},
      selected:{id:'saved-image',provider:'local',kind:'image',localPath:imagePath,width:1920,height:1080},
      visualReview:{status:'accepted',fastRelevance:{version:1,relevant:true},viewDescription:'A ship sailing.'}}} as unknown as Scene;
  project.scenes=[scene,photo];
  project.videoBrief!.readyScript+=' '+photo.narration;
  const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  scene.documentary!.requirement.aiSearchPlan!.inputHash=hash({inputHash:hash({version:1,model:'fixture',context:documentaryAiPlanContext(project)}),sceneId:scene.id});
  project.scenes[0]=attachRouteComparison(project,scene,validateRouteComparison(project,scene,raw,'fixture'));
  photo.documentary!.visualReview!.illustrationApproval=documentaryIllustrationApproval(project,photo);
  const repository=new FileProjectRepository(join(root,'projects.json'));
  const projects=new ProjectService(repository,new MockDirectorProvider());
  const storage=new LocalProjectStorage(join(root,'projects'));
  await repository.save(project);
  let calls=0;
  const events:string[]=[];
  const renderer={render:async()=>{
    calls++;
    const output=storage.finalPath(project.id);await writeFile(output,'renderer reached');return output;
  }} as unknown as StandardRenderer;
  const pipeline=new MockGenerationPipeline(new MemoryTaskRepository(),projects,storage,renderer,undefined,event=>events.push(event.message));
  await pipeline.assembleOnly(project.id);
  await pipeline.drain();
  const [task]=await pipeline.list();
  assert.equal(task?.status,'done',task?.error);
  assert.equal(task?.attempts,1);
  assert.equal(calls,1);
  assert.ok(!events.includes('queue.task.retry_scheduled'));
});
test('unmentioned place, fabricated quote, unknown coordinate, identical paths and continental shortcut are refused',()=>{
  const {project,scene,raw}=routeFixture();
  for(const mutate of [
    (v:any)=>v.routes[0].stops[1].name='Tokyo',
    (v:any)=>v.routes[0].quote='invented claim',
    (v:any)=>v.routes[0].points[1]={bend:[999,999]},
    (v:any)=>{v.routes[1]=structuredClone(v.routes[0]);},
    (v:any)=>{v.routes[0].points=[{stop:0},{stop:1},{stop:2}];},
  ]){const changed=structuredClone(raw);mutate(changed);assert.throws(()=>validateRouteComparison(project,scene,changed,'fixture'));}
});
test('editing script invalidates the accepted diagram binding',()=>{
  const {project,scene,raw}=routeFixture();const next=attachRouteComparison(project,scene,validateRouteComparison(project,scene,raw,'fixture'));project.videoBrief!.readyScript+=' Another voyage.';
  assert.match(savedRouteComparisonIssue(project,next)!,/изменился/);
});
test('a real port quotation from a later voyage cannot establish the current comparison',()=>{
  const {project,scene,raw}=routeFixture();
  scene.narration='How could the sailing ships compete?';
  project.videoBrief!.readyScript='Britain. The route around the Cape of Good Hope was longer. The Suez Canal gave ships a shortcut. How could the sailing ships compete?'
    +'\n\nThe vessel was repaired.'+'\n\nYears later a different voyage began.'+'\n\nShips sailed from London to Shanghai.';
  assert.throws(()=>validateRouteComparison(project,scene,raw,'fixture'),/цитат/);
});
test('ambiguous repeated narration never borrows the first episode geography',()=>{
  const {project,scene,raw}=routeFixture();
  project.videoBrief!.readyScript=scene.narration+'\n\nAn unrelated later journey.\n\n'+scene.narration;
  assert.throws(()=>validateRouteComparison(project,scene,raw,'fixture'),/повторяется/);
});
test('a correction may replace a distant quotation with local evidence for the unchanged place',()=>{
  const {project,scene,raw}=routeFixture(),bad=structuredClone(raw);
  const distant='London was mentioned again during a different expedition.';
  project.videoBrief!.readyScript+='\n\nAnother chapter.\n\nUnrelated context.\n\n'+distant;
  bad.routes[0]!.stops[0]!.quote=distant;
  assert.doesNotThrow(()=>assertRouteComparisonCorrection(project,scene,bad,raw));
  assert.doesNotThrow(()=>validateRouteComparison(project,scene,raw,'fixture'));
});
test('a script without paragraph separators still limits evidence to adjacent original scenes',()=>{
  const {project,scene,raw}=routeFixture();
  scene.narration='The Suez Canal gave ships a shortcut.';scene.order=0;
  project.scenes=[scene,...['The ship was repaired.','The crew returned.','Years passed.','Britain. Ships sailed from London to Shanghai. The route around the Cape of Good Hope was longer.'].map((narration,index)=>({...scene,id:'later'+index,order:index+1,narration}))];
  delete project.videoBrief!.readyScript;
  assert.throws(()=>validateRouteComparison(project,scene,raw,'fixture'),/цитат/);
  project.videoBrief!.readyScript=project.scenes.map(s=>s.narration).join(' ');
  assert.throws(()=>validateRouteComparison(project,scene,raw,'fixture'),/цитат/);
});
test('correction repairs a mismatched label and citation pair without changing valid route evidence',()=>{
  const {project,scene,raw}=routeFixture();
  const mismatched=structuredClone(raw);
  mismatched.routes[0]!.quote=raw.routes[1]!.quote;
  assert.throws(()=>validateRouteComparison(project,scene,mismatched,'fixture'),/Подпись маршрута/);
  assert.doesNotThrow(()=>assertRouteComparisonCorrection(project,scene,mismatched,raw));
  assert.doesNotThrow(()=>validateRouteComparison(project,scene,raw,'fixture'));
  const changedValidPair=structuredClone(raw);
  changedValidPair.routes[1]!.label='shortcut';
  assert.throws(()=>assertRouteComparisonCorrection(project,scene,mismatched,changedValidPair),/изменила/);
  const changedStop=structuredClone(raw);
  changedStop.routes[0]!.stops[0]!.name='Shanghai';
  assert.throws(()=>assertRouteComparisonCorrection(project,scene,mismatched,changedStop),/изменила/);
});
test('different bends around the same named intermediate stop do not establish two alternatives',()=>{
  const {project,scene,raw}=routeFixture(),value=validateRouteComparison(project,scene,raw,'fixture');
  value.routes[1]=structuredClone(value.routes[0]!);value.routes[1]!.points[1]!.longitude-=1;
  assert.throws(()=>documentaryRouteComparisonGeometry(value),/разные промежуточные именованные опоры/);
});
test('service prepares only after a settled failure, preserves provider diagnosis, and reuses a valid cached composition',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-route-comparison-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const f=routeFixture();let project=f.project,calls=0;
  const projects={get:async()=>structuredClone(project),mutate:async(_id:string,fn:any)=>{project={...project,...fn(structuredClone(project))};return structuredClone(project);}};
  const service=new DocumentaryProjectService(projects as any,{projectDirectory:()=>root} as any,{} as any,root,{} as any,()=>{}, {planRouteComparison:async()=>{calls++;return {raw:f.raw,model:'fixture'};}} as any);
  await service.prepareRouteComparisons(project.id,[]);assert.equal(calls,0);
  const ready=await service.prepareRouteComparisons(project.id,[{sceneId:f.scene.id,category:'provider-temporary',message:'Provider quota exceeded'}]);assert.equal(calls,1);assert.equal(ready.scenes[0]!.documentary!.verified,true);
  assert.deepEqual(ready.scenes[0]!.documentary!.motionGraphic!.routeComparison!.selectionFailure,{category:'provider-temporary',message:'Provider quota exceeded'});
  await service.prepareRouteComparisons(project.id,[]);assert.equal(calls,1);
});
test('resume restores a route only with a matching completed response and leaves changed routes unapproved',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-route-resume-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const {project:initial,scene,raw}=routeFixture();
  const ready=attachRouteComparison(initial,scene,validateRouteComparison(initial,scene,raw,'fixture'));
  const legacy=structuredClone(ready);
  legacy.documentary!.verified=false;
  legacy.documentary!.reviewNote='Автоматическая графика больше не соответствует текущей реплике.';
  legacy.documentary!.autoError='A subsequent stock search failed';
  let project={...initial,scenes:[legacy]};
  const projects={get:async()=>structuredClone(project),mutate:async(_id:string,fn:any)=>{project={...project,...fn(structuredClone(project))};return structuredClone(project);}};
  const unexpected=async()=>{assert.fail('Reusing the saved route must not call a provider');};
  const service=new DocumentaryProjectService(projects as any,{projectDirectory:()=>root} as any,{} as any,root,{} as any,()=>{},
    {planRouteComparison:unexpected} as any,undefined,undefined,{plan:unexpected});
  const route=ready.documentary!.motionGraphic!.routeComparison!;
  const directory=join(root,'Documentary','RouteComparisons'),analysis=join(root,'Documentary','Analysis');
  const hash=createHash('sha256').update(JSON.stringify(route)).digest('hex');
  const binding=routeComparisonRequestBinding(project,legacy),system='route response fixture';
  const input=JSON.stringify({routeComparison:1,sceneId:legacy.id,narration:legacy.narration,target:routeComparisonTarget(legacy),script:routeComparisonContext(project)});
  const file=join(analysis,documentaryCheckpointKey('semantic-montage',system,input,[])+'.json');
  const checkpoint={state:'complete',purpose:'semantic-montage',model:'fixture',result:raw};
  await mkdir(directory,{recursive:true});await mkdir(analysis,{recursive:true});
  await writeFile(join(directory,hash+'.json'),JSON.stringify({version:1,origin:'generated-route-schematic',sceneId:legacy.id,comparison:route}));
  await writeFile(join(directory,binding+'-primary-request.json'),JSON.stringify({binding,system,input}));
  const assertUnapproved=async()=>assert.equal(documentaryAutomaticMaterialReady((await service.prepareRouteComparisons(project.id,[])).scenes[0]!),false);
  await assertUnapproved();
  for(const receipt of [{...checkpoint,state:'unknown'},{...checkpoint,model:'different-model'}]){
    await writeFile(file,JSON.stringify(receipt));await assertUnapproved();
    assert.deepEqual(JSON.parse(await readFile(file,'utf8')),receipt);
  }
  await writeFile(file,JSON.stringify(checkpoint));
  const resumed=(await service.planSearch(project.id)).scenes[0]!;
  assert.equal(documentarySavedContextIssue(project,resumed),undefined);
  assert.equal(documentaryAutomaticMaterialReady(resumed),true);
  assert.deepEqual(resumed.documentary!.motionGraphic,ready.documentary!.motionGraphic);
  assert.deepEqual(resumed.documentary!.timing,ready.documentary!.timing);
  assert.equal(resumed.documentary!.autoError,undefined);
  assert.equal(resumed.documentary!.reviewNote,ready.documentary!.reviewNote);
  project={...initial,scenes:[legacy]};
  assert.equal(documentaryAutomaticMaterialReady((await service.prepareRouteComparisons(project.id,[])).scenes[0]!),true);
  project={...initial,scenes:[legacy]};
  const original=structuredClone(raw);original.routes[0]!.points=[{stop:0},{stop:1},{stop:2}];
  const correctionInput=JSON.stringify({routeComparison:1,routeComparisonCorrection:1,sceneId:legacy.id,target:routeComparisonTarget(legacy),
    script:routeComparisonContext(project),original});
  const rawHash=createHash('sha256').update(JSON.stringify(original)).digest('hex');
  await writeFile(file,JSON.stringify({...checkpoint,result:original}));
  await writeFile(join(directory,binding+'-correction-request.json'),JSON.stringify({binding,system,input:correctionInput,rawHash}));
  await writeFile(join(analysis,documentaryCheckpointKey('semantic-montage',system,correctionInput,[])+'.json'),JSON.stringify(checkpoint));
  assert.equal(documentaryAutomaticMaterialReady((await service.prepareRouteComparisons(project.id,[])).scenes[0]!),true);

  const changes:Array<(scene:Scene)=>void>=[
    changed=>{changed.narration+=' Another voyage.';},
    changed=>{changed.documentary!.motionGraphic!.routeComparison!.routes[0]!.places[1]!.name='Tokyo';},
    changed=>{changed.documentary!.motionGraphic!.routeComparison!.routes[0]!.points[1]!.longitude=999;},
    changed=>{changed.documentary!.motionGraphic!.enabled=false;},
  ];
  for(const change of changes){
    const changed=structuredClone(legacy);change(changed);
    const current={...initial,scenes:[changed]};
    assert.equal(documentaryRouteApprovalCandidate(current,changed),changed);
    changed.documentary!.verified=true;
    assert.ok(documentarySavedContextIssue(current,changed));
  }
});
test('settled content and download failures retain route recovery, unlike unfinished analysis or exhausted budget',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-route-failure-categories-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const fixture=routeFixture();let project=structuredClone(fixture.project),calls=0;
  const projects={get:async()=>structuredClone(project),mutate:async(_id:string,fn:any)=>{project={...project,...fn(structuredClone(project))};return structuredClone(project);}};
  const service=new DocumentaryProjectService(projects as any,{projectDirectory:()=>root} as any,{} as any,root,{} as any,()=>{},
    {planRouteComparison:async()=>{calls++;return {raw:fixture.raw,model:'fixture'};}} as any);
  for(const category of ['analysis','pending','unknown','budget-exhausted']){
    const result=await service.prepareRouteComparisons(project.id,[{sceneId:fixture.scene.id,category,message:'Unsettled or incomplete search'}]);
    assert.deepEqual(result.scenes,fixture.project.scenes,category);
  }
  project.scenes[0]!.documentary!.requirement.aiSearchPlan!.visualTarget='ordinary map of Europe and Asia';
  await service.prepareRouteComparisons(project.id,[{sceneId:fixture.scene.id,category:'content-rejected',message:'Wrong content'}]);
  assert.equal(calls,0,'Ineligible targets and nonterminal outcomes cannot submit a route request');
  for(const [category,message] of [['content-rejected','Checked content does not match'],['download','Source exceeded the download window']] as const){
    project=structuredClone(fixture.project);
    const ready=await service.prepareRouteComparisons(project.id,[{sceneId:fixture.scene.id,category,message}]);
    assert.equal(ready.scenes[0]!.documentary!.verified,true,category);
    assert.deepEqual(ready.scenes[0]!.documentary!.motionGraphic!.routeComparison!.selectionFailure,{category,message});
  }
  assert.equal(calls,2);
});
test('a concurrent audio/duration edit is preserved and prevents applying a stale scene snapshot',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-route-race-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const f=routeFixture();let project=f.project;
  const projects={get:async()=>structuredClone(project),mutate:async(_id:string,fn:any)=>{project={...project,...fn(structuredClone(project))};return project;}};
  const service=new DocumentaryProjectService(projects as any,{projectDirectory:()=>root} as any,{} as any,root,{} as any,()=>{}, {planRouteComparison:async()=>{project.scenes[0]={...project.scenes[0]!,audioPath:'new-user-voice.mp3',durationOverrideSeconds:9,narrationVolume:77};return {raw:f.raw,model:'fixture'};}} as any);
  await assert.rejects(service.prepareRouteComparisons(project.id,[{sceneId:f.scene.id,category:'no-results'}]),/Сцена изменена/);
  assert.equal(project.scenes[0]!.audioPath,'new-user-voice.mp3');assert.equal(project.scenes[0]!.durationOverrideSeconds,9);assert.equal(project.scenes[0]!.narrationVolume,77);
  assert.equal(project.scenes[0]!.documentary!.verified,false);
});
test('one geometry correction can repair bends but cannot change evidence or trigger a third response',async t=>{
  for(const mode of ['valid','changed-evidence','still-invalid','unknown-primary']){
    const root=await mkdtemp(join(tmpdir(),'gws-route-correct-'));t.after(()=>rm(root,{recursive:true,force:true}));
    const f=routeFixture();let project=f.project,calls=0,corrections=0;
    const bad=structuredClone(f.raw);bad.routes[0]!.points=[{stop:0},{stop:1},{stop:2}];
    const projects={get:async()=>structuredClone(project),mutate:async(_id:string,fn:any)=>{project={...project,...fn(structuredClone(project))};return project;}};
    const planner={planRouteComparison:async()=>{calls++;if(mode==='unknown-primary')throw Error('pending unknown paid response');return {raw:bad,model:'fixture'};},
      correctRouteComparison:async(_p:unknown,_s:unknown,original:unknown,error:string)=>{calls++;corrections++;assert.deepEqual(original,bad);assert.match(error,/материк/);const corrected=structuredClone(mode==='still-invalid'?bad:f.raw);if(mode==='changed-evidence')corrected.routes[0]!.quote='Changed quotation';return {raw:corrected,model:'fixture'};}};
    const service=new DocumentaryProjectService(projects as any,{projectDirectory:()=>root} as any,{} as any,root,{} as any,()=>{},planner as any);
    await service.prepareRouteComparisons(project.id,[{sceneId:f.scene.id,category:'provider-temporary',message:'quota'}]);
    assert.equal(calls,mode==='unknown-primary'?1:2);assert.equal(corrections,mode==='unknown-primary'?0:1);
    assert.equal(project.scenes[0]!.documentary!.verified,mode==='valid');
    if(mode==='changed-evidence')assert.match(project.scenes[0]!.documentary!.autoError!,/изменила именованные опоры/);
  }
});
test('the correction commission keeps exact request identity if validation wording changes on resume',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-route-identity-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const {project,scene,raw}=routeFixture(),requests:string[]=[];
  const intelligence=new DocumentaryIntelligence({documentaryMontageModel:async()=> 'fixture'} as any,()=>root);
  (intelligence as any).complete=async(_id:string,_purpose:string,system:string,input:string)=>{requests.push(system+'\n'+input);return raw;};
  await intelligence.correctRouteComparison(project,scene,raw,'first exact geometry error');
  await intelligence.correctRouteComparison(project,scene,raw,'changed error wording');
  assert.equal(requests[0],requests[1],'Existing completion receipt must see the same key, not a new paid correction');
});

test('a China quotation never establishes Shanghai; correction preserves stops and already valid evidence',()=>{
  const {project,scene,raw}=routeFixture();
  const china='On the China route, sailing ships had to travel around the southern end of Africa.';
  project.videoBrief!.readyScript+=' '+china+' A different ship visited Sydney.';
  scene.narration+=' '+china;
  const bad=JSON.parse(JSON.stringify(raw));bad.routes[0]!.stops[2]!.quote=china;
  assert.throws(()=>validateRouteComparison(project,scene,bad,'fixture'),/Shanghai.*не названо/);
  assertRouteComparisonCorrection(project,scene,bad,raw);
  assert.ok(validateRouteComparison(project,scene,raw,'fixture'));
  for(const change of [
    (v:any)=>{v.routes[0].stops[2]={name:'Sydney',country:'Australia',quote:'A different ship visited Sydney.'};},
    (v:any)=>{v.routes[1].stops[2].quote=china;},
    (v:any)=>{v.routes[0].quote=china;},
  ]){
    const changed=structuredClone(raw);change(changed);
    assert.throws(()=>assertRouteComparisonCorrection(project,scene,bad,changed),/изменила именованные опоры/);
  }
});

test('one source/geometry correction reuses complete paid receipts and restores approval after restart',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-route-quote-restart-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const f=routeFixture(),bad=JSON.parse(JSON.stringify(f.raw));
  const china='On the China route, sailing ships had to travel around the southern end of Africa.';
  f.project.videoBrief!.readyScript+=' '+china;
  // Rebind the fixture search plan after the script edit, as ordinary planning does.
  const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
  f.scene.documentary!.requirement.aiSearchPlan!.inputHash=hash({inputHash:hash({version:1,model:'fixture',context:documentaryAiPlanContext(f.project)}),sceneId:f.scene.id});
  bad.routes[0]!.stops[2]!.quote=china;
  bad.routes[1]!.label='not in the script';
  bad.routes[0]!.points=[{stop:0},{stop:2}];
  let posts=0,project=f.project;
  const client={documentaryMotionModel:async()=> 'fixture',configured:async()=>true,documentaryCompletion:async()=>JSON.stringify(++posts===1?bad:f.raw)};
  const projects={get:async()=>structuredClone(project),mutate:async(_id:string,fn:any)=>{project={...project,...fn(structuredClone(project))};return structuredClone(project);}};
  const service=()=>new DocumentaryProjectService(projects as any,{projectDirectory:()=>root} as any,{} as any,root,{} as any,()=>{},new DocumentaryIntelligence(client as any,()=>root) as any);
  const failures=[{sceneId:f.scene.id,category:'content-rejected',message:'No comparison found'}];
  await service().prepareRouteComparisons(project.id,failures);
  assert.equal(project.scenes[0]!.documentary!.verified,true);
  assert.equal(posts,2,'One primary and one combined correction');
  assert.equal(await hasCompletedRouteComparison(root,project,project.scenes[0]!),true);
  // Rebuilding from the initial scene replays both receipts, without another POST.
  project=structuredClone(f.project);project.scenes=[structuredClone(f.scene)];
  await service().prepareRouteComparisons(project.id,failures);
  assert.equal(project.scenes[0]!.documentary!.verified,true);assert.equal(posts,2);
  project.scenes[0]!.documentary!.verified=false;
  project.scenes[0]!.documentary!.reviewNote='Автоматическая графика больше не соответствует текущей реплике.';
  project.scenes[0]!.documentary!.autoError='A later search changed approval';
  await service().prepareRouteComparisons(project.id,[]);
  assert.equal(project.scenes[0]!.documentary!.verified,true);assert.equal(posts,2);
});
test('a failed primary route request is listed for explicit recovery and submits once after authorization',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-route-primary-retry-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const {project,scene,raw}=routeFixture();let posts=0;
  const intelligence=new DocumentaryIntelligence({documentaryMontageModel:async()=> 'fixture',configured:async()=>true,
    documentaryCompletion:async()=>{posts++;if(posts===1)throw new AnyModelProviderResponseError('HTTP 503',503);return JSON.stringify(raw);}} as any,()=>root);
  const run=()=>intelligence.planRouteComparison(project,scene);
  await assert.rejects(run(),/HTTP 503/);assert.equal(posts,1);
  await assert.rejects(run(),/повтор.*отключён/);assert.equal(posts,1,'A definite failure still cannot repeat without permission');
  const items=await listDocumentaryRecovery(root);assert.equal(items.length,1);assert.equal(items[0]!.state,'failed');
  await new DocumentaryRetryPermissions().authorize(root,items);
  assert.deepEqual((await run()).raw,raw);assert.equal(posts,2);
  assert.deepEqual((await run()).raw,raw);assert.equal(posts,2,'The completed recovery is reused locally');
  const authorization=JSON.parse(await readFile(join(root,'Documentary','Analysis',items[0]!.id+'.retry-authorization.json'),'utf8'));
  assert.ok(authorization.consumedAt);
});

test('existing failed, pending and partial correction receipts refuse a third POST on resume',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-route-no-third-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const fixture=routeFixture(),{scene}=fixture,bad=structuredClone(fixture.raw);bad.routes[0]!.points=[{stop:0},{stop:1},{stop:2}];
  const requests:Array<{system:string;input:string}>=[];
  const capture=new DocumentaryIntelligence({documentaryMontageModel:async()=> 'fixture'} as any,()=>root);
  (capture as any).complete=async(_id:string,_purpose:string,system:string,input:string)=>{requests.push({system,input});return bad;};
  await capture.planRouteComparison(fixture.project,scene);
  await capture.correctRouteComparison(fixture.project,scene,bad,'original geometry failure');
  const directory=join(root,'Documentary','Analysis');await mkdir(directory,{recursive:true});
  const key=documentaryCheckpointKey('semantic-montage',requests[1]!.system,requests[1]!.input,[]);
  const primaryKey=documentaryCheckpointKey('semantic-montage',requests[0]!.system,requests[0]!.input,[]);
  await writeFile(join(directory,primaryKey+'.json'),JSON.stringify({state:'complete',purpose:'semantic-montage',model:'fixture',result:bad}));
  for(const state of ['failed','pending','partial']){
    await writeFile(join(directory,key+'.json'),JSON.stringify({state,purpose:'semantic-montage',model:'fixture',raw:state==='partial'?'partial stream':undefined,error:state==='failed'?'[no-retry] HTTP 503':undefined,createdAt:new Date().toISOString()}));
    let posts=0;const client={documentaryMontageModel:async()=> 'fixture',configured:async()=>true,documentaryCompletion:async()=>{posts++;throw Error('Unexpected third POST');}};
    const resumed=new DocumentaryIntelligence(client as any,()=>root);let project=structuredClone(fixture.project);
    const projects={get:async()=>structuredClone(project),mutate:async(_id:string,fn:any)=>{project={...project,...fn(structuredClone(project))};return project;}};
    const service=new DocumentaryProjectService(projects as any,{projectDirectory:()=>root} as any,{} as any,root,{} as any,()=>{},resumed as any);
    for(let repeat=0;repeat<2;repeat++){
      await service.prepareRouteComparisons(project.id,[{sceneId:scene.id,category:'provider-temporary',message:'quota'}]);
      assert.equal(project.scenes[0]!.documentary!.verified,false);
      assert.match(project.scenes[0]!.documentary!.autoError!,/HTTP 503|незавершённый|повторный POST/);
    }
    assert.equal(posts,0,`${state} receipt must stop before the client boundary`);
  }
  // A settled correction failure must be authorizable through the public recovery listing.
  await writeFile(join(directory,key+'.json'),JSON.stringify({state:'failed',purpose:'semantic-montage',error:'[no-retry] HTTP 503',createdAt:new Date().toISOString()}));
  const failed=await listDocumentaryRecovery(root);assert.equal(failed.length,1);assert.equal(failed[0]!.state,'failed');
  await new DocumentaryRetryPermissions().authorize(root,failed);
  let approvedPosts=0;
  const approved=new DocumentaryIntelligence({documentaryMontageModel:async()=> 'fixture',configured:async()=>true,documentaryCompletion:async()=>{approvedPosts++;return JSON.stringify(fixture.raw);}} as any,()=>root);
  let project=structuredClone(fixture.project);
  const projects={get:async()=>structuredClone(project),mutate:async(_id:string,fn:any)=>{project={...project,...fn(structuredClone(project))};return project;}};
  const service=new DocumentaryProjectService(projects as any,{projectDirectory:()=>root} as any,{} as any,root,{} as any,()=>{},approved as any);
  await service.prepareRouteComparisons(project.id,[{sceneId:scene.id,category:'provider-temporary',message:'quota'}]);
  assert.equal(approvedPosts,1,'Explicit revision-bound authorization allows one recovery beyond the automatic budget');
  assert.equal(project.scenes[0]!.documentary!.verified,true);
  const authorization=JSON.parse(await readFile(join(directory,key+'.retry-authorization.json'),'utf8'));
  assert.ok(authorization.consumedAt);
  await writeFile(join(directory,key+'.json'),JSON.stringify({state:'failed',purpose:'semantic-montage',approvedRetryAt:authorization.approvedAt,previousRevision:authorization.replacesRevision,error:'HTTP 503'}));
  const consumed=new DocumentaryIntelligence({documentaryMontageModel:async()=> 'fixture',documentaryCompletion:async()=>{approvedPosts++;throw Error('consumed approval must not post');}} as any,()=>root);
  await assert.rejects(consumed.correctRouteComparison(fixture.project,scene,bad,'same error'));
  assert.equal(approvedPosts,1,'A consumed approval cannot silently release another attempt');
});
test('route construction and correction use Motion model while ordinary semantic montage keeps its model',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-route-model-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const {project,scene,raw}=routeFixture(),models:string[]=[];
  const client={configured:async()=>true,documentaryMotionModel:async()=> 'cc/claude-opus-5-5',documentaryMontageModel:async()=> 'ag/claude-sonnet-4-6',
    documentaryCompletion:async(...args:any[])=>{models.push(args[5]);return JSON.stringify(raw);}};
  const intelligence=new DocumentaryIntelligence(client as any,()=>root);
  const planned=await intelligence.planRouteComparison(project,scene);assert.equal(planned.model,'cc/claude-opus-5-5');
  const corrected=await intelligence.correctRouteComparison(project,scene,raw,'fixture error');assert.equal(corrected.model,'cc/claude-opus-5-5');
  await (intelligence as any).complete(project.id,'semantic-montage','ordinary montage system',JSON.stringify({ordinaryMontage:true}));
  assert.deepEqual(models,['cc/claude-opus-5-5','cc/claude-opus-5-5','ag/claude-sonnet-4-6']);
  const directory=join(root,'Documentary','Analysis'),names=await readdir(directory);
  const receipts=await Promise.all(names.filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).map(async n=>({name:n,value:JSON.parse(await readFile(join(directory,n),'utf8'))})));
  assert.equal(receipts.filter(r=>r.value.model==='cc/claude-opus-5-5').length,2);
  // A prior model's completed answer stays truthful after routing changes.
  for(const receipt of receipts.filter(r=>r.value.model==='cc/claude-opus-5-5'))await writeFile(join(directory,receipt.name),JSON.stringify({...receipt.value,model:'old-cached-sonnet'}));
  const cached=await intelligence.planRouteComparison(project,scene);assert.equal(cached.model,'old-cached-sonnet');assert.equal(models.length,3);
});
