import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,mkdir,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {documentaryCheckpointKey} from './documentary-checkpoint-key.js';
import {documentaryReviewContract} from './documentary-review-contract.js';
import {documentaryGeneralIllustrationInstruction} from './documentary-scene-context.js';
import {documentaryScriptRequirements} from './documentary-script-evidence.js';
import type {Project,Scene} from '@gold-work/shared';

test('compact thematic query refinement keeps the old paid checkpoint guard',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-thematic-refine-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const scene={id:'s',order:0,title:'Camera',imagePrompt:'',animationPrompt:'',durationSeconds:4,status:'draft',
    narration:'The Nikon D850 had a larger sensor.',documentary:{version:2,candidates:[],verified:false,pinned:false,illustrative:true,reviewNote:'',
      caption:{text:'',enabled:false,position:'bottom',animation:'fade',fontSize:32,color:'#fff',backgroundColor:'#000',opacity:1},layout:'full',effects:[],
      requirement:{text:'The Nikon D850 had a larger sensor.',entities:[],identities:[],years:[],queries:['camera exterior'],preferredKind:'image',
        visualScope:'illustrative',illustrationQuery:'camera exterior',narrativeIdentities:[{name:'Nikon D850',aliases:[]}]}}} as Scene;
  const project={id:'p',scenes:[scene],videoBrief:{readyScript:scene.narration}} as Project;
  let previous:Array<{system:string;input:string}>=[];
  const first=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>assert.fail('Capture only')},()=>root);
  (first as any).complete=async(_id:string,_purpose:string,system:string,input:string,_images:string[],old:typeof previous)=>{
    assert.match(system,/THEMATIC/);assert.ok(JSON.parse(input).scenes[0].forbiddenNames.includes('Nikon D850'));
    previous=old;return {scenes:[{id:'s',queries:['camera exterior']}]};
  };
  await first.refineQueries(project,[scene]);assert.ok(previous.length);
  const directory=join(root,'Documentary','Analysis');await mkdir(directory,{recursive:true});
  const key=documentaryCheckpointKey('search-refinement',previous[0]!.system,previous[0]!.input,[]);
  await writeFile(join(directory,key+'.json'),JSON.stringify({state:'pending',purpose:'search-refinement'}));
  let calls=0;
  const next=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{calls++;assert.fail('Unknown old refinement must not be repeated');}},()=>root);
  await assert.rejects(next.refineQueries(project,[scene]),/неизвестный результат/);assert.equal(calls,0);
});

test('a new named photograph cannot identify an absent owner from the visible vehicle',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-visible-owner-'));t.after(()=>rm(root,{recursive:true,force:true}));
  for(const personVisible of [false,true]){
    let calls=0;
    const intel=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{
      calls++;return JSON.stringify({status:'accepted',confidence:.95,identityMatch:true,identifiedEntity:'Marie Curie',
        visibleSubjects:[{name:personVisible?'Marie Curie':'Kodak',evidence:personVisible?'Her face and laboratory coat are plainly visible.':'Only the camera belonging to the named person is visible.'}],
        narrativeEvidence:{subjectMatch:true,eraMatch:true,detailMatch:true,requiredEra:'none',observedEra:'none',eraEvidenceQuote:'',evidence:'Mock observation for testing the contract'},
        technicalQuality:{detail:'clear',compression:'clean',pixelated:false,evidence:'Sharp subject edges',orientation:'upright',continuousShot:true}});
    }},()=>join(root,String(personVisible)));
    const run=()=> (intel as any).inspection.run({submissions:0,shouldStop:()=>false,identities:[{name:'Marie Curie',aliases:[]}]},
      ()=> (intel as any).complete('p','visual-overview','Inspect actual pixels',JSON.stringify({mediaKind:'image',source:{title:'Her camera'}}),['frame']));
    const result=await run();
    assert.equal(result.status,personVisible?'accepted':'uncertain');assert.equal(calls,1);
    if(!personVisible){
      const directory=join(root,String(personVisible),'Documentary','Analysis');
      const first=(await readdir(directory)).find(name=>/^[a-f0-9]{64}\.json$/.test(name))!;
      const path=join(directory,first),receipt=JSON.parse(await readFile(path,'utf8'));
      receipt.result={...receipt.result,status:'accepted',visibleSubjects:undefined};
      await writeFile(path,JSON.stringify(receipt));calls=0;
      assert.equal((await run()).status,'uncertain');assert.equal(calls,1,'A known complete owner-only approval gets one actual-pixel repair');
      calls=0;assert.equal((await run()).status,'uncertain');assert.equal(calls,0,'A completed repair is reused');
      const repair=(await readdir(directory)).find(name=>name!==first&&/^[a-f0-9]{64}\.json$/.test(name))!;
      await writeFile(join(directory,repair),JSON.stringify({state:'partial',raw:'{"status":'}));
      await assert.rejects(run(),/незавершённый ответ/);assert.equal(calls,0,'An unknown paid repair must not be resubmitted');
    }
  }
});

