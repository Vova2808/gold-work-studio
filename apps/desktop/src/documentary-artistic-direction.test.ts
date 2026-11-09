import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {DocumentaryArtwork as Artwork,DocumentarySceneDirection,Project} from '@gold-work/shared';
import {buildDocumentaryTimeline,documentaryMusicClipGain,documentaryMusicClipGainExpression} from '@gold-work/remotion-video';
import {reviewArtworkTemporal,artworkTemporalSampleTimes} from './documentary-artwork-temporal-review.js';
import {validateSceneDirection} from './documentary-scene-direction.js';
import {validateMontageDirections,semanticMontageHash,createSemanticMontagePlan} from './documentary-semantic-montage.js';
import {createMotionArtworkPlan,validateMotionArtwork} from './documentary-artwork-plan.js';
import {assessArtworkReplacement} from './documentary-artwork-quality.js';
import {documentaryMontageSoundEvents} from './documentary-effects.js';
import {documentaryCheckpointKey} from './documentary-checkpoint-key.js';
import {DocumentaryIntelligence} from './documentary-intelligence.js';

const direction=():DocumentarySceneDirection=>({alternatives:[
  {id:'transfer',idea:'Transfer',action:'A token moves to a receiver',staging:'Follow left to right'},
  {id:'accumulate',idea:'Accumulation',action:'The receiver fills',staging:'Start on the result and reveal its cause'},
  {id:'connect',idea:'Connection',action:'Two separated parts join',staging:'A wide arrangement resolves around the join'}],selectedId:'transfer',reason:'The narration names a transfer and response',
  storyboard:{entry:'A token and receiver are separate',focus:'The transfer causes a response',states:[{at:0,object:'token',change:'Ready at the source'},
    {at:.4,object:'token',change:'Arrives at receiver'},{at:.7,object:'receiver',change:'Response settles'}],camera:{mode:'hold',purpose:'Keep source and receiver readable'},
    depth:{mode:'flat',purpose:'One plane makes the relation clear'},typography:{mode:'label',purpose:'Name the transfer'},exit:'Receiver holds the changed state',join:'The next thought describes the response',sound:'click'}});
const drawing=():Artwork=>({version:1,motionCoordinates:'absolute',intent:'Transfer and response',layout:'full',canvas:{width:1000,height:600},
  palette:{background:'#151920',ink:'#eeeeee',accent:'#dd4433',secondary:'#4488aa'},startSeconds:0,durationSeconds:6,
  layers:[{id:'token',kind:'rect',x:120,y:250,w:100,h:100,fill:'accent'},
    {id:'receiver',kind:'ellipse',x:620,y:210,w:180,h:180,fill:'secondary'},
    {id:'track',kind:'path',x:110,y:380,w:710,h:20,path:'M0 10 L710 10',stroke:'ink',fill:'none'},
    {id:'word',kind:'text',x:300,y:440,w:400,h:70,text:'transfer',fontSize:48,fill:'ink'}],
  direction:{concept:'Transfer causes a response',alternatives:direction().alternatives.map(a=>a.idea),beats:[{at:0,action:'Ready',layerIds:['token']},{at:.4,action:'Arrives',layerIds:['token','receiver']},{at:.7,action:'Response holds',layerIds:['receiver']}]}});
const moving=():Artwork=>({...drawing(),actions:[{id:'arrive',layerId:'token',start:.12,end:.4,from:{x:120},to:{x:500},ease:'inOut',sound:'transition'},
  {id:'react',layerId:'receiver',after:'arrive',start:.4,end:.7,from:{scale:1},to:{scale:1.25},ease:'out',sound:'click'}]});
