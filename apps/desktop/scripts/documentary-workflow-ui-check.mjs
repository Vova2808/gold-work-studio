// Isolated rendered UI check. No credentials, provider requests or real projects.
import assert from 'node:assert/strict';
import { app, BrowserWindow } from 'electron';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDefaultProjectSettings, createDocumentarySettings } from '@gold-work/shared';

const profile = await mkdtemp(join(tmpdir(), 'gws-stock-workflow-ui-'));
await mkdir(resolve('captures'), { recursive: true });
const workspace = await mkdtemp(join(resolve('captures'), 'storage-ui-'));
const probe = join(workspace, 'storage-probe.txt');
await writeFile(probe, 'verified external workspace');
await writeFile(join(profile, 'storage-location.json'), JSON.stringify({ activePath: workspace, retainedPath: join(profile, 'workspace') }));
const capture = process.argv.includes('--capture');
const settings = createDefaultProjectSettings();
settings.assembly.documentary = createDocumentarySettings();
settings.assembly.transitionType = "none"; settings.assembly.fadeTransitions = false;
settings.stockVideoPercent = 90;
const now = new Date().toISOString();
const project = {
  id: 'stock-workflow-fixture', title: 'Stock workflow · isolated check', topic: 'Tractors',
  mediaMode: 'stock', mode: 'standard', language: 'English', aspectRatio: '16:9', status: 'failed', createdAt: now, updatedAt: now, settings,
  videoBrief: { prompt: 'Tractors', creationMode: 'script', readyScript: 'A tractor works. Its wheels turn. The field is wide.', competitorTranscripts: [] },
  scenes: ['A tractor works. ', 'Its wheels turn. ', 'The field is wide.'].map((text, order) => ({
    id: `scene-${order}`, order, title: `Scene ${order + 1}`, narration: text, imagePrompt: '', animationPrompt: '',
    durationSeconds: 3.064813333333334, status: order ? 'failed' : 'ready',
    audioPath: order ? undefined : join(profile, 'fixture-not-for-playback.mp3'),
    documentary: {
      version: 2, requirement: { text, entities: ['tractor'], years: [], queries: ['tractor field'], preferredKind: order === 2 ? 'image' : 'video', plannedBy: 'semantic' },
      candidates: [], verified: false, pinned: false, illustrative: false, reviewNote: '', layout: 'full', effects: [],
      caption: { text: '', enabled: false, position: 'bottom', animation: 'fade', fontSize: 42, color: '#ffffff', backgroundColor: '#000000', opacity: 1 },
    },
  })),
};
await writeFile(join(profile, 'projects.json'), JSON.stringify([project]));
await writeFile(join(profile, 'queue.json'), JSON.stringify(project.scenes.map((scene, index) => ({
  id: `task-${index}`, runId: 'fixture-run', projectId: project.id, sceneId: scene.id, kind: 'speech', label: `Озвучка · сцена ${index + 1}`,
  status: index ? 'cancelled' : 'done', attempts: index ? 0 : 1, maxAttempts: 3, progress: index ? 0 : 100, dependsOn: [], createdAt: now, updatedAt: now,
}))));
app.setPath('userData', profile);
delete process.env.ELECTRON_RENDERER_URL;
delete process.env.PORTABLE_EXECUTABLE_DIR;
app.on('browser-window-created', (_event, win) => win.on('show', () => win.hide()));
createRequire(import.meta.url)(resolve('dist/main/index.cjs'));
app.whenReady().then(async () => {
  const watchdog = setTimeout(() => { console.error('UI check exceeded 45 seconds'); app.exit(1); }, 45_000);
  let win;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  try {
    for (let n = 0; n < 150; n++) {
      win = BrowserWindow.getAllWindows()[0];
      if (win && !win.webContents.isLoadingMainFrame()) break;
      await wait(100);
    }
    assert.ok(win); win.setSize(1600, 1000); win.webContents.setBackgroundThrottling(false);
    if (capture) { win.removeAllListeners('show'); win.showInactive(); }
    const evaluate = source => win.webContents.executeJavaScript(`(async()=>{${source}})()`, true);
    const until = async expression => {
      for (let n = 0; n < 100; n++) { if (await evaluate(`return (${expression})`)) return; await wait(100); }
      throw new Error(`UI timeout: ${expression}`);
    };
    const click = expression => evaluate(`(${expression}).click()`);
    await until('Boolean(window.goldWork && document.querySelector("[data-nav-key=projects]"))');
    const info = await evaluate('return window.goldWork.getAppInfo()');
    assert.equal(info.workspacePath, join(workspace, 'projects'));
    const storage = await evaluate('return window.goldWork.getWorkspaceStorage()');
    assert.equal(storage.path, workspace); assert.equal(storage.retainedPath, join(profile, 'workspace'));
    assert.equal(await evaluate(`const response=await fetch(${JSON.stringify('gw-media://local/' + encodeURIComponent(probe))});return response.text();`), 'verified external workspace');
    assert.equal(await evaluate(`return (await fetch(${JSON.stringify('gw-media://local/' + encodeURIComponent(join(resolve('captures'), 'outside-storage.txt')))})).status;`), 403, 'An external storage choice does not expose the whole disk');
    const expected = (await readFile('src/generated-build-identity.ts', 'utf8')).match(/APP_BUILD_ID = "([^"]+)"/)[1];
    assert.equal(info.buildId, expected);
    await until(`Boolean(document.querySelector('.startup-health-toast[open] .primary-button'))`);
    await click(`document.querySelector('.startup-health-toast[open] .primary-button')`);
    await until(`!document.querySelector('.startup-health-toast[open]')`);
    await click(`document.querySelector('[data-nav-key=projects]')`);
    await until(`Boolean(document.querySelector('.projects-table-row'))`);
    await click(`document.querySelector('.projects-table-row')`);
    await until(`[...document.querySelectorAll('.project-expand button')].some(e=>e.textContent.includes('Настроить'))`);
    await click(`[...document.querySelectorAll('.project-expand button')].find(e=>e.textContent.includes('Настроить'))`);
    await until(`Boolean(document.querySelector('[data-flow-step=brief]'))`);
    await click(`document.querySelector('[data-flow-step=brief]')`);
    await until(`document.body.innerText.includes('Точная длительность появится после озвучки')`);
    assert.equal(await evaluate(`return document.body.innerText.includes('Программа создаёт визуальные промпты и образы персонажей')`), false);
    assert.equal(await evaluate(`return document.querySelectorAll('.auto-stock-toast').length`), 0);
    await click(`document.querySelector('[data-flow-step=scenario]')`);
    await until(`document.body.innerText.includes('≈ 3,06 с · оценка')`);
    assert.equal(await evaluate(`return document.body.innerText.includes('3.064813333333334')`), false);
    await click(`document.querySelector('[data-flow-step=settings]')`);
    await until(`document.body.innerText.includes('Автоподобрать сток и собрать')`);
    assert.equal(await evaluate(`return ['Переподобрать по новому соотношению','Подобрать stock без запуска','Проверить / заменить вручную'].some(text=>document.body.innerText.includes(text))`), false);
    assert.equal(await evaluate(`return document.querySelectorAll('.documentary-settings input[type=number]').length`), 0, 'Cut has no duration');
    await evaluate(`const select=document.querySelector('.documentary-settings select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'mix');select.dispatchEvent(new Event('change',{bubbles:true}));`);
    await until(`document.querySelectorAll('.documentary-settings input[type=number]').length === 1`);
    await evaluate(`const select=document.querySelector('.documentary-settings select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'none');select.dispatchEvent(new Event('change',{bubbles:true}));`);
    await until(`document.querySelectorAll('.documentary-settings input[type=number]').length === 0`);
    assert.deepEqual(await evaluate(`return [...document.querySelectorAll('[data-flow-step]')].map(e=>e.dataset.flowStep)`), ['brief', 'scenario', 'settings', 'materials', 'production', 'editor', 'export']);
    assert.equal(await evaluate(`return document.querySelector('[data-flow-step=materials]').disabled || document.querySelector('[data-flow-step=editor]').disabled`), false);
    await click(`document.querySelector('[data-flow-step=materials]')`);
    await until(`document.querySelector('[data-flow-step=materials]')?.getAttribute('aria-current') === 'step'`);
    await click(`document.querySelector('[data-flow-step=editor]')`);
    await until(`Boolean(document.querySelector('[data-flow-step=editor][aria-current=step]'))`);
    await click(`[...document.querySelectorAll('[data-flow-step=production]')].at(-1)`);
    await until(`Boolean(document.querySelector('[aria-label="Производство Stock"]'))`);
    const body = await evaluate('return document.body.innerText');
    assert.match(body, /Производство остановлено. Готовые файлы сохранены/);
    assert.match(body, /Цель: 90% видео \/ 10% фото/);
    assert.match(body, /Ожидает готовности озвучки/);
    assert.equal(await evaluate(`return document.querySelectorAll('.stock-production-overview .production-stage-grid article').length`), 3);
    await click(`document.querySelectorAll('[aria-label="Этапы производства Stock"] button')[1]`);
    await until(`document.querySelectorAll('.stock-material-queue article').length === 3`);
    const materialProgress = { projectId: project.id, phase: 'applying', completed: 1, total: 3, selected: 1, skipped: 0, failed: 0, message: 'Проверяю материал' };
    win.webContents.send('stock:auto-progress', materialProgress);
    await until(`[...document.querySelectorAll('.queue-project-controls button')].some(e=>e.textContent.trim()==='Стоп')`);
    assert.equal(await evaluate(`return [...document.querySelectorAll('.queue-project-controls button')].some(e=>e.textContent.includes('Пауза'))`), false);
    win.webContents.send('stock:auto-progress', { ...materialProgress, phase: 'stopped', message: 'Подбор остановлен пользователем. Готовые материалы сохранены.' });
    await until(`!document.querySelector('.queue-project-controls')`);
    if (capture) {
      await wait(700); // Let the compositor paint the final page before capturing it.
      await mkdir('captures/stock-workflow', { recursive: true });
      await writeFile('captures/stock-workflow/production.png', (await win.webContents.capturePage()).toPNG());
    }
    console.log(JSON.stringify({ result: 'ok', buildId: info.buildId, checked: ['Stock preparation copy', 'rounded estimated timing', 'single-button settings', 'all seven tabs', 'materials and editor navigation', 'three production stages', 'material queue', 'user Stop status'], profile }));
    clearTimeout(watchdog); app.exit(0);
  } catch (error) {
    console.error(String(error));
    if (win) {
      console.error(await win.webContents.executeJavaScript('document.body.innerText.slice(0, 4500)').catch(() => 'Renderer unavailable'));
    }
    clearTimeout(watchdog); app.exit(1);
  }
});
