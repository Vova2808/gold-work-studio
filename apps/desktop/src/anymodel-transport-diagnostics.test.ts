import assert from 'node:assert/strict';
import test, {type TestContext} from 'node:test';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {AnyModelClient, AnyModelCompletionUncertainError, AnyModelProviderResponseError} from './anymodel-client.js';
import {setDiagnosticSink} from './diagnostics.js';

const model = 'cc/claude-sonnet-5';
const store = {publicSettings: async () => ({configured:true, baseUrl:'https://fixture.test/v1', textModel:model}), apiKey:async () => 'fixture-private-key'};
const encode = (value:string) => new TextEncoder().encode(value);
const frame = (content:string, finish:string|null = null) => `data: ${JSON.stringify({choices:[{delta:{content},finish_reason:finish}]})}\r\n\r\n`;
const montage = (client:AnyModelClient, signal?:AbortSignal) => client.documentaryCompletion('PRIVATE-SYSTEM','PRIVATE-INPUT',[],signal,undefined,model,9000,false,{purpose:'semantic-montage',singleAttempt:true});

function diagnostics(t:TestContext) {
  const events:Array<{event:string;details:Record<string,unknown>}> = [];
  setDiagnosticSink((_level,event,details) => events.push({event,details}));
  t.after(() => setDiagnosticSink());
  return {events, detail:(event:string) => {
    const match = events.find(row => row.event === event);
    assert.ok(match, `Missing ${event}`); return match.details;
  }};
}

function pendingResponse(init:RequestInit|undefined, expose:(controller:ReadableStreamDefaultController<Uint8Array>)=>void) {
  return new Response(new ReadableStream<Uint8Array>({start(controller) {
    expose(controller);
    // Node's proxy response can report an abort as a body ECONNRESET.
    init!.signal!.addEventListener('abort',() => controller.error(Object.assign(new Error('aborted'),{code:'ECONNRESET'})),{once:true});
  }}),{headers:{'content-type':'text/event-stream'}});
}

test('semantic remote reset before 90s is connection failure, with no local abort or replay',async t => {
  t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
  const log=diagnostics(t); let calls=0, body!:ReadableStreamDefaultController<Uint8Array>, wire='';
  const client=new AnyModelClient(store as never,async (_url,init) => {
    calls++; wire=String(init!.body); return pendingResponse(init,c => {body=c;});
  });
  const result=montage(client);
  const rejected=assert.rejects(result,error => {
    assert.ok(error instanceof AnyModelCompletionUncertainError); assert.equal(error.reason,'connection');
    assert.equal(error.emptyResponse,false,'A reset before data is not a clean EOF');
    assert.match(error.message,/ECONNRESET/); return true;
  });
  await nextTurn(); t.mock.timers.tick(87_000);
  body.error(Object.assign(new Error('socket closed'),{code:'ECONNRESET'})); await rejected;
  const start=log.detail('anymodel.completion.started'), failed=log.detail('anymodel.completion.failed');
  assert.equal(start.requestBytes,Buffer.byteLength(wire)); assert.equal(start.model,model);
  assert.equal(start.timeoutMs,300_000); assert.equal(start.idleTimeoutMs,90_000); assert.equal(start.outputLimit,9000);
  assert.equal(failed.localAbort,'none'); assert.equal(failed.callerAborted,false); assert.equal(failed.status,200);
  assert.equal(failed.elapsedMs,87_000); assert.equal(failed.completionId,start.completionId);
  const stream=log.detail('anymodel.stream.summary');
  assert.equal(stream.receivedBytes,0); assert.equal(stream.dataFrames,0); assert.equal(stream.failureCode,'ECONNRESET');
  assert.equal(stream.terminalReceived,false); assert.equal(calls,1);
  assert.doesNotMatch(JSON.stringify(log.events),/PRIVATE-SYSTEM|PRIVATE-INPUT|fixture-private-key/);
});

test('semantic idle abort is classified as timeout even when the body reports ECONNRESET',async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const log=diagnostics(t); let calls=0;
  const client=new AnyModelClient(store as never,async (_url,init) => {calls++; return pendingResponse(init,() => {});});
  const rejected=assert.rejects(montage(client),error => {
    assert.ok(error instanceof AnyModelCompletionUncertainError); assert.equal(error.reason,'timeout');
    assert.equal(error.emptyResponse,false,'A local timeout is not a clean EOF');
    assert.match(error.message,/нет данных от сервиса \(90 с\)/); return true;
  });
  await nextTurn(); t.mock.timers.tick(90_000); await rejected;
  assert.equal(log.detail('anymodel.completion.failed').localAbort,'idle'); assert.equal(calls,1);
});

