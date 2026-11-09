import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {createDefaultProjectSettings,createDocumentarySettings,type Project} from '@gold-work/shared';
import {MockGenerationPipeline} from './mock-generation-pipeline.js';
import {FileTaskRepository} from './file-task-repository.js';
import {LocalProjectStorage} from './local-project-storage.js';
import type {StandardRenderer} from './standard-renderer.js';

async function exportFixture(t: import('node:test').TestContext) {
  const root=await mkdtemp(join(tmpdir(),'gws-export-queue-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const settings=createDefaultProjectSettings();
  settings.voice.enabled=false;settings.video.enabled=false;
  settings.assembly.documentary={...createDocumentarySettings(),autoMotionGraphics:false};
  const source=join(root,'saved.jpg');await writeFile(source,'queue fixture; rendering is stubbed');
  const repository=new MemoryProjectRepository(),projects=new ProjectService(repository,new MockDirectorProvider());
  const project={id:'export',title:'Stock',mediaMode:'stock',aspectRatio:'16:9',status:'ready',settings,scenes:[{
    id:'scene',order:0,narration:'A ship at sea.',durationSeconds:2,status:'ready',imagePath:source,
    documentary:{version:2,verified:true,pinned:true,checksum:'fixture',layout:'full',template:'full',effects:[],candidates:[],
      caption:{enabled:false,text:''},requirement:{text:'A ship at sea.',entities:[],years:[],queries:[]},selected:{kind:'image',localPath:source,width:1920,height:1080}}
  }]} as unknown as Project;
  await repository.save(project);
  const queuePath=join(root,'queue.json'),tasks=new FileTaskRepository(queuePath),storage=new LocalProjectStorage(join(root,'projects'));
  const outputPath=join(root,'Final.mp4');
  return {root,projects,project,queuePath,tasks,storage,outputPath};
}

test('explicit Stock export persists its intent and resumes as export after a restart',async t=>{
  const {projects,project,queuePath,tasks,storage,outputPath}=await exportFixture(t);let renders=0;
  const renderer={render:async()=>{renders++;await writeFile(outputPath,'stubbed export');return outputPath;}} as unknown as StandardRenderer;
  const original=new MockGenerationPipeline(tasks,projects,storage,renderer);
  const created=await original.assembleOnly(project.id);
  assert.equal(created[0]!.prepareOnly,false,'new export jobs carry explicit intent');
  assert.equal(JSON.parse(await readFile(queuePath,'utf8'))[0].prepareOnly,false);
  const restored=new MockGenerationPipeline(new FileTaskRepository(queuePath),projects,storage,renderer);
  await restored.initialize();
  const checkpoint=(await restored.list())[0]!;
  assert.equal(checkpoint.status,'paused');assert.equal(checkpoint.prepareOnly,false);assert.equal(renders,0);
  await restored.resume(project.id);await restored.drain();
  const completed=(await restored.list())[0]!;
  assert.equal(renders,1);assert.equal(completed.status,'done');assert.equal(completed.resultPath,outputPath);
  const saved=(await projects.get(project.id))!;
  assert.equal(saved.outputPath,outputPath);assert.equal(saved.status,'complete');
});

test('failed standalone Stock export retries after restart without recreating scene or paid jobs',async t=>{
  const {projects,project,queuePath,tasks,storage,outputPath}=await exportFixture(t);let renders=0;
  const renderer={render:async()=>{if(++renders===1)throw Error('ENOSPC: fixture disk full');await writeFile(outputPath,'stubbed export');return outputPath;}} as unknown as StandardRenderer;
  const original=new MockGenerationPipeline(tasks,projects,storage,renderer);
  const [created]=await original.assembleOnly(project.id);await original.drain();
  assert.equal((await original.list())[0]!.status,'failed');
  const before=(await projects.get(project.id))!;
  const restored=new MockGenerationPipeline(new FileTaskRepository(queuePath),projects,storage,renderer);
  const pending=await restored.retry(created!.id);
  assert.equal(pending.status,'pending');assert.equal(pending.id,created!.id);assert.equal(pending.runId,created!.runId);
  await restored.drain();
  const completed=await restored.list();
  assert.equal(completed.length,1);assert.equal(completed[0]!.kind,'assemble');assert.equal(completed[0]!.status,'done');
  assert.equal(completed[0]!.resultPath,outputPath);assert.equal(renders,2);
  const after=(await projects.get(project.id))!;
  assert.equal(after.status,'complete');assert.deepEqual(after.scenes,before.scenes);assert.deepEqual(after.settings,before.settings);
});

test('standalone export retry refuses changed scene content, settings, missing media and uncertain paid submissions',async t=>{
  const {projects,project,queuePath,tasks,storage}=await exportFixture(t);let renders=0;
  const renderer={render:async()=>{renders++;throw Error('ENOSPC: fixture disk full');}} as unknown as StandardRenderer;
  const pipeline=new MockGenerationPipeline(tasks,projects,storage,renderer);
  const [created]=await pipeline.assembleOnly(project.id);await pipeline.drain();
  const baseline=(await projects.get(project.id))!;
  for(const edit of ['scene','sceneId','removedScene','settings','trim'] as const){
    const changed=structuredClone(baseline);
    if(edit==='scene')changed.scenes[0]!.narration='Changed narration';
    else if(edit==='sceneId')changed.scenes[0]!.id='replacement';
    else if(edit==='removedScene')changed.scenes=[];
    else if(edit==='trim')changed.scenes[0]!.durationOverrideSeconds=6;
    else changed.settings.voice.voice='changed voice';
    await projects.update(project.id,{scenes:changed.scenes,settings:changed.settings});
    const restored=new MockGenerationPipeline(new FileTaskRepository(queuePath),projects,storage,renderer);
    await assert.rejects(restored.retry(created!.id),/изменил|изменены/i);
    assert.equal((await restored.list())[0]!.status,'failed');
  }
  await projects.update(project.id,{scenes:baseline.scenes,settings:baseline.settings});
  await rm(baseline.scenes[0]!.imagePath!);
  const missing=new MockGenerationPipeline(new FileTaskRepository(queuePath),projects,storage,renderer);
  await assert.rejects(missing.retry(created!.id),/материал|изображение/i);
  const [failed]=await tasks.list();
  await tasks.replace([{...failed!,pendingSubmission:{provider:'lumean',kind:'speech',startedAt:new Date().toISOString()}}]);
  const uncertain=new MockGenerationPipeline(new FileTaskRepository(queuePath),projects,storage,renderer);
  await assert.rejects(uncertain.retry(created!.id),/платное|Lumean|платный/i);
  assert.equal(renders,1);
});

test('standalone export retry keeps legacy failures without an input checkpoint blocked',async t=>{
  const {projects,project,queuePath,tasks,storage}=await exportFixture(t);
  const renderer={render:async()=>{throw Error('ENOSPC: fixture disk full');}} as unknown as StandardRenderer;
  const pipeline=new MockGenerationPipeline(tasks,projects,storage,renderer);
  const [created]=await pipeline.assembleOnly(project.id);await pipeline.drain();
  const saved=JSON.parse(await readFile(queuePath,'utf8'));
  delete saved[0].failedAssemblyInputHash;
  await writeFile(queuePath,JSON.stringify(saved));
  const restored=new MockGenerationPipeline(new FileTaskRepository(queuePath),projects,storage,renderer);
  await assert.rejects(restored.retry(created!.id),/нет сохранённого состояния входов/);
  assert.equal((await restored.list())[0]!.status,'failed');
});
