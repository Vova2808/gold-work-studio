import assert from 'node:assert/strict';
import {app,BrowserWindow,ipcMain} from 'electron';
import {createRequire} from 'node:module';
import {readFile,writeFile,copyFile,stat,readdir} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';

// Existing authorized project only. Click the product's refresh action, then
// use assembleOnly. No injected media/layouts, no search and no paid submission.
const id='project_mukba0q1_0cubga6',profile='C:/Users/rosup/AppData/Roaming/@gold-work/desktop';
const out=resolve('captures/montage-speed-20260927/new-production'),directory='D:/GoldWorkStorage/projects/'+id;
const hash=value=>createHash('sha256').update(value).digest('hex');
const hashFile=async path=>{const h=createHash('sha256');for await(const chunk of createReadStream(path))h.update(chunk);return h.digest('hex');};
const saved=JSON.parse(await readFile(join(profile,'projects.json'),'utf8')),before=saved.find(p=>p.id===id);
assert.equal(before.status,'complete');assert.ok(before.outputPath);
const stateFile=join(out,'refresh-production.json');
assert.ok(!await stat(stateFile).then(()=>true,()=>false),'Refresh already attempted; inspect the saved run before restarting');
const others=saved.filter(p=>p.id!==id).map(p=>({id:p.id,hash:hash(JSON.stringify(p))}));
const voices=[];for(const s of before.scenes)if(s.audioPath)voices.push({path:s.audioPath,hash:await hashFile(s.audioPath)});
const analysis=join(directory,'Documentary','Analysis'),checkpoints=[];
for(const name of await readdir(analysis))if(name.endsWith('.json')){const path=join(analysis,name);checkpoints.push({path,hash:await hashFile(path)});}
const state={projectId:id,originalStartedAt:'2026-09-27T21:08:58.267Z',kind:'montage-only-refresh',backup:join(directory,'Final-before-refresh-20260928.mp4'),startedAt:new Date().toISOString()};
await copyFile(before.outputPath,state.backup);assert.equal(await hashFile(state.backup),await hashFile(before.outputPath));
await writeFile(join(out,'project-before-refresh.json'),JSON.stringify(before));
await writeFile(stateFile,JSON.stringify(state,null,2));
const handlers=new Map(),original=ipcMain.handle;
ipcMain.handle=function(channel,handler){handlers.set(channel,handler);return original.call(this,channel,handler);};
app.setPath('userData',profile);delete process.env.ELECTRON_RENDERER_URL;delete process.env.PORTABLE_EXECUTABLE_DIR;
createRequire(import.meta.url)(resolve('dist/main/index.cjs'));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
  let win;for(let i=0;i<100;i++){win=BrowserWindow.getAllWindows()[0];if(win?.webContents.getURL()&&!win.webContents.isLoadingMainFrame())break;await pause(200);}assert.ok(win);
  const call=(name,...args)=>handlers.get(name)({sender:win.webContents},...args);
  const evaluate=code=>win.webContents.executeJavaScript(`(async()=>{${code}})()`,true);
  const until=async expression=>{for(let i=0;i<150;i++){if(await evaluate(`return Boolean(${expression});`))return;await pause(200);}throw Error('UI timeout: '+expression);};
  const info=await call('app:info');assert.equal(info.mockMode,false);state.buildId=info.buildId;
  assert.equal(await evaluate('return document.querySelector("[data-renderer-build-id]")?.dataset.rendererBuildId;'),info.buildId);
  assert.ok(!(await call('queue:list')).some(t=>['pending','running','retry_wait'].includes(t.status)));
  await until('document.querySelector("[data-nav-key=projects]")');
  await evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Открыть приложение')?.click();document.querySelector('[data-nav-key=projects]').click();`);
  const row=`[...document.querySelectorAll('.projects-table-row')].find(e=>e.textContent.includes(${JSON.stringify(before.title)}))`;
  await until(row);await evaluate(`${row}.click();`);
  const refresh=`[...document.querySelectorAll('.project-expand button')].find(e=>e.textContent.trim()==='Обновить автомонтаж')`;
  await until(refresh);assert.equal(await evaluate(`return ${refresh}.disabled;`),false);
  await evaluate(`${refresh}.click();`);await until('document.querySelector(".timeline-scroll")');
  await writeFile(join(out,'refresh-ui.png'),(await win.webContents.capturePage()).toPNG());
  const updated=JSON.parse(await readFile(join(profile,'projects.json'),'utf8')).find(p=>p.id===id);
  const media=p=>p.scenes.map(s=>[s.id,s.narration,s.audioPath,s.imagePath,s.videoPath,s.documentary?.verified,s.documentary?.selected,s.documentary?.requirement,s.documentary?.timing]);
  assert.deepEqual(media(updated),media(before));
  for(const s of before.scenes)if(s.documentary?.pinned)assert.deepEqual(updated.scenes.find(t=>t.id===s.id),s);
  state.changedScenes=updated.scenes.filter((s,i)=>JSON.stringify(s.documentary)!==JSON.stringify(before.scenes[i].documentary)).length;
  state.templates=updated.scenes.reduce((counts,s)=>{const key=s.documentary?.motionGraphic?.enabled?s.documentary.motionGraphic.kind:s.documentary?.template??'full';counts[key]=(counts[key]??0)+1;return counts;},{});
  state.refreshedAt=new Date().toISOString();await writeFile(stateFile,JSON.stringify(state,null,2));console.log(JSON.stringify(state));
  const tasksBefore=new Set((await call('queue:list')).map(t=>t.id));
  await call('projects:assemble',id);
  const task=(await call('queue:list')).find(t=>t.projectId===id&&t.kind==='assemble'&&!tasksBefore.has(t.id));assert.ok(task);
  state.taskId=task.id;state.assemblyStartedAt=new Date().toISOString();await writeFile(stateFile,JSON.stringify(state,null,2));
  for(;;){
    const current=(await call('queue:list')).find(t=>t.id===task.id);assert.ok(current);
    state.queueStatus=current.status;state.percent=current.progress;state.stage=current.stage;
    await writeFile(stateFile,JSON.stringify(state,null,2));console.log(JSON.stringify({at:new Date().toISOString(),status:current.status,percent:current.progress,stage:current.stage}));
    if(current.status==='done')break;
    if(['failed','blocked','cancelled'].includes(current.status))throw Error(current.error??'Assembly '+current.status);
    await pause(20000);
  }
  const all=JSON.parse(await readFile(join(profile,'projects.json'),'utf8')),p=all.find(p=>p.id===id);
  assert.equal(p.status,'complete');assert.ok(p.outputPath);assert.deepEqual(media(p),media(before));
  for(const item of others)assert.equal(hash(JSON.stringify(all.find(p=>p.id===item.id))),item.hash);
  for(const item of [...voices,...checkpoints])assert.equal(await hashFile(item.path),item.hash);
  assert.equal((await readdir(analysis)).filter(n=>n.endsWith('.json')).length,checkpoints.length);
  Object.assign(state,{completedAt:new Date().toISOString(),output:p.outputPath,voicesPreserved:voices.length,analysisCheckpointsPreserved:checkpoints.length,otherProjectsPreserved:others.length,paidAnalysisRequests:0});
  await writeFile(stateFile,JSON.stringify(state,null,2));console.log(JSON.stringify(state));win.show();
}).catch(async error=>{state.error=String(error);await writeFile(stateFile,JSON.stringify(state,null,2));console.error(error.stack);BrowserWindow.getAllWindows()[0]?.show();});
