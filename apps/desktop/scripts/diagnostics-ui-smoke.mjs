import assert from 'node:assert/strict';
import { app, BrowserWindow } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Real React/DOM/CSS, in-memory providers. Never opens the user's desktop or credentials.
app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(run).then(() => app.exit(0)).catch(e => { console.error(e); app.exit(1); });
async function run() {
  const win = new BrowserWindow({ width: 1280, height: 920, show: false, webPreferences: {
    contextIsolation: true, sandbox: true, offscreen: true, backgroundThrottling: false, partition: `diagnostics-qa-${Date.now()}`,
  } });
  const evaluate = source => win.webContents.executeJavaScript(`(async()=>{${source}})()`, true);
  const waitFor = async expression => {
    for (let n = 0; n < 100; n++) { if (await evaluate(`return ${expression}`)) return; await new Promise(r => setTimeout(r, 80)); }
    throw new Error(`Timeout: ${expression}`);
  };
  const click = async selector => {
    await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
    const point = await evaluate(`const el=document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({block:'center'});
      if(el.disabled)throw new Error('disabled'); const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
      if(!el.contains(document.elementFromPoint(x,y)))throw new Error('obscured: '+${JSON.stringify(selector)}); return {x:Math.round(x),y:Math.round(y)};`);
    win.webContents.sendInputEvent({ type:'mouseDown',button:'left',clickCount:1,...point });
    win.webContents.sendInputEvent({ type:'mouseUp',button:'left',clickCount:1,...point });
    await new Promise(r => setTimeout(r, 300));
  };
  const captures = join(process.cwd(), 'captures', 'diagnostics-ui');
  const capture = async name => { await mkdir(captures, {recursive:true}); await writeFile(join(captures,name+'.png'),(await win.webContents.capturePage()).toPNG()); };
  try {
    await win.loadURL(new URL('fixtures/diagnostics.html', process.env.GOLD_WORK_SMOKE_URL ?? 'http://127.0.0.1:5174/').href);
    await waitFor('Boolean(document.querySelector(".channels-heading"))');
    await waitFor('Boolean(document.querySelector(".startup-health-toast[open]"))');
    await waitFor('document.querySelector(".startup-progress").getAttribute("aria-valuenow")==="8"');
    assert.equal(await evaluate('return document.querySelector("[data-service=lumean]").classList.contains("error")'), true);
    assert.equal(await evaluate('return document.querySelector("[data-service=anymodel]").classList.contains("checking")'), true);
    await capture('startup-partial');
    await click('.startup-health-toast .primary-button');
    await waitFor('!document.querySelector(".startup-health-toast").open');
    await click('[data-nav-key="channels"]');
    await evaluate('resolveHealth({ok:true,message:"Ключ принят; платная генерация не проверялась"});');
    await click('[data-action="open-health"]');
    await waitFor('document.querySelector(".startup-progress").getAttribute("aria-valuenow")==="9"');
    assert.equal(await evaluate('return healthCalls.length'),1);
    await capture('startup-completed');
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
    win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
    await waitFor('!document.querySelector(".startup-health-toast").open');
    await click('[data-action="open-health"]');
    await click('.startup-health-toast footer .secondary-button:nth-child(2)');
    assert.equal(await evaluate('return healthCalls.length'),2);
    await evaluate('resolveHealth({ok:true,message:"Ключ принят"});');
    await win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    assert.equal(await evaluate('return getComputedStyle(document.querySelector(".startup-brand i")).animationName'), 'none');
    win.setSize(980, 680);
    await capture('startup-small-reduced-motion');
    await click('.startup-health-toast .primary-button');
    win.setSize(1280, 920);
    await evaluate(`
      await qaApi.writeLog('debug','ipc.request',{operationId:'op-qa-report',channel:'test:fixture',projectId:'project_qa'});
      await qaApi.writeLog('error','ipc.failed',{operationId:'op-qa-report',channel:'test:fixture',error:{message:'fetch failed',cause:{code:'ECONNRESET'}},
        diagnostic:{summary:'Соединение оборвалось',nextAction:'Проверьте маршрут VPN / прокси'}});
    `);
    await click('.console-head > button');
    await waitFor('Boolean([...document.querySelectorAll(".console-failure")].find(e=>e.textContent.includes("Соединение оборвалось")))');
    await evaluate(`document.querySelectorAll('.console-failure').forEach(el=>{if(el.textContent.includes('Соединение оборвалось'))el.dataset.qa='failure';});`);
    await click('[data-qa="failure"] button:first-child');
    assert.equal(await evaluate('return document.querySelector(".console-toolbar input").value'), 'op-qa-report');
    // Headless/offscreen windows have no OS clipboard focus. Exercise the browser API contract
    // with an explicit clipboard fixture, including denied access, without touching user clipboard.
    await evaluate(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('Clipboard unavailable')}}});`);
    await click('[data-qa="failure"] button:nth-child(2)');
    await waitFor('document.querySelector("[data-qa=failure]").textContent.includes("Не удалось скопировать")');
    await evaluate(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.qaClipboard=text}}});`);
    await click('[data-qa="failure"] button:nth-child(2)');
    await waitFor('document.querySelector("[data-qa=failure]").textContent.includes("Отчёт скопирован")');
    const report=await evaluate('return window.qaClipboard');
    assert.match(report,/ipc.request/); assert.match(report,/ECONNRESET/); assert.match(report,/op-qa-report/);
    await capture('incident-report');
    const panelHeight = () => evaluate('return document.querySelector(".console-dock").getBoundingClientRect().height');
    const dragConsole = async delta => {
      const point=await evaluate(`const el=document.querySelector('.console-resize-handle'),r=el.getBoundingClientRect();
        const x=r.x+80,y=r.y+r.height/2;if(!el.contains(document.elementFromPoint(x,y)))throw new Error('Resize handle obscured');return {x:Math.round(x),y:Math.round(y)};`);
      win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});
      for(let i=1;i<=5;i++) {
        win.webContents.sendInputEvent({type:'mouseMove',modifiers:['leftButtonDown'],x:point.x,y:Math.round(point.y+delta*i/5)});
        await new Promise(r=>setTimeout(r,30));
      }
      win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:point.x,y:Math.round(point.y+delta)});
      await new Promise(r=>setTimeout(r,80));
      assert.equal(await evaluate('return document.body.classList.contains("console-is-resizing")'),false);
    };
    const initial=await panelHeight();
    await dragConsole(-220);
    assert.ok(Math.abs(await panelHeight()-(initial+220))<3,'dragging up grows console');
    await capture('console-expanded');
    await dragConsole(120);
    const resized=await panelHeight();
    assert.ok(Math.abs(resized-(initial+100))<3,'dragging down shrinks console');
    await click('.console-head > button');
    assert.ok(await panelHeight()<45,'collapsed header remains compact');
    await click('.console-head > button');
    assert.ok(Math.abs(await panelHeight()-resized)<2,'open restores selected height');
    await click('[data-nav-key="projects"]');
    assert.ok(Math.abs(await panelHeight()-resized)<2,'navigation preserves height');
    await win.reload();
    await waitFor('Boolean(document.querySelector(".startup-health-toast[open]"))');
    await click('.startup-health-toast .primary-button');
    await click('.console-head > button');
    assert.ok(Math.abs(await panelHeight()-resized)<2,'reload restores saved height');
    await click('.console-resize-handle');
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'End'});
    win.webContents.sendInputEvent({type:'keyUp',keyCode:'End'});
    await new Promise(r=>setTimeout(r,80));
    assert.equal(await evaluate('const el=document.querySelector(".console-resize-handle");return el.getAttribute("aria-valuenow")===el.getAttribute("aria-valuemax")'),true);
    win.setSize(980,680);
    await new Promise(r=>setTimeout(r,150));
    assert.equal(await evaluate('const r=document.querySelector(".console-dock").getBoundingClientRect();return r.top>=100 && r.bottom<=innerHeight+1'),true,'small window keeps console inside viewport');
    await capture('console-small-window');
    await click('.console-resize-handle');
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Home'});
    win.webContents.sendInputEvent({type:'keyUp',keyCode:'Home'});
    await new Promise(r=>setTimeout(r,80));
    assert.ok(Math.abs(await panelHeight()-150)<2,'minimum height');
    console.log('PASS: startup/incident UI; console drag up/down, collapse/reopen, navigation/reload persistence, keyboard bounds and smaller viewport. Mock providers only.');
  } finally { win.destroy(); }
}
