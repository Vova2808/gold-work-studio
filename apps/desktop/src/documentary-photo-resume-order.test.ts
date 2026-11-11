import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
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

for(const mode of ['resume','photo-rejected','no-error','mixed-shortlist','100-percent','force','pending-photo','manual-photo'] as const)
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
 doc.candidates=mode==='mixed-shortlist'?[candidate('image'),candidate('video')]:[candidate('image')];
 if(mode!=='no-error')doc.autoError='Previous image lane did not find visible sailcloth.';
 if(mode==='manual-photo'){
  scene.imagePath=photo;doc.selected={...candidate('image'),id:'manual:preserved-photo',rights:'user-confirmed'};
  doc.verified=true;doc.pinned=true;doc.reviewNote='User selected this photo';
 }
 project=await projects.mutate(project.id,()=>project);
 const beforeManual=structuredClone(project.scenes[0]!);
 const searches:Array<'image'|'video'>=[],reviews:Array<'image'|'video'>=[];
 const search=new DocumentarySearch();search.search=async input=>{searches.push(input.kind);return {candidates:[candidate(input.kind)],sources:[]};};
 const service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,'projects')),search,join(root,'Materials'),
  {download:async()=>assert.fail('A local prepared candidate must not download again')},()=>{},
  {simpleSelection:true,available:async()=>true,plan:async()=>new Map([[scene.id,doc.requirement]]),inspect:async()=>assert.fail('Use selection review'),
   inspectForSelection:async(current,selected,_progress,_stop,cacheOnly)=>{
    if(cacheOnly)throw new DocumentaryCachedAnalysisMissing();
    const kind=selected.documentary!.selected!.kind;reviews.push(kind);
    if(kind==='image'&&mode==='pending-photo')throw new DocumentaryAnalysisError('Unknown paid image response','pending');
    // Semantic outcomes are mocked. The local patterns exercise transport,
    // preparation and persistence only; they are not photographs of a vessel.
    const accepted=kind==='image'&&mode!=='photo-rejected';
    const review={status:accepted?'accepted' as const:'rejected' as const,confidence:1,reason:accepted?'Mock matching sailcloth':'Mock missing sailcloth',
     viewDescription:'Mock frame description',quality:'',sampleSeconds:kind==='video'?[0,2,3.8]:[0],checkedAt:'now',footageOrigin:'camera' as const,
     fastRelevance:{version:1 as const,target:'Aurora red sails',relevant:accepted,evidence:'Mock visual verdict'}};
    return {usedNewAnalysis:true,review:{...review,...(accepted?{illustrationApproval:documentaryIllustrationApproval(current,
     {...selected,documentary:{...selected.documentary!,visualReview:review}})}:{})}};
   }});
 Reflect.set(service,'selectionResources',async()=>({workers:1}));service.localCandidates=async()=>[];
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
 }else if(mode==='pending-photo'){
  assert.equal(reviews[0],'image');assert.equal(reviews.filter(kind=>kind==='image').length,1);assert.equal(saved.documentary!.verified,false);
  await service.autoSelect(project.id,{sceneIds:[scene.id]});
  assert.equal(reviews.filter(kind=>kind==='image').length,1,'A second resume cannot submit the pending photo again');
 }else{
  const expected=mode==='resume'?['image']:mode==='photo-rejected'?['image','video']:mode==='100-percent'?['video']:['video','image'];
  assert.deepEqual(reviews,expected,JSON.stringify({searches,failures:result.failures}));
  if(mode==='resume')assert.ok(searches.every(kind=>kind==='image'),'No video discovery before successful resumed photo');
  assert.equal(saved.documentary!.verified,!['photo-rejected','100-percent'].includes(mode));
  if(saved.documentary!.verified)assert.equal(documentarySavedContextIssue(result.project,saved),undefined);
 }
});
