import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {mkdtemp,writeFile,readFile,rm,readdir,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {createVoiceCalibration,documentaryManualReviewReady,documentaryGeminiRetryAllowed,documentaryVideoCoverage,documentaryAiPlanContext,type DocumentaryCandidate,type Project} from '@gold-work/shared';
import {DocumentaryProjectService,documentaryVisualRejectionKeys} from './documentary-project-service.js';
import {DocumentarySearch} from './documentary-search.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {prepareDocumentaryScript} from './documentary-plan.js';
import {missingAssemblyInputs} from './assembly-readiness.js';
import {StockClient} from './stock-client.js';
import {effectFfmpeg} from './effect-media.js';
import {prepareDocumentaryImages} from './documentary-media-cache.js';
import {documentaryExportProject} from './documentary-render-cache.js';
import {prepareDocumentaryProduction} from './documentary-production.js';
import {DocumentaryIntelligence,documentaryNarrationContext} from './documentary-intelligence.js';
import {DocumentaryAnalysisError} from './documentary-analysis-error.js';
import {AnyModelCompletionUncertainError} from './anymodel-client.js';

async function fixture(t:test.TestContext,kind:'image'|'video'){
 const root=await mkdtemp(join(tmpdir(),'gws-pexels-fallback-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
 let project=await projects.create({title:'Cars',topic:'Ford and Ferrari',mediaMode:'stock',mode:'standard',language:'English',aspectRatio:'16:9'});
 project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:'The racing cars entered the factory.'};
 const scenes=prepareDocumentaryScript(project,createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:'The racing cars entered the factory.',audioDurationSeconds:5})).slice(0,1);
 project.settings.voice.enabled=false;project.settings.stockVideoPercent=kind==='video'?100:0;
 const scene=scenes[0]!;scene.audioPath='saved-paid-voice.wav';scene.documentary!.selectionPlan={kind,videoPercent:project.settings.stockVideoPercent};
 scene.documentary!.requirement.queries=['saved racing car factory'];
 scene.documentary!.autoError='Exact named historical footage unavailable';
 project=await projects.mutate(project.id,()=>({scenes,settings:project.settings,status:'generating'}));
 const candidate=(id:string,width=1600,height=900):DocumentaryCandidate=>({id,provider:'pexels',kind,title:id,description:'',pageUrl:`https://www.pexels.com/photo/${id}/`,downloadUrl:`https://images.pexels.com/${id}.jpg`,previewUrl:'',author:'author',attribution:'author',license:'Pexels',licenseUrl:'https://www.pexels.com/license/',rights:'licensed',query:'saved racing car factory',retrievedAt:'now',width,height,durationSeconds:30,match:'unverified',concerns:[]});
 let searches=0,attempts=0,reviews=0;
 const intelligence={simpleSelection:true as const,available:async()=>true,plan:async()=>{throw Error('No paid planning');},inspect:async()=>{
  reviews++;throw new DocumentaryAnalysisError('Fixture: Gemini unavailable');}};
 const service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,'projects')),
  {search:async(input:{providers?:string[];kind:string;query:string},_licensed:unknown,_signal:unknown,independent:unknown)=>{searches++;if(_signal){assert.ok(input.providers?.includes('commons'));if(kind==='video')assert.ok(input.providers?.includes('youtube'));assert.equal(independent,true);}assert.equal(input.kind,kind);assert.equal(input.query,'saved racing car factory');
   return {candidates:[candidate('portrait',900,1600),candidate('landscape')],sources:[]};}} as unknown as DocumentarySearch,
  join(root,'materials'),{download:async()=>{throw Error('Unexpected direct download');}},()=>{},
  intelligence);
 const path=join(root,kind==='video'?'fixture.mp4':'fixture.png');
 // Stub only the technical download/preparation boundary; test persisted orchestration and flags here.
 const boundary=service as unknown as {apply:(id:string,sceneId:string,selected:DocumentaryCandidate,commit?:boolean,progress?:unknown,wait?:unknown,deadline?:number,preview?:unknown,manual?:boolean,fallback?:{signal?:AbortSignal})=>Promise<Project>};
 const realApply=boundary.apply.bind(service);
 boundary.apply=async(id,sceneId,selected,_commit,_review,_prepare,_deadline,_update,manual,fallback)=>{
  attempts++;assert.equal(manual,true);if(fallback)assert.ok(fallback.signal);await writeFile(path,'prepared-media-fixture');
  const current=(await projects.get(id))!;return {...current,scenes:current.scenes.map(s=>s.id===sceneId?{...s,imagePath:path,videoPath:selected.kind==='video'?path:undefined,
   documentary:{...s.documentary!,selected:{...selected,localPath:path},checksum:'fixture-checksum'}}:s)};
 };
 return {projects,project,service,boundary,realApply,path,root,intelligence,reviews:()=>reviews,counts:()=>({searches,attempts})};
}

for(const kind of ['image','video'] as const)test(`Pexels ${kind} stays pending, preserves speech, and is reusable without another search`,async t=>{
 const f=await fixture(t,kind),result=await f.service.completeWithNativeFallback(f.project.id),scene=result.scenes[0]!;
 assert.equal(scene.documentary!.selected!.id,'landscape');assert.equal(scene.documentary!.verified,false);assert.equal(scene.documentary!.pinned,false);
 assert.equal(scene.documentary!.visualReview,undefined);assert.equal(scene.documentary!.manualReview!.kind,kind);
 assert.equal(scene.documentary!.manualReview!.analysis!.status,'error');assert.match(scene.documentary!.manualReview!.analysis!.reason,/Gemini unavailable/);
 assert.equal(scene.audioPath,'saved-paid-voice.wav');assert.equal(scene.narration,f.project.scenes[0]!.narration);
 assert.equal(documentaryManualReviewReady(scene),true);assert.deepEqual(missingAssemblyInputs(result),[]);
 assert.ok(missingAssemblyInputs(result,[],path=>path!==f.path).length);
 assert.equal(documentaryVideoCoverage(result.scenes).percent,kind==='video'?100:0);
 await f.service.completeWithNativeFallback(f.project.id);assert.deepEqual(f.counts(),{searches:1,attempts:1});
 assert.equal(f.reviews(),1);
 const changed=structuredClone(scene);changed.narration+=' changed';assert.equal(documentaryManualReviewReady(changed),false);
});

const verdict=(status:'accepted'|'rejected'|'uncertain')=>({status,confidence:.9,reason:`Fixture verdict: ${status}`,
 checkedAt:'2026-10-26T00:00:00Z',sampleSeconds:[0],quality:''});

test('replacing the rejected Adelaide photo keeps its refusal in search history and shows the Cutty Sark review',async t=>{
 const f=await fixture(t,'image'),old='Adelaide Central Market is unrelated to Cutty Sark',reason='Modern museum view of Cutty Sark';
 await f.projects.mutate(f.project.id,p=>({scenes:p.scenes.map(s=>({...s,documentary:{...s.documentary!,
   autoError:old,searchRecovery:{reason:old,queries:[],rejectedRanges:[]}}}))}));
 let beforeReview='';
 Reflect.set(f.intelligence,'inspect',async(_project:Project,current:Project['scenes'][number])=>{
   beforeReview=current.documentary!.manualReview!.reason;
   return {...verdict('accepted'),reason};
 });
 const {scenes:[scene]}=await f.service.completeWithNativeFallback(f.project.id),doc=scene!.documentary!;
 assert.doesNotMatch(beforeReview,/Adelaide/);
 assert.equal(doc.searchRecovery?.reason,old);
 assert.equal(doc.manualReview?.candidateId,doc.selected?.id);
 assert.equal(doc.manualReview?.analysis?.reason,reason);assert.equal(doc.visualReview?.reason,reason);
 assert.ok(doc.reviewNote.includes(reason));assert.doesNotMatch(doc.reviewNote,/Adelaide/);
 assert.equal(doc.manualReview?.status,'pending');assert.equal(doc.verified,false);
});

for(const status of ['accepted','rejected','uncertain'] as const)test(`fallback retains ${status} Gemini result without claiming verified`,async t=>{
 const f=await fixture(t,'image');let calls=0;
 Reflect.set(f.intelligence,'inspect',async(project:Project,scene:Project['scenes'][number])=>{
  calls++;assert.equal(project.scenes[0]!.id,scene.id);assert.equal(scene.imagePath,f.path);
  assert.equal(await readFile(scene.imagePath!,'utf8'),'prepared-media-fixture');
  assert.equal(scene.documentary!.manualReview!.analysis!.status,'pending');return verdict(status);
 });
 const result=await f.service.completeWithNativeFallback(f.project.id),scene=result.scenes[0]!;
 assert.equal(scene.documentary!.visualReview!.status,status);
 assert.equal(scene.documentary!.manualReview?.analysis?.status,status==='rejected'?undefined:status);
 assert.equal(scene.documentary!.verified,false);assert.equal(documentaryManualReviewReady(scene),status!=='rejected');
 if(status==='rejected'){assert.equal(scene.status,'failed');assert.ok(missingAssemblyInputs(result).length);}
 else assert.deepEqual(missingAssemblyInputs(result),[]);
 await f.service.completeWithNativeFallback(result.id);assert.equal(calls,1);
});

for(const [expected,error] of [
 ['pending',new DocumentaryAnalysisError('Existing request still pending','pending')],
 ['unknown',new AnyModelCompletionUncertainError('Response lost after submission')],
 ['error',new Error('Local frame extraction failed')],
] as const)test(`fallback preserves ${expected} and does not retry the same inspection`,async t=>{
 const f=await fixture(t,'image');let calls=0;
 Reflect.set(f.intelligence,'inspect',async()=>{calls++;throw error;});
 const first=await f.service.completeWithNativeFallback(f.project.id),scene=first.scenes[0]!;
 assert.equal(scene.documentary!.manualReview!.analysis!.status,expected);
 assert.match(scene.documentary!.manualReview!.analysis!.reason,new RegExp(error.message.split('.')[0]!));
 assert.equal(scene.documentary!.visualReview,undefined);assert.equal(scene.documentary!.verified,false);
 await f.service.completeWithNativeFallback(first.id);assert.equal(calls,1);
});

test('concurrent fallback entry cannot submit the same pending inspection twice',async t=>{
 const f=await fixture(t,'image');let calls=0,started!:()=>void,release!:()=>void;
 const ready=new Promise<void>(resolve=>{started=resolve;}),waiting=new Promise<void>(resolve=>{release=resolve;});
 Reflect.set(f.intelligence,'inspect',async()=>{calls++;started();await waiting;return verdict('uncertain');});
 const first=f.service.completeWithNativeFallback(f.project.id);await ready;
 const second=await f.service.completeWithNativeFallback(f.project.id);
 assert.equal(second.scenes[0]!.documentary!.manualReview!.analysis!.status,'pending');
 release();await first;assert.equal(calls,1);
});

