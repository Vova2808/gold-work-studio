import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {createDefaultProjectSettings,documentaryVideoCoverage,type Project,type Scene} from '@gold-work/shared';
import {documentaryAiPlanContext} from './documentary-ai-plan-state.js';
import {documentaryPhotoRecoveryScenes,prepareDocumentaryPhotoRecovery} from './documentary-footage-recovery.js';
import {planFastDocumentaryScene} from './documentary-fast-plan.js';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {DocumentarySearch} from './documentary-search.js';
import {effectFfmpeg} from './effect-media.js';

function fixture():Project{
 const scenes=['Riders race on the track.','Rossi engineers prepare the motorcycle.'].map((narration,order)=>({id:`scene-${order}`,order,narration,
  title:narration,durationSeconds:order?4:8,audioPath:`saved-${order}.mp3`,includeInAssembly:true,
  documentary:{version:2,verified:order===0,pinned:order===0,candidates:[],caption:{enabled:false,text:''},effects:[],layout:'full',
   requirement:{text:narration,entities:[],years:[],queries:['motorcycle'],preferredKind:'video'}}} as unknown as Scene));
 scenes[0]!.videoPath='saved-video.mp4';scenes[0]!.documentary!.selected={kind:'video',durationSeconds:8} as any;
 const p={id:'p',title:'Rossi',topic:'Motorcycle racing',language:'English',mediaMode:'stock',mode:'standard',status:'draft',aspectRatio:'16:9',
  scenes,settings:createDefaultProjectSettings(),videoBrief:{creationMode:'script',readyScript:scenes.map(s=>s.narration).join('')}} as Project;
 p.settings.voice.enabled=false;p.settings.stockVideoPercent=60;p.settings.assembly.documentary={version:2,pace:'dynamic',autoMotionGraphics:false} as any;
 const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 scenes[1]!.documentary!.requirement.aiSearchPlan={version:1,inputHash:hash({inputHash:hash({version:1,model:'fixture',context:documentaryAiPlanContext(p)}),sceneId:'scene-1'}),
  model:'fixture',subject:'Rossi engineers',visualTarget:'Rossi engineers in garage',years:[],visualScope:'exact',preferredKind:'video',
  imageQueries:['Rossi engineers garage'],videoQueries:['Rossi engineers garage'],fallbackVisualTarget:'mechanics working in workshop',fallbackVideoQueries:['mechanic workshop']};
 return p;
}

test('photo reserve uses the existing AI query only after the unchanged real-video quota',()=>{
 const p=fixture(),s=p.scenes[1]!,before=structuredClone(p);assert.equal(documentaryVideoCoverage(p.scenes).percent,66);
 assert.deepEqual(documentaryPhotoRecoveryScenes(p),[s.id]);
 const photo=prepareDocumentaryPhotoRecovery(p,s);assert.equal(photo.documentary!.requirement.footageFallback!.kind,'image');
 assert.deepEqual(planFastDocumentaryScene(p,photo,'image').queries,['mechanic workshop']);
 assert.deepEqual(planFastDocumentaryScene(p,photo,'video').queries,[]);
 assert.equal(planFastDocumentaryScene(p,photo).preferredKind,'image');
 assert.equal(photo.audioPath,s.audioPath);assert.equal(photo.narration,s.narration);assert.equal(photo.documentary!.verified,false);
 assert.deepEqual(photo.documentary!.requirement.aiSearchPlan,s.documentary!.requirement.aiSearchPlan);
 assert.equal(documentaryVideoCoverage([p.scenes[0]!,photo]).percent,66);assert.deepEqual(p,before);
 p.scenes[0]!.documentary!.verified=false;assert.deepEqual(documentaryPhotoRecoveryScenes(p),[]);
});

test('photo recovery preserves manual composition and ready materials',()=>{
 for(const change of [(s:Scene)=>s.documentary!.pinned=true,(s:Scene)=>s.documentary!.caption.enabled=true,
  (s:Scene)=>s.documentary!.texts=[{} as any],(s:Scene)=>s.documentary!.templateOrigin='manual',
  (s:Scene)=>s.documentary!.verified=true]){
  const p=fixture(),s=p.scenes[1]!;change(s);assert.deepEqual(documentaryPhotoRecoveryScenes(p),[]);assert.equal(prepareDocumentaryPhotoRecovery(p,s),s);
 }
});

