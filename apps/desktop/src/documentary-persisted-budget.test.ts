import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {documentaryHistoricalReviewBudget,persistentDocumentarySelectionSession} from './documentary-persisted-budget.js';
import {DocumentaryBudgetExhausted} from './documentary-work-budget.js';

const hash=(raw:string)=>createHash('sha256').update(raw).digest('hex');
async function fixture(t:test.TestContext){
  const root=await mkdtemp(join(tmpdir(),'gws-lifetime-budget-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const directory=join(root,'Documentary','Analysis'),history=join(directory,'RetryHistory'),file=join(root,'Documentary','selection-budget.json');
  await mkdir(history,{recursive:true});
  await writeFile(join(root,'project.json'),JSON.stringify({scenes:[{id:'photo',narration:'Unique photo line.'},{id:'video',narration:'Unique video line.'},
    {id:'ambiguous-a',narration:'Repeated line.'},{id:'ambiguous-b',narration:'Repeated line.'}]}));
  const receipt=(sceneId:string|null='photo',start=0,end=0)=>({state:'complete',purpose:'visual-illustration',model:'fixture',createdAt:'2026-11-10T12:00:00.000Z',
    singleReviewBinding:{checksum:'a'.repeat(64),start,end,quality:{version:1,target:'A bird',narration:'Unique photo line.',...(sceneId?{sceneId}:{})}}});
  const put=async(key:string,value:unknown)=>{const raw=JSON.stringify(value);await writeFile(join(directory,key+'.json'),raw);return raw;};
  const archive=async(key:string,raw:string)=>writeFile(join(history,`${key}-${hash(raw)}.json`),raw);
  return {root,directory,history,file,receipt,put,archive};
}

test('one-time migration merges old snapshots with distinct owned requests and preserves unverifiable no-dispatch debits',async t=>{
  const f=await fixture(t),a='1'.repeat(64),b='2'.repeat(64),c='3'.repeat(64),d='4'.repeat(64),e='5'.repeat(64),g='6'.repeat(64);
  const bytes=await f.put(a,f.receipt());await f.archive(a,bytes); // Same payment, copied history.
  await f.put(b,{...f.receipt(null),state:'pending'}); // Unique narration recovers owner.
  await f.put(c,{...f.receipt(),state:'rejected',rejection:'empty-response',raw:''});
  const prior=JSON.stringify({...f.receipt(),state:'received',raw:'{"unfinished'});await f.archive(d,prior);
  await f.put(d,{state:'failed',purpose:'visual-illustration',approvedRetryAt:'2026-11-11T12:00:00.000Z',previousRevision:hash(prior)});
  const pending={...f.receipt(),state:'pending'},pendingText=JSON.stringify(pending),pendingRevision=hash(pendingText);
  await mkdir(join(f.directory,'LocalPreDispatch'),{recursive:true});
  await writeFile(join(f.directory,'LocalPreDispatch',`${e}-${pendingRevision}.json`),pendingText);
  await f.put(e,{...pending,state:'failed',rejection:'local-admission-not-dispatched',requestKey:e,preDispatchPendingRevision:pendingRevision});
  await f.put(g,{...f.receipt(),state:'failed',rejection:'local-pre-dispatch',requestKey:g,inputSha256:'b'.repeat(64),
    preDispatchProof:{version:1,state:'not-dispatched',fingerprint:'b'.repeat(64),rowsSha256:'c'.repeat(64),rowCount:0,endpoint:'fixture',ledgerFile:'fixture',receiptFile:'fixture'}});
  await f.put('7'.repeat(64),{state:'pending',purpose:'visual-overview'});
  const ambiguous=f.receipt(null);ambiguous.singleReviewBinding.quality.narration='Repeated line.';await f.put('8'.repeat(64),ambiguous);
  await f.put('9'.repeat(64),f.receipt('video',2,5));
  const retryKey='a'.repeat(64),videoOld=f.receipt('video',5,8);await f.archive(retryKey,JSON.stringify(videoOld));
  await f.put(retryKey,{...videoOld,state:'pending',createdAt:'2026-11-11T12:00:00.000Z'});
  await writeFile(join(f.directory,'b'.repeat(64)+'.json'),'{broken');
  const historical=await documentaryHistoricalReviewBudget(f.root),counts=new Map(historical.scenes.map(row=>[row.key,row.analyses]));
  assert.deepEqual(Object.fromEntries(counts),{'photo:image':5,'video:video':3});
  assert.equal(historical.migration.attributedRequests,8);assert.equal(historical.migration.unattributedRequests,3);
  await writeFile(f.file,JSON.stringify({version:1,scenes:[{key:'photo:image',analyses:6,attempts:2,searchMs:123},{key:'video:video',analyses:1,attempts:1,searchMs:20}]}));
  const session=await persistentDocumentarySelectionSession(f.root,false);
  assert.equal(session.budget('photo','image').analyses,6);assert.equal(session.budget('video','video').analyses,3);
  const saved=JSON.parse(await readFile(f.file,'utf8'));assert.equal(saved.version,2);assert.equal(saved.receiptMigration.version,1);
  await assert.rejects(session.takeAnalysis('photo','image'),DocumentaryBudgetExhausted);
});

test('concurrent sessions share the lifetime cap and restart never resets or recounts completed debits',async t=>{
  const f=await fixture(t),[a,b]=await Promise.all([persistentDocumentarySelectionSession(f.root,false),persistentDocumentarySelectionSession(f.root,false)]);
  await Promise.all([a.takeAnalysis('photo','image'),b.takeAnalysis('photo','image'),a.takeAnalysis('photo','image')]);
  await assert.rejects(b.takeAnalysis('photo','image'),DocumentaryBudgetExhausted);
  let saved=JSON.parse(await readFile(f.file,'utf8'));assert.equal(saved.scenes.find((row:any)=>row.key==='photo:image').analyses,3);
  // These are the replies to the already debited requests, not extra payments.
  for(let i=1;i<=3;i++)await f.put(String(i).repeat(64),f.receipt());
  const restarted=await persistentDocumentarySelectionSession(f.root,false);
  assert.equal(restarted.budget('photo','image').analyses,3);await assert.rejects(restarted.takeAnalysis('photo','image'),DocumentaryBudgetExhausted);
  saved=JSON.parse(await readFile(f.file,'utf8'));assert.equal(saved.scenes.find((row:any)=>row.key==='photo:image').analyses,3);
  assert.equal(saved.receiptMigration.attributedRequests,0,'Version 2 does not import the same live debits again');
});

test('corrupt ledger blocks new sessions and an already open session before a new paid debit',async t=>{
  const f=await fixture(t),session=await persistentDocumentarySelectionSession(f.root,false);
  await writeFile(f.file,'{corrupt');
  await assert.rejects(persistentDocumentarySelectionSession(f.root,false));
  await assert.rejects(session.takeAnalysis('photo','image'));
  assert.equal(await readFile(f.file,'utf8'),'{corrupt','A failed read never silently replaces the ledger with an empty budget');
  await writeFile(f.file,JSON.stringify({version:2,scenes:[]}));
  await assert.rejects(persistentDocumentarySelectionSession(f.root,false),/сохранённый бюджет/);
  const duplicated={key:'photo:image',analyses:1,attempts:1,searchMs:0};
  await writeFile(f.file,JSON.stringify({version:1,scenes:[duplicated,{...duplicated,analyses:0}]}));
  await assert.rejects(persistentDocumentarySelectionSession(f.root,false),/сохранённый бюджет/);
});
