import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {DocumentaryCandidate,DocumentaryRequirement,Project,Scene} from '@gold-work/shared';
import {DocumentarySelectionSession} from './documentary-selection-session.js';
import {documentaryAnalysisTier} from './documentary-analysis-routing.js';
import {DocumentaryIntelligence,readAnalysisCheckpoint,documentaryMetadataShortlist} from './documentary-intelligence.js';
import {AnyModelClient} from './anymodel-client.js';
import type {AnyModelStore} from './anymodel-store.js';
import {documentaryRequiredVisiblePart,documentaryDetailEvidenceIssue,documentaryRivalryTarget} from './documentary-detail-evidence.js';
import {documentaryFastThematicCandidates,documentaryNeedsSemanticRecovery} from './documentary-project-service.js';
import {DocumentaryRankingBatch} from './documentary-ranking-batch.js';
import {documentaryCandidateKey} from './documentary-reuse.js';

test('general stock uses a two-source pixel-review shortlist; exact model and visible part stay strict',()=>{
  const narration='Motorcycle racing felt faster and more dramatic.';
  const requirement={text:narration,entities:[],identities:[],years:[],queries:['motorcycle racing'],
    visualScope:'illustrative',visualScopeQuote:narration,illustrationQuery:'motorcycle racing'} as DocumentaryRequirement;
  const scene={id:'general',order:0,narration,documentary:{requirement}} as Scene;
  const candidate=(id:string,title:string,provider:'pexels'|'pixabay'|'commons'='pexels'):DocumentaryCandidate=>({
    id,provider,kind:'video',title,description:'',query:'motorcycle racing',durationSeconds:12,width:1920,height:1080,
    rights:'licensed',pageUrl:`https://example.test/${id}`,downloadUrl:`https://example.test/${id}.mp4`,concerns:[],
    author:'Fixture',license:'CC BY',licenseUrl:'https://example.test/license',attribution:'Fixture',retrievedAt:'now',match:'unverified'
  });
  const pool=[candidate('wrong','Nature documentary film'),candidate('race','Motorcycle on track'),
    candidate('race-again','Racing bike corner','pixabay'),candidate('archive','Sports footage circuit','commons')];
  assert.deepEqual(documentaryFastThematicCandidates(scene,pool.slice(0,3)).map(item=>item.id),['race','race-again']);
  assert.deepEqual(documentaryFastThematicCandidates(scene,pool).map(item=>item.id),['race','archive'],
    'A concise archive source remains eligible for the same actual-frame check');
  assert.deepEqual(documentaryFastThematicCandidates({...scene,narration:'The Yamaha YZR-M1 raced.',documentary:{requirement:{...requirement,
    text:'The Yamaha YZR-M1 raced.',visualScope:'exact',identities:[{name:'Yamaha YZR-M1',aliases:[]}]}}} as unknown as Scene,pool),[]);
  assert.deepEqual(documentaryFastThematicCandidates({...scene,narration:'The crankshaft rotates.',documentary:{requirement:{...requirement,
    text:'The crankshaft rotates.',visualScopeQuote:'The crankshaft rotates.'}}} as Scene,pool),[]);
});

test('equally relevant general captions prefer short originals that cover the spoken interval',()=>{
  const scene={durationSeconds:5,narration:'A train on the railway.',documentary:{requirement:{entities:[],identities:[],years:[],queries:['railway train'],visualScope:'illustrative'}}} as unknown as Scene;
  const source:DocumentaryCandidate={id:'fixture',provider:'pexels',kind:'video',title:'railway train',description:'',query:'railway train',concerns:[],rights:'licensed',
    pageUrl:'https://example.test/train',downloadUrl:'https://example.test/train.mp4',author:'Fixture',license:'Fixture',licenseUrl:'',attribution:'Fixture',retrievedAt:'now',match:'unverified'};
  const shortlist=documentaryMetadataShortlist(scene,[{...source,id:'long',durationSeconds:40},{...source,id:'too-short',durationSeconds:3},
    {...source,id:'toy',title:'toy railway train wheels',durationSeconds:6},
    {...source,id:'short',durationSeconds:8},{...source,id:'local',durationSeconds:40,localPath:'saved.mp4'}]);
  assert.deepEqual(shortlist.map(s=>s.id),['local','short','long']);
});

