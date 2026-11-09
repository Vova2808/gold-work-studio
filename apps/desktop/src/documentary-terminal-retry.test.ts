import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DocumentaryIntelligence } from './documentary-intelligence.js';
import { AnyModelClient, AnyModelCompletionUncertainError, AnyModelProviderResponseError, isExplicitAnyModelServerFailure } from './anymodel-client.js';

test('optional semantic montage allows two confirmed output-free attempts and leaves recovery gate open',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-montage-retry-'));t.after(()=>rm(root,{recursive:true,force:true}));let calls=0;
  const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{
    calls++;throw new AnyModelProviderResponseError('HTTP 503: temporarily unavailable',503);
  }},()=>root,async()=>{},undefined,async()=>{});
  await assert.rejects(Reflect.get(service,'complete').call(service,'p','semantic-montage','Budget','{}',[]),/Выполнено 2 отправок/);
  assert.equal(calls,2);assert.equal(Reflect.get(service,'analysisLimit'),1);
});

test('a documented HTTP 503 JSON failure can recover; ambiguous bodies stay guarded', async () => {
  const failure = { error: { message: 'The upstream provider is temporarily unavailable. Try again shortly.', type: 'server_error', code: 'service_unavailable', status: 503, request_id: 'err-fixture' } };
  assert.equal(isExplicitAnyModelServerFailure(503, JSON.stringify(failure)), true);
  for (const body of ['provider busy', JSON.stringify({ ...failure, choices: [{ message: { content: 'partial output' } }] }),
    JSON.stringify({ ...failure, usage: { completion_tokens: 1 } }), JSON.stringify({ error: { ...failure.error, status: 500 } })]) {
    assert.equal(isExplicitAnyModelServerFailure(503, body), false);
  }
  const store = { publicSettings: async () => ({ configured: true, baseUrl: 'https://fixture.test/v1', textModel: 'fixture' }), apiKey: async () => 'fixture' };
  for (const explicit of [true, false]) {
    const root = await mkdtemp(join(tmpdir(), 'gws-http-terminal-'));
    let calls = 0;
    const client = new AnyModelClient(store as never, async () => {
      calls++;
      return calls === 1 ? new Response(explicit ? JSON.stringify(failure) : 'provider busy', { status: 503 })
        : new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } });
    });
    const service = new DocumentaryIntelligence(client, () => root, async () => {}, undefined, async () => {});
    const invoke = () => Reflect.get(service, 'complete').call(service, 'project', 'candidate-relevance', 'Test', '{}', []);
    if (explicit) {
      assert.deepEqual(await invoke(), { ok: true }); await invoke(); assert.equal(calls, 2);
    } else {
      await assert.rejects(invoke(), /неизвестен/); await assert.rejects(invoke(), /Автоповтор отключён/); assert.equal(calls, 1);
    }
  }
});

test('a structured 503 inside HTTP 200 can recover but an envelope with usage remains guarded',async t=>{
  const failure={error:{message:'The upstream provider is temporarily unavailable. Try again shortly.',
    type:'server_error',code:'service_unavailable',status:503,request_id:'err_952679f9-fixture'}};
  for(const stream of [false,true])for(const usage of [false,true]){
    const root=await mkdtemp(join(tmpdir(),'gws-envelope-503-'));t.after(()=>rm(root,{recursive:true,force:true}));
    let calls=0;
    const store={publicSettings:async()=>({configured:true,baseUrl:'https://fixture.test/v1',textModel:'fixture'}),apiKey:async()=>'fixture'};
    const client=new AnyModelClient(store as never,async()=>{
      calls++;
      const payload=calls===1?{...failure,...(usage?{usage:{completion_tokens:1}}:{})}
        :{choices:[{[stream?'delta':'message']:{content:'{"ok":true}'},finish_reason:'stop'}]};
      return stream?new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}}):Response.json(payload);
    });
    const service=new DocumentaryIntelligence(client,()=>root,async()=>{},undefined,async()=>{});
    const invoke=()=>Reflect.get(service,'complete').call(service,'p','visual-source-preview','503 envelope','{}',[]);
    if(usage){
      await assert.rejects(invoke(),/temporarily unavailable/);
      await assert.rejects(invoke(),/Автоповтор отключён/);
      assert.equal(calls,1);
    }else{assert.deepEqual(await invoke(),{ok:true});assert.equal(calls,2);}
  }
});

