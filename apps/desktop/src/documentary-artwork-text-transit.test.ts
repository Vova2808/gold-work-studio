import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,mkdir,mkdtemp,writeFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import ts from 'typescript';
import type {DocumentaryArtwork as Artwork,Project} from '@gold-work/shared';
import {reviewArtworkTemporal,artworkTemporalSampleTimes} from './documentary-artwork-temporal-review.js';
import {motionArtworkSystem,previousMotionArtworkSystems,textTransitDirection} from './documentary-artwork-direction.js';
import {motionArtworkRevisionSystem,preserveArtworkManualLayers} from './documentary-artwork-revision.js';
import {createMotionArtworkPlan,motionArtworkHash} from './documentary-artwork-plan.js';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {documentaryCheckpointKey} from './documentary-checkpoint-key.js';
import {artworkObjectState} from '@gold-work/remotion-video';

const repo=fileURLToPath(new URL('../../../',import.meta.url));
const task=join(repo,'work/release-roadmap-20261026/stage-5-evidence/storyboard-hook-text-transit');
const scratchTask=join(repo,'work/release-roadmap-20261026/stage-5-evidence/storyboard-hook-text-transit-fix1');
const art=():Artwork=>({version:1,motionCoordinates:'relative',intent:'deliberate word transfer',layout:'full',canvas:{width:1000,height:562},
  palette:{background:'#101820',ink:'#ffffff',accent:'#ddaa11',secondary:'#7799aa'},startSeconds:.4,durationSeconds:6,
  layers:[{id:'travel',kind:'text',text:'water',fill:'accent',x:50,y:200,w:100,h:60,
    keyframes:[{t:0,x:0},{t:.2,x:0},{t:.6,x:650},{t:1,x:650}]},
  {id:'settled',kind:'text',text:'water',fill:'ink',x:360,y:200,w:250,h:60},
  {id:'subject',kind:'rect',fill:'accent',x:100,y:100,w:250,h:60}]});
const facts=(a:Artwork)=>reviewArtworkTemporal(a).textTransitEncounters;
const project=():Project=>({id:'transit-fiction',mediaMode:'stock',aspectRatio:'16:9',language:'en',
  settings:{voice:{enabled:true},music:{enabled:false},assembly:{kenBurns:true,documentary:{version:2,autoMotionGraphics:true,
    montage:{version:1,style:'editorial',intensity:'rich',musicPolicy:'preserve'}}}},
  scenes:[{id:'water',order:0,narration:'water',durationSeconds:6,imagePath:'unused.jpg',documentary:{verified:true,checksum:'water',layout:'full',effects:[],caption:{enabled:false,text:''},
    selected:{id:'water',kind:'image',width:1920,height:1080},requirement:{text:'water',identities:[],years:[],accent:'none'},
    semanticMontage:{sceneId:'water',subject:'water',beat:'explain',treatment:'footage',cutawaySceneIds:[],artworkMode:'standalone'},
    timing:{sourceKey:'voice',durationInFrames:180,speechSeconds:5.8}}}]} as unknown as Project);
const scratch=async(_t:{after:(fn:()=>Promise<void>)=>void})=>{await mkdir(scratchTask,{recursive:true});return mkdtemp(join(scratchTask,'case-'));};

