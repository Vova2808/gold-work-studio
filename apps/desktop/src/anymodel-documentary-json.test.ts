import assert from 'node:assert/strict';
import test from 'node:test';
import {AnyModelClient,AnyModelCompletionUncertainError} from './anymodel-client.js';

const MODEL='ag/gemini-2.5-flash';
const store={publicSettings:async()=>({configured:true,baseUrl:'https://fixture.test/v1',textModel:MODEL,transcriptionModel:MODEL}),apiKey:async()=>'offline-fixture'};
const completion=(content='{"ok":true}')=>Response.json({choices:[{message:{content},finish_reason:'stop'}]});

test('motion previews keep explicit scene ownership adjacent to each image when intervening scenes have no preview',async()=>{
  let body:any;
  const client=new AnyModelClient(store as never,async(_url,init)=>{body=JSON.parse(String(init!.body));return completion();});
  await client.documentaryCompletion('Draw.',JSON.stringify({motionArtwork:1,scenes:[
    {sceneId:'first',sourcePreviewImage:2},{sceneId:'missing'},{sceneId:'last',sourcePreviewImage:1}
  ]}),['data:image/jpeg;base64,AA==','data:image/jpeg;base64,BB=='],undefined,undefined,MODEL,1000);
  const content=body.messages[1].content;
  assert.match(content[1].text,/sceneId=last/);assert.equal(content[2].image_url.url,'data:image/jpeg;base64,AA==');
  assert.match(content[3].text,/sceneId=first/);assert.equal(content[4].image_url.url,'data:image/jpeg;base64,BB==');
});

test('native documentary text and pixel transport requests ask for a JSON object on the same Flash route',async()=>{
  const requests:Record<string,any>[]=[];
  const client=new AnyModelClient(store as never,async(url,init)=>{
    assert.equal(url,'https://fixture.test/v1/chat/completions');
    requests.push(JSON.parse(String(init!.body)));return completion();
  });
  for(const images of [[],['data:image/jpeg;base64,AA==']])
    assert.equal(await client.documentaryCompletion('Return JSON.','{"scenes":[]}',images,undefined,undefined,MODEL,4096),' {"ok":true}'.trim());
  assert.equal(requests.length,2);
  for(const body of requests){
    assert.equal(body.model,MODEL);assert.deepEqual(body.response_format,{type:'json_object'});
    assert.equal(body.temperature,0);assert.equal(body.max_tokens,4096);assert.equal(body.stream,true);
    assert.equal(body.reasoning_effort,'medium');
  }
  assert.equal(requests[1]!.messages[1].content[1].type,'image_url');
});

test('ordinary chat and both audio routes retain their existing wire parameters',async()=>{
  const requests:Record<string,any>[]=[];
  const client=new AnyModelClient(store as never,async(_url,init)=>{
    const body=JSON.parse(String(init!.body));requests.push(body);
    return completion(requests.length===3?'[{"startSeconds":0,"durationSeconds":1,"text":"Fixture"}]':'{"ok":true}');
  });
  await client.chatMessage([{role:'user',content:'Fixture'}] as never);
  await client.documentaryCompletion('Transcribe JSON.','Fixture',['data:audio/mp3;base64,AA=='],undefined,undefined,MODEL,512);
  assert.deepEqual(await client.transcribeAudio(Buffer.from([0]),'mp3'),[{startSeconds:0,durationSeconds:1,text:'Fixture'}]);
  assert.deepEqual(requests.map(body=>body.temperature),[0.4,0.4,0]);
  assert.ok(requests.every(body=>body.model===MODEL&&!('response_format' in body)));
  assert.equal(requests[1]!.max_tokens,9000);
  assert.equal(requests[1]!.messages[1].content[1].type,'input_audio');
  assert.equal(requests[2]!.messages[1].content[1].type,'input_audio');
});

test('a definite JSON-format rejection remains one documentary request with no fallback model',async()=>{
  const requests:Record<string,any>[]=[];
  const client=new AnyModelClient(store as never,async(_url,init)=>{
    requests.push(JSON.parse(String(init!.body)));
    return Response.json({error:{message:'Unsupported response_format parameter',type:'invalid_request_error'}},{status:400});
  });
  await assert.rejects(client.withTextModelFallback(()=>client.documentaryCompletion('Return JSON.','{}',[],undefined,undefined,MODEL)),/Unsupported response_format/);
  assert.equal(requests.length,1);assert.equal(requests[0]!.model,MODEL);
  assert.deepEqual(requests[0]!.response_format,{type:'json_object'});
});

test('an uncertain JSON-mode transport failure is never automatically resubmitted or rerouted',async()=>{
  const requests:Record<string,any>[]=[];
  const client=new AnyModelClient(store as never,async(_url,init)=>{
    requests.push(JSON.parse(String(init!.body)));throw Object.assign(new Error('Fixture connection lost'),{code:'ECONNRESET'});
  });
  await assert.rejects(client.withTextModelFallback(()=>client.documentaryCompletion('Return JSON.','{}',[],undefined,undefined,MODEL)),AnyModelCompletionUncertainError);
  assert.equal(requests.length,1);assert.equal(requests[0]!.model,MODEL);
  assert.deepEqual(requests[0]!.response_format,{type:'json_object'});
});
