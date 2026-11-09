import assert from 'node:assert/strict';
import {setImmediate as nextTurn} from 'node:timers/promises';
import test from 'node:test';
import {requestDocumentaryMedia} from './documentary-download.js';

test('a media 429 waits for Retry-After and resumes the same original automatically',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
  const calls:number[]=[],waits:number[]=[];
  t.mock.method(globalThis,'fetch',async()=>{calls.push(Date.now());return calls.length===1
    ?new Response('limited',{status:429,headers:{'retry-after':'30'}}):new Response('original');});
  const pending=requestDocumentaryMedia(new URL('https://retry.example/original.jpg'),undefined,n=>waits.push(n));
  await nextTurn();assert.deepEqual(calls,[1000]);assert.deepEqual(waits,[30]);
  t.mock.timers.tick(29_000);await nextTurn();assert.equal(calls.length,1,'No early request');
  t.mock.timers.tick(1000);
  assert.equal(await (await pending).text(),'original');assert.deepEqual(calls,[1000,31_000]);
});

test('media cooldown is shared by host while another host remains available',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
  const calls:string[]=[];
  t.mock.method(globalThis,'fetch',async(url:URL)=>{calls.push(url.hostname);return calls.length===1
    ?new Response('limited',{status:429,headers:{'retry-after':'30'}}):new Response('original');});
  const first=requestDocumentaryMedia(new URL('https://shared.example/a.jpg'));await nextTurn();
  const second=requestDocumentaryMedia(new URL('https://shared.example/b.jpg'));await nextTurn();
  assert.equal(calls.length,1);
  assert.equal((await requestDocumentaryMedia(new URL('https://other.example/c.jpg'))).status,200);
  t.mock.timers.tick(30_000);await Promise.all([first,second]);assert.equal(calls.length,4);
});

test('Stop interrupts a media cooldown without another request',async t=>{
  const stop=new AbortController();let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('limited',{status:429,headers:{'retry-after':'30'}});});
  const pending=requestDocumentaryMedia(new URL('https://stop.example/a.jpg'),stop.signal);
  const rejected=assert.rejects(pending,error=>(error as Error).name==='AbortError');
  await nextTurn();stop.abort();await rejected;assert.equal(calls,1);
});

test('long and repeated media limits are bounded without retrying early',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('limited',{status:429,headers:{'retry-after':'300'}});});
  await assert.rejects(requestDocumentaryMedia(new URL('https://long.example/a.jpg')),/300/);assert.equal(calls,1);
  t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('limited',{status:429,headers:{'retry-after':'30'}});});
  const pending=requestDocumentaryMedia(new URL('https://repeated.example/a.jpg'));
  const rejected=assert.rejects(pending,/ограничил скачивание/);
  await nextTurn();t.mock.timers.tick(30_000);await nextTurn();t.mock.timers.tick(30_000);await rejected;
  assert.equal(calls,3,'One long refusal and two requests before the shared 45-second wait budget is exhausted');
});

test('a 12-second photo budget reports a 30-second rate limit instead of waiting until an unrelated timeout',async t=>{
 let calls=0;const waits:number[]=[];
 t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('limited',{status:429,headers:{'retry-after':'30'}});});
 await assert.rejects(requestDocumentaryMedia(new URL('https://short-photo.example/a.jpg'),AbortSignal.timeout(100),n=>waits.push(n),{availabilityWaitMs:12000}),/HTTP 429/);
 assert.equal(calls,1);assert.deepEqual(waits,[]);
});
