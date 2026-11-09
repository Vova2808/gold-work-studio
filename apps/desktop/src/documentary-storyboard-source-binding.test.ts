import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {DocumentarySceneDirection,Project} from '@gold-work/shared';
import {documentaryAiPlanContext,documentaryMotionPresetFor} from '@gold-work/shared';
import {createSemanticMontagePlan,montageReplacementSources,montageCutawaySources,validateMontageDirections,semanticMontageHash} from './documentary-semantic-montage.js';
import {documentarySceneDirectionSystem} from './documentary-scene-direction.js';
import {planDocumentaryMontage} from './documentary-montage.js';
import {FileProjectRepository} from './file-project-repository.js';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {buildDocumentaryTimeline} from '../../../packages/remotion-video/src/documentary-timeline.js';
import {documentaryEditorialStages,documentaryPhraseWordProgress,documentaryPhraseWords} from '../../../packages/remotion-video/src/documentary-editorial.js';

function direction(action=true):DocumentarySceneDirection{
  return {alternatives:[{id:'portrait',idea:'A person considers the question',action:'Words enter over a portrait',staging:'Whole accepted portrait'},
    {id:'wide',idea:'Two surveyors wait',action:'A wide source holds',staging:'Whole accepted wide shot'},
    {id:'sea',idea:'The harbor remains quiet',action:'Waves continue',staging:'Original source'}],selectedId:'portrait',reason:'The spoken decision concerns a person.',
    storyboard:{entry:'The whole portrait is visible.',focus:'The person and the question.',
      states:[{at:0,object:'portrait',change:'The whole source holds'}, {at:.35,object:'question text',change:'Why stay enters as overlay'},
        {at:.7,object:'portrait and question',change:'The composition settles'}],camera:{mode:'hold',purpose:'Keep the whole person visible.'},
      depth:{mode:'flat',purpose:'No source separation.'},typography:{mode:action?'action':'none',purpose:'The exact question enters and holds.'},
      exit:'The source holds.',join:'Cut to the decision.',sound:'none'}};
}
function project():Project{
  const narration='Why stay beside the harbor when Mira could sail beyond the old pier before morning?';
  const scenes=['harbor','portrait','wide','context-only'].map((id,order)=>({id,order,narration:order===0?narration:'Mira watched the harbor.',durationSeconds:4.3,
    includeInAssembly:order!==3,audioPath:`voice-${id}.wav`,imagePath:order===0?undefined:`${id}.jpg`,videoPath:order===0?'waves.mp4':undefined,
    sourceVolume:0,documentary:{verified:true,pinned:order>0,illustrative:true,candidates:[],checksum:`hash-${id}`,layout:'full',
      effects:[{id:`sfx-${id}`,kind:'audio',origin:'manual',enabled:true,filePath:'rope.wav',startSeconds:2,durationSeconds:.4}],caption:{enabled:false,text:''},
      timing:{sourceKey:`voice-${id}`,durationInFrames:129,speechSeconds:4.2},selected:{id:`selected-${id}`,kind:order===0?'video':'image',width:order===1?900:1920,height:order===1?1200:1080,durationSeconds:12},
      visualReview:{status:'accepted',viewDescription:order===1?'Mira stands alone beside the old pier.':order===2?'Mira and another surveyor stand together beside a beacon.':'Waves move beside the harbor.'},
      requirement:{text:order===0?narration:'Mira watched the harbor.',identities:[{name:'Mira'}],years:[1974],accent:'none'}}}));
  return {id:'fictional-source-binding',title:'Mira at the harbor',topic:'A fictional decision',updatedAt:'2026-10-28T00:00:00Z',mediaMode:'stock',aspectRatio:'16:9',language:'en',
    script:scenes.map(s=>s.narration).join('\n'),videoBrief:{readyScript:scenes.map(s=>s.narration).join('\n')},
    settings:{voice:{enabled:true},music:{enabled:true,path:'manual-bed.wav',volume:12},assembly:{kenBurns:true,documentary:{version:2,autoEffects:true,autoTransitions:true,autoMotionGraphics:true,
      montage:{version:1,style:'editorial',intensity:'rich',hookSeconds:16,musicPolicy:'preserve'}}}},scenes} as unknown as Project;
}
const canonical=(value:unknown)=>JSON.parse(JSON.stringify(value));
function bind(p:Project,source='portrait'){
  p.scenes[0]!.documentary!.semanticMontage={sceneId:'harbor',subject:'',beat:'evidence',treatment:'footage',cutawayMode:'replace',cutawaySceneIds:[source],sceneDirection:direction()};
  return p;
}
function assertPreserved(before:Project,after:Project){
  assert.deepEqual(after.settings,before.settings);assert.deepEqual(after.videoBrief,before.videoBrief);
  assert.deepEqual((after as Project&{script:string}).script,(before as Project&{script:string}).script);
  for(const [i,scene] of after.scenes.entries()){
    const original=before.scenes[i]!;
    for(const key of ['narration','durationSeconds','durationOverrideSeconds','audioPath','imagePath','videoPath','sourceVolume','trimStartSeconds','trimEndSeconds','playbackRate'] as const)assert.deepEqual(scene[key],original[key],key);
    for(const key of ['selected','checksum','timing','effects'] as const)assert.deepEqual(scene.documentary![key],original.documentary![key],key);
  }
}

