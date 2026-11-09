import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,writeFile,rm,rmdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {DocumentaryYouTube,documentaryYouTubePublicProxy,officialYouTubePublicUrl,withDocumentaryYouTubeCookies} from './documentary-youtube.js';

test('public YouTube metadata receives the enabled saved proxy without changing the store',async()=>{
 const proxy='socks5://fixture-user:fixture-password@proxy.invalid:1080';
 let reads=0,calls=0;
 const store={apiKey:async()=>undefined,resolveValidatedCookies:async()=>undefined,
  proxyUrl:async()=>{reads++;return proxy;},downloadRoute:async()=>'proxy' as const};
 const youtube=new DocumentaryYouTube(store,undefined,undefined,async(url,signal,receivedProxy)=>{
  calls++;assert.equal(receivedProxy,proxy);assert.equal(url,'https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(signal,undefined);return {id:'abcdefghijk',duration:30,title:'Fixture',license:'Creative Commons'};
 });
 assert.equal((await youtube.publicCandidate('https://www.youtube.com/watch?v=abcdefghijk','named ship')).length,1);
 assert.equal(reads,1);assert.equal(calls,1);
});

test('public metadata receives the validated saved cookie file or undefined when none is configured',async()=>{
 for(const cookies of ['fixture-imported-cookies.txt',undefined]){
  let validations=0,calls=0;
  const youtube=new DocumentaryYouTube({apiKey:async()=>undefined,
   resolveValidatedCookies:async()=>{validations++;return cookies;}},undefined,undefined,
   async(_url,_signal,proxy,receivedCookies)=>{
    calls++;assert.equal(proxy,undefined);assert.equal(receivedCookies,cookies);
    return {id:'abcdefghijk',duration:30};
   });
  await youtube.publicCandidate('https://www.youtube.com/watch?v=abcdefghijk','ship');
  assert.equal(validations,1);assert.equal(calls,1);
 }
});

test('metadata cookie writes affect only a disposable copy, removed on success and error',async t=>{
 const root=await mkdtemp(join(tmpdir(),'youtube-cookie-fixture-'));
 const original=join(root,'imported.txt'),content='# Netscape HTTP Cookie File\nfixture';
 t.after(async()=>{await rm(original,{force:true});await rmdir(root);});
 await writeFile(original,content);
 for(const fails of [false,true]){
  let temporary:string|undefined;
  const request=withDocumentaryYouTubeCookies(original,async copy=>{
   assert.ok(copy);assert.notEqual(copy,original);temporary=copy;
   assert.equal(await readFile(copy,'utf8'),content);
   await writeFile(copy,'yt-dlp updated jar');
   if(fails)throw Error('Fixture metadata rejection');
   return 'metadata';
  });
  if(fails)await assert.rejects(request,/Fixture metadata rejection/);
  else assert.equal(await request,'metadata');
  assert.equal(await readFile(original,'utf8'),content);
  await assert.rejects(stat(dirname(temporary!)),{code:'ENOENT'});
 }
 await withDocumentaryYouTubeCookies(undefined,async copy=>assert.equal(copy,undefined));
});

test('system/public-dns routes do not read or enable a saved proxy; selected missing proxy fails closed',async()=>{
 for(const route of ['system','public-dns'] as const){
  assert.equal(await documentaryYouTubePublicProxy({downloadRoute:async()=>route,
   proxyUrl:async()=>{throw Error('Disabled proxy must not be read');}}),undefined);
 }
 await assert.rejects(documentaryYouTubePublicProxy({downloadRoute:async()=>'proxy',proxyUrl:async()=>undefined}),/сохраните прокси/);
 assert.equal(await documentaryYouTubePublicProxy(),undefined);
 assert.equal(await documentaryYouTubePublicProxy({proxyUrl:async()=>'http://fixture.invalid:8080'}),'http://fixture.invalid:8080');
});

test('proxy DNS exception is limited to HTTPS official YouTube resources, never arbitrary source URLs',()=>{
 for(const value of ['https://www.youtube.com/results?search_query=Cutty+Sark','https://www.youtube.com/watch?v=abcdefghijk',
  'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg','https://yt3.ggpht.com/avatar','https://jnn-pa.googleapis.com/']){
  assert.equal(officialYouTubePublicUrl(value)?.href,new URL(value).href);
 }
 for(const value of ['http://www.youtube.com/','https://www.youtube.com:444/','https://user:password@www.youtube.com/',
  'https://www.youtube.com.evil.invalid/','https://evil-youtube.com/','https://youtube.com@127.0.0.1/',
  'https://127.0.0.1/','https://localhost/','https://commons.wikimedia.org/','https://archive.org/',
  'https://www.bing.com/','https://arbitrary.googleapis.com/','file:///C:/secret','invalid']){
  assert.equal(officialYouTubePublicUrl(value),undefined,value);
 }
});
