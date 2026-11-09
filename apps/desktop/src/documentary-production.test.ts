import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import {createHash} from 'node:crypto';
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryProjectRepository, MockDirectorProvider, ProjectService } from "@gold-work/core";
import { createVoiceCalibration, type DocumentaryCandidate, type QueueTask } from "@gold-work/shared";
import { DocumentaryProjectService,documentaryPhotoFirstScenes,selectSimpleDocumentaryCandidates } from "./documentary-project-service.js";
import { DocumentarySearch } from "./documentary-search.js";
import { LocalProjectStorage } from "./local-project-storage.js";
import { prepareDocumentaryScript } from "./documentary-plan.js";
import { documentaryNarrationReadiness,prepareDocumentaryProduction,DocumentarySelectionIncompleteError } from "./documentary-production.js";
import { effectFfmpeg } from "./effect-media.js";
import {documentarySavedContextIssue} from './documentary-context-approval.js';
import {DocumentaryAnalysisError} from './documentary-analysis-error.js';
import {DocumentaryCachedAnalysisMissing} from './documentary-intelligence.js';

test("sources prepare before TTS; same-source checks overlap and use measured voice without losing audio", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-production-overlap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projects = new ProjectService(new MemoryProjectRepository(), new MockDirectorProvider());
  const storage = new LocalProjectStorage(join(root, "projects"));
  let project = await projects.create({ title: "Pattern", topic: "Pattern", mediaMode: "stock", mode: "standard", language: "English", aspectRatio: "16:9" });
  project.videoBrief = { ...project.videoBrief!, creationMode: "script", readyScript: "The first view shows a changing pattern. The next view shows its movement." };
  project.scenes = prepareDocumentaryScript(project, createVoiceCalibration({ provider: "elevenlabs", voice: "fixture", language: "en", sampleText: "A measured fixture voice reads these exact words.", audioDurationSeconds: 4 })).slice(0, 2);
  assert.equal(project.scenes.length, 2);
  project.scenes.forEach(scene => { scene.documentary!.requirement = { ...scene.documentary!.requirement, plannedBy: "semantic", entities: ["Pattern"], identities: [], queries: ["Pattern"], preferredKind: "video" }; });
  project.settings.stockVideoPercent = 0;
  project.settings.voice.enabled = true;
  project = await projects.update(project.id, project);
  const source = join(root, "pattern.mp4");
  await effectFfmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=30", "-t", "8", "-c:v", "libx264", "-preset", "ultrafast", source]);
  const voice = join(root, "voice.wav");
  await effectFfmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", voice]);
  const candidate = { id: "pattern", provider: "local", kind: "video", title: "Pattern", description: "Pattern", localPath: source, downloadUrl: "", query: "Pattern", rights: "user-confirmed", concerns: [], match: "exact-metadata" } as unknown as DocumentaryCandidate;
  const search = new DocumentarySearch();
  search.search = async () => ({ candidates: [candidate], sources: [] });
  let prepared = 0, inspecting = 0, peak = 0;
  let sourcesReady!: () => void, inspectionsReady!: () => void;
  const beforeVoice = new Promise<void>(resolve => { sourcesReady = resolve; });
  const bothInspecting = new Promise<void>(resolve => { inspectionsReady = resolve; });
  const tasks = project.scenes.map(scene => ({ id: scene.id, sceneId: scene.id, kind: "speech", status: "running" })) as QueueTask[];
  const controller = new AbortController();
  const waitForVoice = documentaryNarrationReadiness({ projectId: project.id, projects, storage, tasks, list: async () => tasks, signal: controller.signal });
  const progress:string[]=[];
  const service = new DocumentaryProjectService(projects, storage, search, join(root, "Materials"), { download: async () => { throw new Error("Local media"); } }, event => {progress.push(event.message);}, {
    available: async () => true, plan: async () => new Map(),
    prepareSource: async (_project, scene) => {
      assert.equal(scene.audioPath, undefined, "Source catalogue must not wait for TTS");
      if (++prepared === 2) sourcesReady();
    },
    inspect: async (_project, scene) => {
      assert.equal(scene.audioPath, voice);
      assert.ok(scene.documentary!.timing!.durationInFrames >= 30 && scene.documentary!.timing!.durationInFrames <= 37);
      inspecting++; peak = Math.max(peak, inspecting);
      if (inspecting === 2) inspectionsReady();
      await bothInspecting;
      inspecting--;
      return { status: "accepted", confidence: 1, reason: "fixture", quality: "fixture", sampleSeconds: [], checkedAt: "now", trimStartSeconds: scene.order * 4, trimEndSeconds: scene.order * 4 + 1.2 };
    }
  });
  // The overlap contract needs two slots. Host RAM pressure must not turn this
  // local orchestration regression into a deadlock while waiting for two tasks.
  Object.assign(service,{selectionResources:async()=>({workers:2,physicalBytes:8*1024**3,commitBytes:8*1024**3})});
  await projects.mutate(project.id, () => ({ status: "generating" }));
  const run = service.autoSelect(project.id, {}, waitForVoice);
  const deadline = setTimeout(() => { controller.abort(); sourcesReady(); inspectionsReady(); }, 10000);
  try {
    await beforeVoice;
    assert.equal(prepared, 2,JSON.stringify(progress));
    await projects.mutate(project.id, current => ({ scenes: current.scenes.map(scene => ({ ...scene, audioPath: voice })), status: "ready" }));
    tasks.forEach(task => { task.status = "done"; });
    const result = await run;
    assert.equal(peak, 2, "Remote checks must not serialize on the source lock");
    assert.ok(result.project.scenes.every(scene => scene.audioPath === voice && scene.documentary?.timing));
  } finally { clearTimeout(deadline); controller.abort(); await run.catch(() => {}); }
});

