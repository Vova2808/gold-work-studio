import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {DocumentaryEffect,EffectAsset,Project,Scene} from '@gold-work/shared';
import {documentaryMontageSoundEvents,planDocumentaryEffects} from './documentary-effects.js';
import {planDocumentaryTransitions} from './documentary-transitions.js';
import type {EffectLibrary} from './effect-library.js';
import type {LocalProjectStorage} from './local-project-storage.js';

function project(count=20):Project {
  return {id:'library-seams',mediaMode:'stock',settings:{voice:{enabled:true},assembly:{transitionType:'none',documentary:{
    autoEffects:true,autoTransitions:true,autoMotionGraphics:false,montage:{version:1,style:'editorial',intensity:'rich',hookSeconds:16}}}},
    scenes:Array.from({length:count},(_,order)=>({id:`s${order}`,order,durationSeconds:4,videoPath:`selected-${order}.mp4`,audioPath:`voice-${order}.wav`,narration:`Original narration ${order}`,
      documentary:{effects:[],caption:{enabled:false,text:''},requirement:{accent:'none',sectionTitle:'One section'},timing:{durationInFrames:120},
        semanticMontage:{sceneId:`s${order}`,beat:order===8?'turn':order===12?'conflict':order===18?'resolve':'evidence',treatment:'footage',subject:'same',cutawaySceneIds:[]}}}))} as unknown as Project;
}

function asset(id:string,length=2.4):EffectAsset {
  return {id,name:id,version:1,file:`${id}.mp4`,kind:'video',category:'transition',state:'ready',automatic:true,review:'approved',rights:'user-confirmed',
    metadata:{durationSeconds:length+1},defaults:{trimStartSeconds:.5,trimEndSeconds:.5+length,fadeInSeconds:.1,fadeOutSeconds:.2,sourceAudio:true,volume:100,opacity:80,blend:'screen'}} as EffectAsset;
}

