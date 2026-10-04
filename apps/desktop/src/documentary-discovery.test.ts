import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as tick} from 'node:timers/promises';
import type {DocumentaryCandidate} from '@gold-work/shared';
import {discoverDocumentarySources,discoverDocumentarySourceBatches} from './documentary-discovery.js';
import {DocumentarySearch} from './documentary-search.js';
import {DocumentarySelectionSession} from './documentary-selection-session.js';
import {documentaryFirstImageBatchWorthInspecting} from './documentary-project-service.js';

test('a precise ready source can be inspected and accepted without starting archive or shared discovery',async()=>{
  const calls:string[]=[];
  const batches=discoverDocumentarySourceBatches({kind:'image',queries:['exact subject','alternate subject'],stockQueries:[],youtubeQueries:[],stopped:()=>false,
    discover:async(query,providers)=>{calls.push(`${query}:${providers.join(',')}`);return [{id:'exact'}] as DocumentaryCandidate[];},
    supplement:async()=>{throw Error('Unused shared discovery must not start');}});
  const first=await batches.next();assert.equal(first.value?.[0]?.id,'exact');
  await batches.return(undefined);
  assert.deepEqual(calls,['exact subject:commons']);
});

test('rejection requests full discovery; an empty first source does not end the search',async()=>{
  for(const empty of [false,true]){
    const calls:string[]=[];
    const batches=discoverDocumentarySourceBatches({kind:'video',queries:['precise'],stockQueries:[],youtubeQueries:['precise'],stopped:()=>false,
      discover:async(_query,providers)=>{calls.push(providers.join(','));return providers.length===1&&providers[0]==='youtube'?(empty?[]:[{id:'first'}] as DocumentaryCandidate[]):[{id:'archive'}] as DocumentaryCandidate[];},
      supplement:async()=>[{id:'shared'}] as DocumentaryCandidate[]});
    const found:DocumentaryCandidate[]=[];
    for await(const batch of batches)found.push(...batch);
    assert.ok(found.some(c=>c.id==='archive'));assert.ok(found.some(c=>c.id==='shared'));
    assert.ok(calls.some(c=>c.includes('internet-archive')));
  }
});

test('a weak precise video batch waits for broad results instead of requiring two shortlists',async()=>{
  const calls:string[]=[];
  const batches=discoverDocumentarySourceBatches({kind:'video',queries:['named subject'],stockQueries:[],youtubeQueries:['named subject'],stopped:()=>false,
    firstBatchReady:()=>false,
    discover:async(_query,providers)=>{calls.push(providers.join(','));return [{id:providers.length===1&&providers[0]==='youtube'?'weak':'broad'}] as DocumentaryCandidate[];}});
  const first=await batches.next();
  assert.ok(first.value?.some(candidate=>candidate.id==='weak'));
  assert.ok(first.value?.some(candidate=>candidate.id==='broad'));
  assert.ok(calls.some(call=>call.includes('internet-archive')));
  assert.equal((await batches.next()).done,true);
});

test('near-simultaneous video sources share one shortlist without waiting for a slow archive',async()=>{
  const fast=discoverDocumentarySourceBatches({kind:'video',queries:['precise','broad'],stockQueries:['stock'],youtubeQueries:['precise'],
    coalesceMs:30,stopped:()=>false,firstBatchReady:()=>false,
    discover:async(query,providers)=>[{id:providers.includes('youtube')?'weak':query==='stock'?'stock':'archive'}] as DocumentaryCandidate[]});
  assert.deepEqual((await fast.next()).value?.map(candidate=>candidate.id),['weak','stock','archive']);
  assert.equal((await fast.next()).done,true);

  let release!:()=>void;const slow=new Promise<void>(resolve=>{release=resolve;});const calls:string[]=[];
  const batches=discoverDocumentarySourceBatches({kind:'video',queries:['precise','slow','later'],stockQueries:['stock'],youtubeQueries:['precise'],
    coalesceMs:20,stopped:()=>false,firstBatchReady:()=>false,
    discover:async(query,providers)=>{calls.push(query);if(query==='slow')await slow;return [{id:providers.includes('youtube')?'weak':query}] as DocumentaryCandidate[];}});
  assert.deepEqual((await batches.next()).value?.map(candidate=>candidate.id),['weak','stock']);
  await batches.return(undefined);release();await tick();
  assert.equal(calls.includes('later'),false,'Accepting the fast batch must not dispatch another query wave');
});

