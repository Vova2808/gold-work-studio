import test from 'node:test';
import assert from 'node:assert/strict';
import {DocumentarySelectionSession} from './documentary-selection-session.js';

test('restart keeps scene review counts while downtime and provider search time reset',async()=>{
  const first=new DocumentarySelectionSession(()=>1000);
  for(let index=0;index<3;index++)await first.takeAnalysis('scene','image');
  first.accountSearch('scene','image',30_000);
  const resumed=new DocumentarySelectionSession(()=>10_000_000,first.snapshot());
  assert.ok(resumed.remaining('scene','image')>0);
  assert.ok(resumed.searchRemaining('scene','image')>30_000);
  await assert.rejects(resumed.takeAnalysis('scene','image'),/бюджет/);
  assert.equal(resumed.snapshot()[0]!.analyses,3);
});

test('paid debit waits for durable ordered writes and disk failure blocks dispatch',async()=>{
  const saved:number[]=[];
  let release!:()=>void;
  const durable=new Promise<void>(resolve=>{release=resolve;});
  const session=new DocumentarySelectionSession(Date.now,undefined,async snapshot=>{
    await durable;saved.push(snapshot[0]!.analyses);
  });
  let dispatched=0;
  const calls=[session.takeAnalysis('scene','video').then(()=>{dispatched++;}),session.takeAnalysis('scene','video').then(()=>{dispatched++;})];
  await Promise.resolve();assert.equal(dispatched,0);
  release();await Promise.all(calls);assert.deepEqual(saved,[1,2]);assert.equal(dispatched,2);
  const failed=new DocumentarySelectionSession(Date.now,undefined,async()=>{throw Error('disk unavailable');});
  await assert.rejects(failed.takeAnalysis('scene','video'),/disk unavailable/);
  assert.equal(failed.snapshot()[0]!.analyses,1);
  assert.throws(()=>new DocumentarySelectionSession(Date.now,[{key:'scene:video',attempts:-1,analyses:0}]),/бюджет/);
});