test('streaming checkpoint keys preserve every existing paid-request identity',()=>{
  for(const images of [[],['data:image/jpeg;base64,abc'],['"\\\nРусский',...Array.from({length:15},()=> 'data:image/jpeg;base64,'+'a'.repeat(100000))]]){
    const values=['catalog-range-batch','Policy "quoted"\n✓','{"narration":"2004"}',images] as const;
    assert.equal(documentaryCheckpointKey(...values),createHash('sha256').update(JSON.stringify([2,...values])).digest('hex'));
  }
});

test('range provenance retains full description; new format does not replay an unknown prior request',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-contract-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const requests:Array<{system:string;input:string}>=[];
  const scriptRequirements={version:1 as const,scriptText:'The 2004 race.',checks:[
    {id:'race',kind:'object' as const,scriptQuote:'race',required:'race'},
    {id:'year',kind:'condition' as const,scriptQuote:'2004',required:'2004 season'}],nonVisual:[]};
  assert.ok(documentaryScriptRequirements(scriptRequirements,scriptRequirements.scriptText));
  const review={status:'accepted',confidence:.95,
    scriptEvidence:{version:1,scriptText:scriptRequirements.scriptText,checks:[
      {...scriptRequirements.checks[0],requirementId:'race',match:true,evidence:'Motorcycles and riders occupy the racing circuit.'},
      {...scriptRequirements.checks[1],requirementId:'year',match:true,evidence:'The dated source identifies the 2004 season.'}]},
    narrativeEvidence:{subjectMatch:true,eraMatch:true,detailMatch:true,requiredEra:'2004',observedEra:'2004',eraEvidenceQuote:'2004',evidence:'Race recorded in the 2004 season.'},technicalQuality:{detail:'clear',compression:'clean',pixelated:false,evidence:'Sharp real footage',orientation:'upright',continuousShot:true}};
  const intel=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(system,input)=>{requests.push({system,input});return JSON.stringify({reviews:[review]});}},()=>root);
  const context={submissions:0,shouldStop:()=>false,scriptRequirements,narrativeContext:{current:{scene:1,text:'The 2004 race.'},preceding:[],following:[],earlierTimeReferences:[]},sourceEra:{title:'Race',description:'Recorded in 2004'}};
  const input=JSON.stringify({source:{title:'Race'},groups:[{id:0}]});
  const run=()=> (intel as any).inspection.run(context,()=> (intel as any).complete('p','catalog-range-batch','Inspect pixels',input,['frame']));
  const result=await run();
  assert.equal(result.reviews[0].status,'accepted');
  assert.deepEqual(JSON.parse(requests[0]!.input).sourceEraReferences.description,['2004']);
  assert.ok(requests[0]!.system.includes(documentaryReviewContract));
  assert.equal((await run()).reviews[0].status,'accepted');
  assert.equal(requests.length,1,'The completed canonical review is reused without another submission');
  const analysis=join(root,'Documentary','Analysis');
  const {readdir}=await import('node:fs/promises');
  const filename=(await readdir(analysis)).find(n=>n.endsWith('.json'))!;
  // Recover the exact hashed system: transport-only quality/annotation suffix
  // follows the output contract and is not part of checkpoint identity.
  const currentSystem=requests[0]!.system.slice(0,requests[0]!.system.indexOf(documentaryReviewContract)+documentaryReviewContract.length);
  const oldSystem=currentSystem.replace(documentaryReviewContract,'');
  // originalScript is appended only for transport, after canonical hashing.
  const {originalScript:_,...data}=JSON.parse(requests[0]!.input);
  assert.equal(filename,documentaryCheckpointKey('catalog-range-batch',currentSystem,JSON.stringify(data),['frame'])+'.json');
  data.sourceEraReferences.description=[];
  const oldKey=documentaryCheckpointKey('catalog-range-batch',oldSystem,JSON.stringify(data),['frame']);
  await rm(join(analysis,filename));
  await writeFile(join(analysis,`${oldKey}.json`),JSON.stringify({state:'partial',raw:'{"reviews":['}));
  await assert.rejects(run,/неизвестный|Новый контекст/);
  assert.equal(requests.length,1,'An output-format/provenance fix never repeats a partial paid request');
});