test('fast local search plan starts production with narration without a semantic marker',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-fast-production-plan-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
  const storage=new LocalProjectStorage(join(root,'projects'));
  let project=await projects.create({title:'Motorcycle',topic:'Rossi',mediaMode:'stock',mode:'standard',language:'English',aspectRatio:'16:9'});
  const text='Valentino Rossi joined Yamaha in 2004.';
  project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:text};
  project.scenes=prepareDocumentaryScript(project,createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:text,audioDurationSeconds:4}));
  project.scenes[0]!.audioPath='already-paid-voice.mp3';
  project.settings.voice.enabled=true;
  project=await projects.update(project.id,project);
  const search=new DocumentarySearch();let searches=0,paidPlans=0;
  search.search=async()=>{searches++;return {candidates:[],sources:[]};};
  const service=new DocumentaryProjectService(projects,storage,search,join(root,'Materials'),{
    download:async()=>{throw Error('No download expected');},
  },()=>{}, {
    simpleSelection:true,available:async()=>true,
    plan:async()=>{paidPlans++;throw Error('Fast mode must not submit a semantic plan');},
    inspect:async()=>{throw Error('No media in this orchestration regression');},
  });
  const planned=await service.planSearch(project.id);
  assert.ok(planned.scenes[0]!.documentary!.requirement.queries.length);
  assert.equal(planned.scenes[0]!.documentary!.requirement.plannedBy,undefined);
  await projects.mutate(project.id,()=>({status:'generating'}));
  const result=await service.autoSelect(project.id,{},async()=>{});
  assert.ok(searches>0,'Production must reach discovery instead of rejecting the local plan');
  assert.equal(paidPlans,0);
  assert.equal(result.project.scenes[0]!.audioPath,'already-paid-voice.mp3');
  assert.equal(result.project.scenes[0]!.narration,text);
  assert.equal(result.project.scenes[0]!.documentary!.requirement.plannedBy,undefined);
});

