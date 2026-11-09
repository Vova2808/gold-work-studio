import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {createVoiceCalibration,type Project,type Scene,type DocumentaryCandidate} from '@gold-work/shared';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {DocumentarySearch} from './documentary-search.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {prepareDocumentaryScript} from './documentary-plan.js';
import {documentaryAiPlanContext} from './documentary-ai-plan-state.js';
import {planFastDocumentaryScene} from './documentary-fast-plan.js';
import {documentaryIllustrationApproval,documentarySavedContextIssue,revalidateDocumentaryContext} from './documentary-context-approval.js';
import {documentaryCheckedVideoCoverage} from './documentary-automatic-native-recovery.js';
import {documentaryVideoQuotaPhotoEligible,documentaryVideoQuotaReserveScene,documentaryQuotaPhotoFileCurrent,type DocumentaryQuotaBudget} from './documentary-automatic-video-quota.js';
import {documentaryThematicDiscoveryRequirement} from './documentary-automatic-thematic-recovery.js';
import {DocumentaryAnalysisError} from './documentary-analysis-error.js';
import {effectFfmpeg} from './effect-media.js';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Review=NonNullable<NonNullable<Scene['documentary']>['visualReview']>;
async function fixture(t:TestContext,count=1,initialVideos=0){
  const root=await mkdtemp(join(tmpdir(),'gws-video-quota-'));
  t.after(async()=>{assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));assert.ok(root.includes('gws-video-quota-'));await rm(root,{recursive:true,force:true});});
  const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider()),storage=new LocalProjectStorage(join(root,'projects'));
  let project=await projects.create({title:'Harbor',topic:'Harbor boats',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
  const narration='Boats move across the harbor.';
  project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:narration};
  project.settings.voice.enabled=false;project.settings.stockVideoPercent=60;
  project.settings.assembly.documentary!.autoMotionGraphics=false;project.settings.assembly.documentary!.autoEffects=false;
  const base=prepareDocumentaryScript(project,createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:narration,audioDurationSeconds:4}))[0]!;
  const source=(id:string,kind:'image'|'video'='video'):DocumentaryCandidate=>({id,provider:'commons',kind,title:'Boats moving across the harbor',description:'Boats on harbor water',
    pageUrl:'https://example.test/'+id,downloadUrl:'https://example.test/'+id,localPath:join(root,id+(kind==='video'?'.mp4':'.jpg')),
    rights:'licensed',license:'fixture',licenseUrl:'',author:'fixture',attribution:'fixture',width:1280,height:720,durationSeconds:4,
    query:'harbor boats',retrievedAt:'now',match:'unverified',concerns:[]});
  project.scenes=Array.from({length:count},(_,order)=>{
    const scene=structuredClone(base);scene.id='scene-'+order;scene.order=order;scene.narration=narration;scene.durationSeconds=4;scene.audioPath='saved-paid-voice-'+order+'.mp3';
    const candidate=source('original-'+order,order<initialVideos?'video':'image');
    scene.imagePath=candidate.kind==='image'?candidate.localPath:undefined;scene.videoPath=candidate.kind==='video'?candidate.localPath:undefined;
    scene.documentary={...scene.documentary!,verified:true,pinned:false,selected:candidate,checksum:hash(candidate.downloadUrl),selectionPlan:{kind:candidate.kind,videoPercent:60},
      requirement:{text:narration,entities:[],identities:[],years:[],detail:'boats moving across the harbor',preferredKind:'image',queries:['harbor boats'],
        aiSearchPlan:{version:1,inputHash:'',model:'fixture',subject:'harbor boats',visualTarget:'boats moving across the harbor',visualScope:'illustrative',preferredKind:'image',
          years:[],imageQueries:['harbor boats'],videoQueries:['harbor boats'],fallbackVideoQueries:[],fallbackVisualTarget:''}}};
    return scene;
  });
  const approve=async(p:Project,s:Scene):Promise<Review>=>{
    const file=s.documentary!.selected!.kind==='video'?s.videoPath!:s.imagePath!,info=await stat(file,{bigint:true}),target=planFastDocumentaryScene(p,s).visualTarget;
    const review:Review={status:'accepted',confidence:1,reason:'Mock pixels, orchestration only',quality:'',viewDescription:'Boats moving on harbor water',sampleSeconds:[0,1,2],checkedAt:'now',
      footageOrigin:'camera',frameHash:'fixture',trimStartSeconds:s.trimStartSeconds,trimEndSeconds:s.trimEndSeconds,fastRelevance:{version:1,target,relevant:true,evidence:'Boats on harbor water'},illustrationQualityVersion:1,
      targetVisibility:{version:1,target,visible:true,evidence:'Boats visible'},sourceText:{version:1,kind:'none',text:''},
      localReview:{version:1,size:String(info.size),mtimeNs:String(info.mtimeNs),ctimeNs:String(info.ctimeNs)}};
    review.illustrationApproval=documentaryIllustrationApproval(p,{...s,documentary:{...s.documentary!,visualReview:review}});return review;
  };
  for(const scene of project.scenes){
    scene.documentary!.requirement.aiSearchPlan!.inputHash=hash({inputHash:hash({version:1,model:'fixture',context:documentaryAiPlanContext(project)}),sceneId:scene.id});
    await writeFile(scene.videoPath??scene.imagePath!,'Fixture original '+scene.id);
    scene.documentary!.checksum=createHash('sha256').update(await readFile(scene.videoPath??scene.imagePath!)).digest('hex');
    scene.documentary!.visualReview=await approve(project,scene);
    assert.equal(documentarySavedContextIssue(project,scene),undefined);
  }
  project=await projects.mutate(project.id,()=>project);
  let candidates:DocumentaryCandidate[]=[],budget:DocumentaryQuotaBudget|undefined;
  const calls={search:0,queries:[] as string[],prepare:[] as string[],posts:[] as string[],remaining:[] as number[],progress:[] as string[]};
  let beforeSearch=async(_input:{query:string;entities:string[];years:string[]})=>{},beforePaid=async()=>{},afterPaid=async()=>{};
  let reviewResult:(p:Project,s:Scene)=>Promise<Review>=approve;
  const search=new DocumentarySearch();search.search=async input=>{calls.search++;calls.queries.push(input.query);assert.equal(input.kind,'video');await beforeSearch({query:input.query,entities:input.entities??[],years:input.years??[]});return {candidates,sources:[]};};
  const service=new DocumentaryProjectService(projects,storage,search,join(root,'Materials'),{download:async()=>assert.fail('No live download')},event=>{if(event.message)calls.progress.push(event.message);},
    {simpleSelection:true,available:async()=>true,plan:async()=>new Map(),inspect:async()=>assert.fail('Use inspection adapter'),
      withSelectionBudget:async(value,work)=>{const previous=budget;budget=value as DocumentaryQuotaBudget;try{return await work();}finally{budget=previous;}},
      inspectForSelection:async(p,s)=>{
        assert.ok(budget);await beforePaid();await budget.beforeSubmit();budget.submit();calls.posts.push(s.documentary!.selected!.id);calls.remaining.push(budget.remaining());
        const review=await reviewResult(p,s);await afterPaid();return {review,usedNewAnalysis:true};
      }});
  Reflect.set(service,'selectionResources',async()=>({workers:1}));service.localCandidates=async()=>[];
  Reflect.set(service,'apply',async(_id:string,sceneId:string,candidate:DocumentaryCandidate,commit:boolean,_progress:unknown,_wait:unknown,_deadline:unknown,_preview:unknown,_manual:unknown,fallback?:{thematicProjection?:{scene:Scene}})=>{
    assert.equal(commit,false);calls.prepare.push(candidate.id);
    await writeFile(candidate.localPath!,'Fixture video '+candidate.id);
    const current=(await projects.get(project.id))!,checksum=hash(candidate.downloadUrl),time=2;
    const poster=join(storage.projectDirectory(project.id),'Documentary','RangePosters',hash([checksum,candidate.localPath,time])+'.jpg');
    await mkdir(join(storage.projectDirectory(project.id),'Documentary','RangePosters'),{recursive:true});await writeFile(poster,'Fixture poster');
    return {...current,scenes:current.scenes.map(saved=>{const s=fallback?.thematicProjection?.scene??saved;return saved.id===sceneId?{...s,imagePath:poster,videoPath:candidate.localPath,trimStartSeconds:0,trimEndSeconds:4,
      documentary:{...s.documentary!,selected:candidate,checksum,verified:false,visualReview:undefined}}:saved;})};
  });
  const receipt=join(root,'guarded-receipt.json');await writeFile(receipt,'{"state":"partial","raw":"immutable"}');
  return {root,projects,project,service,calls,source,approve,receipt,
    candidates:(value:DocumentaryCandidate[])=>{candidates=value;},result:(value:typeof reviewResult)=>{reviewResult=value;},
    beforeSearch:(value:typeof beforeSearch)=>{beforeSearch=value;},beforePaid:(value:typeof beforePaid)=>{beforePaid=value;},afterPaid:(value:typeof afterPaid)=>{afterPaid=value;}};
}