test('a scene budget stops a confirmed 503 with an accurate retry count instead of no-retry text',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-503-budget-'));t.after(()=>rm(root,{recursive:true,force:true}));
  let calls=0,remaining=40_000;
  const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{
    calls++;throw new AnyModelProviderResponseError('HTTP 503: temporarily unavailable',503);
  }},()=>root,async()=>{},undefined,async ms=>{remaining-=ms;});
  await assert.rejects(service.withSelectionBudget({remaining:()=>remaining,submit:()=>{}},
    ()=>Reflect.get(service,'complete').call(service,'p','visual-overview','Budget','{}',[])),(error:Error)=>{
    assert.match(error.message,/Выполнено 2 отправок/);assert.match(error.message,/бюджета работы этой сцены/);
    assert.doesNotMatch(error.message,/no-retry|Автоматический повтор отключён/);return true;
  });
  assert.equal(calls,2);
  const dir=join(root,'Documentary','Analysis');
  assert.equal(JSON.parse(await readFile(join(dir,(await readdir(dir))[0]!),'utf8')).state,'failed');
});

test('explicit 503 backoff is bounded, visible, checkpointed and cancellable',async()=>{
  for(const mode of ['recover','exhaust','stop'] as const){
    const root=await mkdtemp(join(tmpdir(),'gws-503-recovery-'));
    let calls=0,waits=0,stopped=false;const messages:string[]=[];
    const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{
      calls++;
      if(mode==='recover'&&calls===3)return '{"ok":true}';
      throw new AnyModelProviderResponseError('Confirmed service unavailable',503);
    }},()=>root,async()=>{},undefined,async()=>{
      waits++;
      if(waits===1){
        const dir=join(root,'Documentary','Analysis');
        const checkpoint=JSON.parse(await readFile(join(dir,(await readdir(dir))[0]!),'utf8'));
        assert.equal(checkpoint.state,'failed','A retry must only follow a saved definite failure');
      }
      if(mode==='stop')stopped=true;
    });
    const run=()=>Reflect.get(service,'inspection').run({submissions:0,shouldStop:()=>stopped,progress:(m:string)=>messages.push(m),comparisonSubjects:[],identities:undefined},
      ()=>Reflect.get(service,'complete').call(service,'project','candidate-relevance','503 test','{}',[]));
    if(mode==='recover')assert.deepEqual(await run(),{ok:true});
    else await assert.rejects(run(),mode==='stop'?{name:'AbortError'}:/unavailable/);
    assert.equal(calls,mode==='stop'?1:3);
    assert.equal(waits,mode==='stop'?1:(8000+30000)/250);
    assert.ok(messages[0]?.includes('ничего нажимать не нужно'));
  }
});

test('structured 503 honors the provider cooldown from body or header; long cooldowns never retry early',async()=>{
  for(const mode of ['body','header','long'] as const){
    const root=await mkdtemp(join(tmpdir(),'gws-provider-cooldown-'));
    let calls=0,waitedMs=0;
    const seconds=mode==='long'?240:19;
    const store={publicSettings:async()=>({configured:true,baseUrl:'https://fixture.test/v1',textModel:'fixture'}),apiKey:async()=>'fixture'};
    const client=new AnyModelClient(store as never,async()=>{
      calls++;
      if(calls===1)return new Response(JSON.stringify({error:{type:'server_error',code:'service_unavailable',status:503,
        message:'The selected model is temporarily unavailable.',...(mode!=='header'?{retry_after_seconds:seconds}:{})}}),
        {status:503,headers:mode==='header'?{'retry-after':String(seconds)}:{}});
      return new Response(JSON.stringify({choices:[{message:{content:'{"ok":true}'},finish_reason:'stop'}]}),{headers:{'content-type':'application/json'}});
    });
    const service=new DocumentaryIntelligence(client,()=>root,async()=>{},undefined,async ms=>{waitedMs+=ms;});
    const invoke=()=>Reflect.get(service,'complete').call(service,'project','candidate-relevance','Cooldown','{}',[]);
    if(mode==='long'){
      await assert.rejects(invoke(),(e:unknown)=>Reflect.get(e as object,'retryAfterMs')===240_000);
      assert.equal(calls,1);assert.equal(waitedMs,0);
    }else{
      assert.deepEqual(await invoke(),{ok:true});assert.equal(calls,2);assert.equal(waitedMs,19_000);
    }
  }
});

