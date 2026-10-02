import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,writeFile,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import type {Project,Scene,DocumentaryCandidate} from '@gold-work/shared';
import {documentarySceneContext} from './documentary-scene-context.js';
import {documentarySavedContextIssue} from './documentary-context-approval.js';
import {documentaryGeneralDiagramScope,documentaryGeneralDiagramPolicy,documentaryGeneralDiagramVerified} from './documentary-general-diagram.js';
import {DocumentaryIntelligence,DocumentaryCachedAnalysisMissing} from './documentary-intelligence.js';
import {effectFfmpeg} from './effect-media.js';
import {documentarySearchQueries} from './documentary-project-service.js';

const identities=[{name:'Yamaha YZR-M1',aliases:['YZR-M1','Yamaha M1']}];
const quote='Inside every engine, pistons and connecting rods are flying up and down thousands of times a minute. ';
function fixture(){
  const scenes=['In 2003 Yamaha needed a new crankshaft.',quote,"That's a lot of heavy metal changing direction. ",'And all that motion pushes and pulls on the crankshaft by itself. ']
    .map((narration,order)=>({id:String(order),order,narration,durationSeconds:4})) as Scene[];
  const scene=scenes.at(-1)!;
  scene.documentary={requirement:{text:scene.narration,identities,entities:['Yamaha YZR-M1'],years:[],queries:['crankshaft diagram']},
    checksum:'fixture',selected:{kind:'image',title:'Crank mechanism schematic',description:'Diagram',width:1280,height:720}} as unknown as Scene['documentary'];
  return {scene,project:{id:'p',scenes} as Project};
}
const evidence=()=>({status:'accepted',confidence:.95,identityMatch:false,identifiedEntity:'',reason:'Schematic shows a piston joined by a connecting rod to an offset crankpin.',
  generalDiagram:{isDiagram:true,illustrationOnly:true,scriptQuote:quote,detailEvidence:'Piston and connecting rod link to the offset crankpin on the shaft.'},
  narrativeEvidence:{subjectMatch:true,detailMatch:true,eraMatch:true,requiredEra:'none',observedEra:'none',evidence:'A clearly schematic mechanism illustrates the explicitly universal explanation.'},
  technicalQuality:{detail:'clear',compression:'clean',pixelated:false,evidence:'Mock contract only; crisp visible lines.'}});

test('general diagram scope comes only from a nearby explicit universal passage and ends on a named/date/possessive return',()=>{
  const {scene,project}=fixture();
  assert.equal(documentaryGeneralDiagramScope(documentarySceneContext(project,scene),identities)?.scriptQuote,quote);
  const requirement=scene.documentary!.requirement;
  assert.equal(documentarySearchQueries(requirement,'image',documentarySceneContext(project,scene))[0],'crankshaft diagram');
  assert.match(documentarySearchQueries(requirement,'video',documentarySceneContext(project,scene))[0]!,/YZR-M1/,'Video keeps exact-subject discovery');
  for(const narration of ['In 2004 this new crankshaft won the race.','Yamaha changed the crankshaft.','Its crankshaft was different.','In every race he used this mechanism.']){
    scene.narration=narration;
    assert.equal(documentaryGeneralDiagramScope(documentarySceneContext(project,scene),identities),undefined);
  }
  project.scenes[1]!.narration='The engine of the Yamaha YZR-M1 moved the crankshaft.';
  scene.narration='Pistons move inside the engine.';
  assert.equal(documentaryGeneralDiagramScope(documentarySceneContext(project,scene),identities),undefined,'Generic words alone do not erase a named referent');
  project.scenes[1]!.narration='В каждом двигателе детали передают усилие.';
  scene.narration='Он проверял этот механизм.';
  assert.equal(documentaryGeneralDiagramScope(documentarySceneContext(project,scene),identities),undefined,'A Russian personal reference also ends the general passage');
});

test('diagram evidence cannot approve a photograph, invented quotation, missing part, or claimed model identity',()=>{
  const {project,scene}=fixture(),context=documentarySceneContext(project,scene),valid=evidence();
  assert.ok(documentaryGeneralDiagramVerified(valid,context,identities));
  for(const invalid of [
    {...valid,generalDiagram:{...valid.generalDiagram,isDiagram:false}},
    {...valid,generalDiagram:{...valid.generalDiagram,scriptQuote:'Every motorcycle has an engine.'}},
    {...valid,narrativeEvidence:{...valid.narrativeEvidence,detailMatch:false}},
    {...valid,identityMatch:true,identifiedEntity:'Yamaha YZR-M1'}
  ])assert.equal(documentaryGeneralDiagramVerified(invalid,context,identities),false);
});

