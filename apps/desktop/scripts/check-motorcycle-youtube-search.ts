// Read-only source availability check for the existing motorcycle script.
// Outputs metadata only: no provider key, source URL, download or paid analysis.
import {app} from 'electron';
import {join} from 'node:path';
import {copyFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {DocumentaryYouTube} from '../src/documentary-youtube.js';
import {YouTubeStore} from '../src/youtube-store.js';

const profile=join(process.env.APPDATA!,'@gold-work/desktop');
const output=join(process.cwd(),'captures/montage-speed-20260927/new-production/motorcycle-live-20261001/youtube-search-oct04');
const isolated=join(output,'profile');
mkdirSync(isolated,{recursive:true});
copyFileSync(join(profile,'Local State'),join(isolated,'Local State'));
app.setPath('userData',isolated);
app.whenReady().then(async()=>{
  const youtube=new DocumentaryYouTube(new YouTubeStore(join(profile,'credentials/youtube.json')));
  const measured:unknown[]=[];
  for(const query of ['Yamaha YZF-R1 2009','Yamaha YZF-R1','2009 Yamaha R1 crossplane showroom']){
    const started=performance.now();
    try{
      const candidates=await youtube.search(query);
      const result={query,seconds:Math.round(performance.now()-started)/1000,count:candidates.length,
        results:candidates.map(item=>({title:item.title.slice(0,130),durationSeconds:item.durationSeconds,
          definition:item.videoDefinition,years:[...new Set(item.title.match(/\b(?:1[89]|20)\d{2}\b/g)??[])]}))};
      measured.push(result);console.log(JSON.stringify(result));
    }catch(error){const result={query,seconds:Math.round(performance.now()-started)/1000,
      error:error instanceof Error?error.message.slice(0,200):'Search failed'};
      measured.push(result);console.log(JSON.stringify(result));}
  }
  writeFileSync(join(output,'result.json'),JSON.stringify({at:new Date().toISOString(),projectId:'project_mun42rx8_1jcven5',
    check:'YouTube CC search metadata only; no download or AnyModel analysis',queries:measured},null,2));
  app.quit();
}).catch(error=>{console.error(error instanceof Error?error.name:'Search failed');app.exit(1);});
