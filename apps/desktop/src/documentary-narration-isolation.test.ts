import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {MemoryProjectRepository, MockDirectorProvider, ProjectService} from '@gold-work/core';
import type {DocumentaryCandidate, QueueTask} from '@gold-work/shared';
import {LocalProjectStorage} from './local-project-storage.js';
import {prepareDocumentaryScript} from './documentary-plan.js';
import {documentaryNarrationReadiness} from './documentary-production.js';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {DocumentarySearch} from './documentary-search.js';
import {effectFfmpeg} from './effect-media.js';

test('failed or blocked foreign speech does not reject a ready scene; all-tracks barrier still fails', async t => {
  const root = await mkdtemp(join(tmpdir(), 'gws-narration-isolation-'));
  t.after(async () => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    await rm(root, {recursive:true,force:true});
  });
  const projects = new ProjectService(new MemoryProjectRepository(), new MockDirectorProvider());
  const storage = new LocalProjectStorage(join(root, 'projects'));
  let project = await projects.create({title:'Train',topic:'Train',mediaMode:'stock',mode:'standard',language:'English',aspectRatio:'16:9'});
  project.videoBrief = {...project.videoBrief!,creationMode:'script',readyScript:'A train moves along the railway.'};
  const scene = prepareDocumentaryScript(project)[0]!;
  const voice = join(root, 'ready.wav');
  await effectFfmpeg(['-y','-f','lavfi','-i','sine=frequency=440:duration=1',voice]);
  project.scenes = [{...scene,id:'ready',audioPath:voice},{...structuredClone(scene),id:'failed',order:1}];
  project.settings.voice.enabled = true;
  project = await projects.update(project.id, project);
  const tasks = [
    {id:'voice-ready',sceneId:'ready',kind:'speech',status:'done'},
    {id:'voice-failed',sceneId:'failed',kind:'speech',status:'failed'},
  ] as QueueTask[];
  const wait = documentaryNarrationReadiness({projectId:project.id,projects,storage,tasks,list:async()=>tasks,signal:new AbortController().signal});
  for (const status of ['failed','blocked'] as const) {
    tasks[1]!.status = status;
    await wait('ready');
    assert.ok((await projects.get(project.id))!.scenes[0]!.documentary!.timing!.speechSeconds > 0);
    await assert.rejects(wait('failed'), /озвучки требует внимания/);
    await assert.rejects(wait(), /озвучки требует внимания/);
  }
  const continuous = [{id:'continuous',sceneId:'ready',narrationSceneIds:['ready','failed'],kind:'speech',status:'failed'}] as QueueTask[];
  const waitContinuous = documentaryNarrationReadiness({projectId:project.id,projects,storage,tasks:continuous,list:async()=>continuous,signal:new AbortController().signal});
  await assert.rejects(waitContinuous('failed'), /озвучки требует внимания/);
});

test('a local narration failure lets later scenes finish selection before the final voice barrier fails', async t => {
  const root = await mkdtemp(join(tmpdir(), 'gws-narration-selection-'));
  t.after(async () => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    await rm(root, {recursive:true,force:true});
  });
  const projects = new ProjectService(new MemoryProjectRepository(), new MockDirectorProvider());
  const storage = new LocalProjectStorage(join(root, 'projects'));
  let project = await projects.create({title:'Train',topic:'Train',mediaMode:'stock',mode:'standard',language:'English',aspectRatio:'16:9'});
  project.videoBrief = {...project.videoBrief!,creationMode:'script',readyScript:'Photograph: A steam train stands at a railway station.'};
  const scene = prepareDocumentaryScript(project)[0]!;
  project.scenes = [{...scene,id:'failed'},{...structuredClone(scene),id:'ready',order:1}];
  project.settings.voice.enabled = false;
  project.settings.stockVideoPercent = 0;
  project = await projects.update(project.id, project);
  const path = join(root, 'train.jpg');
  await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=s=1280x720:r=1','-frames:v','1',path]);
  const candidate: DocumentaryCandidate = {id:'local-train',provider:'local',kind:'image',title:'Train at station',description:'Train at station',localPath:path,downloadUrl:'',pageUrl:'',author:'fixture',license:'user',licenseUrl:'',attribution:'fixture',rights:'user-confirmed',query:'train station',retrievedAt:'now',match:'unverified',concerns:[]};
  const search = new DocumentarySearch();
  search.search = async () => ({candidates:[candidate],sources:[]});
  const inspected: string[] = [];
  const service = new DocumentaryProjectService(projects,storage,search,join(root,'Materials'),{download:async()=>{throw Error('Local fixture only');}},()=>{}, {
    simpleSelection:true,available:async()=>true,plan:async()=>new Map(),inspect:async(_project,current)=>{
      inspected.push(current.id);
      return {status:'accepted',confidence:1,reason:'Local orchestration fixture',quality:'fixture',sampleSeconds:[],checkedAt:'now'};
    },
  });
  Object.assign(service,{selectionResources:async()=>({workers:1,physicalBytes:8*1024**3,commitBytes:8*1024**3})});
  await service.planSearch(project.id);
  const waited: Array<string | undefined> = [];
  await assert.rejects(service.autoSelect(project.id,{},async sceneId => {
    waited.push(sceneId);
    if (sceneId !== 'ready') throw new Error('Voice failed for the first scene');
  }), /Voice failed for the first scene/);
  assert.deepEqual(inspected, ['ready']);
  assert.deepEqual(waited, ['failed','ready',undefined]);
  const saved = (await projects.get(project.id))!;
  assert.equal(saved.scenes.find(item=>item.id==='ready')!.documentary!.verified, true);
  assert.match(saved.scenes.find(item=>item.id==='failed')!.documentary!.autoError!, /Voice failed/);
});
