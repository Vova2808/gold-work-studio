import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {createVoiceCalibration} from '@gold-work/shared';
import type {DocumentaryCandidate,DocumentaryRequirement} from '@gold-work/shared';
import {documentaryNamedDiscoveryQueries,documentaryNamedMetadataShortlist,documentaryExactRequirementForRetry,documentaryNamedMetadataIssue,documentaryYouTubeNameFallback,documentaryNamedVideo,documentaryCandidateSubjectIssue,documentaryPlannedDiscoveryRequirement,documentaryCommonsDiscoverySubjects,documentaryGroundedDiscoveryName} from './documentary-named-search.js';
import {DocumentarySelectionSession} from './documentary-selection-session.js';
import {discoverDocumentarySourceBatches} from './documentary-discovery.js';
import {documentaryIdentityReviewIssue,documentaryIdentityMatches,documentaryListsNamedSubjects,documentaryCatalogIdentityConflict} from './documentary-visual-relevance.js';
import {documentaryContinuityModelYear,documentaryContradictoryModelYear} from './documentary-model-year.js';
import {documentaryThematicQueryAllowed} from './documentary-illustration-fallback.js';
import {DocumentaryProjectService,documentaryVisualRejectionKeys,documentaryCachedRangeMatches,documentaryBroadIllustrationStockQuery,documentaryCandidateAttempts} from './documentary-project-service.js';
import {DocumentarySearch} from './documentary-search.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {prepareDocumentaryScript} from './documentary-plan.js';

const req:DocumentaryRequirement={text:'Marie Curie and Pierre Curie worked in Paris.',entities:['Marie Curie','Pierre Curie'],
  identities:[{name:'Мария Кюри',aliases:['Marie Curie']},{name:'Пьер Кюри',aliases:['Pierre Curie']}],years:['1903'],queries:['Marie Curie Pierre Curie Paris research 1903']};
const candidate=(id:string,title:string):DocumentaryCandidate=>({id,provider:'commons',kind:'image',title,description:'',
  pageUrl:'https://example.test/'+id,downloadUrl:'https://example.test/'+id+'.jpg',author:'Author',license:'CC BY 4.0',licenseUrl:'',rights:'licensed',
  attribution:'Author',query:'search',retrievedAt:'now',match:'unverified',concerns:[]});

const plannedTarget=(subject:string,visualTarget:string,queries:string[]):DocumentaryRequirement=>({...req,
  entities:[subject],identities:[{name:subject,aliases:[]}],years:[],queries,detail:visualTarget,
  aiSearchPlan:{version:1,inputHash:'fixture',model:'fixture',subject,visualTarget,years:[],visualScope:'illustrative',preferredKind:'image',
    imageQueries:queries,videoQueries:[],fallbackVideoQueries:[],fallbackVisualTarget:''}});
const commonsPortrait:DocumentaryCandidate={...candidate('portrait','File:Captain Wilfred Dowman.jpg - Wikimedia Commons'),
  description:`Toggle the table of contents
File:Captain Wilfred Dowman.jpg
File
Discussion
Read
Edit
View history
Tools
Size of this preview: 960 × 736 pixels. Other resolutions: 330 × 253 pixels | 1,280 × 981 pixels | 1,541 × 1,181 pixels.
Original file (1,541 × 1,181 pixels, file size: 449 KB, MIME type: image/jpeg)
File information
Structured data
Captions
English
Captain Wilfred Dowman
Summaryedit
Description\t
English: Picture drawn by A.B.Lavrov for his own book "Катти Сарк: курс на будущее" (Cutty Sark: Heading for the Future)
Русский: Иллюстрация А.Б.Лаврова к его книге "Катти Сарк: курс на будущее"

Date\t5 July 2023
Source\tOwn work
Author\tALRecs
Licensingedit
This file is licensed under the Creative Commons Attribution-Share Alike 4.0 International license.
File history
File usage on Commons
Metadata
Items portrayed in this file
Category: Cutty Sark (ship, 1869)
Hidden categories: CC-BY-SA-4.0Self-published work`};

test('scraped Commons book provenance and category never shortlist a human portrait for the ship or its details',()=>{
  for(const visualTarget of ['Cutty Sark iron frame interior, cargo hold space, preserved ship',
    'Cutty Sark below-waterline Muntz metal sheathing, preserved hull, dry dock',
    'Preserved Cutty Sark at Greenwich, illustrating the 1872 race result against Thermopylae',
    "Preserved Cutty Sark's rudder and stern, illustrating the ship saved by crew skill",
    'Ferreira cargo ship hull and deck, late 19th century photograph']){
    const target=plannedTarget('Cutty Sark (clipper ship)',visualTarget,['Cutty Sark ship exterior']);
    const before=structuredClone(commonsPortrait);
    assert.ok(documentaryCandidateSubjectIssue(commonsPortrait,target),visualTarget);
    assert.deepEqual(documentaryNamedMetadataShortlist([commonsPortrait],target,target.text),[],visualTarget);
    assert.deepEqual(commonsPortrait,before,'Cheap filtering does not rewrite provenance or approve pixels');
    assert.ok(documentaryCandidateSubjectIssue({...commonsPortrait,id:'local:portrait',provider:'local',localPath:'D:/cache/portrait.jpg'},target));
  }
});

test('a current portrait target survives ship words in the narration, query and previous detail',()=>{
  const target={...plannedTarget('Wilfred Dowman, retired sea captain','portrait of Captain Wilfred Dowman',
    ['Wilfred Dowman Cutty Sark captain portrait']),text:'There, retired captain Wilfred Dowman recognised the ship.',detail:'Cutty Sark ship hull'};
  assert.equal(documentaryCandidateSubjectIssue(commonsPortrait,target),undefined);
  assert.deepEqual(documentaryNamedMetadataShortlist([commonsPortrait],target,target.text),[commonsPortrait]);
  assert.equal(commonsPortrait.match,'unverified');
  const owner=candidate('owner','Portrait of John Willis');
  const ownerTarget=plannedTarget('John Willis','Portrait of John Willis, ship owner',['John Willis portrait']);
  assert.equal(documentaryCandidateSubjectIssue(owner,ownerTarget),undefined);
  assert.deepEqual(documentaryNamedMetadataShortlist([owner],ownerTarget,ownerTarget.text),[owner]);
  assert.ok(documentaryCandidateSubjectIssue(owner,plannedTarget('Cutty Sark','Ship portrait of Cutty Sark',['Cutty Sark ship portrait'])));
});

