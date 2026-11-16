import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {DocumentarySemanticMontage,EffectAsset,Project,Scene} from '@gold-work/shared';
import {createSemanticMontagePlan,enrichSemanticMontage,montageCutawaySources,semanticMontageHash,validateMontageDirections,validateMusicSections} from './documentary-semantic-montage.js';
import {documentaryCheckpointKey} from './documentary-checkpoint-key.js';
import {planDocumentaryMontage} from './documentary-montage.js';
import {documentaryMontageSoundEvents,planDocumentaryEffects} from './documentary-effects.js';
import {prepareDocumentaryMontageMedia} from './documentary-montage-media.js';
import {importDocumentaryMusic} from './documentary-music-import.js';
import {buildDocumentaryTimeline} from '../../../packages/remotion-video/src/documentary-timeline.js';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {DocumentaryAnalysisError} from './documentary-analysis-error.js';
import {DocumentarySemanticMontageError} from './documentary-semantic-montage.js';
import {documentaryEditErrors} from './documentary-validation.js';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {DocumentaryRetryPermissions,listDocumentaryRecovery} from './documentary-retry.js';
import {AnyModelCompletionUncertainError} from './anymodel-client.js';
import {documentaryTimeGapState} from '../../../packages/remotion-video/src/documentary-time-gap.js';
import {documentaryPhotoCutTransform} from '../../../packages/remotion-video/src/documentary-design.js';
import {assessArtworkReplacement} from './documentary-artwork-quality.js';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import type {EffectLibrary} from './effect-library.js';
import type {LocalProjectStorage} from './local-project-storage.js';

function project(count=8):Project{
  return {id:'montage-test',mediaMode:'stock',aspectRatio:'16:9',language:'en',settings:{voice:{enabled:true},music:{enabled:false,volume:10},
    assembly:{kenBurns:true,documentary:{version:2,autoEffects:true,autoTransitions:true,autoMotionGraphics:true,montage:{version:1,style:'editorial',intensity:'rich',hookSeconds:16,musicPolicy:'preserve'}}}},
    scenes:Array.from({length:count},(_,order)=>({id:`scene-${order}`,order,narration:'Ford raced in London in 1966.',durationSeconds:6,audioPath:`voice-${order}.wav`,imagePath:`image-${order}.jpg`,
      documentary:{verified:true,checksum:`hash-${order}`,layout:'full',effects:[],caption:{enabled:false,text:''},timing:{sourceKey:`voice-${order}`,durationInFrames:181,speechSeconds:5.9},
        selected:{id:`source-${order}`,kind:'image',width:1920,height:1080},requirement:{text:'Ford raced in London in 1966.',identities:[{name:'Ford'}],years:[1966],accent:'none'},
        semanticMontage:{sceneId:`scene-${order}`,subject:'Ford',beat:'conflict',treatment:'footage',cutawaySceneIds:[`scene-${(order+1)%count}`,`scene-${(order+2)%count}`]}}}))} as unknown as Project;
}
const answer=async(_system:string,input:string)=>({scenes:(JSON.parse(input).scenes as Array<{sceneId:string}>).map(s=>({sceneId:s.sceneId,subject:'Ford',beat:'evidence',treatment:'footage',cutawaySceneIds:[]}))});

function reviewedIllustration(scene:Scene,status:'accepted'|'rejected'){
  const doc=scene.documentary!,selected=doc.selected!,path=scene.videoPath??scene.imagePath!;
  Object.assign(selected,{provider:'local',rights:'user-confirmed',localPath:path});
  doc.verified=false;doc.illustrative=true;
  doc.visualReview={status,confidence:.98,reason:status,checkedAt:'2026-11-04',sampleSeconds:[0],quality:'clear'};
  doc.manualReview={version:1,status:'pending',candidateId:selected.id,provider:selected.provider,kind:selected.kind,mediaPath:path,
    checksum:doc.checksum!,narration:scene.narration,reason:'Illustrative material',analysis:{status,reason:status}};
}

test('Cutty Sark: a repeated full-scene photo yields to reviewed video, including after changing the selected file',()=>{
  const p=project(2),[photo,scene]=p.scenes as [Scene,Scene],doc=scene.documentary!;
  photo.documentary!.timing!.durationInFrames=178;photo.documentary!.semanticMontage!.cutawaySceneIds=[];
  reviewedIllustration(photo,'accepted');
  doc.timing!.durationInFrames=141;scene.videoPath='four-masted-ship.mp4';scene.trimEndSeconds=141/30;
  Object.assign(doc.selected!,{id:'four-masted-ship',kind:'video',durationSeconds:5});
  reviewedIllustration(scene,'rejected');
  doc.semanticMontage={sceneId:scene.id,subject:'',beat:'establish',treatment:'footage',cutawayMode:'replace',cutawaySceneIds:[photo.id]};
  const oldHash=semanticMontageHash(p);doc.semanticMontageInputHash=oldHash;
  const timeline=()=>buildDocumentaryTimeline({...p,scenes:planDocumentaryMontage(p)});
  const covered=planDocumentaryMontage(p),original=buildDocumentaryTimeline({...p,scenes:covered}),fallback=original.scenes[1]!;
  assert.equal(original.durationInFrames,319);
  assert.deepEqual(fallback.documentary!.cuts?.map(c=>[c.imagePath,c.videoPath,c.fromFrame,c.durationInFrames]),
    [[photo.imagePath,undefined,0,141]],'a rejected video stays covered throughout');
  doc.cuts=covered[1]!.documentary!.cuts;doc.cutsOrigin='automatic';
  scene.videoPath='accepted-cutty-sark.mp4';doc.selected!.id='cutty-sark';doc.checksum='accepted-video-checksum';
  reviewedIllustration(scene,'accepted');
  const newHash=semanticMontageHash(p);assert.notEqual(newHash,oldHash);
  for(const hash of [oldHash,newHash]){
    doc.semanticMontageInputHash=hash;
    const result=timeline(),second=result.scenes[1]!;
    assert.equal(result.scenes[0]!.imagePath,photo.imagePath);
    assert.deepEqual([second.fromFrame,second.durationInFrames,second.videoPath,second.audioPath],[178,141,scene.videoPath,scene.audioPath]);
    assert.equal(second.documentary!.cuts,undefined,'neither stale cuts nor a current replace may cover the accepted video with the preceding photo');
    assert.equal(second.documentary!.semanticMontage?.cutawayMode,undefined);
  }
  // The next actual plan proposed both directions: video over the photo's
  // narration, then the photo over the video's narration.
  photo.documentary!.semanticMontage={...photo.documentary!.semanticMontage!,cutawayMode:'replace',cutawaySceneIds:[scene.id]};
  photo.documentary!.semanticMontageInputHash=newHash;
  const reciprocal=timeline();
  assert.deepEqual(reciprocal.scenes.map(s=>s.documentary!.cuts),[undefined,undefined]);
  assert.deepEqual(reciprocal.scenes.map(s=>[s.fromFrame,s.durationInFrames,s.videoPath??s.imagePath]),[
    [0,178,photo.imagePath],[178,141,scene.videoPath]]);
});

test('a replacement checks the outgoing cut by file and video in-point, even across different scene IDs',()=>{
  const p=project(4),[lead,target,left,right]=p.scenes as [Scene,Scene,Scene,Scene];
  for(const s of [left,right]){
    s.videoPath=s.id+'.mp4';s.trimStartSeconds=4;s.trimEndSeconds=18;
    Object.assign(s.documentary!.selected!,{kind:'video',durationSeconds:30});
    s.documentary!.checksum='same-video-bytes';s.documentary!.illustrative=true;
  }
  const cuts=lead.documentary!.cuts=[{id:'manual-tail',fromFrame:140,durationInFrames:41,
    sourceSceneId:left.id,trimStartSeconds:4,playbackRate:1}];
  lead.documentary!.cutsOrigin='manual';
  target.documentary!.semanticMontage={sceneId:target.id,subject:'',beat:'explain',treatment:'footage',cutawayMode:'replace',cutawaySceneIds:[right.id]};
  const first=planDocumentaryMontage(p);
  assert.deepEqual(first[0]!.documentary!.cuts,cuts);
  assert.equal(first[1]!.documentary!.cuts,undefined);
  right.trimStartSeconds=11;
  assert.deepEqual(planDocumentaryMontage(p)[1]!.documentary!.cuts?.map(c=>[c.sourceSceneId,c.trimStartSeconds]),[[right.id,11]]);
});

test('a thirty-second hook retains its approved short cutaway after second twenty',()=>{
  const p=project(3);p.settings.assembly.documentary!.montage!.hookSeconds=30;
  const lead=p.scenes[0]!;lead.durationSeconds=24;lead.documentary!.timing!.durationInFrames=720;lead.documentary!.pinned=true;
  const beat=p.scenes[1]!;beat.durationSeconds=4.2;beat.documentary!.timing!.durationInFrames=126;
  beat.documentary!.semanticMontage!.cutawaySceneIds=['scene-2'];
  assert.deepEqual(enrichSemanticMontage(p)[1]!.documentary!.cuts?.map(c=>c.sourceSceneId),['scene-1','scene-2']);
});

test('ordinary rich footage uses its evidence treatment consistently and honors exclusions',()=>{
  const p=project(24);p.settings.assembly.documentary!.montage!.hookSeconds=30;
  for(const scene of p.scenes){scene.narration='The riders returned to the track.';
    scene.documentary!.semanticMontage={sceneId:scene.id,subject:'',beat:'evidence',treatment:'footage',cutawaySceneIds:[]};}
  const before=structuredClone(p),scenes=enrichSemanticMontage(p);
  const decorations=scenes.filter(s=>['contain','archive-slide','gallery','paper-grid','museum-mat'].includes(s.documentary!.template??''));
  assert.equal(new Set(decorations.map(s=>s.documentary!.template)).size,1);
  assert.equal(decorations[0]!.documentary!.template,'museum-mat');
  const body=decorations.filter(s=>s.order*181/30>=30);
  assert.ok(body.length>=4);
  assert.ok(body.every(s=>s.documentary!.template==='museum-mat'));
  assert.deepEqual(p,before);assert.deepEqual(enrichSemanticMontage({...p,scenes}),scenes,'replanning is stable');
  p.settings.assembly.documentary!.excludedTemplates=['contain','archive-slide','gallery','paper-grid','museum-mat'];
  assert.ok(enrichSemanticMontage(p).every(s=>!p.settings.assembly.documentary!.excludedTemplates!.includes(s.documentary!.template!)));
});

