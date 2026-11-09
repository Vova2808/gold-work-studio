import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {DocumentaryArtwork,DocumentarySemanticMontage,Project,Scene} from '@gold-work/shared';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {createDocumentaryConceptPlan} from './documentary-concept-plan.js';
import {createSemanticMontagePlan,documentaryExplanationKeepsEvidence,enrichSemanticMontage,semanticMontageHash,validateMontageArtworkBrief} from './documentary-semantic-montage.js';
import {documentaryExplanationSpans,documentaryExplanationSemantics,documentaryEditorialSystem} from './documentary-explanation.js';
import {documentaryCheckpointKey} from './documentary-checkpoint-key.js';
import {attachMotionArtwork,createMotionArtworkPlan} from './documentary-artwork-plan.js';

const flow={kind:'flow',nodes:[{id:'sun',label:'Sunlight',symbol:'energy'},{id:'power',label:'electricity',symbol:'energy'}],endSceneId:'s8'};
function fixture(count=10):Project{
  const scenes=Array.from({length:count},(_,order)=>({id:`s${order}`,order,narration:order===7?'Sunlight turns into ':order===8?'electricity through the panel.':'The landscape stays quiet.',durationSeconds:4,imagePath:`missing-${order}.jpg`,documentary:{
    verified:true,checksum:`c${order}`,layout:'full',effects:[],timing:{durationInFrames:120},caption:{enabled:false,text:''},
    requirement:{text:'',identities:[],years:[]},selected:{id:`source-${order}`,kind:'image',width:1920,height:1080},
    semanticMontage:{sceneId:`s${order}`,subject:'',beat:'explain',treatment:'footage',cutawaySceneIds:[]}}})) as unknown as Scene[];
  return {id:'concepts',mediaMode:'stock',aspectRatio:'16:9',language:'en',scenes,settings:{voice:{enabled:false},music:{enabled:false},assembly:{fps:30,kenBurns:true,
    documentary:{version:2,autoMotionGraphics:true,montage:{version:1,style:'editorial',intensity:'rich'}}}}} as unknown as Project;
}
function base(p:Project):DocumentarySemanticMontage{return {version:1,inputHash:semanticMontageHash(p),model:'source-editor',hookSeconds:16,scenes:p.scenes.map(s=>s.documentary!.semanticMontage!)};}
async function cached(p:Project,root:string){await mkdir(join(root,'Documentary','Montage'),{recursive:true});await writeFile(join(root,'Documentary','Montage',semanticMontageHash(p)+'.json'),JSON.stringify(base(p)));}
async function conceptFallback(intelligence:DocumentaryIntelligence,p:Project,warning?:RegExp){
  const plan=await intelligence.planSemanticMontage(p);
  assert.ok('conceptWarning' in plan&&typeof plan.conceptWarning==='string'&&plan.conceptWarning.length>0);
  if(warning)assert.match(plan.conceptWarning,warning);
  assert.deepEqual(JSON.parse(JSON.stringify(plan.scenes)),base(p).scenes.map(row=>({...row,language:p.language})),
    'a blocked commission retains the source edit after its normal language/default normalization');
}

