import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import type {Project,DocumentaryArtwork,DocumentarySemanticMontage} from '@gold-work/shared';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {attachMotionArtwork,createMotionArtworkPlan,motionArtworkHash,repairSavedMotionArtworkPlan,validateMotionArtwork,receivedMotionArtwork,settleArtworkKeys} from './documentary-artwork-plan.js';
import {artworkForRevision} from './documentary-artwork-revision.js';
import {artworkSourceCandidates} from './documentary-artwork-previews.js';
import {semanticMontageHash} from './documentary-semantic-montage.js';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {DocumentaryAnalysisError} from './documentary-analysis-error.js';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {documentaryEditErrors} from './documentary-validation.js';
import {buildDocumentaryTimeline} from '../../../packages/remotion-video/src/documentary-timeline.js';

const drawing=():DocumentaryArtwork=>({version:1,intent:'Water cycle',layout:'full',canvas:{width:1000,height:600},palette:{background:'#101820',ink:'#f5f0e5',accent:'#7ab5ce',secondary:'#cbb583'},startSeconds:.2,durationSeconds:4.5,
  layers:[{id:'label',kind:'text',x:70,y:60,w:400,h:70,text:'water',fontSize:52},
    {id:'water',kind:'ellipse',x:100,y:420,w:230,h:70,fill:'accent'},
    {id:'vapour',kind:'path',x:180,y:180,w:100,h:200,path:'M50 100Q10 70 50 40Q90 10 50 0',stroke:'ink',fill:'none',keyframes:[{t:0,draw:0},{t:.4,draw:1},{t:1,draw:1}]},
    {id:'cloud',kind:'ellipse',x:400,y:150,w:300,h:100,fill:'ink',keyframes:[{t:0,opacity:0},{t:.5,opacity:1},{t:1,opacity:1}]}]});
function fixture():Project {
  const p={id:'artwork-test',mediaMode:'stock',aspectRatio:'16:9',language:'en',settings:{voice:{enabled:true},music:{enabled:false},assembly:{kenBurns:true,documentary:{version:2,autoMotionGraphics:true,autoEffects:false,autoTransitions:false,montage:{version:1,style:'editorial',intensity:'rich',musicPolicy:'preserve'}}}},
    scenes:[{id:'rain',order:0,narration:'Warm water evaporates. The vapour condenses into clouds.',durationSeconds:6,imagePath:'rain.jpg',audioPath:'voice.wav',documentary:{verified:true,checksum:'rain',layout:'full',effects:[],caption:{enabled:false,text:''},selected:{id:'rain',kind:'image',width:1920,height:1080},requirement:{text:'water',identities:[],years:[],accent:'none'},timing:{sourceKey:'voice',durationInFrames:180,speechSeconds:5.8},semanticMontage:{sceneId:'rain',subject:'water',beat:'explain',treatment:'footage',cutawaySceneIds:[]}}}]} as unknown as Project;
  p.scenes[0]!.documentary!.semanticMontageInputHash=semanticMontageHash(p);return p;
}
test('dense commissions carry film timing across batches and keep more than two useful drawings without extra calls',async t=>{
  const p=fixture(),source=p.scenes[0]!;
  p.scenes=Array.from({length:16},(_,order)=>{
    const scene=structuredClone(source);scene.id=`water-${order}`;scene.order=order;
    scene.documentary!.timing!.durationInFrames=150;
    scene.documentary!.semanticMontage!.sceneId=scene.id;return scene;
  });
  p.scenes[0]!.documentary!.semanticMontage!.beat='conflict';
  p.scenes[1]!.includeInAssembly=false;
  p.scenes[4]!.documentary!.pinned=true;
  const root=await mkdtemp(join(tmpdir(),'artwork-density-'));t.after(()=>rm(root,{recursive:true,force:true}));
  type Row={sceneId:string;seconds:number;timelineStartSeconds:number;storyBeat:string;editable:boolean};
  const inputs:Array<{scenes:Row[]}>=[];
  const result=await createMotionArtworkPlan(p,root,async(_system,input)=>{
    const request=JSON.parse(input) as {scenes:Row[]};inputs.push(request);
    return {scenes:request.scenes.filter(row=>row.editable).slice(0,4).map(row=>({sceneId:row.sceneId,artwork:drawing()}))};
  },'local-fixture');
  assert.equal(inputs.length,2,'still one author call per existing batch');
  assert.deepEqual(inputs[0]!.scenes.map(row=>row.timelineStartSeconds),[0,5,10,15,20,25,30,35]);
  assert.equal(inputs[1]!.scenes[0]!.timelineStartSeconds,40);
  assert.equal(inputs[0]!.scenes[0]!.storyBeat,'conflict');
  assert.equal(inputs[0]!.scenes.filter(row=>row.timelineStartSeconds<30).length,6);
  assert.equal(inputs[0]!.scenes.find(row=>row.sceneId==='water-4')!.editable,false);
  assert.equal(result.scenes.length,8,'four valid drawings per batch survive acceptance');
  assert.equal(result.rejected.length,0);
  assert.ok(!result.scenes.some(row=>row.sceneId==='water-1'||row.sceneId==='water-4'));
  const cached=await createMotionArtworkPlan(p,root,async()=>{throw Error('no extra commission');},'local-fixture');
  assert.deepEqual(cached,result);
});

function authoredDetail(scale:.368|.44,sceneId='rain'):DocumentaryArtwork{
  const a=drawing();a.canvas={width:1000,height:562};a.motionCoordinates='absolute';
  const first=scale===.368;
  a.layers.unshift({id:'whole',kind:'media',x:194,y:34,w:613,h:410,sourceSceneId:sceneId,
    sourceWindow:{x:0,y:0,w:1,h:1}},
    {id:'detail',kind:'media',x:first?284:560,y:first?36:34,w:first?433:300,h:first?490:300,sourceSceneId:sceneId,
      sourceWindow:first?{x:.1,y:.52,w:.26,h:.44}:{x:.54,y:.46,w:.24,h:.16},
      keyframes:first?[{t:0,x:284,y:36,scale:1},{t:.3,x:284,y:36,scale:1},
        {t:.55,x:118.5,y:92.4,scale},{t:1,x:118.5,y:92.4,scale}]
        :[{t:0,x:191,y:213,scale},{t:.48,x:191,y:213,scale},{t:.66,x:560,y:34,scale:1},{t:1,x:560,y:34,scale:1}]});
  return a;
}

test('authored media preserves paid sub-unit scale and centre-based position through validation and absolute roundtrip',()=>{
  const p=fixture(),source={currentSceneId:'rain',allowedSources:artworkSourceCandidates(p,'rain')};
  for(const scale of [.368,.44] as const){
    const raw=authoredDetail(scale),original=JSON.stringify(raw);
    const normalized=validateMotionArtwork(raw,p.scenes[0]!.narration,6,true,16/9,source).artwork!;
    assert.ok(normalized);const detail=normalized.layers.find(layer=>layer.id==='detail')!;
    const at=scale===.368?.55:0,state=detail.keyframes!.find(key=>key.t===at)!;
    assert.equal(state.scale,scale);
    assert.equal(state.x,scale===.368?118.5-284:191-560);
    assert.ok(Math.abs(state.y!-(scale===.368?92.4-36:213-34))<1e-10);
    const absolute=artworkForRevision(normalized).layers.find(layer=>layer.id==='detail')!;
    const key=absolute.keyframes!.find(frame=>frame.t===at)!;
    assert.equal(key.x,scale===.368?118.5:191);assert.equal(key.y,scale===.368?92.4:213);
    assert.equal(key.scale,scale);assert.deepEqual([detail.x,detail.y,detail.w,detail.h],scale===.368?[284,36,433,490]:[560,34,300,300]);
    const again=validateMotionArtwork(artworkForRevision(normalized),p.scenes[0]!.narration,6,true,16/9,source).artwork!;
    assert.deepEqual(again.layers.find(layer=>layer.id==='detail'),detail,'absolute/relative roundtrip must not drift');
    assert.equal(JSON.stringify(raw),original);
  }
  const invalid=authoredDetail(.368);invalid.layers[1]!.keyframes=[{t:0,x:-10000,y:10000,scale:.368},{t:1,x:-10000,y:10000,scale:.368}];
  const bounded=validateMotionArtwork(invalid,p.scenes[0]!.narration,6,true,16/9,source).artwork!.layers[1]!;
  const state=bounded.keyframes![0]!,left=bounded.x+state.x!+bounded.w*(1-state.scale!)/2,
    bottom=bounded.y+state.y!+bounded.h*(1+state.scale!)/2;
  assert.ok(Math.abs(left)<1e-8&&Math.abs(bottom-562)<1e-8,'scaled footprint still stays inside the canvas');
});
test('authored geometry rejects executable paths and invented labels; timing stays readable',()=>{
  const a=drawing();a.startSeconds=5.8;
  const accepted=validateMotionArtwork(a,fixture().scenes[0]!.narration,6).artwork!;
  assert.ok(accepted);assert.equal(accepted.startSeconds,3.6);assert.ok(accepted.durationSeconds>=2.4);
  const injection=drawing();injection.layers[2]!.path='<script>fetch(1)</script>';
  assert.equal(validateMotionArtwork(injection,'water',6).artwork,undefined);
  const invention=drawing();invention.layers[0]!.text='100 degrees';
  const withoutInventedLabel=validateMotionArtwork(invention,'water',6).artwork!;
  assert.ok(withoutInventedLabel,'useful object geometry survives removal of all unsupported captions');
  assert.equal(withoutInventedLabel.layers.some(l=>l.kind==='text'),false);
  const positioned=drawing();positioned.motionCoordinates='absolute';
  positioned.layers[1]!.keyframes=[{t:0,x:100},{t:1,x:200}];
  assert.deepEqual(validateMotionArtwork(positioned,'water',6).artwork!.layers[1]!.keyframes,[{t:0,x:0},{t:.76,x:100},{t:1,x:100}]);
});
test('simultaneous disjoint motion properties merge without accepting conflicting keys',()=>{
  const a=drawing();a.layers[2]!.keyframes=[{t:0,draw:0},{t:.4,draw:1,ease:'linear'},
    {t:.4,opacity:1},{t:1,draw:1,opacity:1}];
  const original=JSON.stringify(a),accepted=validateMotionArtwork(a,'water',6).artwork!;
  assert.deepEqual(accepted.layers[2]!.keyframes,[{t:0,draw:0},{t:.4,draw:1,opacity:1,ease:'linear'},
    {t:1,draw:1,opacity:1}]);
  assert.equal(JSON.stringify(a),original,'the saved paid answer is not rewritten');
  a.layers[2]!.keyframes![2]={t:.4,draw:0};
  assert.match(validateMotionArtwork(a,'water',6).issue??'',/invalid motion keyframes/);
  a.layers[2]!.keyframes![2]={t:.4,opacity:1,ease:'out'};
  assert.match(validateMotionArtwork(a,'water',6).issue??'',/invalid motion keyframes/);
});
test('linked mechanism retains safe joint geometry and rejects an impossible rod',()=>{
  const a=drawing();
  a.linkedMechanism={kind:'slider-crank',centerX:440,centerY:470,crankRadius:70,rodLength:180,
    pistonWidth:150,pistonHeight:65,startAngle:0,turns:1};
  const accepted=validateMotionArtwork(a,'water',6).artwork;
  assert.deepEqual(accepted?.linkedMechanism,a.linkedMechanism);
  a.linkedMechanism.rodLength=60;
  assert.match(validateMotionArtwork(a,'water',6).issue??'',/invalid linked mechanism geometry/);
  a.linkedMechanism.rodLength=180;
  a.direction={concept:'cycle',alternatives:[],beats:[{at:.75,action:'Piston at bottom dead center, rod horizontal'}]};
  assert.match(validateMotionArtwork(a,'water',6).issue??'',/contradicts storyboard dead-centre phase/);
});
test('validated artwork span preserves late cues on its shared clock',()=>{
  const a=drawing();a.layers[1]!.keyframes=[{t:0,opacity:0},{t:.9,opacity:1}];
  a.camera={keyframes:[{t:0,x:500,y:300,scale:1},{t:.9,x:500,y:300,scale:1.1}]};
  const local=validateMotionArtwork(a,'water',8).artwork!;
  const spanning=validateMotionArtwork(a,'water',8,true,16/9,undefined,true).artwork!;
  assert.ok(local.layers[1]!.keyframes![1]!.t<.9);
  assert.equal(spanning.layers[1]!.keyframes![1]!.t,.9);
  assert.ok(local.camera!.keyframes[1]!.t<.9);
  assert.equal(spanning.camera!.keyframes[1]!.t,.9);
});
test('spoken counts retain their captions and a wide group can move its bounded contents',()=>{
  for(const [caption,script,allowed] of [
    ['90°','Crankpins at ninety degrees.',true],['1 podium','He had one podium.',true],
    ['2003','One podium in 2003.',true],['0.210 seconds','A gap of 0.210 seconds.',true],
    ['6 laps remaining','There were six laps remaining.',true],['3 people','There were three hundred people.',false],
    ['21 wins','Only one win.',false],['3','There were three hundred people.',false]
  ] as const){
    const a=drawing();a.layers[0]!.text=caption;
    assert.equal(validateMotionArtwork(a,script,6).artwork!.layers.some(l=>l.id==='label'),allowed,caption);
  }
  const a=drawing();a.motionCoordinates='relative';
  a.layers.unshift({id:'travel',kind:'group',x:0,y:0,w:1000,h:600,keyframes:[{t:0,x:0},{t:.5,x:400},{t:1,x:400}]});
  a.layers[2]!.parentId='travel';
  assert.equal(validateMotionArtwork(a,'water',6).artwork!.layers[0]!.keyframes![1]!.x,400);
});

