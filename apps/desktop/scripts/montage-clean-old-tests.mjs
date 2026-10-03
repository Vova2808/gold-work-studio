import assert from 'node:assert/strict';
import {app,BrowserWindow,ipcMain} from 'electron';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir,readdir,lstat,copyFile,realpath} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute,extname} from 'node:path';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';

// Explicitly authorized old test cleanup. Never run alongside production.
const profile='C:/Users/rosup/AppData/Roaming/@gold-work/desktop',root='D:/GoldWorkStorage';
const currentId='project_mukba0q1_0cubga6',protectedId='project_mujq2wnq_4gdz3f3';
const ids=['project_mu9x2ywf_1s9thrt','project_muj5r1uv_pphrclx','project_muihr14p_xsah7wf'];
const out=resolve('captures/montage-speed-20260927/new-production'),archive=join(root,'Archive','DeletedTests-20260928');
const hash=value=>createHash('sha256').update(value).digest('hex');
const hashFile=async path=>{const digest=createHash('sha256');for await(const chunk of createReadStream(path))digest.update(chunk);return digest.digest('hex');};
const inside=(parent,path)=>{const r=relative(resolve(parent),resolve(path));return r!==''&&!r.startsWith('..')&&!isAbsolute(r);};
const handlers=new Map(),original=ipcMain.handle;
ipcMain.handle=function(channel,handler){handlers.set(channel,handler);return original.call(this,channel,handler);};
app.setPath('userData',profile);delete process.env.ELECTRON_RENDERER_URL;delete process.env.PORTABLE_EXECUTABLE_DIR;
createRequire(import.meta.url)(resolve('dist/main/index.cjs'));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
  let win;for(let i=0;i<100;i++){win=BrowserWindow.getAllWindows()[0];if(win?.webContents.getURL()&&!win.webContents.isLoadingMainFrame())break;await pause(200);}
  assert.ok(win);const call=(channel,...args)=>handlers.get(channel)({sender:win.webContents},...args);
  assert.equal((await call('app:info')).mockMode,false);
  const queue=await call('queue:list');
  assert.ok(!queue.some(t=>['running','pending','retry_wait'].includes(t.status)));
  const projects=JSON.parse(await readFile(join(profile,'projects.json'),'utf8'));
  const current=projects.find(p=>p.id===currentId);assert.equal(current.status,'complete');assert.ok(current.outputPath);
  const selected=projects.filter(p=>ids.includes(p.id)||p.mediaMode==='stock'&&p.scenes.length===0&&!p.outputPath);
  assert.ok(selected.every(p=>p.id!==currentId&&p.id!==protectedId));
  const remaining=projects.filter(p=>!selected.some(s=>s.id===p.id));
  const before=remaining.map(p=>({id:p.id,hash:hash(JSON.stringify(p))}));
  const protectedFiles=new Set(remaining.filter(p=>p.id===currentId||p.id===protectedId).flatMap(p=>[...p.scenes.map(s=>s.audioPath),p.outputPath]).filter(Boolean));
  let unknownCount=0;
  const currentAnalysis=join(root,'projects',currentId,'Documentary','Analysis');
  for(const file of await readdir(currentAnalysis))if(file.endsWith('.json')){
    const path=join(currentAnalysis,file),data=JSON.parse(await readFile(path,'utf8'));
    if(['pending','partial'].includes(data.state)){protectedFiles.add(path);unknownCount++;}
  }
  const protectedHashes=[];for(const path of protectedFiles)protectedHashes.push({path,sha256:await hashFile(path)});
  const entries=[],physical=new Map();let copiedBytes=0;
  for(const p of selected){
    assert.ok(!remaining.some(other=>JSON.stringify(other).includes(p.id)),'Remaining project references '+p.id);
    const directory=join(root,'projects',p.id);
    assert.ok(inside(join(root,'projects'),directory));
    const dirStat=await lstat(directory).catch(e=>{if(e.code==='ENOENT')return undefined;throw e;});
    if(dirStat){assert.ok(dirStat.isDirectory()&&!dirStat.isSymbolicLink());assert.ok(inside(await realpath(join(root,'projects')),await realpath(directory)));
      for(const e of await readdir(directory,{recursive:true,withFileTypes:true})){
        if(e.isSymbolicLink())throw Error('Linked directory requires separate review');
        if(!e.isFile())continue;const info=await lstat(join(e.parentPath,e.name)),key=info.dev+':'+info.ino;
        const item=physical.get(key)??{count:0,links:info.nlink,bytes:info.size};item.count++;physical.set(key,item);
      }
    }
    const destination=join(archive,p.id);await mkdir(destination,{recursive:true});
    await writeFile(join(destination,'project.json'),JSON.stringify(p));
    await writeFile(join(destination,'queue.json'),JSON.stringify(queue.filter(t=>t.projectId===p.id)));
    const saved=[];
    const keep=async(source,target)=>{await mkdir(resolve(target,'..'),{recursive:true});await copyFile(source,target);const sha256=await hashFile(target);assert.equal(sha256,await hashFile(source));copiedBytes+=(await lstat(target)).size;saved.push({source,target,sha256});};
    for(const s of p.scenes)if(s.audioPath)await keep(s.audioPath,join(destination,'Audio',s.id+extname(s.audioPath)));
    if(p.outputPath)await keep(p.outputPath,join(destination,'Final.mp4'));
    const analysis=join(directory,'Documentary','Analysis');
    for(const name of await readdir(analysis).catch(e=>{if(e.code==='ENOENT')return [];throw e;}))if(name.endsWith('.json'))await keep(join(analysis,name),join(destination,'Analysis',name));
    await writeFile(join(destination,'preservation.json'),JSON.stringify(saved,null,2));
    entries.push({id:p.id,title:p.title,voices:p.scenes.filter(s=>s.audioPath).length,archive:destination});
  }
  await writeFile(join(out,'old-tests-cleanup-plan.json'),JSON.stringify({entries,copiedBytes},null,2));
  for(const entry of entries){const trashed=await call('projects:delete',entry.id);assert.equal(trashed.originalId,entry.id);await call('trash:purge',trashed.trashId);}
  const after=JSON.parse(await readFile(join(profile,'projects.json'),'utf8'));
  for(const item of before)assert.equal(hash(JSON.stringify(after.find(p=>p.id===item.id))),item.hash,'Remaining project changed: '+item.id);
  for(const item of protectedHashes)assert.equal(await hashFile(item.path),item.sha256,'Protected media/checkpoint changed: '+item.path);
  const releasedDataBytes=[...physical.values()].filter(i=>i.count>=i.links).reduce((sum,i)=>sum+i.bytes,0);
  const report={at:new Date().toISOString(),removed:entries,remaining:after.length,releasedDataBytes,copiedBytes,netDataBytes:releasedDataBytes-copiedBytes,currentAndRemainingProjectsPreserved:true,protectedMediaAndCheckpoints:protectedHashes.length,unknownCheckpointsPreserved:unknownCount};
  await writeFile(join(out,'old-tests-cleanup-result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  await (await import('./montage-timeline-check.mjs')).checkMontageTimeline(win,current.title,out);
  app.exit(0);
}).catch(error=>{console.error(error.stack);app.exit(1);});
