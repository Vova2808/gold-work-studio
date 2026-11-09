import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readdir,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {Project,Scene,DocumentaryRequirement,DocumentaryCandidate} from '@gold-work/shared';
import {DocumentaryIntelligence,documentaryMetadataShortlist} from './documentary-intelligence.js';
import {documentaryGeneralIllustration,documentaryVisualReviewContext} from './documentary-scene-context.js';
import {documentarySearchQueries,documentaryThematicStockProbe} from './documentary-project-service.js';
import {applyDocumentaryRequirement} from './documentary-visual-relevance.js';
import {documentaryContextApproval,documentarySavedContextIssue} from './documentary-context-approval.js';
import {AnyModelCompletionUncertainError} from './anymodel-client.js';
import {documentaryIllustrationFallback} from './documentary-illustration-fallback.js';

test('only a grounded abstract slice becomes a thematic stock shot; exact and invalid decisions stay strict',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-visual-scope-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const lines=[
    'In 2004, Valentino Rossi rode for Yamaha.',
    'The pressure behind every corner kept rising.',
    'Valentino Rossi raced at Phillip Island.',
    'Its crankshaft turned inside the engine.',
    'A single mistake could change everything.',
    'Each lap was a gamble.',
  ];
  const scene=(narration:string,order:number):Scene=>({id:`s${order}`,order,narration,
    documentary:{verified:false,pinned:false,requirement:{text:narration,entities:['Valentino Rossi'],
      identities:[{name:'Valentino Rossi',aliases:['Rossi']}],identityContextVersion:3,
      years:order===0?['2004']:[],queries:['Valentino Rossi MotoGP race'],plannedBy:'semantic'}}} as unknown as Scene);
  const scenes=lines.map(scene);
  const project={id:'fixture-scope',scenes} as Project;
  let calls=0;
  const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(_system,input)=>{
    calls++;
    const ids=(JSON.parse(input).scenes as Array<{id:string}>).map(item=>item.id);
    assert.deepEqual(ids,['s0','s1','s2','s4','s5']);
    return JSON.stringify({scenes:[
      {id:'s0',scope:'exact',quote:lines[0],query:'Valentino Rossi Yamaha 2004'},
      {id:'s1',scope:'illustrative',quote:lines[1],query:'motorcycle racing corner onboard'},
      {id:'s2',scope:'exact',quote:lines[2],query:'Valentino Rossi race footage'},
      {id:'s4',scope:'illustrative',quote:'words absent from original',query:'motorcycle racing mistake'},
      {id:'s5',scope:'illustrative',quote:lines[5],query:'Valentino Rossi racing onboard'},
    ]});
  }},()=>root);
  const saved=new Map<string,DocumentaryRequirement>();
  await intelligence.resolveVisualScopes(project,scenes,async batch=>{for(const [id,value] of batch)saved.set(id,value);});
  assert.equal(calls,1);
  assert.equal(saved.get('s0')?.visualScope,'exact');
  assert.equal(saved.get('s2')?.visualScope,'exact');
  assert.equal(saved.get('s3')?.visualScope,'exact');
  assert.equal(saved.get('s4')?.visualScope,'exact');
  assert.equal(saved.get('s5')?.visualScope,'exact');
  const generic=saved.get('s1')!;
  assert.equal(generic.visualScope,'illustrative');
  assert.deepEqual(generic.identities,[]);
  assert.equal(generic.narrativeIdentities?.[0]?.name,'Valentino Rossi');
  assert.equal(documentarySearchQueries(generic,'video')[0],'motorcycle racing corner onboard');
  assert.equal(documentaryGeneralIllustration(applyDocumentaryRequirement(scenes[1]!,generic)),true);
  assert.deepEqual(documentaryVisualReviewContext(project,applyDocumentaryRequirement(scenes[1]!,generic)).preceding,[]);
  assert.ok(documentaryVisualReviewContext(project,scenes[2]!).preceding.length>0);
  assert.equal(documentaryGeneralIllustration({...applyDocumentaryRequirement(scenes[1]!,generic),narration:'Different words.'}),false);
});