const reserveTarget='Cutty Sark sailing at Greenwich in 2020 with red sails';
const reserveQuery='Cutty Sark Greenwich 2020 sailing red sails';
async function reserveFixture(t:TestContext,count=1){
  const f=await fixture(t,count);
  let p=(await f.projects.get(f.project.id))!;
  for(const scene of p.scenes){
    const req=scene.documentary!.requirement;
    req.entities=['Captain Smith'];req.identities=[{name:'Captain Smith',aliases:[]}];req.years=['1880'];
    req.aiSearchPlan!.fallbackVisualTarget=reserveTarget;req.aiSearchPlan!.fallbackVideoQueries=[reserveQuery];
    scene.documentary!.visualReview=await f.approve(p,scene);
    assert.ok(documentaryVideoQuotaReserveScene(p,scene));
  }
  p=await f.projects.mutate(p.id,()=>p);
  // Primary named metadata must match its own target; reserve discovery must not
  // inherit this historical person's name/date into the authored video query.
  const candidate=(id:string)=>({...f.source(id),title:'Captain Smith boats moving across the harbor'});
  return {...f,project:p,candidate};
}

test('quota reserve reviews the authored target while the photo stays approved; marker and honest label commit atomically',async t=>{
  const f=await reserveFixture(t),before=structuredClone(f.project.scenes[0]!);
  f.beforeSearch(async input=>{
    if(input.query===reserveQuery){assert.deepEqual(input.entities,[]);assert.deepEqual(input.years,['2020']);f.candidates([f.source('reserve')]);}
    else f.candidates([f.candidate('primary')]);
  });
  f.result(async(p,s)=>{
    assert.deepEqual((await f.projects.get(f.project.id))!.scenes[0],before);
    if(!s.documentary!.requirement.footageFallback)return {status:'rejected',confidence:0,reason:'Primary unavailable',quality:'',sampleSeconds:[],checkedAt:'now'};
    assert.equal(planFastDocumentaryScene(p,s,'video').visualTarget,reserveTarget);
    assert.ok(documentaryThematicDiscoveryRequirement(p,s));
    assert.equal(p.scenes[0]!.documentary!.requirement.footageFallback!.target,reserveTarget);
    return f.approve(p,s);
  });
  const result=await f.service.completeWithNativeFallback(f.project.id,undefined,undefined,true),scene=result.scenes[0]!;
  assert.deepEqual(f.calls.posts,['reserve']);
  const {footageFallback,...primary}=scene.documentary!.requirement;
  assert.deepEqual(primary,before.documentary!.requirement);assert.equal(footageFallback!.target,reserveTarget);
  assert.equal(scene.audioPath,before.audioPath);assert.equal(scene.narration,before.narration);
  assert.equal(scene.documentary!.verified,true);assert.equal(scene.documentary!.illustrationLabelInEditorOnly,true);
  assert.match(scene.documentary!.reviewNote,/не архив названного события/);
  assert.equal(documentarySavedContextIssue(result,scene),undefined);assert.equal(revalidateDocumentaryContext(result)[0]!.documentary!.verified,true);
  assert.equal(documentaryCheckedVideoCoverage(result).videoSeconds,4);
  assert.equal(await readFile(f.receipt,'utf8'),'{"state":"partial","raw":"immutable"}');
});