test('a received photo argument remains exportable after an ungrounded optional caption is omitted',()=>{
  const a=drawing();a.canvas={width:1000,height:562};
  a.layers=[{id:'source',kind:'media',x:0,y:0,w:1000,h:562},
    {id:'rule',kind:'path',x:30,y:100,w:300,h:2,path:'M0 1 L300 1'},
    {id:'label',kind:'text',text:'2003',x:30,y:30,w:250,h:50},
    {id:'extra',kind:'text',text:'invented',x:30,y:150,w:250,h:50}];
  const accepted=validateMotionArtwork(a,'In 2003.',6);assert.ok(accepted.artwork);
  assert.equal(accepted.artwork.layers.filter(layer=>layer.kind!=='rect').length,3);
  assert.ok(!accepted.artwork.layers.some(layer=>layer.id==='extra'));
  assert.ok(validateMotionArtwork(accepted.artwork,'In 2003.',6).artwork);
});

test('an editorial standalone decision prevents pseudo-measurements on contextual footage',()=>{
  const a=drawing();a.layers.unshift({id:'photo',kind:'media',x:0,y:0,w:1000,h:600});
  assert.ok(validateMotionArtwork(a,'water',6,true).artwork,'legacy photographic plans remain supported');
  assert.match(validateMotionArtwork(a,'water',6,true,16/9,{mediaAllowed:false}).issue!,/standalone explanation/);
  assert.ok(validateMotionArtwork(drawing(),'water',6,true,16/9,{mediaAllowed:false}).artwork);
});

test('fully received artwork with a stray numeric quote recovers locally; truncation does not',()=>{
  const raw=JSON.stringify({scenes:[{sceneId:'rain',artwork:drawing()}]}).replace('"fontSize":52','"fontSize":52"');
  assert.equal((receivedMotionArtwork(raw)?.scenes as Array<{sceneId:string}>)[0]!.sceneId,'rain');
  assert.equal(receivedMotionArtwork(raw.slice(0,-3)),undefined);
});

test('multipart object transforms and camera survive storage without flattening children',()=>{
  const a=drawing();a.motionCoordinates='absolute';
  a.layers.unshift({id:'object',kind:'group',x:80,y:100,w:650,h:430,shadow:true,
    keyframes:[{t:0,x:80,y:100},{t:1,x:160,y:100,ease:'out'}]});
  for(const l of a.layers.slice(2)){l.parentId='object';l.shading='soft';}
  a.camera={keyframes:[{t:0,x:500,y:300,scale:1},{t:1,x:520,y:300,scale:1.12}]};
  const accepted=validateMotionArtwork(a,fixture().scenes[0]!.narration,6).artwork!;
  assert.equal(accepted.layers[2]!.parentId,'object');
  assert.equal(accepted.layers[2]!.x,100,'child box remains in canvas space, not shifted by the parent');
  assert.deepEqual(accepted.layers[0]!.keyframes,[{t:0,x:0,y:0},{t:.76,x:80,y:0,ease:'out'},{t:1,x:80,y:0,ease:'out'}]);
  assert.equal(accepted.layers[0]!.shadow,true);assert.equal(accepted.layers[2]!.shading,'soft');
  assert.deepEqual(accepted.camera!.keyframes.at(-1),a.camera.keyframes.at(-1));
  assert.equal(accepted.camera!.keyframes.at(-2)!.t,.76);
  const before=structuredClone(accepted),canonical=artworkForRevision(accepted);
  assert.equal(canonical.motionCoordinates,'absolute');
  assert.deepEqual(canonical.layers[0]!.keyframes![1],{t:.76,x:160,y:100,ease:'out'});
  assert.deepEqual(canonical.camera,accepted.camera,'camera view centres are already absolute');
  assert.deepEqual(validateMotionArtwork(canonical,fixture().scenes[0]!.narration,6).artwork,accepted,
    'group, layer, and camera motion survive the model-boundary round trip');
  assert.deepEqual(accepted,before,'the cached relative drawing remains unchanged');
  a.layers[0]!.parentId='object';
  assert.match(validateMotionArtwork(a,'water',6).issue!,/cyclic object group/);
});
test('late captions finish before the final reading hold without changing their values',()=>{
  const keys=[{t:0,opacity:0},{t:.83,opacity:0},{t:.9,opacity:1},{t:1,opacity:1}];
  const settled=settleArtworkKeys(keys)!;
  assert.equal(settled.find(key=>key.opacity===1)!.t,.76);
  assert.deepEqual(settled.at(-1),{t:1,opacity:1});
  assert.deepEqual(settleArtworkKeys(settled),settled,'normalization remains idempotent');
});

test('real footage can anchor one large composition without remote sources or tiny tiles',()=>{
  const a=drawing();a.layers.unshift({id:'footage',kind:'media',x:70,y:60,w:860,h:484,
    keyframes:[{t:0,scale:.1},{t:1,scale:1}]});
  const accepted=validateMotionArtwork(a,'water',6,true).artwork!;
  assert.equal(accepted.layers[0]!.kind,'media');
  assert.equal(accepted.layers[0]!.keyframes![0]!.scale,.95);
  assert.match(validateMotionArtwork(a,'water',6,false).issue!,/one large root/);
  a.layers[0]!.w=100;
  assert.match(validateMotionArtwork(a,'water',6).issue!,/one large root/);
  Object.assign(a.layers[0]!,{x:0,y:0,w:350,h:600});
  const repaired=validateMotionArtwork(a,'water',6,true,16/9).artwork!;
  assert.ok(repaired.layers[0]!.w>350,'expand an empty narrow frame instead of discarding the received composition');
  assert.ok(a.layers.every(layer=>repaired.layers.some(kept=>kept.id===layer.id)));
  a.canvas={width:600,height:1000};a.layers=a.layers.filter(l=>l.id!=='cloud');Object.assign(a.layers[0]!,{x:40,y:50,w:520,h:900});
  assert.ok(validateMotionArtwork(a,'water',6,true,9/16).artwork,'large portrait composition uses output aspect');
});
test('selected-source catalog and media fields preserve provenance without model-authored assets',()=>{
  const project=fixture(),current=project.scenes[0]!;
  const cutaway=structuredClone(current);cutaway.id='cutaway';cutaway.order=1;
  cutaway.imagePath='cutaway.jpg';cutaway.documentary!.selected={...cutaway.documentary!.selected!,id:'cutaway',kind:'image',width:1200,height:800};
  cutaway.documentary!.verified=true;cutaway.documentary!.checksum='cutaway';
  current.documentary!.requirement.identities=[{name:'water',aliases:[]}];
  cutaway.documentary!.requirement.identities=[{name:'water',aliases:[]}];
  project.scenes.push(cutaway);
  current.documentary!.semanticMontage!.artworkBrief={view:'comparison',subjectQuote:'water',
    phaseQuotes:['Warm water evaporates','vapour condenses into clouds']};
  current.documentary!.semanticMontage!.cutawaySceneIds=['cutaway'];
  const catalog=artworkSourceCandidates(project,current.id);
  assert.deepEqual(catalog.map(item=>item.sceneId),['rain','cutaway']);
  assert.deepEqual(catalog[1]!.variants.map(item=>item.status),['actual','on-request']);
  const source={currentSceneId:current.id,allowedSources:catalog,width:1920,height:1080};
  const a=drawing();
  a.layers.unshift({id:'source',kind:'media',x:50,y:60,w:650,h:440,sourceSceneId:'rain',
    sourceVariant:'original',sourceWindow:{x:.1,y:.2,w:.65,h:.55},clip:'ellipse'},
    {id:'detail',kind:'media',x:720,y:120,w:220,h:280,sourceSceneId:'cutaway',sourceVariant:'foreground'});
  const accepted=validateMotionArtwork(a,current.narration,6,true,16/9,source).artwork!;
  assert.equal(accepted.layers[0]!.sourceSceneId,'rain');
  assert.deepEqual(accepted.layers[0]!.sourceWindow,{x:.1,y:.2,w:.65,h:.55});
  assert.equal(accepted.layers[0]!.clip,'ellipse');
  assert.equal(accepted.layers[1]!.sourceVariant,'foreground');
  a.layers[1]!.sourceSceneId='outside';
  assert.match(validateMotionArtwork(a,current.narration,6,true,16/9,source).issue!,/allowlist/);
  a.layers[1]!.sourceSceneId='cutaway';a.layers[1]!.sourceWindow={x:0,y:0,w:.5,h:.5};
  assert.match(validateMotionArtwork(a,current.narration,6,true,16/9,source).issue!,/original still/);
  delete a.layers[1]!.sourceWindow;
  Object.assign(a.layers[1]!,{path:'C:/untrusted.png'});
  assert.match(validateMotionArtwork(a,current.narration,6,true,16/9,source).issue!,/not model-authored/);
  cutaway.documentary!.verified=false;
  assert.deepEqual(artworkSourceCandidates(project,current.id).map(item=>item.sceneId),['rain']);
});
test('video source cannot become a tracked cutout or a second viewport',()=>{
  const a=drawing();a.layers.unshift({id:'source',kind:'media',x:50,y:50,w:900,h:500,sourceSceneId:'rain',sourceVariant:'foreground'});
  const source={currentSceneId:'rain',allowedSources:[{sceneId:'rain',kind:'video' as const,width:1920,height:1080}]};
  assert.match(validateMotionArtwork(a,'water',6,true,16/9,source).issue!,/video media/);
  a.layers[0]!.sourceVariant='original';a.layers[0]!.sourceWindow={x:0,y:0,w:.5,h:.5};
  assert.match(validateMotionArtwork(a,'water',6,true,16/9,source).issue!,/video media/);
  delete a.layers[0]!.sourceWindow;
  a.layers.unshift({...a.layers[0]!,id:'duplicate'});
  assert.match(validateMotionArtwork(a,'water',6,true,16/9,source).issue!,/video media/);
});
test('editorial selected original remains available without claiming a verified foreground',()=>{
  const p=fixture(),scene=p.scenes[0]!;
  scene.documentary!.verified=false;
  Object.assign(scene.documentary!.selected!,{provider:'pexels',localPath:scene.imagePath});
  scene.documentary!.manualReview={version:1,status:'pending',provider:'pexels',candidateId:'rain',kind:'image',
    checksum:'rain',narration:scene.narration,mediaPath:scene.imagePath,reason:'Editorial preview pending'} as never;
  const catalog=artworkSourceCandidates(p,scene.id);
  assert.equal(catalog.length,1);
  assert.equal(catalog[0]!.identityStatus,'editorial');
  assert.deepEqual(catalog[0]!.variants.map(row=>row.name),['original']);
  const a=drawing();a.layers.unshift({id:'source',kind:'media',x:70,y:60,w:860,h:484,sourceVariant:'foreground'});
  const source={currentSceneId:scene.id,allowedSources:catalog};
  assert.match(validateMotionArtwork(a,scene.narration,6,true,16/9,source).issue!,/verified selected still/);
  a.layers[0]!.sourceVariant='original';
  assert.ok(validateMotionArtwork(a,scene.narration,6,true,16/9,source).artwork);
});

