import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, readFile, writeFile, copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, join} from 'node:path';
import {createServer} from 'node:net';
import {createHash} from 'node:crypto';

// Tests the packaged backend/preload/UI with a fresh profile and local Mock Image only.
// It does not open the user's profile, copy credentials, or submit provider requests.
const binary = resolve(process.argv[2] ?? 'release/ai-story-20260908/win-unpacked/Gold Work Studio.exe');
assert.ok(binary.includes('ai-story-20260908'), 'Use the separate QA build, never the user installation');
const profile = await mkdtemp(join(tmpdir(), 'gws-portable-ai-story-'));
// The NSIS portable launcher sets PORTABLE_EXECUTABLE_DIR itself. Run a copy beside
// the fresh QA workspace so even the self-extracting exe cannot touch user data.
let launchBinary = binary;
if (binary.endsWith('-portable.exe')) {
  launchBinary = join(profile,'Gold Work Studio.exe');
  await copyFile(binary,launchBinary);
}
const portServer = createServer();
await new Promise(resolvePort => portServer.listen(0, '127.0.0.1', resolvePort));
const port = portServer.address().port;
await new Promise(resolveClose => portServer.close(resolveClose));
const wait = ms => new Promise(resolveWait => setTimeout(resolveWait, ms));
const env = {...process.env, PORTABLE_EXECUTABLE_DIR:profile};
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(launchBinary, [`--user-data-dir=${join(profile,'chromium')}`, `--remote-debugging-port=${port}`,
  '--remote-debugging-address=127.0.0.1', '--disable-gpu', '--enable-logging'], {env, windowsHide:true, stdio:['ignore','pipe','pipe']});
