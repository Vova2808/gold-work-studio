// Continue the user's existing project through the real production handlers.
import {app,BrowserWindow,ipcMain} from 'electron';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const profile='C:/Users/rosup/AppData/Roaming/@gold-work/desktop',out=resolve('captures/stock-stall-20260927');await mkdir(out,{recursive:true});
const assemblyOnly=process.argv.includes('--assemble-only'),keepOpen=process.argv.includes('--keep-open');
const prefix=process.argv.includes('--final-pass')?'final-pass':assemblyOnly?'warm-assembly':'production';
const id='project_mujq2wnq_4gdz3f3';
const before=JSON.parse(await readFile(join(profile,'projects.json'),'utf8')).find(p=>p.id===id);
assert.equal(before.scenes.length,261);assert.ok(before.scenes.every(s=>s.audioPath));
const voices=before.scenes.map(s=>[s.id,s.narration,s.audioPath]);
const verifiedBefore=before.scenes.filter(s=>s.documentary?.verified).length;
// The harness needs fingerprints only; do not retain a second search history.
for(const scene of before.scenes)if(scene.documentary)scene.documentary.candidates=[];
const handlers=new Map(),handle=ipcMain.handle;ipcMain.handle=function(channel,handler){handlers.set(channel,handler);return handle.call(this,channel,handler);};
app.setPath('userData',profile);delete process.env.ELECTRON_RENDERER_URL;delete process.env.PORTABLE_EXECUTABLE_DIR;
createRequire(import.meta.url)(resolve('dist/main/index.cjs'));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
  let win;for(let n=0;n<150;n++){win=BrowserWindow.getAllWindows()[0];if(win&&!win.webContents.isLoadingMainFrame())break;await wait(100);}assert.ok(win);
  const call=(channel,...args)=>handlers.get(channel)({sender:win.webContents},...args);
  const interrupted=(await call('queue:list')).filter(t=>t.projectId===id&&['pending','running','retry_wait','paused','blocked'].includes(t.status));
  const resumeExport=assemblyOnly&&interrupted.length>0&&interrupted.every(t=>t.kind==='assemble'&&t.status==='paused');
  let progress,crashes=0;const send=win.webContents.send;win.webContents.send=function(channel,...args){if(channel==='stock:auto-progress')progress=args[0];return send.call(this,channel,...args);};win.webContents.on('render-process-gone',()=>crashes++);
  const started=Date.now(),buildId=(await call('app:info')).buildId;let startDone=false,startError,stopped=false,project,tasks=[];
  const production=call(resumeExport?'queue:resume':assemblyOnly?'projects:assemble':'queue:start',id).then(()=>{startDone=true;},error=>{startDone=true;startError=String(error);});
  let lastSample=0;
  for(;;){
    await wait(2000);project=await call('projects:get',id);tasks=(await call('queue:list')).filter(t=>t.projectId===id);
    const assembly=tasks.filter(t=>t.kind==='assemble').sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
    if(Date.now()-lastSample>30000){lastSample=Date.now();const report={buildId,elapsedSeconds:Math.round((Date.now()-started)/1000),verified:project.scenes.filter(s=>s.documentary?.verified).length,voices:project.scenes.filter(s=>s.audioPath).length,projectStatus:project.status,progress:progress?{phase:progress.phase,completed:progress.completed,total:progress.total,selected:progress.selected,failed:progress.failed,message:progress.message}:undefined,assembly:assembly?{status:assembly.status,progress:assembly.progress,label:assembly.stage,error:assembly.error}:undefined,crashes,processes:app.getAppMetrics().map(m=>({type:m.type,ramMiB:Math.round(m.memory.workingSetSize/1024)}))};await writeFile(join(out,`${prefix}-progress.json`),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
    if(startError)break;
    if(startDone&&assembly&&['failed','blocked','cancelled','paused'].includes(assembly.status)){startError=assembly.error??assembly.status;break;}
    if(startDone&&assembly?.status==='done'&&project.outputPath)break;
    if(Date.now()-started>90*60*1000||await stat(join(out,'stop-production.flag')).then(()=>true,()=>false)){
      stopped=true;await call('queue:stop',id);await production;break;
    }
  }
  await production;project=await call('projects:get',id);assert.deepEqual(project.scenes.map(s=>[s.id,s.narration,s.audioPath]),voices);
  const bytes=project.outputPath?await stat(project.outputPath).then(s=>s.size,()=>0):0;
  const result={buildId,mode:assemblyOnly?'assembly':'production',elapsedSeconds:(Date.now()-started)/1000,stopped,error:startError,verifiedBefore,verifiedAfter:project.scenes.filter(s=>s.documentary?.verified).length,voicesPreserved:true,crashes,outputPath:project.outputPath,bytes};
  await writeFile(join(out,`${prefix}-result.json`),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  if(keepOpen&&!startError&&!stopped&&bytes){
    const rendererBuildId=await win.webContents.executeJavaScript('document.querySelector("[data-renderer-build-id]")?.dataset.rendererBuildId');
    assert.equal(rendererBuildId,buildId);
    await writeFile(join(out,'final-startup.json'),JSON.stringify({buildId,rendererBuildId,buildMatch:true,windowOpen:true},null,2));
    win.show();return;
  }
  app.exit(startError||stopped||!bytes?1:0);
});
