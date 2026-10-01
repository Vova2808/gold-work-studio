// Native, isolated acceptance of the September 30 changed paths. No paid calls.
import assert from 'node:assert/strict';
import {app,BrowserWindow,ipcMain} from 'electron';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const root=resolve('captures/montage-speed-20260927/new-production/upgrade-ui-20260930'),profile=join(root,'profile');
await mkdir(profile,{recursive:true});
const registry=join(process.env.APPDATA,'@gold-work/desktop/projects.json'),before=await readFile(registry,'utf8');
const original=JSON.parse(before).find(p=>p.id==='project_mukba0q1_0cubga6');assert.ok(original);
const fixture=structuredClone(original);fixture.id='local-upgrade-20260930';fixture.title='LOCAL UPGRADE QA';fixture.status='failed';fixture.outputPath=undefined;
await writeFile(join(profile,'projects.json'),JSON.stringify([fixture]));
await writeFile(join(profile,'storage-location.json'),JSON.stringify({activePath:'D:/GoldWorkStorage'}));
app.setPath('userData',profile);delete process.env.ELECTRON_RENDERER_URL;delete process.env.PORTABLE_EXECUTABLE_DIR;
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');app.commandLine.appendSwitch('disable-renderer-backgrounding');
createRequire(import.meta.url)(resolve('dist/main/index.cjs'));
app.whenReady().then(async()=>{
  let win;const errors=[],wait=ms=>new Promise(r=>setTimeout(r,ms));
  const watchdog=setTimeout(()=>{console.error('Upgrade UI timeout');app.exit(1);},150000);
  try{
    for(let i=0;i<160;i++){win=BrowserWindow.getAllWindows()[0];if(win&&!win.webContents.isLoadingMainFrame())break;await wait(100);}assert.ok(win);
    win.setSize(1600,1050);win.show();win.focus();win.webContents.setBackgroundThrottling(false);
    win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)errors.push(message);});
    const run=code=>win.webContents.executeJavaScript(`(async()=>{${code}})()`,true);
    const until=async expr=>{for(let i=0;i<160;i++){if(await run(`return Boolean(${expr})`))return;await wait(100);}throw Error('UI timeout: '+expr);};
    const click=async text=>{await run(`const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Missing button '+${JSON.stringify(text)});b.click();`);await wait(100);};
    const input=async(selector,value)=>{await run(`const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing input');Object.getOwnPropertyDescriptor(e instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e instanceof HTMLSelectElement?'change':'input',{bubbles:true}));`);await wait(100);};
    await until('window.goldWork&&document.querySelector("[data-nav-key=projects]")');
    await run(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Открыть приложение')?.click();document.querySelector('[data-nav-key=projects]').click();`);
    await until(`document.querySelector('.projects-table-row')`);await run(`document.querySelector('.projects-table-row').click()`);
    const open=async()=>{await run(`[...document.querySelectorAll('.project-expand button')].find(b=>b.textContent.trim()==='Таймлайн').click()`);await until(`document.querySelector('.documentary-template-clip')`);};
    await until(`document.querySelector('.project-expand')`);await open();
    const info=await run('return window.goldWork.getAppInfo()');assert.equal(await run('return document.querySelector("[data-renderer-build-id]").dataset.rendererBuildId'),info.buildId);
    await run(`document.querySelector('.documentary-template-clip').click();[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Выбрать по композиции')).click()`);
    await until(`document.querySelector('.documentary-template-grid')`);
    assert.equal(await run(`return document.querySelectorAll('.documentary-template-grid button').length`),80);
    await run(`const b=[...document.querySelectorAll('.documentary-template-grid button')].find(b=>/четыре шторки/i.test(b.textContent));if(!b)throw Error('New composition absent');b.click()`);
    await until(`!document.querySelector('.documentary-template-picker')`);
    // Real pointer input exercises capture, edge trim and move on the track.
    const coords=await run(`const b=document.querySelector('.documentary-template-clip'),r=b.getBoundingClientRect();return {x:Math.round(r.right-3),y:Math.round(r.top+r.height/2),width:r.width}`);
    assert.ok(coords.width>20);
    await run(`window.pointerTrace=[];for(const type of ['pointerdown','pointermove','pointerup','lostpointercapture'])document.addEventListener(type,e=>window.pointerTrace.push({type,target:e.target.className,x:e.clientX,y:e.clientY,buttons:e.buttons}),true);`);
    const mouse=(type,x,y)=>win.webContents.sendInputEvent({type,x,y,button:'left',clickCount:1});
    console.log(JSON.stringify({stage:'trim',coords}));
    mouse('mouseMove',coords.x,coords.y);await wait(80);mouse('mouseDown',coords.x,coords.y);await wait(80);mouse('mouseMove',coords.x-Math.floor(coords.width/3),coords.y);await wait(80);mouse('mouseUp',coords.x-Math.floor(coords.width/3),coords.y);await wait(150);
    const move=await run(`const r=document.querySelector('.documentary-template-clip').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}`);
    mouse('mouseMove',move.x,move.y);await wait(80);mouse('mouseDown',move.x,move.y);await wait(80);mouse('mouseMove',move.x+10,move.y);await wait(80);mouse('mouseUp',move.x+10,move.y);await wait(150);
    console.log(JSON.stringify(await run(`return {trace:window.pointerTrace,style:document.querySelector('.documentary-template-clip').getAttribute('style'),hit:document.elementFromPoint(${coords.x},${coords.y})?.outerHTML.slice(0,200)}`)));
    await run(`document.querySelector('.documentary-template-clip').dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true}))`);await wait(100);await click('↶ Отменить');
    await run(`document.querySelector('.documentary-seam-button').click()`);await until(`document.querySelector('.documentary-transition-picker')`);
    await input('.documentary-transition-picker select','blur');await click('Выбрать переход');await click('Применить');
    await until(`(await window.goldWork.getProject(${JSON.stringify(fixture.id)})).scenes[0].documentary.transitionStyle==='blur'`);
    const saved=await run(`return window.goldWork.getProject(${JSON.stringify(fixture.id)})`);
    assert.equal(saved.scenes[0].documentary.template,'editorial-shutters');
    const timing=saved.scenes[0].documentary.templateTiming;assert.ok(timing?.startSeconds>0&&timing.durationSeconds<saved.scenes[0].durationSeconds);
    assert.deepEqual(saved.scenes.map(s=>[s.narration,s.audioPath]),fixture.scenes.map(s=>[s.narration,s.audioPath]));
    await writeFile(join(root,'template-track.png'),(await win.webContents.capturePage()).toPNG());
    // Reopen, then open the real external music browser. No downloads or payments.
    await run(`document.querySelector('.modal-overlay .modal-close')?.click()`);await wait(100);await open();
    await run(`document.querySelector('.music-track button').click()`);await until(`document.querySelector('[aria-label="Запрос музыки Pixabay"]')`);
    await input('[aria-label="Запрос музыки Pixabay"]','documentary');await click('Найти и добавить с Pixabay');
    let music;for(let i=0;i<160;i++){music=BrowserWindow.getAllWindows().find(w=>w.id!==win.id);if(music&&!music.webContents.isLoadingMainFrame())break;await wait(100);}
    assert.ok(music,'Pixabay window must open');
    const musicResult={url:music.webContents.getURL(),title:music.webContents.getTitle()};
    await writeFile(join(root,'pixabay.png'),(await music.webContents.capturePage()).toPNG());music.close();
    await until(`![...document.querySelectorAll('button')].some(b=>b.textContent.includes('Выберите трек в окне Pixabay'))`);
    await run(`document.querySelector('.modal-overlay .modal-close')?.click()`);
    // Recovery UI uses a mocked free probe only; real checkpoint listing, no authorize/start.
    ipcMain.removeHandler('documentary:probe');ipcMain.handle('documentary:probe',()=>true);
    const analysis=join('D:/GoldWorkStorage/projects',fixture.id,'Documentary/Analysis');await mkdir(analysis,{recursive:true});
    await writeFile(join(analysis,'a'.repeat(64)+'.json'),JSON.stringify({state:'partial',purpose:'UI fixture',raw:'unfinished test response',createdAt:new Date().toISOString()}));
    await run(`await window.goldWork.updateProject(${JSON.stringify(fixture.id)},{status:'failed'})`);
    await until(`document.querySelector('[data-flow-step=production]')&&!document.querySelector('[data-flow-step=production]').disabled`);
    await run(`document.querySelector('[data-flow-step=production]').click()`);await until(`document.querySelector('.documentary-recovery')`);
    await click('Продолжить после ошибки');await until(`document.querySelector('.documentary-recovery-requests')`);
    assert.equal(await run(`return [...document.querySelectorAll('.documentary-recovery button')].find(b=>b.textContent.startsWith('Повторить выбранные')).disabled`),true);
    await writeFile(join(root,'recovery.png'),(await win.webContents.capturePage()).toPNG());
    await run(`document.querySelector('[data-flow-step=materials]').click()`);await until(`document.querySelectorAll('.scenario-material-card').length===289`);
    const memory=[];
    for(const index of [0,70,140,210,288,0]){
      await run(`document.querySelectorAll('.scenario-material-card')[${index}].scrollIntoView({block:'center'})`);await wait(650);
      const sample=await run(`const all=[...document.querySelectorAll('.scenario-material-card img')],loaded=all.filter(i=>i.getAttribute('src'));return {cards:document.querySelectorAll('.scenario-material-card').length,loaded:loaded.length,widths:loaded.filter(i=>i.complete&&i.naturalWidth).map(i=>i.naturalWidth),boundedUrls:loaded.every(i=>i.src.includes('thumbnail=640'))}`);
      assert.ok(sample.loaded<40,'Offscreen originals must be released');assert.ok(sample.boundedUrls);assert.ok(sample.widths.every(w=>w<=640));
      memory.push({index,...sample,process:app.getAppMetrics().find(m=>m.pid===win.webContents.getOSProcessId())?.memory});
    }
    await writeFile(join(root,'memory-scroll.json'),JSON.stringify(memory,null,2));
    assert.equal(await readFile(registry,'utf8'),before);
    assert.equal(errors.filter(e=>/Uncaught|Maximum update depth|Too many re-renders/.test(e)).length,0,errors.join('\n'));
    const result={at:new Date().toISOString(),build:info.buildId,catalog:80,templateTiming:timing,musicWindow:musicResult,maxLoadedMaterialImages:Math.max(...memory.map(s=>s.loaded)),checks:['native startup build identity','catalog select','pointer trim/move','delete/undo','blur save','reopen','Pixabay open/cancel','recovery unknown list and confirmation disabled','289 material cards scrolling with bounded decoded images'],registryPreserved:true,voicesPreserved:true,paidRequests:0,errors};
    await writeFile(join(root,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));clearTimeout(watchdog);app.exit(0);
  }catch(error){await writeFile(join(root,'failure.txt'),String(error));if(win)await writeFile(join(root,'failure.png'),(await win.webContents.capturePage()).toPNG());console.error(error);app.exit(1);}
});