for(const topic of [false,true])test(topic?'normal UI photo recovery retains a cached topic reserve through replanning':
 'public auto-selection searches photographs for missing scenes without changing ready footage or pretending success',async t=>{
 const root=await mkdtemp(join(tmpdir(),'gws-photo-rescue-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
 const created=await projects.create({title:'Rossi',topic:'Motorcycle racing',mediaMode:'stock',mode:'standard',language:'English',aspectRatio:'16:9'});
 let p={...fixture(),id:created.id};p.scenes[0]!.videoPath=join(root,'ready.mp4');
 await effectFfmpeg(['-y','-f','lavfi','-i','color=c=blue:s=1280x720:r=5','-t','8','-c:v','libx264','-threads','1','-preset','ultrafast',p.scenes[0]!.videoPath!]);
 p=await projects.mutate(created.id,()=>p);const ready=structuredClone(p.scenes[0]!);
 const searches:Array<{kind:string;query:string}>=[];const search=new DocumentarySearch();
 search.search=async input=>{searches.push({kind:input.kind,query:input.query});return {candidates:[],sources:[]};};
 let ordinaryCalls=0;
 const ordinary=structuredClone(p.scenes[1]!.documentary!.requirement);
 const topicRequirement={...ordinary,aiSearchPlan:{...ordinary.aiSearchPlan!,fallbackVisualTarget:'motorcycle riders racing',fallbackVideoQueries:['motorcycle racing']}};
 const planner={plan:async(_p:Project,scenes:Scene[])=>new Map(scenes.map(s=>[s.id,topic&&s.id==='scene-1'
   ?{...s.documentary!.requirement,aiSearchPlan:topicRequirement.aiSearchPlan}:s.documentary!.requirement])),
  planFallbacks:async(_p:Project,scenes:Scene[])=>{ordinaryCalls++;return new Map(scenes.map(s=>[s.id,ordinary]));},
  ...(topic?{readCachedTopicFallbacks:async(_p:Project,scenes:Scene[])=>new Map(scenes.filter(s=>s.id==='scene-1').map(s=>[s.id,
   {...s.documentary!.requirement,aiSearchPlan:topicRequirement.aiSearchPlan}]))}:{})};
 const service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,'projects')),search,join(root,'Materials'),
  {download:async()=>assert.fail('No candidates')},()=>{},{simpleSelection:true,available:async()=>true,plan:async()=>new Map(),inspect:async()=>assert.fail('No candidates')},undefined,undefined,planner);
 Reflect.set(service,'selectionResources',async()=>({workers:1}));
 const result=await service.autoSelect(p.id);
 assert.ok(searches.some(s=>s.kind==='image'&&s.query===(topic?'motorcycle racing':'mechanic workshop')),JSON.stringify(searches));
 if(topic){assert.equal(ordinaryCalls,0,'A saved final reserve must not buy or restore an older reserve');
  assert.equal(result.project.scenes[1]!.documentary!.requirement.footageFallback!.kind,'image');}
 const retained=result.project.scenes[0]!;
 assert.equal(retained.videoPath,ready.videoPath);assert.equal(retained.audioPath,ready.audioPath);assert.equal(retained.narration,ready.narration);
 assert.deepEqual(retained.documentary!.selected,ready.documentary!.selected);assert.equal(retained.documentary!.pinned,true);
 assert.deepEqual(retained.documentary!.caption,ready.documentary!.caption);assert.equal(retained.documentary!.autoError,undefined);
 assert.equal(result.project.scenes[1]!.audioPath,'saved-1.mp3');
 assert.equal(result.project.scenes[1]!.documentary!.verified,false);assert.equal(result.project.settings.stockVideoPercent,60);
 assert.equal(documentaryVideoCoverage(result.project.scenes).percent,66);
});
