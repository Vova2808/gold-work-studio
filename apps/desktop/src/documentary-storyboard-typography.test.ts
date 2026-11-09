import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {DocumentarySceneDirection,Project} from '@gold-work/shared';
import {documentaryMotionPresetFor} from '@gold-work/shared';
import {planDocumentaryMontage} from './documentary-montage.js';
import {localMontageAccent} from './documentary-local-montage.js';
import {validateSceneDirection} from './documentary-scene-direction.js';
import {FileProjectRepository} from './file-project-repository.js';
import {buildDocumentaryTimeline} from '../../../packages/remotion-video/src/documentary-timeline.js';
import {documentaryEditorialStages,documentaryPhraseWordProgress,documentaryPhraseWords} from '../../../packages/remotion-video/src/documentary-editorial.js';

function direction():DocumentarySceneDirection{
  return {alternatives:[
    {id:'question',idea:'A question over the harbor',action:'Words enter',staging:'Whole harbor source'},
    {id:'quiet',idea:'A quiet harbor',action:'Source holds',staging:'No overlay'},
    {id:'reveal',idea:'A harbor reveal',action:'Source reveals the pier',staging:'Whole source in frame'}],
    selectedId:'question',reason:'The spoken question carries the decision.',storyboard:{
      entry:'The harbor remains visible.',focus:'The question and the harbor.',
      states:[{at:0,object:'harbor',change:'The whole source holds'},
        {at:.35,object:'question text',change:'Why sail enters as overlay'},
        {at:.7,object:'question and harbor',change:'The composition settles'}],
      camera:{mode:'hold',purpose:'Keep the whole harbor visible.'},depth:{mode:'flat',purpose:'No separated source layers.'},
      typography:{mode:'action',purpose:'The exact question enters and then holds.'},
      exit:'The question holds over the harbor.',join:'Cut to the decision.',sound:'none'}};
}

function project():Project{
  const narration='Why sail beyond the harbor when Mira could wait beside the old pier until morning?';
  return {id:'fictional-harbor',title:'Mira at the harbor',updatedAt:'2026-10-28T00:00:00Z',mediaMode:'stock',aspectRatio:'16:9',language:'en',
    script:narration,settings:{voice:{enabled:true},music:{enabled:true,volume:12,path:'manual-bed.wav'},
      assembly:{kenBurns:true,documentary:{version:2,autoEffects:true,autoTransitions:true,autoMotionGraphics:true,
        montage:{version:1,style:'editorial',intensity:'rich',hookSeconds:16,musicPolicy:'preserve'}}}},
    scenes:[{id:'harbor',order:0,narration,durationSeconds:6,audioPath:'mira-voice.wav',imagePath:'harbor.jpg',sourceVolume:0,
      documentary:{verified:true,candidates:[],checksum:'fictional-source-hash',layout:'full',effects:[{id:'manual-sound',kind:'audio',origin:'manual',enabled:true,path:'rope.wav',startSeconds:2,durationSeconds:.4}],
        caption:{enabled:false,text:''},timing:{sourceKey:'mira-voice',durationInFrames:180,speechSeconds:5.8},
        selected:{id:'harbor-source',kind:'image',width:1920,height:1080},requirement:{text:narration,identities:[],years:[],accent:'none'},
        semanticMontage:{sceneId:'harbor',subject:'',beat:'evidence',treatment:'footage',cutawaySceneIds:[],sceneDirection:direction()}}}]} as unknown as Project;
}

const drawing=()=>({version:1,motionCoordinates:'relative',intent:'Keep the authored lantern',layout:'full',canvas:{width:1000,height:562},
  palette:{background:'#f5f3ef',ink:'#222222',accent:'#dd4433',secondary:'#8899aa'},startSeconds:0,durationSeconds:6,
  layers:[{id:'lantern',kind:'ellipse',x:300,y:200,w:80,h:80,fill:'ink'}]} as const);

