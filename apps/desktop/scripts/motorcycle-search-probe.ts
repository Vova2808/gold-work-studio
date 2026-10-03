import {app} from 'electron';
import {copyFileSync,mkdirSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {StockStore} from '../src/stock-store.js';
import {StockClient} from '../src/stock-client.js';
import {YouTubeStore} from '../src/youtube-store.js';
import {DocumentaryYouTube} from '../src/documentary-youtube.js';
import {DocumentarySearch} from '../src/documentary-search.js';

const profile=join(process.env.APPDATA!,'@gold-work/desktop');
const out=resolve('captures/montage-speed-20260927/new-production/motorcycle-live-20261001/search-probe-evening');
mkdirSync(join(out,'profile'),{recursive:true});
copyFileSync(join(profile,'Local State'),join(out,'profile/Local State'));
app.setPath('userData',join(out,'profile'));app.on('window-all-closed',()=>undefined);
app.whenReady().then(async()=>{
  const useCache=process.argv.includes('--use-cache');
  const search=new DocumentarySearch(new StockClient(new StockStore(join(profile,'credentials/stock.json'))),globalThis.fetch,
    useCache?join(profile,'cache/documentary'):undefined,undefined,new DocumentaryYouTube(new YouTubeStore(join(profile,'credentials/youtube.json'))));
  const query=process.argv.find(arg=>arg.startsWith('--query='))?.slice(8);
  const kind=process.argv.includes('--image')?'image' as const:'video' as const;
  const providers=['youtube','commons','internet-archive','pexels','pixabay'] as const;
  if(query){
    const selected=process.argv.includes('--youtube-only')?providers.filter(provider=>provider==='youtube'):
      providers.filter(provider=>kind==='video'||provider!=='youtube');
    const results=await Promise.all(selected.map(async provider=>{
      const started=performance.now();
      const result=await search.search({query,kind,providers:[provider]},true);
      return {provider,seconds:(performance.now()-started)/1000,count:result.candidates.length,
        examples:result.candidates.slice(0,12).map(candidate=>({id:candidate.id,title:candidate.title,
          durationSeconds:candidate.durationSeconds,width:candidate.width,height:candidate.height,rights:candidate.rights})),
        error:result.sources[0]?.error?.replace(/https?:\/\/\S+/g,'[source]')};
    }));
    const result={at:new Date().toISOString(),query,kind,paidRequests:0,documentarySearchCache:useCache,results};
    const file=join(out,`result-${Date.now()}.json`);
    await writeFile(file,JSON.stringify(result,null,2));console.log(JSON.stringify({file,...result}));app.exit(0);return;
  }
  const results=[];
  for(const input of [{query:'Valentino Rossi Honda 2003',kind:'video' as const,providers:['youtube' as const]}, {query:'Yamaha YZR-M1',kind:'image' as const,providers:['commons' as const,'pixabay' as const]}]){
    const start=performance.now(),result=await search.search(input);
    results.push({query:input.query,kind:input.kind,seconds:(performance.now()-start)/1000,sources:result.sources.map(s=>({...s,error:s.error?.replace(/https?:\/\/\S+/g,'[source]')}))});
  }
  const result={at:new Date().toISOString(),paidRequests:0,documentarySearchCache:false,results};
  await writeFile(join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));app.exit(0);
}).catch(error=>{console.error(String(error).replace(/https?:\/\/\S+/g,'[source]'));app.exit(1);});
