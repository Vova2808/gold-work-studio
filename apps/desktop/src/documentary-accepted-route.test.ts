import assert from 'node:assert/strict';
import test,{type TestContext} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {createVoiceCalibration,type DocumentaryMotionGraphic,type Project,type Scene} from '@gold-work/shared';
import {buildDocumentaryTimeline} from '../../../packages/remotion-video/src/documentary-timeline.js';
import {documentaryRouteBounds,documentaryRouteKey} from '../../../packages/remotion-video/src/documentary-route.js';
import {prepareDocumentaryScript} from './documentary-plan.js';
import {planFastDocumentaryScene} from './documentary-fast-plan.js';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {DocumentarySearch} from './documentary-search.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {documentaryIllustrationApproval,documentarySavedContextIssue,revalidateDocumentaryContext} from './documentary-context-approval.js';
import {documentaryAutomaticMaterialReady} from './documentary-auto-readiness.js';
import {missingAssemblyInputs} from './assembly-readiness.js';

function obsoleteRoute():DocumentaryMotionGraphic {
  return {enabled:true,kind:'map-route',origin:'automatic',title:'Old automatic comparison',startSeconds:0,durationSeconds:4,
    routeComparison:{version:1,origin:'generated-route-schematic',contextHash:'obsolete',sceneNarration:'Old route narration',
      visualTarget:'Old map target',title:'Old comparison',model:'fixture',comparisonQuotes:['Invented London to Shanghai quotation'],
      routes:[],disclaimer:'Saved obsolete schematic'}};
}

async function fixture(t:TestContext){
  const root=await mkdtemp(join(tmpdir(),'gws-accepted-route-'));
  t.after(async()=>{assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));await rm(root,{recursive:true,force:true});});
  const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
  const storage=new LocalProjectStorage(join(root,'projects'));
  let project=await projects.create({title:'Canal',topic:'Shipping',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
  const narration='Ships pass through the Suez Canal.';
  project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:narration};
  project.settings.voice.enabled=false;project.settings.stockVideoPercent=100;
  project.settings.assembly.documentary!.autoMotionGraphics=false;project.settings.assembly.documentary!.autoEffects=false;
  const scene=prepareDocumentaryScript(project,createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:narration,audioDurationSeconds:4}))[0]!;
  scene.durationSeconds=4;scene.audioPath='saved-paid-voice.mp3';scene.videoPath=join(root,'saved-source.mp4');
  scene.trimStartSeconds=0;scene.trimEndSeconds=4;
  // The adapter below supplies the saved pixel verdict. These files exercise
  // acceptance, persistence and montage without any provider or media decoding.
  await writeFile(scene.videoPath,'Saved original fixture');
  const checksum=createHash('sha256').update('Saved original fixture').digest('hex');
  const directory=join(storage.projectDirectory(project.id),'Documentary','RangePosters');await mkdir(directory,{recursive:true});
  const posterKey=createHash('sha256').update(JSON.stringify([checksum,scene.videoPath,2])).digest('hex');
  scene.imagePath=join(directory,posterKey+'.jpg');await writeFile(scene.imagePath,'Saved fixture poster');
  scene.documentary={...scene.documentary!,verified:false,pinned:false,motionGraphic:obsoleteRoute(),checksum,selectionPlan:{kind:'video',videoPercent:100},
    effects:[{id:'manual-overlay',assetId:'saved-overlay',assetVersion:1,origin:'manual',name:'Saved overlay',filePath:'saved-overlay.png',
      kind:'image',role:'overlay',enabled:true,startSeconds:0,durationSeconds:4,x:0,y:0,scale:1,blend:'normal',
      defaults:{blend:'normal',opacity:1,volume:0,sourceAudio:false,trimStartSeconds:0,fadeInSeconds:0,fadeOutSeconds:0}}],
    requirement:{text:narration,entities:[],identities:[],years:[],queries:['Suez Canal shipping'],detail:'Ships passing through the Suez Canal',preferredKind:'video'},
    selected:{id:'canal-video',provider:'commons',kind:'video',title:'Ships passing through the Suez Canal',description:'Canal shipping',
      pageUrl:'https://example.test/canal',downloadUrl:'https://example.test/canal.mp4',localPath:scene.videoPath,
      rights:'licensed',license:'fixture',licenseUrl:'',author:'fixture',attribution:'fixture',width:1920,height:1080,durationSeconds:4,
      query:'Suez Canal shipping',retrievedAt:'now',match:'unverified',concerns:[]}};
  project=await projects.mutate(project.id,()=>({...project,status:'draft',scenes:[scene]}));
  let cacheReads=0;
  const service=new DocumentaryProjectService(projects,storage,
    {search:async()=>assert.fail('Saved accepted media must not trigger discovery')} as unknown as DocumentarySearch,
    join(root,'materials'),{download:async()=>assert.fail('Saved media must not be downloaded again')},()=>{},
    {simpleSelection:true,available:async()=>true,plan:async()=>new Map(),inspect:async()=>assert.fail('No paid inspection'),
      inspectForSelection:async(p,s,_progress,_stop,cacheOnly)=>{
        assert.equal(cacheOnly,true);cacheReads++;
        return {review:await approvedReview(p,s),usedNewAnalysis:false};
      }});
  Reflect.set(service,'selectionResources',async()=>({workers:1}));
  return {project,projects,scene,service,cacheReads:()=>cacheReads};
}

