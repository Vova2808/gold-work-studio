import test from 'node:test';
import assert from 'node:assert/strict';
import type {Scene,DocumentaryCandidate} from '@gold-work/shared';
import {documentaryMaterialMetadataIssue} from './documentary-material-metadata.js';
const scene=(quote:string)=>({narration:'A robot cuts an '+quote+'.',documentary:{requirement:{scriptRequirements:{version:1,
 scriptText:'A robot cuts an '+quote+'.',checks:[{id:'part',kind:'object',scriptQuote:quote,required:quote}],nonVisual:[]}}}} as unknown as Scene);
const source=(title:string)=>({title,description:'',previousFrameSearchHint:''} as DocumentaryCandidate);
const namedScene=(name:string,narration:string,target=name)=>({narration,documentary:{requirement:{
  text:narration,identities:[{name,aliases:[]}],entities:[name],years:[],queries:[],detail:target}}} as unknown as Scene);
const groundedScene=(required:string,quote:string,subject:string,target=subject)=>{
 const result=namedScene(required,quote,target);
 result.documentary!.requirement.aiSearchPlan={version:1,inputHash:'fixture',model:'fixture',subject,visualTarget:target,
  years:[],visualScope:'illustrative',preferredKind:'image',imageQueries:[target],videoQueries:[],fallbackVideoQueries:[],fallbackVisualTarget:'',
  grounding:{version:1,mandatory:[{kind:'identity',required,scriptQuote:quote}],illustrations:['An attributed view of the same subject'],optionalDetails:[]}};
 return result;
};

test('namesake drinks fail before pixels even when a nautical target omits the word ship',()=>{
 for(const name of ['Cutty Sark','Aurora']){
  const current=groundedScene(name,name+' lost her rudder in heavy weather.',name,name+' at sea under sail');
  for(const title of ['台湾のオレンジジュースが美味しい。光泉果汁時刻 加 '+name,name]){
   const candidate={...source(title),kind:'video' as const,provider:'local' as const,
    description:name+' is a range of blended Scotch whisky produced by a distillery. The brand was named after the historic ship '+name+'.'};
   assert.match(documentaryMaterialMetadataIssue(current,candidate)??'',/напит/iu,title);
  }
  for(const description of [name+' is a ship unloading whisky barrels.',name+' sailing past a whisky advertisement.',name+' at sea.'])
   assert.equal(documentaryMaterialMetadataIssue(current,{...source(name),description}),undefined,description);
  for(const drink of ['whisky','rum','gin','wine','champagne'])
   assert.equal(documentaryMaterialMetadataIssue(current,{...source(name+' with '+drink+' barrels on deck'),
    description:'The ship '+name+' unloading '+drink+' barrels at the quay.'}),undefined,drink+' cargo');
  assert.equal(documentaryMaterialMetadataIssue(groundedScene(name,name+' whisky',name,name+' whisky bottle with a ship on its label'),
   {...source(name),description:name+' is a brand of Scotch whisky.'}),undefined);
  for(const drink of ['rum','gin','wine','champagne'])
   assert.equal(documentaryMaterialMetadataIssue(groundedScene(name,name+' '+drink,name,name+' '+drink+' bottle with a ship on its label'),
    {...source(name),description:name+' is a brand of '+drink+'.'}),undefined,drink);
 }
});

test('a homonymous venue is rejected before vision, without rejecting the actual vehicle beside a venue',()=>{
 for(const [name,target,venue] of [['Cutty Sark','Cutty Sark clipper ship','public house'],['Spitfire','Spitfire aircraft','tavern']]){
  const current=groundedScene(name!,name!+' entered service.',name!,target!);
  const candidate={...source(name!+' Frontage'),description:'The distinctive window frontage of the listed '+venue+', '+name+'.'};
  assert.match(documentaryMaterialMetadataIssue(current,candidate)??'',/заведение или станцию/);
  assert.equal(documentaryMaterialMetadataIssue(current,{...candidate,description:'The '+target+' is visible beside a '+venue+'.'}),undefined);
  assert.equal(documentaryMaterialMetadataIssue(current,{...source(name!),description:name+' at the museum, with a hotel visible in the background.'}),undefined);
  assert.equal(documentaryMaterialMetadataIssue(current,{...source(name!),description:name+' outside the museum, near a hotel.'}),undefined);
  assert.equal(documentaryMaterialMetadataIssue(groundedScene(name!,name!+' is a '+venue+'.',name!,name!+' '+venue),candidate),undefined);
 }
});

