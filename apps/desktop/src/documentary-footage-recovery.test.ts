import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,link,writeFile,stat,utimes} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDefaultProjectSettings,documentaryVideoCoverage,type Project,type Scene} from '@gold-work/shared';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {documentaryFootageRecoveryScenes,prepareDocumentaryFootageRecovery} from './documentary-footage-recovery.js';
import {planFastDocumentaryScene,fastDocumentaryRequiredYears,fastDocumentaryFootageFallback,resetStaleDocumentaryFootageFallback} from './documentary-fast-plan.js';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {DocumentarySearch} from './documentary-search.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {effectFfmpeg} from './effect-media.js';
import {applyDocumentaryNativeFallback} from './documentary-native-fallback.js';
import {prepareDocumentaryProduction} from './documentary-production.js';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {documentaryIllustrationApproval,documentarySavedContextIssue} from './documentary-context-approval.js';

function fixture(){
 const narration='Valentino Rossi rides a motorcycle.';
 const scene={id:'s',order:0,narration,title:narration,durationSeconds:4,audioPath:'saved-voice.mp3',
  documentary:{version:2,requirement:{text:narration,entities:['Valentino Rossi'],years:[],queries:['Valentino Rossi'],preferredKind:'video'},
   verified:false,pinned:false,candidates:[],caption:{enabled:false,text:''},effects:[],layout:'full',autoError:'Source HTTP 503'}} as unknown as Scene;
 const project={id:'p',mediaMode:'stock',aspectRatio:'16:9',settings:createDefaultProjectSettings(),scenes:[scene]} as Project;
 project.settings.assembly.documentary={version:2,pace:'dynamic',autoMotionGraphics:true} as any;
 project.scenes=[applyDocumentaryNativeFallback(project,scene)];return project;
}

test('saved graphic failures reopen as real thematic video without touching voice or the exact target',()=>{
 const p=fixture(),s=p.scenes[0]!;assert.equal(s.documentary!.verified,true);
 assert.deepEqual(documentaryFootageRecoveryScenes(p),['s']);
 const restored=prepareDocumentaryFootageRecovery(p,s);
 assert.equal(restored.audioPath,s.audioPath);assert.equal(restored.narration,s.narration);
 assert.equal(restored.documentary!.verified,false);assert.equal(restored.documentary!.requirement.footageFallback!.originalTarget,'Valentino Rossi');
 assert.equal(planFastDocumentaryScene({...p,scenes:[restored]},restored).visualTarget,'motorcycle');
 assert.ok(restored.documentary!.nativeFallback,'The existing graphic stays recoverable until video succeeds');
});

test('recovery protects manual edits and stops when actual footage reaches the unchanged threshold',()=>{
 for(const edit of [(s:Scene)=>s.documentary!.pinned=true,(s:Scene)=>s.documentary!.templateOrigin='manual',
  (s:Scene)=>s.documentary!.cuts=[{} as any],(s:Scene)=>s.documentary!.caption.enabled=true]){
  const p=fixture();edit(p.scenes[0]!);assert.deepEqual(documentaryFootageRecoveryScenes(p),[]);
 }
 const p=fixture(),s=p.scenes[0]!;s.videoPath='existing.mp4';s.documentary!.selected={kind:'video',durationSeconds:4} as any;
 assert.deepEqual(documentaryFootageRecoveryScenes(p),[]);assert.equal(p.settings.stockVideoPercent,60);
});

test('an unknown candidate review does not freeze recovery with another source',()=>{
 const p=fixture(),s=p.scenes[0]!;
 s.documentary!.autoError='Прежний оплаченный просмотр имеет неизвестный результат. Повтор не отправлен.';
 assert.deepEqual(documentaryFootageRecoveryScenes(p),['s']);
 const recovered=prepareDocumentaryFootageRecovery(p,s);
 assert.equal(recovered.audioPath,s.audioPath);assert.equal(recovered.narration,s.narration);
 assert.equal(recovered.documentary!.verified,false);assert.ok(recovered.documentary!.requirement.footageFallback);
});

