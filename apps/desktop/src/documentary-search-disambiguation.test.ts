import test from 'node:test';
import assert from 'node:assert/strict';
import {documentaryConflictingModelTitle,documentaryFirstVideoBatchWorthInspecting,documentarySearchQueries,documentaryStockQueries,documentaryYouTubeQueries,selectDocumentaryCandidates} from './documentary-project-service.js';
import {documentaryContinuityModelYear,documentaryContradictoryModelYear} from './documentary-model-year.js';
import type {DocumentarySceneContext} from './documentary-scene-context.js';
import {documentaryExactNamedShortVideoProbe} from './documentary-exact-short-video.js';
import {discoverDocumentarySourceBatches} from './documentary-discovery.js';
import type {DocumentaryCandidate,DocumentaryRequirement} from '@gold-work/shared';

test('an adjacent script year blocks a contradictory exact-model review before its download',()=>{
  const requirement={text:'And the part of this story you can actually touch ended up in showrooms.',
    entities:['Yamaha YZF-R1'],identities:[{name:'Yamaha YZF-R1',aliases:['YZF-R1']}],years:[],
    queries:['Yamaha YZF-R1 showroom']} as DocumentaryRequirement;
  const context:DocumentarySceneContext={current:{scene:242,text:requirement.text},preceding:[],earlierTimeReferences:[],
    following:[{scene:243,text:'In 2009, Yamaha put a crossplane crankshaft into the YZFR1 road bike.'}]};
  const source={provider:'youtube',kind:'video',title:"Just arrived at Gooch's Power Sports 2012 YAMAHA YZF R1 ONLY $8500",
    description:'Pre-owned Yamaha sportbike',durationSeconds:89.49} as DocumentaryCandidate;
  assert.equal(documentaryContinuityModelYear(requirement,context),'2009');
  assert.deepEqual(documentaryYouTubeQueries(requirement,['Yamaha YZF-R1 2009','Yamaha YZF-R1 showroom'],requirement.text),
    ['Yamaha YZF-R1 2009','Yamaha YZF-R1'], 'The precise year query must precede the generic fallback');
  assert.equal(documentaryContradictoryModelYear(source,requirement,context),true);
  assert.equal(documentaryContradictoryModelYear({...source,title:'2009 YAMAHA YZF R1 showroom'},requirement,context),false);
  assert.equal(documentaryContradictoryModelYear({...source,title:'Yamaha YZF R1 road bike'},requirement,context),false);
  assert.equal(documentaryContradictoryModelYear({...source,title:'Yamaha YZF R1 1000 sportbike'},requirement,context),false,
    'Engine displacement is not a historical year');
  assert.equal(documentaryContradictoryModelYear({...source,title:'2009–2012 Yamaha YZF R1 archive'},requirement,context),false);
  assert.equal(documentaryContradictoryModelYear({...source,description:'2009 and 2012 Yamaha YZF R1 archive'},requirement,context),true,
    'A short 2012 review is not a multi-year archive merely because its description mentions 2009');
  assert.equal(documentaryContradictoryModelYear({...source,durationSeconds:600,description:'2009 and 2012 archive footage'},requirement,context),false);
  const unrelated={...context,following:[{scene:243,text:'In 2009, the Honda RC211V changed racing.'}]};
  assert.equal(documentaryContinuityModelYear(requirement,unrelated),undefined);
  assert.equal(documentaryContradictoryModelYear(source,requirement,unrelated),false,
    'An unrelated next subject cannot date this model');
  assert.equal(documentaryContradictoryModelYear({...source,id:'manual:uploaded',provider:'local'},requirement,context),false,
    'Manually imported material remains available for actual-frame review');
  assert.equal(documentaryContradictoryModelYear({...source,id:'local:saved',provider:'local',kind:'image',
    title:'Yamaha YZF R1 2006 50th Anniversary.jpg',description:'Yamaha YZF-R1 Model 2006'},requirement,context),true,
    'A previously downloaded 2006 still cannot stand in for the 2009 model');
  assert.equal(documentaryContradictoryModelYear({...source,id:'commons:3160760',provider:'commons',kind:'image',
    title:'YAMAHA YZF-R1 2007TMS.jpg',description:'YAMAHA YZF-R1 2008'},requirement,context),true,
    'A year next to letters in a filename still dates the wrong model');
  assert.equal(documentaryContradictoryModelYear({...source,id:'commons:other',provider:'commons',kind:'image',
    title:'Motorcycle display.jpg',description:'Yamaha YZF-R1 model 2008'},requirement,context),true,
    'An undated filename cannot hide a contradictory model year in its description');
});