test('explicit illustrative replacements cover every frame, mute video and keep one photo camera across adjacent scenes',()=>{
  const p=project(5),photo=p.scenes[2]!,video=p.scenes[4]!;
  photo.documentary!.illustrative=true;photo.documentary!.template='full';photo.documentary!.templateOrigin='manual';photo.documentary!.visualReview={status:'accepted',viewDescription:'An engine crankshaft inside an open block.'} as NonNullable<NonNullable<typeof photo.documentary>['visualReview']>;
  video.videoPath='reviewed-track.mp4';video.trimStartSeconds=0;video.trimEndSeconds=125/30;video.documentary!.illustrative=true;video.documentary!.selected!.durationSeconds=18.99;
  for(const [i,source,frames] of [[0,photo,132],[1,photo,132],[3,video,114]] as const){
    const s=p.scenes[i]!;s.durationSeconds=frames/30;s.sourceVolume=65;s.documentary!.timing!.durationInFrames=frames;
    s.documentary!.semanticMontage={sceneId:s.id,subject:'',beat:'explain',treatment:'footage',cutawayMode:'replace',cutawaySceneIds:[source.id]};
  }
  reviewedIllustration(p.scenes[1]!,'rejected'); // Only the shared photo can cover these next 132 frames.
  const before=structuredClone(p),scenes=planDocumentaryMontage(p),timeline=buildDocumentaryTimeline({...p,scenes});
  for(const i of [0,1,3]){const s=scenes[i]!;assert.equal(s.documentary!.cuts!.length,1);assert.equal(s.documentary!.cuts![0]!.fromFrame,0);assert.equal(s.documentary!.cuts![0]!.durationInFrames,s.documentary!.timing!.durationInFrames);assert.equal(s.sourceVolume,0);assert.equal(s.documentary!.motionGraphic,undefined);}
  const first=timeline.scenes[0]!,second=timeline.scenes[1]!,cut=first.documentary!.cuts![0]!,next=second.documentary!.cuts![0]!;
  assert.equal(cut.sequenceOffsetFrames,0);assert.equal(next.sequenceOffsetFrames,132);assert.equal(cut.sequenceDurationFrames,264);
  assert.equal(documentaryPhotoCutTransform(first,cut,0,'full'),'scale(1)');
  assert.equal(documentaryPhotoCutTransform(second,next,131,'full'),'scale(1.03)');
  const a=Number(documentaryPhotoCutTransform(first,cut,131,'full')!.match(/scale\(([^)]+)/u)![1]),b=Number(documentaryPhotoCutTransform(second,next,0,'full')!.match(/scale\(([^)]+)/u)![1]);
  assert.ok(Math.abs(a-b)<.001,'the shared picture must not restart its crop');
  const track=timeline.scenes[3]!;assert.equal(track.documentary!.cuts![0]!.trimEndSeconds,3.8);assert.equal(track.documentary!.cuts![0]!.motion,'none');
  assert.equal(first.transitionFrames,0);assert.equal(timeline.scenes[2]!.transitionFrames,0);assert.equal(track.transitionFrames,0);
  assert.deepEqual(p,before);
  const parsed=validateMontageDirections({scenes:[p.scenes[3]!.documentary!.semanticMontage]},p.scenes,p.scenes,p);
  assert.equal(parsed[3]!.cutawayMode,'replace');assert.deepEqual(parsed[3]!.cutawaySceneIds,[video.id]);
  p.scenes[0]!.documentary!.pinned=true;assert.equal(planDocumentaryMontage(p)[0],p.scenes[0]);
});

test('explicit map composition fills the scene with the literal date and sourced venue; manual timing survives',()=>{
  const p=project(1),scene=p.scenes[0]!,d=scene.documentary!;
  scene.narration='The team first tested at Sepang in January 2004.';scene.durationSeconds=134/30;d.timing!.durationInFrames=134;
  d.requirement={...d.requirement,text:scene.narration,identities:[],years:['2004']};
  d.semanticMontage={sceneId:scene.id,subject:'',location:'Sepang',beat:'establish',treatment:'map',cutawaySceneIds:[],composition:{kind:'map-locator',title:'Sepang',kicker:'January 2004'}};
  const before=structuredClone(p),planned=planDocumentaryMontage(p)[0]!,g=planned.documentary!.motionGraphic!;
  assert.equal(g.kind,'map-locator');assert.equal(g.startSeconds,0);assert.equal(g.durationSeconds,134/30);assert.equal(g.mapStyle,'full');
  assert.equal(g.kicker,'January 2004');assert.equal(g.place!.latitude,2.76101);assert.equal(g.place!.longitude,101.7369094);
  assert.equal(g.place!.source,'https://www.sepangcircuit.com/contact-details');assert.deepEqual(p,before);
  d.motionGraphic={...g,origin:'manual',startSeconds:1,durationSeconds:2};
  assert.deepEqual(planDocumentaryMontage(p)[0]!.documentary!.motionGraphic,d.motionGraphic);
});

test('automatic standalone time gap fills measured scene with a final hold while manual timing stays authored',()=>{
  const p=project(1),scene=p.scenes[0]!,d=scene.documentary!;
  scene.narration='He held on to win by just 0.210 seconds.';
  d.requirement={...d.requirement,text:scene.narration,identities:[],years:[]};
  d.timing!.durationInFrames=235;scene.durationSeconds=235/30;
  d.semanticMontage={sceneId:scene.id,subject:'',beat:'resolve',treatment:'footage',cutawaySceneIds:[],composition:{kind:'statistic',value:'0.210 seconds'}};
  d.motionGraphic={kind:'statistic',enabled:true,origin:'automatic',title:'',value:'0.210 seconds',preset:'stat-ticket',startSeconds:92/30,durationSeconds:3.4,diagram:{kind:'time-gap',amount:.21,label:'0.210 seconds'}};
  const before=structuredClone(p),scenes=planDocumentaryMontage(p),g=scenes[0]!.documentary!.motionGraphic!;
  assert.equal(g.diagram!.kind,'time-gap');assert.equal(g.startSeconds,0);assert.equal(g.durationSeconds,235/30);assert.equal(g.showSource,false);
  const timeline=buildDocumentaryTimeline({...p,scenes});
  assert.equal(timeline.scenes[0]!.durationInFrames,235);assert.equal(timeline.scenes[0]!.documentary!.motionGraphic!.startSeconds,0);
  assert.deepEqual(documentaryTimeGapState(184,235),documentaryTimeGapState(234,235));
  assert.deepEqual(p,before,'selected source and original timing are not mutated');
  d.motionGraphic.origin='manual';
  assert.deepEqual(planDocumentaryMontage(p)[0]!.documentary!.motionGraphic,d.motionGraphic);
});

test('standalone artwork span survives semantic short IDs, serialization and ordinary replan without orphan links',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-semantic-artwork-span-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const p=project(3);
  for(const scene of p.scenes){scene.narration='The rider and the team made the machine respond.';scene.documentary!.requirement={...scene.documentary!.requirement,text:scene.narration,identities:[],years:[]};scene.documentary!.semanticMontage={sceneId:scene.id,subject:'',beat:'explain',treatment:'footage',cutawaySceneIds:[]};}
  const artwork:NonNullable<DocumentarySemanticMontage['scenes'][number]['artwork']>={version:1,motionCoordinates:'relative',intent:'Input and response',layout:'full',canvas:{width:1000,height:562},
    palette:{background:'#f5f3ef',ink:'#222222',accent:'#dd4433',secondary:'#8899aa'},startSeconds:0,durationSeconds:543/30,
    layers:[{id:'input',kind:'ellipse',x:100,y:200,w:80,h:80,fill:'ink'},{id:'output',kind:'ellipse',x:800,y:200,w:100,h:100,fill:'ink'},
      {id:'link',kind:'path',x:180,y:239,w:620,h:2,path:'M0 1H620',stroke:'accent',keyframes:[{t:0,draw:0},{t:.9,draw:1},{t:1,draw:1}]}]};
  p.scenes[0]!.documentary!.semanticMontage={...p.scenes[0]!.documentary!.semanticMontage!,artwork,artworkSpan:{endSceneId:p.scenes[2]!.id},artworkMode:'standalone'};
  let calls=0;
  const complete=async(system:string,input:string)=>{calls++;const raw=await answer(system,input);return {scenes:raw.scenes.map((row,i)=>({...row,...(i===0?{artworkSpan:{endSceneId:'s2'}}:{})}))};};
  const plan=await createSemanticMontagePlan(p,root,complete,'fixture');
  assert.equal(plan.scenes[0]!.artworkSpan!.endSceneId,p.scenes[2]!.id);
  assert.deepEqual(plan.scenes[0]!.artwork,artwork);
  const serialized=JSON.parse(await readFile(join(root,'Documentary','Montage',`${plan.inputHash}.json`),'utf8')) as DocumentarySemanticMontage;
  assert.deepEqual(serialized.scenes[0]!.artworkSpan,plan.scenes[0]!.artworkSpan);
  for(const scene of p.scenes)scene.documentary!.semanticMontage=JSON.parse(JSON.stringify(plan.scenes.find(s=>s.sceneId===scene.id)));
  const scenes=planDocumentaryMontage(p),timeline=buildDocumentaryTimeline({...p,scenes});
  assert.deepEqual(timeline.scenes.map(s=>s.documentary!.motionGraphic!.sequenceOffsetFrames),[0,181,362]);
  assert.ok(timeline.scenes.every(s=>s.documentary!.motionGraphic!.sequenceDurationFrames===543));
  const resumed=await createSemanticMontagePlan({...p,scenes},root,complete,'fixture');
  assert.equal(calls,1);assert.deepEqual(resumed.scenes[0]!.artwork,artwork);assert.deepEqual(resumed.scenes[0]!.artworkSpan,plan.scenes[0]!.artworkSpan);
  delete p.scenes[0]!.documentary!.semanticMontage!.artwork;delete p.scenes[0]!.documentary!.semanticMontage!.artworkSpan;
  const orphan=validateMontageDirections({scenes:[{sceneId:p.scenes[0]!.id,artworkSpan:{endSceneId:p.scenes[2]!.id}}]},p.scenes,p.scenes,p);
  assert.equal(orphan[0]!.artworkSpan,undefined);assert.equal(orphan[0]!.artwork,undefined);
  const outsideBrief=validateMontageDirections({scenes:[plan.scenes[0]]},p.scenes.slice(0,2),p.scenes,p);
  assert.equal(outsideBrief[0]!.artworkSpan,undefined);
  p.scenes[0]!.documentary!.semanticMontage=plan.scenes[0];
  const changed=validateMontageDirections({scenes:[{sceneId:p.scenes[0]!.id,artworkMode:'photographic'}]},p.scenes,p.scenes,p);
  assert.equal(changed[0]!.artworkSpan,undefined,'a new photographic direction prevents restoration');
});

test('a saved photo-label artwork cannot replace plain footage, the approved cut plan or an explanatory composition',()=>{
  const p=project(3),scene=p.scenes[0]!,direction=scene.documentary!.semanticMontage!;
  direction.artwork={version:1,intent:'photo annotation',layout:'full',canvas:{width:1000,height:562},
    palette:{background:'#eeeeee',ink:'#111111',accent:'#ff0000',secondary:'#555555'},startSeconds:0,durationSeconds:5,
    layers:[{id:'photo',kind:'media',x:0,y:0,w:1000,h:562},
      {id:'text',kind:'text',x:600,y:200,w:200,h:50,text:'Ford',fontSize:40},
      {id:'line',kind:'path',x:100,y:250,w:700,h:10,path:'M0 5 L700 5'}]};
  const receipt=JSON.stringify(direction.artwork);
  const cutResult=enrichSemanticMontage(p)[0]!;
  assert.ok(cutResult.documentary!.cuts!.length>1,'approved editing survives the artwork attachment');
  assert.equal(cutResult.documentary!.motionGraphic?.artwork,undefined);
  assert.equal(JSON.stringify(cutResult.documentary!.semanticMontage!.artwork),receipt,'retain reusable paid data');
  direction.composition={kind:'explainer',cards:[{label:'Ford'},{label:'London'}],boardLayout:'compare'};
  const graphicResult=enrichSemanticMontage(p)[0]!;
  assert.equal(graphicResult.documentary!.motionGraphic!.boardLayout,'compare');
  assert.equal(graphicResult.documentary!.motionGraphic!.artwork,undefined);
  const bare=project(1),bareScene=bare.scenes[0]!,bareDirection=bareScene.documentary!.semanticMontage!;
  bareDirection.cutawaySceneIds=[];
  const baseline=enrichSemanticMontage(bare)[0]!.documentary!;
  assert.equal(baseline.motionGraphic?.preset,'date-ruler');assert.equal(baseline.cuts,undefined);
  bareDirection.artwork=direction.artwork;
  const plain=enrichSemanticMontage(bare)[0]!.documentary!;
  assert.deepEqual(plain.motionGraphic,baseline.motionGraphic,'a rejected annotation cannot take over the ordinary date accent');
  assert.equal(plain.cuts,undefined);
  assert.equal(JSON.stringify(plain.semanticMontage!.artwork),receipt,'paid source remains intact for editing');
  scene.documentary!.motionGraphic={kind:'explainer',enabled:true,title:'',origin:'manual',startSeconds:0,durationSeconds:5,artwork:direction.artwork};
  assert.equal(enrichSemanticMontage(p)[0]!.documentary!.motionGraphic!.artwork,direction.artwork,'manual choice remains authoritative');
  scene.documentary!.pinned=true;scene.documentary!.motionGraphic.origin='automatic';
  assert.equal(enrichSemanticMontage(p)[0]!.documentary!.motionGraphic!.artwork,direction.artwork,'pinned choices remain authoritative');
});

