import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {documentaryCandidateKey} from './documentary-reuse.js';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {documentaryNegativeRankingCache} from './documentary-ranking-cache.js';
import {DocumentaryIntelligence,documentaryNamedShortVideoRankingPool} from './documentary-intelligence.js';
import {documentaryRankingResponseInstruction} from './documentary-ranking-batch.js';
import type {Project,Scene,DocumentaryCandidate} from '@gold-work/shared';

test('a concise exact-model video survives a crowded shortlist without replaying an old pending ranking',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-short-named-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const scene={id:'s',order:0,narration:'Meet the Honda RC211V motorcycle.',documentary:{requirement:{entities:['Honda RC211V'],
    identities:[{name:'Honda RC211V',aliases:[]}],years:[],queries:['Honda RC211V motorcycle']}}} as unknown as Scene;
  const project={id:'p',scenes:[scene]} as Project;
  const long=Array.from({length:50},(_,index)=>({id:`youtube:long-${index}`,provider:'youtube',kind:'video',
    title:`Honda RC211V racing history part ${index}`,description:'MotoGP documentary compilation',durationSeconds:600,
    rights:'licensed',downloadUrl:`https://example.test/long-${index}`,pageUrl:`https://example.test/long-${index}`})) as DocumentaryCandidate[];
  const short={...long[0]!,id:'youtube:short',title:'Honda RC211V Valentino Rossi',durationSeconds:60,
    downloadUrl:'https://example.test/short',pageUrl:'https://example.test/short'};
  const prioritized=documentaryNamedShortVideoRankingPool([...long,short],scene.documentary!.requirement,scene.narration);
  assert.equal(prioritized.length,40);
  assert.ok(prioritized.includes(short),'The exact 60-second source must reach the paid shortlist');
  let oldSystem='',oldInput='';
  await new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(system,input)=>{
    oldSystem=system.slice(0,-documentaryRankingResponseInstruction.length);oldInput=input;return '{"ids":[]}';
  }},()=>join(root,'capture')).rankCandidates(project,scene,long);
  const guarded=join(root,'guarded');await mkdir(join(guarded,'Documentary','Analysis'),{recursive:true});
  const key=createHash('sha256').update(JSON.stringify([2,'candidate-relevance',oldSystem,oldInput,[]])).digest('hex');
  await writeFile(join(guarded,'Documentary','Analysis',`${key}.json`),JSON.stringify({state:'pending',purpose:'candidate-relevance'}));
  let newCalls=0;
  const selected=await new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{
    newCalls++;return '{"ids":[]}';
  }},()=>guarded).rankCandidates(project,scene,[...long,short]);
  assert.deepEqual(selected,[short],'The exact short source gets a real-frame chance before paid metadata ranking');
  assert.equal(newCalls,0,'The old unknown ranking must not be resent');
});

test('named scenes do not pay to rank unrelated generic stock; a real named source remains eligible',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-named-stock-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const scene={id:'s',order:0,narration:'Masao Furusawa speaks.',documentary:{requirement:{entities:['Masao Furusawa'],identities:[{name:'Masao Furusawa',aliases:['Furusawa']}],years:[],queries:[]}}} as unknown as Scene;
  const project={id:'p',scenes:[scene]} as Project;
  const candidate={id:'generic',provider:'pexels',kind:'video',title:'Studio interview',description:'Generic podcast conversation',downloadUrl:'https://example.test/generic',pageUrl:'https://example.test/generic'} as DocumentaryCandidate;
  let calls=0;
  const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(_system,input)=>{
    calls++;const request=JSON.parse(input);assert.equal(request.candidates.length,1);assert.match(request.candidates[0].title,/Furusawa/);
    return JSON.stringify({ids:[request.candidates[0].id]});
  }},()=>root);
  assert.deepEqual(await intelligence.rankCandidates(project,scene,[candidate]),[]);assert.equal(calls,0);
  const named={...candidate,id:'named',downloadUrl:'https://example.test/named',title:'Interview with Masao Furusawa'};
  assert.deepEqual(await intelligence.rankCandidates(project,scene,[candidate,named]),[named]);assert.equal(calls,1);
});