test('discovery keeps a provided title qualifier instead of searching a common word',()=>{
  const requirement={text:'The film was released.',entities:['Faster'],identities:[{name:'Faster',aliases:['Faster','Faster (2003 film)']}],years:['2003'],queries:['film editing suite','Faster documentary production']};
  const queries=documentarySearchQueries(requirement,'image');
  assert.ok(queries.some(q=>q.includes('Faster (2003 film) film editing suite')));
  assert.ok(queries.some(q=>q.includes('Faster (2003 film) documentary production')));
  assert.ok(queries.includes('film editing suite'),'One literal detail query may find visual evidence hidden by the inherited title');
  assert.ok(queries.includes('Faster (2003 film)'));
  assert.equal(requirement.queries[1],'Faster documentary production','Do not rewrite the saved script/search plan');
  assert.deepEqual(documentarySearchQueries({...requirement,identities:[{name:'Faster',aliases:['Faster']}],queries:['Faster documentary']}),['Faster documentary','Faster']);
});

test('physical-detail footage queries do not spend source slots on an unobservable sound word',()=>{
  const requirement={text:'It gave the engine an uneven firing order, called a big bang engine.',entities:['Yamaha YZR-M1'],
    identities:[{name:'Yamaha YZR-M1',aliases:['Yamaha YZR-M1','YZR-M1']}],years:[],
    queries:['big bang engine firing order MotoGP','Yamaha M1 uneven firing order engine sound']};
  assert.ok(documentarySearchQueries(requirement,'image').every(query=>!/\bsound\b/i.test(query)));
  assert.ok(documentaryStockQueries(requirement).every(query=>!/\bsound\b/i.test(query)));
  assert.equal(requirement.queries[1],'Yamaha M1 uneven firing order engine sound');
});

test('photo-first selection avoids a same-brand review of another explicit model',()=>{
  const requirement={text:'The engine had an uneven firing order.',entities:['Yamaha YZR-M1'],identities:[],years:[],
    preferredKind:'image',queries:['Yamaha M1 engine'],detail:'uneven firing order'} as DocumentaryRequirement;
  const candidate={kind:'video',provider:'youtube',title:'LOOK THIS !!!2018 Yamaha R1S Design Overview Price & Spec',
    description:'The R1 crossplane engine was inspired by the Yamaha M1 MotoGP racer',durationSeconds:163} as DocumentaryCandidate;
  assert.equal(documentaryConflictingModelTitle(candidate,requirement),true);
  assert.equal(documentaryConflictingModelTitle({...candidate,title:'Yamaha YZR-M1 engine technical film'},requirement),false);
  const honda={...requirement,entities:['Honda RC211V']};
  assert.equal(documentaryConflictingModelTitle({...candidate,title:'Honda RC211 V motorcycle documentary'},honda),false,
    'A trailing model letter separated by a space is still the requested machine');
  assert.equal(documentaryConflictingModelTitle({...candidate,title:'Honda RC213 V motorcycle documentary'},honda),true);
  assert.equal(documentaryConflictingModelTitle({...candidate,title:'Yamaha R1S versus M1 engine comparison'},requirement),false);
  assert.equal(documentaryConflictingModelTitle({...candidate,title:'MotoGP engine development archive'},requirement),false);
  assert.equal(documentaryConflictingModelTitle({...candidate,provider:'commons'},requirement),false);
  const savedYouTube={...candidate,provider:'local',pageUrl:'https://www.youtube.com/watch?v=a82Cr-v3c78',localPath:'D:\\saved.mp4'} as DocumentaryCandidate;
  assert.equal(documentaryConflictingModelTitle(savedYouTube,requirement),true,
    'A downloaded copy of the wrong-model review must not consume another paid catalogue check');
  assert.equal(documentaryConflictingModelTitle({...savedYouTube,title:'Yamaha R1S versus M1 engine comparison'},requirement),false);
  assert.equal(documentaryConflictingModelTitle({...savedYouTube,pageUrl:'file:///D:/saved.mp4'},requirement),false,
    'Manually imported local footage remains available for frame inspection');
  assert.equal(documentaryConflictingModelTitle({...candidate,durationSeconds:45},requirement),false);
  assert.equal(documentaryConflictingModelTitle(candidate,{...requirement,preferredKind:'video'}),false);
  const base={...candidate,id:'other-model',rights:'licensed',query:'Yamaha M1 engine',match:'unverified',concerns:[]} as DocumentaryCandidate;
  const exact={...base,id:'exact-model',title:'Yamaha YZR-M1 engine technical film'};
  assert.deepEqual(selectDocumentaryCandidates([base,exact],requirement.entities,new Set(),[],false,[],requirement).map(source=>source.id),['exact-model']);
});

test('one named motorcycle introduction searches the exact model before another verbose YouTube query',()=>{
  const requirement={text:'Start with the motorcycle because Honda certainly did.',entities:['Honda RC211V'],
    identities:[{name:'Honda RC211V',aliases:['RC211V']}],years:[],
    queries:['Honda RC211V MotoGP motorcycle 2002','Honda RC211V race bike close up']};
  assert.deepEqual(documentaryYouTubeQueries(requirement,requirement.queries,requirement.text),
    ['Honda RC211V MotoGP motorcycle 2002','Honda RC211V']);
  assert.deepEqual(documentaryYouTubeQueries({...requirement,years:['2002']},requirement.queries,requirement.text),requirement.queries);
  assert.deepEqual(documentaryYouTubeQueries({...requirement,text:'The crankshaft turns.'},requirement.queries,'The crankshaft turns.'),requirement.queries);
  assert.deepEqual(documentaryYouTubeQueries({...requirement,identities:[{name:'Faster',aliases:['Faster']}]},requirement.queries,requirement.text),requirement.queries);
});

