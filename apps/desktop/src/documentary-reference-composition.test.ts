import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {DocumentaryMontageComposition,Project} from '@gold-work/shared';
import {createSemanticMontagePlan,enrichSemanticMontage,semanticMontageHash,validateMontageDirections,validateMusicSections} from './documentary-semantic-montage.js';
import {documentaryCheckpointKey} from './documentary-checkpoint-key.js';

function project(narration:string):Project{
  return {id:'reference-test',mediaMode:'stock',language:'en',settings:{voice:{enabled:true},assembly:{kenBurns:true,documentary:{version:2,
    autoMotionGraphics:true,montage:{version:1,style:'editorial',intensity:'rich'}}}},scenes:[{id:'a',order:0,narration,durationSeconds:10,
      audioPath:'voice.wav',imagePath:'source.jpg',documentary:{verified:true,checksum:'source',layout:'full',caption:{enabled:false,text:''},effects:[],
        requirement:{text:narration,identities:[{name:'Rossi'},{name:'Honda'},{name:'Yamaha'}]},
        timing:{sourceKey:'voice-key',durationInFrames:303,speechSeconds:10},selected:{id:'source',kind:'image',width:1920,height:1080}}}]} as unknown as Project;
}
function directed(p:Project,composition?:DocumentaryMontageComposition){
  const directions=validateMontageDirections({scenes:p.scenes.map(scene=>({sceneId:scene.id,subject:'',beat:'explain',treatment:'footage',cutawaySceneIds:[],composition}))},p.scenes,p.scenes,p);
  p.scenes=p.scenes.map((scene,i)=>({...scene,documentary:{...scene.documentary!,semanticMontage:directions[i]}}));
  return enrichSemanticMontage(p)[0]!.documentary!.motionGraphic;
}

