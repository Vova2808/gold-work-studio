import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {DocumentaryCandidate} from '@gold-work/shared';
import {DocumentarySearch} from './documentary-search.js';
import {DocumentaryYouTube} from './documentary-youtube.js';

const query='Cutty Sark sailing ship footage';
const input={query,kind:'video' as const,providers:['youtube' as const]};
const publicCandidate:DocumentaryCandidate={id:'youtube:public12345',provider:'youtube',kind:'video',title:'Public ship',description:'',
 pageUrl:'https://www.youtube.com/watch?v=public12345',downloadUrl:'https://www.youtube.com/watch?v=public12345',author:'',attribution:'',
 license:'Условия не подтверждены',licenseUrl:'',rights:'unknown',query,retrievedAt:'2026-11-04T00:00:00Z',match:'unverified',concerns:[],discovery:'public-web'};
const apiCandidate:DocumentaryCandidate={...publicCandidate,id:'youtube:9Evo98NzjuM',title:'Cutty Sark - Cutty Sark 100 Years',
 pageUrl:'https://www.youtube.com/watch?v=9Evo98NzjuM',downloadUrl:'https://www.youtube.com/watch?v=9Evo98NzjuM',
 rights:'licensed',license:'Creative Commons Attribution (YouTube)',discovery:undefined};
const noHttp=async()=>{throw Error('Unexpected HTTP request');};

test('independent YouTube uses the configured Creative Commons API before public metadata',async()=>{
 const calls:string[]=[];
 const youtube=new DocumentaryYouTube({apiKey:async()=>'fixture-key',resolveValidatedCookies:async()=>{throw Error('No cookies in API search');}},async url=>{
  const parsed=new URL(String(url)),resource=parsed.pathname.split('/').at(-1)!;calls.push(resource);
  assert.equal(parsed.searchParams.get('key'),'fixture-key');
  if(resource==='search'){
   assert.equal(parsed.searchParams.get('q'),query);assert.equal(parsed.searchParams.get('videoLicense'),'creativeCommon');
   return Response.json({items:[{id:{videoId:'9Evo98NzjuM'}}]});
  }
  assert.equal(resource,'videos');
  return Response.json({items:[{id:'9Evo98NzjuM',snippet:{title:apiCandidate.title},status:{license:'creativeCommon',privacyStatus:'public'},contentDetails:{duration:'PT1M'}}]});
 });
 const search=new DocumentarySearch(undefined,noHttp,undefined,undefined,youtube,{search:async()=>{calls.push('public');return [publicCandidate];}});
 const result=await search.search(input,true,undefined,true);
 assert.deepEqual(calls,['search','videos']);assert.equal(result.candidates[0]?.id,apiCandidate.id);
 assert.equal(result.candidates[0]?.rights,'licensed');assert.deepEqual(result.sources,[{provider:'youtube',count:1}]);
});

for(const mode of ['missing-key','api-error','empty','missing-adapter'] as const)test(`independent YouTube preserves public fallback on ${mode}`,async()=>{
 let keyReads=0,httpCalls=0,apiCalls=0,publicCalls=0;
 const youtube=mode==='missing-key'?new DocumentaryYouTube({apiKey:async()=>{keyReads++;return undefined;},resolveValidatedCookies:async()=>undefined},
  async()=>{httpCalls++;throw Error('No HTTP without a key');})
  :mode==='missing-adapter'?undefined:{search:async()=>{apiCalls++;if(mode==='api-error')throw Error('YouTube 403: quotaExceeded');return [];}};
 const search=new DocumentarySearch(undefined,noHttp,undefined,undefined,youtube,{
  search:async()=>{throw Error('Source-specific public route required');},
  searchWithSources:async(received,kind,signal,source)=>{
   publicCalls++;assert.equal(received,query);assert.equal(kind,'video');assert.equal(signal,undefined);assert.equal(source,'youtube');
   return {candidates:[publicCandidate],errors:['Fixture public warning']};
  },
 });
 const result=await search.search(input,true,undefined,true);
 assert.equal(publicCalls,1);assert.equal(httpCalls,0);assert.equal(keyReads,mode==='missing-key'?1:0);
 assert.equal(apiCalls,mode==='api-error'||mode==='empty'?1:0);
 assert.equal(result.candidates[0]?.id,publicCandidate.id);assert.equal(result.candidates[0]?.rights,'unknown');
 const warning=result.sources[0]?.error??'';
 assert.match(warning,/Fixture public warning/);
 if(mode==='api-error')assert.match(warning,/YouTube 403: quotaExceeded/);
});

