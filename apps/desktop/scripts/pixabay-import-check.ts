// Native download/import contract with local HTTP responses, not a live-site acceptance.
import assert from 'node:assert/strict';
import {app,BrowserWindow,session} from 'electron';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {choosePixabayMusic} from '../src/pixabay-music-window.js';
import {effectFfmpeg,probeEffectMedia} from '../src/effect-media.js';
app.on('window-all-closed',()=>{});
void(async()=>{
  const root=resolve('captures/montage-speed-20260927/new-production/music-import-20260930');await mkdir(root,{recursive:true});
  app.setPath('userData',join(root,'profile'));await app.whenReady();
  const timer=setTimeout(()=>{console.error('Music import timeout');app.exit(1);},45000);
  try{
    const tone=join(root,'test-tone.wav');await effectFfmpeg(['-y','-f','lavfi','-i','sine=frequency=330:duration=1',tone]);const bytes=await readFile(tone);
    const musicSession=session.fromPartition('persist:gws-pixabay-music');
    musicSession.protocol.handle('https',request=>request.url.includes('/download/')
      ?new Response(bytes,{headers:{'Content-Type':'audio/wav','Content-Disposition':'attachment; filename="local-qa.wav"'}})
      :new Response('<!doctype html><title>LOCAL QA — music import</title><a href="https://pixabay.com/download/local-qa.wav" download="local-qa.wav">Download local test tone</a>',{headers:{'Content-Type':'text/html'}}));
    const pending=choosePixabayMusic(join(root,'library'),'local-qa');
    let window:BrowserWindow|undefined;
    for(let i=0;i<100;i++){window=BrowserWindow.getAllWindows()[0];if(window&&!window.webContents.isLoadingMainFrame()&&window.webContents.getTitle().startsWith('LOCAL QA'))break;await new Promise(r=>setTimeout(r,100));}
    assert.ok(window);await window.webContents.executeJavaScript(`document.querySelector('a').click()`,true);
    const selected=await pending;assert.ok(selected);assert.match(selected.path,/library[\\/][a-f0-9]{64}\.wav$/);
    assert.deepEqual(await readFile(selected.path),bytes);assert.ok((await probeEffectMedia(selected.path)).hasAudio);
    const provenance=JSON.parse(await readFile(selected.path+'.source.json','utf8'));assert.equal(provenance.provider,'pixabay');assert.equal(provenance.sourcePage,'https://pixabay.com/music/search/local-qa/');
    for(let i=0;i<10&&(await readdir(join(root,'library/Downloads'))).length;i++)await new Promise(r=>setTimeout(r,50));
    assert.deepEqual(await readdir(join(root,'library/Downloads')),[]);
    const result={at:new Date().toISOString(),nativeDownloadImported:true,checksumAndAudioPreserved:true,sourceRecorded:true,temporaryDownloadRemoved:true,liveProvider:false,paidRequests:0};
    await writeFile(join(root,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));clearTimeout(timer);app.exit(0);
  }catch(error){console.error(error);app.exit(1);}
})();
