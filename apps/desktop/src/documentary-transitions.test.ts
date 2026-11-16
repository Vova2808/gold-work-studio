import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {documentarySceneTransition,documentaryTransitionPair,type EffectAsset,type Project} from '@gold-work/shared';
import {buildDocumentaryTimeline} from '@gold-work/remotion-video';
import {planDocumentaryTransitions} from './documentary-transitions.js';
import {planDocumentaryEffects} from './documentary-effects.js';
import type {EffectLibrary} from './effect-library.js';
import type {LocalProjectStorage} from './local-project-storage.js';

function fixture():Project{return {id:'fixture',mediaMode:'stock',aspectRatio:'16:9',settings:{voice:{enabled:true},assembly:{transitionType:'none',documentary:{version:2,autoTransitions:true,autoEffects:false,montageDensity:'balanced'}}},
  scenes:Array.from({length:9},(_,order)=>({id:`scene-${order}`,order,title:`Topic ${order}`,durationSeconds:5,narration:`Exact sentence ${order}`,audioPath:`voice-${order}.wav`,
    documentary:{layout:'full',effects:[],caption:{enabled:false,text:''},requirement:{sectionTitle:order<2?'Engine':order<5?'Transmission':'Wheels',accent:'transition'},timing:{durationInFrames:150}}}))} as unknown as Project;}

test('automatic transitions follow sections, preserve authored cuts and pins, and retain full narration timing',()=>{
  const p=fixture();
  let scenes=planDocumentaryTransitions(p);
  assert.deepEqual(scenes.filter(s=>s.autoTransition==='mix').map(s=>s.order),[1,4]);
  assert.deepEqual(scenes.map(s=>[s.narration,s.audioPath,s.durationSeconds]),p.scenes.map(s=>[s.narration,s.audioPath,s.durationSeconds]));
  const timeline=buildDocumentaryTimeline({...p,scenes});
  assert.equal(timeline.durationInFrames,1350);
  assert.equal(timeline.scenes[1]!.transitionFrames,11);
  assert.equal(timeline.scenes[2]!.fromFrame,300);
  assert.equal(documentarySceneTransition({...scenes[1]!,transition:'none'},p.settings.assembly).kind,'none');
  assert.equal(documentarySceneTransition({...scenes[1]!,transitionDurationSeconds:0},p.settings.assembly).kind,'none');
  const disabled={...p.settings.assembly,documentary:{...p.settings.assembly.documentary!,autoTransitions:false}};
  assert.equal(documentarySceneTransition(scenes[1]!,disabled).kind,'none');
  assert.equal(documentarySceneTransition({...scenes[1]!,transition:'fade',transitionDurationSeconds:.7},disabled).durationSeconds,.7);
  p.scenes[1]!.transition='none';p.scenes[4]!.documentary!.pinned=true;
  scenes=planDocumentaryTransitions(p);
  assert.equal(scenes[1]!.transition,'none');assert.equal(scenes[4],p.scenes[4]);
  const moved={...scenes[8]!,autoTransition:'mix' as const,autoTransitionDurationSeconds:.35};
  assert.equal(planDocumentaryTransitions({...p,scenes:[...scenes.slice(0,8),moved]})[8]!.autoTransition,undefined);
});

test('related photographs get semantic blends; authored cuts and complete speech remain intact',()=>{
  const p=fixture();p.scenes=p.scenes.map((scene,i)=>({...scene,imagePath:`photo-${i}.jpg`,documentary:{...scene.documentary!,requirement:{...scene.documentary!.requirement,sectionTitle:'One subject'}}}));
  p.scenes[2]!.transition='none';
  const scenes=planDocumentaryTransitions(p),blends=scenes.filter(s=>s.autoTransition==='mix');
  assert.equal(blends.length,p.scenes.length-2,'related photos blend except the authored cut and final scene');
  assert.ok(blends.every(s=>s.autoTransitionDurationSeconds===.2));
  assert.equal(scenes[2]!.transition,'none');
  assert.equal(buildDocumentaryTimeline({...p,scenes}).durationInFrames,1350);
  assert.deepEqual(scenes.map(s=>[s.audioPath,s.narration]),p.scenes.map(s=>[s.audioPath,s.narration]));
});