test('a generic illustration needs visible topic evidence, including in a nested single-range answer',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-visual-topic-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const responses=[
    {status:'accepted',confidence:.9,technicalQuality:{detail:'clear',compression:'clean',pixelated:false,evidence:'Clean motorcycle footage',orientation:'upright',continuousShot:true}},
    {status:'accepted',confidence:.9,reviews:[{status:'accepted',visualTopicMatch:true,visualTopicEvidence:'A motorcycle leans through a racing corner',technicalQuality:{detail:'clear',compression:'clean',pixelated:false,evidence:'Clean motorcycle footage',orientation:'upright',continuousShot:true}}],technicalQuality:{detail:'clear',compression:'clean',pixelated:false,evidence:'Clean motorcycle footage',orientation:'upright',continuousShot:true}}
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
  // This test reconstructs a former full-policy checkpoint. Four frames keep
  // it on that transport; the three-frame compact route has its own tests.
  const images=['frame','frame2','frame3','frame4'];
  const context={submissions:0,shouldStop:()=>false,generalIllustration:true,illustrationTask:'motorcycle racing',
    narrativeContext:{current:{scene:1,text:'Motorcycle racing became more exciting.'},preceding:[],following:[],earlierTimeReferences:[]}};
  const request=JSON.stringify({source:{title:'Motorcycle race'}});
  const first=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(s,i)=>{
    system=s;input=i;return JSON.stringify({status:'rejected',confidence:.8,reason:'Unrelated shot'});
  }},()=>join(root,'capture'));
  await (first as any).inspection.run(context,()=> (first as any).complete('p','visual-overview','Inspect frames',request,images));
  const base=system.slice(0,system.indexOf(documentaryReviewContract)+documentaryReviewContract.length);
  const marker=' The concrete visible topic/action for THIS shot is';
  const end=' Do not invent what is outside sampled frames.';
  const begin=base.indexOf(marker),finish=base.indexOf(end,begin)+end.length;
  assert.ok(begin>=0&&finish>begin&&base.includes(documentaryGeneralIllustrationInstruction));
  const oldSystem=(base.slice(0,begin)+base.slice(finish)).replace(documentaryGeneralIllustrationInstruction,'');
  // The current transport carries the thematic visual task; the former paid
  // request used the original narrative context and had no rewritten narration.
  const {narration:_,narrationContext:__,illustratedNarration:___,originalScript:____,...oldData}=JSON.parse(input);
  oldData.narrativeContext=context.narrativeContext;
  const oldKey=documentaryCheckpointKey('visual-overview',oldSystem,JSON.stringify(oldData),images);
  const guardedRoot=join(root,'guarded'),analysis=join(guardedRoot,'Documentary','Analysis');
  await mkdir(analysis,{recursive:true});
  await writeFile(join(analysis,`${oldKey}.json`),JSON.stringify({state:'partial',raw:'{"status":'}));
  const guarded=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>assert.fail('Unknown paid review must not repeat')},()=>guardedRoot);
  await assert.rejects((guarded as any).inspection.run(context,()=> (guarded as any).complete('p','visual-overview','Inspect frames',request,images)),/неизвестный результат/);
});
