import {DocumentaryPublicPageNotReadyError,withPublicBrowserDomainPauses} from './documentary-public-browser-ready.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {publicPageCandidates,publicSearchLink,DocumentaryWebSearch} from './documentary-web-search.js';
import type {PublicPage} from './documentary-public-browser.js';
import {DocumentaryYouTube} from './documentary-youtube.js';
import {DocumentarySearch} from './documentary-search.js';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const page=(patch:Partial<PublicPage>={}):PublicPage=>({url:'https://example.org/page',title:'Actual title',text:'Actual source text',links:[],media:[],author:'',licenseUrl:'',licenseText:'',...patch});

test('YouTube public fallback requests CC results and checks actual rights beyond the first two links',async()=>{
 const ids=['aaaaaaaaaaa','bbbbbbbbbbb','ccccccccccc','ddddddddddd','eeeeeeeeeee'];
 const checked:string[]=[];
 const youtube=new DocumentaryYouTube({apiKey:async()=>undefined,resolveValidatedCookies:async()=>undefined},async()=>{throw Error('Unexpected API call');},undefined,async url=>{
  const id=new URL(url).searchParams.get('v')!;checked.push(id);
  return {id,title:'Sailing ship',duration:30,license:ids.indexOf(id)<2?'Standard YouTube License':'Creative Commons Attribution license (reuse allowed)'};
 });
 const search=new DocumentaryWebSearch(async url=>{
  const parsed=new URL(url);assert.equal(parsed.hostname,'www.youtube.com');
  assert.equal(decodeURIComponent(parsed.searchParams.get('sp')!), 'EgIwAQ==');
  return page({url,links:ids.map(id=>({url:`https://www.youtube.com/watch?v=${id}`,text:'Sailing ship'}))});
 },youtube);
 const result=await search.searchWithSources('sailing ship','video',undefined,'youtube');
 assert.deepEqual(checked,ids.slice(0,4));
 assert.equal(result.candidates.filter(c=>c.rights==='licensed').length,2);
 assert.equal(result.candidates.filter(c=>c.rights==='unknown').length,2);
});

test('Bing and Commons shells are page-not-ready, while explicit empty results remain empty',async()=>{
 for(const source of ['web','commons'] as const){
  const web=new DocumentaryWebSearch(async url=>page({url,links:Array.from({length:20},(_,i)=>({url:`https://example.org/menu/${i}`,text:'Menu'}))}));
  await assert.rejects(web.searchWithSources('Ford','image',undefined,source),error=>{
   assert.match(String(error),/page-not-ready/);assert.doesNotMatch(String(error),/не вернула доступных ссылок/);return true;
  });
  const empty=new DocumentaryWebSearch(async url=>page({url,searchNoResults:source==='web',text:source==='commons'?'There were no results matching the query.':''}));
  await assert.rejects(empty.searchWithSources('Ford','image',undefined,source),error=>{
   assert.match(String(error),/не вернула доступных ссылок/);assert.doesNotMatch(String(error),/page-not-ready/);return true;
  });
 }
});

test('a reader returning an empty page after Stop cannot turn cancellation into empty results',async()=>{
 const stop=new AbortController(),reason=Error('User Stop');
 const web=new DocumentaryWebSearch(async url=>{stop.abort(reason);return page({url,searchNoResults:true});});
 await assert.rejects(web.searchWithSources('Ford','image',stop.signal,'web'),error=>error===reason);
});