test('a late Gemini result cannot overwrite a manual choice',async t=>{
 const f=await fixture(t,'image');
 Reflect.set(f.intelligence,'inspect',async()=>{
  await f.projects.mutate(f.project.id,current=>({scenes:current.scenes.map(scene=>({...scene,sourceVolume:37,
   documentary:{...scene.documentary!,pinned:true,verified:true,manualReview:undefined,reviewNote:'Chosen by user'}}))}));
  return verdict('rejected');
 });
 const result=await f.service.completeWithNativeFallback(f.project.id),scene=result.scenes[0]!;
 assert.equal(scene.documentary!.pinned,true);assert.equal(scene.documentary!.verified,true);
 assert.equal(scene.documentary!.manualReview,undefined);assert.equal(scene.documentary!.visualReview,undefined);
 assert.equal(scene.documentary!.reviewNote,'Chosen by user');assert.equal(scene.sourceVolume,37);
});

test('saved licensed candidates from another source survive an unavailable search',async t=>{
 const f=await fixture(t,'image'),searcher=(f.service as unknown as {searcher:DocumentarySearch}).searcher;
 const saved=(await searcher.search({query:'saved racing car factory',kind:'image'})).candidates[1]!;
 await f.projects.mutate(f.project.id,current=>({scenes:current.scenes.map(scene=>({...scene,
  documentary:{...scene.documentary!,candidates:[{...saved,provider:'pixabay',id:'pixabay:saved'}]}}))}));
 searcher.search=async()=>{throw Error('All search adapters offline');};
 const result=await f.service.completeWithNativeFallback(f.project.id),scene=result.scenes[0]!;
 assert.equal(scene.documentary!.selected!.provider,'pixabay');assert.equal(scene.documentary!.manualReview!.provider,'pixabay');
 assert.equal(documentaryManualReviewReady(scene),true);
 const wrongProvider=structuredClone(scene);wrongProvider.documentary!.manualReview!.provider='pexels';assert.equal(documentaryManualReviewReady(wrongProvider),false);
 const unlicensed=structuredClone(scene);unlicensed.documentary!.selected!.rights='unknown';assert.equal(documentaryManualReviewReady(unlicensed),false);
});

test('fallback preserves the saved query verbatim and does not invent one from the topic',async t=>{
 const f=await fixture(t,'image'),query='saved AI query '.repeat(10).trim();let searched:string|undefined;
 const searcher=(f.service as unknown as {searcher:DocumentarySearch}).searcher;
 searcher.search=async input=>{searched=input.query;return {candidates:[],sources:[]};};
 await f.projects.mutate(f.project.id,current=>({scenes:current.scenes.map(scene=>({...scene,documentary:{...scene.documentary!,requirement:{...scene.documentary!.requirement,queries:[query]}}}))}));
 await f.service.completeWithNativeFallback(f.project.id);assert.equal(searched,query);
 searched=undefined;
 await f.projects.mutate(f.project.id,current=>({scenes:current.scenes.map(scene=>({...scene,documentary:{...scene.documentary!,autoError:'Exact search failed',requirement:{...scene.documentary!.requirement,queries:[]}}}))}));
 await f.service.completeWithNativeFallback(f.project.id);assert.equal(searched,undefined);
});

test('fallback uses the approved AI query and leaves a stale plan without invented search',async t=>{
 const f=await fixture(t,'image'),hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 const inputHash=hash({version:1,model:'fixture-model',context:documentaryAiPlanContext(f.project)});
 const planned=await f.projects.mutate(f.project.id,current=>({scenes:current.scenes.map(scene=>({...scene,documentary:{...scene.documentary!,requirement:{...scene.documentary!.requirement,
  aiSearchPlan:{version:1,model:'fixture-model',inputHash:hash({inputHash,sceneId:scene.id}),subject:'racing cars',visualTarget:'racing cars in a factory',years:[],visualScope:'exact',preferredKind:'image',
   imageQueries:['approved original image query'],videoQueries:['approved original video query'],fallbackVideoQueries:['approved approximate query'],fallbackVisualTarget:'racing cars'}}}}))}));
 let searched:string|undefined;
 (f.service as unknown as {searcher:DocumentarySearch}).searcher.search=async input=>{searched=input.query;return {candidates:[],sources:[]};};
 const first=await f.service.completeWithNativeFallback(planned.id);assert.equal(searched,'approved original image query');
 assert.deepEqual(first.scenes[0]!.documentary!.requirement,planned.scenes[0]!.documentary!.requirement);
 searched=undefined;
 await f.projects.mutate(planned.id,current=>({title:current.title+' changed context'}));
 await f.service.completeWithNativeFallback(planned.id);assert.equal(searched,undefined);
});

async function fallbackAiPlan(f:Awaited<ReturnType<typeof fixture>>,kind:'image'|'video',emptyVideo=false){
 const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 const project=(await f.projects.get(f.project.id))!;
 const inputHash=hash({version:1,model:'fixture-model',context:documentaryAiPlanContext(project)});
 return f.projects.mutate(project.id,current=>({scenes:current.scenes.map(scene=>({...scene,documentary:{...scene.documentary!,requirement:{...scene.documentary!.requirement,
  aiSearchPlan:{version:1,model:'fixture-model',inputHash:hash({inputHash,sceneId:scene.id}),subject:'Ferrari',visualTarget:'Ferrari racing car',years:[],visualScope:'exact',preferredKind:kind,
   imageQueries:['Ferrari exact image'],videoQueries:emptyVideo?[]:['Ferrari exact video'],fallbackVideoQueries:['thematic racing reserve'],fallbackVisualTarget:'racing cars'}}}}))}));
}

test('fallback honors an image-only AI lane when the saved selection still requests video',async t=>{
 const f=await fixture(t,'video'),searcher=(f.service as unknown as {searcher:DocumentarySearch}).searcher;
 const source=(await searcher.search({query:'saved racing car factory',kind:'video'})).candidates[1]!;
 await fallbackAiPlan(f,'image',true);
 searcher.search=async(input,_licensed,_signal,independent)=>{
  assert.equal(input.kind,'image');assert.equal(input.query,'Ferrari exact image');assert.ok(input.providers?.includes('commons'));assert.equal(independent,true);
  return {candidates:[{...source,kind:'image'}],sources:[]};
 };
 const scene=(await f.service.completeWithNativeFallback(f.project.id)).scenes[0]!;
 assert.equal(scene.documentary!.selected!.kind,'image');assert.equal(scene.documentary!.selectionPlan!.kind,'image');
 assert.equal(scene.audioPath,'saved-paid-voice.wav');assert.equal(scene.documentary!.verified,false);
});

test('primary exact source search and named metadata precede three irrelevant local candidates',async t=>{
 const f=await fixture(t,'video'),searcher=(f.service as unknown as {searcher:DocumentarySearch}).searcher;
 const source=(await searcher.search({query:'saved racing car factory',kind:'video'})).candidates[1]!;
 await writeFile(f.path,'local pool');
 await f.projects.mutate(f.project.id,current=>({scenes:current.scenes.map(scene=>({...scene,documentary:{...scene.documentary!,
  requirement:{...scene.documentary!.requirement,entities:['Ferrari'],identities:[{name:'Ferrari',aliases:[],kind:'vehicle'}],detail:undefined,historicalIllustration:undefined,scriptRequirements:undefined,years:[]},
  candidates:Array.from({length:3},(_,i)=>({...source,id:`unrelated-${i}`,downloadUrl:`https://fixture/local-${i}`,title:'city traffic',localPath:f.path}))}}))}));
 await fallbackAiPlan(f,'video');
 const events:string[]=[];
 searcher.search=async(input,_licensed,_signal,independent)=>{
  events.push('search');assert.equal(input.query,'Ferrari exact video');assert.ok(input.providers?.includes('youtube'));assert.equal(independent,true);
  return {candidates:[{...source,id:'unrelated-short',downloadUrl:'https://fixture/short',title:'city traffic',durationSeconds:8},
   {...source,id:'ferrari-exact',downloadUrl:'https://fixture/exact',title:'Ferrari racing car',durationSeconds:90}],sources:[]};
 };
 const apply=f.boundary.apply;f.boundary.apply=async(...args)=>{events.push(args[2].id);return apply(...args);};
 const result=await f.service.completeWithNativeFallback(f.project.id);
 assert.deepEqual(events,['search','ferrari-exact']);assert.equal(result.scenes[0]!.documentary!.selected!.id,'ferrari-exact');
});

test('a rejected file alias is skipped and rejection advances to the next distinct candidate',async t=>{
 const f=await fixture(t,'image'),searcher=(f.service as unknown as {searcher:DocumentarySearch}).searcher;
 const source=(await searcher.search({query:'saved racing car factory',kind:'image'})).candidates[1]!;
 const scene=f.project.scenes[0]!,requirement=scene.documentary!.requirement;
 const scope=JSON.stringify([documentaryNarrationContext(f.project,scene),requirement.entities,requirement.identities,requirement.years,requirement.detail,scene.documentary!.motionGraphic]);
 const rejectionScope=createHash('sha256').update(JSON.stringify(['visual-illustration-v1',scope,f.project.aspectRatio,requirement.preferredKind,scene.documentary!.layout])).digest('hex');
 const directory=join(f.root,'projects',f.project.id,'Documentary',scene.id.replace(/[^a-zA-Z0-9_-]/g,'_'));
 await mkdir(directory,{recursive:true});
 const rejectedChecksum='a'.repeat(64);
 await writeFile(join(directory,'rejected-candidates.json'),JSON.stringify({version:1,scope:rejectionScope,keys:documentaryVisualRejectionKeys({...source,id:'old-provider-id'},rejectedChecksum)}));
 searcher.search=async()=>({candidates:[{...source,id:'alias',downloadUrl:'https://fixture/alias',localPath:join(f.root,`${rejectedChecksum}.png`)},
  {...source,id:'first',downloadUrl:'https://fixture/first'}, {...source,id:'second',downloadUrl:'https://fixture/second'}],sources:[]});
 const selected:string[]=[],apply=f.boundary.apply;
 f.boundary.apply=async(...args)=>{selected.push(args[2].id);const result=await apply(...args);result.scenes[0]!.documentary!.checksum=args[2].id;return result;};
 let reviews=0;Reflect.set(f.intelligence,'inspect',async()=>verdict(++reviews===1?'rejected':'accepted'));
 const result=await f.service.completeWithNativeFallback(f.project.id);
 assert.deepEqual(selected,['first','second']);assert.equal(reviews,2);assert.equal(result.scenes[0]!.documentary!.manualReview!.analysis!.status,'accepted');
 assert.equal(result.scenes[0]!.documentary!.verified,false);assert.deepEqual(missingAssemblyInputs(result),[]);
 await f.service.completeWithNativeFallback(f.project.id);assert.equal(reviews,2);
});

test('a saved local parasol hit from a previous steamship search cannot reenter automatic fallback',async t=>{
 const f=await fixture(t,'image'),searcher=(f.service as unknown as {searcher:DocumentarySearch}).searcher;
 const base=(await searcher.search({query:'saved racing car factory',kind:'image'})).candidates[1]!;
 const query='19th century steamship Suez Canal',title='woman baroness vintage 19th century promenade parasol umbrella';
 const old:DocumentaryCandidate={...base,provider:'local',id:'local:parasol',query,title,description:title,localPath:f.path};
 await writeFile(f.path,'old catalog selection');
 await f.projects.mutate(f.project.id,p=>({scenes:p.scenes.map(s=>({...s,documentary:{...s.documentary!,candidates:[old],
   requirement:{...s.documentary!.requirement,queries:[query]}}}))}));
 searcher.search=async()=>({candidates:[],sources:[]});
 const scene=(await f.service.completeWithNativeFallback(f.project.id)).scenes[0]!;
 assert.equal(f.counts().attempts,0);
 assert.equal(f.reviews(),0);
 assert.equal(scene.documentary!.selected,undefined);
});

