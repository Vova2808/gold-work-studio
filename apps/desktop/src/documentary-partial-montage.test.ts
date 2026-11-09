import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {Project} from '@gold-work/shared';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {DocumentaryAnalysisError} from './documentary-analysis-error.js';
import {compactMontageBatches} from './documentary-semantic-batches.js';
import {readCompletedMontageBatches,semanticMontageHash} from './documentary-semantic-montage.js';
import {rebaseDocumentaryPreviewMontage} from './documentary-excerpt-montage.js';

const digest=(data:Buffer|string)=>createHash('sha256').update(data).digest('hex');
const protectedScenes=(p:Project)=>p.scenes.map(s=>({id:s.id,narration:s.narration,audioPath:s.audioPath,
  imagePath:s.imagePath,videoPath:s.videoPath,selected:s.documentary?.selected,checksum:s.documentary?.checksum,
  duration:s.durationSeconds,override:s.durationOverrideSeconds,timing:s.documentary?.timing}));

async function fixture(t:{after:(fn:()=>Promise<void>)=>void},local=true){
  const root=await mkdtemp(join(tmpdir(),'gws-partial-montage-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const directory=join(root,'Documentary','Montage'),analysis=join(root,'Documentary','Analysis');
  await mkdir(directory,{recursive:true});await mkdir(analysis,{recursive:true});
  const voice=join(root,'voice.wav'),image=join(root,'source.jpg'),music=join(root,'music.wav');
  await writeFile(voice,'existing voice');await writeFile(image,'existing source');await writeFile(music,'existing music');
  const p={id:'partial-montage',mediaMode:'stock',aspectRatio:'16:9',language:'en',status:'ready',
    settings:{voice:{enabled:true},music:{enabled:true,volume:17,path:music,clips:[{id:'existing',path:music}]},
      assembly:{kenBurns:true,documentary:{version:2,autoEffects:true,autoTransitions:true,autoMotionGraphics:true,
        montage:{version:1,style:'editorial',intensity:'rich',hookSeconds:30,musicPolicy:'automatic',background:{mode:'library',assetIds:['existing-background']}},
        resolvedBackground:{id:'existing-background',path:image,kind:'image'},motionArtworkStatus:{status:'local',inputHash:'previous-artwork',message:'Keep existing artwork state'}}}},
    scenes:Array.from({length:68},(_,order)=>({id:`scene-${order}`,order,status:'draft',narration:'The ship sailed across the ocean. ',durationSeconds:4,
      audioPath:voice,imagePath:image,documentary:{verified:true,checksum:`source-${order}`,layout:'full',effects:[],caption:{enabled:false,text:''},
        timing:{sourceKey:`voice-${order}`,durationInFrames:120,speechSeconds:3.9},
        selected:{id:`source-${order}`,kind:'image',width:1920,height:1080},requirement:{text:'The ship sailed across the ocean.',identities:[],years:[],accent:'none'}}}))} as unknown as Project;
  p.scenes[1]!.documentary!.motionGraphic={kind:'quote',enabled:true,origin:'manual',title:'My caption',startSeconds:0,durationSeconds:3};
  p.scenes[2]!.documentary!.cuts=[{id:'manual-cut',fromFrame:0,durationInFrames:120,trimStartSeconds:0,playbackRate:1}];
  p.scenes[3]!.documentary!.template='gallery';p.scenes[3]!.documentary!.templateOrigin='manual';
  p.scenes[67]!.documentary!.pinned=true;
  const hash=semanticMontageHash(p);
  if(local)p.settings.assembly.documentary!.semanticMontageStatus={status:'local',inputHash:hash,message:'AI-монтаж недоступен, использован локальный. ECONNRESET; unknown receipt retained.'};
  await writeFile(join(directory,`${hash}-batches.json`),JSON.stringify({version:2,inputHash:hash}));
  const batchFiles:string[]=[];
  for(const [i,batch] of compactMontageBatches(p.scenes).entries()){
    if(i>=7)break;
    const file=join(directory,`${hash}-compact-${i}.json`);batchFiles.push(file);
    await writeFile(file,JSON.stringify({version:1,inputHash:hash,scenes:batch.map(s=>({sceneId:s.id,subject:'ship',beat:'evidence',treatment:'footage',cutawaySceneIds:[]}))}));
  }
  const partial=join(analysis,'unknown.json'),pending=join(analysis,'pending.json');
  await writeFile(partial,JSON.stringify({state:'partial',purpose:'semantic-montage',raw:'{"scenes":[{"sceneId":"s56"',error:'ECONNRESET'}));
  await writeFile(pending,JSON.stringify({state:'pending',purpose:'semantic-montage',createdAt:'unchanged'}));
  const protectedFiles=[partial,pending,voice,image,music,...batchFiles,join(directory,`${hash}-batches.json`)];
  const hashes=new Map(await Promise.all(protectedFiles.map(async f=>[f,digest(await readFile(f))] as const)));
  return {root,directory,p,hash,batchFiles,hashes};
}

for(const local of [true,false])test(`partial montage recovers 56 scenes ${local?'from persisted local status':'after the guarded planner fails'} and stays cache-only`,async t=>{
  const f=await fixture(t,local),repo=new MemoryProjectRepository(),projects=new ProjectService(repo,new MockDirectorProvider());
  await repo.save(f.p);let plannerCalls=0,storageCalls=0;
  const forbidden=()=>{assert.fail('Recovery must not call a provider, artwork commission or media library');};
  const intelligence={planSemanticMontage:async()=>{plannerCalls++;if(local)forbidden();throw new DocumentaryAnalysisError('ECONNRESET; unknown receipt retained.','pending','semantic-montage');},
    planMotionArtwork:forbidden};
  const make=()=>new DocumentaryProjectService(projects,{projectDirectory:()=>f.root,ensureProject:async()=>{storageCalls++;}} as never,
    {} as never,f.root,new Proxy({},{get:forbidden}) as never,()=>{},intelligence as never);
  const first=await make().prepareMontage(f.p.id);
  const second=await make().prepareMontage(f.p.id);
  assert.equal(plannerCalls,local?0:1,'only the pre-existing failed planning operation may run; no retry during recovery');
  assert.equal(storageCalls,2);
  for(const actual of [first,second]){
    assert.equal(actual.scenes.filter(s=>s.documentary?.semanticMontageInputHash===f.hash&&s.documentary.semanticMontage).length,56);
    assert.ok(actual.scenes.slice(56).every(s=>!s.documentary?.semanticMontage));
    assert.equal(actual.settings.assembly.documentary!.semanticMontageStatus!.status,'local');
    assert.match(actual.settings.assembly.documentary!.semanticMontageStatus!.message,/Сохранён AI-монтаж 56\/68 сцен; 12 сцен оформлены локально/);
    assert.match(actual.settings.assembly.documentary!.semanticMontageStatus!.message,/ECONNRESET/);
    assert.deepEqual(protectedScenes(actual),protectedScenes(f.p));assert.deepEqual(actual.settings.music,f.p.settings.music);
    assert.deepEqual(actual.settings.assembly.documentary!.montage,f.p.settings.assembly.documentary!.montage);
    assert.deepEqual(actual.settings.assembly.documentary!.resolvedBackground,f.p.settings.assembly.documentary!.resolvedBackground);
    assert.deepEqual(actual.settings.assembly.documentary!.motionArtworkStatus,f.p.settings.assembly.documentary!.motionArtworkStatus);
    assert.deepEqual(actual.scenes[1]!.documentary!.motionGraphic,f.p.scenes[1]!.documentary!.motionGraphic);
    assert.deepEqual(actual.scenes[2]!.documentary!.cuts,f.p.scenes[2]!.documentary!.cuts);
    assert.equal(actual.scenes[3]!.documentary!.template,'gallery');assert.deepEqual(actual.scenes[67],f.p.scenes[67]);
  }
  assert.deepEqual(second.scenes,first.scenes,'a second ordinary prepare is stable');
  assert.equal(second.settings.assembly.documentary!.semanticMontageStatus!.message,first.settings.assembly.documentary!.semanticMontageStatus!.message);
  for(const [file,hash] of f.hashes)assert.equal(digest(await readFile(file)),hash);
  assert.equal((await readdir(f.directory)).length,8,'no fabricated full plan or missing-batch cache');
});

for(const corruption of ['batch-hash','duplicate-ids','manifest-hash'] as const)test(`cache-only recovery excludes ${corruption} without an AI call`,async t=>{
  const f=await fixture(t),file=corruption==='manifest-hash'?join(f.directory,`${f.hash}-batches.json`):f.batchFiles[0]!;
  const saved=JSON.parse(await readFile(file,'utf8'));
  if(corruption==='duplicate-ids')saved.scenes[1].sceneId=saved.scenes[0].sceneId;else saved.inputHash='different-source-edit';
  await writeFile(file,JSON.stringify(saved));
  const read=await readCompletedMontageBatches(f.p,f.root);
  if(corruption==='manifest-hash'){assert.equal(read,undefined);return;}
  assert.equal(read!.scenes.length,48);assert.ok(read!.scenes.every(s=>!f.p.scenes.slice(0,8).some(original=>original.id===s.sceneId)));
  const repo=new MemoryProjectRepository(),projects=new ProjectService(repo,new MockDirectorProvider());await repo.save(f.p);
  const forbidden=()=>{assert.fail('Corrupt cache must not buy replacement directions or media');};
  const service=new DocumentaryProjectService(projects,{projectDirectory:()=>f.root,ensureProject:async()=>{}} as never,{} as never,f.root,
    new Proxy({},{get:forbidden}) as never,()=>{},{planSemanticMontage:forbidden,planMotionArtwork:forbidden} as never);
  const actual=await service.prepareMontage(f.p.id);
  assert.equal(actual.scenes.filter(s=>s.documentary?.semanticMontage).length,48);
  assert.match(actual.settings.assembly.documentary!.semanticMontageStatus!.message,/48\/68 сцен; 20 сцен оформлены локально/);
});

test('a changed source hash cannot reuse old batches, and abort never falls through to recovery',async t=>{
  const f=await fixture(t);f.p.scenes[0]!.narration='An edited narration belongs to a different request.';
  assert.notEqual(semanticMontageHash(f.p),f.hash);assert.equal(await readCompletedMontageBatches(f.p,f.root),undefined);
  const controller=new AbortController();controller.abort();
  await assert.rejects(readCompletedMontageBatches(f.p,f.root,controller.signal),{name:'AbortError'});
});

test('preview-rebased partial directions survive ordinary prepare without batches for the new hash',async t=>{
  const f=await fixture(t),repo=new MemoryProjectRepository(),projects=new ProjectService(repo,new MockDirectorProvider());
  for(const scene of f.p.scenes)scene.documentary!.selected!.width=5000;
  await repo.save(f.p);
  let providerCalls=0;
  const forbidden=()=>assert.fail('Attached partial recovery must not prepare media or effects');
  const provider=()=>{providerCalls++;throw new Error('provider-blocked');};
  const service=new DocumentaryProjectService(projects,{projectDirectory:()=>f.root,ensureProject:async()=>{}} as never,
    {} as never,f.root,new Proxy({},{get:forbidden}) as never,()=>{},{planSemanticMontage:provider,planMotionArtwork:provider} as never);
  const before=await service.prepareMontage(f.p.id);
  const scenes=before.scenes.map(scene=>({...scene,imagePath:join(f.root,'Documentary','Playback',`${scene.documentary!.checksum}-3840.png`)}));
  const preview={...before,...rebaseDocumentaryPreviewMontage(before,scenes,f.root)},hash=semanticMontageHash(preview);
  assert.notEqual(hash,f.hash);assert.equal(await readCompletedMontageBatches(preview,f.root),undefined);
  await repo.save(preview);
  for(let i=0;i<2;i++){
    const actual=await service.prepareMontage(f.p.id);
    assert.equal(actual.scenes.filter(s=>s.documentary?.semanticMontageInputHash===hash&&s.documentary.semanticMontage).length,56);
    assert.deepEqual(actual.scenes.map(s=>s.documentary?.semanticMontage),preview.scenes.map(s=>s.documentary?.semanticMontage));
    assert.deepEqual(protectedScenes(actual),protectedScenes(preview));assert.deepEqual(actual.settings.music,preview.settings.music);
    assert.equal(actual.settings.assembly.documentary!.semanticMontageStatus!.status,'local');
    assert.match(actual.settings.assembly.documentary!.semanticMontageStatus!.message,/56\/68 сцен; 12 сцен оформлены локально/);
    assert.deepEqual(actual.scenes[1]!.documentary!.motionGraphic,preview.scenes[1]!.documentary!.motionGraphic);
    assert.deepEqual(actual.scenes[2]!.documentary!.cuts,preview.scenes[2]!.documentary!.cuts);
    assert.deepEqual(actual.scenes[67],preview.scenes[67]);
  }
  assert.equal(providerCalls,0);
  const invalid=structuredClone(preview);
  invalid.scenes[0]!.documentary!.semanticMontageInputHash=f.hash;
  invalid.scenes[4]!.documentary!.semanticMontage!.sceneId='different-scene';
  await repo.save(invalid);const filtered=await service.prepareMontage(f.p.id);
  assert.equal(filtered.scenes.filter(s=>s.documentary?.semanticMontage).length,54);
  assert.ok(!filtered.scenes[0]!.documentary!.semanticMontage&&!filtered.scenes[4]!.documentary!.semanticMontage);
  assert.equal(providerCalls,0);
  const edited=structuredClone(preview);edited.scenes[0]!.imagePath=join(f.root,'a-real-replacement.jpg');
  await repo.save(edited);
  await assert.rejects(service.prepareMontage(f.p.id),/provider-blocked/);
  assert.equal(providerCalls,1,'a real material edit must reach ordinary planning, never inherit the old stamps');
  for(const [file,hash]of f.hashes)assert.equal(digest(await readFile(file)),hash);
  assert.equal((await readdir(f.directory)).length,8,'no new-hash batches or fabricated full plan');
});
