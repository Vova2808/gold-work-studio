import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {documentaryAiPlanContext} from '@gold-work/shared';
import {DocumentaryAiQueryPlanner} from './documentary-ai-query-planner.js';
import {DocumentaryProjectService,documentaryPhotoFirstScenes} from './documentary-project-service.js';
import {DocumentarySearch} from './documentary-search.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {prepareDocumentaryScript} from './documentary-plan.js';
import {planFastDocumentaryScene} from './documentary-fast-plan.js';

test('cached AI planning discards a conflicting saved reserve before choosing the media lane',async t=>{
 const root=await mkdtemp(join(tmpdir(),'gws-saved-reserve-lane-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
 let project=await projects.create({title:'Portrait',topic:'A scientist',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
 project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:'The portrait shows Ada Lovelace.'};
 project.scenes=[prepareDocumentaryScript(project)[0]!];project.settings.stockVideoPercent=60;
 const scene=project.scenes[0]!,doc=scene.documentary!;
 const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 const inputHash=hash({version:1,model:'fixture',context:documentaryAiPlanContext(project)});
 scene.audioPath=join(root,'paid-narration.mp3');scene.imagePath=join(root,'saved-source.jpg');
 doc.requirement={...doc.requirement,text:scene.narration,aiSearchPlan:{
  version:1,inputHash:hash({inputHash,sceneId:scene.id}),model:'fixture',subject:'Ada Lovelace',visualTarget:'Ada Lovelace portrait',
  years:[],visualScope:'illustrative',preferredKind:'image',reservePolicy:'thematic',
  imageQueries:['Ada Lovelace portrait'],videoQueries:[],fallbackVisualTarget:'calculating machine',fallbackVideoQueries:['calculating machine'],
  grounding:{version:1,mandatory:[{kind:'identity',required:'Ada Lovelace',scriptQuote:'The portrait shows Ada Lovelace.',aliases:[]}],
   illustrations:['portrait of Ada Lovelace'],optionalDetails:[]},
 },footageFallback:{version:1,target:'calculating machine',queries:['calculating machine'],originalTarget:'Ada Lovelace portrait',
  narration:scene.narration,kind:'video',reason:'Old reserve'}};
 doc.selectionPlan={kind:'video',videoPercent:60};doc.verified=false;
 project=await projects.mutate(project.id,()=>project);
 const planner={plan:async()=>new Map([[scene.id,doc.requirement]])} as unknown as DocumentaryAiQueryPlanner;
 const service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,'projects')),new DocumentarySearch(),join(root,'Materials'),
  {download:async()=>assert.fail('No download during planning')},()=>{},undefined,undefined,undefined,planner);
 const planned=await service.planSearch(project.id,[scene.id]);
 const next=planned.scenes[0]!;
 assert.equal(next.documentary!.requirement.footageFallback,undefined);
 assert.ok(documentaryPhotoFirstScenes(planned,true).has(scene.id),'The removed reserve must not force a video-only slot');
 assert.deepEqual(planFastDocumentaryScene(planned,next,'image').queries,['Ada Lovelace portrait']);
 assert.deepEqual(next.documentary!.requirement.aiSearchPlan!.grounding,doc.requirement.aiSearchPlan!.grounding);
 assert.equal(next.audioPath,scene.audioPath);assert.equal(next.imagePath,scene.imagePath);
 assert.equal(next.documentary!.verified,false);
});
