import test from 'node:test';
import assert from 'node:assert/strict';
import type {Project,Scene} from '@gold-work/shared';
import {validateDocumentaryExplanation,documentaryExplanationSpans} from './documentary-explanation.js';
import {enrichSemanticMontage,validateMontageDirections} from './documentary-semantic-montage.js';
import {buildDocumentaryTimeline} from '../../../packages/remotion-video/src/documentary-timeline.js';

function fixture():Project{
  const scenes=['Sunlight reaches the panel and is converted into ','electricity that supplies the home.','The process supports daily life.'].map((narration,order)=>({
    id:`s${order}`,order,narration,durationSeconds:4,imagePath:`${order}.jpg`,documentary:{verified:true,checksum:`c${order}`,layout:'full',effects:[],
      timing:{durationInFrames:120},caption:{enabled:false,text:''},requirement:{text:narration,identities:[],years:[]},
      selected:{id:`source${order}`,kind:'image',width:1920,height:1080},
      semanticMontage:{sceneId:`s${order}`,subject:'',beat:'explain',treatment:'footage',cutawaySceneIds:[]}}})) as unknown as Scene[];
  return {id:'explanation',mediaMode:'stock',aspectRatio:'16:9',language:'en',scenes,settings:{voice:{enabled:false},music:{enabled:false},assembly:{fps:30,kenBurns:true,
    documentary:{version:2,autoMotionGraphics:true,montage:{version:1,style:'editorial',intensity:'rich'}}}}} as unknown as Project;
}
const flow={kind:'flow',endSceneId:'s1',nodes:[{id:'a',label:'Sunlight',symbol:'energy'},{id:'b',label:'electricity',symbol:'energy'},{id:'c',label:'home',symbol:'place'}]};

test('one complete explanation survives semantic validation, enrichment and timeline across split narration',()=>{
  const p=fixture(),rows=validateMontageDirections({scenes:[{sceneId:'s0',explanation:flow}]},p.scenes,p.scenes,p);
  p.scenes.forEach((s,i)=>s.documentary!.semanticMontage=rows[i]);
  const spans=documentaryExplanationSpans(p);assert.equal(spans.size,2);assert.equal(spans.get('s1')!.sequence!.offsetFrames,120);
  p.scenes=enrichSemanticMontage(p);
  assert.equal(p.scenes[0]!.documentary!.motionGraphic!.explanation!.nodes[2]!.label,'home');
  const timeline=buildDocumentaryTimeline(p);
  assert.equal(timeline.scenes[1]!.documentary!.motionGraphic!.explanation!.sequence!.offsetFrames,120);
  assert.equal(timeline.scenes[1]!.documentary!.motionGraphic!.sequenceOffsetFrames,undefined,'native sequence merging must not double its clock');
});

test('semantic spans cannot rewrite labels, reorder source scenes or cross manual work',()=>{
  const p=fixture();assert.equal(validateDocumentaryExplanation({...flow,nodes:[...flow.nodes.slice(0,2),{id:'c',label:'free power',symbol:'energy'}]},p.scenes[0]!,p.scenes),undefined);
  assert.equal(validateDocumentaryExplanation({...flow,kind:'exchange'},p.scenes[0]!,p.scenes),undefined);
  p.scenes[1]!.documentary!.pinned=true;
  assert.equal(validateDocumentaryExplanation(flow,p.scenes[0]!,p.scenes),undefined);
});

test('automatic photo slogans are removed while authored overlays remain',()=>{
  const p=fixture(),s=p.scenes[2]!;s.documentary!.semanticMontage!.composition={kind:'key-point',title:'daily life'};
  assert.equal(enrichSemanticMontage(p)[2]!.documentary!.motionGraphic,undefined);
  const manual={kind:'key-point' as const,title:'daily life',enabled:true,origin:'manual' as const,startSeconds:0,durationSeconds:4};
  s.documentary!.motionGraphic=manual;
  assert.equal(enrichSemanticMontage(p)[2]!.documentary!.motionGraphic,manual);
});

function concreteFixture(){
  const project=fixture();
  project.scenes[0]!.narration='Does the rider or ';
  project.scenes[1]!.narration='the racing motorcycle make the difference?';
  const explanation={kind:'contrast' as const,endSceneId:'s1',nodes:[
    {id:'rider',label:'the rider',symbol:'person' as const},
    {id:'vehicle',label:'the racing motorcycle',symbol:'motorcycle' as const,objectType:'motorcycle' as const},
  ]};
  return {project,explanation};
}

