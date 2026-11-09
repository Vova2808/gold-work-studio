import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import type {DocumentaryArtwork,Project} from '@gold-work/shared';
import {planArtworkPhases} from './documentary-artwork-phase-renderer.js';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {semanticMontageHash} from './documentary-semantic-montage.js';
import {motionArtworkHash} from './documentary-artwork-plan.js';
import {validateMotionArtwork} from './documentary-artwork-plan.js';
import {assessArtworkReplacement} from './documentary-artwork-quality.js';
import {artworkSourceCandidates} from './documentary-artwork-previews.js';
import {planDocumentaryMontage} from './documentary-montage.js';
import {buildDocumentaryTimeline} from '@gold-work/remotion-video';
import type {ArtworkRevisionPreviewRow} from './documentary-artwork-revision.js';

function fixture(){
 const artwork:DocumentaryArtwork={version:1,intent:'Water cycle',layout:'full',canvas:{width:1000,height:562},
  palette:{background:'#f5f3ef',ink:'#222222',accent:'#dd4433',secondary:'#8899aa'},startSeconds:0,durationSeconds:12,
  layers:[{id:'water',kind:'ellipse',x:100,y:400,w:300,h:100,fill:'accent'},
   {id:'vapor',kind:'path',x:200,y:100,w:200,h:300,path:'M0 300Q200 200 0 100Q200 0 100 0',stroke:'ink'},
   {id:'cloud',kind:'ellipse',x:400,y:100,w:400,h:200,fill:'secondary'}]};
 const project={id:'preview',mediaMode:'stock',aspectRatio:'16:9',language:'en',settings:{voice:{enabled:false},music:{enabled:false},assembly:{kenBurns:true,
  documentary:{version:2,autoMotionGraphics:true,autoEffects:false,autoTransitions:false,montage:{version:1,style:'editorial',intensity:'rich',musicPolicy:'preserve'}}}},
  scenes:[90,90,120,150].map((frames,i)=>({id:`water-${i}`,order:i,narration:'Water evaporates and forms clouds.',durationSeconds:frames/30,imagePath:`source-${i}.jpg`,
   documentary:{verified:true,checksum:`source-${i}`,layout:'full',effects:[],caption:{enabled:false,text:''},selected:{id:`source-${i}`,kind:'image',width:1920,height:1080},
    requirement:{text:'Water evaporates and forms clouds.',identities:[],years:[],accent:'none'},timing:{sourceKey:`voice-${i}`,durationInFrames:frames,speechSeconds:frames/30},
    semanticMontage:{sceneId:`water-${i}`,subject:'',beat:'explain',treatment:'footage',cutawaySceneIds:[]}}}))} as unknown as Project;
 return {project,artwork,rows:[{sceneId:'water-1',endSceneId:'water-3',artwork}]};
}

test('artwork preview samples entrance, action and hold on the actual shared montage clock',()=>{
 const {project,rows}=fixture(),before=structuredClone(project),{timeline,items}=planArtworkPhases(project,rows);
 assert.equal(items[0]!.frames,360);
 assert.deepEqual(items[0]!.phases.map(p=>p.artworkFrame),[14,172,316]);
 assert.deepEqual(items[0]!.phases.map(p=>p.globalFrame),[104,262,406]);
 assert.deepEqual(timeline.scenes.slice(1).map(s=>s.documentary!.motionGraphic!.sequenceOffsetFrames),[0,90,210]);
 assert.deepEqual(items[0]!.phases.map(p=>p.t),[14/359,172/359,316/359]);
 assert.deepEqual(project,before);
 for(const protection of ['motion-zero','manual'] as const){
  const protectedProject=structuredClone(project),d=protectedProject.scenes[2]!.documentary!;
  if(protection==='motion-zero')d.templateMotion={amountPercent:0,curve:'smooth'};
  else d.motionGraphic={enabled:true,origin:'manual',kind:'quote',title:'Authored',startSeconds:0,durationSeconds:4};
  assert.throws(()=>planArtworkPhases(protectedProject,rows),/не применяется/);
 }
});

