import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Project,Scene} from '@gold-work/shared';
import {documentaryContextApproval,documentarySavedContextIssue,revalidateDocumentaryContext} from './documentary-context-approval.js';
import {planDocumentaryMontage} from './documentary-montage.js';
import {FileProjectRepository} from './file-project-repository.js';

const narrativeEvidence={subjectMatch:true,eraMatch:true,detailMatch:true,requiredEra:'1965',observedEra:'1965',eraEvidenceQuote:'1965',evidence:'The dated source identifies the depicted Ford Mustang model as 1965.'};
function approvedPhoto(){
  const narration='A photograph shows the front of a 1965 Ford Mustang.';
  const scene={id:'photo',order:0,narration,durationSeconds:4,durationOverrideSeconds:4,imagePath:'accepted-original.jpg',audioPath:'paid-voice.wav',
    documentary:{verified:true,pinned:false,candidates:[],checksum:'original-pixel-checksum',layout:'full',requirement:{text:narration,entities:[],identities:[],years:['1965'],queries:[],detail:'front view'},
      selected:{id:'commons:1965-mustang',provider:'wikimedia',kind:'image',title:'1965 Ford Mustang front view',description:'An original photograph of a 1965 Ford Mustang',width:1600,height:900},
      visualReview:{status:'accepted',confidence:.98,reason:'The actual photo shows the required car and front view.',checkedAt:'2026-10-14',sampleSeconds:[0],quality:'clear original photo',
        localReview:{version:1,size:'12345',mtimeNs:'1000000',ctimeNs:'1000000'}},caption:{enabled:false},effects:[]}} as unknown as Scene;
  const checks=[{id:'photo',kind:'object' as const,scriptQuote:'photograph',required:'photograph'},
    {id:'car',kind:'object' as const,scriptQuote:'Ford Mustang',required:'Ford Mustang'},
    {id:'front',kind:'condition' as const,scriptQuote:'front',required:'front view'},
    {id:'year',kind:'condition' as const,scriptQuote:'1965',required:'1965 model year'}];
  scene.documentary!.requirement.scriptRequirements={version:1,scriptText:narration,checks,nonVisual:[{scriptQuote:'shows',reason:'Describes the photograph presenting its subject.'}]};
  scene.documentary!.visualReview!.scriptEvidence={version:1,scriptText:narration,checks:checks.map(check=>({...check,requirementId:check.id,match:true,evidence:'The original photo and dated source establish this requirement.'}))};
  const project={id:'chronology-regression',mediaMode:'stock',aspectRatio:'16:9',settings:{assembly:{documentary:{version:2,autoMotionGraphics:true,autoTransitions:false}},video:{enabled:true},voice:{enabled:true}},scenes:[scene]} as unknown as Project;
  scene.documentary!.visualReview!.contextApproval=documentaryContextApproval(project,scene,{status:'accepted',narrativeEvidence});
  assert.ok(scene.documentary!.visualReview!.contextApproval);
  assert.equal(documentarySavedContextIssue(project,scene),undefined);
  return project;
}
function montage(project:Project){return {...project,scenes:planDocumentaryMontage(project)};}

test('accepted photo retains its original approval through automatic chronology, save and reload',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-context-chronology-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const original=approvedPhoto(),approval=structuredClone(original.scenes[0]!.documentary!.visualReview!.contextApproval);
  const planned=montage(original),scene=planned.scenes[0]!;
  assert.equal(scene.documentary!.motionGraphic?.kind,'chronology');
  assert.equal(scene.documentary!.motionGraphic!.value,'1965');
  assert.equal(original.scenes[0]!.documentary!.motionGraphic,undefined);
  assert.equal(documentarySavedContextIssue(planned,scene),undefined);
  assert.equal(revalidateDocumentaryContext(planned)[0]!.documentary!.verified,true);
  const repository=new FileProjectRepository(join(root,'projects.json'));
  await repository.save(planned);
  const restored=(await new FileProjectRepository(join(root,'projects.json')).get(planned.id))!;
  assert.equal(documentarySavedContextIssue(restored,restored.scenes[0]!),undefined);
  assert.deepEqual(restored.scenes[0]!.documentary!.visualReview!.contextApproval,approval,'Existing approval must not be replaced or restamped');
  const remounted=montage(restored);
  assert.equal(documentarySavedContextIssue(remounted,remounted.scenes[0]!),undefined);
  assert.equal(remounted.scenes[0]!.audioPath,'paid-voice.wav');
});

test('chronology cannot exempt narration, source, local file, requirements or timing edits',()=>{
  const project=montage(approvedPhoto());
  for(const change of [
    (s:Scene)=>{s.narration='A photograph shows a different car.';},
    (s:Scene)=>{s.documentary!.checksum='replacement-pixels';},
    (s:Scene)=>{s.documentary!.selected!.id='another-source';},
    (s:Scene)=>{s.documentary!.visualReview!.localReview!.mtimeNs='2000000';},
    (s:Scene)=>{s.documentary!.requirement.scriptRequirements!.checks[1]!.required='another model';},
    (s:Scene)=>{s.durationSeconds=5;s.durationOverrideSeconds=5;s.documentary!.motionGraphic!.durationSeconds=5;},
    (s:Scene)=>{s.durationOverrideSeconds=5;s.documentary!.motionGraphic!.durationSeconds=5;},
    (s:Scene)=>{s.playbackRate=2;},
  ]){
    const changed=structuredClone(project),scene=changed.scenes[0]!;change(scene);
    assert.match(documentarySavedContextIssue(changed,scene)!,/изменился/);
  }
});

test('only the complete stock chronology shape can use the old no-graphic fingerprint',()=>{
  const project=montage(approvedPhoto());
  for(const patch of [
    {origin:'manual'}, {kind:'bar-chart'}, {value:'1966'}, {title:'A different explanation'},
    {startSeconds:1}, {durationSeconds:3}, {background:'grid-dark'}, {theme:'paper'},
    {enabled:false}, {accentColor:'#000000'}, {sequenceId:'another-scene'}, {opacity:1}, {unsupportedStyle:true},
  ]){
    const changed=structuredClone(project),scene=changed.scenes[0]!;
    Object.assign(scene.documentary!.motionGraphic!,patch);
    assert.match(documentarySavedContextIssue(changed,scene)!,/изменился/,JSON.stringify(patch));
  }
});

test('replacing an already approved authored graphic is not an automatically added chronology',()=>{
  const project=approvedPhoto(),scene=project.scenes[0]!;
  const automatic=montage(structuredClone(project)).scenes[0]!.documentary!.motionGraphic!;
  scene.documentary!.motionGraphic={kind:'quote',title:'Authored layout',enabled:true,origin:'manual',startSeconds:0,durationSeconds:4};
  scene.documentary!.visualReview!.contextApproval=documentaryContextApproval(project,scene,{status:'accepted',narrativeEvidence});
  assert.equal(documentarySavedContextIssue(project,scene),undefined);
  scene.documentary!.motionGraphic=automatic;
  assert.match(documentarySavedContextIssue(project,scene)!,/изменился/);
});
