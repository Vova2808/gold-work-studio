// Bounded, user-authorized real selection on the existing motorcycle script.
// Production registry is read-only; paid checkpoints/media keep their real IDs.
import assert from 'node:assert/strict';
import {app} from 'electron';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
import {appendFileSync,copyFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {freemem} from 'node:os';
import {ProjectService,MockDirectorProvider} from '@gold-work/core';
import {FileProjectRepository} from '../src/file-project-repository.js';
import type {Project,Scene} from '@gold-work/shared';
import {AnyModelStore} from '../src/anymodel-store.js';
import {AnyModelClient} from '../src/anymodel-client.js';
import {StockStore} from '../src/stock-store.js';
import {StockClient} from '../src/stock-client.js';
import {YouTubeStore} from '../src/youtube-store.js';
import {DocumentaryYouTube} from '../src/documentary-youtube.js';
import {DocumentaryIntelligence} from '../src/documentary-intelligence.js';
import {DocumentaryProjectService} from '../src/documentary-project-service.js';
import {DocumentarySearch} from '../src/documentary-search.js';
import {DocumentaryAnalysisError} from '../src/documentary-analysis-error.js';
import {LocalProjectStorage} from '../src/local-project-storage.js';
import {EffectLibrary} from '../src/effect-library.js';
import {ensureDocumentaryMemory} from '../src/documentary-resources.js';
import {setDiagnosticSink} from '../src/diagnostics.js';
import {atomicWrite} from '../src/fs-utils.js';

assert.ok(process.argv.includes('--paid'), 'Explicit --paid required');
const profile=join(process.env.APPDATA!,'@gold-work/desktop');
const root=resolve('captures/montage-speed-20260927/new-production/motorcycle-live-20261001');
const round=process.argv.find(a=>a.startsWith('--round='))?.slice(8)??'baseline';
assert.match(round,/^[a-z0-9-]{1,32}$/);
const out=join(root,round);mkdirSync(out,{recursive:true});
assert.ok(!existsSync(join(out,'started.json')), 'Round already started; inspect checkpoints instead of blindly resubmitting');
const temporary=join(out,'electron-profile');mkdirSync(temporary,{recursive:true});
copyFileSync(join(profile,'Local State'),join(temporary,'Local State'));
app.setPath('userData',temporary);app.on('window-all-closed',()=>undefined);

app.whenReady().then(async()=>{
  const manifestName=process.argv.find(a=>a.startsWith('--manifest='))?.slice(11)??'manifest.json';
  assert.match(manifestName,/^manifest(?:-[a-z0-9-]+)?\.json$/);
  const manifest=JSON.parse(await readFile(join(root,manifestName),'utf8'));
  const requested=manifest.groups.flatMap((g:{scenes:Array<{id:string;number:number;kind:string}>})=>g.scenes) as Array<{id:string;number:number;kind:string}>;
  const scenesArg=process.argv.find(a=>a.startsWith('--scenes='));
  const only=scenesArg?.slice(9).trim().split(/[\s,]+/).map(Number);
  const sample=requested.filter(s=>!only||only.includes(s.number));
  assert.ok(sample.length>0&&sample.length<=10&&new Set(sample.map(s=>s.id)).size===sample.length,
    `Invalid sample: flag=${JSON.stringify(scenesArg)}, only=${JSON.stringify(only)}, selected=${sample.length}, manifest=${manifestName}`);
  const registryPath=join(profile,'projects.json');
  const registryHash=async()=>createHash('sha256').update(await readFile(registryPath)).digest('hex');
  const originalHash=await registryHash();
  // Real repository/projection/write path, isolated from the user's registry.
  const testRegistry=join(out,'registry.json');copyFileSync(registryPath,testRegistry);
  const repo=new FileProjectRepository(testRegistry);
  const resume=process.argv.find(a=>a.startsWith('--resume='))?.slice(9);
  if(resume){
    assert.match(resume,/^[a-z0-9-]{1,32}$/);
    const saved=JSON.parse(await readFile(join(root,resume,'project.json'),'utf8')) as Project;
    const original=(await repo.get(manifest.projectId))!;
    assert.equal(saved.id,original.id);assert.deepEqual(saved.settings,original.settings);
    assert.deepEqual(saved.scenes.map(s=>[s.id,s.narration,s.audioPath]),original.scenes.map(s=>[s.id,s.narration,s.audioPath]));
    await repo.save(saved);
  }
  const project=(await repo.get(manifest.projectId))!;
  assert.ok(project&&project.mediaMode==='stock'&&!['generating','paused'].includes(project.status));
  const queue=JSON.parse(await readFile(join(profile,'queue.json'),'utf8'));
  assert.ok(!queue.some((t:{status:string})=>['running','pending','queued'].includes(t.status)), 'Production must be idle');
  const workspaceInfo=JSON.parse(await readFile(join(profile,'storage-location.json'),'utf8'));
  const workspace=workspaceInfo.activePath;assert.equal(workspace.replace(/\\/g,'/'),'D:/GoldWorkStorage');
  const started=Date.now(),context=new AsyncLocalStorage<string>();let submissions=0,tokens=0,lastProgress=0;
  const maxSubmissions=Number(process.argv.find(a=>a.startsWith('--max-calls='))?.slice(12)??20),deadline=started+20*60_000;
  assert.ok(Number.isInteger(maxSubmissions)&&maxSubmissions>=0&&maxSubmissions<=60);
  const perScene=new Map(sample.map(s=>[s.id,{...s,wasVerified:Boolean(project.scenes.find(scene=>scene.id===s.id)?.documentary?.verified),startedAt:0,finishedAt:0,submissions:0,tokens:0}]));
  const log=(event:string,details:Record<string,unknown>)=>appendFileSync(join(out,'events.jsonl'),JSON.stringify({at:new Date().toISOString(),event,...details})+'\n');
  setDiagnosticSink((_level,event,d)=>{
    const sceneId=context.getStore()??(typeof d.sceneId==='string'?d.sceneId:undefined);
    const measured=sceneId?perScene.get(sceneId):undefined;
    if(measured&&d.stage==='scene-selection'){
      if(event==='documentary.stage.started')measured.startedAt=Date.parse(String(d.startedAt));
      if(event==='documentary.stage.finished')measured.finishedAt=Date.parse(String(d.finishedAt));
    }
    if(event==='anymodel.completion.usage'){
      const count=typeof d.totalCount==='number'?d.totalCount:0;tokens+=count;
      const row=sceneId?perScene.get(sceneId):undefined;if(row)row.tokens+=count;
      log(event,{sceneId,input:d.inputCount,output:d.outputCount,total:count,model:d.model});
    }else if(event.startsWith('documentary.'))log(event,{sceneId,stage:d.stage,purpose:d.purpose,cache:d.cache,elapsedMs:d.elapsedMs,success:d.success,intervalId:d.intervalId,startedAt:d.startedAt,finishedAt:d.finishedAt,candidates:d.candidates,delayMs:d.delayMs,attempt:d.attempt,tier:d.tier,model:d.model,rejected:d.rejected,bytes:d.bytes,downloadedBytes:d.downloadedBytes,message:typeof d.message==='string'?d.message.replace(/https?:\/\/\S+/g,'[source]').slice(0,250):undefined});
  });
  const projects=new ProjectService(repo,new MockDirectorProvider());
  const storage=new LocalProjectStorage(join(workspace,'projects'));
  storage.ensureProject=async p=>storage.projectDirectory(p.id);
  const originalMutate=repo.mutate.bind(repo);
  repo.mutate=async(id,update,options)=>{
    const current=await originalMutate(id,update,options);
    for(const s of current.scenes){const row=perScene.get(s.id);if(row&&s.documentary?.verified&&!row.finishedAt){row.finishedAt=Date.now();log('scene.accepted',{sceneId:s.id,number:s.order+1,kind:s.documentary.selected?.kind,seconds:row.startedAt?(row.finishedAt-row.startedAt)/1000:undefined});}}
    return current;
  };
  const client=new AnyModelClient(new AnyModelStore(join(profile,'credentials/anymodel.json')));
  // Count actual POSTs, including retries; a batch is one submission, not one
  // per waiting scene. Per-scene usage of batches is attributed to the leader.
  const transport=Reflect.get(client,'request').bind(client);
  Reflect.set(client,'request',async(path:string,init:RequestInit={},attempt=0)=>{
    if(init.method==='POST'&&path.includes('/chat/completions')){
      if(submissions>=maxSubmissions||Date.now()>deadline)throw new DocumentaryAnalysisError('Лимит малого теста достигнут','unavailable');
      submissions++;const sceneId=context.getStore(),row=sceneId?perScene.get(sceneId):undefined;if(row)row.submissions++;
      const body=JSON.parse(String(init.body));log('paid.request',{sceneId,submissions,model:body.model});
    }
    return transport(path,init,attempt);
  });
  const stock=new StockClient(new StockStore(join(profile,'credentials/stock.json')));
  const youtube=new DocumentaryYouTube(new YouTubeStore(join(profile,'credentials/youtube.json')));
  const intelligence=new DocumentaryIntelligence(client,id=>storage.projectDirectory(id),async()=>{
    await ensureDocumentaryMemory();
    if(submissions>=maxSubmissions||Date.now()>deadline)throw new DocumentaryAnalysisError('Лимит небольшого живого теста достигнут; готовые ответы сохранены','unavailable');
  },join(workspace,'Materials/VideoCatalog'));
  // Attribute normal product analysis/usage to the scene without modifying requests.
  for(const name of ['rankCandidates','inspectForSelection','inspect','prepareSource'] as const){
    const original=intelligence[name].bind(intelligence);
    (intelligence as any)[name]=(p:Project,s:Scene,...args:unknown[])=>context.run(s.id,()=> (original as any)(p,s,...args));
  }
  let service:DocumentaryProjectService;
  service=new DocumentaryProjectService(projects,storage,new DocumentarySearch(stock,globalThis.fetch,join(profile,'cache/documentary'),q=>service.localCandidates(q),youtube),join(workspace,'Materials'),stock,p=>{
    const row=p.currentSceneId?perScene.get(p.currentSceneId):undefined;
    if(row&&!row.startedAt)row.startedAt=Date.now();
    if(Date.now()-lastProgress>15000||p.phase==='complete'||p.phase==='failed'){
      lastProgress=Date.now();const status={seconds:Math.round((Date.now()-started)/1000),submissions,tokens,phase:p.phase,scene:row?.number,completed:p.completed,total:p.total,message:p.message.replace(/https?:\/\/\S+/g,'[source]').slice(0,180)};
      writeFileSync(join(out,'status.json'),JSON.stringify(status,null,2));console.log(JSON.stringify(status));
    }
  },intelligence,new EffectLibrary(join(workspace,'Library')),youtube);
  let peakRss=0,peakHeap=0,minFree=Infinity,lag=0,lastTick=performance.now();
  const monitor=setInterval(()=>{const m=process.memoryUsage();peakRss=Math.max(peakRss,m.rss);peakHeap=Math.max(peakHeap,m.heapUsed);minFree=Math.min(minFree,freemem());const now=performance.now();lag=Math.max(lag,now-lastTick-500);lastTick=now;},500);
  writeFileSync(join(out,'started.json'),JSON.stringify({at:new Date().toISOString(),pid:process.pid,projectId:project.id,registryHash:originalHash,sample,maxSubmissions,resume,deadline:new Date(deadline).toISOString()},null,2));
  let failure:string|undefined;
  try{await service.autoSelect(project.id,{sceneIds:sample.map(s=>s.id)});}catch(error){failure=String(error).replace(/https?:\/\/\S+/g,'[source]');}
  clearInterval(monitor);
  const updated=(await projects.get(project.id))!;
  await atomicWrite(join(out,'project.json'),JSON.stringify(updated));
  const results=sample.map(expected=>{
    const s=updated.scenes.find(s=>s.id===expected.id)!,row=perScene.get(s.id)!;
    return{...row,seconds:row.startedAt?((row.finishedAt||Date.now())-row.startedAt)/1000:undefined,verified:s.documentary?.verified,actualKind:s.documentary?.selected?.kind,
      matchesRequestedKind:s.documentary?.verified&&s.documentary.selected?.kind===expected.kind,narration:s.narration,title:s.documentary?.selected?.title,
      width:s.documentary?.selected?.width,height:s.documentary?.selected?.height,imagePath:s.imagePath,videoPath:s.videoPath,trimStart:s.trimStartSeconds,trimEnd:s.trimEndSeconds,review:s.documentary?.visualReview,error:s.documentary?.autoError};
  });
  // The user may search/edit in the open app while this isolated test runs.
  // Always save its report; never write this test's snapshot back to that app.
  const finalRegistryHash=await registryHash();
  const stats=['image','video'].map(kind=>{const rows=results.filter(r=>r.kind===kind),accepted=rows.filter(r=>r.matchesRequestedKind),fresh=accepted.filter(r=>!r.wasVerified&&r.startedAt);return{kind,requested:rows.length,accepted:accepted.length,newlyAccepted:fresh.length,failedOrFallback:rows.length-accepted.length,meanAcceptedSeconds:fresh.length?fresh.reduce((n,r)=>n+(r.seconds??0),0)/fresh.length:null,meanAttemptSeconds:rows.some(r=>r.startedAt)?rows.filter(r=>r.startedAt).reduce((n,r)=>n+(r.seconds??0),0)/rows.filter(r=>r.startedAt).length:null,tokens:rows.reduce((n,r)=>n+r.tokens,0)};});
  const result={at:new Date().toISOString(),round,repository:'FileProjectRepository isolated full registry',projectId:project.id,elapsedSeconds:(Date.now()-started)/1000,submissions,reportedTokens:tokens,failure,stats,peakRssMB:peakRss/1048576,peakHeapMB:peakHeap/1048576,minFreeMB:minFree/1048576,maxEventLoopDelayMs:lag,registryPreserved:finalRegistryHash===originalHash,registryStartHash:originalHash,registryFinalHash:finalRegistryHash,productionRegistryWrittenByHarness:false,results,note:'Real providers on unfinished existing scenes; prior cache/checkpoints retained. Means include contention and fallback. Not a cold full-film benchmark. Baseline used MemoryProjectRepository; memory/timing cannot be directly compared.'};
  await atomicWrite(join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,results:undefined}));
  app.exit(failure?1:0);
}).catch(error=>{console.error((error instanceof Error ? error.stack ?? error.message : String(error)).replace(/https?:\/\/\S+/g,'[source]'));app.exit(1);});