test('rich montage keeps ordinary video cuts and uses blur for a semantic resolution without changing speech length',()=>{
  const p=fixture();p.settings.assembly.documentary!.montageDensity='rich';
  p.scenes=p.scenes.map((s,i)=>({...s,videoPath:`v${i}.mp4`,documentary:{...s.documentary!,requirement:{...s.documentary!.requirement,sectionTitle:'One subject'}}}));
  p.scenes[2]!.transition='none';
  p.scenes[5]!.documentary!.semanticMontage={sceneId:p.scenes[5]!.id,subject:'Topic',beat:'resolve',treatment:'footage',cutawaySceneIds:[]};
  const planned=planDocumentaryTransitions(p);
  assert.equal(planned.filter(s=>s.autoTransition==='mix').length,1);
  assert.ok(planned.some(s=>s.documentary?.autoTransitionStyle==='blur'));
  assert.equal(planned[2]!.transition,'none');
  const timeline=buildDocumentaryTimeline({...p,scenes:planned});
  assert.equal(timeline.durationInFrames,1350);
  const index=planned.findIndex(s=>s.documentary?.autoTransitionStyle==='blur');
  assert.equal(timeline.scenes[index]!.documentary!.transitionStyle,'blur');
  planned[index]!.transition='mix';
  planned[index]!.documentary!.templateTiming={startSeconds:1,durationSeconds:2};
  const manual=buildDocumentaryTimeline({...p,scenes:planned});
  assert.equal(manual.scenes[index]!.documentary!.transitionStyle,'clean');
  assert.deepEqual(manual.scenes[index]!.documentary!.templateTiming,{startSeconds:1,durationSeconds:2});
});

test('visual library transitions cross both sides of the cut once, without sound or out-of-scope half-transitions',async()=>{
  const root=await mkdtemp(join(tmpdir(),'gws-transition-'));
  await writeFile(join(root,'transition.mp4'),'copy-only fixture');
  const asset={id:'transition',name:'Transition',version:1,file:'transition.mp4',kind:'video',category:'transition',state:'ready',automatic:true,review:'approved',rights:'user-confirmed',
    metadata:{durationSeconds:1},defaults:{trimStartSeconds:0,fadeInSeconds:.1,fadeOutSeconds:.1,sourceAudio:true,volume:100,opacity:100,blend:'screen'}} as EffectAsset;
  const library={rootPath:root,snapshot:async()=>({assets:[asset]})} as unknown as EffectLibrary;
  const storage={projectDirectory:()=>join(root,'project')} as unknown as LocalProjectStorage;
  const p=fixture();p.scenes=planDocumentaryTransitions(p);
  const edited=await planDocumentaryEffects(p,library,storage);
  const outgoing=edited[1]!.documentary!.effects[0]!,incoming=edited[2]!.documentary!.effects[0]!;
  assert.ok(outgoing&&incoming);
  assert.equal(outgoing.startSeconds,4.5);assert.equal(incoming.startSeconds,0);
  assert.equal(outgoing.defaults.trimEndSeconds,incoming.defaults.trimStartSeconds);
  assert.equal(outgoing.durationSeconds+incoming.durationSeconds,1);
  assert.equal(outgoing.defaults.fadeOutSeconds,0);assert.equal(incoming.defaults.fadeInSeconds,0);
  assert.ok([outgoing,incoming].every(e=>!e.defaults.sourceAudio&&e.defaults.volume===0));
  assert.equal(edited[1]!.autoTransition,'none');
  assert.deepEqual(await planDocumentaryEffects({...p,scenes:edited},library,storage),edited);
  assert.ok((await planDocumentaryEffects(p,library,storage,[p.scenes[2]!.id])).every(s=>s.documentary!.effects.length===0));
  const [a,b]=documentaryTransitionPair(p.scenes[1]!,p.scenes[2]!,{...outgoing,id:'manual',durationSeconds:.7,defaults:{...outgoing.defaults,trimStartSeconds:2}},'manual');
  assert.equal(a!.durationSeconds+b!.durationSeconds,.7);
  assert.equal(a!.defaults.trimEndSeconds,b!.defaults.trimStartSeconds);
  assert.equal(b!.defaults.trimEndSeconds,2.7);
});