test('unknown primary source and checksum aliases remain blocked in reserve and on explicit rerun',async t=>{
  const f=await reserveFixture(t),source=f.candidate('unknown-primary');
  const alias={...source,id:'local:'+hash(source.downloadUrl),provider:'local' as const,downloadUrl:''};
  f.beforeSearch(async()=>f.candidates([source,alias,f.source('fresh')]));
  f.result(async(_p,s)=>{if(s.documentary!.selected!.id==='unknown-primary')throw new DocumentaryAnalysisError('Unknown paid result','pending');
    return {status:'rejected',confidence:0,reason:'Wrong reserve',quality:'',sampleSeconds:[],checkedAt:'now'};});
  await f.service.completeWithNativeFallback(f.project.id,undefined,undefined,true);
  await f.service.completeWithNativeFallback(f.project.id,undefined,undefined,true);
  assert.deepEqual(f.calls.prepare,['unknown-primary','fresh']);assert.deepEqual(f.calls.posts,['unknown-primary','fresh']);
  assert.deepEqual((await f.projects.get(f.project.id))!.scenes[0],f.project.scenes[0]);
  assert.equal(await readFile(f.receipt,'utf8'),'{"state":"partial","raw":"immutable"}');
});

for(const phase of ['discovery','before-paid','after-paid','atomic-commit'] as const)test(`reserve ${phase} Stop/edit never attaches marker or discards approved photo`,async t=>{
  const f=await reserveFixture(t),stop=new AbortController();
  f.beforeSearch(async({query})=>{f.candidates(query===reserveQuery?[f.source('reserve')]:[]);if(query===reserveQuery&&phase==='discovery')stop.abort();});
  const edit=async()=>f.projects.mutate(f.project.id,p=>({scenes:p.scenes.map(s=>({...s,imagePrompt:'User changed visual task'}))}));
  if(phase==='before-paid')f.beforePaid(async()=>{await edit();});
  if(phase==='after-paid')f.afterPaid(async()=>{await edit();});
  if(phase==='atomic-commit'){
    let inject=false;f.afterPaid(async()=>{inject=true;});const mutate=f.projects.mutate.bind(f.projects);
    f.projects.mutate=async(...args:Parameters<typeof f.projects.mutate>)=>{if(inject){inject=false;await mutate(f.project.id,p=>({scenes:p.scenes.map(s=>({...s,imagePrompt:'User changed visual task'}))}));}return mutate(...args);};
  }
  const run=f.service.completeWithNativeFallback(f.project.id,undefined,stop.signal,true);
  if(phase==='discovery')await assert.rejects(run,{name:'AbortError'});else await run;
  const saved=(await f.projects.get(f.project.id))!.scenes[0]!;
  assert.equal(saved.documentary!.selected!.id,'original-0');assert.equal(saved.documentary!.requirement.footageFallback,undefined);
  assert.deepEqual(saved.documentary!.visualReview,f.project.scenes[0]!.documentary!.visualReview);
  assert.equal(f.calls.posts.length,phase==='discovery'||phase==='before-paid'?0:1);
});