test('current illustrative discovery selects an existing depicted-object segment instead of the incidental person',()=>{
  for(const [subject,target,query,title] of [
    ['Captain George Moodie, Cutty Sark','Preserved Cutty Sark at Greenwich, illustrating the ship under Captain Moodie','Cutty Sark clipper ship','Preserved Cutty Sark ship'],
    ['Amelia Earhart, Lockheed Electra','Preserved Lockheed Electra aircraft, illustrating the pilot\'s journey','Lockheed Electra aircraft','Lockheed Electra aircraft at a museum']
  ]){
    const requirement=plannedTarget(subject!,target!,[query!]),before=structuredClone(requirement),source=candidate('object',title!);
    assert.deepEqual(documentaryNamedMetadataShortlist([source],requirement,requirement.text),[]);
    const projected=documentaryPlannedDiscoveryRequirement(requirement,requirement.aiSearchPlan);
    assert.deepEqual(documentaryNamedMetadataShortlist([source],projected,requirement.text),[source]);
    assert.deepEqual(requirement,before);assert.equal(projected.aiSearchPlan,requirement.aiSearchPlan);
    assert.equal(source.match,'unverified');
  }
});

test('discovery projection leaves exact, stale, ambiguous, action and unmatched model targets intact',()=>{
  const requirement=plannedTarget('Captain George Moodie, Cutty Sark','Preserved Cutty Sark at Greenwich',['Cutty Sark ship']);
  assert.equal(documentaryPlannedDiscoveryRequirement(requirement,undefined),requirement,'Caller rejects stale plan');
  const exact={...requirement,aiSearchPlan:{...requirement.aiSearchPlan!,visualScope:'exact' as const}};
  assert.equal(documentaryPlannedDiscoveryRequirement(exact,exact.aiSearchPlan),exact);
  const incidental={...requirement,aiSearchPlan:{...requirement.aiSearchPlan!,visualTarget:'A captain portrait, alongside the Cutty Sark'}};
  assert.equal(documentaryPlannedDiscoveryRequirement(incidental,incidental.aiSearchPlan),incidental);
  const noQuery={...requirement,aiSearchPlan:{...requirement.aiSearchPlan!,imageQueries:['historic captain portrait']}};
  assert.equal(documentaryPlannedDiscoveryRequirement(noQuery,noQuery.aiSearchPlan),noQuery);
  const action=plannedTarget('Amelia Earhart, Lockheed Electra','Lockheed Electra landing on a runway',['Amelia Earhart portrait']);
  assert.equal(documentaryPlannedDiscoveryRequirement(action,action.aiSearchPlan),action);
  const model=plannedTarget('Airbus A320','Airbus A380 cockpit',['Airbus A380 cockpit']);
  assert.equal(documentaryPlannedDiscoveryRequirement(model,model.aiSearchPlan),model);
  assert.deepEqual(documentaryNamedMetadataShortlist([candidate('a380','Airbus A380')],model,model.text),[]);
});

test('grounded sentence identities retain their canonical subject for native Commons discovery without changing visual evidence',()=>{
  for(const [subject,required,quote] of [
    ['Cutty Sark','the ship Cutty Sark','Cutty Sark left the tea trade.'],
    ['Cutty Sark (clipper ship)','the ship is Cutty Sark, later renamed Ferreira under Portuguese ownership','Cutty Sark was sold and renamed Ferreira.'],
    ['Marie Curie','the scientist Marie Curie','Marie Curie continued her research.'],
    ['Nikon D850','the camera Nikon D850','The Nikon D850 had a larger sensor.']
  ]){
    const name=subject!.replace(' (clipper ship)','');
    const requirement=plannedTarget(required!,name!+' portrait or preserved view',[name!+' historical photograph']);
    requirement.aiSearchPlan!.subject=subject!;
    requirement.aiSearchPlan!.grounding={version:1,mandatory:[{kind:'identity',required:required!,scriptQuote:quote!}],illustrations:['same subject'],optionalDetails:[]};
    const before=structuredClone(requirement);
    assert.deepEqual(documentaryCommonsDiscoverySubjects(requirement,requirement.aiSearchPlan,requirement.queries[0]!),[name]);
    assert.deepEqual(requirement,before,'Discovery does not rewrite saved meaning or quotes');
    assert.deepEqual(documentaryCommonsDiscoverySubjects(requirement,undefined,requirement.queries[0]!),[]);
  }
});

test('grounded discovery never substitutes an incidental object or shortens a required model discriminator',()=>{
  for(const [subject,required,quote] of [
    ['Cutty Sark','John Willis, owner of Cutty Sark','John Willis owned Cutty Sark.'],
    ['Airbus','the aircraft Airbus A320','The Airbus A320 entered service.'],
    ['Airbus A320','the aircraft Airbus A320-200','The Airbus A320-200 entered service.'],
    ['Nikon D850','the camera Nikon D850','An unidentified camera was used.'],
    ['Marie Curie','the scientist Marie Curie','Marie Curie-Sklodowska was the required full identity.']
  ]){
    const requirement=plannedTarget(required!,subject!,[subject!+' photograph']);
    requirement.aiSearchPlan!.subject=subject!;
    requirement.aiSearchPlan!.grounding={version:1,mandatory:[{kind:'identity',required:required!,scriptQuote:quote!}],illustrations:['same subject'],optionalDetails:[]};
    assert.equal(documentaryGroundedDiscoveryName(requirement.aiSearchPlan),undefined,required);
  }
});

test('repeated grounded identities retain one quoted canonical name with a renamed subject decoration',()=>{
 for(const [name,alias] of [['Cutty Sark','Ferreira'],['Aurora','Vega'],['Marie Curie','Maria Skłodowska']]){
  const requirement=plannedTarget(name!+', also named '+alias,name!+' preserved view',[name!+' historical photograph']);
  const plan=requirement.aiSearchPlan!;
  plan.subject=name+' (renamed '+alias+') '+(name==='Marie Curie'?'scientist':'clipper ship');
  plan.grounding={version:1,mandatory:[
   {kind:'identity',required:name+', also named '+alias,aliases:[alias!],scriptQuote:name+' was renamed '+alias+'.'},
   {kind:'identity',required:name+' as the famous historic subject',scriptQuote:'The famous historic subject changed its role.'},
  ],illustrations:['An attributed view of the same subject.'],optionalDetails:[]};
  requirement.identities=plan.grounding.mandatory.map(check=>({name:check.required,aliases:check.aliases??[]}));
  const before=structuredClone(requirement);
  assert.equal(documentaryGroundedDiscoveryName(plan),name);
  assert.deepEqual(documentaryPlannedDiscoveryRequirement(requirement,plan).identities,[{name,aliases:[]}]);
  assert.deepEqual(documentaryCommonsDiscoverySubjects(requirement,plan,plan.imageQueries[0]!),[name]);
  assert.deepEqual(documentaryCommonsDiscoverySubjects(requirement,plan,'A different subject photograph'),[]);
  assert.deepEqual(requirement,before,'Discovery cannot change saved aliases, quotations or required identities');
  const foreign={...requirement,identities:[...requirement.identities,{name:'Another Object',aliases:[]}]};
  assert.equal(documentaryPlannedDiscoveryRequirement(foreign,plan),foreign,'A separate requirement identity cannot disappear behind a grounded plan');
  assert.deepEqual(documentaryCommonsDiscoverySubjects(foreign,plan,plan.imageQueries[0]!),[]);
 }
});