for(const source of ['portrait','wide'])test(`ordinary mock model → alias → persisted full ${source} source with existing phrase clock`,async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-source-binding-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const p=project(),before=structuredClone(p);let mockCalls=0;
  const originalFetch=globalThis.fetch;let dispatches=0;globalThis.fetch=async()=>{dispatches++;throw Error('Local regression forbids provider/revision dispatch');};t.after(()=>{globalThis.fetch=originalFetch;});
  const plan=await createSemanticMontagePlan(p,root,async(system,input)=>{
    mockCalls++;assert.ok(system.endsWith(documentarySceneDirectionSystem));assert.ok(system.includes('cutawayMode:"replace"'));
    const payload=JSON.parse(input),lead=payload.scenes[0];assert.deepEqual(lead.replacementSources,['s1','s2']);
    assert.ok(!payload.sources.some((s:{id:string})=>s.id==='context-only'||s.id==='s3'));
    assert.ok(payload.storyContext.contextScenes.some((s:{sceneId:string})=>s.sceneId==='context-only'),'textual context does not authorize media');
    return {scenes:payload.scenes.map((row:{sceneId:string},i:number)=>({sceneId:row.sceneId,subject:'',beat:'evidence',treatment:'footage',
      cutawaySceneIds:i===0?[source==='portrait'?'s1':'s2']:[],...(i===0?{cutawayMode:'replace'}:{}),sceneDirection:direction(i===0)}))};
  },'explicitly-mocked-model');
  assert.equal(mockCalls,1);assert.equal(plan.scenes[0]!.cutawayMode,'replace');assert.deepEqual(plan.scenes[0]!.cutawaySceneIds,[source]);
  const repository=new FileProjectRepository(join(root,'projects.json'));await repository.save(p);
  await repository.mutate(p.id,current=>({...current,scenes:planDocumentaryMontage({...current,scenes:current.scenes.map(scene=>({...scene,documentary:{...scene.documentary!,semanticMontage:plan.scenes.find(row=>row.sceneId===scene.id),semanticMontageInputHash:plan.inputHash}}))})}));
  const reopened=(await new FileProjectRepository(join(root,'projects.json')).get(p.id))!;
  assert.deepEqual(canonical(planDocumentaryMontage(reopened)),reopened.scenes,'ordinary replan is stable');
  const target=reopened.scenes[0]!,cuts=target.documentary!.cuts!,graphic=target.documentary!.motionGraphic!;
  assert.deepEqual(cuts.map(c=>[c.sourceSceneId,c.fromFrame,c.durationInFrames]),[[source,0,129]]);
  assert.deepEqual([graphic.title,graphic.startSeconds,graphic.durationSeconds],['Why stay',1.5,2.8]);
  assert.equal(graphic.artwork,undefined);assert.equal(documentaryMotionPresetFor(graphic),undefined);
  const timeline=buildDocumentaryTimeline(reopened),rendered=timeline.scenes[0]!,cut=rendered.documentary!.cuts![0]!;
  assert.equal(cut.imagePath,`${source}.jpg`);assert.equal(cut.videoPath,undefined);assert.equal(cut.width,source==='portrait'?900:1920);
  assert.equal(rendered.audioPath,'voice-harbor.wav');assert.equal(rendered.durationInFrames,129);
  const words=documentaryPhraseWords(graphic.title),phases=Array.from({length:84},(_,frame)=>({frame:frame+45,
    words:words.map((_,i)=>documentaryPhraseWordProgress(frame,84,i,words.length)),settle:documentaryEditorialStages(frame,84).settle,
    opacity:Math.min(1,(84-frame)/Math.min(8,84*.08))}));
  const readable=phases.filter(p=>p.words.every(v=>v===1)&&p.settle===1&&p.opacity===1);
  assert.deepEqual([readable[0]!.frame,readable.at(-1)!.frame,readable.length],[77,122,46]);
  assertPreserved(before,reopened);assert.deepEqual(p,before);assert.equal(dispatches,0);
  const evidence=process.env.GWS_SOURCE_BINDING_EVIDENCE_DIR;
  if(evidence){await mkdir(evidence,{recursive:true});await writeFile(join(evidence,`${source}-project.json`),JSON.stringify(reopened,null,2));
    await writeFile(join(evidence,`${source}-phases.json`),JSON.stringify({mockCalls,providerDispatches:dispatches,readableFrames:readable.length,phases},null,2));}
  const unavailable=structuredClone(reopened);unavailable.scenes.find(s=>s.id===source)!.documentary!.verified=false;
  const fallback=planDocumentaryMontage(unavailable)[0]!;
  assert.ok(!fallback.documentary!.cuts?.some(c=>c.sourceSceneId===source),'reopen source availability is revalidated, no stale automatic cut');
  const changed=structuredClone(reopened),changedSource=changed.scenes.find(s=>s.id===source)!;
  changedSource.imagePath='different-accepted-image.jpg';changedSource.documentary!.checksum='new-material-checksum';
  const stale=planDocumentaryMontage(changed)[0]!;
  assert.equal(stale.documentary!.cuts,undefined,'existing input fingerprint prevents silently rebinding the saved primary ID to changed media');
  assert.equal(stale.documentary!.semanticMontage!.cutawayMode,undefined);
  assert.deepEqual(stale.documentary!.motionGraphic,graphic,'the independent literal phrase payload survives source invalidation');
});

