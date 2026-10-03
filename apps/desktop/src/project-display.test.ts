import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectService, MockDirectorProvider} from '@gold-work/core';
import type {DocumentaryCandidate} from '@gold-work/shared';
import {FileProjectRepository} from './file-project-repository.js';
import {projectForDisplay,projectResultForDisplay} from './project-display.js';

test('light display snapshots preserve paid evidence through a timeline edit and fetch candidates separately',async()=>{
  const root=await mkdtemp(join(tmpdir(),'gws-project-display-'));
  const repo=new FileProjectRepository(join(root,'projects.json'));
  const service=new ProjectService(repo,new MockDirectorProvider());
  const project=await service.create({title:'Display',topic:'Ships',language:'ru',aspectRatio:'16:9',mode:'standard',mediaMode:'stock'});
  const candidates=[{id:'candidate',title:'Original',concerns:['Evidence'],description:'Heavy search metadata'}] as DocumentaryCandidate[];
  project.scenes=[{id:'s',order:0,title:'Scene',narration:'Original words.',imagePrompt:'',animationPrompt:'',durationSeconds:5,status:'ready',audioPath:'paid.wav',
    documentary:{version:2,requirement:{text:'Original words.',entities:[],years:[],queries:[]},candidates,verified:true,pinned:false,illustrative:false,reviewNote:'Reviewed',caption:{text:'',enabled:false,position:'bottom',animation:'fade',fontSize:40,color:'#fff',backgroundColor:'#000',opacity:80},layout:'full',effects:[]}}];
  await repo.save(project);
  const display=projectForDisplay(project);
  assert.equal(display.scenes[0]!.documentary!.candidateCount,1);
  assert.deepEqual(display.scenes[0]!.documentary!.candidates,[]);
  display.scenes[0]!.documentary!.caption={...display.scenes[0]!.documentary!.caption,text:'Edited'};
  await service.update(project.id,{scenes:display.scenes});
  const stored=(await repo.get(project.id))!;
  assert.deepEqual(stored.scenes[0]!.documentary!.candidates,candidates);
  assert.equal(stored.scenes[0]!.documentary!.candidatesDeferred,undefined);
  assert.equal(stored.scenes[0]!.audioPath,'paid.wav');
  assert.equal(stored.scenes[0]!.documentary!.caption.text,'Edited');
  const snapshot=await repo.listForDisplay();
  const lightList=await service.list({omitCandidates:true});
  assert.equal(lightList[0]!.scenes[0]!.documentary!.candidates.length,0);
  assert.equal((await repo.get(project.id))!.scenes[0]!.documentary!.candidates.length,1);
  assert.equal((await repo.listForDisplay(snapshot.versions)).projects.length,0);
  const result=projectResultForDisplay({project:stored,failed:0}) as {project:typeof stored};
  assert.equal(result.project.scenes[0]!.documentary!.candidates.length,0);
  // A full, explicit server-side candidate replacement remains possible.
  stored.scenes[0]!.documentary!.candidates=[];
  await service.update(stored.id,{scenes:stored.scenes});
  assert.deepEqual((await repo.get(stored.id))!.scenes[0]!.documentary!.candidates,[]);
});