test('a later parallel 503 extends the shared pause to its explicit minimum',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-provider-shared-cooldown-'));
  let calls=0,waitedMs=0,releaseSecond!:()=>void,releasePause!:()=>void;
  const secondFailure=new Promise<void>(r=>{releaseSecond=r}),pause=new Promise<void>(r=>{releasePause=r});
  t.after(()=>{releaseSecond();releasePause();});
  const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{
    const call=++calls;
    if(call===1){await new Promise(r=>setImmediate(r));throw new AnyModelProviderResponseError('Unavailable',503);}
    if(call===2){await secondFailure;throw new AnyModelProviderResponseError('Unavailable',503,19_000);}
    return '{"ok":true}';
  }},()=>root,async()=>{},undefined,async ms=>{waitedMs+=ms;if(waitedMs===250)await pause;});
  const invoke=(id:number)=>Reflect.get(service,'complete').call(service,'project','candidate-relevance','Cooldown',JSON.stringify({id}),[]);
  const until=async(condition:()=>boolean)=>{const deadline=Date.now()+3000;while(!condition()){assert.ok(Date.now()<deadline,'Expected queue progress');await new Promise(r=>setImmediate(r));}};
  const first=invoke(1),second=invoke(2);
  await until(()=>calls===2&&waitedMs===250);releaseSecond();
  await until(()=>Reflect.get(service,'analysisPauseRemainingMs')===19_000);
  assert.equal(calls,2);releasePause();
  assert.deepEqual(await Promise.all([first,second]),[{ok:true},{ok:true}]);
  assert.equal(calls,4);assert.equal(waitedMs,19_250,'The elapsed tick cannot shorten a newly received cooldown');
});

test('a transport outage recovers using free probes, without replaying unknown submissions',async()=>{
  for(const mode of ['recover','down','stop'] as const){
    const root=await mkdtemp(join(tmpdir(),'gws-network-recovery-'));
    let calls=0,probes=0,waits=0,stopped=false;const messages:string[]=[];
    const service=new DocumentaryIntelligence({configured:async()=>true,
      documentaryCompletion:async()=>{calls++;if(calls<=3)throw new AnyModelCompletionUncertainError('ECONNRESET');return '{"ok":true}';},
      probeDocumentaryConnection:async()=>{probes++;return mode==='recover';},
    },()=>root,async()=>{},undefined,async()=>{waits++;if(mode==='stop')stopped=true;});
    const invoke=(id:number)=>Reflect.get(service,'inspection').run({submissions:0,shouldStop:()=>stopped,progress:(m:string)=>messages.push(m),comparisonSubjects:[],identities:undefined},
      ()=>Reflect.get(service,'complete').call(service,'project','candidate-relevance','Recovery',JSON.stringify({id}),[]));
    for(let i=0;i<3;i++)await assert.rejects(invoke(i),i===2&&mode==='stop'?{name:'AbortError'}:(e:unknown)=>Reflect.get(e as object,'kind')===(i===2&&mode==='down'?'unavailable':'pending'));
    assert.equal(calls,3);assert.equal(probes,mode==='recover'?1:mode==='down'?2:0);
    assert.equal(waits,mode==='recover'?20:mode==='down'?60:1);
    const dir=join(root,'Documentary','Analysis');
    for(const file of await readdir(dir))assert.equal(JSON.parse(await readFile(join(dir,file),'utf8')).state,'pending');
    stopped=false;await assert.rejects(invoke(0),/Автоповтор отключён/);assert.equal(calls,3);
    if(mode==='recover'){assert.deepEqual(await invoke(3),{ok:true});assert.equal(calls,4);}
    assert.ok(messages.some(m=>m.includes('не повторяются')));
  }
});

test('the recovery probe only reads models through the configured client and validates its response',async()=>{
  const store={publicSettings:async()=>({configured:true,baseUrl:'https://fixture.test/v1',textModel:'fixture'}),apiKey:async()=>'fixture'};
  for(const healthy of [true,false]){
    let calls=0;
    const client=new AnyModelClient(store as never,async(url,init)=>{
      calls++;assert.ok(String(url).endsWith('/v1/models'));assert.equal(init?.method,'GET');assert.ok(init?.signal);
      return new Response(JSON.stringify(healthy?{data:[]}:{error:'unavailable'}),{headers:{'content-type':'application/json'}});
    });
    assert.equal(await client.probeDocumentaryConnection(),healthy);assert.equal(calls,1);
  }
});