async function libraryFixture(t:TestContext,assets:EffectAsset[]) {
  const root=await mkdtemp(join(tmpdir(),'gws-library-seams-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  for(const a of assets)await writeFile(join(root,a.file),'copy-only fixture; not rendered');
  return {library:{rootPath:root,snapshot:async()=>({assets})} as unknown as EffectLibrary,
    storage:{projectDirectory:()=>join(root,'project')} as unknown as LocalProjectStorage};
}

const outgoing=(scenes:Scene[])=>scenes.flatMap(s=>s.documentary!.effects.filter(e=>e.boundary?.from===s.id).map(e=>({scene:s,effect:e})));
const audio=(scenes:Scene[])=>scenes.flatMap(s=>s.documentary!.effects.filter(e=>e.kind==='audio').map(e=>({scene:s.id,effect:e})));

test('Rossi montage uses whole library seams alongside SFX and backgrounds, with slower body cadence',async t=>{
  const visuals=Array.from({length:6},(_,i)=>asset(`visual-${i}`));
  const sound={...asset('whoosh',.3),file:'whoosh.wav',kind:'audio',defaults:{...asset('whoosh',.3).defaults,trimStartSeconds:0,trimEndSeconds:.3}} as EffectAsset;
  const {library,storage}=await libraryFixture(t,[...visuals,sound]),p=project();
  const backgrounds=p.scenes.map((s,i)=>({id:`background-${i}`,assetId:'grid',kind:'video',role:'background',enabled:true,startSeconds:0,durationSeconds:4,origin:'manual'} as DocumentaryEffect));
  p.scenes.forEach((s,i)=>s.documentary!.effects.push(backgrounds[i]!));
  const before=structuredClone(p),events=documentaryMontageSoundEvents(p);
  // Deliberately omit planDocumentaryTransitions: a dissolve is not a prerequisite.
  const scenes=await planDocumentaryEffects(p,library,storage),seams=outgoing(scenes);
  assert.deepEqual(seams.map(({scene})=>(scene.order+1)*4),[4,12,28,44,60,76]);
  assert.ok(seams.length<p.scenes.length/2);
  assert.equal(audio(scenes).length,events.length,'Visual transitions must not add SFX');
  for(const {scene,effect:out} of seams){
    const incoming=scenes.find(s=>s.id===out.boundary!.to)!.documentary!.effects.find(e=>e.id===out.id.replace(/-out$/,'-in'))!;
    assert.ok(incoming);assert.equal(out.startSeconds,2.8);assert.equal(incoming.startSeconds,0);
    assert.equal(out.durationSeconds+incoming.durationSeconds,2.4);
    assert.equal(out.defaults.trimStartSeconds,.5);assert.equal(out.defaults.trimEndSeconds,incoming.defaults.trimStartSeconds);
    assert.equal(incoming.defaults.trimEndSeconds,2.9);
    assert.equal(out.defaults.fadeOutSeconds,0);assert.equal(incoming.defaults.fadeInSeconds,0);
    assert.ok([out,incoming].every(e=>e.role==='transition'&&e.blend==='screen'&&e.defaults.opacity===80&&e.defaults.sourceAudio===false&&e.defaults.volume===0));
    assert.equal(scene.autoTransition,'none');
  }
  scenes.forEach((s,i)=>assert.equal(s.documentary!.effects[0],backgrounds[i]));
  assert.deepEqual(scenes.map(s=>[s.videoPath,s.audioPath,s.narration,s.durationSeconds,s.documentary!.timing]),p.scenes.map(s=>[s.videoPath,s.audioPath,s.narration,s.durationSeconds,s.documentary!.timing]));
  assert.deepEqual(p,before,'Planning does not mutate the source project');
  const again=await planDocumentaryEffects({...p,scenes:planDocumentaryTransitions({...p,scenes})},library,storage);
  assert.deepEqual(outgoing(again).map(v=>v.effect),seams.map(v=>v.effect),'Replanning keeps pairs and spacing without accumulating new seams');
  assert.deepEqual(audio(again),audio(scenes),'Replanning adds no duplicate or louder sound');
  const disabled=planDocumentaryTransitions({...p,scenes,settings:{...p.settings,assembly:{...p.settings.assembly,documentary:{...p.settings.assembly.documentary!,autoTransitions:false}}}});
  assert.equal(outgoing(disabled).length,0);assert.deepEqual(audio(disabled),audio(scenes));
});

test('the same hook and semantic boundaries receive a spaced built-in fallback when no library is present',()=>{
  const p=project(),scenes=planDocumentaryTransitions(p);
  assert.deepEqual(scenes.filter(s=>s.autoTransition==='mix').map(s=>(s.order+1)*4),[4,12,28,44,60,76]);
  assert.equal(scenes.at(-1)!.autoTransition,undefined);
  assert.deepEqual(planDocumentaryTransitions({...p,scenes}),scenes);
});

test('manual audio and nonoverlapping visual edits do not veto a library boundary',async t=>{
  const {library,storage}=await libraryFixture(t,[asset('visual')]),p=project(2);
  const sound={id:'manual-audio',assetId:'voice-accent',kind:'audio',role:'sound',enabled:true,origin:'manual',startSeconds:0,durationSeconds:.3,defaults:{volume:27}} as DocumentaryEffect;
  const overlay={id:'manual-overlay',assetId:'label',kind:'image',role:'overlay',enabled:true,origin:'manual',startSeconds:0,durationSeconds:1} as DocumentaryEffect;
  p.scenes[0]!.documentary!.effects=[overlay];p.scenes[1]!.documentary!.effects=[sound];
  const scenes=await planDocumentaryEffects(p,library,storage);
  assert.equal(outgoing(scenes).length,1);
  assert.equal(scenes[0]!.documentary!.effects[0],overlay);assert.equal(scenes[1]!.documentary!.effects[0],sound);
  assert.equal(audio(scenes).length,1);
});

test('authored cuts, pins, manual graphics/cuts, occupied halves and disabled seams are preserved',async t=>{
  const {library,storage}=await libraryFixture(t,[asset('visual')]);
  const cases:Array<[string,(p:Project)=>void]>=[
    ['authored cut',p=>{p.scenes[0]!.transition='none';}],
    ['authored duration',p=>{p.scenes[0]!.transitionDurationSeconds=0;}],
    ['authored dissolve',p=>{p.scenes[0]!.transition='mix';}],
    ['global dissolve',p=>{p.settings.assembly.transitionType='mix';}],
    ['left pin',p=>{p.scenes[0]!.documentary!.pinned=true;}],
    ['right pin',p=>{p.scenes[1]!.documentary!.pinned=true;}],
    ['manual template',p=>{p.scenes[1]!.documentary!.templateOrigin='manual';}],
    ['manual graphic',p=>{p.scenes[1]!.documentary!.motionGraphic={enabled:true,kind:'subject-card',origin:'manual'} as never;}],
    ['manual cuts',p=>{p.scenes[0]!.documentary!.cuts=[{fromFrame:0,durationInFrames:120}] as never;p.scenes[0]!.documentary!.cutsOrigin='manual';}],
    ['occupied outgoing half',p=>{p.scenes[0]!.documentary!.effects=[{id:'overlay',kind:'image',role:'overlay',enabled:true,startSeconds:3,durationSeconds:1} as DocumentaryEffect];}],
    ['occupied incoming half',p=>{p.scenes[1]!.documentary!.effects=[{id:'overlay',kind:'image',role:'overlay',enabled:true,startSeconds:0,durationSeconds:1} as DocumentaryEffect];}],
    ['disabled seam',p=>{p.scenes[0]!.documentary!.effects=[{id:'disabled',kind:'video',role:'transition',enabled:false,boundary:{from:'s0',to:'s1',origin:'manual'}} as DocumentaryEffect];}],
    ['continuing panels',p=>{p.scenes.forEach((s,i)=>{s.documentary!.motionGraphic={enabled:true,kind:'feature-list',origin:'automatic',sequenceId:'sequence',presentation:'panels',activeIndex:i} as never;});}],
  ];
  for(const [name,edit] of cases){
    const p=project(2);p.settings.assembly.documentary!.autoEffects=false;edit(p);
    const before=structuredClone(p),scenes=await planDocumentaryEffects(p,library,storage);
    assert.deepEqual(scenes,p.scenes,name);assert.deepEqual(p,before,name);
  }
});

test('both sides must be in scope, full trimmed transitions must fit, and excluded scenes are not seam endpoints',async t=>{
  const {library,storage}=await libraryFixture(t,[asset('visual',2.5)]),p=project(3);
  assert.equal(outgoing(await planDocumentaryEffects(p,library,storage,['s1'])).length,0);
  assert.equal(outgoing(await planDocumentaryEffects(p,library,storage,['s0','s1'])).length,1);
  p.scenes[1]!.includeInAssembly=false;
  p.scenes[1]!.documentary!.effects=[{id:'excluded-sfx',kind:'audio',origin:'automatic',enabled:true} as DocumentaryEffect];
  const scenes=await planDocumentaryEffects(p,library,storage);
  assert.equal(outgoing(scenes)[0]!.effect.boundary!.to,'s2');assert.equal(scenes[1],p.scenes[1]);
  const out=outgoing(scenes)[0]!.effect,incoming=scenes[2]!.documentary!.effects.find(e=>e.boundary)!;
  assert.equal(out.durationSeconds,37/30);assert.equal(incoming.durationSeconds,38/30);
  assert.equal(out.defaults.trimEndSeconds,incoming.defaults.trimStartSeconds);assert.equal(incoming.defaults.trimEndSeconds,3);
  p.scenes[0]!.documentary!.timing!.durationInFrames=30;p.scenes[0]!.durationSeconds=1;
  assert.equal(outgoing(await planDocumentaryEffects(p,library,storage)).length,0,'Never clip a long transition down to the shot');
  const long=asset('too-long',6),overlong=await libraryFixture(t,[long]);
  assert.equal(outgoing(await planDocumentaryEffects(project(2),overlong.library,overlong.storage)).length,0);
});

test('unapproved or missing optional visuals keep the built-in transition without changing catalog flags',async t=>{
  const assets=[{...asset('off'),automatic:false},{...asset('pending'),review:'pending' as const},asset('missing')];
  const {library,storage}=await libraryFixture(t,[]);
  library.snapshot=async()=>({assets}) as never;
  const p=project(2);p.scenes=planDocumentaryTransitions(p);
  assert.equal(p.scenes[0]!.autoTransition,'mix');
  const before=structuredClone(assets),scenes=await planDocumentaryEffects(p,library,storage);
  assert.deepEqual(scenes,p.scenes);assert.deepEqual(assets,before);
});

test('an occupied planned seam keeps its dissolve without adding a library transition on the next cut',async t=>{
  const {library,storage}=await libraryFixture(t,[asset('visual')]),p=project(4);
  p.scenes=planDocumentaryTransitions(p);
  p.scenes[0]!.documentary!.effects=[{id:'manual-overlay',kind:'image',role:'overlay',enabled:true,startSeconds:3,durationSeconds:1} as DocumentaryEffect];
  const scenes=await planDocumentaryEffects(p,library,storage);
  assert.equal(scenes[0]!.autoTransition,'mix');
  assert.deepEqual(outgoing(scenes).map(({scene})=>(scene.order+1)*4),[12]);
});
