import assert from "node:assert/strict";
import electron from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { scenarioQualityFingerprint } from "@gold-work/shared";

// An isolated renderer, real React/CSS, in-memory provider fixtures. No user projects or paid API calls.
const { app, BrowserWindow } = electron;
const targetUrl = process.env.GOLD_WORK_SMOKE_URL ?? "http://127.0.0.1:5173/";
const captures = join(process.cwd(), "captures", "ai-story-ui");
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(run).catch(error => { console.error(error); app.exit(1); });
async function run() {
const window = new BrowserWindow({ width: 1440, height: 1000, show: false, webPreferences: {
  contextIsolation: true, sandbox: true, offscreen: true, backgroundThrottling: false,
  partition: `ai-story-smoke-${Date.now()}`,
} });
const evaluate = async (source) => {
  const result = await window.webContents.executeJavaScript(`(async()=>{try{return await (${source})}catch(error){return {__smokeError:String(error.stack??error)}}})()`, true);
  if (result?.__smokeError) throw new Error(result.__smokeError);
  return result;
};
const waitFor = async (source, label) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate(source)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${label}`);
};
const click = async (selector) => {
  await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`, selector);
  const point = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (element.disabled) throw new Error('Disabled button: ' + ${JSON.stringify(selector)});
    element.scrollIntoView({block:'center'});
    const r = element.getBoundingClientRect();
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    if (!element.contains(document.elementFromPoint(x, y))) throw new Error('Button is obscured: ' + ${JSON.stringify(selector)});
    return {x:Math.round(x), y:Math.round(y)};
  })()`);
  // Real hit-tested input, not element.click(): catches overlays and misplaced controls.
  window.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...point });
  window.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...point });
};

try {
  await window.loadURL(targetUrl);
  await waitFor('Boolean(document.querySelector("[data-nav-key=projects]"))', "app");
  await evaluate(`(async () => {
    if (window.goldWork) throw new Error('Smoke must not access real desktop providers');
    const loadedModule = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/fallback-api.ts');
    const {fallbackApi:api} = await import(loadedModule?.name ?? '/src/fallback-api.ts');
    window.aiStorySmokeApi = api;
    const demoApply = api.applyChatTopicToProject;
    api.applyChatTopicToProject = async (id, ...args) => {
      const before = await api.getProject(id);
      await demoApply(id, ...args);
      // Demo analysis uses a canned title; keep stable fixture identity through the new automatic step.
      return api.updateProject(id, { title: before.title });
    };
    const channel = await api.createChannelProfile({name:'AI Story input acceptance',countryCode:'RU',languageCode:'ru',languageLabel:'Русский',
      direction:'ai-story',defaultMediaMode:'ai',masterPrompt:'Watercolor stories with a recurring traveller.',
      defaultImageStyle:'Original channel style',
      defaultDurationMinutes:1,lumeanTemplateUuid:'qa-voice',lumeanTemplateName:'QA voice'});
    const project = await api.createProject({title:'AI Story UI acceptance', topic:'A traveller finds his way home.',
      language:'Русский', aspectRatio:'16:9', mode:'standard', mediaMode:'ai', channelProfileId:channel.id});
    project.settings.voice.enabled = ${process.argv.includes('--providers-only')};
    project.settings.video.enabled = true;
    project.settings.video.provider = 'flow';
    project.settings.video.selectionMode = 'manual';
    const scenes = Array.from({length:4}, (_, order) => ({id:'ai-ui-'+order, order,
      title:'Кадр '+(order+1), narration:'Путник возвращается домой.', imagePrompt:'Watercolor traveller on a forest path',
      animationPrompt:'Gentle camera move', durationSeconds:5, status:'ready',
      imagePath:order === 2 ? undefined : '/styles/watercolor.jpg', includeInAssembly:order !== 3,
      videoPath:order === 1 || order === 3 ? '/fixture-video.mp4' : undefined,
      videoFallback:order === 3 ? 'static-image' : undefined}));
    window.aiStorySmokeProjectId = project.id;
    await api.updateProject(project.id, {settings:project.settings, scenes});
  })()`);
  await click('[data-nav-key="projects"]');
  await click('.projects-table-row');
  await waitFor('[...document.querySelectorAll(".project-expand button")].some(b=>b.textContent.includes("Настроить"))', 'expanded project');
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('.project-expand button')].find(b => b.textContent.includes('Настроить'));
    if (!button) throw new Error('Project settings button missing');
    button.click();
  })()`);
  if(process.argv.includes('--providers-only')){
    await waitFor('Boolean(document.querySelector(".ai-story-settings"))','AI Story provider controls');
    const controls=await evaluate(`([...document.querySelectorAll('.ai-settings-field')].filter(el=>['Сервис озвучки','Генератор изображений','Сервис видео'].includes(el.querySelector('span')?.textContent)).map(el=>({label:el.querySelector('span').textContent,values:[...el.querySelectorAll('option:not(:disabled)')].map(o=>o.value)})))`);
    assert.equal(controls.length,3);
    for(const control of controls)assert.deepEqual(control.values,control.label==='Сервис озвучки'?['elevenlabs']:['flow']);
    await mkdir(captures,{recursive:true});
    await writeFile(join(captures,'providers-only.json'),JSON.stringify({controls,paidRequests:0}));
    await writeFile(join(captures,'providers-only.png'),(await window.webContents.capturePage()).toPNG());
    console.log('[ai-story-ui-smoke] PASS: Flow images/video and Lumean voice are the only selectable services');
    return;
  }
  await click('[data-flow-step="materials"]');
  await waitFor('document.querySelectorAll(".scenario-material-card").length === 4', "materials");
  assert.equal(await evaluate('document.querySelectorAll(".scenario-material-card video").length'),0,'Video decoders stay unloaded until preview is requested');
  await click('.scenario-video-preview');
  await waitFor('document.querySelectorAll(".scenario-material-card video[controls]").length===1','requested video preview');
  assert.equal(await evaluate('document.querySelectorAll(".scenario-material-card video[controls]").length'), 1,
    'Generated AI video must be playable; static fallback must retain its image preview');
  assert.ok(await evaluate('[...document.querySelectorAll(".scenario-material-video-ready")].some(el => el.textContent.includes("Без анимации"))'),
    'Static fallback must not claim that Veo succeeded');
  for (const width of [1440, 1000]) {
    window.setSize(width, 1000);
    await new Promise(resolve => setTimeout(resolve, 100));
    const layout = await evaluate(`(() => [...document.querySelectorAll('.scenario-material-veo-select')].map(button => {
      const box = button.getBoundingClientRect(), parent = button.closest('.scenario-material-image').getBoundingClientRect();
      return {inside:box.left >= parent.left && box.right <= parent.right && box.top >= parent.top && box.bottom <= parent.bottom};
    }))()`);
    assert.ok(layout.length >= 2 && layout.every(x => x.inside), `Veo selection escaped its own image at width ${width}`);
  }
  await click('.scenario-material-veo-select');
  await waitFor('document.querySelector(".scenario-material-veo-select")?.getAttribute("aria-pressed") === "true"', "selected first frame");
  await click('.scenario-material-veo-select');
  await waitFor('document.querySelector(".scenario-material-veo-select")?.getAttribute("aria-pressed") === "false"', "unselected first frame");
  await mkdir(captures, {recursive:true});
  await writeFile(join(captures, 'materials.png'), (await window.webContents.capturePage()).toPNG());
  assert.equal(await evaluate('document.querySelectorAll(".scenario-material-veo-select:not(:disabled)").length'), 2,
    'Missing/excluded frames must not offer Veo selection');
  await click('.scenario-material-veo-select');
  await evaluate(`(() => {
    window.aiStoryUnhandled = [];
    window.addEventListener('unhandledrejection', event => aiStoryUnhandled.push(String(event.reason)));
    const api = aiStorySmokeApi;
    const original = api.updateProject;
    api.updateProject = async (...args) => { api.updateProject = original; throw new Error('Test disk failure'); };
  })()`);
  await click('.veo-selection-actions .generate-button');
  await waitFor('Boolean(document.querySelector(".veo-selection-error"))', "inline error after saving failed");
  assert.equal(await evaluate('document.querySelector(".scenario-material-veo-select")?.getAttribute("aria-pressed")'), 'true');
  assert.deepEqual(await evaluate('aiStoryUnhandled'), [], 'Failed save must not leave an unhandled promise');
  await click('.veo-selection-actions .generate-button');
  await waitFor('document.querySelector("[data-flow-step=production]")?.getAttribute("aria-current") === "step"', "production after Veo");
  const generated = await evaluate(`(async () => {
    const tasks = await aiStorySmokeApi.getQueue();
    const project = await aiStorySmokeApi.getProject(aiStorySmokeProjectId);
    return {ids:tasks.filter(t => t.kind === 'video').map(t => t.sceneId),
      images:project.scenes.map(s => s.imagePath), manual:project.settings.video.selectionMode};
  })()`);
  assert.deepEqual(generated.ids, ['ai-ui-0'], 'Only the selected scene may be animated');
  assert.equal(generated.manual, 'manual');
  assert.equal(generated.images[0], '/styles/watercolor.jpg', 'Veo must retain its source image');
  await evaluate(`(async () => {
    const api = aiStorySmokeApi;
    await api.stopGeneration(aiStorySmokeProjectId);
    const project = await api.getProject(aiStorySmokeProjectId);
    project.settings.voice.enabled = false;
    project.settings.video.enabled = false;
    project.settings.image.style = 'Watercolor ink illustration, flat 2D';
    project.settings.image.references = ['/old-hero.png','/styles/watercolor.jpg'];
    project.characterReference = {name:'Old hero',prompt:'gray coat',imagePath:'/old-hero.png',updatedAt:'old'};
    Object.assign(project.settings.assembly, {fadeTransitions:true,transitionType:'mix',transitionDurationSeconds:0.35,kenBurns:true,kenBurnsDirection:'smart'});
    await api.updateProject(project.id, {status:'ready',outputPath:undefined,settings:project.settings, characterReference:project.characterReference, scenes:[0,1].map(order=>({
      ...project.scenes[order], order, videoPath:undefined, videoFallback:undefined,
      durationSeconds:order===0?5:5.2, imagePath:'/styles/watercolor.jpg', audioPath:'/fixture-audio.wav',
      imagePrompt:'Adult cartoon host, medium shot',autoKenBurnsDirection:order===0?'pan-left':'pan-right',autoKenBurnsZoom:1.12,
      trimStartSeconds:2, playbackRate:2, narrationVolume:100,
      narrationSlice:{sourceSceneId:'ai-ui-0', startSeconds:0.5+order*5, endSeconds:5.5+order*5,last:order===1}
    }))});
  })()`);
  await click('[data-nav-key="projects"]');
  await click('.projects-table-row');
  await waitFor('[...document.querySelectorAll(".project-expand button")].some(b=>b.textContent.includes("Настроить"))', 'expanded measured project');
  await evaluate(`(() => {
    const button=[...document.querySelectorAll('.project-expand button')].find(b=>b.textContent.includes('Настроить'));
    if(!button) throw new Error('Project open action missing');
    button.click();
  })()`);
  await waitFor('document.querySelector("[data-flow-step=settings]")?.getAttribute("aria-current")==="step"','settings before remote completion');
  // Deterministically reproduce a backend update arriving while Settings is
  // open: no user edit may be invented from the old voice-disabled snapshot.
  await evaluate(`(async()=>{
    const project=await aiStorySmokeApi.getProject(aiStorySmokeProjectId);
    project.settings.voice.enabled=true;
    await aiStorySmokeApi.updateProject(project.id,{settings:project.settings,status:'complete',outputPath:'/fixture-final.mp4'});
  })()`);
  await waitFor('document.querySelector("[data-flow-step=export]")?.disabled===false','remote completion reaches Settings');
  await click('[data-flow-step="editor"]');
  await waitFor('document.querySelectorAll(".timeline-clip").length === 2', 'measured editor');
  await waitFor('Boolean(document.querySelector(".timeline-live-preview audio[data-timeline-media]"))','measured editor audio ready');
  const firstAudio = await evaluate(`(() => {
    const a=document.querySelector('.timeline-live-preview audio[data-timeline-media]');
    return a ? {time:Number(a.dataset.timelineTime),rate:Number(a.dataset.timelineRate),volume:Number(a.dataset.timelineVolume)} : null;
  })()`);
  assert.deepEqual(firstAudio,{time:0.5,rate:1,volume:1},'Visual trim/speed must not alter narration');
  const portraitMotion=await evaluate(`(()=>{
    const layer=document.querySelector('.timeline-live-layer[data-scene-id="ai-ui-0"]');
    const style=getComputedStyle(layer),matrix=new DOMMatrixReadOnly(style.transform);
    return {origin:style.transformOrigin,zoom:matrix.a,x:matrix.e,y:matrix.f,width:layer.offsetWidth};
  })()`);
  assert.equal(portraitMotion.origin,'0px 0px','Portrait motion uses the shared top-anchored crop');
  assert.ok(Math.abs(portraitMotion.zoom-1.12)<0.001);
  assert.ok(Math.abs(portraitMotion.x+portraitMotion.width*0.12)<0.1,'Preview pans across the same crop room as FFmpeg');
  assert.ok(Math.abs(portraitMotion.y)<0.001,'Preview does not cut portrait headroom vertically');
  const ruler = await evaluate(`(() => {
    const r=document.querySelector('.timeline-ruler-new').getBoundingClientRect();
    return {x:Math.round(r.x+r.width*5.1/10.2),y:Math.round(r.y+r.height/2)};
  })()`);
  window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...ruler});
  window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...ruler});
  await waitFor('document.querySelectorAll(".timeline-live-preview audio[data-timeline-media]").length===2','audio at the dissolve');
  const boundaryAudio = await evaluate(`[...document.querySelectorAll('.timeline-live-preview audio[data-timeline-media]')].map(a=>({time:Number(a.dataset.timelineTime),rate:Number(a.dataset.timelineRate),volume:Number(a.dataset.timelineVolume)}))`);
  assert.equal(boundaryAudio[0].volume,0,'Outgoing technical overlap must contain no repeated narration');
  assert.equal(boundaryAudio[1].rate,1);
  assert.equal(boundaryAudio[1].volume,1,'Incoming narration must not fade with the image');
  assert.ok(Math.abs(boundaryAudio[1].time-5.6)<0.03,'Short-timeline seeking and audio range must agree');
  // The workflow tabs and the modal's own view switch must share one mode.
  // In-memory media only: actual playable export is covered by the portable smoke.
  if(await evaluate('Boolean(document.querySelector(".notice-toast button"))')) await click('.notice-toast button');
  await click('.timeline-studio [data-flow-step="export"]');
  await waitFor('Boolean(document.querySelector(".preview-modal"))','editor to export workflow');
  // Stress only the gallery layout with several rows; these clones have no
  // event handlers and disappear when this modal view unmounts.
  await evaluate(`(()=>{const gallery=document.querySelector('.scene-gallery');
    for(let index=0;index<6;index++)gallery.append(gallery.firstElementChild.cloneNode(true));})()`);
  for(const width of [1440,1000]) {
    window.setSize(width,1000);
    await new Promise(resolve=>setTimeout(resolve,100));
    const exportLayout=await evaluate(`(()=>{
      const player=document.querySelector('.preview-player').getBoundingClientRect();
      const gallery=document.querySelector('.scene-gallery').getBoundingClientRect();
      const image=document.querySelector('.preview-scene > .scene-thumb').getBoundingClientRect();
      const caption=document.querySelector('.preview-scene > div:last-child').getBoundingClientRect();
      const card=document.querySelector('.preview-scene').getBoundingClientRect();
      const video=document.querySelector('.preview-player video').getBoundingClientRect();
      const footer=document.querySelector('.preview-modal > footer').getBoundingClientRect();
      return {playerBottom:player.bottom,galleryTop:gallery.top,galleryBottom:gallery.bottom,
        imageBottom:image.bottom,captionTop:caption.top,captionBottom:caption.bottom,cardBottom:card.bottom,
        videoBottom:video.bottom,footerTop:footer.top};
    })()`);
    assert.ok(exportLayout.playerBottom<=exportLayout.galleryTop+1,`Export gallery overlaps player at ${width}px`);
    assert.ok(exportLayout.imageBottom<=exportLayout.captionTop+1,'Thumbnail must not overlap its caption');
    assert.ok(exportLayout.videoBottom<=exportLayout.galleryTop+1,'Gallery must not overlap decoded video bounds');
    assert.ok(exportLayout.captionBottom<=exportLayout.cardBottom+1,'Gallery rows must not clip scene captions');
    assert.ok(exportLayout.galleryBottom<=exportLayout.footerTop+1,'Gallery must not overlap export actions');
  }
  await click('.preview-modal [data-flow-step="editor"]');
  await waitFor('Boolean(document.querySelector(".timeline-studio"))','export to editor workflow');
  await click('.timeline-scenes-button');
  await waitFor('Boolean(document.querySelector(".preview-modal"))','editor show scenes');
  await evaluate(`[...document.querySelectorAll('.preview-modal header button')].find(button=>button.textContent.includes('Таймлайн')).dataset.qaTimeline='true'`);
  await click('[data-qa-timeline]');
  await waitFor('Boolean(document.querySelector(".timeline-studio"))','preview internal timeline action');
  await click('.timeline-studio [data-flow-step="export"]');
  await waitFor('Boolean(document.querySelector(".preview-modal"))','internal timeline to export workflow');
  await click('.preview-modal [data-flow-step="editor"]');
  await waitFor('Boolean(document.querySelector(".timeline-studio"))','return to editor');
  await evaluate(`(() => {
    window.aiHeroCalls = []; window.aiHeroConfirms = 0;
    const api = aiStorySmokeApi;
    api.createCharacterReference = async (projectId,input) => {
      aiHeroCalls.push(input);
      const project=await api.getProject(projectId);
      return {project,character:{name:'New hero',prompt:'white head, gray coat, red scarf',characterPrompt:input.characterPrompt,
        imagePath:'/new-hero.png',updatedAt:'new',versionId:'hero-version-new',channelProfileId:project.channelProfileId,createdAt:'new'}};
    };
    api.confirmChannelCharacterReference = async (projectId,versionId) => {
      aiHeroConfirms++;
      const project=await api.getProject(projectId);
      const character={name:'New hero',prompt:'white head, gray coat, red scarf',imagePath:'/new-hero.png',updatedAt:'new',versionId,channelProfileId:project.channelProfileId,createdAt:'new'};
      project.settings.image.references=['/new-hero.png','/styles/watercolor.jpg'];
      return {project:await api.updateProject(projectId,{characterReference:character,settings:project.settings}),character};
    };
  })()`);
  await click('.timeline-studio [data-flow-step="scenario"]');
  await waitFor('Boolean(document.querySelector(".scenario-hero-ready"))','existing hero');
  await evaluate(`[...document.querySelectorAll('.scenario-hero-ready button')].find(b=>b.textContent.includes('Создать заново')).dataset.aiHeroCreate='true'`);
  await click('[data-ai-hero-create]');
  await waitFor('Boolean(document.querySelector(".character-reference-modal textarea"))','candidate hero preview');
  assert.equal(await evaluate('(async()=> (await aiStorySmokeApi.getProject(aiStorySmokeProjectId)).characterReference.name)()'),'Old hero');
  assert.equal(await evaluate('aiHeroCalls[0].stylePrompt'),'Watercolor ink illustration, flat 2D');
  await evaluate(`(() => {
    const textarea=document.querySelector('.character-reference-modal textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(textarea,'Gray coat and a red scarf; same white round head');
    textarea.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await click('.character-reference-modal footer .outline-button');
  await waitFor('aiHeroCalls.length===2 && !document.querySelector(".character-reference-modal footer .generate-button").disabled','hero regenerated');
  assert.ok(await evaluate('aiHeroCalls[1].characterPrompt.includes("red scarf")'));
  await click('.character-reference-modal .modal-close');
  await waitFor('!document.querySelector(".character-reference-modal")','candidate dismissed');
  assert.equal(await evaluate('(async()=> (await aiStorySmokeApi.getProject(aiStorySmokeProjectId)).characterReference.name)()'),'Old hero');
  await click('[data-ai-hero-create]');
  await waitFor('Boolean(document.querySelector(".character-reference-modal footer .generate-button"))','candidate reopened');
  await click('.character-reference-modal footer .generate-button');
  await waitFor('!document.querySelector(".character-reference-modal") && aiHeroConfirms===1','hero confirmed');
  assert.deepEqual(await evaluate('(async()=> (await aiStorySmokeApi.getProject(aiStorySmokeProjectId)).settings.image.references)()'),['/new-hero.png','/styles/watercolor.jpg']);
  await click('[data-nav-key="channels"]');
  await click('.channel-card');
  await waitFor('[...document.querySelectorAll("button")].some(b=>b.textContent.includes("Новый ролик"))', 'channel video action');
  await click('.channel-workspace-heading .outline-button:not(.danger-outline)');
  await waitFor('Boolean(document.querySelector("[data-channel-image-style]"))','channel style editor');
  assert.equal(await evaluate('document.querySelector("[data-channel-image-style]").value'),'Original channel style');
  await evaluate(`(() => {
    const field=document.querySelector('[data-channel-image-style]');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,'Watercolor ink illustration, flat 2D');
    field.dispatchEvent(new Event('input',{bubbles:true}));
    field.scrollIntoView({block:'center'});
  })()`);
  await writeFile(join(captures,'channel-style.png'),(await window.webContents.capturePage()).toPNG());
  // Existing library fixture, independent of the mocked hero-generation preview above.
  await evaluate(`(async()=>{
    const profile=(await aiStorySmokeApi.listChannelProfiles())[0];
    const hero={versionId:'library-hero',channelProfileId:profile.id,name:'Library hero',prompt:'Gray coat',
      imagePath:'/styles/watercolor.jpg',stylePrompt:'Colored pencil, flat 2D',createdAt:'now',updatedAt:'now'};
    await aiStorySmokeApi.updateChannelProfile(profile.id,{...profile,primaryCharacter:hero,characterVersions:[hero]});
  })()`);
  await click('.channel-dialog-footer .primary-button');
  await waitFor('!document.querySelector("[data-channel-image-style]")','channel style saved');
  await evaluate(`(() => {
    const button=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Новый ролик'));
    if(!button) throw new Error('New video action missing');
    button.dataset.aiNewVideo='true';
  })()`);
  await click('[data-ai-new-video]');
  await click('.video-creation-modes button:first-child');
  await evaluate(`(() => {
    window.aiStoryExactInput='  Первая  фраза задаёт вопрос.\\n\\nВторая содержит NBSP\\u00a0и завершает историю.  ';
    const set=(element,value)=>{
      const prototype=element instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype,'value').set.call(element,value);
      element.dispatchEvent(new Event('input',{bubbles:true}));
    };
    set(document.querySelector('.video-dialog input[placeholder="Рабочее название ролика"]'),'Exact script UI');
    set(document.querySelector('.video-dialog textarea'),aiStoryExactInput);
  })()`);
  assert.equal(await evaluate('document.querySelector(".video-dialog .channel-dialog-footer .primary-button").disabled'),true,
    'Creating a video must require calibration, not merely a selected voice');
  await click('.video-voice-controls .outline-button');
  await waitFor('Boolean(document.querySelector(".voice-calibration-stats"))','voice calibration');
  await waitFor('!document.querySelector(".video-dialog .channel-dialog-footer .primary-button").disabled','voice calibration finishes');
  await evaluate(`(() => {
    const api=aiStorySmokeApi, original=api.createProject;
    api.createProject=async(...args)=>{api.createProject=original;throw new Error('Test project disk failure');};
  })()`);
  await click('.video-dialog .channel-dialog-footer .primary-button');
  await waitFor('Boolean(document.querySelector(".video-create-error"))','visible creation failure');
  assert.equal(await evaluate('document.querySelector(".video-dialog textarea").value'),await evaluate('aiStoryExactInput'));
  assert.deepEqual(await evaluate('aiStoryUnhandled'),[],'Creation failure must not escape as an unhandled promise');
  await click('.video-dialog .channel-dialog-footer .primary-button');
  await waitFor('!document.querySelector(".video-dialog")','created video starts preparation');
  await waitFor('!document.querySelector(".ai-story-preparation [role=progressbar]")','ready-script preparation finishes');
  const readyInput=await evaluate(`(async()=>{
    const project=(await aiStorySmokeApi.listProjects()).find(p=>p.title==='Exact script UI');
    return {mode:project.videoBrief.creationMode,text:project.videoBrief.readyScript,
      calibration:!!project.settings.voice.calibration,channel:project.channelProfileId,mediaMode:project.mediaMode,
      style:project.settings.image.style,
      topic:!!project.chatTopicId};
  })()`);
  assert.equal(readyInput.text,await evaluate('aiStoryExactInput'),'The new-video form must preserve the complete pasted script');
  assert.equal(readyInput.mode,'script'); assert.equal(readyInput.mediaMode,'ai');
  assert.ok(readyInput.calibration && readyInput.channel && readyInput.topic);
  assert.equal(readyInput.style,'Colored pencil, flat 2D','Selecting the channel hero must inherit its own style');
  await click('[data-nav-key="channels"]');
  await waitFor('[...document.querySelectorAll("button")].some(b=>b.textContent.includes("Новый ролик"))', 'return to channel');
  await evaluate(`(() => {
    const button=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Новый ролик'));
    if(!button) throw new Error('New video action missing after returning to the channel');
    button.dataset.aiNewVideo='true';
  })()`);
  await click('[data-ai-new-video]');
  await waitFor('document.querySelectorAll(".video-creation-modes button").length === 2', 'new prompt dialog');
  assert.equal(await evaluate('document.querySelectorAll(".video-creation-modes button").length'),2);
  assert.equal(await evaluate('document.querySelector(".video-creation-modes button").getAttribute("aria-checked")'),'true');
  await click('.video-creation-modes button:nth-child(2)');
  await evaluate(`(() => {
    const set=(element,value)=>{
      const prototype=element instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype,'value').set.call(element,value);
      element.dispatchEvent(new Event('input',{bubbles:true}));
    };
    set(document.querySelector('.video-dialog input[placeholder="Рабочее название ролика"]'),'Prompt UI');
    set(document.querySelector('.video-dialog textarea'),'  История о путешественнике, который вернулся домой.  ');
  })()`);
  await click('.reuse-channel-character input');
  assert.equal(await evaluate('document.querySelector(".video-dialog .channel-dialog-footer .primary-button").disabled'),true,
    'A new prompt project also needs its own calibration');
  await click('.video-voice-controls .outline-button');
  await waitFor('Boolean(document.querySelector(".voice-calibration-stats"))','prompt voice calibration');
  await waitFor('!document.querySelector(".video-dialog .channel-dialog-footer .primary-button").disabled','prompt calibration finishes');
  await click('.video-dialog .channel-dialog-footer .primary-button');
  await waitFor('!document.querySelector(".video-dialog")','prompt starts preparation');
  await waitFor('!document.querySelector(".ai-story-preparation [role=progressbar]")','prompt preparation finishes');
  const promptInput=await evaluate(`(async()=>{
    const project=(await aiStorySmokeApi.listProjects()).find(p=>p.title==='Prompt UI');
    return {mode:project.videoBrief.creationMode,text:project.videoBrief.prompt,ready:project.videoBrief.readyScript??null,
      calibration:!!project.settings.voice.calibration,channel:project.channelProfileId,topic:!!project.chatTopicId};
  })()`);
  assert.equal(promptInput.mode,'prompt'); assert.equal(promptInput.ready,null);
  assert.equal(promptInput.text,'История о путешественнике, который вернулся домой.');
  assert.ok(promptInput.calibration && promptInput.channel===readyInput.channel && promptInput.topic);
  assert.equal(await evaluate('(async()=> (await aiStorySmokeApi.listProjects()).find(p=>p.title==="Prompt UI").settings.image.style)()'),'Watercolor ink illustration, flat 2D');
  const pendingScenes=await evaluate(`(async()=>{
    const api=aiStorySmokeApi;
    const project=(await api.listProjects()).find(p=>p.title==='Prompt UI');
    window.aiPendingProjectId=project.id;
    const scenes=Array.from({length:4},(_,order)=>({id:'pending-'+order,order,title:'Кадр '+order,narration:'Путник нашёл дорогу домой.',
      imagePrompt:'Watercolor traveller',animationPrompt:'Slow pan',durationSeconds:5,status:'draft'}));
    await api.updateProject(project.id,{scenes,status:'draft',referenceAnalysis:{sourceUrl:'qa://pending',sourceTitle:'Draft',niche:'Story',
      targetAudience:'Adults',hook:'Journey',structure:[],strengths:[],improvements:[],suggestedTitle:'Draft',suggestedAngle:'Journey',
      recommendedDurationSeconds:20,provider:'anymodel:mock',scenes}});
    window.aiResumeCalls=0;
    api.applyChatTopicToProject=async(id,topic)=>{
      if(id!==aiPendingProjectId)throw new Error('Wrong resume project');
      const current=await api.getProject(id);
      if(topic!==current.chatTopicId)throw new Error('Wrong topic on resume');
      aiResumeCalls++;
      await new Promise(resolve=>{window.aiResumeRelease=resolve;});
      return api.updateProject(id,{status:'ready',scenes:window.aiApprovedScenes,referenceAnalysis:{...current.referenceAnalysis,scenes:window.aiApprovedScenes,scenarioQuality:window.aiApprovedQuality}});
    };
    return scenes;
  })()`);
  const approvedScenes=pendingScenes.map((scene,index)=>({...scene,narration:'Исправленная история: путник вернулся домой. Кадр '+index}));
  await evaluate(`(window.aiApprovedScenes=${JSON.stringify(approvedScenes)})`);
  await evaluate(`(window.aiApprovedQuality=${JSON.stringify({version:1,checkedAt:new Date().toISOString(),targetSeconds:20,totalDurationSeconds:20,wordCount:20,sceneCount:4,fingerprint:scenarioQualityFingerprint(approvedScenes),complete:true,endingResolved:true,repaired:true,requiredBeats:[]})})`);
  await click('[data-nav-key="projects"]');
  await waitFor('[...document.querySelectorAll(".projects-table-row")].some(row=>row.textContent.includes("Prompt UI"))','pending project list update');
  await evaluate(`(()=>{
    const row=[...document.querySelectorAll('.projects-table-row')].find(row=>row.textContent.includes('Prompt UI'));
    if(!row)throw new Error('Pending project row missing');row.click();
  })()`);
  await waitFor('[...document.querySelectorAll(".project-expand button")].some(b=>b.textContent.includes("Настроить"))','pending project');
  await evaluate(`[...document.querySelectorAll('.project-expand button')].find(b=>b.textContent.includes('Настроить')).click()`);
  await waitFor('document.querySelector(".sticky-actions")?.textContent.includes("Черновик сохранён")','pending audit reaches settings after project polling');
  assert.equal(await evaluate('document.querySelector(".sticky-actions .generate-button").disabled'),true,'Pending audit must prevent production before queue invocation');
  assert.equal(await evaluate('document.querySelector("[data-flow-step=scenario]").closest("li").dataset.flowStatus'),'available','A full draft is not an approved scenario');
  await click('[data-flow-step="scenario"]');
  await waitFor('Boolean(document.querySelector(".scenario-review-notice"))','pending review notice');
  await mkdir(captures,{recursive:true});
  await writeFile(join(captures,'pending-review.png'),(await window.webContents.capturePage()).toPNG());
  await click('.scenario-review-notice .generate-button');
  await waitFor('aiResumeCalls===1 && document.querySelector(".scenario-review-notice .generate-button").disabled','visible resume busy state');
  assert.equal(await evaluate('(await aiStorySmokeApi.getProject(aiPendingProjectId)).scenes.length'),4,'Original draft survives while repair is pending');
  await evaluate('aiResumeRelease()');
  await waitFor('!document.querySelector(".scenario-review-notice")','fresh audit unlocks workflow');
  await waitFor('document.querySelector(".full-scenario-document")?.textContent.includes("Исправленная история")','same-ID repaired narration replaces old text in review');
  await click('[data-flow-step="settings"]');
  assert.equal(await evaluate('document.querySelector(".sticky-actions .generate-button").disabled'),false,'Only current successful audit unlocks generation');
  assert.equal(await evaluate('aiResumeCalls'),1);
  // The new project settings must be smaller without changing stored narration,
  // hiding required controls, or losing values when switching Veo off and back on.
  await waitFor('document.querySelectorAll("[data-settings-card]").length===4','compact AI settings');
  assert.equal(await evaluate('Boolean(document.querySelector(".chat-topic-source"))'),false,'Scenario authoring does not belong in project settings');
  assert.equal(await evaluate('document.querySelectorAll(".sticky-actions .generate-button").length'),1);
  assert.equal(await evaluate('document.querySelector(".sticky-actions .generate-button").textContent.trim()'),'Начать генерацию');
  await evaluate('(async()=>{window.aiSettingsBaseline=await aiStorySmokeApi.getProject(aiPendingProjectId)})()');
  const changeSelect = async (card, label, value) => {
    await evaluate(`(()=>{
      const field=[...document.querySelectorAll('[data-settings-card="${card}"] .ai-settings-field')].find(el=>el.querySelector('span')?.textContent===${JSON.stringify(label)});
      const select=field?.querySelector('select');if(!select)throw new Error('Missing setting: '+${JSON.stringify(label)});
      select.scrollIntoView({block:'center'});const r=select.getBoundingClientRect();
      if(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)!==select)throw new Error('Setting is not reachable');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,${JSON.stringify(value)});
      select.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
  };
  await changeSelect('assembly','Движение картинок','off');
  await changeSelect('assembly','Переход между кадрами','none');
  assert.equal(await evaluate('Boolean(document.querySelector("[data-settings-card=assembly] input[type=range]"))'),false);
  await changeSelect('assembly','Движение картинок','smart');
  await changeSelect('assembly','Переход между кадрами','fade');
  assert.equal(await evaluate('Boolean(document.querySelector("[data-settings-card=assembly] input[type=range]"))'),true);
  await changeSelect('assembly','Качество сборки','high');
  await changeSelect('assembly','Формат','9:16');
  await changeSelect('assembly','Формат','16:9');
  await click('[data-settings-card="images"] .ai-settings-more > summary');
  await click('[data-settings-card="images"] .visual-style-options button');
  await waitFor('Boolean(document.querySelector("[data-settings-card=images] .visual-style-options button.selected"))','style can be selected from the compact settings');
  const selectedSettingsStyle=await evaluate('document.querySelector("[data-settings-card=images] .visual-style-custom textarea").value');
  await click('[data-settings-card="images"] .ai-settings-more > summary');
  const voiceToggle='[data-settings-card="voice"] .ai-settings-switch input';
  await click(voiceToggle);
  await waitFor('!document.querySelector("[data-settings-card=voice] .ai-settings-value")','voice switches off');
  await click(voiceToggle);
  await waitFor('Boolean(document.querySelector("[data-settings-card=voice] .ai-settings-value"))','voice selection returns');
  const veoToggle='[data-settings-card="veo"] .ai-settings-switch input';
  if(!await evaluate(`document.querySelector('${veoToggle}').checked`))await click(veoToggle);
  await changeSelect('veo','Какие кадры оживлять','auto');
  await changeSelect('veo','Доля оживлённых кадров','30');
  await click(veoToggle);
  await waitFor('!document.querySelector("[data-settings-card=veo] select")','Veo switches off without losing settings');
  await click(veoToggle);
  await waitFor('Boolean(document.querySelector("[data-settings-card=veo] select"))','Veo switches back on');
  await changeSelect('veo','Какие кадры оживлять','manual');
  await click('.ai-story-settings > .ai-settings-more > summary');
  await click('.ai-settings-advanced-grid input[type=checkbox]');
  await click('.sticky-actions .outline-button');
  await waitFor('!document.querySelector(".sticky-actions .outline-button")','saved settings hide redundant Save');
  const savedSettings=await evaluate(`(async()=>{
    const project=await aiStorySmokeApi.getProject(aiPendingProjectId);
    return {motion:project.settings.assembly.kenBurnsDirection,transition:project.settings.assembly.transitionType,
      quality:project.settings.assembly.quality,mode:project.settings.video.selectionMode,percent:project.settings.video.animationPercent,
      style:project.settings.image.style,aspectRatio:project.aspectRatio,
      sequential:project.settings.image.sequential,narrationUnchanged:JSON.stringify(project.scenes)===JSON.stringify(aiSettingsBaseline.scenes),
      voiceUnchanged:JSON.stringify(project.settings.voice)===JSON.stringify(aiSettingsBaseline.settings.voice)};
  })()`);
  assert.deepEqual(savedSettings,{motion:'smart',transition:'fade',quality:'high',mode:'manual',percent:30,
    style:selectedSettingsStyle,aspectRatio:'16:9',
    sequential:!await evaluate('aiSettingsBaseline.settings.image.sequential'),narrationUnchanged:true,voiceUnchanged:true});
  await click('.ai-story-settings > .ai-settings-more > summary');
  // Production BrowserWindow minWidth is 1060; use its supported settings viewport.
  for(const width of [1440,1060]) {
    window.setSize(width,1000);
    await evaluate(`(()=>{document.querySelector('.ai-settings-overview').scrollIntoView({block:'start'});})()`);
    await new Promise(resolve=>setTimeout(resolve,120));
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false,'Settings must not overflow horizontally');
    await writeFile(join(captures,`project-settings-${width}.png`),(await window.webContents.capturePage()).toPNG());
    await click('.sticky-actions .generate-button');
    await waitFor('document.querySelector(".production-overview")?.parentElement.querySelector("[data-flow-step=production]")?.getAttribute("aria-current")==="step"','single generate action opens production');
    await evaluate('aiStorySmokeApi.stopGeneration(aiPendingProjectId)');
    await evaluate('document.querySelector(".production-overview").parentElement.querySelector("[data-flow-step=settings]").dataset.qaReturnSettings="true"');
    await click('[data-qa-return-settings="true"]');
    await waitFor('Boolean(document.querySelector(".ai-story-settings"))','return to compact settings');
  }
  console.log('[ai-story-ui-smoke] PASS: compact project settings, reachable controls, saved motion/transitions/Veo, unchanged voice/scenes, responsive layout, one working generation action');
  console.log('[ai-story-ui-smoke] PASS: pending audit warning, production disabled, explicit resume with busy state, original draft retained, approval unlocks generation');
  console.log('[ai-story-ui-smoke] PASS: layout, hit testing, toggle, exclusions, selected-only Veo, production navigation, retained image (mock providers)');
  console.log('[ai-story-ui-smoke] PASS: both input modes, mandatory calibration, visible save failure, exact ready input and automatic preparation (mock providers)');
  console.log('[ai-story-ui-smoke] PASS: measured audio ranges, unchanged voice speed, dissolve without overlapping speech, short-timeline seeking');
  console.log('[ai-story-ui-smoke] PASS: bidirectional editor/export workflow navigation and internal view switches');
  console.log('[ai-story-ui-smoke] PASS: backend voice update in open Settings survives navigation without stale auto-save');
  console.log('[ai-story-ui-smoke] PASS: hero style/prompt editing, dismissing a candidate, explicit confirmation without old portrait references');
  console.log('[ai-story-ui-smoke] PASS: channel style editing and inheritance in both new-video input modes');
  console.log('[ai-story-ui-smoke] PASS: portrait headroom and preview pan coordinates match shared FFmpeg motion');
} catch (error) {
  await mkdir(captures, {recursive:true});
  await writeFile(join(captures,'failure-dom.json'),JSON.stringify(await evaluate(`({
    stages:[...document.querySelectorAll('[data-flow-step]')].map(el=>({stage:el.dataset.flowStep,current:el.getAttribute('aria-current'),disabled:el.disabled,visible:el.checkVisibility()})),
    page:document.querySelector('h1')?.textContent,production:!!document.querySelector('.production-overview'),
    width:innerWidth,scrollWidth:document.documentElement.scrollWidth
  })`),null,2));
  await writeFile(join(captures, 'failure.png'), (await window.webContents.capturePage()).toPNG());
  console.error(error);
  process.exitCode = 1;
} finally {
  window.destroy();
  app.exit(process.exitCode ?? 0);
}
}