test('ordinary montage persists a literal selected entrance and executes the existing phrase phases with a readable hold',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-storyboard-type-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const p=project(),before=structuredClone(p),doc=p.scenes[0]!.documentary!;
  assert.ok(validateSceneDirection(doc.semanticMontage!.sceneDirection));assert.equal(localMontageAccent(p.scenes[0]!),undefined);
  const originalFetch=globalThis.fetch;let dispatches=0;
  globalThis.fetch=async()=>{dispatches++;throw new Error('This local application must not dispatch a provider request');};
  t.after(()=>{globalThis.fetch=originalFetch;});
  const scenes=planDocumentaryMontage(p),g=scenes[0]!.documentary!.motionGraphic!;
  assert.equal(g.kind,'key-point');assert.equal(g.title,'Why sail');assert.equal(g.variant,'marker');assert.equal(g.preset,undefined);
  assert.equal(g.startSeconds,63/30);assert.equal(g.durationSeconds,117/30);assert.equal(g.reading,undefined,'editorial cue never fabricates speech timestamps');
  assert.deepEqual(p,before,'ordinary planning does not mutate input');
  const repository=new FileProjectRepository(join(root,'projects.json'));
  await repository.save({...p,scenes});
  const reopened=(await new FileProjectRepository(join(root,'projects.json')).get(p.id))!;
  assert.deepEqual(reopened.scenes[0]!.documentary!.motionGraphic,JSON.parse(JSON.stringify(g)));
  assert.deepEqual(JSON.parse(JSON.stringify(planDocumentaryMontage(reopened))),reopened.scenes,'ordinary replan remains stable after JSON persistence');
  const timeline=buildDocumentaryTimeline(reopened),rendered=timeline.scenes[0]!.documentary!.motionGraphic!;
  assert.deepEqual([rendered.title,rendered.variant,rendered.preset,rendered.startSeconds,rendered.durationSeconds],['Why sail','marker',undefined,2.1,3.9]);
  assert.equal(documentaryMotionPresetFor(rendered),undefined,'ordinary renderer dispatch reaches DocumentaryMotionGraphic → DocumentaryPhrase, not a preset');
  assert.equal(rendered.artwork,undefined);assert.equal(rendered.explanation,undefined);assert.equal(rendered.diagram,undefined);
  const start=Math.round(rendered.startSeconds*30),frames=Math.round(rendered.durationSeconds*30),words=documentaryPhraseWords(rendered.title);
  const phases=Array.from({length:180},(_,frame)=>{
    const local=frame-start,active=local>=0&&local<frames;
    return {frame,active,local,words:active?words.map((_,i)=>documentaryPhraseWordProgress(local,frames,i,words.length)):[],
      settle:active?documentaryEditorialStages(local,frames).settle:0,
      opacity:active?Math.max(0,Math.min(1,(frames-local)/Math.max(1,Math.min(8,frames*.08)))):0};
  });
  assert.equal(phases[62]!.active,false);assert.deepEqual(phases[63]!.words,[0,0]);
  assert.ok(phases[70]!.words[0]!>phases[70]!.words[1]!,'existing word entrance is staggered');
  const readable=phases.filter(phase=>phase.active&&phase.words.every(value=>value===1)&&phase.settle===1&&phase.opacity===1);
  assert.ok(readable.length/30>=2.4,'after the entrance, the complete question holds steadily before fade');
  assert.deepEqual([readable[0]!.frame,readable.at(-1)!.frame],[99,172]);
  for(const scene of reopened.scenes){const original=before.scenes.find(s=>s.id===scene.id)!;
    for(const key of ['narration','durationSeconds','audioPath','imagePath','videoPath','sourceVolume','trimStartSeconds','trimEndSeconds','playbackRate'] as const)
      assert.deepEqual(scene[key],original[key],key);
    for(const key of ['selected','checksum','timing','effects'] as const)assert.deepEqual(scene.documentary![key],original.documentary![key],key);
    assert.deepEqual(scene.documentary!.semanticMontage!.sceneDirection,original.documentary!.semanticMontage!.sceneDirection,'selected hold/depth and all storyboard states');
  }
  assert.deepEqual(reopened.settings,before.settings);assert.equal((reopened as Project&{script:string}).script,(before as Project&{script:string}).script);
  assert.equal(dispatches,0);
  const evidence=process.env.GWS_STORYBOARD_EVIDENCE_DIR;
  if(evidence){await mkdir(evidence,{recursive:true});await writeFile(join(evidence,'fictional-applied-project.json'),JSON.stringify(reopened,null,2));
    await writeFile(join(evidence,'fictional-phrase-phases.json'),JSON.stringify({start,frames,readableFrames:readable.length,providerDispatches:dispatches,revisionDispatches:0,phases},null,2));
    await writeFile(join(evidence,'fictional-persisted-registry.json'),await readFile(join(root,'projects.json')));}
});

