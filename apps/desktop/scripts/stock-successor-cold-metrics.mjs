import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Read-only production evidence. Repeated snapshots preserve measured events
// across log rotation without copying provider payloads or signed URLs.
const root = resolve(process.argv[2] ?? 'captures/stock-successor-cold-20260926');
const profile = 'C:/Users/rosup/AppData/Roaming/@gold-work/desktop';
const state = JSON.parse(await readFile(join(root, 'state.json'), 'utf8'));
const lastRun = state.runs?.at(-1);
const endedAt = state.completedAt ?? (lastRun?.result === 'failed' ? lastRun.endedAt : undefined);
const end = endedAt ?? new Date().toISOString();
const logRoot = join(profile, 'logs');
const logFiles = (await readdir(logRoot)).filter(name => /^gold-work-studio-log(?:-previous(?:-\d+)?)?\.txt$/.test(name));
const saved = await readFile(join(root, 'measured-events.json'), 'utf8').then(JSON.parse, () => []);
const selected = [];
for (const name of logFiles) {
  for (const line of (await readFile(join(logRoot, name), 'utf8')).split('\n')) {
    const match = /\] ((?:documentary|queue)\.[\w.-]+) (\{.*\})$/.exec(line);
    if (!match) continue;
    let item; try { item = JSON.parse(match[2]); } catch { continue; }
    if (item.projectId !== state.projectId || Date.parse(line.slice(0, 24)) < Date.parse(state.startedAt)) continue;
    if (!['documentary.stage.started', 'documentary.stage.finished', 'documentary.analysis.cache', 'queue.task.started', 'queue.task.completed', 'queue.task.failed'].includes(match[1])) continue;
    const row = { at: line.slice(0, 24), event: match[1] };
    for (const key of ['buildId', 'stage', 'kind', 'purpose', 'intervalId', 'taskId', 'attempts', 'startedAt', 'finishedAt', 'elapsedMs', 'success', 'sourceCacheHit', 'cache']) {
      if (item[key] !== undefined) row[key] = item[key];
    }
    selected.push(row);
  }
}
const events = [...new Map([...saved, ...selected].map(row => [JSON.stringify(row), row])).values()];
await writeFile(join(root, 'measured-events.json'), JSON.stringify(events, null, 2));
const union = rows => {
  let until = -Infinity, total = 0;
  for (const [a, b] of rows.filter(([a,b]) => Number.isFinite(a) && Number.isFinite(b)).sort((a,b) => a[0]-b[0])) {
    total += Math.max(0, b - Math.max(until, a)); until = Math.max(until, b);
  }
  return total / 1000;
};
const intervals = events.filter(e => e.event === 'documentary.stage.finished');
const stages = Object.fromEntries([...new Set(intervals.map(e => e.stage))].map(stage => {
  const rows = intervals.filter(e => e.stage === stage);
  return [stage, { count: rows.length, failed: rows.filter(e => !e.success).length,
    wallUnionSeconds: union(rows.map(e => [Date.parse(e.startedAt), Date.parse(e.finishedAt)])),
    requestSumSeconds: rows.reduce((n,e) => n + e.elapsedMs, 0) / 1000 }];
}));
const queue = JSON.parse(await readFile(join(profile, 'queue.json'), 'utf8')).filter(t => t.projectId === state.projectId);
const project = JSON.parse(await readFile(join(profile, 'projects.json'), 'utf8')).find(p => p.id === state.projectId);
const taskIntervals = events.filter(e => e.event === 'queue.task.completed').map(e => ({ ...e,
  startMs: Date.parse(e.at) - e.elapsedMs, endMs: Date.parse(e.at) }));
for (const kind of ['speech', 'assemble']) {
  const rows = taskIntervals.filter(e => e.kind === kind);
  stages[kind] = { completed: rows.length, wallUnionSeconds: union(rows.map(e => [e.startMs, e.endMs])),
    requestSumSeconds: rows.reduce((n,e) => n + e.elapsedMs, 0) / 1000 };
}
const voiceRows = taskIntervals.filter(e => e.kind === 'speech');
const searchRows = intervals.filter(e => ['search', 'analysis', 'download', 'media-preparation'].includes(e.stage) && Date.parse(e.startedAt) >= Date.parse(state.stages.productionStartedAt));
const overlapSeconds = union(voiceRows.flatMap(voice => searchRows.map(e =>
  [Math.max(voice.startMs, Date.parse(e.startedAt)), Math.min(voice.endMs, Date.parse(e.finishedAt))]
)).filter(([a,b]) => b > a));
const report = { at: new Date().toISOString(), projectId: state.projectId, build: state.build,
  complete: Boolean(state.completedAt), startedAt: state.startedAt, endedAt, runs: state.runs,
  elapsedSeconds: (Date.parse(end) - Date.parse(state.startedAt)) / 1000,
  preparationSeconds: state.stages.planningFinishedAt ? (Date.parse(state.stages.planningFinishedAt) - Date.parse(state.stages.planningStartedAt)) / 1000 : undefined,
  mode: 'new project and scene TTS; shared source/analysis catalog reuse allowed',
  scenes: project.scenes.length, voices: project.scenes.filter(s => s.audioPath).length,
  selected: project.scenes.filter(s => s.documentary?.verified).length,
  voiceTasks: new Set(events.filter(e => e.event === 'queue.task.started' && e.kind === 'speech').map(e => e.taskId)).size,
  currentQueueVoiceTasks: queue.filter(t => t.kind === 'speech').length, stages,
  materialWorkOverlapsCompletedVoiceIntervalsSeconds: overlapSeconds,
  downloads: intervals.filter(e => e.stage === 'download' && e.success).length,
  mediaCacheHits: intervals.filter(e => e.stage === 'media-preparation' && e.sourceCacheHit).length,
  analysisCacheHits: events.filter(e => e.event === 'documentary.analysis.cache').reduce((out,e) => ({ ...out, [e.cache]: (out[e.cache] ?? 0) + 1 }), {}),
  note: 'Stage unions overlap: do not add them to obtain elapsed. Overlap uses intersections of completed voice and material intervals. UI interaction is not proven by this main-handler run.' };
await writeFile(join(root, 'metrics.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