test('automatic photographs apply renderable media artwork that passes the artistic quality guard',()=>{
  const p=project(1),scene=p.scenes[0]!,doc=scene.documentary!,direction=doc.semanticMontage!;
  direction.cutawaySceneIds=[];
  const artwork:NonNullable<typeof direction.artwork>={version:1,intent:'Independent diagram beside a photograph',layout:'full',canvas:{width:1000,height:562},
    palette:{background:'#eeeeee',ink:'#111111',accent:'#ff0000',secondary:'#555555'},startSeconds:0,durationSeconds:5,
    layers:[{id:'photo',kind:'media',x:0,y:0,w:1000,h:562,sourceWindow:{x:.1,y:.2,w:.7,h:.7},keyframes:[{t:0,scale:1},{t:1,scale:1.3}]},
      {id:'diagram',kind:'ellipse',x:60,y:181,w:200,h:200,fill:'none',stroke:'#111111'}]};
  assert.equal(assessArtworkReplacement(artwork).allowReplacement,true);
  direction.artwork=artwork;
  doc.motionGraphic={kind:'explainer',enabled:true,origin:'automatic',title:'',startSeconds:0,durationSeconds:5,artwork};
  const before=JSON.stringify(p),planned=enrichSemanticMontage(p)[0]!;
  assert.equal(planned.documentary!.motionGraphic?.artwork,artwork);
  assert.equal(planned.documentary!.template,'full');
  assert.equal(buildDocumentaryTimeline(p).scenes[0]!.documentary!.motionGraphic?.artwork,artwork,'saved automatic artwork remains visible in the timeline');
  assert.equal(JSON.stringify(p),before,'saved source/receipt is unchanged');
  assert.equal(planned.documentary!.semanticMontage!.artwork,artwork);
  doc.motionGraphic.origin='manual';
  assert.equal(enrichSemanticMontage(p)[0]!.documentary!.motionGraphic!.artwork,artwork);
  assert.equal(buildDocumentaryTimeline(p).scenes[0]!.documentary!.motionGraphic!.artwork,artwork);
  doc.motionGraphic.origin='automatic';doc.pinned=true;
  assert.equal(buildDocumentaryTimeline(p).scenes[0]!.documentary!.motionGraphic!.artwork,artwork);
  doc.pinned=false;delete doc.motionGraphic;
  direction.artwork={...artwork,layers:artwork.layers.filter(layer=>layer.kind!=='media')};
  assert.equal(enrichSemanticMontage(p)[0]!.documentary!.motionGraphic!.artwork,direction.artwork,'independent explanatory drawings remain available');
  direction.artwork=artwork;
  const draft={...p,scenes:enrichSemanticMontage(p,new Map([[scene.id,artwork]]))};
  assert.equal(buildDocumentaryTimeline(draft).scenes[0]!.documentary!.motionGraphic!.artwork,artwork,'explicit editor drafts remain visible');
});

test('artwork mode is optional, accepts only the two choices and survives the existing semantic cache',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-montage-artwork-mode-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const p=project(3),hash=semanticMontageHash(p);let calls=0;
  const complete=async(system:string,input:string)=>{
    calls++;assert.match(system,/artworkMode/);assert.match(system,/photographic/);assert.match(system,/standalone/);
    const raw=await answer(system,input);
    return {scenes:raw.scenes.map((row,index)=>({...row,artworkMode:['photographic','standalone','invented'][index]}))};
  };
  const plan=await createSemanticMontagePlan(p,root,complete,'fixture');
  assert.deepEqual(plan.scenes.map(s=>s.artworkMode),['photographic','standalone',undefined]);
  assert.equal(Object.hasOwn(plan.scenes[2]!,'artworkMode'),false);
  const resumed=await createSemanticMontagePlan(p,root,complete,'fixture');
  assert.deepEqual(resumed.scenes.map(s=>s.artworkMode),['photographic','standalone',undefined]);assert.equal(calls,1);
  p.scenes[0]!.documentary!.semanticMontage!.artworkMode='standalone';
  assert.equal(semanticMontageHash(p),hash,'mode does not invalidate a paid semantic plan');
  const path=join(root,'Documentary','Montage',`${hash}.json`),legacy=JSON.parse(await readFile(path,'utf8'));
  for(const direction of legacy.scenes)delete direction.artworkMode;
  await writeFile(path,JSON.stringify(legacy));
  const old=await createSemanticMontagePlan(p,root,complete,'fixture');
  assert.ok(old.scenes.every(s=>!Object.hasOwn(s,'artworkMode')));assert.equal(calls,1,'legacy cache needs no mode-upgrade request');
  legacy.scenes[0].artworkMode='unsupported';await writeFile(path,JSON.stringify(legacy));
  const malformed=await createSemanticMontagePlan(p,root,complete,'fixture');
  assert.equal(Object.hasOwn(malformed.scenes[0]!,'artworkMode'),false);assert.equal(calls,1);
});

for(const failure of ['unavailable','partial','invalid','missing','malformed'] as const)test(`optional semantic ${failure} produces a local timeline and persists no-replay outcome`,async()=>{
  const repo=new MemoryProjectRepository(),projects=new ProjectService(repo,new MockDirectorProvider()),p=project(3);
  p.scenes[1]!.documentary!.pinned=true;
  p.scenes[1]!.documentary!.template='archive-dark';p.scenes[1]!.documentary!.templateOrigin='manual';
  await repo.save(p);let calls=0;
  const intelligence={planSemanticMontage:async()=>{calls++;
    if(failure==='malformed')return {version:1,inputHash:semanticMontageHash(p)} as never;
    if(failure==='missing')return {version:1,inputHash:semanticMontageHash(p),scenes:[]} as never;
    if(failure==='invalid')throw new DocumentarySemanticMontageError('Invalid rows');
    throw new DocumentaryAnalysisError(failure,failure==='partial'?'pending':'unavailable','semantic-montage');
  }};
  const make=()=>new DocumentaryProjectService(projects,{projectDirectory:()=>'.',ensureProject:async()=>{}} as never,{} as never,'.',{} as never,()=>{},intelligence as never);
  const first=await make().prepareMontage(p.id),timeline=buildDocumentaryTimeline(first);
  assert.equal(first.settings.assembly.documentary!.semanticMontageStatus!.status,'local');
  assert.match(first.settings.assembly.documentary!.semanticMontageStatus!.message,/AI-монтаж недоступен/);
  assert.equal(timeline.durationInFrames,543);assert.ok(timeline.scenes.every(s=>s.narrationEnabled&&s.audioPath));
  assert.ok(first.scenes.every(s=>!s.documentary!.semanticMontage));
  assert.deepEqual(first.scenes.map(s=>[s.narration,s.audioPath,s.imagePath,s.documentary!.timing]),p.scenes.map(s=>[s.narration,s.audioPath,s.imagePath,s.documentary!.timing]));
  assert.equal(first.scenes[1]!.documentary!.template,'archive-dark');assert.equal(first.scenes[1]!.documentary!.pinned,true);
  await make().prepareMontage(p.id);assert.equal(calls,1,'new service instance reuses persisted fallback');
  await projects.mutate(p.id,current=>({scenes:current.scenes.map((s,i)=>i?s:{...s,narration:'Changed Ford narration'})}));
  await make().prepareMontage(p.id);assert.equal(calls,2,'new input is a distinct plan');
});

for(const failure of ['abort','disk','conflict'] as const)test(`optional semantic fallback does not conceal ${failure}`,async()=>{
  const repo=new MemoryProjectRepository(),projects=new ProjectService(repo,new MockDirectorProvider()),p=project(2);await repo.save(p);
  const intelligence={planSemanticMontage:async()=>{
    if(failure==='abort')throw new DOMException('Stopped','AbortError');
    if(failure==='disk')throw Object.assign(new Error('Disk full'),{code:'ENOSPC'});
    await projects.mutate(p.id,current=>({scenes:current.scenes.map((s,i)=>i?s:{...s,narration:'Edited during planning'})}));
    throw new DocumentaryAnalysisError('Unavailable');
  }};
  const service=new DocumentaryProjectService(projects,{projectDirectory:()=>'.',ensureProject:async()=>{}} as never,{} as never,'.',{} as never,()=>{},intelligence as never);
  await assert.rejects(service.prepareMontage(p.id),failure==='abort'?/Stopped/:failure==='disk'?/Disk full/:/изменились/);
  assert.equal((await projects.get(p.id))!.settings.assembly.documentary!.semanticMontageStatus,undefined);
});

test('local fallback persists before a later storage error and the storage failure still propagates',async()=>{
  const repo=new MemoryProjectRepository(),projects=new ProjectService(repo,new MockDirectorProvider()),p=project(2);await repo.save(p);let calls=0;
  const service=new DocumentaryProjectService(projects,{projectDirectory:()=>'.',ensureProject:async()=>{throw Object.assign(new Error('Disk full'),{code:'ENOSPC'});}} as never,{} as never,'.',{} as never,()=>{},
    {planSemanticMontage:async()=>{calls++;throw new DocumentaryAnalysisError('Unavailable');}} as never);
  await assert.rejects(service.prepareMontage(p.id),/Disk full/);await assert.rejects(service.prepareMontage(p.id),/Disk full/);assert.equal(calls,1);
});

