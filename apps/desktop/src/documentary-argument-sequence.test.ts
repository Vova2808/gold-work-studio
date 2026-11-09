import test from 'node:test';
import assert from 'node:assert/strict';
import type {Project} from '@gold-work/shared';
import {planDocumentaryArgumentSequences} from './documentary-argument-sequence.js';

const make=()=>({settings:{assembly:{documentary:{montage:{style:'editorial',intensity:'rich'}}}},scenes:[
  'Ford had factories, money, and mass production.',
  'Ferrari had racing victories, hand-built sports cars, and prestige.',
  'Industrial power against a racing legend.',
].map((narration,i)=>({id:String(i),order:i,narration,videoPath:`clip-${i}.mp4`,audioPath:`voice-${i}.wav`,durationSeconds:[3.53,4.53,2.47][i],
  documentary:{templateOrigin:'automatic',effects:[],timing:{durationInFrames:[106,136,74][i]}}}))}) as unknown as Project;

test('two explicit lists and their conclusion carry literal copy across unchanged sources and timing',()=>{
  const p=make(),before=structuredClone(p),scenes=planDocumentaryArgumentSequences(p);
  assert.deepEqual(p,before);
  for(let i=0;i<3;i++){
    const g=scenes[i]!.documentary!.motionGraphic!;
    assert.equal(g.argument!.stage,i);assert.equal(g.startSeconds,0);
    assert.equal(g.durationSeconds,[106,136,74][i]!/30);
    assert.equal(scenes[i]!.videoPath,p.scenes[i]!.videoPath);
    assert.equal(scenes[i]!.audioPath,p.scenes[i]!.audioPath);
    assert.deepEqual(scenes[i]!.documentary!.timing,p.scenes[i]!.documentary!.timing);
    assert.ok(g.argument!.itemFrames.every((f,j,a)=>j===0||f>a[j-1]!));
  }
  const groups=scenes[2]!.documentary!.motionGraphic!.argument!.groups;
  assert.deepEqual(groups.map(g=>g.title),['Ford','Ferrari']);
  assert.deepEqual(groups[1]!.items,['racing victories','hand-built sports cars','prestige']);
  assert.deepEqual(groups.map(g=>g.summary),['Industrial power','a racing legend']);
  assert.equal(new Set(scenes.map(s=>s.documentary!.motionGraphic!.sequenceId)).size,1);
});

test('manual, pinned, motion off and calm projects retain their own composition',()=>{
  for(const mode of ['manual','pinned','motion-off','calm','disabled']){
    const p=make(),doc=p.scenes[1]!.documentary!;
    if(mode==='manual')doc.templateOrigin='manual';
    if(mode==='pinned')doc.pinned=true;
    if(mode==='motion-off')doc.templateMotion={amountPercent:0,curve:'smooth'};
    if(mode==='calm')p.settings.assembly.documentary!.montageDensity='calm';
    if(mode==='disabled')p.settings.assembly.documentary!.autoMotionGraphics=false;
    assert.deepEqual(planDocumentaryArgumentSequences(p),p.scenes,mode);
  }
});

test('unrelated shots or a non-list preceding a contrast never invent a connection',()=>{
  for(const text of ['Ford built a car and won a race.','The argument against exhaustion continued.']){
    const p=make();p.scenes[0]!.narration=text;
    assert.deepEqual(planDocumentaryArgumentSequences(p),p.scenes);
  }
});
