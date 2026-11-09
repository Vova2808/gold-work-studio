import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import type {DocumentaryArtwork,Project} from '@gold-work/shared';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {semanticMontageHash} from './documentary-semantic-montage.js';
import {planDocumentaryMontage} from './documentary-montage.js';
import {motionArtworkHash} from './documentary-artwork-plan.js';
import {buildDocumentaryTimeline} from '../../../packages/remotion-video/src/documentary-timeline.js';
import {setDiagnosticSink} from './diagnostics.js';

test('normal montage commissioning persists a custom span across automatic accents, resume and export preparation',async t=>{
 const root=await mkdtemp(join(tmpdir(),'gws-motion-production-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const narration=['Water evaporates.','Clouds form.','Rain falls.','A protected shot.','An authored shot.','A still composition.'];
 const artwork:DocumentaryArtwork={version:1,intent:'Water cycle',motionCoordinates:'relative',layout:'full',canvas:{width:1000,height:562},
  palette:{background:'#f5f3ef',ink:'#222222',accent:'#dd4433',secondary:'#8899aa'},startSeconds:0,durationSeconds:18,
  layers:[{id:'water',kind:'ellipse',x:100,y:350,w:250,h:60,fill:'accent'},
   {id:'cloud',kind:'path',x:600,y:100,w:250,h:120,path:'M0 100Q0 20 80 40Q140 0 200 50Q250 50 250 100Z',fill:'secondary'},
   {id:'flow',kind:'path',x:300,y:180,w:300,h:200,path:'M0 200Q100 0 300 0',stroke:'ink',keyframes:[{t:0,draw:0},{t:.8,draw:1},{t:1,draw:1}]}]};
 const p={id:'production-water-cycle',mediaMode:'stock',aspectRatio:'16:9',language:'en',
  settings:{voice:{enabled:true},music:{enabled:false,volume:0},assembly:{kenBurns:true,documentary:{version:2,autoEffects:false,autoTransitions:false,autoMotionGraphics:true,montage:{version:1,style:'editorial',intensity:'rich',musicPolicy:'preserve'}}}},
  scenes:narration.map((text,i)=>({id:`water-${i}`,order:i,narration:text,durationSeconds:6,audioPath:`voice-${i}.wav`,imagePath:`source-${i}.jpg`,
   documentary:{verified:true,checksum:`source-${i}`,layout:'full',effects:[],caption:{enabled:false,text:''},timing:{sourceKey:`voice-${i}`,durationInFrames:180,speechSeconds:5.8},
    selected:{id:`selected-${i}`,kind:'image',width:1920,height:1080},requirement:{text,identities:[],years:[],accent:'none'}}}))} as unknown as Project;
 p.scenes[3]!.documentary!.pinned=true;
 p.scenes[4]!.documentary!.motionGraphic={kind:'quote',enabled:true,title:'Authored',origin:'manual',startSeconds:0,durationSeconds:6};
 p.scenes[5]!.documentary!.templateMotion={amountPercent:0,curve:'smooth'};
 p.scenes[5]!.documentary!.motionGraphic={kind:'explainer',enabled:true,title:'',origin:'automatic',startSeconds:0,durationSeconds:6,artwork};
 const repo=new MemoryProjectRepository(),projects=new ProjectService(repo,new MockDirectorProvider());
 const legacy=structuredClone(p);legacy.settings.assembly.documentary!.montage=undefined;await repo.save(legacy);
 let semanticCalls=0,artworkCalls=0;
 const intelligence={planSemanticMontage:async(input:Project)=>{semanticCalls++;return {version:1,inputHash:semanticMontageHash(input),model:'saved-answer-fixture',hookSeconds:16,
  scenes:input.scenes.map(s=>({sceneId:s.id,subject:'',beat:'explain',treatment:'footage',cutawaySceneIds:[],
   ...(s.order<3?{artworkMode:'standalone',composition:{kind:'key-point',title:s.narration.slice(0,-1)}}:{})}))};},
  planMotionArtwork:async(input:Project)=>{artworkCalls++;assert.equal(input.scenes[0]!.documentary!.semanticMontage!.composition!.kind,'key-point');
   const saved={version:1 as const,inputHash:motionArtworkHash(input),model:'saved-answer-fixture',scenes:[{sceneId:'water-0',artwork,artworkSpan:{endSceneId:'water-2'}}],rejected:[]};
   await mkdir(join(root,'Documentary','Montage'),{recursive:true});
   await writeFile(join(root,'Documentary','Montage',`${saved.inputHash}-artwork-v1.json`),JSON.stringify(saved));
   return saved;}};
 const storage={projectDirectory:()=>root,ensureProject:async()=>{}};
 const service=()=>new DocumentaryProjectService(projects,storage as never,{} as never,root,{} as never,()=>{},intelligence as never);
 const immutable=(input:Project)=>input.scenes.map(s=>[s.narration,s.imagePath,s.videoPath,s.audioPath,s.documentary!.selected,s.documentary!.timing]);
 const verify=(input:Project)=>{
  const restored=JSON.parse(JSON.stringify(input)) as Project;
  for(const prepare of [false,true]){
   const planned=planDocumentaryMontage(restored,prepare),timeline=buildDocumentaryTimeline({...restored,scenes:planned});
   assert.deepEqual(timeline.scenes.slice(0,3).map(s=>s.documentary!.motionGraphic?.sequenceOffsetFrames),[0,180,360]);
   assert.ok(timeline.scenes.slice(0,3).every(s=>s.documentary!.motionGraphic?.sequenceDurationFrames===540));
   assert.ok(planned.slice(0,3).every(s=>s.documentary!.motionGraphic?.artwork?.intent==='Water cycle'));
   assert.deepEqual(immutable({...restored,scenes:planned}),immutable(p));
   for(const i of [3,4,5])assert.deepEqual(planned[i]!.documentary!.motionGraphic,p.scenes[i]!.documentary!.motionGraphic);
   assert.equal(planned[5]!.documentary!.templateMotion!.amountPercent,0);
  }
 };
 verify(await service().prepareMontage(p.id));
 assert.equal((await projects.get(p.id))!.settings.assembly.documentary!.montage!.style,'editorial');
 // Reloading the old missing-preset shape must normalize to the exact same
 // input: completed paid outcomes remain reusable instead of buying them again.
 const stored=(await repo.get(p.id))!;stored.settings.assembly.documentary!.montage=undefined;await repo.save(stored);
 verify(await service().prepareMontage(p.id));assert.equal(semanticCalls,1);assert.equal(artworkCalls,1);
 // A recovered receipt B must win over superseded artwork A in project scene
 // directions. The fallback is only for holes, never an overwrite of B's span.
 const superseded={...artwork,intent:'Superseded project drawing',layers:artwork.layers.map((layer,i)=>i===0?{...layer,x:layer.x+500}:layer)};
 await projects.mutate(p.id,current=>({scenes:current.scenes.map((s,i)=>i<3?{...s,documentary:{...s.documentary!,
  motionGraphic:{...s.documentary!.motionGraphic!,artwork:superseded},
  semanticMontage:i===0?{...s.documentary!.semanticMontage!,artwork:superseded}:s.documentary!.semanticMontage}}:s)}));
 const authoritative=await service().prepareMontage(p.id);
 verify(authoritative);
 assert.deepEqual(authoritative.scenes[0]!.documentary!.semanticMontage!.artwork,artwork);
 assert.ok(authoritative.scenes.slice(0,3).every(s=>s.documentary!.motionGraphic!.artwork!.intent==='Water cycle'));
 assert.equal(semanticCalls,1);assert.equal(artworkCalls,1);
 // Rehydrating the base semantic checkpoint must not discard an independently
 // completed artwork commission when one scene lacks its local cache stamp.
 await projects.mutate(p.id,current=>({scenes:current.scenes.map((s,i)=>i===1?{...s,documentary:{...s.documentary!,semanticMontageInputHash:undefined}}:s)}));
 verify(await service().prepareMontage(p.id));assert.equal(semanticCalls,2);assert.equal(artworkCalls,1);
 // Old attachment failures left a completed validated commission on disk but
 // no drawing in fully cached scene directions. Ordinary prepare repairs that
 // state without asking the model again or manually injecting the artwork.
 await projects.mutate(p.id,current=>({scenes:current.scenes.map((s,i)=>i<3?{...s,documentary:{...s.documentary!,motionGraphic:undefined,
  semanticMontage:{...s.documentary!.semanticMontage!,artwork:undefined,artworkSpan:undefined,
   ...(i===0?{explanation:{kind:'flow',nodes:[{id:'vapor',label:'Water',symbol:'generic'},{id:'rain',label:'Rain',symbol:'generic'}],endSceneId:'water-2'}}:{})}}}:s)}));
 const checkpoint=join(root,'Documentary','Montage',`${motionArtworkHash(p)}-artwork-v1.json`);
 const saved={version:1 as const,inputHash:motionArtworkHash(p),model:'saved-answer-fixture',scenes:[{sceneId:'water-0',artwork,artworkSpan:{endSceneId:'water-2'}}],rejected:[]};
 await writeFile(checkpoint,JSON.stringify({...saved,inputHash:'another-source-edit'}));
 const unmatched=await service().prepareMontage(p.id);
 assert.equal(unmatched.scenes[0]!.documentary!.semanticMontage!.artwork,undefined);
 assert.equal(semanticCalls,2);assert.equal(artworkCalls,1);
 await writeFile(checkpoint,JSON.stringify(saved));
 const recovered=await service().prepareMontage(p.id);
 verify(recovered);assert.equal(semanticCalls,2);assert.equal(artworkCalls,1);
 assert.equal(recovered.scenes[0]!.documentary!.semanticMontage!.explanation,undefined);
});

test('a completed commission reports attachment and actual montage use separately when a protected range wins',async t=>{
 const traces:Record<string,unknown>[]=[];
 setDiagnosticSink((_level,event,details)=>{if(event==='documentary.artwork.application')traces.push(details);});
 t.after(()=>setDiagnosticSink());
 for(const mode of ['partial-explanation','numerical-evidence'] as const){
  const root=await mkdtemp(join(tmpdir(),'gws-artwork-application-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const p={id:`blocked-${mode}`,mediaMode:'stock',aspectRatio:'16:9',language:'en',
   settings:{voice:{enabled:true},music:{enabled:false,volume:0},assembly:{kenBurns:true,documentary:{version:2,autoEffects:false,autoTransitions:false,autoMotionGraphics:true,montage:{version:1,style:'editorial',intensity:'rich',musicPolicy:'preserve'}}}},
   scenes:['Water enters soil.','Water reaches groundwater.','Water feeds springs.'].map((narration,i)=>({id:`water-${i}`,order:i,narration,durationSeconds:4,imagePath:`source-${i}.jpg`,audioPath:`voice-${i}.wav`,
    documentary:{verified:true,layout:'full',effects:[],caption:{enabled:false,text:''},timing:{sourceKey:`voice-${i}`,durationInFrames:120,speechSeconds:3.8},
     selected:{id:`selected-${i}`,kind:'image',width:1920,height:1080},requirement:{text:narration,identities:[],years:[],accent:'none'},
     semanticMontage:{sceneId:`water-${i}`,subject:'',beat:'explain',treatment:'footage',cutawaySceneIds:[]}}}))} as unknown as Project;
  if(mode==='partial-explanation')p.scenes[0]!.documentary!.semanticMontage!.explanation={kind:'flow',nodes:[{id:'soil',label:'soil',symbol:'place'},{id:'spring',label:'springs',symbol:'place'}],endSceneId:'water-2'};
  else {p.scenes[0]!.narration='3 of 4 samples passed.';Object.assign(p.scenes[0]!.documentary!.semanticMontage!,{treatment:'statistic',emphasis:'3 of 4'});}
  const hash=semanticMontageHash(p);for(const s of p.scenes)s.documentary!.semanticMontageInputHash=hash;
  const artwork:DocumentaryArtwork={version:1,intent:'Commissioned object study',layout:'full',canvas:{width:1000,height:562},palette:{background:'#f5f3ef',ink:'#222222',accent:'#dd4433',secondary:'#8899aa'},
   startSeconds:0,durationSeconds:8,layers:[{id:'body',kind:'ellipse',x:100,y:100,w:300,h:200,fill:'accent'},
    {id:'surface',kind:'path',x:200,y:300,w:400,h:100,path:'M0 0H400V100H0Z',fill:'secondary'},
    {id:'detail',kind:'path',x:150,y:100,w:200,h:150,path:'M0 150Q0 0 200 0V150Z',fill:'ink'}]};
  const saved={version:1 as const,inputHash:motionArtworkHash(p),model:'received-answer-fixture',scenes:[{sceneId:'water-0',artwork,artworkSpan:{endSceneId:'water-1'}}],rejected:[]};
  const repo=new MemoryProjectRepository(),projects=new ProjectService(repo,new MockDirectorProvider());await repo.save(p);
  const directory=join(root,'Documentary','Montage'),file=join(directory,`${saved.inputHash}-artwork-v1.json`),bytes=JSON.stringify(saved);
  let calls=0;
  const ai={planMotionArtwork:async()=>{calls++;await mkdir(directory,{recursive:true});await writeFile(file,bytes);return saved;}};
  const make=()=>new DocumentaryProjectService(projects,{projectDirectory:()=>root,ensureProject:async()=>{}} as never,{} as never,root,{} as never,()=>{},ai as never);
  const first=await make().prepareMontage(p.id),second=await make().prepareMontage(p.id);
  const status=second.settings.assembly.documentary!.motionArtworkStatus!;
  assert.equal(status.status,'planned');assert.equal(calls,1,'ordinary resume must not buy another drawing');
  assert.match(status.message,new RegExp(`принято 1, прикреплено ${mode==='partial-explanation'?0:1}, в монтаже 0`));
  assert.match(status.message,/Не применены: сцена 1/);
  assert.equal(status.message,first.settings.assembly.documentary!.motionArtworkStatus!.message);
  assert.equal(second.settings.assembly.documentary!.semanticMontageStatus!.message.split('AI-графика:').length,2);
  assert.equal(second.scenes.filter(s=>s.documentary?.motionGraphic?.artwork).length,0);
  assert.equal(await readFile(file,'utf8'),bytes,'accepted paid artifact must remain intact');
  const trace=traces.at(-1)!;
  assert.equal(trace.accepted,1);assert.equal(trace.used,0);assert.equal(trace.inputHash,saved.inputHash);
  assert.deepEqual(trace.skipped,[{sceneId:'water-0',scene:1,stage:mode==='partial-explanation'?'attachment':'montage'}]);
 }
});
