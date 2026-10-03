import assert from 'node:assert/strict';
import { app, BrowserWindow, dialog } from 'electron';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { mkdir, writeFile, readFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createVoiceCalibration, voiceCalibrationSampleText } from '@gold-work/shared';

const root = mkdtempSync(join(tmpdir(), 'gws-doc-ui-'));
const media = join(root, 'originals'); await mkdir(media);
const require = createRequire(import.meta.url), ffmpeg = require('ffmpeg-static');
for (const [name, args] of [
  ['image.png', ['-f', 'lavfi', '-i', 'testsrc2=size=960x540', '-frames:v', '1']],
  ['paper.png', ['-f', 'lavfi', '-i', 'color=c=0xd6d2c8:size=480x720', '-frames:v', '1']],
  ['keyboard.wav', ['-f', 'lavfi', '-i', 'sine=frequency=550:duration=1']],
  ['voice.wav', ['-f', 'lavfi', '-i', 'sine=frequency=220:duration=2']]
]) assert.equal(spawnSync(ffmpeg, ['-hide_banner', '-y', ...args, join(media, name)], { windowsHide: true, encoding: 'utf8' }).status, 0);
app.setPath('userData', root); delete process.env.PORTABLE_EXECUTABLE_DIR;
require(resolve('dist/main/index.cjs'));
app.whenReady().then(run).catch(error => { console.error(error); app.exit(1); });
async function run() {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  let win;
  try {
    for (let n = 0; n < 150; n++) { win = BrowserWindow.getAllWindows()[0]; if (win && !win.webContents.isLoadingMainFrame()) break; await wait(100); }
    assert.ok(win); win.hide(); win.webContents.setBackgroundThrottling(false);
    const evaluate = source => win.webContents.executeJavaScript(`(async()=>{${source}})()`, true);
    const until = async source => { for (let n = 0; n < 180; n++) { if (await evaluate(`return (${source})`)) return; await wait(100); } throw new Error(`Timeout: ${source}`); };
    const setValue = async (selector, value) => { await evaluate(`const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e instanceof HTMLSelectElement?HTMLSelectElement.prototype:e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e instanceof HTMLSelectElement?'change':'input',{bubbles:true}));`); await wait(80); };
    await until('Boolean(window.goldWork?.prepareDocumentaryPreview && document.querySelector("[data-nav-key=projects]"))');
    const build = await evaluate('return window.goldWork.getAppInfo()');
    const expectedBuild = (await readFile(resolve('../renderer/src/generated-build-identity.ts'), 'utf8')).match(/APP_BUILD_ID = "([^"]+)"/)[1];
    assert.equal(build.buildId, expectedBuild, 'Production main and renderer must use the current build identity');
    console.log(`Build verified: ${build.buildId}`);
    const youtubeFixture = await evaluate(`return window.goldWork.saveYouTubeSettings({apiKey:'fixture-youtube-api',proxyUrl:'socks5://fixture-user:fixture-password@127.0.0.1:1080',downloadRoute:'proxy',workDirPath:${JSON.stringify(root)}})`);
    assert.equal(youtubeFixture.proxyConfigured, true); assert.equal(youtubeFixture.downloadRoute, 'proxy');
    assert.ok(!JSON.stringify(youtubeFixture).includes('fixture-password'), 'Proxy credentials must never cross public IPC');
    assert.ok(!(await readFile(join(root,'credentials','youtube.json'),'utf8')).includes('fixture-password'), 'Proxy credentials are encrypted at rest');
    await until(`Boolean(document.querySelector('.startup-health-toast[open] .primary-button'))`);
    await evaluate(`document.querySelector('.startup-health-toast[open] .primary-button').click()`);
    await until(`!document.querySelector('.startup-health-toast[open]')`);
    await evaluate(`document.querySelector('[data-nav-key=settings]').click()`);
    await until(`Boolean(document.querySelector('.settings-menu'))`);
    await evaluate(`[...document.querySelectorAll('.settings-menu button')].find(b=>b.textContent.includes('YouTube')).click()`);
    await until(`Boolean(document.querySelector('[aria-label="Подключение для видео Stock"]'))`);
    await until(`document.querySelector('[aria-label="Подключение для видео Stock"]').value==='proxy'`);
    assert.equal(await evaluate(`return document.querySelector('[aria-label="Прокси для видео Stock"]').value`), '');
    await setValue('[aria-label="Подключение для видео Stock"]','public-dns');
    await evaluate(`[...document.querySelectorAll('.settings-section button')].find(b=>b.textContent.includes('Сохранить')).click()`);
    await until(`Boolean([...document.querySelectorAll('.settings-section button')].find(b=>b.textContent.includes('Сохранить')&&!b.disabled))`);
    const routed = await evaluate(`return window.goldWork.getYouTubeSettings()`);
    assert.equal(routed.downloadRoute, 'public-dns'); assert.equal(routed.configured, true); assert.equal(routed.workDirPath, root); assert.equal(routed.proxyConfigured, true);
    await evaluate(`[...document.querySelectorAll('summary')].find(e=>e.textContent.includes('Вход YouTube для скачивания')).click()`);
    const cookieFixture = join(root, 'youtube-session.txt');
    const picker = dialog.showOpenDialog;
    try {
      dialog.showOpenDialog = async () => ({canceled:false,filePaths:[cookieFixture]});
      await writeFile(cookieFixture, 'invalid cookie file');
      await evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent==='Выбрать cookies.txt').click()`);
      await until(`document.body.innerText.includes('не в формате Netscape')`);
      assert.equal((await evaluate('return window.goldWork.getYouTubeSettings()')).cookiesFileConfigured, false);
      const cookieContent = '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t2147483647\tfixture\tnot-a-real-session\n';
      await writeFile(cookieFixture, cookieContent);
      await evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent==='Выбрать cookies.txt').click()`);
      await until(`document.body.innerText.includes('Файл сессии подключён. Доступ к видео будет проверен при скачивании.')`);
      assert.equal((await evaluate('return window.goldWork.getYouTubeSettings()')).cookiesFileConfigured, true);
      await evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent==='Выбрать cookies.txt').scrollIntoView({block:'center'})`);
      await wait(100);
      await writeFile(resolve('captures/documentary-youtube-session-settings.png'), (await win.webContents.capturePage()).toPNG());
      await evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent==='Отключить файл').click()`);
      await until(`document.body.innerText.includes('Файл сессии отключён от программы')`);
      assert.equal((await evaluate('return window.goldWork.getYouTubeSettings()')).cookiesFileConfigured, false);
      assert.equal(await readFile(cookieFixture, 'utf8'), cookieContent, 'Disconnecting a session preserves its file');
      dialog.showOpenDialog = async () => ({canceled:true,filePaths:[]});
      await evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent==='Выбрать cookies.txt').click()`);
      await wait(100);
      assert.equal((await evaluate('return window.goldWork.getYouTubeSettings()')).cookiesFileConfigured, false);
    } finally { dialog.showOpenDialog = picker; }
    await evaluate(`await window.goldWork.clearYouTubeKey();await window.goldWork.saveYouTubeSettings({clearProxy:true,downloadRoute:'system'});document.querySelector('[data-nav-key=projects]').click()`);
    const calibration = createVoiceCalibration({ provider: 'elevenlabs', voice: 'fixture', language: 'en', sampleText: voiceCalibrationSampleText('en'), audioDurationSeconds: 14 });
    const setup = await evaluate(`
      const api=window.goldWork;
      const ai=await api.createProject({title:'AI preserve',topic:'Original',language:'English',aspectRatio:'16:9',mode:'pro',mediaMode:'ai'});
      const legacy=await api.createProject({title:'Legacy preserve',topic:'Original',language:'English',aspectRatio:'16:9',mode:'standard'});
      let p=await api.createProject({title:'DOCUMENTARY UI QA',topic:'SS United States',language:'English',aspectRatio:'16:9',mode:'standard',mediaMode:'stock',videoBrief:{prompt:'Fixture',creationMode:'script',readyScript:'SS United States crossed the Atlantic in 1952. Icon of the Seas began cruising in 2024.',competitorTranscripts:[]}});
      p=await api.updateProject(p.id,{settings:{...p.settings,voice:{...p.settings.voice,enabled:true,provider:'elevenlabs',voice:'fixture',calibration:${JSON.stringify(calibration)}}}});
      p=await api.prepareProjectScript(p.id);
      await api.importEffectFolders([${JSON.stringify(media)}]);
      return {ai,legacy,project:p};
    `);
    let project = setup.project;
    assert.equal(project.settings.assembly.documentary.version, 2);
    assert.equal(project.scenes.map(scene => scene.narration).join(''), project.videoBrief.readyScript);
    assert.ok(project.scenes.length >= 2);
    for (const [index, scene] of project.scenes.entries()) {
      project = await evaluate(`const api=window.goldWork; await api.importDocumentaryMaterial(${JSON.stringify(project.id)},${JSON.stringify(scene.id)},{path:${JSON.stringify(join(media, index % 2 ? 'paper.png' : 'image.png'))},title:'Local fixture',pageUrl:'',author:'UI test',license:'Own synthetic media',licenseUrl:''});return api.reviewDocumentaryMaterial(${JSON.stringify(project.id)},${JSON.stringify(scene.id)},{verified:true,illustrative:false,note:'Local fixture',rightsConfirmed:true});`);
    }
    project = await evaluate(`let p=await window.goldWork.getProject(${JSON.stringify(project.id)});p=await window.goldWork.updateProject(p.id,{scenes:p.scenes.map((s,index)=>({...s,audioPath:${JSON.stringify(join(media,'voice.wav'))},documentary:{...s.documentary,requirement:{...s.documentary.requirement,preferredKind:index===0?'video':'image'}}}))});return window.goldWork.prepareDocumentaryPreview(p.id);`);
    assert.ok(project.scenes.every(scene => scene.documentary.timing?.audioPath));
    await until(`document.body.innerText.includes('Открыть приложение') || Boolean(document.querySelector('[data-nav-key=projects]'))`);
    await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Открыть приложение')?.click();document.querySelector('[data-nav-key=projects]').click()`);
    await until(`[...document.querySelectorAll('.projects-table-row')].some(e=>e.textContent.includes('DOCUMENTARY UI QA'))`);
    await evaluate(`[...document.querySelectorAll('.projects-table-row')].find(e=>e.textContent.includes('DOCUMENTARY UI QA')).click()`);
    await until(`[...document.querySelectorAll('.project-expand button')].some(e=>e.textContent.includes('Таймлайн'))`);
    await evaluate(`[...document.querySelectorAll('.project-expand button')].find(e=>e.textContent.includes('Настроить')).click()`);
    await until(`Boolean(document.querySelector('.project-workflow'))`);
    await evaluate(`[...document.querySelectorAll('.project-workflow button')].find(e=>e.textContent.includes('Материалы')).click()`);
    await until(`Boolean(document.querySelector('.scenario-material-actions button'))`);
    await until(`document.body.innerText.includes('видео: 0') && document.body.innerText.includes('фото: ${project.scenes.length}')`);
    assert.equal(await evaluate(`return document.querySelectorAll('.scenario-material-copy .documentary-photo-fallback').length`), 1, 'Only a requested video replaced with a photo is marked');
    await evaluate(`document.querySelector('.scenario-material-actions button').click()`);
    await until(`Boolean(document.querySelector('.documentary-material-modal'))`);
    assert.match(await evaluate(`return document.querySelector('.documentary-review .documentary-photo-fallback').textContent`), /Фото вместо видео/);
    assert.equal(await evaluate(`return document.querySelector('[aria-label="Вид материала"]').value`), project.scenes[0].documentary.requirement.preferredKind ?? 'video');
    assert.equal(await evaluate(`return document.querySelector('[aria-label="Источник материалов"] option[value=youtube]')?.textContent`), 'YouTube · Creative Commons');
    const youtubeSearch = await evaluate(`return window.goldWork.searchDocumentary(${JSON.stringify(project.id)}, ${JSON.stringify(project.scenes[0].id)}, {query:'Tractor',kind:'video',providers:['youtube']})`);
    assert.equal(youtubeSearch.result.candidates.length, 0);
    assert.match(youtubeSearch.result.sources[0].error, /YouTube/, 'Unavailable YouTube credentials are an explicit source error through production IPC');
    const beforeAuto = await evaluate(`return window.goldWork.getProject(${JSON.stringify(project.id)})`);
    await evaluate(`[...document.querySelectorAll('.documentary-search-controls button')].find(e=>e.textContent==='Автоподбор по сценарию').click()`);
    await until(`Boolean(document.querySelector('.documentary-material-modal [role=alert]'))`);
    assert.match(await evaluate(`return document.querySelector('.documentary-material-modal [role=alert]').textContent`), /AnyModel/);
    const afterAuto = await evaluate(`return window.goldWork.getProject(${JSON.stringify(project.id)})`);
    assert.deepEqual(afterAuto.scenes, beforeAuto.scenes, 'An unavailable analysis service keeps all previously verified materials');
    await evaluate(`document.querySelector('[aria-label="Закрыть подбор материалов"]').click();document.querySelector('[data-nav-key=projects]').click()`);
    await until(`[...document.querySelectorAll('.projects-table-row')].some(e=>e.textContent.includes('DOCUMENTARY UI QA'))`);
    await evaluate(`if(!document.querySelector('.project-expand'))[...document.querySelectorAll('.projects-table-row')].find(e=>e.textContent.includes('DOCUMENTARY UI QA')).click()`);
    await until(`[...document.querySelectorAll('.project-expand button')].some(e=>e.textContent.includes('Таймлайн'))`);
    await evaluate(`[...document.querySelectorAll('.project-expand button')].find(e=>e.textContent.includes('Таймлайн')).click()`);
    await until(`Boolean(document.querySelector('.timeline-studio'))`);
    await until(`Boolean(document.querySelector('.documentary-inspector')) && !document.body.innerText.includes('Подготавливаю звук…')`);
    assert.match(await evaluate(`return document.querySelector('.documentary-inspector .documentary-photo-fallback').textContent`), /Фото вместо видео/);
    assert.equal(await evaluate(`return document.querySelector('.timeline-properties').innerText.includes('ПРОМПТЫ СЦЕНЫ')`), false);
    await evaluate(`document.querySelector('.documentary-inspector input[type=checkbox]').click()`);
    await setValue('.documentary-inspector textarea', '1952 / 2024');
    await wait(2300);
    assert.equal(await evaluate(`return document.querySelector('.documentary-inspector textarea')?.value`), '1952 / 2024', 'Background project refresh must preserve caption edits');
    await evaluate(`[...document.querySelectorAll('.documentary-inspector button')].find(b=>b.textContent.includes('Из библиотеки')).click()`);
    await until(`Boolean(document.querySelector('.documentary-effect-results button'))`);
    await setValue('[aria-label="Поиск эффекта"]', 'keyboard');
    await evaluate(`document.querySelector('.documentary-effect-results button').click()`);
    await until(`Boolean(document.querySelector('.documentary-effect-preview audio'))`);
    await evaluate(`[...document.querySelectorAll('.documentary-effect-preview button')].find(b=>b.textContent==='Добавить в кадр').click()`);
    await until(`!document.querySelector('.documentary-effect-picker') && Boolean(document.querySelector('.documentary-effect'))`);
    await evaluate(`[...document.querySelectorAll('.timeline-top-actions button')].find(b=>b.textContent.includes('Отменить')).click()`);
    assert.equal(await evaluate(`return Boolean(document.querySelector('.documentary-effect'))`), false);
    await evaluate(`[...document.querySelectorAll('.timeline-top-actions button')].find(b=>b.textContent.includes('Повторить')).click()`);
    await until(`Boolean(document.querySelector('.documentary-effect'))`);
    await evaluate(`document.querySelector('.timeline-properties footer .generate-button').click()`);
    await until(`document.querySelector('.timeline-properties footer .generate-button').disabled`);
    let saved = await evaluate(`return window.goldWork.getProject(${JSON.stringify(project.id)})`);
    const edited = saved.scenes[0];
    assert.equal(edited.documentary.caption.text, '1952 / 2024');
    assert.equal(edited.documentary.effects.length, 1);
    assert.ok(edited.documentary.effects[0].filePath.includes('Documentary'));
    await rename(join(root, 'workspace', 'Library'), join(root, 'workspace', 'Library-offline'));
    assert.ok((await readFile(edited.documentary.effects[0].filePath)).length > 0);
    await evaluate(`const clips=document.querySelectorAll('.timeline-clip'),data=new DataTransfer();clips[0].dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:data}));const r=clips[1].getBoundingClientRect();clips[1].dispatchEvent(new DragEvent('dragover',{bubbles:true,dataTransfer:data,clientX:r.right-1}));`);
    assert.ok(await evaluate(`return Boolean(document.querySelector('.timeline-clip.drop-after'))`));
    await evaluate(`const clips=document.querySelectorAll('.timeline-clip'),r=clips[1].getBoundingClientRect();clips[1].dispatchEvent(new DragEvent('drop',{bubbles:true,clientX:r.right-1}));`);
    await wait(250);
    saved = await evaluate(`return window.goldWork.getProject(${JSON.stringify(project.id)})`);
    assert.equal(saved.scenes[1].id, edited.id);
    assert.equal(saved.scenes[1].documentary.caption.text, '1952 / 2024');
    await evaluate(`document.querySelector('.timeline-transport .play').click()`);
    // Actual production queue and renderer through IPC, with already prepared local voice.
    await evaluate(`await window.goldWork.assembleProject(${JSON.stringify(project.id)})`);
    let finished;
    for (let n=0;n<1200;n++) {
      finished=await evaluate(`return window.goldWork.getProject(${JSON.stringify(project.id)})`);
      if(finished.outputPath && finished.status==='complete')break;
      if(finished.status==='failed')throw new Error(`Assembly failed: ${JSON.stringify(await evaluate(`return window.goldWork.listQueue()`))}`);
      await wait(100);
    }
    assert.ok(finished.outputPath, 'Actual IPC assembly must create Final.mp4');
    assert.equal(finished.lastRender?.engine, 'remotion');
    assert.ok((await readFile(finished.outputPath)).length>10000);
    await wait(700);
    assert.ok(await evaluate(`return [...document.querySelectorAll('.remotion-player audio')].some(a=>a.currentTime>0) || [...document.querySelectorAll('audio')].some(a=>a.currentTime>0)`), 'Player must play measured narration');
    await evaluate(`document.querySelector('.timeline-transport .play').click()`);
    assert.deepEqual(await evaluate(`return window.goldWork.getProject(${JSON.stringify(setup.ai.id)})`), setup.ai);
    assert.deepEqual(await evaluate(`return window.goldWork.getProject(${JSON.stringify(setup.legacy.id)})`), setup.legacy);
    await mkdir(resolve('captures'), { recursive: true });
    const capture = await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
    await writeFile(resolve('captures/documentary-ui-smoke.png'), capture.toPNG());
    console.log('PASS: real Stock main/preload/React ready text, media import/review, local voice timing, caption, effect copy/offline, undo/redo, drag/drop, Player audio and production IPC Final.mp4; unchanged AI and legacy projects. Synthetic local media, no providers.');
    app.exit(0);
  } catch (error) {
    console.error(error);
    if (win) console.error((await win.webContents.executeJavaScript('document.body.innerText')).slice(-1800));
    app.exit(1);
  }
}
