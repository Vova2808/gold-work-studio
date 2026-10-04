import assert from 'node:assert/strict';
import test from 'node:test';
import type {DocumentaryCandidate,DocumentaryRequirement} from '@gold-work/shared';
import {documentaryDetailScore,documentarySearchQueries,selectDocumentaryCandidates} from './documentary-project-service.js';
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

test('a long career table does not outrank a focused named-model action clip by incidental description words',()=>{
  const requirement={text:'The Honda was faster on the straight.',entities:['Honda RC211V'],identities:[{name:'Honda RC211V',aliases:[]}],
    years:[],detail:'top speed on the straight',queries:['Honda RC211V racing straight speed 2004']} as DocumentaryRequirement;
  const base={id:'source',provider:'youtube',kind:'video',title:'',description:'',rights:'licensed',concerns:[],
    query:'Honda RC211V racing straight speed 2004',pageUrl:'https://example.test/source',downloadUrl:'https://example.test/video.mp4',
    author:'Fixture',license:'CC BY',licenseUrl:'https://example.test/license',attribution:'Fixture',retrievedAt:'now',match:'exact-metadata'} as DocumentaryCandidate;
  const years=Array.from({length:12},(_,year)=>`${1996+year} season rider motorcycle team race result`).join('\n');
  const broad={...base,id:'career',title:'Motorcycle career from 1996 to 2010',durationSeconds:611,
    description:`${years}\n2002 Honda RC211V: top speed on the straight and racing results. ${'Overview of many different motorcycles. '.repeat(16)}`};
  const focused={...base,id:'focused',pageUrl:'https://example.test/focused',downloadUrl:'https://example.test/focused.mp4',
    title:'Honda RC211 V racing on the straight',durationSeconds:80,description:'Track camera footage.'};
  assert.ok(documentaryDetailScore(focused,requirement)>documentaryDetailScore(broad,requirement));
  const selected=selectDocumentaryCandidates([broad,focused],requirement.entities,new Set(),[],true,[],requirement);
  assert.deepEqual(selected.map(candidate=>candidate.id),['focused','career']);
  assert.ok(selected.includes(broad),'The long source remains available for a real indexed excerpt');
});
