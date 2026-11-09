import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {createDefaultProjectSettings,createDocumentarySettings,type Project} from '@gold-work/shared';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {DocumentarySemanticMontageError,semanticMontageHash} from './documentary-semantic-montage.js';
import {prepareDocumentaryExcerpts} from './documentary-excerpts.js';
import {rebaseDocumentaryExcerptMontage,rebaseDocumentaryPreviewMontage} from './documentary-excerpt-montage.js';
import {prepareDocumentaryImages} from './documentary-media-cache.js';
import {effectFfmpeg} from './effect-media.js';
import {checksumFile} from './effect-library.js';
import {motionArtworkHash} from './documentary-artwork-plan.js';

for(const local of [false,true])test(`assembly excerpt retains ${local?'local no-replay outcome':'paid plan'} across repeated preparation`,async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-excerpt-plan-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const video=join(root,'original.mp4');
  await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=s=160x90:r=30:d=50','-an','-c:v','libx264','-preset','ultrafast',video]);
  const checksum=await checksumFile(video),signature=await stat(video);
  const settings=createDefaultProjectSettings();settings.voice.enabled=false;
  settings.music={...settings.music,enabled:false,manualEdits:true,clips:[]};
  settings.assembly.documentary={...createDocumentarySettings(),autoEffects:false,autoTransitions:false,
    montage:{version:1,style:'editorial',intensity:'rich',musicPolicy:'preserve',background:{mode:'off'}}};
  const p={id:'excerpt-plan',mediaMode:'stock',language:'en',aspectRatio:'16:9',settings,
    scenes:[{id:'shot',order:0,narration:'The engine ran through the night.',durationSeconds:6,videoPath:video,trimStartSeconds:10,trimEndSeconds:16,
      documentary:{version:2,verified:true,checksum,pinned:false,layout:'full',effects:[],candidates:[],caption:{enabled:false,text:''},
        requirement:{text:'The engine ran through the night.',entities:[],years:[],queries:[]},
        selected:{id:'source',provider:'commons',kind:'video',title:'Local media fixture',localPath:video,durationSeconds:50,width:160,height:90}}}]} as unknown as Project;
  const repo=new MemoryProjectRepository(),projects=new ProjectService(repo,new MockDirectorProvider());await repo.save(p);
  let calls=0,artworkCalls=0;
  const intelligence={planSemanticMontage:async(project:Project)=>{calls++;
    if(local)throw new DocumentarySemanticMontageError('Saved unavailable result');
    return {version:1,inputHash:semanticMontageHash(project),model:'local-counting-fixture',hookSeconds:16,
      scenes:project.scenes.map(s=>({sceneId:s.id,subject:'engine',beat:'explain',treatment:'footage',cutawaySceneIds:[]}))};
  },planMotionArtwork:async(project:Project)=>{artworkCalls++;return {version:1,inputHash:motionArtworkHash(project),model:'local-artwork-fixture',scenes:[],rejected:[]};}};
  const make=()=>new DocumentaryProjectService(projects,{projectDirectory:()=>root,ensureProject:async()=>{}} as never,
    {} as never,root,{rootPath:root,snapshot:async()=>({assets:[]})} as never,()=>{},intelligence as never);
  let prepared=await make().prepareMontage(p.id);
  const posterScenes=await prepareDocumentaryImages(root,prepared.scenes);
  assert.notEqual(posterScenes[0]!.imagePath,prepared.scenes[0]!.imagePath);
  const preview=rebaseDocumentaryPreviewMontage(prepared,posterScenes,root);
  assert.equal(preview.settings.assembly.documentary!.semanticMontageStatus!.inputHash,semanticMontageHash({...prepared,scenes:posterScenes}));
  if(!local)assert.equal(preview.settings.assembly.documentary!.motionArtworkStatus!.inputHash,motionArtworkHash({...prepared,scenes:posterScenes}));
  const edited=structuredClone(posterScenes);edited[0]!.narration='Changed during preview';
  assert.equal(rebaseDocumentaryPreviewMontage(prepared,edited,root).settings,prepared.settings);
  await projects.mutate(p.id,()=>preview);prepared=await make().prepareMontage(p.id);
  assert.equal(calls,1,'generated range posters must not request another plan');
  assert.equal(artworkCalls,local?0:1,'generated range posters must not buy the artwork pass again');
  const clipped=await prepareDocumentaryExcerpts(prepared,root);assert.equal(clipped.count,1);
  const oldHash=semanticMontageHash(prepared),newHash=semanticMontageHash({...prepared,scenes:clipped.scenes});assert.notEqual(oldHash,newHash);
  const rebased=rebaseDocumentaryExcerptMontage(prepared,clipped.scenes);
  assert.equal(rebased.settings.assembly.documentary!.semanticMontageStatus!.inputHash,newHash);
  if(!local)assert.equal(rebased.settings.assembly.documentary!.motionArtworkStatus!.inputHash,motionArtworkHash({...prepared,scenes:clipped.scenes}));
  await projects.mutate(p.id,()=>rebased);
  const after=await make().prepareMontage(p.id);assert.equal(calls,1,'ordinary second prepare must not request a new plan');
  assert.equal(artworkCalls,local?0:1,'local excerpts must not buy the artwork pass again');
  assert.equal(after.settings.assembly.documentary!.semanticMontageStatus!.status,local?'local':'planned');
  assert.deepEqual(after.settings.music,p.settings.music,'manual empty music arrangement retained');
  assert.equal(after.scenes[0]!.narration,p.scenes[0]!.narration);
  assert.equal(await checksumFile(video),checksum);assert.equal((await stat(video)).mtimeMs,signature.mtimeMs);
  if(!local)assert.deepEqual(after.scenes[0]!.documentary!.semanticMontage,prepared.scenes[0]!.documentary!.semanticMontage);
  for(const field of ['narration','trim'] as const){
    const edited=structuredClone(clipped.scenes);
    if(field==='narration')edited[0]!.narration='A different editorial claim.';else edited[0]!.trimStartSeconds!+=1;
    assert.equal(rebaseDocumentaryExcerptMontage(prepared,edited).settings.assembly.documentary!.semanticMontageStatus!.inputHash,oldHash,
      'a genuine input change must not inherit the old decision');
    if(!local)assert.equal(rebaseDocumentaryExcerptMontage(prepared,edited).settings.assembly.documentary!.motionArtworkStatus!.inputHash,motionArtworkHash(prepared));
  }
  await projects.mutate(p.id,current=>({scenes:current.scenes.map(s=>({...s,narration:'A different editorial claim.'}))}));
  await make().prepareMontage(p.id);assert.equal(calls,2,'a genuine new editorial input still invalidates the decision');
  assert.equal(artworkCalls,local?0:2,'genuine new narration still invalidates the artwork decision');
});
