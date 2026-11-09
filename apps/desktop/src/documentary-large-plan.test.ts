import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {Project,Scene} from '@gold-work/shared';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {AnyModelCompletionUncertainError} from './anymodel-client.js';

const scene=(order:number)=>({id:`large-${order}`,order,narration:`In take ${order}, the Ford Model A drives across a wet road in 1927.`}) as Scene;
const project=(scenes:Scene[])=>({id:'large',language:'English',scenes,videoBrief:{readyScript:'Henry Ford introduced the moving assembly line in 1913.\n'+scenes.map(s=>s.narration).join('\n')}}) as Project;
const row=(s:Scene)=>({id:s.id,entities:['Ford Model A'],identities:[{name:'Ford Model A',aliases:['Ford Model A 1927']}],years:['1927'],queries:['Ford Model A driving','Ford Model A wet road'],preferredKind:'video',
  scriptRequirements:{version:1,scriptText:s.narration,checks:[
    {id:'r1',kind:'object',scriptQuote:'Ford Model A',required:'Ford Model A'},
    {id:'r2',kind:'action',scriptQuote:'drives',required:'Driving'},
    {id:'r3',kind:'condition',scriptQuote:'across a wet road',required:'Wet road'},
    {id:'r4',kind:'condition',scriptQuote:'in 1927',required:'1927 period'}],nonVisual:[{scriptQuote:`In take ${s.order}`,reason:'Editing take index'}]}});

test('300 scenes keep full context, all frozen checks and unique coverage; restart/subset never resubmits completed rows',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-large-plan-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const scenes=Array.from({length:300},(_,i)=>scene(i)),p=project(scenes),before=structuredClone(p);
  const submitted:string[]=[];let peak=0,active=0,calls=0;
  const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(system,input,_images,_signal,_partial,_model,tokens)=>{
    calls++;active++;peak=Math.max(peak,active);
    const data=JSON.parse(input);assert.equal(data.script,p.videoBrief?.readyScript);assert.match(data.script,/Henry Ford.*1913/);
    assert.equal(tokens,9000);assert.ok(data.scenes.length<=6);assert.match(system,/strict compact JSON/);
    submitted.push(...data.scenes.map((s:Scene)=>s.id));await new Promise(resolve=>setTimeout(resolve,1));active--;
    return JSON.stringify({scenes:data.scenes.map((s:Scene)=>row(scenes.find(original=>original.id===s.id)!))});
  }},()=>root);
  let saves=0;
  const result=await service.plan(p,scenes,async batch=>{saves+=batch.size;});
  assert.equal(result.size,300);assert.equal(saves,300);assert.equal(calls,50);assert.equal(peak,2);
  assert.equal(submitted.length,300);assert.equal(new Set(submitted).size,300);assert.deepEqual(p,before);
  for(const s of scenes){const r=result.get(s.id)!;assert.equal(r.text,s.narration);assert.deepEqual(r.scriptRequirements,row(s).scriptRequirements);assert.deepEqual(r.identities,row(s).identities);assert.deepEqual(r.years,['1927']);}
  assert.equal((await service.plan(p,scenes)).size,300);
  assert.equal((await service.plan(p,scenes.filter((_,i)=>i%2===1))).size,150);
  assert.equal(calls,50,'paid rows survive regrouping without new submissions');
});

test('invalid received JSON has bounded decomposition, uncertain JSON never retries; no invalid row is saved',async t=>{
  for(const kind of ['truncated','duplicate','invalid-query','unknown-stream'] as const){
    const root=await mkdtemp(join(tmpdir(),'gws-large-invalid-'));t.after(()=>rm(root,{recursive:true,force:true}));
    const scenes=Array.from({length:6},(_,i)=>scene(i)),p=project(scenes);let calls=0,saves=0;
    const raw=JSON.stringify({scenes:scenes.map(row)});
    const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(_system,_input,_images,_signal,onPartial)=>{
      calls++;
      if(kind==='unknown-stream'){onPartial?.(raw.slice(0,-5));throw new AnyModelCompletionUncertainError('Disconnected',raw.slice(0,-5));}
      if(kind==='truncated')return raw.slice(0,-5);
      const rows=scenes.map(row);if(kind==='duplicate')rows[1]!.id=rows[0]!.id;
      else rows[1]!.queries=[];
      return JSON.stringify({scenes:rows});
    }},()=>root);
    await assert.rejects(service.plan(p,scenes,async batch=>{saves+=batch.size;}));assert.equal(saves,0,kind);
    await assert.rejects(service.plan(p,scenes.slice(0,3),async batch=>{saves+=batch.size;}));
    assert.equal(calls,kind==='unknown-stream'?1:9,kind);assert.equal(saves,0,kind);
  }
});

test('a partial malformed legacy response is preserved verbatim and blocks all new batches',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-old-plan-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const analysis=join(root,'Documentary','Analysis');await mkdir(analysis,{recursive:true});
  const path=join(analysis,`${'a'.repeat(64)}.json`),checkpoint=JSON.stringify({state:'partial',purpose:'search-plan',raw:'{"scenes":[{"id":"large-0","queries":["Ford Model A"]}'});
  await writeFile(path,checkpoint);let calls=0;
  const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{calls++;throw new Error('Forbidden new POST');}},()=>root);
  const scenes=Array.from({length:300},(_,i)=>scene(i));
  await assert.rejects(service.plan(project(scenes),scenes),/неопределённый результат/);
  assert.equal(calls,0);assert.equal(await readFile(path,'utf8'),checkpoint);
});

test('duplicate input ids fail before submission',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-plan-input-'));t.after(()=>rm(root,{recursive:true,force:true}));let calls=0;
  const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{calls++;return '{}';}},()=>root);
  const scenes=[scene(0),scene(0)];await assert.rejects(service.plan(project(scenes),scenes),/Повторные id/);assert.equal(calls,0);
});
