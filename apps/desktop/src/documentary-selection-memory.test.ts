import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {documentarySelectionWorkers,runDocumentarySelectionQueue,documentaryFrameWorkers,createDocumentaryFrameQueue} from './documentary-resources.js';

test('selection reduces new work when memory falls, without cancelling accepted paid work',async()=>{
  const gb=1024**3;
  assert.equal(documentarySelectionWorkers(12,.7*gb,3*gb),1);
  assert.equal(documentarySelectionWorkers(12,8*gb,.7*gb),1);
  let samples=0,active=0;const starts:number[]=[];const finished:number[]=[];
  await runDocumentarySelectionQueue([0,1,2,3],async id=>{
    starts[id]=++active;
    try{await delay(id===1?30:5);finished.push(id);}finally{active--;}
  },async()=>++samples===1?2:1,()=>false);
  assert.deepEqual(starts,[1,2,1,1]);assert.deepEqual(finished,[0,1,2,3]);assert.equal(active,0);
});

test('Stop and a failed memory probe drain work already started before returning',async()=>{
  for(const fail of [false,true]){
    let checks=0,active=0,stop=false,done=0;
    const work=runDocumentarySelectionQueue([0,1,2],async id=>{
      active++;try{await delay(id===0?5:30);if(!fail)stop=true;done++;}finally{active--;}
    },async()=>{if(++checks>1&&fail)throw Error('memory probe failed');return 2;},()=>stop);
    if(fail)await assert.rejects(work,/memory probe failed/);else await work;
    assert.equal(active,0);assert.equal(done,2);
  }
});

test('queued decoders respond to falling memory without interrupting active frames',async()=>{
  const gb=1024**3;
  assert.equal(documentaryFrameWorkers(16,355*1024**2),1);
  assert.equal(documentaryFrameWorkers(16,2.5*gb),2);
  assert.equal(documentaryFrameWorkers(16,8*gb),3);
  assert.equal(documentaryFrameWorkers(4,8*gb),1);
  let capacity=3,active=0;
  const starts:number[]=[],release:Array<()=>void>=[];
  const queue=createDocumentaryFrameQueue(()=>capacity);
  const jobs=Array.from({length:6},(_,id)=>queue(async()=>{
    starts[id]=++active;
    try{await new Promise<void>(resolve=>{release[id]=resolve;});if(id===3)throw Error('bad source');}
    finally{active--;}
  }));
  // Observe the deliberate failure immediately; queued later work must still run.
  const outcomes=Promise.allSettled(jobs);
  await delay(0);assert.deepEqual(starts,[1,2,3]);
  capacity=1;
  release[0]!();release[1]!();await delay(0);
  assert.equal(starts.length,3,'No new decoder while two old jobs drain');
  release[2]!();await delay(0);assert.equal(starts[3],1);
  release[3]!();await delay(0);assert.equal(starts[4],1);
  capacity=3;release[4]!();await delay(0);release[5]!();
  const result=await outcomes;
  assert.equal(result.filter(r=>r.status==='rejected').length,1);
  assert.equal(active,0);assert.equal(starts.length,6);
});
