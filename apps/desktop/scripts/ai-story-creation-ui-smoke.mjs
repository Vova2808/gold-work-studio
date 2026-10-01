import assert from 'node:assert/strict';
import electron from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { scenarioQualityFingerprint } from '@gold-work/shared';
import { checkAnalyticsUi } from './analytics-ui-checks.mjs';

// Real React, DOM hit testing and CSS; only in-memory providers. No user data or paid requests.
const { app, BrowserWindow } = electron;
app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(run).catch(error => { console.error(error); app.exit(1); });
async function run() {
  const win = new BrowserWindow({ width: 1280, height: 920, show: false, webPreferences: {
    contextIsolation: true, sandbox: true, offscreen: true, backgroundThrottling: false,
    partition: `creation-smoke-${Date.now()}`,
  } });
  win.webContents.on('console-message', event => { if (event.level === 'error') console.error('[renderer]', event.message); });
  const evaluate = async source => {
    const result = await win.webContents.executeJavaScript(`(async()=>{try{return await (async()=>${source})()}catch(e){return {__error:String(e.stack??e)}}})()`, true)
      .catch(error => { throw new Error(String(error) + '\nSource: ' + source.slice(0, 200)); });
    if (result?.__error) throw new Error(result.__error + '\nSource: ' + source.slice(0, 160));
    return result;
  };
  const waitFor = async (source, label = source) => {
    for (let n = 0; n < 100; n++) {
      if (await evaluate(source)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Timeout: ${label}`);
  };
  const click = async selector => {
    await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
    const point = await evaluate(`{
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el.disabled || el.matches(':disabled')) throw new Error('Disabled: '+${JSON.stringify(selector)});
      el.scrollIntoView({block:'center'});
      const r=el.getBoundingClientRect(), x=r.x+r.width/2, y=r.y+r.height/2;
      if (!el.contains(document.elementFromPoint(x,y))) throw new Error('Obscured: '+${JSON.stringify(selector)});
      return {x:Math.round(x),y:Math.round(y)};
    }`);
    win.webContents.sendInputEvent({ type:'mouseDown', button:'left', clickCount:1, ...point });
    win.webContents.sendInputEvent({ type:'mouseUp', button:'left', clickCount:1, ...point });
    await new Promise(resolve => setTimeout(resolve, 80));
  };
  const set = async (selector, value) => {
    await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
    return evaluate(`{
    const el=document.querySelector(${JSON.stringify(selector)});
    const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:el instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement?'change':'input',{bubbles:true}));
  }`);
  };
  const captures = join(process.cwd(), 'captures', 'ai-story-creation-ui');
  const capture = async name => {
    await mkdir(captures, {recursive:true});
    await writeFile(join(captures,name+'.png'),(await win.webContents.capturePage()).toPNG());
  };
  try {
    await win.loadURL(process.env.GOLD_WORK_SMOKE_URL ?? 'http://127.0.0.1:5173/');
    await waitFor('Boolean(document.querySelector(".channels-heading"))');
    await evaluate(`{
      if (window.goldWork) throw new Error('Must not use real providers');
      const url=performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/fallback-api.ts')?.name;
      const {fallbackApi:api}=await import(url??'/src/fallback-api.ts');
      window.creationApi=api; window.creationCalls=[]; window.creationErrors=[]; window.pendingCreations={};
      window.addEventListener('unhandledrejection', e=>creationErrors.push(String(e.reason)));
      api.applyChatTopicToProject=async(id,topic)=>{
        creationCalls.push({id,topic});
        await new Promise((resolve,reject)=>{pendingCreations[id]={resolve,reject};window.finishCreation=resolve;window.failCreation=reject;});
        delete pendingCreations[id];
        const project=await api.getProject(id);
        return api.updateProject(id,{status:'ready',scenes:window.creationScenes,
          referenceAnalysis:{provider:'anymodel:qa',language:'Русский',sourceUrl:'chat://'+topic,sourceTitle:project.title,niche:'QA',targetAudience:'QA',
            hook:'QA',structure:[],strengths:[],improvements:[],suggestedAngle:'QA',suggestedTitle:project.title,
            scenes:window.creationScenes,scenarioQuality:window.creationQuality}});
      };
      api.prepareStoryCharacters=async id=>{
        const p=await api.getProject(id);
        const cast=['Анна','Борис','Вера','Глеб','Дина','Егор'].map((name,i)=>({id:'cast-'+i,name,aliases:[],prompt:'Stable face '+i,
          stylePrompt:p.settings.image.style,imagePath:'/styles/watercolor.jpg',status:'ready'}));
        return api.updateProject(id,{storyCharacters:cast,storyCharacterPlan:{fingerprint:'qa',status:'ready'},scenes:p.scenes.map(s=>({...s,characterIds:cast.map(c=>c.id)}))});
      };
      api.regenerateStoryCharacter=async(id,characterId,prompt)=>{
        const p=await api.getProject(id);
        return api.updateProject(id,{storyCharacters:p.storyCharacters.map(c=>c.id!==characterId?c:{...c,candidate:{imagePath:'/styles/anime.jpg',prompt,stylePrompt:p.settings.image.style,createdAt:'qa'}})});
      };
      api.confirmStoryCharacter=async(id,characterId)=>{
        const p=await api.getProject(id);
        return api.updateProject(id,{storyCharacters:p.storyCharacters.map(c=>c.id!==characterId?c:{...c,...c.candidate,candidate:undefined})});
      };
    }`);
    await click('.channels-heading .primary-button');
    await set('.channel-form input[placeholder^="Например"]','Простой AI Story');
    assert.equal(await evaluate('document.querySelector(".channel-direction-picker [aria-checked=true]").textContent.includes("AI Story")'),true);
    await click('.channel-dialog-footer .primary-button');
    await waitFor('document.querySelector(".channel-dialog-footer .primary-button")?.textContent==="Пропустить"');
    await capture('optional-master');
    await click('.channel-dialog-footer .primary-button');
    await click('.channel-dialog-footer .primary-button');
    await waitFor('Boolean(document.querySelector(".channel-workspace-heading"))');
    assert.equal(await evaluate('(await creationApi.listChannelProfiles()).find(c=>c.name==="Простой AI Story").masterPrompt'),'');

    const input='  Первая  фраза задаёт вопрос.\n\nВторая\u00a0завершает историю.  ';
    const scenes=[{id:'ready-1',order:0,title:'Первый кадр',narration:input,imagePrompt:'A traveller at home',stockQuery:'traveller',animationPrompt:'Slow push in',durationSeconds:5,status:'draft'}];
    const quality={version:1,checkedAt:new Date().toISOString(),targetSeconds:5,totalDurationSeconds:5,wordCount:8,sceneCount:1,
      fingerprint:scenarioQualityFingerprint(scenes),complete:true,endingResolved:true,repaired:false,requiredBeats:[]};
    await evaluate(`{window.creationScenes=${JSON.stringify(scenes)};window.creationQuality=${JSON.stringify(quality)};}`);
    await click('.channel-workspace-heading .primary-button');
    assert.equal(await evaluate('document.querySelector(".video-creation-modes button").getAttribute("aria-checked")'),'true');
    assert.equal(await evaluate('document.querySelectorAll(".video-creation-modes button").length'),2);
    await set('.video-dialog input[placeholder="Рабочее название ролика"]','Готовый текст');
    await set('.video-dialog textarea',input);
    await click('.new-video-style > summary');
    await waitFor('document.querySelectorAll(".new-video-style .visual-style-options img").length===10');
    await waitFor('[...document.querySelectorAll(".new-video-style .visual-style-options img")].every(image=>image.complete && image.naturalWidth>0)','style pictures loaded');
    await capture('style-gallery');
    await click('.new-video-style > summary');
    // Each input mode keeps its own draft when switching back and forth.
    await click('.video-creation-modes button:nth-child(2)');
    await set('.video-dialog textarea','Отдельный промпт');
    await click('.video-creation-modes button:first-child');
    assert.equal(await evaluate('document.querySelector(".video-dialog textarea").value'),input);
    assert.equal(await evaluate('document.querySelector(".video-dialog .primary-button").disabled'),true);
    const voice=await evaluate('document.querySelector(".video-voice-controls option[value^=edge]").value');
    await set('.video-voice-controls select',voice);
    await click('.video-voice-controls .outline-button');
    await waitFor('Boolean(document.querySelector(".voice-calibration-stats"))');
    assert.ok(await evaluate('document.querySelector(".video-duration-estimate").textContent.includes("Примерная длина ролика")'));
    await capture('ready-input');
    await click('.video-dialog .primary-button');
    await waitFor('creationCalls.length===1 && Boolean(document.querySelector(".ai-story-preparation [role=progressbar]"))');
    assert.equal(await evaluate('Boolean(document.querySelector(".section-host .chat-composer"))'),false,'No mandatory chat');
    assert.equal(await evaluate('document.querySelector("[data-flow-step=settings]").disabled'),true);
    await capture('preparing');
    await click('[data-nav-key=channels]');
    await waitFor('Boolean(document.querySelector(".active-video-dock"))');
    await click('.active-video-dock .icon-button');
    assert.ok(await evaluate('!document.querySelector(".active-video-dock") && localStorage.getItem("gws-video-dock-hidden")==="true"'));
    await click('.restore-video-dock');
    assert.ok(await evaluate('Boolean(document.querySelector(".active-video-dock")) && localStorage.getItem("gws-video-dock-hidden")==="false"'));
    await click('.active-video-return');
    await waitFor('Boolean(document.querySelector(".ai-story-preparation [role=progressbar]"))');
    await click('[data-nav-key=settings]');
    await evaluate('finishCreation()');
    await waitFor('!document.querySelector(".ai-story-preparation [role=progressbar]") && (await creationApi.listProjects()).some(p=>p.storyCharacters?.length===6)');
    assert.equal(await evaluate('Boolean(document.querySelector(".full-scenario-document"))'),false,'Finishing in background must not pull the user away from Settings');
    await click('.active-video-return');
    await waitFor('Boolean(document.querySelector(".full-scenario-document"))');
    await waitFor('document.querySelectorAll("[data-story-character]").length===6');
    await capture('six-characters');
    await click('.story-cast-details > summary');
    await set('[data-story-character="cast-0"] textarea','Round glasses, green coat, same face');
    await click('[data-story-character="cast-0"] > .outline-button');
    await waitFor('Boolean(document.querySelector(".story-character-candidate"))');
    assert.equal(await evaluate('(await creationApi.listProjects()).find(p=>p.title==="Готовый текст").storyCharacters[0].imagePath'),'/styles/watercolor.jpg');
    await click('.story-character-candidate .generate-button');
    await waitFor('!document.querySelector(".story-character-candidate")');
    assert.equal(await evaluate('(await creationApi.listProjects()).find(p=>p.title==="Готовый текст").storyCharacters[0].prompt'),'Round glasses, green coat, same face');
    await click('.story-cast-details > summary');
    const saved=await evaluate('(await creationApi.listProjects()).find(p=>p.title==="Готовый текст")');
    assert.equal(saved.videoBrief.readyScript,input);
    assert.equal(saved.scenes.map(s=>s.narration).join(''),input);
    assert.equal(await evaluate('document.querySelector(".sticky-actions .generate-button").textContent.trim()'),'Далее — настройки');
    assert.equal(await evaluate('document.querySelectorAll(".sticky-actions button").length'),1);
    for (const width of [1280,1100]) {
      win.setSize(width,920);
      await new Promise(resolve=>setTimeout(resolve,100));
      assert.ok(await evaluate('document.querySelector(".sticky-actions .generate-button").getBoundingClientRect().right <= innerWidth'), 'Next button must stay in the viewport');
      await capture(`review-${width}`);
    }
    await click('.sticky-actions .generate-button');
    await waitFor('document.querySelectorAll("[data-settings-card]").length===4');
    win.setSize(1920,1080);
    await waitFor('innerWidth===1920');
    await capture('settings-wide');
    const settingsBounds = await evaluate('(()=>{const r=document.querySelector("[data-flow-step=settings]").closest(".project-workflow").getBoundingClientRect();return {x:r.x,width:r.width}})()');
    await set('[data-settings-card="assembly"] select','cycle');
    assert.equal(await evaluate('document.querySelector(".sticky-actions .generate-button").textContent.trim()'),'Начать генерацию');
    await click('.sticky-actions .generate-button');
    await waitFor('document.querySelector("[data-flow-step=production]")?.getAttribute("aria-current")==="step"');
    assert.equal(await evaluate('(await creationApi.listProjects()).find(p=>p.title==="Готовый текст").settings.assembly.kenBurnsDirection'),'cycle');
    await click('[data-flow-step=materials]');
    await waitFor('Boolean(document.querySelector(".scenario-materials-page"))');
    assert.equal(await evaluate('document.querySelectorAll(".scenario-materials-page .story-cast-strip img").length'),6,'Materials must show the same six saved portraits');
    await waitFor('[...document.querySelectorAll(".scenario-materials-page .story-cast-strip img")].every(image=>image.complete && image.naturalWidth>0)');
    await capture('materials-cast');
    assert.equal(await evaluate('document.querySelector("[data-flow-step=production]").disabled'),false);
    await click('[data-flow-step=settings]');
    await click('[data-flow-step=brief]');
    const briefBounds = await evaluate('(()=>{const r=document.querySelector("[data-flow-step=brief]").closest(".project-workflow").getBoundingClientRect();return {x:r.x,width:r.width}})()');
    assert.ok(Math.abs(settingsBounds.x-briefBounds.x)<2 && Math.abs(settingsBounds.width-briefBounds.width)<2,'Brief and settings share the same workflow width');
    await click('[data-flow-step=production]');

    // Sidebar entry uses the same creation form. Failed preparation retries the existing project.
    await click('[data-nav-key=director]');
    await waitFor('Boolean(document.querySelector(".video-dialog"))');
    await click('.video-creation-modes button:nth-child(2)');
    await set('.video-dialog input[placeholder="Рабочее название ролика"]','По промпту');
    await set('.video-dialog textarea','Напиши короткую историю о путешественнике.');
    await set('.video-voice-controls select',voice);
    await click('.video-voice-controls .outline-button');
    await waitFor('Boolean(document.querySelector(".voice-calibration-stats"))');
    await click('.video-dialog .primary-button');
    await waitFor('creationCalls.length===2');
    await evaluate('failCreation(new Error("Тест: сервис временно недоступен"))');
    await waitFor('Boolean(document.querySelector(".ai-preparation-recovery [role=alert]"))');
    const failed=await evaluate('(await creationApi.listProjects()).find(p=>p.title==="По промпту")');
    assert.equal(failed.videoBrief.creationMode,'prompt');
    await capture('recoverable-error');
    await click('.ai-preparation-recovery .generate-button');
    await waitFor('creationCalls.length===3');
    assert.equal(await evaluate('creationCalls[2].id'),failed.id);
    await evaluate('finishCreation()');
    await waitFor('Boolean(document.querySelector(".full-scenario-document"))');
    assert.equal(await evaluate('(await creationApi.listProjects()).filter(p=>p.title==="По промпту").length'),1);
    // Start a second independent preparation while the first one is still waiting.
    const parallelIds=[];
    for (const title of ['Параллельный A','Параллельный B']) {
      await click('[data-nav-key=director]');
      await waitFor('Boolean(document.querySelector(".video-dialog"))');
      await set('.video-dialog input[placeholder="Рабочее название ролика"]',title);
      await set('.video-dialog textarea',input);
      await set('.video-voice-controls select',voice);
      await click('.video-voice-controls .outline-button');
      await waitFor('Boolean(document.querySelector(".voice-calibration-stats"))');
      await click('.video-dialog .primary-button');
      await waitFor('Boolean(document.querySelector(".ai-story-preparation [role=progressbar]"))');
      parallelIds.push(await evaluate('creationCalls.at(-1).id'));
    }
    assert.notEqual(parallelIds[0],parallelIds[1]);
    assert.equal(await evaluate('Object.keys(pendingCreations).length'),2,'Two different projects must prepare concurrently');
    await evaluate(`pendingCreations[${JSON.stringify(parallelIds[0])}].resolve()`);
    await waitFor(`(await creationApi.getProject(${JSON.stringify(parallelIds[0])})).storyCharacters?.length===6`);
    assert.equal(await evaluate('Boolean(document.querySelector(".ai-story-preparation [role=progressbar]"))'),true,'Completion of A must not hide B progress');
    assert.ok(await evaluate('document.querySelector(".ai-story-preparation").textContent.includes("Параллельный B")'));
    await capture('parallel-preparation');
    await evaluate(`pendingCreations[${JSON.stringify(parallelIds[1])}].resolve()`);
    await waitFor('Boolean(document.querySelector(".full-scenario-document"))');
    for (const id of parallelIds) assert.equal(await evaluate(`(await creationApi.getProject(${JSON.stringify(id)})).videoBrief.readyScript`),input);
    assert.deepEqual(await evaluate('creationErrors'),[]);
    await checkAnalyticsUi({ evaluate, click, set, waitFor, capture, win });
    console.log('[ai-story-creation-ui] PASS: parallel preparations, scripts, portraits, motion, retries; analytics CRUD/groups/charts/API error; persistent dock hide/restore; MOCK providers.');
    win.destroy(); app.exit(0);
  } catch (error) {
    await capture('failure');
    console.error(error); win.destroy(); app.exit(1);
  }
}