test('one montage brief crosses its batch boundary, stays cached and respects authored scenes and literal phase order',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-integrated-brief-'));t.after(()=>rm(root,{recursive:true,force:true}));
  for(const protection of ['none','manual','pinned','zero','evidence'] as const){
    const p=fixture();p.scenes.forEach((scene,i)=>{scene.id=`thought-${i}`;scene.documentary!.semanticMontage!.sceneId=scene.id;});
    const member=p.scenes[8]!.documentary!;
    if(protection==='manual')member.templateOrigin='manual';
    if(protection==='pinned')member.pinned=true;
    if(protection==='zero')member.templateMotion={amountPercent:0,curve:'smooth'};
    if(protection==='evidence'){p.scenes[8]!.narration+=' It produces 25 watts.';member.semanticMontage!.composition={kind:'statistic',value:'25 watts'};}
    const before=JSON.stringify(p);let calls=0;
    const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(system,input)=>{
      calls++;const payload=JSON.parse(input);assert.equal(payload.motionConcepts,undefined);assert.match(system,/artworkBrief/);
      if(payload.scenes[0].sceneId==='s0')assert.equal(payload.artworkContinuations[0].sceneId,'s8');
      return JSON.stringify({scenes:payload.scenes.map((s:{sceneId:string})=>({sceneId:s.sceneId,subject:'',beat:'explain',treatment:'footage',cutawaySceneIds:[],
        ...(s.sceneId==='s7'?{artworkBrief:{view:'system',subjectQuote:'Sunlight',phaseQuotes:['Sunlight turns into','electricity through the panel'],endSceneId:'s8'}}:{}),
        ...(protection==='evidence'&&s.sceneId==='s8'?{composition:{kind:'statistic',value:'25 watts'}}:{})}))});
    }},()=>join(root,protection));
    const first=await intelligence.planSemanticMontage(p);assert.equal(calls,2,'two montage batches, zero concept calls');
    assert.equal(first.scenes[7]!.artworkBrief?.endSceneId,protection==='none'?'thought-8':undefined);
    assert.equal(JSON.stringify(p),before,'brief planning preserves narration, timing and authored data');
    const reused=await intelligence.planSemanticMontage(p);assert.equal(calls,2);assert.deepEqual(JSON.parse(JSON.stringify(reused.scenes)),JSON.parse(JSON.stringify(first.scenes)));
  }
  const scene={...fixture(1).scenes[0]!,narration:'The paper folds. The booklet closes.'};
  const brief={view:'object',subjectQuote:'paper',phaseQuotes:['booklet closes','paper folds']};
  assert.equal(validateMontageArtworkBrief(brief,[scene]),undefined,'reverse order within one scene is invalid');
  assert.equal(validateMontageArtworkBrief({...brief,phaseQuotes:['paper folds','booklet closes']},[scene])?.view,'object');
});

test('integrated directing re-enters the exact pre-brief montage receipt without a changed-key payment',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-brief-predecessor-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const p=fixture(2);
  for(const state of ['complete','received','pending','partial'] as const){
    const directory=join(root,state);let request:{system:string;input:string}|undefined;
    await assert.rejects(createSemanticMontagePlan(p,directory,async(system,input)=>{request={system,input};throw Error('capture');},'old'),/capture/);
    const system=request!.system.split('\nARTWORK WITHIN THIS EDIT')[0]!;assert.notEqual(system,request!.system);
    const payload=JSON.parse(request!.input);delete payload.artworkContinuations;payload.scenes.forEach((row:Record<string,unknown>)=>delete row.artworkEditable);
    const input=JSON.stringify(payload),key=documentaryCheckpointKey('semantic-montage',system,input,[]),analysis=join(directory,'Documentary','Analysis');
    await mkdir(analysis,{recursive:true});
    const result={scenes:payload.scenes.map((row:{sceneId:string})=>({sceneId:row.sceneId,subject:'',beat:'evidence',treatment:'footage',cutawaySceneIds:[]}))};
    const receipt=JSON.stringify({state,purpose:'semantic-montage',...(state==='complete'?{result}:{}),...(state==='partial'?{raw:'{"scenes":['}:{})});
    await writeFile(join(analysis,key+'.json'),receipt);let calls=0;
    const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryMontageModel:async()=>'changed-model',
      documentaryCompletion:async()=>{calls++;throw Error('never resubmit');}},()=>directory);
    if(state==='complete')assert.equal((await intelligence.planSemanticMontage(p)).scenes.length,2);
    else await assert.rejects(intelligence.planSemanticMontage(p),/Автоповтор отключён|повторный платный запрос|не повторяется/);
    assert.equal(calls,0);assert.equal(await readFile(join(analysis,key+'.json'),'utf8'),receipt);
  }
});

