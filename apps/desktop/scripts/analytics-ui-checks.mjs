import assert from 'node:assert/strict';
import electron from 'electron';
import { join } from 'node:path';

/** Shared headless Electron UI fixture: no credentials, network calls or user files. */
export async function checkAnalyticsUi({ evaluate, click, set, waitFor, capture, win }) {
  await evaluate(`{
    const now=Date.now();
    window.analyticsRows=[
      {id:'analytics-a',url:'https://www.youtube.com/@stories',name:'Истории · EN',group:'Истории',addedAt:new Date(now-7*86400000).toISOString(),lastAttemptAt:new Date(now).toISOString(),snapshots:[0,1,2,3,4,5,6].map(i=>({capturedAt:new Date(now-(6-i)*86400000).toISOString(),views:12000+i*1400,subscribers:200+i*30,videos:8+i}))},
      {id:'analytics-b',url:'https://www.youtube.com/@garage',name:'Гараж · RU',group:'Автомобили',addedAt:new Date(now).toISOString(),lastAttemptAt:new Date(now).toISOString(),snapshots:[{capturedAt:new Date(now).toISOString(),views:34000,subscribers:null,videos:24}]}
    ];
    creationApi.getYouTubeSettings=async()=>({configured:true});
    creationApi.listTrackedChannels=async()=>structuredClone(analyticsRows);
    creationApi.saveTrackedChannel=async input=>{
      if(input.id){const c=analyticsRows.find(c=>c.id===input.id);Object.assign(c,{name:input.name,group:input.group});}
      else analyticsRows.push({...input,id:'analytics-new',addedAt:new Date().toISOString(),lastAttemptAt:new Date().toISOString(),snapshots:[]});
      return structuredClone(analyticsRows);
    };
    creationApi.removeTrackedChannel=async id=>{analyticsRows=analyticsRows.filter(c=>c.id!==id);return structuredClone(analyticsRows);};
    creationApi.refreshTrackedChannels=async()=>{
      analyticsRows.forEach(c=>{c.lastAttemptAt=new Date().toISOString();});
      analyticsRows[0].lastError='Тест: YouTube API quotaExceeded';
      return structuredClone(analyticsRows);
    };
  }`);
  await click('[data-nav-key=analytics]');
  await waitFor('document.querySelectorAll(".analytics-channel").length===2');
  assert.equal(await evaluate('Boolean(document.querySelector(".tool-workspace"))'),false,'Analytics must not also render the unrelated Studio placeholder');
  assert.equal(await evaluate('document.querySelectorAll(".analytics-chart-dot").length'),7);
  await click('.active-video-dock .icon-button');
  assert.equal(await evaluate('Boolean(document.querySelector(".active-video-dock"))'),false);
  await capture('analytics-overview');
  await set('[aria-label="Сетка каналов"]','Автомобили');
  assert.equal(await evaluate('document.querySelectorAll(".analytics-channel").length'),1);
  assert.equal(await evaluate('document.querySelectorAll(".analytics-chart-dot").length'),1);
  await set('[aria-label="Режим графика"]','delta');
  await waitFor('document.querySelector(".analytics-chart-empty")?.textContent.includes("два замера")');
  await set('[aria-label="Сетка каналов"]','');
  await set('[aria-label="Режим графика"]','total');
  await click('.analytics-heading .primary-button');
  await set('[name=channelUrl]','https://www.youtube.com/@football');
  await set('[name=channelName]','Футбол · ES');
  await set('[name=channelGroup]','Спорт');
  await click('.analytics-form [type=submit]');
  await waitFor('document.querySelectorAll(".analytics-channel").length===3');
  await waitFor('Boolean(document.querySelector(".analytics-chart-empty"))');
  await click('[aria-label="Изменить Футбол · ES"]');
  assert.equal(await evaluate('document.querySelector("[name=channelUrl]").readOnly'),true);
  await set('[name=channelName]','Футбол · Испания');
  await click('.analytics-form [type=submit]');
  await waitFor('document.querySelector(".analytics-channel.selected")?.textContent.includes("Испания")');
  await click('[aria-label="Убрать Футбол · Испания"]');
  await click('.analytics-confirm .secondary-button');
  assert.equal(await evaluate('analyticsRows.length'),3);
  await click('[aria-label="Убрать Футбол · Испания"]');
  await click('.analytics-confirm .primary-button');
  await waitFor('document.querySelectorAll(".analytics-channel").length===2');
  await click('.analytics-heading .secondary-button');
  await waitFor('Boolean(document.querySelector(".analytics-channel-error"))');
  assert.equal(await evaluate('analyticsRows[0].snapshots.length'),7,'API failure must not clear the graph');
  await set('[aria-label="Режим графика"]','delta');
  assert.equal(await evaluate('document.querySelectorAll(".analytics-delta-line").length'),6);
  await evaluate('document.querySelector(".analytics-chart-panel").scrollIntoView({block:"start"})');
  await new Promise(resolve=>setTimeout(resolve,180));
  await capture('analytics-growth');
  // Every interval can be negative after deletions/audits; the zero baseline must still fit.
  await evaluate('analyticsRows[0].snapshots.forEach((s,i)=>{s.views=12000-i*100;})');
  await click('.analytics-heading .secondary-button');
  await waitFor('document.querySelector(".analytics-chart-value")?.textContent.includes("-100")');
  assert.ok(await evaluate('[...document.querySelectorAll(".analytics-delta-line")].every(l=>Number(l.getAttribute("y1"))>=20 && Number(l.getAttribute("y1"))<=232 && Number(l.getAttribute("y2"))>=20 && Number(l.getAttribute("y2"))<=232)'),'Negative-only changes must retain a visible zero baseline');
  await evaluate('document.querySelector(".analytics-chart-panel").scrollIntoView({block:"start"})');
  await new Promise(resolve=>setTimeout(resolve,180));
  await capture('analytics-negative-growth');
  await evaluate('document.querySelector(".analytics-heading").scrollIntoView({block:"start"})');
  win.setSize(1100,900);
  await new Promise(resolve=>setTimeout(resolve,200));
  assert.ok(await evaluate('document.querySelector(".analytics-page").scrollWidth <= document.querySelector(".page-scroll").clientWidth'),'Analytics must fit a smaller desktop window');
  await capture('analytics-compact');
  await click('[data-nav-key=channels]');
  assert.equal(await evaluate('Boolean(document.querySelector(".active-video-dock"))'),false,'Navigation must not unhide the dock');
  await click('.restore-video-dock');
  await waitFor('Boolean(document.querySelector(".active-video-dock"))');
  assert.equal(await evaluate('localStorage.getItem("gws-video-dock-hidden")'),'false');
  await click('.active-video-dock .icon-button');
  await win.reload();
  await waitFor('Boolean(document.querySelector("[data-nav-key=channels]"))');
  assert.equal(await evaluate('localStorage.getItem("gws-video-dock-hidden")'),'true');
  assert.equal(await evaluate('Boolean(document.querySelector(".active-video-dock"))'),false,'Reload must retain hidden preference');
  await checkAnalyticsPreload();
}

