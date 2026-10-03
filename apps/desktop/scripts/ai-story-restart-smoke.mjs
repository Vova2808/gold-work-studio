import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {resolve,join,relative,isAbsolute} from 'node:path';

// Real packaged Electron/IPC, an abrupt exit and a fresh process. Only this QA
// profile and local MockImage/FFmpeg are used; no user credentials or providers.
const binary=resolve(process.argv[2]??'release/ai-story-20260908-scenario-repair-verified/win-unpacked/Gold Work Studio.exe');
assert.ok(binary.includes('ai-story-20260908'),'Use a separate QA build');
const root=await mkdtemp(join(tmpdir(),'gws-ai-story-restart-'));
const output=resolve('apps/desktop/captures/ai-story-restart',String(Date.now()));
await mkdir(output,{recursive:true});
let launchBinary=binary;
if(binary.endsWith('-portable.exe')) {
  launchBinary=join(root,'Gold Work Studio.exe');
  await copyFile(binary,launchBinary);
}
const delay=ms=>new Promise(done=>setTimeout(done,ms));
const inside=(path)=>{const local=relative(root,path);return local!==''&&!local.startsWith('..')&&!isAbsolute(local);};
const sha=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
let session;

// Pre-existing library fixture only; no project.json is hand-edited and no provider is called.
const libraryRoot=join(root,'workspace','workspace','channel-characters','channel-qa-a');
await mkdir(libraryRoot,{recursive:true});
const heroImage=join(libraryRoot,'hero.png');
await writeFile(heroImage,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4SIAAAAASUVORK5CYII=','base64'));
const hero={versionId:'hero-v1',channelProfileId:'channel-qa-a',name:'QA hero',prompt:'Gray coat, white round head',
  imagePath:heroImage,stylePrompt:'Flat 2D watercolor',createdAt:'2026-09-08T00:00:00Z',updatedAt:'2026-09-08T00:00:00Z'};
const baseChannel={countryCode:'RU',languageCode:'ru',languageLabel:'Русский',masterPrompt:'Offline illustrated story',
  defaultDurationMinutes:1,direction:'ai-story',defaultMediaMode:'ai',motionTemplate:'Без шаблона',
  createdAt:'2026-09-08T00:00:00Z',updatedAt:'2026-09-08T00:00:00Z'};
await mkdir(join(root,'workspace','database'),{recursive:true});
await writeFile(join(root,'workspace','database','channel-profiles.json'),JSON.stringify([
  {...baseChannel,id:'channel-qa-a',name:'Hero library A',defaultImageStyle:'Ink drawing',primaryCharacter:hero,
    characterVersions:[hero,{...hero,versionId:'hero-v2',prompt:'Gray coat, red scarf'}]},
  {...baseChannel,id:'channel-qa-b',name:'Independent channel B',characterVersions:[]},
]));

async function start() {
  const server=createServer();
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const port=server.address().port;
  await new Promise(done=>server.close(done));
  const env={...process.env,PORTABLE_EXECUTABLE_DIR:root};delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(launchBinary,[`--user-data-dir=${join(root,'chromium')}`,`--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1','--disable-gpu'],{env,windowsHide:true,stdio:'ignore'});
  let page;
  for(let index=0;index<480;index++) {
    page=(await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json()).catch(()=>[])).find(p=>p.type==='page'&&p.url.startsWith('file:'));
    if(page)break;
    assert.equal(child.exitCode,null,'QA launcher exited before opening a page');
    if(index>0&&index%80===0)console.log(`[restart] Waiting for QA startup: ${index/4}s`);
    await delay(250);
  }
  assert.ok(page,'QA renderer did not start');
  const socket=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((done,reject)=>{socket.addEventListener('open',done,{once:true});socket.addEventListener('error',reject,{once:true});});
  let id=0;const pending=new Map();
  socket.addEventListener('message',event=>{
    const message=JSON.parse(event.data),request=pending.get(message.id);if(!request)return;
    pending.delete(message.id);clearTimeout(request.timer);
    message.error?request.reject(new Error(message.error.message)):request.done(message.result);
  });
  const call=(method,params={})=>new Promise((done,reject)=>{
    const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(new Error(`CDP timeout: ${method}`));},method==='Browser.close'?1500:30_000);
    pending.set(key,{done,reject,timer});socket.send(JSON.stringify({id:key,method,params}));
  });
  const evaluate=async expression=>{
    const reply=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});
    if(reply.exceptionDetails)throw new Error(reply.exceptionDetails.exception?.description??reply.exceptionDetails.text);
    return reply.result.value;
  };
  const waitFor=async(expression,label)=>{
    for(let attempt=0;attempt<150;attempt++){if(await evaluate(expression))return;await delay(100);}
    throw new Error(`QA timeout: ${label}`);
  };
  await waitFor('Boolean(window.goldWork)','preload');
  const info=await evaluate('goldWork.getAppInfo()');
  assert.ok(inside(info.dataPath)&&inside(info.workspacePath),'Never operate on a user profile');
  const click=async selector=>{
    await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`,selector);
    const point=await evaluate(`(()=>{const button=document.querySelector(${JSON.stringify(selector)});
      if(button.disabled)throw new Error('Disabled QA action');button.scrollIntoView({block:'center'});
      const r=button.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
      if(!button.contains(document.elementFromPoint(x,y)))throw new Error('QA action obscured');return{x,y};})()`);
    await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
    await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
  };
  return {child,socket,call,evaluate,waitFor,click,info};
}

try {
  session=await start();
  assert.deepEqual(await session.evaluate('goldWork.listProjects()'),[]);
  const characterProjects=await session.evaluate(`(async()=>{
    const create=(title,channelProfileId)=>goldWork.createProject({title,topic:'Library reuse only',language:'Русский',aspectRatio:'16:9',mode:'standard',mediaMode:'ai',channelProfileId});
    const first=await create('Hero source','channel-qa-a');
    const second=await create('Hero reused','channel-qa-a');
    const other=await create('No foreign hero','channel-qa-b');
    if(first.settings.image.style!=='Ink drawing'||second.settings.image.style!=='Ink drawing')throw new Error('Channel style was not inherited through real IPC');
    await goldWork.useChannelCharacterReference(first.id);
    await goldWork.useChannelCharacterReference(second.id);
    let denied=false;
    try{await goldWork.useChannelCharacterReference(other.id,'hero-v1');}catch{denied=true;}
    if(!denied)throw new Error('A hero crossed channel boundaries');
    const settings={...second.settings,image:{...second.settings.image,style:'Explicit project override'}};
    await goldWork.updateProject(second.id,{settings});
    await goldWork.useChannelCharacterReference(second.id);
    // Selecting a new version is explicit, does not mutate a previously completed choice elsewhere.
    await goldWork.confirmChannelCharacterReference(first.id,'hero-v2');
    return {first:first.id,second:second.id,other:other.id};
  })()`);
  const projectId=await session.evaluate(`(async()=>{
    const project=await goldWork.createProject({title:'AI Story restart acceptance',topic:'Local restart fixture',language:'Русский',aspectRatio:'16:9',mode:'standard',mediaMode:'ai'});
    project.settings.voice.enabled=false;project.settings.video.enabled=false;project.settings.image.provider='mock-image';
    project.settings.music.enabled=false;project.settings.subtitles.enabled=false;
    project.settings.assembly.quality='preview';project.settings.assembly.kenBurns=false;project.settings.assembly.fadeTransitions=false;
    const scenes=Array.from({length:9},(_,order)=>({id:'restart-'+order,order,title:'Кадр '+(order+1),narration:'',
      imagePrompt:'Local frame '+order,animationPrompt:'None',durationSeconds:3,status:'ready',includeInAssembly:order!==8}));
    await goldWork.updateProject(project.id,{settings:project.settings,scenes});await goldWork.startGeneration(project.id);return project.id;
  })()`);
  const firstPid=session.info.mainProcessId;
  const queuePath=join(session.info.dataPath,'queue.json');
  let before;
  for(let index=0;index<200;index++) {
    const snapshot=JSON.parse(await readFile(queuePath,'utf8'));
    if(snapshot.some(t=>t.kind==='image'&&t.status==='done')&&snapshot.some(t=>t.kind==='image'&&t.status!=='done')){before=snapshot;break;}
    await delay(25);
  }
  assert.ok(before,'Must interrupt a genuinely partial run, not a completed fixture');
  const durable=await Promise.all(before.filter(t=>t.status==='done').map(async task=>{
    assert.ok(task.resultPath&&inside(task.resultPath));
    return {id:task.id,attempts:task.attempts,resultPath:task.resultPath,sha256:await sha(task.resultPath)};
  }));
  await writeFile(join(output,'before.json'),JSON.stringify({projectId,pid:firstPid,tasks:before,durable},null,2));
  // Confirm the exact live PID/profile immediately before killing only this QA app.
  const identity=await session.evaluate('goldWork.getAppInfo()');
  assert.equal(identity.mainProcessId,firstPid);assert.equal(identity.dataPath,session.info.dataPath);
  process.kill(firstPid,'SIGKILL');session.socket.close();
  let gone=false;
  for(let index=0;index<100;index++) {
    try{process.kill(firstPid,0);}catch(error){if(error.code==='ESRCH'){gone=true;break;}throw error;}
    await delay(50);
  }
  assert.ok(gone,'Do not restart until the previous QA main process is gone');
  if(session.child.exitCode===null)session.child.kill();
  console.log(`[restart] Abruptly closed own QA process after ${durable.length} durable image results`);
  session=await start();
  assert.notEqual(session.info.mainProcessId,firstPid,'Recovery must use a new process');
  const library=await session.evaluate(`(async()=>{
    const ids=${JSON.stringify(characterProjects)};
    return {first:await goldWork.getProject(ids.first),second:await goldWork.getProject(ids.second),other:await goldWork.getProject(ids.other),
      channels:await goldWork.listChannelProfiles()};
  })()`);
  assert.equal(library.first.characterReference.versionId,'hero-v2');
  assert.equal(library.second.characterReference.versionId,'hero-v1','A new channel version must not silently replace older projects');
  assert.equal(library.second.settings.image.style,'Explicit project override');
  assert.deepEqual(library.second.settings.image.references,[heroImage]);
  assert.equal(library.other.characterReference,undefined);
  assert.ok(!library.other.settings.image.references.includes(heroImage));
  assert.equal(library.channels.find(channel=>channel.id==='channel-qa-a').primaryCharacter.versionId,'hero-v2');
  assert.equal(library.channels.find(channel=>channel.id==='channel-qa-b').primaryCharacter,undefined);
  console.log('[restart] PASS channel style, reusable/versioned hero, other-channel isolation and retained project override after process restart');
  const restored=await session.evaluate('goldWork.getQueue()');
  assert.deepEqual(restored.map(t=>t.id).sort(),before.map(t=>t.id).sort(),'Restart must retain task identities');
  assert.ok(restored.some(t=>t.status==='paused'));
  assert.ok(restored.every(t=>t.status==='done'||t.status==='paused'),'Recovery must not automatically launch unfinished work');
  assert.equal((await session.evaluate(`goldWork.getProject(${JSON.stringify(projectId)})`)).status,'paused');
  for(const saved of durable) {
    const task=restored.find(t=>t.id===saved.id);assert.equal(task.status,'done');assert.equal(task.attempts,saved.attempts);
    assert.equal(task.resultPath,saved.resultPath);assert.equal(await sha(saved.resultPath),saved.sha256);
  }
  // More than two real scheduler ticks with the fresh process alive, but no Resume.
  await delay(1200);
  assert.deepEqual(await session.evaluate('goldWork.getQueue()'),restored,'Restored work must stay paused until explicit action');
  await session.click('[data-nav-key="queue"]');
  await session.waitFor('[...document.querySelectorAll(".queue-project-controls button")].some(b=>b.textContent.includes("Продолжить"))','restored queue UI');
  if(await session.evaluate('Boolean(document.querySelector(".startup-health-toast"))'))await session.click('.startup-health-toast button[aria-label="Закрыть"]');
  const capture=await session.call('Page.captureScreenshot',{format:'png'});
  await writeFile(join(output,'restored-paused.png'),Buffer.from(capture.data,'base64'));
  await session.evaluate(`[...document.querySelectorAll('.queue-project-controls button')].find(b=>b.textContent.includes('Продолжить')).dataset.qaResume='true'`);
  await session.click('[data-qa-resume]');
  let completed;
  for(let index=0;index<240;index++) {
    completed=await session.evaluate(`goldWork.getProject(${JSON.stringify(projectId)})`);
    if(completed.status==='complete')break;
    assert.notEqual(completed.status,'failed','Resumed generation failed');await delay(250);
  }
  assert.equal(completed.status,'complete');assert.ok(inside(completed.outputPath));
  const finished=await session.evaluate('goldWork.getQueue()');assert.ok(finished.every(t=>t.status==='done'));
  assert.deepEqual(finished.map(t=>t.id).sort(),before.map(t=>t.id).sort(),'Resume must not replace the run with new tasks');
  for(const saved of durable) {
    assert.equal(finished.find(t=>t.id===saved.id).attempts,saved.attempts,'Completed work must not execute again');
    assert.equal(await sha(saved.resultPath),saved.sha256,'Completed media must remain byte-identical');
  }
  assert.equal(finished.filter(t=>t.kind==='image').length,8,'Excluded frame must not enter the resumed run');
  const seconds=await session.evaluate(`new Promise((done,reject)=>{
    const video=document.createElement('video');video.src=goldWork.mediaUrl(${JSON.stringify(completed.outputPath)});
    video.onloadedmetadata=()=>done(video.duration);video.onerror=()=>reject(new Error('Resumed Final decode failed'));video.load();})`);
  assert.ok(Math.abs(seconds-24)<0.2);
  const result={binary,profile:root,projectId,firstPid,secondPid:session.info.mainProcessId,buildId:session.info.buildId,
    durableImages:durable.length,taskCount:finished.length,taskIdsRetained:true,completedMediaUnchanged:true,
    stayedPaused:true,uiResume:true,seconds,outputPath:completed.outputPath,localProvidersOnly:true,
    channelLibrary:{fixtureOnly:true,styleInherited:true,reusedAfterRestart:true,crossChannelDenied:true,existingProjectVersionRetained:true,projectStyleOverrideRetained:true}};
  await writeFile(join(output,'result.json'),JSON.stringify(result,null,2));
  console.log(`[restart] PASS new process, durable files/tasks, paused recovery, UI Resume, ${seconds}s Final. ${output}`);
} catch(error) {
  await writeFile(join(output,'failure.json'),JSON.stringify({error:String(error.stack??error),profile:root},null,2));
  throw error;
} finally {
  if(session?.socket.readyState===1){await session.call('Browser.close').catch(()=>{});session.socket.close();}
  if(session?.child.exitCode===null)session.child.kill();
}
