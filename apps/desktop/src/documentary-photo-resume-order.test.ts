import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {documentaryAiPlanContext,type DocumentaryCandidate} from '@gold-work/shared';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {DocumentarySearch} from './documentary-search.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {prepareDocumentaryScript} from './documentary-plan.js';
import {documentaryIllustrationApproval,documentarySavedContextIssue} from './documentary-context-approval.js';
import {DocumentaryAnalysisError} from './documentary-analysis-error.js';
import {DocumentaryCachedAnalysisMissing} from './documentary-intelligence.js';
import {documentaryCheckedVideoCoverage} from './documentary-automatic-native-recovery.js';
import {effectFfmpeg} from './effect-media.js';
import {claimDocumentaryThematicRecovery,documentaryAutomaticThematicIssue,documentaryThematicDiscoveryRequirement} from './documentary-automatic-thematic-recovery.js';

for(const mode of ['resume','photo-rejected','no-error','mixed-shortlist','mixed-photo-rejected','automatic-reserve','automatic-reserve-rejected','automatic-reserve-pending','refresh-remote','refresh-local','refresh-unmatched','refresh-excerpts','refresh-pending','manual-reserve','100-percent','force','pending-photo','manual-photo'] as const)
test(`saved primary photo lane resumes conservatively: ${mode}`,async t=>{
 const root=await mkdtemp(join(tmpdir(),'gws-photo-resume-order-'));t.after(()=>rm(root,{recursive:true,force:true}));
 t.mock.method(globalThis,'fetch',async()=>assert.fail('No live requests in this fixture'));
 const photo=join(root,'fixture.png'),video=join(root,'fixture.mp4');
 await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=size=1280x720','-frames:v','1',photo]);
 await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=size=1280x720:rate=10','-t','4','-c:v','libx264','-threads','1','-preset','ultrafast',video]);
 const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
 let project=await projects.create({title:'A vessel',topic:'A vessel',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
 const narration='Aurora carried a wide spread of red sails.';
 project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:narration};
 project.settings.stockVideoPercent=mode==='100-percent'?100:60;project.settings.voice.enabled=false;
 project.settings.assembly.documentary!.autoMotionGraphics=false;project.settings.assembly.documentary!.autoEffects=false;
 project.scenes=[prepareDocumentaryScript(project)[0]!];const scene=project.scenes[0]!,doc=scene.documentary!;
 scene.durationSeconds=4;scene.audioPath='preserved-paid-voice.wav';
 const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 const inputHash=hash({version:1,model:'fixture',context:documentaryAiPlanContext(project)});
 doc.requirement={...doc.requirement,text:narration,entities:['Aurora'],identities:[{name:'Aurora',aliases:[]}],years:[],
  preferredKind:'image',queries:['Aurora red sails'],aiSearchPlan:{version:1,inputHash:hash({inputHash,sceneId:scene.id}),model:'fixture',
   subject:'Aurora',visualTarget:'Aurora red sails',years:[],visualScope:'illustrative',preferredKind:'image',reservePolicy:'thematic',
   imageQueries:['Aurora red sails photograph'],videoQueries:['Aurora red sails footage'],fallbackVideoQueries:[],fallbackVisualTarget:'',
   grounding:{version:1,mandatory:[{kind:'identity',required:'Aurora',scriptQuote:narration},{kind:'condition',required:'red sails',scriptQuote:narration}],
    illustrations:['An identified view of Aurora with visible red sails depicts the narrated sailcloth.'],optionalDetails:[]}}};
 doc.selectionPlan={kind:'video',videoPercent:project.settings.stockVideoPercent};
 const candidate=(kind:'image'|'video'):DocumentaryCandidate=>({id:`fixture-${kind}`,provider:'commons',kind,title:'Aurora under red sails',
  description:'An attributed view of Aurora with its red sails',localPath:kind==='image'?photo:video,width:1280,height:720,
  ...(kind==='video'?{durationSeconds:4}:{}),downloadUrl:`https://example.test/${kind}`,pageUrl:`https://example.test/${kind}`,
  author:'Fixture',license:'public domain',licenseUrl:'',rights:'public-domain',attribution:'Fixture',query:'Aurora red sails',retrievedAt:'now',match:'unverified',concerns:[]});
 doc.candidates=['mixed-shortlist','mixed-photo-rejected'].includes(mode)?[candidate('image'),candidate('video')]:[candidate('image')];
 const refresh=mode.startsWith('refresh-');
 const originalUrl='https://upload.wikimedia.org/wikipedia/commons/a/ab/Aurora.jpg';
 const freshUrl='https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Aurora.jpg/1280px-Aurora.jpg';
 const oldSource:DocumentaryCandidate={...candidate('image'),id:'commons:14491633',localPath:mode==='refresh-local'?photo:undefined,downloadUrl:originalUrl};
 const freshSource:DocumentaryCandidate={...oldSource,localPath:undefined,downloadUrl:freshUrl};
 if(mode==='refresh-excerpts'){
  oldSource.excerpt={sourceChecksum:'a'.repeat(64),startSeconds:4,endSeconds:8,sourceDurationSeconds:12};
  freshSource.excerpt={...oldSource.excerpt,startSeconds:0,endSeconds:4};
 }
 if(refresh)doc.candidates=[oldSource,...(mode==='refresh-unmatched'?[{...oldSource,id:'commons:unmatched',downloadUrl:originalUrl.replace('Aurora.jpg','Aurora-other.jpg')}]:[])];
 if(mode!=='no-error')doc.autoError='Previous image lane did not find visible sailcloth.';
 const automaticReserve=mode.startsWith('automatic-reserve');
 if(automaticReserve||mode==='manual-reserve'){
  doc.requirement.aiSearchPlan!.fallbackVisualTarget='Aurora red sails at sea';
  doc.requirement.aiSearchPlan!.fallbackVideoQueries=['Aurora red sails at sea'];
  if(mode==='manual-reserve')doc.requirement.footageFallback={version:1,target:'Aurora red sails at sea',queries:['Aurora red sails at sea'],kind:'video',
   originalTarget:'Aurora red sails',narration,reason:'Earlier bounded primary search was exhausted'};
 }
 if(mode==='manual-photo'){
  scene.imagePath=photo;doc.selected={...candidate('image'),id:'manual:preserved-photo',rights:'user-confirmed'};
  doc.verified=true;doc.pinned=true;doc.reviewNote='User selected this photo';
 }
 project=await projects.mutate(project.id,()=>project);
 const beforeManual=structuredClone(project.scenes[0]!);
 const searches:Array<'image'|'video'>=[],reviews:Array<'image'|'video'>=[],downloads:string[]=[];
 let refreshPending=mode==='refresh-pending';
 const search=new DocumentarySearch();search.search=async input=>{
  searches.push(input.kind);
  return {candidates:automaticReserve&&input.kind==='image'?[]:refresh&&input.kind==='image'?[refreshPending?oldSource:freshSource]:[candidate(input.kind)],sources:[]};
 };
 const service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,'projects')),search,join(root,'Materials'),
  {download:async()=>assert.fail('A local prepared candidate must not download again')},()=>{},
  {simpleSelection:true,available:async()=>true,plan:async current=>new Map([[scene.id,current.scenes[0]!.documentary!.requirement]]),inspect:async()=>assert.fail('Use selection review'),
   inspectForSelection:async(current,selected,_progress,_stop,cacheOnly)=>{
    if(cacheOnly)throw new DocumentaryCachedAnalysisMissing();
    const kind=selected.documentary!.selected!.kind;reviews.push(kind);
    if(kind==='image'&&automaticReserve){
     assert.equal(selected.documentary!.requirement.footageFallback,undefined,'Primary photos are checked against the primary task, not the video reserve');
     assert.equal(selected.documentary!.requirement.aiSearchPlan!.visualTarget,'Aurora red sails');
     assert.deepEqual(selected.documentary!.requirement.identities,[{name:'Aurora',aliases:[]}]);
     assert.deepEqual(selected.documentary!.requirement.aiSearchPlan!.grounding!.mandatory,doc.requirement.aiSearchPlan!.grounding!.mandatory);
    }
    if(kind==='image'&&['pending-photo','automatic-reserve-pending','refresh-pending'].includes(mode))throw new DocumentaryAnalysisError('Unknown paid image response','pending');
    // Semantic outcomes are mocked. The local patterns exercise transport,
    // preparation and persistence only; they are not photographs of a vessel.
    const accepted=kind==='image'&&!['photo-rejected','mixed-photo-rejected','automatic-reserve-rejected'].includes(mode);
    const review={status:accepted?'accepted' as const:'rejected' as const,confidence:1,reason:accepted?'Mock matching sailcloth':'Mock missing sailcloth',
     viewDescription:'Mock frame description',quality:'',sampleSeconds:kind==='video'?[0,2,3.8]:[0],checkedAt:'now',footageOrigin:'camera' as const,
     fastRelevance:{version:1 as const,target:'Aurora red sails',relevant:accepted,evidence:'Mock visual verdict'}};
    return {usedNewAnalysis:true,review:{...review,...(accepted?{illustrationApproval:documentaryIllustrationApproval(current,
     {...selected,documentary:{...selected.documentary!,visualReview:review}})}:{})}};
   }},undefined,undefined,automaticReserve||mode==='manual-reserve'||refresh?{
    // The application supplies a current AI query planner. A fixture without
    // it enters legacy local planning, which rewrites requirement
    // fields and invalidates the automatic reserve's authored-input binding.
    plan:async(_current,scenes)=>new Map(scenes.map(source=>[source.id,source.documentary!.requirement])),
   }:undefined,undefined,async url=>{
    assert.ok(refresh&&mode!=='refresh-local','Prepared local media must not download');
    const address=String(url);downloads.push(address);
    assert.equal(address,refreshPending?originalUrl:freshUrl,'Fresh same-source metadata must replace the old remote URL');
    return new Response(new Uint8Array(await readFile(photo)),{headers:{'content-type':'image/png'}});
   });
 Reflect.set(service,'selectionResources',async()=>({workers:1}));service.localCandidates=async()=>[];
 if(automaticReserve){
  await service.planSearch(project.id,[scene.id]);
  project=(await projects.get(project.id))!;
  assert.equal(documentaryAutomaticThematicIssue(project,project.scenes[0]!),undefined);
  const resumed=claimDocumentaryThematicRecovery(project,project.scenes[0]!);
  project=await projects.mutate(project.id,()=>({scenes:[resumed]}));
  assert.ok(documentaryThematicDiscoveryRequirement(project,project.scenes[0]!),'The saved automatic fallback must be active before resume');
 }
 const result=await service.autoSelect(project.id,{sceneIds:[scene.id],...(mode==='force'?{force:true}:{})});
 const saved=result.project.scenes[0]!;
 assert.equal(saved.audioPath,'preserved-paid-voice.wav');
 assert.equal(result.project.settings.stockVideoPercent,project.settings.stockVideoPercent);
 assert.deepEqual(saved.documentary!.selectionPlan,{kind:'video',videoPercent:project.settings.stockVideoPercent},'Resume order must not rewrite the quota slot');
 assert.equal(documentaryCheckedVideoCoverage(result.project).videoSeconds,0,'A photo never satisfies the moving-video quota');
 if(mode==='manual-photo'){
  assert.deepEqual(reviews,[]);assert.deepEqual(searches,[]);
  assert.equal(saved.imagePath,beforeManual.imagePath);assert.equal(saved.documentary!.pinned,true);
  assert.deepEqual(saved.documentary!.selected,beforeManual.documentary!.selected);assert.equal(saved.documentary!.reviewNote,'User selected this photo');
 }else if(['pending-photo','automatic-reserve-pending','refresh-pending'].includes(mode)){
  assert.equal(reviews[0],'image');assert.equal(reviews.filter(kind=>kind==='image').length,1);assert.equal(saved.documentary!.verified,false);
  const uncertain=mode==='refresh-pending'?join(root,'projects',project.id,'Documentary',scene.id,'uncertain-candidates.json'):undefined;
  const beforeUncertain=uncertain?await readFile(uncertain,'utf8'):undefined;
  refreshPending=false;
  await service.autoSelect(project.id,{sceneIds:[scene.id]});
  assert.equal(reviews.filter(kind=>kind==='image').length,1,'A second resume cannot submit the pending photo again');
  if(uncertain){assert.equal(await readFile(uncertain,'utf8'),beforeUncertain);assert.deepEqual(downloads,[originalUrl],'A new URL cannot bypass the same-source pending guard');}
 }else{
  const expected=refresh||['resume','mixed-shortlist','automatic-reserve'].includes(mode)?['image']:['photo-rejected','mixed-photo-rejected','automatic-reserve-rejected'].includes(mode)?['image','video']:['100-percent','manual-reserve'].includes(mode)?['video']:['video','image'];
  assert.deepEqual(reviews,expected,JSON.stringify({searches,failures:result.failures}));
  if(['resume','mixed-shortlist','automatic-reserve'].includes(mode))assert.ok(searches.every(kind=>kind==='image'),'No video discovery before successful resumed photo');
  assert.equal(saved.documentary!.verified,!['photo-rejected','mixed-photo-rejected','automatic-reserve-rejected','100-percent','manual-reserve'].includes(mode));
  if(saved.documentary!.verified)assert.equal(documentarySavedContextIssue(result.project,saved),undefined);
  if(refresh){
   assert.equal(saved.documentary!.selected!.id,oldSource.id);assert.equal(saved.documentary!.selected!.provider,'commons');
   assert.equal(saved.documentary!.selected!.downloadUrl,mode==='refresh-local'?originalUrl:freshUrl);
   assert.deepEqual(downloads,mode==='refresh-local'?[]:[freshUrl]);
   if(mode==='refresh-local')assert.deepEqual(await readFile(photo),await readFile(saved.documentary!.selected!.localPath!));
   if(mode==='refresh-unmatched')assert.ok(saved.documentary!.candidates.some(source=>source.id==='commons:unmatched'),'An unmatched saved remote source stays available');
   if(mode==='refresh-excerpts')assert.deepEqual(saved.documentary!.candidates.filter(source=>source.id===oldSource.id).map(source=>source.excerpt?.startSeconds).sort(),[0,4],
    'Different excerpt identities of one source must not collapse');
  }
 }
});