const families:Array<{name:string;narration:string;composition:DocumentaryMontageComposition;accent?:boolean}>=[
  {name:'portrait paper introduction',narration:'Rossi, the rider, joined Yamaha.',composition:{kind:'subject-card',title:'Rossi',kicker:'the rider',variant:'collage'}},
  {name:'circle introduction',narration:'Rossi arrived at Yamaha.',composition:{kind:'subject-card',title:'Rossi',variant:'poster'}},
  {name:'document evidence card',narration:'The contract recorded the agreement.',composition:{kind:'explainer',variant:'collage',cards:[{label:'The contract',sceneId:'a'}]}},
  {name:'sequential explanation',narration:'The plan: rider skill, bike performance, team organization.',composition:{kind:'explainer',title:'The plan',boardLayout:'steps',items:['rider skill','bike performance','team organization']}},
  {name:'phrase marker',narration:'The team knew that this changed everything for the following season.',composition:{kind:'key-point',title:'this changed everything',variant:'marker'},accent:true},
  {name:'kinetic thesis',narration:'They finally understood that the rider makes the difference on a difficult track.',composition:{kind:'key-point',title:'the rider makes the difference',variant:'poster'},accent:true},
  {name:'quoted speech',narration:'Rossi said: “This bike is the best one.” Then he explained his decision.',composition:{kind:'quote',title:'This bike is the best one.',highlight:'best one',variant:'collage'}},
  {name:'number counter',narration:'Rossi won 9 races during the season.',composition:{kind:'statistic',title:'races',value:'9'}},
  {name:'comparable chart',narration:'Honda won 9 races, Yamaha won 4 races.',composition:{kind:'bar-chart',title:'races',cards:[{label:'Honda',value:'9 races'},{label:'Yamaha',value:'4 races'}]}},
  {name:'year chronology',narration:'The next period began in 2004.',composition:{kind:'chronology',value:'2004'},accent:true},
  {name:'literal date',narration:'The test began on January 24, 2004 at the track.',composition:{kind:'chronology',variant:'date',value:'January 24, 2004'},accent:true},
  {name:'location',narration:'The team travelled to Tokyo for the meeting.',composition:{kind:'map-locator',title:'Tokyo'}},
  {name:'route',narration:'From Osaka the team travelled to Tokyo.',composition:{kind:'map-route',title:'Tokyo',items:['Osaka','Tokyo']}},
];
test('literal key-point kicker is the title only when the provider omitted title',()=>{
  const p=project("Furusawa's answer was a crossplane crankshaft, with its crankpins arranged at ninety degrees.");
  const graphic=directed(p,{kind:'key-point',variant:'marker',kicker:'crossplane crankshaft'});
  assert.equal(graphic?.title,'crossplane crankshaft');assert.equal(graphic?.variant,'marker');
  assert.equal(graphic?.kicker??'','');
  assert.equal(directed(project(p.scenes[0]!.narration),{kind:'key-point',variant:'marker',title:'crossplane crankshaft',kicker:"Furusawa's answer"})?.kicker,"Furusawa's answer");
  assert.equal(directed(project(p.scenes[0]!.narration),{kind:'key-point',variant:'marker',kicker:'invented phrase'}),undefined);
});
test('saved provider value and highlight recover only literal kind-specific phrases',()=>{
  for(const [narration,composition,title] of [
    ['Twenty-four hours of racing. One perfect photograph. ',{kind:'key-point',variant:'marker',value:'One perfect photograph'},'One perfect photograph'],
    ['Those three cars take first, second, and third. ',{kind:'key-point',variant:'marker',value:'first, second, and third'},'first, second, and third'],
    ['Four victories for a manufacturer. One unfinished story for a driver. ',{kind:'key-point',variant:'marker',value:'One unfinished story for a driver'},'One unfinished story for a driver'],
    ['A memo from Ford racing director Leo Beebe declared: “Henry expects you to win!”',{kind:'quote',variant:'marker',highlight:'Henry expects you to win!'},'Henry expects you to win!']
  ] as Array<[string,DocumentaryMontageComposition,string]>){
    const graphic=directed(project(narration),composition);
    assert.equal(graphic?.kind,composition.kind);assert.equal(graphic?.title,title);assert.equal(graphic?.variant,'marker');
    if(composition.kind==='key-point')assert.ok(!graphic?.value,'the phrase is not displayed twice');
  }
  for(const [narration,composition] of [
    ['Industrial power against a racing legend.',{kind:'key-point',value:'Industrial power against a racing legend'}],
    ['Miles won at Daytona, then Sebring.',{kind:'key-point',value:'Miles won at Daytona, then Sebring'}],
    ['The factory produced cars.',{kind:'key-point',value:'Ferrari won'}],
    ['Henry expects you to win, according to the memo.',{kind:'quote',highlight:'Henry expects you to win'}],
    ['The factory produced cars.',{kind:'subject-card',value:'cars'}],
    ['Only 3 of 8 cars finished.',{kind:'statistic',title:'3 of 8'}],
    ['The team made one perfect photograph.',{kind:'key-point',title:'invented',value:'one perfect photograph'}]
  ] as Array<[string,DocumentaryMontageComposition]>)assert.equal(directed(project(narration),composition),undefined);
});
test('a complete ten-section musical plan retains its valid final resolution',()=>{
  const p=project('Rossi completed the season.');
  p.scenes=Array.from({length:10},(_,i)=>({...structuredClone(p.scenes[0]!),id:`s${i}`,order:i,durationSeconds:25,
    documentary:{...structuredClone(p.scenes[0]!.documentary!),timing:{sourceKey:'fixture',durationInFrames:750,speechSeconds:25}}}));
  const sections=p.scenes.map((s,i)=>({startSceneId:s.id,endSceneId:s.id,role:i===9?'resolution':'narration',mood:i===9?'calm':'reflective'}));
  const normalized=validateMusicSections(sections,p.scenes);
  assert.equal(normalized?.length,10);assert.deepEqual(normalized?.at(-1),sections.at(-1));
});
test('bare comparison date cannot contradict the saved event year',()=>{
  const text="Later that year, Rossi secured Yamaha's first premier-class riders' championship since Wayne Rainey in 1992.";
  const p=project(text);p.scenes[0]!.documentary!.requirement.years=['2004'];
  assert.equal(directed(p,{kind:'chronology',value:'1992'}),undefined);
  assert.equal(directed(p,{kind:'chronology',value:'1992',title:'since Wayne Rainey in 1992'})?.value,'1992');
  p.scenes[0]!.documentary!.requirement.years=['1992'];
  assert.equal(directed(p,{kind:'chronology',value:'1992'})?.value,'1992');
});
test('rich hook promotes the existing literal emphasis while calm, motion-off and explicit variants survive',()=>{
  for(const mode of ['rich','calm','motion-off','graphics-off','explicit'] as const){
    const p=project("The team hadn't won a single race all year, making the decision especially difficult.");
    if(mode==='calm')p.settings.assembly.documentary!.montage!.intensity='calm';
    if(mode==='motion-off')p.settings.assembly.kenBurns=false;
    if(mode==='graphics-off')p.settings.assembly.documentary!.autoMotionGraphics=false;
    const directions=validateMontageDirections({scenes:[{sceneId:'a',beat:'conflict',treatment:'footage',emphasis:"hadn't won a single race all year",cutawaySceneIds:[],
      ...(mode==='explicit'?{composition:{kind:'key-point',variant:'marker',title:"hadn't won a single race all year"}}:{})}]},p.scenes,p.scenes,p);
    p.scenes[0]!.documentary!.semanticMontage=directions[0];
    const graphic=enrichSemanticMontage(p)[0]!.documentary!.motionGraphic;
    assert.equal(graphic?.variant,mode==='rich'?'poster':mode==='explicit'?'marker':undefined);
    if(graphic){assert.equal(graphic.title,"hadn't won a single race all year");assert.ok(graphic.durationSeconds<=4);}
  }
});
for(const family of families)test(`reference family: ${family.name}`,()=>{
  const p=project(family.narration),before=structuredClone(p.scenes[0]!);
  const graphic=directed(p,family.composition);
  assert.equal(graphic?.kind,family.composition.kind);assert.equal(graphic?.variant,family.composition.variant??(family.composition.kind==='quote'?'marker':undefined));
  assert.ok(graphic!.durationSeconds>0&&graphic!.durationSeconds<=303/30);
  if(family.accent)assert.ok(graphic!.durationSeconds<=4);else assert.equal(graphic!.durationSeconds,303/30);
  assert.deepEqual([p.scenes[0]!.narration,p.scenes[0]!.audioPath,p.scenes[0]!.imagePath,p.scenes[0]!.documentary!.timing],
    [before.narration,before.audioPath,before.imagePath,before.documentary!.timing]);
  const other=structuredClone(p.scenes[0]!);other.id='b';other.order=1;other.imagePath='other.jpg';other.documentary!.checksum='other';other.documentary!.semanticMontage=undefined;p.scenes.push(other);
  p.scenes[0]!.documentary!.semanticMontage!.cutawaySceneIds=['b'];
  const enriched=enrichSemanticMontage(p)[0]!;
  assert.equal(enriched.documentary!.motionGraphic?.kind,graphic!.kind);
  if(graphic!.kind==='key-point')assert.deepEqual(enriched.documentary!.cuts?.map(c=>c.sourceSceneId),['a','b']);
  else assert.equal(enriched.documentary!.cuts,undefined,'full compositions and date anchors keep their intended source');
});