test('one quota pass shares a 90s/3 limit across local/network preparation without recursion',async t=>{
  const f=await reserveFixture(t),real=Date.now;let elapsed=0;t.mock.method(Date,'now',()=>real()+elapsed);
  f.beforeSearch(async({query})=>f.candidates([1,2,3,4].map(n=>query===reserveQuery?{...f.source('reserve-'+n),provider:n%2?'commons':'local'}:f.candidate('primary-'+n))));
  f.result(async()=>{elapsed+=30_000;return {status:'rejected',confidence:0,reason:'Wrong target',quality:'',sampleSeconds:[],checkedAt:'now'};});
  await f.service.completeWithNativeFallback(f.project.id,undefined,undefined,true);
  assert.equal(f.calls.prepare.length,3);assert.equal(f.calls.posts.length,3);assert.equal(f.calls.search,1);
  assert.ok(f.calls.remaining.every((v,i)=>v>0&&v<=90_000-(i%3)*30_000));
  assert.deepEqual((await f.projects.get(f.project.id))!.scenes[0],f.project.scenes[0]);
});

test('one authored reserve pass stops immediately when quota is met',async t=>{
  const f=await reserveFixture(t,3);
  f.beforeSearch(async({query})=>f.candidates(query===reserveQuery?[f.source('reserve-'+f.calls.search)]:[]));
  const result=await f.service.completeWithNativeFallback(f.project.id,undefined,undefined,true);
  assert.deepEqual(f.calls.queries,[reserveQuery,reserveQuery]);
  assert.equal(documentaryCheckedVideoCoverage(result).videoSeconds,8);
  assert.equal(result.scenes[2]!.documentary!.selected!.kind,'image');
});

