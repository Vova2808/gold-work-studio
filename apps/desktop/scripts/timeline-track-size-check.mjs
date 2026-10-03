import assert from 'node:assert/strict';
import {app,BrowserWindow} from 'electron';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';

const root=resolve('captures/montage-speed-20260927/new-production/track-resize-20260930');
const profile=join(root,'profile'); await mkdir(profile,{recursive:true});
const registry=join(process.env.APPDATA,'@gold-work/desktop/projects.json'),before=await readFile(registry,'utf8');
const original=JSON.parse(before).find(p=>p.id==='project_mukba0q1_0cubga6'); assert.ok(original);
const fixture=structuredClone(original);fixture.id='local-track-size-20260930';fixture.title='LOCAL TRACK SIZE QA';fixture.status='failed';fixture.outputPath=undefined;
await writeFile(join(profile,'projects.json'),JSON.stringify([fixture]));
await writeFile(join(profile,'storage-location.json'),JSON.stringify({activePath:'D:/GoldWorkStorage'}));
app.setPath('userData',profile);delete process.env.ELECTRON_RENDERER_URL;delete process.env.PORTABLE_EXECUTABLE_DIR;
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
createRequire(import.meta.url)(join(root,'build/main/index.cjs'));
app.whenReady().then(async()=>{
  const wait=ms=>new Promise(r=>setTimeout(r,ms));let win;const errors=[];
  const watchdog=setTimeout(()=>{console.error('Track size UI timeout');app.exit(1);},90000);
  try{
    for(let i=0;i<160;i++){win=BrowserWindow.getAllWindows()[0];if(win&&!win.webContents.isLoadingMainFrame())break;await wait(100);}
    assert.ok(win);win.setSize(1600,1050);win.show();win.focus();win.webContents.setBackgroundThrottling(false);
    win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)errors.push(message);});
    const run=code=>win.webContents.executeJavaScript(`(async()=>{${code}})()`,true);
    const until=async expr=>{for(let i=0;i<160;i++){if(await run(`return Boolean(${expr})`))return;await wait(100);}throw Error('UI timeout: '+expr);};
    await until('window.goldWork&&document.querySelector("[data-nav-key=projects]")');
    if(process.argv.includes('--startup-only')){
      const info=await run('return window.goldWork.getAppInfo()');
      assert.equal(await run('return document.querySelector("[data-renderer-build-id]").dataset.rendererBuildId'),info.buildId);
      assert.equal(await readFile(registry,'utf8'),before);
      const result={at:new Date().toISOString(),build:info.buildId,mainRendererMatched:true,registryPreserved:true,paidRequests:0};
      await writeFile(join(root,'final-startup.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));clearTimeout(watchdog);app.exit(0);return;
    }
    await run(`localStorage.removeItem('gws-timeline-track-heights-v1');localStorage.setItem('gws-timeline-panel-height','320');[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Открыть приложение')?.click();document.querySelector('[data-nav-key=projects]').click()`);
    await until(`document.querySelector('.projects-table-row')`);await run(`document.querySelector('.projects-table-row').click()`);
    await until(`document.querySelector('.project-expand')`);
    const open=async()=>{await run(`[...document.querySelectorAll('.project-expand button')].find(b=>b.textContent.trim()==='Таймлайн').click()`);await until(`document.querySelectorAll('.timeline-track-resize').length===7`);};
    await open();
    await wait(800);
    await run(`window.pointerTrace=[];for(const type of ['pointerdown','pointermove','pointerup','lostpointercapture'])document.addEventListener(type,e=>window.pointerTrace.push({type,target:e.target.outerHTML.slice(0,160),path:e.composedPath().slice(0,5).map(n=>n.className),x:e.clientX,y:e.clientY,buttons:e.buttons}),true);`);
    const info=await run('return window.goldWork.getAppInfo()');
    assert.equal(await run('return document.querySelector("[data-renderer-build-id]").dataset.rendererBuildId'),info.buildId);
    const state=()=>run(`const labels=[...document.querySelectorAll('.timeline-track-label')];const rows=[...document.querySelector('.timeline-canvas').children].filter(e=>!e.classList.contains('timeline-playhead')).slice(1,-1);return {panel:document.querySelector('.resizable-timeline-panel').getBoundingClientRect().height,heights:Object.fromEntries(labels.map(e=>[e.dataset.track,e.getBoundingClientRect().height])),rows:rows.map(e=>({top:e.getBoundingClientRect().top,height:e.getBoundingClientRect().height})),labels:labels.map(e=>({top:e.getBoundingClientRect().top,height:e.getBoundingClientRect().height})),dirty:![...document.querySelectorAll('.documentary-edit-toolbar button')].find(b=>b.textContent.includes('Сохранить')).disabled}`);
    const drag=async(selector,dy)=>{
      await run(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);await wait(100);
      const p=await run(`const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}`);
      const mouse=(type,x,y)=>win.webContents.sendInputEvent({type,x,y,button:'left',clickCount:1,modifiers:type==='mouseMove'?['leftButtonDown']:[]});
      mouse('mouseMove',p.x,p.y);await wait(60);mouse('mouseDown',p.x,p.y);await wait(60);mouse('mouseMove',p.x,p.y+dy);await wait(60);mouse('mouseUp',p.x,p.y+dy);await wait(100);
    };
    const initial=await state();await drag('.timeline-panel-resize',-200);const expanded=await state();
    console.log(JSON.stringify({stage:'panel',initial,expanded}));
    console.log(JSON.stringify(await run(`return {trace:window.pointerTrace,ratio:devicePixelRatio,style:document.querySelector('.resizable-timeline-panel').getAttribute('style')}`)));
    assert.ok(expanded.panel>initial.panel+150);assert.deepEqual(expanded.heights,initial.heights,'Panel must not resize any track');
    const trackResults=[];
    for(const track of ['video','voice','templates','text','sound','effects','music']){
      const before=await state();await drag(`[data-track="${track}"] .timeline-track-resize`,32);const after=await state();
      assert.equal(after.heights[track],before.heights[track]+32,track);
      for(const other of Object.keys(before.heights))if(other!==track)assert.equal(after.heights[other],before.heights[other],`${track} changed ${other}`);
      after.rows.forEach((row,i)=>{assert.ok(Math.abs(row.height-after.labels[i].height)<1);assert.ok(Math.abs(row.top-after.labels[i].top)<1);});
      assert.equal(after.dirty,false,'UI resizing must not change the film');trackResults.push({track,height:after.heights[track]});
    }
    await run(`document.querySelector('[data-track="video"] .timeline-track-resize').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true}))`);
    await wait(80);assert.equal((await state()).heights.video,initial.heights.video+16);
    await run(`document.querySelector('[data-track="video"] .timeline-track-resize').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`);await wait(80);
    assert.equal((await state()).heights.video,76);
    // A compact multi-lane track scrolls internally instead of covering music.
    await drag('[data-track="effects"] .timeline-track-resize',-120);
    assert.equal((await state()).heights.effects,32);
    const compact=await run(`const track=document.querySelectorAll('.timeline-track-viewport')[3];track.scrollTop=100;return {height:track.clientHeight,content:track.scrollHeight,scrollTop:track.scrollTop}`);
    assert.equal(compact.height,32);assert.ok(compact.content>32&&compact.scrollTop>0);
    await run(`document.querySelector('[data-track="effects"] .timeline-track-resize').dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}))`);await wait(80);
    assert.equal((await state()).heights.effects,initial.heights.effects);
    const saved=await state();await run(`document.querySelector('.timeline-topbar [title="Назад"]').click()`);await until(`!document.querySelector('.timeline-studio')`);await open();
    assert.deepEqual((await state()).heights,saved.heights,'Heights must survive editor reopening');
    await run(`document.querySelector('.timeline-sequencer').scrollTop=0`);await wait(100);
    await writeFile(join(root,'editor.png'),(await win.webContents.capturePage()).toPNG());
    assert.equal(await readFile(registry,'utf8'),before);
    const project=await run(`return window.goldWork.getProject(${JSON.stringify(fixture.id)})`);
    assert.deepEqual(project.scenes.map(s=>[s.narration,s.audioPath,s.documentary?.templateTiming]),fixture.scenes.map(s=>[s.narration,s.audioPath,s.documentary?.templateTiming]));
    assert.equal(errors.filter(e=>/Uncaught|Maximum update depth|Too many re-renders/.test(e)).length,0,errors.join('\n'));
    const result={at:new Date().toISOString(),build:info.buildId,initial,expanded,trackResults,compact,saved,checks:['native pointer panel resize','seven independent pointer track resizes','label and clip alignment','keyboard shrink','double-click reset','multi-lane compact scroll','Home reset','editor reopen persistence','no film edits'],registryPreserved:true,paidRequests:0,errors};
    await writeFile(join(root,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));clearTimeout(watchdog);app.exit(0);
  }catch(error){await writeFile(join(root,'failure.txt'),String(error.stack||error));if(win&&!win.isDestroyed())await writeFile(join(root,'failure.png'),(await win.webContents.capturePage()).toPNG());console.error(error);clearTimeout(watchdog);app.exit(1);}
});
