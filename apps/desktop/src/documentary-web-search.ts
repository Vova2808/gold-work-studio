import { createHash } from 'node:crypto';
import type { DocumentaryCandidate } from '@gold-work/shared';
import type { PublicPage,PublicPageReader } from './documentary-public-browser.js';
import {assertPublicBrowserPageReady} from './documentary-public-browser-ready.js';
import {recordDiagnosticEvent} from './diagnostics.js';

export function publicSearchLink(value:string):string {
 try{let url=new URL(value);
  if(url.hostname==='www.bing.com'&&url.pathname==='/ck/a'){const encoded=url.searchParams.get('u');if(!encoded?.startsWith('a1'))return '';url=new URL(Buffer.from(encoded.slice(2),'base64url').toString());}
  return url.protocol==='https:'&&!url.username&&!url.password?url.href:'';
 }catch{return '';}
}
const mediaKind=(value:string):'image'|'video'|undefined=>/\.(?:mp4|webm|ogv|mov)(?:[?#]|$)/i.test(value)?'video':/\.(?:jpe?g|png|webp|gif)(?:[?#]|$)/i.test(value)?'image':undefined;
function wikiFileName(value:string):string {
 try{
  const url=new URL(value),path=decodeURIComponent(url.pathname).normalize('NFC');
  if(/^(?:commons\.wikimedia\.org|[a-z-]+\.wikipedia\.org)$/.test(url.hostname)&&path.startsWith('/wiki/File:'))return path.slice(11).replace(/_/g,' ');
  if(url.hostname==='upload.wikimedia.org'){
   const parts=path.split('/');return (/\/(?:thumb|transcoded)\//.test(path)?parts.at(-2):parts.at(-1))?.replace(/_/g,' ')??'';
  }
 }catch{}
 return '';
}
function sourceRights(page:PublicPage):Pick<DocumentaryCandidate,'rights'|'license'|'licenseUrl'> {
 const url=publicSearchLink(page.licenseUrl.replace(/^http:\/\/(?=(?:www\.)?creativecommons\.org\/)/,'https://'));let path='';try{const u=new URL(url);if(/^(?:www\.)?creativecommons.org$/.test(u.hostname))path=u.pathname;}catch{}
 // Ported 2.x/3.0 licenses add a country segment before the optional deed.
 // Keep the source's actual license/attribution; do not relabel it International.
 const attributionLicense=/^\/licenses\/by(?:-sa)?\/[\d.]+\/(?:deed\.[a-z-]+)?$/.test(path)
  ||/^\/licenses\/by(?:-sa)?\/(?:2\.0|2\.5|3\.0)\/[a-z]{2}\/(?:deed\.[a-z-]+)?$/.test(path);
 return attributionLicense?{rights:'licensed',license:page.licenseText||'Creative Commons Attribution',licenseUrl:url}
  :/^\/publicdomain\/(?:zero|mark)\/1\.0\/?$/.test(path)?{rights:'public-domain',license:page.licenseText||'Public domain (source declaration)',licenseUrl:url}
  :{rights:'unknown',license:'Условия не подтверждены',licenseUrl:url};
}
export function publicPageCandidates(page:PublicPage,query:string,kind:'image'|'video'):DocumentaryCandidate[]{
 const commons=/^https:\/\/commons.wikimedia.org\/wiki\/File:/i.test(page.url);
 const archive=/^https:\/\/archive.org\/details\//i.test(page.url);
 let originals;
 if(commons){
  const name=wikiFileName(page.url);
  const versions=page.media.filter(file=>file.kind===kind && /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\//.test(file.url) && wikiFileName(file.url)===name);
  const best=versions.find(file=>!/\/(?:thumb|transcoded)\//.test(new URL(file.url).pathname))??versions[0];
  originals=best?[best]:[];
 }else{
  originals=[...page.media,...page.links.filter(link=>mediaKind(link.url)===kind).map(link=>({url:link.url,kind}))];
 }
 const seen=new Set<string>();
 return originals.flatMap(file=>{const url=publicSearchLink(file.url);if(!url||file.kind!==kind||seen.has(url))return [];seen.add(url);
  // Page text/footer licenses never establish rights to arbitrary linked media.
  const associated=commons||archive&&new URL(url).hostname==='archive.org'&&new URL(url).pathname.startsWith(new URL(page.url).pathname.replace('/details/','/download/')+'/');
  const rights=associated?sourceRights(page):{rights:'unknown' as const,license:'Условия не подтверждены',licenseUrl:''};
  return [{id:'web:'+createHash('sha256').update(url).digest('hex').slice(0,24),provider:'web' as const,kind,title:page.title,description:page.text.slice(0,6000),pageUrl:page.url,downloadUrl:url,durationSeconds:page.durationSeconds,
   previewUrl:kind==='image'?url:undefined,author:page.author,...rights,attribution:[page.title,page.author,page.url,rights.licenseUrl].filter(Boolean).join(' · '),query,retrievedAt:new Date().toISOString(),
   discovery:'public-web' as const,match:'unverified' as const,concerns:['Публичная страница источника; содержание, дата и качество требуют проверки оригинала']}];
 }).slice(0,8);
}

export class DocumentaryWebSearch {
 constructor(private readonly read:PublicPageReader,private readonly youtube?:{publicCandidate(url:string,query:string,signal?:AbortSignal):Promise<DocumentaryCandidate[]>;publicAvailable?():boolean}){}
 async search(query:string,kind:'image'|'video'='video',signal?:AbortSignal):Promise<DocumentaryCandidate[]>{
  return (await this.searchWithSources(query,kind,signal)).candidates;
 }
 async searchWithSources(query:string,kind:'image'|'video'='video',signal?:AbortSignal,source?:DocumentaryCandidate['provider']):Promise<{candidates:DocumentaryCandidate[];errors:string[]}>{
  if(query.trim().length<2||query.length>240)throw Error('Некорректный запрос вебпоиска');
  const externalSignal=signal;
  signal=AbortSignal.any([AbortSignal.timeout(65000),...(signal?[signal]:[])]);
  const resolvedLinks=new Map<string,Promise<DocumentaryCandidate[]>>();
  const routes=[
   ...(kind==='video'&&this.youtube?.publicAvailable?.()!==false&&(!source||source==='youtube')?[`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIwAQ%253D%253D`]:[]),
   // The ordinary search is rendered by MediaWiki itself. MediaSearch's
   // JavaScript shell can finish loading without ever exposing File links.
   ...(!source||source==='commons'?[`https://commons.wikimedia.org/w/index.php?title=Special:Search&ns6=1&search=${encodeURIComponent(query+' '+(kind==='video'?'filetype:video':'filetype:bitmap'))}`]:[]),
   ...(!source||source==='internet-archive'?[`https://archive.org/search?query=${encodeURIComponent(query)}&and[]=mediatype%3A${kind==='video'?'movies':'image'}`]:[]),
   ...(!source||source==='web'||source==='loc'?[`https://www.bing.com/search?q=${encodeURIComponent((source==='loc'?'site:loc.gov ':'')+query+' '+(kind==='video'?'video footage':'photo')+(source==='web'?' -site:gettyimages.com -site:shutterstock.com -site:alamy.com -site:dreamstime.com':''))}`]:[])];
  // Automatic selection asks for each source independently, so a ready
  // Commons file does not wait for YouTube, Archive or a general web page.
  const results=await Promise.all(routes.map(async route=>{
   const errors:string[]=[],candidates:DocumentaryCandidate[]=[],seen=new Set<string>(),candidateIds=new Set<string>();
   try{signal?.throwIfAborted();
   const page=await this.read(route,signal);signal?.throwIfAborted();
   assertPublicBrowserPageReady(new URL(route),page);
   let links=(new URL(route).hostname==='archive.org'||new URL(route).hostname==='www.bing.com'?page.searchLinks??[]:page.links).map(link=>publicSearchLink(link.url)).filter(Boolean);
   const host=new URL(route).hostname;
   if(host==='www.youtube.com')links=links.filter(url=>/^https:\/\/www.youtube.com\/watch\?v=[\w-]{11}/.test(url));
   else if(host==='commons.wikimedia.org')links=links.filter(url=>/^https:\/\/commons.wikimedia.org\/wiki\/File:/i.test(url));
   else if(host==='archive.org')links=links.filter(url=>/^https:\/\/archive.org\/details\/[^/?#]+\/?$/.test(url));
   else links=links.filter(url=>!/(?:^|\.)(?:bing\.com|microsoft\.com)$/.test(new URL(url).hostname)
    &&!(source==='web'&&/(?:^|\.)(?:gettyimages|shutterstock|alamy|dreamstime|depositphotos|istockphoto)\.[a-z.]+$/i.test(new URL(url).hostname)));
   if(!links.length&&!(host==='archive.org'&&page.searchNoResults===true))errors.push(`${host}: публичная страница поиска не вернула доступных ссылок на материалы`);
   for(const link of [...new Set(links)].slice(0,host==='commons.wikimedia.org'?10:host==='www.youtube.com'?4:2)){
    const canonical=/^https:\/\/www.youtube.com\/watch\?v=/.test(link)?'https://www.youtube.com/watch?v='+new URL(link).searchParams.get('v'):link;
    if(seen.has(canonical))continue;seen.add(canonical);
    try{
     let work=resolvedLinks.get(canonical);
     if(!work){work=(async()=>{
     if(/^https:\/\/www.youtube.com\/watch\?v=/.test(canonical)&&this.youtube)return this.youtube.publicCandidate(canonical,query,signal);
     const source=await this.read(link,signal);let found=publicPageCandidates(source,query,kind);
     if(!found.length&&new URL(link).hostname==='archive.org'&&new URL(link).pathname.startsWith('/details/')){
      const id=new URL(link).pathname.split('/')[2];const listing=await this.read(`https://archive.org/download/${id}/`,signal);
      found=publicPageCandidates({...source,media:listing.media,links:listing.links,durationSeconds:undefined},query,kind);
     }
     // An article's og:image is unknown-rights, not a reason to skip its
     // actual image/file links. Never choose an unrelated Commons footer link.
     if(kind==='image'&&/\.wikipedia\.org$/.test(new URL(source.url).hostname)){
      const names=new Set(source.media.map(file=>wikiFileName(file.url)).filter(Boolean));
      const files=[...(wikiFileName(source.url)?[source.url]:[]),
       ...(source.mediaFileLinks??[]).map(l=>publicSearchLink(l.url)),
       ...source.links.map(l=>publicSearchLink(l.url)).filter(url=>names.has(wikiFileName(url)))];
      for(const file of [...new Set(files)].filter(url=>wikiFileName(url)).slice(0,3)){
       let filePage=file===source.url?source:await this.read(file,signal);
       if(/\.wikipedia\.org$/.test(new URL(filePage.url).hostname)){
        const commons=filePage.links.map(l=>publicSearchLink(l.url)).find(url=>/^https:\/\/commons.wikimedia.org\/wiki\/File:/i.test(url)&&wikiFileName(url)===wikiFileName(file));
        if(!commons)continue;
        filePage=await this.read(commons,signal);
       }
       if(/^https:\/\/commons.wikimedia.org\/wiki\/File:/i.test(filePage.url))found.push(...publicPageCandidates(filePage,query,kind));
      }
     }
     return found;
     })();resolvedLinks.set(canonical,work);}
     for(const candidate of await work){
      if(candidateIds.has(candidate.id))continue;
      candidateIds.add(candidate.id);
      candidates.push(candidate);
     }
     // Return a few distinct licensed alternatives from the same result page.
     // One already-used photo must not exhaust an otherwise useful query.
     if(source&&candidates.filter(candidate=>candidate.rights!=='unknown').length>=(host==='commons.wikimedia.org'?8:host==='www.youtube.com'?2:1))break;
    }catch(error){if(signal?.aborted)throw error;errors.push(`${new URL(link).hostname}: ${error instanceof Error?error.message:String(error)}`);}
   }
  }catch(error){if(externalSignal?.aborted)throw externalSignal.reason;
   errors.push(`${new URL(route).hostname}: ${error instanceof Error?error.message:String(error)}`);}
   return {candidates,errors};
  }));
  externalSignal?.throwIfAborted();
  const errors=results.flatMap(result=>result.errors),seen=new Set<string>();
  if(kind==='video'&&(!source||source==='youtube')&&this.youtube?.publicAvailable?.()===false&&!routes.some(route=>new URL(route).hostname==='www.youtube.com'))errors.push('www.youtube.com: публичные метаданные приостановлены после ограничения сайта');
  const candidates=results.flatMap(result=>result.candidates).filter(candidate=>{if(seen.has(candidate.id))return false;seen.add(candidate.id);return true;});
  if(errors.length)recordDiagnosticEvent('warn','documentary.search.public-web',{errors,candidates:candidates.length});
  if(!candidates.length&&errors.length)throw Error('Вебпоиск: '+errors.join('; ').slice(0,1600));
  return {candidates,errors};
 }
}
