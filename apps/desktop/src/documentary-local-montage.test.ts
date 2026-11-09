import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {Project} from '@gold-work/shared';
import {localMontageAccent,localAccentTiming} from './documentary-local-montage.js';
import {compactMontageBatches} from './documentary-semantic-batches.js';
import {createSemanticMontagePlan,enrichSemanticMontage,localMontageCutawaySources,semanticMontageHash} from './documentary-semantic-montage.js';
import {documentaryCheckpointKey} from './documentary-checkpoint-key.js';
import {planDocumentaryMontage} from './documentary-montage.js';

function project(texts:string[]):Project{
  return {id:'local-montage',mediaMode:'stock',aspectRatio:'16:9',language:'en',settings:{assembly:{kenBurns:true,documentary:{version:2,autoMotionGraphics:true,montage:{version:1,style:'editorial',intensity:'rich',hookSeconds:16}}}},
    scenes:texts.map((narration,order)=>({id:`scene-${order}`,order,narration,durationSeconds:6,audioPath:`voice-${order}.wav`,videoPath:`source-${order}.mp4`,
      documentary:{verified:false,checksum:`checksum-${order}`,manualReview:{version:1,status:'pending',provider:'pexels',kind:'video',candidateId:`stock-${order}`,checksum:`checksum-${order}`,mediaPath:`source-${order}.mp4`,narration,reason:'User review pending'},selected:{id:`stock-${order}`,provider:'pexels',kind:'video',localPath:`source-${order}.mp4`,width:1920,height:1080,durationSeconds:20},
        requirement:{text:narration,identities:[],years:[]},layout:'full',caption:{enabled:false,text:''},effects:[],timing:{sourceKey:`voice-${order}`,speechSeconds:6,durationInFrames:180}}}))} as unknown as Project;
}
const answer=async(_system:string,input:string)=>({scenes:JSON.parse(input).scenes.map((s:{sceneId:string})=>({sceneId:s.sceneId,subject:'',beat:'evidence',treatment:'footage',cutawaySceneIds:[]}))});

test('literal month/year, paired seasons and negative relative clauses provide short accents in either language',()=>{
  for(const [narration,copy] of [
    ['In November 2003, the company moved to a new factory.','November 2003'],
    ['В ноябре 2003 года завод переехал в новое здание.','ноябре 2003'],
    ['The archive covers the 2001 and 2002 seasons.','2001 and 2002'],
    ["It was a factory that hadn't produced a single car all year.","hadn't produced a single car all year"]
  ]){
    const scene=project([narration!]).scenes[0]!,accent=localMontageAccent(scene);
    assert.ok(accent,narration);assert.equal(accent.graphic.value||accent.graphic.title,copy);
    assert.ok(scene.narration.includes(copy!));
  }
});

test('a saved footage plan gains a literal date without changing source, narration, approved cuts or manual work',()=>{
  const p=project(['In November 2003, the factory moved.','The machines were loaded onto trucks.']);
  for(const scene of p.scenes){scene.documentary!.verified=true;scene.documentary!.semanticMontage={sceneId:scene.id,subject:'factory',beat:'evidence',treatment:'footage',cutawaySceneIds:[]};}
  for(const scene of p.scenes)scene.documentary!.requirement.identities=[{name:'factory',aliases:[]}];
  p.scenes[0]!.documentary!.semanticMontage!.cutawaySceneIds=[p.scenes[1]!.id];
  const original=JSON.stringify(p),result=enrichSemanticMontage(p),first=result[0]!;
  assert.equal(first.documentary!.motionGraphic?.value,'November 2003');
  assert.equal(first.documentary!.motionGraphic?.preset,'source-emphasis');
  assert.ok(first.documentary!.cuts?.length);
  assert.equal(first.videoPath,p.scenes[0]!.videoPath);assert.equal(first.narration,p.scenes[0]!.narration);
  assert.equal(JSON.stringify(p),original);
  p.scenes[0]!.documentary!.pinned=true;
  assert.equal(enrichSemanticMontage(p)[0],p.scenes[0]);
});