test('a simultaneous provider error does not hide a ready video before acceptance',async()=>{
  const make=()=>discoverDocumentarySourceBatches({kind:'video',queries:['precise'],stockQueries:['stock'],youtubeQueries:['precise'],
    coalesceMs:20,stopped:()=>false,firstBatchReady:()=>false,
    discover:async(_query,providers)=>{
      if(providers.includes('internet-archive'))throw Error('Archive unavailable');
      return [{id:providers.includes('youtube')?'weak':'stock'}] as DocumentaryCandidate[];
    }});
  const accepted=make();assert.deepEqual((await accepted.next()).value?.map(candidate=>candidate.id),['weak','stock']);
  await accepted.return(undefined);
  const rejected=make();await rejected.next();await assert.rejects(rejected.next(),/Archive unavailable/);
});

test('a technical photo search waits for the actual named part before paying to rank exteriors',async()=>{
  const exterior={id:'exterior',kind:'image',title:'Yamaha racing motorcycle',description:'Whole bike at a race'} as DocumentaryCandidate;
  const secondExterior={id:'second-exterior',kind:'image',title:'Yamaha YZR-M1 race',description:'Racing motorcycle on track'} as DocumentaryCandidate;
  const diagram={id:'diagram',kind:'image',title:'Piston bielle vilebrequin',description:'Piston, connecting rod and crankshaft cutaway'} as DocumentaryCandidate;
  assert.equal(documentaryFirstImageBatchWorthInspecting([exterior],'connecting-rod'),false);
  assert.equal(documentaryFirstImageBatchWorthInspecting([diagram],'connecting-rod'),true);
  const batches=discoverDocumentarySourceBatches({kind:'image',queries:['MotoGP engine diagram'],stockQueries:[],youtubeQueries:[],stopped:()=>false,
    firstBatchReady:first=>documentaryFirstImageBatchWorthInspecting(first,'connecting-rod'),
    deferredBatchReady:batch=>documentaryFirstImageBatchWorthInspecting(batch,'connecting-rod'),
    discover:async(_query,providers)=>providers.length===1?[exterior]:[secondExterior,diagram]});
  assert.deepEqual((await batches.next()).value?.map(candidate=>candidate.id),['exterior','second-exterior','diagram']);
  assert.equal((await batches.next()).done,true);
});

test('a technical photo search keeps two weak waves for fallback instead of ranking either separately',async()=>{
  const exterior={id:'exterior',kind:'image',title:'Motorcycle exterior'} as DocumentaryCandidate;
  const race={id:'race',kind:'image',title:'Yamaha race'} as DocumentaryCandidate;
  const batches=discoverDocumentarySourceBatches({kind:'image',queries:['engine diagram'],stockQueries:[],youtubeQueries:[],stopped:()=>false,
    firstBatchReady:batch=>documentaryFirstImageBatchWorthInspecting(batch,'connecting-rod'),
    deferredBatchReady:batch=>documentaryFirstImageBatchWorthInspecting(batch,'connecting-rod'),
    discover:async(_query,providers)=>providers.length===1?[exterior]:[race]});
  assert.deepEqual((await batches.next()).value?.map(candidate=>candidate.id),['exterior','race']);
  assert.equal((await batches.next()).done,true);
});