test('a short thematic stock video found by a concise query reaches pixel review without a long metadata ranking',()=>{
  const requirement={text:'Racing shows how rider and machine work together.',visualScope:'illustrative',
    entities:[],identities:[],years:[],queries:['motorcycle racing rider skill versus machine performance']} as DocumentaryRequirement;
  const scene={narration:requirement.text,documentary:{requirement}} as Scene;
  const stock={id:'pexels:short',provider:'pexels',kind:'video',title:'Motorcycle racing on a track',
    description:'Camera follows racing bikes',query:'motorcycle racing rider',durationSeconds:12,rights:'allowed'} as unknown as DocumentaryCandidate;
  assert.deepEqual(documentaryMetadataShortlist(scene,[stock]),[stock]);
  assert.deepEqual(documentaryMetadataShortlist({...scene,documentary:{...scene.documentary!,requirement:{...requirement,visualScope:'exact'}}},[stock]),[]);
  const sparse={...stock,title:'Riders at sunset',width:1280,height:720};
  assert.deepEqual(documentaryMetadataShortlist(scene,[sparse]),[]);
  assert.equal(documentaryThematicStockProbe([sparse],requirement),sparse);
  assert.equal(documentaryThematicStockProbe([sparse],{...requirement,visualScope:'exact'}),undefined);
  assert.equal(documentaryThematicStockProbe([{...sparse,width:640}],requirement),undefined);
  const darkCruiser={...sparse,id:'pixabay:cruiser',title:'motorcycle engine chopper',durationSeconds:22};
  const racing={...sparse,id:'pexels:racing',title:'motorcycle racing on circuit track',width:1920,height:1080,durationSeconds:10};
  assert.equal(documentaryThematicStockProbe([darkCruiser,racing],{...requirement,
    illustrationQuery:'motorcycle engine racing'}),racing);
});

test('an explicit maker name can remain exact after scene-level classification',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-scope-maker-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const narration="Honda's stated concept for the whole bike was ease of riding.";
  const requirement={text:narration,entities:['Honda RC211V'],identities:[{name:'Honda RC211V',aliases:['RC211V']}],
    identityContextVersion:3,years:[],queries:['Honda RC211V riding'],plannedBy:'semantic'} as DocumentaryRequirement;
  const scene={id:'honda',order:0,narration,documentary:{verified:false,pinned:false,requirement}} as Scene;
  const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>
    JSON.stringify({scenes:[{id:'honda',scope:'exact',quote:narration,query:'Honda RC211V riding'}]})},()=>root);
  let result:DocumentaryRequirement|undefined;
  await intelligence.resolveVisualScopes({id:'fixture-honda',scenes:[scene]} as Project,[scene],async batch=>{result=batch.get(scene.id);});
  assert.equal(result?.visualScope,'exact');
  assert.equal(result?.visualScopeVersion,3);
  assert.equal(result?.identities?.[0]?.name,'Honda RC211V');
});

test('unfinished old exact scope is reconsidered; current exact and approved scenes stay untouched',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-scope-upgrade-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const narration='Dorna helped bring motorcycle racing to a wider audience.';
  const requirement={text:narration,entities:['Dorna Sports'],identities:[{name:'Dorna Sports',aliases:[]}],
    identityContextVersion:3,visualScope:'exact',years:[],queries:['Dorna Sports MotoGP'],plannedBy:'semantic'} as DocumentaryRequirement;
  const old={id:'old',order:0,narration,documentary:{verified:false,pinned:false,requirement}} as Scene;
  const current={...old,id:'current',documentary:{...old.documentary!,requirement:{...requirement,visualScopeVersion:2}}} as Scene;
  const approved={...old,id:'approved',documentary:{...old.documentary!,verified:true}} as Scene;
  const project={id:'scope-upgrade',scenes:[old,current,approved]} as Project;
  let calls=0;
  const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(_system,input)=>{
    calls++;assert.deepEqual(JSON.parse(input).scenes.map((row:{id:string})=>row.id),['old','current']);
    return JSON.stringify({scenes:['old','current'].map(id=>({id,scope:'illustrative',quote:narration,
      query:'motorcycle racing track and riders'}))});
  }},()=>root);
  const saved=new Map<string,DocumentaryRequirement>();
  await intelligence.resolveVisualScopes(project,project.scenes,async batch=>{for(const [id,value] of batch)saved.set(id,value);});
  assert.equal(calls,1);
  assert.deepEqual([...saved.keys()],['old','current']);
  assert.equal(saved.get('old')?.visualScope,'illustrative');
  assert.equal(saved.get('old')?.visualScopeVersion,3);
  assert.equal(saved.get('current')?.visualScope,'illustrative');
  assert.deepEqual(saved.get('old')?.identities,[]);
});

