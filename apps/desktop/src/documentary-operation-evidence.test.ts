import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {DocumentaryScene,DocumentaryScriptRequirements} from '@gold-work/shared';
import {documentaryScriptEvidence,documentaryScriptEvidenceIssue} from './documentary-script-evidence.js';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {documentaryReviewContract} from './documentary-review-contract.js';
import {documentaryCheckpointKey} from './documentary-checkpoint-key.js';

type Evidence=NonNullable<NonNullable<DocumentaryScene['visualReview']>['scriptEvidence']>;
type Proof=NonNullable<Evidence['checks'][number]['operationEvidence']>;
const seconds=[4.08,5.08,6.08,7.08,8.08];
function fixture(verb='replaces',required='replacing the part'){
  const scriptText=`A mechanic ${verb} a brake disc.`;
  const requirements:DocumentaryScriptRequirements={version:1,scriptText,checks:[
    {id:'r1',kind:'object',scriptQuote:'mechanic',required:'mechanic'},
    {id:'r2',kind:'object',scriptQuote:'brake disc',required:'brake disc'},
    {id:'r3',kind:'action',scriptQuote:verb,required}],nonVisual:[]};
  const evidence:Evidence={version:1,scriptText,checks:requirements.checks.map(check=>({
    requirementId:check.id,kind:check.kind,scriptQuote:check.scriptQuote,required:check.required,match:true,
    evidence:check.id==='r1'?'The same mechanic is visible.':check.id==='r2'?'The brake disc is mounted throughout.':'The mechanic turns a ratchet near the brake caliper.',
    ...(check.kind==='action'?{temporalEvidence:{startState:'holding ratchet wrench near brake caliper',endState:'turning fastener at brake assembly',changed:true,sameSubject:true,
      observations:seconds.map((seconds,index)=>({seconds,subject:'Mechanic beside brake assembly',visible:true,state:`Ratchet rotates to position ${index}; disc remains mounted.`}))}}:{})}))};
  return {requirements,evidence,action:evidence.checks[2]!};
}
function proof(operation:Proof['operation']='replace',states:Proof['observations'][number]['state'][]=['mounted','mounted','detached','replacement-mounted','replacement-mounted']):Proof{
  const descriptions={mounted:'Grooved disc sits on the wheel hub.',detached:'Grooved disc is held clear of the bare hub.',
    'replacement-mounted':'A distinct smooth, ungrooved disc now sits on that hub.','not-visible':'The disc is outside the frame.'};
  return {operation,objectRequirementId:'r2',part:'brake disc',observations:seconds.map((seconds,index)=>({seconds,state:states[index]!,evidence:descriptions[states[index]!]}))};
}
const issue=({evidence,requirements}:ReturnType<typeof fixture>)=>documentaryScriptEvidenceIssue(evidence,true,seconds,requirements);
function attachProof(f:ReturnType<typeof fixture>,p=proof()){
  f.action.operationEvidence=p;
  f.evidence.checks[1]!.evidence='The brake disc is clearly visible in each sample.';
  f.action.evidence='The mechanic changes the mounting state of the brake disc.';
  const temporal=f.action.temporalEvidence!;
  temporal.startState=p.observations[0]!.evidence;temporal.endState=p.observations.at(-1)!.evidence;
  temporal.observations!.forEach((item,index)=>{item.state=p.observations[index]!.evidence;});
}

test('all-true ratchet action from the native failure does not establish brake-disc replacement',()=>{
  const f=fixture();
  assert.ok(documentaryScriptEvidence({scriptEvidence:f.evidence},f.evidence.scriptText));
  assert.match(issue(f)!,/состояния самой детали/);
  f.action.operationEvidence=proof('replace',Array(5).fill('mounted'));
  assert.match(issue(f)!,/состояния самой детали/);
});

