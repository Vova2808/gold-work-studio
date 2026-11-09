import test from 'node:test';
import assert from 'node:assert/strict';
import type {Scene,DocumentaryCandidate} from '@gold-work/shared';
import {documentaryMaterialMetadataIssue} from './documentary-material-metadata.js';
const scene=(quote:string)=>({narration:'A robot cuts an '+quote+'.',documentary:{requirement:{scriptRequirements:{version:1,
 scriptText:'A robot cuts an '+quote+'.',checks:[{id:'part',kind:'object',scriptQuote:quote,required:quote}],nonVisual:[]}}}} as unknown as Scene);
const source=(title:string)=>({title,description:'',previousFrameSearchHint:''} as DocumentaryCandidate);
test('literal aluminium/steel workpiece conflict from actual 220 is refused without treating generic metadata as proof',()=>{
 assert.match(documentaryMaterialMetadataIssue(scene('aluminium body component'),source('machine cutting steel plate'))!,/противоречит/);
 assert.match(documentaryMaterialMetadataIssue(scene('steel plate'),source('cutting an aluminum sheet'))!,/противоречит/);
 for(const title of ['machine cutting metal plate','aluminium plate cutting','steel and aluminium plates',
  'cutting aluminium plate beside a steel tool','not a steel plate','cutting a non-steel plate',
  'cutting a non‑steel plate','cutting a non–steel plate','steel car with aluminium wheels'])
  assert.equal(documentaryMaterialMetadataIssue(scene('aluminium body component'),source(title)),undefined,title);
 for(const title of ['cutting a non-aluminium sheet','cutting a non‑aluminum panel','cutting a non–aluminium plate'])
  assert.equal(documentaryMaterialMetadataIssue(scene('steel plate'),source(title)),undefined,title);
});
test('comparisons, thematic mode, generated hints and other component categories cannot create a material contradiction',()=>{
 const comparison=scene('aluminium and steel body samples');assert.equal(documentaryMaterialMetadataIssue(comparison,source('steel sample')),undefined);
 assert.equal(documentaryMaterialMetadataIssue(comparison,source('aluminium plate')),undefined);
 const thematic=scene('aluminium plate');thematic.documentary!.requirement.scriptRequirements!.mode='thematic';
 assert.equal(documentaryMaterialMetadataIssue(thematic,source('steel plate')),undefined);
 const hintOnly=source('metal plate');hintOnly.description='Generated claim: steel plate';hintOnly.previousFrameSearchHint='steel plate';hintOnly.query='steel plate';
 assert.equal(documentaryMaterialMetadataIssue(scene('aluminium body component'),hintOnly),undefined);
 assert.equal(documentaryMaterialMetadataIssue(scene('steel tool'),source('aluminium plate')),undefined);
});
test('literal Russian workpiece qualifiers keep the same narrow original-title boundary',()=>{
 const sample=scene('алюминиевую кузовную деталь');sample.narration='Робот режет алюминиевую кузовную деталь.';
 assert.match(documentaryMaterialMetadataIssue(sample,source('Резка стальной пластины'))!,/противоречит/);
 assert.equal(documentaryMaterialMetadataIssue(sample,source('Не стальная пластина')),undefined);
 assert.equal(documentaryMaterialMetadataIssue(sample,source('Не-стальная пластина')),undefined);
});
