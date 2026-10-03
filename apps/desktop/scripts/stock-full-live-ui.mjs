import assert from 'node:assert/strict';
import { app, BrowserWindow } from 'electron';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

// Explicitly authorized paid acceptance, through the real creation/settings UI.
// --resume continues the one recorded project; never create another on failure.
assert.ok(process.argv.includes('--paid'), 'Pass --paid only with user authorization');
const profile = 'C:/Users/rosup/AppData/Roaming/@gold-work/desktop';
const out = resolve('captures/stock-full-live-20260920'); await mkdir(out, { recursive: true });
const originalId = 'project_mu8iia3v_qhpe9y9';
const originals = JSON.parse(await readFile(join(profile, 'projects.json'), 'utf8'));
const original = originals.find(project => project.id === originalId); assert.ok(original?.videoBrief?.readyScript);
const channel = JSON.parse(await readFile(join(profile, 'database/channel-profiles.json'), 'utf8')).find(item => item.id === original.channelProfileId);
assert.ok(channel); assert.equal(original.mediaMode, 'stock');
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const originalHash = fingerprint(original), originalPaths = [...new Set(original.scenes.flatMap(scene => [scene.audioPath, scene.imagePath, scene.videoPath, scene.documentary?.selected?.localPath]).filter(Boolean))];
for (const path of originalPaths) assert.ok((await stat(path)).isFile(), `Original missing before test: ${path}`);
const resume = process.argv.includes('--resume');
const videoTarget = Number(process.argv.find(arg => arg.startsWith('--video-target='))?.split('=')[1] ?? 90);
assert.ok(Number.isInteger(videoTarget) && videoTarget >= 80 && videoTarget <= 100);
let state = resume ? JSON.parse(await readFile(join(out, 'state.json'), 'utf8')) : { title: `SS United States — полный тест ${new Date().toLocaleString('ru-RU')}`, startedAt: new Date().toISOString() };
if (!resume) {
  const existing = await readFile(join(out, 'state.json'), 'utf8').then(JSON.parse, () => undefined);
  assert.ok(!existing?.projectId, 'A live project already exists; use --resume');
  await writeFile(join(out, 'original-project.json'), JSON.stringify(original, null, 2));
}
await writeFile(join(out, 'state.json'), JSON.stringify(state, null, 2));
app.setPath('userData', profile); delete process.env.ELECTRON_RENDERER_URL; delete process.env.PORTABLE_EXECUTABLE_DIR;
app.on('browser-window-created', (_event, win) => win.on('show', () => win.hide()));
createRequire(import.meta.url)(resolve('dist/main/index.cjs'));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let win, crashed = false;
let runStartedAt;
const evaluate = source => win.webContents.executeJavaScript(`(async()=>{${source}})()`, true);
const api = (method, ...args) => evaluate(`return window.goldWork[${JSON.stringify(method)}](...${JSON.stringify(args)})`);
async function until(expression, timeout = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeout) { if (await evaluate(`return Boolean(${expression})`)) return; await wait(250); }
  throw new Error(`UI timeout: ${expression}`);
}
const click = expression => evaluate(`const element=(${expression});if(!element||element.disabled)throw new Error('Missing/disabled button');element.click();`);
const button = text => `[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)})`;
const set = (selector, value) => evaluate(`const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('Missing input');const p=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:e instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));`);
async function capture(name) { await writeFile(join(out, `${name}.png`), (await win.webContents.capturePage()).toPNG()); }
async function preserved() {
  const saved = JSON.parse(await readFile(join(profile, 'projects.json'), 'utf8')).find(project => project.id === originalId);
  assert.equal(fingerprint(saved), originalHash, 'Original project must remain unchanged');
  for (const path of originalPaths) assert.ok((await stat(path)).isFile(), `Original reference removed: ${path}`);
}
app.whenReady().then(async () => {
  for (let i = 0; i < 150; i++) { win = BrowserWindow.getAllWindows()[0]; if (win?.webContents.getURL() && !win.webContents.isLoadingMainFrame()) break; await wait(100); }
  assert.ok(win); win.setSize(1600, 1000); win.webContents.setBackgroundThrottling(false);
  // Windows may never resolve capturePage for a never-painted hidden surface.
  win.removeAllListeners('show'); win.showInactive();
  win.webContents.on('render-process-gone', () => { crashed = true; });
  await until('window.goldWork && document.querySelector("[data-nav-key=channels]")');
  state.build = (await api('getAppInfo')).buildId;
  if (process.argv.includes('--verify-only')) {
    // Let startup health reads drain and the normal 500 ms idle maintenance
    // finish; immediate app.exit would skip the product's post-render cleanup.
    await wait(45000); await api('getQueue');
    await preserved(); await capture('startup-verified');
    console.log(JSON.stringify({ build: state.build, originalPreserved: true, productionStarted: false })); app.exit(0); return;
  }
  await evaluate(`window.__liveProgress={};window.goldWork.onAutoStockProgress(p=>window.__liveProgress=p);`);
  await wait(1200); await evaluate(`document.querySelector('.startup-health-toast[open] .primary-button')?.click();`);
  const recheck = process.argv.find(argument => argument.startsWith('--recheck-scenes='))?.split('=')[1].split(',').map(Number);
  if (resume && recheck?.length) {
    assert.ok(recheck.every(number => Number.isInteger(number) && number > 0));
    const current = await api('getProject', state.projectId);
    await writeFile(join(out, `before-recheck-${Date.now()}.json`), JSON.stringify(current, null, 2));
    await api('updateProject', state.projectId, { scenes: current.scenes.map(scene => !scene.documentary?.pinned && recheck.includes(scene.order + 1)
      ? { ...scene, documentary: { ...scene.documentary, verified: false, autoError: 'Найден промах визуальной проверки; исходник сохранён, нужен новый проверенный диапазон.' } } : scene) });
  }
  if (resume && process.argv.includes('--replan-missing') && state.replannedMissingBuild !== state.build) {
    const current = await api('getProject', state.projectId);
    await writeFile(join(out, `before-replan-${state.build}.json`), JSON.stringify(current, null, 2));
    const ids = current.scenes.filter(scene => !scene.documentary?.verified && !scene.documentary?.pinned).map(scene => scene.id);
    // Only the unfinished search plan is rebuilt after the observed attribution
    // bug. Keep narration, voices, ready selections and every paid checkpoint.
    await api('updateProject', state.projectId, { scenes: current.scenes.map(scene => {
      if (!ids.includes(scene.id)) return scene;
      const { plannedBy: _previous, ...requirement } = scene.documentary.requirement;
      return { ...scene, documentary: { ...scene.documentary, requirement } };
    }) });
    state.replannedMissingBuild = state.build;
    await writeFile(join(out, 'state.json'), JSON.stringify(state, null, 2));
    console.log(JSON.stringify({ stage: 'replan-unfinished', scenes: ids.length, voicesPreserved: current.scenes.filter(scene => scene.audioPath).length }));
  }
  if (!state.projectId) {
    await click(`document.querySelector('[data-nav-key=channels]')`);
    await until(`[...document.querySelectorAll('.channel-card')].some(e=>e.textContent.includes(${JSON.stringify(channel.name)}))`);
    await click(`[...document.querySelectorAll('.channel-card')].find(e=>e.textContent.includes(${JSON.stringify(channel.name)}))`);
    await until(button('Новый ролик')); await click(button('Новый ролик'));
    await until(`document.querySelector('.video-dialog')`);
    await set('.video-dialog input[placeholder="Рабочее название ролика"]', state.title);
    await set('.video-dialog textarea', original.videoBrief.readyScript);
    const voiceChoice = `${original.settings.voice.provider === 'elevenlabs' ? 'lumean' : 'edge'}:${original.settings.voice.voice}`;
    await until(`[...document.querySelectorAll('.video-voice-controls select option')].some(e=>e.value===${JSON.stringify(voiceChoice)})`, 60000);
    await set('.video-voice-controls select', voiceChoice);
    await click(button('Озвучить и измерить'));
    await until(`document.querySelector('.voice-calibration-ready') || document.querySelector('.voice-calibration-error')`, 180000);
    assert.equal(await evaluate(`return Boolean(document.querySelector('.voice-calibration-ready'))`), true, await evaluate(`return document.querySelector('.voice-calibration-error')?.textContent`));
    await capture('01-create'); await click(button('Создать и разбить на кадры'));
    for (let i = 0; i < 120; i++) { const created = (await api('listProjects')).find(project => project.title === state.title); if (created) { state.projectId = created.id; break; } await wait(500); }
    assert.ok(state.projectId); await writeFile(join(out, 'state.json'), JSON.stringify(state, null, 2));
    console.log(JSON.stringify({ stage: 'created', projectId: state.projectId, build: state.build }));
    const planningStarted = Date.now(); let last = -1;
    for (;;) {
      const project = await api('getProject', state.projectId), count = project.scenes.filter(scene => scene.documentary?.requirement.plannedBy === 'semantic').length;
      if (count !== last) { last = count; console.log(JSON.stringify({ stage: 'planning', scenes: project.scenes.length, planned: count, seconds: Math.round((Date.now() - planningStarted) / 1000) })); }
      if (count && count === project.scenes.length) break;
      const failure = await evaluate(`return document.querySelector('.scenario-build-error,.error-toast')?.textContent`);
      if (failure) throw new Error(failure);
      if (Date.now() - planningStarted > 12 * 60_000) throw new Error('Script preparation timeout; checkpoints preserved');
      await wait(2000);
    }
  } else {
    await click(`document.querySelector('[data-nav-key=projects]')`);
    await until(`document.querySelector('[data-project-id="${state.projectId}"]') || [...document.querySelectorAll('.projects-table-row')].some(e=>e.textContent.includes(${JSON.stringify(state.title)}))`);
    await click(`[...document.querySelectorAll('.projects-table-row')].find(e=>e.textContent.includes(${JSON.stringify(state.title)}))`);
    await until(`[...document.querySelectorAll('.project-expand button')].some(e=>e.textContent.includes('Настроить'))`);
    await click(`[...document.querySelectorAll('.project-expand button')].find(e=>e.textContent.includes('Настроить'))`);
  }
  const planned = await api('getProject', state.projectId); assert.equal(planned.videoBrief.readyScript, original.videoBrief.readyScript);
  await until(`document.querySelector('[data-flow-step=settings]')`);
  await evaluate(`const e=document.querySelector('[data-flow-step=settings]');if(!e.disabled)e.click();`);
  const productionButton = `document.querySelector('.sticky-actions.editor-actions .generate-button')`;
  await until(productionButton);
  // Settings use the same configured voice/services; no provider/account edits.
  await evaluate(`const field=[...document.querySelectorAll('.field')].find(e=>e.textContent.includes('СООТНОШЕНИЕ STOCK'));const e=field?.querySelector('input[type=range]');if(!e)throw new Error('Ratio field missing');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(String(videoTarget))});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));`);
  await set('.documentary-settings select', 'none');
  await capture('02-settings');
  runStartedAt = new Date().toISOString();
  state.runs ??= []; state.runs.push({ startedAt: runStartedAt, build: state.build, resumed: resume, videoTarget });
  await writeFile(join(out, 'state.json'), JSON.stringify(state, null, 2));
  await click(productionButton);
  state.productionStartedAt ??= new Date().toISOString(); await writeFile(join(out, 'state.json'), JSON.stringify(state, null, 2));
  let lastPrint = 0;
  for (;;) {
    await wait(3000); assert.equal(crashed, false, 'Renderer crashed');
    // Optional local QA control; use the production Stop/drain API, never kill
    // a process holding an uncertain paid request. Old requests do not stop a resume.
    const stopRequest = await stat(join(out, 'stop.request')).catch(() => undefined);
    if (stopRequest && stopRequest.mtimeMs >= Date.parse(runStartedAt)) {
      await api('stopGeneration', state.projectId);
      throw new Error('QA requested a graceful stop; in-flight work drained and checkpoints preserved');
    }
    const project = await api('getProject', state.projectId), tasks = (await api('getQueue')).filter(task => task.projectId === state.projectId);
    const progress = await evaluate('return window.__liveProgress');
    const running = tasks.filter(task => ['running', 'pending', 'retry_wait'].includes(task.status));
    const failed = tasks.filter(task => ['failed', 'blocked'].includes(task.status));
    if (Date.now() - lastPrint > 14000) {
      lastPrint = Date.now(); console.log(JSON.stringify({ stage: progress.phase ?? project.status, seconds: Math.round((Date.now() - Date.parse(state.productionStartedAt)) / 1000), currentRunSeconds: Math.round((Date.now() - Date.parse(runStartedAt)) / 1000), voice: project.scenes.filter(scene => scene.audioPath).length,
        selected: project.scenes.filter(scene => scene.documentary?.verified).length, total: project.scenes.length, running: running.length, failed: failed.length, message: progress.message?.replace(/https?:\/\/\S+/g, '[source]'), assembly: tasks.findLast(task => task.kind === 'assemble')?.progress }));
    }
    if (failed.length && !running.length) throw new Error(failed.map(task => `${task.kind}: ${task.error ?? task.status}`).join('\n'));
    if (progress.phase === 'failed' && !running.length) throw new Error(progress.message);
    if (progress.phase === 'stopped' && !running.length) throw new Error('Production was stopped; checkpoints preserved');
    if (progress.phase === 'complete' && progress.failed && !running.length) throw new Error(progress.message);
    if (project.outputPath && project.status === 'complete') {
      await preserved(); await capture('03-complete');
      Object.assign(state.runs.at(-1), { endedAt: new Date().toISOString(), result: 'complete' });
      await writeFile(join(out, 'state.json'), JSON.stringify(state, null, 2));
      const result = { ...state, completedAt: new Date().toISOString(), elapsedSeconds: (Date.now() - Date.parse(state.startedAt)) / 1000, outputPath: project.outputPath, bytes: (await stat(project.outputPath)).size,
        currentRunSeconds: (Date.now() - Date.parse(runStartedAt)) / 1000,
        scenes: project.scenes.length, verified: project.scenes.filter(scene => scene.documentary?.verified).length, templates: project.scenes.reduce((all, scene) => { const key = scene.documentary?.template ?? 'full'; all[key] = (all[key] ?? 0) + 1; return all; }, {}), rendererSurvived: !crashed, originalPreserved: true };
      await writeFile(join(out, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result)); await wait(4000); app.exit(0);
    }
    // Bound one active run, not time spent developing or relocating storage.
    // The full original elapsed time remains in progress/result above.
    if (Date.now() - Date.parse(runStartedAt) > 2 * 60 * 60_000) {
      await api('stopGeneration', state.projectId);
      throw new Error('Two-hour test boundary reached; production drained and checkpoints preserved');
    }
  }
}).catch(async error => {
  const message = String(error).replace(/https?:\/\/\S+/g, '[source]'); console.error(message);
  if (runStartedAt) { Object.assign(state.runs.at(-1), { endedAt: new Date().toISOString(), result: 'failed', message }); await writeFile(join(out, 'state.json'), JSON.stringify(state, null, 2)); }
  await writeFile(join(out, 'failure.json'), JSON.stringify({ ...state, failedAt: new Date().toISOString(), message }, null, 2));
  if (win && !win.isDestroyed()) { await capture('failure').catch(() => {}); await preserved().catch(error => console.error(String(error))); }
  // Normal failures above are observed only after outstanding queue work drains.
  app.exit(1);
});