test('a contextual spoken year may use relevant B-roll, while a dated race event stays exact',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-scope-year-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const lines=['Its edit was finished in April 2003.','Rossi won the 2003 Australian Grand Prix.'];
  const scenes=lines.map((narration,order)=>({id:`year-${order}`,order,narration,documentary:{verified:false,pinned:false,
    requirement:{text:narration,entities:['Valentino Rossi'],identities:[{name:'Valentino Rossi',aliases:['Rossi']}],
      identityContextVersion:3,visualScope:'exact',visualScopeVersion:2,years:['2003'],queries:['Valentino Rossi 2003'],
      plannedBy:'semantic'}}} as Scene));
  const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(_system,input)=>{
    assert.deepEqual(JSON.parse(input).scenes.map((row:{id:string})=>row.id),['year-0','year-1']);
    return JSON.stringify({scenes:[
      {id:'year-0',scope:'illustrative',quote:lines[0],query:'documentary film editing workstation'},
      {id:'year-1',scope:'exact',quote:lines[1],query:'Valentino Rossi Australian Grand Prix 2003'},
    ]});
  }},()=>root);
  const saved=new Map<string,DocumentaryRequirement>();
  await intelligence.resolveVisualScopes({id:'fixture-year',scenes} as Project,scenes,async batch=>{
    for(const [id,value] of batch)saved.set(id,value);
  });
  assert.equal(saved.get('year-0')?.visualScope,'illustrative');
  assert.deepEqual(saved.get('year-0')?.years,[]);
  assert.deepEqual(saved.get('year-0')?.narrativeYears,['2003']);
  assert.equal(saved.get('year-1')?.visualScope,'exact');
  assert.deepEqual(saved.get('year-1')?.years,['2003']);
});

test('a name in the preceding slice does not force a generic video close-up of that exact model',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-scope-slice-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const before={id:'before',order:0,narration:'The Honda RC211V had a powerful engine, but'} as Scene;
  const narration=' it made riders work to control the power.';
  const requirement={text:narration,entities:['Honda RC211V'],identities:[{name:'Honda RC211V',aliases:['RC211V']}],
    identityContextVersion:3,years:[],queries:['Honda RC211V power delivery'],plannedBy:'semantic'} as DocumentaryRequirement;
  const current={id:'current',order:1,narration,documentary:{verified:false,pinned:false,requirement}} as Scene;
  const project={id:'scope-slice',scenes:[before,current]} as Project;
  let calls=0,result:DocumentaryRequirement|undefined;
  const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{
    calls++;return JSON.stringify({scenes:[{id:'current',scope:'illustrative',quote:'riders work to control the power',query:'motorcycle racing power delivery'}]});
  }},()=>root);
  await intelligence.resolveVisualScopes(project,[current],async batch=>{result=batch.get('current');});
  assert.equal(calls,1);
  assert.equal(result?.visualScope,'illustrative');
  assert.deepEqual(result?.identities,[]);
  assert.equal(result?.narrativeIdentities?.[0]?.name,'Honda RC211V');
});

test('a non-spoken music marker does not invalidate a grounded illustrative quote',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-scope-music-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const narration='It made around 30% more power than the 500 [music] cm two-stroke it replaced.';
  const requirement={text:narration,entities:['Honda RC211V','Honda NSR500'],identities:[
    {name:'Honda RC211V',aliases:[]},{name:'Honda NSR500',aliases:[]}],identityContextVersion:3,years:[],
    queries:['Honda NSR500 versus RC211V'],plannedBy:'semantic'} as DocumentaryRequirement;
  const scene={id:'power',order:0,narration,documentary:{verified:false,pinned:false,requirement}} as Scene;
  let result:DocumentaryRequirement|undefined;
  const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>JSON.stringify({scenes:[{
    id:'power',scope:'illustrative',quote:'30% more power than the 500 cm two-stroke',query:'500cc two-stroke motorcycle engine racing'}]})},()=>root);
  await intelligence.resolveVisualScopes({id:'music',scenes:[scene]} as Project,[scene],async batch=>{result=batch.get('power');});
  assert.equal(result?.visualScope,'illustrative');
  assert.deepEqual(result?.identities,[]);
});