test('bounded search preserves measured narration without an unsolicited graphic replacement',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-graphic-narration-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
  const storage=new LocalProjectStorage(join(root,'projects'));
  let project=await projects.create({title:'Engine',topic:'Motorcycle engine',mediaMode:'stock',mode:'standard',language:'English',aspectRatio:'16:9'});
  const text='Inside a racing engine, pistons and connecting rods constantly accelerate, stop and reverse direction.';
  project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:text};
  project.scenes=prepareDocumentaryScript(project,createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:text,audioDurationSeconds:4}));
  project=await projects.update(project.id,project);
  const search=new DocumentarySearch();let searches=0;
  search.search=async()=>{searches++;return {candidates:[],sources:[]};};
  const service=new DocumentaryProjectService(projects,storage,search,join(root,'Materials'),{
    download:async()=>{throw Error('No media download expected');},
  },()=>{}, {
    simpleSelection:true,available:async()=>true,
    plan:async()=>{throw Error('No paid search plan expected');},
    inspect:async()=>{throw Error('No paid graphic inspection expected');},
  });
  await service.planSearch(project.id);
  await projects.mutate(project.id,()=>({status:'generating'}));
  const result=await service.autoSelect(project.id,{},async()=>{
    await projects.mutate(project.id,current=>({scenes:current.scenes.map(scene=>({...scene,
      audioPath:'already-paid-voice.mp3',documentary:{...scene.documentary!,timing:{sourceKey:'measured',durationInFrames:270,speechSeconds:8.8}}}))}));
  });
  assert.ok(searches>0);
  assert.equal(result.failed,1);
  assert.ok(!result.project.scenes[0]!.documentary!.motionGraphic?.enabled);
  assert.equal(result.project.scenes[0]!.documentary!.verified,false);
  assert.equal(result.project.scenes[0]!.audioPath,'already-paid-voice.mp3');
});

test('unavailable review preserves voices and selected percentage with recoverable incomplete selection',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-offline-production-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
  const storage=new LocalProjectStorage(join(root,'projects'));
  let project=await projects.create({title:'Rossi',topic:'Rossi',mediaMode:'stock',mode:'standard',language:'English',aspectRatio:'16:9'});
  const text='Fortunately, Yamaha had already brought in Masao Furusawa to lead that work.';
  project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:text};
  project.scenes=prepareDocumentaryScript(project,createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:text,audioDurationSeconds:5}));
  project.scenes.forEach(scene=>scene.audioPath='already-paid-voice.wav');
  project.settings.stockVideoPercent=35;
  project=await projects.update(project.id,project);
  const service=new DocumentaryProjectService(projects,storage,new DocumentarySearch(),join(root,'Materials'),{download:async()=>{throw Error('No downloads');}},()=>{},
    {simpleSelection:true,available:async()=>false,plan:async()=>{throw Error('No planning POST');},inspect:async()=>{throw Error('No review POST');}});
  let voiceBarrier=0;
  await assert.rejects(prepareDocumentaryProduction(project.id,{projects,documentary:service,
    signal:new AbortController().signal,startNarration:async()=>async()=>{voiceBarrier++;}}),error=>
    error instanceof DocumentarySelectionIncompleteError&&/^Подбор приостановлен: сервис проверки материалов недоступен/.test(error.message));
  const completed=(await projects.get(project.id))!;
  assert.ok(voiceBarrier>0);
  assert.equal(completed.settings.stockVideoPercent,35);
  assert.ok(completed.scenes.every(scene=>!scene.documentary?.verified&&!scene.documentary?.nativeFallback));
  assert.ok(completed.scenes.every(scene=>scene.audioPath==='already-paid-voice.wav'));
});

test('production never replaces Stop or storage failures with graphic success',async()=>{
  const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
  const project=await projects.create({title:'Railway',topic:'Railway',mediaMode:'stock',mode:'standard',language:'English',aspectRatio:'16:9'});
  let cards=0,plans=0;
  const storageFailure=new Error('Storage fixture failure');
  const documentary={canResumeNativeFallback:async()=>false,planSearch:async()=>{plans++;return project;},autoSelect:async()=>{throw storageFailure;},completeWithNativeFallback:async()=>{cards++;return project;}};
  const controller=new AbortController();
  const options={projects,documentary,signal:controller.signal,startNarration:async()=>async()=>{}};
  await assert.rejects(prepareDocumentaryProduction(project.id,options),error=>error===storageFailure);
  assert.equal(cards,0);
  controller.abort();
  await assert.rejects(prepareDocumentaryProduction(project.id,options),error=>error instanceof Error&&error.name==='AbortError');
  assert.equal(plans,1);
  assert.equal(cards,0);
});

