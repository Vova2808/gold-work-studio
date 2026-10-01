// Real-size registry in an isolated profile. No provider credentials or submissions.
import assert from 'node:assert/strict';
import {app,BrowserWindow,ipcMain} from 'electron';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const out=resolve('captures/stock-stall-20260927');await mkdir(out,{recursive:true});
const profile=await mkdtemp(join(out,'ui-profile-'));
const registry='C:/Users/rosup/AppData/Roaming/@gold-work/desktop/projects.json';
const original=await readFile(registry),projects=JSON.parse(original);
const id='project_mujq2wnq_4gdz3f3',project=projects.find(p=>p.id===id);
assert.equal(project.scenes.length,261);
project.updatedAt=new Date().toISOString();
await writeFile(join(profile,'projects.json'),JSON.stringify(projects));
app.setPath('userData',profile);delete process.env.ELECTRON_RENDERER_URL;delete process.env.PORTABLE_EXECUTABLE_DIR;
app.on('browser-window-created',(_,win)=>win.on('show',()=>win.hide()));
createRequire(import.meta.url)(resolve('dist/main/index.cjs'));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
  let win,step='startup';const timer=setTimeout(()=>{console.error('Timed out at '+step);app.exit(1);},60000);
  try{
    for(let i=0;i<100;i++){win=BrowserWindow.getAllWindows()[0];if(win&&!win.webContents.isLoadingMainFrame())break;await wait(100);}
    assert.ok(win);win.setSize(1600,1000);win.webContents.setBackgroundThrottling(false);
    const run=body=>win.webContents.executeJavaScript(`(async()=>{${body}})()`,true);
    const until=async expression=>{for(let i=0;i<200;i++){if(await run(`return (${expression})`))return;await wait(100);}throw Error('UI timeout: '+expression);};
    await until(`Boolean(document.querySelector('[data-nav-key=projects]'))`);
    await run(`document.querySelector('.startup-health-toast[open] .primary-button')?.click();document.querySelector('[data-nav-key=projects]').click()`);
    await until(`Boolean(document.querySelector('.projects-table-row'))`);
    await run(`document.querySelector('.projects-table-row').click()`);
    await until(`[...document.querySelectorAll('.project-expand button')].some(e=>e.textContent.includes('Настроить'))`);
    await run(`[...document.querySelectorAll('.project-expand button')].find(e=>e.textContent.includes('Настроить')).click()`);
    await until(`Boolean(document.querySelector('[data-flow-step=materials]'))`);
    await run(`document.querySelector('[data-flow-step=materials]').click()`);
    await until(`document.querySelectorAll('.scenario-material-card').length===261`);
    step='snapshot';const before=await run('return performance.memory.usedJSHeapSize');
    const snapshot=await run('return window.goldWork.getProjectChanges()');
    assert.equal(snapshot.projects.length,projects.length);
    const display=snapshot.projects.find(p=>p.id===id);
    assert.equal(display.scenes.reduce((n,s)=>n+(s.documentary?.candidates?.length??0),0),0);
    assert.ok(display.scenes.reduce((n,s)=>n+(s.documentary?.candidateCount??0),0)>16000);
    const sourceScene=project.scenes.find(s=>s.documentary?.candidates?.length);
    step='candidates';const candidates=await run(`return window.goldWork.getDocumentaryCandidates(${JSON.stringify(id)},${JSON.stringify(sourceScene.id)})`);
    assert.equal(candidates.length,sourceScene.documentary.candidates.length);
    for(let i=0;i<100;i++){
      step=`progress ${i}`;
      win.webContents.send('stock:auto-progress',{projectId:id,phase:'searching',completed:190,total:261,selected:1,skipped:189,failed:2,message:'Проверка отзывчивости интерфейса'});
      if(i%10===0){const delta=await run(`return window.goldWork.getProjectChanges(${JSON.stringify(snapshot.revision)})`);assert.equal(delta.projects,undefined);}
      await wait(30);
    }
    step='toast';await until(`Boolean(document.querySelector('.auto-stock-toast'))`);
    assert.equal(await run(`return document.querySelector('.auto-stock-toast').classList.contains('failed')`),false);
    assert.equal(await run(`return document.body.innerText.includes('Что-то пошло не так')`),false);
    const after=await run('return performance.memory.usedJSHeapSize');
    const info=await run('return window.goldWork.getAppInfo()');
    assert.equal(info.buildId,await run(`return document.querySelector('[data-renderer-build-id]').dataset.rendererBuildId`));
    step='capture';win.removeAllListeners('show');win.showInactive();await wait(150);await writeFile(join(out,'ui-materials.png'),(await win.capturePage()).toPNG());
    step='stop feedback';let stopCalls=0,releaseStop;
    ipcMain.removeHandler('queue:stop');ipcMain.handle('queue:stop',()=>{stopCalls++;return new Promise(resolve=>{releaseStop=resolve;});});
    await run(`document.querySelector('[data-nav-key=queue]').click()`);
    await until(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Стоп')`);
    await run(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Стоп').click()`);
    await until(`[...document.querySelectorAll('button')].some(b=>b.disabled&&b.textContent.includes('Останавливаю и сохраняю'))`);
    assert.equal(stopCalls,1);releaseStop([]);
    await until(`![...document.querySelectorAll('button')].some(b=>b.textContent.includes('Останавливаю и сохраняю'))`);
    const report={buildId:info.buildId,scenes:261,projects:projects.length,projectPayloadBytes:Buffer.byteLength(JSON.stringify(display)),heapBeforeMiB:Math.round(before/1024**2),heapAfterMiB:Math.round(after/1024**2),rendererMemoryMiB:app.getAppMetrics().filter(m=>m.type==='Tab').map(m=>Math.round(m.memory.workingSetSize/1024)),runningToastRed:false,candidatesDeferred:true,candidatesLoaded:candidates.length,progressEvents:100,registryUnchanged:original.equals(await readFile(registry))};
    assert.equal(report.registryUnchanged,true);report.stopFeedback=true;await writeFile(join(out,'ui-result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));clearTimeout(timer);app.exit(0);
  }catch(error){console.error(String(error));if(win)console.error(await win.webContents.executeJavaScript('document.body.innerText.slice(-1300)'));clearTimeout(timer);app.exit(1);}
});
