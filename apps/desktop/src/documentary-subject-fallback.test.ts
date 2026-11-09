import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {buildDocumentaryTimeline} from '@gold-work/remotion-video';
import {prepareDocumentarySubjects} from './documentary-render-media.js';

test('failed comparison cutout falls back to framed original materials without retrying inference',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-subject-fallback-'));
  assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const network=t.mock.method(globalThis,'fetch',async()=>{throw Error('This regression must stay offline');});
  // Missing source fails in the real source hash, before model loading/inference.
  const left=join(root,'missing-source.jpg'),right=join(root,'right-poster.jpg');
  const timeline=buildDocumentaryTimeline({aspectRatio:'16:9',settings:{voice:{enabled:false},assembly:{kenBurns:false}},scenes:[
    {id:'left',order:0,durationSeconds:4,imagePath:left,documentary:{layout:'full',effects:[],
      caption:{enabled:false,text:'',position:'bottom',animation:'fade',fontSize:40,color:'#ffffff',backgroundColor:'#000000',opacity:1},
      motionGraphic:{kind:'explainer',enabled:true,title:'Comparison',boardLayout:'compare',isolateSubject:true,startSeconds:0,durationSeconds:4,
        cards:[{sceneId:'left',label:'Left',value:'10'},{sceneId:'right',label:'Right',value:'20'}]}}},
    {id:'right',order:1,durationSeconds:4,imagePath:right,videoPath:join(root,'right.mp4')}
  ]});
  const graphic=timeline.scenes[0]!.documentary!.motionGraphic!;
  graphic.cards!.forEach(card=>{card.imagePath=join(root,'stale-cutout.png');});
  const notices:string[]=[];
  const warnings=await prepareDocumentarySubjects(timeline,join(root,'cutouts'),message=>notices.push(message));
  assert.equal(graphic.isolateSubject,false);
  assert.equal(graphic.enabled,true);
  assert.equal(graphic.boardLayout,'compare');
  assert.deepEqual(graphic.cards,[{sceneId:'left',label:'Left',value:'10',imagePath:left},{sceneId:'right',label:'Right',value:'20',imagePath:right}]);
  assert.equal(timeline.scenes[0]!.imagePath,left);
  assert.equal(timeline.scenes[1]!.videoPath,join(root,'right.mp4'));
  assert.equal(warnings.length,1);
  assert.match(warnings[0]!,/исходные материалы показаны в рамках/u);
  assert.deepEqual(notices,warnings);
  assert.equal(network.mock.callCount(),0);
});
