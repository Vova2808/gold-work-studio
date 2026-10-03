import assert from 'node:assert/strict';
import {app,BrowserWindow} from 'electron';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {loadConfigFromFile} from 'electron-vite';
import {documentaryTemplates} from '@gold-work/shared';
const require=createRequire(import.meta.url),root=resolve('captures/montage-speed-20260927/new-production/renderer-memory-20261001'),profile=join(root,'profile');await mkdir(profile,{recursive:true});
const registry=join(process.env.APPDATA,'@gold-work/desktop/projects.json'),before=await readFile(registry,'utf8');
const original=JSON.parse(before).find(p=>p.id==='project_mun42rx8_1jcven5');assert.ok(original);
const fixture=structuredClone(original);fixture.id='local-memory-20261001';fixture.title='LOCAL MEMORY QA';fixture.status='failed';fixture.outputPath=undefined;
await writeFile(join(profile,'projects.json'),JSON.stringify([fixture]));await writeFile(join(profile,'storage-location.json'),JSON.stringify({activePath:'D:/GoldWorkStorage'}));
const {config}=await loadConfigFromFile({command:'serve',mode:'development'},resolve('electron.vite.config.ts'));
const {createServer}=await import(pathToFileURL(require.resolve('vite',{paths:[dirname(require.resolve('electron-vite'))]})).href);
assert.equal(config.renderer.define['process.env.NODE_ENV'],'"production"');
const probe=`import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
export function start(data){const host=document.createElement('div');host.style.display='none';document.body.append(host);const root=createRoot(host);const Component=({project,iteration})=>React.createElement('span',null,project.title+iteration);return {render(i){flushSync(()=>root.render(React.createElement(Component,{project:structuredClone(data),iteration:i})))},close(){root.unmount();host.remove()}}}`;
const server=await createServer({...config.renderer,configFile:false,cacheDir:join(root,'vite-cache'),optimizeDeps:{...config.renderer.optimizeDeps,include:['react','react-dom','react-dom/client']},server:{host:'127.0.0.1',port:0,strictPort:false,fs:{allow:[resolve('../..')]}},plugins:[{name:'memory-probe',resolveId(id){if(id==='virtual:gws-memory-probe')return '\0'+id;},load(id){if(id==='\0virtual:gws-memory-probe')return probe;}}]});
await server.listen();process.env.ELECTRON_RENDERER_URL=server.resolvedUrls.local[0];delete process.env.PORTABLE_EXECUTABLE_DIR;app.setPath('userData',profile);
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');app.commandLine.appendSwitch('enable-precise-memory-info');
require(resolve('dist/main/index.cjs'));
app.whenReady().then(async()=>{
  const wait=ms=>new Promise(r=>setTimeout(r,ms));let win;const errors=[];const watchdog=setTimeout(()=>{console.error('Memory QA timeout');app.exit(1);},150000);
  try{
    for(let i=0;i<240;i++){win=BrowserWindow.getAllWindows()[0];if(win&&!win.webContents.isLoadingMainFrame())break;await wait(100);}assert.ok(win);win.setSize(1600,1050);win.show();win.focus();win.webContents.setBackgroundThrottling(false);
    win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)errors.push(message);});win.webContents.on('render-process-gone',(_e,details)=>errors.push('process-gone:'+details.reason));
    const run=code=>win.webContents.executeJavaScript(`(async()=>{${code}})()`,true);
    const until=async expr=>{for(let i=0;i<200;i++){if(await run(`return Boolean(${expr})`))return;await wait(100);}throw Error('UI timeout: '+expr);};
    await until('window.goldWork&&document.querySelector("[data-nav-key=projects]")');
    const info=await run('return window.goldWork.getAppInfo()');assert.equal(await run('return document.querySelector("[data-renderer-build-id]").dataset.rendererBuildId'),info.buildId);
    await run(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Открыть приложение')?.click();document.querySelector('[data-nav-key=projects]').click()`);
    await until(`document.querySelector('.projects-table-row')`);await run(`document.querySelector('.projects-table-row').click()`);await until(`document.querySelector('.project-expand')`);
    await run(`[...document.querySelectorAll('.project-expand button')].find(b=>b.textContent.trim()==='Таймлайн').click()`);await until(`document.querySelector('.documentary-template-clip')`);
    await run(`document.querySelector('.documentary-template-clip').click();[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Выбрать по композиции')).click()`);await until(`document.querySelector('.documentary-template-grid')`);
    assert.equal(await run(`return document.querySelectorAll('.documentary-template-grid button').length`),documentaryTemplates.length);
    await wait(400);
    const visible=await run(`const d=document.querySelector('.documentary-template-picker'),r=d.getBoundingClientRect();return {width:r.width,height:r.height,visible:!!document.elementFromPoint(r.left+30,r.top+30)?.closest('.documentary-template-picker')}`);assert.equal(visible.visible,true);
    await writeFile(join(root,'catalog.png'),(await win.webContents.capturePage()).toPNG());
    if(process.argv.includes('--catalog-only')){assert.equal(await readFile(registry,'utf8'),before);const result={at:new Date().toISOString(),build:info.buildId,catalog:documentaryTemplates.length,visible,mainRendererMatched:true,registryPreserved:true,paidRequests:0};await writeFile(join(root,'final-startup.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));clearTimeout(watchdog);await server.close();app.exit(0);return;}
    await run(`document.querySelector('.documentary-template-grid button[title="Телевизор · эффект на весь кадр"]').click()`);await until(`!document.querySelector('.documentary-template-picker')`);
    await run(`const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Применить');if(button)button.click()`);await wait(250);
    // Isolated data, actual renderer runtime. Large changing React props reproduce
    // the allocation path in the logged Performance.measure crash without fees.
    const samples=[];await run(`window.memoryProbe=(await import('/@id/__x00__virtual:gws-memory-probe')).start(await window.goldWork.getProject(${JSON.stringify(fixture.id)}));performance.clearMeasures();`);
    for(let batch=0;batch<8;batch++){
      await run(`for(let i=0;i<50;i++){window.memoryProbe.render(${batch*50}+i);await new Promise(r=>setTimeout(r,5));}`);
      for(let i=0;i<30;i++)win.webContents.send('stock:auto-progress',{projectId:fixture.id,phase:'searching',completed:63,total:246,selected:63,skipped:0,failed:0,message:`Local progress ${batch*30+i}`});
      await wait(100);await win.webContents.debugger.attach('1.3');await win.webContents.debugger.sendCommand('HeapProfiler.collectGarbage');win.webContents.debugger.detach();
      const sample=await run(`return {heap:performance.memory.usedJSHeapSize,measures:performance.getEntriesByType('measure').length,reactMeasures:performance.getEntriesByType('measure').filter(e=>e.detail?.devtools).length}`);samples.push({...sample,updates:(batch+1)*50});console.log(JSON.stringify(samples.at(-1)));
    }
    assert.ok(samples.every(s=>s.reactMeasures===0),'No React profiling props may be retained');
    assert.ok(samples.at(-1).heap-samples[2].heap<48*1024*1024,'Post-GC renderer heap must plateau during 400 large-prop updates');
    await run('window.memoryProbe.close();delete window.memoryProbe');
    const saved=await run(`return window.goldWork.getProject(${JSON.stringify(fixture.id)})`);assert.equal(saved.scenes[0].documentary.template,'broadcast-scanlines');
    assert.deepEqual(saved.scenes.map(s=>[s.narration,s.audioPath]),fixture.scenes.map(s=>[s.narration,s.audioPath]));
    assert.equal(await readFile(registry,'utf8'),before);assert.equal(errors.filter(e=>/Uncaught|process-gone|out of memory/.test(e)).length,0,errors.join('\n'));
    const result={at:new Date().toISOString(),build:info.buildId,mode:'Vite development server with production React runtime',samples,catalog:documentaryTemplates.length,selectedTemplate:saved.scenes[0].documentary.template,registryPreserved:true,voicesPreserved:true,paidRequests:0,errors,note:'Bounded local allocation regression, not an overnight/low-RAM certification.'};await writeFile(join(root,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
    clearTimeout(watchdog);await server.close();app.exit(0);
  }catch(error){await writeFile(join(root,'failure.txt'),String(error.stack||error));console.error(error);if(win&&!win.isDestroyed())await writeFile(join(root,'failure.png'),(await win.webContents.capturePage()).toPNG());clearTimeout(watchdog);await server.close();app.exit(1);}
});