const typographySettings:Array<[string,(p:Project)=>void]>=[
  ['automatic graphics off',p=>{p.settings.assembly.documentary!.autoMotionGraphics=false;}],
  ['clean style',p=>{p.settings.assembly.documentary!.montage!.style='clean';}],
  ['calm intensity',p=>{p.settings.assembly.documentary!.montage!.intensity='calm';}],
];
for(const [name,configure] of typographySettings)test(`replacement respects existing typography settings: ${name}`,()=>{
  const p=bind(project());configure(p);
  p.scenes[0]!.documentary!.semanticMontageInputHash=semanticMontageHash(p);
  const before=structuredClone(p),control=structuredClone(p);
  control.scenes[0]!.documentary!.semanticMontage!.cutawayMode=undefined;
  assert.equal(planDocumentaryMontage(control)[0]!.documentary!.motionGraphic,undefined,'ordinary no-mode policy');
  const scenes=planDocumentaryMontage(p),target=scenes[0]!;
  assert.deepEqual(target.documentary!.cuts!.map(c=>[c.sourceSceneId,c.fromFrame,c.durationInFrames]),[['portrait',0,129]],'settings suppress new text without suppressing a valid source binding');
  assert.equal(target.documentary!.motionGraphic,undefined);
  const applied={...p,scenes};
  assert.deepEqual(canonical(planDocumentaryMontage(applied)),canonical(scenes),'replan retains the source and the settings decision');
  assertPreserved(before,applied);assert.deepEqual(p,before);
});

test('default automatic graphics retain exact replacement phrase timing and stable replan',()=>{
  const p=bind(project());delete p.settings.assembly.documentary!.autoMotionGraphics;
  p.scenes[0]!.documentary!.semanticMontageInputHash=semanticMontageHash(p);
  const before=structuredClone(p),scenes=planDocumentaryMontage(p),graphic=scenes[0]!.documentary!.motionGraphic!;
  assert.deepEqual([graphic.title,graphic.startSeconds,graphic.durationSeconds],['Why stay',45/30,84/30]);
  assert.deepEqual(scenes[0]!.documentary!.cuts!.map(c=>[c.sourceSceneId,c.fromFrame,c.durationInFrames]),[['portrait',0,129]]);
  assert.deepEqual(canonical(planDocumentaryMontage({...p,scenes})),canonical(scenes));
  assertPreserved(before,{...p,scenes});assert.deepEqual(p,before);
});

