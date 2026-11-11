import test from 'node:test';
import assert from 'node:assert/strict';
import type {Scene,DocumentaryCandidate} from '@gold-work/shared';
import {documentaryMaterialMetadataIssue} from './documentary-material-metadata.js';
const scene=(quote:string)=>({narration:'A robot cuts an '+quote+'.',documentary:{requirement:{scriptRequirements:{version:1,
 scriptText:'A robot cuts an '+quote+'.',checks:[{id:'part',kind:'object',scriptQuote:quote,required:quote}],nonVisual:[]}}}} as unknown as Scene);
const source=(title:string)=>({title,description:'',previousFrameSearchHint:''} as DocumentaryCandidate);
const namedScene=(name:string,narration:string,target=name)=>({narration,documentary:{requirement:{
  text:narration,identities:[{name,aliases:[]}],entities:[name],years:[],queries:[],detail:target}}} as unknown as Scene);

test('source description distinguishes the pictured ship from the camera platform',()=>{
  const candidate={...source('Four masted ship woodget c1895.jpg'),
    description:"photograph of a four masted sailing ship taken from the deck of 'Cutty Sark' by her captain Richard Woodget."};
  assert.match(documentaryMaterialMetadataIssue(namedScene('Cutty Sark','Cutty Sark sailed.'),candidate)!,/точке съёмки/);
  const valid={...source('Untitled archival photograph'),description:'Photograph of RMS Titanic taken from the deck of SS Olympic.'};
  assert.equal(documentaryMaterialMetadataIssue(namedScene('RMS Titanic','RMS Titanic sailed.'),valid),undefined);
});

test('mentioning a captain in narration does not make the ship a person with an extended surname',()=>{
  assert.equal(documentaryMaterialMetadataIssue(namedScene('Cutty Sark',
    'Under captain Richard Woodget, Cutty Sark sailed quickly.'),source('Cutty Sark Greenwich View.jpg')),undefined);
});

test('decorative map props are not evidence for a geographic route',()=>{
 const route=namedScene('Suez Canal','The canal connected two seas.','map comparing routes around Africa and through Suez Canal');
 for(const title of ['holidays car map travel route toy car navigation norway', 'Origami paper boat from a map', 'Rolled maps on a desk'])
  assert.match(documentaryMaterialMetadataIssue(route,source(title))!,/декоративную/);
 assert.equal(documentaryMaterialMetadataIssue(route,source('Historic world route map')),undefined);
});

test('a namesake building and a property listing cannot stand in for a person or ship',()=>{
 assert.match(documentaryMaterialMetadataIssue(namedScene('John Willis','Her owner, John Willis, was betting on speed.','John Willis portrait'),
  source('Dramatic view of Chicago skyline with Willis Tower under cloudy skies.'))!,/городской пейзаж/);
 assert.match(documentaryMaterialMetadataIssue(namedScene('Cutty Sark','Cutty Sark carried sails.','Cutty Sark with sails set'),
  source('3 Bedroom Apartment for sale in Western Cape | Garden Route | Cutty S'))!,/недвижимости/);
 assert.equal(documentaryMaterialMetadataIssue(namedScene('John Willis','Her owner, John Willis, was betting on speed.','John Willis portrait'),
  source('John Willis portrait with a skyline background')),undefined);
});

test('explicit different named vessels, aircraft, locomotives and canals are rejected from the original title before visual payment',()=>{
  const cases=[
    ['Cutty Sark','Clipper Ship \'Blackadder\' at sea with foremast and mainmast broken RMG PY8584.tiff'],
    ['Cutty Sark','The Cuauhtémoc (Mexico) Sets Sail From Dublin - Sunday 26th. August (7864835002).jpg'],
    ['RMS Titanic','Ship \'Olympic\' leaving harbour'],
    ['Hawker Hurricane','Aircraft \'Supermarine Spitfire\' in flight'],
    ['Mallard','Locomotive Flying Scotsman at the station'],
    ['Suez Canal','Panama Canal archival view'],
    ['Southern Ocean','Crossing the Gulf Stream (Sailing voyage)'],
    ['Cape Horn','Cape Town coastline'],
  ];
  for(const [name,title] of cases)assert.match(documentaryMaterialMetadataIssue(namedScene(name!,name!),source(title!))!,/противоречит/,title);
});

test('the camera platform, grave, author and shared name prefix cannot replace the depicted person or ship',()=>{
  const cases=[
    {name:'RMS Titanic',narration:'RMS Titanic crossed the Atlantic.',title:'SS Olympic, taken from the deck of RMS Titanic'},
    {name:'Richard Woodget',narration:'In 1885, Richard Woodget became captain.',title:'The grave of Richard Woodget in Burnham Norton - geograph.org.uk - 5565045.jpg'},
    {name:'John Willis',narration:'Her owner, John Willis, was betting on speed.',title:'John Willis Menard.jpg'},
    {name:'John Willis',narration:'Her owner, John Willis, was betting on speed.',title:'John Willis Clark, ca. 1880, by A. G. Dew-Smith.png'},
    {name:'Marie Curie',narration:'Scientist Marie Curie advanced research.',title:'Pierre Curie portrait'},
    {name:'Marie Curie',narration:'Scientist Marie Curie advanced research.',title:'Laboratory apparatus photographed by Marie Curie'},
  ];
  for(const item of cases)assert.match(documentaryMaterialMetadataIssue(namedScene(item.name,item.narration),source(item.title))!,/противоречит/,item.title);
  const photographer=source('California woodget 1895.jpg');photographer.author='Richard Woodget (1845 – 1928)';
  assert.match(documentaryMaterialMetadataIssue(namedScene('Richard Woodget','Richard Woodget became captain.'),photographer)!,/авторстве/);
});

