import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {createVoiceCalibration,type Project} from '@gold-work/shared';
import {prepareDocumentaryScript} from './documentary-plan.js';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {DocumentarySearch} from './documentary-search.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {effectFfmpeg} from './effect-media.js';
import {DocumentaryCachedAnalysisMissing} from './documentary-intelligence.js';
import {DocumentaryAnalysisError} from './documentary-analysis-error.js';
import {planFastDocumentaryScene} from './documentary-fast-plan.js';
import {documentaryIllustrationApproval} from './documentary-context-approval.js';
import {DocumentaryAiQueryPlanner} from './documentary-ai-query-planner.js';
import type {AnyModelClient} from './anymodel-client.js';

for(const mode of ['ordinary','pending','ai-illustrative','ai-fallback'] as const)test(`prepared zero-review original ${mode==='pending'?'protects an unknown receipt':mode==='ai-illustrative'?'retains the AI illustrative editor label':mode==='ai-fallback'?'retains its explicit thematic fallback explanation':'resumes without a search or another download'}`,async t=>{
 const pending=mode==='pending';
 const root=await mkdtemp(join(tmpdir(),'gws-prepared-resume-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
 let p=await projects.create({title:'Bird',topic:'Bird',mediaMode:'stock',mode:'standard',language:'English',aspectRatio:'16:9'});
 p.videoBrief={creationMode:'script',readyScript:'A bird moves in a tree.'} as Project['videoBrief'];
 p.settings.voice.enabled=false;p.settings.assembly.documentary!.autoMotionGraphics=false;
 const calibration=createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:'A measured voice reads naturally.',audioDurationSeconds:3});
 p.scenes=prepareDocumentaryScript(p,calibration);const s=p.scenes[0]!;s.durationSeconds=4;s.audioPath='existing-paid-voice.mp3';
 s.documentary!.timing={startFrame:0,durationInFrames:120,narrationDurationSeconds:4} as any;
 const file=join(root,'prepared.mp4');await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=size=1280x720:rate=10','-t','4','-c:v','libx264','-threads','1','-preset','ultrafast',file]);
 s.videoPath=file;s.documentary!.checksum=createHash('sha256').update(await readFile(file)).digest('hex');
 s.documentary!.selected={id:'prepared',provider:'local',kind:'video',title:'Bird',description:'Bird',localPath:file,durationSeconds:4,rights:'user-confirmed',width:1280,height:720} as any;
 p=await projects.mutate(p.id,()=>p);let newReviews=0,downloads=0,searches=0;
 const planner=mode.startsWith('ai-')?new DocumentaryAiQueryPlanner({documentaryQueryModel:async()=> 'fixture-text',documentaryCompletion:async(_system:string,input:string)=>
   JSON.stringify({scenes:JSON.parse(input).requestedScenes.map((row:{sceneId:string})=>({sceneId:row.sceneId,subject:'bird',visualTarget:'bird moving in a tree',years:[],visualScope:mode==='ai-fallback'?'exact':'illustrative',
     preferredKind:'video',imageQueries:['bird tree photo'],videoQueries:['bird moving tree'],fallbackVideoQueries:mode==='ai-fallback'?['bird in tree']:[],fallbackVisualTarget:mode==='ai-fallback'?'bird in a tree':''}))})} as unknown as AnyModelClient,id=>join(root,'plans',id)):undefined;
 if(mode==='ai-fallback'){
  const requirement=(await planner!.plan(p,p.scenes)).get(s.id)!;
  p=await projects.mutate(p.id,current=>({scenes:current.scenes.map(scene=>({...scene,documentary:{...scene.documentary!,requirement:{...requirement,
    footageFallback:{version:1,target:'bird in a tree',queries:['bird in tree'],narration:scene.narration,originalTarget:requirement.aiSearchPlan!.visualTarget,reason:'Fixture exact search failed'}}}}))}));
 }
 let savedReview:Awaited<ReturnType<import('./documentary-intelligence.js').DocumentaryIntelligence['inspectForSelection']>>['review']|undefined;
 const search=new DocumentarySearch();search.search=async()=>{searches++;return {candidates:[],sources:[]};};
 const service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,'projects')),search,join(root,'Materials'),
  {download:async()=>{downloads++;throw Error('Prepared source must not download');}},()=>{},
  {simpleSelection:true,available:async()=>true,plan:async()=>new Map(),inspect:async()=>{throw Error('Use one inspection');},inspectForSelection:async(project,scene,_progress,_stop,cacheOnly)=>{
    if(pending)throw new DocumentaryAnalysisError('Прежний оплаченный просмотр имеет неизвестный результат','pending');
    if(cacheOnly){if(savedReview)return {usedNewAnalysis:false,review:savedReview};throw new DocumentaryCachedAnalysisMissing();}
    newReviews++;
    const review={status:'accepted' as const,confidence:1,reason:'Mock orchestration evidence only',quality:'',sampleSeconds:[.12,2,3.88],checkedAt:'now',trimStartSeconds:0,trimEndSeconds:4,
      fastRelevance:{version:1 as const,target:planFastDocumentaryScene(project,scene).visualTarget,relevant:true,evidence:'Fixture bird subject moves in the tree'}};
    savedReview={...review,illustrationApproval:documentaryIllustrationApproval(project,{...scene,trimStartSeconds:0,trimEndSeconds:4,documentary:{...scene.documentary!,visualReview:review}})};
    return {usedNewAnalysis:true,review:savedReview};
  }},undefined,undefined,planner);
 Reflect.set(service,'selectionResources',async()=>({workers:1}));
 const result=await service.autoSelect(p.id);
 if(pending){assert.equal(newReviews,0);assert.equal(result.project.scenes[0]!.documentary!.verified,false);}
 else{assert.equal(newReviews,1);assert.equal(searches,0);assert.equal(downloads,0);assert.equal(result.selected,1);const accepted=result.project.scenes[0]!.documentary!;
   assert.equal(accepted.verified,true);assert.equal(accepted.pinned,false);assert.equal(accepted.illustrative,true);assert.equal(accepted.illustrationLabelInEditorOnly,true);
   if(mode==='ai-fallback'){assert.match(accepted.reviewNote,/Тематический видеоряд; не архив/);assert.ok(accepted.reviewNote.endsWith(accepted.visualReview!.reason));}
   else assert.equal(accepted.reviewNote,accepted.visualReview!.reason);
   if(mode==='ai-illustrative')assert.equal(accepted.requirement.aiSearchPlan!.visualScope,'illustrative');
   await service.autoSelect(p.id);assert.equal(newReviews,1);
   if(mode.startsWith('ai-')){
    await projects.mutate(p.id,current=>({scenes:current.scenes.map(scene=>({...scene,documentary:{...scene.documentary!,illustrative:false,illustrationLabelInEditorOnly:false}}))}));
    const oldReady=await service.autoSelect(p.id),corrected=oldReady.project.scenes[0]!.documentary!;
    assert.equal(corrected.verified,true);assert.equal(corrected.pinned,false);assert.equal(corrected.illustrative,true);assert.equal(corrected.illustrationLabelInEditorOnly,true);
    assert.equal(corrected.reviewNote,accepted.reviewNote);assert.equal(newReviews,1);assert.equal(searches,0);assert.equal(downloads,0);
   }
   await projects.mutate(p.id,current=>({scenes:current.scenes.map(scene=>({...scene,documentary:{...scene.documentary!,verified:false,illustrative:false,illustrationLabelInEditorOnly:false}}))}));
   const restored=await service.autoSelect(p.id),labels=restored.project.scenes[0]!.documentary!;
   assert.equal(newReviews,1);assert.equal(labels.verified,true);assert.equal(labels.pinned,false);assert.equal(labels.illustrative,true);assert.equal(labels.illustrationLabelInEditorOnly,true);
   assert.equal(labels.reviewNote,accepted.reviewNote);assert.deepEqual(labels.visualReview,accepted.visualReview);
   if(mode==='ai-illustrative'){
    await projects.mutate(p.id,current=>({scenes:current.scenes.map(scene=>({...scene,documentary:{...scene.documentary!,pinned:true,illustrative:false,illustrationLabelInEditorOnly:false,reviewNote:'Manual preserved note'}}))}));
    const manual=(await service.autoSelect(p.id)).project.scenes[0]!.documentary!;
    assert.equal(manual.pinned,true);assert.equal(manual.illustrative,false);assert.equal(manual.illustrationLabelInEditorOnly,false);assert.equal(manual.reviewNote,'Manual preserved note');assert.equal(newReviews,1);
   }
  }
 assert.equal(result.project.scenes[0]!.audioPath,'existing-paid-voice.mp3');
});
