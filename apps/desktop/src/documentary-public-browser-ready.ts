import {setTimeout as delay} from 'node:timers/promises';
import type {PublicPage,PublicPageReader} from './documentary-public-browser.js';

const commonsSearch=(url:URL)=>url.hostname==='commons.wikimedia.org'
 &&['Special:MediaSearch','Special:Search'].includes(url.searchParams.get('title')??url.pathname.replace(/^\/wiki\//,''));

export class DocumentaryPublicPageNotReadyError extends Error {
 readonly code='page-not-ready';
 constructor(host:string){
  super(`Вебпоиск недоступен: page-not-ready (${host}); таймаут ожидания содержимого страницы.`);
  this.name='DocumentaryPublicPageNotReadyError';
 }
}

export function publicBrowserPageReady(url:URL,page:PublicPage):boolean {
 if(url.hostname==='www.bing.com'&&url.pathname==='/search')return (page.searchLinks?.length??0)>0||page.searchNoResults===true;
 if(url.hostname==='www.youtube.com')return page.links.some(link=>/\/watch\?v=/.test(link.url));
 if(url.hostname==='archive.org'&&url.pathname==='/search')return (page.searchLinks?.length??0)>0||page.searchNoResults===true;
 if(url.hostname==='archive.org'&&url.pathname.startsWith('/details/'))return Boolean(page.title.trim())
  &&!/^Internet Archive(?:: Digital Library|\s*$)/i.test(page.title)&&page.text.trim().length>30;
 if(commonsSearch(url))
  return page.links.some(link=>/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/i.test(link.url))
   ||/\bno (?:results|files) (?:found|matching)\b|ничего не найдено|результатов не найдено/iu.test(page.text);
 return page.links.length>=10;
}

export function assertPublicBrowserPageReady(url:URL,page:PublicPage):void {
 const required=url.hostname==='www.bing.com'&&url.pathname==='/search'
  ||url.hostname==='www.youtube.com'&&url.pathname==='/results'
  ||url.hostname==='archive.org'&&(url.pathname==='/search'||url.pathname.startsWith('/details/'))
  ||commonsSearch(url);
 if(required&&!publicBrowserPageReady(url,page))throw new DocumentaryPublicPageNotReadyError(url.hostname);
}

/** Bound dynamic-page polling; a shell without results is not an empty search. */
export async function waitForPublicBrowserPage(url:URL,read:()=>Promise<PublicPage>,signal?:AbortSignal,
 pause:()=>Promise<unknown>=()=>delay(500,undefined,{signal})):Promise<PublicPage>{
 signal?.throwIfAborted();
 let page=await read();signal?.throwIfAborted();
 for(let attempt=0;attempt<16&&!publicBrowserPageReady(url,page);attempt++){
  await pause();signal?.throwIfAborted();page=await read();signal?.throwIfAborted();
 }
 assertPublicBrowserPageReady(url,page);
 return page;
}


/** Share the browser's HTTP/security pauses with page readiness timeouts. */
export function withPublicBrowserDomainPauses(read:PublicPageReader,blocked:Map<string,number>,now=Date.now):PublicPageReader {
 return async(value,signal)=>{
  signal?.throwIfAborted();
  const host=new URL(value).hostname;
  if((blocked.get(host)??0)>now())throw Error('Вебпоиск недоступен: сайт приостановлен; действует пауза.');
  try{
   const page=await read(value,signal);
   signal?.throwIfAborted();
   return page;
  }catch(error){
   signal?.throwIfAborted();
   if(error instanceof DocumentaryPublicPageNotReadyError)blocked.set(host,Math.max(blocked.get(host)??0,now()+120000));
   throw error;
  }
 };
}