test('automatic transition overlays do not block footage recovery and remain intact',()=>{
 const p=fixture(),s=p.scenes[0]!;
 const effect={id:'transition',enabled:true,kind:'video',boundary:{from:'before',to:s.id,origin:'automatic'}} as any;
 s.documentary!.effects=[effect];
 assert.deepEqual(documentaryFootageRecoveryScenes(p),[s.id]);
 const pending=prepareDocumentaryFootageRecovery(p,s),restored=applyDocumentaryNativeFallback(p,pending);
 assert.equal(restored.documentary!.verified,true);assert.deepEqual(restored.documentary!.effects,[effect]);
 effect.boundary.origin='manual';assert.deepEqual(documentaryFootageRecoveryScenes(p),[]);
 assert.equal(applyDocumentaryNativeFallback(p,{...pending,documentary:{...pending.documentary!,verified:false}}).documentary!.verified,false);
});

test('historical scene fragments retain their episode date and comparative since-years do not reset it',()=>{
 const p=fixture();p.scenes=[{id:'a',narration:'In 2003 Valentino Rossi rode a motorcycle.'},{id:'b',narration:'His destination was Yamaha.'},
  {id:'c',narration:'It was their first championship since 1992.'},{id:'d',narration:'He won again.'}] as Scene[];
 assert.deepEqual(fastDocumentaryRequiredYears(p,p.scenes[1]!),['2003']);
 assert.deepEqual(fastDocumentaryRequiredYears(p,p.scenes[3]!),['2003']);
});

for(const legacy of [true,false])test(`${legacy?'legacy':'bound'} footage fallback expires when narration changes`,async t=>{
 const root=await mkdtemp(join(tmpdir(),'gws-footage-text-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const f=fixture(),original=prepareDocumentaryFootageRecovery(f,f.scenes[0]!);
 if(legacy)delete original.documentary!.requirement.footageFallback!.narration;
 assert.equal(planFastDocumentaryScene(f,original).visualTarget,'motorcycle');
 const edited={...original,narration:'A steam train crosses a railway bridge.'};
 // A new fallback must stay bound even if another planner has already rewritten requirement.text.
 if(!legacy)edited.documentary!.requirement.text=edited.narration;
 const changed={...f,scenes:[edited]};
 assert.doesNotMatch(planFastDocumentaryScene(changed,edited).queries.join(' '),/motorcycl|motorbike/);
 assert.equal(resetStaleDocumentaryFootageFallback(edited).documentary!.requirement.footageFallback,undefined);
 assert.equal(fastDocumentaryFootageFallback(changed,edited).narration,edited.narration);
 assert.equal(fastDocumentaryFootageFallback(changed,edited).target,'train');
 const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
 const created=await projects.create({title:'Changed script',topic:'Railway',mediaMode:'stock',mode:'standard',language:'English',aspectRatio:'16:9'});
 await projects.update(created.id,{scenes:changed.scenes,settings:changed.settings});
 const search=new DocumentarySearch(),queries:string[]=[];
 search.search=async input=>{queries.push(input.query);return {candidates:[],sources:[]};};
 const service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,'projects')),search,join(root,'Materials'),
  {download:async()=>{throw Error('No downloads');}},()=>{},
  {simpleSelection:true,available:async()=>true,plan:async()=>new Map(),inspect:async()=>{throw Error('No paid reviews');}});
 // Exercise the production branch too: it plans locally while narration is already saved.
 const result=await service.autoSelect(created.id,{},async()=>{});
 assert.ok(queries.length);assert.doesNotMatch(queries.join(' '),/motorcycl|motorbike/);
 assert.equal(result.project.scenes[0]!.audioPath,'saved-voice.mp3');
 assert.equal(result.project.scenes[0]!.documentary!.requirement.text,edited.narration);
 assert.equal(result.project.scenes[0]!.documentary!.requirement.footageFallback!.narration,edited.narration);
 const planned=await service.planSearch(created.id);
 assert.doesNotMatch(planned.scenes[0]!.documentary!.requirement.queries.join(' '),/motorcycl|motorbike/);
});

