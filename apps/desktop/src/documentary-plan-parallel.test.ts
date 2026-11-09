import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Project, Scene } from "@gold-work/shared";
import { DocumentaryIntelligence } from "./documentary-intelligence.js";
import {AnyModelProviderResponseError} from './anymodel-client.js';

test("search planning bounds parallel requests, saves complete batches and reuses paid responses", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-plan-parallel-")); t.after(() => rm(root, { recursive: true, force: true }));
  const scenes = Array.from({ length: 53 }, (_, order) => ({ id: `scene-${order}`, order, narration: "The tractor wheels turn." })) as Scene[];
  const project = { id: "new", language: "English", scenes, videoBrief: { readyScript: scenes.map(scene => scene.narration).join(" ") } } as Project;
  let active = 0, peak = 0, requests = 0;
  const intelligence = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async (_system, input) => {
    requests++; active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 25)); active--;
    return JSON.stringify({ scenes: JSON.parse(input).scenes.map((scene: Scene) => ({ id: scene.id, entities: ["tractor"], queries: ["tractor wheels"], sectionTitle: "tractor wheels" })) });
  } }, () => root);
  const saved: number[] = [];
  assert.equal((await intelligence.plan(project, scenes, async batch => { saved.push(batch.size); })).size, 53);
  assert.equal(peak, 2); assert.equal(requests, 9); assert.deepEqual(saved.sort((a, b) => a - b), [5, 6, 6, 6, 6, 6, 6, 6, 6]);
  await intelligence.plan(project, scenes); assert.equal(requests, 9);
});

test('a prior confirmed oversized plan timeout uses smaller batches; an uncertain plan never changes batch boundaries',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-plan-timeout-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const scenes=Array.from({length:24},(_,order)=>({id:`s-${order}`,order,narration:'A car engine.'})) as Scene[];
  const project={id:'new',language:'English',scenes,videoBrief:{readyScript:scenes.map(s=>s.narration).join(' ')}} as Project;
  await mkdir(join(root,'Documentary','Analysis'),{recursive:true});
  await writeFile(join(root,'Documentary','Analysis',`${'a'.repeat(64)}.json`),JSON.stringify({state:'failed',purpose:'search-plan',batchSceneCount:6,error:'upstream provider timed out'}));
  const sizes:number[]=[];
  const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(_system,input)=>{
    const batch=JSON.parse(input).scenes;sizes.push(batch.length);
    if(batch.length>3)throw new AnyModelProviderResponseError('The upstream provider timed out. Try again.');
    return JSON.stringify({scenes:batch.map((s:Scene)=>({id:s.id,queries:['car engine'],entities:[],identities:[]}))});
  }},()=>root,async()=>{},undefined,async()=>{});
  assert.equal((await service.plan(project,scenes)).size,24);
  assert.deepEqual(sizes,[3,3,3,3,3,3,3,3]);
  await service.plan(project,scenes);assert.deepEqual(sizes,[3,3,3,3,3,3,3,3],'smaller paid responses are reused after restart');

  const uncertainRoot=await mkdtemp(join(tmpdir(),'gws-plan-uncertain-'));t.after(()=>rm(uncertainRoot,{recursive:true,force:true}));
  let calls=0;
  const uncertain=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{calls++;throw new Error('Connection disappeared after submission');}},()=>uncertainRoot);
  await assert.rejects(uncertain.plan(project,scenes.slice(0,6)));
  await assert.rejects(uncertain.plan(project,scenes.slice(12)),/неопределённый результат/);
  assert.equal(calls,1,'an unknown paid request is not hidden by a different scene group');
});

test('a completed ordered plan with one mistyped hex digit is recovered without another paid request', async t => {
  const root = await mkdtemp(join(tmpdir(), 'gws-plan-id-')); t.after(() => rm(root, { recursive: true, force: true }));
  const scenes = ['doc-a991ec062551e4a015c0', 'doc-9a8d9fe6d1a5e2ee1f59', 'doc-28ac34aa063777781316']
    .map((id, order) => ({ id, order, narration: 'The steering rack moves.' })) as Scene[];
  const project = { id: 'new', language: 'English', scenes, videoBrief: { readyScript: scenes.map(s => s.narration).join(' ') } } as Project;
  let calls = 0;
  const response = { scenes: scenes.map(s => ({ id: s.id, queries: ['steering rack'], entities: [], identities: [] })) };
  response.scenes[1]!.id = 'doc-9a8d9fe6d1a5e2ae1f59';
  const service = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async () => { calls++; return JSON.stringify(response); } }, () => root);
  const saved: string[] = [];
  assert.equal((await service.plan(project, scenes, async batch => { saved.push(...batch.keys()); })).size, 3);
  assert.deepEqual(saved, scenes.map(s => s.id));
  await service.plan(project, scenes); assert.equal(calls, 1, 'reuse the original completed response');

  for (const invalid of ['two-digits', 'duplicate', 'missing', 'shuffled'] as const) {
    const invalidRoot = await mkdtemp(join(tmpdir(), 'gws-plan-id-invalid-')); t.after(() => rm(invalidRoot, { recursive: true, force: true }));
    const rows = structuredClone(response.scenes);
    if (invalid === 'two-digits') rows[1]!.id = 'doc-9a8d9fe6d1a5e2aa1f59';
    if (invalid === 'duplicate') rows[1]!.id = rows[0]!.id;
    if (invalid === 'missing') rows.splice(1, 1);
    if (invalid === 'shuffled') [rows[0], rows[1]] = [rows[1]!, rows[0]!];
    const bad = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async () => JSON.stringify({ scenes: rows }) }, () => invalidRoot);
    await assert.rejects(bad.plan(project, scenes), /Нет поискового плана|некорректный полный поисковый план|не дали валидного ответа/, invalid);
  }
});
