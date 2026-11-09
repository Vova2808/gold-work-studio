import { BrowserWindow, session } from 'electron';
import { publicMediaUrl } from './documentary-download.js';
import {DocumentaryPublicPageNotReadyError,waitForPublicBrowserPage,withPublicBrowserDomainPauses} from './documentary-public-browser-ready.js';
import {createAuthenticatedProxyBridge} from './proxy-utils.js';
import {documentaryYouTubePublicProxy,officialYouTubePublicUrl,type DocumentaryYouTubeNetworkStore} from './documentary-youtube.js';

export interface PublicPage {
  url:string; title:string; text:string;
  links:{url:string;text:string}[];
  searchLinks?:{url:string;text:string}[];
  searchNoResults?:boolean;
  mediaFileLinks?:{url:string;text:string}[];
  media:{url:string;kind:'image'|'video';width?:number;height?:number;duration?:number}[];
  author:string; licenseUrl:string; licenseText:string;
  durationSeconds?:number;
}
export type PublicPageReader=(url:string,signal?:AbortSignal)=>Promise<PublicPage>;
export function publicBrowserRetryAfter(value:string|null,now=Date.now()):number{
 const delay=value&&/^\d+(?:\.\d+)?$/.test(value)?Number(value)*1000:value?Date.parse(value)-now:120000;
 return Number.isFinite(delay)&&delay>0?Math.max(1000,delay):120000;
}

/** Only a fixed DOM reader runs here. Remote pages have no Node, preload,
 * credentials from the user's browser, permissions or access to local files. */
const snapshot=`(() => {
 const roots=[document];for(let i=0;i<roots.length&&i<500;i++)for(const el of roots[i].querySelectorAll('*'))if(el.shadowRoot)roots.push(el.shadowRoot);
 const all=s=>roots.flatMap(r=>Array.from(r.querySelectorAll(s)));
 const text=el=>(el?.textContent||'').replace(/\\s+/g,' ').trim();
 const resultLinks=all('.b_algo h2 a[href],.sdms-search-result a[href],#video-title[href],#video-title-link[href],.item-title a[href],a.item-title[href],a.tile-link[href]');
 const links=[...resultLinks,...all('a[href]')].map(a=>({url:a.href,text:text(a).slice(0,500)}));
 const tileLinks=roots.filter(r=>r.host&&/tile/.test(r.host.localName)).flatMap(r=>Array.from(r.querySelectorAll('a[href]')));
 const searchLinks=[...resultLinks,...tileLinks].map(a=>({url:a.href,text:text(a).slice(0,500)}));
 // Archive's search component renders an explicit count in its shadow tree.
 // A zero count while the activity indicator is visible is still loading.
 const archiveEmpty=location.hostname==='archive.org'&&location.pathname==='/search'
  &&!all('ia-activity-indicator').some(el=>el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))
  &&roots.filter(r=>r.host?.localName==='search-page').some(r=>Array.from(r.querySelectorAll('collection-browser [slot="results-heading"] .results-count'))
   .some(el=>el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})&&/^0\\s+Results$/i.test(text(el))));
 const searchNoResults=archiveEmpty||all('#b_results .b_no').some(el=>/\\bno results\\b|ничего не найдено|результат(?:ы|ов) не найден/iu.test(text(el)));
 const media=all('.fullMedia a[href],video[src],video source[src],meta[property="og:video"],meta[property="og:video:url"],meta[property="og:image"]')
  .map(el=>{const url=el.href||el.src||el.content;return {url,kind:/\\.(mp4|webm|ogv|mov)(?:[?#]|$)/i.test(url)||el.tagName==='VIDEO'||el.tagName==='SOURCE'||el.getAttribute('property')?.startsWith('og:video')?'video':'image'};});
 const license=all('.licensetpl a[href],a[rel~="license"],.license a[href],meta[itemprop="license"]')
  .find(a=>/creativecommons\\.org\\/(licenses|publicdomain)\\//i.test(a.href||a.content||''));
 const author=all('#fileinfotpl_aut + td,.fileinfotpl-type-information #creator,meta[name="author"],meta[property="article:author"]')[0];
 const metadataDuration=Number(all('meta[property="video:duration"]')[0]?.content);
 const duration=all('video').map(v=>v.duration).find(n=>Number.isFinite(n)&&n>0)||(metadataDuration>0?metadataDuration:undefined);
 const main=all('#maincontent,main,#mw-content-text')[0];
 const mediaFileLinks=Array.from((main||document).querySelectorAll('a.mw-file-description[href],a.image[href]'))
  .filter(a=>{const image=a.querySelector('img');return image&&Math.max(image.naturalWidth||0,image.width||0)>=120;})
  .map(a=>({url:a.href,text:text(a).slice(0,500)}));
 const visible=[main?.innerText||document.body?.innerText||'',...roots.slice(1).flatMap(r=>Array.from(r.children).map(el=>el.innerText||''))].join(' ');
 const title=all('meta[property="og:title"]')[0]?.content||text(all('h1')[0])||document.title;
 return {url:location.href,title,text:visible.slice(0,60000),links:links.slice(0,1500),searchLinks:searchLinks.slice(0,60),searchNoResults,mediaFileLinks:mediaFileLinks.slice(0,12),media:media.slice(0,40),author:(author?.content||text(author)).slice(0,1000),licenseUrl:license?.href||license?.content||'',licenseText:text(license),durationSeconds:duration};
})()`;

