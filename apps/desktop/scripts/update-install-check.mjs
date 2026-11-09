import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {mkdir,readFile,writeFile,appendFile,stat} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {basename,dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

// Exercises the installed application, its real IPC/preload/UI, HTTP download
// and NSIS replacement. All profiles, caches and installations are isolated.
const desktop=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(join(desktop,'package.json'));
const builder=join(dirname(require.resolve('electron-builder/package.json')),'cli.js');
const root=resolve(process.argv[2]??join(process.env.TEMP,'goldwork-update-check-'+Date.now()));
const install=join(root,'installed'),profile=join(root,'profile'),feed=join(root,'feed');
const appName='Gold Work Studio Update Test';
const executable=join(install,appName+'.exe');
const report={startedAt:new Date().toISOString(),root,baseVersion:'0.2.1',targetVersion:'0.2.2',requests:[],checks:{}};
const resumeUpdated=process.argv.includes('--resume-updated');
if(resumeUpdated){const previous=JSON.parse(await readFile(join(root,'update-test-result.json'),'utf8'));Object.assign(report,previous,{passed:false,resumedAt:new Date().toISOString(),previousTransportError:previous.error});delete report.error;}
let networkFailure=false;
await mkdir(feed,{recursive:true});await mkdir(profile,{recursive:true});
const server=createServer(async(req,res)=>{
  try{
    const filename=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname).slice(1);
    report.requests.push(filename);
    if(networkFailure){res.writeHead(503);res.end();return;}
    if(filename!==basename(filename)){res.writeHead(400);res.end();return;}
    const file=join(feed,filename),info=await stat(file);
    const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range??'');
    if(range){const start=Number(range[1]),end=range[2]?Math.min(Number(range[2]),info.size-1):info.size-1;
      res.writeHead(206,{'Content-Length':end-start+1,'Content-Range':`bytes ${start}-${end}/${info.size}`,'Accept-Ranges':'bytes'});
      createReadStream(file,{start,end}).pipe(res);
    }else{res.writeHead(200,{'Content-Length':info.size,'Accept-Ranges':'bytes'});createReadStream(file).pipe(res);}
  }catch{res.writeHead(404);res.end();}
});
const skipBuild=resumeUpdated||process.argv.includes('--skip-build');
const previousPort=skipBuild?JSON.parse(await readFile(join(root,'server.json'),'utf8')).port:0;
await new Promise(resolve=>server.listen(previousPort,'127.0.0.1',resolve));
await writeFile(join(root,'server.json'),JSON.stringify({port:server.address().port}));
const url=`http://127.0.0.1:${server.address().port}/`;
function run(file,args,options={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(file,args,{cwd:desktop,windowsHide:true,stdio:'inherit',...options});
    child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(`${basename(file)} exited ${code}`)));
  });
}
async function waitFor(work,timeout=90_000){
  const until=Date.now()+timeout;let last;
  while(Date.now()<until){try{const value=await work();if(value)return value;}catch(error){last=error;}await delay(400);}
  throw Error(`Timed out${last?': '+last.message:''}`);
}
async function build(version,output){
  const config=join(root,`build-${version}.yml`);
  await writeFile(config,`extends: ${JSON.stringify(join(desktop,'electron-builder.yml'))}\nappId: studio.goldwork.update.test\nproductName: ${JSON.stringify(appName)}\nextraMetadata:\n  name: gold-work-studio-update-test\n  version: ${JSON.stringify(version)}\ndirectories:\n  output: ${JSON.stringify(output)}\nnsis:\n  createDesktopShortcut: false\n  createStartMenuShortcut: false\n  runAfterFinish: false\npublish:\n  - provider: generic\n    url: ${JSON.stringify(url)}\n`);
  await run(process.execPath,[builder,'--win','nsis','--config',config,'--publish','never']);
}
async function connect(port){
  const target=await waitFor(async()=>{
    const targets=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());
    return targets.find(t=>t.type==='page'&&t.url.startsWith('file:')&&t.webSocketDebuggerUrl);
  },180_000);
  const socket=new WebSocket(target.webSocketDebuggerUrl);let id=0;const pending=new Map();
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  socket.addEventListener('message',event=>{const result=JSON.parse(event.data);const task=pending.get(result.id);if(!task)return;pending.delete(result.id);
    if(result.error)task.reject(Error(result.error.message));else task.resolve(result.result);});
  socket.addEventListener('close',()=>{for(const task of pending.values())task.reject(Error('Application disconnected'));pending.clear();});
  const evaluate=async(expression)=>{
    const message={id:++id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}};
    const result=await new Promise((resolve,reject)=>{pending.set(message.id,{resolve,reject});socket.send(JSON.stringify(message));});
    if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);
    return result.result.value;
  };
  await waitFor(()=>evaluate('Boolean(window.goldWork)'));
  return {evaluate,close:()=>socket.close()};
}
async function launch(port){
  const child=spawn(executable,[`--remote-debugging-port=${port}`],{windowsHide:true,stdio:['ignore','pipe','pipe'],
    env:{...process.env,GWS_USER_DATA_DIR:profile,GWS_BACKGROUND_TEST:'1',ELECTRON_RENDERER_URL:'',PORTABLE_EXECUTABLE_DIR:''}});
  child.stdout.on('data',part=>{void appendFile(join(root,'application.log'),part);});
  child.stderr.on('data',part=>{void appendFile(join(root,'application.log'),part);});
  child.on('error',()=>{});
  return {child,client:await connect(port)};
}
async function stopOwnedProcesses(){
  // Match the resolved installation path; never stop another GoldWork copy.
  const literal=executable.replace(/'/g,"''");
  await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${literal}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`],{stdio:'ignore'});
}
try{
  let project={id:report.checks.projectCreated,title:'Сохранение проекта после обновления'};
  const sentinel=JSON.stringify({project:'preserved',setting:'original',value:42});
  if(!resumeUpdated){
  if(!skipBuild){await build(report.baseVersion,join(root,'base'));await build(report.targetVersion,feed);}
  const setup=join(root,'base',`Gold-Work-Studio-${report.baseVersion}-Setup.exe`);
  await run(setup,['/S',`/D=${install}`],{stdio:'ignore'});
  await waitFor(()=>stat(executable).then(()=>true));
  await writeFile(join(profile,'update-preservation.json'),sentinel);
  const base=await launch(19361);
  const before=await base.client.evaluate('window.goldWork.getAppInfo()');
  assert.equal(before.version,report.baseVersion);assert.equal(resolve(before.dataPath),profile);
  project=await base.client.evaluate('window.goldWork.createProject({title:"Сохранение проекта после обновления",topic:"update check",aspectRatio:"16:9",language:"Русский",mode:"standard",mediaMode:"stock"})');
  assert.ok(project.id);
  report.checks.projectCreated=project.id;
  await base.client.evaluate('window.__updateStates=[];window.goldWork.onAppUpdateState(s=>window.__updateStates.push(s));window.goldWork.checkAppUpdates()');
  const downloaded=await waitFor(async()=>{
    const state=await base.client.evaluate('window.goldWork.getAppUpdateState()');
    if(state.status==='error')throw Error(state.message);
    return state.status==='downloaded'?state:false;
  },180_000);
  assert.equal(downloaded.availableVersion,report.targetVersion);
  report.checks.downloaded=downloaded;
  const banner=await base.client.evaluate('document.querySelector(".app-update-panel.compact")?.innerText');
  assert.match(banner??'',/0\.2\.2/);assert.match(banner,/Перезапустить и установить/);
  report.checks.banner= banner;
  const states=await base.client.evaluate('window.__updateStates');
  assert.ok(states.some(s=>s.status==='downloading'));
  report.checks.progress=states.filter(s=>s.status==='downloading').map(s=>s.percent);
  await base.client.evaluate('document.querySelector(".app-update-panel.compact button").click();true');
  await waitFor(()=>base.child.exitCode!==null||base.child.signalCode!==null);
  base.client.close();
  // The actual updater relaunches after replacing the installation. Obtain a
  // fresh CDP endpoint from that installed executable for the post-update check.
  await waitFor(async()=>{
    const metadata=await new Promise((resolve,reject)=>{
      const command=`(Get-Item -LiteralPath '${executable.replace(/'/g,"''")}').VersionInfo.ProductVersion`;
      const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true});let text='';
      child.stdout.on('data',part=>text+=part);child.once('error',reject);child.once('exit',()=>resolve(text.trim()));
    });
    return String(metadata).startsWith(report.targetVersion);
  },120_000);
  await delay(3500);await stopOwnedProcesses();
  }
  const updated=resumeUpdated?{client:await connect(19362)}:await launch(19362);
  const after=await updated.client.evaluate('window.goldWork.getAppInfo()');
  assert.equal(after.version,report.targetVersion);assert.equal(resolve(after.dataPath),profile);
  assert.equal(await readFile(join(profile,'update-preservation.json'),'utf8'),sentinel);
  const preserved=await updated.client.evaluate(`window.goldWork.getProject(${JSON.stringify(project.id)})`);
  assert.equal(preserved.title,project.title);
  report.checks.installedVersion=after.version;report.checks.projectPreserved=true;report.checks.settingsPreserved=true;
  const latest=await updated.client.evaluate('window.goldWork.checkAppUpdates()');
  assert.equal(latest.status,'up-to-date');report.checks.noFurtherUpdate=true;
  networkFailure=true;
  const failure=await updated.client.evaluate('window.goldWork.checkAppUpdates()');
  assert.equal(failure.status,'error');report.checks.networkFailureHandled=true;networkFailure=false;
  assert.equal((await updated.client.evaluate('window.goldWork.checkAppUpdates()')).status,'up-to-date');
  assert.ok(report.requests.some(path=>path.endsWith('-Setup.exe')));
  await updated.client.evaluate('window.goldWork.closeWindow()');updated.client.close();
  report.passed=true;console.log(JSON.stringify({passed:true,version:after.version,projectPreserved:true,root}));
}catch(error){report.passed=false;report.error=error.stack;throw error;}
finally{
  await stopOwnedProcesses().catch(()=>{});
  server.close();
  report.completedAt=new Date().toISOString();
  await writeFile(join(root,'update-test-result.json'),JSON.stringify(report,null,2));
}