test('relative transit is a neutral box observation, preserving deliberate action and subsequent hold',()=>{
  const a=art(),before=structuredClone(a),report=reviewArtworkTemporal(a),encounter=report.textTransitEncounters[0]!;
  assert.equal(report.textTransitEncounters.length,1);assert.deepEqual(encounter.layerIds,['travel','settled']);
  assert.equal(encounter.kind,'declared-box-candidate');assert.ok(encounter.firstFrame<encounter.lastFrame);
  assert.ok(encounter.maxOverlapArea>0);assert.ok(encounter.subsequentSeparateHold!.seconds>1.2);
  assert.ok(!report.findings.some(f=>f.code.includes('transit')));assert.deepEqual(a,before);
  assert.ok(motionArtworkSystem.includes(textTransitDirection));assert.ok(motionArtworkRevisionSystem.includes(textTransitDirection));
});
test('free corridor, hidden text, opacity-only, static overlap and common motion do not imply transit',()=>{
  const free=art();free.layers[0]!.y=100;assert.deepEqual(facts(free),[]);
  const hidden=art();hidden.layers[1]!.keyframes=[{t:0,opacity:0},{t:1,opacity:0}];assert.deepEqual(facts(hidden),[]);
  const fade=art();fade.layers[0]!.x=370;fade.layers[0]!.keyframes=[{t:0,opacity:0},{t:1,opacity:1}];assert.deepEqual(facts(fade),[]);
  const still=art();still.layers[0]!.x=370;still.layers[0]!.keyframes=undefined;assert.deepEqual(facts(still),[]);
  const common=structuredClone(still);common.layers.forEach(l=>l.parentId='board');
  common.layers.push({id:'board',kind:'group',x:0,y:0,w:1000,h:562,keyframes:[{t:0,x:0,rotation:0,scale:1},{t:1,x:50,rotation:30,scale:1.4}]});
  common.camera={path:'continuous',keyframes:[{t:0,x:500,y:281,scale:1},{t:1,x:600,y:300,scale:1.4}]};
  assert.deepEqual(facts(common),[]);
  const inherited=art();inherited.layers[0]!.parentId='hidden-parent';inherited.layers.push({id:'hidden-parent',kind:'group',x:0,y:0,w:1000,h:562,keyframes:[{t:0,draw:0},{t:1,draw:0}]});
  assert.deepEqual(facts(inherited),[]);
});
test('hidden-only transfer before static reveal is not transit; visible and visibility-boundary crossings remain observed',async()=>{
  const repro=JSON.parse(await readFile(join(repo,'work/release-roadmap-20261026/stage-5-evidence/storyboard-hook-text-transit-independent-review/hidden-transfer-repro.json'),'utf8'));
  const hidden=repro.artwork as Artwork,moving=hidden.layers[0]!,frames=180;
  const visibleStates=Array.from({length:frames},(_,frame)=>({frame,...artworkObjectState(hidden,moving,frame/(frames-1))})).filter(s=>s.opacity*s.draw>0);
  assert.equal(visibleStates[0]!.frame,90);assert.ok(visibleStates.every(s=>s.x===300));assert.deepEqual(facts(hidden),[]);
  const oldSamples=[.04,.48,.88].map(t=>Math.round(t*(frames-1)));
  assert.deepEqual(artworkTemporalSampleTimes(hidden,frames).map(t=>Math.round(t*(frames-1))),oldSamples,'false encounter must not consume the missing witness slot');
  const visible=structuredClone(hidden);visible.layers[0]!.keyframes!.forEach(k=>k.opacity=1);
  const actual=facts(visible)[0]!;assert.equal(actual.firstFrame,60);assert.equal(actual.lastFrame,179);
  const boundary=structuredClone(hidden);boundary.layers[0]!.keyframes![2]!.x=600;
  const crossing=facts(boundary)[0]!;assert.equal(crossing.firstFrame,90);assert.equal(crossing.lastFrame,119);
  const inherited=structuredClone(hidden);inherited.layers[0]!.keyframes!.forEach(k=>delete k.opacity);inherited.layers[0]!.parentId='visibility';
  inherited.layers.push({id:'visibility',kind:'group',x:0,y:0,w:1000,h:562,keyframes:[{t:0,opacity:0},{t:.5,opacity:0},{t:1,opacity:1}]});
  assert.deepEqual(facts(inherited),[],'hidden parent cannot supply motion evidence either');
});
test('automatic rotated/scaled group polygons work; protected and unsupported hierarchy stays uncertain/readOnly',()=>{
  const a=art();a.layers[0]!.parentId='turn';a.layers[0]!.keyframes=undefined;
  a.layers.push({id:'turn',kind:'group',x:50,y:200,w:100,h:60,keyframes:[{t:0,x:0,rotation:0,scale:1},{t:.6,x:650,rotation:20,scale:1.2},{t:1,x:650,rotation:20,scale:1.2}]});
  assert.ok(facts(a).length);
  for(const mode of ['edited','clip','missing','nongroup','cycle','parallax'] as const){
    const b=structuredClone(a),parent=b.layers.find(l=>l.id==='turn')!;
    if(mode==='edited')parent.editTransform={x:1,y:0,rotation:0,scale:1};
    if(mode==='clip')parent.clip='ellipse';if(mode==='missing')b.layers[0]!.parentId='absent';
    if(mode==='nongroup')parent.kind='rect';if(mode==='cycle')parent.parentId=parent.id;if(mode==='parallax')parent.depth=.3;
    const review=reviewArtworkTemporal(b);assert.deepEqual(review.textTransitEncounters,[],mode);assert.ok(review.textTransitUncertainty.some(u=>u.readOnly),mode);
    assert.deepEqual(preserveArtworkManualLayers(b,{...structuredClone(b),layers:b.layers.map(l=>({...l,x:l.x+10}))})?.layers.find(l=>l.id==='turn')?.x,mode==='edited'?parent.x:parent.x+10);
  }
});
test('immutable 33-layer fixture reports frames99–117 and existing107 witness with old findings/holds/samples intact',async()=>{
  const base=join(repo,'work/release-roadmap-20261026/stage-5-evidence');
  const diagnosis=JSON.parse(await readFile(join(base,'storyboard-hook-motion-text-collision-diagnosis/collision-diagnosis.json'),'utf8'));
  const p=JSON.parse(await readFile(diagnosis.projectPath,'utf8'));
  const scene=p.scenes.find((s:{id:string})=>s.id===diagnosis.sceneId),a=scene.documentary.semanticMontage.artwork as Artwork;
  assert.equal(a.layers.length,33);const before=JSON.stringify(a),report=reviewArtworkTemporal(a,scene.documentary.semanticMontage.sceneDirection);
  const encounter=report.textTransitEncounters.find(e=>e.layerIds.includes('num29')&&e.layerIds.includes('phraseRest'))!;
  assert.equal(encounter.firstFrame,99);assert.equal(encounter.lastFrame,117);assert.equal(encounter.witness.frame,107);
  assert.ok(encounter.subsequentSeparateHold!.firstFrame>=118);assert.ok(encounter.subsequentSeparateHold!.seconds>3);
  const {textTransitEncounters:_encounters,textTransitUncertainty:_uncertainty,...oldReport}=report;
  assert.deepEqual(oldReport,diagnosis.existingReview);
  assert.deepEqual(artworkTemporalSampleTimes(a,224).map(t=>Math.round(t*223)),diagnosis.previewFrames);assert.equal(JSON.stringify(a),before);
});
test('sampling retains observations/action contacts/joins and adds at most one witness within25',()=>{
  const a=art();a.actions=[{id:'move',layerId:'travel',start:.2,end:.6,from:{x:0},to:{x:650},ease:'linear'}];a.layers[0]!.keyframes=undefined;
  const frames=180,joins=[.1,.25,.4,.55,.7,.9],sampled=artworkTemporalSampleTimes(a,frames,joins).map(t=>Math.round(t*(frames-1)));
  const expected=[.04,.48,.88,.4,.6-1/179,.6,.6+1/179,...joins.flatMap(t=>[t-1/179,t])].map(t=>Math.round(t*179));
  assert.ok(expected.every(f=>sampled.includes(f)));assert.ok(sampled.length<=25);assert.ok(sampled.length<=new Set(expected).size+1);
});
test('ordinary future revision callback receives structured facts; callbacks are MOCK only',async t=>{
  const root=await scratch(t),p=project();let requests=0;
  await createMotionArtworkPlan(p,root,async(_s,_i,paid)=>{await paid?.('a'.repeat(64));return {scenes:[{sceneId:'water',artwork:art()}]};},'mock',undefined,{revision:{
    preview:async rows=>rows.map(row=>({sceneId:row.sceneId,frames:artworkTemporalSampleTimes(row.artwork,180).map(t=>({t,image:'data:image/jpeg;base64,AA=='}))})),
    complete:async(system,input)=>{requests++;assert.ok(system.includes(textTransitDirection));const row=JSON.parse(input).scenes[0];
      assert.ok(row.temporalReview.textTransitEncounters.length);assert.equal(row.temporalReview.textTransitEncounters[0].kind,'declared-box-candidate');return {scenes:[]};}}});
  assert.equal(requests,1);
});
test('exact preceding primary prompt COMPLETE reuse and PENDING/UNKNOWN protection dispatch zero MOCK requests',async t=>{
  const previous=previousMotionArtworkSystems.at(-1)!;
  const baseline=await readFile(join(task,'documentary-artwork-direction.ts.baseline'),'utf8');
  const js=ts.transpileModule(baseline,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
  const old=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64')) as {motionArtworkSystem:string};
  assert.equal(previous,old.motionArtworkSystem,'exact preceding system, including byte-sensitive whitespace');
  for(const state of ['complete','pending','partial'] as const){
    const root=await scratch(t),p=project();let input='';
    await assert.rejects(createMotionArtworkPlan(p,root,async(_s,i)=>{input=i;throw Error('mock capture');},'mock'),/mock capture/);
    const analysis=join(root,'Documentary/Analysis');await mkdir(analysis,{recursive:true});
    const key=documentaryCheckpointKey('semantic-montage',previous,input,[]),file=join(analysis,key+'.json');
    const raw=JSON.stringify({state,purpose:'semantic-montage',...(state==='complete'?{result:{scenes:[{sceneId:'water',artwork:art()}]}}:{}),...(state==='partial'?{raw:'{"scenes":['}:{})});
    await writeFile(file,raw);let dispatched=0;
    const service=new DocumentaryIntelligence({configured:async()=>true,documentaryMotionModel:async()=> 'mock',documentaryCompletion:async()=>{dispatched++;throw Error('unexpected MOCK dispatch');}},()=>root);
    if(state==='complete'){const result=await service.planMotionArtwork(p);assert.equal(result.scenes.length,1);}else await assert.rejects(service.planMotionArtwork(p));
    assert.equal(dispatched,0);assert.equal(await readFile(file,'utf8'),raw);assert.deepEqual(await readdir(analysis),[key+'.json']);
    assert.equal(motionArtworkHash(p),motionArtworkHash(project()));
  }
});
