import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import type {DocumentaryAiSearchPlan} from '@gold-work/shared';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {documentaryGroundedIllustrationQualityInstruction,documentaryIllustrationScriptGrounding} from './documentary-illustration-quality.js';
import {checkDocumentarySelectionRetry,DocumentaryRetryPermissions,DocumentarySelectionRetryProbePassed,documentarySelectionRetry,listDocumentaryRecovery,readDocumentarySelectionRetryGrant} from './documentary-retry.js';

const narration='After eight tea voyages, Cutty Sark left the trade for which she had been built.';
const plan:DocumentaryAiSearchPlan={version:1,inputHash:'fixture',model:'fixture',subject:'Cutty Sark',
  visualTarget:'Cutty Sark',visualScope:'illustrative',preferredKind:'image',imageQueries:['Cutty Sark'],videoQueries:[],
  fallbackVideoQueries:[],fallbackVisualTarget:'',grounding:{version:1,mandatory:[{kind:'identity',required:'Cutty Sark',scriptQuote:'Cutty Sark'}],
    illustrations:['A modern view of the same preserved ship.'],optionalDetails:['Tea cargo being loaded.']},years:[]};
const scriptGrounding=documentaryIllustrationScriptGrounding(plan,narration)!;

test('grounded question carries original script, optional loading and binding identity without rewriting their evidence',()=>{
  assert.equal(scriptGrounding.originalScript,narration);
  assert.equal(scriptGrounding.grounding,plan.grounding);
  assert.equal(documentaryIllustrationScriptGrounding({...plan,grounding:undefined},narration),undefined);
  assert.equal(documentaryIllustrationScriptGrounding(plan,'Unrelated original script.'),undefined);
});

test('one explicit terminal-incomplete receipt can commission a grounded visual review and preserve its original archive',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-grounded-review-'));t.after(()=>rm(root,{recursive:true,force:true}));
  let calls=0;
  const client={configured:async()=>true,documentaryAnalysisModel:async()=>'fixture',
    documentaryCompletion:async(system:string,text:string,...args:unknown[])=>{
      calls++;
      if(calls===1)return '```json\n{"description":"The preserved clipper';
      assert.equal(system,documentaryGroundedIllustrationQualityInstruction);
      const input=JSON.parse(text);assert.deepEqual(input.scriptGrounding,scriptGrounding);
      assert.equal((args[6] as {singleAttempt?:boolean}).singleAttempt,true);
      return JSON.stringify({suitable:false,targetVisible:false,description:'A different identified ship.',
        reason:'The source and visible structure identify a different vessel.',targetEvidence:'Different hull and rigging.',sourceText:{kind:'none',text:''}});
    }};
  const service=new DocumentaryIntelligence(client as never,()=>root),complete=(service as any).complete.bind(service);
  const oldInput={singleReview:true,singleReviewVersion:5,visualTarget:'Cutty Sark',narration,sourcePolicy:'specific',
    requiredYears:[],analysisModel:'fixture',checksum:'b'.repeat(64),fileRevision:{size:'123',mtimeNs:'1',ctimeNs:'1'},
    startSeconds:0,endSeconds:0,illustrationQualityVersion:1};
  const oldSystem='Fixture old visual task',oldText=JSON.stringify(oldInput);
  const inspectOld=()=>complete('p','visual-illustration',oldSystem,oldText,[]);
  await assert.rejects(inspectOld(),/незавершённый JSON/);assert.equal(calls,1);
  const [item]=await listDocumentaryRecovery(root);assert.ok(item);
  const directory=join(root,'Documentary','Analysis'),original=await readFile(join(directory,item.id+'.json'),'utf8');
  const newInput={...oldInput,sceneId:'scene-40',scriptGrounding};
  const inspect=(patch={})=>complete('p','visual-illustration',documentaryGroundedIllustrationQualityInstruction,
    JSON.stringify({...newInput,...patch}),[],[{system:oldSystem,input:oldText}]);
  await assert.rejects(inspect(),/неизвестный результат/);assert.equal(calls,1);
  await new DocumentaryRetryPermissions().authorize(root,[item]);
  const grant=(await readDocumentarySelectionRetryGrant(directory,item.id))!;
  assert.equal(grant.groundedNarration,narration);
  await assert.rejects(documentarySelectionRetry.run({grant,probe:true},()=>inspect()),DocumentarySelectionRetryProbePassed);
  assert.equal(calls,1,'A permission probe never posts');
  const review=await documentarySelectionRetry.run({grant,probe:false},()=>inspect());
  assert.equal(review.suitable,false,'Grounding never turns a different-identity model refusal into acceptance');
  assert.equal(calls,2);
  assert.deepEqual(await documentarySelectionRetry.run({grant,probe:false},()=>inspect()),review);
  assert.equal(calls,2,'The settled rejection is cached');
  await assert.rejects(documentarySelectionRetry.run({grant,probe:false},()=>inspect({scriptGrounding:{...scriptGrounding,
    grounding:{...scriptGrounding.grounding,optionalDetails:['Another optional view.']}}})),/не совпадает/);
  assert.equal(calls,2,'Changing optional wording cannot spend the same grant again');
  await assert.rejects(documentarySelectionRetry.run({grant,probe:false},inspectOld),/не совпадает/);
  await assert.rejects(inspectOld(),/уже использована/);
  assert.equal(calls,2,'The original exact request cannot reuse the grant spent on its grounded successor');
  assert.equal(await readFile(join(directory,'RetryHistory',`${item.id}-${item.revision}.json`),'utf8'),original);
  const receipts=await Promise.all((await readdir(directory)).filter(name=>/^[a-f0-9]{64}\.json$/.test(name))
    .map(async name=>JSON.parse(await readFile(join(directory,name),'utf8'))));
  assert.equal(receipts.filter(receipt=>receipt.singleReviewBinding?.groundedRetryOrigin===item.id).length,1);
});