test('local events distinguish dates, qualified metrics, ratios, quotations, maps, lists and comparisons',()=>{
  const cases=[
    ['June 19, 1966. The race begins.','chronology','date'],
    ['The roof was only 40 inches high.','statistic','poster'],
    ['Only 3 of 8 cars reach the finish.','statistic','poster'],
    ['He wrote: “Henry expects you to win!”','quote','marker'],
    ['The story links three places: Detroit, Modena, and Le Mans.','map-route',undefined],
    ['Industrial power against a racing legend.','explainer','poster'],
    ['The priorities were clear: brakes, cooling, and transmission.','explainer','collage'],
    ['Ford had factories, money, and mass production.','explainer','collage'],
    ['Diesel: 20 hp; Electric: 40 hp.','bar-chart',undefined],
    ['In 1964, no Ford finished.','chronology',undefined],
    ['Ferrari had won 6 consecutive Le Mans races, from 1960 through 1965.','statistic','poster'],
    ['The early results were brutal. Reliability was the missing piece.','key-point',undefined],
  ] as const;
  for(const [text,kind,variant] of cases){
    const scene=project([text]).scenes[0]!,accent=localMontageAccent(scene);
    assert.equal(accent?.graphic.kind,kind,text);if(variant)assert.equal(accent?.graphic.variant,variant,text);
    const g=accent!.graphic;
    for(const literal of [g.title,g.value,g.kicker,...g.items??[],...g.cards?.flatMap(c=>[c.label,c.value])??[]].filter(Boolean))
      assert.ok(text.includes(literal!),`literal ${literal} must come from ${text}`);
    assert.ok(g.cards?.every(c=>!c.sceneId)??true,'text boards cannot identify an unknown source');
    if(g.kind==='quote')assert.equal(g.quoteMode,'phrase','local quotes must not request a speech model');
  }
  assert.equal(localMontageAccent(project(['There is no quotation in this narration.']).scenes[0]!)?.graphic.kind==='quote',false);
  assert.notEqual(localMontageAccent(project(['Then the result arrives: Bruce McLaren and Chris Amon win. Miles and Denny Hulme are second.']).scenes[0]!)?.graphic.kind,'explainer');
  const age=localMontageAccent(project(['It took no more than 24 hours.']).scenes[0]!)!;
  assert.equal(age.graphic.value,'no more than 24 hours');assert.equal(age.graphic.showSource,false);
});

test('saved archive and television dates and empty statistic directions retain literal accents',()=>{
  for(const treatment of ['archive','television','statistic'] as const){
    const p=project(['The archive covers the 2001 and 2002 seasons.']);
    p.scenes[0]!.documentary!.semanticMontage={sceneId:'scene-0',subject:'',beat:'evidence',treatment,cutawaySceneIds:[]};
    const first=enrichSemanticMontage(p)[0]!,g=first.documentary!.motionGraphic;
    assert.equal(g?.value,'2001 and 2002');assert.equal(g?.preset,'source-emphasis');
    assert.ok(g!.startSeconds+g!.durationSeconds<=6);assert.equal(first.narration,p.scenes[0]!.narration);
    assert.deepEqual(enrichSemanticMontage({...p,scenes:[first]})[0]!.documentary!.motionGraphic,g);
  }
});

test('Russian excerpts retain exact source spelling and ambiguous geographic names do not resolve',()=>{
  const texts=['18 июня 1966. Начинается гонка.','Осталось только 3 из 8 машин.','Промышленная мощь против гоночной легенды.','Маршрут: Springfield и London.'];
  const accents=project(texts).scenes.map(localMontageAccent);
  assert.equal(accents[0]?.graphic.value,'18 июня 1966');assert.equal(accents[1]?.graphic.value,'только 3 из 8');
  assert.equal(accents[2]?.graphic.boardLayout,'compare');assert.notEqual(accents[3]?.graphic.kind,'map-route');
});

test('a colon and conjunction do not make a list of winning drivers; actual lists remain intact',()=>{
  const text='Then the result arrives: Bruce McLaren and Chris Amon win. Miles and Denny Hulme are second.';
  const p=project([text]),accent=localMontageAccent(p.scenes[0]!)!;
  assert.equal(accent.graphic.kind,'key-point');assert.equal(accent.graphic.cards,undefined);
  assert.ok(text.includes(accent.graphic.title));assert.equal(enrichSemanticMontage(p)[0]!.documentary!.motionGraphic?.kind,'key-point');
  assert.notEqual(localMontageAccent(project(['The result: Bruce McLaren and Chris Amon.']).scenes[0]!)?.graphic.kind,'explainer','a colon alone is insufficient even without a recognized verb');
  for(const [narration,items] of [
    ['Ford had factories, money, and mass production.',['factories','money','mass production']],
    ['The priorities were clear: brakes, cooling, and transmission.',['brakes','cooling','transmission']],
    ['The kit contains a pump and a valve.',['a pump','a valve']],
  ] as const){
    const graphic=localMontageAccent(project([narration]).scenes[0]!)!.graphic;
    assert.equal(graphic.kind,'explainer');assert.deepEqual(graphic.cards?.map(c=>c.label),items);
  }
});