test('fallback for the Cutty Sark sail scene tries the tall ship before a better-framed cruise embarkation',async t=>{
 const f=await fixture(t,'video'),searcher=(f.service as unknown as {searcher:DocumentarySearch}).searcher;
 const base=(await searcher.search({query:'saved racing car factory',kind:'video'})).candidates[1]!;
 await fallbackAiPlan(f,'video');
 const target='sails filling with wind on a tall ship',query='ship sails filling wind';
 await f.projects.mutate(f.project.id,p=>({scenes:p.scenes.map(s=>{
   const doc=s.documentary!,req=doc.requirement;
   return {...s,documentary:{...doc,requirement:{...req,entities:['Sailing ship powered by wind'],identities:[],queries:[query],
     aiSearchPlan:{...req.aiSearchPlan!,visualTarget:target,subject:'Sailing ship powered by wind',visualScope:'illustrative',videoQueries:[query]}}}};
 })}));
 const cruise={...base,id:'icon-of-the-seas',provider:'local' as const,query,title:'Royal Caribbean Icon of the Seas Day-1 | Embarkation! | Miami Sail-Away!',
   description:'Cruise ship embarkation on its inaugural sailing.'};
 const sails={...base,id:'tall-ship',query,title:'majestic tall ship sailing in clear blue sky',width:1500,downloadUrl:'https://fixture/tall-ship'};
 searcher.search=async()=>({candidates:[cruise,sails],sources:[]});
 const scene=(await f.service.completeWithNativeFallback(f.project.id)).scenes[0]!;
 assert.equal(scene.documentary!.selected!.id,sails.id);
 assert.equal(f.reviews(),1);assert.equal(scene.documentary!.verified,false);
});

test('video primary query gets a chance before the saved thematic reserve',async t=>{
 const f=await fixture(t,'video'),searcher=(f.service as unknown as {searcher:DocumentarySearch}).searcher;
 const source=(await searcher.search({query:'saved racing car factory',kind:'video'})).candidates[1]!;
 await fallbackAiPlan(f,'video');
 const queries:string[]=[];
 searcher.search=async input=>{queries.push(input.query);return {candidates:queries.length===1?[]:[source],sources:[]};};
 const result=await f.service.completeWithNativeFallback(f.project.id);
 assert.deepEqual(queries,['Ferrari exact video','thematic racing reserve']);
 assert.equal(documentaryManualReviewReady(result.scenes[0]!),true);assert.equal(f.counts().attempts,1);
});

test('three distinct rejections retain evidence but never become a ready manual fallback',async t=>{
 const f=await fixture(t,'image'),searcher=(f.service as unknown as {searcher:DocumentarySearch}).searcher;
 const source=(await searcher.search({query:'saved racing car factory',kind:'image'})).candidates[1]!;
 searcher.search=async()=>({candidates:[source],sources:[]});
 Reflect.set(f.intelligence,'inspect',async()=>verdict('accepted'));
 const prepared=await f.service.completeWithNativeFallback(f.project.id),donor=structuredClone(prepared.scenes[0]!);
 const target=structuredClone(f.project.scenes[0]!);target.id+='-target';target.order=1;
 await f.projects.mutate(prepared.id,()=>({scenes:[donor,target]}));
 searcher.search=async()=>({candidates:Array.from({length:5},(_,i)=>({...source,id:`rejected-${i}`,downloadUrl:`https://fixture/rejected-${i}`})),sources:[]});
 let attempts=0,reviews=0;const apply=f.boundary.apply;
 f.boundary.apply=async(...args)=>{
  attempts++;const result=await apply(...args),scene=result.scenes.find(scene=>scene.id===target.id)!,path=join(f.root,`${args[2].id}.png`);
  await writeFile(path,args[2].id);scene.imagePath=path;scene.documentary!.selected!.localPath=path;scene.documentary!.checksum=args[2].id;return result;
 };
 Reflect.set(f.intelligence,'inspect',async()=>{reviews++;return verdict('rejected');});
 const result=await f.service.completeWithNativeFallback(f.project.id),last=result.scenes[1]!;
 assert.equal(attempts,3);assert.equal(reviews,3);assert.equal(last.documentary!.selected!.id,'rejected-2');
 assert.equal(last.documentary!.visualReview!.status,'rejected');assert.equal(last.documentary!.verified,false);
 assert.equal(last.status,'failed');assert.equal(last.documentary!.manualReview,undefined);
 assert.equal(documentaryManualReviewReady(last),false);assert.ok(missingAssemblyInputs(result).length);
});

test('source search, preparation and Gemini share the original ninety-second deadline',async t=>{
 const f=await fixture(t,'image'),searcher=(f.service as unknown as {searcher:DocumentarySearch}).searcher;
 const source=(await searcher.search({query:'saved racing car factory',kind:'image'})).candidates[1]!;
 const now=Date.now;let elapsed=now(),remaining:number|undefined,reviews=0;
 searcher.search=async()=>{elapsed+=60_000;return {candidates:[source,{...source,id:'second',downloadUrl:'https://fixture/second'}],sources:[]};};
 const apply=f.boundary.apply;f.boundary.apply=async(...args)=>{elapsed+=5_000;return apply(...args);};
 Reflect.set(f.intelligence,'withSelectionBudget',async(budget:{remaining:()=>number;beforeSubmit:()=>Promise<void>;submit:()=>void},inspect:()=>Promise<unknown>)=>{
  remaining=budget.remaining();await budget.beforeSubmit();budget.submit();return inspect();
 });
 Reflect.set(f.intelligence,'inspect',async()=>{reviews++;elapsed+=25_001;return verdict('rejected');});
 let result:Project;
 try{Date.now=()=>elapsed;result=await f.service.completeWithNativeFallback(f.project.id);}finally{Date.now=now;}
 assert.equal(remaining,25_000);assert.equal(f.counts().attempts,1);assert.equal(reviews,1);
 assert.equal(documentaryManualReviewReady(result.scenes[0]!),false);assert.equal(result.scenes[0]!.documentary!.visualReview!.status,'rejected');
});

test('legacy pending material enters inspection once without another download or search',async t=>{
 const f=await fixture(t,'image');const first=await f.service.completeWithNativeFallback(f.project.id);
 await f.projects.mutate(first.id,current=>({scenes:current.scenes.map(scene=>({...scene,documentary:{...scene.documentary!,
  manualReview:{...scene.documentary!.manualReview!,analysis:undefined}}}))}));
 let calls=0;Reflect.set(f.intelligence,'inspect',async()=>{calls++;return verdict('uncertain');});
 const next=await f.service.completeWithNativeFallback(first.id);
 assert.equal(calls,1);assert.equal(next.scenes[0]!.documentary!.manualReview!.analysis!.status,'uncertain');
 assert.deepEqual(f.counts(),{searches:1,attempts:1});
 await f.service.completeWithNativeFallback(first.id);assert.equal(calls,1);
});

for(const exhausted of ['neither','attempts','time'] as const)test(`late local donors retain only the recipient active budget (${exhausted})`,async t=>{
 const f=await fixture(t,'image'),searcher=(f.service as unknown as {searcher:DocumentarySearch}).searcher;
 const source=(await searcher.search({query:'saved racing car factory',kind:'image'})).candidates[1]!;
 const first=structuredClone(f.project.scenes[0]!),donor=structuredClone(first),later=structuredClone(first);
 first.documentary!.requirement.queries=['first'];donor.id='late-donor';donor.order=1;donor.documentary!.requirement.queries=['donor'];
 later.id='later-empty';later.order=2;later.documentary!.requirement.queries=['later'];
 await f.projects.mutate(f.project.id,()=>({scenes:[first,donor,later]}));
 const now=Date.now;let elapsed=now(),remaining:number|undefined;const attempts:string[]=[];
 searcher.search=async input=>{
  if(input.query==='first'){
   elapsed+=exhausted==='time'?90_001:20_000;
   return {candidates:Array.from({length:exhausted==='attempts'?3:2},(_,i)=>({...source,id:`failed-${i}`,downloadUrl:`https://fixture/failed-${i}`})),sources:[]};
  }
  elapsed+=60_000;
  return {candidates:input.query==='donor'?[{...source,id:'late-local-donor'}]:[],sources:[]};
 };
 const apply=f.boundary.apply;
 f.boundary.apply=async(...args)=>{
  if(args[1]===first.id){attempts.push(args[2].id);if(args[2].id.startsWith('failed'))throw Error('Fixture preparation failure');
   remaining=args[6]!-Date.now();assert.equal(args[9]!.signal!.aborted,false);}
  return apply(...args);
 };
 Reflect.set(f.intelligence,'inspect',async()=>verdict('accepted'));
 let result:Project;
 try{Date.now=()=>elapsed;result=await f.service.completeWithNativeFallback(f.project.id);}finally{Date.now=now;}
 const recipient=result.scenes[0]!;
 if(exhausted==='neither'){
  assert.deepEqual(attempts,['failed-0','failed-1','late-local-donor']);assert.equal(remaining,70_000,'Resume spends the unconsumed time, not a new 90 seconds');
  assert.equal(recipient.documentary!.selected!.id,'late-local-donor');assert.equal(recipient.documentary!.manualReview!.analysis!.status,'accepted');
 }else{
  assert.equal(attempts.length,exhausted==='attempts'?3:0);assert.equal(remaining,undefined);assert.equal(recipient.documentary!.selected,undefined);
 }
 assert.equal(recipient.audioPath,first.audioPath);assert.equal(recipient.narration,first.narration);
});

test('same-file fallback preserves manual timing, volume and composition settings',async t=>{
 const f=await fixture(t,'video');
 const source=(await (f.service as unknown as {searcher:DocumentarySearch}).searcher.search({query:'saved racing car factory',kind:'video'})).candidates[1]!;
 await writeFile(f.path,'prepared-media-fixture');
 const project=await f.projects.mutate(f.project.id,current=>({scenes:current.scenes.map(scene=>({...scene,trimStartSeconds:2,trimEndSeconds:7,sourceVolume:23,
  videoPath:f.path,
  playbackRate:1.1,transition:'fade',transitionDurationSeconds:.7,kenBurnsDirection:'out',
  documentary:{...scene.documentary!,selected:{...source,localPath:f.path},checksum:'fixture-checksum',template:'full',templateOrigin:'manual',templateMotion:{amountPercent:0,curve:'smooth'},caption:{...scene.documentary!.caption,text:'Manual caption'}}}))}));
 const result=await f.service.completeWithNativeFallback(f.project.id),before=project.scenes[0]!,after=result.scenes[0]!;
 for(const key of ['id','narration','audioPath','trimStartSeconds','trimEndSeconds','sourceVolume','playbackRate','transition','transitionDurationSeconds','kenBurnsDirection'] as const)
  assert.deepEqual(after[key],before[key],key);
 for(const key of ['template','templateOrigin','templateMotion','caption'] as const)assert.deepEqual(after.documentary![key],before.documentary![key],key);
});

