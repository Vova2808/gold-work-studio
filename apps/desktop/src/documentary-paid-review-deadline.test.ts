import assert from 'node:assert/strict';
import test, {type TestContext} from 'node:test';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {AnyModelClient} from './anymodel-client.js';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {DocumentarySelectionSession} from './documentary-selection-session.js';
import {DocumentaryBudgetExhausted} from './documentary-work-budget.js';
import {setDiagnosticSink} from './diagnostics.js';

const image='data:image/png;base64,iVBORw0KGgo=';
const store={publicSettings:async()=>({configured:true,baseUrl:'https://fixture.test/v1',textModel:'fixture-vision'}),apiKey:async()=>'offline-fixture'};
const encode=(value:string)=>new TextEncoder().encode(value);
const answer={fixture:'completed transport; not a content approval'};
const terminal=()=>encode(`data: ${JSON.stringify({choices:[{delta:{content:JSON.stringify(answer)},finish_reason:'stop'}]})}\n\n`);

async function fixture(t:TestContext,immediate=false,delayedHeaders=false){
  const root=await mkdtemp(join(tmpdir(),'gws-paid-review-deadline-'));
  t.after(async()=>{
    assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&root.includes('gws-paid-review-deadline-'));
    await rm(root,{recursive:true,force:true});
  });
  t.mock.timers.enable({apis:['setTimeout','Date'],now:1_000});
  // Native AbortSignal.timeout uses an internal clock; exercise the actual
  // deadline policy against the same deterministic clock as the real client.
  t.mock.method(AbortSignal,'timeout',(ms:number)=>{
    const controller=new AbortController();
    setTimeout(()=>controller.abort(new DOMException('Fixture deadline','TimeoutError')),ms);
    return controller.signal;
  });
  t.mock.method(globalThis,'fetch',async()=>assert.fail('No live transport is permitted'));
  const events:Array<{event:string;details:Record<string,unknown>}>=[];
  setDiagnosticSink((_level,event,details)=>events.push({event,details}));t.after(()=>setDiagnosticSink());
  let posts=0,signal:AbortSignal|undefined,body:ReadableStreamDefaultController<Uint8Array>|undefined,stopped=false;
  let sent!:()=>void;
  const dispatched=new Promise<void>(resolve=>{sent=resolve;});
  let headersReady!:()=>void;
  const headers=new Promise<void>(resolve=>{headersReady=resolve;});
  const client=new AnyModelClient(store as never,async(_url,init)=>{
    posts++;signal=init?.signal??undefined;sent();
    const response=new Response(new ReadableStream<Uint8Array>({start(controller){
      body=controller;
      if(immediate){controller.enqueue(terminal());controller.close();return;}
      signal!.addEventListener('abort',()=>controller.error(Object.assign(new Error('body aborted'),{code:'ECONNRESET'})),{once:true});
    }}),{headers:{'content-type':'text/event-stream'}});
    if(delayedHeaders)await headers;
    return response;
  });
  const intelligence=new DocumentaryIntelligence(client,()=>root,async()=>{});
  const session=new DocumentarySelectionSession();session.budget('scene','image');
  let remainingOverride:number|undefined,beforeSubmit:(()=>Promise<void>)|undefined;
  const invoke=(id=1,external?:AbortSignal)=>intelligence.withSelectionBudget({
    remaining:()=>remainingOverride??session.remaining('scene','image'),
    submit:()=>session.takeAnalysis('scene','image'),beforeSubmit:async()=>beforeSubmit?.(),
  },()=>Reflect.get(intelligence,'inspection').run({submissions:0,shouldStop:()=>stopped,comparisonSubjects:[],progress:()=>{}},()=>
    Reflect.get(intelligence,'complete').call(intelligence,'fixture-project','visual-illustration','Return the fixture JSON.',JSON.stringify({id}),[image],[],undefined,{signal:external}))) as Promise<Record<string,unknown>>;
  const receipts=async()=>{
    const dir=join(root,'Documentary','Analysis');
    const names=(await readdir(dir)).filter(name=>/^[a-f0-9]{64}\.json$/.test(name));
    return Promise.all(names.map(async name=>({name,bytes:await readFile(join(dir,name),'utf8')})));
  };
  return {intelligence,session,invoke,receipts,dispatched,events,headersReady,posts:()=>posts,signal:()=>signal,
    tick:async(ms:number)=>{t.mock.timers.tick(ms);await nextTurn();},
    complete:()=>body!.enqueue(terminal()),heartbeat:()=>body!.enqueue(encode(': heartbeat\n\n')),
    stop:()=>{stopped=true;},remaining:(value:number)=>{remainingOverride=value;},beforeSubmit:(fn:()=>Promise<void>)=>{beforeSubmit=fn;}};
}

