import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {DocumentarySearch} from './documentary-search.js';

const query='Richard Woodget Cutty Sark captain portrait';
const input={query,kind:'image' as const,providers:['commons' as const]};
const payload={query:{pages:[{pageid:123,title:'File:Captain Richard Woodget.png',imageinfo:[{
  url:'https://upload.wikimedia.org/wikipedia/commons/a/ab/Captain.png',descriptionurl:'https://commons.wikimedia.org/wiki/File:Captain.png',
  mime:'image/png',width:1109,height:1117,size:123456,extmetadata:{LicenseShortName:{value:'CC BY-SA 4.0'},
    LicenseUrl:{value:'https://creativecommons.org/licenses/by-sa/4.0/'},Artist:{value:'<b>Fixture author</b>'},
    ImageDescription:{value:'Portrait of Richard Woodget.'}}
}]}]}};
const empty={query:{pages:[]}};

test('independent Commons uses native metadata first and retains rights/origin without approving pixels',async()=>{
  let requests=0,web=0;
  const search=new DocumentarySearch(undefined,async(url,options)=>{
    requests++;const api=new URL(String(url));assert.equal(api.origin+api.pathname,'https://commons.wikimedia.org/w/api.php');
    assert.equal(api.searchParams.get('generator'),'search');assert.equal(api.searchParams.get('gsrnamespace'),'6');
    assert.equal(api.searchParams.get('gsrlimit'),'24');assert.equal(api.searchParams.get('gsrsearch'),query);
    assert.equal(new Headers(options?.headers).get('User-Agent'),'GoldWorkStudio/0.2 (local documentary editor)');
    assert.ok(options?.signal);return Response.json(payload);
  },undefined,undefined,undefined,{search:async()=>{web++;return [];}});
  const result=await search.search(input,true,undefined,true);
  assert.equal(requests,1);assert.equal(web,0);assert.deepEqual(result.sources,[{provider:'commons',count:1}]);
  const c=result.candidates[0]!;assert.equal(c.id,'commons:123');assert.equal(c.author,'Fixture author');
  assert.equal(c.rights,'licensed');assert.equal(c.license,'CC BY-SA 4.0');assert.equal(c.width,1109);assert.equal(c.height,1117);
  assert.equal(c.pageUrl,payload.query.pages[0]!.imageinfo[0]!.descriptionurl);assert.equal(c.match,'unverified');
  assert.ok(c.concerns.some(value=>value.includes('визуально')));
});
test('a usable source beyond the first eight is returned by one bounded metadata request',async()=>{
  let requests=0;
  const pages=Array.from({length:9},(_,index)=>({...structuredClone(payload.query.pages[0]!),pageid:index+1,
    title:index===8?'File:Captain Richard Woodget.png':`File:Unrelated ship ${index}.png`,
    imageinfo:[{...structuredClone(payload.query.pages[0]!.imageinfo[0]!),
      url:`https://upload.wikimedia.org/wikipedia/commons/a/ab/Candidate${index}.png`,
      descriptionurl:`https://commons.wikimedia.org/wiki/File:Candidate${index}.png`}]}));
  const search=new DocumentarySearch(undefined,async url=>{
    requests++;const limit=Number(new URL(String(url)).searchParams.get('gsrlimit'));
    return Response.json({query:{pages:pages.slice(0,limit)}});
  },undefined,undefined,undefined,{search:async()=>assert.fail('No extra web request')});
  const result=await search.search(input,true,undefined,true);
  assert.equal(requests,1);
  assert.ok(result.candidates.some(candidate=>candidate.id==='commons:9'&&candidate.match==='unverified'));
});

for(const explicit of ['entities','quoted'] as const)test(`empty full Commons query broadens once using ${explicit}, preserving original identity/year requirements`,async()=>{
  const request={...input,...(explicit==='entities'?{entities:['Richard Woodget'],years:['1869']}:{query:'"Richard Woodget" Cutty Sark captain portrait',years:['1869']})};
  const before=structuredClone(request),queries:string[]=[];
  const search=new DocumentarySearch(undefined,async url=>{
    queries.push(new URL(String(url)).searchParams.get('gsrsearch')!);return Response.json(queries.length===1?empty:payload);
  },undefined,undefined,undefined,{search:async()=>assert.fail('Native subject result needs no web')});
  const result=await search.search(request,true,undefined,true);
  assert.deepEqual(queries,['"Richard Woodget" Cutty Sark captain portrait','"Richard Woodget"']);
  assert.equal(result.candidates.length,1);assert.ok(result.candidates[0]!.concerns.some(value=>value.includes('1869')));
  assert.deepEqual(request,before);
});