test('comparison uses allowed source aliases and preserves their label association through one cached plan',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-reference-cards-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const p=project('Honda versus Yamaha: two different approaches.'),second=structuredClone(p.scenes[0]!);
  second.id='b';second.order=1;second.imagePath='yamaha.jpg';second.documentary!.checksum='yamaha';second.documentary!.requirement.identities=[{name:'Yamaha',aliases:[]}];p.scenes.push(second);
  let calls=0;
  const plan=await createSemanticMontagePlan(p,root,async(system,input)=>{
    calls++;assert.match(system,/Most scenes keep footage/);assert.match(system,/magnifier/);
    const payload=JSON.parse(input);assert.ok(payload.scenes[0].allowedSources.includes('s1'));
    return {scenes:[{sceneId:'s0',beat:'explain',treatment:'footage',composition:{kind:'explainer',variant:'poster',boardLayout:'compare',cards:[{label:'Honda',sceneId:'s0'},{label:'Yamaha',sceneId:'s1'}]}},
      {sceneId:'s1',beat:'evidence',treatment:'footage'}]};
  },'configured');
  assert.equal(calls,1);assert.deepEqual(plan.scenes[0]!.composition?.cards?.map(c=>[c.label,c.sceneId]),[['Honda','a'],['Yamaha','b']]);
  p.scenes=p.scenes.map((scene,i)=>({...scene,documentary:{...scene.documentary!,semanticMontage:plan.scenes[i]}}));
  const result=enrichSemanticMontage(p);assert.equal(result[0]!.documentary!.motionGraphic?.boardLayout,'compare');
  assert.equal(result[1]!.documentary!.motionGraphic,undefined,'ordinary footage stays free of overlays');
  const cached=await createSemanticMontagePlan(p,root,async()=>{throw Error('must not pay again');},'configured');
  assert.equal(JSON.stringify(cached),JSON.stringify(plan));assert.equal(semanticMontageHash({...p,scenes:result}),plan.inputHash);
});