test('replacement requires the original detached and a distinct replacement mounted at supplied times',()=>{
  const f=fixture();attachProof(f);
  assert.equal(issue(f),undefined);
  for(const mutation of [
    (p:Proof)=>{p.operation='remove';},
    (p:Proof)=>{p.objectRequirementId='r3';},
    (p:Proof)=>{p.objectRequirementId='missing';},
    (p:Proof)=>{p.objectRequirementId='r1';},
    (p:Proof)=>{p.part='ratchet wrench';},
    (p:Proof)=>{p.observations[2]!.seconds+=.01;},
    (p:Proof)=>{p.observations.splice(2,1);},
    (p:Proof)=>{p.observations[2]!.state='not-visible';},
    (p:Proof)=>{p.observations[2]!.state='mounted';},
    (p:Proof)=>{p.observations[2]!.evidence=p.observations[0]!.evidence;},
    (p:Proof)=>{p.observations[3]!.state='mounted';p.observations[4]!.state='mounted';},
  ]){
    f.action.operationEvidence=proof();mutation(f.action.operationEvidence);
    assert.match(issue(f)!,/состояния самой детали/);
  }
});

test('removal and installation require opposite part transitions, not their substitute',()=>{
  const removal=fixture('removes','removing the disc');
  attachProof(removal,proof('remove',['mounted','mounted','detached','detached','detached']));
  assert.equal(issue(removal),undefined);
  removal.action.operationEvidence=proof('remove',['detached','detached','mounted','mounted','mounted']);
  assert.match(issue(removal)!,/состояния самой детали/);
  const install=fixture('installs','installing the disc');
  attachProof(install,proof('install',['detached','detached','mounted','mounted','mounted']));
  assert.equal(issue(install),undefined);
  install.action.operationEvidence=proof('install',['mounted','mounted','detached','detached','detached']);
  assert.match(issue(install)!,/состояния самой детали/);
});

test('paired target substitution cannot transfer a part operation to its actor or instrument',()=>{
  const f=fixture();
  f.evidence.scriptText=f.requirements.scriptText='A mechanic replaces a brake disc with a ratchet wrench.';
  f.requirements.checks.push({id:'tool',kind:'object',scriptQuote:'ratchet wrench',required:'ratchet wrench'});
  f.evidence.checks.push({requirementId:'tool',kind:'object',scriptQuote:'ratchet wrench',required:'ratchet wrench',match:true,evidence:'The mechanic holds a ratchet wrench.'});
  f.requirements.nonVisual.push({scriptQuote:'with',reason:'Links the action and its instrument.'});
  attachProof(f);assert.equal(issue(f),undefined);
  for(const [id,part] of [['r1','mechanic'],['tool','ratchet wrench']]){
    f.action.operationEvidence={...proof(),objectRequirementId:id!,part:part!};
    assert.match(issue(f)!,/состояния самой детали/);
  }
});

test('passive narration binds replacement to the preceding part, not the following mechanic',()=>{
  const f=fixture('replaced');
  f.evidence.scriptText=f.requirements.scriptText='A brake disc is replaced by a mechanic.';
  f.requirements.nonVisual.push({scriptQuote:'by',reason:'Marks the actor of the passive operation.'});
  attachProof(f);assert.equal(issue(f),undefined);
  f.action.operationEvidence={...proof(),objectRequirementId:'r1',part:'mechanic'};
  assert.match(issue(f)!,/состояния самой детали/);
});

test('removing bulk material from a part requires temporal progress, not a mechanical lifecycle',()=>{
  for(const bulk of ['snow','dirt','sand','debris']){
    const f=fixture('removes','removing '+bulk);
    f.evidence.scriptText=f.requirements.scriptText=`A mechanic removes ${bulk} from a brake disc.`;
    f.requirements.checks.push({id:'bulk',kind:'object',scriptQuote:bulk,required:bulk});
    f.evidence.checks.push({requirementId:'bulk',kind:'object',scriptQuote:bulk,required:bulk,match:true,evidence:'Bulk material is visible on the disc.'});
    f.requirements.nonVisual.push({scriptQuote:'from',reason:'Links the removed material to its original surface.'});
    f.action.temporalEvidence!.startState='Bulk material covers the disc.';
    f.action.temporalEvidence!.endState='The same disc is clear of the bulk material.';
    f.action.temporalEvidence!.observations!.forEach((item,index)=>{item.state=`Material coverage decreases to ${100-index*25} percent.`;});
    assert.equal(issue(f),undefined,bulk+' must not require mounted/detached evidence');
    f.action.temporalEvidence!.changed=false;
    assert.match(issue(f)!,/изменение действия/);
  }
});

