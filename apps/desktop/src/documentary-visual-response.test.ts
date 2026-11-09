import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {AnyModelClient} from './anymodel-client.js';
import {DocumentaryAnalysisError} from './documentary-analysis-error.js';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {documentaryCheckpointKey} from './documentary-checkpoint-key.js';
import {documentaryIllustrationQualityInstruction,documentaryIllustrationResponseInstruction,documentaryIllustrationQualityIssue} from './documentary-illustration-quality.js';

const images=['data:image/jpeg;base64,AA==','data:image/jpeg;base64,AQ==','data:image/jpeg;base64,Ag=='];
const input=JSON.stringify({singleReview:true,checksum:'fixture-media',fileRevision:{size:'10',mtimeNs:'1',ctimeNs:'1'},
 startSeconds:0,endSeconds:5,visualTarget:'tea clipper ship',narration:'Tea clippers carried cargo from China.',namedSubject:false,
 illustrationQualityVersion:1,singleReviewVersion:5,analysisModel:'fixture'});
const answer={description:'A tea clipper with sails and rigging on open water.',suitable:true,reason:'The requested ship is visible.',
 targetVisible:true,targetEvidence:'A square-rigged sailing vessel carrying canvas sails is visible throughout.',footageOrigin:'camera',
 sourceText:{kind:'caption',text:'Tea clippers carried tea from China',relevant:true,evidence:'The caption describes the visible tea clipper and the narrated trade.'}};
async function fixture(t:test.TestContext,content=JSON.stringify(answer),finish:string|null='stop',stream=false){
 const root=await mkdtemp(join(tmpdir(),'gws-visual-response-'));
 assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));t.after(()=>rm(root,{recursive:true,force:true}));
 const requests:Record<string,any>[]=[];
 const store={publicSettings:async()=>({configured:true,baseUrl:'https://fixture.test/v1',textModel:'fixture'}),apiKey:async()=>'fixture'};
 const client=new AnyModelClient(store as never,async(_url,init)=>{requests.push(JSON.parse(String(init!.body)));
  if(stream){
   const event=JSON.stringify({choices:[{delta:{content},finish_reason:finish}]});
   return new Response(`data: ${event}\n\n`,{headers:{'content-type':'text/event-stream'}});
  }
  return Response.json({choices:[{message:{content},finish_reason:finish}]});});
 const complete=()=>{const intelligence=new DocumentaryIntelligence(client,()=>root);return Reflect.get(intelligence,'complete').call(intelligence,
  'fixture','visual-illustration',documentaryIllustrationQualityInstruction,input,images);};
 const directory=join(root,'Documentary','Analysis'),key=documentaryCheckpointKey('visual-illustration',documentaryIllustrationQualityInstruction,input,images);
 return {root,requests,complete,directory,file:join(directory,key+'.json')};
}

test('new visual response requests bounded exact quotations, accepts sufficient short evidence and retains the canonical receipt key',async t=>{
 const f=await fixture(t),value=await f.complete();
 assert.equal(value.suitable,true);assert.equal(documentaryIllustrationQualityIssue('tea clipper ship',value,true),undefined);
 const request=f.requests[0]!,system=request.messages[0].content;
 assert.equal(system,documentaryIllustrationResponseInstruction);assert.doesNotMatch(system,/all legible text|Transcribe every legible/);
 assert.match(system,/at most 240 characters total/);assert.match(system,/ALL observed editorial content, including unquoted text/);
 assert.equal(request.max_tokens,1200);assert.equal(request.messages[1].content.filter((p:{type:string})=>p.type==='image_url').length,3);
 const saved=JSON.parse(await readFile(f.file,'utf8'));assert.equal(saved.state,'complete');assert.deepEqual(saved.completion,
  {finishReason:'stop',outputLimit:1200,receivedCharacters:JSON.stringify(answer).length});
 assert.equal(saved.result.sourceText.text,answer.sourceText.text);assert.equal((await readdir(f.directory)).filter(f=>f.endsWith('.json')).length,1);
 await f.complete();assert.equal(f.requests.length,1,'Formatting and terminal metadata do not create another paid identity');
});