test('normal Intelligence restores a paid full-thought concept without buying a separate commission',async()=>{
  const root=await mkdtemp(join(tmpdir(),'gws-concept-'));
  try{
    const p=fixture(),original=JSON.stringify(p);await cached(p,root);let calls=0;
    const request=await conceptRequest(p),key=documentaryCheckpointKey('semantic-montage',request.system,request.input,[]);
    const analysis=join(root,'Documentary','Analysis');await mkdir(analysis,{recursive:true});
    const raw=JSON.stringify({explanations:[{sceneId:'s7',...flow}]});
    await writeFile(join(analysis,key+'.json'),JSON.stringify({state:'complete',purpose:'semantic-montage',model:'cc/claude-sonnet-5',result:JSON.parse(raw),raw}));
    const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryMontageModel:async()=>'source-editor',
      documentaryCompletion:async()=>{calls++;throw Error('legacy concept must stay local');}},()=>root);
    const planned=await intelligence.planSemanticMontage(p);await intelligence.planSemanticMontage(p);assert.equal(calls,0);
    assert.equal(JSON.stringify(p),original,'planning must not mutate sources, narration or timing');
    p.scenes=p.scenes.map(s=>({...s,documentary:{...s.documentary!,semanticMontage:planned.scenes.find(r=>r.sceneId===s.id)}}));
    const enriched=enrichSemanticMontage(p);assert.equal(enriched[8]!.documentary!.motionGraphic!.explanation!.sequence!.offsetFrames,120);
    const files=await readdir(join(root,'Documentary','Analysis'));assert.equal(files.length,1);
    const receipt=JSON.parse(await readFile(join(root,'Documentary','Analysis',files[0]!), 'utf8'));
    assert.equal(receipt.state,'complete');assert.equal(receipt.model,'cc/claude-sonnet-5');assert.ok(receipt.raw.includes('Sunlight'));
  }finally{await rm(root,{recursive:true,force:true});}
});

test('grounded visual briefs route two different physical thoughts to artwork without place icons',async()=>{
  const p=fixture(6);
  p.scenes[0]!.narration='Liquid enters the chamber.';
  p.scenes[1]!.narration='It passes through narrow passages into the vessel.';
  p.scenes[3]!.narration='The paper folds along a crease.';
  p.scenes[4]!.narration='It closes into a small booklet.';
  const physical={sceneId:'s0',endSceneId:'s1',kind:'flow',nodes:[
    {id:'a',label:'chamber',symbol:'place'},{id:'b',label:'vessel',symbol:'place'}],
    visualBrief:{view:'cutaway',subjectQuote:'Liquid',phaseQuotes:['enters the chamber','passes through narrow passages into the vessel']}};
  const folding={sceneId:'s3',endSceneId:'s4',kind:'flow',nodes:[
    {id:'a',label:'paper',symbol:'document'},{id:'b',label:'booklet',symbol:'document'}],
    visualBrief:{view:'object',subjectQuote:'paper',phaseQuotes:['folds along a crease','closes into a small booklet']}};
  const plan=await createDocumentaryConceptPlan(p,base(p),async()=>({explanations:[physical,folding]}));
  assert.equal(plan.scenes[0]!.artworkMode,undefined);
  assert.deepEqual(plan.scenes[0]!.artworkBrief,{...physical.visualBrief,endSceneId:'s1'});
  assert.equal(plan.scenes[3]!.artworkMode,undefined);
  assert.deepEqual(plan.scenes[3]!.artworkBrief,{...folding.visualBrief,endSceneId:'s4'});
  assert.equal(plan.scenes[1]!.explanation,undefined);
  assert.equal(plan.scenes[4]!.explanation,undefined);
  const prepared={...p,scenes:p.scenes.map(scene=>({...scene,documentary:{...scene.documentary!,semanticMontage:plan.scenes.find(row=>row.sceneId===scene.id)!}}))};
  const root=await mkdtemp(join(tmpdir(),'artwork-two-briefs-'));
  try{
    let calls=0;
    await createMotionArtworkPlan(prepared,root,async(_system,input)=>{
      calls++;const sent=JSON.parse(input);
      assert.deepEqual(sent.scenes.filter((row:{artworkBrief?:unknown})=>row.artworkBrief).map((row:{sceneId:string})=>row.sceneId),['s0','s3']);
      return {scenes:[]};
    },'working-model');
    assert.equal(calls,1,'two distinct opportunities share one normal drawing batch');
  }finally{await rm(root,{recursive:true,force:true});}
  const ungrounded=await createDocumentaryConceptPlan(p,base(p),async()=>({explanations:[
    {...physical,visualBrief:{...physical.visualBrief,phaseQuotes:['enters the chamber','travels through an invented filter']}}]}));
  assert.equal(ungrounded.scenes[0]!.artworkMode,undefined);
  assert.equal(ungrounded.scenes[0]!.explanation,undefined,'place-only icons are not an adequate fallback');
  const noBrief=await createDocumentaryConceptPlan(p,base(p),async()=>({explanations:[
    {sceneId:'s0',endSceneId:'s1',kind:'flow',nodes:physical.nodes}]}));
  assert.equal(noBrief.scenes[0]!.explanation,undefined);
});