test('an unbranded concrete motorcycle retains its declared type through validation, span, enrichment and timeline',()=>{
  const {project:p,explanation}=concreteFixture();
  const protectedInputs=p.scenes.map(s=>({narration:s.narration,imagePath:s.imagePath,timing:s.documentary!.timing}));
  const rows=validateMontageDirections({scenes:[{sceneId:'s0',explanation}]},p.scenes,p.scenes,p);
  assert.deepEqual(rows[0]!.explanation,explanation);
  p.scenes.forEach((s,i)=>s.documentary!.semanticMontage=rows[i]);
  const spans=documentaryExplanationSpans(p);
  assert.equal(spans.size,2);assert.equal(spans.get('s1')!.sequence!.offsetFrames,120);
  p.scenes=enrichSemanticMontage(p);
  const timeline=buildDocumentaryTimeline(p);
  for(const scene of timeline.scenes.slice(0,2)){
    const node=scene.documentary!.motionGraphic!.explanation!.nodes[1]!;
    assert.deepEqual(node,{id:'vehicle',label:'the racing motorcycle',symbol:'motorcycle',objectType:'motorcycle'});
    assert.equal(scene.documentary!.motionGraphic!.explanation!.sequence!.durationInFrames,240);
  }
  assert.deepEqual(p.scenes.map(s=>({narration:s.narration,imagePath:s.imagePath,timing:s.documentary!.timing})),protectedInputs);
});

test('declared concrete mismatch and unsupported types are rejected; legacy machine is never reinterpreted from labels',()=>{
  const {project:p,explanation}=concreteFixture();
  for(const symbol of ['machine','generic','person']){
    const mismatch={...explanation,nodes:[explanation.nodes[0],{...explanation.nodes[1],symbol}]};
    assert.equal(validateDocumentaryExplanation(mismatch,p.scenes[0]!,p.scenes),undefined);
    const rows=validateMontageDirections({scenes:[{sceneId:'s0',explanation:mismatch}]},p.scenes,p.scenes,p);
    assert.equal(rows[0]!.explanation,undefined,'existing absent-explanation path retains ordinary footage/artwork choices');
    p.scenes.forEach((s,i)=>s.documentary!.semanticMontage=rows[i]);
    assert.equal(documentaryExplanationSpans(p).size,0);
    assert.equal(enrichSemanticMontage(p)[0]!.documentary!.motionGraphic?.explanation,undefined);
  }
  for(const objectType of ['car','',null,42]){
    assert.equal(validateDocumentaryExplanation({...explanation,nodes:[explanation.nodes[0],{...explanation.nodes[1],objectType}]},p.scenes[0]!,p.scenes),undefined);
  }
  const legacy={...explanation,nodes:[explanation.nodes[0],{id:'vehicle',label:'the racing motorcycle',symbol:'machine'}]};
  const retained=validateDocumentaryExplanation(legacy,p.scenes[0]!,p.scenes)!;
  assert.equal(retained.nodes[1]!.symbol,'machine');
  assert.equal(Object.hasOwn(retained.nodes[1]!,'objectType'),false,'no inferred migration of legacy data');
});

test('concrete types do not relax literal labels, span order or manual boundaries',()=>{
  const {project:p,explanation}=concreteFixture();
  assert.equal(validateDocumentaryExplanation({...explanation,nodes:[explanation.nodes[0],{...explanation.nodes[1],label:'the fastest motorcycle'}]},p.scenes[0]!,p.scenes),undefined);
  assert.equal(validateDocumentaryExplanation({...explanation,endSceneId:'s0'},p.scenes[1]!,p.scenes),undefined);
  assert.equal(validateDocumentaryExplanation({...explanation,endSceneId:'missing'},p.scenes[0]!,p.scenes),undefined);
  for(const protect of [
    (s:Scene)=>{s.documentary!.pinned=true;},
    (s:Scene)=>{s.documentary!.templateOrigin='manual';},
    (s:Scene)=>{s.documentary!.caption.enabled=true;},
    (s:Scene)=>{s.documentary!.templateMotion={amountPercent:0,curve:'smooth'};},
    (s:Scene)=>{s.documentary!.motionGraphic={kind:'key-point',enabled:true,origin:'manual',title:'authored',startSeconds:0,durationSeconds:4};},
  ]){
    const {project:q}=concreteFixture();protect(q.scenes[1]!);
    assert.equal(validateDocumentaryExplanation(explanation,q.scenes[0]!,q.scenes),undefined);
  }
});