test('actual inspection accepts an evidenced general schematic only; old unknown visual and ranking requests stay protected',async()=>{
  const root=await mkdtemp(join(tmpdir(),'gws-general-diagram-'));
  const imagePath=join(root,'fixture.png');
  await effectFfmpeg(['-y','-f','lavfi','-i','color=c=red:s=1280x720','-frames:v','1',imagePath]);
  const {scene,project}=fixture();scene.imagePath=imagePath;
  let legacyVisual='',legacyRanking='',calls=0,asDiagram=true;
  const client={configured:async()=>true,documentaryCompletion:async(system:string,input:string,images:string[])=>{
    calls++;
    if(system.includes('prominentParts'))return JSON.stringify({prominentParts:['crankshaft'],evidence:'Mock inventory: offset crankpin and shaft, visibly exposed.'});
    const {generalDiagramScope:scope,...before}=JSON.parse(input);
    assert.equal(scope.scriptQuote,quote);assert.ok(system.includes(documentaryGeneralDiagramPolicy));
    const purpose=images.length?'visual-overview':'candidate-relevance';
    // Optional response hints follow checkpoint hashing; retain only the old
    // policy prefix, not those transport-only additions.
    const key=createHash('sha256').update(JSON.stringify([2,purpose,system.slice(0,system.indexOf(documentaryGeneralDiagramPolicy)),JSON.stringify(before),images])).digest('hex');
    if(!images.length){legacyRanking=key;return JSON.stringify({ids:[before.candidates[0].id],reason:'Inspect the schematic, not an exact named model'});}
    legacyVisual=key;
    const result=evidence();result.generalDiagram.isDiagram=asDiagram;
    return JSON.stringify(result);
  }};
  const intelligence=new DocumentaryIntelligence(client,()=>join(root,'first'));
  const result=await intelligence.inspectForSelection(project,scene);
  assert.equal(result.review.status,'accepted');assert.equal(result.review.identifiedEntity,undefined);
  assert.match(result.review.reason,/Поясняющая схема/);
  assert.ok(result.review.contextApproval,'Actual accepted evidence is persisted, not only its prose reason');
  const approved={...scene,documentary:{...scene.documentary!,verified:true,visualReview:result.review}};
  assert.equal(documentarySavedContextIssue(project,approved),undefined);
  const cacheOnly=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>assert.fail('Cache-only replay must never POST')},()=>join(root,'first'));
  assert.ok((await cacheOnly.inspectForSelection(project,scene,undefined,undefined,true)).review.contextApproval);
  const missing=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>assert.fail('Cache miss must not create a paid request')},()=>join(root,'missing'));
  await assert.rejects(missing.inspectForSelection(project,scene,undefined,undefined,true),DocumentaryCachedAnalysisMissing);
  await intelligence.inspectForSelection(project,scene);assert.equal(calls,2,'Completed overview and source-blind detail evidence are reused');
  asDiagram=false;
  assert.notEqual((await new DocumentaryIntelligence(client,()=>join(root,'photo')).inspectForSelection(project,scene)).review.status,'accepted','A real photograph cannot use the diagram exception');
  const candidate={id:'diagram',provider:'commons',kind:'image',title:'Crankshaft schematic',description:'Piston mechanism diagram',pageUrl:'https://example.test/diagram',downloadUrl:'https://example.test/diagram.png',rights:'licensed',match:'unverified'} as DocumentaryCandidate;
  assert.equal((await intelligence.rankCandidates(project,scene,[candidate])).length,1);
  for(const purpose of ['visual-overview','candidate-relevance'])for(const state of ['pending','partial','received']){
    const directory=join(root,purpose+state,'Documentary','Analysis');await mkdir(directory,{recursive:true});
    await writeFile(join(directory,(purpose==='visual-overview'?legacyVisual:legacyRanking)+'.json'),JSON.stringify({state,purpose,raw:state==='partial'?'incomplete':undefined}));
    const guarded=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>assert.fail('Changed scope cannot repeat an unknown charge')},()=>join(root,purpose+state));
    await assert.rejects(purpose==='visual-overview'?guarded.inspectForSelection(project,scene):guarded.rankCandidates(project,scene,[candidate]),/неизвестный результат/);
  }
  const paperRoot=join(root,'paper'),oldFrames=join(paperRoot,'Documentary','Frames','fixture');
  await mkdir(oldFrames,{recursive:true});await mkdir(join(paperRoot,'Documentary','Analysis'),{recursive:true});
  await copyFile(join(root,'first','Documentary','Frames','fixture','0.000.jpg'),join(oldFrames,'0.000.jpg'));
  await writeFile(join(paperRoot,'Documentary','Analysis',legacyVisual+'.json'),JSON.stringify({state:'pending',purpose:'visual-overview'}));
  scene.imagePath=join(root,'fixture-diagram.png');
  await effectFfmpeg(['-y','-f','lavfi','-i','color=c=white:s=1280x720','-frames:v','1',scene.imagePath]);
  const paper=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>assert.fail('New matte cannot repay an old unknown image check')},()=>paperRoot);
  await assert.rejects(paper.inspectForSelection(project,scene),/неизвестный результат/);
});