test('an unmatchable old visual-scope batch keeps the exact plan without another paid request',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-scope-pending-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const analysis=join(root,'Documentary','Analysis');await mkdir(analysis,{recursive:true});
  await writeFile(join(analysis,`${'a'.repeat(64)}.json`),JSON.stringify({state:'partial',purpose:'visual-scope',raw:'{"scenes":'}));
  const narration='It made the engine easier to control.';
  const requirement={text:narration,entities:['Honda RC211V'],identities:[{name:'Honda RC211V',aliases:['RC211V']}],
    identityContextVersion:3,years:[],queries:['motorcycle racing engine'],plannedBy:'semantic'} as DocumentaryRequirement;
  const scene={id:'uncertain',order:0,narration,documentary:{verified:false,pinned:false,requirement}} as Scene;
  const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{
    throw Error('must not submit');
  }},()=>root);
  let saved=0;
  await intelligence.resolveVisualScopes({id:'pending',scenes:[scene]} as Project,[scene],async batch=>{saved+=batch.size});
  assert.equal(saved,0);
  assert.notEqual(scene.documentary!.requirement.visualScope,'illustrative');
});

test('an exact matching pending scope batch is skipped while disjoint scenes continue',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-scope-pending-batch-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const scenes=Array.from({length:26},(_,order)=>{
    const narration=`Honda's production decision ${order+1} shaped its racing work.`;
    return {id:`pending-${order}`,order,narration,documentary:{verified:false,pinned:false,
      requirement:{text:narration,entities:['Honda'],identities:[{name:'Honda',aliases:[]}],
        identityContextVersion:3,visualScope:'exact',visualScopeVersion:2,years:[],
        queries:['Honda racing work'],plannedBy:'semantic'}}} as unknown as Scene;
  });
  scenes[1]!.documentary!.verified=true;
  const project={id:'pending-batch',scenes} as Project;
  let calls=0;
  const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(_system,input)=>{
    calls++;
    if(calls===1)throw new AnyModelCompletionUncertainError('Connection ended after submission');
    const rows=(JSON.parse(input).scenes as Array<{id:string;current:string}>).map(scene=>({
      id:scene.id,scope:'illustrative',quote:scene.current,query:'motorcycle team working in garage'}));
    return JSON.stringify({scenes:rows});
  }},()=>root);
  const saved=new Map<string,DocumentaryRequirement>();
  const save=async(batch:Map<string,DocumentaryRequirement>)=>{for(const [id,value] of batch)saved.set(id,value);};
  await assert.rejects(intelligence.resolveVisualScopes(project,scenes,save),/неизвестен|неизвестн/i);
  // Simulate a checkpoint created before request membership was persisted and
  // one formerly pending scene that became verified in the meantime.
  scenes[4]!.documentary!.verified=true;
  const analysis=join(root,'Documentary','Analysis');
  for(const file of (await readdir(analysis)).filter(name=>name.startsWith('visual-scope-')))
    await rm(join(analysis,file));
  await intelligence.resolveVisualScopes(project,scenes,save);
  assert.equal(calls,4,'The pending eight-scene request must not be sent again');
  assert.equal(saved.has('pending-0'),false);
  assert.equal(saved.has('pending-8'),false);
  assert.equal(saved.get('pending-9')?.visualScope,'illustrative');
  assert.equal(saved.get('pending-25')?.visualScope,'illustrative');
});

test('changing an approved thematic visual target revokes only that saved approval',()=>{
  const requirement={text:'Racing became a test of skill.',entities:[],identities:[],years:[],
    queries:['motorcycle racing track'],visualScope:'illustrative',visualScopeQuote:'test of skill',
    illustrationQuery:'motorcycle racing track'} as DocumentaryRequirement;
  const scene={id:'approval',order:0,narration:requirement.text,imagePath:'frame.jpg',documentary:{verified:true,
    checksum:'pixels',selected:{id:'pexels:1',provider:'pexels',kind:'image',title:'Motorcycles racing',description:'Track'},requirement}} as unknown as Scene;
  const project={id:'approval',scenes:[scene]} as Project;
  const value={status:'accepted',narrativeEvidence:{subjectMatch:true,eraMatch:true,detailMatch:true,
    requiredEra:'none',observedEra:'modern',evidence:'Visible motorcycles race around a real track.'}};
  const approval=documentaryContextApproval(project,scene,value);
  assert.ok(approval);
  const saved={...scene,documentary:{...scene.documentary!,visualReview:{status:'accepted',contextApproval:approval}}} as Scene;
  assert.equal(documentarySavedContextIssue({...project,scenes:[saved]},saved),undefined);
  const changed={...saved,documentary:{...saved.documentary!,requirement:{...requirement,illustrationQuery:'motorcycle garage'}}};
  assert.match(documentarySavedContextIssue({...project,scenes:[changed]},changed)!,/изменился/);
});

