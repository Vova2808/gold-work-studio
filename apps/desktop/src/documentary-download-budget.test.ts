import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay, setImmediate as nextTurn } from "node:timers/promises";
import { withDocumentaryDownloadBudget, documentaryDownloadTimedOut, DocumentaryDownloadTimeoutError, documentaryDownloadProgress } from "./documentary-download.js";
import { documentaryWorkLimits } from "./documentary-work-budget.js";

test("automatic media transfer is aborted at remaining phase deadline, without background work", async () => {
  let active = false, observed: AbortSignal | undefined;
  await assert.rejects(withDocumentaryDownloadBudget({ automatic: true, kind: "image", deadline: Date.now() + documentaryWorkLimits.analysisReserveMs + 40 }, async signal => {
    active = true; observed = signal;
    try { await delay(10_000, undefined, { signal }); } finally { active = false; }
  }), error => {
    assert.match(String(error), /время автоматической загрузки/);
    assert.equal(documentaryDownloadTimedOut(error), true, 'the real budget expiry must skip the next slow YouTube download');
    return true;
  });
  assert.equal(active, false); assert.equal(observed?.aborted, true);
});

test('all existing download watchdog messages are timeouts, user Stop and source errors are not',()=>{
  for(const message of ['Источник превысил время автоматической загрузки.', 'Загрузка YouTube превысила 15 минут', 'YouTube download timeout', 'Источник не начал передачу', 'новые данные не поступают'])
    assert.equal(documentaryDownloadTimedOut(new Error(message)),true,message);
  for(const message of ['Загрузка остановлена пользователем','HTTP 404','Оригинал не подтверждён'])assert.equal(documentaryDownloadTimedOut(new Error(message)),false);
});

test("expired auto stage sends no GET; manual download is not silently shortened", async () => {
  let calls = 0;
  await assert.rejects(withDocumentaryDownloadBudget({ automatic: true, kind: "video", deadline: 0 }, async () => { calls++; }), /время/);
  assert.equal(calls, 0);
  const stop = new AbortController();
  assert.equal(await withDocumentaryDownloadBudget({ automatic: false, kind: "image", deadline: 0, signal: stop.signal }, async signal => {
    assert.equal(signal, stop.signal); return "manual";
  }), "manual");
});

test("user Stop is preserved and a successful transfer cannot be aborted later by a stale timer", async () => {
  const stop = new AbortController(), reason = new Error("user stop"); stop.abort(reason);
  await assert.rejects(withDocumentaryDownloadBudget({ automatic: true, kind: "video", signal: stop.signal }, async () => assert.fail()), error => error === reason);
  let observed: AbortSignal | undefined;
  await withDocumentaryDownloadBudget({ automatic: true, kind: "image", deadline: Date.now() + documentaryWorkLimits.analysisReserveMs + 30 }, async signal => { observed = signal; });
  await delay(60); assert.equal(observed?.aborted, false);
});

test('automatic transfer cannot consume the time reserved for actual-content analysis',async()=>{
  let calls=0;
  await assert.rejects(withDocumentaryDownloadBudget({automatic:true,kind:'video',deadline:Date.now()+5000},async()=>{calls++;}),/время автоматической загрузки/);
  assert.equal(calls,0);
});

test('short transfer window and remaining absolute deadline both bound the actual transfer',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
 for(const remaining of [90_000,8_000]){
  let active=false,observed:AbortSignal|undefined;
  const work=withDocumentaryDownloadBudget({automatic:true,kind:'video',transferMs:20_000,
   deadline:Date.now()+documentaryWorkLimits.analysisReserveMs+remaining},async signal=>{
    active=true;observed=signal;
    try{await delay(60_000,undefined,{signal});}finally{active=false;}
   });
  const rejected=assert.rejects(work,/время автоматической загрузки/);
  await nextTurn();t.mock.timers.tick(Math.min(remaining,20_000)-1);
  assert.equal(observed?.aborted,false);assert.equal(active,true);
  t.mock.timers.tick(1);await rejected;assert.equal(observed?.aborted,true);assert.equal(active,false);
 }
});

test('body progress cannot extend the total transfer cap or consume the analysis reserve',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
 for(const remaining of [90_000,8_000]){
  let observed:AbortSignal|undefined;
  const cap=Math.min(remaining,documentaryWorkLimits.video.downloadMs);
  const work=withDocumentaryDownloadBudget({automatic:true,kind:'video',transferMs:20_000,progressAware:true,
   deadline:Date.now()+documentaryWorkLimits.analysisReserveMs+remaining},async signal=>{
    observed=signal;await delay(120_000,undefined,{signal});
   });
  const rejected=assert.rejects(work,error=>error instanceof DocumentaryDownloadTimeoutError&&error.reason==='total');
  await nextTurn();
  for(let elapsed=0;elapsed<cap;){
   const step=Math.min(10_000,cap-elapsed-1);
   if(step<=0)break;
   t.mock.timers.tick(step);elapsed+=step;
   documentaryDownloadProgress(observed)?.(elapsed);
   assert.equal(observed?.aborted,false);
  }
  t.mock.timers.tick(1);await rejected;
 }
});

test('a stalled body expires after its last new bytes; repeated counts cannot keep it alive',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
 let observed:AbortSignal|undefined;
 const work=withDocumentaryDownloadBudget({automatic:true,kind:'video',transferMs:20_000,progressAware:true},async signal=>{
  observed=signal;await delay(120_000,undefined,{signal});
 });
 const rejected=assert.rejects(work,error=>error instanceof DocumentaryDownloadTimeoutError&&error.reason==='idle');
 // Leave five seconds before the 35-second total cap: this test isolates
 // the 20-second idle window instead of making both deadlines coincide.
 await nextTurn();t.mock.timers.tick(10_000);
 documentaryDownloadProgress(observed)?.(1024);
 t.mock.timers.tick(19_999);
 documentaryDownloadProgress(observed)?.(1024);
 documentaryDownloadProgress(observed)?.(0);
 assert.equal(observed?.aborted,false);
 t.mock.timers.tick(1);await rejected;
});

test('a stalled body whose idle deadline equals the total cap remains bounded by the total timeout',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
 let observed:AbortSignal|undefined;
 const work=withDocumentaryDownloadBudget({automatic:true,kind:'video',transferMs:20_000,progressAware:true},async signal=>{
  observed=signal;await delay(120_000,undefined,{signal});
 });
 const rejected=assert.rejects(work,error=>error instanceof DocumentaryDownloadTimeoutError&&error.reason==='total');
 await nextTurn();t.mock.timers.tick(15_000);
 documentaryDownloadProgress(observed)?.(1024);
 t.mock.timers.tick(19_999);assert.equal(observed?.aborted,false);
 t.mock.timers.tick(1);await rejected;
});

test('progress tracking requires explicit automatic-video opt-in and is detached on completion',async()=>{
 for(const options of [
  {automatic:false,kind:'video' as const,progressAware:true},
  {automatic:true,kind:'video' as const},
  {automatic:true,kind:'image' as const,progressAware:true}
 ])await withDocumentaryDownloadBudget({...options,transferMs:20_000},async signal=>{
  assert.equal(documentaryDownloadProgress(signal),undefined);
 });
 let observed:AbortSignal|undefined;
 await withDocumentaryDownloadBudget({automatic:true,kind:'video',transferMs:20_000,progressAware:true},async signal=>{
  observed=signal;assert.equal(typeof documentaryDownloadProgress(signal),'function');
 });
 assert.equal(documentaryDownloadProgress(observed),undefined);
});
