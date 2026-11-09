import assert from 'node:assert/strict';
import test from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import type {DocumentaryCandidate} from '@gold-work/shared';
import {discoverDocumentaryQueryLanes} from './documentary-query-lanes.js';
import {selectSimpleDocumentaryCandidates} from './documentary-project-service.js';

const query='Suez Canal route versus Cape of Good Hope map';
const candidate=(id:string,title:string):DocumentaryCandidate=>({id,title,description:title,query,provider:'pexels',kind:'image',
 pageUrl:`https://example.org/${id}`,downloadUrl:`https://example.org/${id}.jpg`,author:'',attribution:'',license:'CC0',licenseUrl:'',rights:'public-domain',
 retrievedAt:'2026-11-08T21:33:46.052Z',match:'unverified',concerns:[]});
const sign=candidate('pexels:38235268','Wooden sign at Cape of Good Hope, the most south-western point of Africa, with rocky coastline.');
const map=candidate('pexels:7634698','World map with wooden ship markers symbolizing travel and exploration laid on a table.');

test('a real scene-6 map gets a preparation slot before the geographical sign without raising the attempt limit',async()=>{
 const batches=discoverDocumentaryQueryLanes({lanes:[{provider:'pexels',queries:[query]}],searchMs:100,stopped:()=>false,discover:async()=>[sign,map]});
 const first=await batches.next();
 assert.equal(selectSimpleDocumentaryCandidates(first.value??[])[0]?.id,map.id);
 assert.deepEqual(batches.takeReady(),[],'A ready drain must not put the deferred sign back ahead of the map before preparation');
 assert.deepEqual((await batches.next()).value,[sign],'The alternative is retained if the first subject batch is rejected');
 await batches.return(undefined);
});

test('a sparse map result or an OR alternative without a captioned map is never discarded',async()=>{
 const sparse=candidate('sparse','Archive plate 1869');
 const batches=discoverDocumentaryQueryLanes({lanes:[{provider:'archive',queries:[query]}],searchMs:100,stopped:()=>false,discover:async()=>[sparse,sign]});
 assert.deepEqual((await batches.next()).value,[sparse,sign]);
 await batches.return(undefined);
});

test('queries without an explicit map/globe retain their ordinary batch',async()=>{
 const batches=discoverDocumentaryQueryLanes({lanes:[{provider:'source',queries:['Cape of Good Hope coast']}],searchMs:100,stopped:()=>false,discover:async()=>[sign,map]});
 assert.deepEqual((await batches.next()).value,[sign,map]);
 await batches.return(undefined);
});

test('maps settling during an earlier inspection compete before deferred landmarks in the ready drain',async()=>{
 let release!:()=>void;const ready=new Promise<void>(resolve=>{release=resolve;});
 const old=candidate('old','Modern cargo ships');
 const batches=discoverDocumentaryQueryLanes({lanes:[{provider:'local',queries:[query]},{provider:'pexels',queries:[query]}],searchMs:1000,stopped:()=>false,
  discover:async(_query,provider)=>{if(provider==='local')return [old];await ready;return [sign,map];}});
 assert.deepEqual((await batches.next()).value,[old]);
 release();await delay(0);
 assert.deepEqual(batches.takeReady(),[map]);
 assert.deepEqual(batches.takeReady(),[]);
 assert.deepEqual((await batches.next()).value,[sign]);
 await batches.return(undefined);
});

test('Stop discards the deferred alternative too',async()=>{
 const controller=new AbortController();
 const batches=discoverDocumentaryQueryLanes({lanes:[{provider:'source',queries:[query]}],searchMs:100,signal:controller.signal,stopped:()=>false,discover:async()=>[sign,map]});
 assert.deepEqual((await batches.next()).value,[map]);controller.abort();
 assert.equal((await batches.next()).done,true);assert.deepEqual(batches.takeReady(),[]);
});