test('all workers share the same recovery and new paid requests wait until it finishes',async()=>{
  const root=await mkdtemp(join(tmpdir(),'gws-network-shared-'));
  let calls=0,probes=0,release!:()=>void;
  const gate=new Promise<void>(r=>{release=r});
  const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{calls++;if(calls<=3)throw new AnyModelCompletionUncertainError('ECONNRESET');return '{"ok":true}';},
    probeDocumentaryConnection:async()=>{probes++;await gate;return true;},
  },()=>root,async()=>{},undefined,async()=>{});
  const invoke=(id:number)=>Reflect.get(service,'complete').call(service,'project','candidate-relevance','Recovery',JSON.stringify({id}),[]);
  await assert.rejects(invoke(0));await assert.rejects(invoke(1));
  const third=assert.rejects(invoke(2),(e:unknown)=>Reflect.get(e as object,'kind')==='pending');
  while(!probes)await new Promise(r=>setImmediate(r));
  const fourth=invoke(3);await new Promise(r=>setTimeout(r,15));assert.equal(calls,3);
  release();await third;assert.deepEqual(await fourth,{ok:true});assert.equal(probes,1);assert.equal(calls,4);
});

test('parallel terminal refusals share one pause; new submissions wait for a single recovery response',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-503-shared-'));
  let calls=0,waits=0,active=0,recoveryMaximum=0,releaseFailure!:()=>void,releasePause!:()=>void,releaseRecovery!:()=>void;
  const failing=new Promise<void>(r=>{releaseFailure=r}),pause=new Promise<void>(r=>{releasePause=r}),recovery=new Promise<void>(r=>{releaseRecovery=r});
  t.after(()=>{releaseFailure();releasePause();releaseRecovery();});
  const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{
    const call=++calls;
    if(call<=2){await failing;throw new AnyModelProviderResponseError('Service unavailable',503);}
    active++;recoveryMaximum=Math.max(recoveryMaximum,active);
    try{await recovery;return '{"ok":true}';}finally{active--;}
  }},()=>root,async()=>{},undefined,async()=>{waits++;if(waits===1)await pause;});
  const invoke=(id:number)=>Reflect.get(service,'complete').call(service,'project','candidate-relevance','Shared retry',JSON.stringify({id}),[]);
  const until=async(condition:()=>boolean)=>{const deadline=Date.now()+3000;while(!condition()){assert.ok(Date.now()<deadline,'Expected queue progress');await new Promise(r=>setImmediate(r));}};
  const first=invoke(1),second=invoke(2);await until(()=>calls===2);releaseFailure();await until(()=>waits===1);
  const third=invoke(3);await new Promise(r=>setTimeout(r,15));assert.equal(calls,2);
  const directory=join(root,'Documentary','Analysis');
  assert.equal((await readdir(directory)).length,2,'Waiting for service recovery must not create an uncertain paid submission');
  releasePause();await until(()=>calls===3);await new Promise(r=>setTimeout(r,15));
  assert.equal(calls,3,'Only one request probes completion recovery');assert.equal(waits,32,'Other refusals join the same 8-second pause');
  releaseRecovery();assert.deepEqual(await Promise.all([first,second,third]),[{ok:true},{ok:true},{ok:true}]);
  assert.equal(calls,5);assert.ok(recoveryMaximum<=2,'Restore two concurrent calls instead of a new burst');
});

test('successful completions restore analysis throughput after a confirmed 503',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-503-ramp-'));t.after(()=>rm(root,{recursive:true,force:true}));
  let calls=0;
  const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{
    if(++calls===1)throw new AnyModelProviderResponseError('Service unavailable',503);
    return '{"ok":true}';
  }},()=>root,async()=>{},undefined,async()=>{});
  const invoke=(id:number)=>Reflect.get(service,'complete').call(service,'project','throughput-check','Adaptive recovery',JSON.stringify({id}),[]);
  assert.equal(Reflect.get(service,'analysisLimit'),4,'Start with a bounded cold burst');
  assert.deepEqual(await invoke(1),{ok:true});
  assert.equal(Reflect.get(service,'analysisLimit'),2,'A single recovery response opens only a small lane');
  assert.equal((await Promise.all([invoke(2),invoke(3)])).length,2);
  assert.equal(Reflect.get(service,'analysisLimit'),4);
  assert.equal((await Promise.all([invoke(4),invoke(5),invoke(6),invoke(7)])).length,4);
  assert.equal(Reflect.get(service,'analysisLimit'),8,'Healthy traffic regains normal throughput');
  assert.equal(calls,8,'Only the documented 503 is retried');
});

