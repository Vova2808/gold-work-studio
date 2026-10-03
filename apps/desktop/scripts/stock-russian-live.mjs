import assert from 'node:assert/strict';
import { app, BrowserWindow } from 'electron';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, stat, appendFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { estimateNarrationDurationSeconds } from '@gold-work/shared';

// Authorized real-provider acceptance. Only the application's public API is
// called; no manual scene selection or motion-template injection.
assert.ok(process.argv.includes('--paid'), 'Explicit --paid required');
const profile = 'C:/Users/rosup/AppData/Roaming/@gold-work/desktop';
const out = resolve('captures/stock-russian-live-20260926');
await mkdir(out, { recursive: true });
const statePath = join(out, 'state.json');
const prior = await readFile(statePath, 'utf8').then(JSON.parse, () => null);
assert.ok(!prior?.projectId || process.argv.includes('--resume'), 'Use --resume for the existing test');
const state = prior ?? { title: 'Панамский канал — русский автотест 26.09.2026', stages: {}, runs: [] };
const script = (await readFile(join(out, 'script.txt'), 'utf8')).trim();
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const registry = JSON.parse(await readFile(join(profile, 'projects.json'), 'utf8'));
const preservedProjects = registry.filter(project => project.id !== state.projectId).map(project => ({ id: project.id, hash: fingerprint(project) }));
const clean = value => String(value).replace(/https?:\/\/\S+/g, '[URL]');
const save = () => writeFile(statePath, JSON.stringify(state, null, 2));
const event = async (stage, details = {}) => {
  const item = { at: new Date().toISOString(), stage, ...details };
  console.log(JSON.stringify(item));
  await appendFile(join(out, 'events.jsonl'), JSON.stringify(item) + '\n');
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
app.setPath('userData', profile);
delete process.env.ELECTRON_RENDERER_URL;
delete process.env.PORTABLE_EXECUTABLE_DIR;
createRequire(import.meta.url)(resolve('dist/main/index.cjs'));
let win, crashed = false, monitoring = false;
const api = (method, ...args) => win.webContents.executeJavaScript(
  `window.goldWork[${JSON.stringify(method)}](...${JSON.stringify(args)})`, true);
async function preserveCheck() {
  const after = JSON.parse(await readFile(join(profile, 'projects.json'), 'utf8'));
  for (const original of preservedProjects) assert.equal(fingerprint(after.find(p => p.id === original.id)), original.hash, `Original modified: ${original.id}`);
}
async function snapshot() {
  if (!state.projectId) return;
  const project = await api('getProject', state.projectId);
  const tasks = (await api('getQueue')).filter(task => task.projectId === state.projectId);
  const progress = await win.webContents.executeJavaScript('window.__russianRunProgress ?? null');
  const voices = project.scenes.filter(scene => scene.audioPath).length;
  const selected = project.scenes.filter(scene => scene.documentary?.verified).length;
  if (voices === project.scenes.length && voices && !state.stages.voiceFinishedAt) {
    state.stages.voiceFinishedAt = new Date().toISOString(); await save();
  }
  if (selected === project.scenes.length && selected && !state.stages.materialsFinishedAt) {
    state.stages.materialsFinishedAt = new Date().toISOString(); await save();
  }
  const assembly = tasks.findLast(task => task.kind === 'assemble');
  if (assembly?.status === 'running' && !state.stages.assemblyStartedAt) {
    state.stages.assemblyStartedAt = new Date().toISOString(); await save();
  }
  await event('progress', { elapsedSeconds: Math.round((Date.now() - Date.parse(state.startedAt)) / 1000),
    status: project.status, scenes: project.scenes.length, voices, selected,
    active: tasks.filter(task => ['running', 'pending', 'retry_wait'].includes(task.status)).length,
    errors: tasks.filter(task => ['failed', 'blocked'].includes(task.status)).map(task => ({ kind: task.kind, sceneId: task.sceneId, error: clean(task.error) })),
    phase: progress?.phase, message: progress?.message ? clean(progress.message) : undefined,
    assembly: assembly ? { status: assembly.status, progress: assembly.progress } : undefined });
  assert.equal(crashed, false, 'Renderer crashed');
  return { project, tasks };
}

app.whenReady().then(async () => {
  for (let i = 0; i < 150; i++) {
    win = BrowserWindow.getAllWindows()[0];
    if (win?.webContents.getURL() && !win.webContents.isLoadingMainFrame()) break;
    await wait(200);
  }
  assert.ok(win); win.webContents.setBackgroundThrottling(false);
  win.webContents.on('render-process-gone', () => { crashed = true; });
  state.build = (await api('getAppInfo')).buildId;
  assert.equal((await api('getAppInfo')).mockMode, false, 'Real providers required');
  assert.equal((await api('getQueue')).some(task => ['running', 'pending', 'retry_wait'].includes(task.status)), false, 'Other work is running');
  const model = await api('getAnyModelSettings');
  await event('preflight', { build: state.build, textModel: model.textModel });
  await win.webContents.executeJavaScript('window.__russianRunProgress=null;window.goldWork.onAutoStockProgress(p=>window.__russianRunProgress=p);void 0;');
  const channel = (await api('listChannelProfiles')).find(channel => channel.id === '7b6761b6-0e28-44d6-8b00-927963484ed4');
  assert.equal(channel?.direction, 'stock-documentary'); assert.equal(channel.languageCode, 'ru');
  const voice = (await api('listVoicerTemplates')).find(voice => voice.uuid === channel.lumeanTemplateUuid);
  assert.ok(voice && !voice.broken, 'Saved voice template unavailable');
  state.voice = { name: voice.name, id: voice.uuid, language: channel.languageCode };
  state.startedAt ??= new Date().toISOString(); await save();
  if (!state.calibration) {
    state.stages.calibrationStartedAt = new Date().toISOString(); await save();
    await event('calibration-start', { voice: voice.name });
    const sample = await api('calibrateVoice', { provider: 'elevenlabs', voice: voice.uuid, language: 'русский' });
    state.calibration = sample.calibration;
    await writeFile(join(out, 'voice-sample.mp3'), Buffer.from(sample.sampleAudioBase64, 'base64'));
    state.stages.calibrationFinishedAt = new Date().toISOString(); await save();
  }
  state.estimatedSeconds = estimateNarrationDurationSeconds(script, state.calibration);
  await event('calibrated', { voice: voice.name, estimatedSeconds: state.estimatedSeconds, calibration: state.calibration });
  if (process.argv.includes('--calibrate-only')) { await save(); app.exit(0); return; }
  if (!state.projectId) {
    const created = await api('createProject', { title: state.title, topic: state.title, aspectRatio: '16:9', language: 'русский', mode: 'standard',
      channelProfileId: channel.id, mediaMode: 'stock', motionTemplate: channel.motionTemplate,
      videoBrief: { prompt: state.title, competitorTranscripts: [], creationMode: 'script', readyScript: script } });
    state.projectId = created.id; await save();
    await api('updateProject', created.id, { settings: { ...created.settings,
      durationMinutes: state.estimatedSeconds / 60, stockVideoPercent: 85,
      voice: { ...created.settings.voice, enabled: true, provider: 'elevenlabs', voice: voice.uuid, singleTrack: false, calibration: state.calibration },
      video: { ...created.settings.video, enabled: false } } });
    await event('project-created', { projectId: created.id });
  }
  let project = await api('getProject', state.projectId);
  assert.equal(project.videoBrief.readyScript, script);
  assert.equal(project.settings.assembly.documentary?.version, 2);
  if (!state.stages.planningFinishedAt) {
    state.stages.planningStartedAt ??= new Date().toISOString(); await save();
    await event('planning-start');
    project = await api('prepareProjectScript', state.projectId);
    state.stages.planningFinishedAt = new Date().toISOString(); await save();
    await event('planning-finished', { scenes: project.scenes.length,
      motion: project.scenes.map(scene => scene.documentary?.motionGraphic).filter(Boolean) });
  }
  state.stages.productionStartedAt ??= new Date().toISOString();
  const run = { startedAt: new Date().toISOString(), build: state.build }; state.runs.push(run); await save();
  await event('production-start');
  monitoring = true;
  const monitor = (async () => {
    while (monitoring) {
      await snapshot();
      const stop = await stat(join(out, 'stop.request')).catch(() => null);
      if ((stop && stop.mtimeMs >= Date.parse(run.startedAt)) || Date.now() - Date.parse(run.startedAt) > 2 * 60 * 60_000) {
        await api('stopGeneration', state.projectId); throw new Error('Graceful test stop requested; checkpoints preserved');
      }
      await wait(15000);
    }
  })();
  // Observe failures immediately, but do not terminate an uncertain paid call.
  let monitorError; monitor.catch(error => { monitorError = error; });
  try {
    await api('startGeneration', state.projectId);
    for (;;) {
      if (monitorError) throw monitorError;
      const current = await api('getProject', state.projectId);
      if (current.status === 'complete' && current.outputPath) { project = current; break; }
      const tasks = (await api('getQueue')).filter(task => task.projectId === state.projectId);
      if (!tasks.some(task => ['running', 'pending', 'retry_wait'].includes(task.status))) {
        throw new Error(tasks.filter(task => ['failed', 'blocked'].includes(task.status)).map(task => `${task.kind}: ${task.error}`).join('\n') || 'Production stopped without Final');
      }
      await wait(3000);
    }
  } finally { monitoring = false; }
  state.completedAt = new Date().toISOString(); run.endedAt = state.completedAt; run.result = 'complete'; await save();
  await preserveCheck();
  const result = { ...state, elapsedSeconds: (Date.parse(state.completedAt) - Date.parse(state.startedAt)) / 1000,
    outputPath: project.outputPath, bytes: (await stat(project.outputPath)).size,
    scenes: project.scenes.length, rendererSurvived: !crashed, previousProjectsPreserved: true,
    method: 'native public application API; not a UI-click acceptance' };
  await writeFile(join(out, 'result.json'), JSON.stringify(result, null, 2));
  await event('complete', { outputPath: project.outputPath, elapsedSeconds: result.elapsedSeconds });
  await wait(3000); app.exit(0);
}).catch(async error => {
  monitoring = false; const message = clean(error?.stack ?? error);
  await event('failed', { message });
  if (state.runs?.length) Object.assign(state.runs.at(-1), { endedAt: new Date().toISOString(), result: 'failed', message });
  await save(); await writeFile(join(out, 'failure.json'), JSON.stringify({ at: new Date().toISOString(), projectId: state.projectId, message }, null, 2));
  // Stop drains normal in-flight tasks; preserve unknown submissions for review.
  if (state.projectId && win && !win.isDestroyed()) await api('stopGeneration', state.projectId).catch(() => undefined);
  await preserveCheck().catch(error => console.error(clean(error)));
  app.exit(1);
});
