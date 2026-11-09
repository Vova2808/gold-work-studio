import {parseProxyUrl,proxyFetch} from './proxy-utils.js';

/** No saved proxy retains the system route. A failed configured proxy never falls
 * back to the machine's direct route or rewrites the saved settings. */
export function createDocumentarySourceFetcher(readProxyUrl:()=>Promise<string|undefined>,transport=proxyFetch,direct:typeof globalThis.fetch=globalThis.fetch):typeof globalThis.fetch {
  return async(input,init)=>{
    const value=await readProxyUrl();
    if(!value?.trim())return direct(input,init);
    const proxy=parseProxyUrl(value);
    if(!proxy)throw new Error('Некорректный сохранённый прокси публичных материалов.');
    return transport(input,init,proxy);
  };
}
