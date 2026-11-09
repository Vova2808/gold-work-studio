import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {createVoiceCalibration,documentaryManualReviewReady,documentaryMaterialUsable,type DocumentaryCandidate,type Project,type Scene} from '@gold-work/shared';
import {documentaryAutomaticMaterialReady} from './documentary-auto-readiness.js';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {DocumentarySearch} from './documentary-search.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {prepareDocumentaryScript} from './documentary-plan.js';
import {prepareDocumentaryProduction,DocumentarySelectionIncompleteError} from './documentary-production.js';
import {DocumentaryAnalysisError} from './documentary-analysis-error.js';
import {assertDocumentaryAutoExport} from './documentary-workflow.js';
import {missingAssemblyInputs} from './assembly-readiness.js';
import {documentaryIllustrationApproval,documentarySavedContextIssue} from './documentary-context-approval.js';
import {planFastDocumentaryScene} from './documentary-fast-plan.js';
import {applyDocumentaryNativeFallback,documentaryNativeFallbackReady} from './documentary-native-fallback.js';
import {documentaryAiPlanContext,currentDocumentaryAiSearchPlan} from './documentary-ai-plan-state.js';

const pendingNumbers=[5,17,21,23,26,30,32,34,35,36,37,38,40,45,47,48,50,55,63];
const failedNumbers=[7,13,25,31,33,41,42,49,57];
const uncertainNumbers=[45,48,55];
const oldChecksum='a'.repeat(64),newChecksum='b'.repeat(64);