for(const unavailable of [false,true])test(`quota recovery ${unavailable?'preserves ready graphics on service interruption':'finishes with ready status after skipping a reserve graphic'}`,async t=>{
 const root=await mkdtemp(join(tmpdir(),'gws-quota-finish-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
 let p=await projects.create({title:'Quota',topic:'motorcycle',mediaMode:'stock',mode:'standard',language:'English',aspectRatio:'16:9'});
 const f=fixture();p.settings=f.settings;p.settings.voice.enabled=false;
 p.scenes=Array.from({length:10},(_,order)=>applyDocumentaryNativeFallback(p,{...structuredClone(f.scenes[0]!),id:'s'+order,order,
  durationSeconds:1,documentary:{...structuredClone(f.scenes[0]!.documentary!),verified:false,autoError:'Source HTTP 503'}}));
 p=await projects.update(p.id,{scenes:p.scenes,settings:p.settings});
 const video=join(root,'source.mp4');
 if(!unavailable)await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=s=1280x720:r=10','-t','12','-c:v','libx264','-threads','1','-preset','ultrafast',video]);
 const candidate={id:'local:quota',provider:'local',kind:'video',localPath:video,title:'motorcycle riding',description:'motorcycle riding',durationSeconds:12,
  width:1280,height:720,pageUrl:'',downloadUrl:'',author:'fixture',license:'fixture',licenseUrl:'',attribution:'fixture',rights:'user-confirmed',query:'motorcycle',retrievedAt:'now',match:'unverified',concerns:[]} as any;
 const search=new DocumentarySearch();search.search=async()=>({candidates:[candidate],sources:[]});
 const events:any[]=[];let inspections=0;
 const service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,'projects')),search,join(root,'Materials'),
  {download:async()=>{throw Error('No network');}},event=>events.push(event),
  {simpleSelection:true,available:async()=>!unavailable,plan:async()=>new Map(),inspect:async(_p,scene)=>{
   inspections++;
   const review={status:'accepted' as const,confidence:1,reason:'Mock orchestration only',quality:'',sampleSeconds:[],checkedAt:'now',trimStartSeconds:scene.order,trimEndSeconds:scene.order+1,
    fastRelevance:{version:1 as const,target:'motorcycle',relevant:true,evidence:'Mock motorcycle motion evidence for orchestration only'}};
   return {...review,illustrationApproval:documentaryIllustrationApproval(_p,{...scene,trimStartSeconds:scene.order,trimEndSeconds:scene.order+1,
    documentary:{...scene.documentary!,visualReview:review}})};
  }});
 Reflect.set(service,'selectionResources',async()=>({workers:1}));
 if(unavailable){
  await assert.rejects(service.autoSelect(p.id),/доступный AnyModel/);
  const saved=(await projects.get(p.id))!;
  assert.ok(saved.scenes.every(scene=>scene.documentary!.verified&&scene.documentary!.nativeFallback));
  const manifest=JSON.parse(await readFile(join(root,'projects',p.id,'project.json'),'utf8'));
  assert.ok(manifest.scenes.every((scene:Scene)=>scene.documentary!.verified));
  assert.ok(saved.scenes.every(scene=>scene.audioPath==='saved-voice.mp3'));
  assert.equal(inspections,0);return;
 }
 const result=await service.autoSelect(p.id);
 assert.equal(documentaryVideoCoverage(result.project.scenes).percent,60);
 assert.equal(result.project.settings.stockVideoPercent,60);assert.equal(result.failed,0);
 assert.equal(result.project.status,'ready',JSON.stringify(result.project.scenes.map(scene=>({n:scene.order,issue:documentarySavedContextIssue(result.project,scene)}))));assert.ok(result.project.scenes.every(scene=>scene.documentary!.verified));
 assert.ok(result.project.scenes[6]!.documentary!.nativeFallback,'The unused reserve keeps its ready graphic');
 assert.ok(result.project.scenes.every(scene=>scene.audioPath==='saved-voice.mp3'));
 assert.equal(events.at(-1).phase,'complete');assert.equal(events.at(-1).failed,0);
 assert.equal(events.at(-1).total,10);assert.equal(events.at(-1).completed,10);
 assert.equal(inspections,6);
 const manifest=JSON.parse(await readFile(join(root,'projects',p.id,'project.json'),'utf8'));
 assert.equal(manifest.status,'ready');assert.ok(manifest.scenes.every((scene:Scene)=>scene.documentary!.verified));
});

