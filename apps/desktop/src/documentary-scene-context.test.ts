import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Project,Scene,DocumentaryCandidate} from '@gold-work/shared';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {documentaryContextApproval,documentarySavedContextIssue} from './documentary-context-approval.js';
import {documentarySceneContext,documentaryGeneralIllustration,documentaryCallToActionIllustration,documentaryGeneralIllustrationInstruction,documentaryContinuityInstruction,documentaryEraProvenanceInstruction,documentaryLegacyEraProvenanceInstruction,documentarySourceEraReferences,documentaryNarrativeEvidenceIssue} from './documentary-scene-context.js';
import {effectFfmpeg} from './effect-media.js';
import {documentaryTechnicalQualityInstruction} from './documentary-source-quality.js';
import {documentaryCheckpointKey} from './documentary-checkpoint-key.js';
import {documentaryReviewContract} from './documentary-review-contract.js';
import {documentarySubjectPolicy} from './documentary-visual-relevance.js';
import {documentaryContinuityEvidenceInstruction} from './documentary-scene-context.js';
import {documentaryScriptRequirements} from './documentary-script-evidence.js';
import {FileProjectRepository} from './file-project-repository.js';

// Production appends originalScript after hashing; it is never canonical input.
function canonicalReviewInput(submitted:string){
  const {originalScript:_,...canonical}=JSON.parse(submitted);
  return canonical;
}

function frozenRacingRequirements(text:string){
  const requirements={version:1 as const,scriptText:text,checks:[
    {id:'motorcycle',kind:'object' as const,scriptQuote:text.startsWith('Motorcycle')?'Motorcycle':'motorcycle',required:'motorcycle'},
    {id:'racing',kind:'action' as const,scriptQuote:'racing',required:'motorcycles racing on a circuit'}],
    nonVisual:[{scriptQuote:text.startsWith('Motorcycle')?'can be thrilling.':'as cool as possible.',reason:'Subjective reaction imposes no additional visible condition.'}]};
  assert.ok(documentaryScriptRequirements(requirements,text),'Candidate-independent frozen requirements must satisfy the production contract');
  return requirements;
}

function racingEvidence(requirements:ReturnType<typeof frozenRacingRequirements>,sampleSeconds:number[]){
  assert.equal(sampleSeconds.length,5);
  return {version:1,scriptText:requirements.scriptText,checks:[
    {...requirements.checks[0],requirementId:'motorcycle',match:true,evidence:'The same blue motorcycle and rider are directly visible.'},
    {...requirements.checks[1],requirementId:'racing',match:true,evidence:'The blue motorcycle progresses through the circuit bend.',
      temporalEvidence:{startState:'Blue motorcycle approaches the circuit bend.',endState:'Blue motorcycle exits the circuit bend.',changed:true,sameSubject:true,
        observations:sampleSeconds.map((seconds,index)=>({seconds,subject:'Blue motorcycle and rider',visible:true,
          state:['Approaches the bend beside the first kerb.','Begins leaning beside the first kerb.','Leans through the middle of the bend.','Straightens beside the second kerb.','Exits the bend beyond the second kerb.'][index]}))}}]};
}

function racingFrameEvidence(range:{startSeconds:number;endSeconds:number;sampleSeconds:number[]}){
  return {startSeconds:range.startSeconds,endSeconds:range.endSeconds,identityMatch:true,
    sourceText:{kind:'none',text:''},
    sampleChecks:range.sampleSeconds.map(seconds=>({seconds,identityMatch:true,eraMatch:true,evidence:'The same motorcycle and rider remain visible.'})),
    motion:{motionType:'live-footage',confidence:.98,cameraMoves:false,subjectMoves:true,globalTransformOnly:false,
      subjectMotionEvidence:'The rider progresses past two fixed circuit kerbs.',evidence:'Mock orchestration evidence only.'}};
}

test('a single required event year cannot be widened by the reviewed range era',()=>{
 const review={narrativeEvidence:{subjectMatch:true,eraMatch:true,detailMatch:true,requiredEra:'2004',observedEra:'2003-2004',eraEvidenceQuote:'2004',evidence:'Source spans both years'}};
 assert.match(documentaryNarrativeEvidenceIssue(review,{title:'Career 2003 2004'})!,/противоречащую/);
 assert.equal(documentaryNarrativeEvidenceIssue({...review,narrativeEvidence:{...review.narrativeEvidence,observedEra:'2004'}},{title:'Race 2004'}),undefined);
 assert.equal(documentaryNarrativeEvidenceIssue({...review,narrativeEvidence:{...review.narrativeEvidence,requiredEra:'none'}},{title:'Career 2003 2004'}),undefined);
});

