import test from 'node:test';
import assert from 'node:assert/strict';
import type {Project} from '@gold-work/shared';
import {planDocumentaryArtworkSpans} from './documentary-artwork-span.js';
import {buildDocumentaryTimeline,type DocumentaryProjectInput} from '../../../packages/remotion-video/src/documentary-timeline.js';

const make=()=>({aspectRatio:'16:9',settings:{voice:{enabled:true},assembly:{kenBurns:true,transitionType:'mix',documentary:{montage:{style:'editorial',intensity:'rich'}}}},scenes:[113,91,171].map((frames,i)=>({
  id:`scene-${i}`,order:i,narration:`Narration ${i}`,videoPath:`clip-${i}.mp4`,audioPath:`voice-${i}.wav`,durationSeconds:frames/30,
  documentary:{layout:'full',template:'full',templateOrigin:'automatic',caption:{enabled:false},effects:[{id:'effect',enabled:true,kind:'video',origin:'automatic'}],
    timing:{durationInFrames:frames},semanticMontage:{sceneId:`scene-${i}`,subject:'input and response',beat:'explain',treatment:'footage',cutawaySceneIds:[],...(i===0?{artworkSpan:{endSceneId:'scene-2'},artwork:{version:1,layout:'full',canvas:{width:1000,height:562},palette:{background:'#f5f3ef',ink:'#222222',accent:'#dd4433',secondary:'#8899aa'},layers:[{id:'line',kind:'path',x:100,y:100,w:300,h:10,path:'M0 5H300'}],startSeconds:0,durationSeconds:12.5}}:{})}}}))}) as unknown as Project;

test('one authored span keeps voice and sources and derives a 375-frame clock with hard internal cuts',()=>{
  const project=make(),before=structuredClone(project),scenes=planDocumentaryArtworkSpans(project);
  assert.deepEqual(project,before);
  const timeline=buildDocumentaryTimeline({...project,scenes} as unknown as DocumentaryProjectInput);
  assert.deepEqual(timeline.scenes.map(s=>s.durationInFrames),[113,91,171]);
  assert.deepEqual(timeline.scenes.map(s=>s.documentary!.motionGraphic!.sequenceOffsetFrames),[0,113,204]);
  assert.deepEqual(timeline.scenes.map(s=>s.documentary!.motionGraphic!.sequenceDurationFrames),[375,375,375]);
  assert.deepEqual(timeline.scenes.slice(0,2).map(s=>[s.transition,s.transitionFrames]),[['none',0],['none',0]]);
  for(const [i,scene] of scenes.entries()){
    assert.equal(scene.audioPath,before.scenes[i]!.audioPath);assert.equal(scene.videoPath,before.scenes[i]!.videoPath);
    assert.equal(scene.narration,before.scenes[i]!.narration);assert.deepEqual(scene.documentary!.timing,before.scenes[i]!.documentary!.timing);
    assert.equal(scene.documentary!.effects.length,0);assert.equal(scene.documentary!.motionGraphic!.artwork,scenes[0]!.documentary!.motionGraphic!.artwork);
  }
});

test('an invalid endpoint, nested span or protected member prevents partial replacement',()=>{
  for(const mode of ['end','manual','pin','caption','transition','effect','nested','media','disabled']){
    const project=make(),middle=project.scenes[1]!.documentary!,first=project.scenes[0]!.documentary!.semanticMontage!;
    if(mode==='end')first.artworkSpan!.endSceneId='missing';
    if(mode==='manual')middle.templateOrigin='manual';
    if(mode==='pin')middle.pinned=true;
    if(mode==='caption')middle.caption.enabled=true;
    if(mode==='transition')project.scenes[1]!.transition='fade';
    if(mode==='effect')middle.effects[0]!.origin='manual';
    if(mode==='nested')middle.semanticMontage!.artworkSpan={endSceneId:'scene-2'};
    if(mode==='media')first.artwork!.layers[0]!.kind='media';
    if(mode==='disabled')project.settings.assembly.documentary!.autoMotionGraphics=false;
    assert.deepEqual(planDocumentaryArtworkSpans(project),project.scenes,mode);
  }
});

test('changing order or measured durations rebuilds the clock and different artwork never shares it',()=>{
  const project=make();project.scenes[1]!.documentary!.timing!.durationInFrames=120;
  const scenes=planDocumentaryArtworkSpans(project);
  const timeline=buildDocumentaryTimeline({...project,scenes} as unknown as DocumentaryProjectInput);
  assert.deepEqual(timeline.scenes.map(s=>s.documentary!.motionGraphic!.sequenceOffsetFrames),[0,113,233]);
  assert.equal(timeline.scenes[2]!.documentary!.motionGraphic!.sequenceDurationFrames,404);
  scenes[1]!.documentary!.motionGraphic!.artwork=structuredClone(scenes[1]!.documentary!.motionGraphic!.artwork!);
  scenes[1]!.documentary!.motionGraphic!.artwork!.palette.ink='#112233';
  const separate=buildDocumentaryTimeline({...project,scenes} as unknown as DocumentaryProjectInput);
  assert.ok(separate.scenes.every(s=>s.documentary!.motionGraphic!.sequenceOffsetFrames===undefined));
});

test('motion zero and existing substantive compositions survive; the same owned span can be replanned',()=>{
  for(const mode of ['motion-zero','diagram','artwork','manual-artwork','composition']){
    const project=make(),d=project.scenes[1]!.documentary!;
    if(mode==='motion-zero')d.templateMotion={amountPercent:0,curve:'smooth'};
    if(mode==='composition')d.semanticMontage!.composition={kind:'statistic',value:'4'};
    if(mode==='diagram')d.motionGraphic={enabled:true,origin:'automatic',kind:'statistic',title:'4',startSeconds:0,durationSeconds:3,diagram:{kind:'ratio',amount:1,total:4,label:'one of four'}};
    if(mode==='artwork')d.motionGraphic={enabled:true,origin:'automatic',kind:'explainer',title:'',startSeconds:0,durationSeconds:3,artwork:project.scenes[0]!.documentary!.semanticMontage!.artwork};
    if(mode==='manual-artwork')d.motionGraphic={enabled:true,origin:'manual',kind:'explainer',title:'',startSeconds:0,durationSeconds:3,artwork:project.scenes[0]!.documentary!.semanticMontage!.artwork};
    assert.deepEqual(planDocumentaryArtworkSpans(project),project.scenes,mode);
  }
  const project=make(),once=planDocumentaryArtworkSpans(project);
  assert.deepEqual(planDocumentaryArtworkSpans({...project,scenes:once}),once);
});
