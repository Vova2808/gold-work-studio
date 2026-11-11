import assert from 'node:assert/strict';
import test from 'node:test';
import {DocumentarySearch} from './documentary-search.js';

const payload={query:{pages:[{pageid:123,title:'File:Richard Woodget portrait.png',imageinfo:[{
  url:'https://upload.wikimedia.org/wikipedia/commons/a/ab/Captain.png',descriptionurl:'https://commons.wikimedia.org/wiki/File:Captain.png',
  mime:'image/png',width:1109,height:1117,extmetadata:{LicenseShortName:{value:'CC BY-SA 4.0'},Artist:{value:'Fixture'},
    ImageDescription:{value:'Portrait of Richard Woodget.'}}
}]}]}};
const empty={query:{pages:[]}};
const input=(wording:string,visualConstraints?:string[])=>({query:`Richard Woodget ${wording}`,kind:'image' as const,
  providers:['commons' as const],entities:['Richard Woodget'],...(visualConstraints?{visualConstraints}:{})});

test('different AI wording reuses one successful native query while retaining per-scene concerns',async()=>{
  const queries:string[]=[];
  const search=new DocumentarySearch(undefined,async url=>{
    queries.push(new URL(String(url)).searchParams.get('gsrsearch')!);return Response.json(payload);
  });
  const first=await search.search({...input('captain photograph'),years:['1885']},true,undefined,true);
  first.candidates[0]!.concerns.push('Caller-only note');
  const second=await search.search(input('archival portrait'),true,undefined,true);
  assert.deepEqual(queries,['intitle:"Richard Woodget"']);
  assert.equal(second.candidates.length,1);
  assert.ok(!second.candidates[0]!.concerns.some(value=>/1885|Caller-only/.test(value)));
  assert.ok(second.candidates[0]!.concerns.some(value=>value.includes('визуально')));
});

test('parallel scene queries share one native fetch even with separate cancellation signals',async()=>{
  let requests=0,finish!:(response:Response)=>void;
  const search=new DocumentarySearch(undefined,async()=>{requests++;return new Promise<Response>(resolve=>{finish=resolve;});});
  const first=search.search(input('captain photograph'),true,new AbortController().signal,true);
  const second=search.search(input('archival portrait'),true,new AbortController().signal,true);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(requests,1);
  finish(Response.json(payload));
  const results=await Promise.all([first,second]);
  assert.ok(results.every(result=>result.candidates.length===1));assert.equal(requests,1);
});

test('different required physical conditions remain separate native queries',async()=>{
  const queries:string[]=[];
  const search=new DocumentarySearch(undefined,async url=>{
    queries.push(new URL(String(url)).searchParams.get('gsrsearch')!);return Response.json(payload);
  });
  await search.search(input('photograph',['hands visible']),true,undefined,true);
  await search.search(input('photograph',['face visible']),true,undefined,true);
  assert.deepEqual(queries,['intitle:"Richard Woodget" (hands)','intitle:"Richard Woodget" (face)']);
});

test('shared empty native results preserve both distinct original web fallbacks and the two-GET budget',async()=>{
  const native:string[]=[],web:string[]=[];
  const search=new DocumentarySearch(undefined,async url=>{
    native.push(new URL(String(url)).searchParams.get('gsrsearch')!);return Response.json(empty);
  },undefined,undefined,undefined,{search:async()=>assert.fail('Use source-specific fallback'),searchWithSources:async query=>{
    web.push(query);return {candidates:[],errors:[]};
  }});
  await Promise.all([search.search(input('captain photograph'),true,undefined,true),search.search(input('archival portrait'),true,undefined,true)]);
  assert.deepEqual(native,['intitle:"Richard Woodget"','"Richard Woodget"']);
  assert.deepEqual(web.sort(),['"Richard Woodget" archival portrait','"Richard Woodget" captain photograph']);
});

