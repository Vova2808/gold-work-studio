import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {DocumentaryCandidate} from '@gold-work/shared';
import {DocumentarySearch} from './documentary-search.js';

const candidate=(provider:DocumentaryCandidate['provider'],kind:'image'|'video'='video'):DocumentaryCandidate=>({
  id:`${provider}:fixture`,provider,kind,title:'Honda RC211V',description:'Test metadata',query:'Honda RC211V',
  pageUrl:`https://example.org/${provider}`,downloadUrl:`https://example.org/${provider}.mp4`,author:'',attribution:'',
  license:'',licenseUrl:'',rights:'unknown',retrievedAt:'2026-10-14T00:00:00Z',match:'unverified',concerns:[],
});

test('default external discovery calls Pexels, Pixabay and public web; local reuse remains available',async()=>{
  const calls:string[]=[];
  const search=new DocumentarySearch({search:async (input:{provider:string})=>{calls.push(input.provider);return {items:[]};}} as never,
    async()=>{throw Error('Legacy HTTP API must not run');},undefined,
    async()=>{calls.push('local');return [candidate('local')];},
    {search:async()=>{throw Error('YouTube Data API must not run');}},
    {search:async()=>{calls.push('web');return [candidate('youtube')];}});
  const result=await search.search({query:'Honda RC211V',kind:'video'});
  assert.deepEqual(calls.sort(),['local','pexels','pixabay','web']);
  assert.deepEqual(result.sources.map(source=>source.provider).sort(),['local','pexels','pixabay','web']);
  assert.ok(result.candidates.some(source=>source.provider==='youtube'&&source.rights==='unknown'));
});

test('legacy choices collapse into one web query without changing candidate provenance or inventing rights',async()=>{
  const calls:string[]=[];
  const search=new DocumentarySearch(undefined,async()=>{throw Error('Legacy HTTP API must not run');},undefined,undefined,
    {search:async()=>{throw Error('YouTube Data API must not run');}},
    {search:async(query,kind)=>{calls.push(query);assert.equal(kind,'image');return [candidate('commons','image')];}});
  const result=await search.search({query:'Honda RC211V 2002',entities:['Honda RC211V'],kind:'image',
    providers:['commons','internet-archive','loc','youtube','web']},true);
  assert.deepEqual(calls,['"Honda RC211V" 2002']);
  assert.deepEqual(result.sources,[{provider:'web',count:1}]);
  assert.equal(result.candidates[0]?.provider,'commons');
  assert.equal(result.candidates[0]?.rights,'unknown');
});

test('web discovery cache survives a new service instance and keeps unknown-rights candidates unconfirmed',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-source-policy-'));t.after(()=>rm(root,{recursive:true,force:true}));
  let calls=0;
  const make=()=>new DocumentarySearch(undefined,undefined,root,undefined,undefined,
    {search:async()=>{calls++;return [candidate('youtube')];}});
  const input={query:'Honda RC211V',kind:'video' as const,providers:['web' as const]};
  await make().search(input);
  const result=await make().search(input);
  assert.equal(calls,1);assert.equal(result.candidates[0]?.rights,'unknown');
});

test('web unavailability is reported while local reuse and stock searches complete',async()=>{
  const search=new DocumentarySearch({search:async()=>({items:[]})} as never,undefined,undefined,
    async()=>[candidate('local')],undefined,{search:async()=>{throw Error('Веб-поиск недоступен: CAPTCHA');}});
  const result=await search.search({query:'Honda RC211V',kind:'video'});
  assert.match(result.sources.find(source=>source.provider==='web')?.error??'',/CAPTCHA/);
  assert.equal(result.candidates[0]?.provider,'local');
  assert.equal(result.sources.filter(source=>!source.error).length,3);
});