test('a 2006 R1 still cannot acquire approval for the script-linked 2009 model',async()=>{
  const source={id:'local:saved-r1',provider:'local',kind:'image',title:'Yamaha YZF R1 2006 50th Anniversary.jpg',
    description:'Yamaha YZF-R1 Model 2006'} as DocumentaryCandidate;
  const scene={id:'showroom',order:0,narration:'And the part of this story you can actually touch ended up in showrooms.',
    documentary:{checksum:'saved-photo',verified:true,selected:source,requirement:{
      text:'And the part of this story you can actually touch ended up in showrooms.',
      identities:[{name:'Yamaha YZF-R1',aliases:['YZF-R1']}],years:[],entities:['Yamaha YZF-R1'],queries:['Yamaha YZF-R1 showroom']},
      visualReview:{status:'accepted',confidence:.99,checkedAt:'now',sampleSeconds:[0]}}} as unknown as Scene;
  const project={id:'existing-motorcycle-script',scenes:[scene,{id:'next',order:1,
    narration:'In 2009, Yamaha put a crossplane crankshaft into the YZFR1 road bike.'}]} as Project;
  const value={status:'accepted',narrativeEvidence:{subjectMatch:true,eraMatch:true,detailMatch:true,
    requiredEra:'none',observedEra:'2006',evidence:'A Yamaha YZF-R1 motorcycle stands on a showroom floor.'}};
  assert.equal(documentaryContextApproval(project,scene,value),undefined);
  assert.match(documentarySavedContextIssue(project,scene)!,/Год модели/);
  let paid=0;
  const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{paid++;return '{}';}},()=>'.');
  const checked=await intelligence.inspectForSelection(project,scene);
  assert.equal(checked.review.status,'rejected');
  assert.equal(paid,0,'A known wrong-year still needs no paid frame review');
});

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

