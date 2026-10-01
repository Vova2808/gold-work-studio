import assert from 'node:assert/strict';
import { app, BrowserWindow } from 'electron';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = mkdtempSync(join(tmpdir(), 'gws-library-ipc-'));
const source = join(root, 'source', 'Звуковые эффекты', 'Клавиатура');
await mkdir(source, { recursive: true });
const require = createRequire(import.meta.url);
const ffmpeg = require('ffmpeg-static');
const make = spawnSync(ffmpeg, ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'sine=frequency=450:duration=1', join(source, 'Keyboard_01.wav')], { windowsHide: true, encoding: 'utf8' });
assert.equal(make.status, 0, make.stderr);
app.setPath('userData', root);
delete process.env.PORTABLE_EXECUTABLE_DIR;
require(resolve('dist/main/index.cjs'));
app.whenReady().then(run).catch(error => { console.error(error); app.exit(1); });
async function run() {
  try {
    let win;
    for (let n = 0; n < 150; n++) {
      win = BrowserWindow.getAllWindows()[0];
      if (win && !win.webContents.isLoadingMainFrame()) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(win); win.webContents.setBackgroundThrottling(false); win.hide();
    const evaluate = source => win.webContents.executeJavaScript(`(async()=>{${source}})()`, true);
    for (let n = 0; n < 100; n++) {
      if (await evaluate('return Boolean(window.goldWork?.getEffectLibrary && document.querySelector("[data-nav-key=library]"))')) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const before = await evaluate(`
      const api=window.goldWork;
      const ai=await api.createProject({title:'Existing AI Story',topic:'Original',language:'English',aspectRatio:'16:9',mode:'pro',mediaMode:'ai'});
      await api.importEffectFolders([${JSON.stringify(source)}]);
      return ai;
    `);
    let snapshot;
    for (let n = 0; n < 100; n++) {
      snapshot = await evaluate('return window.goldWork.getEffectLibrary()');
      if (snapshot.importProgress?.status === 'complete') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(snapshot.importProgress?.status, 'complete');
    assert.deepEqual(snapshot.importProgress.errors, []);
    assert.equal(snapshot.assets.length, 1);
    assert.equal(snapshot.assets[0].category, 'keyboard');
    await evaluate(`
      [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Открыть приложение')?.click();
      document.querySelector('[data-nav-key=library]').click();
    `);
    for (let n = 0; n < 50; n++) {
      if (await evaluate('return Boolean(document.querySelector(".effect-card"))')) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await evaluate('document.querySelector(".effect-card").click()');
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.ok(await evaluate('return document.querySelector(".effect-card.selected") && document.querySelector("audio") && document.querySelector("[aria-label=\\"Свойства эффекта\\"]")'));
    await evaluate(`
      const input=[...document.querySelectorAll('.effect-inspector label')].find(e=>e.textContent.startsWith('Название')).querySelector('input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Keyboard reviewed');
      input.dispatchEvent(new Event('input',{bubbles:true}));
    `);
    await new Promise(resolve => setTimeout(resolve, 100));
    await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Сохранить свойства').click()`);
    for (let n = 0; n < 50; n++) {
      if (await evaluate(`return document.body.innerText.includes('Свойства сохранены')`)) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    snapshot = await evaluate('return window.goldWork.getEffectLibrary()');
    assert.equal(snapshot.assets[0].name, 'Keyboard reviewed');
    const media = await evaluate(`const r=await fetch(document.querySelector('audio').src,{headers:{Range:'bytes=0-15'}});return {status:r.status,length:(await r.arrayBuffer()).byteLength};`);
    assert.equal(media.status, 206); assert.equal(media.length, 16);
    const after = await evaluate(`return window.goldWork.getProject(${JSON.stringify(before.id)})`);
    assert.deepEqual(after, before);
    const disk = JSON.parse(await readFile(join(snapshot.rootPath, 'Catalog', 'Assets', `${snapshot.assets[0].id}.json`), 'utf8'));
    assert.equal(disk.name, 'Keyboard reviewed');
    await mkdir(resolve('captures'), { recursive: true });
    const capture = await Promise.race([
      win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Library screenshot timed out')), 15000))
    ]);
    assert.ok(!capture.isEmpty(), 'Library screenshot must contain rendered pixels');
    await writeFile(resolve('captures/effect-library-ui-smoke.png'), capture.toPNG());
    console.log('PASS: real main/preload IPC import, library navigation/selection, React inspector edit, persisted catalog, playable media range and unchanged AI Story. No provider calls.');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
}