test('explicit semantic refresh keeps unknown receipt guarded, then uses one authorized recovery with unchanged input',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-semantic-refresh-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const repo=new MemoryProjectRepository(),projects=new ProjectService(repo,new MockDirectorProvider()),p=project(2);await repo.save(p);
  const requests:string[]=[];
  const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryQueryModel:async()=> 'selected',
    documentaryCompletion:async(system:string,input:string)=>{
      requests.push(JSON.stringify([system,input]));
      if(requests.length===1)throw new AnyModelCompletionUncertainError('unknown paid result');
      return JSON.stringify(JSON.parse(input).motionConcepts===1?{explanations:[]}:await answer(system,input));
    }},()=>root);
  const service=new DocumentaryProjectService(projects,{projectDirectory:()=>root,ensureProject:async()=>{}} as never,{} as never,root,{} as never,()=>{},{planSemanticMontage:intelligence.planSemanticMontage.bind(intelligence)} as never);
  assert.equal((await service.prepareMontage(p.id)).settings.assembly.documentary!.semanticMontageStatus!.status,'local');
  await service.prepareMontage(p.id);assert.equal(requests.length,1,'routine assembly retains local outcome');
  await service.prepareMontage(p.id,undefined,{refreshSemantic:true});assert.equal(requests.length,1,'refresh alone cannot replay unknown');
  const items=await listDocumentaryRecovery(root);assert.equal(items.length,1);assert.equal(items[0]!.purpose,'semantic-montage');
  const oldReceipt=await readFile(join(root,'Documentary','Analysis',items[0]!.id+'.json'),'utf8');
  await new DocumentaryRetryPermissions().authorize(root,items);
  const recovered=await service.prepareMontage(p.id,undefined,{refreshSemantic:true});
  assert.equal(recovered.settings.assembly.documentary!.semanticMontageStatus!.status,'planned');
  assert.equal(requests.length,2,'one authorized source recovery, no separate concept commission');assert.equal(requests[1],requests[0],'purpose/input identity is not changed to bypass pending');
  assert.equal(await readFile(join(root,'Documentary','Analysis','RetryHistory',`${items[0]!.id}-${items[0]!.revision}.json`),'utf8'),oldReceipt);
  await service.prepareMontage(p.id);await service.prepareMontage(p.id,undefined,{refreshSemantic:true});assert.equal(requests.length,2);
  assert.deepEqual(recovered.scenes.map(s=>[s.narration,s.audioPath,s.documentary!.timing]),p.scenes.map(s=>[s.narration,s.audioPath,s.documentary!.timing]));
});

test('semantic edits reach the real timeline with exact frame partitions and original narration',()=>{
  const p=project(),scenes=planDocumentaryMontage(p),timeline=buildDocumentaryTimeline({...p,scenes},path=>`local:${path}`);
  assert.equal(timeline.durationInFrames,181*8);
  const first=timeline.scenes[0]!,cuts=first.documentary!.cuts!;
  assert.equal(cuts.length,3);assert.deepEqual(cuts.map(c=>[c.fromFrame,c.durationInFrames]),[[0,60],[60,60],[120,61]]);
  assert.deepEqual(cuts.map(c=>c.imagePath),['local:image-0.jpg','local:image-1.jpg','local:image-2.jpg']);
  assert.deepEqual(cuts.map(c=>c.motion),['push','push','push']);assert.equal(cuts[1]!.width,1920);
  assert.deepEqual(scenes.map(s=>[s.narration,s.audioPath,s.documentary!.timing]),p.scenes.map(s=>[s.narration,s.audioPath,s.documentary!.timing]));
  assert.ok(timeline.scenes.every(s=>s.narrationEnabled));
  assert.deepEqual(planDocumentaryMontage({...p,scenes}),scenes);
});

test('manual cuts, templates, graphics, text and pinned scenes survive semantic planning',()=>{
  const p=project();p.scenes[0]!.documentary!.pinned=true;
  p.scenes[1]!.documentary!.template='gallery';p.scenes[1]!.documentary!.templateOrigin='manual';
  p.scenes[2]!.documentary!.cuts=[{id:'manual',fromFrame:0,durationInFrames:181,trimStartSeconds:0,playbackRate:1}];
  p.scenes[3]!.documentary!.motionGraphic={kind:'quote',enabled:true,title:'Authored',origin:'manual',startSeconds:0,durationSeconds:4};
  p.scenes[4]!.documentary!.caption.enabled=true;
  const scenes=enrichSemanticMontage(p);for(let i=0;i<5;i++)assert.equal(scenes[i],p.scenes[i]);
});

test('short key-point accompanies approved hook cuts without changing narration or source identity',()=>{
  const p=project(3),scene=p.scenes[0]!;
  scene.documentary!.semanticMontage!.emphasis='raced in London';
  const inputHash=semanticMontageHash(p),scenes=enrichSemanticMontage(p),first=scenes[0]!;
  assert.equal(first.documentary!.motionGraphic?.kind,'key-point');
  assert.deepEqual(first.documentary!.cuts?.map(c=>c.sourceSceneId),['scene-0','scene-1','scene-2']);
  assert.equal(first.documentary!.cuts?.reduce((sum,c)=>sum+c.durationInFrames,0),181);
  const timeline=buildDocumentaryTimeline({...p,scenes},path=>`local:${path}`);
  assert.equal(timeline.scenes[0]!.documentary!.motionGraphic?.title,'raced in London');
  assert.deepEqual(timeline.scenes[0]!.documentary!.cuts?.map(c=>c.imagePath),['local:image-0.jpg','local:image-1.jpg','local:image-2.jpg']);
  assert.deepEqual(scenes.map(s=>[s.narration,s.audioPath,s.documentary!.timing]),p.scenes.map(s=>[s.narration,s.audioPath,s.documentary!.timing]));
  assert.equal(semanticMontageHash({...p,scenes}),inputHash);
  // Missing optional fields and explicit undefined serialize identically.
  assert.deepEqual(JSON.parse(JSON.stringify(enrichSemanticMontage({...p,scenes}))),JSON.parse(JSON.stringify(scenes)));
});

for(const beat of ['turn','evidence'] as const)test(`body ${beat} uses its approved supporting shot`,()=>{
  const p=project(3);
  p.scenes[0]!.durationSeconds=24;p.scenes[0]!.documentary!.timing!.durationInFrames=720;
  for(const s of p.scenes)s.documentary!.semanticMontage!.cutawaySceneIds=[];
  const scene=p.scenes[1]!;scene.documentary!.semanticMontage!.beat=beat;scene.documentary!.semanticMontage!.cutawaySceneIds=['scene-2'];
  const result=enrichSemanticMontage(p)[1]!;
  assert.deepEqual(result.documentary!.cuts?.map(c=>c.sourceSceneId),['scene-1','scene-2']);
  assert.equal(result.documentary!.cuts?.reduce((sum,c)=>sum+c.durationInFrames,0),181);
});

test('a four-second approved cutaway survives the hook boundary then settles into longer body holds',()=>{
  for(const start of [15.9,16,16+25/30,19,24]){
    const p=project(3);
    for(const s of p.scenes)s.documentary!.semanticMontage!.cutawaySceneIds=[];
    p.scenes[0]!.durationSeconds=start;p.scenes[0]!.documentary!.timing!.durationInFrames=Math.round(start*30);
    // Isolate settling from the legitimate rich-hook fallback which can borrow
    // this future source earlier and then suppress its immediate repetition.
    p.scenes[0]!.documentary!.pinned=true;
    const scene=p.scenes[1]!;scene.durationSeconds=4.2;scene.documentary!.timing!.durationInFrames=126;
    scene.documentary!.semanticMontage!.cutawaySceneIds=['scene-2'];
    const result=enrichSemanticMontage(p)[1]!;
    if(start===24)assert.equal(result.documentary!.cuts,undefined,'settled body holds need enough time for two readable shots');
    else assert.deepEqual(result.documentary!.cuts?.map(c=>[c.sourceSceneId,c.durationInFrames]),[['scene-1',63],['scene-2',63]]);
  }
});

test('accent spacing follows the previous hold and gives a dramatic turn room sooner',()=>{
  const p=project(6);
  for(const s of p.scenes){s.documentary!.semanticMontage!.cutawaySceneIds=[];s.documentary!.semanticMontage!.beat='explain';}
  p.scenes[0]!.durationSeconds=24;p.scenes[0]!.documentary!.timing!.durationInFrames=720;
  for(const index of [1,2])p.scenes[index]!.documentary!.semanticMontage!.emphasis='Ford';
  p.scenes[2]!.documentary!.semanticMontage!.beat='turn';
  let scenes=enrichSemanticMontage(p);
  assert.equal(scenes[1]!.documentary!.motionGraphic?.kind,'key-point');
  assert.equal(scenes[2]!.documentary!.motionGraphic?.kind,'key-point','a new turn need not wait 12 seconds from the last start');
  p.scenes[1]!.documentary!.semanticMontage!.emphasis=undefined;p.scenes[1]!.documentary!.semanticMontage!.treatment='subject';
  p.scenes[3]!.durationSeconds=2;p.scenes[3]!.documentary!.timing!.durationInFrames=60;
  p.scenes[3]!.documentary!.semanticMontage!.emphasis='Ford';p.scenes[3]!.documentary!.semanticMontage!.beat='turn';
  scenes=enrichSemanticMontage(p);
  assert.equal(scenes[1]!.documentary!.motionGraphic?.kind,'subject-card');
  assert.equal(scenes[2]!.documentary!.motionGraphic?.kind,'key-point','the shortened identity overlay releases the source before a new turn');
  assert.equal(scenes[3]!.documentary!.motionGraphic?.kind,'key-point');
});

test('explicit saved map and 3 of 8 survive earlier accents without changing narration or sources',()=>{
  for(const kind of ['map','ratio'] as const){
    const p=project(3),previous=p.scenes[1]!,scene=p.scenes[2]!;
    p.scenes[0]!.durationSeconds=20;p.scenes[0]!.documentary!.timing!.durationInFrames=600;
    for(const s of p.scenes)s.documentary!.semanticMontage={sceneId:s.id,subject:'',beat:'explain',treatment:'footage',cutawaySceneIds:[]};
    previous.narration=kind==='map'?'In May 1963, the deal collapsed. Ford would have to build his own winner.':'Headlights cut through darkness. Mechanics fight exhaustion while drivers fight the clock.';
    previous.durationSeconds=kind==='map'?5.7:4.9;previous.documentary!.timing!.durationInFrames=kind==='map'?171:147;
    scene.narration=kind==='map'?'The story links three places: Detroit, Modena, and Le Mans.':'Only 3 of 8 Mark Two Fords reach the finish.';
    scene.durationSeconds=kind==='map'?143/30:86/30;scene.documentary!.timing!.durationInFrames=kind==='map'?143:86;
    if(kind==='map'){
      previous.documentary!.requirement.years=['1963'];
      previous.documentary!.semanticMontage!.composition={kind:'chronology',variant:'date',value:'May 1963'};
    }
    else previous.documentary!.semanticMontage!.emphasis='Mechanics fight exhaustion while drivers fight the clock';
    scene.documentary!.semanticMontage!.composition=kind==='map'?{kind:'map-route',items:['Detroit','Modena','Le Mans']}:{kind:'statistic',value:'3 of 8'};
    const before=structuredClone(p),result=enrichSemanticMontage(p),graphic=result[2]!.documentary!.motionGraphic;
    assert.equal(graphic?.kind,kind==='map'?'map-route':'statistic');
    if(kind==='ratio'){
      assert.equal(graphic?.value,'3 of 8');assert.equal(result[1]!.documentary!.motionGraphic,undefined,'fallback phrase yields its lead-in to explicit data');
    }else assert.equal(result[1]!.documentary!.motionGraphic?.kind,'chronology','explicit preceding date is retained');
    assert.deepEqual(result.map(s=>[s.narration,s.audioPath,s.imagePath,s.documentary!.timing]),before.scenes.map(s=>[s.narration,s.audioPath,s.imagePath,s.documentary!.timing]));
    assert.equal(JSON.stringify(enrichSemanticMontage({...p,scenes:result})),JSON.stringify(result));assert.deepEqual(p,before);
    scene.documentary!.semanticMontage!.composition={kind:'statistic',value:'999'};
    assert.equal(enrichSemanticMontage(p)[2]!.documentary!.motionGraphic,undefined,'invalid data cannot receive priority');
    if(kind==='ratio')assert.equal(enrichSemanticMontage(p)[1]!.documentary!.motionGraphic?.kind,'key-point');
    scene.documentary!.template='full';scene.documentary!.templateOrigin='manual';
    scene.documentary!.semanticMontage!.composition={kind:'statistic',value:'3 of 8'};
    assert.equal(enrichSemanticMontage(p)[2]!.documentary!.motionGraphic,undefined,'manual scene remains untouched');
  }
});