const project=():Project=>({id:'artistic',title:'Transfer',mediaMode:'stock',aspectRatio:'16:9',language:'en',videoBrief:{readyScript:'The transfer causes a response.\nOutside the slice is preserved.'},
  settings:{voice:{enabled:true},music:{enabled:false},assembly:{kenBurns:true,documentary:{version:2,autoEffects:true,autoTransitions:false,autoMotionGraphics:true,montage:{version:1,style:'editorial',intensity:'rich',musicPolicy:'preserve'}}}},
  scenes:[{id:'s0',order:0,narration:'The transfer causes a response.',durationSeconds:6,includeInAssembly:true,documentary:{layout:'full',caption:{enabled:false,text:''},effects:[],
    requirement:{text:'transfer',identities:[],years:[]},timing:{durationInFrames:180,speechSeconds:6},semanticMontage:{sceneId:'s0',subject:'transfer',beat:'explain',treatment:'footage',cutawaySceneIds:[],artworkMode:'standalone',sceneDirection:direction()}}},
    {id:'s1',order:1,narration:'Outside the slice is preserved.',durationSeconds:4,includeInAssembly:false}]} as unknown as Project);

const comparison=():Artwork=>({...drawing(),intent:'Chart comparison',layers:[
  {id:'barA',kind:'rect',x:160,y:260,w:170,h:180,fill:'accent'},
  {id:'barB',kind:'rect',x:600,y:160,w:170,h:280,fill:'secondary',keyframes:[{t:0,opacity:0},{t:.2,opacity:0},{t:.5,opacity:1},{t:1,opacity:1}]},
  {id:'baseline',kind:'path',x:100,y:455,w:750,h:10,path:'M0 0 L750 0',stroke:'ink',fill:'none'},
  {id:'label',kind:'text',x:200,y:485,w:600,h:60,text:'The comparison',fontSize:44,fill:'ink'}],
  direction:{concept:'Static bars appear',alternatives:['Comparison','Transfer','Accumulate'],beats:[{at:0,action:'First bar',layerIds:['barA']},
    {at:.5,action:'Second bar',layerIds:['barB']},{at:.76,action:'Comparison holds',layerIds:['barA','barB']}]}});

// Real normalizer and ordinary primary/revision path. Only completion/preview
// transport is fake; this does not assert live model or artistic acceptance.
async function ordinarySameDraft(art:Artwork){
  const p=project(),scene=p.scenes[0]!;scene.narration='The comparison. A response.';p.videoBrief!.readyScript=scene.narration;
  delete scene.documentary!.semanticMontage!.sceneDirection;
  const checked=validateMotionArtwork(art,scene.narration,6,false);assert.ok(checked.artwork,checked.issue);
  const root=await mkdtemp(join(tmpdir(),'temporal-ordinary-'));let calls=0,revisionReview:ReturnType<typeof reviewArtworkTemporal>|undefined;
  try{
    const result=await createMotionArtworkPlan(p,root,async(_system,_input,submitted)=>{calls++;await submitted?.('c'.repeat(64));
      return {scenes:[{sceneId:'s0',artwork:art}]};},'offline-fixture',undefined,{revision:{
      preview:async rows=>rows.map(row=>({sceneId:row.sceneId,frames:[.04,.48,.88].map(t=>({t,image:'data:image/jpeg;base64,YQ=='}))})),
      complete:async(_system,input)=>{calls++;revisionReview=JSON.parse(input).scenes[0].temporalReview;return {scenes:[{sceneId:'s0',artwork:art}]};}}});
    assert.equal(calls,2);assert.equal(result.scenes.length,1);assert.deepEqual(result.rejected,[]);assert.ok(revisionReview);
    return {review:reviewArtworkTemporal(checked.artwork),revisionReview,result};
  }finally{await rm(root,{recursive:true,force:true});}
}

test('ordinary revision keeps the missing object-state diagnostic for a static chart with only a fade',async()=>{
  const {review,revisionReview,result}=await ordinarySameDraft(comparison());
  assert.ok(review.reveals.some(r=>r.layerId==='barB'),'appearance remains available to visual review');
  assert.ok(review.findings.some(f=>f.code==='no-object-state-change'));
  assert.ok(revisionReview.findings.some(f=>f.code==='no-object-state-change'));
  assert.match(result.incomplete??'',/no-object-state-change/,'same fade-only revision is visibly incomplete');
});