for(const variant of ['technical','magnifier'] as const)test(`detail ${variant} requires saved confident targets and keeps source timing`,()=>{
  const p=project('The engine cover is clearly visible.'),scene=p.scenes[0]!;
  const composition:DocumentaryMontageComposition={kind:'annotations',title:'engine cover',variant};
  assert.equal(directed(p,composition),undefined);
  scene.documentary!.visualReview={status:'accepted',confidence:.99,reason:'visible',checkedAt:'fixture',sampleSeconds:[0],quality:'good',
    annotations:[{label:'engine cover',confidence:.97,points:[{seconds:0,x:42,y:55}]}]};
  // directed() replaces scene objects; use the updated source carrying the saved review.
  p.scenes[0]!.documentary!.visualReview=scene.documentary!.visualReview;
  const graphic=directed(p,composition);assert.equal(graphic?.variant,variant);assert.equal(graphic?.sourceChecksum,'source');
  assert.deepEqual(graphic?.annotations?.[0]?.points,[{seconds:0,x:42,y:55}]);
  const other=structuredClone(p.scenes[0]!);other.id='b';other.order=1;other.imagePath='other.jpg';other.documentary!.checksum='other';other.documentary!.semanticMontage=undefined;p.scenes.push(other);
  p.scenes[0]!.documentary!.semanticMontage!.cutawaySceneIds=['b'];
  const anchored=enrichSemanticMontage(p)[0]!;
  assert.equal(anchored.documentary!.motionGraphic?.sourceChecksum,'source');assert.equal(anchored.documentary!.cuts,undefined,'callouts must stay on the reviewed source');
  p.scenes[0]!.documentary!.visualReview!.annotations![0]!.confidence=.8;
  assert.equal(directed(p,composition),undefined);
});

test('unsupported labels, full subtitles, invented facts and headings stay out of the composition',()=>{
  for(const composition of [
    {kind:'key-point',title:'Rossi won the race.'},
    {kind:'quote',title:'won the race'},
    {kind:'statistic',title:'race',value:'99%'},
    {kind:'chapter-number',title:'New era'},
    {kind:'explainer',cards:[{label:'Rossi',sceneId:'outside-project'}]},
    {kind:'subject-card',title:'Translated name'},
    {kind:'bar-chart',cards:[{label:'Rossi',value:'9 seconds'},{label:'Honda',value:'4 races'}]},
  ] as DocumentaryMontageComposition[])assert.equal(directed(project('Rossi won the race.'),composition),undefined);
});

test('real script chapters, manual controls and measured reading survive',()=>{
  const p=project('Rossi began a new season.'),scene=p.scenes[0]!;
  p.videoBrief={readyScript:'## Chapter 2: A new season\nRossi began a new season.'} as Project['videoBrief'];
  const chapter=directed(p);assert.equal(chapter?.kind,'chapter-number');assert.equal(chapter?.title,'A new season');assert.equal(chapter?.variant,'poster');
  for(const control of ['pinned','manual','off','clean'] as const){
    const q=project('Rossi began a new season.');
    if(control==='pinned')q.scenes[0]!.documentary!.pinned=true;
    if(control==='manual')q.scenes[0]!.documentary!.motionGraphic={kind:'key-point',enabled:true,title:'Manual',origin:'manual',startSeconds:1,durationSeconds:3};
    if(control==='off')q.settings.assembly.documentary!.autoMotionGraphics=false;
    if(control==='clean')q.settings.assembly.documentary!.montage!.style='clean';
    const graphic=directed(q,{kind:'subject-card',title:'Rossi',variant:'poster'});
    assert.equal(graphic?.title,control==='manual'?'Manual':undefined);
  }
  const q=project('Rossi said “This bike is the best one.” and then explained why.'),composition:DocumentaryMontageComposition={kind:'quote',title:'This bike is the best one.',variant:'marker'};
  const quote=directed(q,composition)!;
  q.scenes[0]!.documentary!.motionGraphic={...quote,reading:{sourceKey:'voice-key',text:composition.title!,words:[{text:'This',startSeconds:2,endSeconds:2.2}]}};
  assert.deepEqual(directed(q,composition)?.reading?.words,[{text:'This',startSeconds:2,endSeconds:2.2}]);
  q.scenes[0]!.documentary!.timing!.sourceKey='changed-voice';assert.equal(directed(q,composition)?.reading,undefined);
  assert.equal(scene.narration,'Rossi began a new season.');
});