test('a generic subscribe line can use topical footage without repaying an older unknown review',async t=>{
  const scene={id:'cta',order:1,narration:"If you're enjoying this, hit subscribe.",
    documentary:{requirement:{identityContextVersion:3,identities:[],years:[],queries:['MotoGP race grid start footage']}}} as unknown as Scene;
  assert.equal(documentaryCallToActionIllustration(scene),true);
  assert.equal(documentaryCallToActionIllustration({...scene,narration:'The 2004 race ended.'}),false);
  assert.equal(documentaryCallToActionIllustration({...scene,documentary:{...scene.documentary!,requirement:{...scene.documentary!.requirement,identities:[{name:'Valentino Rossi',aliases:[]}]}}}),false);
  const root=await mkdtemp(join(tmpdir(),'gws-cta-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const context=documentarySceneContext({scenes:[{id:'race',order:0,narration:'Rossi races his Honda on the circuit.'} as Scene,scene]} as Project,scene);
  const input=JSON.stringify({narration:scene.narration}),images=['unchanged actual frame bytes'];
  let calls=0;
  const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{calls++;return '{"reviews":[]}';}},()=>root);
  const inspection=Reflect.get(service,'inspection');
  const request=()=>Reflect.get(service,'complete').call(service,'project','catalog-range-batch','Review actual frames',input,images);
  const base={submissions:0,shouldStop:()=>false,comparisonSubjects:[],identities:[],narrativeContext:context,generalIllustration:true};
  await inspection.run(base,request);
  const analysis=join(root,'Documentary','Analysis'),files=await readdir(analysis);
  assert.equal(files.length,1);
  await writeFile(join(analysis,files[0]!),JSON.stringify({state:'partial',purpose:'catalog-range-batch',raw:'unfinished reply'}));
  await assert.rejects(inspection.run({...base,callToActionTheme:['MotoGP race grid start footage']},request),/неизвестный результат|незавершённый/);
  assert.equal(calls,1,'An unfinished former request must never be repaid');
  const fresh=await mkdtemp(join(tmpdir(),'gws-cta-new-'));t.after(()=>rm(fresh,{recursive:true,force:true}));
  let priorCtaKey='';
  const enhanced=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(system,submitted,frames)=>{
    assert.match(system,/does not need to depict someone pressing Subscribe/);
    assert.match(system,/An empty track is not motorcycle racing/);
    assert.deepEqual(JSON.parse(submitted).editorialBackgroundQueries,['MotoGP race grid start footage']);
    const oldSystem=system.split(documentaryTechnicalQualityInstruction)[0]!.split(' For VIDEO, return one exact continuous interval')[0]!;
    priorCtaKey=documentaryCheckpointKey('catalog-range-batch',oldSystem,JSON.stringify(canonicalReviewInput(submitted)),frames??[]);
    return '{"reviews":[]}';
  }},()=>fresh);
  await Reflect.get(enhanced,'inspection').run({...base,callToActionTheme:['MotoGP race grid start footage']},
    ()=>Reflect.get(enhanced,'complete').call(enhanced,'project','catalog-range-batch','Review actual frames',input,images));
  const guarded=await mkdtemp(join(tmpdir(),'gws-cta-old-pending-'));t.after(()=>rm(guarded,{recursive:true,force:true}));
  await mkdir(join(guarded,'Documentary','Analysis'),{recursive:true});
  await writeFile(join(guarded,'Documentary','Analysis',`${priorCtaKey}.json`),JSON.stringify({state:'pending',purpose:'catalog-range-batch'}));
  const restart=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{
    assert.fail('An uncertain first CTA policy request cannot be submitted again');
  }},()=>guarded);
  await assert.rejects(Reflect.get(restart,'inspection').run({...base,callToActionTheme:['MotoGP race grid start footage']},
    ()=>Reflect.get(restart,'complete').call(restart,'project','catalog-range-batch','Review actual frames',input,images)),/неизвестный результат/);
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
  let oldKey='',baseSystem='',calls=0;
  const first=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(system,input,images)=>{
    assert.ok(system.includes(documentaryGeneralIllustrationInstruction));
    calls++;
    // The ordinary transport replaces the full canonical policy. Reassemble
    // this fixture's exact production policy from the original complete call.
    const checkpointSystem=baseSystem+documentarySubjectPolicy+documentaryContinuityInstruction
      +documentaryContinuityEvidenceInstruction+documentaryEraProvenanceInstruction
      +documentaryGeneralIllustrationInstruction+documentaryReviewContract;
    const canonicalInput=JSON.stringify(canonicalReviewInput(input));
    const currentKey=documentaryCheckpointKey('visual-overview',checkpointSystem,canonicalInput,images??[]);
    assert.deepEqual(await readdir(join(root,'first','Documentary','Analysis')),[currentKey+'.json'],
      'Reconstructed canonical system/input must match the actual pending production receipt');
    oldKey=documentaryCheckpointKey('visual-overview',checkpointSystem.replace(documentaryGeneralIllustrationInstruction,''),canonicalInput,images??[]);
    return JSON.stringify({status:'rejected',confidence:.9,reason:'Fixture is not relevant'});
  }},()=>join(root,'first'));
  const complete=Reflect.get(first,'complete').bind(first);
  Reflect.set(first,'complete',(...args:unknown[])=>{baseSystem=String(args[2]);return complete(...args);});
  assert.equal((await first.inspectForSelection(project,scene)).review.status,'rejected');
  assert.equal((await first.inspectForSelection(project,scene)).review.status,'rejected');
  assert.equal(calls,1,'The canonical completed refusal remains a refusal without another submission');
  const guarded=join(root,'guarded','Documentary','Analysis');await mkdir(guarded,{recursive:true});
  await writeFile(join(guarded,oldKey+'.json'),JSON.stringify({state:'pending',purpose:'visual-overview'}));
  const restart=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{
    assert.fail('The older pending visual check must not be repaid');
  }},()=>join(root,'guarded'));
  await assert.rejects(restart.inspectForSelection(project,scene),/неизвестный результат/);
});

test('thematic frame review checks the visible task without repaying an older unknown review',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-thematic-review-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const narration='In 2003 Baros crashed while racing the Yamaha.';
  const visualTask='motorcycle racing crash';
  const context={current:{scene:12,text:narration},preceding:[{scene:11,text:'Baros joined Yamaha.'}],following:[],earlierTimeReferences:['2003']};
  const input=JSON.stringify({narration,narrationContext:narration,source:{title:'Motorcycle crash footage'}});
  const images=['actual-frame-fixture'];
  const inspection={submissions:0,shouldStop:()=>false,comparisonSubjects:[],identities:[],
    generalIllustration:true,illustrationTask:visualTask,narrativeContext:context};
  let oldKey='',calls=0;
  const first=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(system,submitted,frames)=>{
    calls++;
    const data=JSON.parse(submitted);
    assert.equal(data.narration,visualTask);
    assert.equal(data.narrativeContext.current.text,visualTask);
    assert.deepEqual(data.narrativeContext.preceding,[]);
    assert.deepEqual(data.narrativeContext.earlierTimeReferences,[]);
    assert.match(system,/preclassified THEMATIC shot/);
    const oldSystem=system.split(' For this preclassified THEMATIC shot')[0]!;
    const {illustratedNarration:_,...oldData}=data;
    const oldInput=JSON.stringify({...oldData,narration,narrationContext:narration,narrativeContext:context});
    oldKey=documentaryCheckpointKey('visual-overview',oldSystem,oldInput,frames??[]);
    return JSON.stringify({status:'rejected',reason:'Fixture review'});
  }},()=>join(root,'first'));
  await Reflect.get(first,'inspection').run(inspection,
    ()=>Reflect.get(first,'complete').call(first,'project','visual-overview','Inspect actual frames',input,images));
  assert.equal(calls,1);
  const guarded=join(root,'guarded','Documentary','Analysis');await mkdir(guarded,{recursive:true});
  await writeFile(join(guarded,oldKey+'.json'),JSON.stringify({state:'pending',purpose:'visual-overview'}));
  const restart=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{
    assert.fail('The old uncertain paid review must not be resubmitted');
  }},()=>join(root,'guarded'));
  await assert.rejects(Reflect.get(restart,'inspection').run(inspection,
    ()=>Reflect.get(restart,'complete').call(restart,'project','visual-overview','Inspect actual frames',input,images)),/неизвестный результат/);
});