test('YouTube API quota and public failure both remain visible',async()=>{
 const search=new DocumentarySearch(undefined,noHttp,undefined,undefined,{search:async()=>{throw Error('YouTube 429: quotaExceeded');}},
  {search:async()=>[],searchWithSources:async()=>{throw Error('YouTube public timeout');}});
 const result=await search.search(input,true,undefined,true);
 assert.equal(result.candidates.length,0);
 assert.match(result.sources[0]?.error??'',/quotaExceeded.*public timeout/);
});

test('an exhausted API quota does not ban a recovering independent public YouTube route',async()=>{
 let publicCalls=0;
 const search=new DocumentarySearch(undefined,noHttp,undefined,undefined,{search:async()=>{throw Error('YouTube 429: quotaExceeded');}},
  {search:async()=>[],searchWithSources:async()=>{
   publicCalls++;if(publicCalls===1)throw Error('YouTube public timeout');
   return {candidates:[apiCandidate],errors:[]};
  }});
 const first=await search.search(input,true,undefined,true);
 assert.match(first.sources[0]?.error??'',/quotaExceeded.*public timeout/);
 const second=await search.search({...input,query:'tall ship sailing'},true,undefined,true);
 assert.equal(publicCalls,2,'API quota is not the public website quota');
 assert.equal(second.candidates[0]?.id,apiCandidate.id);
});

test('image-only independent YouTube discovery does not call the video API',async()=>{
 let apiCalls=0,publicCalls=0;
 const search=new DocumentarySearch(undefined,noHttp,undefined,undefined,{search:async()=>{apiCalls++;return [apiCandidate];}},
  {search:async(_query,kind)=>{publicCalls++;assert.equal(kind,'image');return [];}});
 await search.search({...input,kind:'image'},true,undefined,true);
 assert.equal(apiCalls,0);assert.equal(publicCalls,1);
});

test('Stop racing a public rate limit does not block the next independent native YouTube search',async()=>{
 for(const message of ['YouTube public HTTP 429','YouTube public quotaExceeded']){
  const controller=new AbortController();let apiCalls=0,publicCalls=0;
  const search=new DocumentarySearch(undefined,noHttp,undefined,undefined,{search:async()=>{
   apiCalls++;return apiCalls===1?[]:[apiCandidate];
  }},{search:async()=>[],searchWithSources:async()=>{
   publicCalls++;controller.abort(Error('User Stop'));throw Error(message);
  }});
  const first=await search.search(input,true,controller.signal,true);
  assert.equal(first.candidates.length,0);
  const second=await search.search({...input,query:'tall ship sailing'},true,undefined,true);
  assert.equal(apiCalls,2,`${message}: cancelled public search must not pause the next native request`);
  assert.equal(publicCalls,1);
  assert.equal(second.candidates[0]?.id,apiCandidate.id);
  assert.match(first.sources[0]?.error??'',/User Stop/);
 }
});

for(const rejects of [false,true])test(`Stop during the API ${rejects?'error':'response'} does not enter public fallback`,async()=>{
 const controller=new AbortController();let publicCalls=0,apiCalls=0;
 const search=new DocumentarySearch(undefined,noHttp,undefined,undefined,{search:async()=>{
  apiCalls++;controller.abort(Error('User Stop'));if(rejects)throw Error('API stopped');return [];
 }},{search:async()=>{publicCalls++;return [publicCandidate];}});
 const result=await search.search(input,true,controller.signal,true);
 assert.equal(apiCalls,1);assert.equal(publicCalls,0);assert.equal(result.candidates.length,0);
 assert.match(result.sources[0]?.error??'',/User Stop/);
});

test('old independent public YouTube cache cannot mask API preference; the new result stays cached',async t=>{
 const root=await mkdtemp(join(tmpdir(),'gws-youtube-api-preference-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const oldKey=createHash('sha256').update(JSON.stringify(['public-source-2','youtube',query.toLowerCase(),'video'])).digest('hex');
 const oldFile=join(root,`${oldKey}.json`),oldBytes=JSON.stringify({expiresAt:Date.now()+24*3600_000,candidates:[publicCandidate]});
 await writeFile(oldFile,oldBytes);
 let apiCalls=0,publicCalls=0;
 const make=()=>new DocumentarySearch(undefined,noHttp,root,undefined,{search:async()=>{apiCalls++;return [apiCandidate];}},
  {search:async()=>{publicCalls++;return [publicCandidate];}});
 const first=await make().search(input,true,undefined,true),second=await make().search(input,true,undefined,true);
 assert.equal(first.candidates[0]?.id,apiCandidate.id);assert.equal(second.candidates[0]?.id,apiCandidate.id);
 assert.equal(apiCalls,1);assert.equal(publicCalls,0);assert.equal(await readFile(oldFile,'utf8'),oldBytes);
});
