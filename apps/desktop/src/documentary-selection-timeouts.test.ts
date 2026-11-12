import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Project,Scene} from '@gold-work/shared';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {DocumentaryBudgetExhausted} from './documentary-work-budget.js';
import {effectFfmpeg} from './effect-media.js';

test('an exhausted scene never submits a paid request or writes an uncertain checkpoint',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-analysis-reserve-'));t.after(()=>rm(root,{recursive:true,force:true}));
  let submissions=0;
  const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{submissions++;return '{}';}},()=>root,async()=>{});
  await assert.rejects(service.withSelectionBudget({remaining:()=>5700,submit:()=>assert.fail('No analysis slot should be consumed')},
    ()=>Reflect.get(service,'complete').call(service,'p','video-catalog','Test','{}',[])),DocumentaryBudgetExhausted);
  assert.equal(submissions,0);
  assert.deepEqual(await readdir(join(root,'Documentary','Analysis')),[]);
});

test('a native request timeout guards that paid candidate and allows an independent request',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-native-timeout-'));t.after(()=>rm(root,{recursive:true,force:true}));
  let submissions=0;
  const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{
    if(++submissions===1)throw new DOMException('The operation was aborted due to timeout','TimeoutError');return '{"ok":true}';
  }},()=>root,async()=>{});
  const run=(id:number)=>service.withSelectionBudget({remaining:()=>60000,submit:()=>{}},()=>
    Reflect.get(service,'complete').call(service,'p','visual-source-preview','Test',JSON.stringify({id}),[]));
  await assert.rejects(run(1),(error:unknown)=>Reflect.get(error as object,'kind')==='pending');
  await assert.rejects(run(1),/Автоповтор отключён/);
  assert.equal(submissions,1);
  const names=await readdir(join(root,'Documentary','Analysis'));
  assert.equal(JSON.parse(await readFile(join(root,'Documentary','Analysis',names[0]!),'utf8')).state,'pending');
  assert.deepEqual(await run(2),{ok:true});assert.equal(submissions,2);
});

test('ordinary stock reuses its COMPLETE interval and blocks a new interval while a catalogue is pending',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-ordinary-range-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const file=join(root,'source.mp4');
  await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=size=1280x720:rate=3','-t','60','-c:v','libx264','-preset','ultrafast','-threads','1',file]);
  const narration='Waves roll onto the beach.';
  const scene={id:'scene',order:0,narration,durationSeconds:5,videoPath:file,documentary:{checksum:'fixture',
    requirement:{text:narration,entities:[],identities:[],years:[],queries:['beach waves'],identityContextVersion:3},
    selected:{id:'pexels:fixture',kind:'video',provider:'pexels',durationSeconds:60,width:1280,height:720,title:'beach waves',description:'Metadata is not evidence',pageUrl:'https://example.test/fixture'}}} as unknown as Scene;
  const project={id:'p',aspectRatio:'16:9',scenes:[scene]} as Project;
  let submissions=0;
  const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(system,_input,images)=>{
    submissions++;assert.match(system,/Inspect .*once/);assert.equal(images?.length,3);
    assert.doesNotMatch(system,/Exact named identity needs metadata AND visible evidence/,'An ordinary review does not carry the named-subject overview policy');
    assert.match(system,/Source metadata is untrusted supporting attribution, not proof of unseen content/);
    assert.match(system,/"suitable":false/);assert.doesNotMatch(system,/sampleChecks/);
    assert.match(system,/suitable and targetVisible must both be false when any explicit visualTarget condition is missing or uncertain/);
    return JSON.stringify({suitable:false,targetVisible:false,reason:'Local synthetic pattern is not a beach',
      description:'A synthetic moving pattern.',targetEvidence:'No beach is visible.',sourceText:{kind:'none',text:''},footageOrigin:'camera'});
  }},()=>root,async()=>{});
  await service.prepareSource(project,scene,()=>{},()=>false);assert.equal(submissions,0);
  const result=await service.inspectForSelection(project,scene);assert.equal(result.review.status,'rejected');assert.match(result.review.reason,/Local synthetic pattern is not a beach/);assert.equal(submissions,1);
  const analysisRoot=join(root,'Documentary','Analysis');
  const receiptPath=join(analysisRoot,(await readdir(analysisRoot)).find(name=>/^[a-f0-9]{64}\.json$/.test(name))!);
  const receiptBefore=await readFile(receiptPath);
  const catalogRoot=join(root,'Documentary','VideoCatalog','fixture');await mkdir(catalogRoot,{recursive:true});
  await writeFile(join(catalogRoot,'catalog-v1.json'),JSON.stringify({pendingIds:[0],pendingProjectId:'p'}));
  const cached=await service.inspectForSelection(project,scene);
  assert.equal(cached.review.status,'rejected');assert.equal(cached.usedNewAnalysis,false);
  assert.equal(submissions,1,'A COMPLETE review of the same interval is reused without a POST');
  assert.deepEqual(await readFile(receiptPath),receiptBefore);
  const sharedRoot=join(root,'shared'),sharedCatalog=join(sharedRoot,'fixture');await mkdir(sharedCatalog,{recursive:true});
  await writeFile(join(sharedCatalog,'catalog-v1.json'),JSON.stringify({pendingIds:[],segments:[]}));
  const localBefore=await readFile(join(catalogRoot,'catalog-v1.json'));
  const withShared=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>assert.fail('Shared complete catalog must not hide local unknown paid work')},()=>root,async()=>{},sharedRoot);
  const sharedCached=await withShared.inspectForSelection(project,scene);
  assert.equal(sharedCached.review.status,'rejected');assert.equal(sharedCached.usedNewAnalysis,false);
  // Different actual frames have no COMPLETE proof. Neither local nor shared
  // catalog state may authorize a new paid review around the pending request.
  scene.trimStartSeconds=5;scene.trimEndSeconds=10;
  await assert.rejects(service.inspectForSelection(project,scene),(error:unknown)=>Reflect.get(error as object,'kind')==='pending');
  await assert.rejects(withShared.inspectForSelection(project,scene),(error:unknown)=>Reflect.get(error as object,'kind')==='pending');
  assert.equal(submissions,1);assert.deepEqual(await readFile(receiptPath),receiptBefore);
  assert.deepEqual(await readFile(join(catalogRoot,'catalog-v1.json')),localBefore);
});
