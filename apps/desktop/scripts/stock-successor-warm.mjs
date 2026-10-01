import assert from 'node:assert/strict';
import { app, BrowserWindow, ipcMain } from 'electron';
import { installStockMainApi } from './stock-main-api.mjs';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, stat, appendFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

assert.ok(process.argv.includes('--paid'), 'Explicit paid test flag required');
const profile = 'C:/Users/rosup/AppData/Roaming/@gold-work/desktop';
const projectId = 'project_muihr14p_xsah7wf';
const attempt = process.argv.find(value => value.startsWith('--attempt='))?.split('=')[1] ?? '1';
assert.match(attempt, /^[1-9]\d*$/);
const out = resolve(`captures/stock-successor-warm-20260926${attempt === '1' ? '' : `-attempt-${attempt}`}`);
await mkdir(out, { recursive: true });
assert.equal(await stat(join(out, 'events.jsonl')).catch(() => null), null, 'Use a new attempt directory; preserve previous evidence');
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const before = JSON.parse(await readFile(join(profile, 'projects.json'), 'utf8'));
const original = before.find(project => project.id === projectId);
assert.equal(original.scenes.filter(scene => scene.audioPath).length, 114);
const voices = original.scenes.map(scene => ({ id: scene.id, path: scene.audioPath }));
const preserved = before.filter(project => project.id !== projectId).map(project => ({ id: project.id, hash: fingerprint(project) }));
const clean = value => String(value).replace(/https?:\/\/\S+/g, '[URL]');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const event = async (stage, details = {}) => {
  const row = { at: new Date().toISOString(), stage, ...details };
  await appendFile(join(out, 'events.jsonl'), JSON.stringify(row) + '\n');
  console.log(JSON.stringify(row));
};
await writeFile(join(out, `before-${Date.now()}.json`), JSON.stringify(original));
await writeFile(join(out, 'preserved-project-fingerprints.json'), JSON.stringify(preserved));
app.setPath('userData', profile);
delete process.env.ELECTRON_RENDERER_URL;
delete process.env.PORTABLE_EXECUTABLE_DIR;
const mainApi = installStockMainApi(ipcMain);
createRequire(import.meta.url)(resolve('dist/main/index.cjs'));
let win, crashed = false, finished = false, stopRequested = false, monitor;
const api = (method, ...args) => mainApi.call(method, ...args);
const started = Date.now();
app.whenReady().then(async () => {
  for (let i = 0; i < 150; i++) {
    win = BrowserWindow.getAllWindows()[0];
    if (win?.webContents.getURL() && !win.webContents.isLoadingMainFrame()) break;
    await wait(200);
  }
  assert.ok(win);
  mainApi.attach(win.webContents);
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on('render-process-gone', () => { crashed = true; });
  const info = await api('getAppInfo');
  assert.equal(info.mockMode, false);
  assert.equal((await api('getQueue')).some(task => ['running', 'pending', 'retry_wait'].includes(task.status)), false);
  await event('started', { projectId, build: info.buildId, reusedVoices: voices.length, mode: 'warm recovery, not cold TTS benchmark' });
  let monitorError;
  monitor = (async () => {
    while (!finished) {
      const project = await api('getProject', projectId);
      const progress = mainApi.progress();
      const tasks = (await api('getQueue')).filter(task => task.projectId === projectId);
      assert.equal(crashed, false, 'Renderer crash');
      assert.ok(tasks.filter(task => task.kind === 'speech').every(task => task.status === 'done'), 'Warm recovery must not order new TTS');
      const state = { projectId, build: info.buildId, elapsedSeconds: (Date.now() - started) / 1000, selected: project.scenes.filter(scene => scene.documentary?.verified).length,
        identities: project.scenes.filter(scene => scene.documentary?.requirement.identities !== undefined).length,
        status: project.status, phase: progress?.phase, message: progress?.message ? clean(progress.message) : undefined };
      await writeFile(join(out, 'state.json'), JSON.stringify(state, null, 2));
      await event('progress', state);
      const stop = await stat(join(out, 'stop.request')).catch(() => null);
      if (stop && stop.mtimeMs >= started || Date.now() - started > 60 * 60_000) {
        stopRequested = true;
        await api('stopGeneration', projectId);
        throw new Error('Warm run stopped with checkpoints preserved');
      }
      await wait(15000);
    }
  })();
  monitor.catch(error => { monitorError = error; });
  await api('startGeneration', projectId);
  if (stopRequested || monitorError) throw monitorError || new Error('Warm run stopped with checkpoints preserved');
  let project;
  for (;;) {
    if (monitorError) throw monitorError;
    project = await api('getProject', projectId);
    if (project.status === 'complete' && project.outputPath) {
      assert.equal(project.scenes.every(scene => scene.includeInAssembly === false || scene.documentary?.verified), true, 'All included scenes must remain verified');
      assert.ok((await api('getQueue')).some(task => task.projectId === projectId && task.kind === 'assemble' && task.status === 'done' && Date.parse(task.updatedAt) >= started), 'A previous Final cannot pass the new run');
      assert.ok((await stat(project.outputPath)).mtimeMs >= started, 'Final must have been rendered in this run');
      break;
    }
    const tasks = (await api('getQueue')).filter(task => task.projectId === projectId);
    if (!tasks.some(task => ['running', 'pending', 'retry_wait'].includes(task.status))) throw new Error('Production stopped without Final');
    await wait(3000);
  }
  finished = true;
  const result = { projectId, build: info.buildId, elapsedSeconds: (Date.now() - started) / 1000, outputPath: project.outputPath,
    bytes: (await stat(project.outputPath)).size, reusedVoices: 114, mode: 'warm recovery', method: 'registered production main handlers; not renderer IPC or UI acceptance' };
  await writeFile(join(out, 'result.json'), JSON.stringify(result, null, 2));
  await event('complete', result);
}).catch(async error => {
  finished = true;
  await event('failed', { message: clean(error.stack ?? error) });
  if (win && !win.isDestroyed()) await api('stopGeneration', projectId).catch(() => {});
  await writeFile(join(out, 'failure.json'), JSON.stringify({ at: new Date().toISOString(), message: clean(error.stack ?? error) }, null, 2));
  process.exitCode = 1;
}).finally(async () => {
  finished = true;
  await monitor?.catch(() => {});
  const after = JSON.parse(await readFile(join(profile, 'projects.json'), 'utf8'));
  for (const saved of preserved) assert.equal(fingerprint(after.find(project => project.id === saved.id)), saved.hash, `Other project changed: ${saved.id}`);
  const current = after.find(project => project.id === projectId);
  for (const voice of voices) assert.equal(current.scenes.find(scene => scene.id === voice.id).audioPath, voice.path, 'Saved voice must remain unchanged');
  await writeFile(join(out, 'project-snapshot.json'), JSON.stringify(current));
  app.exit(process.exitCode || 0);
});
