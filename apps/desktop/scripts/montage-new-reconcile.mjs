import {readFile,writeFile,stat} from 'node:fs/promises';
import {join,resolve,isAbsolute} from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

// Evidence-only reconciliation after the monitor observed a torn completion
// snapshot. Does not launch production or modify registry/settings/media.
const out=resolve('captures/montage-speed-20260927/new-production'),profile=join(process.env.APPDATA,'@gold-work/desktop');
const state=JSON.parse(await readFile(join(out,'state.json'),'utf8')),raw=await readFile(join(profile,'projects.json'),'utf8');
const all=JSON.parse(raw),p=all.find(p=>p.id===state.projectId),queue=JSON.parse(await readFile(join(profile,'queue.json'),'utf8'));
const run=state.runs.at(-1);assert.equal(p.status,'complete');assert.ok(p.outputPath);
assert.ok(!queue.some(t=>['pending','running','retry_wait'].includes(t.status)));
const task=queue.findLast(t=>t.projectId===p.id&&t.kind==='assemble'&&t.status==='done'&&Date.parse(t.updatedAt)>=Date.parse(run.startedAt));assert.ok(task);
assert.ok((await stat(p.outputPath)).mtimeMs>=Date.parse(run.startedAt));
const original=(await readFile(resolve('scripts/fixtures/automobile-production-20260928.txt'),'utf8')).trim();
assert.equal(p.scenes.map(s=>s.narration).join(''),original);assert.ok(p.scenes.every(s=>s.documentary?.verified&&s.audioPath));
const metrics=JSON.parse(await readFile(join(resolve(p.outputPath,'..'),'Documentary','last-render-metrics.json'),'utf8'));
const hash=x=>createHash('sha256').update(x).digest('hex');
const baseline=JSON.parse(await readFile(join(out,'preservation-bounded-stop-082904.json'),'utf8'));
for(const voice of baseline.voices)assert.equal(hash(await readFile(voice.path)),voice.sha256);
const unknown=JSON.parse(await readFile(join(out,'balance-block-091838.json'),'utf8')).unresolved;
for(const item of unknown){const path=isAbsolute(item.file)?item.file:join(resolve(p.outputPath,'..'),'Documentary','Analysis',item.file);assert.equal(hash(await readFile(path)),item.sha256);}
const log=(await readFile(join(profile,'logs','gold-work-studio-log.txt'),'utf8')).split('\n');
const completed=log.filter(l=>l.includes('queue.task.completed')).map(l=>JSON.parse(l.slice(l.indexOf('{')))).findLast(d=>d.taskId===task.id);
assert.ok(Number.isFinite(completed?.elapsedMs));
if(run.error){run.monitorError=run.error;delete run.error;}
run.completedAt=task.updatedAt;state.completedAt=task.updatedAt;
state.interventions.push({at:new Date().toISOString(),kind:'monitor-reconciliation',detail:'Queue task completed before project snapshot; Final already existed. Verified saved project/queue/Final/voices. No production or provider call.'});
await writeFile(join(out,'state.json'),JSON.stringify(state,null,2));
const result={projectId:p.id,buildId:run.buildId,startedAt:state.startedAt,completedAt:state.completedAt,elapsedSeconds:(Date.parse(state.completedAt)-Date.parse(state.startedAt))/1000,
  runElapsedSeconds:(Date.parse(state.completedAt)-Date.parse(run.startedAt))/1000,assemblySeconds:completed.elapsedMs/1000,
  renderSeconds:metrics.totalSeconds,parts:metrics.parts,scenes:p.scenes.length,outputPath:p.outputPath,bytes:(await stat(p.outputPath)).size,
  voicesPreserved:baseline.voices.length,previousUnknownCheckpointsPreserved:unknown.length,
  stages:state.stages,runs:state.runs,interventions:state.interventions,
  method:'Normal application pipeline. Completion reconciled read-only after monitor snapshot race. Original start retained; resumed production is not a new cold timing.'};
assert.equal(await readFile(join(profile,'projects.json'),'utf8'),raw);
await writeFile(join(out,'result.json'),JSON.stringify(result,null,2));await writeFile(join(out,'project-snapshot.json'),JSON.stringify(p));
console.log(JSON.stringify({...result,runs:undefined,interventions:undefined,stages:undefined}));