const controls:Array<[string,(p:Project)=>void]>=[
  ['label',p=>{p.scenes[0]!.documentary!.semanticMontage!.sceneDirection!.storyboard.typography.mode='label';}],
  ['invalid selection',p=>{p.scenes[0]!.documentary!.semanticMontage!.sceneDirection!.selectedId='missing';}],
  ['nonliteral',p=>{p.scenes[0]!.documentary!.semanticMontage!.sceneDirection!.storyboard.states[1]!.change='Why sail toward the city enters as overlay';}],
  ['conflicting quoted object',p=>{p.scenes[0]!.documentary!.semanticMontage!.sceneDirection!.storyboard.states[1]!.object='question text “Why wait”';}],
  ['no explicit entrance',p=>{p.scenes[0]!.documentary!.semanticMontage!.sceneDirection!.storyboard.states[1]!.change='“Why sail” holds quietly';}],
  ['partial word',p=>{p.scenes[0]!.narration='Why sailor Mira waited beside the old pier until the morning light reached the harbor.';}],
  ['repeated narration',p=>{p.scenes[0]!.narration+=' Why sail';}],
  ['ambiguous states',p=>{p.scenes[0]!.documentary!.semanticMontage!.sceneDirection!.storyboard.states[2]={at:.7,object:'question text',change:'Why sail appears'};}],
  ['nontext object',p=>{p.scenes[0]!.documentary!.semanticMontage!.sceneDirection!.storyboard.states[1]!.object='boat';}],
  ['no window',p=>{p.scenes[0]!.documentary!.timing!.durationInFrames=90;p.scenes[0]!.durationSeconds=3;}],
  ['late entrance',p=>{const s=p.scenes[0]!.documentary!.semanticMontage!.sceneDirection!.storyboard.states;s[1]!.at=.75;s[2]!.at=.8;}],
  ['drawing',p=>{p.scenes[0]!.documentary!.semanticMontage!.artwork=structuredClone(drawing()) as never;}],
  ['drawing commission',p=>{p.scenes[0]!.documentary!.semanticMontage!.artworkBrief={view:'object',subjectQuote:'Why sail',phaseQuotes:[]};}],
  ['calm',p=>{p.settings.assembly.documentary!.montage!.intensity='calm';}],
  ['clean',p=>{p.settings.assembly.documentary!.montage!.style='clean';}],
  ['automatic graphics off',p=>{p.settings.assembly.documentary!.autoMotionGraphics=false;}],
  ['composition',p=>{p.scenes[0]!.documentary!.semanticMontage!.composition={kind:'key-point',title:'beyond the harbor'};}],
  ['emphasis',p=>{p.scenes[0]!.documentary!.semanticMontage!.emphasis='beyond the harbor';}],
  ['local accent',p=>{p.scenes[0]!.narration='In 1987 Mira waited beside the old pier until the morning light reached the harbor. Why sail';}],
  ['pinned',p=>{p.scenes[0]!.documentary!.pinned=true;}],
  ['manual',p=>{p.scenes[0]!.documentary!.motionGraphic={kind:'key-point',origin:'manual',enabled:true,title:'My caption',startSeconds:.2,durationSeconds:2};}],
  ['existing automatic accent',p=>{p.scenes[0]!.documentary!.motionGraphic={kind:'key-point',origin:'automatic',variant:'marker',enabled:true,title:'beside the old pier',startSeconds:.2,durationSeconds:2};}],
  ['existing automatic drawing',p=>{p.scenes[0]!.documentary!.motionGraphic={kind:'explainer',origin:'automatic',enabled:true,title:'',startSeconds:0,durationSeconds:6,artwork:structuredClone(drawing()) as never};}],
];
for(const [name,mutate] of controls)test(`storyboard bridge leaves the ordinary fallback unchanged: ${name}`,()=>{
  const p=project();mutate(p);const before=structuredClone(p),baseline=structuredClone(p);
  delete baseline.scenes[0]!.documentary!.semanticMontage!.sceneDirection;
  const actual=planDocumentaryMontage(p),expected=planDocumentaryMontage(baseline);
  assert.deepEqual(actual[0]!.documentary!.motionGraphic,expected[0]!.documentary!.motionGraphic);
  assert.deepEqual(p,before);
});

test('literal quoted and Cyrillic entrances use the same existing phrase route',()=>{
  for(const [title,narration,change] of [
    ['Why sail',project().scenes[0]!.narration,'“Why sail” appears over the source'],
    ['Зачем плыть','Зачем плыть за пределы гавани когда Мира может ждать возле старого причала до самого утра?','Зачем плыть появляется поверх кадра'],
  ]){const p=project();p.scenes[0]!.narration=narration!;p.scenes[0]!.documentary!.semanticMontage!.sceneDirection!.storyboard.states[1]!.change=change!;
    const graphic=planDocumentaryMontage(p)[0]!.documentary!.motionGraphic!;
    assert.equal(graphic.title,title);assert.equal(graphic.startSeconds,2.1);assert.equal(graphic.variant,'marker');}
});

function expectOrdinaryFallback(p:Project,label:string){
  const before=structuredClone(p),baseline=structuredClone(p);
  assert.equal(localMontageAccent(p.scenes[0]!),undefined,label+' must isolate the storyboard bridge');
  delete baseline.scenes[0]!.documentary!.semanticMontage!.sceneDirection;
  assert.deepEqual(planDocumentaryMontage(p)[0]!.documentary!.motionGraphic,planDocumentaryMontage(baseline)[0]!.documentary!.motionGraphic,label);
  assert.deepEqual(p,before,label+' preserves the input');
}

