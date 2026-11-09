import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createDocumentarySourceFetcher} from './documentary-source-fetch.js';
import {downloadDocumentaryFile} from './documentary-download.js';

test('the production file downloader streams through the injected saved-proxy transport',async t=>{
 const root=await mkdtemp(join(tmpdir(),'gws-public-proxy-'));t.after(()=>rm(root,{recursive:true,force:true}));let calls=0;
 const fetcher=createDocumentarySourceFetcher(async()=>'http://fixture:fixture@proxy.example:8080',async(input,init,proxy)=>{
  calls++;assert.equal(new URL(String(input)).hostname,'93.184.216.34');assert.equal(init?.redirect,'manual');assert.ok(proxy);
  return new Response('JPEG',{headers:{'content-type':'image/jpeg','content-length':'4'}});
 });
 const file=join(root,'working.jpg');
 const result=await downloadDocumentaryFile('https://93.184.216.34/working.jpg',file,undefined,undefined,{fetcher,availabilityWaitMs:12000});
 assert.equal(calls,1);assert.equal(result.bytes,4);assert.equal(await readFile(file,'utf8'),'JPEG');
});

test('an unavailable configured proxy propagates failure and never silently uses direct fetch',async t=>{
 let direct=0;t.mock.method(globalThis,'fetch',async()=>{direct++;return new Response('unexpected');});
 const fetcher=createDocumentarySourceFetcher(async()=>'http://proxy.example:8080',async()=>{throw Error('Fixture proxy failure');});
 await assert.rejects(fetcher('https://upload.wikimedia.org/fixture.jpg'),/Fixture proxy failure/);
 assert.equal(direct,0);
});

test('no saved proxy retains the lawful direct route with the same request options',async t=>{
 let direct=0;const stop=new AbortController();
 t.mock.method(globalThis,'fetch',async(_input:unknown,init?:RequestInit)=>{direct++;assert.equal(init?.redirect,'manual');assert.equal(init?.signal,stop.signal);return new Response('direct');});
 assert.equal(await (await createDocumentarySourceFetcher(async()=>undefined)('https://upload.wikimedia.org/fixture.jpg',{redirect:'manual',signal:stop.signal})).text(),'direct');
 assert.equal(direct,1);
});

test('invalid saved proxy is an error instead of an implicit direct route',async t=>{
 let direct=0;t.mock.method(globalThis,'fetch',async()=>{direct++;return new Response('unexpected');});
 await assert.rejects(createDocumentarySourceFetcher(async()=>'not a proxy')('https://upload.wikimedia.org/fixture.jpg'));
 assert.equal(direct,0);
});

test('the configured transport receives manual redirects and abort unchanged',async()=>{
 const stop=new AbortController();let calls=0;
 const fetcher=createDocumentarySourceFetcher(async()=>'http://proxy.example:8080',async(_input,init)=>{
  calls++;assert.equal(init?.redirect,'manual');assert.equal(init?.signal,stop.signal);init?.signal?.throwIfAborted();
  return new Response(null,{status:302,headers:{location:'https://example.org/next'}});
 });
 const init={redirect:'manual' as const,signal:stop.signal};
 assert.equal((await fetcher('https://upload.wikimedia.org/fixture.jpg',init)).status,302);assert.equal(calls,1);
 stop.abort();await assert.rejects(fetcher('https://upload.wikimedia.org/fixture.jpg',init),{name:'AbortError'});
});