async function approvedReview(project:Project,scene:Scene){
  const info=await stat(scene.videoPath!,{bigint:true}),target=planFastDocumentaryScene(project,scene).visualTarget;
  const review:NonNullable<NonNullable<Scene['documentary']>['visualReview']>={status:'accepted',confidence:1,reason:'Saved mocked pixel verdict',
    quality:'',checkedAt:'now',sampleSeconds:[0,1,2,3],trimStartSeconds:0,trimEndSeconds:4,footageOrigin:'camera',frameHash:'saved-poster-hash',
    viewDescription:'Ships passing through a canal',fastRelevance:{version:1,target,relevant:true,evidence:'Canal visible'},
    illustrationQualityVersion:1,targetVisibility:{version:1,target,visible:true,evidence:'Canal visible'},sourceText:{version:1,kind:'none',text:''},
    localReview:{version:1,size:String(info.size),mtimeNs:String(info.mtimeNs),ctimeNs:String(info.ctimeNs)}};
  review.illustrationApproval=documentaryIllustrationApproval(project,{...scene,documentary:{...scene.documentary!,visualReview:review}});
  return review;
}

for(const verified of [false,true])test(`saved footage with verified=${verified} disables an obsolete automatic route through readiness and montage`,async t=>{
  const f=await fixture(t),before=structuredClone(f.scene);
  if(verified){
    const review=await approvedReview(f.project,f.scene);
    await f.projects.mutate(f.project.id,current=>({scenes:current.scenes.map(scene=>({...scene,documentary:{...scene.documentary!,verified:true,visualReview:review}}))}));
  }
  const result=await f.service.autoSelect(f.project.id),project=result.project,scene=project.scenes[0]!;
  assert.equal(f.cacheReads(),verified?0:1);assert.deepEqual(result.failures,[]);
  assert.deepEqual(scene.documentary!.motionGraphic,{...before.documentary!.motionGraphic,enabled:false});
  assert.equal(scene.audioPath,before.audioPath);assert.equal(scene.videoPath,before.videoPath);
  assert.deepEqual(scene.documentary!.effects,before.documentary!.effects);
  assert.equal(documentaryAutomaticMaterialReady(scene),true);
  assert.equal(documentarySavedContextIssue(project,scene),undefined);
  assert.deepEqual(missingAssemblyInputs(project),[]);
  assert.equal(revalidateDocumentaryContext(project)[0]!.documentary!.verified,true);
  const timeline=buildDocumentaryTimeline(project),shot=timeline.scenes[0]!;
  assert.ok(shot.videoPath);assert.equal(shot.documentary!.motionGraphic!.enabled,false);
  assert.deepEqual(shot.documentary!.motionGraphic!.routeComparison,before.documentary!.motionGraphic!.routeComparison);

  const changed=structuredClone(project);changed.scenes[0]!.trimStartSeconds=1;
  assert.match(documentarySavedContextIssue(changed,changed.scenes[0]!)??'',/После просмотра изменился/);
  assert.ok(missingAssemblyInputs(changed).length,'Disabled route must still validate actual media evidence');
});

