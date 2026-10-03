// Exercise the actual Electron media protocol against every selected scene.
// Separate profile, no credentials, no production writes or provider requests.
import assert from 'node:assert/strict';
import { app, BrowserWindow } from 'electron';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, mkdir, link, stat, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
const registry = 'C:/Users/rosup/AppData/Roaming/@gold-work/desktop/projects.json';
const original = await readFile(registry);
const project = JSON.parse(original).find(p => p.id === 'project_mu8iia3v_qhpe9y9');
assert.ok(project);
const profile = await mkdtemp(join(tmpdir(), 'gws-preview-audit-'));
const media = join(profile, 'workspace/projects', project.id, 'media');
const out = resolve('captures/stock-preview-audit');
await mkdir(media, { recursive: true }); await mkdir(out, { recursive: true });
const owned = new Map();
async function own(path) {
  if (!path) return path;
  if (owned.has(path)) return owned.get(path);
  const target = join(media, createHash('sha256').update(path).digest('hex') + extname(path));
  await link(path, target).catch(async error => { if ((await stat(path)).size > 2e6) throw error; await copyFile(path, target); });
  owned.set(path, target); return target;
}
for (const scene of project.scenes) {
  for (const key of ['imagePath', 'videoPath', 'audioPath']) scene[key] = await own(scene[key]);
  if (scene.documentary?.timing?.audioPath) scene.documentary.timing.audioPath = await own(scene.documentary.timing.audioPath);
  for (const effect of scene.documentary?.effects ?? []) effect.filePath = await own(effect.filePath);
}
project.status = 'ready';
await writeFile(join(profile, 'projects.json'), JSON.stringify([project]));
app.setPath('userData', profile);
if (process.argv.includes('--dev')) process.env.ELECTRON_RENDERER_URL = 'http://127.0.0.1:5174';
else delete process.env.ELECTRON_RENDERER_URL;
delete process.env.PORTABLE_EXECUTABLE_DIR;
app.on('browser-window-created', (_e, win) => win.on('show', () => win.hide()));
createRequire(import.meta.url)(resolve('dist/main/index.cjs'));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
let win;
const timeout = setTimeout(() => { console.error('audit timeout'); app.exit(1); }, 240_000);
try {
  for (let n = 0; n < 100; n++) { win = BrowserWindow.getAllWindows()[0]; if (win?.webContents.getURL() && !win.webContents.isLoadingMainFrame()) break; await wait(100); }
  assert.ok(win); win.webContents.setBackgroundThrottling(false); win.setSize(1600, 1000);
  const evaluate = body => win.webContents.executeJavaScript(`(async()=>{${body}})()`, true);
  for (let n = 0; n < 100; n++) { if (await evaluate('return Boolean(window.goldWork)')) break; await wait(100); }
  if (process.argv.includes('--editor')) {
  const until = async expression => { for(let i=0;i<1200;i++){ if(await evaluate(`return (${expression})`))return; await wait(100); }throw new Error(expression); };
    await until(`Boolean(document.querySelector('.startup-health-toast[open] .primary-button'))`);
    await evaluate(`document.querySelector('.startup-health-toast[open] .primary-button').click();document.querySelector('[data-nav-key=projects]').click()`);
    await until(`Boolean(document.querySelector('.projects-table-row'))`);
    await evaluate(`document.querySelector('.projects-table-row').click()`);
    await until(`[...document.querySelectorAll('.project-expand button')].some(e=>e.textContent.includes('Таймлайн'))`);
    await evaluate(`[...document.querySelectorAll('.project-expand button')].find(e=>e.textContent.includes('Таймлайн')).click()`);
    await until(`Boolean(document.querySelector('.timeline-big-play'))`);
    await wait(3000);
    win.removeAllListeners('show'); win.showInactive(); await wait(500);
    if(process.argv.includes('--edit-tools')) {
      await until(`Boolean(document.querySelector('.timeline-big-play:not(:disabled)'))`);
      const errors=[];win.webContents.on('console-message',(_event,level,message)=>{if(level>=3)errors.push(message)});
      const click = async text => {await evaluate(`const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b)throw new Error('Missing button');b.click()`);await wait(120);};
      const set = async (selector,value)=>{await evaluate(`const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e instanceof HTMLSelectElement?HTMLSelectElement.prototype:e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e instanceof HTMLSelectElement?'change':'input',{bubbles:true}));`);await wait(100);};
      const seek = async seconds => {const p=await evaluate(`const p=await window.goldWork.getProject(${JSON.stringify(project.id)});const duration=p.scenes.filter(s=>s.includeInAssembly!==false).reduce((sum,s)=>sum+Math.max((s.documentary?.timing?.durationInFrames??Math.ceil(s.durationSeconds*30))/30,s.durationOverrideSeconds??0),0);const r=document.querySelector('.timeline-ruler-new').getBoundingClientRect();return{x:Math.round(r.x+${seconds}*r.width/duration),y:Math.round(r.y+8)}`);win.webContents.sendInputEvent({type:'mouseMove',...p});win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...p});await wait(80);win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...p});await wait(250);};
      const read = ()=>evaluate(`return window.goldWork.getProject(${JSON.stringify(project.id)})`);
      const originalVoice=project.scenes.map(s=>[s.id,s.narration,s.audioPath]);
      console.log('editing UI: media ready');
      await seek(1);await click('✂ Разрезать');
      assert.equal(await evaluate(`return document.querySelectorAll('.documentary-visual-track .timeline-clip i')[1].textContent`),'1.2');
      await set('[aria-label="Материал фрагмента"]',project.scenes[1].id);
      await click('↶ Отменить');assert.equal(await evaluate(`return document.querySelector('[aria-label="Материал фрагмента"]').value`),project.scenes[0].id);
      await click('↷ Повторить');
      await click('Текст');await set('[aria-label="Текст клипа"]','Текст поверх двух кадров');
      const point=await evaluate(`const r=document.querySelector('.text-clip').getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}`);
      win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});win.webContents.sendInputEvent({type:'mouseMove',x:point.x+26,y:point.y});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:point.x+26,y:point.y});await wait(200);
      await evaluate(`const e=document.querySelector('[aria-label="Текст клипа"]');e.focus();e.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true,bubbles:true}))`);
      await until(`Boolean(document.querySelector('.documentary-edit-toolbar button:last-of-type:disabled') && document.querySelector('.timeline-top-actions .generate-button:not(:disabled)'))`);
      let saved=await read();assert.equal(saved.scenes[0].documentary.cuts.length,2);assert.equal(saved.scenes[0].documentary.cuts[1].sourceSceneId,project.scenes[1].id);
      assert.equal(saved.scenes[0].documentary.texts[0].text,'Текст поверх двух кадров');assert.ok(saved.scenes[0].documentary.texts[0].startSeconds>1.5);
      assert.deepEqual(saved.scenes.map(s=>[s.id,s.narration,s.audioPath]),originalVoice);
      await evaluate(`document.querySelector('.documentary-visual-track .timeline-clip').click()`);await wait(150);
      await set('.documentary-inspector select','chapter-breathe');await set('.documentary-inspector textarea','НОВАЯ ГЛАВА');
      await seek(1.3);await wait(1200);
      await writeFile(join(out,'editor-tools.png'),(await win.capturePage()).toPNG());
      await click('Сохранить');await until(`Boolean(document.querySelector('.documentary-edit-toolbar button:last-of-type:disabled') && document.querySelector('.timeline-top-actions .generate-button:not(:disabled)'))`);
      saved=await read();assert.equal(saved.scenes[0].documentary.template,'chapter-breathe');
      // Close/reopen the editor: serialized cuts/text/templates must survive.
      await evaluate(`document.querySelector('.timeline-topbar button[title="Назад"]').click()`);await wait(150);
      await evaluate(`[...document.querySelectorAll('.project-expand button')].find(e=>e.textContent.includes('Таймлайн')).click()`);
      await until(`Boolean(document.querySelector('.text-clip'))`);
      assert.equal(await evaluate(`return document.querySelector('.documentary-inspector select').value`),'chapter-breathe');
      assert.equal(await evaluate(`return [...document.querySelectorAll('.documentary-inspector select option')].filter(o=>o.value.startsWith('chapter-')).length`),6);
      await evaluate(`document.querySelector('.documentary-visual-track .timeline-clip').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:350,clientY:700}))`);await wait(100);
      await click('Дублировать');await until(`(await window.goldWork.getProject(${JSON.stringify(project.id)})).scenes.length===108`);
      const duplicated=(await read()).scenes[1];assert.notEqual(duplicated.documentary.cuts[0].id,saved.scenes[0].documentary.cuts[0].id);assert.notEqual(duplicated.documentary.texts[0].id,saved.scenes[0].documentary.texts[0].id);
      await click('↶ Отменить');await click('Сохранить');await until(`(await window.goldWork.getProject(${JSON.stringify(project.id)})).scenes.length===107`);
      assert.equal(errors.filter(e=>/Uncaught|Maximum update depth|out of memory|DataCloneError/.test(e)).length,0,errors.join('\n'));
      assert.deepEqual(await readFile(registry),original);
      const report={ok:true,build:await evaluate('return window.goldWork.getAppInfo()'),checks:['split picture','replace one fragment','undo/redo','text track drag','Ctrl+S in text field','save/reopen','chapter preview','duplicate/undo with independent edit IDs','107 narration paths/text preserved','production registry unchanged'],errors};
      await writeFile(join(out,'editor-tools.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
      clearTimeout(timeout);app.exit(0);return;
    }
    const shots=[];
    for(const seconds of [1,30,75,153,230,310]) {
      await evaluate(`document.querySelector('.timeline-scroll').scrollLeft=${Math.max(0,seconds*26-120)}`);await wait(120);
      const point=await evaluate(`const r=document.querySelector('.timeline-ruler-new').getBoundingClientRect();return{x:Math.round(r.x+${seconds*26}),y:Math.round(r.y+8)}`);
      win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});
      await wait(1500);
      shots.push(await evaluate(`return {seconds:${seconds},images:[...document.querySelectorAll('.timeline-live-preview img,.timeline-clip img')].map(i=>({src:i.src,ok:i.naturalWidth>0})),videos:[...document.querySelectorAll('.timeline-live-preview video')].map(v=>{let pixel;try{const c=document.createElement('canvas');c.width=32;c.height=18;const x=c.getContext('2d');x.drawImage(v,0,0,32,18);pixel=Array.from(x.getImageData(0,0,32,18).data).filter((_,i)=>i%4!==3).reduce((a,b)=>a+b,0)/(32*18*3)}catch(e){pixel=e.message}return {ready:v.readyState,time:v.currentTime,seeking:v.seeking,error:v.error?.message,pixel,style:v.getAttribute('style'),ancestors:[v.parentElement,v.parentElement?.parentElement].map(e=>({style:e?.getAttribute('style'),rect:e?.getBoundingClientRect().toJSON()}))}}),errors:document.querySelector('.timeline-media-error')?.textContent}`));
      await writeFile(join(out,`editor-${seconds}.png`),(await win.capturePage()).toPNG());
    }
    const summary=shots.map(s=>({seconds:s.seconds,videos:s.videos.map(v=>({ready:v.ready,seeking:v.seeking,pixel:v.pixel})),errors:s.errors}));
    assert.ok(shots.flatMap(s=>s.videos).every(v=>typeof v.pixel==='number'&&v.pixel>2&&!v.error), 'Decoded pixels, not only readyState, must contain the real image after seeking');
    assert.equal(await evaluate(`return [...document.querySelectorAll('select')].some(s=>s.options.length===26&&s.textContent.includes('Шаблон')===false&&s.textContent.includes('Галерея'))`),true,'All twenty-five templates are available in the inspector');
    console.log(JSON.stringify({shots:summary,memory:app.getAppMetrics().filter(m=>m.type==='Tab').map(m=>m.memory.workingSetSize/1024)}));
    await writeFile(join(out,'editor.json'),JSON.stringify(shots,null,2));
    assert.deepEqual(await readFile(registry),original);clearTimeout(timeout);app.exit(0);return;
  }
  let images = [];
  console.log('audit: selected images');
  images = await evaluate(`const paths=${JSON.stringify(project.scenes.map(s=>({scene:s.order+1,path:s.imagePath})).filter(s=>s.path))};const results=[];let cursor=0;await Promise.all(Array.from({length:4},async()=>{while(cursor<paths.length){const item=paths[cursor++],img=new Image();let timer,error;img.src=window.goldWork.mediaUrl(item.path);await Promise.race([img.decode().catch(e=>error=e.name+': '+e.message),new Promise(r=>timer=setTimeout(()=>{error='timeout';r()},3000))]);clearTimeout(timer);results.push({scene:item.scene,ok:img.naturalWidth>0,width:img.naturalWidth,error});}}));return results;`);
  console.log(JSON.stringify({images:images.length,broken:images.filter(x=>!x.ok)}));
  const seen = new Set(), videos = [];
  for (const scene of project.scenes) {
    if (!scene.videoPath) continue;
    const identity = String((await stat(scene.videoPath, { bigint: true })).ino);
    if (seen.has(identity)) continue; seen.add(identity);
    const result = await evaluate(`const v=document.createElement('video');v.muted=true;v.preload='auto';v.src=window.goldWork.mediaUrl(${JSON.stringify(scene.videoPath)});document.body.append(v);let issue; await new Promise(r=>{const t=setTimeout(()=>{issue='metadata timeout';r()},5000);v.onloadedmetadata=()=>{clearTimeout(t);r()};v.onerror=()=>{issue=v.error?.message;clearTimeout(t);r()}});if(!issue){await new Promise(r=>{const t=setTimeout(()=>{issue='seek timeout';r()},5000);v.onseeked=()=>{clearTimeout(t);r()};v.currentTime=${scene.trimStartSeconds ?? 0}+.1});} const result={ok:!issue&&v.readyState>=2,error:issue,width:v.videoWidth,time:v.currentTime,ready:v.readyState};v.removeAttribute('src');v.load();v.remove();return result;`);
    videos.push({ scene: scene.order + 1, ...result }); console.log(JSON.stringify(videos.at(-1)));
    if (videos.filter(x=>!x.ok).length >= 3) break;
  }
  await writeFile(join(out, 'protocol.json'), JSON.stringify({ images, videos }, null, 2));
  console.log(JSON.stringify({ images: images.length, brokenImages: images.filter(x=>!x.ok).map(x=>({scene:x.scene,error:x.error})), videos: videos.length, brokenVideos: videos.filter(x=>!x.ok) }));
  assert.deepEqual(await readFile(registry), original);
  assert.ok(images.every(x=>x.ok) && videos.every(x=>x.ok), 'All selected sources must decode/seek');
  clearTimeout(timeout); app.exit(0);
} catch (error) { if(win){await writeFile(join(out,'failed.png'),(await win.capturePage()).toPNG()).catch(()=>{});console.error(await win.webContents.executeJavaScript(`JSON.stringify({transport:document.querySelector('.timeline-transport')?.textContent,toolbar:document.querySelector('.documentary-edit-toolbar')?.textContent,error:document.querySelector('.timeline-media-error')?.textContent})`).catch(()=>''));}console.error(error.stack??String(error)); clearTimeout(timeout); app.exit(1); }
});
