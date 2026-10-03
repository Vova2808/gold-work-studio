// Real selected media, isolated profile, no provider credentials or production writes.
import assert from 'node:assert/strict';
import { app, BrowserWindow } from 'electron';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, mkdir, link, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
const sourcePath = 'C:/Users/rosup/AppData/Roaming/@gold-work/desktop/projects.json';
const original = await readFile(sourcePath);
const project = JSON.parse(original.toString()).find(p => p.id === 'project_mu8iia3v_qhpe9y9');
assert.ok(project);
const profile = await mkdtemp(join(tmpdir(), 'gws-range-posters-ui-'));
const out = resolve('captures/stock-range-posters-ui'); await mkdir(out, { recursive: true });
project.scenes = project.scenes.slice(0, 15);
const media = join(profile, 'workspace/projects', project.id, 'fixture-media'); await mkdir(media, { recursive: true });
const copies = new Map();
const owned = async path => {
  if (!path) return path;
  if (copies.has(path)) return copies.get(path);
  const target = join(media, createHash('sha256').update(path).digest('hex') + extname(path));
  await link(path, target).catch(() => copyFile(path, target)); copies.set(path, target); return target;
};
for (const scene of project.scenes) {
  scene.videoPath = await owned(scene.videoPath); scene.imagePath = await owned(scene.imagePath); scene.audioPath = await owned(scene.audioPath);
  if (scene.documentary?.timing?.audioPath) scene.documentary.timing.audioPath = await owned(scene.documentary.timing.audioPath);
  if (scene.documentary?.selected?.localPath) scene.documentary.selected.localPath = await owned(scene.documentary.selected.localPath);
  for (const effect of scene.documentary?.effects ?? []) effect.filePath = await owned(effect.filePath);
}
await writeFile(join(profile, 'projects.json'), JSON.stringify([project]));
app.setPath('userData', profile);
delete process.env.ELECTRON_RENDERER_URL; delete process.env.PORTABLE_EXECUTABLE_DIR;
app.on('browser-window-created', (_event, win) => win.on('show', () => win.hide()));
createRequire(import.meta.url)(resolve('dist/main/index.cjs'));
app.whenReady().then(async () => {
  const timeout = setTimeout(() => { console.error('UI timeout'); app.exit(1); }, 45_000);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  let win;
  try {
    for (let n = 0; n < 100; n++) {
      win = BrowserWindow.getAllWindows()[0];
      if (win && !win.webContents.isLoadingMainFrame()) break;
      await wait(100);
    }
    assert.ok(win); win.setSize(1600, 1000); win.webContents.setAudioMuted(true); win.webContents.setBackgroundThrottling(false);
    win.removeAllListeners('show'); win.showInactive();
    const evaluate = body => win.webContents.executeJavaScript(`(async()=>{${body}})()`, true);
    const until = async expression => {
      for (let n = 0; n < 150; n++) { if (await evaluate(`return (${expression})`)) return; await wait(100); }
      throw new Error(`UI timeout: ${expression}`);
    };
    await until(`Boolean(document.querySelector('.startup-health-toast[open] .primary-button'))`);
    await evaluate(`document.querySelector('.startup-health-toast[open] .primary-button').click(); document.querySelector('[data-nav-key=projects]').click()`);
    await until(`Boolean(document.querySelector('.projects-table-row'))`);
    await evaluate(`document.querySelector('.projects-table-row').click()`);
    await until(`[...document.querySelectorAll('.project-expand button')].some(e=>e.textContent.includes('Таймлайн'))`);
    await evaluate(`[...document.querySelectorAll('.project-expand button')].find(e=>e.textContent.includes('Таймлайн')).click()`);
    await until(`document.querySelectorAll('.video-track .timeline-clip img').length === 15 && [...document.querySelectorAll('.video-track .timeline-clip img')].every(img=>img.src.includes('RangePosters')&&img.complete&&img.naturalWidth>0)`);
    const info = await evaluate('return window.goldWork.getAppInfo()');
    const expected = (await readFile('src/generated-build-identity.ts', 'utf8')).match(/APP_BUILD_ID = "([^"]+)"/)[1];
    assert.equal(info.buildId, expected);
    const images = await evaluate(`return [...document.querySelectorAll('.video-track .timeline-clip img')].map(img=>img.src)`);
    assert.equal(new Set(images).size, 15);
    await evaluate(`document.querySelector('.timeline-big-play').click()`);
    await until(`[...document.querySelectorAll('video')].some(video=>video.readyState>=2&&video.videoWidth>0&&video.currentTime>334)`);
    await wait(600);
    await evaluate(`document.querySelector('.timeline-big-play').click()`);
    await wait(300);
    await writeFile(join(out, 'range-posters.png'), (await win.capturePage()).toPNG());
    assert.deepEqual(await readFile(sourcePath), original);
    await writeFile(join(out, 'result.json'), JSON.stringify({ startup: 'ok', buildId: info.buildId, distinctPosters: images.length, productionProjectUnchanged: true }, null, 2));
    console.log(JSON.stringify({ startup: 'ok', buildId: info.buildId, distinctPosters: images.length, capture: join(out, 'range-posters.png') }));
    clearTimeout(timeout); app.exit(0);
  } catch (error) {
    console.error(String(error));
    if (win) console.error(JSON.stringify(await win.webContents.executeJavaScript(`({media:[...document.querySelectorAll('video')].map(v=>({time:v.currentTime,ready:v.readyState,width:v.videoWidth,error:v.error?.message})),text:document.body.innerText.slice(-1200)})`)));
    clearTimeout(timeout); app.exit(1);
  }
});