test('title adjacency to a venue does not identify the named vehicle as that venue',()=>{
 for(const [name,target] of [['Cutty Sark','Cutty Sark clipper ship'],['Spitfire','Spitfire aircraft'],['Aurora','Aurora locomotive']]){
  const current=groundedScene(name!,name!+' entered service.',name!,target!);
  for(const relation of ['near a hotel','beside a tavern','next to a restaurant','in front of a pub','opposite a railway station',
    'outside a hotel','behind a tavern','alongside a hotel facade','рядом с рестораном']){
   const title=name+' '+relation;
   assert.equal(documentaryMaterialMetadataIssue(current,source(title)),undefined,title);
  }
  assert.equal(documentaryMaterialMetadataIssue(current,{...source(name+' near a hotel frontage'),description:'A hotel in the background.'}),undefined);
  for(const title of [name+' pub',name+' hotel near the museum',name+' tavern beside a hotel','Hotel near '+name])
   assert.match(documentaryMaterialMetadataIssue(current,source(title))??'',/заведение или станцию/,title);
  assert.match(documentaryMaterialMetadataIssue(current,{...source(name+' Frontage beside a hotel'),
   description:'The window frontage of the listed public house named '+name+'.'})??'',/заведение или станцию/);
 }
});

test('saved scenes 2 and 40 reject the same camera-platform mention despite a sentence-shaped identity',()=>{
 const candidate={...source('Four masted ship woodget c1895.jpg'),
  description:"photograph of a four masted sailing ship taken from the deck of 'Cutty Sark' by her captain Richard Woodget.",
  author:'Richard Woodget (1845 – 6 March 1928)'};
 const second=groundedScene('the ship Cutty Sark','Cutty Sark slid into the water at Dumbarton, Scotland','Cutty Sark','Cutty Sark under sail or hull profile');
 const fortieth=groundedScene('Cutty Sark is the ship that completed eight tea voyages and then left the tea trade',
  'After eight tea voyages, Cutty Sark left the trade for which she had been built.','Cutty Sark (clipper ship)',
  'Cutty Sark, the sailing clipper ship, archival photograph or historical view');
 for(const current of [second,fortieth]){
  assert.match(documentaryMaterialMetadataIssue(current,candidate)!,/точке съёмки/);
  assert.equal(documentaryMaterialMetadataIssue(current,{...candidate,title:'Cutty Sark under sail',
   description:'Photograph of Cutty Sark taken from the deck of another ship.'}),undefined);
 }
 // The active reserve must not erase the primary grounded identity.
 fortieth.documentary!.requirement.footageFallback={version:1,target:'Cutty Sark, three-masted clipper ship, archival photograph',
  queries:['Cutty Sark three-masted ship'],originalTarget:fortieth.documentary!.requirement.aiSearchPlan!.visualTarget,
  narration:fortieth.narration,kind:'video',reason:'Earlier primary discovery exhausted'};
 assert.match(documentaryMaterialMetadataIssue(fortieth,candidate)!,/точке съёмки/);
});