test('a healthy catalogue cannot cause endless paid attempts when completions stay disconnected',async()=>{
  const root=await mkdtemp(join(tmpdir(),'gws-network-budget-'));let calls=0,probes=0;
  const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{calls++;throw new AnyModelCompletionUncertainError('ECONNRESET');},
    probeDocumentaryConnection:async()=>{probes++;return true;},
  },()=>root,async()=>{},undefined,async()=>{});
  for(let i=0;i<9;i++)await assert.rejects(Reflect.get(service,'complete').call(service,'project','candidate-relevance','Recovery',JSON.stringify({i}),[]),
    (e:unknown)=>Reflect.get(e as object,'kind')===(i===8?'unavailable':'pending'));
  assert.equal(calls,9);assert.equal(probes,2);
});

test('terminal timeout retry is bounded, preserves partial answers and observes Stop', async () => {
  for (const mode of ['repeated', 'partial', 'stop'] as const) {
    const root = await mkdtemp(join(tmpdir(), 'gws-terminal-retry-'));
    let submissions = 0, stopped = false, waits = 0;
    const service = new DocumentaryIntelligence({
      configured: async () => true,
      documentaryCompletion: async (_system, _input, _images, _limit, onPartial) => {
        submissions++;
        if (mode === 'partial') onPartial?.('{"reviews":[');
        throw new AnyModelProviderResponseError('The upstream provider timed out. Try again.');
      },
    }, () => root, async () => {}, undefined, async () => {
      waits++;
      if (mode === 'stop') stopped = true;
    });
    const invoke = () => Reflect.get(service, 'complete').call(service, 'project', 'search-plan', 'Test', '{}', []);
    const context = { submissions: 0, shouldStop: () => stopped, comparisonSubjects: [], identities: undefined };
    await assert.rejects(Reflect.get(service, 'inspection').run(context, invoke), mode === 'stop' ? { name: 'AbortError' } : /timed out/);
    assert.equal(submissions, mode === 'repeated' ? 2 : 1, mode);
    assert.equal(waits, mode === 'repeated' ? 32 : mode === 'stop' ? 1 : 0, mode);
    const directory = join(root, 'Documentary', 'Analysis');
    const saved = JSON.parse(await readFile(join(directory, (await readdir(directory))[0]!), 'utf8'));
    assert.equal(saved.state, mode === 'partial' ? 'partial' : 'failed', mode);
    if (mode === 'partial') assert.equal(saved.raw, '{"reviews":[');
  }
});

test('one-attempt recovery stops its immediate retry without permanently blocking later definite-failure recovery',async()=>{
  const root=await mkdtemp(join(tmpdir(),'gws-one-recovery-'));
  const directory=join(root,'Documentary','Analysis');await mkdir(directory,{recursive:true});
  const key=createHash('sha256').update(JSON.stringify([2,'search-plan','Test','{}',[]])).digest('hex');
  const approvalPath=join(directory,`${key}.retry-authorization.json`);
  await writeFile(approvalPath,JSON.stringify({approvedAt:new Date().toISOString(),maxAttempts:1}));
  let calls=0;
  const client={configured:async()=>true,documentaryCompletion:async()=>{calls++;throw new AnyModelProviderResponseError('The upstream provider timed out. Try again.');}};
  const run=()=>{
    const service=new DocumentaryIntelligence(client,()=>root,async()=>{},undefined,async()=>{});
    return Reflect.get(service,'complete').call(service,'project','search-plan','Test','{}',[]);
  };
  await assert.rejects(run(),/upstream provider timed out/);
  assert.equal(calls,1);
  assert.ok(JSON.parse(await readFile(approvalPath,'utf8')).consumedAt);
  await assert.rejects(run(),/upstream provider timed out/);
  assert.equal(calls,3,'A later run can perform the normal bounded retry after a definite failure');
  await writeFile(join(directory,`${key}.json`),JSON.stringify({state:'pending',purpose:'search-plan'}));
  await assert.rejects(run(),/Автоповтор отключён/);
  assert.equal(calls,3,'The consumed receipt never permits replaying an unknown response');
});