test('local maps are full-size while saved AI and manual map layouts retain their own policy',()=>{
  const text='The story links three places: Detroit, Modena, and Le Mans.',p=project([text]);
  const local=enrichSemanticMontage(p)[0]!.documentary!.motionGraphic!;
  assert.equal(local.kind,'map-route');assert.equal(local.mapStyle,'full');assert.equal(local.route?.length,3);
  p.scenes[0]!.documentary!.semanticMontage={sceneId:'scene-0',subject:'',beat:'explain',treatment:'map',cutawaySceneIds:[],composition:{kind:'map-route',items:['Detroit','Modena','Le Mans']}};
  assert.equal(enrichSemanticMontage(p)[0]!.documentary!.motionGraphic?.mapStyle,'full','an explicit saved route keeps its full map');
  p.scenes[0]!.documentary!.motionGraphic={...local,origin:'manual',mapStyle:'inset'};
  assert.deepEqual(enrichSemanticMontage(p)[0]!.documentary!.motionGraphic,p.scenes[0]!.documentary!.motionGraphic);
});

test('long narration uses an interior bounded event; planning preserves frames, voice, sources and local status',()=>{
  const p=project(['The car rolls out of the garage. The mechanics watch the instruments and wait for the driver to return. The missing piece was reliability.']);
  p.scenes[0]!.durationSeconds=15;p.scenes[0]!.documentary!.timing!.durationInFrames=450;
  const scene=p.scenes[0]!,accent=localMontageAccent(scene)!,timing=localAccentTiming(accent,scene,15);
  assert.ok(timing.startSeconds>1);assert.ok(timing.startSeconds+timing.durationSeconds<=15);assert.ok(timing.durationSeconds<10);
  const before=structuredClone(p),result=planDocumentaryMontage(p)[0]!;
  assert.ok(result.documentary!.motionGraphic!.startSeconds>1);assert.equal(result.documentary!.semanticMontage,undefined);
  assert.equal(result.documentary!.motionGraphic!.reading,undefined,'editorial onset is not measured speech');
  assert.deepEqual([result.narration,result.audioPath,result.videoPath,result.durationSeconds,result.documentary!.timing],[scene.narration,scene.audioPath,scene.videoPath,scene.durationSeconds,scene.documentary!.timing]);
  assert.deepEqual(p,before);assert.equal(JSON.stringify(planDocumentaryMontage({...p,scenes:[result]})),JSON.stringify([result]));
});

test('manual and legacy edits, pinning, exclusions, clean/calm and disabled motion survive local fallback',()=>{
  for(const patch of [
    {pinned:true},{template:'archive-dark',templateOrigin:'manual'},
    {template:'archive-dark'}, {motionGraphic:{kind:'key-point',title:'Authored',enabled:true,origin:'manual'}},
    {cuts:[{id:'manual',fromFrame:0,durationInFrames:180,sourceSceneId:'scene-0'}]},
    {texts:[{id:'manual',text:'Authored'}]},{caption:{enabled:true,text:'Authored'}},
  ]){
    const p=project(['June 19, 1966. The race begins.']);Object.assign(p.scenes[0]!.documentary!,patch);
    assert.deepEqual(planDocumentaryMontage(p)[0]!.documentary,p.scenes[0]!.documentary);
  }
  const excluded=project(['A person works in the garage.']);excluded.scenes[0]!.imagePath='photo.jpg';delete excluded.scenes[0]!.videoPath;
  excluded.scenes[0]!.documentary!.verified=true;
  excluded.settings.assembly.documentary!.excludedTemplates=['full','archive-slide','editorial-orbit','museum-mat','paper-grid','gallery'];
  assert.ok(!excluded.settings.assembly.documentary!.excludedTemplates.includes(planDocumentaryMontage(excluded)[0]!.documentary!.template!),'new photo compositions still obey existing exclusions');
  for(const mode of ['clean','calm','density','off'] as const){
    const p=project(['June 19, 1966. The race begins.']),settings=p.settings.assembly.documentary!;
    if(mode==='clean')settings.montage!.style='clean';if(mode==='calm')settings.montage!.intensity='calm';
    if(mode==='density')settings.montageDensity='calm';if(mode==='off')settings.autoMotionGraphics=false;
    assert.equal(planDocumentaryMontage(p)[0]!.documentary!.motionGraphic,undefined,mode);
  }
  const still=project(['An ordinary view of a workshop.']);still.settings.assembly.kenBurns=false;
  assert.equal(planDocumentaryMontage(still)[0]!.documentary!.templateMotion!.amountPercent,0);
  still.settings.assembly.kenBurns=true;still.scenes[0]!.documentary!.templateMotion={amountPercent:0,curve:'smooth'};
  assert.equal(planDocumentaryMontage(still)[0]!.documentary!.templateMotion!.amountPercent,0);
});

