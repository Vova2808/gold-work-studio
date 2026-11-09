import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import type {DocumentaryCandidate} from '@gold-work/shared';
import {discoverDocumentaryQueryLanes} from './documentary-query-lanes.js';
import {selectSimpleDocumentaryCandidates} from './documentary-project-service.js';
import {documentaryCandidateKey} from './documentary-reuse.js';

test('short03 scene6 ready-drain preserves map priority across all three real provider pools',async()=>{
 const data=JSON.parse(await readFile(new URL('./fixtures/short03-map-pools.json',import.meta.url),'utf8')) as {
  query:string;local:DocumentaryCandidate;packages:Array<{provider:string;availableAt:string;candidates:DocumentaryCandidate[]}>};
 const releases=new Map<string,()=>void>();
 const gates=new Map(data.packages.map(row=>[row.provider,new Promise<void>(resolve=>{releases.set(row.provider,resolve);})]));
 const batches=discoverDocumentaryQueryLanes({lanes:[{provider:'local',queries:[data.query]},...data.packages.map(row=>({provider:row.provider,queries:[data.query]}))],
  searchMs:1000,stopped:()=>false,discover:async(_query,provider)=>{
   if(provider==='local')return [data.local];
   await gates.get(provider);return data.packages.find(row=>row.provider===provider)!.candidates;
  }});
 const initial=(await batches.next()).value!;
 assert.deepEqual(initial.map(c=>c.id),['local:60a612a1e02aa1460741a31692bc648ced24675ef03403b15d2dd163ac3bee69']);
 // Preserve the actual availability order: Pixabay 02.192, Pexels 02.409,
 // Commons 04.497, all while the first local photo was being inspected.
 for(const row of data.packages){releases.get(row.provider)!();await delay(0);}
 const ready=batches.takeReady(),tried=new Set(initial.map(documentaryCandidateKey));
 const selected=selectSimpleDocumentaryCandidates([...initial,...ready].filter(c=>!tried.has(documentaryCandidateKey(c))))[0]!;
 const map=/\b(?:maps?|globes?|cartography)\b/i;
 assert.ok(map.test(selected.title+' '+selected.description),`The second bounded preparation slot went to ${selected.id}: ${selected.title}`);
 assert.ok(!ready.some(c=>c.id==='commons:6515473'),'The coast must not re-enter the map shortlist through a map-empty Commons batch');
 assert.ok(ready.length>0);assert.deepEqual(batches.takeReady(),[]);
 const remaining:DocumentaryCandidate[]=[];for await(const batch of batches)remaining.push(...batch);
 const actual=[...initial,...ready,...remaining].map(c=>c.id).sort();
 const expected=[data.local,...data.packages.flatMap(row=>row.candidates)].map(c=>c.id).sort();
 assert.deepEqual(actual,expected,'Every sparse or alternative candidate remains available if the map batch is rejected');
});

test('an explicitly non-map ready lane keeps its alternative alongside the map results',async()=>{
 const data=JSON.parse(await readFile(new URL('./fixtures/short03-map-pools.json',import.meta.url),'utf8')) as {
  query:string;local:DocumentaryCandidate;packages:Array<{provider:string;candidates:DocumentaryCandidate[]}>};
 let release!:()=>void;const ready=new Promise<void>(resolve=>{release=resolve;});
 const batches=discoverDocumentaryQueryLanes({lanes:[{provider:'local',queries:[data.query]},{provider:'pexels',queries:[data.query]},
  {provider:'commons',queries:['Cape of Good Hope coast']}],searchMs:1000,stopped:()=>false,discover:async(_query,provider)=>{
   if(provider==='local')return [data.local];await ready;return data.packages.find(row=>row.provider===provider)!.candidates;
  }});
 await batches.next();release();await delay(0);
 const alternatives=batches.takeReady();
 assert.ok(alternatives.some(c=>c.id==='commons:6515473'),'A separately requested coast is not demoted by another lane asking for maps');
 assert.ok(alternatives.some(c=>/\bmap\b/i.test(c.title)));
 await batches.return(undefined);
});