for(const request of [input,{...input,entities:['Richard Woodget','Cutty Sark']},
  {...input,query:'"Richard Woodget" "Cutty Sark" portrait'}, {...input,query:'"Richard Woodget" captain "portrait'},
  {...input,entities:['Someone Else']},{...input,query:'"1869" ship portrait'}])
test(`Commons does not guess an ambiguous/absent primary identity: ${JSON.stringify(request)}`,async()=>{
  let native=0,web=0;
  const search=new DocumentarySearch(undefined,async()=>{native++;return Response.json(empty);},undefined,undefined,undefined,{
    search:async()=>assert.fail('Use source-specific public search'),
    searchWithSources:async(received,kind,_signal,source)=>{web++;assert.equal(source,'commons');assert.equal(kind,'image');assert.ok(received);return {candidates:[],errors:[]};}
  });
  await search.search(request,true,undefined,true);assert.equal(native,1);assert.equal(web,1);
});

test('two empty native queries enter exactly one existing source-specific web fallback',async()=>{
  let native=0,web=0;
  const search=new DocumentarySearch(undefined,async()=>{native++;return Response.json(empty);},undefined,undefined,undefined,{
    search:async()=>assert.fail('Use source-specific public search'),searchWithSources:async(q,_kind,_signal,source)=>{
      web++;assert.equal(q,'"Richard Woodget" Cutty Sark captain portrait');assert.equal(source,'commons');return {candidates:[],errors:[]};}
  });
  await search.search({...input,entities:['Richard Woodget']},true,undefined,true);assert.equal(native,2);assert.equal(web,1);
});

test('native transport error goes directly to one web fallback without subject retry',async()=>{
  let native=0,web=0;
  const search=new DocumentarySearch(undefined,async()=>{native++;throw Error('Fixture connection failure');},undefined,undefined,undefined,{
    search:async()=>{web++;return [];}
  });
  const result=await search.search({...input,entities:['Richard Woodget']},true,undefined,true);
  assert.equal(native,1);assert.equal(web,1);assert.match(result.sources[0]?.error??'',/connection failure/);
});

for(const status of [429,403])test(`Commons ${status} pauses further native/web requests across queries and media kinds`,async()=>{
  let native=0,web=0;
  const search=new DocumentarySearch(undefined,async()=>{native++;return new Response('',{status,headers:{'retry-after':'120'}});},undefined,undefined,undefined,{
    search:async()=>{web++;return [];}
  });
  const first=await search.search({...input,entities:['Richard Woodget']},true,undefined,true);
  const second=await search.search({...input,query:'Cutty Sark',kind:'video'},true,undefined,true);
  assert.equal(native,1);assert.equal(web,0);assert.match(first.sources[0]?.error??'',new RegExp(String(status)));
  assert.match(second.sources[0]?.error??'',/ограничил/);
});

for(const refusal of [403,429,'quota'] as const)test(`concurrent Commons ${refusal} prevents sibling native searches from entering public fallback`,async()=>{
  const native:Array<{resolve:(response:Response)=>void;reject:(error:Error)=>void}>=[];
  let web=0;
  const search=new DocumentarySearch(undefined,async()=>new Promise<Response>((resolve,reject)=>native.push({resolve,reject})),undefined,undefined,undefined,{
    search:async()=>assert.fail('Use source-specific public search'),
    searchWithSources:async()=>{web++;if(refusal==='quota')throw Error('quotaExceeded');return {candidates:[],errors:[]};}
  });
  const request=(query:string)=>search.search({...input,query},true,undefined,true);
  const jobs=['alpha ship','bravo ship','charlie ship','delta ship'].map(request);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(native.length,4);
  const queued=request('echo ship');
  native[0]!.resolve(refusal==='quota'?Response.json(empty):new Response('',{status:refusal,headers:{'retry-after':'120'}}));
  const first=await jobs[0]!,fifth=await queued;
  // Both successful-empty and failed native requests began before the refusal.
  // Neither may start a new public request after the provider is blocked.
  native[1]!.resolve(Response.json(empty));native[2]!.resolve(Response.json(empty));
  native[3]!.reject(Error('Fixture connection failure'));
  const siblings=await Promise.all(jobs.slice(1)),later=await request('foxtrot ship');
  assert.match(first.sources[0]?.error??'',refusal==='quota'?/quotaExceeded/:new RegExp(String(refusal)));
  const blocked=refusal==='quota'?/квот/:/ограничил/;
  for(const result of [fifth,...siblings,later])assert.match(result.sources[0]?.error??'',blocked);
  assert.equal(native.length,4);assert.equal(web,refusal==='quota'?1:0);
  assert.ok(search.nextRetryDelayMs()>0);
});

