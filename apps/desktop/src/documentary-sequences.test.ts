import test from 'node:test';
import assert from 'node:assert/strict';
import type {Project} from '@gold-work/shared';
import {buildDocumentaryTimeline} from '@gold-work/remotion-video';
import {planDocumentaryMontage} from './documentary-montage.js';
import {documentaryRenderWorkers,documentarySelectionWorkers,withDocumentaryFrameSlot} from './documentary-resources.js';

function fixture():Project {
  const narration=['Три детали: ворота, вода и суда. ','Ворота закрывают камеру. ','Вода поднимает корабль. ','Суда проходят канал. '];
  return {aspectRatio:'16:9',mediaMode:'stock',videoBrief:{readyScript:narration.join('')},settings:{voice:{enabled:true},assembly:{kenBurns:false,documentary:{version:2,autoMotionGraphics:true}}},scenes:narration.map((text,order)=>({
    id:String(order),order,narration:text,audioPath:`paid-${order}.wav`,videoPath:`verified-${order}.mp4`,durationSeconds:4,
    documentary:{verified:true,layout:'full',selected:{kind:'video',width:1920,height:1080},requirement:{text},caption:{enabled:false,text:''},effects:[],timing:{durationInFrames:120,audioPath:`paid-${order}.wav`}}
  }))} as unknown as Project;
}
test('a list follows matching narration across materials, survives resume and recalculates duration after editing',()=>{
  const p=fixture(),result=planDocumentaryMontage(p);
  assert.deepEqual(result.map(s=>s.documentary?.motionGraphic?.activeIndex),[undefined,0,1,2]);
  assert.equal(new Set(result.map(s=>s.documentary?.motionGraphic?.sequenceId)).size,1);
  assert.ok(result.every(s=>s.documentary?.motionGraphic?.sequenceId));
  assert.deepEqual(result.map(s=>[s.narration,s.audioPath]),p.scenes.map(s=>[s.narration,s.audioPath]));
  assert.deepEqual(planDocumentaryMontage({...p,scenes:result}),result);
  const edited={...p,scenes:result};edited.scenes[1]!.durationOverrideSeconds=6;
  const timeline=buildDocumentaryTimeline(edited);
  assert.deepEqual(timeline.scenes.map(s=>s.documentary?.motionGraphic?.sequenceOffsetFrames),[0,120,300,420]);
  assert.equal(timeline.scenes[0]!.documentary!.motionGraphic!.sequenceDurationFrames,540);
  edited.scenes[2]!.documentary!.motionGraphic!.origin='manual';
  const separated=buildDocumentaryTimeline(edited);
  assert.equal(separated.scenes[0]!.documentary!.motionGraphic!.sequenceDurationFrames,300);
  assert.equal(separated.scenes[2]!.documentary!.motionGraphic!.sequenceOffsetFrames,undefined);
  assert.equal(separated.scenes[3]!.documentary!.motionGraphic!.sequenceOffsetFrames,undefined);
});
test('unrelated, excluded, pinned, edited or ambiguous materials cannot silently become a linked sequence',()=>{
  for(const mode of ['unrelated','excluded','pinned','edited','ambiguous']){
    const p=fixture(),s=p.scenes[2]!;
    if(mode==='unrelated')s.narration='В другой стране наступила ночь.';
    if(mode==='excluded')s.includeInAssembly=false;
    if(mode==='pinned')s.documentary!.pinned=true;
    if(mode==='edited')s.documentary!.template='contain';
    if(mode==='ambiguous')s.narration='Вода и ворота.';
    const result=planDocumentaryMontage(p);
    assert.equal(result[0]!.documentary!.motionGraphic?.sequenceId,undefined,mode);
    assert.equal(result[2]!.documentary?.motionGraphic?.sequenceId,undefined,mode);
  }
});
test('three confirmed items become focus panels with live material and mapped posters',()=>{
  const p=fixture();p.scenes.forEach(s=>{s.imagePath=`poster-${s.id}.jpg`;});p.scenes=planDocumentaryMontage(p);
  assert.equal(p.scenes[0]!.documentary!.motionGraphic!.presentation,undefined);
  assert.ok(p.scenes.slice(1).every(s=>s.documentary!.motionGraphic!.presentation==='panels'));
  const t=buildDocumentaryTimeline(p,path=>`media:${path}`);
  assert.deepEqual(t.scenes[1]!.documentary!.motionGraphic!.panels?.map(p=>p.imagePath),['media:poster-1.jpg','media:poster-2.jpg','media:poster-3.jpg']);
  assert.deepEqual(t.scenes.slice(1).map(s=>s.documentary!.motionGraphic!.sequenceOffsetFrames),[0,120,240]);
  assert.ok(t.scenes.slice(1).every(s=>s.documentary!.motionGraphic!.sequenceDurationFrames===360));
});
test('a spoken enumeration and its details may span several measured voice clips',()=>{
  const p=fixture(),original=p.scenes;
  p.scenes=[{...original[0]!,narration:'Три детали: ворота, '},{...original[0]!,id:'intro-tail',narration:'вода и суда. ',durationSeconds:1},
    {...original[1]!,narration:'Ворота закрывают '},{...original[1]!,id:'detail-tail',narration:'камеру. ',durationSeconds:1},original[2]!,original[3]!].map((s,order)=>({...s,order,documentary:{...s.documentary!,timing:undefined}}));
  p.videoBrief!.readyScript=p.scenes.map(s=>s.narration).join('');
  const result=planDocumentaryMontage(p);
  assert.deepEqual(result.map(s=>s.documentary?.motionGraphic?.activeIndex),[undefined,undefined,0,0,1,2]);
  assert.ok(result.every(s=>s.documentary?.motionGraphic?.sequenceId));
  assert.deepEqual(result.map(s=>s.narration),p.scenes.map(s=>s.narration));
});
test('render concurrency respects both CPU and Windows commit headroom',()=>{
  const gb=1024**3;
  assert.equal(documentaryRenderWorkers(12,8*gb,8*gb),6);
  assert.equal(documentaryRenderWorkers(4,8*gb,8*gb),2);
  assert.equal(documentaryRenderWorkers(12,8*gb,1.5*gb),1);
  assert.equal(documentaryRenderWorkers(12,2.5*gb,8*gb),2);
  assert.equal(documentaryRenderWorkers(12,3.2*gb,8*gb),3);
});

