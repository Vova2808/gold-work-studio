import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,readdir,rm,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Project,Scene,DocumentaryCandidate} from '@gold-work/shared';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {documentarySceneContext,documentaryGeneralIllustration,documentaryGeneralIllustrationInstruction,documentaryContinuityInstruction,documentaryEraProvenanceInstruction,documentaryLegacyEraProvenanceInstruction,documentarySourceEraReferences,documentaryNarrativeEvidenceIssue} from './documentary-scene-context.js';
import {effectFfmpeg} from './effect-media.js';
import {documentaryTechnicalQualityInstruction} from './documentary-source-quality.js';

test('only a vetted general line can use period-independent illustrative stock',()=>{
  const scene=(narration:string,identities:Array<{name:string;aliases:string[]}>,years:string[])=>({narration,
    documentary:{requirement:{identityContextVersion:3,identities,years}}}) as Scene;
  const general=scene('motorcycle racing as cool as possible.',[],[]);
  assert.equal(documentaryGeneralIllustration(general),true);
  assert.equal(documentaryGeneralIllustration(scene('the 2001 and 2002 seasons.',[],['2001','2002'])),false);
  assert.equal(documentaryGeneralIllustration(scene('He won the title.',[],[])),false);
  assert.equal(documentaryGeneralIllustration(scene('The crankshaft turns.',[{name:'Honda RC211V',aliases:[]}],[])),false);
  const context=documentarySceneContext({scenes:[{id:'prior',order:0,narration:'The 2002 racing season.'} as Scene,
    {...general,id:'general',order:1}]} as Project,{...general,id:'general',order:1});
  assert.equal(documentaryNarrativeEvidenceIssue({narrativeEvidence:{subjectMatch:true,eraMatch:true,detailMatch:true,
    requiredEra:'none',observedEra:'modern',evidence:'A generic racing motorcycle is visible on a track.'}},
    {title:'Modern race footage'},context),undefined);
});

test('general-illustration policy does not resend an older uncertain paid frame review',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-general-policy-')),imagePath=join(root,'fixture.png');
  t.after(()=>rm(root,{recursive:true,force:true}));
  await effectFfmpeg(['-y','-f','lavfi','-i','color=c=blue:s=1280x720','-frames:v','1',imagePath]);
  const scene={id:'general',order:1,narration:'motorcycle racing as cool as possible.',durationSeconds:4,imagePath,
    documentary:{checksum:'fixture',requirement:{text:'motorcycle racing as cool as possible.',entities:['MotoGP'],
      identities:[],identityContextVersion:3,queries:['MotoGP race'],years:[]},
      selected:{kind:'image',title:'Modern race',description:'MotoGP racing',width:1280,height:720}}} as unknown as Scene;
  const project={id:'p',scenes:[{id:'past',order:0,narration:'At the 2002 Grand Prix.'} as Scene,scene]} as Project;
  let oldKey='';
  const first=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(system,input,images)=>{
    assert.ok(system.includes(documentaryGeneralIllustrationInstruction));
    const checkpointSystem=system.split(documentaryTechnicalQualityInstruction)[0]!;
    oldKey=createHash('sha256').update(JSON.stringify([2,'visual-overview',checkpointSystem.replace(documentaryGeneralIllustrationInstruction,''),input,images])).digest('hex');
    return JSON.stringify({status:'rejected',confidence:.9,reason:'Fixture is not relevant'});
  }},()=>join(root,'first'));
  await first.inspectForSelection(project,scene);
  const guarded=join(root,'guarded','Documentary','Analysis');await mkdir(guarded,{recursive:true});
  await writeFile(join(guarded,oldKey+'.json'),JSON.stringify({state:'pending',purpose:'visual-overview'}));
  const restart=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{
    assert.fail('The older pending visual check must not be repaid');
  }},()=>join(root,'guarded'));
  await assert.rejects(restart.inspectForSelection(project,scene),/неизвестный результат/);
});

test('a short general video verifies its actual rendered range in one paid check',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-short-general-')),videoPath=join(root,'fixture.mp4');
  t.after(()=>rm(root,{recursive:true,force:true}));
  await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=size=1280x720:rate=10','-t','6','-c:v','mpeg4',videoPath]);
  const scene={id:'general-video',order:1,narration:'motorcycle racing as cool as possible.',durationSeconds:2,videoPath,
    documentary:{checksum:'short-video',requirement:{text:'motorcycle racing as cool as possible.',entities:['MotoGP'],
      identities:[],identityContextVersion:3,queries:['motorcycle racing'],years:[]},
      selected:{kind:'video',provider:'pexels',title:'motorcycle race',description:'Race track footage',durationSeconds:6,width:1280,height:720}}} as unknown as Scene;
  const project={id:'p',aspectRatio:'16:9',scenes:[{id:'prior',order:0,narration:'The 2002 season.'} as Scene,scene]} as Project;
  let calls=0;
  const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(system,input,images)=>{
    calls++;
    assert.match(system,/ONLY and FINAL check/);
    assert.equal(JSON.parse(input).endSeconds,2);
    assert.equal(images?.length,3);
    return JSON.stringify({status:'accepted',confidence:.96,reason:'Three actual frames show motorcycles racing on a track.',
      quality:'Clear camera footage',isCameraFootage:true,mediaType:'camera',presentation:'clean',physicalEvidence:'Track and riders visible',
      technicalQuality:{detail:'clear',compression:'clean',pixelated:false,evidence:'Riders and track edges are clear'},
      narrativeEvidence:{subjectMatch:true,eraMatch:true,detailMatch:true,requiredEra:'none',observedEra:'unspecified',eraEvidenceQuote:'',
        evidence:'The sampled range shows motorcycle racing without a claimed historical event.'}});
  }},()=>root);
  const {review}=await intelligence.inspectForSelection(project,scene);
  assert.equal(calls,1);
  assert.equal(review.status,'accepted');
  assert.ok(review.contextApproval);
  assert.equal(review.sampleSeconds.length,3);
  const analysis=join(root,'Documentary','Analysis');
  const files=(await readdir(analysis)).filter(file=>file.endsWith('.json'));
  assert.equal(files.length,1);
  await writeFile(join(analysis,files[0]!),JSON.stringify({state:'partial',purpose:'visual-range',raw:'{"status":'}));
  const restart=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{
    assert.fail('The uncertain paid range must not be resubmitted');
  }},()=>root);
  await assert.rejects(restart.inspectForSelection(project,scene),/незавершённый ответ анализа/);
});

test('a completed accepted review without current context approval cannot verify a scene',async()=>{
  const scene={id:'s',order:0,narration:'The motorcycle feels smooth and stable.',
    documentary:{requirement:{text:'The motorcycle feels smooth and stable.',entities:[],identities:[],queries:[],years:[]}}} as unknown as Scene;
  const project={id:'p',scenes:[scene]} as Project;
  const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{
    assert.fail('A saved review must not trigger a paid request');
  }},()=>'.');
  Object.assign(intelligence,{inspect:async()=>({status:'accepted',confidence:.92,reason:'Old result says accepted',
    checkedAt:'now',sampleSeconds:[0],quality:'clear'})});
  const result=await intelligence.inspectForSelection(project,scene);
  assert.equal(result.review.status,'uncertain');
  assert.equal(result.review.contextApproval,undefined);
  assert.match(result.review.reason,/не подтверждено соответствие/);
  assert.equal(result.usedNewAnalysis,false);
});

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