test('an uncertain concept commission is never resubmitted',async()=>{
  const root=await mkdtemp(join(tmpdir(),'gws-concept-pending-'));
  try{
    const p=fixture();await cached(p,root);let calls=0;
    const request=await conceptRequest(p),key=documentaryCheckpointKey('semantic-montage',request.system,request.input,[]);
    const analysis=join(root,'Documentary','Analysis');await mkdir(analysis,{recursive:true});
    await writeFile(join(analysis,key+'.json'),JSON.stringify({state:'pending',purpose:'semantic-montage'}));
    await writeFile(join(root,'Documentary','Montage',semanticMontageHash(p)+'-concept-commission.json'),
      JSON.stringify({version:1,filmHash:semanticMontageHash(p),key,...request}));
    const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{
      calls++;throw Error('unknown concept must stay local');}},()=>root);
    await conceptFallback(intelligence,p);
    p.scenes[0]!.documentary!.pinned=true;
    await conceptFallback(intelligence,p);assert.equal(calls,0,'changed eligibility must not submit a new paid key');
  }finally{await rm(root,{recursive:true,force:true});}
});

test('rich-plan migration preserves the old paid request hash, completed plan and pending editorial receipt',async()=>{
  const root=await mkdtemp(join(tmpdir(),'gws-concept-migration-'));
  try{
    const p=fixture();let request:{system:string;input:string}|undefined;
    await assert.rejects(createSemanticMontagePlan(p,root,async(system,input)=>{request={system,input};throw Error('capture');},'source-editor'),/capture/);
    const oldHash=JSON.parse(request!.input).inputHash;assert.notEqual(oldHash,semanticMontageHash(p));
    const oldPlan={...base(p),inputHash:oldHash},oldFile=join(root,'Documentary','Montage',oldHash+'.json');await writeFile(oldFile,JSON.stringify(oldPlan));
    let concepts=0;const client={configured:async()=>true,documentaryCompletion:async(_system:string,input:string)=>{assert.equal(JSON.parse(input).motionConcepts,1);concepts++;return '{"explanations":[]}';}};
    const intel=new DocumentaryIntelligence(client,()=>root);await intel.planSemanticMontage(p);assert.equal(concepts,0);assert.equal(await readFile(oldFile,'utf8'),JSON.stringify(oldPlan));
    const guardedRoot=join(root,'pending'),analysis=join(guardedRoot,'Documentary','Analysis');await mkdir(analysis,{recursive:true});
    // The real predecessor, independent of later additions (e.g. ratio groups)
    // to the current prompt. Removing a sentence from a new prompt invents a
    // combination that was never a commissioned predecessor.
    const previousSystem=documentaryEditorialSystem.replace(documentaryExplanationSemantics,'');
    const previousInput=JSON.parse(request!.input);delete previousInput.artworkContinuations;
    for(const row of previousInput.scenes)delete row.artworkEditable;
    const key=documentaryCheckpointKey('semantic-montage',previousSystem,JSON.stringify(previousInput),[]);
    const receipt=JSON.stringify({state:'pending',purpose:'semantic-montage'});await writeFile(join(analysis,key+'.json'),receipt);
    const guarded=new DocumentaryIntelligence(client,()=>guardedRoot);await assert.rejects(guarded.planSemanticMontage(p),/Автоповтор отключён/);
    assert.equal(concepts,0);assert.equal(await readFile(join(analysis,key+'.json'),'utf8'),receipt);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('manual, pinned and Motion 0 scenes block the whole span without changing authored data',async()=>{
  for(const protection of ['manual','pinned','zero'] as const){
    const p=fixture();const d=p.scenes[8]!.documentary!;
    if(protection==='manual')d.templateOrigin='manual';if(protection==='pinned')d.pinned=true;if(protection==='zero')d.templateMotion={amountPercent:0,curve:'smooth'};
    p.scenes[7]!.documentary!.semanticMontage!.explanation=flow as never;
    assert.equal(documentaryExplanationSpans(p).size,0);
    const before=JSON.stringify(p);
    await assert.rejects(createDocumentaryConceptPlan(p,base(p),async()=>({explanations:[{sceneId:'s7',...flow}]})),/no-retry/);
    assert.equal(JSON.stringify(p),before);
  }
});

test('a confirmed two-image comparison outranks generic contrast, including across scene boundaries',async()=>{
  const p=fixture(),scene=p.scenes[0]!;scene.narration='Artists and printers made the book.';
  for(const [i,name] of [[0,'Artists'],[1,'printers']] as const)p.scenes[i]!.documentary!.visualReview={status:'accepted',viewDescription:`Portrait of ${name}`,fastRelevance:{relevant:true}} as never;
  scene.documentary!.semanticMontage!.composition={kind:'explainer',boardLayout:'compare',cards:[{label:'Artists',sceneId:'s0'},{label:'printers',sceneId:'s1'}]};
  const contrast={kind:'contrast',nodes:[{id:'a',label:'Artists',symbol:'person'},{id:'b',label:'printers',symbol:'team'}],endSceneId:'s1'};
  scene.documentary!.semanticMontage!.explanation=contrast as never;
  assert.equal(documentaryExplanationKeepsEvidence(scene,p.scenes),true);
  const plan=await createDocumentaryConceptPlan(p,base(p),async()=>({explanations:[{sceneId:'s0',...contrast}]}));
  assert.deepEqual(plan.scenes[0]!.composition,scene.documentary!.semanticMontage!.composition);
  const enriched=enrichSemanticMontage(p);assert.equal(enriched[0]!.documentary!.motionGraphic?.explanation,undefined);
  assert.equal(enriched[0]!.documentary!.motionGraphic?.cards?.length,2);assert.equal(enriched[1]!.documentary!.motionGraphic?.explanation,undefined);
});

test('covered artwork batches do not buy a replacement; pending old batches stay discoverable',async()=>{
  const root=await mkdtemp(join(tmpdir(),'gws-concept-art-'));
  try{
    const p=fixture(2);p.scenes[0]!.narration='Sunlight turns into ';p.scenes[1]!.narration='electricity through the panel.';
    p.scenes[0]!.documentary!.semanticMontage!.explanation={...flow,endSceneId:'s1'} as never;
    let calls=0;const client={configured:async()=>true,documentaryCompletion:async()=>{calls++;return '{"scenes":[]}';}};
    const intelligence=new DocumentaryIntelligence(client,()=>root);
    const artwork=await intelligence.planMotionArtwork(p);assert.equal(calls,0);assert.deepEqual(artwork.scenes,[]);
    const malicious={...artwork,scenes:[{sceneId:'s1',artwork:{} as never}]};assert.equal(attachMotionArtwork(base(p),malicious).scenes[1]!.artwork,undefined);
    // Use an independent root so a local empty cache cannot mask the orphan.
    const pendingRoot=join(root,'old');await mkdir(join(pendingRoot,'Documentary','Analysis'),{recursive:true});
    await writeFile(join(pendingRoot,'Documentary','Analysis','a'.repeat(64)+'.json'),JSON.stringify({state:'partial',purpose:'semantic-montage',raw:'lost old batch'}));
    const guarded=new DocumentaryIntelligence(client,()=>pendingRoot);
    await assert.rejects(guarded.planMotionArtwork(p),/прежнего плана/);assert.equal(calls,0);
  }finally{await rm(root,{recursive:true,force:true});}
});

async function conceptRequest(p:Project){
  let request:{system:string;input:string}|undefined;
  await createDocumentaryConceptPlan(p,base(p),async(system,input)=>{request={system,input};return {explanations:[]};});
  assert.ok(request);return request;
}

test('a durable commission reuses an older prompt and eligibility after restart, including incomplete receipts',async()=>{
  for(const state of ['complete','received','pending','partial'] as const){
    const root=await mkdtemp(join(tmpdir(),'gws-concept-identity-'));
    try{
      const p=fixture();await cached(p,root);
      const original=await conceptRequest(p),request={...original,system:original.system+' Previous commissioned wording.'};
      const key=documentaryCheckpointKey('semantic-montage',request.system,request.input,[]);
      const directory=join(root,'Documentary','Montage'),analysis=join(root,'Documentary','Analysis');await mkdir(analysis,{recursive:true});
      const manifest={version:1,filmHash:semanticMontageHash(p),key,...request};
      await writeFile(join(directory,manifest.filmHash+'-concept-commission.json'),JSON.stringify(manifest));
      const receipt={state,purpose:'semantic-montage',...(state==='complete'?{result:{explanations:[{sceneId:'s7',...flow}]}}:state==='received'?{raw:JSON.stringify({explanations:[{sceneId:'s7',...flow}]})}:state==='partial'?{raw:'{"explanations":['}:{})};
      await writeFile(join(analysis,key+'.json'),JSON.stringify(receipt));
      p.scenes[0]!.documentary!.pinned=true;
      let calls=0;const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{calls++;throw Error('must not submit');}},()=>root);
      if(state==='complete'||state==='received')assert.deepEqual((await intelligence.planSemanticMontage(p)).scenes[7]!.explanation,flow);
      else await conceptFallback(intelligence,p,/неизвестный результат/);
      assert.equal(calls,0);
      const recovered=await readFile(join(analysis,key+'.json'),'utf8');
      if(state==='received'){assert.ok('raw' in receipt);assert.equal(JSON.parse(recovered).state,'complete');assert.equal(JSON.parse(recovered).raw,receipt.raw);}
      else assert.equal(recovered,JSON.stringify(receipt));
      assert.equal(await readFile(join(directory,manifest.filmHash+'-concept-commission.json'),'utf8'),JSON.stringify(manifest));
    }finally{await rm(root,{recursive:true,force:true});}
  }
});

test('exact completed concepts win before orphan guarding, while an orphan blocks a genuinely new key',async()=>{
  for(const completed of [false,true]){
    const root=await mkdtemp(join(tmpdir(),'gws-concept-orphan-'));
    try{
      const p=fixture();await cached(p,root);const request=await conceptRequest(p);
      const analysis=join(root,'Documentary','Analysis');await mkdir(analysis,{recursive:true});
      await writeFile(join(analysis,'a'.repeat(64)+'.json'),JSON.stringify({state:'partial',purpose:'semantic-montage',raw:'older prompt response'}));
      if(completed)await writeFile(join(analysis,documentaryCheckpointKey('semantic-montage',request.system,request.input,[])+'.json'),
        JSON.stringify({state:'complete',purpose:'semantic-montage',result:{explanations:[{sceneId:'s7',...flow}]}}));
      let calls=0;const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{calls++;throw Error('must not submit');}},()=>root);
      if(completed)assert.deepEqual((await intelligence.planSemanticMontage(p)).scenes[7]!.explanation,flow);
      else await conceptFallback(intelligence,p,/неизвестный результат/);
      assert.equal(calls,0);
    }finally{await rm(root,{recursive:true,force:true});}
  }
});