for(const [setting,configure] of typographySettings)for(const priority of ['manual','pinned','disabled','rich','artwork'] as const)test(`typography ${setting} preserves existing ${priority} priority`,()=>{
  const p=bind(project());configure(p);const doc=p.scenes[0]!.documentary!;
  doc.motionGraphic={kind:'key-point',enabled:priority!=='disabled',title:'Why stay',variant:'marker',origin:priority==='manual'?'manual':'automatic',startSeconds:1.5,durationSeconds:2.8};
  if(priority==='pinned')doc.pinned=true;
  if(priority==='rich')doc.motionGraphic.value='Keep this authored value';
  if(priority==='artwork')doc.motionGraphic.artwork={version:1,layout:'full',layers:[{id:'person',kind:'ellipse',x:200,y:200,w:60,h:60}]} as never;
  doc.semanticMontageInputHash=semanticMontageHash(p);
  const before=structuredClone(p);
  assert.deepEqual(planDocumentaryMontage(p)[0],before.scenes[0]);assert.deepEqual(p,before);
});

const sourceControls:Array<[string,(p:Project)=>void]>=[
  ['unknown ID',p=>{p.scenes[0]!.documentary!.semanticMontage!.cutawaySceneIds=['missing'];}],
  ['excluded context',p=>{p.scenes[1]!.includeInAssembly=false;}],['unselected',p=>{p.scenes[1]!.documentary!.selected=undefined;}],
  ['unusable',p=>{p.scenes[1]!.documentary!.verified=false;}],['rejected',p=>{p.scenes[1]!.documentary!.visualReview!.status='rejected';}],
  ['native fallback',p=>{p.scenes[1]!.documentary!.nativeFallback={} as never;}],
  ['no local media',p=>{p.scenes[1]!.imagePath=undefined;}],['non illustrative',p=>{p.scenes[1]!.documentary!.illustrative=false;}],
  ['short reviewed interval',p=>{const s=p.scenes[1]!;s.imagePath=undefined;s.videoPath='short.mp4';s.documentary!.selected!.kind='video';s.documentary!.selected!.durationSeconds=.2;s.trimEndSeconds=.2;}],
  ['duplicate IDs',p=>{p.scenes[0]!.documentary!.semanticMontage!.cutawaySceneIds=['portrait','portrait'];}],
  ['multiple IDs',p=>{p.scenes[0]!.documentary!.semanticMontage!.cutawaySceneIds=['portrait','wide'];}],
  ['composition',p=>{p.scenes[0]!.documentary!.semanticMontage!.composition={kind:'key-point',title:'Why stay'};}],
  ['artwork commission',p=>{p.scenes[0]!.documentary!.semanticMontage!.artworkBrief={view:'object',subjectQuote:'Mira',phaseQuotes:['Why stay','Mira could sail']};}],
  ['footage issue',p=>{const s=p.scenes[1]!,d=s.documentary!;d.verified=false;s.narration='A motorcycle waits.';d.requirement.detail='motorcycle';
    Object.assign(d.selected!,{provider:'local',rights:'user-confirmed',localPath:s.imagePath,title:'a car waits'});
    d.manualReview={version:1,status:'pending',provider:'local',candidateId:d.selected!.id,kind:'image',checksum:d.checksum!,narration:s.narration,mediaPath:s.imagePath!,reason:'approximate local material'} as never;}],
];
for(const [name,change] of sourceControls)test(`replacement fails closed: ${name}`,()=>{
  const p=bind(project());change(p);const before=structuredClone(p),lead=p.scenes[0]!;
  const validated=validateMontageDirections({scenes:[lead.documentary!.semanticMontage]},[lead],p.scenes,p)[0]!;
  assert.equal(validated.cutawayMode,undefined);
  const result=planDocumentaryMontage(p)[0]!;
  const cuts=result.documentary!.cuts;
  assert.ok(!(cuts?.length===1&&cuts[0]!.sourceSceneId==='portrait'&&cuts[0]!.durationInFrames===129));
  assert.deepEqual(p,before);
});

for(const name of ['pinned','Motion0','caption','manual template','manual cuts','manual graphic','disabled marker','rich marker','authored drawing'] as const)test(`replacement preserves ${name}`,()=>{
  const p=bind(project()),d=p.scenes[0]!.documentary!;
  if(name==='pinned')d.pinned=true;
  else if(name==='Motion0')d.templateMotion={amountPercent:0,curve:'smooth'};
  else if(name==='caption')d.caption={...d.caption,enabled:true,text:'Keep this authored caption'};
  else if(name==='manual template'){d.template='full';d.templateOrigin='manual';}
  else if(name==='manual cuts'){d.cutsOrigin='manual';d.cuts=[{id:'manual',fromFrame:0,durationInFrames:129,trimStartSeconds:0,playbackRate:1}];}
  else{d.motionGraphic={kind:'key-point',enabled:name!=='disabled marker',title:'Why stay',variant:'marker',origin:name==='manual graphic'?'manual':'automatic',startSeconds:1.5,durationSeconds:2.8};
    if(name==='rich marker')d.motionGraphic.value='keep this authored value';
    if(name==='authored drawing')d.motionGraphic.artwork={version:1,layout:'full',layers:[{id:'person',kind:'ellipse',x:200,y:200,w:60,h:60}]} as never;
  }
  const before=structuredClone(p),result=planDocumentaryMontage(p)[0]!;
  assert.deepEqual(result,before.scenes[0]);assert.deepEqual(p,before);
});

