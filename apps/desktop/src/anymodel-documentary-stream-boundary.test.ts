import test from 'node:test';
import assert from 'node:assert/strict';
import {AnyModelClient,AnyModelCompletionUncertainError,readAnyModelCompletion} from './anymodel-client.js';

const store={publicSettings:async()=>({configured:true,baseUrl:'https://fixture.test/v1',textModel:'fixture',transcriptionModel:'fixture'}),apiKey:async()=>'offline-fixture'};
const frame=(value:unknown)=>`data: ${JSON.stringify(value)}\n\n`;
const answer='{"visible":true}';
const content=frame({choices:[{delta:{content:answer},finish_reason:null}]});
const stop=frame({choices:[{delta:{},finish_reason:'stop'}]});
const encoder=new TextEncoder();
function response(first:string,tail:string){
  let cancelled=false,reads=0;
  const body=new ReadableStream<Uint8Array>({pull(controller){
    reads++;controller.enqueue(encoder.encode(reads===1?first:tail));if(reads===2)controller.close();
  },cancel(){cancelled=true;}});
  return {response:new Response(body,{headers:{'content-type':'text/event-stream'}}),cancelled:()=>cancelled};
}

for(const terminal of [stop,'data: [DONE]\n\n'])test('documentary terminal does not parse an incomplete following SSE line: '+(terminal===stop?'finish_reason':'DONE'),async()=>{
  const wire=response(content+terminal+'data: {"usage":', '{"total_tokens":30}}\n\n');let calls=0;
  const client=new AnyModelClient(store as never,async()=>{calls++;return wire.response;});
  assert.equal(await client.documentaryCompletion('Return JSON.','{}'),answer);
  assert.equal(calls,1);assert.equal(wire.cancelled(),true);
});

test('ordinary reader retains its existing treatment of the same boundary',async()=>{
  const wire=response(content+stop+'data: {"usage":','{"total_tokens":30}}\n\n');
  await assert.rejects(readAnyModelCompletion(wire.response,true),/повреждённый SSE-фрагмент/);
});

for(const broken of ['data: {broken}\n\n'+content+stop,content+stop+'data: {broken}\n\n',content+'data: {"choices":'])
test('complete malformed frames and missing terminal stay uncertain without replay: '+broken.slice(-30),async()=>{
  let calls=0;
  const client=new AnyModelClient(store as never,async()=>{calls++;return new Response(broken,{headers:{'content-type':'text/event-stream'}});});
  await assert.rejects(client.documentaryCompletion('Return JSON.','{}'),error=>{
    assert.ok(error instanceof AnyModelCompletionUncertainError);assert.equal(error.emptyResponse,false);return true;
  });
  assert.equal(calls,1);
});

for(const wire of ['',': heartbeat\n\n','data: {broken}\n\n',content])
test('only a clean zero-byte EOF exposes emptyResponse: '+(wire||'empty closed stream'),async()=>{
  let calls=0;
  const client=new AnyModelClient(store as never,async()=>{
    calls++;
    return new Response(new ReadableStream<Uint8Array>({start(controller){
      if(wire)controller.enqueue(encoder.encode(wire));controller.close();
    }}),{headers:{'content-type':'text/event-stream'}});
  });
  await assert.rejects(client.documentaryCompletion('Return JSON.','{}'),error=>{
    assert.ok(error instanceof AnyModelCompletionUncertainError);
    assert.equal(error.emptyResponse,wire==='');assert.equal(error.reason,'connection');
    assert.equal(error.partial,wire===content?answer:'');return true;
  });
  assert.equal(calls,1,'The client never retries even a confirmed empty response');
});

test('a final complete terminal line without a newline is consumed at actual EOF',async()=>{
  const client=new AnyModelClient(store as never,async()=>new Response(content+stop.trimEnd(),{headers:{'content-type':'text/event-stream'}}));
  assert.equal(await client.documentaryCompletion('Return JSON.','{}'),answer);
});
