import assert from 'node:assert/strict';
import test from 'node:test';
import {documentaryScriptRequirements,documentaryScriptEvidenceIssue} from './documentary-script-evidence.js';

function objectPlan(text:string,required=text){
 return {version:1 as const,scriptText:text,checks:[{id:'part',kind:'object' as const,scriptQuote:text,required}],nonVisual:[]};
}
function evidence(plan:ReturnType<typeof objectPlan>){
 return {version:1 as const,scriptText:plan.scriptText,checks:plan.checks.map(check=>({...check,requirementId:check.id,match:true,evidence:'The specified component is visible.'}))};
}

test('brake component and diagram nouns are valid static requirements without invented temporal proof',()=>{
 for(const text of ['Hydraulic brake components','Brake test roller','Regenerative braking energy flow','Truck air-brake system','Brake pads','Braking zones','Rear brake caliper','Brake lights']){
  const plan=objectPlan(text);
  assert.ok(documentaryScriptRequirements(plan,text),text);
  assert.equal(documentaryScriptEvidenceIssue(evidence(plan),false,undefined,plan),undefined,text);
 }
});

test('an independent braking action remains temporal even beside a brake component noun',()=>{
 for(const required of ['The car brakes before the braking zones','The car is braking near brake lights','Brake disc and braking','Brake test roller brakes']){
  const plan=objectPlan(required);
  assert.equal(documentaryScriptRequirements(plan,required),undefined,required);
  assert.match(documentaryScriptEvidenceIssue(evidence(plan),false)!,/изменение действия/,required);
 }
 // Renaming an original braking verb as a component cannot hide the action.
 const disguised=objectPlan('The car brakes','Brake lights');
 assert.equal(documentaryScriptRequirements(disguised,disguised.scriptText),undefined);
 assert.match(documentaryScriptEvidenceIssue(evidence(disguised),false)!,/изменение действия/);
});

test('explicit actions and other temporal descriptions keep their existing proof requirements',()=>{
 const text='Brake pedal';const plan={...objectPlan(text),checks:[...objectPlan(text).checks,{id:'motion',kind:'action' as const,scriptQuote:text,required:text}]};
 assert.ok(documentaryScriptRequirements(plan,text));
 const actionEvidence={version:1 as const,scriptText:text,checks:plan.checks.map(check=>({...check,requirementId:check.id,match:true,evidence:'The specified component is visible.'}))};
 assert.match(documentaryScriptEvidenceIssue(actionEvidence,false,undefined,plan)!,/изменение действия/);
 assert.match(documentaryScriptEvidenceIssue(actionEvidence,true,[.1,2,4],plan)!,/изменение действия/);
 for(const required of ['Brake disc opening','Brake pads accelerating','Closing brake system']){
  assert.equal(documentaryScriptRequirements(objectPlan(required),required),undefined,required);
 }
});