test('fast licensed sources are inspectable before a slow archive finishes; accepting them starts no later wave',async()=>{
  let release!:()=>void;const archive=new Promise<void>(resolve=>{release=resolve;});
  const calls:string[]=[];
  const batches=discoverDocumentarySourceBatches({kind:'image',queries:['precise','archive followup','never'],stockQueries:['stock first','stock later','never'],youtubeQueries:[],stopped:()=>false,
    discover:async(query,providers)=>{
      calls.push(query);
      if(providers.includes('internet-archive')){await archive;return []}
      if(query==='precise')return [];
      return [{id:query}] as DocumentaryCandidate[];
    }});
  const first=await batches.next();
  assert.ok(first.value?.some(candidate=>candidate.id==='stock first'));
  assert.equal(calls.includes('never'),false);
  await batches.return(undefined);
  release();await tick();
  assert.equal(calls.includes('stock later'),true,'first stock wave was already in flight');
  assert.equal(calls.includes('never'),false,'no followup wave after acceptance');
});

test('stop between precise and broad waves dispatches no more network work',async()=>{
  let stopped=false,calls=0;
  const batches=discoverDocumentarySourceBatches({kind:'image',queries:['subject'],stockQueries:[],youtubeQueries:[],stopped:()=>stopped,
    discover:async()=>{calls++;return [{id:'first'}] as DocumentaryCandidate[];}});
  await batches.next();stopped=true;
  assert.equal((await batches.next()).done,true);assert.equal(calls,1);
});

test('slow discovery does not consume inspection time or reset the existing paid-attempt cap',()=>{
  let now=0;const session=new DocumentarySelectionSession(()=>now);
  session.budget('scene','image');now=50_000;session.accountSearch('scene','image',50_000);
  assert.equal(session.remaining('scene','image'),60_000);assert.equal(session.searchRemaining('scene','image'),10_000);
  assert.equal(session.takeAttempt('scene','image'),true);
  now+=12_000;assert.equal(session.remaining('scene','image'),48_000);
  now+=10_000;session.accountSearch('scene','image',10_000);
  assert.equal(session.searchRemaining('scene','image'),0);assert.equal(session.remaining('scene','image'),48_000);
  assert.equal(session.takeAttempt('scene','image'),true);assert.equal(session.takeAttempt('scene','image'),false);
});

test('a slow archive does not delay other source families; results retain checkpoint order',async()=>{
  let release!:()=>void;const archive=new Promise<void>(r=>{release=r;});const started:string[]=[];
  const run=discoverDocumentarySources({queries:['archive1','archive2','archive3'],stockQueries:['stock'],youtubeQueries:['youtube'],stopped:()=>false,
    discover:async query=>{started.push(query);if(query.startsWith('archive'))await archive;return [{id:query}] as DocumentaryCandidate[];}});
  await tick();assert.ok(started.includes('youtube'));assert.ok(started.includes('stock'));assert.ok(!started.includes('archive3'));
  release();assert.deepEqual((await run).map(c=>c.id),['stock','archive1','archive2','archive3','youtube']);
});
test('stop drains running searches and does not dispatch another batch',async()=>{
  let release!:()=>void,stopped=false;const gate=new Promise<void>(r=>{release=r;});let calls=0;
  const run=discoverDocumentarySources({queries:['one','two','three'],stockQueries:[],youtubeQueries:[],stopped:()=>stopped,discover:async()=>{calls++;await gate;return [];}});
  await tick();stopped=true;release();await run;assert.equal(calls,2);
});
test('parallel scene searches share a provider cap and deduplicate identical requests',async()=>{
  let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});let active=0,peak=0,calls=0;
  const search=new DocumentarySearch(undefined,undefined,undefined,undefined,{search:async()=>{calls++;active++;peak=Math.max(peak,active);await gate;active--;return [];}});
  const jobs=Array.from({length:9},(_,i)=>search.search({query:`source ${i}`,kind:'video',providers:['youtube']}));
  jobs.push(search.search({query:'source 0',kind:'video',providers:['youtube']}));
  await tick();assert.equal(calls,4);release();await Promise.all(jobs);assert.equal(calls,9);assert.equal(peak,4);
});