test('ordinary revision preserves a spatially coherent successive unit accumulation',async()=>{
  const art=comparison();art.layers=art.layers.filter(l=>!['barA','barB'].includes(l.id));
  art.layers.unshift(...[0,1,2].map(i=>({id:`unit${i}`,kind:'rect' as const,x:160+i*65,y:320,w:50,h:70,fill:'accent',
    ...(i?{keyframes:[{t:0,opacity:0},{t:i===1?.2:.45,opacity:0},{t:i===1?.3:.55,opacity:1},{t:1,opacity:1}]}:{})})));
  art.direction={concept:'A collection gains equal units in sequence',alternatives:['Accumulate','Transfer','Compare'],beats:[
    {at:0,action:'One established unit',layerIds:['unit0']},{at:.3,action:'A second unit',layerIds:['unit0','unit1']},
    {at:.55,action:'The collection grows again',layerIds:['unit0','unit1','unit2']}]};
  const {review,result}=await ordinarySameDraft(art);
  assert.ok(review.changes.some(c=>c.kind==='accumulation'));
  assert.ok(!review.findings.some(f=>f.code==='no-object-state-change'));assert.equal(result.incomplete,undefined);
  for(const exit of ['opacity','scale'] as const){
    const authored=structuredClone(art);
    for(const unit of authored.layers.filter(l=>l.id.startsWith('unit')))unit.keyframes=[...(unit.keyframes?.filter(k=>k.t<.65)??[{t:0,opacity:1}]),
      {t:.65,opacity:1,scale:1},{t:.75,opacity:exit==='opacity'?0:1,scale:exit==='scale'?0:1},
      {t:1,opacity:exit==='opacity'?0:1,scale:exit==='scale'?0:1}];
    const exited=await ordinarySameDraft(authored);
    assert.ok(exited.review.changes.some(c=>c.kind==='accumulation'),`${exit} exit does not erase the accumulated state`);
    assert.ok(!exited.revisionReview.findings.some(f=>f.code==='no-object-state-change'));
    assert.equal(exited.result.incomplete,undefined);
  }
});

test('ordinary reading review accepts continuous temporary/sequential labels and retains short or unstable windows',async t=>{
  const base=()=>{const art=comparison();delete art.layers[1]!.keyframes;
    art.actions=[{id:'move',layerId:'barA',start:.15,end:.5,from:{x:160},to:{x:390}}];return art;};
  for(const name of ['temporary','parent-exit','sequential','short','moving','disconnected'] as const)await t.test(name,async()=>{
    const art=base(),label=art.layers.find(l=>l.id==='label')!;
    if(name==='temporary'||name==='parent-exit'){
      const keys=[{t:0,opacity:1},{t:.7,opacity:1},{t:.75,opacity:0},{t:1,opacity:0}];
      if(name==='temporary')label.keyframes=keys;
      else {label.parentId='labelGroup';art.layers.push({id:'labelGroup',kind:'group',x:200,y:485,w:600,h:60,keyframes:keys});}
    }else if(name==='sequential'){
      label.keyframes=[{t:0,opacity:1},{t:.35,opacity:1},{t:.4,opacity:0},{t:1,opacity:0}];
      art.layers.push({...label,id:'response',text:'A response',keyframes:[{t:0,opacity:0},{t:.45,opacity:0},{t:.5,opacity:1},{t:1,opacity:1}]});
    }else if(name==='short')label.keyframes=[{t:0,opacity:0},{t:.8,opacity:0},{t:.84,opacity:1},{t:.9,opacity:1},{t:.94,opacity:0},{t:1,opacity:0}];
    else if(name==='moving')label.keyframes=[{t:0,x:100},{t:1,x:450}];
    else label.keyframes=[{t:0,opacity:0},{t:.1,opacity:1},{t:.18,opacity:1},{t:.2,opacity:0},{t:.3,opacity:1},
      {t:.38,opacity:1},{t:.4,opacity:0},{t:.5,opacity:1},{t:.58,opacity:1},{t:.6,opacity:0},{t:1,opacity:0}];
    const {review,revisionReview,result}=await ordinarySameDraft(art),adequate=['temporary','parent-exit','sequential'].includes(name);
    assert.ok(!review.findings.some(f=>f.code==='no-object-state-change'));
    assert.equal(review.findings.some(f=>f.code==='short-reading-hold'),!adequate);
    assert.equal(revisionReview.findings.some(f=>f.code==='short-reading-hold'),!adequate);
    if(adequate){assert.equal(result.incomplete,undefined);if(name!=='sequential')assert.ok(review.readingHolds[0]!.seconds>=4.1);}
    else assert.match(result.incomplete??'',/short-reading-hold/);
  });
});

