import test from 'node:test';
import assert from 'node:assert/strict';
import {fastDocumentaryCandidateMetadataIssue,fastDocumentaryCandidateScore,type FastDocumentaryScenePlan} from './documentary-fast-plan.js';

test('AI technical target rejects the observed race-car caption before paying for pixels',()=>{
  const plan:FastDocumentaryScenePlan={aiPlanned:true,visualTarget:'crossplane crankshaft with crankpins at ninety degrees',
    queries:['Yamaha crossplane crankshaft ninety degree crankpins'],preferredKind:'image',sourcePolicy:'specific'};
  const before=JSON.stringify(plan);
  assert.match(fastDocumentaryCandidateMetadataIssue(plan,{provider:'pexels',title:'Black race car preparing at an outdoor racing event with spectators in the background.',description:''})!,/crankshaft/);
  assert.equal(fastDocumentaryCandidateMetadataIssue(plan,{provider:'commons',title:'Crossplane crankshaft with ninety-degree crankpins',description:'Technical drawing'}),undefined);
  assert.equal(JSON.stringify(plan),before,'A free filter never rewrites the goal or queries');
});

test('AI thematic motorcycle reserve does not inherit an exact crankshaft requirement',()=>{
  const reserve:FastDocumentaryScenePlan={aiPlanned:true,visualTarget:'motorcycle racing on a circuit',queries:['motorcycle racing circuit'],preferredKind:'video',sourcePolicy:'background'};
  assert.equal(fastDocumentaryCandidateMetadataIssue(reserve,{provider:'pexels',title:'Dynamic motorcycle racing on circuit track',description:''}),undefined);
  assert.ok(fastDocumentaryCandidateScore(reserve,{title:'Dynamic motorcycle racing on circuit track',description:''})>0);
});

test('unrelated rich stock captions do not consume an exact named-target review on generic joiner words',()=>{
  const plan:FastDocumentaryScenePlan={aiPlanned:true,visualTarget:'Valentino Rossi demonstrating precise throttle control and cornering on Yamaha M1',
    queries:['Valentino Rossi Yamaha 2004 riding style'],preferredKind:'video',sourcePolicy:'specific'};
  assert.ok(fastDocumentaryCandidateMetadataIssue(plan,{provider:'pixabay',title:'People riding bicycles and cycling on a path',description:'Outdoor cycling and a path'}));
  assert.equal(fastDocumentaryCandidateMetadataIssue(plan,{provider:'commons',title:'Rossi Yamaha M1 2004 at a circuit',description:''}),undefined);
});
