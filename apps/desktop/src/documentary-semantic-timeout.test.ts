import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {documentaryCheckpointKey} from './documentary-checkpoint-key.js';
import {AnyModelClient} from './anymodel-client.js';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {DocumentaryRetryPermissions,listDocumentaryRecovery} from './documentary-retry.js';

test('semantic montage alone gets 300s total; model, 9000 tokens, idle and cancellation stay intact',async()=>{
  const client=new AnyModelClient({publicSettings:async()=>({configured:true,textModel:'configured',transcriptionModel:'audio'})} as never);
  const calls:any[][]=[];Reflect.set(client,'chatOnce',async(...args:any[])=>{calls.push(args);return '{}';});
  const signal=new AbortController().signal,partial=()=>{};
  await client.documentaryCompletion('system','{}',[],signal,partial,'selected',9000,false,{purpose:'semantic-montage'});
  await client.documentaryCompletion('system','{}',[],signal,partial,'selected',9000);
  await client.documentaryCompletion('system','{}',[],signal,partial);
  assert.deepEqual(calls.map(c=>c[5]),[300000,120000,600000]);
  assert.deepEqual(calls.map(c=>c[6].idleTimeoutMs),[90000,90000,180000]);
  assert.equal(calls[0]![0],'selected');assert.equal(calls[0]![2],9000);
  assert.equal(calls[0]![4],signal);assert.equal(calls[0]![6].onPartial,partial);
});

for(const state of ['new','pending','complete'] as const)test(`semantic timeout option preserves ${state} receipt behavior`,async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-semantic-timeout-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const key=documentaryCheckpointKey('semantic-montage','system','{}',[]);
  await mkdir(join(root,'Documentary','Analysis'),{recursive:true});
  if(state!=='new')await writeFile(join(root,'Documentary','Analysis',key+'.json'),JSON.stringify({state,purpose:'semantic-montage',...(state==='complete'?{result:{ok:true}}:{})}));
  const calls:any[][]=[];
  const service=new DocumentaryIntelligence({configured:async()=>true,documentaryQueryModel:async()=> 'selected',documentaryCompletion:async(...args:any[])=>{calls.push(args);return '{"ok":true}';}},()=>root);
  const invoke=()=>Reflect.get(service,'complete').call(service,'p','semantic-montage','system','{}',[]);
  if(state==='pending')await assert.rejects(invoke(),/Автоповтор отключён/);
  else assert.deepEqual(await invoke(),{ok:true});
  assert.equal(calls.length,state==='new'?1:0);
  if(state==='new')assert.deepEqual(calls[0]![8],{purpose:'semantic-montage'});
});

test('one authorized semantic recovery makes one HTTP attempt even on a short explicit model cooldown',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-semantic-one-http-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const dir=join(root,'Documentary','Analysis');await mkdir(dir,{recursive:true});
  const key=documentaryCheckpointKey('semantic-montage','system','{}',[]);
  await writeFile(join(dir,key+'.json'),JSON.stringify({state:'pending',purpose:'semantic-montage'}));
  await new DocumentaryRetryPermissions().authorize(root,await listDocumentaryRecovery(root));
  let requests=0;
  const client=new AnyModelClient({publicSettings:async()=>({configured:true,baseUrl:'https://fixture.test/v1',textModel:'selected'}),apiKey:async()=>'fixture'} as never,async()=>{
    requests++;
    return Response.json({error:{code:'model_not_found',message:'The selected model is temporarily unavailable',retry_after_seconds:.001}},{status:429});
  });
  const service=new DocumentaryIntelligence(client,()=>root);
  await assert.rejects(Reflect.get(service,'complete').call(service,'p','semantic-montage','system','{}',[]));
  assert.equal(requests,1,'revision-bound one-shot authorization also caps internal HTTP retries');
});

test('consumed semantic recovery stays single-shot after a definite output-free failure',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-semantic-consumed-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const dir=join(root,'Documentary','Analysis');await mkdir(dir,{recursive:true});
  const key=documentaryCheckpointKey('semantic-montage','system','{}',[]);
  await writeFile(join(dir,key+'.json'),JSON.stringify({state:'pending',purpose:'semantic-montage'}));
  await new DocumentaryRetryPermissions().authorize(root,await listDocumentaryRecovery(root));
  let requests=0;
  const client=new AnyModelClient({publicSettings:async()=>({configured:true,baseUrl:'https://fixture.test/v1',textModel:'selected'}),apiKey:async()=>'fixture'} as never,async()=>{
    requests++;return Response.json({error:{message:'The upstream provider is temporarily unavailable. Try again shortly.',type:'server_error',code:'service_unavailable',status:503}},{status:503});
  });
  const run=()=>{const service=new DocumentaryIntelligence(client,()=>root);return Reflect.get(service,'complete').call(service,'p','semantic-montage','system','{}',[]);};
  await assert.rejects(run());await assert.rejects(run(),/повторная отправка уже использована/);
  assert.equal(requests,1,'a later refresh must not buy a new POST after the authorized attempt failed');
});