test('canonical grounded subjects keep source roles and model discriminators across unrelated topics',()=>{
 const plane=groundedScene('Spitfire is the aircraft described in this passage','Spitfire served in the squadron.',
  'Spitfire (aircraft)','Spitfire aircraft');
 assert.match(documentaryMaterialMetadataIssue(plane,{...source('Unidentified aircraft'),
  description:'Photograph of an aircraft taken from the cockpit of Spitfire by its pilot.'})!,/точке съёмки/);
 const scientist=groundedScene('Marie Curie is the scientist whose research is discussed','Marie Curie studied radioactivity.',
  'Marie Curie (person)','Marie Curie portrait');
 assert.match(documentaryMaterialMetadataIssue(scientist,source('Laboratory apparatus photographed by Marie Curie'))!,/противоречит|предмет/);
 const model=groundedScene('Airbus A320 is the aircraft discussed','Airbus A320 entered service.','Airbus (aircraft)','Airbus A320 aircraft');
 assert.equal(documentaryMaterialMetadataIssue(model,{...source('Unidentified aircraft'),description:'Photograph taken from the cockpit of Airbus.'}),undefined,
  'A generic manufacturer cannot replace the required aircraft model');
 const associated=groundedScene('Captain Morgan, owner of Aurora','Captain Morgan owned Aurora.','Aurora (ship)','Captain Morgan portrait');
 assert.equal(documentaryMaterialMetadataIssue(associated,source('Captain Morgan aboard Aurora')),undefined,
  'The associated ship is not a second required identity');
 const unknown={...source('Untitled archival photograph'),description:'An archival image. Photographer Morgan was captain of Aurora.'};
 assert.equal(documentaryMaterialMetadataIssue(groundedScene('Aurora is the ship discussed','Aurora sailed.','Aurora (ship)'),unknown),undefined,
  'A biographical mention alone proves neither the presence nor the absence of the depicted subject');
});

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

test('animal keyword portraits and names before a vessel class are early refusals, not name-match evidence',()=>{
 const person=namedScene('John Willis','Her owner, John Willis, was betting on speed.','John Willis portrait');
 assert.match(documentaryMaterialMetadataIssue(person,source('puppy sleeping pet owner adorable animal canine cute nature dog sleep sleeping puppy asleep portrait'))!,/животное/);
 assert.match(documentaryMaterialMetadataIssue(namedScene('Ada Lovelace','Show Ada Lovelace.','Ada Lovelace portrait'),source('kitten cat portrait'))!,/животное/);
 for(const title of ['A woman holding a puppy','Dog with its owner','John Willis with a dog'])
  assert.equal(documentaryMaterialMetadataIssue(person,source(title)),undefined,title);
 assert.match(documentaryMaterialMetadataIssue(namedScene('Cutty Sark','Cutty Sark sailed.','Cutty Sark ship'),
  source('The Galaxy Clipper ferry cruising the Thames in London, with passengers aboard and cityscape in view.'))!,/другой объект/);
 assert.match(documentaryMaterialMetadataIssue(namedScene('RMS Titanic','RMS Titanic sailed.'),source('SS Olympic ocean liner underway'))!,/другой объект/);
 for(const title of ['Cutty Sark clipper at Greenwich','Unknown ferry on a river','Sailing ship at sea'])
  assert.equal(documentaryMaterialMetadataIssue(namedScene('Cutty Sark','Cutty Sark sailed.'),source(title)),undefined,title);
});

test('a namesake beverage and explicitly named foreign-language yacht are not the required vessel',()=>{
 const ship=namedScene('Cutty Sark','Cutty Sark left the tea trade.','Cutty Sark sailing ship');
 assert.match(documentaryMaterialMetadataIssue(ship,source('台湾のオレンジジュースが美味しい。光泉果汁時刻 加 Cutty Sark カティサーク'))!,/напиток/);
 assert.match(documentaryMaterialMetadataIssue(namedScene('Aurora','Aurora sailed.','Aurora ship'),source('Aurora whisky review'))!,/напиток/);
 assert.match(documentaryMaterialMetadataIssue(ship,source('Gaston Kreps nos ensenia su velero "Reliance" botado en San Isidro'))!,/другой объект/);
 assert.match(documentaryMaterialMetadataIssue(namedScene('Aurora','Aurora sailed.'),source('Le voilier "Belle Etoile" au port'))!,/другой объект/);
 assert.equal(documentaryMaterialMetadataIssue(ship,source('Tour of Cutty Sark ship and the whisky named after her')),undefined);
 assert.equal(documentaryMaterialMetadataIssue(namedScene('Aurora','Aurora whisky was produced.','Aurora whisky bottle'),source('Aurora whisky review')),undefined);
});

