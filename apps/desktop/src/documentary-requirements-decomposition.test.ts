import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,readdir,rm,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import type {Project,Scene} from '@gold-work/shared';
import {DocumentaryIntelligence,DocumentaryPlanIncompleteError} from './documentary-intelligence.js';
import {AnyModelCompletionUncertainError} from './anymodel-client.js';
import {documentaryScriptRequirements,documentaryScriptRequirementsProblem} from './documentary-script-evidence.js';
const testRoot=resolve('captures/footage-18min-20261014');
const fixture=(count:number)=>{
  const scenes=Array.from({length:count},(_,order)=>({id:`requirements-${order}`,order,narration:`A race car brakes on wet road ${order}.`,documentary:{requirement:{
    text:`A race car brakes on wet road ${order}.`,entities:['race car'],identities:[],years:[],queries:['race car braking wet road'],plannedBy:'semantic',preferredKind:'video',
  }}})) as unknown as Scene[];
  return {id:'requirements-project',language:'English',scenes,videoBrief:{readyScript:'A 1927 Ford Model A is driven.\n'+scenes.map(s=>s.narration).join('\n')}} as Project;
};
const requirements=(s:Scene)=>({version:1,scriptText:s.narration,checks:[
  {id:'object',kind:'object',scriptQuote:'race car',required:'race car'},
  {id:'action',kind:'action',scriptQuote:'brakes',required:'car braking'},
  {id:'condition',kind:'condition',scriptQuote:`on wet road ${s.order}`,required:`on wet road ${s.order}`},
],nonVisual:[]});
const invalidRequirements=(s:Scene)=>({...requirements(s),checks:requirements(s).checks.filter(c=>c.kind!=='action')});
const row=(s:Scene,invalid=false)=>({id:s.id,scriptRequirements:invalid?invalidRequirements(s):requirements(s)});
const temporary=async(t:{after:(fn:()=>Promise<void>)=>void})=>{
  await mkdir(testRoot,{recursive:true});const root=await mkdtemp(join(testRoot,'requirements-test-'));
  t.after(async()=>{assert.ok(resolve(root).startsWith(testRoot+'\\'));await rm(root,{recursive:true,force:true});});return root;
};
const snapshots=async(root:string)=>{
  const path=join(root,'Documentary','Analysis');return new Map(await Promise.all((await readdir(path)).filter(n=>/^[a-f0-9]{64}\.json$/.test(n))
    .map(async name=>[name,await readFile(join(path,name),'utf8')] as const)));
};

test('received complete semantic-invalid requirements repair 6→3→1 with full script, unchanged receipts, and exact native checks',async t=>{
  const root=await temporary(t),p=fixture(6),sizes:number[]=[],payloads=new Set<string>(),saved=new Map();
  const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(_system,input)=>{
    assert.ok(!payloads.has(input));payloads.add(input);const data=JSON.parse(input);
    assert.equal(data.script,p.videoBrief!.readyScript);assert.equal(data.language,p.language);sizes.push(data.scenes.length);
    const repair=data.scenes[0].validationError!==undefined;
    if(repair){assert.match(data.scenes[0].validationError,/brakes/);assert.ok(data.completedResponseRepair);}
    for(const item of data.scenes){assert.equal(item.narration,p.scenes.find(s=>s.id===item.id)!.narration);assert.equal(item.candidates,undefined);assert.ok(item.context.current.text);}
    return JSON.stringify({scenes:(data.scenes as Scene[]).map(s=>row(p.scenes.find(scene=>scene.id===s.id)!,!repair||data.scenes.length>1))});
  }},()=>root);
  await service.resolveScriptRequirements(p,p.scenes,async plan=>{for(const [id,value] of plan)saved.set(id,value);});
  assert.deepEqual(sizes,[6,6,3,1,1,1,3,1,1,1]);assert.equal(saved.size,6);
  for(const s of p.scenes){assert.deepEqual(saved.get(s.id).scriptRequirements,requirements(s));assert.deepEqual(saved.get(s.id).queries,s.documentary!.requirement.queries);}
  const before=await snapshots(root);const calls=sizes.length;
  const resume=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{throw new Error('paid replay');}},()=>root);
  await resume.resolveScriptRequirements(p,p.scenes,async()=>{});assert.equal(sizes.length,calls);assert.deepEqual(await snapshots(root),before);
  const manifests=(await readdir(join(root,'Documentary','Analysis'))).filter(n=>/^script-requirements-repair-.*scene-ids\.json$/.test(n));
  assert.equal(manifests.length,9);for(const name of manifests){const m=JSON.parse(await readFile(join(root,'Documentary','Analysis',name),'utf8'));assert.ok(m.parentCheckpointKey);}
});