test('a short general video verifies its actual rendered range in one paid check',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-short-general-')),videoPath=join(root,'fixture.mp4');
  t.after(()=>rm(root,{recursive:true,force:true}));
  // Synthetic changing pixels exercise orchestration, not live recognition.
  await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=size=1280x720:rate=10,rotate=0.3*t','-t','6','-c:v','mpeg4',videoPath]);
  const scene={id:'general-video',order:1,narration:'motorcycle racing as cool as possible.',durationSeconds:2,videoPath,
    documentary:{checksum:createHash('sha256').update(await readFile(videoPath)).digest('hex'),requirement:{text:'motorcycle racing as cool as possible.',entities:['MotoGP'],
      identities:[],identityContextVersion:3,queries:['motorcycle racing'],years:[]},
      selected:{kind:'video',provider:'pexels',title:'motorcycle race',description:'Race track footage',durationSeconds:6,width:1280,height:720}}} as unknown as Scene;
  const project={id:'p',aspectRatio:'16:9',scenes:[{id:'prior',order:0,narration:'The 2002 season.'} as Scene,scene]} as Project;
  const scriptRequirements=frozenRacingRequirements(scene.narration);
  scene.documentary!.requirement.scriptRequirements=scriptRequirements;
  let calls=0;
  const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(system,input,images)=>{
    calls++;
    assert.match(system,/ONLY full review/);
    const range=JSON.parse(input);
    assert.equal(range.endSeconds,2);
    assert.deepEqual(range.originalScript.requirements,scriptRequirements);
    assert.equal(range.singleReview,true);assert.equal(images?.length,5);
    return JSON.stringify({...racingFrameEvidence(range),status:'accepted',confidence:.96,reason:'Five mock frames show motorcycles racing on a track.',
      quality:'Clear camera footage',isCameraFootage:true,mediaType:'camera',presentation:'clean',physicalEvidence:'Track and riders visible',
      visualTopicMatch:true,visualTopicEvidence:'Actual motorcycles and riders race on a circuit.',
      scriptEvidence:racingEvidence(scriptRequirements,range.sampleSeconds),
      technicalQuality:{detail:'clear',compression:'clean',pixelated:false,evidence:'Riders and track edges are clear',orientation:'upright',continuousShot:true},
      narrativeEvidence:{subjectMatch:true,eraMatch:true,detailMatch:true,requiredEra:'none',observedEra:'unspecified',eraEvidenceQuote:'',
        evidence:'The sampled range shows motorcycle racing without a claimed historical event.'}});
  }},()=>root);
  const {review}=await intelligence.inspectForSelection(project,scene);
  assert.equal(calls,1);
  assert.equal(review.status,'accepted');
  assert.ok(review.contextApproval);
  assert.equal(review.sampleSeconds.length,5);
  const analysis=join(root,'Documentary','Analysis');
  const files=(await readdir(analysis)).filter(file=>file.endsWith('.json'));
  assert.equal(files.length,1);
  assert.equal((await intelligence.inspectForSelection(project,scene)).review.status,'accepted');
  assert.equal(calls,1,'The completed exact-range review is reused without another submission');
  scene.trimStartSeconds=review.trimStartSeconds;scene.trimEndSeconds=review.trimEndSeconds;
  scene.documentary={...scene.documentary!,candidates:[],visualReview:review,verified:true};
  const registry=join(root,'projects.json');
  await new FileProjectRepository(registry).save(project);
  const restored=(await new FileProjectRepository(registry).get(project.id))!,restoredScene=restored.scenes[1]!;
  assert.deepEqual(restoredScene.documentary!.visualReview,JSON.parse(JSON.stringify(review)));
  restoredScene.documentary!.requirement.queries=['another motorcycle racing discovery query'];
  assert.equal(documentarySavedContextIssue(restored,restoredScene),undefined);
  const cacheOnly=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{
    assert.fail('Saving, reloading the project registry and changing discovery queries must reuse the completed receipt');
  }},()=>root);
  assert.equal((await cacheOnly.inspectForSelection(restored,restoredScene,undefined,undefined,true)).review.status,'accepted');
  assert.equal(await cacheOnly.savedMotionIssue(restored,restoredScene),undefined);assert.equal(calls,1);
  await writeFile(join(analysis,files[0]!),JSON.stringify({state:'partial',purpose:'visual-range',raw:'{"status":'}));
  const restart=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{
    assert.fail('The uncertain paid range must not be resubmitted');
  }},()=>root);
  await assert.rejects(restart.inspectForSelection(project,scene),/незавершённый ответ анализа/);
});

