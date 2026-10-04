import test from 'node:test';
import assert from 'node:assert/strict';
import {documentaryConflictingModelTitle,documentaryFirstVideoBatchWorthInspecting,documentarySearchQueries,documentaryStockQueries,documentaryYouTubeQueries,selectDocumentaryCandidates} from './documentary-project-service.js';
import {documentaryExactNamedShortVideoProbe} from './documentary-exact-short-video.js';
import {discoverDocumentarySourceBatches} from './documentary-discovery.js';
import type {DocumentaryCandidate,DocumentaryRequirement} from '@gold-work/shared';

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
  assert.equal(documentaryConflictingModelTitle({...candidate,title:'Yamaha R1S versus M1 engine comparison'},requirement),false);
  assert.equal(documentaryConflictingModelTitle({...candidate,title:'MotoGP engine development archive'},requirement),false);
  assert.equal(documentaryConflictingModelTitle({...candidate,provider:'commons'},requirement),false);
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
