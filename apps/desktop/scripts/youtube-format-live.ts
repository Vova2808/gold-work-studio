// Zero-AnyModel probe of the already rejected motorcycle source. It calls the
// product downloader with existing account settings and keeps a small receipt.
import assert from 'node:assert/strict';
import {app} from 'electron';
import {createHash} from 'node:crypto';
import {copyFileSync,existsSync,mkdirSync} from 'node:fs';
import {readFile,readdir,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {atomicWrite} from '../src/fs-utils.js';
import {YouTubeStore} from '../src/youtube-store.js';
import {DocumentaryYouTube} from '../src/documentary-youtube.js';

const projectId='project_mun42rx8_1jcven5';
const sceneId='doc-38f3690077ac87862325';
const sourceHash='c8d4be8f32ee1ff2858398bf919d0e4a3b7ec0f56f335640016eaf2d4b31f2d9';
const root=resolve('captures/montage-speed-20260927/new-production/motorcycle-live-20261001');
const out=join(root,'narrow-youtube-format-probe');
assert.ok(!existsSync(join(out,'result.json')),'Probe already completed');
mkdirSync(out,{recursive:true});
const profile=join(process.env.APPDATA!,'@gold-work/desktop');
const temporary=join(out,'electron-profile');mkdirSync(temporary,{recursive:true});
copyFileSync(join(profile,'Local State'),join(temporary,'Local State'));
app.setPath('userData',temporary);
app.on('window-all-closed',()=>undefined);

app.whenReady().then(async()=>{
  const path=join('D:/GoldWorkStorage/projects',projectId,'Documentary',sceneId,`${sourceHash}.source.json`);
  const original=await readFile(path);
  const candidate=JSON.parse(original.toString('utf8'));
  assert.equal(candidate.id,'youtube:_Df0TEWoyZc');
  assert.equal(candidate.provider,'youtube');
  const destination=join(out,'original.download');
  const started=Date.now();let failure:string|undefined;
  try{
    await new DocumentaryYouTube(new YouTubeStore(join(profile,'credentials/youtube.json')))
      .download(candidate,destination,AbortSignal.timeout(90000),undefined,true);
  }catch(error){failure=String(error).replace(/https?:\/\/\S+/g,'[source]').slice(0,600);}
  const bytes=async(directory:string)=>{
    let sum=0;
    for(const entry of await readdir(directory,{withFileTypes:true}).catch(()=>[])){
      if(entry.isFile())sum+=(await stat(join(directory,entry.name))).size;
      else if(entry.isDirectory())sum+=await bytes(join(directory,entry.name));
    }
    return sum;
  };
  const result={projectId,sceneId,sourceId:candidate.id,elapsedSeconds:(Date.now()-started)/1000,
    failure,downloadedBytes:(await stat(destination).catch(()=>undefined))?.size??0,
    partialBytes:await bytes(`${destination}.resume`),anyModelPosts:0,
    sourceOriginalUnchanged:createHash('sha256').update(await readFile(path)).digest('hex')===createHash('sha256').update(original).digest('hex')};
  await atomicWrite(join(out,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));app.exit();
}).catch(error=>{console.error(String(error).replace(/https?:\/\/\S+/g,'[source]'));app.exit(1);});
