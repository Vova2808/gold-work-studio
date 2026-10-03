// Bounded continuation of eight unfinished scenes; existing voice/media/checkpoints stay in place.
import {app,BrowserWindow,ipcMain} from 'electron';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
// A harness failure belongs in its terminal, not in Electron's native error dialog.
const fail=error=>{console.error(error);app.exit(1);};
process.on('uncaughtException',fail);process.on('unhandledRejection',fail);
const profile='C:/Users/rosup/AppData/Roaming/@gold-work/desktop';
const out=resolve('captures/stock-stall-20260927');await mkdir(out,{recursive:true});
const id='project_mujq2wnq_4gdz3f3',source=JSON.parse(await readFile(join(profile,'projects.json'),'utf8')).find(p=>p.id===id);
const orders=process.argv.find(s=>s.startsWith('--scenes='))?.split('=')[1].split(/[,\s]+/).map(Number);
if(orders)assert.ok(orders.length&&orders.every(n=>Number.isInteger(n)&&n>0),'Scene numbers must be positive integers');
const rejectCurrent=process.argv.includes('--reject-current');
const mapCorrection=process.argv.includes('--map-correction');
const replaceRepeats=process.argv.includes('--replace-repeats');
if(rejectCurrent)assert.equal(orders?.length,1,'A visual correction must target one explicit scene');
if(replaceRepeats)assert.ok(orders?.length&&orders.length<=8,'A repetition check must target at most eight explicit scenes');
const sceneIds=source.scenes.filter(s=>s.includeInAssembly!==false&&(!s.documentary?.verified||rejectCurrent||replaceRepeats)&&!s.documentary?.pinned&&(!orders||orders.includes(s.order+1))).sort((a,b)=>a.order-b.order).slice(0,8).map(s=>s.id);
if(replaceRepeats)await writeFile(join(out,'repetition-before.json'),JSON.stringify(source.scenes.filter(s=>sceneIds.includes(s.id)),null,2));
assert.ok(sceneIds.length>0&&sceneIds.length<=8);assert.ok(source.scenes.every(s=>s.audioPath));
const handlers=new Map(),handle=ipcMain.handle;
ipcMain.handle=function(channel,callback){handlers.set(channel,callback);return handle.call(this,channel,callback);};
app.setPath('userData',profile);delete process.env.ELECTRON_RENDERER_URL;delete process.env.PORTABLE_EXECUTABLE_DIR;
createRequire(import.meta.url)(resolve('dist/main/index.cjs'));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
  let win;for(let i=0;i<150;i++){win=BrowserWindow.getAllWindows()[0];if(win&&!win.webContents.isLoadingMainFrame())break;await wait(100);}assert.ok(win);
  const call=(channel,...args)=>handlers.get(channel)({sender:win.webContents},...args);
  if(rejectCurrent){
    await writeFile(join(out,mapCorrection?'map-before.json':'active-item-before.json'),JSON.stringify(source.scenes.find(s=>s.id===sceneIds[0]),null,2));
    await call('documentary:review',id,sceneIds[0],{verified:false,illustrative:false,note:mapCorrection
      ?'Визуальная проверка: карта Средиземного моря не соответствует маршруту через Америку. Нужен повторный автоматический подбор с проверкой видимой географии.'
      :'Визуальная проверка Final: чертёж водосброса не изображает активный пункт «дождь». Требуется повторный автоматический подбор с проверкой конкретного пункта.'});
  }
  const started=Date.now(),samples=[];let progress,stopRequested=false;
  const send=win.webContents.send;win.webContents.send=function(channel,...args){if(channel==='stock:auto-progress')progress=args[0];return send.call(this,channel,...args);};
  let stopJob;
  const stop=async()=>{if(!stopJob){stopRequested=true;const at=Date.now();stopJob=call('queue:stop',id).then(()=>{console.log(JSON.stringify({stoppedAfterMs:Date.now()-at}));});}return stopJob;};
  const maxSeconds=Number(process.argv.find(s=>s.startsWith('--seconds='))?.split('=')[1]??600);
  const deadline=setTimeout(()=>{void stop();},maxSeconds*1000);
  const stopFlag=join(out,'stop-live-check.flag');
  const stopPoll=setInterval(()=>{void stat(stopFlag).then(()=>stop(),()=>{});},1000);
  const sampler=setInterval(()=>{const sample={elapsedSeconds:Math.round((Date.now()-started)/1000),progress:progress?{phase:progress.phase,completed:progress.completed,selected:progress.selected,failed:progress.failed,message:progress.message}:undefined,processes:app.getAppMetrics().map(m=>({type:m.type,ramMiB:Math.round(m.memory.workingSetSize/1024)}))};samples.push(sample);console.log(JSON.stringify(sample));},30000);
  let outcome;
  try{
    const result=await call('stock:auto-select',id,{sceneIds,...(replaceRepeats?{force:true}:{})});
    outcome={status:'complete',selected:result.selected,skipped:result.skipped,failed:result.failed,failures:result.failures?.map(f=>({sceneNumber:f.sceneNumber,category:f.category,message:f.message}))};
  }catch(error){outcome={status:stopRequested?'bounded-stop':'failed',error:String(error)};}
  finally{clearTimeout(deadline);clearInterval(sampler);clearInterval(stopPoll);await stopJob;}
  const current=JSON.parse(await readFile(join(profile,'projects.json'),'utf8')).find(p=>p.id===id);
  try {
    assert.deepEqual(current.scenes.map(s=>s.audioPath),source.scenes.map(s=>s.audioPath));
    // Opening the preview regenerates range posters and Playback proxies.
    // Compare originals and edits, rather than these derived preview paths.
    for(const s of source.scenes.filter(s=>s.documentary?.verified&&!sceneIds.includes(s.id))){const now=current.scenes.find(x=>x.id===s.id);
      assert.deepEqual([now.videoPath,now.documentary?.selected?.id,now.documentary?.selected?.localPath,now.documentary?.checksum,now.trimStartSeconds,now.trimEndSeconds],
        [s.videoPath,s.documentary?.selected?.id,s.documentary?.selected?.localPath,s.documentary?.checksum,s.trimStartSeconds,s.trimEndSeconds]);}
  } catch(error){outcome={status:'failed',error:String(error)};}
  const result={buildId:(await call('app:info')).buildId,elapsedSeconds:(Date.now()-started)/1000,testedScenes:sceneIds.map(id=>source.scenes.find(s=>s.id===id).order+1),outcome,verifiedBefore:source.scenes.filter(s=>s.documentary?.verified).length,verifiedAfter:current.scenes.filter(s=>s.documentary?.verified).length,voicePreserved:true,samples};
  await writeFile(join(out,mapCorrection?'live-map-result.json':replaceRepeats?'live-repetition-result.json':process.argv.includes('--active-item-resume')?'live-active-item-resume-result.json':rejectCurrent?'live-active-item-result.json':orders?'live-explanatory-result.json':'live-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,samples:undefined}));app.exit(outcome.status==='complete'?0:1);
});