test('literal Russian narration cannot be weakened into generic work on a part',()=>{
  const f=fixture();
  f.evidence.scriptText=f.requirements.scriptText='Механик заменяет тормозной диск.';
  for(const [index,quote] of ['Механик','тормозной диск','заменяет'].entries()){
    f.evidence.checks[index]!.scriptQuote=f.requirements.checks[index]!.scriptQuote=quote;
  }
  f.action.required=f.requirements.checks[2]!.required='working on the part';
  assert.match(issue(f)!,/состояния самой детали/);
  attachProof(f);
  assert.equal(issue(f),undefined);
});

test('ordinary sustained action keeps its existing temporal proof',()=>{
  const f=fixture('turns','turning a brake disc');
  assert.equal(issue(f),undefined);
});

test('old complete acceptance is revalidated on restart without a POST or rewriting its raw receipt',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-operation-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const f=fixture();let calls=0;let requestSystem='',requestInput='';
  const response={status:'accepted',confidence:.96,reason:'Mechanic turns a ratchet.',scriptEvidence:f.evidence,
    narrativeEvidence:{subjectMatch:true,eraMatch:true,detailMatch:true,requiredEra:'none',observedEra:'unspecified',evidence:'A mechanic works on a brake disc.'},
    technicalQuality:{detail:'clear',compression:'clean',pixelated:false,evidence:'Clear actual footage',orientation:'upright',continuousShot:true}};
  const raw=JSON.stringify(response);
  const context={submissions:0,shouldStop:()=>false,comparisonSubjects:[],scriptRequirements:f.requirements,
    narrativeContext:{current:{scene:1,text:f.evidence.scriptText},preceding:[],following:[],earlierTimeReferences:[]}};
  const input=JSON.stringify({narration:f.evidence.scriptText,mediaKind:'video',sampleSeconds:seconds});
  const frames=['first','second','third','fourth','fifth'];
  const run=(intel:DocumentaryIntelligence)=> (intel as any).inspection.run(context,
    ()=> (intel as any).complete('p','visual-range','Inspect actual frames',input,frames));
  const intel=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(system,input)=>{
    calls++;requestSystem=system;requestInput=input;return raw;
  }},()=>root);
  const first=await run(intel);
  assert.equal(first.status,'uncertain');assert.match(first.reason,/состояния самой детали/);
  const directory=join(root,'Documentary','Analysis');
  const files=(await readdir(directory)).filter(file=>file.endsWith('.json'));
  assert.equal(files.length,1);
  const path=join(directory,files[0]!);const saved=await readFile(path,'utf8');
  assert.equal(JSON.parse(saved).raw,raw);assert.equal(JSON.parse(saved).result.status,'accepted');
  const canonicalSystem=requestSystem.slice(0,requestSystem.indexOf(documentaryReviewContract)+documentaryReviewContract.length);
  const {originalScript:_,...canonicalInput}=JSON.parse(requestInput);
  assert.equal(files[0],documentaryCheckpointKey('visual-range',canonicalSystem,JSON.stringify(canonicalInput),frames)+'.json',
    'operationEvidence is only a transport append; it must not change checkpoint identity');
  assert.ok(requestSystem.includes('operationEvidence'));
  const restarted=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{calls++;assert.fail('Complete response must never replay');}},()=>root);
  const resumed=await run(restarted);
  assert.equal(resumed.status,'uncertain');assert.match(resumed.reason,/состояния самой детали/);
  assert.equal(calls,1);assert.equal(await readFile(path,'utf8'),saved);
});
