import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {FileTaskRepository} from './file-task-repository.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {MockGenerationPipeline} from './mock-generation-pipeline.js';
import {StandardRenderer} from './standard-renderer.js';

test('completed narration cannot mark incomplete documentary materials ready on startup',async t=>{
 const root=await mkdtemp(join(tmpdir(),'gws-stock-restart-status-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
 const project=await projects.create({title:'Partial',topic:'Motorcycles',language:'en',aspectRatio:'16:9',mode:'standard',mediaMode:'stock'},true);
 await projects.mutate(project.id,()=>({status:'failed'}));
 const tasks=new FileTaskRepository(join(root,'tasks.json'));
 await tasks.replace([{id:'voice',runId:'previous-voice',projectId:project.id,sceneId:project.scenes[0]!.id,kind:'speech',label:'Existing voice',
  status:'done',attempts:1,maxAttempts:1,progress:100,dependsOn:[],resultPath:'existing-paid-voice.wav',createdAt:'',updatedAt:''}]);
 const storage=new LocalProjectStorage(join(root,'projects'));
 const pipeline=new MockGenerationPipeline(tasks,projects,storage,new StandardRenderer(storage));
 await pipeline.initialize();
 const saved=(await projects.get(project.id))!;
 assert.equal(saved.status,'failed');assert.equal(saved.scenes[0]!.audioPath,'existing-paid-voice.wav');
 assert.deepEqual((await tasks.list())[0]!.status,'done');assert.equal(saved.outputPath,undefined);
});

test('completed voice tasks keep an active documentary production running until selection finishes',async t=>{
 const root=await mkdtemp(join(tmpdir(),'gws-stock-active-status-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
 const project=await projects.create({title:'Active production',topic:'City',language:'en',aspectRatio:'16:9',mode:'standard',mediaMode:'stock'},true);
 await projects.mutate(project.id,()=>({status:'generating'}));
 const tasks=new FileTaskRepository(join(root,'tasks.json'));
 await tasks.replace([{id:'voice',runId:'current-voice',projectId:project.id,sceneId:project.scenes[0]!.id,kind:'speech',label:'Paid voice',
  status:'done',attempts:1,maxAttempts:1,progress:100,dependsOn:[],resultPath:'existing-paid-voice.wav',createdAt:'',updatedAt:''}]);
 const storage=new LocalProjectStorage(join(root,'projects'));
 const pipeline=new MockGenerationPipeline(tasks,projects,storage,new StandardRenderer(storage),undefined,undefined,undefined,undefined,undefined,undefined,
  id=>id===project.id);
 await pipeline.initialize();
 assert.equal((await projects.get(project.id))!.status,'generating');
 assert.equal((await projects.get(project.id))!.scenes[0]!.audioPath,'existing-paid-voice.wav');
 const restarted=new MockGenerationPipeline(tasks,projects,storage,new StandardRenderer(storage));
 await restarted.initialize();
 assert.equal((await projects.get(project.id))!.status,'failed','A process restart must not invent an active selection');
});

test('opening an idle draft with saved narration leaves the original project unchanged',async t=>{
 const root=await mkdtemp(join(tmpdir(),'gws-stock-idle-restart-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
 let project=await projects.create({title:'Original draft',topic:'Motorcycles',language:'en',aspectRatio:'16:9',mode:'standard',mediaMode:'stock'},true);
 project=await projects.mutate(project.id,current=>({status:'draft',scenes:current.scenes.map(scene=>({...scene,status:'ready',audioPath:`saved-${scene.id}.wav`}))}));
 const tasks=new FileTaskRepository(join(root,'tasks.json'));
 await tasks.replace(project.scenes.map(scene=>({id:`voice-${scene.id}`,runId:'old-paid-voice',projectId:project.id,sceneId:scene.id,kind:'speech',label:'Saved voice',
  status:'done',attempts:1,maxAttempts:1,progress:100,dependsOn:[],resultPath:scene.audioPath,createdAt:'',updatedAt:''})));
 const storage=new LocalProjectStorage(join(root,'projects'));
 const pipeline=new MockGenerationPipeline(tasks,projects,storage,new StandardRenderer(storage));
 await pipeline.initialize();
 assert.deepEqual(await projects.get(project.id),project,'Restart must not change draft/status/timestamps or saved media');
 await pipeline.tick();
 assert.deepEqual(await projects.get(project.id),project,'Idle polling must preserve the same original project');
});