test('portrait artwork uses actual source aspect and preserves received graphics',()=>{
  const a=drawing();a.canvas.height=562;a.layers.unshift({id:'footage',kind:'media',x:100,y:0,w:800,h:562});
  const before=structuredClone(a),source={width:1536,height:2048};
  const accepted=validateMotionArtwork(a,'water',6,true,16/9,source).artwork!;
  assert.ok(accepted);assert.ok(a.layers.every(layer=>accepted.layers.some(kept=>kept.id===layer.id)));
  assert.deepEqual(accepted.layers[0]!.w,800,'full-height portrait does not need a wider empty frame');
  assert.equal(accepted.layers[0]!.h,562);
  assert.deepEqual(a,before,'normalizing source framing never mutates the paid receipt');
  assert.deepEqual(validateMotionArtwork(accepted,'water',6,true,16/9,source).artwork,accepted,'saved geometry remains stable');
});
test('paid artwork receipts are reused, including a valid empty design decision',async()=>{
  const root=await mkdtemp(join(tmpdir(),'artwork-cache-'));let calls=0;const p=fixture();
  try{
    const complete=async(_system:string,_input:string,onPaidSubmission?: (key:string)=>Promise<void>)=>{
      await onPaidSubmission?.('a'.repeat(64));calls++;return {scenes:[{sceneId:'rain',artwork:drawing()}]};};
    const first=await createMotionArtworkPlan(p,root,complete,'cheap');
    const second=await createMotionArtworkPlan(p,root,complete,'cheap');
    assert.equal(calls,1);assert.deepEqual(second,first);assert.equal(first.scenes.length,1);
    assert.match(first.incomplete!,/предпросмотр визуальной доработки не подключён/iu,'a missing revision preview remains visible');
  }finally{await rm(root,{recursive:true,force:true});}
});
test('cached keyframe rejection repairs from saved receipt without another commission',async()=>{
  const root=await mkdtemp(join(tmpdir(),'artwork-keyframe-repair-')),p=fixture(),hash=motionArtworkHash(p);
  const directory=join(root,'Documentary','Montage');let calls=0;
  try{
    await mkdir(directory,{recursive:true});
    const cached={version:1,validationVersion:13,inputHash:hash,model:'working-model',scenes:[],
      rejected:[{sceneId:'rain',reason:'invalid motion keyframes'}]};
    const cachePath=join(directory,`${hash}-artwork-v1.json`);
    await writeFile(cachePath,JSON.stringify(cached));
    const complete=async()=>{calls++;throw Error('A saved response must never trigger another commission');};
    assert.deepEqual(await repairSavedMotionArtworkPlan(p,root),cached,
      'missing raw receipt leaves the old result intact');
    const artwork=drawing();artwork.layers[2]!.keyframes=[{t:0,draw:0},{t:.4,draw:1},{t:.4,opacity:1},{t:1,draw:1}];
    const raw=JSON.stringify({scenes:[{sceneId:'rain',artwork}]});
    await writeFile(join(directory,`${hash}-artwork-0.json`),raw);
    const repaired=(await repairSavedMotionArtworkPlan(p,root))!;
    assert.equal(calls,0);assert.equal(repaired.scenes.length,1);assert.deepEqual(repaired.rejected,[]);
    assert.equal(repaired.keyframeCoalesceVersion,1);
    const frames=repaired.scenes[0]!.artwork.layers[2]!.keyframes!;
    assert.equal(frames.filter(frame=>frame.draw===1&&frame.opacity===1).length,1,
      'simultaneous properties survive timing normalization in one frame');
    assert.equal(new Set(frames.map(frame=>frame.t)).size,frames.length);
    assert.equal(await readFile(join(directory,`${hash}-artwork-0.json`),'utf8'),raw,
      'repair does not alter the paid response');
    assert.equal(await repairSavedMotionArtworkPlan(p,root),undefined,'one-time repair marker prevents repeated work');
    assert.deepEqual(await createMotionArtworkPlan(p,root,complete,'working-model'),repaired);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('one fresh batch gets one visual revision and later prepares reuse both receipts',async()=>{
  const root=await mkdtemp(join(tmpdir(),'artwork-revision-')),p=fixture();
  p.scenes=Array.from({length:2},(_,i)=>{const scene=structuredClone(p.scenes[0]!);scene.id=`rain-${i}`;scene.order=i;
    scene.documentary!.semanticMontage!.sceneId=scene.id;return scene;});
  p.videoBrief={prompt:'Show the complete water cycle without inventing hidden reservoirs.',competitorTranscripts:[]};
  let drafts=0,previews=0,revisions=0;
  try{
    const revised=drawing();revised.motionCoordinates='absolute';revised.layers[1]!.w=310;
    const plan=await createMotionArtworkPlan(p,root,async(_system,_input,onPaidSubmission)=>{
      await onPaidSubmission?.('a'.repeat(64));drafts++;return {scenes:p.scenes.map(scene=>({sceneId:scene.id,artwork:drawing()}))};},
      'working-model',undefined,{revision:{
        preview:async rows=>{previews++;assert.deepEqual(rows.map(row=>row.sceneId),['rain-0','rain-1']);
          assert.ok(rows.every(row=>row.artwork.layers[1]!.w===(previews===1?230:310)),'post-editor preview must render the changed drawings');
          return rows.map(row=>({sceneId:row.sceneId,frames:[.1,.5,.9].map(t=>({t,image:'data:image/png;base64,AA=='}))}));},
        complete:async(system,input,images)=>{revisions++;const request=JSON.parse(input);
          assert.match(system,/LAYER CONTRACT/);
          assert.equal(request.motionArtworkRevision,1);assert.equal(request.scenes.length,2);assert.equal(images.length,6);
          assert.deepEqual(request.scenes[0].narration,[p.scenes[0]!.narration]);
          assert.equal(request.storyContext.brief,p.videoBrief!.prompt);
          assert.deepEqual(request.storyContext.batch.map((row:{sceneId:string})=>row.sceneId),['rain-0','rain-1']);
          return {scenes:p.scenes.map(scene=>({sceneId:scene.id,artwork:revised}))};}
      }});
    assert.deepEqual([drafts,previews,revisions],[1,2,1]);
    assert.equal(plan.scenes.length,2);assert.ok(plan.scenes.every(row=>row.artwork.layers[1]!.w===310));
    assert.equal(plan.incomplete,undefined);
    const hash=motionArtworkHash(p),montage=join(root,'Documentary','Montage');
    const revisionPath=join(montage,`${hash}-artwork-revision-v2-0.json`);
    const revisionRaw=JSON.parse(await readFile(revisionPath,'utf8'));
    assert.equal((revisionRaw.scenes as unknown[]).length,2);
    const renderCheck=JSON.parse(await readFile(join(montage,`${hash}-artwork-revision-v2-0.render-check.json`),'utf8'));
    assert.equal(renderCheck.status,'rendered');assert.equal(renderCheck.scope,'technical-three-phase-render');
    assert.equal(renderCheck.scenes.length,2);assert.equal(renderCheck.scenes[0].frames.length,3);
    await createMotionArtworkPlan(p,root,async()=>{throw Error('old draft replayed');},'working-model',undefined,
      {revision:{preview:async()=>{throw Error('old preview rerendered');},complete:async()=>{throw Error('old revision replayed');}}});
    await rm(join(montage,`${hash}-artwork-v1.json`));
    const recovered=await createMotionArtworkPlan(p,root,async()=>{throw Error('old draft replayed');},'working-model');
    assert.deepEqual(recovered.scenes,plan.scenes,'saved revision raw recovers locally after an interrupted plan write');
    await rm(join(montage,`${hash}-artwork-v1.json`));await rm(revisionPath);
    const attempt=JSON.parse(await readFile(join(montage,`${hash}-artwork-revision-v2-0.attempt.json`),'utf8'));
    const analysis=join(root,'Documentary','Analysis');await mkdir(analysis,{recursive:true});
    await writeFile(join(analysis,`${attempt.analysisKey}.json`),JSON.stringify({state:'complete',result:revisionRaw}));
    const fromCheckpoint=await createMotionArtworkPlan(p,root,async()=>{throw Error('old draft replayed');},'working-model');
    assert.deepEqual(fromCheckpoint.scenes,plan.scenes,'completed Analysis receipt recovers without a new request');
  }finally{await rm(root,{recursive:true,force:true});}
});

test('fresh Intelligence uses montage, artwork and one editor; failed replacement render stays local on resume',async t=>{
  const root=await mkdtemp(join(tmpdir(),'artwork-three-calls-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const p=fixture(),submitted:string[]=[];let renders=0;
  const changed=drawing();changed.motionCoordinates='absolute';changed.layers[1]!.w=310;
  const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(_system,input)=>{
    const payload=JSON.parse(input);
    const stage=payload.motionArtworkRevision?'editor':payload.motionArtwork?'artwork':payload.motionConcepts?'concept':'montage';
    submitted.push(stage);
    if(stage==='montage')return JSON.stringify({scenes:payload.scenes.map((row:{sceneId:string})=>({sceneId:row.sceneId,subject:'water',beat:'explain',treatment:'footage',cutawaySceneIds:[],
      artworkBrief:{view:'system',subjectQuote:'water',phaseQuotes:['Warm water evaporates','vapour condenses into clouds']}}))});
    assert.notEqual(stage,'concept');
    if(stage==='artwork')assert.equal(payload.scenes[0].artworkBrief.view,'system');
    return JSON.stringify({scenes:[{sceneId:'rain',artwork:stage==='editor'?changed:drawing()}]});
  }},()=>root);
  const semantic=await intelligence.planSemanticMontage(p);
  p.scenes[0]!.documentary!.semanticMontage=semantic.scenes[0];
  const preview=async(rows:Array<{sceneId:string;artwork:DocumentaryArtwork}>)=>{
    renders++;if(rows.some(row=>row.artwork.layers[1]!.w===310))throw Error('replacement render failed');
    return rows.map(row=>({sceneId:row.sceneId,frames:[.04,.48,.88].map(t=>({t,image:'data:image/jpeg;base64,AA=='}))}));
  };
  const first=await intelligence.planMotionArtwork(p,undefined,{revisionPreview:preview});
  assert.deepEqual(submitted,['montage','artwork','editor']);assert.equal(renders,2);
  assert.equal(first.scenes[0]!.artwork.layers[1]!.w,230,'failed changed render keeps the original');
  assert.match(first.incomplete!,/техническая проверка новых кадров/);
  const directory=join(root,'Documentary','Montage'),hash=motionArtworkHash(p),rawPath=join(directory,`${hash}-artwork-revision-v2-0.json`);
  const raw=await readFile(rawPath,'utf8');assert.equal(JSON.parse(raw).scenes[0].artwork.layers[1].w,310,'paid replacement is retained for repair');
  await intelligence.planSemanticMontage(p);
  const resumed=await intelligence.planMotionArtwork(p);
  assert.equal(resumed.scenes[0]!.artwork.layers[1]!.w,230,'offline restore cannot promote the failed replacement');
  assert.deepEqual(submitted,['montage','artwork','editor']);assert.equal(renders,2);assert.equal(await readFile(rawPath,'utf8'),raw);
  await rm(join(directory,`${hash}-artwork-revision-v2-0.render-check.json`));
  const interrupted=await intelligence.planMotionArtwork(p);
  assert.equal(interrupted.scenes[0]!.artwork.layers[1]!.w,230,'missing post-render evidence on a new attempt cannot be treated as legacy approval');
  assert.match(interrupted.incomplete!,/ещё не завершена/);
  const recovered=await intelligence.planMotionArtwork(p,undefined,{revisionPreview:async rows=>{
    renders++;assert.ok(rows.every(row=>row.artwork.layers[1]!.w===310));
    return rows.map(row=>({sceneId:row.sceneId,frames:[.04,.48,.88].map(t=>({t,image:'data:image/jpeg;base64,AA=='}))}));
  }});
  assert.equal(recovered.scenes[0]!.artwork.layers[1]!.w,310);assert.equal(recovered.incomplete,undefined);
  assert.equal(renders,3);assert.deepEqual(submitted,['montage','artwork','editor'],'finishing the interrupted local check costs zero API requests');
  assert.equal(await readFile(rawPath,'utf8'),raw);
});
test('old paid artwork raw does not start an unrecorded visual revision',async()=>{
  const root=await mkdtemp(join(tmpdir(),'artwork-old-no-revision-')),p=fixture(),hash=motionArtworkHash(p);
  const montage=join(root,'Documentary','Montage');let previews=0,revisions=0;
  try{
    await mkdir(montage,{recursive:true});
    await writeFile(join(montage,`${hash}-artwork-0.json`),JSON.stringify({scenes:[{sceneId:'rain',artwork:drawing()}]}));
    const plan=await createMotionArtworkPlan(p,root,async()=>{throw Error('old commission replayed');},'working-model',undefined,
      {revision:{preview:async()=>{previews++;return [];},complete:async()=>{revisions++;return {scenes:[]};}}});
    assert.equal(plan.scenes.length,1);assert.deepEqual([previews,revisions],[0,0]);
    assert.equal(plan.incomplete,undefined);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('explicit saved-artwork revision uses v2 receipts once and never replays an uncertain attempt',async()=>{
  const root=await mkdtemp(join(tmpdir(),'artwork-explicit-revision-')),p=fixture(),hash=motionArtworkHash(p);
  const montage=join(root,'Documentary','Montage');let drafts=0,previews=0,revisions=0;
  try{
    await mkdir(montage,{recursive:true});
    const raw=JSON.stringify({scenes:[{sceneId:'rain',artwork:drawing()}]});
    await writeFile(join(montage,`${hash}-artwork-0.json`),raw);
    const complete=async()=>{drafts++;throw Error('draft commission forbidden');};
    const initial=await createMotionArtworkPlan(p,root,complete,'working-model');
    assert.equal(initial.scenes.length,1);assert.equal(initial.incomplete,undefined);
    const revised=drawing();revised.motionCoordinates='absolute';revised.layers[1]!.w=310;
    const hooks={preview:async(rows:Array<{sceneId:string}>)=>{previews++;
      return rows.map(row=>({sceneId:row.sceneId,frames:[.1,.5,.9].map(t=>({t,image:'data:image/png;base64,AA=='}))}));},
      complete:async(_system:string,input:string)=>{revisions++;
        const request=JSON.parse(input);assert.equal(request.scenes[0].artwork.motionCoordinates,'absolute');
        return {scenes:[{sceneId:'rain',artwork:revised}]};}};
    const upgraded=await createMotionArtworkPlan(p,root,complete,'working-model',undefined,
      {reviseSavedArtwork:true,revision:hooks});
    assert.deepEqual([drafts,previews,revisions],[0,2,1]);
    assert.equal(upgraded.scenes[0]!.artwork.layers[1]!.w,310);
    assert.equal(await readFile(join(montage,`${hash}-artwork-0.json`),'utf8'),raw);
    await assert.rejects(readFile(join(montage,`${hash}-artwork-revision-0.json`),'utf8'),{code:'ENOENT'});
    await createMotionArtworkPlan(p,root,complete,'working-model',undefined,{reviseSavedArtwork:true,revision:hooks});
    assert.deepEqual([drafts,previews,revisions],[0,2,1],'saved v2 answer and local render evidence are reused');
    await rm(join(montage,`${hash}-artwork-revision-v2-0.json`));
    const uncertain=await createMotionArtworkPlan(p,root,complete,'working-model',undefined,
      {reviseSavedArtwork:true,revision:hooks});
    assert.deepEqual([drafts,previews,revisions],[0,2,1]);
    assert.equal(uncertain.scenes[0]!.artwork.layers[1]!.w,230);
    assert.match(uncertain.incomplete!,/повторный запрос отключён/);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('a bound local preview failure resumes explicitly once, without laundering invalid failures or existing attempts',async t=>{
  const root=await mkdtemp(join(tmpdir(),'artwork-local-editor-resume-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const p=fixture(),hash=motionArtworkHash(p),montage=join(root,'Documentary','Montage'),prefix=`${hash}-artwork-revision-v2-0`;
  const failedPath=join(montage,prefix+'.failed.json'),attemptPath=join(montage,prefix+'.attempt.json');
  let drafts=0,previews=0,editors=0;
  const first=await createMotionArtworkPlan(p,root,async(_system,_input,onPaidSubmission)=>{
    drafts++;await onPaidSubmission?.('a'.repeat(64));return {scenes:[{sceneId:'rain',artwork:drawing()}]};
  },'fixture',undefined,{revision:{preview:async()=>{previews++;throw Error('Local preview adapter unavailable');},
    complete:async()=>{editors++;throw Error('editor must not start');}}});
  assert.deepEqual([drafts,previews,editors],[1,1,0]);assert.ok(first.incomplete);
  const failure=await readFile(failedPath,'utf8'),primary=await readFile(join(montage,`${hash}-artwork-0.json`),'utf8');
  await assert.rejects(readFile(attemptPath,'utf8'),{code:'ENOENT'});
  const deniedPrimary=async()=>{drafts++;throw Error('primary replay forbidden');};
  const revision={preview:async(rows:Array<{sceneId:string}>)=>{previews++;return rows.map(row=>({sceneId:row.sceneId,
    frames:[.04,.48,.88].map(t=>({t,image:'data:image/jpeg;base64,AA=='}))}));},
    complete:async()=>{editors++;const attempt=JSON.parse(await readFile(attemptPath,'utf8'));
      assert.equal(attempt.inputHash,hash);assert.equal(attempt.from,0,'attempt must exist before the only editor call');
      return {scenes:[{sceneId:'rain',artwork:{...drawing(),motionCoordinates:'absolute'}}]};}};
  await createMotionArtworkPlan(p,root,deniedPrimary,'fixture',undefined,{revision});
  assert.deepEqual([drafts,previews,editors],[1,1,0],'ordinary prepare cannot retry even a local preview');
  assert.equal(await readFile(failedPath,'utf8'),failure);
  const repaired=await createMotionArtworkPlan(p,root,deniedPrimary,'fixture',undefined,{reviseSavedArtwork:true,revision});
  assert.equal(repaired.incomplete,undefined);assert.deepEqual([drafts,previews,editors],[1,3,1]);
  await createMotionArtworkPlan(p,root,deniedPrimary,'fixture',undefined,{reviseSavedArtwork:true,revision});
  assert.deepEqual([drafts,previews,editors],[1,3,1]);assert.equal(await readFile(failedPath,'utf8'),failure);
  assert.equal(await readFile(join(montage,`${hash}-artwork-0.json`),'utf8'),primary);
  for(const mode of ['invalid-binding','legacy-failure','null-failure','null-attempt'] as const){
    const isolated=join(root,mode),directory=join(isolated,'Documentary','Montage');await mkdir(directory,{recursive:true});
    await writeFile(join(directory,`${hash}-artwork-v1.json`),JSON.stringify(first));
    await writeFile(join(directory,`${hash}-artwork-0.json`),primary);
    const bad=mode==='invalid-binding'?JSON.stringify({...JSON.parse(failure),inputHash:'another-film'}):mode==='legacy-failure'?'{"message":"legacy local failure"}':mode==='null-failure'?'null':failure;
    await writeFile(join(directory,prefix+'.failed.json'),bad);
    if(mode==='null-attempt')await writeFile(join(directory,prefix+'.attempt.json'),'null');
    for(let i=0;i<2;i++)await createMotionArtworkPlan(p,isolated,deniedPrimary,'fixture',undefined,{reviseSavedArtwork:true,revision});
    assert.deepEqual([drafts,previews,editors],[1,3,1],mode);
    assert.equal(await readFile(join(directory,prefix+'.failed.json'),'utf8'),bad,'guard rejection must not manufacture valid failure metadata');
    if(mode==='null-attempt')assert.equal(await readFile(join(directory,prefix+'.attempt.json'),'utf8'),'null');
  }
});

test('explicit repair of a partial plan sends both weak saved drafts to one editor, never missing primary batches',async t=>{
  for(const unknown of [false,true]){
    const root=await mkdtemp(join(tmpdir(),'artwork-partial-repair-'));t.after(()=>rm(root,{recursive:true,force:true}));
    const p=fixture();p.scenes=Array.from({length:9},(_,i)=>{const scene=structuredClone(p.scenes[0]!);
      scene.id=`rain-${i}`;scene.order=i;scene.documentary!.semanticMontage!.sceneId=scene.id;return scene;});
    const hash=motionArtworkHash(p),montage=join(root,'Documentary','Montage');
    const first=await createMotionArtworkPlan(p,root,async(_system,input)=>{
      if(JSON.parse(input).scenes[0].sceneId==='rain-8')throw new DocumentaryAnalysisError('[local-acceptance-budget] No request sent: persistent submission allowance exhausted','pending','semantic-montage');
      return {scenes:[0,1].map(i=>({sceneId:`rain-${i}`,artwork:drawing()}))};
    },'fixture');
    assert.ok(first.incomplete);
    // Simulate drafts accepted by the predecessor guard. These are test-only
    // fixtures; real paid answers must never be edited in place.
    const weak=drawing();weak.canvas={width:1000,height:562};weak.layers=[{id:'source',kind:'media',x:0,y:0,w:1000,h:562},
      {id:'label',kind:'text',x:70,y:60,w:300,h:60,text:'water'},
      {id:'rule',kind:'path',x:70,y:125,w:300,h:2,path:'M0 1 L300 1'}];
    first.scenes=first.scenes.map(row=>({...row,artwork:weak}));
    const raw=JSON.stringify({scenes:first.scenes});
    await writeFile(join(montage,`${hash}-artwork-0.json`),raw);
    await writeFile(join(montage,`${hash}-artwork-v1.json`),JSON.stringify(first));
    const missingFailure=await readFile(join(montage,`${hash}-artwork-8.failed.json`),'utf8');
    const attemptPath=join(montage,`${hash}-artwork-revision-v2-0.attempt.json`);
    const failurePath=join(montage,`${hash}-artwork-revision-v2-0.failed.json`);
    const analysis=join(root,'Documentary','Analysis'),analysisKey='a'.repeat(64);
    const oldAttempt=JSON.stringify({version:1,inputHash:hash,from:0,inputSha256:'b'.repeat(64),analysisKey});
    if(unknown){await mkdir(analysis,{recursive:true});await writeFile(attemptPath,oldAttempt);
      await writeFile(failurePath,'{"message":"ECONNRESET"}');
      await writeFile(join(analysis,analysisKey+'.json'),'{"state":"partial","raw":"paid partial"}');}
    let primary=0,editor=0,previews=0;
    const repaired=await createMotionArtworkPlan(p,root,async()=>{primary++;throw Error('primary forbidden');},'fixture',undefined,
      {reviseSavedArtwork:true,revision:{preview:async rows=>{previews++;assert.equal(rows.length,2);
        return rows.map(row=>({sceneId:row.sceneId,frames:[.04,.48,.88].map(t=>({t,image:'data:image/png;base64,AA=='}))}));},
        complete:async(_system,input)=>{editor++;const request=JSON.parse(input);assert.equal(request.scenes.length,2);
          assert.ok(request.scenes.every((row:{stagingReview?:string})=>row.stagingReview));
          return {scenes:[0,1].map(i=>({sceneId:`rain-${i}`,artwork:{...drawing(),motionCoordinates:'absolute'}}))};}}});
    assert.equal(primary,0);assert.equal(editor,unknown?0:1);assert.equal(previews,unknown?0:2);assert.equal(repaired.scenes.length,2);
    assert.equal(await readFile(join(montage,`${hash}-artwork-0.json`),'utf8'),raw);
    assert.equal(await readFile(join(montage,`${hash}-artwork-8.failed.json`),'utf8'),missingFailure);
    if(unknown){assert.equal(await readFile(attemptPath,'utf8'),oldAttempt);
      assert.equal(await readFile(join(analysis,analysisKey+'.json'),'utf8'),'{"state":"partial","raw":"paid partial"}');
      assert.match(repaired.incomplete!,/повторный запрос отключён/);}
  }
});
test('saved-only editing never becomes a new primary commission when its plan is absent',async t=>{
  const root=await mkdtemp(join(tmpdir(),'artwork-missing-repair-'));t.after(()=>rm(root,{recursive:true,force:true}));
  let primary=0;
  await assert.rejects(createMotionArtworkPlan(fixture(),root,async()=>{primary++;return {scenes:[]};},'fixture',undefined,
    {reviseSavedArtwork:true}),/Первичные генерации не отправлялись/);
  assert.equal(primary,0);
});
test('normal repair adopts a completed first v2 receipt after interruption without paid replay',async()=>{
  const root=await mkdtemp(join(tmpdir(),'artwork-v2-interrupted-')),p=fixture();
  p.scenes=Array.from({length:9},(_,i)=>{const scene=structuredClone(p.scenes[0]!);scene.id=`rain-${i}`;scene.order=i;
    scene.documentary!.semanticMontage!.sceneId=scene.id;return scene;});
  const hash=motionArtworkHash(p),montage=join(root,'Documentary','Montage');let paid=0;
  const noPaid=async()=>{paid++;throw Error('local recovery must never submit a model request');};
  try{
    await mkdir(montage,{recursive:true});
    const firstRaw=JSON.stringify({scenes:[{sceneId:'rain-0',artworkSpan:{endSceneId:'rain-1'},artwork:drawing()}]});
    const secondRaw=JSON.stringify({scenes:[{sceneId:'rain-8',artwork:drawing()}]});
    await writeFile(join(montage,`${hash}-artwork-0.json`),firstRaw);
    await writeFile(join(montage,`${hash}-artwork-8.json`),secondRaw);
    const initial=await createMotionArtworkPlan(p,root,noPaid,'working-model');
    assert.equal(initial.scenes[0]!.artwork.layers[1]!.w,230);
    const revised=drawing();revised.motionCoordinates='absolute';revised.layers[1]!.w=310;
    const attempt=(from:number)=>({version:1,inputHash:hash,from,inputSha256:'a'.repeat(64),
      previewCount:3,analysisKey:(from===8?'c':'b').repeat(64)});
    const firstAttempt=join(montage,`${hash}-artwork-revision-v2-0.attempt.json`);
    await writeFile(firstAttempt,JSON.stringify({...attempt(0),inputHash:'f'.repeat(64)}));
    await writeFile(join(montage,`${hash}-artwork-revision-v2-0.json`),JSON.stringify({scenes:[
      {sceneId:'rain-0',artworkSpan:{endSceneId:'rain-1'},artwork:revised}]}));
    await writeFile(join(montage,`${hash}-artwork-revision-v2-8.attempt.json`),JSON.stringify(attempt(8)));
    const analysis=join(root,'Documentary','Analysis');await mkdir(analysis,{recursive:true});
    await writeFile(join(analysis,`${'c'.repeat(64)}.json`),JSON.stringify({state:'received',
      raw:JSON.stringify({scenes:[{sceneId:'rain-8',artwork:revised}]})}));
    assert.equal(await repairSavedMotionArtworkPlan(p,root),undefined,'a receipt bound to another input hash is ignored');
    await writeFile(firstAttempt,JSON.stringify(attempt(0)));
    const restored=(await repairSavedMotionArtworkPlan(p,root))!;
    assert.equal(paid,0);assert.equal(restored.scenes[0]!.artwork.layers[1]!.w,310);
    assert.deepEqual(restored.scenes[0]!.artworkSpan,{endSceneId:'rain-1'});
    assert.equal(restored.scenes[1]!.artwork.layers[1]!.w,230,'unknown second attempt keeps its primary drawing');
    assert.match(restored.incomplete!,/порции 9 не завершена/);
    assert.equal(typeof restored.v2ReceiptHashes?.['0'],'string');
    assert.equal(await repairSavedMotionArtworkPlan(p,root),undefined,'applied receipt is not replayed on every prepare');
    await assert.rejects(readFile(join(montage,`${hash}-artwork-revision-v2-8.json`),'utf8'),{code:'ENOENT'});
    await assert.rejects(readFile(join(montage,`${hash}-artwork-revision-v2-8.failed.json`),'utf8'),{code:'ENOENT'});
    assert.equal(await readFile(join(montage,`${hash}-artwork-0.json`),'utf8'),firstRaw);
    assert.equal(await readFile(join(montage,`${hash}-artwork-8.json`),'utf8'),secondRaw);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('a completed Analysis receipt restored without Montage raw does not buy revision',async()=>{
  const root=await mkdtemp(join(tmpdir(),'artwork-analysis-recovered-')),p=fixture(),hash=motionArtworkHash(p);
  const analysis=join(root,'Documentary','Analysis'),checkpoint=join(analysis,'a'.repeat(64)+'.json');
  let revisions=0;
  try{
    await mkdir(analysis,{recursive:true});
    await writeFile(checkpoint,JSON.stringify({state:'complete',purpose:'semantic-montage',
      result:{scenes:[{sceneId:'rain',artwork:drawing()}]}}));
    const plan=await createMotionArtworkPlan(p,root,async(_system,_input,_onPaidSubmission)=>{
      const saved=JSON.parse(await readFile(checkpoint,'utf8'));
      assert.equal(saved.state,'complete');return saved.result;
    },'working-model',undefined,{revision:{preview:async()=>{throw Error('old paid preview');},
      complete:async()=>{revisions++;throw Error('old paid revision');}}});
    assert.equal(plan.scenes.length,1);assert.equal(plan.incomplete,undefined);assert.equal(revisions,0);
    await assert.rejects(readFile(join(root,'Documentary','Montage',`${hash}-artwork-0.revision-eligible.json`),'utf8'),
      {code:'ENOENT'});
  }finally{await rm(root,{recursive:true,force:true});}
});
test('visual revision sees the neighboring narration beyond its batch',async()=>{
  const root=await mkdtemp(join(tmpdir(),'artwork-revision-context-')),p=fixture();
  p.scenes=Array.from({length:9},(_,i)=>{const scene=structuredClone(p.scenes[0]!);scene.id=`rain-${i}`;scene.order=i;
    scene.documentary!.semanticMontage!.sceneId=scene.id;return scene;});
  p.scenes[8]!.narration='Water enters narrow pores rather than one giant cave.';
  try{
    let revisionCalls=0;
    const plan=await createMotionArtworkPlan(p,root,async(_system,input,onPaidSubmission)=>{
      await onPaidSubmission?.('a'.repeat(64));
      const first=JSON.parse(input).scenes[0].sceneId;
      return {scenes:first==='rain-0'?[{sceneId:'rain-7',artwork:drawing()}]:[]};
    },'working-model',undefined,{revision:{
      preview:async rows=>rows.map(row=>({sceneId:row.sceneId,frames:[.04,.48,.88].map(t=>({t,image:'data:image/jpeg;base64,AA=='}))})),
      complete:async(_system,input)=>{revisionCalls++;const request=JSON.parse(input);
        assert.deepEqual(request.storyContext.following,[{sceneId:'rain-8',narration:p.scenes[8]!.narration}]);
        assert.equal(request.storyContext.batch.length,8);
        const revised=drawing();revised.motionCoordinates='absolute';
        return {scenes:[{sceneId:'rain-7',artwork:revised}]};}
    }});
    assert.equal(revisionCalls,1);assert.equal(plan.scenes.length,1);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('one batch sends both selected-source and standalone drawings to the actual-frame editor',async()=>{
  const root=await mkdtemp(join(tmpdir(),'artwork-revision-mixed-')),p=fixture();
  p.scenes=Array.from({length:2},(_,i)=>{const scene=structuredClone(p.scenes[0]!);scene.id=`rain-${i}`;scene.order=i;
    scene.documentary!.semanticMontage!.sceneId=scene.id;return scene;});
  const photographic=drawing();photographic.layers.unshift({id:'footage',kind:'media',x:70,y:60,w:860,h:484});
  const photoRevision=structuredClone(photographic);photoRevision.motionCoordinates='absolute';photoRevision.layers[2]!.w=310;
  const revised=drawing();revised.motionCoordinates='absolute';revised.layers[1]!.w=310;let previews=0,revisions=0;
  try{
    const plan=await createMotionArtworkPlan(p,root,async(_system,_input,onPaidSubmission)=>{
      await onPaidSubmission?.('a'.repeat(64));return {scenes:[
      {sceneId:'rain-0',artwork:photographic},{sceneId:'rain-1',artwork:drawing()}]};},'working-model',undefined,{revision:{
      preview:async rows=>{previews++;assert.deepEqual(rows.map(row=>row.sceneId),['rain-0','rain-1']);
        return rows.map(row=>({sceneId:row.sceneId,frames:[.04,.48,.88].map(t=>({t,image:'data:image/jpeg;base64,AA=='}))}));},
      complete:async(_system,input,images)=>{revisions++;const request=JSON.parse(input);
        assert.deepEqual(request.scenes.map((row:{sceneId:string})=>row.sceneId),['rain-0','rain-1']);
        assert.equal(images.length,6);
        assert.ok(request.scenes[0].artwork.layers.some((layer:{kind:string})=>layer.kind==='media'));
        return {scenes:[{sceneId:'rain-0',artwork:photoRevision},{sceneId:'rain-1',artwork:revised}]};}
    }});
    assert.deepEqual([previews,revisions],[2,1]);assert.equal(plan.scenes.length,2);
    assert.ok(plan.scenes[0]!.artwork.layers.some(layer=>layer.kind==='media'));
    assert.equal(plan.scenes[0]!.artwork.layers.find(layer=>layer.id==='water')!.w,310,'selected-source composition is revised');
    assert.equal(plan.scenes[1]!.artwork.layers[1]!.w,310,'replacement uses the original result index');
    assert.equal(plan.incomplete,undefined);
    const photoOnly=fixture();
    const skipped=await createMotionArtworkPlan(photoOnly,root,async(_system,_input,onPaidSubmission)=>{
      await onPaidSubmission?.('a'.repeat(64));return {scenes:[{sceneId:'rain',artwork:photographic}]};},
      'working-model',undefined,{revision:{preview:async rows=>rows.map(row=>({sceneId:row.sceneId,
        frames:[.04,.48,.88].map(t=>({t,image:'data:image/jpeg;base64,AA=='}))})),
        complete:async()=>({scenes:[{sceneId:'rain',artwork:photoRevision}]})}});
    assert.equal(skipped.scenes.length,1);assert.equal(skipped.incomplete,undefined);
    assert.equal(skipped.scenes[0]!.artwork.layers.find(layer=>layer.id==='water')!.w,310);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('failed visual revision preserves the fresh drawing and visible partial status',async()=>{
  const root=await mkdtemp(join(tmpdir(),'artwork-revision-failed-')),p=fixture();let revisions=0;
  try{
    const plan=await createMotionArtworkPlan(p,root,async(_system,_input,onPaidSubmission)=>{
      await onPaidSubmission?.('a'.repeat(64));return {scenes:[{sceneId:'rain',artwork:drawing()}]};},
      'working-model',undefined,{revision:{
        preview:async rows=>rows.map(row=>({sceneId:row.sceneId,frames:[.1,.5,.9].map(t=>({t,image:'data:image/jpeg;base64,AA=='}))})),
        complete:async()=>{revisions++;throw new DocumentaryAnalysisError('unknown revision result','pending','semantic-montage');}
      }});
    assert.equal(revisions,1);assert.equal(plan.scenes.length,1);assert.match(plan.incomplete!,/unknown revision result/);
    const hash=motionArtworkHash(p);
    assert.match(await readFile(join(root,'Documentary','Montage',`${hash}-artwork-revision-v2-0.failed.json`),'utf8'),/unknown revision result/);
    await createMotionArtworkPlan(p,root,async()=>{throw Error('draft replayed');},'working-model');
    assert.equal(revisions,1);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('a received annotation-only design is rejected without replaying its paid response',async()=>{
  const root=await mkdtemp(join(tmpdir(),'artwork-annotation-')),p=fixture();let calls=0;
  try{
    const weak=drawing();weak.canvas={width:1000,height:562};
    weak.layers=[{id:'source',kind:'media',x:0,y:0,w:1000,h:562},
      {id:'label',kind:'text',text:'water',x:620,y:200,w:180,h:50},
      {id:'rule',kind:'path',x:0,y:0,w:1000,h:562,path:'M950 80 L600 380'}];
    const complete=async()=>{calls++;return {scenes:[{sceneId:'rain',artwork:weak}]};};
    await assert.rejects(createMotionArtworkPlan(p,root,complete,'working-model'),/single-source-annotation/);
    await assert.rejects(createMotionArtworkPlan(p,root,complete,'working-model'),/все композиции отклонены/);
    assert.equal(calls,1,'saved raw receipt is inspected locally on the second attempt');
    const report=JSON.parse(await readFile(join(root,'Documentary','Montage',`${motionArtworkHash(p)}-artwork-validation.json`),'utf8'));
    assert.deepEqual(report.rejected,[{sceneId:'rain',reason:'single-source-annotation'}]);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('standalone artwork supersedes only a complete editable automatic explanation',()=>{
  const project=fixture();project.scenes=Array.from({length:3},(_,i)=>{
    const scene=structuredClone(project.scenes[0]!);scene.id=`rain-${i}`;scene.order=i;
    scene.documentary!.semanticMontage!.sceneId=scene.id;return scene;
  });
  const explanation={kind:'flow',nodes:[{id:'a',label:'water',symbol:'energy'},{id:'b',label:'clouds',symbol:'energy'}],endSceneId:'rain-2'} as const;
  const plan={version:1,inputHash:'x',model:'working-model',hookSeconds:10,
    scenes:project.scenes.map((scene,i)=>({sceneId:scene.id,subject:'water',beat:'explain' as const,
      treatment:'footage' as const,cutawaySceneIds:[],...(i===0?{explanation}:{})}))} as DocumentarySemanticMontage;
  const rows=(endSceneId:string)=>({version:1 as const,inputHash:'x',model:'working-model',rejected:[],
    scenes:[{sceneId:'rain-0',artwork:drawing(),artworkSpan:{endSceneId}}]});
  const partial=attachMotionArtwork(plan,rows('rain-1'),project);
  assert.equal(partial.scenes[0]!.artwork,undefined);
  assert.deepEqual(partial.scenes[0]!.explanation,explanation,'a shorter artwork cannot truncate the icon sequence');
  assert.equal(attachMotionArtwork(plan,rows('rain-2')).scenes[0]!.artwork,undefined,'project evidence is required');
  const complete=attachMotionArtwork(plan,rows('rain-2'),project);
  assert.ok(complete.scenes[0]!.artwork);
  assert.equal(complete.scenes[0]!.explanation,undefined);
  const saved=structuredClone(plan);delete saved.scenes[0]!.explanation;
  saved.scenes[0]!.artwork=drawing();saved.scenes[0]!.artworkSpan={endSceneId:'rain-2'};
  const redraw=attachMotionArtwork(saved,{...rows('rain-2'),scenes:[{sceneId:'rain-0',artwork:drawing()}]},project);
  assert.ok(redraw.scenes[0]!.artwork);
  assert.equal(redraw.scenes[0]!.artworkSpan,undefined,'a single-scene redraw drops the old span');
  project.scenes[1]!.documentary!.templateMotion={amountPercent:0} as never;
  assert.equal(attachMotionArtwork(plan,rows('rain-2'),project).scenes[0]!.artwork,undefined);
  delete project.scenes[1]!.documentary!.templateMotion;
  project.scenes[1]!.documentary!.pinned=true;
  assert.equal(attachMotionArtwork(plan,rows('rain-2'),project).scenes[0]!.artwork,undefined);
  project.scenes[1]!.documentary!.pinned=false;
  project.scenes[1]!.documentary!.templateOrigin='manual';
  assert.equal(attachMotionArtwork(plan,rows('rain-2'),project).scenes[0]!.artwork,undefined);
  project.scenes[1]!.documentary!.templateOrigin='automatic';
  project.scenes[1]!.documentary!.motionGraphic={kind:'statistic',enabled:true,origin:'automatic',title:'',value:'1'} as never;
  assert.equal(attachMotionArtwork(plan,rows('rain-2'),project).scenes[0]!.artwork,undefined,'a numeric diagram is protected');
});
test('span admission accepts a validated no-media drawing with absent mode and protects other scenes',async()=>{
  const make=()=>{
    const p=fixture();p.scenes=Array.from({length:3},(_,i)=>{
      const scene=structuredClone(p.scenes[0]!);scene.id=`rain-${i}`;scene.order=i;
      scene.documentary!.semanticMontage!.sceneId=scene.id;return scene;
    });return p;
  };
  const cases:Array<[string,(p:Project)=>void,boolean]>=[
    ['undefined mode',()=>{},true],
    ['explicit photographic',p=>{p.scenes[1]!.documentary!.semanticMontage!.artworkMode='photographic';},false],
    ['pinned',p=>{p.scenes[1]!.documentary!.pinned=true;},false],
    ['Motion zero',p=>{p.scenes[1]!.documentary!.templateMotion={amountPercent:0} as never;},false],
    ['numeric evidence',p=>{p.scenes[1]!.documentary!.motionGraphic={kind:'statistic',enabled:true,origin:'automatic',title:'',value:'1'} as never;},false],
    ['partial automatic explanation',p=>{p.scenes[1]!.documentary!.semanticMontage!.explanation={kind:'flow',nodes:[],endSceneId:'rain-2'} as never;},false]
  ];
  for(const [name,change,expected] of cases){
    const p=make();change(p);const root=await mkdtemp(join(tmpdir(),'artwork-span-admission-'));
    try{
      const complete=async()=>({scenes:[{sceneId:'rain-0',artworkSpan:{endSceneId:'rain-1'},artwork:drawing()}]});
      if(expected){const result=await createMotionArtworkPlan(p,root,complete,'working-model');
        assert.equal(result.scenes.length,1,name);assert.deepEqual(result.scenes[0]!.artworkSpan,{endSceneId:'rain-1'});}
      else await assert.rejects(createMotionArtworkPlan(p,root,complete,'working-model'),/invalid artwork span/,name);
    }finally{await rm(root,{recursive:true,force:true});}
  }
});
test('saved short interior span restores locally without revising an unreviewed drawing',async()=>{
  const root=await mkdtemp(join(tmpdir(),'artwork-short-span-repair-')),p=fixture();
  p.scenes=Array.from({length:11},(_,i)=>{const scene=structuredClone(p.scenes[0]!);scene.id=`rain-${i}`;scene.order=i;
    scene.documentary!.semanticMontage!.sceneId=scene.id;return scene;});
  p.scenes[7]!.documentary!.semanticMontage!.artworkMode='standalone';
  p.scenes[7]!.documentary!.semanticMontage!.artworkBrief={view:'system',subjectQuote:'water',
    phaseQuotes:['Warm water evaporates','vapour condenses into clouds'],endSceneId:'rain-9'};
  for(const [index,frames] of [[7,175],[8,60],[9,120],[10,121]] as const)
    p.scenes[index]!.documentary!.timing!.durationInFrames=frames;
  const hash=motionArtworkHash(p),montage=join(root,'Documentary','Montage');let commissions=0,revisions=0;
  try{
    await mkdir(montage,{recursive:true});
    const cachePath=join(montage,`${hash}-artwork-v1.json`);
    const oldPlan={version:1,validationVersion:13,keyframeCoalesceVersion:1,inputHash:hash,model:'working-model',
      scenes:[{sceneId:'rain-10',artwork:drawing()}],rejected:[{sceneId:'rain-7',reason:'invalid artwork span'}]};
    await writeFile(cachePath,JSON.stringify(oldPlan));
    await writeFile(join(montage,`${hash}-artwork-batches.json`),JSON.stringify({version:1,inputHash:hash,
      sceneIds:p.scenes.map(scene=>scene.id),ranges:[{from:0,until:7},{from:7,until:11}]}));
    const revised=drawing();revised.layers[1]!.w=310;
    await writeFile(join(montage,`${hash}-artwork-7.json`),JSON.stringify({scenes:[
      {sceneId:'rain-7',artworkSpan:{endSceneId:'rain-9'},artwork:drawing()},
      {sceneId:'rain-10',artwork:drawing()}]}));
    await writeFile(join(montage,`${hash}-artwork-revision-7.json`),JSON.stringify({scenes:[{sceneId:'rain-10',artwork:revised}]}));
    const complete=async()=>{commissions++;throw Error('paid artwork call forbidden');};
    const hooks={preview:async()=>{throw Error('saved preview forbidden');},
      complete:async()=>{revisions++;throw Error('paid revision forbidden');}};
    assert.deepEqual(await createMotionArtworkPlan(p,root,complete,'working-model',undefined,{revision:hooks}),oldPlan,
      'missing first raw keeps the previous plan');
    await writeFile(join(montage,`${hash}-artwork-0.json`),JSON.stringify({scenes:[]}));
    const restored=(await repairSavedMotionArtworkPlan(p,root))!;
    assert.deepEqual([commissions,revisions],[0,0]);assert.equal(restored.spanDurationVersion,1);
    assert.deepEqual(restored.scenes.map(row=>[row.sceneId,row.artworkSpan?.endSceneId]),
      [['rain-7','rain-9'],['rain-10',undefined]]);
    assert.equal(restored.scenes[0]!.artwork.layers[1]!.w,230,'newly recovered span retains its original unreviewed drawing');
    assert.equal(restored.scenes[1]!.artwork.layers[1]!.w,230,'legacy relative revision is discarded in favor of the primary drawing');
    assert.deepEqual(restored.rejected,[]);assert.match(restored.incomplete!,/rain-7: нет доработки/);
    assert.match(restored.incomplete!,/rain-10: доработка вернула не абсолютные координаты/);
    assert.equal(await repairSavedMotionArtworkPlan(p,root),undefined,'span and coordinate repair run once');
  }finally{await rm(root,{recursive:true,force:true});}
});
test('the artwork commission receives literal scene phases from the concept brief',async()=>{
  const p=fixture(),root=await mkdtemp(join(tmpdir(),'artwork-brief-'));
  const brief={view:'cutaway' as const,subjectQuote:'water',phaseQuotes:['Warm water evaporates','vapour condenses into clouds']};
  p.scenes[0]!.documentary!.semanticMontage!.artworkMode='standalone';
  p.scenes[0]!.documentary!.semanticMontage!.artworkBrief=brief;
  try{
    let request:Record<string,unknown>|undefined;
    await createMotionArtworkPlan(p,root,async(_system,input)=>{request=JSON.parse(input);return {scenes:[]};},'working-model');
    assert.deepEqual((request!.scenes as Array<{artworkBrief?:unknown}>)[0]!.artworkBrief,brief);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('a grounded brief can use the already selected source for a single scene',async()=>{
  const p=fixture(),root=await mkdtemp(join(tmpdir(),'artwork-brief-source-'));
  p.scenes[0]!.documentary!.semanticMontage!.artworkMode='standalone';
  p.scenes[0]!.documentary!.semanticMontage!.artworkBrief={view:'object',subjectQuote:'water',
    phaseQuotes:['Warm water evaporates','vapour condenses into clouds']};
  const photographic=drawing();photographic.layers.unshift({id:'source',kind:'media',x:70,y:60,w:860,h:484});
  try{
    let request:{scenes:Array<{artworkMode?:string;artworkBrief?:unknown}>}|undefined;
    const plan=await createMotionArtworkPlan(p,root,async(_system,input)=>{
      request=JSON.parse(input);return {scenes:[{sceneId:'rain',artwork:photographic}]};},'working-model');
    assert.equal(request!.scenes[0]!.artworkMode,undefined,'brief leaves evidence mode to the artwork pass');
    assert.ok(request!.scenes[0]!.artworkBrief);
    assert.equal(plan.scenes.length,1);assert.ok(plan.scenes[0]!.artwork.layers.some(layer=>layer.kind==='media'));
    p.scenes[0]!.documentary!.motionGraphic={kind:'explainer',enabled:true,origin:'automatic',title:'',
      startSeconds:0,durationSeconds:6,artwork:plan.scenes[0]!.artwork} as never;
    assert.ok(!documentaryEditErrors(p).some(issue=>issue.includes('некорректная AI-композиция')),
      'the saved source composition remains export-valid even for a legacy standalone brief');
  }finally{await rm(root,{recursive:true,force:true});}
});
test('a thought across scene eight stays whole while prior paid batch boundaries remain fixed',async()=>{
  const p=fixture();p.scenes=Array.from({length:11},(_,i)=>{
    const scene=structuredClone(p.scenes[0]!);scene.id=`rain-${i}`;scene.order=i;
    scene.documentary!.semanticMontage!.sceneId=scene.id;return scene;
  });
  p.scenes[7]!.documentary!.semanticMontage!.artworkMode='standalone';
  p.scenes[7]!.documentary!.semanticMontage!.artworkBrief={view:'system',subjectQuote:'water',
    phaseQuotes:['Warm water evaporates','vapour condenses into clouds'],endSceneId:'rain-9'};
  const hash=motionArtworkHash(p);
  const root=await mkdtemp(join(tmpdir(),'artwork-boundary-'));
  try{
    const inputs:string[][]=[];
    const result=await createMotionArtworkPlan(p,root,async(_system,input)=>{
      const rows=JSON.parse(input).scenes as Array<{sceneId:string}>;inputs.push(rows.map(row=>row.sceneId));
      const a=drawing();a.durationSeconds=18;
      return {scenes:rows[0]?.sceneId==='rain-7'?[{sceneId:'rain-7',artworkSpan:{endSceneId:'rain-9'},artwork:a}]:[]};
    },'working-model');
    assert.deepEqual(inputs.map(rows=>[rows[0],rows.at(-1)]),[['rain-0','rain-6'],['rain-7','rain-10']]);
    assert.deepEqual(result.scenes.map(row=>row.artworkSpan?.endSceneId),['rain-9']);
    const manifest=JSON.parse(await readFile(join(root,'Documentary','Montage',`${hash}-artwork-batches.json`),'utf8'));
    assert.deepEqual(manifest.ranges,[{from:0,until:7},{from:7,until:11}]);
  }finally{await rm(root,{recursive:true,force:true});}
  for(const history of ['raw','analysis'] as const){
    const prior=await mkdtemp(join(tmpdir(),'artwork-legacy-boundary-'));
    try{
      const montage=join(prior,'Documentary','Montage');await mkdir(montage,{recursive:true});
      if(history==='raw')await writeFile(join(montage,`${hash}-artwork-0.json`),JSON.stringify({scenes:[]}));
      else {const analysis=join(prior,'Documentary','Analysis');await mkdir(analysis,{recursive:true});
        await writeFile(join(analysis,'a'.repeat(64)+'.json'),JSON.stringify({state:'complete',purpose:'semantic-montage',
          raw:'{"scenes":[]}',result:{scenes:[{sceneId:'rain-7',artwork:{}}]}}));}
      await createMotionArtworkPlan(p,prior,async()=>({scenes:[]}), 'working-model');
      const saved=JSON.parse(await readFile(join(montage,`${hash}-artwork-batches.json`),'utf8'));
      assert.deepEqual(saved.ranges,[{from:0,until:8},{from:8,until:11}],history);
    }finally{await rm(prior,{recursive:true,force:true});}
  }
});
test('later unknown paid batch preserves received drawings without an automatic replay',async()=>{
  const root=await mkdtemp(join(tmpdir(),'artwork-partial-'));const p=fixture();let calls=0;
  p.scenes=Array.from({length:13},(_,i)=>({...structuredClone(p.scenes[0]!),id:`rain-${i}`,order:i}));
  try{
    const complete=async()=>{if(++calls===1)return {scenes:[{sceneId:'rain-0',artwork:drawing()}]};throw new DocumentaryAnalysisError('Unknown response','pending','semantic-montage');};
    const result=await createMotionArtworkPlan(p,root,complete,'cheap');
    assert.equal(result.scenes.length,1);assert.match(result.incomplete!,/Unknown/);
    await createMotionArtworkPlan(p,root,complete,'cheap');assert.equal(calls,2);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('normal prepare upgrades an existing semantic plan and carries drawing into final timeline',async()=>{
  const p=fixture(),repo=new MemoryProjectRepository(),projects=new ProjectService(repo,new MockDirectorProvider());await repo.save(p);let calls=0;
  const ai={planSemanticMontage:async()=>{throw Error('Existing semantic plan must be reused');},planMotionArtwork:async()=>{calls++;return {version:1,inputHash:motionArtworkHash(p),model:'cheap',scenes:[{sceneId:'rain',artwork:drawing()}],rejected:[]};}};
  const make=()=>new DocumentaryProjectService(projects,{projectDirectory:()=>'.',ensureProject:async()=>{}} as never,{} as never,'.',{} as never,()=>{},ai as never);
  const first=await make().prepareMontage(p.id),timeline=buildDocumentaryTimeline(first);
  assert.equal(timeline.durationInFrames,180);assert.equal(timeline.scenes[0]!.audioPath,'voice.wav');
  assert.deepEqual(timeline.scenes[0]!.documentary!.motionGraphic!.artwork,drawing());
  assert.deepEqual(documentaryEditErrors(first),[],'production export accepts drawing layers without legacy explainer cards');
  await make().prepareMontage(p.id);assert.equal(calls,1,'ordinary reassembly must not buy another drawing');
  await make().prepareMontage(p.id,undefined,{refreshSemantic:true});assert.equal(calls,1,'refresh of a saved successful drawing must not buy it again');
  assert.equal(first.settings.assembly.documentary!.motionArtworkStatus!.status,'planned');
});
test('normal prepare repairs a planned drawing only from saved raw artwork',async()=>{
  const root=await mkdtemp(join(tmpdir(),'artwork-planned-repair-')),p=fixture(),hash=motionArtworkHash(p);
  const montage=join(root,'Documentary','Montage');let providerCalls=0;
  try{
    p.settings.assembly.documentary!.semanticMontageStatus={status:'planned',inputHash:semanticMontageHash(p),message:'Saved semantic plan'};
    p.settings.assembly.documentary!.motionArtworkStatus={status:'planned',inputHash:hash,message:'AI-графика: принято 0.'};
    await mkdir(montage,{recursive:true});
    const artwork=drawing();artwork.layers[2]!.keyframes=[{t:0,draw:0},{t:.4,draw:1},{t:.4,opacity:1},{t:1,draw:1}];
    const file=join(montage,`${hash}-artwork-v1.json`),rawFile=join(montage,`${hash}-artwork-0.json`);
    const checkpoint=JSON.stringify({version:1,validationVersion:13,inputHash:hash,
      model:'working-model',scenes:[],rejected:[{sceneId:'rain',reason:'invalid motion keyframes'}]});
    const raw=JSON.stringify({scenes:[{sceneId:'rain',artwork}]});
    await writeFile(file,checkpoint);
    const repo=new MemoryProjectRepository(),projects=new ProjectService(repo,new MockDirectorProvider());await repo.save(p);
    const ai={planSemanticMontage:async()=>{throw Error('Saved semantic plan must be reused');},
      planMotionArtwork:async()=>{providerCalls++;throw Error('No provider call is allowed for saved repair');}};
    const service=new DocumentaryProjectService(projects,{projectDirectory:()=>root,ensureProject:async()=>{}} as never,
      {} as never,root,{} as never,()=>{},ai as never);
    await service.prepareMontage(p.id,undefined,{refreshSemantic:true});
    assert.equal(await readFile(file,'utf8'),checkpoint,'missing raw preserves the paid checkpoint');
    assert.equal(providerCalls,0,'missing raw cannot trigger a replacement commission');
    await writeFile(rawFile,raw);
    const result=await service.prepareMontage(p.id,undefined,{refreshSemantic:true});
    const resumed=await service.prepareMontage(p.id);
    assert.equal(providerCalls,0);
    assert.ok(result.scenes[0]!.documentary!.semanticMontage!.artwork);
    assert.match(result.settings.assembly.documentary!.motionArtworkStatus!.message,/принято 1, прикреплено 1, в монтаже 1/);
    assert.deepEqual(resumed.scenes[0]!.documentary!.motionGraphic,result.scenes[0]!.documentary!.motionGraphic);
    assert.equal(await readFile(rawFile,'utf8'),raw,'recovery preserves the original paid response');
    assert.equal(result.scenes[0]!.narration,p.scenes[0]!.narration);
    const saved=JSON.parse(await readFile(file,'utf8'));
    assert.equal(saved.scenes.length,1);
    assert.equal(saved.keyframeCoalesceVersion,1);assert.deepEqual(saved.rejected,[]);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('ordinary prepare restores sub-unit transforms from completed editor raw despite a partial matching cache',async t=>{
  const root=await mkdtemp(join(tmpdir(),'artwork-media-transform-repair-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const p=fixture();p.scenes=Array.from({length:9},(_,i)=>{const s=structuredClone(p.scenes[0]!);s.id=`rain-${i}`;
    s.order=i;s.documentary!.semanticMontage!.sceneId=s.id;return s;});
  const hash=motionArtworkHash(p),semanticHash=semanticMontageHash(p),montage=join(root,'Documentary','Montage');
  const rows=[{sceneId:'rain-0',artwork:authoredDetail(.368,'rain-0')},{sceneId:'rain-1',artwork:authoredDetail(.44,'rain-1')}];
  const cached=await createMotionArtworkPlan(p,root,async(_system,input)=>{
    if(JSON.parse(input).scenes[0].sceneId==='rain-8')throw new DocumentaryAnalysisError('Known local budget stop','pending','semantic-montage');
    return {scenes:rows};
  },'paid-motion');
  assert.ok(cached.incomplete);
  const revisionRaw=JSON.stringify({scenes:rows}),attemptRaw=JSON.stringify({version:1,inputHash:hash,from:0,
    inputSha256:'b'.repeat(64),analysisKey:'c'.repeat(64)});
  const revisionPath=join(montage,`${hash}-artwork-revision-v2-0.json`),attemptPath=join(montage,`${hash}-artwork-revision-v2-0.attempt.json`);
  await writeFile(revisionPath,revisionRaw);await writeFile(attemptPath,attemptRaw);
  cached.v2ReceiptHashes={'0':createHash('sha256').update(revisionRaw).update('\n').update(attemptRaw).digest('hex')};
  delete cached.mediaTransformVersion;
  for(const row of cached.scenes){const detail=row.artwork.layers.find(layer=>layer.id==='detail')!;
    for(const key of detail.keyframes??[]){if(key.scale!==undefined)key.scale=Math.max(.95,key.scale);
      if(row.sceneId==='rain-0'&&key.y!==undefined)key.y=Math.min(36,key.y);}}
  await writeFile(join(montage,`${hash}-artwork-v1.json`),JSON.stringify(cached));
  const primaryPath=join(montage,`${hash}-artwork-0.json`),primaryRaw=await readFile(primaryPath,'utf8');
  const failurePath=join(montage,`${hash}-artwork-8.failed.json`),failureRaw=await readFile(failurePath,'utf8');
  for(const scene of p.scenes){scene.documentary!.semanticMontageInputHash=semanticHash;
    const old=cached.scenes.find(row=>row.sceneId===scene.id);if(old)scene.documentary!.semanticMontage!.artwork=old.artwork;}
  p.settings.assembly.documentary!.semanticMontageStatus={status:'planned',inputHash:semanticHash,message:'Saved semantic'};
  p.settings.assembly.documentary!.motionArtworkStatus={status:'planned',inputHash:hash,incomplete:true,message:'Saved partial artwork'};
  const repo=new MemoryProjectRepository(),projects=new ProjectService(repo,new MockDirectorProvider());await repo.save(p);
  let calls=0;const denied=async()=>{calls++;throw Error('No API or renderer allowed');};
  const service=new DocumentaryProjectService(projects,{projectDirectory:()=>root,ensureProject:async()=>{}} as never,
    {} as never,root,{} as never,()=>{},{planSemanticMontage:denied,planMotionArtwork:denied} as never);
  const repaired=await service.prepareMontage(p.id);
  assert.equal(calls,0);
  for(const [i,scale] of [[0,.368],[1,.44]] as const){
    const detail=repaired.scenes[i]!.documentary!.semanticMontage!.artwork!.layers.find(layer=>layer.id==='detail')!;
    const state=detail.keyframes!.find(key=>key.t===(i===0?.55:0))!;assert.equal(state.scale,scale);
    assert.ok(Math.abs(state.y!-(i===0?56.4:179))<1e-10);
  }
  const restored=JSON.parse(await readFile(join(montage,`${hash}-artwork-v1.json`),'utf8'));
  assert.equal(restored.mediaTransformVersion,1);assert.equal(restored.scenes.length,2);assert.ok(restored.incomplete);
  assert.equal(await repairSavedMotionArtworkPlan(repaired,root),undefined,'matching migrated cache needs no repeated local repair');
  assert.equal(await readFile(primaryPath,'utf8'),primaryRaw);assert.equal(await readFile(revisionPath,'utf8'),revisionRaw);
  assert.equal(await readFile(attemptPath,'utf8'),attemptRaw);assert.equal(await readFile(failurePath,'utf8'),failureRaw);
});

test('saved-only recovery adds later completed batches past a missing unknown batch without primary or editor calls',async t=>{
  const root=await mkdtemp(join(tmpdir(),'artwork-partial-later-recovery-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const p=fixture();p.scenes=Array.from({length:18},(_,i)=>{const scene=structuredClone(p.scenes[0]!);
    scene.id=`rain-${i}`;scene.order=i;scene.documentary!.semanticMontage!.sceneId=scene.id;return scene;});
  const hash=motionArtworkHash(p),directory=join(root,'Documentary','Montage'),analysis=join(root,'Documentary','Analysis');
  await mkdir(directory,{recursive:true});await mkdir(analysis,{recursive:true});
  const normalized=validateMotionArtwork(drawing(),p.scenes[0]!.narration,6).artwork!;
  const old={version:1,validationVersion:13,keyframeCoalesceVersion:1,spanDurationVersion:1,revisionCoordinatesVersion:2,mediaTransformVersion:1,
    inputHash:hash,model:'saved-model',scenes:[0,1].map(i=>({sceneId:`rain-${i}`,artwork:normalized})),rejected:[],incomplete:'Old partial snapshot'};
  await writeFile(join(directory,`${hash}-artwork-v1.json`),JSON.stringify(old));
  await writeFile(join(directory,`${hash}-artwork-0.json`),JSON.stringify({scenes:[0,1].map(i=>({sceneId:`rain-${i}`,artwork:drawing()}))}));
  const laterRaw=JSON.stringify({scenes:[{sceneId:'rain-16',artwork:drawing()}]});
  await writeFile(join(directory,`${hash}-artwork-16.json`),laterRaw);
  const unknown=JSON.stringify({state:'pending',purpose:'semantic-montage'}),key='a'.repeat(64);
  await writeFile(join(analysis,key+'.json'),unknown);
  const failure='{"message":"Unknown primary response"}';await writeFile(join(directory,`${hash}-artwork-8.failed.json`),failure);
  const attempt=JSON.stringify({version:1,inputHash:hash,from:16,inputSha256:'b'.repeat(64),analysisKey:key});
  await writeFile(join(directory,`${hash}-artwork-revision-v2-16.attempt.json`),attempt);
  const repaired=await repairSavedMotionArtworkPlan(p,root);
  assert.deepEqual(repaired?.scenes.map(row=>row.sceneId),['rain-0','rain-1','rain-16']);assert.ok(repaired?.incomplete);
  let callbacks=0;const denied=async()=>{callbacks++;throw Error('no provider/editor/render permitted');};
  const restored=await createMotionArtworkPlan(p,root,denied,'saved-model',undefined,{savedOnly:true,revision:{preview:denied,complete:denied}});
  assert.deepEqual(restored.scenes,repaired.scenes);assert.equal(callbacks,0);
  assert.equal(await readFile(join(analysis,key+'.json'),'utf8'),unknown);
  assert.equal(await readFile(join(directory,`${hash}-artwork-8.failed.json`),'utf8'),failure);
  assert.equal(await readFile(join(directory,`${hash}-artwork-16.json`),'utf8'),laterRaw);
  assert.equal(await readFile(join(directory,`${hash}-artwork-revision-v2-16.attempt.json`),'utf8'),attempt);
});
test('first failed batch cannot suppress independent designs or replay the unknown request',async()=>{
  const root=await mkdtemp(join(tmpdir(),'artwork-first-failure-')),p=fixture();let calls=0;
  p.scenes=Array.from({length:13},(_,i)=>({...structuredClone(p.scenes[0]!),id:`rain-${i}`,order:i}));
  try{
    const complete=async()=>{if(++calls===1)throw new DocumentaryAnalysisError('Unknown first response','pending','semantic-montage');return {scenes:[{sceneId:'rain-8',artwork:drawing()}]};};
    const result=await createMotionArtworkPlan(p,root,complete,'working-model');
    assert.equal(result.scenes[0]!.sceneId,'rain-8');assert.match(result.incomplete!,/Unknown first/);
    await createMotionArtworkPlan(p,root,complete,'working-model');assert.equal(calls,2);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('artwork outage remains visible and is not retried by ordinary assembly',async()=>{
  const p=fixture(),repo=new MemoryProjectRepository(),projects=new ProjectService(repo,new MockDirectorProvider());await repo.save(p);let calls=0;
  const ai={planMotionArtwork:async()=>{calls++;throw new DocumentaryAnalysisError('Provider unavailable','pending','semantic-montage');}};
  const make=()=>new DocumentaryProjectService(projects,{projectDirectory:()=>'.',ensureProject:async()=>{}} as never,{} as never,'.',{} as never,()=>{},ai as never);
  const result=await make().prepareMontage(p.id);await make().prepareMontage(p.id);
  assert.equal(calls,1);assert.equal(result.settings.assembly.documentary!.motionArtworkStatus!.status,'local');
  assert.match(result.settings.assembly.documentary!.semanticMontageStatus!.message,/AI-графика недоступна/);
  assert.equal(result.scenes[0]!.narration,p.scenes[0]!.narration);
});