test('a corrupt commission blocks submission without overwriting the saved identity',async()=>{
  const root=await mkdtemp(join(tmpdir(),'gws-concept-corrupt-'));
  try{
    const p=fixture();await cached(p,root);const file=join(root,'Documentary','Montage',semanticMontageHash(p)+'-concept-commission.json');
    await writeFile(file,'{"version":');let calls=0;
    const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{calls++;return '{}';}},()=>root);
    await conceptFallback(intelligence,p,/Повреждена привязка/);
    assert.equal(calls,0);assert.equal(await readFile(file,'utf8'),'{"version":');
  }finally{await rm(root,{recursive:true,force:true});}
});

const substantiveArtwork:DocumentaryArtwork={version:1,intent:'Show the circular motion of the mechanism',layout:'left',
  canvas:{width:960,height:540},palette:{background:'#ffffff',ink:'#111111',accent:'#ff0000',secondary:'#333333'},
  startSeconds:0,durationSeconds:4,layers:[{id:'circle',kind:'ellipse',x:40,y:60,w:200,h:200,stroke:'#111111',fill:'none',strokeWidth:3}]};

test('replanning carries bound substantive artwork past the base plan into assembly, including legacy migration',async()=>{
  for(const binding of ['current','legacy'] as const)for(const storage of ['direction','render'] as const){
    const root=await mkdtemp(join(tmpdir(),'gws-concept-preserve-'));
    try{
      const p=fixture();await cached(p,root);const d=p.scenes[8]!.documentary!;
      const legacy=structuredClone(p);legacy.settings.assembly.documentary!.autoMotionGraphics=false;
      d.semanticMontageInputHash=semanticMontageHash(binding==='legacy'?legacy:p);
      if(storage==='direction')d.semanticMontage={...d.semanticMontage!,artwork:substantiveArtwork,artworkMode:'photographic'};
      else d.motionGraphic={kind:'explainer',origin:'automatic',enabled:true,title:'',startSeconds:0,durationSeconds:4,artwork:substantiveArtwork};
      // Each storage form alone must survive, including before the first render.
      const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>JSON.stringify({explanations:[{sceneId:'s7',...flow}]})},()=>root);
      const plan=await intelligence.planSemanticMontage(p);
      assert.deepEqual(plan.scenes[8]!.artwork,substantiveArtwork);assert.equal(plan.scenes[7]!.explanation,undefined,'evidence inside the span protects all members');
      const attached=attachMotionArtwork(plan,{version:1,inputHash:'already-covered',model:'designer',scenes:[],rejected:[]});
      const assembled=enrichSemanticMontage({...p,scenes:p.scenes.map(s=>({...s,documentary:{...s.documentary!,semanticMontage:attached.scenes.find(row=>row.sceneId===s.id)}}))});
      assert.deepEqual(assembled[8]!.documentary!.motionGraphic!.artwork,substantiveArtwork);
    }finally{await rm(root,{recursive:true,force:true});}
  }
});

