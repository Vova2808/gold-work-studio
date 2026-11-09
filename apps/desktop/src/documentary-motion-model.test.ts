import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AnyModelClient,AnyModelCompletionUncertainError,AnyModelProviderResponseError} from './anymodel-client.js';
import {DocumentaryIntelligence} from './documentary-intelligence.js';

test('Opus is isolated to motion; custom endpoints retain their selected model',async()=>{
  const settings={baseUrl:'https://anymodel.org/v1',textModel:'user-selection'};
  const client=new AnyModelClient({publicSettings:async()=>settings} as never);
  assert.equal(await client.documentaryMotionModel(),'cc/claude-opus-5-5');
  assert.equal(await client.documentaryMontageModel(),'ag/claude-sonnet-4-6');
  assert.equal(await client.documentaryConceptModel(),'cc/claude-sonnet-5');
  assert.equal(await client.documentaryQueryModel(),'user-selection');
  assert.equal(await client.documentaryAnalysisModel('careful'),'ag/gemini-3.8-flash-high');
  settings.baseUrl='https://other.example/v1';
  assert.equal(await client.documentaryMotionModel(),'user-selection');
});

test('one-shot Opus transport does not retry a short HTTP cooldown or switch to an IPC reserve',async()=>{
  let sends=0;
  const client=new AnyModelClient({publicSettings:async()=>({configured:true,baseUrl:'https://fixture.test/v1',textModel:'global'}),
    apiKey:async()=> 'offline-fixture'} as never,async()=>{sends++;
    return new Response('Unavailable',{status:503,headers:{'Retry-After':'1'}});
  });
  await assert.rejects(client.withTextModelFallback(()=>client.documentaryCompletion('Brief','{"motionArtworkRevision":1}',[],
    undefined,undefined,'cc/claude-opus-5-5',9000,false,{purpose:'semantic-montage',singleAttempt:true})));
  assert.equal(sends,1);
});

test('author and editor use bounded one-shot motion requests and preserve uncertain receipts',async t=>{
  for(const revision of [false,true])for(const outcome of ['complete','503','unknown'] as const){
    const root=await mkdtemp(join(tmpdir(),'gws-motion-policy-'));t.after(()=>rm(root,{recursive:true,force:true}));
    let calls=0,waits=0;
    const service=new DocumentaryIntelligence({configured:async()=>true,
      documentaryMotionModel:async()=> 'verified-motion-route',documentaryMontageModel:async()=> 'semantic-route',
      documentaryCompletion:async(_system,_input,_images,_signal,onPartial,model,limit,_ordinary,options)=>{
        calls++;assert.equal(model,'verified-motion-route');assert.equal(limit,revision?9000:14000);
        assert.equal(options?.singleAttempt,true);
        if(outcome==='503')throw new AnyModelProviderResponseError('HTTP 503: unavailable',503,60000);
        if(outcome==='unknown'){onPartial?.('{"scenes":[');throw new AnyModelCompletionUncertainError('ECONNRESET');}
        return '{"scenes":[]}';
      }},()=>root,async()=>{},undefined,async()=>{waits++;});
    const invoke=()=>Reflect.get(service,'complete').call(service,'p','semantic-montage','production brief',
      JSON.stringify(revision?{motionArtwork:1,motionArtworkRevision:1}:{motionArtwork:1}),[]);
    if(outcome==='complete'){await invoke();await invoke();}
    else {await assert.rejects(invoke());await assert.rejects(invoke());}
    assert.equal(calls,1,`${revision?'editor':'author'} ${outcome} must not resubmit`);assert.equal(waits,0);
    const directory=join(root,'Documentary','Analysis');
    const files=(await readdir(directory)).filter(name=>name.endsWith('.json'));assert.equal(files.length,1);
    const receipt=JSON.parse(await readFile(join(directory,files[0]!),'utf8'));
    assert.equal(receipt.model,'verified-motion-route');
    if(outcome==='unknown'){assert.equal(receipt.state,'partial');assert.equal(receipt.raw,'{"scenes":[');}
  }
});