test('chapter holds retain intro pacing while explicit statistics take precedence over fallback phrases',()=>{
  const cases=[
    {frames:[530,223,88,140,120],chapter:'Chapter 1: The Refusal',
      opening:'Three years earlier, Henry Ford the Second wanted to buy Ferrari.',
      middle:'Ford had factories, money, and mass production.',middleEmphasis:'factories, money, and mass production',
      ending:'Ferrari had racing victories, hand-built sports cars, and prestige.',emphasis:'hand-built sports cars, and prestige',duration:3,statistic:false},
    {frames:[1819,183,130,124,120],chapter:'Chapter 2: Building the Weapon',
      opening:'The result was the Ford GT40.',
      middle:'Its name referred to a height of just 40 inches: barely more than one metre.',middleEmphasis:'40 inches',
      ending:'Low roof. Wide stance. An engine behind the driver.',emphasis:'Low roof. Wide stance.',duration:2.6,statistic:true}
  ];
  for(const sample of cases){
    const p=project(5),narration=['The story begins in the workshop.',`${sample.chapter}\n\n${sample.opening}`,sample.middle,sample.ending,'Ford built the next machine for a much longer race.'];
    p.videoBrief={readyScript:narration.join('\n\n')} as Project['videoBrief'];
    p.scenes.forEach((scene,i)=>{
      scene.narration=narration[i]!;scene.durationSeconds=sample.frames[i]!/30;
      scene.documentary!.timing!.durationInFrames=sample.frames[i]!;
      scene.documentary!.timing!.speechSeconds=sample.frames[i]!/30;
      scene.documentary!.semanticMontage={sceneId:scene.id,subject:'',beat:'explain',treatment:'footage',cutawaySceneIds:[]};
    });
    p.scenes[2]!.documentary!.semanticMontage!.emphasis=sample.middleEmphasis;
    if(sample.statistic)p.scenes[2]!.documentary!.semanticMontage!.composition={kind:'statistic',title:'',value:sample.middleEmphasis};
    p.scenes[3]!.documentary!.semanticMontage!.emphasis=sample.emphasis;
    p.scenes[3]!.documentary!.motionGraphic={kind:'key-point',enabled:true,title:sample.emphasis,kicker:'',value:'',startSeconds:0,durationSeconds:sample.duration,origin:'automatic',sourceChecksum:'hash-3',mapStyle:'inset'};
    p.scenes[4]!.documentary!.semanticMontage!.emphasis='Ford';
    const before=structuredClone(p),result=enrichSemanticMontage(p),chapter=result[1]!.documentary!.motionGraphic,accent=result[3]!.documentary!.motionGraphic;
    assert.equal(chapter?.kind,'chapter-number');assert.ok(chapter!.durationSeconds<=3.2,'a chapter introduces the section without occupying its complete scene');
    assert.ok(chapter!.startSeconds+chapter!.durationSeconds<sample.frames[1]!/30-2,'the source continues after the chapter');
    if(sample.statistic){
      assert.equal(result[2]!.documentary!.motionGraphic?.kind,'statistic');assert.equal(result[2]!.documentary!.motionGraphic?.value,'40 inches');
      assert.equal(accent,undefined,'the explicit quantity takes precedence over a later fallback phrase');
    }else{
      assert.equal(result[2]!.documentary!.motionGraphic?.kind,'explainer','an explicit list emphasis becomes a structured explanation after the chapter');
      assert.deepEqual(result[2]!.documentary!.motionGraphic?.cards?.map(c=>c.label),['factories','money','mass production']);
      assert.equal(accent?.kind,'explainer');assert.deepEqual(accent?.cards?.map(c=>c.label),['racing victories','hand-built sports cars','prestige']);
      assert.ok(accent!.durationSeconds<=5.5);assert.ok(accent!.startSeconds>0,'the phrase follows its literal position');
    }
    assert.equal(result[4]!.documentary!.motionGraphic,undefined,'ordinary emphasis spacing remains active');
    const normalized=enrichSemanticMontage({...p,scenes:result});
    assert.deepEqual(normalized[3]!.documentary!.motionGraphic,accent,'repeated normalization retains the accepted phrase');
    assert.deepEqual(p,before,'normalization does not mutate its input');
  }
});

test('saved real Rossi response retains scene two cutaways and the scene at 16.83 seconds',async t=>{
  const projectPath=process.env.GWS_ROSSI_PACE_PROJECT,receiptPath=process.env.GWS_ROSSI_PACE_RECEIPT;
  if(!projectPath&&!receiptPath)return t.skip('Set both GWS_ROSSI_PACE_PROJECT and GWS_ROSSI_PACE_RECEIPT to the saved acceptance files.');
  assert.ok(projectPath&&receiptPath,'both saved acceptance paths are required');
  const p=JSON.parse(await readFile(projectPath,'utf8')) as Project;
  const receipt=JSON.parse(await readFile(receiptPath,'utf8')) as {state:string;result:{scenes:DocumentarySemanticMontage['scenes']}};
  assert.equal(receipt.state,'complete');assert.equal(receipt.result.scenes.length,50);
  const ordered=p.scenes.filter(s=>s.includeInAssembly!==false).sort((a,b)=>a.order-b.order);
  const ids=new Map(ordered.map((s,i)=>[`s${i}`,s.id]));
  const directions=validateMontageDirections({scenes:receipt.result.scenes.map(s=>({...s,sceneId:ids.get(s.sceneId)??s.sceneId,
    cutawaySceneIds:s.cutawaySceneIds?.map(id=>ids.get(id)??id),composition:s.composition&&{...s.composition,cards:s.composition.cards?.map(c=>({...c,sceneId:c.sceneId?(ids.get(c.sceneId)??c.sceneId):undefined}))}}))},ordered,ordered,p);
  const byId=new Map(directions.map(d=>[d.sceneId,d]));
  p.scenes=p.scenes.map(s=>({...s,documentary:{...s.documentary!,semanticMontage:byId.get(s.id)}}));
  const inputHash=semanticMontageHash(p),scenes=enrichSemanticMontage(p),byScene=new Map(scenes.map(s=>[s.id,s]));
  const second=byScene.get('doc-bc7b5b1314fc2e253074')!,fourth=byScene.get('doc-0d89b049c78058e3a20e')!;
  assert.equal(second.documentary!.motionGraphic?.title,"hadn't won a single race all year");
  assert.equal(second.documentary!.semanticMontage!.cutawaySceneIds.length,2);
  assert.deepEqual(second.documentary!.cuts?.map(c=>c.sourceSceneId),[second.id,...second.documentary!.semanticMontage!.cutawaySceneIds]);
  assert.equal(second.documentary!.cuts?.reduce((sum,c)=>sum+c.durationInFrames,0),165);
  assert.deepEqual(fourth.documentary!.cuts?.map(c=>c.sourceSceneId),[fourth.id,'doc-a2677586712662b6fae3']);
  for(const beat of ['turn','evidence'])assert.ok(scenes.some(s=>s.documentary?.semanticMontage?.beat===beat&&(s.documentary.cuts?.length??0)>1),`saved ${beat} proposals reach the timeline`);
  assert.deepEqual(scenes.map(s=>[s.narration,s.audioPath,s.durationSeconds,s.documentary!.timing]),p.scenes.map(s=>[s.narration,s.audioPath,s.durationSeconds,s.documentary!.timing]));
  assert.equal(semanticMontageHash({...p,scenes}),inputHash);
  assert.deepEqual(enrichSemanticMontage({...p,scenes}),scenes);
});

test('short hook video gives remaining frames to approved cutaways without stretching voice or source range',()=>{
  const p=project(3),first=p.scenes[0]!;
  first.videoPath='short.mp4';first.imagePath=undefined;first.durationSeconds=7.1;
  first.documentary!.timing!.durationInFrames=213;first.documentary!.selected!.durationSeconds=1.98;
  const scenes=enrichSemanticMontage(p),cuts=scenes[0]!.documentary!.cuts!;
  assert.deepEqual(cuts.map(c=>[c.fromFrame,c.durationInFrames]),[[0,59],[59,77],[136,77]]);
  assert.deepEqual(cuts.map(c=>c.sourceSceneId),['scene-0','scene-1','scene-2']);
  assert.equal(buildDocumentaryTimeline({...p,scenes}).durationInFrames,213+181*2);
  assert.deepEqual(scenes.map(s=>[s.narration,s.audioPath,s.documentary!.timing]),p.scenes.map(s=>[s.narration,s.audioPath,s.documentary!.timing]));
  for(const s of p.scenes){s.videoPath='short-'+s.id+'.mp4';s.imagePath=undefined;s.documentary!.selected!.durationSeconds=1;}
  assert.equal(enrichSemanticMontage(p)[0]!.documentary!.cuts,undefined,'insufficient approved material cannot pretend to cover narration');
});

test('hook skips flashing short inserts and duplicate files without losing a usable later cutaway',()=>{
  const p=project(4),first=p.scenes[0]!;
  first.documentary!.semanticMontage!.cutawaySceneIds=['scene-1','scene-2','scene-3'];
  const short=p.scenes[1]!;short.videoPath='short.mp4';short.documentary!.selected!.durationSeconds=.2;
  const out=enrichSemanticMontage(p)[0]!,cuts=out.documentary!.cuts!;
  assert.deepEqual(cuts.map(c=>c.sourceSceneId),['scene-0','scene-2','scene-3']);
  assert.ok(cuts.every(c=>c.durationInFrames>=42));
  assert.equal(cuts.reduce((n,c)=>n+c.durationInFrames,0),181);
  short.videoPath=undefined;
  p.scenes[2]!.documentary!.checksum=short.documentary!.checksum;
  p.scenes[2]!.imagePath=short.imagePath;
  assert.deepEqual(enrichSemanticMontage(p)[0]!.documentary!.cuts!.map(c=>c.sourceSceneId),['scene-0','scene-1','scene-3']);
  assert.equal(out.narration,first.narration);assert.equal(out.audioPath,first.audioPath);
});

test('cutaway eligibility rejects other identities, periods and duplicate files; accepted Pexels stays unverified',()=>{
  const p=project(5),scene=p.scenes[0]!;
  p.scenes[1]!.documentary!.requirement.years=['2020'];p.scenes[2]!.documentary!.requirement.identities=[{name:'Ferrari'} as never];
  p.scenes[3]!.imagePath=scene.imagePath;
  const accepted=p.scenes[4]!,doc=accepted.documentary!;doc.verified=false;
  doc.selected={...doc.selected!,provider:'pexels',localPath:accepted.imagePath} as unknown as NonNullable<typeof doc.selected>;
  doc.manualReview={version:1,status:'pending',provider:'pexels',candidateId:doc.selected!.id,kind:'image',checksum:doc.checksum!,narration:accepted.narration,mediaPath:accepted.imagePath!,reason:'User accepted fallback'} as never;
  assert.deepEqual(montageCutawaySources(scene,p.scenes).map(s=>s.id),[accepted.id]);
  p.scenes[1]!.documentary!.requirement.years=['1966'];p.scenes[1]!.documentary!.requirement.identities=[{name:'Ford and Ferrari negotiations'} as never];
  assert.ok(montageCutawaySources(scene,p.scenes).some(s=>s.id==='scene-1'),'compound names retain a shared named subject');
  scene.documentary!.semanticMontage!.cutawaySceneIds=[accepted.id];
  const scenes=enrichSemanticMontage(p);assert.equal(scenes[0]!.documentary!.cuts?.[1]?.sourceSceneId,accepted.id);
  assert.equal(scenes[4]!.documentary!.verified,false);assert.deepEqual(scenes[4]!.documentary!.manualReview,doc.manualReview);
});