test('one rejected singleton preserves and saves all other 299 requirements before typed partial error; restart has zero calls',async t=>{
  const root=await temporary(t),p=fixture(300),bad='requirements-2',saved=new Set<string>();let calls=0;
  const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(_system,input)=>{
    calls++;const batch=JSON.parse(input).scenes as Scene[],badBatch=batch.some(s=>s.id===bad);
    return JSON.stringify({scenes:batch.map(s=>row(p.scenes.find(scene=>scene.id===s.id)!,badBatch))});
  }},()=>root);
  const check=(e:unknown)=>{assert.ok(e instanceof DocumentaryPlanIncompleteError);assert.equal(e.purpose,'script-requirements');assert.deepEqual(e.failedSceneIds,[bad]);assert.equal(e.completedPlan.size,299);return true;};
  await assert.rejects(service.resolveScriptRequirements(p,p.scenes,async plan=>{for(const id of plan.keys())saved.add(id);}),check);
  assert.equal(saved.size,299);assert.ok(saved.has('requirements-299'));assert.ok(!saved.has(bad));
  const before=calls;await assert.rejects(service.resolveScriptRequirements(p,p.scenes,async()=>{}),check);assert.equal(calls,before);
});

test('two exhausted semantic-invalid IDs remain excluded on full and subset resumes, without weakening physical-action validation',async t=>{
  const root=await temporary(t),p=fixture(18),bad=new Set(['requirements-2','requirements-14']);let calls=0;
  const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(_system,input)=>{
    calls++;const batch=JSON.parse(input).scenes as Scene[];
    return JSON.stringify({scenes:batch.map(s=>row(p.scenes.find(scene=>scene.id===s.id)!,batch.some(scene=>bad.has(scene.id))))});
  }},()=>root);
  const check=(expected:number)=>(e:unknown)=>{assert.ok(e instanceof DocumentaryPlanIncompleteError);assert.deepEqual([...e.failedSceneIds].sort(),[...bad].sort());assert.equal(e.completedPlan.size,expected);return true;};
  await assert.rejects(service.resolveScriptRequirements(p,p.scenes,async()=>{}),check(16));
  const before=calls,receipts=await snapshots(root);
  await assert.rejects(service.resolveScriptRequirements(p,p.scenes,async()=>{}),check(16));
  await assert.rejects(service.resolveScriptRequirements(p,p.scenes.filter(s=>bad.has(s.id)),async()=>{}),check(0));
  assert.equal(calls,before);assert.deepEqual(await snapshots(root),receipts);
  assert.equal(documentaryScriptRequirements(invalidRequirements(p.scenes[2]!),p.scenes[2]!.narration),undefined);
});

test('unknown partial submission blocks full and subset regrouping, even with two otherwise healthy scenes',async t=>{
  const root=await temporary(t),p=fixture(6);let calls=0;
  const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(_system,_input,_images,_signal,partial)=>{
    calls++;partial?.('{"scenes":[');throw new AnyModelCompletionUncertainError('Unknown transport state','{"scenes":[');
  }},()=>root);
  await assert.rejects(service.resolveScriptRequirements(p,p.scenes,async()=>{}));
  await assert.rejects(service.resolveScriptRequirements(p,p.scenes.slice(4),async()=>{}),/неизвестный платный результат/);assert.equal(calls,1);
});

