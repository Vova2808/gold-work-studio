import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import type {Project,Scene} from '@gold-work/shared';
import {documentaryScriptEvidence, documentaryScriptEvidenceIssue, documentaryRecoveryQueries,documentaryScriptRequirements} from './documentary-script-evidence.js';
import {documentarySearchQueries,documentaryStockQueries} from './documentary-project-service.js';

const scriptText='The car brakes on wet asphalt before an intersection.';
const observations=[.1,2,4].map((seconds,index)=>({seconds,subject:'White hatchback',visible:true,state:['Approaching junction.','Slowing before junction.','Stopped before junction.'][index]}));
const checks=[
  {requirementId:'object',kind:'object',scriptQuote:'car',required:'car',match:true,evidence:'A white car is visible.'},
  {requirementId:'action',kind:'action',scriptQuote:'brakes',required:'braking',match:true,evidence:'The same car slows to a stop.',temporalEvidence:{startState:'Approaching junction.',endState:'Stopped before junction.',changed:true,sameSubject:true,observations}},
  {requirementId:'surface',kind:'condition',scriptQuote:'wet asphalt',required:'wet asphalt',match:true,evidence:'Water reflects in the road.'},
  {requirementId:'location',kind:'condition',scriptQuote:'before an intersection',required:'before intersection',match:true,evidence:'Car stops before a visible junction.'},
];
const evidence=()=>({version:1,scriptText,checks:structuredClone(checks)});
const frozen=documentaryScriptRequirements({version:1,scriptText,checks:checks.map(check=>({id:check.requirementId,kind:check.kind,scriptQuote:check.scriptQuote,required:check.required})),nonVisual:[]},scriptText)!;

test('final review must answer the immutable pre-search requirements independently',()=>{
  assert.ok(frozen);
  assert.equal(documentaryScriptEvidenceIssue(evidence() as any,true,[.1,2,4],frozen),undefined);
  for(const tamper of [
    (data:any)=>{data.checks=[{...data.checks[0],scriptQuote:scriptText,required:scriptText}];},
    (data:any)=>{data.checks[1].kind='object';delete data.checks[1].temporalEvidence;},
    (data:any)=>{data.checks[2].required='dry asphalt';},
    (data:any)=>{data.checks[2].requirementId='action';},
    (data:any)=>{data.checks.splice(2,1);data.nonVisual=[{scriptQuote:'wet asphalt',reason:'Unnecessary scene detail'}];},
  ]){const data=evidence();tamper(data);assert.ok(documentaryScriptEvidenceIssue(data as any,true,[.1,2,4],frozen));}
});

test('a whole sentence disguised as one object cannot prove its action and conditions',()=>{
  const data={version:1,scriptText,checks:[{...checks[0],scriptQuote:scriptText,required:scriptText}]};
  assert.ok(documentaryScriptEvidenceIssue(data as any,true,[.1,2,4]));
  assert.equal(documentaryScriptRequirements({...data,checks:data.checks.map(check=>({...check,id:'object'})),nonVisual:[]},scriptText),undefined);
});
test('string changed=false cannot approve and malformed startState never throws',()=>{
  for(const mutation of [{changed:'false'},{startState:42},{endState:[]},{sameSubject:'true'},{observations:[null]}]){
    const data=evidence();Object.assign(data.checks[1]!.temporalEvidence!,mutation);
    assert.equal(documentaryScriptEvidence({scriptEvidence:data},scriptText),undefined);
    assert.doesNotThrow(()=>documentaryScriptEvidenceIssue(data as any,true,[.1,2,4]));
    assert.ok(documentaryScriptEvidenceIssue(data as any,true,[.1,2,4]));
  }
});
test('malformed refusals cannot crash recovery search',()=>{
  for(const data of [{checks:{}},{checks:[null]},{checks:[{kind:'object',required:42}]},{checks:[{kind:'action',required:[],match:false}]}])
    assert.deepEqual(documentaryRecoveryQueries({scriptEvidence:data,nextSearchQueries:['car wet road']}),['car wet road']);
});

test('frozen physical conditions guide the first search before broad legacy topic queries',()=>{
  const requirement={text:scriptText,scriptRequirements:frozen,queries:['car traffic road'],entities:['car'],years:[]};
  for(const queries of [documentarySearchQueries(requirement),documentaryStockQueries(requirement)]){
    assert.match(queries[0]!,/braking/);assert.match(queries[0]!,/wet asphalt/);assert.match(queries[0]!,/before intersection/);
  }
  const data=evidence();data.checks[2]!.match=false;
  assert.equal(documentaryRecoveryQueries({scriptEvidence:data,nextSearchQueries:['car braking wet junction']})[0],'car braking wet junction');
});

test('a partial saved script plan repairs only its missing requirements once, including after restart',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-frozen-plan-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const dir=join(root,'Documentary','Analysis');await mkdir(dir,{recursive:true});
  const scene={id:'s',order:0,narration:scriptText,documentary:{requirement:{text:scriptText,entities:[],years:[],queries:['car']}}} as unknown as Scene;
  const project={id:'p',scenes:[scene]} as Project;
  await writeFile(join(dir,'a'.repeat(64)+'.json'),JSON.stringify({state:'complete',purpose:'script-requirements',result:{scenes:[{
    id:'s',scriptRequirements:{...frozen,checks:frozen.checks.slice(0,2)}
  }]}}));
  let calls=0;
  const client={configured:async()=>true,documentaryCompletion:async(_system:string,input:string)=>{
    calls++;const value=JSON.parse(input);assert.match(value.scenes[0].validationError,/wet/);
    assert.equal(value.scenes[0].narration,scriptText);assert.equal(value.scenes[0].candidates,undefined);
    return JSON.stringify({scenes:[{id:'s',scriptRequirements:frozen}]});
  }};
  for(let i=0;i<2;i++){
    const intel=new DocumentaryIntelligence(client,()=>root);let saved=0;
    await intel.resolveScriptRequirements(project,[scene],async plan=>{assert.deepEqual(plan.get('s')?.scriptRequirements,frozen);saved+=plan.size;});
    assert.equal(saved,1);
  }
  assert.equal(calls,1);
});