test('a technical refusal does not rerank a subject that final pixels already confirmed',()=>{
  const scene=(checks:unknown)=>({documentary:{searchRecovery:{scriptEvidence:{checks}}}}) as Scene;
  assert.equal(documentaryNeedsSemanticRecovery(scene([{match:true},{match:true}])),false);
  for(const checks of [[{match:false}],[{match:'true'}],[],undefined])assert.equal(documentaryNeedsSemanticRecovery(scene(checks)),true);
  const thematic={...scene([{match:false}]),documentary:{...scene([{match:false}]).documentary!,
    requirement:{scriptRequirements:{mode:'thematic'},identities:[]}}} as unknown as Scene;
  assert.equal(documentaryNeedsSemanticRecovery(thematic),false,'A broad thematic refusal still requires final pixels, without a new paid caption ranking');
  assert.equal(documentaryNeedsSemanticRecovery({...thematic,documentary:{...thematic.documentary!,requirement:{...thematic.documentary!.requirement,identities:[{name:'Boeing 747',aliases:[]}]}}}),true);
});

test('related scenes share discovery, but not mutable evidence or a different era',async()=>{
  const session=new DocumentarySelectionSession();let calls=0;
  const requirement={text:'Yamaha engine',entities:['Yamaha'],queries:['Yamaha engine'],years:['2003'],identities:[{name:'Yamaha',aliases:[]}]} as DocumentaryRequirement;
  const search=async()=>{calls++;return {sources:[],candidates:[{id:'a',provider:'commons',kind:'video',pageUrl:'https://example.test/a',concerns:[]} as unknown as DocumentaryCandidate]};};
  const [a,b]=await Promise.all([session.related(requirement,'video',search),session.related({...requirement,queries:['Yamaha wheels']},'video',search)]);
  assert.equal(calls,1);a.candidates[0]!.concerns.push('wrong for first scene');assert.deepEqual(b.candidates[0]!.concerns,[]);
  await session.related({...requirement,years:['2004']},'video',search);assert.equal(calls,2);
  const completed=session.completedRelated(requirement,'video');
  assert.equal(completed?.candidates[0]?.id,'a');
  completed!.candidates[0]!.concerns.push('changed');
  assert.deepEqual(session.completedRelated(requirement,'video')?.candidates[0]?.concerns,[]);
  assert.equal(session.completedRelated({...requirement,years:['2005']},'video'),undefined);
  assert.equal(calls,2,'Reading completed discovery cannot start another provider query');
});

test('a completed licensed video search is available to later matching scenes without another provider call',()=>{
  const session=new DocumentarySelectionSession();
  const requirement={text:'Yamaha M1',entities:['Yamaha YZR-M1'],queries:['Yamaha M1 engine closeup'],years:['2003'],
    identities:[{name:'Yamaha YZR-M1',aliases:['M1']}]} as DocumentaryRequirement;
  const exact:DocumentaryCandidate={id:'youtube:video-one',provider:'youtube',kind:'video',rights:'licensed',title:'Yamaha YZR-M1 2003',
    description:'Race footage',pageUrl:'https://example.test/one',downloadUrl:'https://example.test/one',author:'Source',
    license:'CC BY',licenseUrl:'https://example.test/license',attribution:'Source',query:'Yamaha 2003',retrievedAt:'2026-10-04T00:00:00Z',
    match:'unverified',concerns:[]};
  const unrelated={...exact,id:'youtube:video-two',title:'Other motorcycle',pageUrl:'https://example.test/two',downloadUrl:'https://example.test/two'};
  session.rememberVideos(requirement,[exact,{...exact},unrelated,{...exact,id:'photo',kind:'image'}]);
  const reused=session.completedRelated({...requirement,queries:['Yamaha M1 on track']},'video');
  assert.deepEqual(reused?.candidates.map(item=>item.id),['youtube:video-one','youtube:video-two']);
  reused!.candidates[0]!.concerns.push('scene-specific rejection');
  assert.deepEqual(session.completedRelated(requirement,'video')?.candidates[0]?.concerns,[]);
  assert.equal(session.completedRelated({...requirement,years:['2004']},'video'),undefined);
  assert.equal(session.completedRelated({...requirement,identities:[{name:'Honda RC211V',aliases:[]}]},'video'),undefined);
});

