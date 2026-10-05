// Continue the existing paid motorcycle project through the production IPC.
// The project, voices and paid checkpoints remain in the normal user profile.
import assert from 'node:assert/strict';
import {app,BrowserWindow,ipcMain} from 'electron';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {writeFileSync,existsSync} from 'node:fs';
import {freemem} from 'node:os';
import {resolve,join} from 'node:path';

const id='project_mun42rx8_1jcven5';
const profile=join(process.env.APPDATA,'@gold-work','desktop');
assert.ok(process.env.GWS_CAPTURE_DIR,'Set GWS_CAPTURE_DIR to a new capture directory; an existing run must never be overwritten');
const out=resolve(process.env.GWS_CAPTURE_DIR);
assert.ok(!existsSync(join(out,'started.json'))&&!existsSync(join(out,'result.json')),'Capture directory already contains a run');
await mkdir(out,{recursive:true});
process.on('exit',code=>{
  if(!existsSync(join(out,'result.json')))writeFileSync(join(out,'termination.json'),JSON.stringify({
    at:new Date().toISOString(),pid:process.pid,exitCode:code,
    reason:'Process ended before writing a result; inspect the captured console and OS diagnostics.'},null,2));
});
const snapshot=JSON.parse(await readFile(join(profile,'projects.json'),'utf8')).find(project=>project.id===id);
assert.ok(snapshot,'Existing motorcycle project is missing');
assert.equal(snapshot.scenes.length,246);
assert.equal(snapshot.settings.stockVideoPercent,65);
assert.ok(snapshot.scenes.every(scene=>scene.audioPath),'Existing paid voices must be present');
const voiceHash=project=>createHash('sha256').update(JSON.stringify(project.scenes.map(scene=>[scene.id,scene.narration,scene.audioPath]))).digest('hex');
const originalVoiceHash=voiceHash(snapshot);
const queue=JSON.parse(await readFile(join(profile,'queue.json'),'utf8'));
assert.ok(!queue.some(task=>['running','pending','queued','retry_wait'].includes(task.status)),'A production is already active');

const handlers=new Map();
const originalHandle=ipcMain.handle;
ipcMain.handle=function(channel,handler){handlers.set(channel,handler);return originalHandle.call(this,channel,handler);};
app.setPath('userData',profile);
app.on('browser-window-created',(_event,window)=>window.on('show',()=>window.hide()));
delete process.env.ELECTRON_RENDERER_URL;
delete process.env.PORTABLE_EXECUTABLE_DIR;
createRequire(import.meta.url)(resolve('dist/main/index.cjs'));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

app.whenReady().then(async()=>{
  let window;
  for(let n=0;n<150;n++){
    window=BrowserWindow.getAllWindows()[0];
    if(window?.webContents.getURL()&&!window.webContents.isLoadingMainFrame())break;
    await wait(100);
  }
  assert.ok(window,'Electron window did not become ready');
  let crashes=0,progress;
  window.webContents.on('render-process-gone',()=>{crashes++;});
  const send=window.webContents.send;
  window.webContents.send=function(channel,...args){if(channel==='stock:auto-progress')progress=args[0];return send.call(this,channel,...args);};
  const call=(channel,...args)=>{
    const handler=handlers.get(channel);
    assert.ok(handler,`IPC handler unavailable: ${channel}`);
    return handler({sender:window.webContents},...args);
  };
  const started=Date.now();
  const buildId=(await call('app:info')).buildId;
  await writeFile(join(out,'started.json'),JSON.stringify({at:new Date().toISOString(),pid:process.pid,buildId,projectId:id,
    verifiedBefore:snapshot.scenes.filter(scene=>scene.documentary?.verified).length,voiceHash:originalVoiceHash},null,2));
  let finished=false,error;
  const production=call('queue:start',id).then(()=>{finished=true;},reason=>{finished=true;error=reason instanceof Error?reason.message:String(reason);});
  let lastReport=0,outputPath,assembly;
  for(;;){
    await wait(5000);
    const project=await call('projects:get',id);
    const tasks=(await call('queue:list')).filter(task=>task.projectId===id);
    assembly=tasks.filter(task=>task.kind==='assemble').sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    if(Date.now()-lastReport>30000||error||assembly?.status==='done'){
      lastReport=Date.now();
      const report={at:new Date().toISOString(),buildId,elapsedSeconds:Math.round((Date.now()-started)/1000),
        verified:project.scenes.filter(scene=>scene.documentary?.verified).length,
        videos:project.scenes.filter(scene=>scene.documentary?.verified&&scene.documentary.selected?.kind==='video').length,
        voices:project.scenes.filter(scene=>scene.audioPath).length,status:project.status,
        progress:progress?{phase:progress.phase,completed:progress.completed,total:progress.total,selected:progress.selected,
          failed:progress.failed,currentSceneNumber:progress.currentSceneNumber,message:String(progress.message??'').slice(0,220)}:undefined,
        assembly:assembly?{status:assembly.status,progress:assembly.progress,stage:assembly.stage,error:assembly.error}:undefined,
        crashes,freeRamMiB:Math.round(freemem()/1048576),outputPath:project.outputPath};
      await writeFile(join(out,'progress.json'),JSON.stringify(report,null,2));
      console.log(JSON.stringify(report));
    }
    if(error)break;
    if(finished&&assembly&&['failed','blocked','cancelled','paused'].includes(assembly.status)){
      error=String(assembly.error??assembly.status);break;
    }
    if(finished&&assembly?.status==='done'&&project.outputPath){outputPath=project.outputPath;break;}
    if(Date.now()-started>6*60*60*1000){error='Production exceeded six hours; checkpoints preserved';break;}
  }
  if(error&&!finished)await call('queue:stop',id);
  await production;
  const project=await call('projects:get',id);
  const voicesPreserved=voiceHash(project)===originalVoiceHash;
  const bytes=outputPath?await stat(outputPath).then(value=>value.size,()=>0):0;
  const result={at:new Date().toISOString(),buildId,projectId:id,elapsedSeconds:(Date.now()-started)/1000,
    error,verifiedBefore:snapshot.scenes.filter(scene=>scene.documentary?.verified).length,
    verifiedAfter:project.scenes.filter(scene=>scene.documentary?.verified).length,
    voicesPreserved,crashes,outputPath:project.outputPath,bytes};
  await writeFile(join(out,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
  app.exit(error||!voicesPreserved||!bytes?1:0);
}).catch(error=>{console.error(error instanceof Error?error.stack??error.message:String(error));app.exit(1);});
