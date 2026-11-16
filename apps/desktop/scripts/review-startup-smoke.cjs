// Real main/preload/renderer, an isolated empty profile, no paid provider calls.
const {app,BrowserWindow}=require('electron');
const {mkdirSync,writeFileSync}=require('node:fs');
const {resolve,join}=require('node:path');
const assert=require('node:assert/strict');
const captures=resolve(__dirname,'../../../captures/review-startup');
mkdirSync(captures,{recursive:true});
process.env.GWS_USER_DATA_DIR=join(captures,'profile-'+Date.now());
process.env.GWS_BACKGROUND_TEST='1';
delete process.env.ELECTRON_RENDERER_URL;
const failures=[];
app.on('web-contents-created',(_event,contents)=>{
  contents.on('render-process-gone',(_e,details)=>failures.push(details.reason));
  contents.on('preload-error',(_e,_path,error)=>failures.push(error.message));
});
require('../dist/main/index.cjs');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(read,label){
  for(let i=0;i<150;i++){const value=await read();if(value)return value;await sleep(100);}
  throw Error('Timed out: '+label);
}
app.whenReady().then(async()=>{
  const window=await until(()=>BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&w.webContents.getURL().includes('/renderer/')),'main window');
  const run=code=>window.webContents.executeJavaScript(code,true);
  await until(()=>run('Boolean(window.goldWork && document.querySelector("[data-nav-key=projects]"))'),'React + preload');
  await until(()=>run(`Boolean([...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Открыть приложение'&&!e.disabled))`),'startup checks');
  await run(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Открыть приложение').click()`);
  const result=await run(`(async()=>{
    const api=window.goldWork;
    if(typeof api.resolveUncertainSubmission!=='function')throw Error('Missing queue IPC');
    let project=await api.createProject({title:'Review fixes smoke',topic:'Local stock settings',mediaMode:'stock',mode:'standard',language:'English',aspectRatio:'16:9'});
    project=await api.updateProject(project.id,{expectedUpdatedAt:project.updatedAt,settings:{...project.settings,voice:{...project.settings.voice,enabled:false}},
      scenes:[{id:'smoke-scene',order:0,title:'Smoke',narration:'A ship crosses the ocean.',durationSeconds:5,status:'draft',imagePrompt:'',animationPrompt:''}]});
    const info=await api.getAppInfo();
    return {projectId:project.id,policy:project.settings.assembly.documentary?.missingMaterialPolicy,
      retry:project.settings.assembly.documentary?.retryEmptyVisualResponse,info};
  })()`);
  assert.equal(result.policy,'related');assert.equal(result.retry,true);
  await new Promise(resolve=>{window.webContents.once('did-finish-load',resolve);window.webContents.reload();});
  await until(()=>run('Boolean(document.querySelector("[data-nav-key=projects]"))'),'navigation');
  await until(()=>run(`Boolean([...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Открыть приложение'&&!e.disabled))`),'startup checks after reload');
  await run(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Открыть приложение').click()`);
  await run('document.querySelector("[data-nav-key=projects]").click()');
  const projectRow=`[...document.querySelectorAll('.projects-table-row')].find(e=>e.textContent.includes('Review fixes smoke'))`;
  await until(()=>run(`Boolean(${projectRow})`),'saved local project');
  await run(`${projectRow}.click()`);
  await until(()=>run(`Boolean([...document.querySelectorAll('.project-expand button')].find(e=>e.textContent.trim()==='Настроить'))`),'configure action');
  await run(`[...document.querySelectorAll('.project-expand button')].find(e=>e.textContent.trim()==='Настроить').click()`);
  await until(()=>run(`Boolean(document.querySelector('[data-flow-step=settings]'))`),'settings step');
  await run(`(()=>{const button=document.querySelector('[data-flow-step=settings]');if(!button.disabled)button.click();})()`);
  await until(()=>run(`document.body.textContent.includes('Если точный материал не найден')`),'new footage policy');
  const controls=await run(`(()=>{
    const fields=[...document.querySelectorAll('label')];
    const value=text=>fields.find(e=>e.textContent.includes(text))?.querySelector('select')?.value;
    return {policy:value('Если точный материал не найден'),quota:value('Доля видео'),queueApi:typeof window.goldWork.resolveUncertainSubmission};
  })()`);
  assert.deepEqual(controls,{policy:'related',quota:'target',queueApi:'function'});
  await run(`document.querySelector('option[value=related]').closest('label').scrollIntoView({block:'center'})`);
  await sleep(150);
  writeFileSync(join(captures,'settings.png'),(await window.webContents.capturePage()).toPNG());
  assert.deepEqual(failures,[]);
  const report={passed:true,controls,build:result.info,profile:process.env.GWS_USER_DATA_DIR};
  writeFileSync(join(captures,'result.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:true,controls}));app.exit(0);
}).catch(async error=>{
  console.error(error);
  const window=BrowserWindow.getAllWindows().find(w=>!w.isDestroyed());
  if(window){
    console.error(await window.webContents.executeJavaScript('document.body.innerText.slice(0,3500)').catch(()=>''));
    writeFileSync(join(captures,'failure.png'),(await window.webContents.capturePage()).toPNG());
  }
  app.exit(1);
});
setTimeout(()=>{console.error('Startup smoke exceeded 45 seconds');app.exit(1);},45000).unref();