async function fixture(t:test.TestContext,status:'pending'|'uncertain'='pending'){
  const root=await mkdtemp(join(tmpdir(),'gws-auto-readiness-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
  let project=await projects.create({title:'Ships',topic:'Sailing ships',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
  project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:'The ship sails on the sea.'};
  project.settings.voice.enabled=false;project.settings.stockVideoPercent=0;
  project.settings.assembly.documentary!.autoMotionGraphics=false;project.settings.assembly.documentary!.autoEffects=false;
  const scene=prepareDocumentaryScript(project,createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:project.videoBrief.readyScript!,audioDurationSeconds:4}))[0]!;
  scene.audioPath='existing-paid-voice.wav';scene.documentary!.selectionPlan={kind:'image',videoPercent:0};
  scene.documentary!.requirement={text:scene.narration,entities:[],identities:[],years:[],queries:['sailing ship'],detail:'sailing ship at sea',preferredKind:'image'};
  const oldPath=join(root,`${oldChecksum}.jpg`),newPath=join(root,`${newChecksum}.jpg`),receipt=join(root,'unknown-receipt.json');
  await writeFile(oldPath,'old immutable fixture');await writeFile(newPath,'new immutable fixture');await writeFile(receipt,'{"state":"unknown","requestId":"existing"}');
  const old:DocumentaryCandidate={id:'old-source',provider:'commons',kind:'image',title:'Ship at sea',description:'',localPath:oldPath,
    pageUrl:'https://example.test/old',downloadUrl:'https://example.test/old.jpg',author:'fixture',license:'fixture',licenseUrl:'',rights:'licensed',attribution:'fixture',
    width:1600,height:900,query:'sailing ship',retrievedAt:'now',match:'unverified',concerns:[]};
  scene.imagePath=oldPath;
  scene.documentary={...scene.documentary!,selected:old,checksum:oldChecksum,verified:false,pinned:false,
    manualReview:{version:1,status:'pending',provider:old.provider,kind:'image',candidateId:old.id,checksum:oldChecksum,mediaPath:oldPath,narration:scene.narration,reason:'Saved fallback',
      analysis:{status,reason:status==='pending'?'Previous paid response is unknown':'Visible identity remains uncertain'}},
    visualReview:status==='uncertain'?{status:'uncertain',confidence:0,reason:'Visible identity remains uncertain',quality:'',sampleSeconds:[],checkedAt:'now'}:undefined};
  project=await projects.mutate(project.id,()=>({...project,scenes:[scene],status:'draft'}));
  const next={...old,id:'new-source',localPath:undefined,pageUrl:'https://example.test/new',downloadUrl:'https://example.test/new.jpg'};
  const alias={...old,id:`local:${oldChecksum}`,provider:'local' as const};
  return {root,projects,project,scene,old,next,alias,oldPath,newPath,receipt};
}

async function approvedFixtureReview(project:Project,scene:Scene){
  const info=await stat(scene.imagePath!,{bigint:true}),target=planFastDocumentaryScene(project,scene).visualTarget;
  const review:NonNullable<Scene['documentary']>['visualReview']={status:'accepted',confidence:1,reason:'Mock pixel review; orchestration evidence only',quality:'',sampleSeconds:[],checkedAt:'now',
    viewDescription:'Fixture image of a sailing ship',fastRelevance:{version:1,target,relevant:true,evidence:'Mock visible ship for orchestration'},
    illustrationQualityVersion:1,targetVisibility:{version:1,target,visible:true,evidence:'Fixture visible subject'},sourceText:{version:1,kind:'none',text:''},
    localReview:{version:1,size:String(info.size),mtimeNs:String(info.mtimeNs),ctimeNs:String(info.ctimeNs)}};
  review.illustrationApproval=documentaryIllustrationApproval(project,{...scene,documentary:{...scene.documentary!,visualReview:review}});
  return review;
}

async function plannedRecoveryFixture(t:test.TestContext,scope:'illustrative'|'exact'='illustrative'){
  const f=await fixture(t),narration='Captain George Moodie chose to continue.';
  const subject='Captain George Moodie, Cutty Sark',target='Preserved Cutty Sark at Greenwich, illustrating the ship under Captain Moodie';
  const scene=structuredClone(f.scene);scene.narration=narration;scene.documentary!.selectionPlan={kind:'video',videoPercent:60};
  scene.documentary!.manualReview!.narration=narration;
  scene.documentary!.requirement={text:narration,entities:[subject],identities:[{name:subject,aliases:[]}],years:[],
    queries:['Cutty Sark clipper ship'],detail:target,preferredKind:'image',visualScope:scope,
    aiSearchPlan:{version:1,inputHash:'',model:'fixture',subject,visualTarget:target,years:[],visualScope:scope,preferredKind:'image',
      imageQueries:['Cutty Sark clipper ship'],videoQueries:['Cutty Sark preserved ship'],fallbackVideoQueries:[],fallbackVisualTarget:''}};
  const donors=await Promise.all([1,2,3].map(async number=>{
    const donor=structuredClone(f.scene),checksum=String(number).repeat(64),file=join(f.root,`${checksum}.jpg`);await writeFile(file,`donor-${number}`);
    donor.id=`donor-${number}`;donor.order=number;
    const source={...f.next,id:`donor-${number}`,title:number===3?'Steamship on a river':'Preserved Cutty Sark ship',kind:number===3?'video' as const:'image' as const,
      pageUrl:`https://example.test/donor-${number}`,downloadUrl:`https://example.test/donor-${number}`,localPath:file,durationSeconds:30};
    donor.documentary={...donor.documentary!,selected:source,checksum,verified:true,manualReview:undefined,visualReview:undefined};
    donor.imagePath=number===3?undefined:file;donor.videoPath=number===3?file:undefined;
    return donor;
  }));
  await f.projects.mutate(f.project.id,current=>{
    const project={...current,videoBrief:{...current.videoBrief!,readyScript:narration},scenes:[scene,...donors]};
    const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const inputHash=hash({version:1,model:'fixture',context:documentaryAiPlanContext(project)});
    scene.documentary!.requirement.aiSearchPlan!.inputHash=hash({inputHash,sceneId:scene.id});
    return project;
  });
  const project=(await f.projects.get(f.project.id))!;
  assert.ok(currentDocumentaryAiSearchPlan(project,project.scenes[0]!));
  return {...f,project,scene:project.scenes[0]!,donors};
}

for(const outcome of ['accepted','uncertain'] as const)test(`automatic planned-photo recovery ${outcome}: current target, per-recipient review and one shared budget`,async t=>{
  const f=await plannedRecoveryFixture(t),before=structuredClone(f.scene.documentary!.requirement);
  const remote=[4,5].map(n=>({...f.next,id:`remote-${n}`,title:'Preserved Cutty Sark ship',pageUrl:`https://example.test/remote-${n}`,downloadUrl:`https://example.test/remote-${n}`}));
  let searches=0,elapsed=0;const realNow=Date.now;t.mock.method(Date,'now',()=>realNow()+elapsed);
  type Budget={remaining:()=>number;submit:()=>void;beforeSubmit?:()=>Promise<void>};let budget:Budget|undefined;
  const prepared:string[]=[],reviews:Array<{id:string;remaining:number}>=[];
  const search=new DocumentarySearch();search.search=async()=>{searches++;return {candidates:remote,sources:[]};};
  const service=new DocumentaryProjectService(f.projects,new LocalProjectStorage(join(f.root,'projects')),search,join(f.root,'materials'),
    {download:async()=>assert.fail('No network in recovery fixture')},()=>{},
    {simpleSelection:true,available:async()=>true,plan:async()=>new Map(),inspect:async()=>assert.fail('Use bounded inspection'),
      withSelectionBudget:async<T>(value:Budget,work:()=>Promise<T>)=>{const prior=budget;budget=value;try{return await work();}finally{budget=prior;}},
      inspectForSelection:async(project,scene,_progress,_stop,cacheOnly)=>{
        if(cacheOnly)throw new DocumentaryAnalysisError('Old paid request still pending','pending');
        assert.equal(scene.id,f.scene.id,'Donor approval is not transferred');assert.ok(budget);
        await budget.beforeSubmit?.();budget.submit();reviews.push({id:scene.documentary!.selected!.id,remaining:budget.remaining()});
        if(outcome==='accepted')return {review:await approvedFixtureReview(project,scene),usedNewAnalysis:true};
        elapsed+=reviews.length===1?70_000:10_000;
        return {review:{status:'uncertain',confidence:0,reason:'New recipient target remains uncertain',quality:'',sampleSeconds:[],checkedAt:'now'},usedNewAnalysis:true};
      }});
  Reflect.set(service,'selectionResources',async()=>({workers:1}));service.localCandidates=async()=>[];
  Reflect.set(service,'apply',async(id:string,sceneId:string,source:DocumentaryCandidate)=>{
    assert.equal(source.kind,'image');assert.notEqual(source.id,'donor-3');prepared.push(source.id);
    const checksum=source.id.slice(-1).repeat(64),file=join(f.root,`${checksum}.jpg`);if(!source.localPath)await writeFile(file,source.id);
    const project=(await f.projects.get(id))!;return {...project,scenes:project.scenes.map(scene=>scene.id===sceneId?{...scene,imagePath:file,videoPath:undefined,
      documentary:{...scene.documentary!,selected:{...source,localPath:file},checksum}}:scene)};
  });
  const project=await service.completeWithNativeFallback(f.project.id,undefined,undefined,true),scene=project.scenes[0]!;
  assert.deepEqual(scene.documentary!.requirement,before,'Only discovery hints are projected');
  assert.equal(await readFile(f.receipt,'utf8'),'{"state":"unknown","requestId":"existing"}');
  if(outcome==='accepted'){
    assert.equal(prepared.length,1);assert.match(prepared[0]!,/^donor-[12]$/);assert.equal(reviews.length,1);assert.equal(searches,0);
    assert.equal(scene.documentary!.selectionPlan!.kind,'image');assert.equal(documentaryAutomaticMaterialReady(scene),true);
  }else{
    assert.equal(prepared.length,3);assert.deepEqual(new Set(prepared.slice(0,2)),new Set(['donor-1','donor-2']));assert.equal(prepared[2],'remote-4');
    assert.equal(reviews.length,3);assert.ok(reviews[1]!.remaining<=20_000);assert.ok(reviews[2]!.remaining<=10_000);
    assert.equal(documentaryAutomaticMaterialReady(scene),false);assert.ok(searches>0);
  }
});

test('exact and manual recovery do not substitute the illustrative planned-photo lane',async t=>{
  for(const mode of ['exact','manual'] as const){
    const f=await plannedRecoveryFixture(t,mode==='exact'?'exact':'illustrative');const preparedKinds:string[]=[];let fresh=0;
    const search=new DocumentarySearch();search.search=async()=>({candidates:[],sources:[]});
    const service=new DocumentaryProjectService(f.projects,new LocalProjectStorage(join(f.root,'projects')),search,join(f.root,'materials'),
      {download:async()=>assert.fail('No network')},()=>{},
      {simpleSelection:true,available:async()=>true,plan:async()=>new Map(),inspect:async()=>assert.fail('No new inspection'),
        inspectForSelection:async(_p,_s,_progress,_stop,cacheOnly)=>{if(!cacheOnly)fresh++;throw new DocumentaryAnalysisError('Existing paid request pending','pending');}});
    Reflect.set(service,'selectionResources',async()=>({workers:1}));Reflect.set(service,'apply',async(_id:string,_sceneId:string,source:DocumentaryCandidate)=>{preparedKinds.push(source.kind);throw Error('No prepared fixture for legacy video lane');});
    const project=await service.completeWithNativeFallback(f.project.id,undefined,undefined,mode==='exact');
    if(mode==='exact')assert.deepEqual(preparedKinds,[]);
    else assert.ok(preparedKinds.every(kind=>kind==='video'),'Manual/default retains its original video donor lane');
    assert.equal(fresh,0,mode);assert.equal(documentaryAutomaticMaterialReady(project.scenes[0]!),false);
    assert.equal(await readFile(f.receipt,'utf8'),'{"state":"unknown","requestId":"existing"}');
  }
});

test('the actual terminal shape counts 35 approved and all 28 unfinished, retaining 19 editable manual sources',async t=>{
  const f=await fixture(t);
  const scenes=Array.from({length:63},(_,order)=>{
    const scene=structuredClone(f.scene);scene.id=`scene-${order+1}`;scene.order=order;
    if(pendingNumbers.includes(order+1)){
      const status=uncertainNumbers.includes(order+1)?'uncertain':'pending';scene.documentary!.manualReview!.analysis={status,reason:status};
    }else if(failedNumbers.includes(order+1)){
      scene.documentary!.manualReview=undefined;scene.documentary!.visualReview={status:'rejected',reason:'Different subject',confidence:0,quality:'',sampleSeconds:[],checkedAt:'now'};
    }else{scene.documentary!.verified=true;scene.documentary!.manualReview=undefined;}
    return scene;
  });
  const project={...f.project,scenes};
  assert.equal(scenes.filter(documentaryAutomaticMaterialReady).length,35);
  assert.equal(scenes.filter(scene=>documentaryMaterialUsable(scene)).length,54);
  assert.deepEqual(scenes.filter(scene=>documentaryManualReviewReady(scene)).map(scene=>scene.order+1),pendingNumbers);
  assert.deepEqual(missingAssemblyInputs({...project,scenes:scenes.filter(scene=>documentaryManualReviewReady(scene))}),[],'Manual editing/export semantics stay unchanged');
  let montage=0;
  await assert.rejects(prepareDocumentaryProduction(project.id,{projects:{get:async()=>project,update:async()=>project},signal:new AbortController().signal,startNarration:async()=>async()=>{},
    documentary:{planSearch:async()=>project,
      autoSelect:async()=>({project,total:63,selected:35,skipped:19,failed:9,failures:failedNumbers.map(sceneNumber=>({sceneId:`scene-${sceneNumber}`,sceneNumber,category:'provider-temporary' as const,message:'Earlier provider error'}))}),
      completeWithVideoQuota:async()=>assert.fail('Incomplete scenes must stop before quota work'),
      prepareMontage:async()=>{montage++;return project;}}}),error=>error instanceof DocumentarySelectionIncompleteError
        &&/для 28 сцен/.test(error.message)&&/ручной проверки: 19/.test(error.message)&&/16 без завершённого результата/.test(error.message)&&!/источники временно/.test(error.message));
  assert.equal(montage,0);assert.throws(()=>assertDocumentaryAutoExport(project),/№5/);
});

test('verified native scenes and pinned approvals remain automatically ready',async t=>{
  const f=await fixture(t),project=structuredClone(f.project);project.settings.assembly.documentary!.autoMotionGraphics=true;
  const original={...f.scene,imagePath:undefined,documentary:{...f.scene.documentary!,selected:undefined,checksum:undefined,manualReview:undefined,visualReview:undefined,autoError:'No source'}};
  const native=applyDocumentaryNativeFallback(project,original);
  assert.equal(documentaryNativeFallbackReady(project,native),true);assert.equal(documentaryAutomaticMaterialReady(native),true);
  assert.equal(documentaryAutomaticMaterialReady({...f.scene,documentary:{...f.scene.documentary!,verified:true,pinned:true}}),true);
});

for(const route of ['ordinary','fallback'] as const)for(const status of ['pending','uncertain'] as const)
test(`${route} automatic resume replaces ${status} with a different approved candidate without reposting old pixels`,async t=>{
  const f=await fixture(t,status),prepared:string[]=[],posts:string[]=[],cache:string[]=[];
  const search=new DocumentarySearch();let searches=0;
  search.search=async()=>{searches++;return {candidates:[f.old,f.alias,f.next],sources:[]};};
  const service=new DocumentaryProjectService(f.projects,new LocalProjectStorage(join(f.root,'projects')),search,join(f.root,'materials'),
    {download:async()=>{throw Error('No network in orchestration test');}},()=>{},
    {simpleSelection:true,available:async()=>true,plan:async()=>new Map(),inspect:async()=>{throw Error('Use inspectForSelection');},
      inspectForSelection:async(project,scene,_progress,_stop,cacheOnly)=>{
        const source=scene.documentary!.selected!;
        if(source.id!==f.next.id){assert.equal(cacheOnly,true,'Unknown same-frame review may only read a receipt');cache.push(source.id);throw new DocumentaryAnalysisError('Existing request outcome unknown','pending');}
        assert.ok(!cacheOnly);posts.push(source.id);
        return {review:await approvedFixtureReview(project,scene),usedNewAnalysis:true};
      }});
  service.localCandidates=async()=>[f.alias];Reflect.set(service,'selectionResources',async()=>({workers:1}));
  Reflect.set(service,'apply',async(id:string,sceneId:string,source:DocumentaryCandidate)=>{
    prepared.push(source.id);assert.equal(source.id,f.next.id,'The unresolved provider and library aliases are excluded before preparation');
    const project=(await f.projects.get(id))!;return {...project,scenes:project.scenes.map(scene=>scene.id===sceneId?{...scene,imagePath:f.newPath,
      documentary:{...scene.documentary!,selected:{...source,localPath:f.newPath},checksum:newChecksum}}:scene)};
  });
  const project=route==='ordinary'?(await service.autoSelect(f.project.id)).project:await service.completeWithNativeFallback(f.project.id,undefined,undefined,true);
  assert.ok(searches>0);assert.deepEqual(prepared,[f.next.id]);assert.deepEqual(posts,[f.next.id]);
  if(status==='pending')assert.ok(cache.length>0);else assert.equal(cache.length,0);
  assert.equal(documentaryAutomaticMaterialReady(project.scenes[0]!),true,JSON.stringify({review:project.scenes[0]!.documentary!.visualReview,
    manual:project.scenes[0]!.documentary!.manualReview,issue:documentarySavedContextIssue(project,{...project.scenes[0]!,documentary:{...project.scenes[0]!.documentary!,verified:true}})}));
  assert.equal(project.scenes[0]!.documentary!.manualReview,undefined);
  assert.equal(project.scenes[0]!.audioPath,'existing-paid-voice.wav');assert.equal(await readFile(f.receipt,'utf8'),'{"state":"unknown","requestId":"existing"}');
  assert.doesNotThrow(()=>assertDocumentaryAutoExport(project));
});

for(const route of ['ordinary','fallback'] as const)test(`${route} recovers a completed receipt cache-only before looking for another source`,async t=>{
  const f=await fixture(t);let cache=0;
  const service=new DocumentaryProjectService(f.projects,new LocalProjectStorage(join(f.root,'projects')),
    {search:async()=>assert.fail('Recovered receipt needs no discovery')} as unknown as DocumentarySearch,join(f.root,'materials'),
    {download:async()=>assert.fail('Recovered receipt needs no download')},()=>{},
    {simpleSelection:true,available:async()=>true,plan:async()=>new Map(),inspect:async()=>assert.fail('No new inspection'),
      inspectForSelection:async(project,scene,_progress,_stop,cacheOnly)=>{assert.equal(cacheOnly,true);cache++;return {review:await approvedFixtureReview(project,scene),usedNewAnalysis:false};}});
  Reflect.set(service,'selectionResources',async()=>({workers:1}));
  const project=route==='ordinary'?(await service.autoSelect(f.project.id)).project:await service.completeWithNativeFallback(f.project.id,undefined,undefined,true);
  assert.equal(cache,1);assert.equal(documentaryAutomaticMaterialReady(project.scenes[0]!),true);
  assert.equal(await readFile(f.receipt,'utf8'),'{"state":"unknown","requestId":"existing"}');
});

test('automatic recovery shares the saved source first-review deadline with later candidates',async t=>{
  const f=await fixture(t);
  await f.projects.mutate(f.project.id,current=>({scenes:current.scenes.map(scene=>({...scene,
    documentary:{...scene.documentary!,manualReview:{...scene.documentary!.manualReview!,analysis:undefined}}}))}));
  const candidates=[1,2,3].map(index=>({...f.next,id:`new-${index}`,pageUrl:`https://example.test/new-${index}`,
    downloadUrl:`https://example.test/new-${index}.jpg`}));
  const realNow=Date.now;let elapsed=0;
  t.mock.method(Date,'now',()=>realNow()+elapsed);
  type Budget={remaining:()=>number;submit:()=>void;beforeSubmit?:()=>Promise<void>};
  let activeBudget:Budget|undefined;
  const observations:Array<{source:string;remaining:number;elapsed:number}>=[],prepared:string[]=[];
  const search=new DocumentarySearch();search.search=async()=>({candidates,sources:[]});
  const service=new DocumentaryProjectService(f.projects,new LocalProjectStorage(join(f.root,'projects')),search,join(f.root,'materials'),
    {download:async()=>assert.fail('No network in the deadline regression')},()=>{},
    {simpleSelection:true,available:async()=>true,plan:async()=>new Map(),inspect:async()=>assert.fail('Use bounded inspection'),
      withSelectionBudget:async<T>(budget:Budget,work:()=>Promise<T>)=>{
        const previous=activeBudget;activeBudget=budget;try{return await work();}finally{activeBudget=previous;}
      },
      inspectForSelection:async(_project,scene,_progress,_stop,cacheOnly)=>{
        assert.equal(cacheOnly,false);assert.ok(activeBudget);
        await activeBudget.beforeSubmit?.();activeBudget.submit();
        const source=scene.documentary!.selected!.id;
        observations.push({source,remaining:activeBudget.remaining(),elapsed});
        elapsed+=source===f.old.id?70_000:10_000;
        return {review:{status:'uncertain',confidence:0,reason:'Fixture unresolved identity',quality:'',sampleSeconds:[],checkedAt:'now'},usedNewAnalysis:true};
      }});
  service.localCandidates=async()=>[];Reflect.set(service,'selectionResources',async()=>({workers:1}));
  Reflect.set(service,'apply',async(id:string,sceneId:string,source:DocumentaryCandidate)=>{
    prepared.push(source.id);
    const checksum=source.id.slice(-1).repeat(64),localPath=join(f.root,`${checksum}.jpg`);await writeFile(localPath,source.id);
    const project=(await f.projects.get(id))!;return {...project,scenes:project.scenes.map(scene=>scene.id===sceneId?{...scene,imagePath:localPath,
      documentary:{...scene.documentary!,selected:{...source,localPath},checksum}}:scene)};
  });
  const project=await service.completeWithNativeFallback(f.project.id,undefined,undefined,true);
  assert.ok(observations[1]!.remaining>0&&observations[1]!.remaining<=20_000,JSON.stringify(observations));
  assert.deepEqual(observations.map(item=>item.source),[f.old.id,'new-1','new-2'],'No review starts after the shared 90-second deadline');
  assert.ok(observations.every(item=>item.elapsed<90_000&&item.remaining>0));
  assert.deepEqual(prepared,['new-1','new-2']);assert.equal(elapsed,90_000);
  assert.equal(documentaryAutomaticMaterialReady(project.scenes[0]!),false);
  assert.equal(await readFile(f.receipt,'utf8'),'{"state":"unknown","requestId":"existing"}');
});

test('all nineteen saved pending/uncertain scenes remain unfinished without alternatives, are not skipped or reposted, and stay editable',async t=>{
  const f=await fixture(t);let searches=0,posts=0;const progress:Array<{failed:number;selected:number}>=[];
  await f.projects.mutate(f.project.id,()=>({scenes:pendingNumbers.map(number=>{
    const scene=structuredClone(f.scene);scene.id=`scene-${number}`;scene.order=number-1;
    if(uncertainNumbers.includes(number)){
      scene.documentary!.manualReview!.analysis={status:'uncertain',reason:'Identity unresolved'};
      scene.documentary!.visualReview={status:'uncertain',confidence:0,reason:'Identity unresolved',quality:'',sampleSeconds:[],checkedAt:'now'};
    }
    return scene;
  })}));
  const search=new DocumentarySearch();search.search=async()=>{searches++;return {candidates:[f.old,f.alias],sources:[]};};
  const service=new DocumentaryProjectService(f.projects,new LocalProjectStorage(join(f.root,'projects')),search,join(f.root,'materials'),
    {download:async()=>{throw Error('Unknown source must not redownload');}},event=>progress.push(event),
    {simpleSelection:true,available:async()=>true,plan:async()=>new Map(),inspect:async()=>{posts++;throw Error('No paid inspection');},
      inspectForSelection:async(_project,_scene,_progress,_stop,cacheOnly)=>{assert.equal(cacheOnly,true);throw new DocumentaryAnalysisError('Saved request pending','pending');}});
  service.localCandidates=async()=>[f.alias];Reflect.set(service,'selectionResources',async()=>({workers:1}));
  const result=await service.autoSelect(f.project.id);
  assert.ok(searches>0);assert.equal(result.failed,19);assert.equal(result.skipped,0);assert.equal(result.selected,0);assert.equal(posts,0);
  assert.deepEqual(result.failures.map(failure=>Number(failure.sceneId.replace('scene-',''))).sort((a,b)=>a-b),pendingNumbers);
  assert.equal(result.project.scenes.filter(scene=>documentaryManualReviewReady(scene)).length,19);assert.equal(result.project.scenes.filter(documentaryAutomaticMaterialReady).length,0);
  assert.throws(()=>assertDocumentaryAutoExport(result.project),/№1/);assert.equal(await readFile(f.receipt,'utf8'),'{"state":"unknown","requestId":"existing"}');
  const recovered=await service.completeWithNativeFallback(f.project.id,undefined,undefined,true);
  assert.equal(recovered.scenes.filter(documentaryAutomaticMaterialReady).length,0);assert.equal(posts,0);
  assert.equal(progress.at(-1)!.failed,19);assert.equal(progress.at(-1)!.selected,0);
  assert.equal(recovered.scenes.filter(scene=>documentaryManualReviewReady(scene)).length,19);
});