test('static geometry and a hidden frame jump cannot pass as an object action, regardless of layer count or camera',()=>{
  const art=drawing();art.layers.push({id:'frame',kind:'rect',x:100,y:230,w:720,h:150,fill:'none',stroke:'ink',
    keyframes:[{t:0,opacity:0},{t:.4,opacity:0},{t:.5,opacity:1}]});
  art.actions=[{id:'hiddenMove',layerId:'frame',start:.1,end:.3,from:{y:230},to:{y:390}}];
  art.camera={path:'continuous',keyframes:[{t:0,x:500,y:300,scale:1},{t:1,x:540,y:330,scale:1.1}]};
  assert.equal(assessArtworkReplacement(art).allowReplacement,true,'old replacement guard alone accepts the static board');
  const review=reviewArtworkTemporal(art);
  assert.ok(review.findings.some(f=>f.code==='no-object-state-change'));
  assert.ok(review.findings.some(f=>f.code==='invisible-action'&&f.layers.includes('frame')));
  const board=drawing();board.layers.forEach(l=>{l.parentId='board';});
  board.layers.unshift({id:'board',kind:'group',x:0,y:0,w:1000,h:600});
  board.actions=[{id:'entrance',layerId:'board',start:.1,end:.5,from:{x:-200},to:{x:0},ease:'out'}];
  assert.ok(reviewArtworkTemporal(board).findings.some(f=>f.code==='no-object-state-change'),'moving the whole board is not a changed object relationship');
  const checked=validateMotionArtwork(moving(),project().scenes[0]!.narration,6,false),normalized=checked.artwork!;
  assert.ok(normalized,checked.issue);assert.ok(reviewArtworkTemporal(normalized).changes.some(c=>c.layerId==='token'));
  assert.ok(!reviewArtworkTemporal(normalized).findings.some(f=>f.code==='no-object-state-change'));
});

test('contact samples contain the actual contact and adjacent frames plus a span join',()=>{
  const art=moving(),frames=360,phases=artworkTemporalSampleTimes(art,frames,180/359).map(t=>Math.round(t*359));
  assert.ok(phases.length<=13);assert.ok(phases.includes(179)&&phases.includes(180));
  for(const a of art.actions!){const end=Math.round(a.end*359);for(const f of [end-1,end,end+1])assert.ok(phases.includes(f),`${a.id}: frame ${f}`);}
});

test('selected alternatives/storyboard survive ordinary semantic validation; cosmetic duplicates are omitted',async t=>{
  const p=project(),valid=direction();assert.deepEqual(validateSceneDirection(valid),valid);
  const duplicate=structuredClone(valid);duplicate.alternatives[1]!.action=duplicate.alternatives[0]!.action;duplicate.alternatives[1]!.staging=duplicate.alternatives[0]!.staging;
  assert.equal(validateSceneDirection(duplicate),undefined);
  assert.deepEqual(validateMontageDirections({scenes:[{...p.scenes[0]!.documentary!.semanticMontage}]},[p.scenes[0]!],p.scenes,p)[0]!.sceneDirection,valid);
  const root=await mkdtemp(join(tmpdir(),'artistic-semantic-'));t.after(()=>rm(root,{recursive:true,force:true}));
  let calls=0;
  const plan=await createSemanticMontagePlan(p,root,async(system,input)=>{calls++;
    assert.match(system,/3–5 materially different/);const data=JSON.parse(input);assert.equal(data.storyContext.originalScript,p.videoBrief!.readyScript);
    assert.equal(data.storyContext.contextScenes.length,2);
    return {scenes:[{...p.scenes[0]!.documentary!.semanticMontage,sceneId:'s0'}]};
  },'offline-fixture');
  assert.deepEqual(plan.scenes[0]!.sceneDirection,valid);assert.equal(calls,1);
  await createSemanticMontagePlan(p,root,async()=>{throw Error('receipt must be reused');},'offline-fixture');
});