test('changed narration or media cannot import an old automatic drawing; manual and Motion 0 remain untouched',async()=>{
  for(const change of ['narration','media','unbound','manual','zero'] as const){
    const p=fixture(),clean=base(p),d=p.scenes[8]!.documentary!;
    d.semanticMontageInputHash=semanticMontageHash(p);
    d.semanticMontage={...d.semanticMontage!,artwork:substantiveArtwork,artworkMode:'photographic'};
    d.motionGraphic={kind:'explainer',origin:'automatic',enabled:true,title:'',startSeconds:0,durationSeconds:4,artwork:substantiveArtwork};
    if(change==='narration')p.scenes[8]!.narration='The artists finish a painting.';
    if(change==='media')p.scenes[8]!.imagePath='different-mechanism.jpg';
    if(change==='unbound')d.semanticMontageInputHash=undefined;
    if(change==='manual')d.templateOrigin='manual';
    if(change==='zero')d.templateMotion={amountPercent:0,curve:'smooth'};
    const before=JSON.stringify(p),plan=await createDocumentaryConceptPlan(p,clean,async()=>({explanations:[]}));
    if(change==='manual'||change==='zero')assert.deepEqual(plan.scenes[8],d.semanticMontage);
    else {
      assert.equal(plan.scenes[8]!.artwork,undefined);
      const assembled=enrichSemanticMontage({...p,scenes:p.scenes.map(s=>({...s,documentary:{...s.documentary!,semanticMontage:plan.scenes.find(row=>row.sceneId===s.id)}}))});
      assert.equal(assembled[8]!.documentary!.motionGraphic?.artwork,undefined,'old renderer artwork must not reappear after narration/media changes');
    }
    assert.equal(JSON.stringify(p),before);
  }
});

