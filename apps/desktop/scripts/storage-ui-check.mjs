// Isolated profile, tiny local fixtures, no production data or provider calls.
import assert from 'node:assert/strict';
import { app, BrowserWindow, dialog } from 'electron';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const profile = await mkdtemp(join(tmpdir(), 'gws-storage-ui-'));
const out = resolve('captures/storage-ui'); await mkdir(out, { recursive: true });
const destination = await mkdtemp(join(out, 'fixture-'));
const target = join(destination, 'first'), next = join(destination, 'next');
await mkdir(target); await mkdir(next);
await mkdir(join(profile, 'workspace'), { recursive: true });
const voice = join(profile, 'workspace', 'voice.wav');
await writeFile(voice, 'local-audio-fixture');
await writeFile(join(profile, 'storage-location.json'), JSON.stringify({ pendingPath: target }));
app.setPath('userData', profile);
delete process.env.ELECTRON_RENDERER_URL; delete process.env.PORTABLE_EXECUTABLE_DIR;
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [next] });
app.on('browser-window-created', (_event, win) => win.on('show', () => win.hide()));
createRequire(import.meta.url)(resolve('dist/main/index.cjs'));
app.whenReady().then(async () => {
  const timeout = setTimeout(() => { console.error('Storage UI timeout'); app.exit(1); }, 45_000);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  let win;
  try {
    for (let n = 0; n < 150; n++) {
      win = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'));
      if (win && !win.webContents.isLoadingMainFrame()) break;
      await wait(100);
    }
    assert.ok(win); win.setSize(1500, 1000);
    const evaluate = body => win.webContents.executeJavaScript(`(async()=>{${body}})()`, true);
    const until = async expression => {
      for (let n = 0; n < 100; n++) { if (await evaluate(`return (${expression})`)) return; await wait(100); }
      throw new Error(`UI timeout: ${expression}`);
    };
    await until(`Boolean(document.querySelector('.startup-health-toast[open] .primary-button'))`);
    await evaluate(`document.querySelector('.startup-health-toast[open] .primary-button').click(); document.querySelector('[data-nav-key=settings]').click()`);
    await until(`Boolean(document.querySelector('.settings-menu'))`);
    await evaluate(`[...document.querySelectorAll('.settings-menu button')].find(e=>e.textContent.includes('Хранение')).click()`);
    await until(`document.body.innerText.includes('Выбрать папку хранения')`);
    const info = await evaluate('return window.goldWork.getWorkspaceStorage()');
    assert.equal(info.path, await realpath(target)); assert.equal(info.error, undefined);
    assert.equal(await readFile(voice, 'utf8'), 'local-audio-fixture');
    const build = (await evaluate('return window.goldWork.getAppInfo()')).buildId;
    assert.equal(build, (await readFile('src/generated-build-identity.ts', 'utf8')).match(/APP_BUILD_ID = "([^"]+)"/)[1]);
    await evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent.includes('Выбрать папку хранения')).click()`);
    await until(`document.body.innerText.includes('Отменить перенос')`);
    assert.equal((await evaluate('return window.goldWork.getWorkspaceStorage()')).pendingPath, await realpath(next));
    assert.ok(await evaluate(`const hint = document.querySelector('.storage-help').getBoundingClientRect(); const status = document.querySelector('[role=status] .storage-path-row').getBoundingClientRect(); return hint.width > 500 && hint.height < 140 && hint.bottom <= status.top;`), 'Storage help must not overlap the selected path');
    win.removeAllListeners('show'); win.showInactive(); await wait(200);
    await writeFile(join(out, 'storage.png'), (await win.capturePage()).toPNG());
    await evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent.includes('Отменить перенос')).click()`);
    await until(`!document.body.innerText.includes('Отменить перенос')`);
    assert.equal((await evaluate('return window.goldWork.getWorkspaceStorage()')).pendingPath, undefined);
    console.log(JSON.stringify({ startupMove: 'ok', chooseAndCancel: 'ok', oldPathPreserved: true, build, capture: join(out, 'storage.png') }));
    clearTimeout(timeout);
    app.removeAllListeners('window-all-closed');
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
    // Chromium owns part of the profile until exit; never touch another profile.
    await rm(join(profile, 'workspace'), { recursive: true, force: true });
    await rm(destination, { recursive: true, force: true });
    app.exit(0);
  } catch (error) {
    console.error(String(error));
    if (win) console.error(await win.webContents.executeJavaScript('document.body.innerText.slice(-1800)'));
    clearTimeout(timeout); app.exit(1);
  }
});
