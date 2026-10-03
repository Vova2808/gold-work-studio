import assert from 'node:assert/strict';
import electron from 'electron';
import {mkdir, writeFile, mkdtemp, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';

// Isolated actual React/Chromium, local media, in-memory services; no user data or paid API.
const {app, BrowserWindow} = electron;
app.whenReady().then(run).catch(error => { console.error(error); app.exit(1); });
async function run() {
  const win = new BrowserWindow({width:1440,height:1000,show:false,webPreferences:{
    sandbox:true,contextIsolation:true,backgroundThrottling:false,partition:`editor-ready-${Date.now()}`}});
  const captures=join(process.cwd(),'captures','editor-ready-script');
  const fixtureDir=await mkdtemp(join(tmpdir(),'gws-preview-final-'));
  const fixturePath=join(fixtureDir,'final.mp4');
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=320x180:r=24','-t','12','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',fixturePath],{windowsHide:true});
  const finalBase64=(await readFile(fixturePath)).toString('base64');
  const evaluate=async source=>{
    const result=await win.webContents.executeJavaScript(`(async()=>{try{return await (async()=>{${source}})()}catch(e){return {__error:String(e.stack??e)}}})()`,true);
    if(result?.__error)throw Error(result.__error);return result;
  };
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const until=async(source,label=source)=>{for(let i=0;i<100;i++){if(await evaluate(`return (${source})`))return;await wait(100);}throw Error('Timeout: '+label);};
  const click=async selector=>{
    await until(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
    const p=await evaluate(`const e=document.querySelector(${JSON.stringify(selector)});if(e.matches(':disabled'))throw Error('Disabled '+${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(!e.contains(document.elementFromPoint(x,y)))throw Error('Obscured '+${JSON.stringify(selector)});return {x:Math.round(x),y:Math.round(y)};`);
    win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...p});
    win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...p});await wait(100);
  };
  const set=async(selector,value)=>evaluate(`const e=document.querySelector(${JSON.stringify(selector)});const p=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));`);
  const capture=async name=>{await mkdir(captures,{recursive:true});await writeFile(join(captures,name+'.png'),(await win.webContents.capturePage()).toPNG());};
  try {
    await win.loadURL(process.env.GOLD_WORK_SMOKE_URL??'http://127.0.0.1:5187/');
    await until('Boolean(document.querySelector(".channels-heading"))');
    console.log('UI_MOUNTED');
    win.showInactive();
    await evaluate(`
      if(window.goldWork)throw Error('Test must not use real providers');
      const moduleUrl=performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/fallback-api.ts')?.name;
      const {fallbackApi:api}=await import(moduleUrl??'/src/fallback-api.ts');window.qaApi=api;window.qaErrors=[];
      window.addEventListener('error',e=>qaErrors.push(e.message));window.addEventListener('unhandledrejection',e=>qaErrors.push(String(e.reason)));
      window.qaChatCalls=0;api.createChatTopic=async()=>{qaChatCalls++;throw Error('Chat must not be created');};
      api.prepareStoryCharacters=async id=>api.getProject(id);
      const ch=await api.createChannelProfile({name:'READY SCRIPT QA',countryCode:'GB',languageCode:'en',languageLabel:'Английский',direction:'ai-story',defaultMediaMode:'ai',masterPrompt:'',defaultDurationMinutes:1,defaultImageStyle:'Flat cartoon',lumeanTemplateUuid:'qa-voice',lumeanTemplateName:'QA voice'});
      window.qaChannel=ch;
      function wav(seconds){const rate=8000,n=rate*seconds,b=new ArrayBuffer(44+n*2),v=new DataView(b);function str(p,s){for(let i=0;i<s.length;i++)v.setUint8(p+i,s.charCodeAt(i));}str(0,'RIFF');v.setUint32(4,36+n*2,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,n*2,true);for(let i=0;i<n;i++)v.setInt16(44+i*2,Math.sin(i*2*Math.PI*220/rate)*1000,true);return URL.createObjectURL(new Blob([b],{type:'audio/wav'}));}
      window.qaAudio=wav(5);window.qaNewAudio=wav(7);
      const p=await api.createProject({title:'EDITOR QA 243',topic:'Ready text',language:'Английский',mediaMode:'ai',mode:'standard',aspectRatio:'16:9',channelProfileId:ch.id,videoBrief:{prompt:'',creationMode:'script',readyScript:'First. Second.',competitorTranscripts:[]}});
      p.settings.voice.enabled=true;p.settings.video.enabled=false;p.settings.assembly.imageMotionMode='alternate';p.settings.assembly.transition='cut';
      p.settings.assembly.imageMotion='alternate';
      const scenes=Array.from({length:243},(_,order)=>({id:'editor-qa-'+order,order,title:'Scene '+(order+1),narration:'Scene '+(order+1),imagePrompt:'A cartoon landscape',animationPrompt:'Slow camera push-in',durationSeconds:5,status:'ready',imagePath:'/styles/watercolor.jpg',audioPath:order<4?qaAudio:undefined,kenBurnsDirection:order%2?'out':'in'}));
      window.qaProjectId=p.id;await api.updateProject(p.id,{scenes,settings:p.settings,status:'ready'});
    `);
    await click('[data-nav-key="projects"]');
    await until('[...document.querySelectorAll(".projects-table-row")].some(e=>e.textContent.includes("EDITOR QA 243"))');
    console.log('PROJECT_VISIBLE');
    await evaluate(`[...document.querySelectorAll('.projects-table-row')].find(e=>e.textContent.includes('EDITOR QA 243')).click();`);
    await until('[...document.querySelectorAll(".project-expand button")].some(b=>b.textContent.includes("Таймлайн"))');
    await evaluate(`[...document.querySelectorAll('.project-expand button')].find(e=>e.textContent.includes('Таймлайн')).click();`);
    if(!await evaluate('return Boolean(document.querySelector(".timeline-studio"))')) {
      await until('Boolean(document.querySelector("[data-flow-step=editor]"))');await click('[data-flow-step="editor"]');
    }
    await until('Boolean(document.querySelector(".timeline-studio"))');
    await until('document.querySelector(".timeline-live-preview audio")?.readyState>=1');
    await click('.timeline-transport .play');
    const sampled=await evaluate(`
      const layer=document.querySelector('[data-preview-layer]'),audio=layer.querySelector('audio');
      window.qaInitialLayer=layer;window.qaInitialAudio=audio;const values=[];const times=[];let update=false;
      const start=performance.now();await new Promise(resolve=>{const frame=async()=>{const t=performance.now()-start;values.push(getComputedStyle(layer).transform);times.push(t);
        if(t>800&&!update){update=true;const p=await qaApi.getProject(qaProjectId);p.scenes[0].audioPath=qaNewAudio;p.scenes[2].imagePath='/styles/comic.jpg';await qaApi.updateProject(p.id,{scenes:p.scenes});}
        if(t<3000)requestAnimationFrame(frame);else resolve();};requestAnimationFrame(frame);});
      return {samples:values.length,unique:new Set(values).size,playing:document.querySelector('.timeline-live-preview').classList.contains('playing'),sameImage:qaInitialLayer===document.querySelector('[data-preview-layer]'),sameAudio:qaInitialAudio===document.querySelector('[data-preview-layer] audio'),audioTime:audio.currentTime,pending:Boolean(document.querySelector('.timeline-pending-media')),maxFrameGap:Math.max(...times.slice(1).map((t,i)=>t-times[i]))};
    `);
    assert.equal(sampled.playing,true,'Background update must not pause playback');
    assert.equal(sampled.sameImage,true);assert.equal(sampled.sameAudio,true);
    assert.ok(sampled.audioTime>2,'Real local audio advances');assert.ok(sampled.samples>60,'Visible preview must animate above background timer cadence');assert.ok(sampled.unique>sampled.samples*.55,'Motion updates at frame cadence, not 80ms steps');
    assert.equal(sampled.pending,true);console.log('LIVE_PREVIEW',JSON.stringify(sampled));
    await click('.timeline-transport .play');
    await until('document.querySelector("[data-preview-layer] audio")?.src===qaNewAudio');
    await capture('editor-paused');
    // Selection and right-panel edits survive background snapshots, and are persisted explicitly.
    await click('.timeline-clip:nth-child(3)');
    assert.match(await evaluate('return document.querySelector(".timeline-property-thumb span").textContent'),/Scene 3/);
    await set('.timeline-properties input[type="range"]','64');
    await evaluate(`const p=await qaApi.getProject(qaProjectId);await qaApi.updateProject(p.id,{title:p.title+' updated'});`);await wait(1000);
    assert.equal(await evaluate('return document.querySelector(".timeline-properties input[type=range]").value'),'64');
    await click('.timeline-properties footer .generate-button');
    await until('(await qaApi.getProject(qaProjectId)).scenes[2].narrationVolume===64');
    // Native HTML drag events exercise the actual React handlers; cancellation cannot reorder.
    await evaluate(`const clips=document.querySelectorAll('.timeline-clip'),data=new DataTransfer();window.qaDrag=data;clips[0].dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:data}));const r=clips[2].getBoundingClientRect();clips[2].dispatchEvent(new DragEvent('dragover',{bubbles:true,dataTransfer:data,clientX:r.right-2}));`);
    await until('Boolean(document.querySelector(".timeline-clip.dragging"))&&Boolean(document.querySelector(".timeline-clip.drop-after"))');await capture('editor-drag');
    await evaluate(`const clips=document.querySelectorAll('.timeline-clip'),r=clips[2].getBoundingClientRect();clips[2].dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:qaDrag,clientX:r.right-2}));`);
    await until('(await qaApi.getProject(qaProjectId)).scenes[2].id==="editor-qa-0"');
    await evaluate(`window.qaFinal=URL.createObjectURL(new Blob([Uint8Array.from(atob(${JSON.stringify(finalBase64)}),c=>c.charCodeAt(0))],{type:'video/mp4'}));await qaApi.updateProject(qaProjectId,{outputPath:qaFinal,lastRender:{completedAt:'2026-09-13T16:00:00Z',engine:'ffmpeg',templates:[]}});`);
    await until('[...document.querySelectorAll(".timeline-preview-switch button")].some(b=>b.textContent==="Final.mp4"&&!b.disabled)');
    await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Final.mp4').click();`);
    await until('document.querySelector(".timeline-media-frame video[data-mode=final]")?.readyState>=2');
    await click('.timeline-transport .play');
    await evaluate(`window.qaFinalElement=document.querySelector('.timeline-media-frame video[data-mode=final]');await qaApi.updateProject(qaProjectId,{title:'EDITOR QA Final update'});`);
    await wait(1400);
    assert.equal(await evaluate(`return qaFinalElement===document.querySelector('.timeline-media-frame video[data-mode=final]')&&!qaFinalElement.paused&&qaFinalElement.currentTime>1`),true,'Ordinary project updates must not reload or pause Final');
    await evaluate(`await qaApi.updateProject(qaProjectId,{lastRender:{completedAt:'2026-09-13T16:01:00Z',engine:'ffmpeg',templates:[]}});`);
    await until(`qaFinalElement!==document.querySelector('.timeline-media-frame video[data-mode=final]')`);
    console.log('FINAL_PREVIEW',JSON.stringify({stableDuringUpdates:true,reloadsNewRender:true}));
    await evaluate(`await qaApi.updateProject(qaProjectId,{status:'generating'});`);
    await until('document.querySelector(".timeline-property-fields")?.disabled===true');
    assert.equal(await evaluate(`return [...document.querySelectorAll('.timeline-property-fields input,.timeline-property-fields select')].every(e=>e.matches(':disabled'))`),true);
    assert.equal(await evaluate(`return document.querySelector('.timeline-transport .play').disabled`),false);
    await evaluate(`await qaApi.updateProject(qaProjectId,{status:'ready'});`);
    await click('.timeline-topbar > button');
    await click('[data-nav-key="channels"]');
    await click('.channels-heading .primary-button');
    await set('.channel-dialog .channel-form input','READY SCRIPT INPUT');
    await click('.channel-dialog-footer .primary-button');
    await until('document.querySelector(".channel-dialog-header")?.textContent.includes("ШАГ 2 ИЗ 2")');
    await click('.channel-dialog-footer .primary-button');
    await until('Boolean(document.querySelector(".channel-workspace-actions")) || document.body.textContent.includes("Новый ролик")');
    assert.equal(await evaluate('return Boolean(document.querySelector(".chat-area,.channel-topic-list"))'),false);
    await evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent.includes('Новый ролик')).click();`);
    await until('Boolean(document.querySelector(".video-dialog"))');
    assert.equal(await evaluate('return document.querySelectorAll(".video-creation-modes").length'),0);
    const script=Array.from({length:70},(_,i)=>`Paragraph ${i+1}. A complete ready script, with its original wording.\nThe next line stays exactly as written.  Even these two spaces must remain.`).join('\n\n')+'\n\nThe end.';
    await set('.video-dialog input[type="text"], .video-dialog input:not([type])','READY INPUT QA');
    await set('.video-dialog textarea',script);
    await click('.video-voice-controls button');await until('Boolean(document.querySelector(".voice-calibration-ready"))');
    await capture('ready-script-form');
    await evaluate(`const prepare=qaApi.prepareProjectScript;qaApi.prepareProjectScript=async(...args)=>{await new Promise(resolve=>window.qaReleasePreparation=resolve);return prepare(...args);};`);
    await click('.video-dialog .channel-dialog-footer .primary-button');
    await until('Boolean(window.qaReleasePreparation)&&Boolean(document.querySelector(".ai-preparation-source"))');
    await click('.ai-preparation-source > summary');
    const sourceLayout=await evaluate(`const e=document.querySelector('.ready-script-input textarea'),r=e.getBoundingClientRect(),parent=e.closest('.ai-preparation-source').getBoundingClientRect();return {text:e.value,width:r.width,parentWidth:parent.width,height:r.height,readOnly:e.readOnly,disabled:e.disabled,background:getComputedStyle(e).backgroundColor,styleCollapsed:!document.querySelector('.ready-script-style').open};`);
    assert.equal(sourceLayout.text,script);assert.equal(sourceLayout.readOnly,true);assert.equal(sourceLayout.disabled,false);
    assert.ok(sourceLayout.width>sourceLayout.parentWidth*.9,'Full-width ready text, not the browser default textarea');
    assert.ok(sourceLayout.height>=320);assert.equal(sourceLayout.background,'rgb(13, 13, 11)');assert.equal(sourceLayout.styleCollapsed,true);
    await evaluate(`document.querySelector('.ready-script-input textarea').scrollIntoView({block:'center'});`);
    await capture('ready-script-source-preparing');
    await evaluate('qaReleasePreparation();');
    await until('document.querySelector(".scenario-page")?.textContent.includes("READY INPUT QA")');
    const input=await evaluate(`const p=(await qaApi.listProjects()).find(p=>p.title==='READY INPUT QA');return {script:p.videoBrief.readyScript,narration:p.scenes.map(s=>s.narration).join(''),chatId:p.chatTopicId,calls:qaChatCalls};`);
    assert.equal(input.script,script);assert.equal(input.narration,script);assert.equal(input.chatId,undefined);assert.equal(input.calls,0);
    // Every entry to project settings must mount the actual screen (a missing route throws no React error).
    await click('[data-flow-step="settings"]');
    await until('Boolean(document.querySelector(".project-page .ai-story-settings"))');
    assert.equal(await evaluate('return document.querySelectorAll(".ai-settings-card").length'),4);
    assert.match(await evaluate('return document.querySelector(".project-page").textContent'),/Начать генерацию/);
    await capture('ready-script-settings');
    await evaluate(`const field=[...document.querySelectorAll('.ai-settings-field')].find(e=>e.textContent.includes('Движение картинок'));field.querySelector('select').dataset.qaMotion='';`);
    await set('[data-qa-motion]','cycle');
    await click('[data-flow-step="scenario"]');
    await until('Boolean(document.querySelector(".scenario-page"))');
    await click('[data-flow-step="materials"]');
    await until('document.querySelector("[data-flow-step=materials]")?.getAttribute("aria-current")==="step"');
    await click('[data-flow-step="settings"]');
    await until('Boolean(document.querySelector(".project-page .ai-story-settings"))');
    assert.equal(await evaluate(`return [...document.querySelectorAll('.ai-settings-field')].find(e=>e.textContent.includes('Движение картинок')).querySelector('select').value`),'cycle','Settings persist through stage navigation');
    await click('[data-flow-step="brief"]');
    await until('Boolean(document.querySelector(".ai-preparation-source"))');
    await click('.ai-preparation-source > summary');
    assert.equal(await evaluate('return document.querySelector(".ready-script-input textarea").value'),script);
    assert.equal(await evaluate('return document.querySelector(".ready-script-input textarea").readOnly'),false);
    win.setSize(1100,900);await wait(200);
    assert.ok(await evaluate('const e=document.querySelector(".ready-script-input textarea");return e.getBoundingClientRect().width>600&&document.querySelector(".page-scroll").scrollWidth<=document.querySelector(".page-scroll").clientWidth+1;'),'Readable source at smaller window width without horizontal overflow');
    await capture('ready-script-source-compact');
    win.setSize(1440,1000);
    await click('[data-nav-key="projects"]');
    await until('[...document.querySelectorAll(".projects-table-row")].some(e=>e.textContent.includes("READY INPUT QA"))');
    await evaluate(`[...document.querySelectorAll('.projects-table-row')].find(e=>e.textContent.includes('READY INPUT QA')).click();`);
    await evaluate(`[...document.querySelectorAll('.project-expand button')].find(e=>e.textContent.includes('Настроить')).click();`);
    await until('Boolean(document.querySelector(".project-page .ai-story-settings"))');
    console.log('BRIEF_AND_SETTINGS',JSON.stringify({fullTextCharacters:script.length,readableDuringPreparation:true,stageNavigation:true,settingsFromProjectList:true,savedMotion:'cycle'}));
    await click('[data-nav-key="channels"]');
    await evaluate(`const b=[...document.querySelectorAll('button')].find(e=>e.textContent.includes('Каналы'));if(b)b.click();`);
    console.log('READY_SCRIPT',JSON.stringify({exactText:true,chatCalls:input.calls}));
    assert.deepEqual(await evaluate('return qaErrors'),[]);
    console.log('EDITOR_READY_SCRIPT_UI_OK',captures);
  } finally {win.destroy();}
  app.exit(0);
}
