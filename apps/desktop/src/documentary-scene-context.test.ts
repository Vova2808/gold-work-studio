import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Project,Scene,DocumentaryCandidate} from '@gold-work/shared';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {documentaryContinuityInstruction} from './documentary-scene-context.js';
import {effectFfmpeg} from './effect-media.js';

test('actual inspection retains original context, refuses a contradictory era and protects pre-context unknown payments',async()=>{
  const root=await mkdtemp(join(tmpdir(),'gws-continuity-')),imagePath=join(root,'fixture.png');
  await effectFfmpeg(['-y','-f','lavfi','-i','color=c=red:s=1280x720','-frames:v','1',imagePath]);
  const scene={id:'s2',order:1,narration:'He had eight wins that season.',durationSeconds:4,imagePath,
    documentary:{checksum:'image',requirement:{entities:[],identities:[],queries:[],years:[]},
      selected:{kind:'image',title:'Race 2015',description:'A race in 2015',width:1280,height:720} as DocumentaryCandidate}} as unknown as Scene;
  const project={id:'p',scenes:[{id:'s1',order:0,narration:'In 2004 he won the title.'} as Scene,scene]} as Project;
  let calls=0,legacyKey='';
  const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(system,input,images)=>{
    calls++;const data=JSON.parse(input);
    assert.equal(data.narrativeContext.current.text,scene.narration);
    assert.equal(data.narrativeContext.preceding[0].text,project.scenes[0]!.narration);
    const {narrativeContext:_,sourceEraReferences:__,...previousInput}=data;
    // Technical/editorial response hints are appended after checkpoint hashing.
    const previousSystem=system.split(documentaryContinuityInstruction)[0]!;
    legacyKey=createHash('sha256').update(JSON.stringify([2,'visual-overview',previousSystem,JSON.stringify(previousInput),images])).digest('hex');
    // Deliberately inconsistent model status must never override its own era evidence.
    return JSON.stringify({status:'accepted',confidence:.99,reason:'Mock frame contract only',
      technicalQuality:{detail:'clear',compression:'clean',pixelated:false,evidence:'Mock technical evidence'},
      narrativeEvidence:{subjectMatch:true,eraMatch:false,detailMatch:true,requiredEra:'2004',observedEra:'2015',evidence:'The original event is 2004, but this source explicitly depicts 2015.'}});
  }},()=>join(root,'first'));
  const review=await intelligence.inspectForSelection(project,scene);
  assert.equal(review.review.status,'uncertain');assert.match(review.review.reason,/2004/);assert.equal(calls,1);
  assert.equal((await intelligence.inspectForSelection(project,scene)).review.status,'uncertain');assert.equal(calls,1,'Completed negative evidence is reused');
  const guarded=join(root,'guarded','Documentary','Analysis');await mkdir(guarded,{recursive:true});
  await writeFile(join(guarded,legacyKey+'.json'),JSON.stringify({state:'pending',purpose:'visual-overview'}));
  const restart=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{assert.fail('Old unknown request must not be resubmitted');}},()=>join(root,'guarded'));
  await assert.rejects(restart.inspectForSelection(project,scene),/неизвестный результат/);
});
