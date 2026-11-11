import assert from 'node:assert/strict';
import {mkdtemp,readdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {AnyModelClient,AnyModelCompletionUncertainError,type AnyModelCompletionMetadata} from './anymodel-client.js';
import {DocumentaryIntelligence,readAnalysisCheckpoint} from './documentary-intelligence.js';
import {documentaryJsonFormatIssue,parseDocumentaryJson} from './documentary-json.js';

const raw='```json\n{"description":"A preserved clipper seen from below, showing its bowsprit and tall rigged';
const frame=(value:unknown)=>`data: ${JSON.stringify(value)}\n\n`;
const content=frame({choices:[{delta:{content:raw},finish_reason:null}]});
const store={publicSettings:async()=>({configured:true,baseUrl:'https://fixture.test/v1',textModel:'fixture',transcriptionModel:'fixture'}),apiKey:async()=>'offline-fixture'};

test('terminal DONE and low usage do not imply a token-limit failure or supply a missing visual verdict',async()=>{
  let calls=0,metadata:AnyModelCompletionMetadata|undefined;
  const client=new AnyModelClient(store as never,async()=>{
    calls++;return new Response(content+frame({usage:{completion_tokens:94}})+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
  });
  assert.equal(await client.documentaryCompletion('Return JSON.','{}',[],undefined,undefined,'fixture',1200,false,
    {purpose:'visual-illustration',onTerminal:value=>{metadata=value;}}),raw);
  assert.equal(calls,1);assert.equal(metadata?.terminalKind,'done');assert.equal(metadata?.finishReason,undefined);
  assert.equal(metadata?.completionTokens,94);assert.equal(metadata?.outputLimit,1200);
  assert.equal(parseDocumentaryJson(raw),undefined);assert.equal(documentaryJsonFormatIssue(raw),'incomplete-json');
});

test('same incomplete content without a transport terminal remains uncertain and is never retried',async()=>{
  let calls=0,terminals=0;
  const client=new AnyModelClient(store as never,async()=>{calls++;return new Response(content,{headers:{'content-type':'text/event-stream'}});});
  await assert.rejects(client.documentaryCompletion('Return JSON.','{}',[],undefined,undefined,'fixture',1200,false,
    {purpose:'visual-illustration',onTerminal:()=>{terminals++;}}),error=>{
      assert.ok(error instanceof AnyModelCompletionUncertainError);assert.equal(error.partial,raw);return true;
    });
  assert.equal(calls,1);assert.equal(terminals,0);
});

test('terminal incomplete visual JSON keeps the received receipt and exact raw bytes without a second paid call',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-incomplete-visual-'));t.after(()=>rm(root,{recursive:true,force:true}));
  let calls=0;
  const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{calls++;return raw;}},()=>root);
  const complete=(service as any).complete.bind(service);
  const run=()=>complete('p','visual-illustration','Inspect actual pixels','{}',[]);
  await assert.rejects(run(),/незавершённый JSON/);
  const directory=join(root,'Documentary','Analysis'),[name]=await readdir(directory),file=join(directory,name!);
  const original=await readFile(file,'utf8'),receipt=JSON.parse(original);
  assert.equal(receipt.state,'received');assert.equal(receipt.raw,raw);assert.equal(receipt.formatIssue,'incomplete-json');
  assert.equal(receipt.result,undefined);
  await assert.rejects(run(),/лимит токенов не подтверждён/);assert.equal(calls,1);
  assert.equal(await readFile(file,'utf8'),original);
  // Historical receipts do not need to be rewritten merely to classify them.
  await writeFile(file,JSON.stringify({state:'received',purpose:'visual-illustration',raw}));
  const legacy=await readFile(file,'utf8');assert.equal((await readAnalysisCheckpoint(file))?.state,'received');
  assert.equal(await readFile(file,'utf8'),legacy);
});

test('JSON diagnostics never complete unfinished objects or accept a verdict prefix',()=>{
  for(const text of [raw,'{"suitable":true,"description":"unfinished','{"suitable":false,','{"nested":{"suitable":true}']){
    assert.equal(documentaryJsonFormatIssue(text),'incomplete-json');assert.equal(parseDocumentaryJson(text),undefined);
  }
  assert.equal(documentaryJsonFormatIssue('{"suitable":tru}'),'invalid-json');
  assert.equal(documentaryJsonFormatIssue('{"suitable":false}'),undefined);
});
