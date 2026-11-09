import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {DocumentaryTimeline} from '@gold-work/remotion-video';
import {prepareDocumentaryOptionalRenderMedia} from './documentary-optional-render-media.js';
import {validateMontageDirections} from './documentary-semantic-montage.js';
import {planDocumentaryMontage} from './documentary-montage.js';

test('missing optional seam is omitted on both sides while audio, timing and source remain',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-optional-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const ready=join(root,'existing.mp4');await writeFile(ready,'exists');
  const absent=join(root,'missing.mp4'),boundary={from:'a',to:'b',origin:'automatic'};
  const timeline={fps:30,scenes:[{id:'a',order:0,fromFrame:0,durationInFrames:180,videoPath:ready,audioPath:ready,
    documentary:{effects:[{id:'out',enabled:true,filePath:absent,boundary},{id:'sfx',enabled:true,kind:'audio',filePath:ready}]}},
    {id:'b',order:1,fromFrame:180,durationInFrames:180,videoPath:ready,documentary:{effects:[{id:'in',enabled:true,filePath:ready,boundary}],
      motionGraphic:{enabled:true,kind:'explainer',title:'An exact title',cards:[{sceneId:'a',imagePath:absent,label:'A'}]}}}]} as unknown as DocumentaryTimeline;
  const warnings=await prepareDocumentaryOptionalRenderMedia(timeline);
  assert.equal(warnings.length,3);assert.deepEqual(timeline.scenes.map(s=>s.documentary!.effects.map(e=>e.id)),[['sfx'],[]]);
  assert.equal(timeline.scenes[1]!.documentary!.motionGraphic!.kind,'key-point');
  assert.deepEqual(timeline.scenes.map(s=>[s.videoPath,s.fromFrame,s.durationInFrames]),[[ready,0,180],[ready,180,180]]);
  assert.equal(timeline.scenes[0]!.audioPath,ready);
});

test('semantic image comparison cannot assign an empty video-only card',()=>{
  const narration='The engine and the car were compared.';
  const scene={id:'a',narration,videoPath:'real-video.mp4',durationSeconds:5,documentary:{verified:true,
    selected:{kind:'video'},requirement:{identities:[],years:[]},effects:[],caption:{enabled:false}}} as never;
  const [direction]=validateMontageDirections({scenes:[{sceneId:'a',subject:'engine',beat:'explain',treatment:'footage',cutawaySceneIds:[],
    composition:{kind:'explainer',boardLayout:'compare',cards:[{sceneId:'a',label:'engine'},{sceneId:'a',label:'car'}]}}]},[scene],[scene]);
  assert.equal(direction!.composition,undefined);
});

test('explicit montage refresh preserves the actual graphic source of a media-free scene',()=>{
  const graphic={kind:'feature-list',enabled:true,title:'The engine',items:['accelerate','stop'],origin:'automatic'};
  const scene={id:'graphic',order:0,narration:'The engine can accelerate and stop.',durationSeconds:6,audioPath:'voice.wav',
    documentary:{verified:true,layout:'full',effects:[],caption:{enabled:false,text:''},requirement:{text:'The engine can accelerate and stop.'},motionGraphic:graphic}};
  const project={mediaMode:'stock',language:'en',scenes:[scene],settings:{assembly:{documentary:{version:2,montage:{version:1,style:'editorial',intensity:'rich'}}}}} as never;
  const [after]=planDocumentaryMontage(project,false,true);
  assert.deepEqual(after!.documentary!.motionGraphic,graphic);
  assert.equal(after!.audioPath,scene.audioPath);assert.equal(after!.durationSeconds,scene.durationSeconds);
});