test('filtering generic stock never bypasses a pending ranking of the original full pool',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-ranking-pending-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const scene={id:'s',order:0,narration:'Masao Furusawa speaks.',documentary:{requirement:{entities:['Masao Furusawa'],identities:[{name:'Masao Furusawa',aliases:[]}],years:[],queries:[]}}} as unknown as Scene;
  const project={id:'p',scenes:[scene]} as Project;
  const base={provider:'pexels',kind:'video',description:'Interview',author:'fixture'};
  const pool=[{...base,id:'generic',title:'Podcast studio',downloadUrl:'https://example.test/generic'},
    {...base,id:'named',title:'Masao Furusawa interview',downloadUrl:'https://example.test/named'}] as DocumentaryCandidate[];
  let recordedSystem='',recordedInput='';
  await new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(system,input)=>{
    assert.ok(system.endsWith(documentaryRankingResponseInstruction));
    // Response-format hints are appended at dispatch, after the saved key.
    recordedSystem=system.slice(0,-documentaryRankingResponseInstruction.length);recordedInput=input;return '{"ids":[]}';
  }},()=>join(root,'capture')).rankCandidates(project,scene,pool);
  const request=JSON.parse(recordedInput);
  request.candidates=pool.map(c=>({id:createHash('sha256').update(documentaryCandidateKey(c)).digest('hex').slice(0,8),title:c.title,description:c.description,provider:c.provider,author:c.author,kind:c.kind})).sort((a,b)=>a.id.localeCompare(b.id));
  const key=createHash('sha256').update(JSON.stringify([2,'candidate-relevance',recordedSystem,JSON.stringify(request),[]])).digest('hex');
  const guarded=join(root,'guarded');await mkdir(join(guarded,'Documentary','Analysis'),{recursive:true});
  await writeFile(join(guarded,'Documentary','Analysis',key+'.json'),JSON.stringify({state:'pending',purpose:'candidate-relevance'}));
  let submissions=0;
  const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{submissions++;return '{"ids":[]}';}},()=>guarded);
  await assert.rejects(intelligence.rankCandidates(project,scene,pool),/неизвестный результат|Автоповтор/);assert.equal(submissions,0);
});

test('completed negative rankings reuse subsets but never hide unknown sources or changed context',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-ranking-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const a={id:'a',title:'Wrong place'},b={id:'b',title:'Wrong person'},c={id:'c',title:'New footage'};
  const input=(candidates:unknown[],narration='Exact named object')=>JSON.stringify({narration,candidates});
  const first=await documentaryNegativeRankingCache(root,'policy',input([a,b]));assert.equal(first.allRejected,false);
  // Until a caller has a completed empty answer, nothing is cached.
  assert.equal((await documentaryNegativeRankingCache(root,'policy',input([a]))).allRejected,false);
  await first.rememberEmpty();
  assert.equal((await documentaryNegativeRankingCache(root,'policy',input([b,a]))).allRejected,true);
  assert.equal((await documentaryNegativeRankingCache(root,'policy',input([a]))).allRejected,true);
  assert.equal((await documentaryNegativeRankingCache(root,'policy',input([a,c]))).allRejected,false);
  assert.deepEqual((await documentaryNegativeRankingCache(root,'policy',input([a,c]))).remainingCandidates,[c]);
  assert.equal((await documentaryNegativeRankingCache(root,'new policy',input([a]))).allRejected,false);
  assert.equal((await documentaryNegativeRankingCache(root,'policy',input([a],'Different scene'))).allRejected,false);
  assert.equal((await documentaryNegativeRankingCache(root,'policy',input([{...a,title:'New proven subject'}]))).allRejected,false);
});

