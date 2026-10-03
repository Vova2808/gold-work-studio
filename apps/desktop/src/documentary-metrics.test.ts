import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {documentaryIntervalUnion,startDocumentaryMetrics,measureDocumentaryStage,finishDocumentaryMetrics} from './documentary-metrics.js';

test('parallel stages report real interval unions, not summed waiting time',async()=>{
  assert.deepEqual(documentaryIntervalUnion([[10,30],[20,45],[50,70],[15,25]]),[[10,45],[50,70]]);
  const root=await mkdtemp(join(tmpdir(),'gws-timing-')),projectId='timing-check';
  await startDocumentaryMetrics(projectId,root);
  await Promise.all([measureDocumentaryStage('search',{projectId},()=>delay(25)),measureDocumentaryStage('search',{projectId},()=>delay(25))]);
  await finishDocumentaryMetrics(projectId,'complete');
  const report=JSON.parse(await readFile(join(root,'Documentary','production-timing.json'),'utf8'));
  assert.equal(report.status,'complete');assert.equal(report.mode,'production');assert.equal(report.stages.search.calls,2);
  assert.ok(report.stages.search.activeSeconds<report.stages.search.requestSeconds);
  assert.ok(report.elapsedSeconds>=report.stages.search.activeSeconds);
});