async function useRealInspection(t:test.TestContext,kind:'image'|'video',complete:(input:string,images:string[])=>Promise<string>){
 const f=await fixture(t,kind);
 // These fixtures exercise paid-review orchestration, so the actual decoded
 // original must pass the unchanged source-geometry gate first.
 await effectFfmpeg(kind==='image'?['-f','lavfi','-i','color=c=blue:s=1280x720','-frames:v','1','-y',f.path]
  :['-f','lavfi','-i','testsrc2=size=1280x720:rate=10','-t','8','-c:v','libx264','-preset','ultrafast','-threads','1','-pix_fmt','yuv420p','-y',f.path]);
 const bytes=await readFile(f.path);
 (f.service as unknown as {stock:Pick<StockClient,'download'>}).stock={download:async()=>({data:bytes,extension:kind==='image'?'.png':'.mp4',contentType:kind==='image'?'image/png':'video/mp4'})};
 f.boundary.apply=f.realApply;
 const storage=(f.service as unknown as {storage:LocalProjectStorage}).storage;
 const client={configured:async()=>true,documentaryCompletion:async(_system:string,input:string,images:string[]=[])=>complete(input,images)};
 Reflect.set(f.service,'intelligence',new DocumentaryIntelligence(client,id=>storage.projectDirectory(id)));
 return {...f,analysisRoot:join(storage.projectDirectory(f.project.id),'Documentary','Analysis')};
}

for(const mode of ['disjoint','short-rejected','occupied'] as const)test(`replacing a video recomputes its range before actual-frame review (${mode})`,async t=>{
 let calls=0;
 const f=await useRealInspection(t,'video',async(input,images)=>{
  calls++;const data=JSON.parse(input);assert.equal(images.length,3);assert.equal(data.sampleSeconds.length,3);
  assert.ok(data.endSeconds<= (mode==='short-rejected'?5.4:16.2));
  return JSON.stringify({description:'Mock actual frames',suitable:mode!=='short-rejected',reason:'Fixture frame verdict',footageOrigin:'camera',
   targetVisible:mode!=='short-rejected',targetEvidence:'Mock visible racing car body and wheels.',sourceText:{kind:'none',text:''}});
 });
 const duration=mode==='disjoint'?16.2:mode==='short-rejected'?5.4:8;
 if(duration!==8)await effectFfmpeg(['-f','lavfi','-i','testsrc2=size=1280x720:rate=10','-t',String(duration),'-c:v','libx264','-preset','ultrafast','-threads','1','-pix_fmt','yuv420p','-y',f.path]);
 const bytes=await readFile(f.path),checksum=createHash('sha256').update(bytes).digest('hex');
 (f.service as unknown as {stock:Pick<StockClient,'download'>}).stock={download:async()=>({data:bytes,extension:'.mp4',contentType:'video/mp4'})};
 const searcher=(f.service as unknown as {searcher:DocumentarySearch}).searcher;
 const base=(await searcher.search({query:'saved racing car factory',kind:'video'})).candidates[1]!;
 const source={...base,id:'new-file',durationSeconds:duration};searcher.search=async()=>({candidates:[source],sources:[]});
 const target=structuredClone(f.project.scenes[0]!);target.durationSeconds=5.1;target.trimStartSeconds=1.4;target.trimEndSeconds=6.5;target.videoPath=join(f.root,'old.mp4');
 Object.assign(target.documentary!,{checksum:'old-file',selected:{...base,id:'old-file',durationSeconds:1},timing:{sourceKey:'saved-voice',durationInFrames:153,speechSeconds:5.1}});
 const donor=structuredClone(target);donor.id='used-range';donor.order=1;donor.durationSeconds=3.733;donor.trimStartSeconds=0;donor.trimEndSeconds=3.733;donor.videoPath=f.path;
 Object.assign(donor.documentary!,{selected:{...source,localPath:f.path},checksum,pinned:true,verified:true,timing:{sourceKey:'donor-voice',durationInFrames:112,speechSeconds:3.733}});
 await f.projects.mutate(f.project.id,()=>({scenes:mode==='short-rejected'?[target]:[target,donor]}));
 const result=await f.service.completeWithNativeFallback(f.project.id),scene=result.scenes[0]!;
 assert.equal(scene.documentary!.selected!.id,'new-file');assert.equal(scene.audioPath,target.audioPath);assert.equal(scene.narration,target.narration);
 assert.ok(scene.trimEndSeconds!<=duration);assert.notDeepEqual([scene.trimStartSeconds,scene.trimEndSeconds],[1.4,6.5]);
 if(mode==='occupied'){
  assert.equal(calls,0);assert.equal(scene.documentary!.verified,false);assert.deepEqual(scene.documentary!.visualReview!.sampleSeconds,[]);
  assert.doesNotMatch(scene.documentary!.autoError!,/Gemini/,'A local no-range refusal is not a model verdict');
 }else{
  assert.equal(calls,1);assert.equal(scene.documentary!.visualReview!.sampleSeconds.length,3);
  assert.equal(scene.documentary!.verified,mode==='disjoint');
  if(mode==='disjoint')assert.ok(scene.trimStartSeconds!>=donor.trimEndSeconds!-.001);
 }
});

test('a fully approved saved fallback becomes verified without another search or paid review; changed bytes do not',async t=>{
 for(const changed of [false,true]){
  let calls=0;
  const f=await useRealInspection(t,'image',async input=>{calls++;const data=JSON.parse(input);
   return JSON.stringify({target:data.visualTarget,description:'Fixture racing cars',relevant:true,evidence:'Fixture matching cars.',
    targetVisible:true,targetEvidence:'Fixture cars have visible bodies and wheels',sourceText:{kind:'none',text:''}});});
  // This checks approval recovery, so use source dimensions that satisfy the
  // production geometry gate rather than the helper's tiny technical image.
  await effectFfmpeg(['-f','lavfi','-i','color=c=blue:s=1280x720','-frames:v','1','-y',f.path]);
  const image=await readFile(f.path);(f.service as unknown as {stock:Pick<StockClient,'download'>}).stock={download:async()=>({data:image,extension:'.png',contentType:'image/png'})};
  const ready=await f.service.completeWithNativeFallback(f.project.id),scene=ready.scenes[0]!,doc=scene.documentary!;
  assert.equal(doc.verified,true,JSON.stringify({review:doc.visualReview,analysis:doc.manualReview?.analysis}));assert.ok(doc.visualReview?.illustrationApproval);assert.equal(doc.manualReview,undefined);
  const receipts=(await readdir(f.analysisRoot)).filter(name=>name.endsWith('.json'));
  const bytes=await Promise.all(receipts.map(name=>readFile(join(f.analysisRoot,name),'utf8')));
  await f.projects.mutate(ready.id,current=>({scenes:current.scenes.map(s=>({...s,documentary:{...s.documentary!,verified:false,
   manualReview:{version:1,status:'pending',provider:doc.selected!.provider,kind:'image',candidateId:doc.selected!.id,checksum:doc.checksum!,
    mediaPath:scene.imagePath!,narration:scene.narration,reason:'Legacy approved fallback',analysis:{status:'accepted',reason:doc.visualReview!.reason}}}}))}));
  if(changed)await writeFile(scene.imagePath!,'Changed after paid review');
  (f.service as unknown as {searcher:DocumentarySearch}).searcher.search=async()=>{throw Error('Saved review must not search');};
  const intelligence=Reflect.get(f.service,'intelligence') as DocumentaryIntelligence;
  intelligence.inspectForSelection=async()=>{throw Error('Saved accepted review must not submit or inspect again');};
  const resumed=await f.service.completeWithNativeFallback(ready.id),after=resumed.scenes[0]!;
  assert.equal(after.documentary!.verified,!changed);assert.equal(calls,1);
  assert.equal(after.audioPath,scene.audioPath);assert.equal(after.narration,scene.narration);
  assert.deepEqual(await Promise.all(receipts.map(name=>readFile(join(f.analysisRoot,name),'utf8'))),bytes);
 }
});

test('named video fallback searches the planned exact photo before generic B-roll and verifies it',async t=>{
 let calls=0;
 const f=await useRealInspection(t,'image',async input=>{calls++;const data=JSON.parse(input);
  return JSON.stringify({target:data.visualTarget,description:'Fixture Ferrari racing car',relevant:true,evidence:'Fixture exact named object.',
   targetVisible:true,targetEvidence:'Fixture Ferrari car body and wheels are visible.',sourceText:{kind:'none',text:''}});});
 await f.projects.mutate(f.project.id,current=>({settings:{...current.settings,stockVideoPercent:100},scenes:current.scenes.map(scene=>({...scene,
  documentary:{...scene.documentary!,selectionPlan:{kind:'video',videoPercent:100},requirement:{...scene.documentary!.requirement,
   identities:[{name:'Ferrari',aliases:[]}],entities:['Ferrari']}}}))}));
 await fallbackAiPlan(f,'video');
 const searcher=(f.service as unknown as {searcher:DocumentarySearch}).searcher;
 const source=(await searcher.search({query:'saved racing car factory',kind:'image'})).candidates[1]!;
 const searches:string[]=[];
 searcher.search=async input=>{searches.push(`${input.kind}:${input.query}`);return {candidates:input.kind==='video'
  ?[{...source,id:'wrong-ferry',kind:'video',title:'Scenic modern ferry deck'}]
  :[{...source,id:'exact-photo',kind:'image',title:'Ferrari racing car'}],sources:[]};};
 const result=await f.service.completeWithNativeFallback(f.project.id),scene=result.scenes[0]!;
 assert.deepEqual(searches,['video:Ferrari exact video','image:Ferrari exact image']);
 assert.equal(calls,1,'No paid review of the plainly unrelated ferry');
 assert.equal(scene.documentary!.verified,true);assert.equal(scene.documentary!.selected!.id,'exact-photo');
 assert.equal(scene.documentary!.manualReview,undefined);assert.equal(scene.documentary!.selectionPlan!.kind,'image');
 assert.equal(scene.audioPath,'saved-paid-voice.wav');
});