test('single-review mode tries a second distinct image after a pixel rejection within the existing two-attempt budget',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-fast-refusal-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider()),storage=new LocalProjectStorage(join(root,'projects'));
  let project=await projects.create({title:'Railway',topic:'Railway',mediaMode:'stock',mode:'standard',language:'English',aspectRatio:'16:9'});
  const text='Photograph: A steam locomotive pulls a train along the railway.';
  project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:text};
  project.scenes=prepareDocumentaryScript(project,createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:text,audioDurationSeconds:4}));
  project.settings.voice.enabled=false;project.settings.stockVideoPercent=0;project=await projects.update(project.id,project);
  const candidates:DocumentaryCandidate[]=[];
  for(const [id,pattern] of [['first','testsrc2=s=1280x720:r=1'],['second','smptebars=s=1280x720:r=1']] as const){
    const path=join(root,id+'.jpg');await effectFfmpeg(['-y','-f','lavfi','-i',pattern!,'-frames:v','1',path]);
    candidates.push({id,provider:'local',kind:'image',title:'Steam locomotive pulling train',description:'Steam locomotive pulling train',localPath:path,downloadUrl:'',pageUrl:'',author:'fixture',license:'user',licenseUrl:'',attribution:'fixture',rights:'user-confirmed',query:'steam locomotive pulling train',retrievedAt:'now',match:'unverified',concerns:[]});
  }
  const search=new DocumentarySearch();search.search=async()=>({candidates,sources:[]});const seen:string[]=[];
  const service=new DocumentaryProjectService(projects,storage,search,join(root,'Materials'),{download:async()=>{throw Error('Local fixture');}},()=>{},
    {simpleSelection:true,available:async()=>true,plan:async()=>new Map(),inspect:async(_p,scene)=>{
      const id=scene.documentary!.selected!.id;seen.push(id);return {status:id==='first'?'rejected':'accepted',confidence:1,reason:'Mock pixel verdict for orchestration only',quality:'mock',sampleSeconds:[],checkedAt:'now'};
    }});
  await service.planSearch(project.id);const result=await service.autoSelect(project.id);
  assert.deepEqual(seen,['first','second'],JSON.stringify(result.failures));assert.equal(result.failed,0);assert.equal(result.project.scenes[0]!.documentary!.selected!.id,'second');
});

test('simple selection respects 0/35/100 percentages and provider candidate order without metadata ranking',async()=>{
  const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
  const project=await projects.create({title:'Train',topic:'Train',mode:'standard',mediaMode:'stock',language:'English',aspectRatio:'16:9'});
  project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:'A train moves along a railway.'};
  const base=prepareDocumentaryScript(project)[0]!;
  project.scenes=Array.from({length:20},(_,order)=>({...structuredClone(base),id:`s${order}`,order,durationSeconds:5}));
  for(const [percentage,photos]of [[0,20],[35,13],[100,0]]){
    project.settings.stockVideoPercent=percentage!;
    assert.equal(documentaryPhotoFirstScenes(project,true).size,photos);
    assert.equal(project.settings.stockVideoPercent,percentage);
  }
  const candidates=[{id:'a',provider:'local',kind:'image',title:'Unrelated metadata',rights:'user-confirmed'},
    {id:'b',provider:'local',kind:'image',title:'Exact train metadata',rights:'user-confirmed'}] as DocumentaryCandidate[];
  assert.deepEqual(selectSimpleDocumentaryCandidates([...candidates,candidates[0]!]).map(item=>item.id),['a','b']);
});