test('local cutaways require saved shared subject/details and never infer history from broad request overlap',()=>{
  const p=project(['Ford GT40 engine exhaust under inspection.','Ford GT40 engine exhaust detail.']);
  for(const s of p.scenes){const d=s.documentary!;d.verified=true;d.requirement.identities=[{name:'Ford GT40',aliases:[]}];d.requirement.years=['1966'];
    d.visualReview={status:'accepted',viewDescription:'Ford GT40 engine exhaust under inspection.'} as never;}
  assert.deepEqual(localMontageCutawaySources(p.scenes[0]!,p.scenes).map(s=>s.id),['scene-1']);
  const cuts=enrichSemanticMontage(p)[0]!.documentary!.cuts!;assert.equal(cuts.length,2);
  assert.equal(cuts.reduce((sum,c)=>sum+c.durationInFrames,0),180);
  p.scenes[1]!.documentary!.visualReview!.viewDescription='A generic engine in a workshop.';
  assert.deepEqual(localMontageCutawaySources(p.scenes[0]!,p.scenes),[]);
  p.scenes[1]!.documentary!.visualReview!.viewDescription='Ford GT40 engine exhaust under inspection.';
  p.scenes[0]!.narration='Ford GT40 engine exhaust after the victory.';
  assert.deepEqual(localMontageCutawaySources(p.scenes[0]!,p.scenes),[]);
});

test('new plans use bounded compact batches, exact adjacent context, and checkpointed resume',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-local-batches-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const p=project(Array.from({length:19},(_,i)=>`Scene ${i} explains a different part of the programme.`));
  const sizes:number[]=[];let calls=0;
  await assert.rejects(createSemanticMontagePlan(p,root,async(s,i)=>{
    const payload=JSON.parse(i);sizes.push(payload.scenes.length);
    if(++calls===2)throw Error('uncertain fixture');return answer(s,i);
  },'mock'),/uncertain fixture/);
  assert.deepEqual(sizes,[8,8]);let resumed=0;
  const result=await createSemanticMontagePlan(p,root,async(s,i)=>{resumed++;const value=JSON.parse(i);
    if(resumed===1){assert.equal(value.before,p.scenes[7]!.narration);assert.equal(value.after,p.scenes[16]!.narration);}
    return answer(s,i);
  },'mock');
  assert.equal(resumed,2);assert.equal(result.scenes.length,19);
  await createSemanticMontagePlan(p,root,async()=>{throw Error('cached plan must not submit');},'mock');
  const long=project(['x'.repeat(2000),'short','y'.repeat(1500),'z'.repeat(1500)]);
  assert.deepEqual(compactMontageBatches(long.scenes).map(b=>b.length),[1,2,1]);
});