test('parenthesized model discriminators survive grounded discovery and Commons projection',()=>{
 for(const name of ['Canon EOS R5 (Mark II)','Airbus A320 (neo)','Nikon Z6 (II)']){
  const requirement=plannedTarget(name,name+' technical view',[name+' photograph']);
  const plan=requirement.aiSearchPlan!;plan.subject=name;
  plan.grounding={version:1,mandatory:[{kind:'identity',required:name,scriptQuote:name+' was introduced.'}],illustrations:['The same model'],optionalDetails:[]};
  const before=structuredClone(requirement);
  assert.equal(documentaryGroundedDiscoveryName(plan),name);
  assert.deepEqual(documentaryCommonsDiscoverySubjects(requirement,plan,plan.imageQueries[0]!),[name]);
  assert.deepEqual(requirement,before);
  plan.subject=name.replace(/\s*\([^()]+\)$/u,'');
  assert.equal(documentaryGroundedDiscoveryName(plan),undefined,'A shortened subject cannot remove the required model qualifier');
  assert.deepEqual(documentaryCommonsDiscoverySubjects(requirement,plan,plan.imageQueries[0]!),[name]);
  plan.grounding.mandatory[0]!.required=name.replace('(', '(camera) (');
  assert.equal(documentaryGroundedDiscoveryName(plan),undefined,'An object class before the model qualifier cannot hide it');
 }
});

test('renamed decoration requires an explicit alias and a witnessed renaming relation',()=>{
 for(const [aliases,quote] of [
  [[], 'Aurora was renamed Vega.'],
  [['Vega'], 'Aurora sailed alongside Vega.'],
 ] as Array<[string[],string]>){
  const requirement=plannedTarget('Aurora','Aurora ship',['Aurora ship']);
  const plan=requirement.aiSearchPlan!;plan.subject='Aurora (renamed Vega) ship';
  plan.grounding={version:1,mandatory:[{kind:'identity',required:'Aurora',aliases,scriptQuote:quote}],illustrations:['Same ship'],optionalDetails:[]};
  assert.equal(documentaryGroundedDiscoveryName(plan),undefined,JSON.stringify({aliases,quote}));
 }
});

test('several grounded checks cannot collapse different identities, owners or model discriminators',()=>{
 for(const [subject,required,second,quote] of [
  ['Aurora','Aurora','Orion','Aurora sailed alongside Orion.'],
  ['Aurora','Aurora and Orion','Aurora as a historic ship','Aurora sailed alongside Orion.'],
  ['Aurora','Aurora','Captain Morgan, owner of Aurora','Captain Morgan owned Aurora.'],
  ['Aurora','Aurora','Aurora\'s captain','Aurora sailed with her captain.'],
  ['Aurora','Aurora','Aurora crew','Aurora sailed with her crew.'],
  ['Aurora','Aurora','Aurora compared with Orion','Aurora sailed alongside Orion.'],
  ['Airbus','Airbus A320','Airbus A380','Airbus A320 and Airbus A380 entered service.'],
  ['Airbus A320','Airbus A320-200','Airbus A320 as a passenger aircraft','Airbus A320-200 entered service.'],
  ['Marie Curie','Marie Curie','Marie Curie as a scientist','Marie Curie-Sklodowska was the required full identity.'],
 ]){
  const requirement=plannedTarget(required!,subject!,[subject!+' photograph']);
  const plan=requirement.aiSearchPlan!;plan.subject=subject!;
  plan.grounding={version:1,mandatory:[{kind:'identity',required:required!,scriptQuote:quote!},
   {kind:'identity',required:second!,scriptQuote:'The historic subject changed its role.'}],illustrations:['same subject'],optionalDetails:[]};
  requirement.identities=plan.grounding.mandatory.map(check=>({name:check.required,aliases:check.aliases??[]}));
  assert.equal(documentaryGroundedDiscoveryName(plan),undefined,JSON.stringify({subject,required,second}));
  assert.equal(documentaryPlannedDiscoveryRequirement(requirement,plan),requirement);
  assert.deepEqual(documentaryCommonsDiscoverySubjects(requirement,plan,plan.imageQueries[0]!),[]);
 }
});

test('discovery projection retains model discriminators in delimited aliases and canonical segments',()=>{
  for(const [name,alias,target,query,wrong] of [
    ['Airbus A320','Airbus, passenger aircraft','Preserved Airbus aircraft at a museum','Airbus A320 aircraft','Airbus A380 aircraft'],
    ['Airbus A320','Aircraft, passenger transport','Preserved Aircraft at a museum','Airbus A320 aircraft','Boeing 737 aircraft'],
    ['Rolls Royce Phantom','Rolls Royce, luxury car','Preserved Rolls Royce car at a museum','Rolls Royce Phantom car','Rolls Royce Ghost'],
    ['Nikon D850','Nikon, digital camera','Nikon camera at a museum','Nikon D850 camera','Nikon D750'],
    ['Airbus A320-200','Airbus A320, passenger aircraft','Airbus A320 aircraft at a museum','Airbus A320-200 aircraft','Airbus A320-100'],
    ['Airbus A320, Airbus','Airbus, passenger aircraft','Preserved Airbus aircraft at a museum','Airbus A320 aircraft','Airbus A380 aircraft']
  ]){
    const requirement=plannedTarget(name!,target!,[query!]);requirement.identities![0]!.aliases=[alias!];
    const projected=documentaryPlannedDiscoveryRequirement(requirement,requirement.aiSearchPlan);
    const right=candidate('right',name!.split(',')[0]!),other=candidate('wrong',wrong!);
    assert.equal(projected,requirement,alias);
    assert.deepEqual(documentaryNamedMetadataShortlist([other,right],projected,requirement.text),[right],alias);
  }
});

test('discovery projection preserves valid full-model aliases and their wrong-model exclusion',()=>{
  const requirement=plannedTarget('Airbus A320-200','Preserved A320-200 aircraft at a museum',['A320-200 aircraft']);
  requirement.identities![0]!.aliases=['Airbus, passenger aircraft','A320-200, passenger aircraft'];
  const projected=documentaryPlannedDiscoveryRequirement(requirement,requirement.aiSearchPlan);
  const right=candidate('right','A320-200 aircraft');
  assert.equal(projected,requirement);
  assert.deepEqual(documentaryNamedMetadataShortlist([candidate('wrong','Airbus A320-100'),right],projected,requirement.text),[right]);
});

test('explicit object titles cannot serve a portrait target while ambiguous and real portraits remain eligible',()=>{
  const target=plannedTarget('John Willis','Portrait of John Willis, ship owner',['John Willis portrait']);
  for(const title of ['The Cutty Sark ship','Close-up of a ship deck','Aircraft cockpit']){
    const source={...candidate(title,title),description:'This object was owned by John Willis.'};
    assert.ok(documentaryCandidateSubjectIssue(source,target));
  }
  for(const title of ['Portrait of John Willis','John Willis, ship owner','Captain Cook','An old photograph'])
    assert.equal(documentaryCandidateSubjectIssue(candidate(title,title),target),undefined,title);
  assert.equal(documentaryCandidateSubjectIssue(candidate('ship','Ship portrait of Captain Cook'),
    plannedTarget('Captain Cook','Captain Cook ship hull',['Captain Cook ship'])),undefined);
});