test('reserve own named/year/action/detail target cannot be replaced by a primary-target approval',async t=>{
  const f=await reserveFixture(t);f.beforeSearch(async({query})=>f.candidates(query===reserveQuery?[f.source('wrong-approval')]:[]));
  f.result(async(p,s)=>{
    assert.equal(planFastDocumentaryScene(p,s,'video').visualTarget,reserveTarget);
    const {footageFallback,...primary}=s.documentary!.requirement;
    return f.approve(p,{...s,documentary:{...s.documentary!,requirement:primary}});
  });
  await f.service.completeWithNativeFallback(f.project.id,undefined,undefined,true);
  assert.deepEqual((await f.projects.get(f.project.id))!.scenes[0],f.project.scenes[0]);assert.equal(f.calls.posts.length,1);
});

test('reserve requires current authored queries and shared policy; protected primary or reserve still targets remain photos',async t=>{
  const f=await reserveFixture(t);
  for(const change of [(p:Project)=>{p.settings.assembly.documentary!.matchMode='literal';},
    (p:Project)=>{p.scenes[0]!.documentary!.pinned=true;},(p:Project)=>{p.scenes[0]!.documentary!.selected!.id='manual:x';},
    (p:Project)=>{p.scenes[0]!.documentary!.requirement.aiSearchPlan!.inputHash='stale';},
    (p:Project)=>{p.scenes[0]!.documentary!.requirement.aiSearchPlan!.fallbackVideoQueries=[];},
    (p:Project)=>{p.scenes[0]!.documentary!.requirement.aiSearchPlan!.fallbackVideoQueries=[' '];},
    ...['portrait','historical document','ship diagram'].map(target=>(p:Project)=>{p.scenes[0]!.documentary!.requirement.aiSearchPlan!.fallbackVisualTarget=target;})]){
    const p=structuredClone(f.project);change(p);assert.equal(documentaryVideoQuotaReserveScene(p,p.scenes[0]!),undefined);
  }
});