test('catalog does not broaden ordinary cuts; legacy mode and no-mode retain their carriers',()=>{
  const p=bind(project()),lead=p.scenes[0]!,ordinary=montageCutawaySources(lead,p.scenes).map(s=>s.id);
  assert.deepEqual(montageReplacementSources(lead,p.scenes).map(s=>s.id),['portrait','wide']);
  assert.deepEqual(montageCutawaySources(lead,p.scenes).map(s=>s.id),ordinary);
  lead.documentary!.semanticMontage!.sceneDirection=undefined;
  const legacy=planDocumentaryMontage(p)[0]!;assert.deepEqual(legacy.documentary!.cuts?.map(c=>c.sourceSceneId),['portrait']);assert.equal(legacy.documentary!.motionGraphic,undefined);
  lead.documentary!.semanticMontage!.cutawayMode=undefined;
  const fallback=planDocumentaryMontage(p)[0]!;assert.equal(fallback.documentary!.cuts![0]!.sourceSceneId,'harbor');
});

// These keys were captured by executing the frozen pre-increment source on
// this fictional input. They are not hashes of the implementation under test.
const previousKeys={compact:'35442fb8aee6c1a60e7bdddff198779e5d14d8af9685dbee67b83e563d86a62e',
  legacy64:'98d59406ee5eb3519db4ffa4fc93ff2b75ee6275b878538bb42b7aeb95018fcd',
  'pre-direction':'eec39ee8f55c1ee7a099d12e2a267f61421bdf7dd69f9b66ae7782917fab7312'};
for(const strategy of ['compact','legacy64','pre-direction'] as const)for(const state of ['complete','pending','partial'] as const)test(`exact pre-increment ${strategy} ${state} receipt makes zero provider submissions`,async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-binding-receipt-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const p=project(),key=previousKeys[strategy],storyContext=documentaryAiPlanContext(p);
  const directory=join(root,'replay');await mkdir(join(directory,'Documentary/Analysis'),{recursive:true});
  const result={scenes:p.scenes.filter(s=>s.includeInAssembly!==false).map((_,index)=>({sceneId:`s${index}`,subject:'',beat:'evidence',treatment:'footage',cutawaySceneIds:[],sceneDirection:direction(false)}))};
  const receipt=JSON.stringify({state,purpose:'semantic-montage',...(state==='complete'?{result}:{})});
  await writeFile(join(directory,'Documentary/Analysis',key+'.json'),receipt);
  if(strategy!=='legacy64'){await mkdir(join(directory,'Documentary/Montage'),{recursive:true});
    await writeFile(join(directory,'Documentary/Montage',semanticMontageHash(p)+'-batches.json'),JSON.stringify({version:2,inputHash:semanticMontageHash(p),storyContext}));}
  let submissions=0;const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryQueryModel:async()=>'mock',
    documentaryCompletion:async()=>{submissions++;throw Error('must never dispatch');}},()=>directory);
  if(state==='complete'){const plan=await intelligence.planSemanticMontage(p);assert.equal(plan!.scenes.length,3);}
  else await assert.rejects(intelligence.planSemanticMontage(p),/Автоповтор отключён|повторный платный запрос не отправлен|Этот платный запрос не повторяется/u);
  assert.equal(submissions,0);assert.equal(await readFile(join(directory,'Documentary/Analysis',key+'.json'),'utf8'),receipt);
});

test('a historical montage receipt for different selected media cannot replace the fresh request',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-binding-changed-media-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const p=project(),directory=join(root,'Documentary','Analysis');
  await mkdir(directory,{recursive:true});
  await writeFile(join(directory,previousKeys.compact+'.json'),JSON.stringify({state:'pending',purpose:'semantic-montage'}));
  p.scenes[0]!.documentary!.checksum='different-media-at-same-path';
  await assert.rejects(createSemanticMontagePlan(p,root,async(system,input)=>{
    assert.match(system,/nodes:\[\{id,label,symbol,objectType\?\}\]/u);
    assert.equal(JSON.parse(input).scenes[0].sceneId,'s0');
    throw Error('captured fresh request locally');
  },'mock'),/captured fresh request locally/);
});
