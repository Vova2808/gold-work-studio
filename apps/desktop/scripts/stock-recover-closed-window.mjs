import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, appendFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';

// Read-only recovery of evidence after the renderer was closed. Does not stop
// processes, touch project data or resubmit any provider request.
const root = resolve(process.argv[2] ?? '');
assert.ok(process.argv[2], 'Specify the interrupted warm attempt directory');
assert.equal(await stat(join(root, 'failure.json')).catch(() => null), null, 'Keep existing terminal evidence');
const profile = 'C:/Users/rosup/AppData/Roaming/@gold-work/desktop';
const events = (await readFile(join(root, 'events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
const begin = events.find(event => event.stage === 'started');
assert.ok(begin);
assert.ok(!events.some(event => ['complete', 'failed'].includes(event.stage)), 'Already terminal');
const rows = (await readFile(join(profile, 'logs/gold-work-studio-log.txt'), 'utf8')).split('\n').flatMap(line => {
  const match = /\] ([\w.-]+) (\{.*\})$/.exec(line);
  if (!match) return [];
  try { return [{ at: line.slice(0, 24), event: match[1], ...JSON.parse(match[2]) }]; } catch { return []; }
}).filter(row => row.buildId === begin.build && Date.parse(row.at) >= Date.parse(begin.at));
const terminal = rows.findLast(row => row.event === 'ipc.failed' && row.channel === 'queue:start' && row.projectId === begin.projectId);
assert.ok(terminal, 'Production has not reported terminal failure and drained its work yet');
assert.ok(rows.some(row => row.event === 'window.closed' && row.sessionId === terminal.sessionId), 'No matching closed-window evidence');
const queue = JSON.parse(await readFile(join(profile, 'queue.json'), 'utf8'));
assert.ok(!queue.some(task => task.projectId === begin.projectId && ['running', 'pending', 'retry_wait'].includes(task.status)), 'Active queue must finish first');
const activeStages = new Set();
for (const row of rows.filter(row => row.operationId === terminal.operationId)) {
  if (row.event === 'documentary.stage.started') activeStages.add(row.intervalId);
  if (row.event === 'documentary.stage.finished') activeStages.delete(row.intervalId);
}
assert.equal(activeStages.size, 0, 'Production still has unfinished stage records');
const beforeName = (await readdir(root)).find(name => /^before-\d+\.json$/.test(name));
assert.ok(beforeName);
const before = JSON.parse(await readFile(join(root, beforeName), 'utf8'));
const projects = JSON.parse(await readFile(join(profile, 'projects.json'), 'utf8'));
const project = projects.find(project => project.id === begin.projectId);
assert.ok(project);
assert.equal(project.videoBrief.readyScript, before.videoBrief.readyScript);
for (const scene of before.scenes) assert.equal(project.scenes.find(item => item.id === scene.id)?.audioPath, scene.audioPath);
const newSpeech = queue.filter(task => task.projectId === begin.projectId && task.kind === 'speech' && Date.parse(task.createdAt) >= Date.parse(begin.at));
assert.equal(newSpeech.length, 0, 'Warm run created speech tasks');
const evidence = { recoveredAt: new Date().toISOString(), productionEndedAt: terminal.at, sessionId: terminal.sessionId,
  mainError: terminal.error, selected: project.scenes.filter(scene => scene.documentary?.verified).length,
  voicePathsPreserved: before.scenes.length, scriptPreserved: true, newSpeechTasks: newSpeech.length,
  activeStages: 0, activeQueue: 0, otherProjectFingerprintsVerified: false,
  limitation: 'Renderer-harness did not finish: main window closed. Other-project before fingerprints were not persisted by that version.' };
await writeFile(join(root, 'recovery.json'), JSON.stringify(evidence, null, 2));
await writeFile(join(root, 'project-snapshot.json'), JSON.stringify(project));
const failed = { at: terminal.at, stage: 'failed', message: 'Production main reported terminal failure after draining; renderer window closed. See recovery.json. No Final.', recoveredAt: evidence.recoveredAt };
await writeFile(join(root, 'failure.json'), JSON.stringify(failed, null, 2));
await appendFile(join(root, 'events.jsonl'), JSON.stringify(failed) + '\n');
console.log(JSON.stringify({ ...evidence, mainError: undefined }));