test('real detached apply prepares reserve media without un-verifying the stored photo',async t=>{
  const f=await reserveFixture(t),candidate=f.source('local-reserve'),before=structuredClone(f.project.scenes[0]!);
  await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=size=1280x720:rate=30','-t','4','-c:v','libx264','-preset','ultrafast','-crf','32','-pix_fmt','yuv420p',candidate.localPath!]);
  const apply=Reflect.get(DocumentaryProjectService.prototype,'apply');
  Reflect.set(f.service,'apply',async(...args:unknown[])=>{
    const options=args[9] as {thematicProjection:{scene:Scene;binding:string}};
    assert.equal(args[3],false);assert.equal(args[8],false);assert.ok(options.thematicProjection.binding);
    assert.equal(options.thematicProjection.scene.documentary!.requirement.footageFallback!.target,reserveTarget);
    const result:Project=await apply.apply(f.service,args);
    assert.deepEqual((await f.projects.get(f.project.id))!.scenes[0],before);
    assert.equal(result.scenes[0]!.documentary!.requirement.footageFallback!.target,reserveTarget);
    return result;
  });
  f.beforeSearch(async({query})=>f.candidates(query===reserveQuery?[candidate]:[]));
  f.result(async(p,s)=>{assert.equal(planFastDocumentaryScene(p,s).visualTarget,reserveTarget);return f.approve(p,s);});
  const result=await f.service.completeWithNativeFallback(f.project.id,undefined,undefined,true),scene=result.scenes[0]!;
  assert.equal(scene.documentary!.selected!.id,'local-reserve');assert.equal(scene.documentary!.verified,true);
  assert.ok(documentaryThematicDiscoveryRequirement(result,scene));assert.equal(documentarySavedContextIssue(result,scene),undefined);
  assert.equal(documentaryCheckedVideoCoverage(result).videoSeconds,4);
});

test('service upgrades only the needed approved photos after fallback, preserves targets/voice and stops at checked quota',async t=>{
  const f=await fixture(t,4,1);f.candidates([f.source('first'),f.source('second'),f.source('third')]);
  const before=structuredClone(f.project),events:string[]=[];
  const original=Reflect.get(f.service,'completeWithSourceFallback').bind(f.service);
  Reflect.set(f.service,'completeWithSourceFallback',async(...args:unknown[])=>{const result=await original(...args);events.push('fallback-complete');return result;});
  f.beforeSearch(async()=>{assert.equal(events[0],'fallback-complete');});
  const result=await f.service.completeWithNativeFallback(f.project.id,undefined,undefined,true);
  assert.equal(f.service.automaticVideoQuotaRequired,true);assert.equal(documentaryCheckedVideoCoverage(result).percent,75,JSON.stringify(f.calls));
  assert.equal(result.scenes.filter(scene=>scene.documentary!.selected!.kind==='image').length,1);
  assert.equal(f.calls.posts.length,2);assert.equal(f.calls.search,2);assert.equal(result.settings.stockVideoPercent,60);
  for(const scene of result.scenes){const saved=before.scenes.find(s=>s.id===scene.id)!;assert.equal(scene.audioPath,saved.audioPath);assert.equal(scene.narration,saved.narration);assert.deepEqual(scene.documentary!.requirement,saved.documentary!.requirement);}
  assert.equal(await readFile(f.receipt,'utf8'),'{"state":"partial","raw":"immutable"}');
});

test('service continues after first refused pixels; the old photo stays selected throughout both reviews',async t=>{
  const f=await fixture(t);f.candidates([f.source('refused'),f.source('accepted')]);
  f.result(async(p,s)=>{
    const saved=(await f.projects.get(f.project.id))!.scenes[0]!;assert.equal(saved.documentary!.selected!.id,'original-0');assert.equal(saved.documentary!.verified,true);
    return s.documentary!.selected!.id==='refused'?{status:'rejected',confidence:0,reason:'Wrong pixels',quality:'',sampleSeconds:[],checkedAt:'now'}:f.approve(p,s);
  });
  const result=await f.service.completeWithNativeFallback(f.project.id,undefined,undefined,true);
  assert.deepEqual(f.calls.posts,['refused','accepted']);assert.equal(result.scenes[0]!.documentary!.selected!.id,'accepted');
});