test('a bound photo-label decoration is not promoted to preserved substantive artwork',async()=>{
  const p=fixture(),clean=base(p),d=p.scenes[8]!.documentary!;
  d.semanticMontageInputHash=semanticMontageHash(p);
  d.semanticMontage={...d.semanticMontage!,artwork:{...substantiveArtwork,layers:[
    {id:'photo',kind:'media',x:0,y:0,w:960,h:540},
    {id:'label',kind:'text',x:100,y:400,w:600,h:60,text:'electricity'}]}};
  const plan=await createDocumentaryConceptPlan(p,clean,async()=>({explanations:[]}));
  assert.equal(plan.scenes[8]!.artwork,undefined);
});

test('a physical process reaches the existing artwork commission without a phantom graphic span',async()=>{
  const root=await mkdtemp(join(tmpdir(),'gws-concept-physical-'));
  try{
    const p=fixture(2);p.scenes[0]!.narration='The piston moves ';p.scenes[1]!.narration='the crankshaft.';
    const physical={kind:'flow',nodes:[{id:'p',label:'piston',symbol:'machine'},{id:'c',label:'crankshaft',symbol:'machine'}],endSceneId:'s1'};
    // Include an older automatic explanation, as in a resumed source plan.
    p.scenes[0]!.documentary!.semanticMontage!.explanation=physical as never;
    const before=JSON.stringify(p),plan=await createDocumentaryConceptPlan(p,base(p),async()=>({explanations:[{sceneId:'s0',...physical}]}));
    assert.equal(JSON.stringify(p),before);
    assert.equal(plan.scenes[0]!.artworkMode,undefined);assert.equal(plan.scenes[1]!.artworkMode,undefined);
    const planned={...p,scenes:p.scenes.map(s=>({...s,documentary:{...s.documentary!,semanticMontage:plan.scenes.find(r=>r.sceneId===s.id)}}))};
    assert.equal(documentaryExplanationSpans(planned).size,0);
    assert.ok(enrichSemanticMontage(planned).every(s=>!s.documentary?.motionGraphic?.explanation));
    let calls=0;
    const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(_system,input)=>{
      calls++;const payload=JSON.parse(input);assert.equal(payload.motionArtwork,1);
      assert.equal(payload.scenes[0].artworkMode,undefined);
      assert.ok(payload.scenes.every((row:{editable:boolean})=>row.editable),'a non-rendered explanation must not suppress either artwork scene');
      return '{"scenes":[]}';
    }},()=>root);
    await intelligence.planMotionArtwork(planned);assert.equal(calls,1);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('people, generic results and word-only contrasts keep the source edit; abstract stages still render',async()=>{
  for(const [kind,labels,symbols,render] of [
    ['merge',['Ada','engineers','machine'],['person','team','machine'],false],
    ['flow',['request','result'],['document','generic'],false],
    ['contrast',['power','control'],['energy','signal'],false],
    ['flow',['draft','review'],['document','document'],true],
    ['branch',['request','accept','reject'],['document','signal','signal'],true],
    ['cycle',['draft','review'],['document','document'],true],
  ] as const){
    const p=fixture(1);p.scenes[0]!.narration=labels.join(' ');
    const explanation={kind,nodes:labels.map((label,i)=>({id:`n${i}`,label,symbol:symbols[i]}))};
    p.scenes[0]!.documentary!.semanticMontage!.explanation=explanation as never;
    const plan=await createDocumentaryConceptPlan(p,base(p),async()=>({explanations:[{sceneId:'s0',...explanation}]}));
    assert.equal(Boolean(plan.scenes[0]!.explanation),render,kind+': '+labels.join('/'));
    assert.equal(plan.scenes[0]!.artworkMode,undefined);
    assert.equal(plan.scenes[0]!.treatment,'footage');
  }
});

test('physical artwork routing protects evidence anywhere in the proposed span',async()=>{
  for(const protection of ['artwork','statistic','manual','pinned','zero'] as const){
    const p=fixture(3);p.scenes[0]!.narration='The piston moves ';p.scenes[1]!.narration='the crankshaft.';p.scenes[2]!.narration='There are 10 parts.';
    const d=p.scenes[2]!.documentary!;
    if(protection==='artwork')d.semanticMontage={...d.semanticMontage!,artwork:substantiveArtwork};
    if(protection==='statistic')d.semanticMontage={...d.semanticMontage!,treatment:'statistic',emphasis:'10'};
    if(protection==='manual')d.templateOrigin='manual';
    if(protection==='pinned')d.pinned=true;
    if(protection==='zero')d.templateMotion={amountPercent:0,curve:'smooth'};
    const before=JSON.stringify(p);
    const run=()=>createDocumentaryConceptPlan(p,base(p),async()=>({explanations:[{sceneId:'s0',endSceneId:'s2',kind:'flow',nodes:[
      {id:'p',label:'piston',symbol:'machine'},{id:'c',label:'crankshaft',symbol:'machine'}]}]}));
    if(['manual','pinned','zero'].includes(protection))await assert.rejects(run,/no-retry/);
    else {
      const plan=await run();assert.equal(plan.scenes[0]!.artworkMode,undefined);
      assert.deepEqual(plan.scenes[2],d.semanticMontage);
    }
    assert.equal(JSON.stringify(p),before);
  }
});