test('public search redirect decoding preserves only public HTTPS schemes',()=>{
 const target='https://archive.org/details/train';assert.equal(publicSearchLink('https://www.bing.com/ck/a?u=a1'+Buffer.from(target).toString('base64url')),target);
 assert.equal(publicSearchLink('javascript:alert(1)'),'');assert.equal(publicSearchLink('https://user:secret@example.org/file.mp4'),'');
});
test('general page license never licenses a linked third-party photo',()=>{
 const found=publicPageCandidates(page({licenseUrl:'https://creativecommons.org/licenses/by/4.0/',media:[{url:'https://other.org/photo.jpg',kind:'image'}]}),'train','image');
 assert.equal(found[0]!.rights,'unknown');assert.equal(found[0]!.author,'');assert.equal(found[0]!.capturedAt,undefined);
});
test('Commons file license is associated with its original, without licensing external links',()=>{
 const found=publicPageCandidates(page({url:'https://commons.wikimedia.org/wiki/File:Train.jpg',licenseUrl:'https://creativecommons.org/licenses/by-sa/4.0/deed.en',author:'Actual author',media:[{url:'https://upload.wikimedia.org/wikipedia/commons/a/a1/Train.jpg',kind:'image'}],links:[{url:'https://other.org/another.jpg',text:'another'}]}),'train','image');
 assert.equal(found.length,1);assert.equal(found[0]!.rights,'licensed');assert.equal(found[0]!.author,'Actual author');
});
test('associated CC Germany deed/canonical URLs retain their actual ported license',()=>{
 const original=page({url:'https://commons.wikimedia.org/wiki/File:Mustang.jpg',author:'Original author',licenseText:'CC BY-SA 2.0 Germany',
  media:[{url:'https://upload.wikimedia.org/wikipedia/commons/a/a1/Mustang.jpg',kind:'image'}]});
 for(const licenseUrl of ['https://creativecommons.org/licenses/by-sa/2.0/de/deed.en','https://creativecommons.org/licenses/by-sa/2.0/de/']){
  const candidate=publicPageCandidates({...original,licenseUrl},'1965 Ford Mustang','image')[0]!;
  assert.equal(candidate.rights,'licensed');assert.equal(candidate.licenseUrl,licenseUrl);
  assert.equal(candidate.license,'CC BY-SA 2.0 Germany');assert.equal(candidate.author,original.author);
  assert.match(candidate.attribution,/Original author/);
 }
 for(const licenseUrl of ['https://creativecommons.org/licenses/by-sa/2.0/de/extra','https://creativecommons.org/licenses/by-nc-sa/2.0/de/deed.en',
  'https://creativecommons.org/licenses/by-sa/4.0/de/deed.en','https://creativecommons.org.evil.example/licenses/by-sa/2.0/de/'])
  assert.equal(publicPageCandidates({...original,licenseUrl},'1965 Ford Mustang','image')[0]!.rights,'unknown');
});
test('Archive item preserves actual public-domain declaration and duration for its own file',()=>{
 const found=publicPageCandidates(page({url:'https://archive.org/details/train',licenseUrl:'http://creativecommons.org/publicdomain/mark/1.0/',durationSeconds:23,media:[{url:'https://archive.org/download/train/train.mp4',kind:'video'}]}),'train','video');
 assert.equal(found[0]!.rights,'public-domain');assert.equal(found[0]!.durationSeconds,23);
});
test('partial public search failure retains successful Commons candidates and warning',async()=>{
 const calls:string[]=[];const web=new DocumentaryWebSearch(async(url)=>{calls.push(url);if(url.includes('commons.wikimedia.org/w/'))return page({url,links:[{url:'https://commons.wikimedia.org/wiki/File:Train.jpg',text:'Train'}]});
  if(url.includes('/wiki/File:'))return page({url,media:[{url:'https://upload.wikimedia.org/wikipedia/commons/a/a1/Train.jpg',kind:'image'}]});
  throw Error('CAPTCHA/проверка безопасности');});
 const result=await web.searchWithSources('train','image');assert.equal(result.candidates.length,1);assert.equal(result.errors.length,2);
 assert.equal(calls.filter(url=>url.includes('bing.com')).length,1);
});
test('web warnings survive search-cache restart without repeated network',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'gws-web-cache-'));try{
  let calls=0;const candidate=publicPageCandidates(page({media:[{url:'https://example.org/train.jpg',kind:'image'}]}),'train','image')[0]!;
  const adapter={search:async()=>[candidate],searchWithSources:async()=>{calls++;return {candidates:[candidate],errors:['YouTube: временно недоступен']};}};
  const first=await new DocumentarySearch(undefined,fetch,dir,undefined,undefined,adapter).search({query:'train',kind:'image',providers:['web']});
  const restarted=await new DocumentarySearch(undefined,fetch,dir,undefined,undefined,adapter).search({query:'train',kind:'image',providers:['web']});
  assert.equal(calls,1);assert.equal(first.sources[0]!.count,1);assert.equal(restarted.sources[0]!.error,'YouTube: временно недоступен');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('public YouTube metadata requires neither API key nor cookies and retains unknown rights',async()=>{
 const youtube=new DocumentaryYouTube({apiKey:async()=>{throw Error('Unexpected API key read');},resolveValidatedCookies:async()=>undefined},async()=>{throw Error('Unexpected Data API');},undefined,async(url,_signal,_proxy,cookies)=>{
  assert.equal(url,'https://www.youtube.com/watch?v=abcdefghijk');assert.equal(cookies,undefined);
  return {id:'abcdefghijk',duration:30,title:'Actual video',license:'Standard YouTube License'};
 });
 const found=await youtube.publicCandidate('https://www.youtube.com/watch?v=abcdefghijk','train');assert.equal(found[0]!.rights,'unknown');assert.equal(found[0]!.discovery,'public-web');
});
test('YouTube security challenge stops further metadata requests during pause',async()=>{
 let calls=0;const youtube=new DocumentaryYouTube({apiKey:async()=>undefined,resolveValidatedCookies:async()=>undefined},fetch,undefined,async()=>{calls++;throw Error('Sign in to confirm you’re not a bot');});
 await assert.rejects(youtube.publicCandidate('https://www.youtube.com/watch?v=abcdefghijk','train'),/not a bot/);
 await assert.rejects(youtube.publicCandidate('https://www.youtube.com/watch?v=abcdefghijk','other'),/пауза/);assert.equal(calls,1);
});
test('external Stop never returns a successful partial search to be cached',async()=>{
 const controller=new AbortController();const web=new DocumentaryWebSearch(async(url)=>{controller.abort(Error('User Stop'));throw controller.signal.reason;});
 await assert.rejects(web.searchWithSources('train','image',controller.signal),/User Stop/);
});

test('slow YouTube metadata does not prevent another source from reading its actual file page',{timeout:2000},async()=>{
 let release!:()=>void,commonsDone!:()=>void;
 const metadata=new Promise<void>(done=>release=done),readCommons=new Promise<void>(done=>commonsDone=done);
 const web=new DocumentaryWebSearch(async url=>{
  if(url.includes('youtube.com/results'))return page({url,links:[{url:'https://www.youtube.com/watch?v=abcdefghijk',text:'engine'}]});
  if(url.includes('commons.wikimedia.org/w/'))return page({url,links:[{url:'https://commons.wikimedia.org/wiki/File:Engine.webm',text:'engine'}]});
  if(url.includes('/wiki/File:')){commonsDone();return page({url,media:[{url:'https://upload.wikimedia.org/wikipedia/commons/a/a1/Engine.webm',kind:'video'}]});}
  return page({url});
 },{publicCandidate:async()=>{await metadata;return [];}});
 const work=web.searchWithSources('engine','video');
 try{await readCommons;}finally{release();}
 const result=await work;assert.equal(result.candidates.length,1);
});

test('a paused metadata source is not repeatedly opened while other public routes continue',async()=>{
 const calls:string[]=[];const web=new DocumentaryWebSearch(async url=>{calls.push(url);return page({url});},{publicAvailable:()=>false,publicCandidate:async()=>{throw Error('Paused metadata must not be requested');}});
 await assert.rejects(web.searchWithSources('engine','video'),/приостановлены/);
 assert.equal(calls.some(url=>url.includes('youtube.com')),false);assert.equal(calls.length,3);
});

test('the same YouTube link from two routes shares one metadata call, including tracking variants',async()=>{
 let calls=0,release!:()=>void;const metadata=new Promise<void>(done=>release=done);
 const web=new DocumentaryWebSearch(async url=>{
  const watch='https://www.youtube.com/watch?v=abcdefghijk';
  if(url.includes('youtube.com/results'))return page({url,links:[{url:watch,text:'engine'}]});
  if(url.includes('bing.com/search'))return page({url,searchLinks:[{url:watch+'&feature=share',text:'engine'}]});
  return page({url});
 },{publicCandidate:async()=>{calls++;await metadata;return [];}});
 const work=web.searchWithSources('engine','video');
 await new Promise<void>(done=>setImmediate(done));release();
 await assert.rejects(work,/Вебпоиск/);assert.equal(calls,1);
});

test('Commons uses rendered file search and keeps alternatives after the first licensed photo',async()=>{
 const calls:string[]=[];
 const web=new DocumentaryWebSearch(async url=>{
  calls.push(url);
  if(url.includes('/w/index.php'))return page({url,links:['One','Two','Three'].map(name=>({url:`https://commons.wikimedia.org/wiki/File:${name}.jpg`,text:name}))});
  return page({url,licenseUrl:'https://creativecommons.org/licenses/by/4.0/',media:[{url:`https://upload.wikimedia.org/wikipedia/commons/a/a1/${url.split(':').at(-1)}`,kind:'image'}]});
 });
 const result=await web.searchWithSources('Valentino Rossi','image',undefined,'commons');
 assert.match(calls[0]!,/title=Special:Search/);
 assert.match(calls[0]!,/filetype%3Abitmap/);
 assert.equal(result.candidates.length,3);
 assert.equal(result.candidates.every(c=>c.rights==='licensed'),true);
});

test('Commons fills its eight slots with distinct files, preferring the original over a thumbnail',async()=>{
 const names=Array.from({length:9},(_,i)=>`Cutty_Sark_${i}.jpg`);
 const web=new DocumentaryWebSearch(async url=>{
  if(url.includes('/w/index.php'))return page({url,links:[names[0]+'#file',...names].map(name=>({url:`https://commons.wikimedia.org/wiki/File:${name}`,text:name}))});
  const name=new URL(url).pathname.split('File:')[1]!,base='https://upload.wikimedia.org/wikipedia/commons/';
  return page({url,licenseUrl:'https://creativecommons.org/licenses/by/4.0/',media:[
   {url:base+'a/a1/Unrelated.jpg',kind:'image'},
   {url:`${base}thumb/a/a1/${name}/320px-${name}`,kind:'image'},
   {url:`${base}a/a1/${name}`,kind:'image'}]});
 });
 const result=await web.searchWithSources('Cutty Sark ship Greenwich','image',undefined,'commons');
 assert.deepEqual(result.candidates.map(c=>c.downloadUrl),names.slice(0,8).map(name=>'https://upload.wikimedia.org/wikipedia/commons/a/a1/'+name));
});

test('Wikipedia og:image still resolves its actual file through Wikipedia to Commons',async()=>{
 const calls:string[]=[],article='https://en.wikipedia.org/wiki/Masao_Furusawa';
 const local='https://en.wikipedia.org/wiki/File:Furusawa.jpg',commons='https://commons.wikimedia.org/wiki/File:Furusawa.jpg';
 const unrelated='https://commons.wikimedia.org/wiki/File:Unrelated.jpg';
 const web=new DocumentaryWebSearch(async url=>{
  calls.push(url);
  if(url.includes('bing.com/search'))return page({url,searchLinks:[{url:article,text:'Furusawa'}]});
  if(url===article)return page({url,media:[{url:'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Furusawa.jpg/400px-Furusawa.jpg',kind:'image'}],
   links:[{url:unrelated,text:'Footer'},{url:local,text:''}]});
  if(url===local)return page({url,links:[{url:unrelated,text:'Other file'},{url:commons,text:'View on Commons'}]});
  if(url===commons)return page({url,title:'Furusawa photograph',licenseUrl:'https://creativecommons.org/licenses/by/4.0/',media:[{url:'https://upload.wikimedia.org/wikipedia/commons/a/a1/Furusawa.jpg',kind:'image'}]});
  throw Error('Unrelated file must not be opened');
 });
 const result=await web.searchWithSources('Masao Furusawa','image',undefined,'web');
 assert.equal(result.candidates.filter(c=>c.rights==='licensed').length,1);
 assert.equal(result.candidates.find(c=>c.rights==='licensed')!.pageUrl,commons);
 assert.equal(calls.includes(local),true);assert.equal(calls.includes(unrelated),false);
});

test('Wikipedia article media links use actual Commons rights and local fair-use files stay unknown',async()=>{
 for(const direct of [true,false]){
  const article='https://en.wikipedia.org/wiki/Subject',commons='https://commons.wikimedia.org/wiki/File:Subject.jpg';
  const local='https://en.wikipedia.org/wiki/File:Subject.jpg';
  const web=new DocumentaryWebSearch(async url=>{
   if(url.includes('bing.com/search'))return page({url,searchLinks:[{url:article,text:'Subject'}]});
   if(url===article)return page({url,licenseUrl:'https://creativecommons.org/licenses/by-sa/4.0/',mediaFileLinks:[{url:direct?commons:local,text:''}],
    media:[{url:'https://upload.wikimedia.org/wikipedia/en/a/a1/Subject.jpg',kind:'image'}]});
   if(url===local)return page({url,licenseUrl:'https://creativecommons.org/licenses/by-sa/4.0/',links:[{url:'https://commons.wikimedia.org/wiki/File:Other.jpg',text:'Unrelated free file'}]});
   if(url===commons)return page({url,licenseUrl:'https://creativecommons.org/licenses/by/4.0/',media:[{url:'https://upload.wikimedia.org/wikipedia/commons/a/a1/Subject.jpg',kind:'image'}]});
   throw Error('Unrelated file must not be opened');
  });
  const result=await web.searchWithSources('Subject','image',undefined,'web');
  assert.equal(result.candidates.some(c=>c.rights==='licensed'),direct);
 }
});

test('Archive completed empty search returns no candidates or outage, while its pending shell still fails',async()=>{
 let reads=0;
 const empty=new DocumentaryWebSearch(async url=>{reads++;return page({url,searchLinks:[],searchNoResults:true});});
 assert.deepEqual(await empty.searchWithSources('Cutty Sark launch Dumbarton 1869','image',undefined,'internet-archive'),{candidates:[],errors:[]});
 assert.equal(reads,1,'An empty search needs no item-page requests');
 const pending=new DocumentaryWebSearch(async url=>page({url,searchLinks:[],searchNoResults:false,text:'0 Results'}));
 await assert.rejects(pending.searchWithSources('Cutty Sark launch Dumbarton 1869','image',undefined,'internet-archive'),/page-not-ready/);
});



test('a restricted Bing destination does not discard a healthy destination',async()=>{
 const web=new DocumentaryWebSearch(async url=>{
  if(new URL(url).hostname==='www.bing.com')return page({url,searchLinks:[{url:'https://slow.example/item',text:'Slow'},{url:'https://healthy.example/item',text:'Healthy'}]});
  if(new URL(url).hostname==='slow.example')throw Error('Сайт приостановлен; действует пауза');
  return page({url,media:[{url:'https://healthy.example/photo.jpg',kind:'image'}]});
 });
 const result=await web.searchWithSources('train','image',undefined,'web');
 assert.equal(result.candidates.length,1);
 assert.match(result.errors[0]!,/slow.example/);
});


test('timeout pauses only its domain across searches and resumes after expiry',async()=>{
 let now=1000,slowReads=0,healthyReads=0;
 const blocked=new Map<string,number>();
 const read=withPublicBrowserDomainPauses(async url=>{
  const host=new URL(url).hostname;
  if(host==='www.bing.com')return page({url,searchLinks:[{url:'https://slow.example/item',text:'Slow'},{url:'https://healthy.example/item',text:'Healthy'}]});
  if(host==='slow.example'){slowReads++;throw new DocumentaryPublicPageNotReadyError(host);}
  healthyReads++;
  return page({url,media:[{url:'https://healthy.example/photo.jpg',kind:'image'}]});
 },blocked,()=>now);
 const web=new DocumentaryWebSearch(read);
 for(let i=0;i<3;i++)assert.equal((await web.searchWithSources('train','image',undefined,'web')).candidates.length,1);
 assert.equal(slowReads,1);
 assert.equal(healthyReads,3);
 assert.deepEqual([...blocked.keys()],['slow.example']);
 now+=120000;
 await web.searchWithSources('train','image',undefined,'web');
 assert.equal(slowReads,2);
});

test('Stop is immediate during a pause and cancellation never pauses a healthy domain',async()=>{
 const blocked=new Map([['slow.example',Date.now()+120000]]);
 const stop=new AbortController(),reason=Error('User Stop');stop.abort(reason);
 let reads=0;
 const read=withPublicBrowserDomainPauses(async url=>{reads++;return page({url});},blocked);
 await assert.rejects(read('https://slow.example/',stop.signal),error=>error===reason);
 assert.equal(reads,0);
 const active=new AbortController();
 const cancel=withPublicBrowserDomainPauses(async()=>{active.abort(reason);throw new DocumentaryPublicPageNotReadyError('healthy.example');},blocked);
 await assert.rejects(cancel('https://healthy.example/',active.signal),error=>error===reason);
 assert.equal(blocked.has('healthy.example'),false);
 await read('https://healthy.example/');
 assert.equal(reads,1);
});