for(const outcome of ['download-failure','rejected','budget','deadline'] as const)test(`named fallback retains untried videos after empty photos (${outcome})`,async t=>{
 const f=await fixture(t,'video'),searcher=(f.service as unknown as {searcher:DocumentarySearch}).searcher;
 const source=(await searcher.search({query:'saved racing car factory',kind:'video'})).candidates[1]!;
 await f.projects.mutate(f.project.id,current=>({scenes:current.scenes.map(scene=>({...scene,documentary:{...scene.documentary!,
  requirement:{...scene.documentary!.requirement,identities:[{name:'Ferrari',aliases:[]}],entities:['Ferrari']}}}))}));
 await fallbackAiPlan(f,'video');
 if(outcome==='download-failure')await f.projects.mutate(f.project.id,current=>({scenes:current.scenes.map(scene=>({...scene,
  documentary:{...scene.documentary!,requirement:{...scene.documentary!.requirement,
   aiSearchPlan:{...scene.documentary!.requirement.aiSearchPlan!,fallbackVideoQueries:[]}}}}))}));
 const events:string[]=[],deadlines:Array<number|undefined>=[],signals:Array<AbortSignal|undefined>=[],now=Date.now;
 searcher.search=async input=>{
  events.push(`search:${input.query}`);
  if(input.kind==='image'){
   if(outcome==='deadline'){const expired=now()+90_001;Date.now=()=>expired;}
   return {candidates:[],sources:[]};
  }
  assert.equal(input.query,'Ferrari exact video','Saved exact videos must precede generic reserve without repeating the search');
  return {candidates:['A','B','C','D'].map(id=>({...source,id,title:'Ferrari racing car',downloadUrl:`https://fixture.test/${id}`})),sources:[]};
 };
 const apply=f.boundary.apply;
 f.boundary.apply=async(...args)=>{
  events.push(`prepare:${args[2].id}`);deadlines.push(args[6]);signals.push(args[9]?.signal);
  if(outcome==='download-failure'&&args[2].id==='A')throw Error('Fixture failed video download');
  const prepared=await apply(...args);prepared.scenes[0]!.documentary!.checksum=`distinct-file-${args[2].id}`;return prepared;
 };
 Reflect.set(f.intelligence,'inspect',async(_project:Project,scene:Project['scenes'][number])=>{
  const id=scene.documentary!.selected!.id;events.push(`review:${id}`);
  return verdict(id==='B'&&outcome!=='budget'?'accepted':'rejected');
 });
 let result:Project;
 try{result=await f.service.completeWithNativeFallback(f.project.id);}finally{Date.now=now;}
 const expected=['search:Ferrari exact video','prepare:A',...(outcome==='download-failure'?[]:['review:A']),'search:Ferrari exact image',
  ...(outcome==='deadline'?[]:['prepare:B','review:B']),...(outcome==='budget'?['prepare:C','review:C']:[])];
 assert.deepEqual(events,expected);
 assert.equal(new Set(deadlines).size,1,'Photo and deferred video lanes keep the original deadline');
 assert.equal(new Set(signals).size,1,'Deferred video preparation keeps the original cancellation signal');
 assert.equal(deadlines.length,outcome==='budget'?3:outcome==='deadline'?1:2);
 const scene=result.scenes[0]!;
 if(outcome==='download-failure'||outcome==='rejected'){
  assert.equal(scene.documentary!.selected!.id,'B');assert.equal(scene.documentary!.visualReview!.status,'accepted');
 }else{assert.equal(scene.status,'failed');assert.equal(documentaryManualReviewReady(scene),false);}
 assert.equal(scene.audioPath,'saved-paid-voice.wav');assert.equal(scene.narration,f.project.scenes[0]!.narration);
});

for(const kind of ['image','video'] as const)test(`real fallback ${kind} frames reach the normal inspection/checkpoint path (mock provider)`,async t=>{
 let calls=0;
 const f=await useRealInspection(t,kind,async(input,images)=>{
  calls++;const data=JSON.parse(input);assert.ok(data.visualTarget);assert.equal(data.narration,'The racing cars entered the factory.');
  assert.equal(images.length,kind==='video'?3:1);assert.ok(images.every(image=>image.startsWith('data:image/jpeg;base64,')&&image.length>100));
  return JSON.stringify({target:data.visualTarget,description:'Synthetic local test pattern',relevant:false,evidence:'The supplied synthetic frames do not show racing cars.',confidence:.9});
 });
 const result=await f.service.completeWithNativeFallback(f.project.id),scene=result.scenes[0]!;
 assert.equal(calls,1);assert.equal(scene.documentary!.visualReview!.status,'rejected');
 assert.equal(scene.documentary!.manualReview,undefined);assert.equal(scene.documentary!.verified,false);assert.equal(scene.status,'failed');
 assert.equal(scene.documentary!.visualReview!.sampleSeconds.length,kind==='video'?3:1);
 await f.service.completeWithNativeFallback(result.id);assert.equal(calls,1);
});

test('an unknown normal inspection receipt survives resume without a second provider request',async t=>{
 let calls=0;
 const f=await useRealInspection(t,'image',async()=>{calls++;throw new AnyModelCompletionUncertainError('Fixture interrupted response');});
 const result=await f.service.completeWithNativeFallback(f.project.id);
 assert.ok(['pending','unknown'].includes(result.scenes[0]!.documentary!.manualReview!.analysis!.status));
 const receipts=(await readdir(f.analysisRoot)).filter(name=>name.endsWith('.json'));assert.equal(receipts.length,1);
 const receipt=join(f.analysisRoot,receipts[0]!),before=await readFile(receipt,'utf8');
 const resumed=await f.service.completeWithNativeFallback(result.id);
 assert.deepEqual(resumed.scenes[0]!.documentary!.manualReview!.analysis,result.scenes[0]!.documentary!.manualReview!.analysis);
 assert.equal(calls,1);assert.equal(await readFile(receipt,'utf8'),before);assert.equal(result.scenes[0]!.audioPath,'saved-paid-voice.wav');
});

test('cache-only recovery attaches a completed receipt after project persistence was interrupted',async t=>{
 let calls=0,interrupted=false;
 const f=await useRealInspection(t,'image',async(input)=>{calls++;const data=JSON.parse(input);
  return JSON.stringify({target:data.visualTarget,description:'Synthetic blue frame',relevant:false,evidence:'No racing cars are present.',confidence:.9});});
 const mutate=f.projects.mutate.bind(f.projects);
 f.projects.mutate=async(id,updater,options)=>mutate(id,current=>{
  const update=updater(current);
  if(!interrupted&&update.scenes?.some(scene=>scene.documentary?.manualReview?.analysis?.status==='rejected')){
   interrupted=true;throw Error('Fixture project write interrupted after completed receipt');
  }
  return update;
 },options);
 const first=await f.service.completeWithNativeFallback(f.project.id);
 assert.equal(interrupted,true);assert.equal(first.scenes[0]!.documentary!.manualReview!.analysis!.status,'pending');
 assert.equal(first.scenes[0]!.documentary!.visualReview,undefined);assert.equal(calls,1);
 const names=(await readdir(f.analysisRoot)).filter(name=>name.endsWith('.json'));assert.equal(names.length,1);
 const receipt=join(f.analysisRoot,names[0]!),bytes=await readFile(receipt,'utf8');assert.equal(JSON.parse(bytes).state,'complete');
 const intel=Reflect.get(f.service,'intelligence') as DocumentaryIntelligence,inspect=intel.inspectForSelection.bind(intel),cacheOnlyCalls:boolean[]=[];
 intel.inspectForSelection=async(...args)=>{cacheOnlyCalls.push(args[4]===true);return inspect(...args);};
 // Recovery must not even need a configured/live provider.
 intel.available=async()=>{throw Error('Cache-only recovery must not probe availability');};
 const resumed=await f.service.completeWithNativeFallback(first.id),scene=resumed.scenes[0]!;
 assert.deepEqual(cacheOnlyCalls,[true]);assert.equal(calls,1);assert.equal(await readFile(receipt,'utf8'),bytes);
 assert.equal(scene.documentary!.manualReview,undefined);assert.equal(scene.documentary!.visualReview!.status,'rejected');
 assert.equal(scene.documentary!.verified,false);assert.equal(scene.audioPath,first.scenes[0]!.audioPath);
 assert.equal(scene.documentary!.checksum,first.scenes[0]!.documentary!.checksum);assert.equal(documentaryManualReviewReady(scene),false);assert.equal(scene.status,'failed');
});

for(const status of ['pending','unknown','error'] as const)test(`cache-only miss preserves ${status} without a provider request`,async t=>{
 let calls=0;
 const f=await useRealInspection(t,'image',async()=>{calls++;throw Error('Cache-only miss must not submit');});
 const intel=Reflect.get(f.service,'intelligence') as DocumentaryIntelligence;intel.available=async()=>false;
 const first=await f.service.completeWithNativeFallback(f.project.id);
 const saved=await f.projects.mutate(first.id,current=>({scenes:current.scenes.map(scene=>({...scene,documentary:{...scene.documentary!,
  manualReview:{...scene.documentary!.manualReview!,analysis:{status,reason:'Saved unfinished analysis'}}}}))}));
 const inspect=intel.inspectForSelection.bind(intel),cacheOnlyCalls:boolean[]=[];
 intel.inspectForSelection=async(...args)=>{cacheOnlyCalls.push(args[4]===true);return inspect(...args);};
 intel.available=async()=>{throw Error('Do not probe availability on recovery');};
 const resumed=await f.service.completeWithNativeFallback(first.id);
 assert.deepEqual(cacheOnlyCalls,[true]);assert.equal(calls,0);
 assert.deepEqual(resumed.scenes[0]!.documentary!.manualReview!.analysis,saved.scenes[0]!.documentary!.manualReview!.analysis);
 assert.equal(resumed.scenes[0]!.documentary!.visualReview,undefined);
 const receipts=await readdir(f.analysisRoot).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
 assert.equal(receipts.filter(name=>name.endsWith('.json')).length,0);
});

test('a readable saved local candidate is prepared before a search can spend its deadline',async t=>{
 let calls=0,searches=0;
 const f=await useRealInspection(t,'image',async(input)=>{calls++;const data=JSON.parse(input);
  return JSON.stringify({target:data.visualTarget,description:'Fixture racing cars',relevant:true,evidence:'Fixture matching cars.',confidence:.9,
   targetVisible:true,targetEvidence:'Fixture car bodies and wheels are visible.',sourceText:{kind:'none',text:''}});});
 const searcher=(f.service as unknown as {searcher:DocumentarySearch}).searcher;
 const candidate=(await searcher.search({query:'saved racing car factory',kind:'image'})).candidates[1]!;
 const before=await f.projects.mutate(f.project.id,current=>({scenes:current.scenes.map(scene=>({...scene,documentary:{...scene.documentary!,
  candidates:[{...candidate,provider:'pixabay',id:'pixabay:local-before-timeout',localPath:f.path}]}}))}));
 const now=Date.now;
 searcher.search=async()=>{searches++;const expired=now()+90_001;Date.now=()=>expired;throw Error('Fixture search consumed deadline');};
 (f.service as unknown as {stock:Pick<StockClient,'download'>}).stock={download:async()=>{throw Error('Readable saved file must not download');}};
 let attempts=0;const apply=f.boundary.apply;
 f.boundary.apply=async(...args)=>{attempts++;return apply(...args);};
 let result:Project;
 try{result=await f.service.completeWithNativeFallback(f.project.id);}finally{Date.now=now;}
 const scene=result.scenes[0]!;
 assert.equal(searches,0,'Readable local material has priority over network search');assert.equal(attempts,1);assert.equal(calls,1);
 assert.equal(documentaryManualReviewReady(scene),false);assert.equal(scene.documentary!.verified,true);assert.equal(scene.documentary!.selected!.provider,'pixabay');
 assert.equal(scene.narration,before.scenes[0]!.narration);assert.equal(scene.audioPath,before.scenes[0]!.audioPath);
 assert.deepEqual(await readFile(scene.documentary!.selected!.localPath!),await readFile(f.path));
});

