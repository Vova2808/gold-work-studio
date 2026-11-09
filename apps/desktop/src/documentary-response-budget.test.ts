import test from 'node:test';
import assert from 'node:assert/strict';
import {AnyModelClient} from './anymodel-client.js';
import type {AnyModelStore} from './anymodel-store.js';

test('each three/five-frame group carries its own source time immediately before its image',async()=>{
  const store={publicSettings:async()=>({configured:true,textModel:'unchanged'})} as unknown as AnyModelStore;
  const client=new AnyModelClient(store);let messages:any;
  (client as any).chatOnce=async(_model:unknown,sent:unknown)=>{messages=sent;return '{}';};
  for(const samples of [3,5]){
    const groups=[2,0,1].map(id=>({id,sampleSeconds:Array.from({length:samples},(_,i)=>id*10+i+.1)}));
    await client.documentaryCompletion('Actual groups',JSON.stringify({groups}),Array.from({length:samples*3},()=> 'data:image/jpeg;base64,fixture'));
    const content=messages[1].content;let cursor=1;
    for(const group of groups)for(const seconds of group.sampleSeconds){
      assert.match(content[cursor++].text,new RegExp(`Group id=${group.id},.*source time=${seconds.toFixed(3)}`));
      assert.equal(content[cursor++].type,'image_url');
    }
    assert.equal(cursor,content.length);
  }
});

test('three five-frame reviews get room for complete JSON without enlarging ordinary photo or text requests',async()=>{
  const store={publicSettings:async()=>({configured:true,textModel:'unchanged',transcriptionModel:'unchanged-audio'})} as unknown as AnyModelStore;
  const client=new AnyModelClient(store);
  const sent:Array<{model:unknown;tokens:unknown;messages:any}>=[];
  (client as any).chatOnce=async(model:unknown,messages:unknown,tokens:unknown)=>{sent.push({model,messages,tokens});return '{"reviews":[]}';};
  for(const count of [1,2,3]){
    const input={groups:Array.from({length:count},(_,id)=>({id,sampleSeconds:[1,2,3,4,5]}))};
    await client.documentaryCompletion('Review every frame',JSON.stringify(input),Array.from({length:count*5},()=> 'data:image/jpeg;base64,fixture'));
  }
  await client.documentaryCompletion('One photo','{}',['data:image/jpeg;base64,fixture']);
  await client.documentaryCompletion('Metadata','{}');
  assert.deepEqual(sent.map(row=>row.tokens),[1800,2800,4200,1800,9000]);
  assert.ok(sent.every(row=>row.model==='unchanged'));
  assert.equal(sent[2]!.messages[1].content.filter((c:any)=>c.type==='image_url').length,15);
});

test('metadata planning and image checks keep the existing model and reasoning profile',async()=>{
  const store={publicSettings:async()=>({configured:true,textModel:'unchanged',transcriptionModel:'unchanged-audio'})} as unknown as AnyModelStore;
  const client=new AnyModelClient(store),sent:unknown[][]=[];
  (client as any).chatOnce=async(...args:unknown[])=>{sent.push(args);return '{"ids":[]}';};
  await client.documentaryCompletion('Ranking','{}');
  await client.documentaryCompletion('Planning','{}');
  await client.documentaryCompletion('Actual image check','{}',['data:image/jpeg;base64,fixture']);
  assert.deepEqual(sent.map(args=>[args[0],args[2],args[3]]),[['unchanged',9000,'medium'],['unchanged',9000,'medium'],['unchanged',1800,'medium']]);
});

test('contextual image reviews have a bounded complete-answer allowance without replacing their model',async()=>{
  const store={publicSettings:async()=>({configured:true,textModel:'configured',transcriptionModel:'audio'})} as unknown as AnyModelStore;
  const client=new AnyModelClient(store),sent:unknown[][]=[];
  (client as any).chatOnce=async(...args:unknown[])=>{sent.push(args);return '{}';};
  const narrativeContext={current:{text:'The 2004 race.'},preceding:[],following:[]};
  await client.documentaryCompletion('Review actual pixels',JSON.stringify({narrativeContext}),['data:image/jpeg;base64,fixture'],undefined,undefined,'configured');
  await client.documentaryCompletion('Metadata',JSON.stringify({narrativeContext}),[],undefined,undefined,'configured',1600);
  assert.deepEqual(sent.map(args=>[args[0],args[2],args[3]]),[['configured',2800,'medium'],['configured',1600,'medium']]);
});
