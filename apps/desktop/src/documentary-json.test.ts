import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {parseDocumentaryJson} from './documentary-json.js';
import {DocumentaryIntelligence,readAnalysisCheckpoint} from './documentary-intelligence.js';

test('shared completed-answer parser preserves visual evidence, strict JSON and existing single-fence explanation handling',()=>{
  const raw='Answer:\n```json\n{status:"rejected", confidence:0.95, narrativeEvidence:{matchesNarration:false}, scriptEvidence:{checks:[{requirementId:"r1",match:false,evidence:"No braking"}],},}\n```\nExplanation follows.';
  const parsed=parseDocumentaryJson(raw)!;assert.equal(parsed.parser,'json5');
  assert.deepEqual(parsed.result,{status:'rejected',confidence:.95,narrativeEvidence:{matchesNarration:false},scriptEvidence:{checks:[{requirementId:'r1',match:false,evidence:'No braking'}]}});
  assert.equal(parseDocumentaryJson('{"status":"rejected"}')?.parser,'json');
  for(const invalid of ['{status:"accepted",x:NaN}','{status:"accepted",x:Infinity}','{"status":"accepted","x":1e999}','{status:"accepted",x:undefined}',
    '{status:"accepted",__proto__:{polluted:true}}','{status:"accepted",prototype:{}}','{status:"accepted",constructor:{}}',
    '{status:"accepted",x:(globalThis.compromised=true)}','{status:"accepted",reason:"incomplete','```json\n{status:"accepted"}\n','{} {}',raw+'\n```json\n{}\n```',
    raw+'\n{status:"accepted"}','{status:"accepted"}\n'+raw,raw+'\n```json\n{status:"accepted"}'])assert.equal(parseDocumentaryJson(invalid),undefined,invalid);
});

test('fully received generic visual JSON5 retains raw/hash/parser proof; unknown stream states never complete',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-visual-json5-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const raw='{status:"rejected",reason:"action absent",confidence:0.9,}';
  for(const state of ['received','partial','pending']){
    const path=join(root,`${state}.json`),original=JSON.stringify({state,purpose:'visual-range',raw});await writeFile(path,original);
    const saved=await readAnalysisCheckpoint(path);
    if(state==='received'){
      assert.equal(saved?.state,'complete');assert.equal(saved?.result?.status,'rejected');
      const proof=JSON.parse(await readFile(path,'utf8'));assert.equal(proof.raw,raw);assert.equal(proof.syntaxRepair.parser,'json5');
      assert.equal(proof.syntaxRepair.rawSha256,createHash('sha256').update(raw).digest('hex'));
    }else{assert.equal(saved?.state,state);assert.equal(await readFile(path,'utf8'),original);}
  }
});

test('new generic visual response uses the same JSON5 parser, keeps refusal and reuses its completed checkpoint',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-new-visual-json5-'));t.after(()=>rm(root,{recursive:true,force:true}));let calls=0;
  const raw='{status:"rejected",reason:"no visible requested subject",confidence:0.95,}';
  const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{calls++;return raw;}},()=>root);
  const complete=(service as unknown as {complete:(id:string,purpose:string,system:string,input:string)=>Promise<Record<string,unknown>>}).complete.bind(service);
  const first=await complete('p','visual-overview','Inspect supplied evidence','{}');assert.equal(first.status,'rejected');
  assert.deepEqual(await complete('p','visual-overview','Inspect supplied evidence','{}'),first);assert.equal(calls,1);
  const analysis=join(root,'Documentary','Analysis'),name=(await readdir(analysis)).find(name=>/^[a-f0-9]{64}\.json$/.test(name))!;
  const saved=JSON.parse(await readFile(join(analysis,name),'utf8'));assert.equal(saved.raw,raw);assert.equal(saved.syntaxRepair.parser,'json5');
});

test('completed strict and fenced visual answers retain raw even when missing context evidence makes the verdict uncertain',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-visual-raw-context-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const value={status:'accepted',confidence:.98,reason:'A vintage car drives past pedestrians.',
    isCameraFootage:true,mediaType:'camera',presentation:'clean',
    technicalQuality:{detail:'clear',compression:'clean',pixelated:false,evidence:'Sharp subject edges',orientation:'upright',continuousShot:true}};
  for(const fenced of [false,true]){
    const raw=fenced?'```json\n'+JSON.stringify(value,null,2)+'\n```':JSON.stringify(value);
    let calls=0;
    const directory=join(root,String(fenced));
    const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{calls++;return raw;}},()=>directory);
    const context={submissions:0,shouldStop:()=>false,narrativeContext:{current:{scene:1,text:'A vintage automobile rolls past pedestrians.'},preceding:[],following:[],earlierTimeReferences:[]}};
    const run=()=> (service as any).inspection.run(context,()=> (service as any).complete('p','visual-range','Inspect actual frames',JSON.stringify({mediaKind:'video'}),['frame1','frame2','frame3']));
    const first=await run();assert.equal(first.status,'uncertain');assert.equal(first.narrativeEvidence,undefined);
    const analysis=join(directory,'Documentary','Analysis'),name=(await readdir(analysis)).find(name=>/^[a-f0-9]{64}\.json$/.test(name))!;
    const receipt=JSON.parse(await readFile(join(analysis,name),'utf8'));
    assert.equal(receipt.raw,raw);assert.equal(receipt.result.status,'uncertain');assert.equal(receipt.syntaxRepair,undefined);
    assert.deepEqual(parseDocumentaryJson(receipt.raw)?.result,value,'Original verdict survives independently of the enforced refusal');
    assert.deepEqual(await run(),first);assert.equal(calls,1,'A complete receipt is reused without another submission');
  }
});