test('graphics require literal text, maps resolve real coordinates, subjects request alpha segmentation',()=>{
  const p=project(2);p.scenes[0]!.narration='Ford raced in Tokyo in 1966.';
  const directions=validateMontageDirections({scenes:[{sceneId:'scene-0',subject:'Ford',location:'Tokyo',emphasis:'99%',beat:'explain',treatment:'map',cutawaySceneIds:['scene-1','invented']}]},[p.scenes[0]!],p.scenes);
  assert.equal(directions[0]!.emphasis,undefined);assert.deepEqual(directions[0]!.cutawaySceneIds,['scene-1']);
  p.scenes[0]!.documentary!.semanticMontage=directions[0];
  let scene=enrichSemanticMontage(p)[0]!,graphic=scene.documentary!.motionGraphic!;
  assert.equal(graphic.kind,'map-locator');assert.ok(Math.abs(graphic.place!.latitude-35.7)<1);assert.ok(Math.abs(graphic.place!.longitude-139.7)<1);
  p.scenes[0]!.documentary!.semanticMontage={...directions[0]!,treatment:'subject'};
  scene=enrichSemanticMontage(p)[0]!;assert.equal(scene.documentary!.motionGraphic!.isolateSubject,true);assert.equal(scene.documentary!.cuts,undefined);
  p.scenes[0]!.documentary!.semanticMontage={...directions[0]!,location:'Atlantis'};
  assert.equal(enrichSemanticMontage(p)[0]!.documentary!.motionGraphic,undefined);
});

test('editorial and cinematic TV treatment follows saved meaning and manual TV survives',()=>{
  const p=project(24);for(const scene of p.scenes)scene.documentary!.semanticMontage!.treatment='television';
  const rich=enrichSemanticMontage(p);
  const richBroadcast=rich.filter(s=>s.documentary!.template?.startsWith('broadcast-'));
  assert.ok(richBroadcast.length>0);
  assert.ok(rich.filter(s=>!s.documentary!.motionGraphic).every(s=>s.documentary!.template==='broadcast-scanlines'),'explicit television direction applies outside graphic compositions');
  assert.deepEqual(rich.map(s=>[s.narration,s.audioPath,s.imagePath]),p.scenes.map(s=>[s.narration,s.audioPath,s.imagePath]));
  const cinematic=structuredClone(p);cinematic.settings.assembly.documentary!.montage!.style='cinematic';
  const scenes=enrichSemanticMontage(cinematic),broadcast=scenes.filter(s=>s.documentary!.template!.startsWith('broadcast-'));
  assert.ok(broadcast.length>0);assert.ok(broadcast.every(s=>!s.documentary!.cuts));
  for(const scene of p.scenes){scene.documentary!.semanticMontage!.treatment='footage';scene.documentary!.semanticMontage!.cutawaySceneIds=[];}
  assert.ok(enrichSemanticMontage(p).every(s=>['full','push'].includes(s.documentary!.template!)),'conflict keeps a push or a complete graphic');
  for(const scene of cinematic.scenes){scene.documentary!.semanticMontage!.treatment='footage';scene.documentary!.semanticMontage!.cutawaySceneIds=[];}
  assert.ok(enrichSemanticMontage(cinematic).every(s=>['full','push'].includes(s.documentary!.template!)),'cinematic layout also follows meaning');
  p.scenes[10]!.documentary!.template='broadcast-crt';p.scenes[10]!.documentary!.templateOrigin='manual';
  assert.deepEqual(enrichSemanticMontage(p)[10],p.scenes[10],'an explicitly chosen TV frame remains authored');
});

test('57-scene plan uses compact completions and cache survives restart, visual edits do not invalidate it',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-montage-cache-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const p=project(57);let calls=0;const batches:number[]=[];
  const complete=async(s:string,i:string)=>{calls++;batches.push(JSON.parse(i).scenes.length);return answer(s,i);};
  const first=await createSemanticMontagePlan(p,root,complete,'configured-text');assert.equal(calls,8);assert.equal(first.scenes.length,57);
  assert.deepEqual(batches,[8,8,8,8,8,8,8,1]);
  assert.equal(JSON.stringify(await createSemanticMontagePlan(p,root,complete,'configured-text')),JSON.stringify(first));assert.equal(calls,8);
  assert.equal(semanticMontageHash({...p,scenes:planDocumentaryMontage(p)}),first.inputHash);
  p.settings.assembly.documentary!.montage!.background={mode:'off'};p.settings.assembly.documentary!.montage!.musicPolicy='off';
  assert.equal(semanticMontageHash(p),first.inputHash,'background and music must not purchase a new semantic plan');
});

test('completed batches persist before a later failure and are reused; missing response rows fail explicitly',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-montage-resume-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const p=project(65);let calls=0;
  await assert.rejects(createSemanticMontagePlan(p,root,async(s,i)=>{if(++calls===2)throw new Error('stop');return answer(s,i);},'configured-text'),/stop/);
  let resumed=0;const resumedIds:string[]=[];
  const result=await createSemanticMontagePlan(p,root,async(s,i)=>{resumed++;resumedIds.push(...JSON.parse(i).scenes.map((row:{sceneId:string})=>row.sceneId));return answer(s,i);},'configured-text');
  assert.equal(result.scenes.length,65);assert.equal(resumed,8);
  assert.deepEqual(resumedIds,Array.from({length:57},(_,i)=>`s${i+8}`),'the completed first eight scenes are not submitted again');
  p.scenes[0]!.narration='Changed narration';
  await assert.rejects(createSemanticMontagePlan(p,root,async()=>({scenes:[]}),'configured-text'),/no-retry/);
});

test('opening sound accents follow cuts, later accents are sparse, voice and copied audio survive timeline',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-montage-sfx-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(join(root,'click.wav'),'fixture-copy-only');await writeFile(join(root,'ding.wav'),'fixture-copy-only');
  const assets=['click','ding'].map(id=>({id,name:id,file:`${id}.wav`,version:1,kind:'audio',category:id,state:'ready',automatic:true,review:'approved',rights:'user-confirmed',
    defaults:{volume:65,opacity:100,trimStartSeconds:0,fadeInSeconds:0,fadeOutSeconds:0},metadata:{durationSeconds:.2,peakDb:-4}})) as EffectAsset[];
  const library={rootPath:root,snapshot:async()=>({assets})} as unknown as EffectLibrary,storage={projectDirectory:()=>join(root,'project')} as unknown as LocalProjectStorage;
  const p=project(25);p.scenes=enrichSemanticMontage(p);
  const events=documentaryMontageSoundEvents(p),at=events.map(e=>p.scenes.findIndex(s=>s.id===e.sceneId)*181/30+e.seconds);
  assert.ok(at.filter(s=>s<16).length>=4);assert.ok(at.filter(s=>s>=16).length<9);
  const body=at.filter(s=>s>=16);assert.ok(body.every((s,i)=>!i||s-body[i-1]!>=16));
  const scenes=await planDocumentaryEffects(p,library,storage),timeline=buildDocumentaryTimeline({...p,scenes});
  const sounds=timeline.scenes.flatMap(s=>s.documentary!.effects.filter(e=>e.kind==='audio'));assert.ok(sounds.length>=4);
  assert.ok(sounds.every(e=>e.origin==='automatic'&&e.defaults.volume<=65));assert.equal(await readFile(sounds[0]!.filePath,'utf8'),'fixture-copy-only');
  assert.ok(timeline.scenes.every(s=>s.narrationEnabled&&s.audioPath));
  p.settings.assembly.documentary!.autoEffects=false;p.settings.assembly.documentary!.autoTransitions=false;p.settings.assembly.documentary!.autoMotionGraphics=false;
  assert.equal((await planDocumentaryEffects({...p,scenes},library,storage)).flatMap(s=>s.documentary!.effects).filter(e=>e.kind==='audio').length,0);
});

test('accepted illustrative object can be isolated, abstract or unreviewed subjects cannot',()=>{
  const p=project(1),s=p.scenes[0]!,doc=s.documentary!;
  s.narration='But the car they helped develop needed sufficient cooling.';
  doc.illustrative=true;doc.requirement.identities=[{name:'Ford GT40 development effort',aliases:[]}];
  doc.visualReview={status:'accepted',confidence:0,reason:'Visible car',quality:'',viewDescription:'A Ford GT40 race car at an outdoor street show.',fastRelevance:{version:1,target:'Ford GT40',relevant:true,evidence:'Visible car'},checkedAt:'2026-10-19',sampleSeconds:[0]};
  doc.semanticMontage={...doc.semanticMontage!,subject:'the car',treatment:'subject'};
  assert.equal(enrichSemanticMontage(p)[0]!.documentary!.motionGraphic?.isolateSubject,true);
  assert.equal(enrichSemanticMontage(p)[0]!.documentary!.motionGraphic?.hideTitle,true);
  assert.equal(enrichSemanticMontage(p)[0]!.documentary!.illustrative,true);
  doc.semanticMontage.subject='sufficient cooling';assert.equal(enrichSemanticMontage(p)[0]!.documentary!.motionGraphic,undefined);
  doc.semanticMontage.subject='the car';doc.visualReview!.status='rejected';assert.equal(enrichSemanticMontage(p)[0]!.documentary!.motionGraphic,undefined);
});

test('cutaways do not immediately return to the preceding primary source',()=>{
  const p=project(3),scene=p.scenes[1]!;
  p.settings.assembly.documentary!.montage!.intensity='balanced';p.scenes[0]!.documentary!.semanticMontage!.cutawaySceneIds=[];
  scene.documentary!.semanticMontage!.cutawaySceneIds=[p.scenes[0]!.id,p.scenes[2]!.id];
  const result=enrichSemanticMontage(p)[1]!;
  assert.ok(result.documentary!.cuts?.some(c=>c.sourceSceneId===p.scenes[2]!.id));
  assert.ok(!result.documentary!.cuts?.some(c=>c.sourceSceneId===p.scenes[0]!.id));
});

test('empty rich opening borrows only compatible forward sources already proposed in the same hook',()=>{
  const p=project(5);for(const s of p.scenes)s.documentary!.semanticMontage!.cutawaySceneIds=[];
  p.scenes[1]!.documentary!.semanticMontage!.cutawaySceneIds=[p.scenes[3]!.id];
  const result=enrichSemanticMontage(p);
  assert.ok(result[0]!.documentary!.cuts?.some(c=>c.sourceSceneId===p.scenes[3]!.id));
  assert.ok(!result[1]!.documentary!.cuts?.some(c=>c.sourceSceneId===p.scenes[3]!.id),'do not replay borrowed source');
  p.scenes[3]!.documentary!.requirement.identities=[{name:'Unrelated ship',aliases:[]}];
  assert.equal(enrichSemanticMontage(p)[0]!.documentary!.cuts,undefined);
});

