import assert from 'node:assert/strict';
import {app,BrowserWindow,ipcMain} from 'electron';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir,stat,readdir,appendFile,copyFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {estimateNarrationDurationSeconds} from '@gold-work/shared';
import {installStockMainApi} from './stock-main-api.mjs';

// One authorized new production through the SAME handlers as the app's buttons.
// No injected scene materials/templates/voices; no provider/settings overrides.
assert.ok(process.argv.includes('--paid')||process.argv.includes('--preflight'),'Use --paid or --preflight');
const profile='C:/Users/rosup/AppData/Roaming/@gold-work/desktop';
const out=resolve('captures/montage-speed-20260927/new-production');
await mkdir(out,{recursive:true});
const statePath=join(out,'state.json'),registryPath=join(profile,'projects.json');
const prior=await readFile(statePath,'utf8').then(JSON.parse,()=>undefined);
assert.ok(!prior?.projectId||process.argv.includes('--resume')||process.argv.includes('--preflight'),'Existing run: inspect state and use --resume');
const state=prior??{title:'Как устроен автомобиль — полный новый замер 28.09.2026',stages:{},runs:[],interventions:[]};
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const script=(await readFile(resolve('scripts/fixtures/automobile-production-20260928.txt'),'utf8')).trim();
const clean=x=>String(x).replace(/https?:\/\/\S+/g,'[URL]');
const save=()=>writeFile(statePath,JSON.stringify(state,null,2));
const event=async(stage,details={})=>{const item={at:new Date().toISOString(),stage,...details};console.log(JSON.stringify(item));await appendFile(join(out,'events.jsonl'),JSON.stringify(item)+'\n');};
const baseline=await (async()=>{
  const all=JSON.parse(await readFile(registryPath,'utf8'));
  const source=all.find(p=>p.id==='project_mujq2wnq_4gdz3f3');assert.ok(source);
  return {settings:structuredClone(source.settings),channelProfileId:source.channelProfileId,aspectRatio:source.aspectRatio,language:source.language,
    preserved:all.filter(p=>p.id!==state.projectId).map(p=>({id:p.id,hash:digest(p)}))};
})();
const preserve=async()=>{
  const all=JSON.parse(await readFile(registryPath,'utf8'));
  for(const item of baseline.preserved)assert.equal(digest(all.find(p=>p.id===item.id)),item.hash,`Existing project changed: ${item.id}`);
};
assert.ok(baseline.settings.voice.calibration,'Use the saved voice calibration');
const apiBridge=installStockMainApi(ipcMain);
app.setPath('userData',profile);delete process.env.ELECTRON_RENDERER_URL;delete process.env.PORTABLE_EXECUTABLE_DIR;
createRequire(import.meta.url)(resolve('dist/main/index.cjs'));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let win,crashes=0,monitoring=false;
const api=(name,...args)=>apiBridge.call(name,...args);
const active=t=>['pending','running','retry_wait'].includes(t.status);
const snapshot=async()=>{
  const p=await api('getProject',state.projectId),q=(await api('getQueue')).filter(t=>t.projectId===p.id);
  const voices=p.scenes.filter(s=>s.audioPath).length,verified=p.scenes.filter(s=>s.documentary?.verified).length;
  if(voices===p.scenes.length&&voices&&!state.stages.voiceFinishedAt){state.stages.voiceFinishedAt=new Date().toISOString();await save();}
  if(verified===p.scenes.length&&verified&&!state.stages.materialsFinishedAt){state.stages.materialsFinishedAt=new Date().toISOString();await save();}
  const assembly=q.findLast(t=>t.kind==='assemble');
  if(assembly?.status==='running'&&!state.stages.assemblyStartedAt){state.stages.assemblyStartedAt=new Date().toISOString();await save();}
  const progress=apiBridge.progress();
  const report={elapsedSeconds:Math.round((Date.now()-Date.parse(state.startedAt))/1000),status:p.status,scenes:p.scenes.length,voices,verified,
    phase:progress?.phase,message:clean(progress?.message??''),activeTasks:q.filter(active).length,
    errors:q.filter(t=>['failed','blocked'].includes(t.status)).map(t=>({kind:t.kind,sceneId:t.sceneId,error:clean(t.error)})),
    assembly:assembly?{status:assembly.status,progress:assembly.progress}:undefined,crashes};
  await writeFile(join(out,'progress.json'),JSON.stringify(report,null,2));await event('progress',report);
  return {p,q};
};
app.whenReady().then(async()=>{
  for(let i=0;i<150;i++){win=BrowserWindow.getAllWindows()[0];if(win?.webContents.getURL()&&!win.webContents.isLoadingMainFrame())break;await wait(200);}
  assert.ok(win);apiBridge.attach(win.webContents);win.webContents.setBackgroundThrottling(false);
  win.webContents.on('render-process-gone',()=>{crashes++;});
  const info=await api('getAppInfo');assert.equal(info.mockMode,false);
  const rendererBuildId=await win.webContents.executeJavaScript('document.querySelector("[data-renderer-build-id]")?.dataset.rendererBuildId');
  assert.equal(info.buildId,rendererBuildId);state.buildId=info.buildId;
  assert.equal((await api('getQueue')).some(active),false,'Existing active queue: do not interfere');
  await win.webContents.capturePage().then(img=>writeFile(join(out,'startup.png'),img.toPNG()));
  await writeFile(join(out,'startup.json'),JSON.stringify({buildId:info.buildId,rendererBuildId,buildMatch:true,crashes},null,2));
  if(process.argv.includes('--ui-check'))await (await import('./montage-timeline-check.mjs')).checkMontageTimeline(win,state.title,out);
  if(process.argv.includes('--preflight')){await preserve();await event('preflight-ok',{buildId:info.buildId});if(process.argv.includes('--keep-open'))win.show();else app.exit(0);return;}
  if(!state.startedAt){
    await copyFile(registryPath,join(out,'registry-before.json'));
    state.existingCatalogFiles=await readdir('D:/GoldWorkStorage/Materials/Catalog').catch(()=>[]);
    state.scriptHash=digest(script);state.settingsHash=digest(baseline.settings);
    state.startedAt=new Date().toISOString();await save();
  }
  assert.equal(state.scriptHash,digest(script),'Do not change the ready script after starting');
  if(!state.projectId){
    assert.ok(!state.creationPending,'Reconcile an unreturned creation before retrying');state.creationPending=true;await save();
    const p=await api('createProject',{title:state.title,topic:state.title,aspectRatio:baseline.aspectRatio,language:baseline.language,mode:'standard',
      channelProfileId:baseline.channelProfileId,mediaMode:'stock',videoBrief:{prompt:state.title,competitorTranscripts:[],creationMode:'script',readyScript:script}});
    state.projectId=p.id;state.creationPending=false;await save();assert.equal(p.scenes.length,0);
    const settings={...baseline.settings,durationMinutes:estimateNarrationDurationSeconds(script,baseline.settings.voice.calibration)/60};
    await api('updateProject',p.id,{settings});state.settingsApplied=true;await save();
    await event('created',{projectId:p.id,estimatedSeconds:settings.durationMinutes*60,stockVideoPercent:settings.stockVideoPercent,existingCatalog:state.existingCatalogFiles.length});
  }
  assert.ok(state.settingsApplied,'Inspect incomplete settings application before resuming');
  const original=await api('getProject',state.projectId);assert.equal(original.videoBrief.readyScript,script);
  assert.equal(original.mediaMode,'stock');assert.equal(original.settings.assembly.documentary.version,2);
  if(!state.stages.planningFinishedAt){
    state.stages.planningStartedAt??=new Date().toISOString();await save();
    const planned=await api('prepareProjectScript',state.projectId);
    assert.equal(planned.scenes.map(s=>s.narration).join(''),script);
    assert.ok(planned.scenes.every(s=>!s.audioPath&&!s.documentary?.selected),'New production must begin without voices/materials');
    state.stages.planningFinishedAt=new Date().toISOString();state.sceneCount=planned.scenes.length;await save();
    await event('planned',{scenes:planned.scenes.length});
  }
  const run={startedAt:new Date().toISOString(),buildId:state.buildId};state.runs.push(run);await save();
  let done=false,startError,stopRequested=false;
  const work=api('startGeneration',state.projectId).then(()=>{done=true;},e=>{done=true;startError=e;});
  monitoring=true;
  let current;
  while(monitoring){
    current=await snapshot();
    if(done&&startError)throw startError;
    if(done&&current.p.status==='complete'&&current.p.outputPath&&current.q.some(t=>t.kind==='assemble'&&t.status==='done'&&Date.parse(t.updatedAt)>=Date.parse(run.startedAt)))break;
    if(done&&!current.q.some(active)){
      // Queue completion and project persistence are separate writes. The first
      // snapshot may contain the old project and the newly completed task.
      for(let i=0;i<20&&current.p.status!=='complete'&&current.q.some(t=>t.kind==='assemble'&&t.status==='done'&&Date.parse(t.updatedAt)>=Date.parse(run.startedAt));i++){
        await wait(250);current=await snapshot();
      }
      if(current.p.status==='complete'&&current.p.outputPath&&current.q.some(t=>t.kind==='assemble'&&t.status==='done'&&Date.parse(t.updatedAt)>=Date.parse(run.startedAt)))break;
      throw new Error(current.q.filter(t=>['failed','blocked'].includes(t.status)).map(t=>clean(t.error)).join('\n')||'Production ended without Final');
    }
    const requested=await stat(join(out,'stop.request')).then(s=>s.mtimeMs>=Date.parse(run.startedAt),()=>false);
    if(requested||Date.now()-Date.parse(run.startedAt)>120*60000){stopRequested=true;await api('stopGeneration',state.projectId);await work;throw new Error('Bounded run stopped; checkpoints preserved');}
    await wait(15000);
  }
  monitoring=false;await work;assert.equal(stopRequested,false);assert.equal(crashes,0);
  const project=current.p;assert.ok(project.scenes.every(s=>s.includeInAssembly===false||s.documentary?.verified));
  assert.equal(project.scenes.map(s=>s.narration).join(''),script);await preserve();
  const output=await stat(project.outputPath);assert.ok(output.mtimeMs>=Date.parse(run.startedAt));
  state.completedAt=new Date().toISOString();run.completedAt=state.completedAt;await save();
  const sourceChecksums=project.scenes.map(s=>s.documentary?.selected?.excerpt?.sourceChecksum??s.documentary?.checksum).filter(Boolean);
  const result={projectId:state.projectId,buildId:state.buildId,startedAt:state.startedAt,completedAt:state.completedAt,
    elapsedSeconds:(Date.parse(state.completedAt)-Date.parse(state.startedAt))/1000,stages:state.stages,runs:state.runs,interventions:state.interventions,
    scenes:project.scenes.length,outputPath:project.outputPath,bytes:output.size,crashes,previousProjectsPreserved:true,
    sharedCatalog:state.existingCatalogFiles.length,selectedSourcesPresentBefore:sourceChecksums.filter(c=>state.existingCatalogFiles.includes(`${c}.json`)).length,
    method:'New ready script, new scenes and TTS; normal app handlers. Shared provider/source cache retained. Not UI-click acceptance.'};
  await writeFile(join(out,'result.json'),JSON.stringify(result,null,2));
  await writeFile(join(out,'project-snapshot.json'),JSON.stringify(project));await event('complete',result);
  win.show();
}).catch(async error=>{
  monitoring=false;const message=clean(error?.stack??error);await event('failed',{message});
  if(state.runs.length)state.runs.at(-1).error=message;
  await save();await writeFile(join(out,'failure.json'),JSON.stringify({at:new Date().toISOString(),projectId:state.projectId,message},null,2));
  if(state.projectId&&win&&!win.isDestroyed())await api('stopGeneration',state.projectId).catch(()=>{});
  await preserve().catch(e=>event('preserve-check-failed',{message:clean(e)}));
  // A failed material is an actionable app state, not a reason to close the UI.
  // Leave the ordinary application available for review/resume.
  if(win&&!win.isDestroyed())win.show();else app.exit(1);
});
