import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {documentaryCheckpointKey} from './documentary-checkpoint-key.js';
import {documentaryReviewContract} from './documentary-review-contract.js';
import {documentaryGeneralIllustrationInstruction} from './documentary-scene-context.js';

test('streaming checkpoint keys preserve every existing paid-request identity',()=>{
  for(const images of [[],['data:image/jpeg;base64,abc'],['"\\\nРусский',...Array.from({length:15},()=> 'data:image/jpeg;base64,'+'a'.repeat(100000))]]){
    const values=['catalog-range-batch','Policy "quoted"\n✓','{"narration":"2004"}',images] as const;
    assert.equal(documentaryCheckpointKey(...values),createHash('sha256').update(JSON.stringify([2,...values])).digest('hex'));
  }
});

test('range provenance retains full description; new format does not replay an unknown prior request',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-contract-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const requests:Array<{system:string;input:string}>=[];
  const review={status:'accepted',confidence:.95,narrativeEvidence:{subjectMatch:true,eraMatch:true,detailMatch:true,requiredEra:'2004',observedEra:'2004',eraEvidenceQuote:'2004',evidence:'Race recorded in the 2004 season.'},technicalQuality:{detail:'clear',compression:'clean',pixelated:false,evidence:'Sharp real footage'}};
  const intel=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(system,input)=>{requests.push({system,input});return JSON.stringify({reviews:[review]});}},()=>root);
  const context={submissions:0,shouldStop:()=>false,narrativeContext:{current:{scene:1,text:'The 2004 race.'},preceding:[],following:[],earlierTimeReferences:[]},sourceEra:{title:'Race',description:'Recorded in 2004'}};
  const input=JSON.stringify({source:{title:'Race'},groups:[{id:0}]});
  const run=()=> (intel as any).inspection.run(context,()=> (intel as any).complete('p','catalog-range-batch','Inspect pixels',input,['frame']));
  const result=await run();
  assert.equal(result.reviews[0].status,'accepted');
  assert.deepEqual(JSON.parse(requests[0]!.input).sourceEraReferences.description,['2004']);
  assert.ok(requests[0]!.system.includes(documentaryReviewContract));
  const analysis=join(root,'Documentary','Analysis');
  const {readdir}=await import('node:fs/promises');
  const filename=(await readdir(analysis)).find(n=>n.endsWith('.json'))!;
  // Recover the exact hashed system: transport-only quality/annotation suffix
  // follows the output contract and is not part of checkpoint identity.
  const currentSystem=requests[0]!.system.slice(0,requests[0]!.system.indexOf(documentaryReviewContract)+documentaryReviewContract.length);
  const oldSystem=currentSystem.replace(documentaryReviewContract,'');
  const data=JSON.parse(requests[0]!.input);data.sourceEraReferences.description=[];
  const oldKey=documentaryCheckpointKey('catalog-range-batch',oldSystem,JSON.stringify(data),['frame']);
  await rm(join(analysis,filename));
  await writeFile(join(analysis,`${oldKey}.json`),JSON.stringify({state:'partial',raw:'{"reviews":['}));
  await assert.rejects(run,/неизвестный|Новый контекст/);
  assert.equal(requests.length,1,'An output-format/provenance fix never repeats a partial paid request');
});

test('a generic illustration needs visible topic evidence, including in a nested single-range answer',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-visual-topic-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const responses=[
    {status:'accepted',confidence:.9,technicalQuality:{detail:'clear',compression:'clean',pixelated:false,evidence:'Clean motorcycle footage'}},
    {status:'accepted',confidence:.9,reviews:[{status:'accepted',visualTopicMatch:true,visualTopicEvidence:'A motorcycle leans through a racing corner',technicalQuality:{detail:'clear',compression:'clean',pixelated:false,evidence:'Clean motorcycle footage'}}],technicalQuality:{detail:'clear',compression:'clean',pixelated:false,evidence:'Clean motorcycle footage'}}
  ];
  let calls=0;
  const intel=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>JSON.stringify(responses[calls++])},()=>join(root,String(calls)));
  const context={submissions:0,shouldStop:()=>false,generalIllustration:true,illustrationTask:'motorcycle racing'};
  const run=()=> (intel as any).inspection.run(context,()=> (intel as any).complete('p','visual-overview','Inspect actual frames',JSON.stringify({source:{title:'Sports'}}),['frame']));
  assert.equal((await run()).status,'uncertain','No pixels establish the concrete topic');
  const nested=await run();
  assert.equal(nested.status,'accepted',JSON.stringify(nested));
  assert.equal(calls,2);
});

test('a new visual-topic rule does not resubmit an older unknown generic review',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-topic-unknown-'));t.after(()=>rm(root,{recursive:true,force:true}));
  let system='',input='';
  const context={submissions:0,shouldStop:()=>false,generalIllustration:true,illustrationTask:'motorcycle racing',
    narrativeContext:{current:{scene:1,text:'Motorcycle racing became more exciting.'},preceding:[],following:[],earlierTimeReferences:[]}};
  const request=JSON.stringify({source:{title:'Motorcycle race'}});
  const first=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(s,i)=>{
    system=s;input=i;return JSON.stringify({status:'rejected',confidence:.8,reason:'Unrelated shot'});
  }},()=>join(root,'capture'));
  await (first as any).inspection.run(context,()=> (first as any).complete('p','visual-overview','Inspect frames',request,['frame']));
  const base=system.slice(0,system.indexOf(documentaryReviewContract)+documentaryReviewContract.length);
  const marker=' The concrete visible topic/action for THIS shot is';
  const end=' Do not invent what is outside sampled frames.';
  const begin=base.indexOf(marker),finish=base.indexOf(end,begin)+end.length;
  assert.ok(begin>=0&&finish>begin&&base.includes(documentaryGeneralIllustrationInstruction));
  const oldSystem=(base.slice(0,begin)+base.slice(finish)).replace(documentaryGeneralIllustrationInstruction,'');
  const oldKey=documentaryCheckpointKey('visual-overview',oldSystem,input,['frame']);
  const guardedRoot=join(root,'guarded'),analysis=join(guardedRoot,'Documentary','Analysis');
  await mkdir(analysis,{recursive:true});
  await writeFile(join(analysis,`${oldKey}.json`),JSON.stringify({state:'partial',raw:'{"status":'}));
  const guarded=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>assert.fail('Unknown paid review must not repeat')},()=>guardedRoot);
  await assert.rejects((guarded as any).inspection.run(context,()=> (guarded as any).complete('p','visual-overview','Inspect frames',request,['frame'])),/неизвестный результат/);
});