for(const retained of [false,true])test(`a confirmed vision outage stops new simple-selection scenes after a ${retained?'retained':'fresh'} file without rejecting their materials`,async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-vision-outage-drain-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
  const storage=new LocalProjectStorage(join(root,'projects'));
  let project=await projects.create({title:'Railway',topic:'Railway',mediaMode:'stock',mode:'standard',language:'English',aspectRatio:'16:9'});
  project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:'Photograph: A train travels along a railway.'};
  const base=prepareDocumentaryScript(project)[0]!;
  project.scenes=Array.from({length:4},(_,order)=>({...structuredClone(base),id:`outage-${order}`,order,audioPath:`saved-${order}.mp3`}));
  project.settings.voice.enabled=false;project.settings.stockVideoPercent=0;
  project=await projects.update(project.id,project);
  const candidates:DocumentaryCandidate[]=[];
  for(const [id,pattern] of [['one','testsrc2=s=1280x720:r=1'],['two','smptebars=s=1280x720:r=1']] as const){
    const localPath=join(root,id+'.jpg');
    await effectFfmpeg(['-y','-f','lavfi','-i',pattern,'-frames:v','1',localPath]);
    candidates.push({id,provider:'local',kind:'image',title:'Train on a railway',description:'Train on a railway',localPath,
      downloadUrl:'',pageUrl:'',author:'fixture',license:'user',licenseUrl:'',attribution:'fixture',rights:'user-confirmed',
      query:'train railway',retrievedAt:'now',match:'unverified',concerns:[]});
  }
  const search=new DocumentarySearch();search.search=async()=>({candidates,sources:[]});
  const reviewed:number[]=[];
  const outage=new DocumentaryAnalysisError('Сервис анализа временно недоступен: HTTP 503','unavailable','single-visual-target',false,true);
  const service=new DocumentaryProjectService(projects,storage,search,join(root,'Materials'),
    {download:async()=>{throw Error('Only existing local media');}},()=>{}, {
      simpleSelection:true,available:async()=>true,plan:async()=>new Map(),inspect:async(_current,scene)=>{
        reviewed.push(scene.order);
        throw outage;
      },
      ...(retained?{inspectForSelection:async(_current,scene,_progress,_stop,cacheOnly)=>{
        if(cacheOnly)throw new DocumentaryCachedAnalysisMissing('No saved answer');
        reviewed.push(scene.order);throw outage;
      }}:{}),
    });
  Object.assign(service,{selectionResources:async()=>({workers:1,physicalBytes:8*1024**3,commitBytes:8*1024**3})});
  await service.planSearch(project.id);
  if(retained){
    const candidate=candidates[0]!,checksum=createHash('sha256').update(await readFile(candidate.localPath!)).digest('hex');
    await projects.mutate(project.id,current=>({scenes:current.scenes.map((scene,index)=>index?scene:{...scene,imagePath:candidate.localPath,
      documentary:{...scene.documentary!,selected:candidate,checksum,verified:false,visualReview:undefined}})}));
  }
  await assert.rejects(service.autoSelect(project.id),error=>error===outage);
  assert.deepEqual(reviewed,[0]);
  const saved=(await projects.get(project.id))!;
  assert.ok(saved.scenes.slice(1).every(scene=>!scene.documentary?.autoError&&!scene.documentary?.visualReview));
  assert.equal(saved.scenes[0]!.documentary?.visualReview,undefined,'A provider outage is not a content verdict');
  assert.deepEqual(saved.scenes.map(scene=>scene.audioPath),project.scenes.map(scene=>scene.audioPath));
});

test('cheap candidate ordering ignores period-only matches before spending a frame review',()=>{
  const candidate=(id:string,title:string,query:string)=>({id,provider:'pixabay',kind:'video',rights:'user-confirmed',title,query,description:''}) as DocumentaryCandidate;
  const ranked=selectSimpleDocumentaryCandidates([
    candidate('period','Woman in 19th century dress','19th century sailing ship'),
    candidate('unknown','Evening at sea','sailing ship'),
    candidate('ship','Sailing ship on open water','sailing ship'),
  ]);
  assert.deepEqual(ranked.map(item=>item.id),['ship','unknown']);
});