test('local and network candidate pools share the existing three preparation attempts',async t=>{
 const f=await fixture(t,'image'),searcher=(f.service as unknown as {searcher:DocumentarySearch}).searcher;
 const source=(await searcher.search({query:'saved racing car factory',kind:'image'})).candidates[1]!;
 await writeFile(f.path,'readable but corrupt fixture');
 await f.projects.mutate(f.project.id,current=>({scenes:current.scenes.map(scene=>({...scene,documentary:{...scene.documentary!,
  candidates:[{...source,id:'local-broken',localPath:f.path,downloadUrl:'https://fixture.test/local'}]}}))}));
 let attempts=0;f.boundary.apply=async()=>{attempts++;throw Error('Fixture preparation failed');};
 searcher.search=async()=>({candidates:Array.from({length:5},(_,i)=>({...source,id:`remote-${i}`,downloadUrl:`https://fixture.test/remote-${i}`})),sources:[]});
 const result=await f.service.completeWithNativeFallback(f.project.id);
 assert.equal(attempts,3);assert.equal(documentaryManualReviewReady(result.scenes[0]!),false);
});

async function retryFixture(t:test.TestContext,relevant=false){
 let blocked=true,calls=0,release:(()=>void)|undefined;
 const f=await useRealInspection(t,'image',async(input)=>{calls++;if(release)await new Promise<void>(resolve=>{release=resolve;});const data=JSON.parse(input);
   return JSON.stringify({target:data.visualTarget,description:'Blue fixture',relevant,evidence:relevant?'Fixture matching cars.':'No racing cars are present.',confidence:.9,
    targetVisible:relevant,targetEvidence:relevant?'Mock visible car bodies and wheels.':'Only the synthetic blue field is visible.',sourceText:{kind:'none',text:''}});});
 const intel=Reflect.get(f.service,'intelligence') as DocumentaryIntelligence;
 Reflect.set(intel,'beforePaidRequest',async()=>{if(blocked)throw Error('Fixture local preflight denied before POST');});
 const failed=await f.service.completeWithNativeFallback(f.project.id);
 const ready=await f.projects.mutate(f.project.id,()=>({status:'ready'}));
 assert.equal(calls,0);assert.equal(failed.scenes[0]!.documentary!.manualReview!.analysis!.status,'error');
 assert.equal(documentaryGeminiRetryAllowed(ready,ready.scenes[0]!),true);
 return {...f,intel,ready,calls:()=>calls,unblock:()=>{blocked=false;},pause:()=>{release=()=>{};},release:()=>release?.()};
}

test('explicit Gemini retry uses a proven pre-submit failure once and preserves manual review',async t=>{
 const f=await retryFixture(t);f.unblock();
 await f.service.completeWithNativeFallback(f.ready.id);assert.equal(f.calls(),0,'Automatic entry only reads cache and cannot spend a retry');
 const before=structuredClone(f.ready.scenes[0]!),result=await f.service.retryGemini(f.ready.id,before.id),scene=result.scenes[0]!;
 assert.equal(f.calls(),1);assert.equal(scene.documentary!.manualReview!.analysis!.status,'rejected');
 assert.equal(scene.documentary!.manualReview!.analysis!.preSubmit,undefined);assert.equal(documentaryGeminiRetryAllowed(result,scene),false);
 assert.equal(scene.documentary!.verified,false);assert.equal(documentaryManualReviewReady(scene),true);
 for(const key of ['id','narration','imagePath','audioPath','trimStartSeconds','trimEndSeconds','sourceVolume'] as const)assert.deepEqual(scene[key],before[key]);
 await f.service.retryGemini(result.id,scene.id);assert.equal(f.calls(),1,'Completed result is reused, never purchased twice');
});

test('an accepted retry and its completed receipt become verified without another POST',async t=>{
 const f=await retryFixture(t,true);f.unblock();const scene=f.ready.scenes[0]!;
 const accepted=await f.service.retryGemini(f.ready.id,scene.id);
 assert.equal(accepted.scenes[0]!.documentary!.verified,true);assert.equal(accepted.scenes[0]!.documentary!.manualReview,undefined);
 await f.service.retryGemini(f.ready.id,scene.id);assert.equal(f.calls(),1);
 const receipts=(await readdir(f.analysisRoot)).filter(name=>name.endsWith('.json'));
 const bytes=await Promise.all(receipts.map(name=>readFile(join(f.analysisRoot,name),'utf8')));
 await f.projects.mutate(f.ready.id,()=>structuredClone(f.ready));
 const recovered=await f.service.retryGemini(f.ready.id,scene.id);
 assert.equal(recovered.scenes[0]!.documentary!.verified,true);assert.equal(f.calls(),1);
 assert.deepEqual(await Promise.all(receipts.map(name=>readFile(join(f.analysisRoot,name),'utf8'))),bytes);
});

test('double-click retry shares one pending submission',async t=>{
 const f=await retryFixture(t);f.unblock();f.pause();const scene=f.ready.scenes[0]!;
 const first=f.service.retryGemini(f.ready.id,scene.id),second=f.service.retryGemini(f.ready.id,scene.id);assert.equal(first,second);
 while(f.calls()===0)await new Promise(resolve=>setTimeout(resolve,5));
 const pending=(await f.projects.get(f.ready.id))!.scenes[0]!;
 assert.equal(pending.documentary!.manualReview!.analysis!.status,'pending');assert.equal(pending.documentary!.manualReview!.analysis!.preSubmit,undefined);
 f.release();await first;assert.equal(f.calls(),1);
});

test('an uncertain explicit retry removes eligibility and preserves its receipt without another POST',async t=>{
 const f=await retryFixture(t);f.unblock();
 const client=Reflect.get(f.intel,'client'),complete=client.documentaryCompletion.bind(client);
 client.documentaryCompletion=async(...args:unknown[])=>{await complete(...args);throw new AnyModelCompletionUncertainError('Fixture retry response lost');};
 const first=await f.service.retryGemini(f.ready.id,f.ready.scenes[0]!.id),scene=first.scenes[0]!;
 assert.equal(f.calls(),1);assert.equal(documentaryGeminiRetryAllowed(first,scene),false);assert.equal(scene.documentary!.manualReview!.analysis!.preSubmit,undefined);
 const name=(await readdir(f.analysisRoot)).find(name=>name.endsWith('.json'))!,path=join(f.analysisRoot,name),before=await readFile(path,'utf8');
 await assert.rejects(f.service.retryGemini(first.id,scene.id),/Нет доказанной/);
 assert.equal(f.calls(),1);assert.equal(await readFile(path,'utf8'),before);
});

test('an unavailable provider does not consume proved pre-submit retry eligibility',async t=>{
 const f=await retryFixture(t);f.unblock();f.intel.available=async()=>false;
 await assert.rejects(f.service.retryGemini(f.ready.id,f.ready.scenes[0]!.id),/устраните ошибку/);
 const current=(await f.projects.get(f.ready.id))!;
 assert.equal(f.calls(),0);assert.equal(documentaryGeminiRetryAllowed(current,current.scenes[0]!),true);
});

for(const status of ['error','pending','unknown'] as const)test(`legacy ${status} cannot authorize an explicit Gemini POST`,async t=>{
 const f=await retryFixture(t);f.unblock();
 await f.projects.mutate(f.ready.id,current=>({scenes:current.scenes.map(scene=>({...scene,documentary:{...scene.documentary!,
  manualReview:{...scene.documentary!.manualReview!,analysis:{status,reason:'No durable pre-submit fact'}}}}))}));
 await assert.rejects(f.service.retryGemini(f.ready.id,f.ready.scenes[0]!.id),/Нет доказанной/);assert.equal(f.calls(),0);
});

test('material, narration, trim, context and file changes invalidate explicit retry proof',async t=>{
 const f=await retryFixture(t);f.unblock();
 for(const change of [
  (p:Project)=>{p.scenes[0]!.narration+=' changed';},
  (p:Project)=>{p.scenes[0]!.trimStartSeconds=1;},
  (p:Project)=>{p.scenes[0]!.documentary!.selected!.id+=' changed';},
  (p:Project)=>{p.title+=' changed';},
 ]){const changed=structuredClone(f.ready);change(changed);await f.projects.mutate(f.ready.id,()=>changed);
  assert.equal(documentaryGeminiRetryAllowed(changed,changed.scenes[0]!),false);
  await assert.rejects(f.service.retryGemini(changed.id,changed.scenes[0]!.id),/Нет доказанной/);}
 await f.projects.mutate(f.ready.id,()=>structuredClone(f.ready));
 await writeFile(f.ready.scenes[0]!.imagePath!,'changed local bytes');
 await assert.rejects(f.service.retryGemini(f.ready.id,f.ready.scenes[0]!.id),/Локальный файл изменился/);assert.equal(f.calls(),0);
});

test('retry first recovers completed receipts; a later unknown receipt forbids a new POST',async t=>{
 const f=await retryFixture(t);f.unblock();const scene=f.ready.scenes[0]!;
 const completed=await f.service.retryGemini(f.ready.id,scene.id),names=(await readdir(f.analysisRoot)).filter(name=>name.endsWith('.json'));
 const receipt=join(f.analysisRoot,names[0]!),before=await readFile(receipt,'utf8');
 await f.projects.mutate(f.ready.id,()=>structuredClone(f.ready));
 const recovered=await f.service.retryGemini(f.ready.id,scene.id);
 assert.equal(recovered.scenes[0]!.documentary!.manualReview!.analysis!.status,'rejected');assert.equal(f.calls(),1);
 assert.equal(await readFile(receipt,'utf8'),before);
 await writeFile(receipt,JSON.stringify({...JSON.parse(before),state:'pending',result:undefined}));
 const unknown=await readFile(receipt,'utf8');await f.projects.mutate(f.ready.id,()=>structuredClone(f.ready));
 await assert.rejects(f.service.retryGemini(f.ready.id,scene.id),/receipt прежнего запроса/);
 assert.equal(f.calls(),1);assert.equal(await readFile(receipt,'utf8'),unknown);assert.equal(completed.scenes[0]!.audioPath,scene.audioPath);
});

test('retry refuses a scene changed during preflight without submitting or overwriting the manual choice',async t=>{
 const f=await retryFixture(t);f.unblock();
 Reflect.set(f.intel,'beforePaidRequest',async()=>{
  await f.projects.mutate(f.ready.id,current=>({scenes:current.scenes.map(scene=>({...scene,sourceVolume:47,
   documentary:{...scene.documentary!,pinned:true,verified:true,manualReview:undefined,reviewNote:'Late manual choice'}}))}));
 });
 const result=await f.service.retryGemini(f.ready.id,f.ready.scenes[0]!.id),scene=result.scenes[0]!;
 assert.equal(f.calls(),0);assert.equal(scene.sourceVolume,47);assert.equal(scene.documentary!.reviewNote,'Late manual choice');
 assert.equal(scene.documentary!.pinned,true);assert.equal(scene.documentary!.visualReview,undefined);
});

