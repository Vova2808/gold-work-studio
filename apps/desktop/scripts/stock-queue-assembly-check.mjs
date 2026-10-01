import assert from 'node:assert/strict';
import { app, BrowserWindow } from 'electron';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

// Resume only the existing local assembly job. Never order voice/materials.
const requestedId=process.argv.find(arg=>arg.startsWith('--project='))?.split('=')[1];
const id=requestedId??'project_mu8iia3v_qhpe9y9';assert.ok(/^project_[a-z0-9_]+$/.test(id));
const warm=process.argv.includes('--reassemble');
const profile='C:/Users/rosup/AppData/Roaming/@gold-work/desktop';
const out=resolve('captures/stock-queue-assembly',...(requestedId?[id]:[]),warm?(process.argv.includes('--edited')?'edited':'warm'):'cold');await mkdir(out,{recursive:true});
const before=JSON.parse(await readFile(profile+'/projects.json','utf8')).find(p=>p.id===id);
const fingerprint=p=>JSON.stringify(p.scenes.map(s=>[s.id,s.narration,s.audioPath,s.videoPath,s.imagePath,s.trimStartSeconds,s.trimEndSeconds,s.documentary?.pinned]));
const queue=JSON.parse(await readFile(profile+'/queue.json','utf8'));
const unfinished=queue.filter(t=>t.projectId===id&&t.status!=='done');
if(warm)assert.equal(unfinished.length,0);
else {assert.equal(unfinished.length,1);assert.equal(unfinished[0].kind,'assemble');assert.equal(unfinished[0].status,'paused');}
await writeFile(resolve(out,'before.json'),JSON.stringify({project:before,queue},null,2));
app.setPath('userData',profile);delete process.env.ELECTRON_RENDERER_URL;delete process.env.PORTABLE_EXECUTABLE_DIR;
app.on('browser-window-created',(_event,win)=>win.on('show',()=>win.hide()));
createRequire(import.meta.url)(resolve('dist/main/index.cjs'));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
  let win;for(let n=0;n<150;n++){win=BrowserWindow.getAllWindows()[0];if(win?.webContents.getURL()&&!win.webContents.isLoadingMainFrame())break;await wait(100);}
  assert.ok(win);let crashed=false;win.webContents.on('render-process-gone',()=>crashed=true);
  const api=(method,...args)=>win.webContents.executeJavaScript(`window.goldWork[${JSON.stringify(method)}](...${JSON.stringify(args)})`,true);
  for(let n=0;n<150;n++){if(await win.webContents.executeJavaScript('Boolean(window.goldWork)'))break;await wait(100);}
  const started=Date.now();let last=-1;
  const launched=await api(warm?'assembleProject':'resumeGeneration',id);
  const taskId=warm?launched.find(t=>t.kind==='assemble'&&t.status!=='done')?.id:unfinished[0].id;assert.ok(taskId);
  for(;;){
    await wait(2000);const tasks=(await api('getQueue')).filter(t=>t.projectId===id),task=tasks.find(t=>t.id===taskId);assert.ok(task);
    if(Math.floor(task.progress/5)!==last){last=Math.floor(task.progress/5);console.log(JSON.stringify({seconds:Math.round((Date.now()-started)/1000),status:task.status,progress:task.progress,stage:task.progressLabel}));}
    if(['failed','blocked','paused','cancelled'].includes(task.status))throw new Error(JSON.stringify({status:task.status,error:task.error}));
    assert.equal(crashed,false,'Renderer must survive the complete assembly');
    if(task.status==='done')break;
    if(Date.now()-started>25*60*1000)throw new Error('Assembly exceeded 25 minutes; leave checkpoint intact');
  }
  const after=await api('getProject',id);assert.equal(fingerprint(after),fingerprint(before),'Assembly must preserve selected footage, narration and pins');
  assert.ok(after.outputPath);const size=(await stat(after.outputPath)).size;assert.ok(size>1e6);
  const result={elapsedSeconds:(Date.now()-started)/1000,outputPath:after.outputPath,bytes:size,status:after.status,rendererSurvived:!crashed,sceneCount:after.scenes.length,voiceAndMediaPreserved:true,build:await api('getAppInfo')};
  await writeFile(resolve(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));app.exit(0);
}).catch(error=>{console.error(String(error));app.exit(1)});