test('a failed YouTube format is skipped by later scenes only under the same selector',()=>{
  const session=new DocumentarySelectionSession();
  session.rememberUnavailableFormat('full-frame-mp4','youtube:bad-format');
  assert.equal(session.isUnavailableFormat('full-frame-mp4','youtube:bad-format'),true);
  assert.equal(session.isUnavailableFormat('small-card-mp4','youtube:bad-format'),false);
  assert.equal(session.isUnavailableFormat('full-frame-mp4','youtube:other-video'),false);
});

test('an unfinished shared search never blocks a scene waiting for its own source',async()=>{
  const session=new DocumentarySelectionSession();
  const requirement={text:'Yamaha engine',entities:['Yamaha'],queries:['Yamaha engine'],years:[],identities:[{name:'Yamaha',aliases:[]}]} as DocumentaryRequirement;
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  const work=session.related(requirement,'video',async()=>{await gate;return {sources:[],candidates:[]};});
  assert.equal(session.completedRelated(requirement,'video'),undefined);
  release();await work;assert.deepEqual(session.completedRelated(requirement,'video')?.candidates,[]);
});

test('refinement does not reset source/time budgets; narration wait is excluded',()=>{
  let now=0;const session=new DocumentarySelectionSession(()=>now);
  for(let i=0;i<5;i++)assert.equal(session.takeAttempt('s','video'),true);
  assert.equal(session.takeAttempt('s','video'),false);
  assert.equal(session.canAttempt('s','video'),false,'Do not buy another shortlist/refinement after the candidate budget is exhausted');
  assert.equal(session.takeAttempt('other','video'),true);now=119_000;session.extend('other','video',30_000);assert.equal(session.remaining('other','video'),31_000);
  now=151_000;assert.equal(session.takeAttempt('other','video'),false);
});

test('fast analysis does not take over planning, engine details or event identity',()=>{
  assert.equal(documentaryAnalysisTier('candidate-relevance','{}'),'fast');
  assert.equal(documentaryAnalysisTier('search-plan','{}'),'careful');
  assert.equal(documentaryAnalysisTier('visual-overview',JSON.stringify({narration:'Inside the engine'})),'careful');
  assert.equal(documentaryAnalysisTier('catalog-range-batch',JSON.stringify({narrationContext:'Rossi won in 2003'})),'careful');
  assert.equal(documentaryAnalysisTier('catalog-range-check',JSON.stringify({narrationContext:'A panoramic view of the coast'})),'fast');
});

test('a closed vehicle cannot approve a literal crankshaft explanation, abstract specs stay illustrative',()=>{
  assert.equal(documentaryRequiredVisiblePart('Motion pushes on the crankshaft.'),'crankshaft');
  assert.equal(documentaryRequiredVisiblePart('The engine made 200 horsepower.'),undefined);
  assert.ok(documentaryDetailEvidenceIssue('crankshaft',{prominentParts:['exposed-engine'],evidence:'An engine casing is visible.'}));
  assert.equal(documentaryDetailEvidenceIssue('crankshaft',{prominentParts:['crankshaft'],evidence:'Large exposed metal shaft with offset crankpins in the foreground.'}),undefined);
});

