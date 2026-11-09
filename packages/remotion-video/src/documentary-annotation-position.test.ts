import assert from 'node:assert/strict';
import test from 'node:test';
import {annotationPosition,annotationLabelBox,annotationLeaderEnd,type AnnotationLabelBox} from './documentary-annotation-position.js';
import {buildDocumentaryTimeline,type DocumentaryProjectInput} from './documentary-timeline.js';

test('pointers never bridge sparse samples, coordinate jumps or invalid saved positions',()=>{
  assert.equal(annotationPosition([{seconds:0,x:20,y:40},{seconds:6,x:25,y:40}],3),undefined);
  assert.equal(annotationPosition([{seconds:0,x:20,y:40},{seconds:2,x:70,y:40}],1),undefined);
  assert.deepEqual(annotationPosition([{seconds:0,x:20,y:40},{seconds:6,x:25,y:40}],6),{x:25,y:40});
  assert.equal(annotationPosition([{seconds:0,x:NaN,y:40}],0),undefined);
  assert.equal(annotationPosition([{seconds:1,x:20,y:40},{seconds:0,x:25,y:40}],.5),undefined);
});

test('source replacement and trim edits never reuse an automatic pointer on different pixels',()=>{
  const project:DocumentaryProjectInput={aspectRatio:'16:9',settings:{voice:{enabled:false},assembly:{kenBurns:false}},scenes:[{
    id:'source',order:0,durationSeconds:6,videoPath:'source.mp4',trimStartSeconds:10,playbackRate:1,
    documentary:{layout:'full',checksum:'same',effects:[],caption:{text:'',enabled:false,position:'bottom',animation:'fade',fontSize:48,color:'#fff',backgroundColor:'#000000',opacity:50},
      motionGraphic:{kind:'annotations',enabled:true,origin:'automatic',title:'',sourceChecksum:'same',sourceTrimStartSeconds:10,sourcePlaybackRate:1,startSeconds:0,durationSeconds:6,
        annotations:[{label:'Крышка',confidence:.98,points:[{seconds:0,x:50,y:40},{seconds:3,x:51,y:40},{seconds:6,x:52,y:40}]}]}}}]};
  const graphic=()=>buildDocumentaryTimeline(project).scenes[0]!.documentary!.motionGraphic!;
  assert.equal(graphic().annotations![0]!.confidence,.98);
  project.scenes[0]!.trimStartSeconds=20;
  assert.equal(graphic().annotations![0]!.confidence,undefined);
  assert.equal(project.scenes[0]!.documentary!.motionGraphic!.annotations![0]!.confidence,.98,'Preview never edits saved annotations');
  project.scenes[0]!.documentary!.checksum='replacement';assert.equal(graphic().enabled,false);
  project.scenes[0]!.documentary!.checksum='same';
  project.scenes[0]!.documentary!.cuts=[{id:'cut',fromFrame:0,durationInFrames:180,trimStartSeconds:0,playbackRate:1}];
  assert.equal(graphic().enabled,false);
});

test('nearby labels stay within safe margins, do not cover anchors or overlap other labels',()=>{
  const anchors=[{x:500,y:500},{x:800,y:530},{x:1700,y:100}];
  const occupied:AnnotationLabelBox[]=[];
  for(const anchor of anchors){
    const box=annotationLabelBox(anchor,300,80,occupied,anchors);assert.ok(box);
    assert.ok(box.x>=96&&box.x+box.width<=1824&&box.y>=80&&box.y+box.height<=1000);
    assert.ok(!anchors.some(p=>p.x>=box.x&&p.x<=box.x+box.width&&p.y>=box.y&&p.y<=box.y+box.height));
    const end=annotationLeaderEnd(anchor,box);assert.ok(Math.hypot(end.x-anchor.x,end.y-anchor.y)<400);
    occupied.push(box);
  }
});