test('photographic phases retain the current original image or trimmed video and authored motion',()=>{
 for(const kind of ['image','video'] as const){
  const {project,artwork}=fixture(),directory=join(tmpdir(),'gws-photographic-preview');
  const scene=project.scenes[2]!,doc=scene.documentary!;
  const original=join(directory,`accepted.${kind==='image'?'jpg':'mp4'}`);
  scene.imagePath=kind==='image'?join(directory,'Documentary','Playback',`${doc.checksum}-3840.png`):join(directory,'poster.jpg');
  scene.videoPath=kind==='video'?original:undefined;
  scene.trimStartSeconds=4.25;scene.trimEndSeconds=9.25;scene.playbackRate=1.25;
  doc.selected={...doc.selected!,kind,localPath:original,durationSeconds:20};
  doc.semanticMontage={...doc.semanticMontage!,artworkMode:'photographic'};
  const drawing:DocumentaryArtwork={...artwork,intent:'The current source explains the narrated relationship',startSeconds:.5,durationSeconds:3,
   camera:{keyframes:[{t:0,x:500,y:281,scale:1},{t:1,x:510,y:281,scale:1.08}]},layers:[
    {id:'current-source',kind:'media',x:80,y:60,w:750,h:440,shadow:true,
     keyframes:[{t:0,x:0,scale:1,ease:'linear'},{t:1,x:30,scale:1.1,ease:'linear'}]},
    {id:'water-transfer',kind:'path',x:850,y:150,w:80,h:200,path:'M40 0Q80 90 80 140Q80 200 40 200Q0 200 0 140Q0 90 40 0Z',fill:'accent',
     keyframes:[{t:0,scale:.6},{t:1,scale:1}]},
    {id:'label',kind:'text',x:840,y:400,w:110,h:70,text:'Water',fontSize:40}]};
  const rows=[{sceneId:scene.id,artwork:drawing}],before=structuredClone(project);
  const {timeline,items}=planArtworkPhases(project,rows,directory),item=items[0]!,mounted=timeline.scenes[item.first]!;
  assert.equal(item.first,2);assert.equal(item.last,2);assert.equal(item.frames,90);
  assert.deepEqual(item.phases.map(phase=>phase.globalFrame),[199,238,273]);
  assert.equal(kind==='image'?mounted.imagePath:mounted.videoPath,original,'preview uses the same original as Final');
  assert.equal(mounted.trimStartSeconds,4.25);assert.equal(mounted.trimEndSeconds,9.25);assert.equal(mounted.playbackRate,1.25);
  assert.equal(mounted.motion,true);assert.equal(mounted.documentary!.selected!.durationSeconds,20);
  assert.deepEqual(mounted.documentary!.motionGraphic!.artwork,drawing);
  assert.deepEqual(mounted.documentary!.motionGraphic!.artwork!.layers[0]!.keyframes,drawing.layers[0]!.keyframes,
   'Final receives the authored media travel and scale rather than a static replacement');
  assert.deepEqual(item.phases.map(phase=>phase.globalFrame-mounted.fromFrame-Math.round(drawing.startSeconds*timeline.fps)),[4,43,78]);
  assert.equal(mounted.narrationEnabled,false);assert.equal(mounted.sourceVolume,0);
  assert.deepEqual(project,before,'preview planning cannot replace the project source or its timing');
  const missing=structuredClone(project);missing.scenes[2]!.imagePath=undefined;missing.scenes[2]!.videoPath=undefined;
  assert.throws(()=>planArtworkPhases(missing,rows),/не применяется/);
  assert.throws(()=>planArtworkPhases(project,[{...rows[0]!,endSceneId:project.scenes[3]!.id}]),/не применяется/);
 }
});