export function createDocumentaryPublicBrowser(youtubeStore?:DocumentaryYouTubeNetworkStore):PublicPageReader {
 const blocked=new Map<string,number>();
 const prepareSession=(partition:string,youtubeProxy=false)=>{
 const isolated=session.fromPartition(partition); // in-memory; never Chrome's profile
 isolated.setPermissionRequestHandler((_wc,_permission,reply)=>reply(false));
 isolated.setPermissionCheckHandler(()=>false);
 isolated.on('will-download',(event,item)=>{event.preventDefault();item.cancel();});
 const hosts=new Map<string,Promise<boolean>>();
 isolated.webRequest.onBeforeRequest((details,reply)=>{
  let url:URL;try{url=new URL(details.url);}catch{reply({cancel:true});return;}
  if(url.protocol==='data:'||url.href==='about:blank'){reply({cancel:false});return;}
  if(url.protocol!=='https:'||(blocked.get(url.hostname)??0)>Date.now()){reply({cancel:true});return;}
  // Only this separate YouTube session trusts the fixed official host list.
  // It never resolves the destination locally or visits arbitrary sources.
  if(youtubeProxy){reply({cancel:!officialYouTubePublicUrl(url.href)});return;}
  let checked=hosts.get(url.host);if(!checked){checked=publicMediaUrl(url.origin).then(()=>true,()=>false);hosts.set(url.host,checked);}
  void checked.then(ok=>reply({cancel:!ok}));
 });
 isolated.webRequest.onHeadersReceived((details,reply)=>{
  if(details.statusCode===429||details.statusCode===403){const host=new URL(details.url).hostname;
   const retry=Object.entries(details.responseHeaders??{}).find(([key])=>key.toLowerCase()==='retry-after')?.[1]?.[0]??null;
   blocked.set(host,Math.max(blocked.get(host)??0,Date.now()+publicBrowserRetryAfter(retry)));}
  reply({});
 });
 return isolated;
 };
 const isolated=prepareSession('goldwork-public-web');
 const youtubeSession=prepareSession('goldwork-public-youtube-proxy',true);
 // Reserve one reader for Commons. Round-robin put a ready File page
 // behind a slow Archive/YouTube navigation on the other slot.
 // Both lanes stay bounded; completed scenes cancel queued reads.
 const tails:Promise<unknown>[]=[Promise.resolve(),Promise.resolve()];
 return withPublicBrowserDomainPauses((value,signal)=>{
  const slot=new URL(value).hostname==='commons.wikimedia.org'?0:1;
  const work=tails[slot]!.catch(()=>{}).then(async()=>{
   signal?.throwIfAborted();
   const requested=new URL(value);
   if((blocked.get(requested.hostname)??0)>Date.now())throw Error('Вебпоиск недоступен: сайт приостановлен; действует пауза.');
   const proxy=requested.hostname==='www.youtube.com'&&officialYouTubePublicUrl(value)?await documentaryYouTubePublicProxy(youtubeStore):undefined;
   const bridge=proxy?await createAuthenticatedProxyBridge(proxy,{host:'www.youtube.com',port:443}):undefined;
   try {
   signal?.throwIfAborted();
   const url=bridge?officialYouTubePublicUrl(value)!:await publicMediaUrl(value);
   if((blocked.get(url.hostname)??0)>Date.now())throw Error('Вебпоиск недоступен: сайт ограничил доступ; действует пауза.');
   if(bridge)await youtubeSession.setProxy({mode:'fixed_servers',proxyRules:bridge.proxyUrl,proxyBypassRules:'<-loopback>'});
   signal?.throwIfAborted();
   const win=new BrowserWindow({show:false,webPreferences:{session:bridge?youtubeSession:isolated,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
   win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
   win.webContents.on('will-attach-webview',event=>event.preventDefault());
   const abort=()=>{if(!win.isDestroyed())win.destroy();};signal?.addEventListener('abort',abort,{once:true});
   let timedOut=false;
   const timer=setTimeout(()=>{timedOut=true;abort();},20000);
   try{
    await win.loadURL(url.href).catch(async(error:Error)=>{
     // YouTube can replace its URL during initial theme navigation.
     if(!error.message.includes('ERR_ABORTED')||win.isDestroyed())throw error;
     if(win.webContents.isLoadingMainFrame())await new Promise<void>((done,reject)=>{
      win.webContents.once('did-finish-load',()=>done());win.once('closed',()=>reject(Error('Вебпоиск недоступен: таймаут страницы')));
     });
    });
    return await waitForPublicBrowserPage(url,async()=>{
    signal?.throwIfAborted();if(win.isDestroyed())throw new DocumentaryPublicPageNotReadyError(url.hostname);
    const page=await win.webContents.executeJavaScript(snapshot) as PublicPage;
    signal?.throwIfAborted();
    const challenge=/verify you are human|unusual traffic|solve (?:the |this )?(?:challenge|captcha)|подтвердите.{0,30}(?:не робот|человек)|решите испытание ниже|checking your browser|access denied|sign in to confirm you.re not a bot/i.test(page.text+' '+page.title);
    if(challenge||(blocked.get(new URL(page.url).hostname)??0)>Date.now()){
     const until=Math.max(blocked.get(url.hostname)??0,blocked.get(new URL(page.url).hostname)??0,Date.now()+5*60000);
     blocked.set(url.hostname,until);throw Error(`Вебпоиск недоступен: CAPTCHA/проверка безопасности или ограничение сайта. Пауза ${Math.ceil((until-Date.now())/1000)} с.`);
    }
    return page;
    },signal);
   }catch(error){
    signal?.throwIfAborted();
    if(timedOut||error instanceof DocumentaryPublicPageNotReadyError){
     blocked.set(url.hostname,Math.max(blocked.get(url.hostname)??0,Date.now()+120000));
     throw new DocumentaryPublicPageNotReadyError(url.hostname);
    }
    throw error;
   }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);abort();}
   }finally{await bridge?.close();}
  });tails[slot]=work;
  if(!signal)return work;
  // Stop cancels queued readers immediately, before their browser slot opens.
  return new Promise<PublicPage>((done,reject)=>{
   const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});
   if(signal.aborted)abort();
   void work.then(done,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
 },blocked);
}