async function checkAnalyticsPreload() {
  const { BrowserWindow, ipcMain } = electron;
  const calls=[];
  const routes=['analytics:list','analytics:save','analytics:refresh','analytics:remove'];
  for (const route of routes) ipcMain.handle(route, (_event, input)=>{
    calls.push({route,input});
    if(route==='analytics:save' && input.name==='invalid') throw new Error('Invalid test channel');
    return [];
  });
  const ipcWindow=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,sandbox:true,preload:join(process.cwd(),'dist','preload','index.cjs'),partition:'analytics-ipc-'+Date.now()}});
  try {
    await ipcWindow.loadURL('data:text/html,<title>Local IPC check</title>');
    const result=await ipcWindow.webContents.executeJavaScript(`(async()=>{
      const api=window.goldWork;
      await api.listTrackedChannels();
      await api.saveTrackedChannel({url:'https://youtube.com/@test',name:'Test',group:'Network'});
      await api.refreshTrackedChannels({id:'test-id',automatic:true});
      await api.removeTrackedChannel('test-id');
      try { await api.saveTrackedChannel({url:'@test',name:'invalid'});return false; } catch(error) { return String(error).includes('Invalid test channel'); }
    })()`);
    assert.equal(result,true,'IPC errors must remain visible to the renderer');
    assert.deepEqual(calls.slice(0,4).map(c=>c.route),routes);
    assert.deepEqual(calls[1].input,{url:'https://youtube.com/@test',name:'Test',group:'Network'});
    assert.deepEqual(calls[2].input,{id:'test-id',automatic:true});
    assert.equal(calls[3].input,'test-id');
  } finally {
    ipcWindow.destroy();
    for(const route of routes) ipcMain.removeHandler(route);
  }
}