test('a submitted visual review finishes after its scene budget; no new paid request starts',async t=>{
  const f=await fixture(t,false,true);await f.tick(3_000);
  const outcome=f.invoke().then(value=>({value}),error=>({error}));
  await f.dispatched;await nextTurn();
  assert.equal(f.posts(),1);assert.equal(JSON.parse((await f.receipts())[0]!.bytes).state,'pending');
  // Reproduce the observed slow headers, followed by a quiet SSE body.
  await f.tick(47_000);f.headersReady();await nextTurn();await f.tick(11_000);
  assert.equal(f.session.remaining('scene','image'),0);
  assert.equal(f.signal()!.aborted,false,'Admission time must not abort a paid in-flight response');
  f.complete();const settled=await outcome;assert.ok('value' in settled);assert.equal(settled.value.fixture,answer.fixture);
  const receipt=(await f.receipts())[0]!;assert.equal(JSON.parse(receipt.bytes).state,'complete');
  await assert.rejects(f.invoke(2),DocumentaryBudgetExhausted);
  assert.equal(f.posts(),1);assert.equal(f.session.budget('scene','image').analyses,1);
  assert.equal((await f.invoke()).fixture,answer.fixture,'A saved complete response remains reusable even after budget expiry');
  assert.deepEqual(await f.receipts(),[receipt]);
});

for(const limit of ['idle','total'] as const)test(`the real client's ${limit} deadline remains bounded and never replays unknown work`,async t=>{
  const f=await fixture(t);
  const rejected=assert.rejects(f.invoke(),error=>{
    assert.equal(Reflect.get(error as object,'kind'),'pending');
    assert.match(String(error),limit==='idle'?/нет данных от сервиса \(90 с\)/:/общий лимит ожидания \(120 с\)/);return true;
  });
  await f.dispatched;await nextTurn();
  if(limit==='total'){
    await f.tick(80_000);f.heartbeat();await nextTurn();await f.tick(40_000);
  }else await f.tick(90_000);
  await rejected;
  const event=f.events.find(row=>row.event==='anymodel.completion.failed')!;
  assert.equal(event.details.localAbort,limit);assert.equal(event.details.callerAborted,false);
  const receipt=(await f.receipts())[0]!;assert.equal(JSON.parse(receipt.bytes).state,'pending');
  f.remaining(60_000);await assert.rejects(f.invoke(),/Автоповтор отключён/);
  assert.equal(f.posts(),1);assert.deepEqual(await f.receipts(),[receipt]);
});

test('an explicit caller abort still interrupts transport and preserves its unknown receipt',async t=>{
  const f=await fixture(t),caller=new AbortController();
  const rejected=assert.rejects(f.invoke(1,caller.signal),error=>Reflect.get(error as object,'kind')==='pending');
  await f.dispatched;await nextTurn();caller.abort(new DOMException('Explicit caller cancellation','AbortError'));await rejected;
  const event=f.events.find(row=>row.event==='anymodel.completion.failed')!;
  assert.equal(event.details.callerAborted,true);assert.equal(event.details.localAbort,'none');
  const receipt=(await f.receipts())[0]!;assert.equal(JSON.parse(receipt.bytes).state,'pending');
  await assert.rejects(f.invoke(),/Автоповтор отключён/);assert.equal(f.posts(),1);assert.deepEqual(await f.receipts(),[receipt]);
});

test('Stop drains a dispatched paid response, saves it, and prevents the next submission',async t=>{
  const f=await fixture(t);
  const response=f.invoke();await f.dispatched;await nextTurn();f.stop();
  await f.tick(65_000);assert.equal(f.signal()!.aborted,false);f.complete();assert.equal((await response).fixture,answer.fixture);
  const receipt=(await f.receipts())[0]!;assert.equal(JSON.parse(receipt.bytes).state,'complete');
  await assert.rejects(f.invoke(2),{name:'AbortError'});assert.equal(f.posts(),1);assert.deepEqual(await f.receipts(),[receipt]);
});

for(const reason of ['budget','stop','signal'] as const)test(`a ${reason} change during pending persistence prevents dispatch without deleting the checkpoint`,async t=>{
  const f=await fixture(t,true),caller=new AbortController();let checks=0,persisted='';
  f.beforeSubmit(async()=>{
    if(++checks!==2)return;
    const receipt=(await f.receipts())[0]!;persisted=receipt.bytes;
    assert.equal(JSON.parse(persisted).state,'pending');assert.equal(f.posts(),0);
    if(reason==='budget')f.remaining(0);
    if(reason==='stop')f.stop();
    if(reason==='signal')caller.abort(new DOMException('Cancel before dispatch','AbortError'));
  });
  await assert.rejects(f.invoke(1,caller.signal),reason==='budget'?DocumentaryBudgetExhausted:{name:'AbortError'});
  assert.equal(checks,2);assert.equal(f.posts(),0,'Persisted pending is not proof that an HTTP POST was sent');
  assert.equal((await f.receipts())[0]!.bytes,persisted);
  await assert.rejects(f.invoke(),/Автоповтор отключён/);assert.equal(f.posts(),0);
  assert.equal((await f.receipts())[0]!.bytes,persisted);
});

test('a budget already exhausted at admission creates neither a request nor a pending receipt',async t=>{
  const f=await fixture(t,true);f.remaining(0);
  await assert.rejects(f.invoke(),DocumentaryBudgetExhausted);
  assert.equal(f.posts(),0);assert.deepEqual(await f.receipts(),[]);assert.equal(f.session.budget('scene','image').analyses,0);
});
