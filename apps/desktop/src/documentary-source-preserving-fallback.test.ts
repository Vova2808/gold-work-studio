import test from 'node:test';
import assert from 'node:assert/strict';
import React,{createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {Project} from '@gold-work/shared';
import {documentaryMotionPresetFor} from '@gold-work/shared';
import {enrichSemanticMontage,semanticMontageHash} from './documentary-semantic-montage.js';
import {motionArtworkHash} from './documentary-artwork-plan.js';
import {documentarySourceFootageIssue,documentaryVisualSourceIssue,documentaryStandaloneArtworkReady} from './documentary-source-eligibility.js';
import {documentarySourcePreservingFallbackReady} from './documentary-native-fallback.js';
import {missingAssemblyInputs} from './assembly-readiness.js';
import {buildDocumentaryTimeline} from '../../../packages/remotion-video/src/documentary-timeline.js';
import {DocumentaryMotionPreset} from '../../../packages/remotion-video/src/DocumentaryMotionPreset.js';

function fixture(title='crew moving a Formula One car'):Project {
  const narration='The motorcycle team arrived at the circuit with a difficult season ahead.';
  return {id:'fictional-source-fallback',mediaMode:'stock',aspectRatio:'16:9',language:'en',settings:{voice:{enabled:true},video:{enabled:true},music:{enabled:false},
    assembly:{kenBurns:true,documentary:{version:2,autoMotionGraphics:true,montage:{version:1,style:'editorial',intensity:'rich'}}}},
    scenes:[{id:'fictional-scene',order:0,narration,durationSeconds:4,audioPath:'paid-voice.mp3',videoPath:'selected.mp4',trimStartSeconds:2,trimEndSeconds:8,sourceVolume:0,
      documentary:{verified:false,illustrative:true,layout:'full',effects:[],caption:{enabled:false,text:''},checksum:'retained-checksum',
        requirement:{text:narration,detail:'motorcycle',identities:[],years:[],accent:'none'},
        selected:{id:'fictional-source',provider:'pexels',kind:'video',title,rights:'pexels',localPath:'selected.mp4',width:1920,height:1080,durationSeconds:12},
        manualReview:{version:1,status:'pending',provider:'pexels',kind:'video',candidateId:'fictional-source',checksum:'retained-checksum',mediaPath:'selected.mp4',narration,reason:'approximate'},
        timing:{sourceKey:'paid-clock',durationInFrames:128,speechSeconds:4.1,audioPath:'paid-voice.mp3'},
        semanticMontage:{sceneId:'fictional-scene',subject:'team',beat:'evidence',treatment:'footage',cutawaySceneIds:[]}}}]} as unknown as Project;
}
function apply(p:Project){return {...p,scenes:enrichSemanticMontage(p)};}

test('canonical mismatch gets complete native source-free presentation with exact identities, hashes and timing retained',()=>{
  const p=fixture(),before=structuredClone(p),semantic=semanticMontageHash(p),artwork=motionArtworkHash(p),out=apply(p),s=out.scenes[0]!,old=p.scenes[0]!;
  assert.ok(documentarySourceFootageIssue(s));assert.equal(s.documentary!.verified,false);
  assert.equal(documentarySourcePreservingFallbackReady(s),true);assert.equal(documentaryStandaloneArtworkReady(s),true);
  assert.equal(documentaryVisualSourceIssue(s,out.scenes),undefined);assert.deepEqual(missingAssemblyInputs(out),[]);
  for(const key of ['selected','checksum','visualHash','visualReview','manualReview','verified','illustrative','requirement','timing'] as const)
    assert.deepEqual(s.documentary![key],old.documentary![key],key);
  for(const key of ['narration','audioPath','imagePath','videoPath','stockSource','trimStartSeconds','trimEndSeconds','sourceVolume','durationSeconds'] as const)
    assert.deepEqual(s[key],old[key],key);
  assert.deepEqual(out.settings,p.settings);assert.equal(semanticMontageHash(out),semantic);assert.equal(motionArtworkHash(out),artwork);
  const persisted=JSON.parse(JSON.stringify(out)) as Project;
  assert.equal(documentarySourcePreservingFallbackReady(persisted.scenes[0]!),true);
  assert.deepEqual(apply(persisted).scenes,persisted.scenes);assert.deepEqual(p,before);
});

test('ordinary compatible, approximate and unreviewed footage does not trigger fallback',()=>{
  for(const title of ['motorcycle on a circuit','crew in a generic garage','unidentified sports practice']){
    const p=fixture(title);p.scenes[0]!.documentary!.manualReview=undefined;
    assert.equal(documentarySourceFootageIssue(p.scenes[0]!),undefined);
    assert.equal(apply(p).scenes[0]!.documentary!.nativeFallback,undefined);
  }
});

test('manual pinned disabled rich composition and cut priorities are retained or remain a clear blocker',()=>{
  const changes:Array<(p:Project)=>void>=[
    p=>{p.scenes[0]!.documentary!.pinned=true;},p=>{p.scenes[0]!.documentary!.templateOrigin='manual';},
    p=>{p.settings.assembly.documentary!.autoMotionGraphics=false;},p=>{p.scenes[0]!.documentary!.templateMotion={amountPercent:0,curve:'smooth'};},
    p=>{p.scenes[0]!.documentary!.motionGraphic={kind:'key-point',title:'team',origin:'automatic',enabled:false,startSeconds:0,durationSeconds:4};},
    p=>{p.scenes[0]!.documentary!.semanticMontage!.composition={kind:'quote',title:'team'} as never;},
    p=>{p.scenes[0]!.documentary!.motionGraphic={kind:'explainer',title:'team',origin:'automatic',enabled:true,startSeconds:0,durationSeconds:4,cards:[{label:'team'}]};},
    p=>{p.scenes[0]!.documentary!.cuts=[{id:'partial',fromFrame:20,durationInFrames:30,sourceSceneId:'fictional-scene',trimStartSeconds:0,playbackRate:1}];p.scenes[0]!.documentary!.cutsOrigin='manual';},
  ];
  for(const change of changes){const p=fixture();change(p);const out=apply(p),s=out.scenes[0]!;
    assert.equal(s.documentary!.nativeFallback,undefined);
    if(!p.scenes[0]!.documentary!.pinned)assert.ok(documentaryVisualSourceIssue(s,out.scenes));
    const g=p.scenes[0]!.documentary!.motionGraphic;if(g)assert.deepEqual(s.documentary!.motionGraphic,g);
  }
});

test('partial start exit source and payload mutations cannot inherit source-free readiness',()=>{
  const good=apply(fixture());
  const changes:Array<(p:Project)=>void>=[
    p=>{p.scenes[0]!.documentary!.motionGraphic!.startSeconds=1/30;},
    p=>{p.scenes[0]!.documentary!.motionGraphic!.durationSeconds-=1/30;},
    p=>{p.scenes[0]!.documentary!.motionGraphic!.showSource=true;},
    p=>{p.scenes[0]!.documentary!.motionGraphic!.preset='type-echo';},
    p=>{p.scenes[0]!.documentary!.motionGraphic!.title='arbitrary title';},
    p=>{p.scenes[0]!.documentary!.selected!.id='changed';},p=>{p.scenes[0]!.documentary!.selected!.title='another car';},
    p=>{p.scenes[0]!.documentary!.checksum='changed';},p=>{p.scenes[0]!.videoPath='changed.mp4';},p=>{p.scenes[0]!.trimStartSeconds=3;},
    p=>{p.scenes[0]!.documentary!.timing!.durationInFrames++;},p=>{p.scenes[0]!.narration+=' Another sentence.';},
  ];
  for(const change of changes){const p=structuredClone(good);change(p);const s=p.scenes[0]!;
    assert.equal(documentarySourcePreservingFallbackReady(s),false);assert.ok(documentaryVisualSourceIssue(s,p.scenes));
    const out=apply(p);assert.equal(documentarySourcePreservingFallbackReady(out.scenes[0]!),false);
  }
});

test('actual timeline and existing native preset omit material on every frame, including entrance and exit (DOM semantics only)',()=>{
  // tsx uses classic JSX for the sibling renderer package in this Node probe.
  const globals=globalThis as typeof globalThis&{React?:typeof React},previous=globals.React;globals.React=React;
  try{
  for(const override of [undefined,128/30+.001]){
  const input=fixture();input.scenes[0]!.durationOverrideSeconds=override;
  const p=apply(input),timeline=buildDocumentaryTimeline(p),s=timeline.scenes[0]!,g=s.documentary!.motionGraphic!;
  assert.equal(s.durationInFrames,override?129:128);assert.equal(documentaryMotionPresetFor(g)?.id,'type-slam');
  for(let frame=0;frame<s.durationInFrames;frame++){
    const start=Math.round(g.startSeconds*30),frames=Math.min(Math.round(g.durationSeconds*30),s.durationInFrames-start);
    assert.ok(frame>=start&&frame<start+frames);
    const html=renderToStaticMarkup(createElement(DocumentaryMotionPreset,{graphic:g,frame:frame-start,frames,material:createElement('b',null,'REJECTED_SOURCE_SENTINEL'),
      accent:'#e6bc39',width:1920,height:1080,mediaAspect:16/9,isVideo:true,motionEnabled:true}));
    assert.match(html,/data-motion-preset="type-slam"/u);assert.match(html,/background:#0c1015/u);
    assert.doesNotMatch(html,/REJECTED_SOURCE_SENTINEL|gws-motion-preset-source/u);
  }
  }
  }finally{if(previous)globals.React=previous;else Reflect.deleteProperty(globals,'React');}
});