test('subject filtering generalizes to aircraft and respects active or stale footage fallback targets',()=>{
  const source={...candidate('engineer','Portrait of Adrian Bell'),description:'Portrait drawn by an artist for his own book "Airbus A320: A History".\nCategory: Airbus A320 aircraft'};
  const target=plannedTarget('Airbus A320','Airbus A320 cockpit and fuselage',['Airbus A320 cockpit']);
  assert.ok(documentaryCandidateSubjectIssue(source,target));
  assert.deepEqual(documentaryNamedMetadataShortlist([source],target,target.text),[]);
  const portrait=plannedTarget('Adrian Bell','Portrait of Adrian Bell',['Adrian Bell portrait']);
  const fallback={version:1 as const,target:'aircraft cockpit',queries:['aircraft cockpit'],reason:'fixture',originalTarget:'Portrait of Adrian Bell',narration:portrait.text};
  assert.ok(documentaryCandidateSubjectIssue(source,{...portrait,footageFallback:fallback}));
  assert.equal(documentaryCandidateSubjectIssue(source,{...portrait,footageFallback:{...fallback,narration:'Old narration'}}),undefined);
});

test('subject captions retain real interiors, details and ships with human names; ambiguous titles are not rejected',()=>{
  const ship=plannedTarget('Cutty Sark','Cutty Sark interior iron framing',['Cutty Sark interior']);
  const interior={...candidate('interior','File:Iron framing.jpg - Wikimedia Commons'),description:'Captions\nEnglish\nInterior of Cutty Sark\nSummaryedit\nDescription\t\nEnglish: Cargo hold and iron frame of Cutty Sark, photographed by an author for a book.\nDate\t2023\nCategory: Ship interiors'};
  assert.equal(documentaryCandidateSubjectIssue(interior,ship),undefined);
  assert.deepEqual(documentaryNamedMetadataShortlist([interior],ship,ship.text),[interior]);
  const credited={...interior,description:'Photographed by Alex Stone: interior of Cutty Sark showing its iron frame.'};
  assert.deepEqual(documentaryNamedMetadataShortlist([credited],ship,ship.text),[credited]);
  const book={...interior,description:'Drawn by Alex Stone for his own book "Cutty Sark: Heading for the Future".'};
  assert.deepEqual(documentaryNamedMetadataShortlist([book],ship,ship.text),[]);
  const captainShip={...candidate('captain-ship','File:Captain Cook.jpg - Wikimedia Commons'),description:'The preserved sailing ship Captain Cook, view of her hull.'};
  const namedShip=plannedTarget('Captain Cook','Captain Cook ship hull',['Captain Cook ship']);
  assert.equal(documentaryCandidateSubjectIssue(captainShip,namedShip),undefined);
  assert.deepEqual(documentaryNamedMetadataShortlist([captainShip],namedShip,namedShip.text),[captainShip]);
  const ambiguous={...candidate('ambiguous','Museum study'),description:'From the collection.\nCategory: Cutty Sark (ship, 1869)'};
  assert.equal(documentaryCandidateSubjectIssue(ambiguous,ship),undefined,'Missing subject metadata is not a negative visual observation');
  assert.deepEqual(documentaryNamedMetadataShortlist([ambiguous],ship,ship.text),[],'A footer mention earns no named shortcut');
  assert.equal(documentaryCandidateSubjectIssue(commonsPortrait,{...req,identities:[],detail:'Museum collection',queries:['museum collection']}),undefined);
});

for(const route of ['ordinary-pool','donor'] as const)test(`simple selection excludes a portrait before actual preparation through ${route}`,async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-subject-scope-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
  let project=await projects.create({title:'Ship',topic:'Ship construction',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
  project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:'The ship has an iron frame.'};
  const scenes=prepareDocumentaryScript(project,createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',
    sampleText:project.videoBrief.readyScript!,audioDurationSeconds:5})).slice(0,1);
  project.settings.voice.enabled=false;project.settings.stockVideoPercent=0;
  const scene=scenes[0]!;scene.audioPath='saved-voice.wav';
  scene.documentary!.requirement={text:scene.narration,entities:['Cutty Sark'],identities:[{name:'Cutty Sark',aliases:[]}],years:[],
    queries:['Cutty Sark ship iron frame'],detail:'ship iron frame interior',preferredKind:'image',plannedBy:'semantic'};
  scene.documentary!.selectionPlan={kind:'image',videoPercent:0};
  const file=join(root,'portrait.jpg');await writeFile(file,'orchestration-only fixture');
  const source={...commonsPortrait,provider:'local' as const,localPath:file};
  if(route==='donor'){
    scene.documentary!.autoError='Запасной материал недоступен: fixture';
    const donor=structuredClone(scene);donor.id='portrait-donor';donor.order=1;donor.imagePath=file;
    donor.documentary={...donor.documentary!,selected:source,verified:true,pinned:true,
      visualReview:{status:'accepted',confidence:1,reason:'Mock donor only; recipient needs its own review',quality:'',sampleSeconds:[],checkedAt:'now'}};
    scenes.push(donor);
  }
  project=await projects.mutate(project.id,()=>({scenes,settings:project.settings,status:route==='donor'?'generating':'draft'}));
  let searches=0,preparations=0,reviews=0;
  const searcher=new DocumentarySearch();searcher.search=async()=>{searches++;return {candidates:route==='ordinary-pool'?[commonsPortrait]:[],sources:[]};};
  const service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,'projects')),searcher,join(root,'materials'),
    {download:async()=>{throw Error('No network permitted');}},()=>{},
    {simpleSelection:true,available:async()=>true,plan:async()=>new Map(),inspect:async()=>{reviews++;throw Error('Incompatible portrait reached review');}});
  service.localCandidates=async()=>[source];
  Reflect.set(service,'selectionResources',async()=>({workers:1}));
  Reflect.set(service,'apply',async()=>{preparations++;throw Error('Incompatible portrait reached preparation');});
  const result=route==='ordinary-pool'?(await service.autoSelect(project.id,{sceneIds:[scene.id]})).project:await service.completeWithNativeFallback(project.id);
  assert.ok(searches>0,'The selection path really attempted discovery');
  assert.equal(preparations,0);assert.equal(reviews,0);
  assert.equal(result.scenes[0]!.documentary!.verified,false);
  assert.equal(result.scenes[0]!.audioPath,'saved-voice.wav');
});

