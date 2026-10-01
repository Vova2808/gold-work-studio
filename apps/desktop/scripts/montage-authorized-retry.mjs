import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {createHash} from 'node:crypto';

// One-time recovery explicitly approved in this chat on 28 September 2026.
// No request is sent here. Unknown originals stay intact in the project audit.
assert.ok(process.argv.includes('--approved-one-retry'));
const out=resolve('captures/montage-speed-20260927/new-production');
const reviewPath=join(out,'retry-review.json');
const review=JSON.parse(await readFile(reviewPath,'utf8'));
assert.equal(review.authorization,'required-not-yet-given');
assert.equal(review.projectId,'project_mukba0q1_0cubga6');
assert.equal(review.requests.length,2);
const root=resolve('D:/GoldWorkStorage/projects',review.projectId,'Documentary/Analysis');
const archive=join(root,'RecoveryAudit','20260928-user-approved-once');
assert.ok(relative(root,archive)&&!relative(root,archive).startsWith('..'));
for(const request of review.requests){
  assert.match(request.name,/^[a-f0-9]{64}\.json$/);
  const raw=await readFile(join(root,request.name));
  assert.equal(createHash('sha256').update(raw).digest('hex'),request.sha256);
  const checkpoint=JSON.parse(raw);assert.equal(checkpoint.state,'pending');assert.ok(!checkpoint.raw);
}
const approvedAt=new Date().toISOString();
await mkdir(archive,{recursive:true});
for(const request of review.requests){
  const from=join(root,request.name),to=join(archive,request.name);
  assert.ok(!relative(root,from).startsWith('..')&&!relative(root,to).startsWith('..'));
  await rename(from,to);
  await writeFile(join(root,request.name.replace('.json','.retry-authorization.json')),JSON.stringify({approvedAt,maxAttempts:1,
    reason:'User explicitly authorized one retry after reviewing the unknown result and duplicate-charge risk.',
    unknownCheckpointArchive:to,originalSha256:request.sha256},null,2),{flag:'wx'});
}
review.authorization='user-approved-one-retry';review.approvedAt=approvedAt;review.archive=archive;
await writeFile(reviewPath,JSON.stringify(review,null,2));
const statePath=join(out,'state.json'),state=JSON.parse(await readFile(statePath,'utf8'));
state.interventions.push({at:approvedAt,kind:'user-authorized-one-retry-of-two-unknown-plans',failedAt:'2026-09-27T21:21:27.011Z',
  checkpointNames:review.requests.map(r=>r.name),archive,previousOutcome:'unknown',timerReset:false});
await writeFile(statePath,JSON.stringify(state,null,2));
console.log(JSON.stringify({archived:2,maxAttemptsPerRequest:1,originalStartedAt:state.startedAt}));
