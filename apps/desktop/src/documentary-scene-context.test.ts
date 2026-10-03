import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Project,Scene,DocumentaryCandidate} from '@gold-work/shared';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {documentarySceneContext,documentaryContinuityInstruction,documentaryEraProvenanceInstruction,documentaryLegacyEraProvenanceInstruction,documentarySourceEraReferences,documentaryNarrativeEvidenceIssue} from './documentary-scene-context.js';
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

test('upload timestamps cannot ground a depicted era, and old provenance pending/partial requests remain protected',async()=>{
  const evidence={subjectMatch:true,eraMatch:true,detailMatch:true,requiredEra:'2004',observedEra:'2004',
    eraEvidenceQuote:'2004',evidence:'The supplied date is 2004 and the model claims this is the required season.'};
  const source={title:'Rossi Yamaha race',description:'Undated archive',date:'2004-11-01'};
  assert.ok(documentaryNarrativeEvidenceIssue({narrativeEvidence:evidence},source));
  assert.deepEqual(documentarySourceEraReferences(source).date,[],'Do not suggest upload year to source-blind vision');
  assert.equal(documentaryNarrativeEvidenceIssue({narrativeEvidence:evidence},{...source,title:'Rossi Yamaha 2004 race'}),undefined);
  const root=await mkdtemp(join(tmpdir(),'gws-era-upload-')),imagePath=join(root,'fixture.png');
  await effectFfmpeg(['-y','-f','lavfi','-i','color=c=red:s=1280x720','-frames:v','1',imagePath]);
  const scene={id:'s',order:0,narration:'He won the race in 2004.',durationSeconds:4,imagePath,
    documentary:{checksum:'image',requirement:{entities:[],identities:[],queries:[],years:['2004']},
      selected:{kind:'image',title:source.title,description:source.description,capturedAt:source.date,width:1280,height:720}}} as unknown as Scene;
  const project={id:'p',scenes:[scene]} as Project;let legacyKey='';
  const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(system,input,images)=>{
    const data=JSON.parse(input);
    assert.deepEqual(data.sourceEraReferences.date,[]);
    const legacySystem=system.slice(0,system.indexOf(documentaryEraProvenanceInstruction))+documentaryLegacyEraProvenanceInstruction;
    const {earlierTimeReferences:_,...legacyContext}=data.narrativeContext;
    const legacyInput=JSON.stringify({...data,narrativeContext:legacyContext,sourceEraReferences:documentarySourceEraReferences(source,true)});
    legacyKey=createHash('sha256').update(JSON.stringify([2,'visual-overview',legacySystem,legacyInput,images])).digest('hex');
    return JSON.stringify({status:'accepted',confidence:.99,reason:'Mock contract only',narrativeEvidence:evidence,
      technicalQuality:{detail:'clear',compression:'clean',pixelated:false,evidence:'Mock technical evidence'}});
  }},()=>join(root,'first'));
  assert.equal((await intelligence.inspectForSelection(project,scene)).review.status,'uncertain');
  for(const state of ['pending','partial','received']){
    const guarded=join(root,state,'Documentary','Analysis');await mkdir(guarded,{recursive:true});
    await writeFile(join(guarded,legacyKey+'.json'),JSON.stringify({state,purpose:'visual-overview',raw:state==='partial'?'incomplete':undefined}));
    const restart=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{assert.fail('The stricter date policy must not repay an uncertain request');}},()=>join(root,state));
    await assert.rejects(restart.inspectForSelection(project,scene),/неизвестный результат/);
  }
});

test('a long explanation retains its original era instead of deriving a target year from the found source',()=>{
  const scenes=['In 2003 the engineering team redesigned the engine.',...Array.from({length:12},()=> 'The mechanism transmits force.'),'The crankshaft receives that force.']
    .map((narration,order)=>({id:String(order),order,narration})) as Scene[];
  const context=documentarySceneContext({scenes} as Project,scenes.at(-1)!);
  assert.deepEqual(context.earlierTimeReferences,[{scene:1,text:scenes[0]!.narration}]);
  const review={narrativeEvidence:{subjectMatch:true,eraMatch:true,detailMatch:true,requiredEra:'2010 model year',observedEra:'2010',
    eraEvidenceQuote:'Yamaha 2010',evidence:'The source title establishes a 2010 model, but that does not establish the narrated year.'}};
  assert.match(documentaryNarrativeEvidenceIssue(review,{title:'Yamaha 2010 engine'},context)!,/исходного сценария/);
});
