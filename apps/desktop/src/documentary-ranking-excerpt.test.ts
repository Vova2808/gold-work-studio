import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {DocumentaryCandidate,Project,Scene} from '@gold-work/shared';
import {documentaryRankingExcerpt} from './documentary-ranking-excerpt.js';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {documentaryRankingResponseInstruction} from './documentary-ranking-batch.js';

test('metadata excerpt keeps a late exact model and dated row without the whole career table',()=>{
  const chronology=Array.from({length:16},(_,index)=>`${1990+index} rider season motorcycle standings. `).join('');
  const description=`Racing documentary overview. ${chronology}2002 MotoGP Honda RC211V, Repsol Honda, high speed on a straight. ${chronology}`;
  const excerpt=documentaryRankingExcerpt(description,['Honda RC211V','2002','straight']);
  assert.ok(excerpt.length<=720);
  assert.ok(excerpt.includes('Honda RC211V'));
  assert.ok(excerpt.includes('2002 MotoGP Honda RC211V'));
  assert.ok(excerpt.length<description.length*.65);
  assert.equal(documentaryRankingExcerpt(description,['missing']).includes('Honda RC211V'),false,'No invented hit');
});

test('short ranking payload keeps the late model and guards the old full paid checkpoint',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-ranking-excerpt-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const scene={id:'s',order:0,narration:'The Honda RC211V was fast on the straight.',documentary:{requirement:{
    entities:['Honda RC211V'],identities:[{name:'Honda RC211V',aliases:[]}],years:[],
    detail:'top speed on the straight',queries:['Honda RC211V racing straight speed']}}} as unknown as Scene;
  const project={id:'p',scenes:[scene]} as Project;
  const description=`A history of racing. ${'Other motorcycles in many seasons. '.repeat(27)}2002 Honda RC211V on the straight. ${'Archive recap. '.repeat(25)}`;
  const candidate={id:'source',provider:'youtube',kind:'video',title:'Racing career overview',description,
    durationSeconds:611,downloadUrl:'https://example.test/source.mp4',pageUrl:'https://example.test/source',
    rights:'licensed',author:'Fixture'} as DocumentaryCandidate;
  let sentSystem='',sentInput='';
  await new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(system,input)=>{
    sentSystem=system.slice(0,-documentaryRankingResponseInstruction.length);sentInput=input;
    return JSON.stringify({ids:[JSON.parse(input).candidates[0].id]});
  }},()=>join(root,'capture')).rankCandidates(project,scene,[candidate]);
  const compact=JSON.parse(sentInput);
  assert.ok(compact.candidates[0].description.length<description.length*.7);
  assert.match(compact.candidates[0].description,/Honda RC211V/);
  const oldInput=JSON.stringify({...compact,candidates:compact.candidates.map((item:Record<string,unknown>)=>({
    ...item,description:description.slice(0,1200)}))});
  const oldKey=createHash('sha256').update(JSON.stringify([2,'candidate-relevance',sentSystem,oldInput,[]])).digest('hex');
  const guarded=join(root,'guarded'),analysis=join(guarded,'Documentary','Analysis');await mkdir(analysis,{recursive:true});
  const oldPath=join(analysis,`${oldKey}.json`);
  await writeFile(oldPath,JSON.stringify({state:'pending',purpose:'candidate-relevance'}));
  let calls=0;
  const resumed=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{
    calls++;throw Error('Must not resubmit');
  }},()=>guarded);
  await assert.rejects(resumed.rankCandidates(project,scene,[candidate]),/неизвестный результат|Автоповтор/);
  assert.equal(calls,0);
  await writeFile(oldPath,JSON.stringify({state:'complete',purpose:'candidate-relevance',result:{ids:[compact.candidates[0].id]}}));
  assert.deepEqual(await resumed.rankCandidates(project,scene,[candidate]),[candidate]);
  assert.equal(calls,0);
});

test('completed empty excerpt rankings do not repay rejected sources when a new source joins',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-ranking-excerpt-negative-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const scene={id:'s',order:0,narration:'The Honda RC211V was fast on the straight.',documentary:{requirement:{
    entities:['Honda RC211V'],identities:[{name:'Honda RC211V',aliases:[]}],years:[],
    detail:'top speed on the straight',queries:['Honda RC211V racing straight speed']}}} as unknown as Scene;
  const project={id:'p',scenes:[scene]} as Project;
  const source=(id:string)=>({id,provider:'youtube',kind:'video',title:`Race history ${id}`,
    description:`Many seasons. ${'Different racing bikes across years. '.repeat(30)}2002 Honda RC211V.`,
    durationSeconds:600,downloadUrl:`https://example.test/${id}.mp4`,pageUrl:`https://example.test/${id}`}) as DocumentaryCandidate;
  const a=source('a'),b=source('b');let calls=0;
  const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(_system,input)=>{
    calls++;assert.equal(JSON.parse(input).candidates.length,1);return '{"ids":[]}';
  }},()=>root);
  assert.deepEqual(await intelligence.rankCandidates(project,scene,[a]),[]);
  assert.deepEqual(await intelligence.rankCandidates(project,scene,[a,b]),[]);
  assert.deepEqual(await intelligence.rankCandidates(project,scene,[a,b]),[]);
  assert.equal(calls,2);
});
