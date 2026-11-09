import test from 'node:test';
import assert from 'node:assert/strict';
import type {PublicPage} from './documentary-public-browser.js';
import {DocumentaryPublicPageNotReadyError,publicBrowserPageReady,waitForPublicBrowserPage} from './documentary-public-browser-ready.js';
import {documentarySearchUnavailable} from './documentary-search.js';
const page=(patch:Partial<PublicPage>={}):PublicPage=>({url:'https://commons.wikimedia.org/',title:'Search',text:'',links:Array.from({length:20},(_,i)=>({url:`https://commons.wikimedia.org/wiki/Help:${i}`,text:'Navigation'})),media:[],author:'',licenseUrl:'',licenseText:'',...patch});
const search=new URL('https://commons.wikimedia.org/w/index.php?title=Special:MediaSearch&type=image&search=Ford');

test('Bing navigation links do not count as loaded search results',()=>{
 const bing=new URL('https://www.bing.com/search?q=Ford');
 assert.equal(publicBrowserPageReady(bing,page({searchLinks:[]})),false);
 assert.equal(publicBrowserPageReady(bing,page({links:[],searchLinks:[{url:'https://example.org/ford',text:'Ford'}]})),true);
 assert.equal(publicBrowserPageReady(bing,page({searchLinks:[],searchNoResults:true})),true,'An explicit no-results element ends the wait');
 assert.equal(publicBrowserPageReady(bing,page({text:'Search for no results found',searchLinks:[]})),false,'Query text alone is not a no-results element');
});

test('bounded reader waits for delayed Bing, Commons and Archive results and never returns a shell',async()=>{
 for(const [value,result] of [
  ['https://www.bing.com/search?q=Ford',{searchLinks:[{url:'https://example.org/ford',text:'Ford'}]}],
  [search.href,{links:[{url:'https://commons.wikimedia.org/wiki/File:Ford.jpg',text:'Ford'}]}],
  ['https://archive.org/search?query=Ford',{searchLinks:[{url:'https://archive.org/details/ford',text:'Ford'}]}],
 ] as const){
  const url=new URL(value);let reads=0,waits=0;
  const loaded=page({...result,links:'links' in result?[...result.links]:[],searchLinks:'searchLinks' in result?[...result.searchLinks]:[]});
  assert.equal(await waitForPublicBrowserPage(url,async()=>++reads<3?page():loaded,undefined,async()=>{waits++;}),loaded);
  assert.equal(waits,2);
  reads=0;waits=0;
  await assert.rejects(waitForPublicBrowserPage(url,async()=>{reads++;return page();},undefined,async()=>{waits++;}),error=>{
   assert.ok(error instanceof DocumentaryPublicPageNotReadyError);assert.equal(error.code,'page-not-ready');
   assert.equal(documentarySearchUnavailable(error.message),true);return true;
  });
  assert.equal(waits,16);assert.equal(reads,17,'Polling is bounded even without a browser navigation timeout');
 }
});

test('bounded reader preserves Stop and does not take another snapshot after cancellation',async()=>{
 const stop=new AbortController(),reason=Error('User Stop');let reads=0;
 await assert.rejects(waitForPublicBrowserPage(search,async()=>{reads++;return page();},stop.signal,async()=>{stop.abort(reason);}),error=>error===reason);
 assert.equal(reads,1);
});
test('Commons navigation does not end the wait before asynchronous file results arrive',()=>{
 assert.equal(publicBrowserPageReady(search,page()),false);
 assert.equal(publicBrowserPageReady(search,page({links:[{url:'https://commons.wikimedia.org/wiki/File:Ford.jpg',text:'Ford'}]})),true);
 assert.equal(publicBrowserPageReady(search,page({text:'No results found'})),true);
});
test('non-search source pages and prior video/search readiness keep their existing conditions',()=>{
 assert.equal(publicBrowserPageReady(new URL('https://commons.wikimedia.org/wiki/File:Ford.jpg'),page()),true);
 assert.equal(publicBrowserPageReady(new URL('https://www.youtube.com/results?search_query=Ford'),page()),false);
 assert.equal(publicBrowserPageReady(new URL('https://archive.org/search?query=Ford'),page({searchLinks:[{url:'https://archive.org/details/ford',text:'Ford'}]})),true);
});

test('Archive explicit empty state is ready but a pending search shell is not',async()=>{
 const url=new URL('https://archive.org/search?query=Cutty%20Sark&and[]=mediatype%3Aimage');
 assert.equal(publicBrowserPageReady(url,page({searchLinks:[],searchNoResults:true})),true);
 assert.equal(publicBrowserPageReady(url,page({searchLinks:[],text:'0 Results'})),false,'Body text alone is not a completed search state');
 let reads=0;
 const empty=page({searchLinks:[],searchNoResults:true});
 assert.equal(await waitForPublicBrowserPage(url,async()=>++reads===1?page({searchLinks:[]}):empty,undefined,async()=>{}),empty);
 assert.equal(reads,2);
});