test('SSE heartbeats renew idle time but keep the semantic 300s total deadline',async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const log=diagnostics(t); let body!:ReadableStreamDefaultController<Uint8Array>;
  const client=new AnyModelClient(store as never,async (_url,init) => pendingResponse(init,c => {body=c;}));
  const rejected=assert.rejects(montage(client),error => {
    assert.ok(error instanceof AnyModelCompletionUncertainError); assert.equal(error.reason,'timeout');
    assert.match(error.message,/общий лимит ожидания \(300 с\)/); return true;
  });
  await nextTurn();
  for(let i=0;i<3;i++){t.mock.timers.tick(80_000);body.enqueue(encode(': heartbeat\r\n\r\n'));await nextTurn();}
  t.mock.timers.tick(60_000); await rejected;
  assert.equal(log.detail('anymodel.completion.failed').localAbort,'total');
  const stream=log.detail('anymodel.stream.summary');
  assert.equal(stream.receivedBytes,45); assert.equal(stream.receivedChunks,3); assert.equal(stream.dataFrames,0);
});

test('caller cancellation remains distinct from local deadlines',async t => {
  const log=diagnostics(t), caller=new AbortController();
  const client=new AnyModelClient(store as never,async (_url,init) => pendingResponse(init,() => {}));
  const cancelled=new DOMException('User stopped','AbortError');
  const rejected=assert.rejects(montage(client,caller.signal),error => error===cancelled);
  await nextTurn(); caller.abort(cancelled); await rejected;
  const failed=log.detail('anymodel.completion.failed');
  assert.equal(failed.localAbort,'none'); assert.equal(failed.callerAborted,true);
});

test('byte-fragmented UTF-8 SSE still completes without recording content',async t => {
  const log=diagnostics(t), content='{"result":"Привет"}', wire=encode(frame(content,'stop'));
  let cancelled=false;
  const client=new AnyModelClient(store as never,async () => new Response(new ReadableStream<Uint8Array>({
    start(controller){for(const byte of wire)controller.enqueue(Uint8Array.of(byte));},cancel(){cancelled=true;}
  }),{headers:{'content-type':'text/event-stream'}}));
  assert.equal(await montage(client),content); assert.equal(cancelled,true);
  const summary=log.detail('anymodel.stream.summary');
  assert.equal(summary.receivedBytes,wire.length-2); // stop is recognized at the first complete data line
  assert.equal(summary.malformedFrames,0); assert.equal(summary.terminalReceived,true);
  assert.equal(log.detail('anymodel.completion.completed').receivedCharacters,content.length);
  assert.doesNotMatch(JSON.stringify(log.events),/Привет|PRIVATE-SYSTEM|PRIVATE-INPUT/);
});

test('malformed SSE remains uncertain and is distinguishable from an empty connection reset',async t => {
  const log=diagnostics(t); let calls=0;
  const client=new AnyModelClient(store as never,async () => {
    calls++; return new Response('data: {broken}\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
  });
  await assert.rejects(montage(client),AnyModelCompletionUncertainError);
  const stream=log.detail('anymodel.stream.summary');
  assert.equal(stream.dataFrames,2); assert.equal(stream.malformedFrames,1); assert.equal(stream.terminalReceived,true);
  assert.equal(stream.failureCode,undefined); assert.equal(calls,1);
});

test('completed gateway unavailable signature is a provider failure without replay, not generated JSON',async t => {
  const log=diagnostics(t);
  const content='[Error] The upstream provider is temporarily unavailable. Try again shortly.';
  for (const format of ['sse','json'] as const) {
    let calls=0;
    const client=new AnyModelClient(store as never,async () => {
      calls++;
      return format==='sse'
        ? new Response(frame(content,'stop')+'data: [DONE]\r\n\r\n',{headers:{'content-type':'text/event-stream'}})
        : Response.json({choices:[{message:{content},finish_reason:'stop'}]});
    });
    await assert.rejects(client.withTextModelFallback(() => montage(client)),error => {
      assert.ok(error instanceof AnyModelProviderResponseError);
      assert.equal(error.completedGatewayError,true);
      assert.match(error.message,/провайдер временно недоступен/);
      assert.equal(error.retryableNoOutput,false);
      assert.equal(error.terminalStatus,undefined); // The actual transport status was 200.
      return true;
    });
    assert.equal(calls,1);
  }
  assert.equal(log.events.filter(row=>row.event==='anymodel.completion.completed').length,0);
  assert.equal(log.events.filter(row=>row.event==='anymodel.completion.failed').length,2);
});

test('gateway words do not override an unfinished stream or content merely quoting the signature',async () => {
  const signature='[Error] The upstream provider is temporarily unavailable. Try again shortly.';
  let calls=0;
  const unfinished=new AnyModelClient(store as never,async () => {
    calls++; return new Response(frame(signature),{headers:{'content-type':'text/event-stream'}});
  });
  await assert.rejects(montage(unfinished),AnyModelCompletionUncertainError);
  assert.equal(calls,1);
  for (const content of [JSON.stringify({quote:signature}),`The service displayed: ${signature}`,`${signature} Additional explanation.`]) {
    const client=new AnyModelClient(store as never,async () => new Response(frame(content,'stop'),{headers:{'content-type':'text/event-stream'}}));
    assert.equal(await montage(client),content);
  }
});