test('production treats a mixed video percentage as a search target while 100 percent remains strict',async()=>{
  const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
  const project=await projects.create({title:'Harbour',topic:'Harbour',mode:'standard',mediaMode:'stock',language:'English',aspectRatio:'16:9'});
  project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:'The harbour is quiet.'};
  project.scenes=prepareDocumentaryScript(project);
  project.settings.stockVideoPercent=60;
  const scene=project.scenes[0]!;
  scene.audioPath='preserved-paid-voice.mp3';scene.imagePath='accepted-harbour.jpg';
  // A file extension must never turn an image candidate into moving footage.
  scene.videoPath='photo-wrapped-in-video.mp4';
  scene.documentary={...scene.documentary!,verified:true,selected:{id:'photo',kind:'image',provider:'local',rights:'user-confirmed'} as DocumentaryCandidate};
  const before=structuredClone(project.scenes);let montages=0,completions=0;
  const documentary={automaticVideoQuotaRequired:true,
    planSearch:async()=>project,autoSelect:async()=>({project,total:1,selected:0,skipped:1,failed:0,failures:[]}),
    completeWithVideoQuota:async()=>{completions++;return project;},prepareMontage:async()=>{montages++;return project;}};
  const options={projects:{get:async()=>project,update:projects.update.bind(projects)},documentary,signal:new AbortController().signal,startNarration:async()=>async()=>{}};
  const result=await prepareDocumentaryProduction(project.id,options);
  assert.equal(result.project.settings.stockVideoPercent,60);
  assert.equal(completions,1);assert.equal(montages,1);assert.deepEqual(project.scenes,before);
  assert.equal(project.settings.stockVideoPercent,60);
  scene.documentary!.verified=false;
  await assert.rejects(prepareDocumentaryProduction(project.id,options),/Не найдены подходящие материалы/);
  assert.equal(completions,1);assert.equal(montages,1,'An unready scene must stop before quota completion and montage');
  scene.documentary!.verified=true;
  project.settings.stockVideoPercent=100;
  await assert.rejects(prepareDocumentaryProduction(project.id,options),error=>error instanceof DocumentarySelectionIncompleteError
    &&error.recoverable&&/0.0%.*100%/.test(error.message));
  assert.equal(completions,2);assert.equal(montages,1);
  // The user's explicit video-only mode does not depend on the analysis adapter.
  documentary.automaticVideoQuotaRequired=false;
  await assert.rejects(prepareDocumentaryProduction(project.id,options),/0.0%.*100%/);
  assert.equal(completions,2);assert.equal(montages,1);
  project.settings.stockVideoPercent=0;
  await prepareDocumentaryProduction(project.id,options);assert.equal(montages,2);
  documentary.automaticVideoQuotaRequired=true;project.settings.stockVideoPercent=60;
  documentary.prepareMontage=async()=>{montages++;return {...project,settings:{...project.settings,stockVideoPercent:100}};};
  await assert.rejects(prepareDocumentaryProduction(project.id,options),DocumentarySelectionIncompleteError);
  assert.equal(montages,3,'Quota must be checked against the returned montage snapshot as well');
  assert.deepEqual(project.scenes,before);
});
test('settled route preparation runs before readiness but cannot bypass explicit video-only mode',async()=>{
  const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
  let project=await projects.create({title:'Routes',topic:'Routes',mediaMode:'stock',mode:'standard',language:'English',aspectRatio:'16:9'});
  project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:'The ships followed alternative routes.'};
  project.scenes=prepareDocumentaryScript(project,createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:'A measured voice reads the sentence.',audioDurationSeconds:4})).slice(0,1);
  project.settings.stockVideoPercent=100;
  const failure={sceneId:project.scenes[0]!.id,sceneNumber:1,category:'provider-temporary' as const,message:'source unavailable'};
  const stages:string[]=[];
  const documentary={automaticVideoQuotaRequired:true,planSearch:async()=>project,
    autoSelect:async()=>{stages.push('selection');return {project,total:1,selected:0,skipped:0,failed:1,failures:[failure]};},
    prepareRouteComparisons:async(_id:string,failures:unknown[])=>{assert.deepEqual(failures,[failure]);stages.push('route');project.scenes[0]!.documentary!.verified=true;return project;},
    prepareMontage:async()=>{stages.push('montage');return project;}};
  assert.equal(project.settings.stockVideoPercent,100);
  await assert.rejects(prepareDocumentaryProduction(project.id,{projects:{get:async()=>project,update:async()=>project},documentary,signal:new AbortController().signal,startNarration:async()=>async()=>{}}),/0.0%.*100%/);
  assert.deepEqual(stages,['selection','route']);assert.equal(project.settings.stockVideoPercent,100);
});