test('mixed ranking sends only newly seen candidates and cannot bypass an old pending mixed pool',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-ranking-reduced-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const scene={id:'s',order:0,narration:'A named vessel.',documentary:{requirement:{entities:['Exact Vessel'],identities:[{name:'Exact Vessel',aliases:[]}],years:[],queries:[]}}} as unknown as Scene;
  const project={id:'p',scenes:[scene]} as Project;
  const pool=['a','b','c'].map(id=>({id,provider:'commons',kind:'image',title:`Unrelated ${id}`,description:'Unknown object',downloadUrl:`https://example.test/${id}.jpg`,pageUrl:`https://example.test/${id}`})) as DocumentaryCandidate[];
  let fullSystem='',fullInput='';
  await new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(system,input)=>{
    assert.ok(system.endsWith(documentaryRankingResponseInstruction));
    fullSystem=system.slice(0,-documentaryRankingResponseInstruction.length);fullInput=input;return '{"ids":[]}';
  }},()=>join(root,'capture')).rankCandidates(project,scene,pool);
  for(const pending of [false,true]){
    const directory=join(root,String(pending));const inputs:string[]=[];
    const client={configured:async()=>true,documentaryCompletion:async(_system:string,input:string)=>{inputs.push(input);const data=JSON.parse(input);return inputs.length===1?' {"ids":[]} ':JSON.stringify({ids:[data.candidates[0].id]});}};
    const intelligence=new DocumentaryIntelligence(client,()=>directory);
    await intelligence.rankCandidates(project,scene,pool.slice(0,2));
    if(pending){
      const analysis=join(directory,'Documentary','Analysis');await mkdir(analysis,{recursive:true});
      const key=createHash('sha256').update(JSON.stringify([2,'candidate-relevance',fullSystem,fullInput,[]])).digest('hex');
      await writeFile(join(analysis,key+'.json'),JSON.stringify({state:'pending',purpose:'candidate-relevance'}));
      await assert.rejects(intelligence.rankCandidates(project,scene,pool),/неизвестный результат/);
      assert.equal(inputs.length,1);
    }else{
      assert.deepEqual(await intelligence.rankCandidates(project,scene,pool),[pool[2]]);
      assert.equal(JSON.parse(inputs[1]!).candidates.length,1);
      assert.equal(JSON.parse(inputs[1]!).candidates[0].title,'Unrelated c');
    }
  }
});

test('real ranking integration pays once for a rejected pool, reuses subsets after restart, and preserves pending guards',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-ranking-integration-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const scene={id:'s',order:0,narration:'A named vessel.',documentary:{requirement:{entities:['Exact Vessel'],identities:[{name:'Exact Vessel',aliases:[]}],years:[],queries:[]}}} as unknown as Scene;
  const project={id:'p',scenes:[scene]} as Project;
  const pool=['a','b','c'].map(id=>({id,provider:'commons',kind:'image',title:`Unrelated ${id}`,description:'Unknown object',downloadUrl:`https://example.test/${id}.jpg`,pageUrl:`https://example.test/${id}`})) as DocumentaryCandidate[];
  let calls=0;const client={configured:async()=>true,documentaryCompletion:async()=>{calls++;return '{"ids":[]}';}};
  await new DocumentaryIntelligence(client,()=>root).rankCandidates(project,scene,pool);
  await new DocumentaryIntelligence(client,()=>root).rankCandidates(project,scene,pool.slice(0,2));
  await new DocumentaryIntelligence(client,()=>root).rankCandidates(project,scene,pool.slice(1));assert.equal(calls,1);
  const unknown={...pool[0]!,id:'new',downloadUrl:'https://example.test/new.jpg'};
  await new DocumentaryIntelligence(client,()=>root).rankCandidates(project,scene,[pool[0]!,unknown]);assert.equal(calls,2);
  let uncertainCalls=0;const uncertain=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{uncertainCalls++;throw Error('Connection interrupted');}},()=>join(root,'uncertain'));
  await assert.rejects(uncertain.rankCandidates(project,scene,pool),/interrupted/);
  await assert.rejects(uncertain.rankCandidates(project,scene,pool),/Автоповтор отключён/);assert.equal(uncertainCalls,1);
});
