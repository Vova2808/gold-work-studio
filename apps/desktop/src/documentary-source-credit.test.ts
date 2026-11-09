import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {DocumentaryCandidate} from '@gold-work/shared';
import {DocumentarySearch} from './documentary-search.js';

// Actual full-clean-02 Commons candidate and its production-credit paragraph.
const source:DocumentaryCandidate={id:'commons:66942094',provider:'commons',kind:'video',
 title:"KEN THE 390 × SMOKIN' IN THE BOYS ROOM - Blue Fire (Official Video).webm",
 description:'Music Videoも町田の映像チーム「CUTTY SARK STUDIO」によって制作され、町田各所での撮影を敢行。選手のトレーニング姿や、熱狂するサポーターの様子も収録され、FC町田ゼルビアが掲げる「ALL POWER MACHIDA」を体現する必見の仕上がりとなっている。',
 pageUrl:'https://commons.wikimedia.org/wiki/File:KEN_THE_390_%C3%97_SMOKIN%27_IN_THE_BOYS_ROOM_-_Blue_Fire_(Official_Video).webm',
 downloadUrl:'https://upload.wikimedia.org/wikipedia/commons/2/26/KEN_THE_390_%C3%97_SMOKIN%27_IN_THE_BOYS_ROOM_-_Blue_Fire_%28Official_Video%29.webm',
 author:'',attribution:'',license:'CC BY 3.0',licenseUrl:'https://creativecommons.org/licenses/by/3.0',
 query:'Cutty Sark Greenwich hull bow exterior',retrievedAt:'2026-11-08T21:11:14.800Z',match:'unverified',rights:'licensed',concerns:[]};
const plans=[
 {query:'Cutty Sark Greenwich hull bow exterior',entities:['Cutty Sark launch at Dumbarton, Scotland, 1869']},
 {query:'Cutty Sark Greenwich masts rigging',entities:['Cutty Sark tea clipper']},
];
for(const [index,plan] of plans.entries())test(`scene ${index+1} does not send the real studio-credit namesake to download or vision`,async()=>{
 const search=new DocumentarySearch(undefined,async()=>{throw Error('No network');},undefined,async()=>[{...source,id:'local:saved-file',provider:'local'}],undefined,
  {search:async()=>[source]});
 for(const providers of [['web'],['local']] as const){
  const result=await search.search({...plan,kind:'video',providers:[...providers]},true,undefined,true);
  assert.deepEqual(result.candidates,[],'The production search boundary must return no candidate for preparation');
  assert.equal(result.sources[0]?.count,0);
 }
});

test('a raw discovery disk-cache hit cannot restore a credit-only candidate to preparation',async t=>{
 const root=await mkdtemp(join(tmpdir(),'gws-credit-only-'));t.after(()=>rm(root,{recursive:true,force:true}));let calls=0;
 const search=new DocumentarySearch(undefined,undefined,root,undefined,undefined,{search:async()=>{calls++;return [source];}});
 for(let attempt=0;attempt<2;attempt++)
  assert.deepEqual((await search.search({...plans[0]!,kind:'video',providers:['web']})).candidates,[]);
 assert.equal(calls,1,'Second discovery reads the cached raw response and must still apply the gate');
});

test('production credits retain real subject titles, subject descriptions and explicit studio tasks',async()=>{
 const subjects=[
  {...source,id:'title',title:'Cutty Sark under sail',description:'Produced by Cutty Sark Studio.'},
  {...source,id:'caption',title:'Maritime documentary',description:'The Cutty Sark at Greenwich. Produced by Cutty Sark Studio.'},
  {...source,id:'ship',title:'Preserved clipper ship hull and rigging',description:source.description},
 ];
 for(const candidate of subjects){
  const search=new DocumentarySearch(undefined,undefined,undefined,async()=>[candidate]);
  const result=await search.search({...plans[0]!,kind:'video',providers:['local']});
  assert.deepEqual(result.candidates.map(x=>x.id),[candidate.id]);
 }
 const studio=new DocumentarySearch(undefined,undefined,undefined,async()=>[source]);
 assert.equal((await studio.search({query:'Cutty Sark Studio music video',kind:'video',providers:['local']})).candidates.length,1);
});

test('credit filtering uses requested words rather than a particular name, provider or candidate ID',async()=>{
 const bad={...source,id:'different',title:'Music performance',description:'Produced by Northern Light Productions.'};
 const search=new DocumentarySearch(undefined,undefined,undefined,async()=>[bad]);
 assert.equal((await search.search({query:'Northern Light ship hull',entities:['Northern Light'],kind:'video',providers:['local']})).candidates.length,0);
 const creditTitle=new DocumentarySearch(undefined,undefined,undefined,async()=>[{...bad,title:'Northern Light Productions music performance'}]);
 assert.equal((await creditTitle.search({query:'Northern Light ship hull',kind:'video',providers:['local']})).candidates.length,0);
 const sparse=new DocumentarySearch(undefined,undefined,undefined,async()=>[{...bad,title:'Archive reel',description:''}]);
 assert.equal((await sparse.search({query:'Northern Light ship hull',kind:'video',providers:['local']})).candidates.length,1);
});