test('descriptive legacy identities retain the canonical object without requiring its action or location in metadata',()=>{
  for(const name of ['Cutty Sark (clipper ship), launch at Dumbarton','Cutty Sark preserved ship at Greenwich',
    "Cutty Sark's hull and rigging construction detail",'Cutty Sark museum ship in her modern role at Greenwich']){
    const target={...req,text:'Her story offers a different lesson.',entities:[name],identities:[{name,aliases:[]}],years:[],
      queries:['Cutty Sark Greenwich overview','Cutty Sark hull photograph']};
    const exact=candidate('right','The Cutty Sark'),wrong=candidate('wrong','Adelaide clipper ship at Greenwich');
    const before=structuredClone(target);
    assert.deepEqual(documentaryNamedMetadataShortlist([wrong,exact],target,target.text),[exact],name);
    assert.deepEqual(target,before,'Discovery must not rewrite the actual-file approval requirements');
    assert.equal(exact.match,'unverified');
  }
});

test('canonical discovery handles other proper names and descriptive aliases without broadening to a brand or namesake',()=>{
  for(const [name,aliases,queries,right,wrong] of [
    ['HMS Victory (warship), restoration at Portsmouth',[],['HMS Victory restored ship'],'HMS Victory','HMS Warrior at Portsmouth'],
    ['Airbus A320-200 aircraft landing at Hamburg',[],['Airbus A320-200 landing'],'Airbus A320-200','Airbus A380 landing'],
    ['Marie Curie working in her laboratory',[],['Marie Curie laboratory'],'Marie Curie portrait','Pierre Curie laboratory'],
    ['Мария Кюри, работа в лаборатории',['Marie Curie in the laboratory'],['Marie Curie laboratory'],'Marie Curie portrait','Pierre Curie laboratory'],
    ['Ludwig van Beethoven (composer), portrait',[],['Ludwig van Beethoven portrait'],'Ludwig van Beethoven','Ludwig II portrait'],
  ] as Array<[string,string[],string[],string,string]>){
    const target={...req,text:name,entities:[name],identities:[{name,aliases}],years:[],queries};
    const exact=candidate('right',right),other=candidate('wrong',wrong);
    assert.deepEqual(documentaryNamedMetadataShortlist([other,exact],target,target.text),[exact],name);
  }
});

test('generic or ambiguous legacy descriptions do not impose an impossible exact-name metadata gate',()=>{
  for(const name of ['steamship, representative of the steam era','Steamship, representative of the steam era',
    'preserved sailing vessel at a museum']){
    const target={...req,text:'The rise of steam changed shipping.',entities:[name],identities:[{name,aliases:[]}],years:[],
      queries:['19th century steamship photograph']};
    const real=candidate('real','A paddle steamer at sea');
    assert.deepEqual(documentaryNamedMetadataShortlist([candidate('toy','Steamship scale model'),{...real,id:'unknown',rights:'unknown'},real],target,target.text),[real],name);
    assert.equal(real.match,'unverified','A generic shortlist only permits actual-file review');
  }
});

test('clean canonical names and aliases still exclude a different named model',()=>{
  const target={...req,text:'BMW i8',entities:['BMW i8'],identities:[{name:'BMW i8',aliases:['БМВ i8']}],years:[],
    queries:['BMW i8 photograph']};
  const exact=candidate('right','BMW i8'),translated=candidate('alias','БМВ i8');
  assert.deepEqual(documentaryNamedMetadataShortlist([candidate('wrong','BMW i3'),exact,translated],target,target.text),[exact,translated]);
});

test('descriptive brand aliases cannot discard the discriminator of the primary model',()=>{
  for(const [name,alias,wrong] of [
    ['Airbus A320','Airbus passenger aircraft','Airbus A380'],
    ['Rolls Royce Phantom','Rolls Royce luxury car','Rolls Royce Ghost'],
    ['Nikon D850','Nikon digital camera','Nikon D750'],
    ['Airbus A320-200','Airbus A320 passenger aircraft','Airbus A320-100'],
    ['Airbus A320-200','A320 passenger aircraft','A320-100'],
  ]){
    const target={...req,text:name!,entities:[name!],identities:[{name:name!,aliases:[alias!]}],years:[],queries:[name+' photograph']};
    const exact=candidate('right',name!),other=candidate('wrong',wrong!);
    assert.deepEqual(documentaryNamedMetadataShortlist([other,exact],target,target.text),[exact],alias);
    assert.deepEqual(documentaryNamedMetadataShortlist([other],target,target.text),[],alias);
  }
});

test('specific descriptive aliases and clean alternate names remain eligible',()=>{
  for(const [name,aliases,alternate,wrong] of [
    ['Airbus A320',['Airbus passenger aircraft','A320 passenger aircraft'],'A320','Airbus A380'],
    ['Airbus A320-200',['A320-200 passenger aircraft'],'A320-200','Airbus A320-100'],
    ['BMW i8',['BMW sports car','БМВ i8 спортивный автомобиль'],'БМВ i8','BMW i3'],
    ['Ford Mustang',['Ford passenger car','Mustang'],'Mustang','Ford Fiesta'],
    ['International Business Machines',['IBM'],'IBM','International Paper'],
  ] as Array<[string,string[],string,string]>){
    const target={...req,text:name,entities:[name],identities:[{name,aliases}],years:[],queries:[name+' photograph']};
    const exact=candidate('right',alternate),other=candidate('wrong',wrong);
    assert.deepEqual(documentaryNamedMetadataShortlist([other,exact],target,target.text),[exact],alternate);
    assert.equal(exact.match,'unverified');
  }
});

test('named discovery keeps the proper name when the AI subject appends a description',()=>{
  const target={...req,entities:['Cutty Sark clipper ship'],identities:[{name:'Cutty Sark clipper ship',aliases:[]}],
    queries:['Cutty Sark ship sailing','clipper ship tea trade'],years:[]};
  const generic=candidate('other','aerial view of a five masted tall ship');
  const exact={...candidate('named','The Cutty Sark'),provider:'youtube' as const,kind:'video' as const,videoDefinition:'hd' as const};
  const miniature={...exact,id:'toy',title:'The Cutty Sark scale model'};
  assert.equal(documentaryYouTubeNameFallback(target,target.queries),'Cutty Sark');
  assert.equal(documentaryYouTubeNameFallback(target,[target.queries[0]!,'Cutty Sark mast closeup']),undefined);
  assert.equal(documentaryYouTubeNameFallback(req,target.queries),undefined);
  assert.equal(documentaryNamedVideo(miniature,'Cutty Sark'),false);
  assert.equal(documentaryNamedVideo({...exact,rights:'unknown'},'Cutty Sark'),false);
  assert.equal(documentaryNamedVideo(exact,'Cutty Sark'),true);
  assert.deepEqual(documentaryNamedMetadataShortlist([generic,miniature,{...exact,id:'query-only',title:'Clipper ship',query:'Cutty Sark'},exact],target,''),[exact]);
  assert.deepEqual(documentaryNamedMetadataShortlist([generic,exact],{...target,queries:['different clipper ship']},''),[exact],
    'The canonical identity remains valid when a planned query is broader');
});

