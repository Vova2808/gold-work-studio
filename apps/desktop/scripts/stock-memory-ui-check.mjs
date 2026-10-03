// Full-size real project on an isolated profile; media are links, no paid calls.
import assert from 'node:assert/strict';
import { app, BrowserWindow, dialog } from 'electron';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, mkdir, link, copyFile, stat, rm, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
const sourcePath = 'C:/Users/rosup/AppData/Roaming/@gold-work/desktop/projects.json';
const original = await readFile(sourcePath);
const projects = JSON.parse(original.toString());
const project = projects.find(p => p.id === 'project_mu8iia3v_qhpe9y9');
assert.equal(project.scenes.length, 107);
const profile = await mkdtemp(join(tmpdir(), 'gws-stock-memory-ui-'));
const out = resolve('captures/stock-memory-ui'); await mkdir(out, { recursive: true });
const media = join(profile, 'workspace/projects', project.id, 'fixture-media'); await mkdir(media, { recursive: true });
const copies = new Map();
const owned = async path => {
  if (!path) return path;
  if (copies.has(path)) return copies.get(path);
  const target = join(media, createHash('sha256').update(path).digest('hex') + extname(path));
  await link(path, target).catch(async error => {
    if ((await stat(path)).size > 2 * 1024 * 1024) throw error; // Never duplicate a large movie just for a UI fixture.
    await copyFile(path, target);
  });
  copies.set(path, target); return target;
};
for (const scene of project.scenes) {
  scene.videoPath = await owned(scene.videoPath); scene.imagePath = await owned(scene.imagePath); scene.audioPath = await owned(scene.audioPath);
  if (scene.documentary?.timing?.audioPath) scene.documentary.timing.audioPath = await owned(scene.documentary.timing.audioPath);
  if (scene.documentary?.selected?.localPath) scene.documentary.selected.localPath = await owned(scene.documentary.selected.localPath);
  for (const effect of scene.documentary?.effects ?? []) effect.filePath = await owned(effect.filePath);
}
project.status = 'ready';
project.updatedAt = new Date().toISOString();
await writeFile(join(profile, 'projects.json'), JSON.stringify(projects));
app.setPath('userData', profile);
delete process.env.ELECTRON_RENDERER_URL; delete process.env.PORTABLE_EXECUTABLE_DIR;
app.on('browser-window-created', (_event, win) => win.on('show', () => win.hide()));
createRequire(import.meta.url)(resolve('dist/main/index.cjs'));
app.whenReady().then(async () => {
  const timeout = setTimeout(() => { console.error('Stock memory UI timeout'); app.exit(1); }, 115_000);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  let win;
  try {
    for (let n = 0; n < 100; n++) {
      win = BrowserWindow.getAllWindows()[0];
      if (win && !win.webContents.isLoadingMainFrame()) break;
      await wait(100);
    }
    assert.ok(win); win.setSize(1600, 1000); win.webContents.setBackgroundThrottling(false);
    const evaluate = body => win.webContents.executeJavaScript(`(async()=>{${body}})()`, true);
    const until = async expression => {
      for (let n = 0; n < 150; n++) { if (await evaluate(`return (${expression})`)) return; await wait(100); }
      throw new Error(`UI timeout: ${expression}`);
    };
    await until(`Boolean(document.querySelector('.startup-health-toast[open] .primary-button'))`);
    await evaluate(`document.querySelector('.startup-health-toast[open] .primary-button').click(); document.querySelector('[data-nav-key=projects]').click()`);
    await until(`Boolean(document.querySelector('.projects-table-row'))`);
    await evaluate(`document.querySelector('.projects-table-row').click()`);
    await until(`[...document.querySelectorAll('.project-expand button')].some(e=>e.textContent.includes('Настроить'))`);
    await evaluate(`window.sceneClones=0; const clone=window.structuredClone; window.structuredClone=(value,...rest)=>{if(Array.isArray(value)&&value[0]?.narration!==undefined) window.sceneClones++;return clone(value,...rest)}; [...document.querySelectorAll('.project-expand button')].find(e=>e.textContent.includes('Настроить')).click()`);
    await until(`Boolean(document.querySelector('[data-flow-step=materials]'))`);
    await evaluate(`document.querySelector('[data-flow-step=materials]').click()`);
    await until(`document.querySelectorAll('.scenario-material-card').length===107`);
    assert.equal(await evaluate(`return document.querySelectorAll('.scenario-materials-page video').length`), 0);
    const snapshot = await evaluate(`return window.goldWork.getProjectChanges()`);
    assert.equal(snapshot.projects.length, 38);
    const unchanged = await evaluate(`return window.goldWork.getProjectChanges(${JSON.stringify(snapshot.revision)})`);
    assert.equal(unchanged.projects, undefined, 'Idle polling must not transfer the registry again');
    const heapBefore = await evaluate('return performance.memory.usedJSHeapSize');
    for (let i = 0; i < 20; i++) {
      win.webContents.send('stock:auto-progress', { projectId: project.id, phase: 'searching', completed: 100, total: 107, selected: 100, skipped: 0, failed: 0, message: `Fixture progress ${i}` });
      await wait(35);
    }
    assert.equal(await evaluate('return window.sceneClones'), 0, 'Progress must not deep-clone every scene');
    assert.equal(await evaluate(`return document.body.innerText.includes('Что-то пошло не так')`), false);
    await evaluate(`document.querySelectorAll('.scenario-video-preview')[0].click()`);
    await until(`document.querySelector('.scenario-materials-page video')?.readyState>=2`);
    await evaluate(`document.querySelectorAll('.scenario-video-preview')[0].click()`);
    await until(`document.querySelector('.scenario-materials-page video')?.readyState>=2`);
    assert.equal(await evaluate(`return document.querySelectorAll('.scenario-materials-page video').length`), 1);
    // Background updates still arrive after a file revision change.
    project.updatedAt = new Date().toISOString(); project.title += ' — isolated update';
    // Match the repository's atomic saves: polling must never see half a JSON.
    await writeFile(join(profile, 'projects.next.json'), JSON.stringify(projects));
    await rename(join(profile, 'projects.next.json'), join(profile, 'projects.json'));
    await until(`document.body.innerText.includes('isolated update')`);
    const delta = await evaluate(`return window.goldWork.getProjectChanges(${JSON.stringify(snapshot.revision)})`);
    assert.equal(delta.projects.length, 1, 'Only the changed project crosses IPC');
    assert.equal(delta.projectIds.length, 38);
    assert.equal(await evaluate('return window.sceneClones'), 0);
    assert.ok(await evaluate(`const preview=document.querySelector('.scenario-video-preview'); const box=preview.getBoundingClientRect(); const parent=preview.parentElement.getBoundingClientRect(); return box.width<=parent.width+1 && box.height<300;`), 'Poster preview must fit its card');
    const heapAfter = await evaluate('return performance.memory.usedJSHeapSize');
    win.removeAllListeners('show'); win.showInactive(); await wait(150);
    await writeFile(join(out, 'materials.png'), (await win.capturePage()).toPNG());
    await evaluate(`document.querySelector('[data-nav-key=projects]').click()`);
    await until(`document.querySelector('.project-storage-size')?.textContent.includes('ГБ')`);
    await writeFile(join(out, 'projects.png'), (await win.capturePage()).toPNG());
    await evaluate(`document.querySelector('[data-nav-key=settings]').click()`);
    await until(`Boolean(document.querySelector('.settings-menu'))`);
    await evaluate(`[...document.querySelectorAll('.settings-menu button')].find(e=>e.textContent.includes('Хранение')).click()`);
    await until(`Boolean(document.querySelector('.storage-usage-list[aria-busy=false] button'))`);
    await evaluate(`[...document.querySelectorAll('.storage-usage-list button')].find(e=>e.textContent.includes('projects')).click()`);
    await until(`Boolean([...document.querySelectorAll('.storage-usage-list button')].find(e=>e.textContent.includes('isolated update')))`);
    await evaluate(`[...document.querySelectorAll('.storage-usage-list button')].find(e=>e.textContent.includes('isolated update')).click()`);
    await until(`Boolean([...document.querySelectorAll('.storage-usage-list button')].find(e=>e.textContent.includes('fixture-media')))`);
    await writeFile(join(out, 'storage.png'), (await win.capturePage()).toPNG());
    const ramMiB = app.getAppMetrics().filter(metric => metric.type === 'Tab').map(metric => Math.round(metric.memory.workingSetSize / 1024));
    let recoveryDialogs = 0;
    dialog.showMessageBox = async () => { recoveryDialogs++; return { response: 0, checkboxChecked: false }; };
    win.webContents.forcefullyCrashRenderer();
    await wait(1500);
    await until(`Boolean(document.querySelector('[data-nav-key=projects]'))`);
    assert.equal(recoveryDialogs, 1, 'A crashed frame offers recovery instead of staying blank');
    const build = (await evaluate('return window.goldWork.getAppInfo()')).buildId;
    assert.equal(build, (await readFile('src/generated-build-identity.ts', 'utf8')).match(/APP_BUILD_ID = "([^"]+)"/)[1]);
    assert.deepEqual(await readFile(sourcePath), original);
    const result = { build, scenes: 107, projects: 38, idleProjectPayload: false, deltaProjects: 1, sceneClones: 0, simultaneousVideos: 1, heapBeforeMiB: Math.round(heapBefore / 1024 ** 2), heapAfterMiB: Math.round(heapAfter / 1024 ** 2), ramMiB, storageDrilldown: true, crashRecovery: true, productionUnchanged: true };
    await writeFile(join(out, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
    clearTimeout(timeout); app.removeAllListeners('window-all-closed');
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
    await rm(join(profile, 'workspace'), { recursive: true, force: true });
    app.exit(0);
  } catch (error) {
    console.error(String(error));
    if (win) console.error(await win.webContents.executeJavaScript('document.body.innerText.slice(-1800)'));
    clearTimeout(timeout); app.exit(1);
  }
});
