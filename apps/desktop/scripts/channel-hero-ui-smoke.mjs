import assert from 'node:assert/strict';
import electron from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Isolated actual renderer/DOM/CSS. In-memory data and a simulated new portrait; no live services.
const { app, BrowserWindow } = electron;
app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(run).catch(error => { console.error(error); app.exit(1); });
async function run() {
  const win = new BrowserWindow({ width: 1360, height: 960, show: false, webPreferences: {
    contextIsolation: true, sandbox: true, offscreen: true, backgroundThrottling: false, partition: `channel-hero-${Date.now()}`,
  } });
  const evaluate = async source => {
    const result = await win.webContents.executeJavaScript(`(async()=>{try{${source}}catch(e){return {__error:String(e.stack??e)}}})()`, true);
    if (result?.__error) throw new Error(result.__error);
    return result;
  };
  const until = async source => {
    for (let n = 0; n < 100; n++) { if (await evaluate(`return (${source})`)) return; await new Promise(resolve => setTimeout(resolve, 100)); }
    throw new Error('Timeout: ' + source);
  };
  const click = async selector => {
    await until(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
    const point = await evaluate(`const el=document.querySelector(${JSON.stringify(selector)}); if(el.matches(':disabled'))throw Error('Disabled');
      el.scrollIntoView({block:'center'}); const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
      if(!el.contains(document.elementFromPoint(x,y)))throw Error('Obscured '+${JSON.stringify(selector)}); return {x:Math.round(x),y:Math.round(y)};`);
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
    await new Promise(resolve => setTimeout(resolve, 100));
  };
  const set = async (selector, value) => {
    await evaluate(`const el=document.querySelector(${JSON.stringify(selector)});
      const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:el instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});
      el.dispatchEvent(new Event(el instanceof HTMLSelectElement?'change':'input',{bubbles:true}));`);
  };
  const capture = async name => {
    const dir = join(process.cwd(), 'captures', 'channel-hero'); await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name + '.png'), (await win.webContents.capturePage()).toPNG());
  };
  try {
    await win.loadURL(process.env.GOLD_WORK_SMOKE_URL ?? 'http://127.0.0.1:5173/');
    await until('Boolean(document.querySelector(".channels-heading"))');
    await evaluate(`
      if(window.goldWork)throw Error('Must not use real providers');
      const url=performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/fallback-api.ts')?.name;
      window.qaApi=(await import(url??'/src/fallback-api.ts')).fallbackApi; window.qaErrors=[];
      window.addEventListener('unhandledrejection',e=>qaErrors.push(String(e.reason)));
      const input={name:'Герой канала — проверка',countryCode:'US',languageCode:'en',languageLabel:'English',masterPrompt:'',direction:'ai-story',defaultMediaMode:'ai',defaultDurationMinutes:10,motionTemplate:'none'};
      window.qaChannel=await qaApi.createChannelProfile(input); window.qaOther=await qaApi.createChannelProfile({...input,name:'Другой канал'});
      const p=await qaApi.createProject({title:'Готовый ролик',topic:'Test',language:'English',aspectRatio:'16:9',mode:'pro',channelProfileId:qaChannel.id});
      const svg='<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240"><rect width="240" height="240" fill="#ece5d6"/><circle cx="120" cy="66" r="32" fill="white" stroke="black" stroke-width="4"/><circle cx="110" cy="65" r="3"/><circle cx="130" cy="65" r="3"/><path d="M110 78 Q120 88 130 78 M120 98 L120 160 L93 212 M120 160 L146 212 M120 105 L85 147 M120 105 L154 147" fill="none" stroke="black" stroke-width="4"/><path d="M108 102 L131 102 L138 160 L100 160Z" fill="#68897a" stroke="black" stroke-width="3"/></svg>';
      window.qaPortrait='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
      const cast=[{id:'main',name:'Sam',aliases:['Main User'],prompt:'Round white face, green shirt',stylePrompt:'Flat 2D',imagePath:qaPortrait,status:'ready'},
        {id:'second',name:'Alex',aliases:[],prompt:'A different person',stylePrompt:'Flat 2D',imagePath:qaPortrait,status:'ready'}];
      window.qaProject=await qaApi.updateProject(p.id,{mediaMode:'ai',status:'complete',outputPath:'fixture-final.mp4',storyCharacters:cast,
        scenes:[{id:'scene-one',order:0,title:'Scene one',narration:'The original narration stays unchanged.',durationSeconds:5,imagePrompt:'Sam at home',stockQuery:'home',animationPrompt:'slow zoom',characterIds:['main'],status:'ready',imagePath:qaPortrait}]});
      window.qaOriginal=JSON.stringify(qaProject);
      window.confirm=()=>true;
      window.qaGenerateCalls=0;
      qaApi.generateChannelCharacter=async(channelId,input)=>{
        qaGenerateCalls++; const profile=(await qaApi.listChannelProfiles()).find(c=>c.id===channelId);
        const candidate={...profile.primaryCharacter,name:input.name,prompt:input.prompt,characterPrompt:input.prompt,
          versionId:'qa-new-version',imagePath:qaPortrait,createdAt:new Date().toISOString()};
        return qaApi.updateChannelProfile(channelId,{...profile,characterVersions:[candidate,...profile.characterVersions]});
      };
      window.dispatchEvent(new Event('gws:channel-character-changed'));
    `);
    await until('[...document.querySelectorAll(".channel-card")].some(el=>el.textContent.includes("Герой канала — проверка"))');
    await evaluate('[...document.querySelectorAll(".channel-card")].find(el=>el.textContent.includes("Герой канала — проверка")).click();');
    await until('document.querySelectorAll("[data-hero-source]").length===2');
    await capture('01-existing-cast');
    await click('[data-hero-source="main"] .outline-button');
    await until('document.querySelector(".channel-character-card strong")?.textContent==="Sam"');
    assert.equal(await evaluate('return JSON.stringify(await qaApi.getProject(qaProject.id))'), await evaluate('return qaOriginal'));
    await capture('02-saved-hero');
    await click('.channel-workspace-heading .primary-button');
    await until('Boolean(document.querySelector(".reuse-channel-character"))');
    assert.equal(await evaluate('return document.querySelector(".reuse-channel-character input").checked'), true);
    assert.match(await evaluate('return document.querySelector(".reuse-channel-character").textContent'), /Sam/);
    await click('.reuse-channel-character input');
    assert.equal(await evaluate('return document.querySelector(".reuse-channel-character input").checked'), false);
    await click('.reuse-channel-character input');
    await capture('03-reuse-next-video');
    await click('.video-dialog .channel-dialog-header button');
    await click('.channel-character-card .outline-button');
    await set('.channel-hero-editor input', 'Samuel');
    await set('.channel-hero-editor textarea', 'Round face, glasses and blue jacket');
    await click('.channel-hero-editor .primary-button');
    await until('Boolean(document.querySelector("[data-hero-version=qa-new-version]"))');
    assert.equal(await evaluate('return document.querySelector(".channel-character-card strong").textContent'), 'Sam');
    assert.equal(await evaluate('return qaGenerateCalls'), 1);
    await capture('04-candidate');
    await click('[data-hero-version="qa-new-version"] .outline-button');
    await until('document.querySelector(".channel-character-card strong")?.textContent==="Samuel"');
    assert.equal(await evaluate('return JSON.stringify(await qaApi.getProject(qaProject.id))'), await evaluate('return qaOriginal'));
    await click('.channel-character-card .channel-hero-portrait');
    await until('Boolean(document.querySelector(".cast-preview-modal"))');
    await capture('05-preview');
    await click('.cast-preview-modal .icon-button');
    await click('.channel-workspace-heading > .icon-button');
    await evaluate('[...document.querySelectorAll(".channel-card")].find(el=>el.textContent.includes("Другой канал")).click();');
    await until('Boolean(document.querySelector("[data-channel-hero]"))');
    assert.equal(await evaluate('return Boolean(document.querySelector(".channel-character-card"))'), false);
    assert.equal(await evaluate('return document.querySelectorAll("[data-hero-source]").length'), 0);
    await click('.channel-workspace-heading .primary-button');
    await until('Boolean(document.querySelector(".video-dialog"))');
    assert.equal(await evaluate('return Boolean(document.querySelector(".reuse-channel-character"))'), false);
    await click('.video-dialog .channel-dialog-header button');
    await click('.channel-workspace-heading > .icon-button');
    await evaluate('[...document.querySelectorAll(".channel-card")].find(el=>el.textContent.includes("Герой канала — проверка")).click();');
    await until('document.querySelector(".channel-character-card strong")?.textContent==="Samuel"');
    // Same app's scenario control publishes without touching its finished video.
    await click('.channel-project-open');
    await until('Boolean(document.querySelector("[data-flow-step=scenario]"))');
    if (!await evaluate('return Boolean(document.querySelector(".story-channel-hero-picker"))')) await click('[data-flow-step="scenario"]');
    await until('Boolean(document.querySelector(".story-channel-hero-picker select"))');
    await set('.story-channel-hero-picker select', 'second');
    await until('!document.querySelector(".story-channel-hero-picker .outline-button").disabled');
    await click('.story-channel-hero-picker .outline-button');
    await until('document.querySelector(".story-channel-hero-picker p")?.textContent.includes("Alex")');
    await click('[data-nav-key="channels"]');
    await until('document.querySelector(".channel-character-card strong")?.textContent==="Alex"');
    const deleteId = await evaluate('return (await qaApi.listChannelProfiles()).find(c=>c.id===qaChannel.id).primaryCharacter.versionId');
    await evaluate('window.confirm=()=>false;');
    await click(`[data-delete-hero="${deleteId}"]`);
    assert.equal(await evaluate('return document.querySelector(".channel-character-card strong").textContent'), 'Alex');
    assert.equal(await evaluate('return document.querySelectorAll("[data-deleted-hero]").length'), 0);
    await evaluate('window.confirm=()=>true;');
    await click('[data-delete-hero="qa-new-version"]');
    await until('Boolean(document.querySelector("[data-deleted-hero=qa-new-version]"))');
    assert.equal(await evaluate('return document.querySelector(".channel-character-card strong").textContent'), 'Alex');
    await click(`[data-delete-hero="${deleteId}"]`);
    await until('!document.querySelector(".channel-character-card")');
    await click('.channel-workspace-heading .primary-button');
    await until('Boolean(document.querySelector(".video-dialog"))');
    assert.equal(await evaluate('return Boolean(document.querySelector(".reuse-channel-character"))'), false);
    await click('.video-dialog .channel-dialog-header button');
    await click('[data-deleted-heroes] > summary');
    await capture('06-deleted-heroes');
    await click(`[data-deleted-hero="${deleteId}"] .outline-button`);
    await until(`Boolean(document.querySelector('[data-hero-version="${deleteId}"]'))`);
    assert.equal(await evaluate('return Boolean(document.querySelector(".channel-character-card"))'), false);
    await click(`[data-hero-version="${deleteId}"] .outline-button`);
    await until('document.querySelector(".channel-character-card strong")?.textContent==="Alex"');
    await capture('07-restored-hero');
    assert.equal(await evaluate('return JSON.stringify(await qaApi.getProject(qaProject.id))'), await evaluate('return qaOriginal'));
    assert.deepEqual(await evaluate('return qaErrors'), []);
    console.log('PASS: channel source selection, version confirmation/reuse, channel isolation, scenario publish, delete cancellation, remove candidate/main, no implicit replacement, restore and unchanged finished video. Mock portrait generation only.');
    win.destroy(); app.exit(0);
  } catch (error) {
    await capture('failure').catch(() => undefined);
    console.error(error); win.destroy(); app.exit(1);
  }
}
