import assert from 'node:assert/strict';
import { app, BrowserWindow } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(run).then(()=>app.exit(0)).catch(error=>{console.error(error);app.exit(1)});
async function run() {
  const win=new BrowserWindow({width:1440,height:1000,show:false,webPreferences:{contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false,partition:`documentary-edit-${Date.now()}`}});
  const errors=[];
  win.webContents.on('console-message',(_event,level,message)=>{if(level>=3)errors.push(message)});
  const evaluate=source=>win.webContents.executeJavaScript(`(async()=>{${source}})()`,true);
  const waitFor=async expression=>{for(let i=0;i<80;i++){if(await evaluate(`return ${expression}`))return;await new Promise(r=>setTimeout(r,100))}throw new Error('Timeout: '+expression)};
  const clickText=async text=>{await evaluate(`const el=[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===${JSON.stringify(text)});if(!el)throw new Error('Missing button: '+${JSON.stringify(text)});el.click();`);await new Promise(r=>setTimeout(r,100))};
  await win.loadURL('http://127.0.0.1:5174/fixtures/documentary-editing.html');
  await waitFor('typeof qaProgress === "function" && Boolean(document.querySelector("[data-nav-key=projects]"))');
  await evaluate('document.querySelectorAll("dialog").forEach(el=>el.close());qaProgress({});');
  await waitFor('Boolean(document.querySelector(".auto-stock-toast-close"))');
  await evaluate('document.querySelector(".auto-stock-toast-close").click();');
  await evaluate('qaProgress({completed:2});');
  await new Promise(r=>setTimeout(r,200));
  assert.equal(await evaluate('return Boolean(document.querySelector(".auto-stock-toast"))'),false);
  await clickText('Показать подбор материалов');
  assert.equal(await evaluate('return document.querySelector(".auto-stock-toast-counts").textContent.includes("2 из 107")'),true);
  await evaluate('document.querySelector(".auto-stock-toast-close").click();document.querySelector("[data-nav-key=projects]").click();');
  await waitFor('Boolean(document.querySelector(".projects-table-row"))');
  await evaluate('document.querySelector(".projects-table-row").click();');
  await clickText('Таймлайн');
  await waitFor('Boolean(document.querySelector(".documentary-effect-clip"))');
  // Drag the real DOM clip by one second, then undo and exercise the trim handle.
  const point=await evaluate('const el=document.querySelector(".documentary-effect-clip"),r=el.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),px:document.querySelector(".documentary-effect-track").clientWidth/321};');
  const drag=async(x,y,dx)=>{win.webContents.sendInputEvent({type:'mouseMove',x,y});win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x,y});win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(x+dx),y});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:Math.round(x+dx),y});await new Promise(r=>setTimeout(r,150));};
  await drag(point.x,point.y,point.px);
  assert.match(await evaluate('return document.querySelector(".documentary-effect-clip").title'),/2\.00–4\.50/);
  await clickText('↶ Отменить');
  assert.match(await evaluate('return document.querySelector(".documentary-effect-clip").title'),/1\.00–3\.50/);
  const edge=await evaluate('const r=document.querySelector(".documentary-trim-handle.right").getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};');
  await drag(edge.x,edge.y,-point.px*.5);
  const trimmed=await evaluate('return document.querySelector(".documentary-effect-clip").title');
  assert.match(trimmed,/1\.00–3\.00/);
  for(let i=0;i<8;i++){await evaluate('await qaUpdate();qaProgress({completed:3});');await new Promise(r=>setTimeout(r,800));}
  assert.equal(await evaluate('return document.querySelector(".documentary-effect-clip").title'),trimmed);
  await clickText('Применить');
  assert.equal(await evaluate('const p=await qaProject();return p.scenes[1].documentary.effects[0].durationSeconds;'),2);
  assert.equal(errors.filter(message=>/Maximum update depth|Uncaught|Too many re-renders/.test(message)).length,0,errors.join('\n'));
  const root=join(process.cwd(),'captures','resume-2026-09-19');await mkdir(root,{recursive:true});
  await writeFile(join(root,'editor-effects.png'),(await win.webContents.capturePage()).toPNG());
  await writeFile(join(root,'ui-check.json'),JSON.stringify({ok:true,checks:['hide/restore live progress','move SFX','undo','trim SFX','retain edit during 8 background updates','save edited SFX'],errors},null,2));
  console.log('PASS: progress, drag, undo, trim, background updates; '+errors.length+' console errors');
  win.destroy();
}