test('native transport failures are not memoized as successful empty batches',async()=>{
  let requests=0,web=0;
  const search=new DocumentarySearch(undefined,async()=>{
    if(++requests===1)throw Error('Fixture connection failure');return Response.json(payload);
  },undefined,undefined,undefined,{search:async()=>{web++;return [];}});
  const failed=await search.search(input('captain photograph'),true,undefined,true);
  const recovered=await search.search(input('archival portrait'),true,undefined,true);
  assert.match(failed.sources[0]?.error??'',/connection failure/);
  assert.equal(recovered.candidates.length,1);assert.equal(requests,2);assert.equal(web,1);
});

test('429 retains its cooldown and permits a fresh native attempt after expiry',async t=>{
  let now=Date.now(),requests=0;t.mock.method(Date,'now',()=>now);
  const search=new DocumentarySearch(undefined,async()=>++requests===1?new Response('',{status:429,headers:{'retry-after':'1'}}):Response.json(payload));
  assert.match((await search.search(input('first'),true,undefined,true)).sources[0]?.error??'',/429/);
  assert.equal((await search.search(input('during cooldown'),true,undefined,true)).candidates.length,0);assert.equal(requests,1);
  now+=1001;
  assert.equal((await search.search(input('after cooldown'),true,undefined,true)).candidates.length,1);assert.equal(requests,2);
});

test('cancelling one subscriber preserves the shared fetch for another scene',async()=>{
  let requests=0,fetchSignal!:AbortSignal,finish!:(response:Response)=>void;
  const search=new DocumentarySearch(undefined,async(_url,options)=>{
    requests++;fetchSignal=options!.signal!;return new Promise<Response>(resolve=>{finish=resolve;});
  });
  const stop=new AbortController();
  const first=search.search(input('captain photograph'),true,stop.signal,true);
  const second=search.search(input('archival portrait'),true,new AbortController().signal,true);
  await new Promise(resolve=>setImmediate(resolve));stop.abort(Error('First scene Stop'));
  assert.match((await first).sources[0]?.error??'',/First scene Stop/);
  assert.equal(fetchSignal.aborted,false);finish(Response.json(payload));
  assert.equal((await second).candidates.length,1);assert.equal(requests,1);
});

test('last subscriber Stop aborts the fetch and does not leave a success memo',async()=>{
  let requests=0,fetchSignal!:AbortSignal;
  const search=new DocumentarySearch(undefined,async(_url,options)=>{
    if(++requests>1)return Response.json(payload);
    fetchSignal=options!.signal!;
    return new Promise<Response>((_resolve,reject)=>fetchSignal.addEventListener('abort',()=>reject(fetchSignal.reason),{once:true}));
  });
  const stop=new AbortController(),pending=search.search(input('captain photograph'),true,stop.signal,true);
  await new Promise(resolve=>setImmediate(resolve));stop.abort(Error('Last scene Stop'));
  assert.match((await pending).sources[0]?.error??'',/Last scene Stop/);assert.equal(fetchSignal.aborted,true);
  assert.equal((await search.search(input('archival portrait'),true,undefined,true)).candidates.length,1);assert.equal(requests,2);
});

test('native memory memo expires after one minute instead of suppressing fresh discovery indefinitely',async t=>{
  let now=Date.now(),requests=0;t.mock.method(Date,'now',()=>now);
  const search=new DocumentarySearch(undefined,async()=>{requests++;return Response.json(payload);});
  await search.search(input('first'),true,undefined,true);now+=59_999;
  await search.search(input('second'),true,undefined,true);assert.equal(requests,1);
  now+=2;await search.search(input('third'),true,undefined,true);assert.equal(requests,2);
});

test('native memory memo evicts old batches at its bounded capacity',async()=>{
  let requests=0;
  const search=new DocumentarySearch(undefined,async()=>{requests++;return Response.json(payload);});
  for(let index=0;index<65;index++)await search.search(input('photograph',[`feature${index}`]),true,undefined,true);
  assert.equal(requests,65);
  await search.search(input('fresh wording',['feature0']),true,undefined,true);assert.equal(requests,66);
});