for(const predecessor of ['original','music','rossi'] as const)test(`paid ${predecessor} predecessor remains exact and cannot be hidden by the composition prompt`,async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-reference-receipt-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const p=project('Rossi began a new season.');let currentSystem='',currentInput='';
  await assert.rejects(createSemanticMontagePlan(p,root,async(system,input)=>{currentSystem=system;currentInput=input;throw Error('capture');},'configured'),/capture/);
  let system=currentSystem.split(predecessor==='rossi'?' Narrative pace:':' Rossi reference compositions:')[0]!;
  const payload=JSON.parse(currentInput);let input=currentInput;
  if(predecessor==='original'){
    system=system.split(' Keep every displayed word')[0]!.replace('cutawaySceneIds:[],vignette?,monochrome?}],musicSections:[{startSceneId,endSceneId,role,mood}]','cutawaySceneIds:[]}]');
    const {language:_language,previousMusicSection:_music,...legacy}=payload;input=JSON.stringify(legacy);
  }
  const key=documentaryCheckpointKey('semantic-montage',system,input,[]),dir=join(root,'Documentary','Analysis');
  await mkdir(dir,{recursive:true});const receipt=JSON.stringify({state:'pending',purpose:'semantic-montage'});await writeFile(join(dir,`${key}.json`),receipt);
  await assert.rejects(createSemanticMontagePlan(p,root,async(s,i)=>{assert.equal(s,system);assert.equal(i,input);throw Error('existing receipt guard');},'configured'),/existing receipt guard/);
  assert.equal(await readFile(join(dir,`${key}.json`),'utf8'),receipt);
});

test('video detail keeps the reviewed interval and playback rate, never extrapolates an edited trim',()=>{
  const p=project('The engine cover is visible throughout this view.'),scene=p.scenes[0]!;
  scene.videoPath='engine.mp4';scene.trimStartSeconds=20;scene.trimEndSeconds=40.2;scene.playbackRate=2;
  scene.documentary!.visualReview={status:'accepted',confidence:.99,reason:'visible',checkedAt:'fixture',sampleSeconds:[20,30,40],quality:'good',
    annotations:[{label:'engine cover',confidence:.98,points:[{seconds:20,x:40,y:50},{seconds:30,x:45,y:50},{seconds:40,x:50,y:50}]}]};
  const composition:DocumentaryMontageComposition={kind:'annotations',variant:'magnifier',title:'engine cover'};
  const graphic=directed(p,composition);assert.equal(graphic?.sourceTrimStartSeconds,20);assert.equal(graphic?.sourcePlaybackRate,2);
  assert.deepEqual(graphic?.annotations?.[0]?.points.map(point=>point.seconds),[0,5,10]);
  p.scenes[0]!.trimStartSeconds=30;assert.equal(directed(p,composition),undefined);
});

test('source-language spelling and old version-one cached plans need no paid upgrade',async t=>{
  const p=project('El piloto Rossi dijo: «La moto era lo más importante.» Luego explicó la decisión.');p.language='es';
  assert.equal(directed(p,{kind:'quote',title:'la moto era lo más importante.',variant:'marker'})?.title,'La moto era lo más importante.');
  const root=await mkdtemp(join(tmpdir(),'gws-reference-old-cache-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const inputHash=semanticMontageHash(p),directory=join(root,'Documentary','Montage');await mkdir(directory,{recursive:true});
  const old={version:1,inputHash,model:'old-model',hookSeconds:16,scenes:[{sceneId:'a',subject:'Rossi',beat:'evidence',treatment:'footage',cutawaySceneIds:[]}]};
  await writeFile(join(directory,`${inputHash}.json`),JSON.stringify(old));
  const result=await createSemanticMontagePlan(p,root,async()=>{throw Error('must not upgrade a paid plan');},'new-model');
  assert.equal(result.model,'old-model');assert.equal(result.scenes[0]!.composition,undefined);assert.equal(result.scenes[0]!.language,'es');
});