test('a short exact-model result joins a weak first wave before paid ranking',async()=>{
  const requirement={text:'Honda RC211V changed racing.',entities:['Honda RC211V'],identities:[{name:'Honda RC211V',aliases:['RC211V']}],
    years:[],queries:['Honda RC211V 2002 MotoGP','Honda RC211V']} as DocumentaryRequirement;
  const base={provider:'youtube',kind:'video',rights:'licensed',description:'Racing archive',
    query:'Honda RC211V',match:'unverified'} as DocumentaryCandidate;
  const long={...base,id:'long',title:'Valentino Rossi RC211V 1996-2010 career',durationSeconds:611};
  const short={...base,id:'short',title:'Honda RC211V Valentino Rossi',durationSeconds:60};
  const searches:string[]=[];
  const batches:DocumentaryCandidate[][]=[];
  const discover=async(query:string,providers:string[])=>{
    searches.push(`${providers.join(',')}:${query}`);
    if(providers.length===1&&providers[0]==='youtube')return query==='Honda RC211V'?[short]:[long];
    return [];
  };
  for await(const batch of discoverDocumentarySourceBatches({kind:'video',queries:requirement.queries,
    stockQueries:[],youtubeQueries:requirement.queries,discover,stopped:()=>false,
    firstBatchReady:batch=>documentaryFirstVideoBatchWorthInspecting(batch,requirement),
    deferredBatchReady:batch=>documentaryFirstVideoBatchWorthInspecting(batch,requirement)}))batches.push(batch);
  assert.deepEqual(batches.map(batch=>batch.map(candidate=>candidate.id)),[['long','short']]);
  assert.equal(searches.filter(search=>search==='youtube:Honda RC211V 2002 MotoGP').length,1,'Do not repeat the first YouTube API search');
  assert.equal(documentaryFirstVideoBatchWorthInspecting([short],requirement),true);
  assert.equal(documentaryFirstVideoBatchWorthInspecting([{...short,title:'Honda RC211V 2014 MotoGP'}],{...requirement,years:['2002']}),false);
});

test('a short exact named video can be probed after long metadata picks, but dated and action scenes stay strict',()=>{
  const requirement={text:'Meet the Honda RC211V.',entities:['Honda RC211V'],identities:[{name:'Honda RC211V',aliases:[]}],
    years:[],queries:['Honda RC211V']} as DocumentaryRequirement;
  const base={provider:'youtube',kind:'video',rights:'licensed',videoDefinition:'hd',title:'Honda RC211V Valentino Rossi',durationSeconds:60} as DocumentaryCandidate;
  assert.equal(documentaryExactNamedShortVideoProbe([{...base,durationSeconds:611},base],requirement,requirement.text),base);
  assert.equal(documentaryExactNamedShortVideoProbe([{...base,rights:'unknown'}],requirement,requirement.text),undefined);
  assert.equal(documentaryExactNamedShortVideoProbe([{...base,videoDefinition:'sd'}],requirement,requirement.text),undefined);
  assert.equal(documentaryExactNamedShortVideoProbe([base],{...requirement,years:['2002']},requirement.text),undefined);
  assert.equal(documentaryExactNamedShortVideoProbe([base],requirement,'The crankshaft turns.'),undefined);
});

test('a named person in an unrelated sport does not get the early download shortcut',()=>{
  const requirement={text:'Rossi had eight wins, the most for a Yamaha rider.',entities:['Valentino Rossi'],
    identities:[{name:'Valentino Rossi',aliases:['Rossi']}],years:[],
    queries:['Valentino Rossi 2004 season wins Yamaha compilation','Rossi 2004 MotoGP race wins highlights']} as DocumentaryRequirement;
  const unrelated={provider:'youtube',kind:'video',rights:'licensed',videoDefinition:'hd',
    title:'Valentino Rossi Tests The F1 2006 Ferrari Onboard at Misano',durationSeconds:60} as DocumentaryCandidate;
  const relevant={...unrelated,title:'Valentino Rossi Yamaha MotoGP 2004 highlights'};
  assert.equal(documentaryExactNamedShortVideoProbe([unrelated],requirement,requirement.text),undefined);
  assert.equal(documentaryExactNamedShortVideoProbe([unrelated,relevant],requirement,requirement.text),relevant);
  assert.equal(documentaryFirstVideoBatchWorthInspecting([unrelated],requirement),false,'A weak first wave must wait for other providers before another paid ranking');
  assert.equal(documentaryFirstVideoBatchWorthInspecting([relevant],requirement),true);
});
