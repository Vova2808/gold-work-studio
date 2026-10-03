// Live, bounded verification of the generic documentary path in an isolated profile.
// Reuses one already downloaded licensed video and existing provider settings; never orders TTS.
import { app, BrowserWindow } from 'electron';
import { createRequire } from 'node:module';
import { readFile, writeFile, copyFile, mkdir, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const output=resolve('captures/documentary-topic-live'), profile=join(output,'profile');
const original=join(process.env.APPDATA,'@gold-work','desktop');
await mkdir(join(profile,'credentials'),{recursive:true});
const copyMissing=async(from,to)=>{try{await access(to);}catch{await copyFile(from,to);}};
await copyMissing(join(original,'Local State'),join(profile,'Local State'));
await copyMissing(join(original,'credentials','anymodel.json'),join(profile,'credentials','anymodel.json'));
const catalog='12d09c5987e4bc9bae3a8738a38a616bc0ced99237478bc0cf74eea1403b5955.json';
const materialRoot=join(profile,'workspace','Materials','Catalog'); await mkdir(materialRoot,{recursive:true});
await copyMissing(join(original,'workspace','Materials','Catalog',catalog),join(materialRoot,catalog));
const projects=JSON.parse(await readFile(join(original,'projects.json'),'utf8'));
const calibration=projects.find(project=>project.id==='project_mu04dsry_gxx759k').settings.voice.calibration;
assert.ok(calibration);
const statePath=join(output,'state.json');let state=await readFile(statePath,'utf8').then(JSON.parse,()=>({}));
const save=async(value)=>{state={...state,...value};await writeFile(statePath,JSON.stringify(state,null,2));};
app.setPath('userData',profile);delete process.env.PORTABLE_EXECUTABLE_DIR;
createRequire(import.meta.url)(resolve('dist/main/index.cjs'));
app.whenReady().then(async()=>{
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));let win;
  try{
    for(let i=0;i<180;i++){win=BrowserWindow.getAllWindows()[0];if(win&&!win.webContents.isLoadingMainFrame())break;await wait(100);}
    assert.ok(win);win.hide();win.webContents.setBackgroundThrottling(false);
    const evaluate=source=>win.webContents.executeJavaScript(`(async()=>{${source}})()`,true);
    const api=(method,...args)=>evaluate(`return window.goldWork[${JSON.stringify(method)}](...${JSON.stringify(args)})`);
    const expected=(await readFile(resolve('src/generated-build-identity.ts'),'utf8')).match(/APP_BUILD_ID = "([^"]+)"/)[1];
    assert.equal((await api('getAppInfo')).buildId,expected);
    await save({error:null,buildId:expected});
    await evaluate(`window.goldWork.onAutoStockProgress(progress=>console.log('TOPIC_PROGRESS '+JSON.stringify({phase:progress.phase,message:progress.message})))`);
    win.webContents.on('console-message',(_event,_level,message)=>{if(message.startsWith('TOPIC_PROGRESS '))console.log(message);});
    let project=state.projectId?await api('getProject',state.projectId):undefined;
    const text='The Empire State Building rises above the streets of New York City.';
    if(!project){
      project=await api('createProject',{title:'Generic documentary live check',topic:'City architecture',language:'English',aspectRatio:'16:9',mode:'standard',mediaMode:'stock',videoBrief:{creationMode:'script',readyScript:text,prompt:'City architecture',competitorTranscripts:[]}});
      await save({projectId:project.id,buildId:expected});
    }
    if(!project.scenes.length){
      project=await api('updateProject',project.id,{settings:{...project.settings,voice:{...project.settings.voice,enabled:true,provider:'elevenlabs',voice:calibration.voice,calibration},assembly:{...project.settings.assembly,documentary:{...project.settings.assembly.documentary,autoEffects:false}}}});
      project=await api('prepareProjectScript',project.id);
    }
    assert.equal(project.scenes.map(scene=>scene.narration).join(''),text);
    const selection=await api('autoSelectStock',project.id);
    const result={buildId:expected,total:selection.total,selected:selection.selected,failed:selection.failed,
      videos:selection.project.scenes.filter(scene=>scene.documentary?.verified&&scene.videoPath).map(scene=>({order:scene.order,title:scene.documentary.selected.title,review:scene.documentary.visualReview,videoPath:scene.videoPath})),
      errors:selection.failures,limitation:'Live search and visual video review only; no voice generation or five-minute export.'};
    assert.equal((await api('getQueue')).filter(task=>task.projectId===project.id).length,0);
    await writeFile(join(output,'result.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify(result));await save({finishedAt:new Date().toISOString()});
    app.exit(result.videos.length?0:1);
  }catch(error){const message=String(error).replace(/(?:https?|socks5h?):\/\/[^\s]+/gi,'[URL]');await save({error:message});console.error(message);app.exit(1);}
});