test('honest same-subject illustrations and unknown metadata stay undecided; thematic substitutions use their separate visual gate',()=>{
  const ship=namedScene('Cutty Sark sails','With all her sails set, she carried 32,000 square feet of canvas.','Cutty Sark with full sail configuration');
  for(const title of ['StateLibQld 1 145047 Cutty Sark (ship).jpg','Cutty Sark (January 2024) 02.jpg',
    'Cutty Sark historical drawing','Cutty Sark Sailing','Four masted ship woodget c1895.jpg','ship underway',
    'Sailing ship at sea','Ship Sailing At Sea','Ship at Suez Canal','Untitled archival view'])assert.equal(documentaryMaterialMetadataIssue(ship,source(title)),undefined,title);
  const person=namedScene('Richard Woodget','Richard Woodget became captain.');
  for(const title of ['Richard Woodget portrait','Captain Richard Woodget','Unknown captain portrait'])
    assert.equal(documentaryMaterialMetadataIssue(person,source(title)),undefined,title);
  const tomb=namedScene('Richard Woodget','Show the grave of Richard Woodget.','grave of Richard Woodget');
  assert.equal(documentaryMaterialMetadataIssue(tomb,source('grave of Richard Woodget')),undefined);
  const reserve=namedScene('Cutty Sark','Cutty Sark left the tea trade.');reserve.documentary!.requirement.footageFallback={version:1,target:'clipper ship',queries:[],reason:'',originalTarget:'Cutty Sark'};
  assert.equal(documentaryMaterialMetadataIssue(reserve,source('Clipper Ship \'Blackadder\' under sail')),undefined);
  const onlyGenerated=source('Untitled');onlyGenerated.description='Ship Blackadder';onlyGenerated.query='Blackadder';
  assert.equal(documentaryMaterialMetadataIssue(ship,onlyGenerated),undefined);
});
test('literal aluminium/steel workpiece conflict from actual 220 is refused without treating generic metadata as proof',()=>{
 assert.match(documentaryMaterialMetadataIssue(scene('aluminium body component'),source('machine cutting steel plate'))!,/противоречит/);
 assert.match(documentaryMaterialMetadataIssue(scene('steel plate'),source('cutting an aluminum sheet'))!,/противоречит/);
 for(const title of ['machine cutting metal plate','aluminium plate cutting','steel and aluminium plates',
  'cutting aluminium plate beside a steel tool','not a steel plate','cutting a non-steel plate',
  'cutting a non‑steel plate','cutting a non–steel plate','steel car with aluminium wheels'])
  assert.equal(documentaryMaterialMetadataIssue(scene('aluminium body component'),source(title)),undefined,title);
 for(const title of ['cutting a non-aluminium sheet','cutting a non‑aluminum panel','cutting a non–aluminium plate'])
  assert.equal(documentaryMaterialMetadataIssue(scene('steel plate'),source(title)),undefined,title);
});
test('comparisons, thematic mode, generated hints and other component categories cannot create a material contradiction',()=>{
 const comparison=scene('aluminium and steel body samples');assert.equal(documentaryMaterialMetadataIssue(comparison,source('steel sample')),undefined);
 assert.equal(documentaryMaterialMetadataIssue(comparison,source('aluminium plate')),undefined);
 const thematic=scene('aluminium plate');thematic.documentary!.requirement.scriptRequirements!.mode='thematic';
 assert.equal(documentaryMaterialMetadataIssue(thematic,source('steel plate')),undefined);
 const hintOnly=source('metal plate');hintOnly.description='Generated claim: steel plate';hintOnly.previousFrameSearchHint='steel plate';hintOnly.query='steel plate';
 assert.equal(documentaryMaterialMetadataIssue(scene('aluminium body component'),hintOnly),undefined);
 assert.equal(documentaryMaterialMetadataIssue(scene('steel tool'),source('aluminium plate')),undefined);
});
test('literal Russian workpiece qualifiers keep the same narrow original-title boundary',()=>{
 const sample=scene('алюминиевую кузовную деталь');sample.narration='Робот режет алюминиевую кузовную деталь.';
 assert.match(documentaryMaterialMetadataIssue(sample,source('Резка стальной пластины'))!,/противоречит/);
 assert.equal(documentaryMaterialMetadataIssue(sample,source('Не стальная пластина')),undefined);
 assert.equal(documentaryMaterialMetadataIssue(sample,source('Не-стальная пластина')),undefined);
});
