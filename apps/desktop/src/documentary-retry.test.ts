import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DocumentaryRetryPermissions,listDocumentaryRecovery} from './documentary-retry.js';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {AnyModelCompletionUncertainError} from './anymodel-client.js';

test('explicit revision-bound recovery archives the response, submits once, and protects a second disconnect',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-retry-ui-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const dir=join(root,'Documentary','Analysis');await mkdir(dir,{recursive:true});
  const key=createHash('sha256').update(JSON.stringify([2,'search-plan','Test','{}',[]])).digest('hex');
  const raw=JSON.stringify({state:'partial',purpose:'search-plan',raw:'paid partial',createdAt:'now'});await writeFile(join(dir,key+'.json'),raw);
  let calls=0;const client={configured:async()=>true,documentaryCompletion:async()=>{calls++;throw new AnyModelCompletionUncertainError('connection lost');}};
  const run=()=>Reflect.get(new DocumentaryIntelligence(client,()=>root),'complete').call(new DocumentaryIntelligence(client,()=>root),'project','search-plan','Test','{}',[]);
  const items=await listDocumentaryRecovery(root);assert.equal(items.length,1);
  await assert.rejects(run(),/незавершённый ответ/);assert.equal(calls,0);
  const permissions=new DocumentaryRetryPermissions();
  assert.deepEqual(await Promise.all([permissions.authorize(root,items),permissions.authorize(root,items)]),[1,1]);
  assert.equal((await readdir(join(dir,'RetryHistory'))).length,1);
  assert.equal(await readFile(join(dir,'RetryHistory',`${key}-${items[0]!.revision}.json`),'utf8'),raw);
  await assert.rejects(run());assert.equal(calls,1);
  await assert.rejects(run());assert.equal(calls,1);
  await assert.rejects(permissions.authorize(root,items),/изменилось/);
  assert.equal((await listDocumentaryRecovery(root)).length,1);
});

test('a complete received JSON answer is recovered locally, never offered for paid resubmission',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-received-retry-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const dir=join(root,'Documentary','Analysis');await mkdir(dir,{recursive:true});
  await writeFile(join(dir,'a'.repeat(64)+'.json'),JSON.stringify({state:'received',raw:'```json\n{"reviews":[]}\n```'}));
  await writeFile(join(dir,'b'.repeat(64)+'.json'),JSON.stringify({state:'partial',raw:'{"reviews":[]}'}));
  const items=await listDocumentaryRecovery(root);assert.deepEqual(items.map(i=>i.id),['b'.repeat(64)]);
});
