import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DocumentaryRetryPermissions,listDocumentaryRecovery} from './documentary-retry.js';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {AnyModelCompletionUncertainError} from './anymodel-client.js';
import {documentaryCheckpointKey} from './documentary-checkpoint-key.js';

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

test('failed recovery is offered only for primary and correction route request identities',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-route-failed-recovery-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const dir=join(root,'Documentary','Analysis'),routes=join(root,'Documentary','RouteComparisons');
  await mkdir(dir,{recursive:true});await mkdir(routes,{recursive:true});
  const eligible:string[]=[];
  for(const phase of ['primary','correction'] as const){
    const binding=(phase==='primary'?'a':'b').repeat(64),system='route '+phase;
    const input=JSON.stringify({routeComparison:1,...(phase==='correction'?{routeComparisonCorrection:1}:{}),sceneId:'s6'});
    const key=documentaryCheckpointKey('semantic-montage',system,input,[]);eligible.push(key);
    await writeFile(join(routes,`${binding}-${phase}-request.json`),JSON.stringify({binding,system,input}));
    await writeFile(join(dir,key+'.json'),JSON.stringify({state:'failed',purpose:'semantic-montage',error:'HTTP 503',createdAt:'now'}));
  }
  const unrelated='c'.repeat(64);
  await writeFile(join(dir,unrelated+'.json'),JSON.stringify({state:'failed',purpose:'semantic-montage',error:'HTTP 503'}));
  const invalidBinding='d'.repeat(64),system='ordinary montage',input=JSON.stringify({ordinaryMontage:1});
  const nonRoute=documentaryCheckpointKey('semantic-montage',system,input,[]);
  await writeFile(join(routes,`${invalidBinding}-primary-request.json`),JSON.stringify({binding:invalidBinding,system,input}));
  await writeFile(join(dir,nonRoute+'.json'),JSON.stringify({state:'failed',purpose:'semantic-montage',error:'HTTP 503'}));
  const items=await listDocumentaryRecovery(root);assert.deepEqual(items.map(i=>i.id).sort(),eligible.sort());
  assert.ok(items.every(i=>i.state==='failed'));
  const permissions=new DocumentaryRetryPermissions();
  await assert.rejects(permissions.authorize(root,[{id:unrelated,revision:'stale',purpose:'semantic-montage',state:'failed',characters:0,createdAt:''}]),/изменилось/);
  await writeFile(join(dir,items[0]!.id+'.json'),JSON.stringify({state:'pending',purpose:'semantic-montage'}));
  await assert.rejects(permissions.authorize(root,[items[0]!]),/изменилось/);
  assert.equal(JSON.parse(await readFile(join(dir,items[0]!.id+'.json'),'utf8')).state,'pending');
});
