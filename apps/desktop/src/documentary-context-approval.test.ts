import assert from 'node:assert/strict';
import test from 'node:test';
import type {Project,Scene} from '@gold-work/shared';
import {documentaryContextApproval,documentarySavedContextIssue,revalidateDocumentaryContext} from './documentary-context-approval.js';
import {missingAssemblyInputs} from './assembly-readiness.js';

const evidence={subjectMatch:true,eraMatch:true,detailMatch:true,requiredEra:'2004',observedEra:'2004',eraEvidenceQuote:'2004',evidence:'The source identifies the depicted race as the 2004 season.'};
function fixture(){
  const scene={id:'s',order:1,narration:'He won this race.',durationSeconds:4,imagePath:'poster.jpg',videoPath:'source.mp4',audioPath:'paid.wav',trimStartSeconds:12,trimEndSeconds:16,
    documentary:{verified:true,pinned:false,checksum:'original',requirement:{text:'He won this race.',entities:[],identities:[],years:[],queries:[],detail:'race'},
      selected:{id:'source',provider:'youtube',kind:'video',title:'Race 2004',description:'Original event recording',width:1920,height:1080},
      visualReview:{status:'accepted',confidence:.95,reason:'Saved automatic approval',checkedAt:'2026-10-01',sampleSeconds:[12.1,13,14,15,15.9],quality:'1920x1080'},caption:{enabled:false},effects:[]}} as unknown as Scene;
  const project={id:'p',mediaMode:'stock',settings:{assembly:{documentary:{version:2}},video:{enabled:true},voice:{enabled:true}},
    scenes:[{id:'before',order:0,narration:'In 2004 he joined Yamaha.',includeInAssembly:false} as Scene,scene]} as unknown as Project;
  return {scene,project};
}

test('old automatic approval is held before assembly; local migration preserves media, voices and manual pins',()=>{
  const {project,scene}=fixture();
  assert.match(documentarySavedContextIssue(project,scene)!,/Старое автоматическое/);
  assert.ok(missingAssemblyInputs(project).some(issue=>issue.includes('Старое автоматическое')));
  const migrated=revalidateDocumentaryContext(project,['s'])[1]!;
  assert.equal(migrated.documentary!.verified,false);
  for(const key of ['imagePath','videoPath','audioPath','trimStartSeconds','trimEndSeconds'] as const)assert.equal(migrated[key],scene[key]);
  assert.strictEqual(migrated.documentary!.selected,scene.documentary!.selected);
  assert.strictEqual(revalidateDocumentaryContext(project,['another'])[1],scene);
  assert.equal(scene.documentary!.verified,true,'Original in-memory snapshot remains untouched');
  scene.documentary!.pinned=true;
  assert.equal(documentarySavedContextIssue(project,scene),undefined);
  assert.strictEqual(revalidateDocumentaryContext(project)[1],scene);
});

test('current evidence survives serialization/search edits; script, subject, source and interval edits revoke it',()=>{
  const {project,scene}=fixture();
  scene.documentary!.visualReview!.contextApproval=documentaryContextApproval(project,scene,{status:'accepted',narrativeEvidence:evidence});
  assert.ok(scene.documentary!.visualReview!.contextApproval);
  assert.equal(documentarySavedContextIssue(project,scene),undefined);
  const saved=JSON.parse(JSON.stringify(project)) as Project;
  assert.equal(documentarySavedContextIssue(saved,saved.scenes[1]!),undefined);
  scene.documentary!.requirement.queries=['other discovery query'];scene.imagePath='new-poster.jpg';
  assert.equal(documentarySavedContextIssue(project,scene),undefined);
  for(const edit of [
    (p:Project)=>{p.scenes[0]!.narration='In 2015 he raced elsewhere.';},
    (p:Project)=>{p.scenes[1]!.narration='Another man won.';},
    (p:Project)=>{p.scenes[1]!.documentary!.requirement.identities=[{name:'Another rider',aliases:[]}];},
    (p:Project)=>{p.scenes[1]!.documentary!.checksum='replacement';},
    (p:Project)=>{p.scenes[1]!.documentary!.selected!.title='Race 2015';},
    (p:Project)=>{p.scenes[1]!.trimStartSeconds=20;},
    (p:Project)=>{p.scenes[1]!.trimEndSeconds=25;},
  ]){
    const changed=structuredClone(project);edit(changed);
    assert.match(documentarySavedContextIssue(changed,changed.scenes[1]!)!,/изменился/);
  }
});

test('missing or inconsistent era evidence never receives proof and persisted evidence is rechecked',()=>{
  const {project,scene}=fixture();
  for(const raw of [{status:'accepted'}, {status:'rejected',narrativeEvidence:evidence},
    {status:'accepted',narrativeEvidence:{...evidence,eraMatch:false}},
    {status:'accepted',narrativeEvidence:{...evidence,eraEvidenceQuote:'Invented 2004'}}])
    assert.equal(documentaryContextApproval(project,scene,raw),undefined);
  const proof=documentaryContextApproval(project,scene,{status:'accepted',narrativeEvidence:evidence})!;
  scene.documentary!.visualReview!.contextApproval={...proof,evidence:{...proof.evidence,eraEvidenceQuote:'Invented 2004'}};
  assert.match(documentarySavedContextIssue(project,scene)!,/не подтверждена/);
});
