import test from 'node:test';
import assert from 'node:assert/strict';
import type {DocumentaryMotionGraphic,Scene} from '@gold-work/shared';
import {documentaryDiagram,groundedDocumentaryRatioGroups} from './documentary-diagram-plan.js';

const draw=(narration:string,value:string,origin:'manual'|'automatic'='automatic')=>documentaryDiagram({narration} as Scene,{kind:'statistic',title:'',value,origin} as DocumentaryMotionGraphic);
test('literal ratios keep their numerator, denominator and conditional object',()=>{
  assert.deepEqual(draw('Only 3 of 8 Mark Two Fords reach the finish.','3 of 8'),{kind:'ratio',amount:3,total:8,label:'3 of 8',object:'car'});
  assert.equal(draw('Only 3 of 8 proposals passed.','3 of 8')?.object,undefined);
  for(const value of ['9 of 8','3 of 0','1966','about 3 of 8'])assert.equal(draw(value,value),undefined);
  assert.equal(draw('3 of 8 cars','3 of 8','manual'),undefined);
  assert.equal(draw('Only 0 of 8 proposals passed.','0 of 8')?.amount,0);
  assert.equal(draw('It won 14 of 16 races.','14 of 16 races')?.total,16);
  assert.equal(draw('It won 14 of 16 races.','15 of 16 races'),undefined,'numbers must occur in the narration');
  const narration='Honda had won 29 of the previous 32 Grand Prix races.';
  const keyPoint={kind:'key-point',title:'29 of the previous 32 Grand Prix races',origin:'automatic'} as DocumentaryMotionGraphic;
  assert.deepEqual(documentaryDiagram({narration} as Scene,keyPoint),{kind:'ratio',amount:29,total:32,label:keyPoint.title,object:undefined});
  assert.equal(draw('3 of 61 proposals passed.','3 of 61 proposals'),undefined);
});
test('schematics require literal dimensions, duration or cylinder count',()=>{
  assert.equal(draw('Its height was just 40 inches.','40 inches')?.kind,'measure');
  assert.equal(draw('It travelled 40 inches.','40 inches'),undefined);
  assert.equal(draw('The Mark Two used a 7-litre V8.','7-litre')?.total,8);
  assert.equal(draw('It used a 7-litre engine.','7-litre'),undefined);
  assert.equal(draw('Survive all 24 hours.','24 hours')?.amount,24);
  assert.equal(draw('It lasted 48 hours.','48 hours'),undefined);
  assert.deepEqual(draw('Its RC211V was a 990cc V5 built for MotoGP.','990cc V5'),{kind:'engine',amount:990,total:5,label:'990cc V5',unit:'V5'});
  assert.equal(draw('Its 990cc engine was built for MotoGP.','990cc'),undefined,'capacity alone never supplies a cylinder count');
  assert.equal(draw('It used a 3-litre V10.','3-litre')?.total,10);
});
test('one trophy per year requires an exact matching contiguous count',()=>{
  assert.equal(draw('Ford answered with 4, from 1966 through 1969.','4')?.kind,'period');
  assert.equal(draw('He was 47. Ferrari had won 6 consecutive Le Mans races, from 1960 through 1965.','47'),undefined);
  assert.equal(draw('Ferrari had won 6 consecutive Le Mans races, from 1960 through 1965.','6 consecutive Le Mans races')?.amount,6);
  assert.equal(draw('Ford answered with 3, from 1966 through 1969.','3'),undefined);
});

test('a time gap represents a narrated interval between events, not distance on footage',()=>{
  assert.deepEqual(draw('He held on to win by just 0.210 seconds.','0.210 seconds'),{kind:'time-gap',amount:.21,label:'0.210 seconds'});
  assert.deepEqual(draw('The second signal arrived 25 milliseconds later.','25 milliseconds'),{kind:'time-gap',amount:.025,label:'25 milliseconds'});
  assert.equal(draw('Разница составила 1,5 секунды.','1,5 секунды')?.amount,1.5);
  assert.deepEqual(draw('He won by more than five seconds.','more than five seconds'),{kind:'time-gap',amount:5,label:'more than five seconds'});
  assert.equal(draw('Разница — менее пяти секунд.','менее пяти секунд'),undefined,'unknown word inflection must not invent a value');
  assert.equal(draw('The device runs for 25 seconds.','25 seconds'),undefined);
  assert.equal(draw('He was faster by 10 metres.','10 metres'),undefined);
  assert.equal(draw('The signal arrived 25 milliseconds later.','24 milliseconds'),undefined);
});

test('ratio groups partition a grounded numerator and derive only its arithmetic remainders',()=>{
  const narration='In 2002, it won 14 of 16 races. Rossi took eleven victories, but other Honda riders won too.';
  const groups=[{amount:11,label:'Rossi',sourceQuote:'Rossi took eleven victories'},
    {amount:3,label:'other Honda riders',sourceQuote:'other Honda riders won too'},
    {amount:2,label:'other',sourceQuote:'14 of 16 races'}];
  const scene={narration,documentary:{semanticMontage:{composition:{kind:'statistic',ratioGroups:groups}}}} as unknown as Scene;
  const graphic={kind:'statistic',value:'14 of 16 races',origin:'automatic'} as DocumentaryMotionGraphic;
  assert.deepEqual(documentaryDiagram(scene,graphic)?.groups,groups,'existing semantic composition reaches the local diagram planner');
  assert.deepEqual(groundedDocumentaryRatioGroups(groups,narration,14,16,'14 of 16 races'),groups);
  for(const invalid of [
    groups.map((g,i)=>i===1?{...g,amount:4}:g),
    groups.map((g,i)=>i===0?{...g,amount:10}:i===1?{...g,amount:4}:g),
    groups.map((g,i)=>i===1?{...g,sourceQuote:'Another brand won three races'}:g),
    groups.map((g,i)=>i===1?{...g,label:'invented manufacturer'}:g),
    groups.map((g,i)=>i===0?{...g,sourceQuote:'other Honda riders won too'}:g),
    groups.map((g,i)=>i===2?{...g,sourceQuote:'other Honda riders won too'}:g),
    [...groups,{amount:0,label:'races',sourceQuote:'14 of 16 races'}],
  ])assert.equal(groundedDocumentaryRatioGroups(invalid,narration,14,16,'14 of 16 races'),undefined);
  const bad=groups.map((g,i)=>i===1?{...g,amount:4}:g);
  assert.equal(documentaryDiagram(scene,{...graphic,ratioGroups:bad})?.groups,undefined,'invalid direction keeps the literal ratio without inventing a split');
  assert.equal(documentaryDiagram(scene,{...graphic,origin:'manual'}),undefined,'manual graphics are not replanned');
});

test('ratio grouping is topic-independent and supports two groups, zero remainder, and compound spoken numbers',()=>{
  const narration='The archive retained 23 of 23 documents. The first collection supplied twenty-one documents; the second collection supplied the rest.';
  const groups=[{amount:21,label:'first collection',sourceQuote:'The first collection supplied twenty-one documents'},
    {amount:2,label:'second collection',sourceQuote:'the second collection supplied the rest'},
    {amount:0,label:'documents',sourceQuote:'23 of 23 documents'}];
  assert.deepEqual(groundedDocumentaryRatioGroups(groups,narration,23,23,'23 of 23 documents'),groups);
  const simple=[{amount:23,label:'archive',sourceQuote:'The archive retained 23 of 23 documents'},groups[2]!];
  assert.deepEqual(groundedDocumentaryRatioGroups(simple,narration,23,23,'23 of 23 documents'),simple);
});