test('old complete batches and original/current receipts retain the exact 64-scene request boundary',async t=>{
  const p=project(Array.from({length:17},()=> 'The roof was 40 inches high.'));
  const capture=await mkdtemp(join(tmpdir(),'gws-capture-batches-'));t.after(()=>rm(capture,{recursive:true,force:true}));
  let system='';await assert.rejects(createSemanticMontagePlan(p,capture,async(s)=>{system=s;throw Error('capture');},'mock'),/capture/);
  // Seed an old validated batch to obtain its byte-compatible 64-size payload.
  for(const predecessor of ['original','current','saved'] as const){
    const root=await mkdtemp(join(tmpdir(),'gws-old-batches-'));t.after(()=>rm(root,{recursive:true,force:true}));
    const hash=semanticMontageHash(p),directory=join(root,'Documentary','Montage');await mkdir(directory,{recursive:true});
    const file=join(directory,`${hash}-batch-0.json`);
    await writeFile(file,JSON.stringify({inputHash:hash,scenes:[]}));
    let input='';await assert.rejects(createSemanticMontagePlan(p,root,async(_s,i)=>{input=i;throw Error('capture');},'mock'),/capture/);
    assert.equal(JSON.parse(input).scenes.length,17);
    if(predecessor==='saved'){
      const scenes=p.scenes.map(s=>({sceneId:s.id,subject:'',beat:'evidence',treatment:'footage',cutawaySceneIds:[]}));
      await writeFile(file,JSON.stringify({inputHash:hash,scenes}));
      assert.equal((await createSemanticMontagePlan(p,root,async()=>{throw Error('no submission');},'mock')).scenes.length,17);continue;
    }
    await rm(file);
    // The current editorial prompt no longer contains the historical prefix.
    // Keep the original request as a literal fixture, not a split of today's text.
    const prior=predecessor==='original'
      ?'You are a documentary editor. Return JSON {scenes:[{sceneId,subject,location?,beat,emphasis?,treatment,cutawaySceneIds:[]}]}. '
        +'Plan meaning and rhythm, not decoration. Subject, location and emphasis must be exact short quotations from that scene narration. '
        +'beat: establish|conflict|evidence|explain|turn|resolve; treatment: footage|archive|television|map|subject|statistic|quote. '
        +'Opening 10–20 seconds: establish stakes, vary supporting shots where the approved sources explain the SAME claim. '
        +'Choose 0–2 cutawaySceneIds only from that row allowedSources, only if their observed content and period support this narration. '
        +'Do not turn later victory footage into proof of an earlier defeat or generic footage into a named event. Empty cuts are correct when sources do not fit. '
        +'Requested subjects/years describe the narration request, NOT verified source content. User-accepted illustrative/manual-review sources may support an idea editorially, never prove a historical event. '
        +'Use map only when geography is being explained, never for a company/person with a geographic name. '
        +'Use subject only for an explicitly introduced person/object visible in the selected image. Television only for actual broadcast/interview/archive context, occasionally. '
        +'Use statistic only with an exact quantity in emphasis, quote only for actual quoted speech. Most body scenes remain footage. No invented facts, captions or coordinates.'
      :system;
    const {artworkContinuations:_continuations,storyContext:_story,previousDirections:_directions,...previousPayload}=JSON.parse(input);
    previousPayload.sources=previousPayload.sources.map((row:Record<string,unknown>)=>({id:row.id,kind:row.kind,
      requestedSubjects:row.requestedSubjects,requestedYears:row.requestedYears,observed:row.observed??'',illustrative:row.illustrative,manualReview:row.manualReview}));
    previousPayload.scenes=previousPayload.scenes.map((row:Record<string,unknown>)=>({sceneId:row.sceneId,narration:row.narration,
      startSeconds:row.startSeconds,seconds:row.seconds,allowedSources:row.allowedSources}));
    const {language:_language,previousMusicSection:_previous,...legacyPayload}=previousPayload;
    const expectedInput=predecessor==='original'?JSON.stringify(legacyPayload):input;
    const key=documentaryCheckpointKey('semantic-montage',prior,expectedInput,[]),analysis=join(root,'Documentary','Analysis');await mkdir(analysis,{recursive:true});
    const receipt=JSON.stringify({state:'partial',purpose:'semantic-montage'});await writeFile(join(analysis,`${key}.json`),receipt);
    let attempts=0;await assert.rejects(createSemanticMontagePlan(p,root,async(s,i)=>{
      attempts++;assert.equal(s,prior,predecessor+' prompt');
      assert.equal(documentaryCheckpointKey('semantic-montage',s,i,[]),key,predecessor+' receipt identity');
      throw Error('existing receipt guard');
    },'mock'),/existing receipt guard/);
    assert.equal(attempts,1);assert.equal(await readFile(join(analysis,`${key}.json`),'utf8'),receipt);
    await assert.rejects(readFile(join(directory,`${hash}-batches.json`)),{code:'ENOENT'});
  }
});