test('video poster does not turn ordinary body footage into a still-image frame',()=>{
  const p=project(8),s=p.scenes[6]!;
  s.videoPath='movie.mp4';s.imagePath='poster.jpg';s.documentary!.semanticMontage!.treatment='footage';s.documentary!.semanticMontage!.cutawaySceneIds=[];
  assert.equal(enrichSemanticMontage(p)[6]!.documentary!.template,'full');
});

test('literal location gets one local map; screen-media context respects the montage style',()=>{
  const p=project(18);
  for(const s of p.scenes)s.documentary!.semanticMontage={...s.documentary!.semanticMontage!,treatment:'footage',cutawaySceneIds:[],location:undefined};
  for(const i of [5,12]){const s=p.scenes[i]!;s.narration='At Le Mans, the race returned.';s.documentary!.semanticMontage!.location='Le Mans';}
  p.scenes[3]!.narration='The film told their story.';
  const result=enrichSemanticMontage(p);
  assert.equal(result.filter(s=>s.documentary!.motionGraphic?.kind==='map-locator').length,1);
  assert.equal(result[5]!.documentary!.motionGraphic?.place?.name,'Le Mans');
  assert.ok(result[3]!.documentary!.template?.startsWith('broadcast-'),'the requested TV treatment is available in rich editorial mode');
  const cinematic=structuredClone(p);cinematic.settings.assembly.documentary!.montage!.style='cinematic';
  const cinematicResult=enrichSemanticMontage(cinematic);
  assert.ok(cinematicResult[3]!.documentary!.template?.startsWith('broadcast-'),'the existing screen-media cue still selects TV in cinematic style');
  assert.equal(cinematicResult.filter(s=>s.documentary!.motionGraphic?.kind==='map-locator').length,1);
  assert.equal(cinematicResult[5]!.documentary!.motionGraphic?.place?.name,'Le Mans');
  p.scenes[5]!.narration='A different place.';
  assert.equal(enrichSemanticMontage(p)[5]!.documentary!.motionGraphic,undefined);
});

test('render validation accepts the grounded word-number statistic plan',()=>{
  const p=project(1),s=p.scenes[0]!;s.narration='Its low body stood roughly forty inches tall.';
  s.documentary!.semanticMontage={...s.documentary!.semanticMontage!,treatment:'statistic',emphasis:'forty inches tall',subject:'Its low body'};
  p.scenes=enrichSemanticMontage(p);
  assert.equal(p.scenes[0]!.documentary!.motionGraphic?.kind,'statistic');
  assert.ok(!documentaryEditErrors(p).some(e=>e.includes('число для счётчика')));
  const changed=p.scenes[0]!,doc=changed.documentary!;doc.verified=false;
  doc.selected={...doc.selected!,id:'sample',provider:'pexels',kind:'image',localPath:changed.imagePath};
  doc.manualReview={version:1,status:'pending',provider:'pexels',kind:'image',candidateId:'sample',checksum:doc.checksum!,mediaPath:changed.imagePath!,narration:changed.narration,reason:'Unverified source'};
  assert.equal(enrichSemanticMontage(p)[0]!.documentary!.motionGraphic?.showSource,false);
});

test('saved manual and legacy audio reserve space around automatically planned accents',()=>{
  const p=project(30),scene=p.scenes[7]!;
  scene.documentary!.effects=[{id:'authored',enabled:true,kind:'audio',startSeconds:-.5} as never];
  const at=7*181/30-.5;
  assert.ok(documentaryMontageSoundEvents(p).every(e=>{const time=p.scenes.findIndex(s=>s.id===e.sceneId)*181/30+e.seconds;return Math.abs(time-at)>=(time<16?2.3:16);}));
  assert.equal(scene.documentary!.effects[0]!.enabled,true);
});

test('selected background is real silent timeline media; manual backgrounds win and off removes automatic backgrounds',()=>{
  const p=project(1),settings=p.settings.assembly.documentary!;p.scenes[0]!.documentary!.template='editorial-orbit';
  settings.montage!.background={mode:'library',assetId:'background'};settings.resolvedBackground={assetId:'background',path:'background.mp4',kind:'video',name:'Background',durationSeconds:2};
  const layer=buildDocumentaryTimeline(p,path=>`local:${path}`).scenes[0]!.documentary!.effects[0]!;
  assert.equal(layer.filePath,'local:background.mp4');assert.equal(layer.defaults.sourceAudio,false);assert.equal(layer.defaults.volume,0);assert.equal(layer.defaults.trimEndSeconds,2);
  const manual={...layer,id:'manual',filePath:'authored.png',origin:'manual' as const};p.scenes[0]!.documentary!.effects=[manual as never];
  assert.equal(buildDocumentaryTimeline(p).scenes[0]!.documentary!.effects[0]!.id,'manual');
  settings.montage!.background={mode:'off'};p.scenes[0]!.documentary!.effects.push(layer as never);
  assert.deepEqual(buildDocumentaryTimeline(p).scenes[0]!.documentary!.effects.map(e=>e.id),['manual']);
});

test('music preserve makes no helper request, off retains the track but removes it from the real timeline',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-montage-off-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const p=project(1);p.settings.music={...p.settings.music,enabled:true,path:'stale.mp3',name:'Stale',assetId:'old',sourcePage:'old'};
  const preserved=await prepareDocumentaryMontageMedia(p,join(root,'project'),root);assert.equal(preserved.settings.music,p.settings.music);
  p.settings.assembly.documentary!.montage!.musicPolicy='off';
  const disabled=await prepareDocumentaryMontageMedia(p,join(root,'project'),root);assert.equal(disabled.settings.music.path,'stale.mp3');assert.equal(disabled.settings.music.enabled,false);assert.equal(disabled.settings.music.selectionStatus,'off');
  assert.equal(buildDocumentaryTimeline(disabled).music,undefined);
});

test('music media ignores stale semantic sections and uses the new passed plan without another completion',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-montage-media-cues-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const network=t.mock.method(globalThis,'fetch',async()=>{throw Error('This local fixture must not request network or a completion');});
  const planning=t.mock.method(DocumentaryIntelligence.prototype,'planSemanticMontage',async()=>{throw Error('Media preparation must not plan again');});
  const samples=32*8000,wav=Buffer.alloc(44+samples*2);
  wav.write('RIFF');wav.writeUInt32LE(36+samples*2,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
  wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
  for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(3000*Math.sin(i*2*Math.PI*220/8000)),44+i*2);
  const track=join(root,'energetic.wav');await writeFile(track,wav);
  const imported=await importDocumentaryMusic(track,join(root,'Music'),{name:'Energetic cinematic instrumental',tags:['energetic','cinematic','driving']});
  const p=project(3);p.settings.assembly.documentary!.montage!.musicPolicy='automatic';
  const silence={startSceneId:'scene-0',endSceneId:'scene-2',role:'narration' as const,mood:'silence' as const};
  p.scenes[0]!.documentary!.semanticMontage!.musicSection=silence;p.scenes[0]!.documentary!.semanticMontageInputHash='stale';
  const unknown=await prepareDocumentaryMontageMedia(p,join(root,'project'),root);
  const clips=unknown.settings.music.clips!;
  assert.equal(unknown.settings.music.selectionStatus,'ready');assert.equal(clips.length,1,'stale silence is ignored in favor of a grouped local fallback');
  assert.equal(clips[0]?.status,'ready');assert.equal(clips[0]?.assetId,imported.split(/[\\/]/u).at(-1)!.replace(/\.wav$/u,''));
  assert.equal(clips[0]?.startSeconds,0);assert.ok(clips[0]!.durationSeconds>12,'one connected span covers several scenes');
  assert.ok(clips[0]!.path);await readFile(clips[0]!.path!);
  p.scenes[0]!.documentary!.semanticMontageInputHash=semanticMontageHash(p);
  p.scenes[0]!.documentary!.semanticMontage!.musicSection={...silence,mood:'energetic'};
  const plan={version:1 as const,inputHash:semanticMontageHash(p),model:'fixture',hookSeconds:16,scenes:[],musicSections:[silence]};
  const current=await prepareDocumentaryMontageMedia(p,join(root,'project'),root,undefined,undefined,plan);
  assert.deepEqual(current.settings.music.clips,[],'explicit silence overrides even a current saved non-silent cue');assert.equal(current.settings.music.selectionStatus,'off');
  p.scenes[0]!.documentary!.semanticMontage!.musicSection=silence;
  const restored=await prepareDocumentaryMontageMedia(p,join(root,'project'),root);
  assert.deepEqual(restored.settings.music.clips,[]);
  assert.equal(network.mock.callCount(),0);assert.equal(planning.mock.callCount(),0);
});

test('music spans and dramatic directions share compact responses and persist through restart',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-montage-sections-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const p=project(15);p.language='es';p.videoBrief={readyScript:'## Capítulo 7: La caída\n\n'+p.scenes.map(s=>s.narration).join('\n')} as Project['videoBrief'];
  let calls=0;
  const complete=async(system:string,input:string)=>{calls++;const value=JSON.parse(input);
    assert.equal(value.language,'es');assert.match(system,/musicSections/);
    const first=value.scenes[0].sceneId,last=value.scenes.at(-1).sceneId;
    return {scenes:value.scenes.map((s:{sceneId:string})=>({...s,subject:'Ford',beat:'conflict',treatment:'footage',vignette:true,monochrome:true,cutawaySceneIds:[],chapter:{title:'INVENTED'}})),
      musicSections:first==='s0'?[{startSceneId:'s0',endSceneId:'s2',role:'hook',mood:'tension'},{startSceneId:'s3',endSceneId:'s3',role:'turn',mood:'silence'},
        {startSceneId:'s4',endSceneId:last,role:'narration',mood:'calm'}]:[{startSceneId:first,endSceneId:last,role:'narration',mood:'calm'}]};};
  const first=await createSemanticMontagePlan(p,root,complete,'configured-text');
  assert.equal(calls,2);assert.equal(first.musicSections?.length,3);assert.equal(first.scenes[0]?.chapter?.title,'La caída');
  assert.equal(first.musicSections?.[2]?.endSceneId,'scene-14','matching musical spans continue across the compact boundary');
  assert.equal(first.scenes[3]?.musicSection?.mood,'silence');assert.equal(first.scenes[4]?.language,'es');
  assert.equal(first.scenes.filter(s=>s.monochrome).length,3);
  assert.equal(JSON.stringify(await createSemanticMontagePlan(p,root,complete,'configured-text')),JSON.stringify(first));assert.equal(calls,2);
});

test('long-film music continuation survives later batches while one joined whole-film bed is rejected',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-montage-long-music-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const p=project(180);let calls=0;
  const complete=async(system:string,input:string)=>{
    calls++;const value=JSON.parse(input),first=value.scenes[0].sceneId,last=value.scenes.at(-1).sceneId;
    return {...await answer(system,input),musicSections:first==='s0'?
      [{startSceneId:'s0',endSceneId:'s2',role:'hook',mood:'tension'},{startSceneId:'s3',endSceneId:last,role:'narration',mood:'calm'}]
      :[{startSceneId:first,endSceneId:last,role:'narration',mood:'calm'}]};
  };
  const plan=await createSemanticMontagePlan(p,root,complete,'fixture');
  assert.equal(calls,23);assert.deepEqual(plan.musicSections,[
    {startSceneId:'scene-0',endSceneId:'scene-2',role:'hook',mood:'tension'},
    {startSceneId:'scene-3',endSceneId:'scene-179',role:'narration',mood:'calm'}]);
  await rm(join(root,'Documentary','Montage',`${semanticMontageHash(p)}.json`));
  const resumed=await createSemanticMontagePlan(p,root,async()=>{throw Error('Saved batches must not submit again');},'fixture');
  assert.deepEqual(resumed.musicSections,plan.musicSections);
  const uninterrupted=await createSemanticMontagePlan(p,join(root,'one-bed'),async(system,input)=>{
    const value=JSON.parse(input);return {...await answer(system,input),musicSections:[{startSceneId:value.scenes[0].sceneId,endSceneId:value.scenes.at(-1).sceneId,role:'narration',mood:'calm'}]};
  },'fixture');
  assert.deepEqual(uninterrupted.musicSections,[]);
});

