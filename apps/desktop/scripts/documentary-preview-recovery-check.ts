// Reproduce one empty YouTube preview; no paid model or production mutation.
import {app} from 'electron';
import assert from 'node:assert/strict';
import {copyFile,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {DocumentaryYouTube} from '../src/documentary-youtube.js';
import {YouTubeStore} from '../src/youtube-store.js';
import {probeEffectMedia,effectFfmpeg} from '../src/effect-media.js';

const [candidateFile,output]=process.argv.slice(2);
assert.ok(candidateFile&&output,'Pass a saved candidate and a new output directory');
const root=resolve(output),profile=join(process.env.APPDATA!,'@gold-work/desktop');
await mkdir(root,{recursive:true});
await writeFile(join(root,'started.json'),JSON.stringify({at:new Date().toISOString(),paidPosts:0}),{flag:'wx'});
const temporary=join(root,'electron-profile');await mkdir(temporary,{recursive:true});
await copyFile(join(profile,'Local State'),join(temporary,'Local State'));app.setPath('userData',temporary);
app.whenReady().then(async()=>{
  const started=Date.now(),candidate=JSON.parse(await readFile(candidateFile,'utf8'));
  const youtube=new DocumentaryYouTube(new YouTubeStore(join(profile,'credentials/youtube.json')));
  try{
    const preview=await youtube.preview(candidate,root,AbortSignal.timeout(45_000));
    const media=[];
    for(const [index,segment] of preview.segments.entries()){
      const info=await probeEffectMedia(segment.path);
      assert.ok(info.videoCodec&&info.durationSeconds>=.5);
      const poster=join(root,`frame-${index}.jpg`);
      await effectFfmpeg(['-y','-ss','0.2','-i',segment.path,'-frames:v','1',poster]);
      media.push({start:segment.start,end:segment.end,seconds:info.durationSeconds,width:info.width,height:info.height,poster});
    }
    const result={success:true,seconds:(Date.now()-started)/1000,bytes:preview.bytes,paidPosts:0,media};
    await writeFile(join(root,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  }catch(error){
    const result={success:false,seconds:(Date.now()-started)/1000,paidPosts:0,error:String(error).replace(/https?:\/\/\S+/g,'[source]').slice(-1400)};
    await writeFile(join(root,'result.json'),JSON.stringify(result,null,2));throw error;
  }
}).then(()=>app.exit(),error=>{console.error(String(error).replace(/https?:\/\/\S+/g,'[source]').slice(-1400));app.exit(1);});