test('ordinary semantic request includes direction in its leading response contract; omitted wire fields remain visible',async t=>{
  // Actual live response subjects/shape: all four rows omitted sceneDirection.
  // Basic montage is preserved, never upgraded into a fabricated creative answer.
  const subjects=['Honda that had won 29 of the previous 32 Grand Prix races',
    "Yamaha, a team that hadn't won a single race all year",'his third consecutive premier-class championship',
    'Why leave the strongest motorcycle on the grid for one that kept losing'];
  const p=project();p.scenes=subjects.map((subject,i)=>({...structuredClone(p.scenes[0]!),id:`s${i}`,order:i,narration:subject}));
  p.videoBrief!.readyScript=subjects.join('\n');
  const wire={scenes:subjects.map((subject,i)=>({sceneId:`s${i}`,subject,beat:i===0?'establish':i===2?'evidence':'conflict',
    treatment:i===1?'subject':'footage',cutawaySceneIds:[]}))};
  for(const omitted of [true,false]){
    const root=await mkdtemp(join(tmpdir(),'direction-wire-'));t.after(()=>rm(root,{recursive:true,force:true}));let calls=0;
    const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryQueryModel:async()=> 'selected',
      documentaryCompletion:async(system)=>{calls++;
        const contract=system.slice(0,system.indexOf('\nsubject is'));
        assert.match(contract,/cutawaySceneIds:\[\],sceneDirection:\{alternatives:/);
        for(const field of ['selectedId','reason','storyboard','states','camera','depth','typography','join','sound'])assert.ok(contract.includes(field),field);
        return JSON.stringify({scenes:wire.scenes.map(s=>({...s,...(omitted?{}:{sceneDirection:direction()})}))});
      }},()=>root);
    const result=await intelligence.planSemanticMontage(p);
    assert.equal(calls,1);assert.equal(result.scenes.length,4);
    if(omitted){assert.equal(result.scenes.filter(s=>s.sceneDirection).length,0);
      for(const s of wire.scenes)assert.ok(result.conceptWarning?.includes(`${s.sceneId}: неполная режиссура`));}
    else {assert.equal(result.conceptWarning,undefined);for(const row of result.scenes)assert.deepEqual(row.sceneDirection,direction());}
    await intelligence.planSemanticMontage(p);assert.equal(calls,1,'completed request/cache reused without resubmission');
  }
});

for(const state of ['pending','received','partial','complete'] as const)test(`exact pre-fix directed ${state} receipt is preserved by ordinary Intelligence`,async t=>{
  const root=await mkdtemp(join(tmpdir(),'direction-prior-'));t.after(()=>rm(root,{recursive:true,force:true}));const p=project();
  let system='',input='';await assert.rejects(createSemanticMontagePlan(p,root,async(s,i)=>{system=s;input=i;throw Error('capture');},'selected'),/capture/);
  // Historical leading schema, before the direction field was part of it.
  const old=system.slice(0,system.indexOf('Every scene, including'))
    +'Return compact JSON {scenes:[{sceneId,subject,beat,treatment,cutawaySceneIds:[],composition?,explanation?,artworkMode?}],musicSections:[{startSceneId,endSceneId,role,mood}]}. Return exactly one row for EVERY supplied scene. Omit undefined optional fields, no markdown.'
    +system.slice(system.indexOf('\nsubject is'));
  const key=documentaryCheckpointKey('semantic-montage',old,input,[]),directory=join(root,'Documentary','Analysis');
  await mkdir(directory,{recursive:true});const receipt=JSON.stringify({state,purpose:'semantic-montage',
    ...(state==='complete'?{result:{scenes:[{sceneId:'s0',subject:'transfer',beat:'explain',treatment:'footage',cutawaySceneIds:[]}]}}:{})});
  const file=join(directory,`${key}.json`);await writeFile(file,receipt);let calls=0;
  const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryQueryModel:async()=> 'selected',
    documentaryCompletion:async()=>{calls++;throw Error('must not submit');}},()=>root);
  if(state==='complete'){const plan=await intelligence.planSemanticMontage(p);assert.equal(plan.scenes.length,1);assert.match(plan.conceptWarning??'',/неполная режиссура/);}
  else await assert.rejects(intelligence.planSemanticMontage(p),/Автоповтор отключён|повторный платный запрос не отправлен|Этот платный запрос не повторяется/);
  assert.equal(calls,0);assert.equal(await readFile(file,'utf8'),receipt);
});