test('production recovers a verified native fallback through a failed provider and preserves saved voice',async t=>{
 const root=await mkdtemp(join(tmpdir(),'gws-footage-recovery-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
 let p=await projects.create({title:'Rossi',topic:'MotoGP',mediaMode:'stock',mode:'standard',language:'English',aspectRatio:'16:9'});
 const f=fixture();p=await projects.update(p.id,{scenes:f.scenes,settings:{...p.settings,stockVideoPercent:60}});
 const video=join(root,'video.mp4');await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=s=1280x720:r=10','-t','5','-c:v','libx264','-threads','1','-preset','ultrafast',video]);
 const candidate={id:'pexels:recovered',provider:'pexels',kind:'video',title:'motorcycle riding',description:'motorcycle riding',durationSeconds:5,
  width:1280,height:720,pageUrl:'https://example.test/video',downloadUrl:'https://example.test/video.mp4',author:'fixture',license:'fixture',licenseUrl:'',
  attribution:'fixture',rights:'licensed',query:'motorcycle',retrievedAt:'now',match:'unverified',concerns:[]} as any;
 const search=new DocumentarySearch();let queries=0;
 search.search=async input=>{queries++;if(input.providers?.includes('pixabay'))throw Error('Provider unavailable');return {candidates:input.providers?.includes('pexels')?[candidate]:[],sources:[]};};
 const service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,'projects')),search,join(root,'Materials'),
  {download:async()=>({data:await readFile(video),extension:'.mp4',contentType:'video/mp4'})},()=>{},
  {simpleSelection:true,available:async()=>true,plan:async()=>new Map(),inspect:async()=>({status:'accepted',confidence:1,reason:'Fixture orchestration review',quality:'',sampleSeconds:[],checkedAt:'now'})});
 const result=await prepareDocumentaryProduction(p.id,{projects,documentary:service,signal:new AbortController().signal,startNarration:async()=>async()=>{}});
 assert.equal(documentaryVideoCoverage(result.project.scenes).percent,100);assert.equal(result.project.settings.stockVideoPercent,60);
 assert.equal(result.project.scenes[0]!.audioPath,'saved-voice.mp3');assert.equal(result.project.scenes[0]!.documentary!.nativeFallback,undefined);
 assert.ok(queries>0);assert.ok(result.project.scenes[0]!.videoPath);
});

for(const change of ['link','mtime','bytes'] as const)test(`in-flight review ${change==='bytes'?'rejects changed bytes':change==='mtime'?'survives a timestamp-only touch':'survives a new immutable hardlink'}`,async t=>{
 const corrupt=change==='bytes';
 const root=await mkdtemp(join(tmpdir(),'gws-review-link-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const path=join(root,'video.mp4');await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=s=1280x720:r=10','-t','5','-c:v','libx264','-threads','1','-preset','ultrafast',path]);
 const p=fixture();const scene=prepareDocumentaryFootageRecovery(p,p.scenes[0]!);p.scenes=[scene];
 scene.videoPath=path;scene.documentary!.checksum=createHash('sha256').update(await readFile(path)).digest('hex');
 scene.documentary!.selected={id:'fixture',kind:'video',durationSeconds:5,title:'motorcycle',description:'motorcycle',localPath:path} as any;
 const intel=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(_system,input)=>{
  const data=JSON.parse(input);await link(path,join(root,'another-scene.mp4'));
  if(change==='mtime'){const before=await stat(path);await utimes(path,before.atime,new Date(before.mtimeMs+2000));}
  if(corrupt)await writeFile(path,Buffer.alloc((await readFile(path)).length,1));
  return JSON.stringify({description:'A motorcycle moves along the road.',target:data.visualTarget,relevant:true,evidence:'A motorcycle visibly changes position relative to the trees and road markings.',
   sampleChecks:data.sampleSeconds.map((seconds:number)=>({seconds,targetVisible:true,evidence:'Motorcycle visible'})),
   motion:{motionType:'live-footage',confidence:1,cameraMoves:false,subjectMoves:true,globalTransformOnly:false,
    subjectMotionEvidence:'The motorcycle changes position relative to the trees and road markings.',evidence:'Physical movement'}});
 }},()=>root);
 const result=await intel.inspectForSelection(p,scene);
 assert.equal(result.review.status,corrupt?'uncertain':'accepted',result.review.reason);
});
