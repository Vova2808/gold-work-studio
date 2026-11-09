import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {receivedDocumentaryPlan,receivedDocumentaryPlanPayload} from './documentary-plan-json.js';
import {readAnalysisCheckpoint} from './documentary-intelligence.js';

const rows=[{id:'s1',queries:['Ford Model A'],scriptRequirements:{version:1,checks:[],nonVisual:[]}},
  {id:'s2',queries:['Ford factory'],identities:[{name:'Ford',aliases:['Ford Motor Company']}],years:['1913'],scriptRequirements:{version:1,checks:[],nonVisual:[]}}];
const full=JSON.stringify({scenes:rows}),missing=full.slice(0,-3)+full.slice(-2);

test('only a last-scene closing brace is repaired; every semantic field stays byte-for-byte represented',()=>{
  const repaired=receivedDocumentaryPlan(missing)!;assert.ok(repaired);assert.deepEqual(repaired.result,{scenes:rows});
  assert.equal(missing.slice(0,repaired.insertedAt)+'}'+missing.slice(repaired.insertedAt),full);
  for(const invalid of [full,full.slice(0,-8),full.replace('"s1"','"s1'),missing.replace('"s2"','"s1"'),missing.replace('"Ford factory"',''),full.replace('"checks":[]','"checks":[{'),missing+'\nexplanation'])assert.equal(receivedDocumentaryPlan(invalid),undefined,invalid);
});

test('complete received JSON5 supports unquoted keys and fences without changing values',()=>{
  const raw='```json\n{scenes:[{id:"s1",queries:["Ford factory"],scriptRequirements:{version:1,scriptText:"A worker fits a wheel to a vehicle chassis.",checks:[],nonVisual:[]},},]}\n```';
  const plan=receivedDocumentaryPlanPayload(raw)!;
  assert.equal(plan.kind,'received-json5');assert.equal(plan.parser,'json5');
  assert.equal((plan.result.scenes as any[])[0].scriptRequirements.scriptText,'A worker fits a wheel to a vehicle chassis.');
  assert.deepEqual((plan.result.scenes as any[])[0].scriptRequirements.checks,[]);
  for(const invalid of [
    '{scenes:[{id:"s1",queries:["Ford"],x:NaN}]}',
    '{scenes:[{id:"s1",queries:["Ford"],x:Infinity}]}',
    '{"scenes":[{"id":"s1","queries":["Ford"],"x":1e999}]}',
    '{scenes:[{id:"s1",queries:["Ford"],x:undefined}]}',
    '{scenes:[{id:"s1",queries:["Ford"],__proto__:{polluted:true}}]}',
    '{scenes:[{id:"s1",queries:["Ford"],constructor:{prototype:{}}}]}',
    '{scenes:[{id:"s1",queries:["Ford"],x:(globalThis.compromised=true)}]}',
    raw.slice(0,-4),'{scenes:[{id:"s1",queries:["Ford"]}]} trailing prose',raw+'\n'+raw,
    '{scenes:[{id:"s1",queries:["Ford"]},{id:"s1",queries:["Ford"]}]}',
    '{scenes:[{id:"s1",queries:[]}]}',
  ])assert.equal(receivedDocumentaryPlanPayload(invalid),undefined,invalid);
  assert.equal(({} as any).polluted,undefined);assert.equal((globalThis as any).compromised,undefined);
});

test('received JSON5 stores parser/raw/hash proof; partial/pending and unsafe strict JSON never bypass guards',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-plan-json5-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const raw='{scenes:[{id:"s1",queries:["Ford"],scriptRequirements:{version:1,scriptText:"Ford",checks:[],nonVisual:[]}}]}';
  for(const state of ['received','partial','pending']){
    const path=join(root,`${state}.json`),original=JSON.stringify({state,purpose:'search-plan',raw});await writeFile(path,original);
    const saved=await readAnalysisCheckpoint(path);
    if(state==='received'){
      assert.equal(saved?.state,'complete');const proof=JSON.parse(await readFile(path,'utf8'));
      assert.equal(proof.raw,raw);assert.equal(proof.syntaxRepair.parser,'json5');assert.equal(proof.syntaxRepair.kind,'received-json5');
      assert.equal(proof.syntaxRepair.rawSha256,createHash('sha256').update(raw).digest('hex'));
    }else{assert.equal(saved?.state,state);assert.equal(await readFile(path,'utf8'),original);}
  }
  const path=join(root,'unsafe.json'),original=JSON.stringify({state:'received',purpose:'search-plan',raw:'{"scenes":[{"id":"s1","queries":["Ford"],"x":1e999}]}'});
  await writeFile(path,original);assert.equal((await readAnalysisCheckpoint(path))?.state,'invalid');const rejected=JSON.parse(await readFile(path,'utf8'));assert.equal(rejected.raw,JSON.parse(original).raw);assert.equal(rejected.plannerFailure,'received-invalid-format');assert.equal(rejected.result,undefined);
});

test('received repair retains the original raw/hash; partial and pending checkpoints never repair or synthesize checks',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-plan-json-'));t.after(()=>rm(root,{recursive:true,force:true}));
  for(const state of ['received','partial','pending']){
    const path=join(root,`${state}.json`),original=JSON.stringify({state,purpose:'search-plan',raw:missing});await writeFile(path,original);
    const checkpoint=await readAnalysisCheckpoint(path);
    if(state==='received'){
      assert.equal(checkpoint?.state,'complete');assert.deepEqual(checkpoint?.result,{scenes:rows});
      const saved=JSON.parse(await readFile(path,'utf8'));assert.equal(saved.raw,missing);
      assert.equal(saved.syntaxRepair.rawSha256,createHash('sha256').update(missing).digest('hex'));
      assert.deepEqual(saved.result.scenes[0].scriptRequirements.checks,[],'no missing requirements invented');
    }else{assert.equal(checkpoint?.state,state);assert.equal(await readFile(path,'utf8'),original);}
  }
});