test('ordinary bounded revision receives concrete temporal findings and cannot silently accept the same static board',async t=>{
  for(const repair of [false,true]){
    const p=project(),root=await mkdtemp(join(tmpdir(),'artistic-revision-'));t.after(()=>rm(root,{recursive:true,force:true}));
    let calls=0,previews=0;
    const result=await createMotionArtworkPlan(p,root,async(_system,input,submitted)=>{calls++;const data=JSON.parse(input);
      assert.deepEqual(data.scenes[0].sceneDirection,direction());assert.equal(data.storyContext.contextScenes.length,2);
      await submitted?.('a'.repeat(64));return {scenes:[{sceneId:'s0',artwork:drawing()}]};
    },'offline-fixture',undefined,{revision:{preview:async rows=>{previews++;return rows.map(row=>({sceneId:row.sceneId,frames:[.04,.48,.88].map(t=>({t,image:'data:image/jpeg;base64,YQ=='}))}));},
      complete:async(_system,input)=>{calls++;const data=JSON.parse(input);assert.ok(data.scenes[0].temporalReview.findings.some((f:{code:string})=>f.code==='no-object-state-change'));
        assert.deepEqual(data.scenes[0].sceneDirection,direction());return {scenes:[{sceneId:'s0',artwork:repair?moving():drawing()}]};}}});
    assert.equal(calls,2);assert.equal(previews,repair?2:1);
    assert.equal(Boolean(result.scenes[0]!.artwork.actions?.length),repair);
    if(!repair)assert.match(result.incomplete??'',/no-object-state-change/);
    else assert.equal(result.incomplete,undefined);
    const saved=JSON.parse(await readFile(join(root,'Documentary','Montage',`${result.inputHash}-artwork-v1.json`),'utf8'));
    assert.equal(saved.scenes[0].sceneId,'s0');
  }
});

test('quiet artwork has no generic cut whoosh, contacts use their action clock, automatic music releases without changing manual clips',()=>{
  const p=project(),doc=p.scenes[0]!.documentary!;
  doc.motionGraphic={enabled:true,origin:'automatic',kind:'explainer',title:'',artwork:drawing(),startSeconds:0,durationSeconds:6};
  assert.deepEqual(documentaryMontageSoundEvents(p),[]);
  doc.motionGraphic.artwork=moving();assert.deepEqual(documentaryMontageSoundEvents(p).map(e=>[e.seconds,e.category]),[[Math.round(.4*179)/30,'transition'],[Math.round(.7*179)/30,'click']]);
  doc.templateMotion={amountPercent:0,curve:'smooth'};assert.deepEqual(documentaryMontageSoundEvents(p),[]);
  const timeline=buildDocumentaryTimeline({aspectRatio:'16:9',scenes:[{id:'s',order:0,durationSeconds:6}],settings:{voice:{enabled:false},assembly:{kenBurns:false},music:{enabled:true,volume:100,fadeInSeconds:0,fadeOutSeconds:0,ducking:false}}});
  const clip={id:'music',path:'local.wav',startSeconds:0,durationSeconds:5,sourceOffsetSeconds:0,volume:100,enabled:true,origin:'automatic' as const,status:'ready' as const};
  assert.ok(documentaryMusicClipGain(timeline,clip,4.7)<.4);
  assert.equal(documentaryMusicClipGain(timeline,{...clip,origin:'manual'},4.7),1);
  assert.match(documentaryMusicClipGainExpression(timeline,clip),/0\.9/);
  assert.equal(semanticMontageHash(p),semanticMontageHash(structuredClone(p)));
});
