import assert from 'node:assert/strict';
import test from 'node:test';
import type { DocumentaryCandidate } from '@gold-work/shared';
import { DocumentarySearch } from './documentary-search.js';

test('long queries keep their final historical year and continue through other sources', async () => {
  const query = 'Valentino Rossi Yamaha YZR-M1 South African Grand Prix Welkom race winning motorcycle front fairing celebration 2004';
  let stockCalls = 0;
  const webQueries: string[] = [];
  const material:DocumentaryCandidate = {id:'web:rossi',provider:'web',kind:'video',title:'Valentino Rossi Yamaha YZR-M1 Welkom 2004',
    description:'Race footage',rights:'licensed',concerns:[],query,match:'unverified',
    pageUrl:'https://example.test/rossi',downloadUrl:'https://example.test/rossi.mp4',
    author:'Fixture',license:'Fixture license',licenseUrl:'https://example.test/license',
    attribution:'Fixture',retrievedAt:'2026-10-16T00:00:00Z'};
  const search = new DocumentarySearch({search:async()=>{stockCalls++;return {items:[]};}} as never,
    async()=>{throw new Error('Unexpected network call');},undefined,undefined,undefined,
    {search:async value=>{webQueries.push(value);return [material];}});
  const found = await search.search({query,kind:'video',providers:['pexels','pixabay','web']});
  assert.equal(stockCalls,0,'a provider limit must not silently change the query');
  assert.deepEqual(webQueries,[query]);
  assert.equal(found.candidates[0]?.id,material.id);
  for (const provider of ['pexels','pixabay']) assert.match(found.sources.find(source=>source.provider===provider)?.error??'',/100 символов/);
  assert.equal(found.sources.find(source=>source.provider==='web')?.error,undefined);
});

test('a 100-character stock query is sent intact including its final year', async () => {
  const query = `${'Yamaha '.repeat(13)}YZRM 2004`;
  assert.equal(query.length,100);
  const submitted: string[] = [];
  const search = new DocumentarySearch({search:async(input:{query:string})=>{submitted.push(input.query);return {items:[]};}} as never);
  await search.search({query,kind:'video',providers:['pixabay']});
  assert.deepEqual(submitted,[query]);
  assert.ok(submitted[0]?.endsWith('2004'));
});