for(const outcome of ['rejected','unknown','error','stop'] as const)test(`quota ${outcome} retains the complete accepted photo and quarantines attempts on resume`,async t=>{
  const f=await fixture(t),stop=new AbortController();f.candidates([f.source('attempt')]);
  f.result(async()=>{if(outcome==='stop')stop.abort();if(outcome==='unknown'||outcome==='stop')throw new DocumentaryAnalysisError('Submitted, response unknown','pending');
    if(outcome==='error')throw Error('Fixture failure');return {status:'rejected',confidence:0,reason:'Wrong pixels',quality:'',sampleSeconds:[],checkedAt:'now'};});
  const run=f.service.completeWithNativeFallback(f.project.id,undefined,stop.signal,true);
  if(outcome==='stop')await assert.rejects(run,{name:'AbortError'});else await run;
  const saved=(await f.projects.get(f.project.id))!;assert.deepEqual(saved.scenes[0],f.project.scenes[0]);
  if(outcome==='unknown')f.candidates([{...f.source('attempt'),id:'local:'+hash(f.source('attempt').downloadUrl),provider:'local',downloadUrl:''}]);
  await f.service.completeWithNativeFallback(f.project.id,undefined,undefined,true);
  assert.deepEqual(f.calls.prepare,['attempt']);assert.deepEqual(f.calls.posts,['attempt']);
  assert.equal(await readFile(f.receipt,'utf8'),'{"state":"partial","raw":"immutable"}');
});

for(const phase of ['before-paid','after-paid','atomic-commit'] as const)test(`concurrent visual edit ${phase} preserves the photo and cannot attach video approval`,async t=>{
  const f=await fixture(t);f.candidates([f.source('late')]);
  const edit=async()=>{await f.projects.mutate(f.project.id,p=>({scenes:p.scenes.map(s=>({...s,imagePrompt:'[Visual: exact portrait]'}))}));};
  if(phase==='before-paid')f.beforePaid(edit);
  else if(phase==='after-paid')f.afterPaid(edit);
  else {
    let inject=false;f.afterPaid(async()=>{inject=true;});const mutate=f.projects.mutate.bind(f.projects);
    f.projects.mutate=async(...args:Parameters<typeof f.projects.mutate>)=>{if(inject){inject=false;await mutate(f.project.id,p=>({scenes:p.scenes.map(s=>({...s,imagePrompt:'[Visual: exact portrait]'}))}));}return mutate(...args);};
  }
  const result=await f.service.completeWithNativeFallback(f.project.id,undefined,undefined,true),scene=result.scenes[0]!;
  assert.match(scene.imagePrompt,/exact portrait/);assert.equal(scene.documentary!.selected!.id,'original-0');
  assert.deepEqual(scene.documentary!.visualReview,f.project.scenes[0]!.documentary!.visualReview);
  assert.equal(f.calls.posts.length,phase==='before-paid'?0:1);
});

test('one scene shares 90 seconds and at most three actual preparations across candidates and queries',async t=>{
  const f=await fixture(t),real=Date.now;let elapsed=0;t.mock.method(Date,'now',()=>real()+elapsed);
  f.candidates([1,2,3,4].map(n=>f.source('attempt-'+n)));
  f.result(async()=>{elapsed+=30_000;return {status:'rejected',confidence:0,reason:'Wrong pixels',quality:'',sampleSeconds:[],checkedAt:'now'};});
  await f.service.completeWithNativeFallback(f.project.id,undefined,undefined,true);
  assert.equal(f.calls.prepare.length,3);assert.equal(f.calls.posts.length,3);
  assert.ok(f.calls.remaining[0]!<=90_000&&f.calls.remaining[1]!<=60_000&&f.calls.remaining[2]!<=30_000);
  assert.deepEqual((await f.projects.get(f.project.id))!.scenes[0],f.project.scenes[0]);
});

test('shared policy protects pinned/manual/authored/portrait/diagram/document/stale/image-only targets without changing source',async t=>{
  const f=await fixture(t),p=f.project,s=p.scenes[0]!;assert.equal(documentaryVideoQuotaPhotoEligible(p,s),true);
  for(const change of [(v:Scene)=>{v.documentary!.pinned=true;},(v:Scene)=>{v.documentary!.selected!.id='manual:chosen';},
    (v:Scene)=>{v.imagePrompt='[Visual: actual archival shot]';},(v:Scene)=>{v.documentary!.caption.enabled=true;},
    (v:Scene)=>{v.documentary!.requirement.aiSearchPlan!.inputHash='stale';},(v:Scene)=>{v.documentary!.requirement.aiSearchPlan!.videoQueries=[];},
    ...['portrait of captain','ship blueprint','historical document'].map(target=>(v:Scene)=>{v.documentary!.requirement.aiSearchPlan!.visualTarget=target;})]){
    const copy=structuredClone(p);change(copy.scenes[0]!);assert.equal(documentaryVideoQuotaPhotoEligible(copy,copy.scenes[0]!),false);
  }
  const before=structuredClone(p);await f.service.completeWithNativeFallback(p.id);assert.equal(f.calls.search,0);assert.deepEqual((await f.projects.get(p.id))!.scenes,before.scenes);
});