test('a local file changed during retry preflight cannot reach the provider',async t=>{
 const f=await retryFixture(t);f.unblock();
 Reflect.set(f.intel,'beforePaidRequest',async()=>{await writeFile(f.ready.scenes[0]!.imagePath!,'changed during preflight');});
 const result=await f.service.retryGemini(f.ready.id,f.ready.scenes[0]!.id);
 assert.equal(f.calls(),0);assert.equal(result.scenes[0]!.documentary!.manualReview!.analysis!.status,'error');
 assert.equal(result.scenes[0]!.documentary!.manualReview!.analysis!.preSubmit,undefined);
});

for(const change of ['scene','file'] as const)test(`retry blocks a ${change} change during pending receipt write without dispatch or receipt deletion`,async t=>{
 const f=await retryFixture(t);f.unblock();let intercepted=false,receiptPath='',receiptBytes='';
 const rename=fs.promises.rename;
 fs.promises.rename=async(from,to)=>{
  if(!intercepted&&String(to).startsWith(f.analysisRoot)&&String(to).endsWith('.json')){
   const pending=await readFile(from,'utf8');
   if(JSON.parse(pending).state==='pending'){
    intercepted=true;receiptPath=String(to);receiptBytes=pending;
    if(change==='scene')await f.projects.mutate(f.ready.id,current=>({scenes:current.scenes.map(scene=>({...scene,sourceVolume:47,
     documentary:{...scene.documentary!,pinned:true,verified:true,manualReview:undefined,reviewNote:'Manual choice during pending write'}}))}));
    else await writeFile(f.ready.scenes[0]!.imagePath!,'changed during pending write');
   }
  }
  await rename(from,to);
 };
 syncBuiltinESMExports();
 let result:Project;
 try{result=await f.service.retryGemini(f.ready.id,f.ready.scenes[0]!.id);}
 finally{fs.promises.rename=rename;syncBuiltinESMExports();}
 assert.equal(intercepted,true);assert.equal(f.calls(),0);
 assert.equal(await readFile(receiptPath,'utf8'),receiptBytes);assert.equal(JSON.parse(receiptBytes).state,'pending');
 const scene=result.scenes[0]!;
 if(change==='scene'){
  assert.equal(scene.sourceVolume,47);assert.equal(scene.documentary!.pinned,true);assert.equal(scene.documentary!.verified,true);
  assert.equal(scene.documentary!.reviewNote,'Manual choice during pending write');assert.equal(scene.documentary!.manualReview,undefined);
 }else{
  assert.equal(scene.documentary!.manualReview!.analysis!.status,'error');assert.equal(scene.documentary!.manualReview!.analysis!.preSubmit,undefined);
 }
 assert.equal(documentaryGeminiRetryAllowed(result,scene),false);assert.equal(scene.documentary!.visualReview,undefined);
 await f.service.completeWithNativeFallback(f.ready.id);
 await assert.rejects(f.service.retryGemini(f.ready.id,scene.id),/Нет (доказанной|сохранённой ошибки до отправки)/);
 assert.equal(f.calls(),0);assert.equal(await readFile(receiptPath,'utf8'),receiptBytes);
});

test('retry blocks manual choice during the final post-pending stat and retains the receipt without dispatch',async t=>{
 const f=await retryFixture(t);f.unblock();const file=f.ready.scenes[0]!.imagePath!,fileBytes=await readFile(file);
 const {rename,stat}=fs.promises;let pendingSaved=false,injected=false,receiptPath='',receiptBytes='';
 fs.promises.rename=async(from,to)=>{
  const isReceipt=String(to).startsWith(f.analysisRoot)&&String(to).endsWith('.json');
  const bytes=isReceipt?await readFile(from,'utf8'):'';
  await rename(from,to);
  if(isReceipt&&JSON.parse(bytes).state==='pending'){pendingSaved=true;receiptPath=String(to);receiptBytes=bytes;}
 };
 fs.promises.stat=new Proxy(stat,{async apply(target,thisArg,args){
  if(pendingSaved&&!injected&&String(args[0])===file&&args[1]?.bigint){
   injected=true;assert.equal(f.calls(),0);assert.equal(JSON.parse(await readFile(receiptPath,'utf8')).state,'pending');
   await f.projects.mutate(f.ready.id,current=>({scenes:current.scenes.map(scene=>({...scene,sourceVolume:47,
    documentary:{...scene.documentary!,pinned:true,verified:true,manualReview:undefined,reviewNote:'Manual choice during final stat'}}))}));
  }
  return Reflect.apply(target,thisArg,args);
 }});
 syncBuiltinESMExports();let result:Project;
 try{result=await f.service.retryGemini(f.ready.id,f.ready.scenes[0]!.id);}
 finally{fs.promises.rename=rename;fs.promises.stat=stat;syncBuiltinESMExports();}
 assert.equal(pendingSaved,true);assert.equal(injected,true);assert.equal(f.calls(),0);
 assert.deepEqual(await readFile(file),fileBytes);assert.equal(await readFile(receiptPath,'utf8'),receiptBytes);
 const scene=result.scenes[0]!;
 assert.equal(scene.sourceVolume,47);assert.equal(scene.documentary!.pinned,true);assert.equal(scene.documentary!.verified,true);
 assert.equal(scene.documentary!.reviewNote,'Manual choice during final stat');assert.equal(scene.documentary!.manualReview,undefined);
 assert.equal(scene.documentary!.visualReview,undefined);assert.equal(documentaryGeminiRetryAllowed(result,scene),false);
 await f.service.completeWithNativeFallback(f.ready.id);
 await assert.rejects(f.service.retryGemini(f.ready.id,scene.id),/Нет сохранённой ошибки до отправки/);
 assert.equal(f.calls(),0);assert.equal(await readFile(receiptPath,'utf8'),receiptBytes);
});

test('a missing pending file is invalidated if fallback cannot replace it',async t=>{
 const f=await fixture(t,'image');await f.service.completeWithNativeFallback(f.project.id);await rm(f.path);
 f.boundary.apply=async()=>{throw Error('Unreadable source');};
 const result=await f.service.completeWithNativeFallback(f.project.id);
 assert.equal(documentaryManualReviewReady(result.scenes[0]!),false);assert.match(result.scenes[0]!.documentary!.autoError!,/Unreadable source/);
});

test('fallback stops after three failed preparations',async t=>{
 const f=await fixture(t,'image');let attempts=0;
 const searcher=(f.service as unknown as {searcher:DocumentarySearch}).searcher;
 const original=searcher.search.bind(searcher);
 // Count corrupt-media preparations of eligible landscape candidates, not
 // the portrait candidates rejected locally before any preparation attempt.
 searcher.search=async(...args)=>{const result=await original(...args);return {...result,candidates:Array.from({length:9},(_,i)=>({...result.candidates[1]!,id:String(i),downloadUrl:`https://images.pexels.com/distinct-${i}.jpg`}))};};
 f.boundary.apply=async()=>{attempts++;throw Error('Corrupt media');};
 const result=await f.service.completeWithNativeFallback(f.project.id);
 assert.equal(attempts,3);assert.equal(documentaryManualReviewReady(result.scenes[0]!),false);assert.equal(result.scenes[0]!.documentary!.verified,false);
});

test('Stop aborts the stock search request and does not retry',async()=>{
 let calls=0;const controller=new AbortController();let started!:()=>void;
 const ready=new Promise<void>(resolve=>{started=resolve;});
 const client=new StockClient({apiKey:async()=> 'fixture-key'},async(_input,init)=>{
  calls++;started();return new Promise<Response>((_resolve,reject)=>{init!.signal!.addEventListener('abort',()=>reject(init!.signal!.reason),{once:true});});
 });
 const work=client.search({provider:'pexels',query:'racing car',mediaType:'video'},false,controller.signal);
 await ready;controller.abort(Error('User stopped'));await assert.rejects(work,/User stopped/);assert.equal(calls,1);
});

test('manual application clears the pending flag and pins the chosen material',async t=>{
 const f=await fixture(t,'image');const result=await f.service.completeWithNativeFallback(f.project.id),scene=result.scenes[0]!;
 await f.projects.mutate(result.id,()=>({status:'ready'}));
 const stage=await f.service.stageCandidate(result.id,scene.id,scene.documentary!.selected!.id);
 const chosen=await f.service.applyStage(result.id,scene.id,{stageId:stage.id,startSeconds:0,rightsConfirmed:true,illustrative:true,note:'Manually chosen thematic photo'});
 assert.equal(chosen.scenes[0]!.documentary!.manualReview,undefined);assert.equal(chosen.scenes[0]!.documentary!.verified,true);assert.equal(chosen.scenes[0]!.documentary!.pinned,true);
});

test('real local image preparation keeps a readable pending file when Gemini is unavailable',async t=>{
 const f=await fixture(t,'image');
 await effectFfmpeg(['-f','lavfi','-i','color=c=blue:s=320x180','-frames:v','1','-y',f.path]);
 const bytes=await readFile(f.path);
 (f.service as unknown as {stock:Pick<StockClient,'download'>}).stock={download:async()=>({data:bytes,extension:'.png',contentType:'image/png'})};
 f.boundary.apply=f.realApply;
 const result=await f.service.completeWithNativeFallback(f.project.id),scene=result.scenes[0]!;
 assert.equal(documentaryManualReviewReady(scene),true);assert.equal(scene.documentary!.verified,false);assert.equal(scene.documentary!.visualReview,undefined);
 assert.equal(scene.documentary!.manualReview!.analysis!.status,'error');
 assert.ok((await readFile(scene.imagePath!)).length);assert.equal(scene.documentary!.selected!.width,320);assert.equal(scene.documentary!.selected!.height,180);
});

for(const status of ['rejected','unknown','error','pending','uncertain'] as const)test(`fallback does not propagate a ${status} manual material as a donor`,async t=>{
 const f=await fixture(t,'image'),searcher=(f.service as unknown as {searcher:DocumentarySearch}).searcher;
 const candidate=(await searcher.search({query:'saved racing car factory',kind:'image'})).candidates[1]!;
 searcher.search=async()=>({candidates:[candidate],sources:[]});
 const prepared=await f.service.completeWithNativeFallback(f.project.id),donor=structuredClone(prepared.scenes[0]!);
 donor.documentary!.manualReview!.analysis={status,reason:'Saved donor verdict'};
 const missing=structuredClone(f.project.scenes[0]!);missing.id+='-missing';missing.order=1;
 await f.projects.mutate(prepared.id,()=>({scenes:[donor,missing]}));
 searcher.search=async()=>({candidates:[],sources:[]});
 const result=await f.service.completeWithNativeFallback(prepared.id);
 if(status==='rejected'){
  assert.equal(result.scenes[0]!.status,'failed');assert.equal(result.scenes[0]!.documentary!.manualReview,undefined);
  assert.equal(result.scenes[0]!.documentary!.reviewNote,'Saved donor verdict');
  assert.equal(result.scenes[0]!.imagePath,donor.imagePath);assert.equal(result.scenes[0]!.audioPath,donor.audioPath);
 }else assert.deepEqual(result.scenes[0],donor);
 assert.equal(result.scenes[1]!.documentary!.selected,undefined);
 assert.equal(documentaryManualReviewReady(result.scenes[1]!),false);
});

