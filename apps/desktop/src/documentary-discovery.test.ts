import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as tick} from 'node:timers/promises';
import type {DocumentaryCandidate} from '@gold-work/shared';
import {discoverDocumentarySources} from './documentary-discovery.js';
import {DocumentarySearch} from './documentary-search.js';

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
