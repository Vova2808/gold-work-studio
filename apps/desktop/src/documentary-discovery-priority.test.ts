import assert from 'node:assert/strict';
import test from 'node:test';
import type {DocumentaryCandidate,DocumentaryRequirement} from '@gold-work/shared';
import {documentarySearchQueries,selectDocumentaryCandidates} from './documentary-project-service.js';
import {documentaryRankingPool} from './documentary-intelligence.js';

test('a literal part query survives inherited model names and reaches semantic ranking before whole vehicles',()=>{
  const requirement={text:'Motion pushes and pulls on the crankshaft.',entities:['Yamaha YZR-M1'],
    identities:[{name:'Yamaha YZR-M1',aliases:['YZR-M1','Yamaha M1']}],years:[],
    queries:['crankshaft diagram engine mechanism','motorcycle crankshaft closeup photo','engine crankshaft rotation diagram']} as DocumentaryRequirement;
  const queries=documentarySearchQueries(requirement,'image');
  assert.equal(queries.length,4,'Keep the existing per-lane query bound');
  assert.ok(queries.includes(requirement.queries[0]!),'Do not replace every precise query by model-name discovery');
  const diagram={id:'part',provider:'commons',kind:'image',title:'Crankshaft diagram',description:'Engine mechanism showing crankpins',
    pageUrl:'https://example.test/part',downloadUrl:'https://example.test/part.jpg',author:'Fixture',license:'CC BY',licenseUrl:'https://example.test/license',
    attribution:'Fixture',retrievedAt:'2026-10-02T00:00:00Z',rights:'licensed',concerns:[],query:requirement.queries[0]!,match:'unverified',width:1600,height:900} as DocumentaryCandidate;
  const wholeBikes=Array.from({length:50},(_,i)=>({...diagram,id:`bike-${i}`,pageUrl:`https://example.test/bike-${i}`,downloadUrl:`https://example.test/bike-${i}.jpg`,
    title:'Yamaha YZR-M1 motorcycle',description:'A complete racing motorcycle',query:'Yamaha YZR-M1',match:'exact-metadata' as const}));
  const selected=selectDocumentaryCandidates([...wholeBikes,diagram],requirement.entities,new Set(),[],true,queries,requirement);
  assert.ok(documentaryRankingPool(selected).some(c=>c.id===diagram.id),'A relevant part must not disappear outside the 40-item paid shortlist');
  assert.equal(selected[0]!.id,diagram.id);
  assert.equal(selected[0]!.match,'unverified','Admission never establishes model identity or approves the image');
  assert.equal(selectDocumentaryCandidates([diagram],requirement.entities,new Set(),[],false,queries,requirement).length,0,'No semantic checker means no widened admission');
  assert.equal(selectDocumentaryCandidates([{...diagram,rights:'unknown'}],requirement.entities,new Set(),[],true,queries,requirement).length,0);
});

test('source year agreement precedes a stronger name match without approving either candidate',()=>{
  const base={provider:'commons',kind:'image',description:'',rights:'licensed',concerns:[],query:'Rossi Honda 2002',match:'unverified'} as unknown as DocumentaryCandidate;
  const candidates=[{...base,id:'later',pageUrl:'https://example.test/later',title:'Valentino Rossi 2015',match:'exact-metadata' as const},
    {...base,id:'period',pageUrl:'https://example.test/period',title:'Rossi Honda 2002'}];
  const selected=selectDocumentaryCandidates(candidates,['Valentino Rossi'],new Set(),['2002'],true);
  assert.equal(selected[0]!.id,'period');
  assert.equal(selected[0]!.match,'unverified');
});