for(const predecessor of ['original','music','rossi','pace','composition','brief'] as const)for(const state of predecessor==='rossi'?['pending','received','partial']:['pending'])test(`new prompt re-enters exact ${predecessor} ${state} receipt without sending a paid replacement`,async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-montage-legacy-pending-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const p=project(2);let system='',input='';
  await assert.rejects(createSemanticMontagePlan(p,root,async(s,i)=>{system=s;input=i;throw Error('capture only');},'configured-text'),/capture only/);
  let legacySystem=predecessor==='original'
    ?'You are a documentary editor. Return JSON {scenes:[{sceneId,subject,location?,beat,emphasis?,treatment,cutawaySceneIds:[]}]}. '
      +'Plan meaning and rhythm, not decoration. Subject, location and emphasis must be exact short quotations from that scene narration. '
      +'beat: establish|conflict|evidence|explain|turn|resolve; treatment: footage|archive|television|map|subject|statistic|quote. '
      +'Opening 10–20 seconds: establish stakes, vary supporting shots where the approved sources explain the SAME claim. '
      +'Choose 0–2 cutawaySceneIds only from that row allowedSources, only if their observed content and period support this narration. '
      +'Do not turn later victory footage into proof of an earlier defeat or generic footage into a named event. Empty cuts are correct when sources do not fit. '
      +'Requested subjects/years describe the narration request, NOT verified source content. User-accepted illustrative/manual-review sources may support an idea editorially, never prove a historical event. '
      +'Use map only when geography is being explained, never for a company/person with a geographic name. '
      +'Use subject only for an explicitly introduced person/object visible in the selected image. Television only for actual broadcast/interview/archive context, occasionally. '
      +'Use statistic only with an exact quantity in emphasis, quote only for actual quoted speech. Most body scenes remain footage. No invented facts, captions or coordinates.'
    :system.split(predecessor==='brief'?'\nCURRENT EDITING DENSITY':predecessor==='music'?' Rossi reference compositions:':predecessor==='rossi'?' Narrative pace:':predecessor==='pace'?' Composition fields:':' Artwork intent:')[0]!;
  // Historical requests did not contain replacement/source-eligibility or
  // full-story direction fields. A hybrid with today's fields was never sent.
  const {artworkContinuations:_continuations,storyContext:_story,previousDirections:_directions,...payload}=JSON.parse(input);
  payload.sources=payload.sources.map((row:Record<string,unknown>)=>({id:row.id,kind:row.kind,requestedSubjects:row.requestedSubjects,
    requestedYears:row.requestedYears,observed:row.observed??'',illustrative:row.illustrative,manualReview:row.manualReview}));
  payload.scenes=payload.scenes.map((row:Record<string,unknown>)=>({sceneId:row.sceneId,narration:row.narration,startSeconds:row.startSeconds,
    seconds:row.seconds,allowedSources:row.allowedSources,...(predecessor==='brief'?{artworkEditable:row.artworkEditable}:{})}));
  let legacyInput=input;
  if(predecessor==='original'){
    const {language:_language,previousMusicSection:_previous,...original}=payload;legacyInput=JSON.stringify(original);
  }else if(predecessor==='brief'){
    legacySystem=legacySystem.replace('Every scene, including quiet footage, must include sceneDirection; never return only the older montage fields. ','')
      .replace(/,sceneDirection:\{alternatives:.*?exit,join,sound\}\}/u,'');
    payload.artworkContinuations=_continuations;legacyInput=JSON.stringify(payload);
  }
  const key=documentaryCheckpointKey('semantic-montage',legacySystem,legacyInput,[]),directory=join(root,'Documentary','Analysis');
  await mkdir(directory,{recursive:true});const receipt=JSON.stringify({state,purpose:'semantic-montage'});await writeFile(join(directory,`${key}.json`),receipt);
  let calls=0;const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryQueryModel:async()=> 'selected',
    documentaryCompletion:async()=>{calls++;throw Error('must never submit');}},()=>root);
  await assert.rejects(intelligence.planSemanticMontage(p),/Автоповтор отключён|повторный платный запрос не отправлен|Этот платный запрос не повторяется/);
  assert.equal(calls,0);assert.equal(await readFile(join(directory,`${key}.json`),'utf8'),receipt);
});

for(const predecessor of ['Rossi','pace','composition'])test(`completed ${predecessor} predecessor is reused by Intelligence without a provider submission`,async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-montage-rossi-complete-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const p=project(2);let system='',input='';
  await assert.rejects(createSemanticMontagePlan(p,root,async(s,i)=>{system=s;input=i;throw Error('capture only');},'configured-text'),/capture only/);
  const prior=system.split(predecessor==='Rossi'?' Narrative pace:':predecessor==='pace'?' Composition fields:':' Artwork intent:')[0]!,key=documentaryCheckpointKey('semantic-montage',prior,input,[]),directory=join(root,'Documentary','Analysis');
  const receipt=JSON.stringify({state:'complete',purpose:'semantic-montage',result:await answer(prior,input)});
  await mkdir(directory,{recursive:true});await writeFile(join(directory,`${key}.json`),receipt);
  let calls=0,concepts=0;const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryQueryModel:async()=> 'selected',
    documentaryCompletion:async(_system,input)=>{if(JSON.parse(input).motionConcepts===1){concepts++;return '{"explanations":[]}';}calls++;throw Error('must never submit');}},()=>root);
  const plan=await intelligence.planSemanticMontage(p);
  assert.equal(plan?.inputHash,semanticMontageHash(p));assert.equal(plan?.scenes.length,2);assert.equal(calls,0);assert.equal(concepts,0);
  assert.equal(await readFile(join(directory,`${key}.json`),'utf8'),receipt);
});

test('music validation rejects per-shot replacements and invalid overlaps but retains deliberate pauses',()=>{
  const p=project(12);
  const sections=validateMusicSections([
    {startSceneId:'scene-0',endSceneId:'scene-2',role:'hook',mood:'tension'},
    {startSceneId:'scene-2',endSceneId:'scene-4',role:'turn',mood:'calm'},
    {startSceneId:'scene-3',endSceneId:'scene-3',role:'turn',mood:'silence'},
    {startSceneId:'scene-4',endSceneId:'scene-4',role:'narration',mood:'energetic'},
  ],p.scenes);
  assert.equal(sections?.length,2);assert.equal(sections?.[1]?.mood,'silence');
  const long=project(57);
  assert.deepEqual(validateMusicSections([{startSceneId:'scene-0',endSceneId:'scene-56',role:'narration',mood:'calm'}],long.scenes),[]);
});

test('chapters and short source-language accents use existing graphics without inventing subtitles',()=>{
  const p=project(15);p.language='de';p.videoBrief={readyScript:'Ein Schiff fuhr weiter.\n\n## Kapitel IV: Der Wendepunkt\nNiemand konnte die Maschine stoppen.'} as Project['videoBrief'];
  p.scenes[0]!.narration='Ein Schiff fuhr weiter.';p.scenes[1]!.narration='Niemand konnte die Maschine stoppen.';
  for(const s of p.scenes){s.documentary!.semanticMontage!.cutawaySceneIds=[];s.documentary!.semanticMontage!.emphasis=s.narration;s.documentary!.requirement.sectionTitle='INVENTED';}
  const result=enrichSemanticMontage(p),chapter=result[1]!.documentary!.motionGraphic;
  assert.equal(chapter?.kind,'chapter-number');assert.equal(chapter?.title,'Der Wendepunkt');assert.equal(chapter?.value,'IV');
  assert.equal(chapter?.startSeconds,.3);assert.ok(chapter!.durationSeconds<=3.2);assert.ok(chapter!.startSeconds+chapter!.durationSeconds<181/30-2);assert.equal(chapter?.kicker,undefined);
  assert.equal(result.filter(s=>s.documentary?.motionGraphic).length,1,'full narration emphasis must not become subtitles');
  const p2=project(1);p2.language='es';p2.scenes[0]!.narration='El barco se llamaba Estrella del Mar.';
  const directions=validateMontageDirections({scenes:[{sceneId:'scene-0',subject:'Star of the Sea',emphasis:'estrella del mar',treatment:'footage'}]},p2.scenes,p2.scenes,p2);
  assert.equal(directions[0]?.subject,'');assert.equal(directions[0]?.emphasis,'Estrella del Mar');assert.equal(directions[0]?.language,'es');
  p2.scenes[0]!.documentary!.semanticMontage=directions[0];
  assert.equal(enrichSemanticMontage(p2)[0]!.documentary!.motionGraphic?.kind,'key-point');
});

test('pinned and manually authored scenes suppress automatic dramatic hints',()=>{
  const p=project(2);p.scenes[0]!.documentary!.pinned=true;p.scenes[1]!.documentary!.templateOrigin='manual';
  for(const s of p.scenes){s.documentary!.semanticMontage!.vignette=true;s.documentary!.semanticMontage!.monochrome=true;}
  const result=enrichSemanticMontage(p);
  assert.ok(result.every(s=>!s.documentary!.semanticMontage!.vignette&&!s.documentary!.semanticMontage!.monochrome));
  assert.equal(result[0]!.documentary!.pinned,true);assert.equal(result[1]!.documentary!.templateOrigin,'manual');
});

test('a count never clones a photograph or its caption; comparisons use confirmed distinct subjects',()=>{
  const p=project(1),s=p.scenes[0]!;s.narration='Cuatro motores impulsan el barco.';s.documentary!.requirement.identities=[{name:'motores',aliases:[]}];
  s.documentary!.semanticMontage={sceneId:s.id,subject:'motores',emphasis:'Cuatro motores',treatment:'subject',beat:'explain',cutawaySceneIds:[]};
  const repeated=enrichSemanticMontage(p)[0]!.documentary!.motionGraphic;
  assert.equal(repeated?.cards?.length??0,0);
  const comparison=project(2),left=comparison.scenes[0]!,right=comparison.scenes[1]!;
  left.narration='Ford versus Ferrari on the track.';left.documentary!.requirement.identities=[{name:'Ford'},{name:'Ferrari'}] as never;
  right.documentary!.requirement.identities=[{name:'Ferrari'}] as never;
  left.documentary!.visualReview={status:'accepted',identifiedEntity:'Ford'} as never;
  right.documentary!.visualReview={status:'accepted',identifiedEntity:'Ferrari'} as never;
  left.documentary!.semanticMontage={sceneId:left.id,subject:'Ford',beat:'explain',treatment:'subject',cutawaySceneIds:[right.id]};
  const graphic=enrichSemanticMontage(comparison)[0]!.documentary!.motionGraphic;
  assert.equal(graphic?.boardLayout,'compare');assert.deepEqual(graphic?.cards,[{sceneId:left.id,label:'Ford'},{sceneId:right.id,label:'Ferrari'}]);
});