test('a captain grave stays irrelevant when the task changes from his portrait to his ship',()=>{
 const ship=namedScene('Cutty Sark','In 1885, Richard Woodget became captain.','Cutty Sark clipper ship');
 const grave=source('The grave of Richard Woodget in Burnham Norton - geograph.org.uk - 5565045.jpg');
 assert.match(documentaryMaterialMetadataIssue(ship,grave)!,/захоронение/);
 assert.match(documentaryMaterialMetadataIssue(namedScene('Aurora','Her captain was remembered.','Aurora ship'),source('Tomb of Captain Smith'))!,/захоронение/);
 assert.match(documentaryMaterialMetadataIssue(namedScene('Aurora','Her captain was remembered.','Aurora ship'),source('Могила капитана Смита'))!,/захоронение/);
 assert.equal(documentaryMaterialMetadataIssue(namedScene('Richard Woodget','His grave remains.','grave of Richard Woodget'),grave),undefined);
 assert.equal(documentaryMaterialMetadataIssue(ship,source('Cutty Sark at Greenwich')),undefined);
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

test('a saved reserve cannot bypass original grounded identity when its title explicitly depicts another subject',()=>{
  const person=namedScene('Richard Woodget, captain of Cutty Sark','Richard Woodget became captain.','Richard Woodget portrait');
  person.documentary!.requirement.aiSearchPlan={subject:'Richard Woodget',visualTarget:'Richard Woodget portrait',imageQueries:['Richard Woodget portrait'],videoQueries:[],
    grounding:{version:1,mandatory:[{kind:'identity',required:'Richard Woodget, captain of Cutty Sark',scriptQuote:person.narration}],illustrations:['portrait'],optionalDetails:[]}} as any;
  person.documentary!.requirement.footageFallback={version:1,target:'Cutty Sark ship sailing',queries:[],reason:'',originalTarget:'Richard Woodget portrait'};
  person.documentary!.requirement.fastSourcePolicy='background';
  for(const title of ['The Cutty Sark ship','Ship Scale Models Navigational Sailing','Aircraft in a hangar'])
    assert.match(documentaryMaterialMetadataIssue(person,source(title))!,/конкретный человек/,title);
  assert.equal(documentaryMaterialMetadataIssue(person,source('Richard Woodget aboard Cutty Sark ship')),undefined);
  assert.equal(documentaryMaterialMetadataIssue(person,source('Unidentified archive view')),undefined,'Absence of a name is not a contradiction');
  assert.equal(documentaryMaterialMetadataIssue(person,source('Walking around Greenwich')),undefined,'A tour title alone does not prove absent subject');
  const ship=namedScene('Cutty Sark','Cutty Sark left the tea trade.');
  ship.documentary!.requirement.aiSearchPlan={subject:'Cutty Sark',visualTarget:'Cutty Sark ship',imageQueries:['Cutty Sark ship'],videoQueries:[],
    grounding:{version:1,mandatory:[{kind:'identity',required:'the ship Cutty Sark',scriptQuote:ship.narration}],illustrations:['same ship'],optionalDetails:[]}} as any;
  ship.documentary!.requirement.footageFallback={version:1,target:'sailing ship',queries:[],reason:'',originalTarget:'Cutty Sark'};
  assert.match(documentaryMaterialMetadataIssue(ship,source("Clipper Ship 'Blackadder' under sail"))!,/противоречит/);
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