for(const kind of ['image','video'] as const)for(const alreadyTried of [false,true])test(`Pexels ${kind} local reuse preserves donor and speech (saved exhausted fallback: ${alreadyTried})`,async t=>{
 const f=await fixture(t,kind);
 Reflect.set(f.intelligence,'inspect',async()=>verdict('accepted'));
 await effectFfmpeg(kind==='image'
  ?['-f','lavfi','-i','color=c=blue:s=320x180','-frames:v','1','-y',f.path]
  :['-f','lavfi','-i','color=c=blue:s=320x180:r=24','-t','8','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-y',f.path]);
 const bytes=await readFile(f.path);
 (f.service as unknown as {stock:Pick<StockClient,'download'>}).stock={download:async()=>({data:bytes,extension:kind==='image'?'.png':'.mp4',contentType:kind==='image'?'image/png':'video/mp4'})};
 f.boundary.apply=f.realApply;
 const prepared=await f.service.completeWithNativeFallback(f.project.id),donor=structuredClone(prepared.scenes[0]!);
 assert.equal(documentaryManualReviewReady(donor),true);
 Reflect.set(f.intelligence,'inspect',async()=>{throw new DocumentaryAnalysisError('Fixture: Gemini unavailable');});
 const missing=structuredClone(donor);missing.id+='-missing';missing.order=1;missing.narration='A different saved narration.';missing.audioPath='another-saved-paid-voice.wav';
 missing.imagePath=undefined;missing.videoPath=undefined;missing.stockSource=undefined;
 Object.assign(missing.documentary!,{selected:undefined,checksum:undefined,manualReview:undefined,visualReview:undefined,verified:false,pinned:false,candidates:[],autoError:alreadyTried?'Запасной материал Pexels недоступен: timeout':'Source unavailable'});
 await f.projects.mutate(prepared.id,()=>({scenes:[donor,missing],status:'generating'}));
 let searches=0;
 (f.service as unknown as {searcher:DocumentarySearch}).searcher.search=async()=>{searches++;throw Error('Pexels unavailable');};
 (f.service as unknown as {stock:Pick<StockClient,'download'>}).stock={download:async()=>{throw Error('Local reuse must not download');}};
 const result=await f.service.completeWithNativeFallback(prepared.id),reused=result.scenes[1]!;
 assert.equal(searches,alreadyTried?0:1);
 assert.deepEqual(result.scenes[0],donor);assert.equal(documentaryManualReviewReady(reused),true);
 assert.equal(reused.documentary!.verified,false);assert.equal(reused.documentary!.pinned,false);assert.equal(reused.documentary!.visualReview,undefined);
 assert.match(reused.documentary!.manualReview!.reason,/Повторно использован.*после ошибки источника/);
 assert.deepEqual(reused.documentary!.selectionPlan,missing.documentary!.selectionPlan);
 assert.equal(reused.audioPath,missing.audioPath);assert.equal(reused.narration,missing.narration);
 for(const key of ['id','provider','kind','pageUrl','license','licenseUrl','author','rights'] as const)assert.equal(reused.documentary!.selected![key],donor.documentary!.selected![key]);
 assert.deepEqual(await readFile(reused.documentary!.selected!.localPath!),await readFile(donor.documentary!.selected!.localPath!));
 assert.deepEqual(missingAssemblyInputs(result),[]);
});

test('native production resumes exhausted plans only with approved prior media and keeps unresolved fallback incomplete',async t=>{
 const f=await fixture(t,'image');
 Reflect.set(f.intelligence,'inspect',async()=>verdict('accepted'));
 await effectFfmpeg(['-f','lavfi','-i','color=c=blue:s=320x180','-frames:v','1','-y',f.path]);
 const bytes=await readFile(f.path);
 (f.service as unknown as {stock:Pick<StockClient,'download'>}).stock={download:async()=>({data:bytes,extension:'.png',contentType:'image/png'})};
 f.boundary.apply=f.realApply;
 const prepared=await f.service.completeWithNativeFallback(f.project.id),donor=structuredClone(prepared.scenes[0]!);
 const missing=structuredClone(donor);missing.id+='-missing';missing.order=1;missing.narration='Another unchanged spoken sentence.';missing.audioPath='another-paid-voice.wav';
 missing.imagePath=undefined;missing.videoPath=undefined;
 Object.assign(missing.documentary!,{selected:undefined,checksum:undefined,manualReview:undefined,visualReview:undefined,verified:false,pinned:false,candidates:[],autoError:'Запасной материал Pexels недоступен: timeout'});
 let project={...prepared,scenes:[donor,missing]};
 const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 const inputHash=hash({version:1,model:'fixture-model',context:documentaryAiPlanContext(project)});
 for(const scene of project.scenes){scene.documentary!.requirement.text=scene.narration;scene.documentary!.requirement.aiSearchPlan={version:1,model:'fixture-model',inputHash:hash({inputHash,sceneId:scene.id}),
  subject:'racing cars',visualTarget:'racing cars',years:[],visualScope:'exact',preferredKind:'image',imageQueries:['racing cars'],videoQueries:['racing cars'],fallbackVideoQueries:['racing cars'],fallbackVisualTarget:'racing cars'};}
 project=await f.projects.mutate(project.id,()=>({...project,status:'failed'}));
 assert.equal(await f.service.canResumeNativeFallback(project.id),false,'A manual-ready source without verified approval cannot make automatic resume ready');
 // An explicit user approval is preserved; it does not approve this source
 // for the second scene, whose own mocked review still lacks bound evidence.
 project=await f.projects.mutate(project.id,current=>({scenes:current.scenes.map((scene,index)=>index===0
  ?{...scene,documentary:{...scene.documentary!,verified:true,pinned:true,manualReview:undefined}}:scene)}));
 const baseline=structuredClone(project),receipt=join(f.path,'..','unknown-paid-receipt.json');await writeFile(receipt,'{"state":"unknown","requestId":"existing"}');
 assert.equal(await f.service.canResumeNativeFallback(project.id),true);
 for(const mutate of [
  (p:Project)=>{p.title+=' changed';},
  (p:Project)=>{p.scenes[1]!.narration+=' changed';},
  (p:Project)=>{p.settings.stockVideoPercent=100;},
  (p:Project)=>{p.scenes[1]!.documentary!.requirement.aiSearchPlan!.inputHash='stale';},
  (p:Project)=>{p.scenes[1]!.documentary!.autoError='Not attempted yet';},
  (p:Project)=>{p.scenes[0]!.imagePath='missing-file.png';},
 ]){const changed=structuredClone(baseline);mutate(changed);await f.projects.mutate(project.id,()=>changed);assert.equal(await f.service.canResumeNativeFallback(project.id),false);}
 const changed=structuredClone(baseline);changed.title+=' changed';await f.projects.mutate(project.id,()=>changed);
 let plans=0,voiceBarriers=0;
 f.service.planSearch=async()=>{plans++;throw Error('Normal planning reached');};
 f.service.autoSelect=async()=>{throw Error('Paid review must not repeat');};
 const options={projects:f.projects,documentary:f.service,signal:new AbortController().signal,startNarration:async()=>async()=>{voiceBarriers++;}};
 await assert.rejects(prepareDocumentaryProduction(project.id,options),/Normal planning reached/);assert.equal(plans,1);
 await f.projects.mutate(project.id,()=>baseline);
 (f.service as unknown as {searcher:DocumentarySearch}).searcher.search=async()=>{throw Error('Exhausted fallback must reuse locally');};
 (f.service as unknown as {stock:Pick<StockClient,'download'>}).stock={download:async()=>{throw Error('Local reuse must not download');}};
 await assert.rejects(prepareDocumentaryProduction(project.id,options),/для 1 сцен/);
 const result={project:(await f.projects.get(project.id))!};
 assert.equal(plans,1);assert.equal(voiceBarriers,1);
 // No montage/export success is claimed; preserve the approved donor and
 // keep the other prepared source available to the manual editor.
 const protectedScene=(scene:Project['scenes'][number])=>({id:scene.id,narration:scene.narration,audioPath:scene.audioPath,narrationSlice:scene.narrationSlice,
  imagePath:scene.imagePath,videoPath:scene.videoPath,stockSource:scene.stockSource,trimStartSeconds:scene.trimStartSeconds,trimEndSeconds:scene.trimEndSeconds,
  sourceVolume:scene.sourceVolume,playbackRate:scene.playbackRate,documentary:{selected:scene.documentary!.selected,checksum:scene.documentary!.checksum,
   requirement:scene.documentary!.requirement,manualReview:scene.documentary!.manualReview,visualReview:scene.documentary!.visualReview,
   verified:scene.documentary!.verified,pinned:scene.documentary!.pinned}});
 assert.deepEqual(protectedScene(result.project.scenes[0]!),protectedScene(baseline.scenes[0]!));
 assert.equal(result.project.scenes[0]!.documentary!.verified,true);
 assert.ok(documentaryManualReviewReady(result.project.scenes[1]!)&&!result.project.scenes[1]!.documentary!.verified);
 assert.deepEqual(result.project.scenes.map(s=>s.audioPath),baseline.scenes.map(s=>s.audioPath));
 assert.equal(await readFile(receipt,'utf8'),'{"state":"unknown","requestId":"existing"}');
});

test('large pending image remains usable across preview and export without accepting unrelated paths',async t=>{
 const f=await fixture(t,'image');
 await effectFfmpeg(['-f','lavfi','-i','color=c=blue:s=4096x64','-frames:v','1','-y',f.path]);
 const bytes=await readFile(f.path);
 (f.service as unknown as {stock:Pick<StockClient,'download'>}).stock={download:async()=>({data:bytes,extension:'.png',contentType:'image/png'})};
 f.boundary.apply=f.realApply;
 const result=await f.service.completeWithNativeFallback(f.project.id),original=result.scenes[0]!;
 const directory=(f.service as unknown as {storage:LocalProjectStorage}).storage.projectDirectory(result.id);
 const prepared=await prepareDocumentaryImages(directory,result.scenes),preview=prepared[0]!;
 assert.notEqual(preview.imagePath,original.imagePath);assert.equal(documentaryManualReviewReady(preview),true);
 assert.equal(preview.documentary!.manualReview!.mediaPath,preview.imagePath);
 const exported=documentaryExportProject({...result,scenes:prepared},directory).scenes[0]!;
 assert.equal(exported.imagePath,original.documentary!.selected!.localPath);assert.equal(documentaryManualReviewReady(exported),true);
 assert.equal(documentaryManualReviewReady({...preview,imagePath:'unrelated.png'}),false);
 const stale=structuredClone(preview);stale.documentary!.manualReview!.checksum='wrong-checksum';
 const invalid=documentaryExportProject({...result,scenes:[stale]},directory).scenes[0]!;
 assert.equal(documentaryManualReviewReady(invalid),false);assert.equal(invalid.documentary!.manualReview!.mediaPath,preview.imagePath);
});
