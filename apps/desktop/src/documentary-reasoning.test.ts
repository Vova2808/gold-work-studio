import assert from 'node:assert/strict';
import test from 'node:test';
import {AnyModelClient} from './anymodel-client.js';
import type {AnyModelStore} from './anymodel-store.js';
import {documentaryReasoningEffort} from './documentary-analysis-routing.js';

test('the single illustration review keeps low effort for historical and mechanical speech',()=>{
  for(const narration of ["Yamaha had not won a race in 2003.",'The engine crankshaft changes the firing order.','Rossi was overtaking under yellow flags.'])
    assert.equal(documentaryReasoningEffort('ag/gemini-2.5-flash',JSON.stringify({reviewPolicyVersion:3,singleReview:true,narration}),true,true),'low');
});
import {DocumentaryRankingBatch,documentaryRankingResponseInstruction} from './documentary-ranking-batch.js';

test('metadata uses low thinking; unclassified pixels and planning retain medium',async()=>{
  const ranking=JSON.stringify({candidates:[{id:'a',title:'Honda RC211V 2003'}]});
  assert.equal(documentaryReasoningEffort('ag/gemini-2.5-flash',ranking,false),'low');
  assert.equal(documentaryReasoningEffort('ag/gemini-2.5-flash',JSON.stringify({requests:[{data:JSON.parse(ranking)},{data:JSON.parse(ranking)}]}),false),'low');
  for(const [model,input,media] of [
    ['ag/gemini-2.5-flash',ranking,true],['cc/claude-sonnet-5',ranking,false],
    ['ag/gemini-2.5-flash','{"scenes":[]}',false],['ag/gemini-2.5-flash','{"candidates":[]}',false],
    ['ag/gemini-2.5-flash','invalid',false],['ag/gemini-2.5-flash','{"requests":[null]}',false],
  ] as const)assert.equal(documentaryReasoningEffort(model,input,media),'medium');
  const client=new AnyModelClient({publicSettings:async()=>({configured:true,textModel:'cc/claude-sonnet-5'})} as AnyModelStore);
  const calls:unknown[][]=[];
  Reflect.set(client,'chat',async(...args:unknown[])=>{calls.push(args);return '{"ids":[]}';});
  await client.documentaryCompletion('Rank candidates',ranking,[],undefined,undefined,'ag/gemini-2.5-flash',1600);
  await client.documentaryCompletion('Inspect actual frames',ranking,['data:image/jpeg;base64,AA=='],undefined,undefined,'ag/gemini-2.5-flash');
  await client.documentaryCompletion('Plan scenes','{"scenes":[]}');
  assert.equal(calls[0]![3],'low');assert.equal(calls[1]![3],'medium');assert.equal(calls[2]![3],'medium');
  assert.equal(calls[0]![0],'ag/gemini-2.5-flash');assert.equal(calls[0]![2],1600);
});

test('single ranking asks only for a shortlist, never fabricated visual evidence',async()=>{
  let sent='';
  const batch=new DocumentaryRankingBatch(async(system)=>{sent=system;return '{"ids":["a"],"reason":"Named source"}';},()=>assert.fail('A single request uses its existing checkpoint'));
  const response=await batch.request('p','ag/gemini-2.5-flash','Original policy','{"candidates":[{"id":"a"}]}',()=>{},async()=>{});
  assert.deepEqual(JSON.parse(response).ids,['a']);assert.equal(sent,'Original policy'+documentaryRankingResponseInstruction);
});

test('only a confirmed ordinary visual task uses low thinking; named subjects and parts remain careful',()=>{
  const ordinary=JSON.stringify({mediaKind:'video',narration:'Waves roll onto a beach.',years:[],requiredIdentities:[]});
  assert.equal(documentaryReasoningEffort('ag/gemini-2.5-flash',ordinary,true,true),'low');
  assert.equal(documentaryReasoningEffort('ag/gemini-2.5-flash',ordinary,true,false),'medium');
  assert.equal(documentaryReasoningEffort('cc/claude-sonnet-5',ordinary,true,true),'medium');
  const withNeighbours=JSON.stringify({...JSON.parse(ordinary),narrativeContext:{current:{text:'Waves roll onto a beach.'},preceding:[{text:'A person in 2003 opens the engine.'}],following:[]}});
  assert.equal(documentaryReasoningEffort('ag/gemini-2.5-flash',withNeighbours,true,true),'low');
  assert.equal(documentaryReasoningEffort('ag/gemini-2.5-flash',withNeighbours,true,false),'medium');
  assert.equal(documentaryReasoningEffort('ag/gemini-2.5-flash',JSON.stringify({narration:'Wind moves leaves on green trees.'}),true,true),'low');
  assert.equal(documentaryReasoningEffort('ag/gemini-2.5-flash',JSON.stringify({narration:'The rider wins the race.'}),true,true),'medium');
  for(const detail of [{requiredIdentities:[{name:'Valentino Rossi'}]},{years:['2003']},{narration:'Inside the engine, the piston moves.'}])
    assert.equal(documentaryReasoningEffort('ag/gemini-2.5-flash',JSON.stringify({...JSON.parse(ordinary),...detail}),true,true),'medium');
});
