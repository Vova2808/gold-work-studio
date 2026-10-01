import test from 'node:test';
import assert from 'node:assert/strict';
import {AnyModelTextFallback,AnyModelModelUnavailableError} from './anymodel-text-fallback.js';
test('parallel explicit refusals share an already selected working reserve',async()=>{
  const fallback=new AnyModelTextFallback(),models:string[]=[],switches:string[]=[];
  const results=await fallback.run(()=>Promise.allSettled(Array.from({length:4},()=>fallback.complete('primary',async model=>{
    models.push(model);
    if(model==='primary')throw new AnyModelModelUnavailableError('explicit refusal');
    await new Promise(resolve=>setTimeout(resolve,5));
    return 'ready';
  }))),change=>{switches.push(change.to);});
  assert.equal(results.filter(result=>result.status==='fulfilled').length,4);
  assert.deepEqual(switches,['ag/claude-sonnet-4-6']);
  assert.equal(models.filter(model=>model==='ag/claude-sonnet-4-6').length,4);
  assert.ok(models.every(model=>model==='primary'||model==='ag/claude-sonnet-4-6'));
});
test('Stock honors one explicit short cooldown on the same model before reserve routing',async()=>{
  const fallback=new AnyModelTextFallback(),models:string[]=[];
  const result=await fallback.run(()=>fallback.complete('primary',async model=>{models.push(model);if(models.length===1)throw new AnyModelModelUnavailableError('explicit refusal',1);return 'ready';},undefined,true));
  assert.equal(result,'ready');assert.deepEqual(models,['primary','primary']);
});
test('Stock never repeats uncertain requests or waits through long provider cooldowns',async()=>{
  for(const error of [new Error('unknown submission'),new AnyModelModelUnavailableError('long cooldown',90_000)]){
    let calls=0;const fallback=new AnyModelTextFallback();
    await assert.rejects(fallback.complete('primary',async()=>{calls++;throw error;},undefined,true));assert.equal(calls,1);
  }
  let calls=0;const fallback=new AnyModelTextFallback();
  await assert.rejects(fallback.complete('primary',async()=>{calls++;throw new AnyModelModelUnavailableError('still unavailable',1);},undefined,true));assert.equal(calls,2);
});