for(const state of ['received','partial','pending'] as const)test(`grounded transition rejects unrelated tasks and ${state} transport ambiguity`,async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-grounded-grant-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const service=new DocumentaryIntelligence({configured:async()=>true,documentaryAnalysisModel:async()=>'fixture',
    documentaryCompletion:async()=>'{"description":"unfinished'},()=>root);
  await assert.rejects((service as any).complete('p','visual-illustration','fixture',JSON.stringify({singleReview:true,
    visualTarget:'Cutty Sark',narration,checksum:'c'.repeat(64),startSeconds:0,endSeconds:0,illustrationQualityVersion:1}),[]));
  const [initial]=await listDocumentaryRecovery(root),directory=join(root,'Documentary','Analysis');assert.ok(initial);
  const path=join(directory,initial.id+'.json'),receipt=JSON.parse(await readFile(path,'utf8'));
  await writeFile(path,JSON.stringify({...receipt,state}));
  const [item]=await listDocumentaryRecovery(root);assert.ok(item);
  await new DocumentaryRetryPermissions().authorize(root,[item]);
  const grant=(await readDocumentarySelectionRetryGrant(directory,item.id))!;
  const request={id:'d'.repeat(64),purpose:'visual-illustration',model:'fixture',existing:false,
    binding:{...grant.binding,taskKey:'e'.repeat(64)},groundedTask:{sceneId:'scene',narration,...scriptGrounding}};
  const gate=(value= request)=>documentarySelectionRetry.run({grant,probe:false},()=>checkDocumentarySelectionRetry(directory,value));
  if(state==='received')assert.equal(await gate(),'grounded');else await assert.rejects(gate(),/не совпадает/);
  for(const wrong of [{...request,model:'other'},{...request,binding:{...request.binding,checksum:'f'.repeat(64)}},
    {...request,binding:{...request.binding,end:1}},{...request,existing:true},
    {...request,groundedTask:{...request.groundedTask,narration:'Different narration.'}},
    {...request,groundedTask:{...request.groundedTask,originalScript:'Unrelated script.'}}])await assert.rejects(gate(wrong),/не совпадает/);
});