for(const phase of [1,2])test(`native timeout in query ${phase} never starts another native/web request`,async()=>{
  let native=0,web=0;
  const search=new DocumentarySearch(undefined,async()=>{if(++native===phase)throw new DOMException('Fixture timeout','TimeoutError');return Response.json(empty);},undefined,undefined,undefined,{
    search:async()=>{web++;return [];}
  });
  await search.search({...input,entities:['Richard Woodget']},true,undefined,true);assert.equal(native,phase);assert.equal(web,0);
});

for(const phase of [1,2])test(`Stop during native body ${phase} stops subject/public fallback`,async()=>{
  const stop=new AbortController();let native=0,web=0;
  const search=new DocumentarySearch(undefined,async(_url,options)=>{
    native++;assert.ok(options?.signal);const response=Response.json(empty);
    response.json=async()=>{if(native===phase)stop.abort(Error('User Stop'));return empty;};return response;
  },undefined,undefined,undefined,{search:async()=>{web++;return [];}});
  const result=await search.search({...input,entities:['Richard Woodget']},true,stop.signal,true);
  assert.equal(native,phase);assert.equal(web,0);assert.match(result.sources[0]?.error??'',/User Stop/);
});

test('Stop interrupts the actual native fetch signal and a queued fifth Commons search',async()=>{
  const pending:AbortController[]=[],seen:AbortSignal[]=[],releases:Array<()=>void>=[];
  const search=new DocumentarySearch(undefined,async(_url,options)=>{
    const signal=options!.signal!;seen.push(signal);
    return new Promise<Response>((resolve,reject)=>{
      signal.addEventListener('abort',()=>reject(signal.reason),{once:true});releases.push(()=>resolve(Response.json(payload)));
    });
  });
  const jobs=Array.from({length:4},(_,index)=>{const stop=new AbortController();pending.push(stop);return search.search({...input,query:`ship ${index}`},true,stop.signal,true);});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(seen.length,4);
  const queued=new AbortController(),fifth=search.search({...input,query:'queued ship'},true,queued.signal,true);
  queued.abort(Error('Queued Stop'));assert.match((await fifth).sources[0]?.error??'',/Queued Stop/);assert.equal(seen.length,4);
  pending[0]!.abort(Error('Active Stop'));assert.match((await jobs[0]!).sources[0]?.error??'',/Active Stop/);assert.equal(seen[0]!.aborted,true);
  releases.slice(1).forEach(release=>release());await Promise.all(jobs);
});

test('automatic SVG metadata fits the same native GET budget and uses the existing raster parser',async()=>{
  const data=structuredClone(payload),info=data.query.pages[0]!.imageinfo[0]!;
  Object.assign(info,{mime:'image/svg+xml',url:'https://upload.wikimedia.org/wikipedia/commons/a/ab/Ship.svg',
    thumburl:'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Ship.svg/1600px-Ship.svg.png',thumbwidth:1600,thumbheight:900});
  let calls=0;
  const search=new DocumentarySearch(undefined,async url=>{calls++;assert.equal(new URL(String(url)).searchParams.get('iiurlwidth'),'1920');return Response.json(data);});
  const result=await search.search(input,true,undefined,true);assert.equal(calls,1);assert.equal(result.candidates.length,1);assert.match(result.candidates[0]!.downloadUrl,/\.png$/);
});

test('manual/default Commons keeps the existing public route without native HTTP',async()=>{
  let web=0;
  const search=new DocumentarySearch(undefined,async()=>assert.fail('Default route must not call Commons API'),undefined,undefined,undefined,{
    search:async()=>{web++;return [];}
  });
  assert.deepEqual((await search.search(input)).sources,[{provider:'web',count:0}]);assert.equal(web,1);
});

test('old empty web Commons cache cannot mask native search; new results stay cached without rewriting old files',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-commons-native-'));
  t.after(async()=>{assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));assert.ok(root.includes('gws-commons-native-'));await rm(root,{recursive:true,force:true});});
  const oldKey=createHash('sha256').update(JSON.stringify(['commons-one-file-1','commons',query.toLowerCase(),'image'])).digest('hex');
  const oldFile=join(root,oldKey+'.json'),old=JSON.stringify({expiresAt:Date.now()+86400000,candidates:[]});await writeFile(oldFile,old);
  let calls=0;
  const make=()=>new DocumentarySearch(undefined,async()=>{calls++;return Response.json(payload);},root);
  assert.equal((await make().search(input,true,undefined,true)).candidates.length,1);
  assert.equal((await make().search(input,true,undefined,true)).candidates.length,1);
  assert.equal(calls,1);assert.equal(await readFile(oldFile,'utf8'),old);
});