test('dated named driving keeps the original action query and bypasses parked walkarounds',()=>{
  const text='A 1965 Ford Mustang drives along a road.';
  const target:DocumentaryRequirement={...req,text,entities:['Ford Mustang'],identities:[{name:'Ford Mustang',aliases:[]}],years:['1965'],queries:['1965 Ford Mustang driving'],
    scriptRequirements:{version:1,scriptText:text,checks:[{id:'car',kind:'object',scriptQuote:'1965 Ford Mustang',required:'1965 Ford Mustang'},
      {id:'drive',kind:'action',scriptQuote:'drives',required:'car driving'}],nonVisual:[]}};
  assert.equal(documentaryNamedDiscoveryQueries(target,['Ford Mustang 1965',...target.queries],text)[0],target.queries[0]);
  const video=(id:string,title:string)=>({...candidate(id,title),kind:'video' as const,durationSeconds:30});
  const parked=video('parked','1965 Ford Mustang walkaround'),wrong=video('wrong','2020 Ford Mustang driving'),right=video('right','1965 Ford Mustang driving');
  assert.deepEqual(documentaryNamedMetadataShortlist([parked,wrong,right],target,text),[right]);
  const drivingOnly={...video('drive-only','1965 Baby Blue Mustang Driving Through Small Town'),durationSeconds:496};
  const mixed={...video('mixed','1965 Ford Mustang cold start and drive'),durationSeconds:113};
  assert.equal(documentaryNamedMetadataShortlist([mixed,drivingOnly],target,text)[0],drivingOnly);
  assert.equal(documentaryNamedMetadataShortlist([video('modern','Ford Mustang GT POV test drive'),mixed,drivingOnly],target,text)[0],drivingOnly);
  assert.equal(drivingOnly.match,'unverified');
  const context={current:{scene:0,text},preceding:[],following:[],earlierTimeReferences:[]};
  assert.equal(documentaryContradictoryModelYear(wrong,target,context),true);
  assert.equal(documentaryContradictoryModelYear({...right,title:'1965 Ford Mustang filmed in 2024'},target,context),false);
  assert.equal(documentaryContradictoryModelYear({...right,title:'Ford Mustang at a 2024 car show',description:'A 1965 Ford Mustang.'},target,context),false,'A modern capture date does not change a documented model year');
  assert.equal(documentaryIdentityMatches(target,'1965 Ford Mustang'),true);
  assert.equal(documentaryIdentityMatches(target,'2020 Ford Mustang'),false);
  assert.equal(documentaryIdentityMatches(target,'1965 Ford Mustang Mach E'),false);
  assert.equal(documentaryIdentityReviewIssue(target,{identityMatch:true,identifiedEntity:'1965 Ford Mustang'}),undefined);
  assert.equal(documentaryContradictoryModelYear({...wrong,durationSeconds:600,description:'Comparing 1965 and 2020 Ford Mustang models'},target,context),false);
  const event={...target,text:'In 2020, the Porsche 911 won the race.',entities:['Porsche 911'],identities:[{name:'Porsche 911',aliases:[]}],years:['2020']};
  const eventContext={...context,current:{scene:0,text:event.text}};
  assert.equal(documentaryContinuityModelYear(event,eventContext),undefined);
  assert.equal(documentaryContradictoryModelYear(video('2019','2019 Porsche 911'),event,eventContext),false,'A model from 2019 can participate in a 2020 event');
  for(const text of ['In 2020, Porsche 911 won the race.','В 2020 Porsche 911 выиграл гонку.']){
    const dated={...event,text},datedContext={...eventContext,current:{scene:0,text}};
    assert.equal(documentaryContinuityModelYear(dated,datedContext),undefined);
    assert.equal(documentaryContradictoryModelYear(video('2019','2019 Porsche 911'),dated,datedContext),false);
  }
});

test('a refused named shortlist retains the final discovery wave fallback within the same six-source bound',async()=>{
  const text='A Porsche 911 drives.';
  const target={...req,text,entities:['Porsche 911'],identities:[{name:'Porsche 911',aliases:[]}],years:[],queries:['Porsche 911 driving'],scriptRequirements:{version:1 as const,scriptText:text,checks:[
    {id:'object',kind:'object' as const,scriptQuote:'Porsche 911',required:'Porsche 911'},
    {id:'action',kind:'action' as const,scriptQuote:'drives',required:'car driving'}],nonVisual:[]}};
  const first={...candidate('wrong','Porsche 911 driving'),kind:'video' as const,durationSeconds:30};
  const good={...candidate('good','Porsche 911 on the road'),kind:'video' as const,durationSeconds:30,description:'Actual driving'};
  const batches=discoverDocumentarySourceBatches({kind:'video',named:true,queries:['Porsche 911 driving'],youtubeQueries:[],stockQueries:[],stopped:()=>false,discover:async()=>[first,good]});
  const batch=await batches.next();assert.equal(batch.done,false);
  const shortlist=documentaryNamedMetadataShortlist(batch.value!,target,text);assert.deepEqual(shortlist,[first]);
  const attempts=documentaryCandidateAttempts(batch.value!,target.entities,shortlist);
  assert.deepEqual(attempts.map(c=>c.id),['wrong','good']);
  let accepted:string|undefined;const tried:string[]=[];
  for(const source of attempts){tried.push(source.id);if(source.id==='good'){accepted=source.id;break;}}
  assert.equal(accepted,'good');assert.deepEqual(tried,['wrong','good']);await batches.return();
});

test('automatic YouTube timeout survives query-repair passes but expires with the user run',()=>{
  const session=new DocumentarySelectionSession();
  session.rememberDownloadTimeout('scene','youtube');
  assert.equal(session.downloadTimedOut('scene','youtube'),true);
  assert.equal(session.downloadTimedOut('other','youtube'),false);
  assert.equal(session.downloadTimedOut('scene','commons'),false);
  assert.equal(new DocumentarySelectionSession().downloadTimedOut('scene','youtube'),false);
});

test('dated aircraft and investigation events retain compact discovery before generic model or portrait searches',()=>{
  for(const item of [
    {name:'Boeing 747',year:'1969',text:'Первый полёт Boeing 747 состоялся в 1969 году.',query:'Boeing 747 first flight 1969 archive footage'},
    {name:'John Kennedy',year:'1963',text:'Убийство Джона Кеннеди произошло в Далласе в 1963 году.',query:'John Kennedy Dallas assassination 1963 archive footage'},
    {name:'Ayrton Senna',year:'1994',text:'Айртон Сенна погиб в аварии в Имоле в 1994 году.',query:'Ayrton Senna Imola accident 1994 archive footage'},
  ]){
    const target={...req,text:item.text,entities:[item.name],identities:[{name:item.name,aliases:[]}],years:[item.year],queries:[item.query]};
    const queries=documentaryNamedDiscoveryQueries(target,[item.name+' '+item.query],item.text);
    assert.ok(queries[0]!.includes(item.year));
    assert.ok(queries[0]!.includes(item.query.split(' ').slice(2,-2).join(' ')));
    assert.ok(!queries[0]!.includes('archive footage'));
    assert.equal(target.queries[0],item.query,'Discovery does not rewrite evidence requirements');
  }
});