test('an active invalid route remains blocked, including without stock media',async t=>{
  const f=await fixture(t),scene=f.project.scenes[0]!;
  scene.documentary!.verified=true;scene.documentary!.visualReview=await approvedReview(f.project,scene);
  assert.match(documentarySavedContextIssue(f.project,scene)??'',/отдельной схемой/);
  assert.ok(missingAssemblyInputs(f.project).length);
  scene.imagePath=undefined;scene.videoPath=undefined;scene.documentary!.selected=undefined;
  assert.match(documentarySavedContextIssue(f.project,scene)??'',/Сценарий или target схемы изменился/);
});

test('resume keeps an automatic route blocked when the accepted media proof is stale',async t=>{
  const f=await fixture(t),review=await approvedReview(f.project,f.scene);
  review.illustrationApproval!.fingerprint='stale-proof';
  await f.projects.mutate(f.project.id,current=>({scenes:current.scenes.map(scene=>({...scene,documentary:{...scene.documentary!,verified:true,visualReview:review}}))}));
  const result=await f.service.autoSelect(f.project.id),scene=result.project.scenes[0]!;
  assert.equal(result.failures.length,1);assert.equal(scene.documentary!.verified,false);
  assert.deepEqual(scene.documentary!.motionGraphic,f.scene.documentary!.motionGraphic);
  assert.equal(scene.audioPath,f.scene.audioPath);assert.equal(scene.videoPath,f.scene.videoPath);
  assert.equal(scene.documentary!.checksum,f.scene.documentary!.checksum);
  assert.deepEqual(scene.documentary!.effects,f.scene.documentary!.effects);
  assert.ok(missingAssemblyInputs(result.project).length);
});

test('accepted footage retains an ordinary automatic inset route without a comparison',async t=>{
  const f=await fixture(t),review=await approvedReview(f.project,f.scene);
  const route=[{name:'Suez',latitude:29.97,longitude:32.55},{name:'Port Said',latitude:31.26,longitude:32.3}];
  const graphic:DocumentaryMotionGraphic={enabled:true,origin:'automatic',kind:'map-route',mapStyle:'inset',title:'Suez Canal',
    startSeconds:0,durationSeconds:4,route,fromPlace:route[0]!,place:route[1]!,
    detail:{kind:'satellite',imagePath:f.scene.imagePath!,latitude:30.6,longitude:32.4,radiusKm:80,featureCount:2,createdAt:'now',
      bounds:documentaryRouteBounds(route),routeKey:documentaryRouteKey(route)}};
  const before=await f.projects.mutate(f.project.id,current=>({scenes:current.scenes.map(scene=>({...scene,
    documentary:{...scene.documentary!,motionGraphic:graphic,verified:true,visualReview:review}}))}));
  assert.equal(documentarySavedContextIssue(before,before.scenes[0]!),undefined);
  assert.deepEqual(missingAssemblyInputs(before),[]);
  const {project,failures}=await f.service.autoSelect(f.project.id),scene=project.scenes[0]!;
  assert.deepEqual(failures,[]);assert.deepEqual(scene.documentary!.motionGraphic,graphic);
  assert.deepEqual(missingAssemblyInputs(project),[]);
  assert.equal(buildDocumentaryTimeline(project).scenes[0]!.documentary!.motionGraphic!.enabled,true);
});

for(const enabled of [false,true])test(`accepting media preserves a manual route with enabled=${enabled}`,async t=>{
  const f=await fixture(t),manual={...obsoleteRoute(),origin:'manual' as const,enabled};
  await f.projects.mutate(f.project.id,current=>({scenes:current.scenes.map(scene=>({...scene,documentary:{...scene.documentary!,motionGraphic:manual}}))}));
  const {project}=await f.service.autoSelect(f.project.id),scene=project.scenes[0]!;
  assert.deepEqual(scene.documentary!.motionGraphic,manual);
  assert.deepEqual(scene.documentary!.effects,f.scene.documentary!.effects);
  if(enabled){
    assert.equal(scene.documentary!.verified,false);
    assert.ok(missingAssemblyInputs(project).length);
    assert.match(documentarySavedContextIssue(project,{...scene,documentary:{...scene.documentary!,verified:true}})??'',/отдельной схемой/);
  }else{
    assert.equal(documentarySavedContextIssue(project,scene),undefined);
    assert.deepEqual(missingAssemblyInputs(project),[]);
  }
});
