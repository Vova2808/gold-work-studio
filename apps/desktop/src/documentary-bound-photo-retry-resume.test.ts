import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {documentaryAiPlanContext,type DocumentaryCandidate,type Scene} from '@gold-work/shared';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {DocumentarySearch} from './documentary-search.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {prepareDocumentaryScript} from './documentary-plan.js';
import {documentarySceneContext} from './documentary-scene-context.js';
import {claimDocumentaryThematicRecovery,documentaryThematicDiscoveryRequirement} from './documentary-automatic-thematic-recovery.js';
import {DocumentaryCachedAnalysisMissing,DocumentaryIntelligence,documentaryNarrationContext} from './documentary-intelligence.js';
import {documentaryIllustrationApproval} from './documentary-context-approval.js';
import {documentarySelectionRetry,DocumentaryRetryPermissions,listDocumentaryRecovery,readDocumentarySelectionRetryGrant} from './documentary-retry.js';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bytesHash=(value:string)=>createHash('sha256').update(value).digest('hex');
const model='fixture/visual-model';
const modes=['exact','ui-photo','unbound','missing','empty','directory','altered-file','changed-task','changed-request','changed-model',
 'no-grant','remote-checksum','manual-reserve','100-percent','pinned','video-preferred'] as const;

for(const mode of modes)test(`bound prepared photo resumes through exact retry gate: ${mode}`,async t=>{
 const root=await mkdtemp(join(tmpdir(),'gws-bound-photo-retry-'));t.after(()=>rm(root,{recursive:true,force:true}));
 t.mock.method(globalThis,'fetch',async()=>assert.fail('No live HTTP in this fixture'));
 const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
 let project=await projects.create({title:'Aurora',topic:'Aurora',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
 const narration='Aurora carried a wide spread of red sails.',target='Aurora with visible red sails';
 project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:narration};
 project.settings.stockVideoPercent=mode==='100-percent'?100:60;project.settings.voice.enabled=false;
 project.settings.assembly.documentary!.autoMotionGraphics=false;project.settings.assembly.documentary!.autoEffects=false;
 project.scenes=[prepareDocumentaryScript(project)[0]!];const scene=project.scenes[0]!,doc=scene.documentary!;
 const voice=join(root,'paid-voice.wav');await writeFile(voice,'Existing paid narration');scene.audioPath=voice;scene.durationSeconds=4;
 const inputHash=hash({version:1,model:'fixture',context:documentaryAiPlanContext(project)});
 doc.requirement={...doc.requirement,text:narration,entities:['Aurora'],identities:[{name:'Aurora',aliases:[]}],years:[],detail:target,
  queries:[target],preferredKind:'image',aiSearchPlan:{version:1,inputHash:hash({inputHash,sceneId:scene.id}),model:'fixture',
   subject:'Aurora',visualTarget:target,years:[],visualScope:'illustrative',preferredKind:'image',reservePolicy:'thematic',
   imageQueries:[target],videoQueries:[target+' footage'],fallbackVideoQueries:[target+' at sea'],fallbackVisualTarget:target+' at sea',
   grounding:{version:1,mandatory:[{kind:'identity',required:'Aurora',scriptQuote:narration},{kind:'condition',required:'red sails',scriptQuote:narration}],
    illustrations:['An identified view of Aurora with visible red sails depicts its sailcloth.'],optionalDetails:[]}}};
 doc.selectionPlan={kind:'video',videoPercent:project.settings.stockVideoPercent};doc.autoError='Previous image review did not finish';
 project=await projects.mutate(project.id,()=>project);
 const storage=new LocalProjectStorage(join(root,'projects')),directory=storage.projectDirectory(project.id);
 const sceneRoot=join(directory,'Documentary',scene.id),analysis=join(directory,'Documentary','Analysis');await mkdir(sceneRoot,{recursive:true});
 const imageBytes='Saved immutable image bytes',imageChecksum=bytesHash(imageBytes),videoBytes='Saved immutable video bytes',videoChecksum=bytesHash(videoBytes);
 const imageFile=join(sceneRoot,imageChecksum+'.jpg'),videoFile=join(sceneRoot,videoChecksum+'.mp4');
 await writeFile(imageFile,imageBytes);await writeFile(videoFile,videoBytes);
 const candidate=(kind:'image'|'video'):DocumentaryCandidate=>({id:kind==='image'?'commons:15663715':'youtube:old-pending-video',provider:kind==='image'?'commons':'youtube',
  kind,title:'Aurora with visible red sails',description:'An attributed view of Aurora under full sail',width:1280,height:kind==='image'?1462:720,
  ...(kind==='video'?{durationSeconds:4}:{}),localPath:kind==='image'?imageFile:videoFile,downloadUrl:'https://example.test/'+kind,
  pageUrl:'https://example.test/source',author:'Fixture',license:'public domain',licenseUrl:'',rights:'public-domain',attribution:'Fixture',query:target,
  retrievedAt:'fixture',match:'unverified',concerns:[]});
 const photo=candidate('image'),video=candidate('video');
 let seeding=true,currentModel=model,requestChanged=false;
 const dispatches:string[]=[],reviews:string[]=[],applications:string[]=[],searches:string[]=[];
 const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryAnalysisModel:async()=>currentModel,
  documentaryCompletion:async(...args:unknown[])=>{
   const input=JSON.parse(String(args[1]));dispatches.push(input.checksum);
   if(seeding)throw new Error('Simulated unknown transport outcome after dispatch');
   assert.equal(input.checksum,imageChecksum,'The unresolved video must never be submitted again');
   return JSON.stringify({description:'Offline fixture: matching ship and visible red sails',suitable:true,reason:'Fixture pixel verdict'});
  }},()=>directory);
 const complete=Reflect.get(intelligence,'complete').bind(intelligence) as (...args:unknown[])=>Promise<Record<string,unknown>>;
 const inspect=(selected:Scene)=>{
  const source=selected.documentary!.selected!,checksum=selected.documentary!.checksum!;
  // Only the image task/model varies in negative cases. The saved video keeps
  // its original canonical request, so its unknown response cannot be replayed.
  return complete(project.id,'visual-illustration','Inspect offline fixture',JSON.stringify({singleReview:true,singleReviewVersion:5,
   visualTarget:source.kind==='image'?selected.documentary!.requirement.aiSearchPlan!.visualTarget:target,narration:selected.narration,sourcePolicy:'background',requiredYears:[],
   analysisModel:source.kind==='image'?currentModel:model,checksum,fileRevision:{size:String(source.kind==='image'?imageBytes.length:videoBytes.length),mtimeNs:'1',ctimeNs:'1'},
   startSeconds:0,endSeconds:0,...(source.kind==='image'&&requestChanged?{sourceHint:{title:'Changed canonical request'}}:{})}),['data:image/jpeg;base64,AA==']);
 };
 const search=new DocumentarySearch();search.search=async input=>{searches.push(input.kind);return {candidates:[],sources:[]};};
 const service=new DocumentaryProjectService(projects,storage,search,join(root,'Materials'),{download:async()=>assert.fail('No download')},()=>{},
  {simpleSelection:true,selectionReviewIdentity:async()=>({model:currentModel,contract:'fixture'}),available:async()=>true,
   plan:async current=>new Map([[scene.id,current.scenes[0]!.documentary!.requirement]]),inspect:async()=>assert.fail('Use selection'),
   inspectForSelection:async(current,selected,_progress,_stop,cacheOnly)=>{
    if(cacheOnly&&!documentarySelectionRetry.getStore())throw new DocumentaryCachedAnalysisMissing();
    const source=selected.documentary!.selected!;
    if(!cacheOnly)reviews.push(source.kind);
    const before=dispatches.length,value=await inspect(selected);
    const review={status:value.suitable?'accepted' as const:'rejected' as const,confidence:1,reason:String(value.reason),
     viewDescription:String(value.description),quality:'',sampleSeconds:[0],checkedAt:'fixture',footageOrigin:'camera' as const,
     fastRelevance:{version:1 as const,target,relevant:true,evidence:'Offline fixture verdict'}};
    return {usedNewAnalysis:dispatches.length>before,review:{...review,illustrationApproval:documentaryIllustrationApproval(current,
     {...selected,documentary:{...selected.documentary!,visualReview:review}})}};
   }},undefined,undefined,{plan:async(_current,scenes)=>new Map(scenes.map(s=>[s.id,s.documentary!.requirement]))});
 Reflect.set(service,'selectionResources',async()=>({workers:1}));service.localCandidates=async()=>[];
 // This fixture isolates resume/receipt orchestration: source decoding and the
 // semantic verdict are mocked, while canonical Intelligence retry checks and
 // actual immutable file hashes remain real.
 Reflect.set(service,'apply',async(_projectId:string,_sceneId:string,source:DocumentaryCandidate)=>{
  applications.push(source.kind);
  const p=(await projects.get(project.id))!;
  return {...p,scenes:p.scenes.map(s=>s.id===scene.id?{...s,imagePath:source.kind==='image'?source.localPath:undefined,
   videoPath:source.kind==='video'?source.localPath:undefined,documentary:{...s.documentary!,selected:source,
    checksum:source.kind==='image'?imageChecksum:videoChecksum}}:s)};
 });
 await service.planSearch(project.id,[scene.id]);project=(await projects.get(project.id))!;
 project=await projects.mutate(project.id,()=>({scenes:[claimDocumentaryThematicRecovery(project,project.scenes[0]!)]}));
 assert.ok(documentaryThematicDiscoveryRequirement(project,project.scenes[0]!));
 const primary=(s:Scene):Scene=>({...s,documentary:{...s.documentary!,requirement:{...s.documentary!.requirement,footageFallback:undefined},searchRecovery:undefined}});
 const primaryScene=primary(project.scenes[0]!);
 const resumeBinding=(s:Scene)=>hash([s.narration,s.documentary!.requirement,documentarySceneContext(project,s),project.aspectRatio,s.documentary!.layout]);
 await inspect({...primaryScene,documentary:{...primaryScene.documentary!,selected:photo,checksum:imageChecksum}}).then(()=>assert.fail('Expected pending'),()=>{});
 await inspect({...project.scenes[0]!,documentary:{...project.scenes[0]!.documentary!,selected:video,checksum:videoChecksum}}).then(()=>assert.fail('Expected pending'),()=>{});
 assert.equal(dispatches.length,2);seeding=false;dispatches.length=0;
 const pending=await listDocumentaryRecovery(directory);
 // Read only the synthetic receipt identities; no real profile/permission is used.
 const receipts=await Promise.all((await readdir(analysis)).filter(name=>/^[a-f0-9]{64}\.json$/.test(name))
  .map(async name=>({name,body:JSON.parse(await readFile(join(analysis,name),'utf8'))})));
 const imageReceipt=receipts.find(row=>row.body.singleReviewBinding.checksum===imageChecksum)!,videoReceipt=receipts.find(row=>row.body.singleReviewBinding.checksum===videoChecksum)!;
 assert.equal(imageReceipt.body.state,'pending');assert.equal(videoReceipt.body.state,'pending');
 const permitItem=pending.find(item=>item.id===imageReceipt.name.slice(0,-5));assert.ok(permitItem);
 if(mode!=='no-grant')assert.equal(await new DocumentaryRetryPermissions().authorize(directory,[permitItem]),1);
 const videoReceiptBefore=await readFile(join(analysis,videoReceipt.name),'utf8');
 if(mode==='changed-model')currentModel='fixture/other-model';
 if(mode==='changed-request')requestChanged=true;
 if(mode==='altered-file')await writeFile(imageFile,imageBytes+' altered');
 if(mode==='missing')await rm(imageFile);
 if(mode==='empty')await writeFile(imageFile,'');
 if(mode==='directory'){await rm(imageFile);await mkdir(imageFile);}
 const manifest={...photo,checksum:imageChecksum,selectionBinding:mode==='unbound'?undefined:resumeBinding(primaryScene)};
 if(mode!=='remote-checksum')await writeFile(join(sceneRoot,imageChecksum+'.source.json'),JSON.stringify(manifest));
 project=await projects.mutate(project.id,current=>({scenes:current.scenes.map(s=>({...s,documentary:{...s.documentary!,
  candidates:mode==='remote-checksum'?[{...photo,checksum:imageChecksum} as DocumentaryCandidate,video]:mode==='ui-photo'?[photo,video]:[video],
  ...(mode==='pinned'?{pinned:true,selected:video}:{}),
  requirement:{...s.documentary!.requirement,...(mode==='manual-reserve'?{footageFallback:{...s.documentary!.requirement.footageFallback!,automaticRecovery:undefined}}:{}),
   aiSearchPlan:{...s.documentary!.requirement.aiSearchPlan!,...(mode==='changed-task'?{visualTarget:'Aurora hull details'}:{}),
    ...(mode==='video-preferred'?{preferredKind:'video' as const}:{})}}}}))}));
 const scopeScene=primary(project.scenes[0]!),requirement=scopeScene.documentary!.requirement;
 const scope=JSON.stringify([documentaryNarrationContext(project,scopeScene),requirement.entities,requirement.identities,requirement.years,requirement.detail,scopeScene.documentary!.motionGraphic]);
 const uncertainty=JSON.stringify({version:1,scope:hash([hash(['visual-rejection-v1',scope,project.aspectRatio,requirement.preferredKind,scopeScene.documentary!.layout]),currentModel]),
  keys:[hash([photo.provider,photo.id,undefined,undefined,undefined]),bytesHash('uncertain-file:'+imageChecksum)]});
 const uncertaintyPath=join(sceneRoot,'primary-photo-uncertain-candidates.json');await writeFile(uncertaintyPath,uncertainty);
 const result=await service.autoSelect(project.id,{sceneIds:[scene.id]});
 const success=mode==='exact'||mode==='ui-photo';
 assert.deepEqual(dispatches,success?[imageChecksum]:[],JSON.stringify({mode,reviews,applications,searches,failures:result.failures}));
 if(success){
  assert.deepEqual(reviews,['image']);assert.deepEqual(applications,['image']);
  assert.equal(result.project.scenes[0]!.documentary!.verified,true);
  assert.equal(result.project.scenes[0]!.documentary!.selected!.id,photo.id);
  assert.equal(result.project.scenes[0]!.documentary!.selected!.provider,'commons');
  assert.equal(await readDocumentarySelectionRetryGrant(analysis,permitItem.id),undefined);
  const authorizationPath=join(analysis,permitItem.id+'.retry-authorization.json');
  const authorizationBytes=await readFile(authorizationPath,'utf8');assert.ok(JSON.parse(authorizationBytes).consumedAt);
  await service.autoSelect(project.id,{sceneIds:[scene.id]});assert.deepEqual(dispatches,[imageChecksum],'The permit authorizes only one dispatch');
  assert.equal(await readFile(authorizationPath,'utf8'),authorizationBytes,'Resume does not reset or consume the permit a second time');
 }else if(mode!=='no-grant')assert.ok(await readDocumentarySelectionRetryGrant(analysis,permitItem.id),'A failed match must not consume the exact permit');
 assert.equal(await readFile(join(analysis,videoReceipt.name),'utf8'),videoReceiptBefore,'Unknown video receipt stays byte-identical');
 const savedUncertainty=JSON.parse(await readFile(uncertaintyPath,'utf8')),initialUncertainty=JSON.parse(uncertainty);
 assert.equal(savedUncertainty.scope,initialUncertainty.scope);
 for(const key of initialUncertainty.keys)assert.ok(savedUncertainty.keys.includes(key),'Retry admission does not delete the uncertainty history');
 assert.equal(result.project.scenes[0]!.audioPath,voice);assert.equal(await readFile(voice,'utf8'),'Existing paid narration');
 assert.equal(result.project.settings.stockVideoPercent,mode==='100-percent'?100:60);
});
