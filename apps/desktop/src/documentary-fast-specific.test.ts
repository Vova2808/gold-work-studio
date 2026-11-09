import test from 'node:test';
import assert from 'node:assert/strict';
import {fastDocumentarySpecificIssue,planFastDocumentaryScene,fastDocumentaryEvidenceIssue,type FastDocumentaryScenePlan} from './documentary-fast-plan.js';
import type {Project,Scene} from '@gold-work/shared';
test('named pixel verdict cannot be replaced by generic relevance, a namesake, wrong date or action',()=>{
 const plan={namedSubject:'Valentino Rossi'} as FastDocumentaryScenePlan;
 const proof={subject:'Valentino Rossi',identityMatch:true,eraMatch:true,actionMatch:true,evidence:'Visible matching rider and event cues'};
 assert.ok(fastDocumentarySpecificIssue(plan,{relevant:true,evidence:'A motorcycle rider'}));
 for(const change of [{subject:'Rossi furniture'},{identityMatch:false},{eraMatch:false},{actionMatch:false},{evidence:''}])
  assert.ok(fastDocumentarySpecificIssue(plan,{specificEvidence:{...proof,...change}}));
 assert.equal(fastDocumentarySpecificIssue(plan,{specificEvidence:proof}),undefined);
 assert.equal(fastDocumentarySpecificIssue({} as FastDocumentaryScenePlan,{}),undefined);
});
test('generic handlebar area is not evidence of the accelerator',()=>{
 assert.ok(fastDocumentaryEvidenceIssue('motorcycle throttle','visible motorcycle handlebar grip and control assembly representing the throttle area'));
 assert.equal(fastDocumentaryEvidenceIssue('motorcycle throttle','The accelerator twist-grip and throttle cable are visible'),undefined);
});
test('a deictic design explanation retains the internal part rather than the exterior engine',()=>{
 const scenes=["Furusawa's answer was a crossplane crankshaft, with its crankpins arranged at ninety degrees.",
  'The design reduced the interference from those inertial forces and produced a more controllable'].map((narration,id)=>({id:String(id),narration} as Scene));
 assert.match(planFastDocumentaryScene({scenes} as Project,scenes[1]!).visualTarget,/(?:^| )crossplane crankshaft$/);
});
test('filming him retains the preceding named person instead of accepting a later brand exhibition',()=>{
 const scenes=['Valentino Rossi won on Honda.','The documentary Faster captured him at the height of Honda dominance.'].map((narration,id)=>({id:String(id),narration} as Scene));
 const plan=planFastDocumentaryScene({scenes} as Project,scenes[1]!);
 assert.equal(plan.namedSubject,'Valentino Rossi');
 assert.ok(fastDocumentarySpecificIssue(plan,{specificEvidence:{subject:'Honda',identityMatch:true,eraMatch:true,actionMatch:true,evidence:'A red Honda X-ADV at Paris Motor Show 2018'}}));
});
test('a dated named scene needs a literal source quote even if the model asserts eraMatch',()=>{
 const plan={namedSubject:'Valentino Rossi',requiredYears:['2003']} as FastDocumentaryScenePlan;
 const proof={subject:'Valentino Rossi',identityMatch:true,eraMatch:true,actionMatch:true,evidence:'Actual rider cues with provenance'};
 const source={title:'Valentino Rossi at Phillip Island 2003',description:''};
 assert.ok(fastDocumentarySpecificIssue(plan,{specificEvidence:proof},source));
 assert.ok(fastDocumentarySpecificIssue(plan,{specificEvidence:{...proof,eraEvidenceQuote:'Invented event 2003'}},source));
 assert.equal(fastDocumentarySpecificIssue(plan,{specificEvidence:{...proof,eraEvidenceQuote:'Phillip Island 2003'}},source),undefined);
});