test('an interview precedes a fan-club reaction with the same named person',()=>{
  const target={...req,text:'These people made the result: Sophie Durand.',entities:['Sophie Durand'],
    identities:[{name:'Sophie Durand',aliases:[]}],years:[],detail:'Person and team members'};
  const fans={...candidate('fans','Sophie Durand fan club members reaction'),kind:'video' as const,durationSeconds:30};
  const face={...candidate('face','Sophie Durand interview'),kind:'video' as const,durationSeconds:60};
  assert.equal(documentaryNamedMetadataShortlist([fans,face],target,target.text)[0]!.id,'face');
  assert.equal(face.match,'unverified','Search order cannot approve a person');
});

test('resuming a failed fallback retains the exact referent and concrete stock objects',()=>{
  const fallback={...req,visualScope:'illustrative' as const,illustrationFallbackVersion:1 as const,identities:[],entities:[],years:[],queries:['laboratory equipment'],
    narrativeIdentities:req.identities,narrativeEntities:req.entities,narrativeYears:req.years,narrativeQueries:req.queries};
  const exact=documentaryExactRequirementForRetry(fallback)!;
  assert.equal(exact.visualScope,'exact');assert.deepEqual(exact.identities,req.identities);assert.deepEqual(exact.queries,req.queries);
  assert.equal(fallback.visualScope,'illustrative');assert.equal(documentaryExactRequirementForRetry({...fallback,illustrationFallbackVersion:undefined}),undefined);
  assert.equal(documentaryBroadIllustrationStockQuery({...fallback,queries:['motogp race motorcycle preparation in team pit garage']}),'motorcycle garage');
  assert.equal(documentaryBroadIllustrationStockQuery({...fallback,queries:['four cylinder motorcycle engine close up view']}),'motorcycle engine');
});

test('translated referents are searched separately and shared across scenes',()=>{
  const queries=documentaryNamedDiscoveryQueries(req,req.queries,req.text);
  assert.equal(queries[0],'Marie Curie 1903');assert.ok(queries.includes('Pierre Curie 1903'));
  assert.equal(queries[1],'Pierre Curie 1903','Both named people belong to the first two video queries');
  assert.ok(queries.includes(req.queries[0]!));assert.ok(queries.length<=4);
  const session=new DocumentarySelectionSession();
  assert.equal(session.group(req,'image')!.key,session.group({...req,identities:req.identities!.slice(0,1)},'image')!.key);
  assert.equal(session.group(req,'image')!.query,'marie curie 1903');
  assert.notEqual(session.group(req,'image')!.key,session.group({...req,years:['1911']},'image')!.key);
});

test('named metadata orders discovery, excludes gameplay and never approves pixels',()=>{
  const wanted=candidate('wanted','Marie Curie 1903 portrait');
  const list=documentaryNamedMetadataShortlist([candidate('game','Marie Curie simulator gameplay'),candidate('unrelated','Laboratory'),candidate('wrong-era','Marie Curie 1911 portrait'),wanted],req,req.text);
  assert.equal(list[0],wanted);assert.equal(list.length,2,'An event year alone is not a model-year exclusion');assert.ok(list.every(item=>item.match==='unverified'));
  assert.ok(documentaryNamedMetadataIssue({...wanted,title:'Review Canon EOS550D',description:'Diecast scale model 1:12'}));
  assert.equal(documentaryNamedMetadataIssue({...wanted,title:'Canon EOS550D camera review',description:'Actual camera demonstration'}),undefined);
  assert.ok(documentaryNamedMetadataIssue({...wanted,title:'Canon EOS550D escala 1:12'}));
  assert.ok(documentaryNamedMetadataIssue({...wanted,title:'Minichamps Canon EOS550D miniature'}));
});

test('thematic refinement cannot reintroduce a narrative person, model or year',()=>{
  const thematic={...req,identities:[],visualScope:'illustrative' as const,narrativeIdentities:req.identities};
  assert.equal(documentaryThematicQueryAllowed(thematic,'scientist working in laboratory'),true);
  assert.equal(documentaryThematicQueryAllowed(thematic,'Marie Curie portrait'),false);
  assert.equal(documentaryThematicQueryAllowed(thematic,'Мария Кюри laboratory'),false);
  assert.equal(documentaryThematicQueryAllowed(thematic,'laboratory 1903 equipment'),false);
});

test('event and exposed-part discovery retains the precise planned queries before generic model views',()=>{
  const event={...req,identities:[{name:'Nikon D850',aliases:[]}],years:['2020'],queries:['2020 Tokyo exhibition opening','Tokyo camera exhibition 2020 archive']};
  assert.deepEqual(documentaryNamedDiscoveryQueries(event,event.queries,'The camera was exhibited in Tokyo.').slice(0,2),['2020 Tokyo exhibition opening','Tokyo camera exhibition 2020']);
  const part={...event,years:[],queries:['camera shutter mechanism exposed','camera shutter cutaway']};
  assert.deepEqual(documentaryNamedDiscoveryQueries(part,part.queries,'An exposed crankshaft rotates.').slice(0,2),part.queries);
  const prefixed=event.queries.map(query=>'Nikon D850 '+query);
  assert.equal(documentaryNamedDiscoveryQueries(event,prefixed,'The camera was exhibited in Tokyo.')[0],event.queries[0],'An inherited model prefix must not displace the original event');
  const win={...req,identities:[{name:'Sophie Durand',aliases:[]}],years:['2020'],queries:['Sophie Durand Tokyo 2020 finish line win','Sophie Durand first win parc ferme']};
  assert.deepEqual(documentaryNamedDiscoveryQueries(win,win.queries,'She won the first race.').slice(0,2),['Sophie Durand Tokyo 2020','Durand Tokyo 2020']);
});

test('an actual catalogue frame from a different year is excluded before a paid event range review',()=>{
  const scene={narration:'The 2004 race.',documentary:{requirement:{...req,years:['2004']}}} as Parameters<typeof documentaryCatalogIdentityConflict>[0];
  const shot={id:0,description:'Marie Curie at the 1903 ceremony',entities:['Marie Curie','1903']} as Parameters<typeof documentaryCatalogIdentityConflict>[1];
  assert.equal(documentaryCatalogIdentityConflict(scene,shot,[shot]),true);
  assert.equal(documentaryCatalogIdentityConflict({...scene,documentary:{...scene.documentary!,requirement:{...req,years:[]}}},shot,[shot]),false);
});

test('model suffix spacing matches but unknown rights still fail',()=>{
  const model={...req,identities:[{name:'Canon EOS550D',aliases:[]}],years:[],queries:['Canon EOS550D camera']};
  const real=candidate('camera','Canon EOS550 D');
  assert.deepEqual(documentaryNamedMetadataShortlist([{...real,id:'unknown',rights:'unknown'},real],model,'The camera has a high resolution sensor.'),[real]);
});