test('still images with an MP4 path cannot count as a quota upgrade',async t=>{
  const f=await fixture(t),still={...f.source('still'),kind:'image' as const};f.candidates([still]);
  const result=await f.service.completeWithNativeFallback(f.project.id,undefined,undefined,true);
  assert.equal(documentaryCheckedVideoCoverage(result).videoSeconds,0);assert.equal(f.calls.prepare.length,0);assert.equal(f.calls.posts.length,0);
});

test('old photo ctime-only drift needs identical bytes; a new video with wrong full revision is never accepted',async t=>{
  const f=await fixture(t);
  await f.projects.mutate(f.project.id,p=>({scenes:p.scenes.map(s=>{
    const review={...s.documentary!.visualReview!,localReview:{...s.documentary!.visualReview!.localReview!,ctimeNs:'0'}};
    const scene={...s,documentary:{...s.documentary!,visualReview:review}};review.illustrationApproval=documentaryIllustrationApproval(p,scene);return scene;
  })}));
  const before=(await f.projects.get(f.project.id))!;assert.equal(await documentaryQuotaPhotoFileCurrent(before.scenes[0]!),true);
  const corrupt=structuredClone(before.scenes[0]!);corrupt.documentary!.checksum='0'.repeat(64);assert.equal(await documentaryQuotaPhotoFileCurrent(corrupt),false);
  f.candidates([f.source('new-bad-revision')]);f.result(async(p,s)=>{
    const review=await f.approve(p,s);review.localReview!.ctimeNs='0';review.illustrationApproval=documentaryIllustrationApproval(p,{...s,documentary:{...s.documentary!,visualReview:review}});return review;
  });
  const result=await f.service.completeWithNativeFallback(f.project.id,undefined,undefined,true);
  assert.deepEqual(f.calls.posts,['new-bad-revision']);assert.deepEqual(result.scenes[0],before.scenes[0]);assert.equal(documentaryCheckedVideoCoverage(result).videoSeconds,0);
});

test('Stop during quota discovery consumes no source attempt and allows a later bounded run',async t=>{
  const f=await fixture(t),stop=new AbortController();f.candidates([f.source('after-stop')]);f.beforeSearch(async()=>{stop.abort();});
  await assert.rejects(f.service.completeWithNativeFallback(f.project.id,undefined,stop.signal,true),{name:'AbortError'});
  assert.equal(f.calls.prepare.length,0);assert.equal(f.calls.posts.length,0);assert.deepEqual((await f.projects.get(f.project.id))!.scenes[0],f.project.scenes[0]);
  f.beforeSearch(async()=>{});const result=await f.service.completeWithNativeFallback(f.project.id,undefined,undefined,true);
  assert.equal(result.scenes[0]!.documentary!.selected!.id,'after-stop');assert.deepEqual(f.calls.posts,['after-stop']);
});

test('candidate bytes changing before dispatch prevent a new paid request',async t=>{
  const f=await fixture(t),candidate=f.source('changed');f.candidates([candidate]);
  f.beforePaid(async()=>{await writeFile(candidate.localPath!,'Changed video bytes before paid dispatch');});
  await f.service.completeWithNativeFallback(f.project.id,undefined,undefined,true);
  assert.equal(f.calls.posts.length,0);assert.deepEqual((await f.projects.get(f.project.id))!.scenes[0],f.project.scenes[0]);
});
