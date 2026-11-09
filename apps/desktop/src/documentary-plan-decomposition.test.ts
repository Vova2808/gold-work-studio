import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {Project,Scene} from '@gold-work/shared';
import {DocumentaryIntelligence,DocumentaryPlanIncompleteError} from './documentary-intelligence.js';
import {AnyModelCompletionUncertainError} from './anymodel-client.js';
const scenes=(count:number)=>Array.from({length:count},(_,order)=>({id:`split-${order}`,order,narration:`A race car takes corner ${order}.`})) as Scene[];
const project=(s:Scene[])=>({id:'p',language:'English',scenes:s,videoBrief:{readyScript:'A 1927 Ford Model A is driven.\n'+s.map(s=>s.narration).join('\n')}}) as Project;
const row=(s:Scene)=>({id:s.id,entities:['race car'],identities:[],queries:['race car track corner']});
const malformed='{"scenes":[{"id":"split-0", -entities:["race car"]}]}';

test('settled invalid syntax decomposes 6→3→1 with distinct payloads, full script, parent receipts and no replay',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-split-plan-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const s=scenes(6),p=project(s),sizes:number[]=[],payloads=new Set<string>();let saved=0;
  const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(_system,input)=>{
    assert.ok(!payloads.has(input));payloads.add(input);const data=JSON.parse(input);assert.equal(data.script,p.videoBrief?.readyScript);sizes.push(data.scenes.length);
    return data.scenes.length===1?JSON.stringify({scenes:data.scenes.map(row)}):malformed;
  }},()=>root);
  assert.equal((await service.plan(p,s,async batch=>{saved+=batch.size;})).size,6);assert.equal(saved,6);
  assert.deepEqual(sizes,[6,3,1,1,1,3,1,1,1]);
  const analysis=join(root,'Documentary','Analysis');
  const receipts=await Promise.all((await readdir(analysis)).filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).map(async n=>({key:n.slice(0,-5),...JSON.parse(await readFile(join(analysis,n),'utf8'))})));
  const invalid=receipts.filter(r=>r.state==='invalid');assert.equal(invalid.length,3);assert.ok(invalid.every(r=>r.raw===malformed&&r.plannerFailure==='received-invalid-format'&&r.rawSha256));
  const manifests=await Promise.all((await readdir(analysis)).filter(n=>/^search-plan-.*scene-ids\.json$/.test(n)).map(async n=>JSON.parse(await readFile(join(analysis,n),'utf8'))));
  assert.equal(manifests.filter(m=>m.parentCheckpointKey).length,8);
  for(const m of manifests.filter(m=>m.parentCheckpointKey))assert.ok(invalid.some(r=>r.key===m.parentCheckpointKey));
  assert.equal((await service.plan(p,s)).size,6);assert.equal(sizes.length,9);
});

test('one exhausted singleton is never synthesized; other 299 plans survive and restart cannot buy malformed payloads again',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-single-plan-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const s=scenes(300),p=project(s),payloads=new Set<string>(),savedIds=new Set<string>();let calls=0;
  const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(_system,input)=>{
    calls++;assert.ok(!payloads.has(input));payloads.add(input);const batch=JSON.parse(input).scenes as Scene[];
    return batch.some(s=>s.id==='split-2')?malformed:JSON.stringify({scenes:batch.map(row)});
  }},()=>root);
  let caught:DocumentaryPlanIncompleteError|undefined;
  try{await service.plan(p,s,async batch=>{for(const id of batch.keys())savedIds.add(id);});}catch(error){assert.ok(error instanceof DocumentaryPlanIncompleteError);caught=error;}
  assert.ok(caught);assert.deepEqual(caught.failedSceneIds,['split-2']);assert.equal(caught.completedPlan.size,299);assert.equal(savedIds.size,299);assert.ok(!savedIds.has('split-2'));
  const before=calls;await assert.rejects(service.plan(p,s),DocumentaryPlanIncompleteError);assert.equal(calls,before);
});

test('uncertain partial/pending submissions do not authorize decomposition or regrouping',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-unknown-split-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const s=scenes(6),p=project(s);let calls=0;
  const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(_system,_input,_images,_signal,partial)=>{
    calls++;partial?.(malformed);throw new AnyModelCompletionUncertainError('Unknown transport state',malformed);
  }},()=>root);
  await assert.rejects(service.plan(p,s));await assert.rejects(service.plan(p,s.slice(1)),/неопределённый результат/);assert.equal(calls,1);
});

test('multiple exhausted singleton IDs stay excluded from regrouping on full and subset resumes',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-multi-invalid-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const s=scenes(12),p=project(s),bad=new Set(['split-2','split-8']);let calls=0;
  const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(_system,input)=>{
    calls++;const batch=JSON.parse(input).scenes as Scene[];
    return batch.some(scene=>bad.has(scene.id))?malformed:JSON.stringify({scenes:batch.map(row)});
  }},()=>root);
  const check=(error:unknown)=>{assert.ok(error instanceof DocumentaryPlanIncompleteError);assert.deepEqual([...error.failedSceneIds].sort(),[...bad].sort());return true;};
  await assert.rejects(service.plan(p,s),error=>{check(error);assert.equal((error as DocumentaryPlanIncompleteError).completedPlan.size,10);return true;});
  const before=calls;
  await assert.rejects(service.plan(p,s),check);
  await assert.rejects(service.plan(p,s.filter(scene=>bad.has(scene.id))),check);
  assert.equal(calls,before);
});