test('editor previews a validated weak draft without weakening Final quality or protected-scene guards',()=>{
 const {project,artwork}=fixture(),scene=project.scenes[2]!;
 const checked=validateMotionArtwork({...artwork,startSeconds:.5,durationSeconds:3,layers:[
  {id:'whole',kind:'media',sourceSceneId:scene.id,x:30,y:30,w:600,h:480,
   keyframes:[{t:0,x:0,scale:1},{t:.76,x:30,scale:1.06},{t:1,x:30,scale:1.06}]},
  {id:'detail',kind:'media',sourceSceneId:scene.id,sourceWindow:{x:.25,y:.25,w:.5,h:.5},clip:'ellipse',x:680,y:80,w:280,h:260},
  {id:'label',kind:'text',x:680,y:400,w:280,h:70,text:'Water',fontSize:40}]},scene.narration,4,true,16/9,
  {...scene.documentary!.selected,currentSceneId:scene.id,allowedSources:artworkSourceCandidates(project,scene.id)});
 assert.ok(checked.artwork,checked.issue);
 const draft=checked.artwork,rows=[{sceneId:scene.id,artwork:draft}];
 assert.deepEqual(assessArtworkReplacement(draft),{allowReplacement:false,reason:'static-media-board'});
 scene.documentary!.semanticMontage={...scene.documentary!.semanticMontage!,artwork:draft};
 const before=structuredClone(project),hash=motionArtworkHash(project);
 const final=()=>buildDocumentaryTimeline({...project,scenes:planDocumentaryMontage(project)});
 assert.equal(final().scenes[2]!.documentary!.motionGraphic?.artwork,undefined);
 const {timeline,items}=planArtworkPhases(project,rows),mounted=timeline.scenes[2]!;
 assert.deepEqual(mounted.documentary!.motionGraphic!.artwork,draft,'editor sees the exact validated geometry and keyframes');
 assert.equal(mounted.imagePath,scene.imagePath);assert.equal(mounted.documentary!.motionGraphic!.startSeconds,.5);
 assert.equal(items[0]!.frames,90);assert.deepEqual(items[0]!.phases.map(p=>p.globalFrame),[199,238,273]);
 assert.equal(final().scenes[2]!.documentary!.motionGraphic?.artwork,undefined,'preview permission never reaches ordinary Final');
 assert.deepEqual(project,before);assert.equal(motionArtworkHash(project),hash);
 for(const protection of ['pinned','motion-zero','manual'] as const){
  const protectedProject=structuredClone(project),doc=protectedProject.scenes[2]!.documentary!;
  if(protection==='pinned')doc.pinned=true;
  else if(protection==='motion-zero')doc.templateMotion={amountPercent:0,curve:'smooth'};
  else doc.motionGraphic={enabled:true,origin:'manual',kind:'quote',title:'Authored',startSeconds:0,durationSeconds:4};
  assert.throws(()=>planArtworkPhases(protectedProject,rows),/не применяется/);
 }
 const unsafe=structuredClone(draft);unsafe.layers[1]!.sourceSceneId='outside-allowlist';
 assert.throws(()=>planArtworkPhases(project,[{sceneId:scene.id,artwork:unsafe}]),/draft.*не прошёл проверку/);
});

test('normal prepare supplies the batch preview callback and resumes without commissioning again',async t=>{
 const root=await mkdtemp(join(tmpdir(),'gws-preview-service-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const {project,rows}=fixture(),hash=semanticMontageHash(project);
 for(const scene of project.scenes)scene.documentary!.semanticMontageInputHash=hash;
 let commissions=0,previews=0;const revisionOptions:boolean[]=[];
 const ai={planMotionArtwork:async(input:Project,signal:AbortSignal|undefined,options:{reviseSavedArtwork?:boolean;revisionPreview:(...args:any[])=>Promise<unknown>})=>{
  commissions++;revisionOptions.push(options.reviseSavedArtwork===true);await options.revisionPreview(rows,signal);
  return {version:1,inputHash:motionArtworkHash(input),model:'saved-fixture',rejected:[],scenes:rows.map(row=>({sceneId:row.sceneId,artwork:row.artwork,artworkSpan:{endSceneId:row.endSceneId}}))};
 }};
 const repo=new MemoryProjectRepository(),projects=new ProjectService(repo,new MockDirectorProvider());await repo.save(project);
 const renderer=async(input:Project,batch:ArtworkRevisionPreviewRow[],options:{projectDirectory:string;signal?:AbortSignal})=>{
  previews++;assert.equal(options.projectDirectory,root);assert.deepEqual(batch,rows);assert.equal(input.id,project.id);
  const phases=planArtworkPhases(input,batch);
  return phases.items.map(item=>({sceneId:item.sceneId,frames:item.phases.map(p=>({t:p.t,image:'data:image/jpeg;base64,unit-fixture'}))}));
 };
 const make=()=>new DocumentaryProjectService(projects,{projectDirectory:()=>root,ensureProject:async()=>{}} as never,{} as never,root,{} as never,()=>{},ai as never,
  undefined,undefined,undefined,renderer);
 const first=await make().prepareMontage(project.id),second=await make().prepareMontage(project.id);
 assert.equal(commissions,1);assert.equal(previews,1);
 assert.deepEqual(second.scenes.map(s=>s.documentary?.motionGraphic),first.scenes.map(s=>s.documentary?.motionGraphic));
 assert.equal(second.scenes[1]!.documentary!.motionGraphic!.artwork!.intent,'Water cycle');
 // Only an explicit service option revisits a successful saved artwork plan.
 // It is passed to intelligence for its versioned revision receipt; it is not
 // persisted as permission to buy another request on the next normal assembly.
 await make().prepareMontage(project.id,undefined,{reviseSavedArtwork:true});
 assert.equal(commissions,2);assert.equal(previews,2);assert.deepEqual(revisionOptions,[false,true]);
 await make().prepareMontage(project.id);
 assert.equal(commissions,2);assert.equal(previews,2);
});
