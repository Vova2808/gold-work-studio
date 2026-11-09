import test from 'node:test';
import assert from 'node:assert/strict';
import type {Project,Scene,DocumentaryCandidate} from '@gold-work/shared';
import {createDefaultProjectSettings,documentaryVideoCoverage} from '@gold-work/shared';
import {documentaryPhotoFirstScenes,documentaryQuotaUpgradeScenes} from './documentary-project-service.js';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {DocumentarySearch} from './documentary-search.js';
import {documentaryIllustrationApproval} from './documentary-context-approval.js';
import {effectFfmpeg} from './effect-media.js';

test('60 percent duration on four equal scenes allocates at most one photo and upgrades the minimum automatic still',()=>{
 const settings=createDefaultProjectSettings();assert.equal(settings.stockVideoPercent,60);
 const scenes=Array.from({length:4},(_,order)=>({id:String(order),order,narration:order>1?'Photograph: Boats rest in the harbour.':'Waves move.',durationSeconds:4,documentary:{candidates:[],requirement:{preferredKind:order>1?'image':'video',queries:[]}}} as unknown as Scene));
 const project={scenes,settings} as Project;assert.equal(documentaryPhotoFirstScenes(project).size,1);
 for(const scene of scenes){scene.documentary!.verified=true;scene.documentary!.selected={kind:scene.order<2?'video':'image',durationSeconds:4} as any;if(scene.order<2)scene.videoPath='existing.mp4';}
 assert.equal(documentaryVideoCoverage(scenes).percent,50);
 assert.deepEqual(documentaryQuotaUpgradeScenes(project),['3']);
 scenes[3]!.documentary!.pinned=true;assert.deepEqual(documentaryQuotaUpgradeScenes(project),['2'],'Manual selection is preserved');
 scenes[2]!.documentary!.pinned=true;assert.deepEqual(documentaryQuotaUpgradeScenes(project),[],'Report shortage rather than replacing manual work');
 scenes[3]!.documentary!.pinned=false;scenes[3]!.documentary!.selected!.kind='video';scenes[3]!.videoPath='new.mp4';
 assert.equal(documentaryVideoCoverage(scenes).percent,75);assert.deepEqual(documentaryQuotaUpgradeScenes(project),[]);
 scenes[3]!.documentary!.selected!.kind='image';assert.equal(documentaryVideoCoverage(scenes).percent,50,'A photo in an MP4/zoom is not footage');
});

test('automatic photo upgrade continues to a second distinct video after the first pixel refusal',async t=>{
 const root=await mkdtemp(join(tmpdir(),'gws-quota-upgrade-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider()),storage=new LocalProjectStorage(join(root,'projects'));
 let project=await projects.create({title:'Harbour',topic:'Harbour',mediaMode:'stock',mode:'standard',language:'English',aspectRatio:'16:9'});
 const image=join(root,'old.jpg');await effectFfmpeg(['-y','-f','lavfi','-i','color=c=blue:s=1280x720','-frames:v','1',image]);
 const narration='Photograph: Boats rest in the harbour.';
 const candidate=(id:string,kind:string,path:string)=>({id,provider:'local',kind,title:'Boats rest harbour',description:'Boats rest harbour',localPath:path,downloadUrl:'',pageUrl:'',author:'fixture',license:'user',licenseUrl:'',attribution:'fixture',rights:'user-confirmed',query:'Boats rest harbour',retrievedAt:'now',match:'unverified',concerns:[],durationSeconds:4,width:1280,height:720}) as any;
 const scene={id:'harbour',order:0,title:narration,narration,durationSeconds:4,status:'draft',stockQuery:'Boats rest harbour',imagePrompt:'',animationPrompt:'',imagePath:image,
  documentary:{version:2,requirement:{text:narration,entities:[],years:[],queries:['Boats rest harbour'],preferredKind:'image'},candidates:[],verified:true,pinned:false,layout:'full',effects:[],caption:{enabled:false,text:''},selected:candidate('old','image',image),checksum:createHash('sha256').update(await readFile(image)).digest('hex'),visualReview:{status:'accepted',reason:'Mock saved photo',viewDescription:'Boats in harbour',quality:'',sampleSeconds:[0],checkedAt:'now',fastRelevance:{version:1,target:'Boats rest harbour',relevant:true,evidence:'Boats rest in harbour'}}}} as unknown as Scene;
 scene.documentary!.visualReview!.illustrationApproval=documentaryIllustrationApproval(project,scene);
 project.scenes=[scene];project.settings.stockVideoPercent=60;project=await projects.update(project.id,project);
 const videos:DocumentaryCandidate[]=[];
 for(const [id,pattern] of [['first','testsrc2'],['second','smptebars']]){
  const path=join(root,id+'.mp4');await effectFfmpeg(['-y','-f','lavfi','-i',`${pattern}=s=1280x720:r=10`,'-t','4','-c:v','libx264','-threads','1','-preset','ultrafast',path]);videos.push(candidate(id!,'video',path));
 }
 const search=new DocumentarySearch();search.search=async()=>({candidates:videos,sources:[]});const seen:string[]=[];
 const service=new DocumentaryProjectService(projects,storage,search,join(root,'Materials'),{download:async()=>{throw Error('Local fixture');}},()=>{},
  {simpleSelection:true,available:async()=>true,plan:async()=>new Map(),inspect:async(_project,current)=>{const id=current.documentary!.selected!.id;seen.push(id);return {status:id==='first'?'rejected':'accepted',confidence:1,reason:'Mock orchestration only',quality:'',sampleSeconds:[],checkedAt:'now'};}});
 const result=await service.autoSelect(project.id);
 assert.deepEqual(seen,['first','second'],JSON.stringify(result.failures));assert.equal(result.project.scenes[0]!.documentary!.selected!.id,'second');assert.equal(result.failed,0);assert.equal(documentaryVideoCoverage(result.project.scenes).percent,100);
});
