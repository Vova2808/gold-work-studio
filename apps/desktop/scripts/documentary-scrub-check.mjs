import { app, BrowserWindow } from 'electron';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, realpath, link, stat } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import assert from 'node:assert/strict';
import { buildDocumentaryTimeline } from '../../../packages/remotion-video/dist/documentary-timeline.js';

// Read-only originals, hard-linked media and a separate profile: no provider credentials or jobs.
const out=resolve('captures/documentary-scrub'), label=process.argv.includes('--after')?'after':'before';
const profile=join(out,`profile-${label}-${Date.now()}`);await mkdir(profile,{recursive:true});
const source=JSON.parse(await readFile('C:/Users/rosup/AppData/Roaming/@gold-work/desktop/projects.json','utf8')).find(p=>p.id==='project_mu1sc77k_kyoo4o9');
const project=structuredClone(source);project.title='SCRUB CHECK — отдельная копия';project.status='ready';project.outputPath=undefined;
const media=join(profile,'media');await mkdir(media);const paths=new Map();
async function local(path){if(!path)return path;if(paths.has(path))return paths.get(path);const target=join(media,`${paths.size}-${basename(path)}`);await link(await realpath(path),target);paths.set(path,target);return target;}
for(const scene of project.scenes){
  for(const field of ['imagePath','videoPath','audioPath'])if(scene[field])scene[field]=await local(scene[field]);
  const timing=scene.documentary?.timing;
  if(timing?.audioPath){timing.audioPath=await local(timing.audioPath);const info=await stat(scene.audioPath);timing.sourceKey=createHash('sha256').update(JSON.stringify([4,scene.audioPath,info.size,info.mtimeMs,scene.narrationSlice,scene.durationOverrideSeconds,project.settings.assembly.audioNormalize])).digest('hex');}
  for(const effect of scene.documentary?.effects??[])effect.filePath=await local(effect.filePath);
}
await writeFile(join(profile,'projects.json'),JSON.stringify([project]));
app.setPath('userData',profile);delete process.env.PORTABLE_EXECUTABLE_DIR;
if(process.argv.includes('--production'))delete process.env.ELECTRON_RENDERER_URL;
else process.env.ELECTRON_RENDERER_URL='http://127.0.0.1:5174/';
app.on('browser-window-created',(_event,win)=>win.hide());
createRequire(import.meta.url)(resolve('dist/main/index.cjs'));
app.whenReady().then(async()=>{try{
  const wait=ms=>new Promise(r=>setTimeout(r,ms));let win;
  for(let i=0;i<150;i++){win=BrowserWindow.getAllWindows()[0];if(win&&!win.webContents.isLoadingMainFrame())break;await wait(100);}
  win.hide();win.webContents.setAudioMuted(true);win.webContents.setBackgroundThrottling(false);
  const errors=[];win.webContents.on('console-message',(_event,level,message)=>{if(level>=3)errors.push(message)});
  const evaluate=body=>win.webContents.executeJavaScript(`(async()=>{${body}})()`,true);
  const until=async expression=>{for(let i=0;i<150;i++){if(await evaluate(`return (${expression})`))return;await wait(100)}throw new Error('Timeout: '+expression)};
  await until(`Boolean(document.querySelector('.startup-health-toast[open] .primary-button'))`);
  await evaluate(`document.querySelector('.startup-health-toast[open] .primary-button').click();document.querySelector('[data-nav-key=projects]').click()`);
  await until(`Boolean(document.querySelector('.projects-table-row'))`);
  await evaluate(`document.querySelector('.projects-table-row').click()`);
  await until(`[...document.querySelectorAll('.project-expand button')].some(e=>e.textContent.includes('Таймлайн'))`);
  await evaluate(`[...document.querySelectorAll('.project-expand button')].find(e=>e.textContent.includes('Таймлайн')).click()`);
  await until(`Boolean(document.querySelector('.timeline-big-play'))&&!document.body.innerText.includes('Подготавливаю звук')`);
  await evaluate(`window.metrics={positions:[],seeks:[],gaps:[],mediaErrors:[]};const el=document.querySelector('.timeline-playhead');new MutationObserver(()=>metrics.positions.push({at:performance.now(),x:parseFloat(el.style.transform.slice(11))})).observe(el,{attributes:true,attributeFilter:['style']});
    const d=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'currentTime');Object.defineProperty(HTMLMediaElement.prototype,'currentTime',{...d,set(value){metrics.seeks.push({at:performance.now(),value,kind:this.tagName});d.set.call(this,value)}});
    document.addEventListener('error',e=>{if(e.target instanceof HTMLMediaElement||e.target instanceof HTMLImageElement)metrics.mediaErrors.push(e.target.tagName+':'+(e.target.error?.code??'image'))},true);
    let last=performance.now();const tick=now=>{metrics.gaps.push(now-last);last=now;requestAnimationFrame(tick)};requestAnimationFrame(tick);`);
  const ruler=await evaluate(`const r=document.querySelector('.timeline-ruler-new').getBoundingClientRect();return{x:r.x,y:Math.round(r.y+8),scale:26}`);
  win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:Math.round(ruler.x+26),y:ruler.y});
  for(let t=1;t<=8;t+=.25){win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(ruler.x+t*26),y:ruler.y});await wait(22)}
  win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:Math.round(ruler.x+8*26),y:ruler.y});
  await wait(1500);
  const paused=await evaluate(`return {time:document.querySelector('.timeline-transport time').textContent,transform:document.querySelector('.timeline-playhead').style.transform,images:[...document.querySelectorAll('.timeline-live-preview img')].map(i=>({loaded:i.complete&&i.naturalWidth>0}))}`);
  await writeFile(join(out,`${label}-paused.png`),(await win.capturePage()).toPNG());
  await evaluate(`metrics.playStart=performance.now();document.querySelector('.timeline-big-play').click()`);
  await wait(7000);
  const result=await evaluate(`return {...metrics,paused:${JSON.stringify(paused)},time:document.querySelector('.timeline-transport time').textContent,images:[...document.querySelectorAll('.timeline-live-preview img')].map(i=>({loaded:i.complete&&i.naturalWidth>0})),videos:[...document.querySelectorAll('.timeline-live-preview video')].map(v=>({readyState:v.readyState,seeking:v.seeking,time:v.currentTime,error:v.error?.code}))}`);
  await writeFile(join(out,`${label}-playing.png`),(await win.capturePage()).toPNG());
  let resize, videoCheck;
  if (label === 'after') {
    await evaluate(`document.querySelector('.timeline-big-play').click()`);
    const handle=await evaluate(`const r=document.querySelector('.timeline-panel-resize').getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),height:document.querySelector('.resizable-timeline-panel').clientHeight}`);
    win.webContents.sendInputEvent({type:'mouseMove',x:handle.x,y:handle.y});
    await wait(50);
    win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:handle.x,y:handle.y});
    await wait(50);
    win.webContents.sendInputEvent({type:'mouseMove',modifiers:['leftButtonDown'],x:handle.x,y:handle.y-110});
    await wait(50);
    win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:handle.x,y:handle.y-110});
    await wait(150);
    resize=await evaluate(`return{before:${handle.height},after:document.querySelector('.resizable-timeline-panel').clientHeight,saved:Number(localStorage.getItem('gws-timeline-panel-height'))}`);
    const videoScene=buildDocumentaryTimeline(project).scenes.find(scene=>scene.videoPath&&scene.durationInFrames>=60);
    assert.ok(videoScene,'The real project must contain a video scene');
    const videoTime=videoScene.fromFrame/30+.3;
    await evaluate(`document.querySelector('.timeline-scroll').scrollLeft=${videoTime*26-120}`);
    await wait(150);
    const point=await evaluate(`const r=document.querySelector('.timeline-ruler-new').getBoundingClientRect();return{x:Math.round(r.x+${videoTime*26}),y:Math.round(r.y+8)}`);
    win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});
    win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});
    await until(`[...document.querySelectorAll('.timeline-live-preview video')].some(v=>v.readyState>=2&&!v.seeking)`);
    const videoState=()=>evaluate(`const v=[...document.querySelectorAll('.timeline-live-preview video')].find(v=>v.readyState>=2);return v?{time:v.currentTime,width:v.videoWidth,height:v.videoHeight,paused:v.paused,error:v.error?.code}:null`);
    const start=await videoState();
    await evaluate(`document.querySelector('.timeline-big-play').click()`);
    await wait(1000);
    videoCheck={scene:videoScene.order+1,timelineSeconds:videoTime,start,end:await videoState()};
    await writeFile(join(out,`${label}-video-resized.png`),(await win.capturePage()).toPNG());
    await evaluate(`document.querySelector('.timeline-big-play').click()`);
  }
  const playback=result.positions.filter(p=>p.at>=result.playStart), gaps=result.gaps.sort((a,b)=>a-b);
  const summary={label,paused:result.paused,time:result.time,positionUpdates:result.positions.length,backwardJumps:playback.filter((p,i)=>i&&p.x<playback[i-1].x-2).length,seeks:result.seeks.length,p95FrameGap:gaps[Math.floor(gaps.length*.95)],errors:errors.slice(0,8),errorCount:errors.length,mediaErrors:await evaluate('return metrics.mediaErrors'),images:result.images,videos:result.videos,resize,videoCheck};
  await writeFile(join(out,`${label}.json`),JSON.stringify({summary,result},null,2));console.log(JSON.stringify(summary));
  if(label==='after'){
    assert.ok(paused.time.startsWith('0:08'));
    assert.equal(paused.transform,'translateX(208px)');
    assert.ok(paused.images.some(image=>image.loaded));
    assert.ok(playback.at(-1).x>8*26+26,'Playback must advance after seeking');
    assert.equal(summary.backwardJumps,0);assert.equal(errors.length,0);assert.equal(summary.mediaErrors.length,0);
    assert.ok(resize.after>resize.before);assert.equal(resize.saved,resize.after);
    assert.ok(videoCheck.end?.time>videoCheck.start.time+.1,'Real video must advance');
  }
  app.exit(0);
}catch(error){console.error(error);app.exit(1)}});
