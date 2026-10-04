import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {DocumentaryCandidate,DocumentaryRequirement,Project,Scene} from '@gold-work/shared';
import {DocumentarySelectionSession} from './documentary-selection-session.js';
import {documentaryAnalysisTier} from './documentary-analysis-routing.js';
import {DocumentaryIntelligence,readAnalysisCheckpoint} from './documentary-intelligence.js';
import {AnyModelClient} from './anymodel-client.js';
import type {AnyModelStore} from './anymodel-store.js';
import {documentaryRequiredVisiblePart,documentaryDetailEvidenceIssue,documentaryRivalryTarget} from './documentary-detail-evidence.js';

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
  assert.equal(session.takeAttempt('s','video'),true);assert.equal(session.takeAttempt('s','video'),true);assert.equal(session.takeAttempt('s','video'),true);assert.equal(session.takeAttempt('s','video'),false);
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

test('fast model discovery is free, scoped to Stock and never saves provider settings',async()=>{
  const settings={configured:true,textModel:'cc/claude-sonnet-5',baseUrl:'https://anymodel.org/v1'};
  const client=new AnyModelClient({publicSettings:async()=>({...settings})} as AnyModelStore);
  let probes=0;
  Reflect.set(client,'request',async(path:string,init:RequestInit)=>{
    assert.equal(path,'/v1/models');assert.equal(init.method,'GET');probes++;
    return Response.json({data:[{id:'ag/gemini-2.5-flash'}]});
  });
  assert.deepEqual(await Promise.all([client.documentaryAnalysisModel('fast'),client.documentaryAnalysisModel('fast')]),['ag/gemini-2.5-flash','ag/gemini-2.5-flash']);
  assert.equal(probes,1);assert.equal(await client.documentaryAnalysisModel('careful'),'cc/claude-sonnet-5');
  settings.textModel='user-selected-other';assert.equal(await client.documentaryAnalysisModel('fast'),'user-selected-other');
  settings.textModel='cc/claude-sonnet-5';settings.baseUrl='https://another.example/v1';
  assert.equal(await client.documentaryAnalysisModel('fast'),'cc/claude-sonnet-5');assert.equal(probes,1);
});

for(const corrupt of [false,true])test(`metadata batch keeps per-scene IDs and protects incomplete paid results (${corrupt})`,async()=>{
  const root=await mkdtemp(join(tmpdir(),'gws-batch-paid-'));let calls=0;
  const scenes=['a','b'].map((id,order)=>({id,order,narration:`The ${id} subject.`,documentary:{requirement:{entities:[],identities:[],years:[],queries:[]}}})) as unknown as Scene[];
  const project={id:'p',scenes} as Project;
  const pool=(id:string)=>[{id,provider:'commons',kind:'image',title:`Subject ${id}`,description:'Illustration',pageUrl:`https://example.test/${id}`} as DocumentaryCandidate];
  const client={configured:async()=>true,documentaryCompletion:async(_system:string,input:string)=>{
    calls++;const value=JSON.parse(input);assert.equal(value.requests.length,2);
    const results=value.requests.map((request:any)=>({id:request.id,ids:[request.data.candidates[0].id]}));
    if(corrupt)results[1].ids=results[0].ids;
    return JSON.stringify({results});
  }};
  const intelligence=new DocumentaryIntelligence(client,()=>root);
  const results=await Promise.allSettled(scenes.map(s=>intelligence.rankCandidates(project,s,pool(s.id))));
  assert.equal(calls,1);
  if(corrupt){
    assert.ok(results.every(result=>result.status==='rejected'));
    // A changed worker grouping or model must not pay again for the member.
    await assert.rejects(new DocumentaryIntelligence(client,()=>root).rankCandidates(project,scenes[0]!,pool('a')),/Автоповтор|неизвестный/);
    assert.equal(calls,1);
  }else{
    assert.deepEqual(results.map(result=>result.status==='fulfilled'?result.value.map(c=>c.id):[]),[['a'],['b']]);
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
