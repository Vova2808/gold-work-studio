import assert from 'node:assert/strict';
import {app,BrowserWindow,ipcMain} from 'electron';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {installStockMainApi} from './stock-main-api.mjs';

// One real missing scene in the same authorized production; no extra TTS or
// synthetic health completion. Existing paid response guards remain in force.
assert.ok(process.argv.includes('--paid'));
const number=Number(process.argv.find(arg=>arg.startsWith('--scene='))?.split('=')[1]);
assert.ok(Number.isInteger(number)&&number>0);
const profile='C:/Users/rosup/AppData/Roaming/@gold-work/desktop';
const out=resolve('captures/montage-speed-20260927/new-production');
const state=JSON.parse(await readFile(join(out,'state.json'),'utf8'));
const before=JSON.parse(await readFile(join(profile,'projects.json'),'utf8'));
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const saved=before.find(p=>p.id===state.projectId),scene=saved.scenes.find(s=>s.order===number-1);
assert.ok(scene?.audioPath&&!scene.documentary?.pinned&&!scene.documentary?.verified);
const bridge=installStockMainApi(ipcMain);
app.setPath('userData',profile);delete process.env.ELECTRON_RENDERER_URL;delete process.env.PORTABLE_EXECUTABLE_DIR;
createRequire(import.meta.url)(resolve('dist/main/index.cjs'));
const startedAt=new Date().toISOString();
const report={startedAt,projectId:state.projectId,scene:number,originalStartedAt:state.startedAt};
app.whenReady().then(async()=>{
  let win;for(let i=0;i<150;i++){win=BrowserWindow.getAllWindows()[0];if(win?.webContents.getURL()&&!win.webContents.isLoadingMainFrame())break;await new Promise(r=>setTimeout(r,200));}
  assert.ok(win);bridge.attach(win.webContents);win.webContents.setBackgroundThrottling(false);
  const info=await bridge.call('getAppInfo');
  assert.equal(info.buildId,await win.webContents.executeJavaScript('document.querySelector("[data-renderer-build-id]")?.dataset.rendererBuildId'));
  assert.equal((await bridge.call('getQueue')).some(t=>['running','pending','retry_wait'].includes(t.status)),false);
  report.buildId=info.buildId;
  const result=await bridge.call('autoSelectStock',state.projectId,{sceneIds:[scene.id]});
  report.selected=result.selected;report.failed=result.failed;
  const after=await bridge.call('getProject',state.projectId);
  assert.equal(after.scenes.map(s=>s.narration).join(''),saved.scenes.map(s=>s.narration).join(''));
  assert.deepEqual(after.scenes.map(s=>s.audioPath),saved.scenes.map(s=>s.audioPath));
  const all=JSON.parse(await readFile(join(profile,'projects.json'),'utf8'));
  for(const p of before.filter(p=>p.id!==saved.id))assert.equal(hash(all.find(a=>a.id===p.id)),hash(p));
  report.preservedVoicesAndOtherProjects=true;
  assert.ok(after.scenes.find(s=>s.id===scene.id)?.documentary?.verified,'The missing scene remains unverified');
  report.complete=true;
}).catch(error=>{report.error=String(error).replace(/https?:\/\/\S+/g,'[source URL]');}).finally(async()=>{
  report.endedAt=new Date().toISOString();report.seconds=(Date.parse(report.endedAt)-Date.parse(startedAt))/1000;
  await writeFile(join(out,`source-recovery-${number}-${Date.now()}.json`),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));app.exit(report.complete?0:1);
});
