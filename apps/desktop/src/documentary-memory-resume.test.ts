import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {DocumentaryMemoryUnavailableError} from './documentary-resources.js';
import {DocumentarySelectionSession} from './documentary-selection-session.js';
import {DocumentaryBudgetExhausted} from './documentary-work-budget.js';

test('production resumes after a bounded RAM pause within the scene budget without submitting twice',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-memory-resume-'));t.after(()=>rm(root,{recursive:true,force:true}));
  let now=100_000,posts=0,waits=0,extended=0;
  const actualNow=Date.now;Date.now=()=>now;t.after(()=>{Date.now=actualNow;});
  const session=new DocumentarySelectionSession(()=>now);session.budget('s','video');
  const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{posts++;return '{"ok":true}';}},()=>root,
    async()=>{if(waits<3)throw new DocumentaryMemoryUnavailableError('RAM below unchanged reserve');},undefined,
    async ms=>{assert.equal(posts,0);assert.deepEqual(await readdir(join(root,'Documentary','Analysis')),[]);waits++;now+=ms;});
  const result=await service.withSelectionBudget({remaining:()=>session.remaining('s','video'),submit:()=>session.takeAnalysis('s','video'),extend:ms=>{extended+=ms;session.extend('s','video',ms);}},()=>
    Reflect.get(service,'inspection').run({progress:()=>{},shouldStop:()=>false},()=>Reflect.get(service,'complete').call(service,'p','visual-source-preview','RAM resume','{}',[])));
  assert.deepEqual(result,{ok:true});assert.equal(waits,3);assert.equal(extended,0);assert.equal(posts,1);
  assert.equal(session.remaining('s','video'),105_000);assert.equal(session.budget('s','video').analyses,1);
  const receipts=await readdir(join(root,'Documentary','Analysis'));assert.equal(receipts.length,1);
  assert.equal(JSON.parse(await readFile(join(root,'Documentary','Analysis',receipts[0]!), 'utf8')).state,'complete');
});

test('persistent RAM shortage stops after 45 seconds without a paid submission or checkpoint',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-memory-bounded-'));t.after(()=>rm(root,{recursive:true,force:true}));
  let waited=0,posts=0;
  const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{posts++;return '{}';}},()=>root,
    async()=>{throw new DocumentaryMemoryUnavailableError('RAM shortage');},undefined,async ms=>{waited+=ms;});
  await assert.rejects(service.withSelectionBudget({remaining:()=>120_000-waited,submit:()=>assert.fail('No submission'),extend:()=>assert.fail('No budget extension')},()=>
    Reflect.get(service,'inspection').run({progress:()=>{},shouldStop:()=>false},()=>Reflect.get(service,'complete').call(service,'p','visual-source-preview','RAM cap','{}',[]))),DocumentaryBudgetExhausted);
  assert.equal(waited,45_000);assert.equal(posts,0);
  assert.deepEqual(await readdir(join(root,'Documentary','Analysis')),[]);
});

test('search accounting and kind changes cannot extend the total scene deadline',()=>{
  let now=0;const session=new DocumentarySelectionSession(()=>now);
  session.budget('s','video');now=100_000;session.accountSearch('s','video',100_000);
  assert.equal(session.remaining('s','video'),50_000);
  session.extend('s','video',500_000);assert.equal(session.remaining('s','video'),50_000);
  session.budget('s','image');now=150_000;
  assert.equal(session.remaining('s','image'),0);assert.equal(session.canAttempt('s','video'),false);
});

test('Stop cancels a RAM pause before any paid checkpoint is created',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-memory-stop-'));t.after(()=>rm(root,{recursive:true,force:true}));
  let stopped=false,posts=0;
  const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{posts++;return '{}';}},()=>root,
    async()=>{throw new DocumentaryMemoryUnavailableError('RAM shortage');},undefined,async()=>{stopped=true;});
  await assert.rejects(service.withSelectionBudget({remaining:()=>120_000,submit:()=>{},extend:()=>{}},()=>Reflect.get(service,'inspection').run({progress:()=>{},shouldStop:()=>stopped},()=>
    Reflect.get(service,'complete').call(service,'p','visual-source-preview','Stop RAM wait','{}',[]))),{name:'AbortError'});
  assert.equal(posts,0);assert.deepEqual(await readdir(join(root,'Documentary','Analysis')),[]);
});

test('manual one-off review reports RAM shortage rather than starting an unobservable wait',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-memory-manual-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>assert.fail('No paid request')},()=>root,
    async()=>{throw new DocumentaryMemoryUnavailableError('RAM shortage');},undefined,async()=>assert.fail('No wait without a cancellable production budget'));
  await assert.rejects(Reflect.get(service,'inspection').run({progress:()=>{},shouldStop:()=>false},()=>
    Reflect.get(service,'complete').call(service,'p','visual-source-preview','Manual RAM shortage','{}',[])),DocumentaryMemoryUnavailableError);
});

test('stopping one RAM waiter neither traps nor cancels another owner',async()=>{
  for(const stoppedOwner of [0,1]){
    const sleeps:Array<()=>void>=[];let ready=false;const stop=[false,false];
    const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>assert.fail('No paid request')},()=>'',
      async()=>{if(!ready)throw new DocumentaryMemoryUnavailableError('RAM shortage');},undefined,()=>new Promise(resolve=>sleeps.push(resolve)));
    const run=(owner:number)=>Reflect.get(service,'inspection').run({progress:()=>{},shouldStop:()=>stop[owner]},()=>Reflect.get(service,'waitForMemory').call(service)) as Promise<void>;
    const outcomes=[run(0),run(1)].map(p=>p.then(()=> 'resumed',error=>error.name));
    assert.equal(sleeps.length,2);stop[stoppedOwner]=true;ready=true;sleeps.splice(0).forEach(resolve=>resolve());
    assert.deepEqual(await Promise.all(outcomes),stoppedOwner===0?['AbortError','resumed']:['resumed','AbortError']);
  }
});