test('rivalry permits the primary named member, not an arbitrary substitute or a physical joint action',()=>{
  const identities=[{name:'Rossi',aliases:[]},{name:'Biaggi',aliases:[]}];
  assert.equal(documentaryRivalryTarget({narration:'setting Rossi up against.',detailEntities:['Biaggi']},identities),'Biaggi');
  assert.equal(documentaryRivalryTarget({narration:'Rossi hands a trophy to Biaggi.',detailEntities:['Biaggi']},identities),undefined);
  assert.equal(documentaryRivalryTarget({narration:'Rossi against Biaggi.',entities:['Rossi','Biaggi']},identities),undefined);
});

test('documentary reviews use Sonnet for both tiers without changing saved settings or probing providers',async()=>{
  const settings={configured:true,textModel:'cc/claude-sonnet-5',baseUrl:'https://anymodel.org/v1'};
  const client=new AnyModelClient({publicSettings:async()=>({...settings})} as AnyModelStore);
  let probes=0;
  Reflect.set(client,'request',async(path:string,init:RequestInit)=>{
    assert.equal(path,'/v1/models');assert.equal(init.method,'GET');probes++;
    return Response.json({data:[{id:'ag/gemini-3.8-flash-high'}]});
  });
  assert.deepEqual(await Promise.all([client.documentaryAnalysisModel('fast'),client.documentaryAnalysisModel('fast')]),['ag/gemini-3.8-flash-high','ag/gemini-3.8-flash-high']);
  assert.equal(probes,0);assert.equal(await client.documentaryAnalysisModel('careful'),'ag/gemini-3.8-flash-high');
  settings.textModel='user-selected-other';assert.equal(await client.documentaryAnalysisModel('fast'),'ag/gemini-3.8-flash-high');
  assert.equal(settings.textModel,'user-selected-other');
  settings.textModel='cc/claude-sonnet-5';settings.baseUrl='https://another.example/v1';
  assert.equal(await client.documentaryAnalysisModel('fast'),'cc/claude-sonnet-5');
  assert.equal(await client.documentaryAnalysisModel('careful'),'cc/claude-sonnet-5');assert.equal(probes,0);
});

test('documentary Flash refusal cannot enter the surrounding paid text-model fallback',async()=>{
  const settings={configured:true,textModel:'cc/claude-sonnet-5',baseUrl:'https://anymodel.org/v1'};
  const client=new AnyModelClient({publicSettings:async()=>settings} as AnyModelStore);
  const models:string[]=[];
  Reflect.set(client,'request',async(_path:string,init:RequestInit)=>{
    models.push(JSON.parse(String(init.body)).model);
    return Response.json({error:{code:'model_unavailable',message:'model unavailable'}},{status:503});
  });
  await assert.rejects(client.withTextModelFallback(()=>client.documentaryCompletion('Inspect actual footage.','{}',[],undefined,undefined,'ag/gemini-2.5-flash')));
  assert.deepEqual(models,['ag/gemini-2.5-flash']);
});

test('a validated ordinary illustration is routed by its visual task while exact identity and details stay careful',()=>{
  const task={narration:'A motorcycle rides along a road.',visualTask:'motorcycle riding road',
    voiceOverContext:'Rossi won the 2004 championship.',years:[],requiredIdentities:[]};
  assert.equal(documentaryAnalysisTier('visual-range',JSON.stringify(task)),'careful');
  assert.equal(documentaryAnalysisTier('visual-range',JSON.stringify(task),true),'fast');
  for(const extra of [{requiredIdentities:[{name:'Rossi'}]},{years:['2004']},{detail:'inside the engine'},
    {narration:'The rider crashes.'}])
    assert.equal(documentaryAnalysisTier('visual-range',JSON.stringify({...task,...extra}),true),'careful');
});

