import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {createVoiceCalibration,documentaryFixedRange,documentaryVideoCoverage,type Scene,type Project} from '@gold-work/shared';
import {prepareDocumentaryScript} from './documentary-plan.js';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {DocumentarySearch} from './documentary-search.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {effectFfmpeg} from './effect-media.js';
import {documentaryPhotoFallbackStatus} from './documentary-photo-fallback.js';
import {DocumentarySelectionSession} from './documentary-selection-session.js';

test('staged local replacement preserves the scene until Apply; ranges, stale edits and individual cuts are protected',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-manual-stage-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
  const storage=new LocalProjectStorage(join(root,'Projects'));
  const service=new DocumentaryProjectService(projects,storage,new DocumentarySearch(),join(root,'Materials'),{download:async()=>{throw Error('No network');}});
  let project=await projects.create({title:'Manual footage QA',topic:'Machines',mediaMode:'stock',mode:'standard',language:'English',aspectRatio:'16:9'});
  project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:'A tractor works in a field.'};
  project.scenes=prepareDocumentaryScript(project,createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:'A measured voice reads every word.',audioDurationSeconds:4}));
  const target=project.scenes[0]!;
  target.durationSeconds=6;target.durationOverrideSeconds=6;target.playbackRate=1.5;target.audioPath='keep-voice.wav';
  target.documentary!.timing=undefined;target.documentary!.cuts=undefined;
  project=await projects.update(project.id,project);
  const video=join(root,'source.mp4');
  await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=size=1280x720:rate=30','-t','12','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',video]);
  const input={path:video,title:'My original',author:'Me',pageUrl:'',license:'Owned',licenseUrl:''};
  const before=structuredClone((await projects.get(project.id))!.scenes);
  const stage=await service.stageImport(project.id,target.id,input);
  assert.deepEqual((await projects.get(project.id))!.scenes,before,'Downloading must not change the old selection or narration');
  assert.equal(await stat(stage.scene.videoPath!).then(info=>info.isFile()),true);
  const apply={stageId:stage.id,startSeconds:4,illustrative:false,note:'',rightsConfirmed:true};
  await assert.rejects(service.applyStage(project.id,target.id,apply),/внутри исходного/);
  assert.deepEqual((await projects.get(project.id))!.scenes,before);
  const updated=await service.applyStage(project.id,target.id,{...apply,startSeconds:2});
  const accepted=updated.scenes[0]!;
  assert.equal(accepted.audioPath,'keep-voice.wav');assert.equal(accepted.narration,target.narration);
  assert.equal(accepted.trimStartSeconds,2);assert.equal(accepted.trimEndSeconds,11);
  assert.equal(accepted.documentary!.pinned,true);assert.equal(accepted.documentary!.verified,true);
  assert.equal((await service.localCandidates('My original'))[0]!.rights,'user-confirmed');
  const stale=await service.stageImport(project.id,target.id,input);
  await projects.mutate(project.id,current=>({scenes:current.scenes.map(scene=>scene.id===target.id?{...scene,playbackRate:1}:scene)}));
  await assert.rejects(service.applyStage(project.id,target.id,{...apply,stageId:stale.id}),/изменилась/);
  await projects.mutate(project.id,current=>({scenes:current.scenes.map(scene=>scene.id===target.id?{...scene,documentary:{...scene.documentary!,cuts:[
    {id:'cut-a',fromFrame:0,durationInFrames:60,trimStartSeconds:2,trimEndSeconds:4,playbackRate:1},
    {id:'cut-b',fromFrame:60,durationInFrames:120,trimStartSeconds:4,trimEndSeconds:8,playbackRate:1},
  ]}}:scene)}));
  const cutStage=await service.stageImport(project.id,target.id,input);
  const prior=(await projects.get(project.id))!.scenes[0]!;
  const cutProject=await service.applyStage(project.id,target.id,{...apply,stageId:cutStage.id,startSeconds:9,cutId:'cut-a',illustrative:true,note:'Thematic illustration'});
  const parent=cutProject.scenes[0]!,source=cutProject.scenes.find(scene=>scene.id===parent.documentary!.cuts![0]!.sourceSceneId)!;
  assert.equal(parent.videoPath,prior.videoPath);assert.equal(parent.audioPath,prior.audioPath);
  assert.deepEqual(parent.documentary!.cuts![1],prior.documentary!.cuts![1]);
  assert.equal(parent.documentary!.cuts![0]!.trimEndSeconds,11);
  assert.equal(source.includeInAssembly,false);assert.equal(source.documentary!.pinned,true);
  assert.equal(source.documentary!.illustrationLabelInEditorOnly,true);
});

test('fallback allocation counts planned video scenes, excludes manual choices and never rounds up',()=>{
  const scenes=Array.from({length:10},(_,i)=>({id:String(i),includeInAssembly:true,documentary:{selectionPlan:{kind:'video',videoPercent:100},verified:true,pinned:false,selected:{kind:i===0?'image':'video'}}} as Scene));
  const project={scenes} as Project;
  assert.deepEqual(documentaryPhotoFallbackStatus(project),{planned:10,used:1,limit:1,allowed:false});
  scenes[0]!.documentary!.pinned=true;
  assert.equal(documentaryPhotoFallbackStatus(project).used,0);
  assert.equal(documentaryPhotoFallbackStatus({...project,scenes:scenes.slice(1)}).limit,0);
});

test('analysis budgets survive refinements, exclude idle phases and do not consume a cached answer',()=>{
  let now=0;const session=new DocumentarySelectionSession(()=>now);
  for(let i=0;i<3;i++)session.takeAnalysis('s','image');
  assert.throws(()=>session.takeAnalysis('s','image'),/бюджет/);
  session.pause('s');now=600000;session.resume('s');
  assert.equal(session.remaining('s','image'),60000);
  session.blockPhotoFallback('s');assert.equal(session.photoFallbackBlocked('s'),true);
  const scene={durationSeconds:6,playbackRate:1.5,documentary:{}} as Scene;
  assert.equal(documentaryFixedRange(scene,2,12).endSeconds,11);
  assert.throws(()=>documentaryFixedRange(scene,0,8),/короткий/);
  session.pause('queued');now+=600000;
  session.canAttempt('queued','video');session.resume('queued');
  assert.equal(session.remaining('queued','video'),120000,'A later queue slot retains its full active budget');
});

test('video coverage follows a manually replaced cut and excludes the hidden source from total duration',()=>{
  const photo={id:'photo',includeInAssembly:true,durationSeconds:6,documentary:{verified:true,selected:{kind:'image'},cuts:[
    {id:'a',fromFrame:0,durationInFrames:60,sourceSceneId:'source',trimStartSeconds:3,trimEndSeconds:5,playbackRate:1},
    {id:'b',fromFrame:60,durationInFrames:120,trimStartSeconds:0,playbackRate:1},
  ]}} as Scene;
  const source={id:'source',includeInAssembly:false,durationSeconds:10,videoPath:'owned.mp4',documentary:{verified:true,selected:{kind:'video',durationSeconds:10}}} as Scene;
  assert.deepEqual(documentaryVideoCoverage([photo,source]),{videoSeconds:2,totalSeconds:6,percent:33});
});