test('graphics exist before material completion, keep split facts continuous and never mark sources verified',()=>{
  const p=fixture();
  p.scenes=p.scenes.slice(0,2).map((s,index)=>({...s,narration:index?'метров выше моря. ':'Озеро находится на высоте 26 ',documentary:{...s.documentary!,verified:false,timing:undefined}}));
  p.videoBrief!.readyScript=p.scenes.map(s=>s.narration).join('');
  p.scenes[1]!.durationSeconds=1.8;
  const result=planDocumentaryMontage(p,true);
  assert.ok(result.every(s=>!s.documentary!.verified));
  assert.deepEqual(result.map(s=>s.documentary!.motionGraphic?.value),['26 метров','26 метров']);
  assert.equal(result[0]!.documentary!.motionGraphic!.sequenceId,result[1]!.documentary!.motionGraphic!.sequenceId);
  const t=buildDocumentaryTimeline({...p,scenes:result});
  assert.deepEqual(t.scenes.map(s=>s.documentary!.motionGraphic!.sequenceOffsetFrames),[0,120]);
  assert.equal(t.scenes[0]!.documentary!.motionGraphic!.sequenceDurationFrames,174);
  assert.deepEqual(planDocumentaryMontage({...p,scenes:result},true),result);
  p.scenes[1]!.documentary!.pinned=true;
  assert.equal(planDocumentaryMontage(p,true)[1]!.documentary!.motionGraphic,undefined);
});

test('prepared lists gain verified focus panels when their source posters arrive',()=>{
  const p=fixture();p.scenes.forEach(s=>{s.documentary!.verified=false;});
  p.scenes=planDocumentaryMontage(p,true);
  assert.ok(p.scenes.every(s=>s.documentary!.motionGraphic?.sequenceId));
  p.scenes.forEach(s=>{s.documentary!.verified=true;s.imagePath=`poster-${s.id}.jpg`;});
  const result=planDocumentaryMontage(p);
  assert.ok(result.slice(1).every(s=>s.documentary!.motionGraphic!.presentation==='panels'));
});

test('parallel selection stays within memory headroom and decode slots recover after failures',async()=>{
  const gb=1024**3;
  assert.equal(documentarySelectionWorkers(12,8*gb,8*gb),4);
  assert.equal(documentarySelectionWorkers(12,1.5*gb,8*gb),1);
  assert.equal(documentarySelectionWorkers(12,8*gb,2*gb),2);
  let active=0,peak=0;
  const results=await Promise.allSettled(Array.from({length:12},(_,i)=>withDocumentaryFrameSlot(async()=>{
    active++;peak=Math.max(peak,active);
    try {await new Promise(resolve=>setTimeout(resolve,8));if(i%3===0)throw Error('decoder failed');return i;}finally{active--;}
  })));
  assert.ok(peak<=3);assert.equal(active,0);assert.equal(results.filter(r=>r.status==='fulfilled').length,8);
  assert.equal(await withDocumentaryFrameSlot(async()=>42),42);
});