test('a medium general clip reviews one spoken-length excerpt in one paid call',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-medium-general-')),videoPath=join(root,'fixture.mp4');
  t.after(()=>rm(root,{recursive:true,force:true}));
  await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=size=1280x720:rate=2,rotate=0.3*t','-t','30','-c:v','mpeg4',videoPath]);
  const scene={id:'general-medium',order:0,narration:'Motorcycle racing can be thrilling.',durationSeconds:3,videoPath,
    documentary:{checksum:createHash('sha256').update(await readFile(videoPath)).digest('hex'),requirement:{text:'Motorcycle racing can be thrilling.',entities:[],
      identities:[],identityContextVersion:3,queries:['motorcycle racing'],years:[]},
      selected:{kind:'video',provider:'pexels',title:'motorcycle race',description:'Race track footage',durationSeconds:30,width:1280,height:720}}} as unknown as Scene;
  const project={id:'p',aspectRatio:'16:9',scenes:[scene]} as Project;
  const scriptRequirements=frozenRacingRequirements(scene.narration);
  scene.documentary!.requirement.scriptRequirements=scriptRequirements;
  let calls=0;
  const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(system,input,images)=>{
    calls++;const range=JSON.parse(input);
    assert.deepEqual(range.originalScript.requirements,scriptRequirements);
    assert.match(system,/ONLY full review/);
    assert.equal(range.startSeconds,0);assert.equal(range.endSeconds,scene.durationSeconds);
    assert.deepEqual(range.sampleSeconds,[.03,.25,.5,.75,.97].map(f=>scene.durationSeconds*f));
    assert.equal(range.singleReview,true);assert.equal(images?.length,5);
    return JSON.stringify({...racingFrameEvidence(range),status:'accepted',confidence:.96,reason:'Actual moving motorcycles on a circuit.',isCameraFootage:true,
      mediaType:'camera',presentation:'clean',physicalEvidence:'Race circuit and riders',visualTopicMatch:true,visualTopicEvidence:'Actual motorcycles race on a circuit',
      scriptEvidence:racingEvidence(scriptRequirements,range.sampleSeconds),technicalQuality:{detail:'clear',compression:'clean',pixelated:false,evidence:'Subject edges are sharp',orientation:'upright',continuousShot:true},
        narrativeEvidence:{subjectMatch:true,eraMatch:true,detailMatch:true,requiredEra:'none',observedEra:'unspecified',eraEvidenceQuote:'',
          evidence:'The excerpt shows the narrated motorcycle-racing topic.'}});
  }},()=>root);
  const {review}=await intelligence.inspectForSelection(project,scene);
  assert.equal(calls,1);
  assert.equal(review.status,'accepted',review.reason);
  assert.equal(review.trimStartSeconds,0);assert.equal(review.trimEndSeconds,scene.durationSeconds);
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
    const {narrativeContext:_,sourceEraReferences:__,...previousInput}=canonicalReviewInput(input);
    // Technical/editorial response hints are appended after checkpoint hashing.
    const previousSystem=system.split(documentaryContinuityInstruction)[0]!;
    legacyKey=documentaryCheckpointKey('visual-overview',previousSystem,JSON.stringify(previousInput),images??[]);
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
    const legacyInput=JSON.stringify({...canonicalReviewInput(input),narrativeContext:legacyContext,sourceEraReferences:documentarySourceEraReferences(source,true)});
    legacyKey=documentaryCheckpointKey('visual-overview',legacySystem,legacyInput,images??[]);
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
