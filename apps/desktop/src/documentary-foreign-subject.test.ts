import assert from 'node:assert/strict';
import test from 'node:test';
import type {DocumentaryCandidate} from '@gold-work/shared';
import {DocumentarySearch} from './documentary-search.js';

// Captions and the queries that actually downloaded these files in full-clean-02.
const failures=[
 ['pexels:6073478','a crab on the wooden boardwalk','Cutty Sark lower deck wooden planking'],
 ['pexels:4061847','inside the bread toaster','Cutty Sark Greenwich cargo hold interior'],
 ['pexels:9345861','a view of a narrow alleyway on a street','Cutty Sark Greenwich cargo hold interior'],
 ['pixabay:51016','cockpit pilot steering wheel aircraft flying airport aviation jet travel traffic panorama nature','tall ship helmsman steering wheel'],
];
const candidate=(id:string,title:string,description=title):DocumentaryCandidate=>({id,title,description,provider:'local',kind:'video',
 pageUrl:'https://example.org/source',downloadUrl:'https://example.org/source.mp4',author:'',attribution:'',license:'CC0',licenseUrl:'',rights:'public-domain',
 query:'',retrievedAt:'2026-11-08T00:00:00Z',match:'unverified',concerns:[]});
for(const [id,title,query] of failures)test(`the actual foreign caption ${id} does not reach the preparation pool`,async()=>{
 const source=candidate(id!,title!);
 const search=new DocumentarySearch(undefined,async()=>{throw Error('No live network');},undefined,async()=>[source],undefined,{search:async()=>[source]});
 for(const provider of ['web','local'] as const){
  const result=await search.search({query:query!,kind:'video',providers:[provider]},true,undefined,true);
  assert.deepEqual(result.candidates,[]);
  assert.equal(result.sources[0]?.count,0);
 }
});

test('explicit alternatives, mixed subjects, real historical ships and sparse captions remain eligible',async()=>{
 const controls=[
  ['Ship galley toaster','A toaster aboard a historic ship','ship galley interior'],
  ['Crab fishing boat','Crew hauling crab pots aboard a fishing vessel','ship deck crew'],
  ['Historic dry dock alleyway','An alleyway beside the clipper hull','ship hull dry dock'],
  ['Aircraft cockpit beside a sailing ship','Naval aviation archive','ship and aircraft archive'],
  ['Aircraft cockpit','Historic cockpit','ship or aircraft cockpit'],
  ['Aircraft cockpit','Historic cockpit','ship aircraft cockpit'],
  ['Crab on a boardwalk','Coastal wildlife','ship deck or crab on boardwalk'],
  ['Archive reel 1869','','ship hull historic'],
  ['Interior framing','Wooden planks and iron framing','ship cargo hold interior'],
  ['HMS Victory hull','Historic drawing of the ship hull','ship hull historic'],
  ['Endeavour cockpit','Historical cockpit view','ship helm steering wheel'],
  ['Yacht cockpit','Cockpit view','ship helm steering wheel'],
  ['Lower deck alleyway','Historic interior','ship cargo hold interior'],
  ['Crab winch','Historic equipment','ship deck equipment'],
  ['Narrow alleyway','Historic city street','historic city alleyway'],
 ];
 for(const [title,description,query] of controls){
  const source=candidate('control',title!,description!);
  const search=new DocumentarySearch(undefined,undefined,undefined,async()=>[source]);
  assert.deepEqual((await search.search({query:query!,kind:'video',providers:['local']})).candidates.map(c=>c.id),['control'],query);
 }
});