for(const corrupt of [false,true])test(`public metadata ranking is free; legacy batch preserves per-scene IDs and incomplete receipts (${corrupt})`,async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-batch-paid-'));t.after(()=>rm(root,{recursive:true,force:true}));let calls=0;
  const scenes=['a','b'].map((id,order)=>({id,order,narration:`The ${id} subject.`,documentary:{requirement:{entities:[],identities:[],years:[],queries:[]}}})) as unknown as Scene[];
  const project={id:'p',scenes} as Project;
  const pool=(id:string)=>[{id,provider:'commons',kind:'image',title:`Subject ${id}`,description:'Illustration',pageUrl:`https://example.test/${id}`} as DocumentaryCandidate];
  const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>assert.fail('Public metadata ranking must not submit a model request')},()=>root);
  const shortlist=await Promise.all(scenes.map(s=>intelligence.rankCandidates(project,s,pool(s.id))));
  assert.deepEqual(shortlist.map(items=>items.map(item=>item.id)),[['a'],['b']]);
  assert.ok(shortlist.flat().every(item=>!('verified' in item)&&!('visualReview' in item)&&!('contextApproval' in item)),'Metadata cannot acquire pixel approval');
  assert.deepEqual(await readdir(join(root,'Documentary','Analysis')).catch(error=>{if(error.code==='ENOENT')return [];throw error;}),[]);
  // The removed public route must remain free, while its old batch receipts
  // still need real member validation and crash recovery. Exercise that adapter
  // directly rather than paying for a removed metadata stage.
  const analysis=join(root,'Documentary','Analysis');await mkdir(analysis,{recursive:true});
  const canonicalIds=scenes.map(s=>createHash('sha256').update(documentaryCandidateKey(pool(s.id)[0]!)).digest('hex'));
  const batcher=new DocumentaryRankingBatch(async(_system:string,input:string)=>{
    calls++;const value=JSON.parse(input);assert.equal(value.requests.length,2);
    const results=value.requests.map((request:any)=>({id:request.id,ids:[request.data.candidates[0].id]}));
    if(corrupt)results[1].ids=results[0].ids;
    return JSON.stringify({results});
  },()=>root);
  const members=scenes.map(s=>join(analysis,`${s.id}.json`));
  const results=await Promise.allSettled(scenes.map((s,index)=>batcher.request(project.id,'ag/gemini-2.5-flash','Metadata fixture',
    JSON.stringify({candidates:[{...pool(s.id)[0],id:canonicalIds[index]}]}),()=>{},
    async(batchFile,batchMember)=>{await writeFile(members[index]!,JSON.stringify({state:'pending',purpose:'candidate-relevance',batchFile,batchMember}));})));
  assert.equal(calls,1);
  if(corrupt){
    assert.ok(results.every(result=>result.status==='rejected'));
    assert.deepEqual((await Promise.all(members.map(readAnalysisCheckpoint))).map(value=>value?.state),['pending','pending']);
    // Public ranking ignores old metadata votes and cannot resubmit them.
    assert.equal((await intelligence.rankCandidates(project,scenes[0]!,pool('a')))[0]!.id,'a');
    assert.equal(calls,1);
  }else{
    assert.deepEqual(results.map(result=>result.status==='fulfilled'?JSON.parse(result.value).ids:[]),canonicalIds.map(id=>[id]));
    const recovered=await Promise.all(members.map(readAnalysisCheckpoint));
    assert.deepEqual(recovered.map(value=>value?.result?.ids),canonicalIds.map(id=>[id]));
    assert.ok(recovered.every(value=>value?.state==='complete'));
    assert.equal((await intelligence.rankCandidates(project,scenes[0]!,pool('a')))[0]!.id,'a');assert.equal(calls,1);
  }
  const files=await readdir(join(root,'Documentary','Analysis'));
  const batch=files.find(file=>file.startsWith('ranking-batch-'))!;
  assert.ok(batch);assert.equal(JSON.parse(await readFile(join(root,'Documentary','Analysis',batch),'utf8')).state,corrupt?'received':'complete');
  const orphan=join(root,'Documentary','Analysis','crash-after-batch.json');
  await writeFile(orphan,JSON.stringify({state:'pending',batchFile:batch,batchMember:0}));
  const recovered=await readAnalysisCheckpoint(orphan);
  assert.equal(recovered?.state,corrupt?'pending':'complete');assert.equal(calls,1);
});