const launchStarted = Date.now();
console.log(`[portable-ai-story] QA profile: ${profile}`);
let startupOutput = '';
for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { startupOutput=(startupOutput+chunk.toString()).slice(-5000); });
let socket;
let ownPage;
const pending = new Map();
let nextId = 0;
const send = (method, params={}) => new Promise((resolveCall, reject) => {
  const id = ++nextId;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, method === 'Browser.close' ? 1500 : 30_000);
  pending.set(id, {resolve:value => {clearTimeout(timer); resolveCall(value);}, reject:error => {clearTimeout(timer); reject(error);}});
  socket.send(JSON.stringify({id,method,params}));
});
const evaluate = async expression => {
  const response = await send('Runtime.evaluate', {expression, awaitPromise:true, returnByValue:true, userGesture:true});
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  return response.result.value;
};
const waitFor = async (expression,label) => {
  for(let attempt=0;attempt<100;attempt++) {
    if(await evaluate(expression)) return;
    await wait(100);
  }
  throw new Error(`Portable UI timeout: ${label}`);
};
const click = async selector => {
  await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`,selector);
  const point=await evaluate(`(()=>{
    const button=document.querySelector(${JSON.stringify(selector)});
    if(button.disabled)throw new Error('Disabled: '+${JSON.stringify(selector)});
    button.scrollIntoView({block:'center'});
    const rect=button.getBoundingClientRect(),x=rect.x+rect.width/2,y=rect.y+rect.height/2;
    const hit=document.elementFromPoint(x,y);
    if(!button.contains(hit))throw new Error('Obscured: '+${JSON.stringify(selector)}+'; hit='+(hit?.tagName??'none')+'.'+(hit?.className??'')+'; at '+x+','+y);
    return {x,y};
  })()`);
  await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
};
try {
  // A cold NSIS portable launch first extracts the bundled runtimes. It is not
  // renderer readiness; keep a separate bounded budget and visible diagnostics.
  for (let attempt=0; attempt<480; attempt++) {
    const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json()).catch(() => []);
    ownPage = pages.find(page => page.type === 'page' && page.url.startsWith('file:'));
    if (ownPage) break;
    assert.equal(child.exitCode, null, 'QA application exited during startup');
    if(attempt>0 && attempt%40===0) console.log(`[portable-ai-story] Waiting for cold launcher/renderer: ${Math.round((Date.now()-launchStarted)/1000)}s`);
    await wait(250);
  }
  assert.ok(ownPage, `Packaged renderer did not open: ${startupOutput}`);
  const startupSeconds=(Date.now()-launchStarted)/1000;
  console.log(`[portable-ai-story] Renderer connected after ${startupSeconds}s`);
  // Assert that the launched backend actually uses the isolated workspace before making any mutations.
  const startupLog = await readFile(join(profile,'workspace','logs','gold-work-studio-log.txt'),'utf8');
  assert.ok(startupLog.includes('app.ready'));
  socket = new WebSocket(ownPage.webSocketDebuggerUrl);
  await new Promise((resolveOpen,reject) => {socket.addEventListener('open',resolveOpen,{once:true});socket.addEventListener('error',reject,{once:true});});
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (!pending.has(message.id)) return;
    const request = pending.get(message.id); pending.delete(message.id);
    message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
  });
  for (let attempt=0; attempt<80 && !await evaluate('Boolean(window.goldWork)'); attempt++) await wait(100);
  assert.deepEqual(await evaluate('goldWork.listProjects()'), [], 'Fresh QA workspace must contain no user projects');
  const id = await evaluate(`(async () => {
    const channel=await goldWork.createChannelProfile({name:'Portable AI Story QA',countryCode:'RU',languageCode:'ru',languageLabel:'Русский',
      direction:'ai-story',defaultMediaMode:'ai',defaultDurationMinutes:1,masterPrompt:'Flat 2D illustrated stories. No overlays.'});
    window.portableQaChannelId=channel.id;
    const project = await goldWork.createProject({title:'Portable AI Story acceptance',topic:'Local isolated fixture',language:'Русский',aspectRatio:'16:9',mode:'standard',mediaMode:'ai',channelProfileId:channel.id});
    project.settings.voice.enabled=false; project.settings.video.enabled=false;
    project.settings.image.provider='mock-image'; project.settings.music.enabled=false;
    project.settings.assembly.quality='preview'; project.settings.assembly.kenBurns=false;
    project.settings.assembly.fadeTransitions=true; project.settings.assembly.transitionType='mix';
    project.settings.subtitles.enabled=false;
    const scenes = Array.from({length:4},(_,order) => ({id:'portable-'+order,order,title:'Кадр '+(order+1),
      narration:'',imagePrompt:'Local illustrated frame '+order,animationPrompt:'Gentle motion',durationSeconds:3,status:'ready',includeInAssembly:order!==3}));
    await goldWork.updateProject(project.id,{settings:project.settings,scenes});
    await goldWork.startGeneration(project.id);
    await goldWork.pauseGeneration(project.id);
    return project.id;
  })()`);
  const paused = await evaluate(`goldWork.getProject(${JSON.stringify(id)})`);
  assert.equal(paused.status, 'paused');
  await evaluate(`goldWork.resumeGeneration(${JSON.stringify(id)})`);
  console.log('[portable-ai-story] Real IPC queue started, pause/resume passed (local-only providers)');
  let completed;
  for (let attempt=0; attempt<160; attempt++) {
    completed = await evaluate(`goldWork.getProject(${JSON.stringify(id)})`);
    if (completed.status === 'complete') break;
    if (completed.status === 'failed') throw new Error(JSON.stringify(await evaluate('goldWork.getQueue()')));
    await wait(250);
  }
  assert.equal(completed.status,'complete');
  assert.ok(completed.outputPath?.startsWith(profile), 'Final must stay inside QA data');
  const queue = await evaluate('goldWork.getQueue()');
  assert.equal(queue.filter(t=>t.kind==='image').length,3);
  assert.ok(queue.every(t=>t.status==='done'));
  const saved = JSON.parse(await readFile(join(completed.outputPath,'..','project.json'),'utf8'));
  assert.equal(saved.status,'complete');
  assert.equal(saved.outputPath,completed.outputPath);
  const media = await evaluate(`(async () => {
    const url=goldWork.mediaUrl(${JSON.stringify(completed.outputPath)});
    const response=await fetch(url,{headers:{Range:'bytes=0-127'}});
    const video=document.createElement('video'); video.muted=true;video.src=url;
    const ready=new Promise((resolveVideo,reject)=>{video.onloadedmetadata=()=>resolveVideo(video.duration);video.onerror=()=>reject(new Error('Packaged video decoder failed'));});
    document.body.append(video);
    const seconds=await ready; video.remove(); return {rangeStatus:response.status,bytes:(await response.arrayBuffer()).byteLength,seconds};
  })()`);
  assert.equal(media.rangeStatus,206); assert.equal(media.bytes,128);
  assert.ok(Math.abs(media.seconds-9)<0.2);
  // Exercise the actual packaged renderer, not only IPC calls from a test harness.
  await click('[data-nav-key="projects"]');
  await waitFor('document.querySelector(".projects-table-row")?.textContent.includes("Portable AI Story acceptance")','project list');
  await click('.projects-table-row');
  await waitFor('[...document.querySelectorAll(".project-expand button")].some(button=>button.textContent.includes("Настроить"))','project actions');
  await evaluate(`[...document.querySelectorAll('.project-expand button')].find(button=>button.textContent.includes('Настроить')).dataset.portableSettings='true'`);
  await click('[data-portable-settings]');
  await waitFor('Boolean(document.querySelector("[data-flow-step=settings][aria-current=step]"))','settings navigation settles');
  if(await evaluate('Boolean(document.querySelector(".startup-health-toast"))')) await click('.startup-health-toast button[aria-label="Закрыть"]');
  if (binary.includes('project-settings') || binary.includes('headroom')) {
    assert.equal(await evaluate('document.querySelectorAll("[data-settings-card]").length'),4);
    assert.equal(await evaluate('Boolean(document.querySelector(".chat-topic-source"))'),false);
    assert.equal(await evaluate('document.querySelector(".sticky-actions .generate-button").textContent.trim()'),'Начать генерацию');
    await click('.ai-story-settings > .ai-settings-more > summary');
    assert.equal(await evaluate('document.querySelector(".ai-settings-advanced-grid input").checked'),false);
    await click('.ai-story-settings > .ai-settings-more > summary');
    const settingsOutput=resolve('apps/desktop/captures/portable-ai-story'); await mkdir(settingsOutput,{recursive:true});
    const settingsPng=await send('Page.captureScreenshot',{format:'png'});
    await writeFile(join(settingsOutput,'project-settings.png'),Buffer.from(settingsPng.data,'base64'));
  }
  await waitFor('document.querySelector("[data-flow-step=export]")?.disabled===false','completed project enables export');
  await click('[data-flow-step="export"]');
  await waitFor('document.querySelector(".preview-modal video")?.readyState>=1','export video metadata');
  assert.ok(Math.abs(await evaluate('document.querySelector(".preview-modal video").duration')-9)<0.2);
  await click('.preview-modal [data-flow-step="editor"]');
  await waitFor('Boolean(document.querySelector(".timeline-studio"))','actual editor');
  await click('.timeline-studio [data-flow-step="export"]');
  await waitFor('document.querySelector(".preview-modal video")?.readyState>=2','editor to export with decoded frame');
  await waitFor('[...document.querySelectorAll(".preview-scene > .scene-thumb")].every(image=>image.complete && image.naturalWidth>0)','loaded export thumbnails');
  const exportLayout=await evaluate(`(()=>{
    const player=document.querySelector('.preview-player').getBoundingClientRect();
    const video=document.querySelector('.preview-player video'),videoRect=video.getBoundingClientRect();
    const gallery=document.querySelector('.scene-gallery').getBoundingClientRect();
    const footer=document.querySelector('.preview-modal > footer').getBoundingClientRect();
    const thumbnail=document.querySelector('.preview-scene > .scene-thumb').getBoundingClientRect();
    const caption=document.querySelector('.preview-scene > div:last-child').getBoundingClientRect();
    const card=document.querySelector('.preview-scene').getBoundingClientRect();
    return {playerBottom:player.bottom,galleryTop:gallery.top,galleryBottom:gallery.bottom,
      footerTop:footer.top,thumbnailBottom:thumbnail.bottom,captionTop:caption.top,captionBottom:caption.bottom,cardBottom:card.bottom,
      videoBottom:videoRect.bottom,videoHit:document.elementFromPoint(videoRect.x+videoRect.width/2,videoRect.y+videoRect.height/2)===video};
  })()`);
  assert.ok(exportLayout.videoBottom<=exportLayout.galleryTop+1,'Packaged gallery overlaps actual video content');
  assert.ok(exportLayout.videoHit,'Packaged video is obscured');
  assert.ok(exportLayout.playerBottom<=exportLayout.galleryTop+1,'Packaged gallery overlaps the video player');
  assert.ok(exportLayout.galleryBottom<=exportLayout.footerTop+1,'Packaged gallery overlaps export actions');
  assert.ok(exportLayout.thumbnailBottom<=exportLayout.captionTop+1,'Packaged thumbnail overlaps its caption');
  assert.ok(exportLayout.captionBottom<=exportLayout.cardBottom+1,'Packaged thumbnail pushes its caption outside the card');
  // The QA process is deliberately hidden. Chromium may suspend muted video in
  // hidden windows; emulate a focused page without foregrounding the user's apps.
  await send('Emulation.setFocusEmulationEnabled',{enabled:true});
  assert.equal(await evaluate('document.visibilityState'),'visible','Playback acceptance requires an active page');
  await evaluate(`(()=>{const video=document.querySelector('.preview-modal video');window.qaPlaybackEvents=[];
    for(const name of ['play','playing','pause','waiting','stalled','emptied','error','ended'])video.addEventListener(name,()=>qaPlaybackEvents.push({name,time:video.currentTime}));
    video.muted=true;return video.play()})()`);
  await waitFor('document.querySelector(".preview-modal video").currentTime>0.15','actual export playback');
  await evaluate(`document.querySelector('.preview-modal video').pause()`);
  const output=resolve('apps/desktop/captures/portable-ai-story'); await mkdir(output,{recursive:true});
  const png=await send('Page.captureScreenshot',{format:'png'});
  await writeFile(join(output,'packaged.png'),Buffer.from(png.data,'base64'));
  const captionReachable=await evaluate(`(()=>{
    const gallery=document.querySelector('.scene-gallery');
    const button=gallery.querySelector('.preview-scene .retry-button');
    gallery.scrollTop+=button.getBoundingClientRect().bottom-gallery.getBoundingClientRect().bottom+16;
    const rect=button.getBoundingClientRect();
    return button.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2));
  })()`);
  assert.ok(captionReachable,'Scene caption actions must be reachable by scrolling the gallery');
  const galleryPng=await send('Page.captureScreenshot',{format:'png'});
  await writeFile(join(output,'packaged-gallery.png'),Buffer.from(galleryPng.data,'base64'));
  await click('.preview-modal .modal-close');
  const checksum=async()=>createHash('sha256').update(await readFile(completed.outputPath)).digest('hex');
  const originalHash=await checksum();
  const trash=await evaluate(`goldWork.deleteProject(${JSON.stringify(id)})`);
  assert.equal(await evaluate(`goldWork.getProject(${JSON.stringify(id)}).then(project=>Boolean(project))`),false);
  assert.ok((await evaluate('goldWork.listTrash()')).some(item=>item.trashId===trash.trashId));
  await evaluate(`goldWork.restoreTrashItem(${JSON.stringify(trash.trashId)})`);
  assert.equal((await evaluate(`goldWork.getProject(${JSON.stringify(id)})`)).outputPath,completed.outputPath);
  assert.equal(await checksum(),originalHash,'Restored Final must be byte-identical');
  const channelTrash=await evaluate('goldWork.deleteChannelProfile(portableQaChannelId)');
  assert.equal(await checksum(),originalHash,'Removing a channel must not delete its project media');
  await evaluate(`goldWork.restoreTrashItem(${JSON.stringify(channelTrash.trashId)})`);
  assert.ok((await evaluate('goldWork.listChannelProfiles()')).some(channel=>channel.id===completed.channelProfileId));
  await writeFile(join(output,'result.json'),JSON.stringify({binary,profile,projectId:id,outputPath:completed.outputPath,media,
    exportUi:true,editorUi:true,videoPlayed:true,exportLayout,captionReachable,projectAndChannelTrashRestore:true,finalHash:originalHash,startupSeconds,localOnly:true},null,2));
  console.log(`[portable-ai-story] PASS packaged backend, real IPC, queue, FFmpeg, project.json, gw-media range and Chromium MP4 decode; ${media.seconds}s`);
  console.log('[portable-ai-story] PASS hit-tested editor/export navigation, playable Final, project/channel trash and restore without media loss');
  console.log(`[portable-ai-story] QA profile retained: ${profile}`);
} catch(error) {
  const output=resolve('apps/desktop/captures/portable-ai-story');await mkdir(output,{recursive:true});
  if(socket?.readyState===1) {
    console.error('[portable-ai-story] UI diagnosis',JSON.stringify(await evaluate(`({
      url:location.href,
      timelineClasses:[...document.querySelectorAll('[class*="timeline"]')].slice(0,25).map(el=>el.className),
      playback:document.querySelector('.preview-modal video')?(()=>{const video=document.querySelector('.preview-modal video');return {
        time:video.currentTime,paused:video.paused,ready:video.readyState,network:video.networkState,rate:video.playbackRate,
        error:video.error?.message,buffered:[...Array(video.buffered.length)].map((_,i)=>[video.buffered.start(i),video.buffered.end(i)]),
        events:window.qaPlaybackEvents,quality:video.getVideoPlaybackQuality(),visibility:document.visibilityState};})():null,
      workflow:[...document.querySelectorAll('[data-flow-step]')].map(el=>({step:el.dataset.flowStep,active:el.getAttribute('aria-current'),disabled:el.disabled}))
    })`).catch(()=>undefined),null,2));
    const png=await send('Page.captureScreenshot',{format:'png'}).catch(()=>undefined);
    if(png)await writeFile(join(output,'failure.png'),Buffer.from(png.data,'base64'));
  }
  throw error;
} finally {
  if(socket?.readyState===1) { await send('Browser.close').catch(()=>{}); socket.close(); }
  // Never kill unrelated Electron processes; this handle owns only the QA binary.
  if(child.exitCode===null) child.kill();
}
