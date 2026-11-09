import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {DocumentaryAnalysisError} from './documentary-analysis-error.js';
import {documentaryEraProvenanceInstruction,documentaryPreArchiveEraProvenanceInstruction} from './documentary-scene-context.js';

test('archive instruction reuses the exact previous canonical receipt and protects its unknown states',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-archive-cache-'));t.after(()=>rm(root,{recursive:true,force:true}));
  let calls=0;
  const intel=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{
    calls++;return JSON.stringify({status:'rejected',confidence:.95,reason:'Mock cache orchestration only',quality:'unknown'});
  }},()=>root);
  const input=JSON.stringify({narration:'A car.',source:{title:'Car',description:'Original description'},sampleSeconds:[0]});
  const images=['data:image/jpeg;base64,fixture'];
  const invoke=(instruction:string)=>Reflect.get(intel,'complete').call(intel,'fixture','visual-range','Inspect actual frames.'+instruction,input,images);
  await invoke(documentaryPreArchiveEraProvenanceInstruction);
  const analysis=join(root,'Documentary','Analysis');
  const names=(await readdir(analysis)).filter(name=>/^[a-f0-9]{64}\.json$/.test(name));
  assert.equal(names.length,1);
  const file=join(analysis,names[0]!),original=await readFile(file,'utf8'),receipt=JSON.parse(original);
  assert.equal((await invoke(documentaryEraProvenanceInstruction)).status,'rejected');
  assert.equal(calls,1,'A policy-only change cannot pay for the same completed input/images again');
  assert.equal(await readFile(file,'utf8'),original,'The original paid receipt stays byte-identical');
  for(const state of ['pending','partial','received']){
    await writeFile(file,JSON.stringify({...receipt,state,result:undefined,raw:undefined}));
    await assert.rejects(invoke(documentaryEraProvenanceInstruction),DocumentaryAnalysisError);
    assert.equal(calls,1,'The predecessor guard runs before every possible new completion');
  }
});
