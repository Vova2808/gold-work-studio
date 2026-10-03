import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {documentaryCheckpointKey} from './documentary-checkpoint-key.js';
import {documentaryReviewContract} from './documentary-review-contract.js';

test('streaming checkpoint keys preserve every existing paid-request identity',()=>{
  for(const images of [[],['data:image/jpeg;base64,abc'],['"\\\nРусский',...Array.from({length:15},()=> 'data:image/jpeg;base64,'+'a'.repeat(100000))]]){
    const values=['catalog-range-batch','Policy "quoted"\n✓','{"narration":"2004"}',images] as const;
    assert.equal(documentaryCheckpointKey(...values),createHash('sha256').update(JSON.stringify([2,...values])).digest('hex'));
  }
});

test('range provenance retains full description; new format does not replay an unknown prior request',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-contract-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const requests:Array<{system:string;input:string}>=[];
  const review={status:'accepted',confidence:.95,narrativeEvidence:{subjectMatch:true,eraMatch:true,detailMatch:true,requiredEra:'2004',observedEra:'2004',eraEvidenceQuote:'2004',evidence:'Race recorded in the 2004 season.'},technicalQuality:{detail:'clear',compression:'clean',pixelated:false,evidence:'Sharp real footage'}};
  const intel=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(system,input)=>{requests.push({system,input});return JSON.stringify({reviews:[review]});}},()=>root);
  const context={submissions:0,shouldStop:()=>false,narrativeContext:{current:{scene:1,text:'The 2004 race.'},preceding:[],following:[],earlierTimeReferences:[]},sourceEra:{title:'Race',description:'Recorded in 2004'}};
  const input=JSON.stringify({source:{title:'Race'},groups:[{id:0}]});
  const run=()=> (intel as any).inspection.run(context,()=> (intel as any).complete('p','catalog-range-batch','Inspect pixels',input,['frame']));
  const result=await run();
  assert.equal(result.reviews[0].status,'accepted');
  assert.deepEqual(JSON.parse(requests[0]!.input).sourceEraReferences.description,['2004']);
  assert.ok(requests[0]!.system.includes(documentaryReviewContract));
  const analysis=join(root,'Documentary','Analysis');
  const {readdir}=await import('node:fs/promises');
  const filename=(await readdir(analysis)).find(n=>n.endsWith('.json'))!;
  // Recover the exact hashed system: transport-only quality/annotation suffix
  // follows the output contract and is not part of checkpoint identity.
  const currentSystem=requests[0]!.system.slice(0,requests[0]!.system.indexOf(documentaryReviewContract)+documentaryReviewContract.length);
  const oldSystem=currentSystem.replace(documentaryReviewContract,'');
  const data=JSON.parse(requests[0]!.input);data.sourceEraReferences.description=[];
  const oldKey=documentaryCheckpointKey('catalog-range-batch',oldSystem,JSON.stringify(data),['frame']);
  await rm(join(analysis,filename));
  await writeFile(join(analysis,`${oldKey}.json`),JSON.stringify({state:'partial',raw:'{"reviews":['}));
  await assert.rejects(run,/неизвестный|Новый контекст/);
  assert.equal(requests.length,1,'An output-format/provenance fix never repeats a partial paid request');
});
