import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {receivedDocumentaryRanking} from './documentary-ranking-response.js';
import {readAnalysisCheckpoint} from './documentary-intelligence.js';

test('a received single-quoted ranking is readable without network or rewriting its original checkpoint',async()=>{
  const raw="{'ids': ['59db9d14', '301430ea'], 'reason': 'Shots of the Yamaha YZR-M1 and its exhibition context to illustrate the bike whose engine development is being discussed.'}";
  const file=join(await mkdtemp(join(tmpdir(),'gws-received-ranking-')),'answer.json');
  const original=JSON.stringify({state:'received',purpose:'candidate-relevance',raw});
  await writeFile(file,original);
  const restored=await readAnalysisCheckpoint(file);
  assert.equal(restored?.state,'complete');assert.deepEqual(restored?.result?.ids,['59db9d14','301430ea']);
  assert.equal(await readFile(file,'utf8'),original,'Keep the exact paid response as evidence');
  for(const state of ['pending','partial']){
    await writeFile(file,JSON.stringify({state,purpose:'candidate-relevance',raw}));
    assert.equal((await readAnalysisCheckpoint(file))?.state,state,'Even parseable text does not prove an interrupted completion finished');
  }
});

test('ranking recovery never guesses truncated values, combines answers, executes expressions or approves frames',()=>{
  for(const raw of ["{'ids':['59db9d14']", "{'ids':['59db9d14']} {'ids':[]}", "{'ids': process.exit()}",
    "{'ids':['invented-source']}", "{'ids':[], 'status':'accepted'}", "{'ids':[], '__proto__':{}}"])
    assert.equal(receivedDocumentaryRanking(raw),undefined);
  assert.deepEqual(receivedDocumentaryRanking("{'ids':[], 'reason':'No source shows the rider\\'s helmet.'}"),{ids:[],reason:"No source shows the rider's helmet."});
});