test('interrupted complete invalid repair resumes at the next smaller level through full and subset scopes',async t=>{
  const root=await temporary(t),p=fixture(6),sizes:number[]=[];let stopped=false,stopSize=6;
  const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(system,input)=>{
    const batch=JSON.parse(input).scenes as Scene[];sizes.push(batch.length);
    if(system.startsWith('Repair')&&batch.length===stopSize)stopped=true;
    return JSON.stringify({scenes:batch.map(s=>row(p.scenes.find(scene=>scene.id===s.id)!,batch.length!==1))});
  }},()=>root);
  const control={shouldStop:()=>stopped,progress:()=>{}};
  await service.resolveScriptRequirements(p,p.scenes,async()=>{},control);
  assert.deepEqual(sizes,[6,6]);
  stopped=false;stopSize=3;
  await service.resolveScriptRequirements(p,p.scenes,async()=>{},control);
  assert.deepEqual(sizes,[6,6,3]);
  stopped=false;stopSize=0;
  await service.resolveScriptRequirements(p,p.scenes.slice(0,3),async()=>{},control);
  assert.deepEqual(sizes,[6,6,3,1,1,1]);
  await service.resolveScriptRequirements(p,p.scenes,async()=>{},control);
  assert.deepEqual(sizes,[6,6,3,1,1,1,3,1,1,1]);
  const before=sizes.length;
  await service.resolveScriptRequirements(p,p.scenes,async()=>{},control);assert.equal(sizes.length,before);
});

test('cached requirements bind id, narration, full script and language; context changes demand a new context-bound completion',async t=>{
  const root=await temporary(t),p=fixture(1);let calls=0;
  const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(_system,input)=>{
    calls++;const data=JSON.parse(input);assert.equal(data.script,p.videoBrief!.readyScript);assert.equal(data.language,p.language);
    return JSON.stringify({scenes:[row(p.scenes[0]!)]});
  }},()=>root);
  await service.resolveScriptRequirements(p,p.scenes,async()=>{});await service.resolveScriptRequirements(p,p.scenes,async()=>{});assert.equal(calls,1);
  p.videoBrief!.readyScript='Different subject in the full script.\n'+p.scenes[0]!.narration;
  await service.resolveScriptRequirements(p,p.scenes,async()=>{});assert.equal(calls,2);
  p.language='Russian';await service.resolveScriptRequirements(p,p.scenes,async()=>{});assert.equal(calls,3);
  p.scenes[0]!.narration='A race car brakes on wet road 10.';p.scenes[0]!.order=10;
  await service.resolveScriptRequirements(p,p.scenes,async()=>{});assert.equal(calls,4);
});

test('legacy completed semantic-invalid row seeds existing repair without receipt mutation or candidate approval',async t=>{
  const root=await temporary(t),p=fixture(1),analysis=join(root,'Documentary','Analysis');await mkdir(analysis,{recursive:true});
  const path=join(analysis,'a'.repeat(64)+'.json'),receipt=JSON.stringify({state:'complete',purpose:'script-requirements-repair',result:{scenes:[row(p.scenes[0]!,true)]},raw:'unchanged native receipt'});
  await writeFile(path,receipt);let calls=0;
  const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(_system,input)=>{
    calls++;const data=JSON.parse(input);assert.match(data.scenes[0].validationError,/brakes/);assert.equal(data.script,p.videoBrief!.readyScript);
    assert.equal(data.completedResponseRepair,'a'.repeat(64));return JSON.stringify({scenes:[row(p.scenes[0]!)]});
  }},()=>root);
  await service.resolveScriptRequirements(p,p.scenes,async plan=>assert.equal(plan.size,1));assert.equal(calls,1);assert.equal(await readFile(path,'utf8'),receipt);
  assert.match(documentaryScriptRequirementsProblem(invalidRequirements(p.scenes[0]!),p.scenes[0]!.narration),/brakes/);
});