test('failed exact archive may use labelled generic video while preserving the original claim',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-fallback-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const narration='In 2004, Valentino Rossi won the motorcycle race at Phillip Island.';
  const requirement={text:narration,entities:['Valentino Rossi'],identities:[{name:'Valentino Rossi',aliases:['Rossi']}],
    years:['2004'],queries:['Valentino Rossi Phillip Island 2004'],identityContextVersion:3,
    visualScope:'exact',visualScopeVersion:3,plannedBy:'semantic'} as DocumentaryRequirement;
  const scene={id:'race',order:0,narration,documentary:{verified:false,pinned:false,requirement}} as Scene;
  const project={id:'fallback',scenes:[scene]} as Project;
  let calls=0,result:DocumentaryRequirement|undefined;
  const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{
    calls++;return JSON.stringify({scenes:[{id:'race',safe:true,quote:'Valentino Rossi won the motorcycle race',
      query:'motorcycle racing on a circuit'}]});
  }},()=>root);
  await intelligence.resolveIllustrationFallbacks(project,[scene],async batch=>{result=batch.get('race');});
  assert.equal(calls,1);
  assert.equal(result?.visualScope,'illustrative');
  assert.equal(result?.illustrationFallbackVersion,1);
  assert.deepEqual(result?.identities,[]);
  assert.deepEqual(result?.years,[]);
  assert.equal(result?.narrativeIdentities?.[0]?.name,'Valentino Rossi');
  assert.deepEqual(result?.narrativeYears,['2004']);
  assert.equal(documentaryGeneralIllustration(applyDocumentaryRequirement(scene,result!)),true);
  assert.equal(result?.preferredKind,'video');
});

test('unsafe fallback, invented fact, named stock query and physical part stay exact',()=>{
  const narration='In 2004 Rossi won the race.';
  const requirement={text:narration,identities:[{name:'Rossi',aliases:[]}],entities:['Rossi'],years:['2004'],
    queries:['Rossi race'],visualScope:'exact',visualScopeVersion:3} as DocumentaryRequirement;
  const scene={narration,documentary:{requirement}} as Scene;
  for(const row of [
    {safe:false,quote:'Rossi won the race',query:'motorcycle racing circuit'},
    {safe:true,quote:'Rossi lost the race',query:'motorcycle racing circuit'},
    {safe:true,quote:'Rossi won the race',query:'Rossi motorcycle racing circuit'},
    {safe:true,quote:'Rossi won the race',query:'motorcycle racing in 2004'},
  ])assert.equal(documentaryIllustrationFallback(scene,row).visualScope,'exact');
  const detail={...scene,narration:'The crankshaft rotates inside the engine.',documentary:{...scene.documentary!,requirement:{...requirement,text:'The crankshaft rotates inside the engine.'}}};
  assert.equal(documentaryIllustrationFallback(detail as Scene,{safe:true,quote:'crankshaft rotates inside the engine',
    query:'motorcycle engine close view'}).visualScope,'exact');
});

test('unknown fallback batch is not submitted again on resume',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-fallback-pending-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const narration='In 2004, a motorcycle race changed the season.';
  const requirement={text:narration,identities:[{name:'Rossi',aliases:[]}],entities:['Rossi'],years:['2004'],
    queries:['Rossi 2004 race'],visualScope:'exact',visualScopeVersion:3} as DocumentaryRequirement;
  const scene={id:'pending-fallback',order:0,narration,documentary:{verified:false,pinned:false,requirement}} as Scene;
  const project={id:'pending-fallback',scenes:[scene]} as Project;
  let calls=0;
  const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{
    calls++;throw new AnyModelCompletionUncertainError('Connection ended after submission');
  }},()=>root);
  const save=async()=>{throw Error('unknown response must not be accepted');};
  await intelligence.resolveIllustrationFallbacks(project,[scene],save);
  await intelligence.resolveIllustrationFallbacks(project,[scene],save);
  assert.equal(calls,1);
});