for(const [label,raw,finish] of [
 ['malformed-stop','{"description":"A slide","sourceText":{"kind":"caption","text":"'+('medium clipper paragraph '.repeat(60)),'stop'],
 ['terminal-length','{"description":"A slide","sourceText":{"kind":"caption","text":"unfinished','length'],
] as const)test(`incomplete visual JSON is never accepted or repaid; terminal reason survives (${label})`,async t=>{
 const f=await fixture(t,raw,finish);
 await assert.rejects(f.complete());assert.equal(f.requests.length,1);
 const bytes=await readFile(f.file,'utf8'),saved=JSON.parse(bytes);
 assert.notEqual(saved.state,'complete');assert.equal(saved.result,undefined);assert.equal(saved.completion.finishReason,finish);
 assert.equal(saved.completion.outputLimit,1200);assert.equal(saved.completion.receivedCharacters,raw.length);
 await assert.rejects(f.complete());assert.equal(f.requests.length,1);assert.equal(await readFile(f.file,'utf8'),bytes);
});

test('empty terminal visual SSE is settled without a verdict; the same receipt never submits twice',async t=>{
 const f=await fixture(t,'','stop',true);
 const value=await f.complete();
 assert.equal(value.status,'uncertain');assert.equal(value.suitable,undefined);assert.match(value.reason,/пустым ответом/);
 const bytes=await readFile(f.file,'utf8'),saved=JSON.parse(bytes);
 assert.equal(saved.state,'complete');assert.equal(saved.raw,'');assert.deepEqual(saved.result,value);
 assert.deepEqual(saved.completion,{finishReason:'stop',outputLimit:1200,receivedCharacters:0,disposition:'empty'});
 assert.equal((await f.complete()).status,'uncertain');
 assert.equal(f.requests.length,1);assert.equal(await readFile(f.file,'utf8'),bytes);
});

test('nonempty visual SSE without a terminal frame stays partial and blocks replay',async t=>{
 const raw='{"description":"Незавершённый ответ';
 const f=await fixture(t,raw,null,true);
 const pending=(error:unknown)=>error instanceof DocumentaryAnalysisError&&error.kind==='pending';
 await assert.rejects(f.complete(),pending);
 const bytes=await readFile(f.file,'utf8'),saved=JSON.parse(bytes);
 assert.equal(saved.state,'partial');assert.equal(saved.raw,raw);
 assert.equal(saved.completion,undefined);assert.equal(saved.result,undefined);
 await assert.rejects(f.complete(),pending);
 assert.equal(f.requests.length,1);assert.equal(await readFile(f.file,'utf8'),bytes);
});

for(const state of ['pending','partial','received','complete'] as const)test(`pre-format ${state} receipt remains at the identical key without resubmission or rewriting`,async t=>{
 const f=await fixture(t);await mkdir(f.directory,{recursive:true});
 const bytes=JSON.stringify({state,purpose:'visual-illustration',model:'fixture',...(state==='complete'?{result:answer}:{raw:'{"unfinished"'})});
 await writeFile(f.file,bytes);
 if(state==='complete')assert.equal((await f.complete()).suitable,true);else await assert.rejects(f.complete());
 assert.equal(f.requests.length,0);assert.equal(await readFile(f.file,'utf8'),bytes);
});

test('format adaptation does not change the existing terminal-failed retry policy or give it a new receipt identity',async t=>{
 const f=await fixture(t);await mkdir(f.directory,{recursive:true});
 await writeFile(f.file,JSON.stringify({state:'failed',purpose:'visual-illustration',model:'fixture',error:'Confirmed terminal server failure'}));
 assert.equal((await f.complete()).suitable,true);assert.equal(f.requests.length,1,'The existing failed-state policy permits this request');
 assert.deepEqual((await readdir(f.directory)).filter(f=>f.endsWith('.json')),[f.file.split(/[\\/]/).at(-1)]);
 await f.complete();assert.equal(f.requests.length,1);
});
