import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import type {Project,Scene,DocumentaryCandidate} from '@gold-work/shared';
import {filterDocumentaryRankingEra} from './documentary-ranking-era.js';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {DocumentaryRankingBatch,documentaryRankingResponseInstruction} from './documentary-ranking-batch.js';
import {receivedDocumentaryRanking} from './documentary-ranking-response.js';

const context={current:{scene:227,text:'Rossi had eight wins at that point.'},preceding:[{scene:223,text:'Then in October 2004 he won the title.'},{scene:226,text:'The first since 1992.'}],following:[],earlierTimeReferences:[]};
const pool=[{id:'a',title:'Valentino Rossi 2007 Oct.jpg',description:'Valentino Rossi'},
 {id:'b',title:'Yamaha YZR-M1 2004.jpg',description:'Yamaha YZR-M1 (2004 OWP3, Valentino Rossi)'},
 {id:'c',title:'Rossi retrospective 2007',description:'Including his victory in 2004'}];

test('existing completed ranking cannot call an explicitly 2007 photo a 2004-era source',()=>{
 const response={ids:['a','b','c'],reason:'Valentino Rossi in October 2004 era and his Yamaha YZR-M1 motorcycle.'};
 assert.deepEqual(filterDocumentaryRankingEra(response,context,pool,response.ids),['b','c']);
 assert.deepEqual(filterDocumentaryRankingEra({...response,reason:'Rossi between 1992 and 2004'},context,pool,response.ids),response.ids,'Do not infer one year across a comparison');
 assert.deepEqual(filterDocumentaryRankingEra({...response,reason:'Rossi in 2005'},context,pool,response.ids),response.ids,'Never invent a target date absent from the script');
});

test('new dated rankings need actual script and source quotations, not a guessed year or upload date',()=>{
 const response={ids:['a','b'],era:{years:['2004'],scriptQuote:'Then in October 2004 he won the title.'},sourceQuotes:{a:'2004',b:'2004'}};
 assert.deepEqual(filterDocumentaryRankingEra(response,context,pool,response.ids),['b']);
 assert.deepEqual(filterDocumentaryRankingEra({...response,sourceQuotes:{a:'2007',b:'2007'}},context,pool,response.ids),[]);
 assert.deepEqual(filterDocumentaryRankingEra({...response,era:{years:['2004'],scriptQuote:'In 2004 Rossi won eight races.'}},context,pool,response.ids),[],'Quotation must be literal original text');
 assert.deepEqual(filterDocumentaryRankingEra({...response,era:{years:[],scriptQuote:'Then in October 2004 he won the title.'}},context,pool,response.ids),[],'A dated quotation is not an undated target');
 assert.deepEqual(filterDocumentaryRankingEra({...response,era:null},context,pool,response.ids),[]);
 const uploadOnly=[{id:'a',title:'Rossi',description:'Portrait',capturedAt:'2004'}];
 assert.deepEqual(filterDocumentaryRankingEra(response,context,uploadOnly,['a']),[]);
 const generic={...context,current:{scene:227,text:'Pistons drive the crankshaft.'}};
 assert.deepEqual(filterDocumentaryRankingEra({...response,era:{years:[],scriptQuote:generic.current.text}},generic,pool,response.ids),response.ids,'An undated mechanism can keep its general illustration');
});

test('full received metadata quotations survive checkpoint parsing without approving visual fields',()=>{
 const response={ids:['12345678'],era:{years:['2004'],scriptQuote:'In 2004'},sourceQuotes:{'12345678':'2004'}};
 assert.deepEqual(receivedDocumentaryRanking(JSON.stringify(response)),response);
 assert.equal(receivedDocumentaryRanking(JSON.stringify({...response,status:'accepted'})),undefined);
});

test('a literal script quotation can cross adjacent editing slices but never a missing scene',()=>{
 const split={...context,preceding:[{scene:223,text:'Then in October 2004 he won'}, {scene:224,text:'the title.'}]};
 const response={era:{years:['2004'],scriptQuote:'Then in October 2004 he won the title.'},sourceQuotes:{b:'2004'}};
 assert.deepEqual(filterDocumentaryRankingEra(response,split,pool,['b']),['b']);
 assert.deepEqual(filterDocumentaryRankingEra(response,{...split,preceding:[split.preceding[0]!,{...split.preceding[1]!,scene:225}]},pool,['b']),[]);
});

test('batched metadata preserves each member era quotations',async()=>{
 const root=await mkdtemp(join(tmpdir(),'gws-era-batch-'));
 const batch=new DocumentaryRankingBatch(async(_system,input)=>JSON.stringify({results:JSON.parse(input).requests.map((r:any)=>({id:r.id,ids:[r.data.candidates[0].id],era:{years:['2004'],scriptQuote:'In 2004'},sourceQuotes:{[r.data.candidates[0].id]:'2004'}}))}),()=>root);
 const output=await Promise.all(['aaaa0001','aaaa0002'].map(id=>batch.request('p','same-model','policy',JSON.stringify({candidates:[{id}]}),()=>{},async()=>{})));
 output.forEach((raw,i)=>{const id=['aaaa0001','aaaa0002'][i]!;assert.deepEqual(JSON.parse(raw).sourceQuotes,{[id]:'2004'});});
});

test('real rankCandidates reuses a completed dated response, filters its wrong year, and never resubmits old pending work',async()=>{
 const root=await mkdtemp(join(tmpdir(),'gws-era-ranking-'));
 const scene={id:'s',order:0,narration:'In 2004 Rossi won the championship.',documentary:{requirement:{entities:['Valentino Rossi'],identities:[{name:'Valentino Rossi',aliases:[]}],years:[],queries:[]}}} as unknown as Scene;
 const project={id:'p',scenes:[scene]} as Project;
 const candidates=pool.slice(0,2).map(c=>({...c,provider:'commons',kind:'image',downloadUrl:`https://example.test/${c.id}.jpg`,pageUrl:`https://example.test/${c.id}`})) as DocumentaryCandidate[];
 let calls=0,system='',input='';
 const client={configured:async()=>true,documentaryCompletion:async(s:string,i:string)=>{
   calls++;system=s;input=i;const data=JSON.parse(i);
   return JSON.stringify({ids:data.candidates.map((c:any)=>c.id),reason:'Valentino Rossi in the 2004 season.'});
 }};
 assert.deepEqual(await new DocumentaryIntelligence(client,()=>root).rankCandidates(project,scene,candidates),[candidates[1]]);
 assert.deepEqual(await new DocumentaryIntelligence(client,()=>root).rankCandidates(project,scene,candidates),[candidates[1]]);
 assert.equal(calls,1);
 const guard=join(root,'guard'),analysis=join(guard,'Documentary','Analysis');await mkdir(analysis,{recursive:true});
 const key=createHash('sha256').update(JSON.stringify([2,'candidate-relevance',system.slice(0,-documentaryRankingResponseInstruction.length),input,[]])).digest('hex');
 await writeFile(join(analysis,key+'.json'),JSON.stringify({state:'pending',purpose:'candidate-relevance'}));
 await assert.rejects(new DocumentaryIntelligence(client,()=>guard).rankCandidates(project,scene,candidates),/Автоповтор|неизвестный/);
 assert.equal(calls,1);
});