test('unquoted negated or ambiguous entrance operations fail closed while quoted operation words stay literal',()=>{
  for(const [narration,change] of [
    ['Quiet water does not appear beneath the pier before the sailors return to the harbor after dawn.','Quiet water does not appear on screen'],
    ['Do not enter the harbor before the sailors return to the pier beneath the old lighthouse after dawn.','Do not enter appears above the source'],
    ['Enter the harbor before the sailors return to the pier beneath the old lighthouse after dawn.','Enter the harbor appears above the source'],
    ['Quiet water never appears beneath the pier before the sailors return to the harbor after dawn.','Quiet water never appears on screen'],
    ["Quiet water doesn't appear beneath the pier before the sailors return to the harbor after dawn.","Quiet water doesn't appear on screen"],
    ['Тихая вода не появляется под причалом пока моряки возвращаются в гавань возле старого маяка после рассвета.','Тихая вода не появляется на экране'],
  ]){const p=project();p.scenes[0]!.narration=narration!;
    p.scenes[0]!.documentary!.semanticMontage!.sceneDirection!.storyboard.states[1]!.change=change!;
    expectOrdinaryFallback(p,change!);}
  for(const quotes of [['"','"'],['“','”'],['«','»']]){
    const p=project();p.scenes[0]!.narration='Do not enter the harbor before the sailors return to the pier beneath the old lighthouse after dawn.';
    p.scenes[0]!.documentary!.semanticMontage!.sceneDirection!.storyboard.states[1]!.change=quotes[0]+'Do not enter'+quotes[1]+' appears above the source';
    const graphic=planDocumentaryMontage(p)[0]!.documentary!.motionGraphic!;
    assert.equal(graphic.title,'Do not enter');assert.equal(graphic.variant,'marker');assert.equal(graphic.startSeconds,2.1);
  }
});

test('literal narration boundaries inspect complete Unicode code points and preserve exact case',()=>{
  for(const [side,adjacent] of [['before','\u{10400}'],['after','\u{10400}'],['after','\u{1D7CE}'],['before','\u{1D7CE}'],
    ['before','X'],['after','X'],['before','\u0301'],['after','\u0301']]){
    const p=project();p.scenes[0]!.narration=p.scenes[0]!.narration.replace('Why sail',side==='before'?adjacent+'Why sail':'Why sail'+adjacent);
    expectOrdinaryFallback(p,side+' '+adjacent);
  }
  const wrongCase=project();wrongCase.scenes[0]!.narration=wrongCase.scenes[0]!.narration.replace('Why sail','why sail');
  expectOrdinaryFallback(wrongCase,'case mismatch');
  for(const narration of ['\u{1F30A}Why sail beyond the harbor when Mira could wait beside the old pier until morning?',
    'Why sail\u{1F30A} beyond the harbor when Mira could wait beside the old pier until morning?']){
    const p=project();p.scenes[0]!.narration=narration;
    assert.equal(planDocumentaryMontage(p)[0]!.documentary!.motionGraphic!.title,'Why sail','astral punctuation is still a boundary');
  }
});

test('only the exact enabled plain bridge payload can be reused after ordinary persistence',()=>{
  const own=planDocumentaryMontage(project())[0]!.documentary!.motionGraphic!;
  for(const payload of [{enabled:false},{value:'Existing value',highlight:'sail',accentColor:'#112233',showSource:false},
    {value:'Existing value'},{highlight:'sail'},{accentColor:'#112233'},{showSource:false},{startSeconds:.5},{durationSeconds:3},
    {kicker:'Existing kicker'},{items:['Existing item']},{theme:'paper'},{sourceChecksum:'a-different-source'},{customPayload:'unsupported'}]){
    const p=project();p.scenes[0]!.documentary!.motionGraphic={...own,...payload} as typeof own;
    expectOrdinaryFallback(p,JSON.stringify(payload));
  }
  const disabled=project();disabled.scenes[0]!.documentary!.motionGraphic={kind:'key-point',origin:'automatic',variant:'marker',enabled:false,title:'Why sail',startSeconds:.5,durationSeconds:3};
  expectOrdinaryFallback(disabled,'minimal disabled marker from review');
  const p=project();p.scenes[0]!.documentary!.motionGraphic=JSON.parse(JSON.stringify(own));
  assert.deepEqual(JSON.parse(JSON.stringify(planDocumentaryMontage(p)[0]!.documentary!.motionGraphic)),JSON.parse(JSON.stringify(own)));
});