test('named discovery avoids generic stock queries and acceptance stops later waves',async()=>{
  const calls:string[]=[];
  const batches=discoverDocumentarySourceBatches({kind:'image',named:true,queries:['Marie Curie','Pierre Curie'],youtubeQueries:[],stockQueries:[],stopped:()=>false,
    discover:async(query,providers)=>{calls.push(query+':'+providers.join(','));return [candidate(query,query)];}});
  assert.equal((await batches.next()).value!.length,1);await batches.return();assert.deepEqual(calls,['Marie Curie:web']);
  const all=discoverDocumentarySourceBatches({kind:'image',named:true,queries:['Marie Curie','Pierre Curie'],youtubeQueries:[],stockQueries:[],stopped:()=>false,
    discover:async(_query,providers)=>{assert.ok(!providers.includes('pexels')&&!providers.includes('pixabay'));return [];}});
  for await(const _batch of all){};
});

test('video first wave includes stock without sending YouTube operators to it or repeating its query',async()=>{
  const calls:Array<{query:string;providers:string[]}>=[];
  const batches=discoverDocumentarySourceBatches({kind:'video',named:true,queries:['Porsche 911'],youtubeQueries:['Porsche 911 -gameplay'],stockQueries:['Porsche 911','Porsche driving'],stopped:()=>false,
    discover:async(query,providers)=>{calls.push({query,providers});return [candidate(providers[0]!+query,query)];}});
  const first=await batches.next();
  assert.ok(first.value!.some(item=>item.title==='Porsche 911'));
  assert.deepEqual(calls,[{query:'Porsche 911 -gameplay',providers:['web']},{query:'Porsche 911',providers:['pexels','pixabay']}]);
  for await(const _batch of batches){};
  assert.equal(calls.filter(call=>call.query==='Porsche 911'&&call.providers[0]==='pexels').length,1);
});

test('a brand alone cannot replace the named person; an explicitly listed alternative remains eligible',()=>{
  const person={...req,text:'Marie Curie worked with Kodak.',identities:[req.identities![0]!,{name:'Kodak',aliases:[]}],years:[]};
  assert.match(documentaryIdentityReviewIssue(person,{identityMatch:true,identifiedEntity:'Kodak'})!,/общий бренд/);
  assert.equal(documentaryIdentityReviewIssue(person,{identityMatch:true,identifiedEntity:'Marie Curie'}),undefined);
  assert.equal(documentaryIdentityReviewIssue({...person,text:'Marie Curie and Kodak.'},{identityMatch:true,identifiedEntity:'Kodak'}),undefined);
  const qualified={...person,entities:['Marie Curie','Kodak'],identities:[req.identities![0]!,{name:'Kodak Brownie',aliases:['Kodak']}]};
  assert.match(documentaryIdentityReviewIssue(qualified,{identityMatch:true,identifiedEntity:'Kodak Brownie'})!,/общий бренд/);
  assert.equal(documentaryIdentityReviewIssue(qualified,{identityMatch:true,identifiedEntity:'Marie Curie'}),undefined);
});

test('a complete surname enumeration allows one exact subject, but a relationship does not',()=>{
  const list={...req,text:'За результатом стояли люди: Кюри, Эйнштейн и команда.',identities:[{name:'Marie Curie',aliases:['Мария Кюри']},{name:'Albert Einstein',aliases:['Альберт Эйнштейн']},{name:'Kodak',aliases:[]}]};
  assert.equal(documentaryListsNamedSubjects(list),true);
  assert.equal(documentaryListsNamedSubjects({...list,text:'Кюри и Эйнштейн работали вместе: исследование, теория.'}),false);
  assert.equal(documentaryListsNamedSubjects({...list,text:'Кюри читала: книгу, статью.'}),false);
});

test('model specifications inherit only an explicit model year, not a dated purchase or unrelated event',()=>{
  const model={...req,text:'Nikon D850 has the same sensor size.',identities:[{name:'Nikon D850',aliases:[]}],years:[]};
  const context={current:{scene:2,text:model.text},preceding:[{scene:1,text:'In 2020 she chose Nikon.'}],following:[],earlierTimeReferences:[]};
  assert.equal(documentaryContinuityModelYear(model,context),undefined);
  assert.equal(documentaryContradictoryModelYear(candidate('new','Nikon D850 2024 version'),model,context),false);
  const explicit={...context,preceding:[{scene:1,text:'She chose the 2020 Nikon D850.'}]};
  assert.equal(documentaryContinuityModelYear(model,explicit),'2020');
  assert.equal(documentaryContradictoryModelYear(candidate('new','Nikon D850 2024 version'),model,explicit),true);
  assert.equal(documentaryContinuityModelYear(model,{...context,current:{scene:2,text:'Her previous Nikon D850.'}}),undefined);
  assert.equal(documentaryContinuityModelYear(model,{...context,preceding:[{scene:1,text:'In 2020 she travelled to Paris.'}]}),undefined);
});

test('a rejected image stays rejected through a library alias; long videos do not lose other intervals',()=>{
  const image=candidate('commons:portrait','Portrait'),checksum='b'.repeat(64);
  const rejected=new Set(documentaryVisualRejectionKeys(image,checksum));
  const local={...image,id:`local:${checksum}`,provider:'local' as const,localPath:`D:/cache/${checksum}.jpg`};
  assert.ok(documentaryVisualRejectionKeys(local).some(key=>rejected.has(key)));
  const long={...image,kind:'video' as const,durationSeconds:600};
  const first={...long,excerpt:{sourceChecksum:'c'.repeat(64),sourceDurationSeconds:600,startSeconds:0,endSeconds:8}},second={...long,excerpt:{sourceChecksum:'c'.repeat(64),sourceDurationSeconds:600,startSeconds:30,endSeconds:38}};
  assert.ok(!documentaryVisualRejectionKeys(second).some(key=>documentaryVisualRejectionKeys(first,checksum).includes(key)));
});

test('a legacy ten-second file cannot replace the full long source; explicit excerpts retain their offsets',()=>{
  const source={...candidate('youtube:archive','Archive'),kind:'video' as const,durationSeconds:600};
  assert.equal(documentaryCachedRangeMatches({...source,durationSeconds:10},source,5),false);
  assert.equal(documentaryCachedRangeMatches({...source,durationSeconds:599.8},source),true);
  const excerpt={...source,durationSeconds:10,excerpt:{sourceChecksum:'d'.repeat(64),sourceDurationSeconds:600,startSeconds:300,endSeconds:310}};
  assert.equal(documentaryCachedRangeMatches(excerpt,source,5),true);
  assert.equal(documentaryCachedRangeMatches(excerpt,{...source,excerpt:{...excerpt.excerpt,startSeconds:100,endSeconds:110}}),false);
});
