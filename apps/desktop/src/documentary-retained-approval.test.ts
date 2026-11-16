import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,utimes} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createDefaultProjectSettings,createDocumentarySettings,documentaryRetainedApproval,documentarySceneReady,type Project,type Scene} from '@gold-work/shared';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {documentarySavedContextIssue} from './documentary-context-approval.js';

async function fixture(t:test.TestContext){
  const root=await mkdtemp(join(tmpdir(),'gws-retained-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const bytes=Buffer.from('original immutable fixture pixels'),path=join(root,'image.png');
  await writeFile(path,bytes);
  const settings=createDefaultProjectSettings();settings.assembly.documentary=createDocumentarySettings();
  const scene={id:'accepted',order:0,narration:'The original ship.',durationSeconds:5,imagePath:path,
    documentary:{verified:true,pinned:false,selected:{id:'ship',provider:'local',kind:'image',title:'Ship',description:'A ship',pageUrl:'https://example.test/ship',rights:'allowed'},
      checksum:createHash('sha256').update(bytes).digest('hex'),requirement:{text:'The original ship.',entities:[],identities:[],years:[],queries:['ship']},
      visualReview:{status:'accepted',confidence:1,reason:'Old pixel approval',checkedAt:'2026-10-01',sampleSeconds:[],quality:'clear'},
      reviewNote:'',layout:'full',effects:[],candidates:[],caption:{enabled:false,text:''}}} as unknown as Scene;
  let project={id:'retained',mediaMode:'stock',language:'English',settings,scenes:[scene,
    {id:'neighbor',order:1,narration:'A neighboring sentence.'} as Scene]} as Project;
  const repository={mutate:async(_id:string,change:(p:Project)=>Partial<Project>)=>{project={...project,...change(project)};return project;}};
  const service=new DocumentaryProjectService(repository as never,{} as never,{} as never,root,{} as never);
  const migrate=()=> (service as unknown as {retainAcceptedMaterials(p:Project):Promise<Project>}).retainAcceptedMaterials(project);
  return {path,get project(){return project;},get scene(){return project.scenes[0]!;},migrate};
}

test('unchanged accepted pixels survive newer rules and a file timestamp change without AI',async t=>{
  const f=await fixture(t);
  assert.ok(documentarySavedContextIssue(f.project,f.scene));
  await f.migrate();
  assert.equal(documentaryRetainedApproval(f.scene,f.project),true);
  assert.equal(documentarySceneReady(f.scene,undefined,f.project),true);
  assert.equal(documentarySavedContextIssue(f.project,f.scene),undefined);
  await utimes(f.path,new Date(),new Date());
  await f.migrate();
  assert.equal(f.scene.documentary!.verified,true);
  assert.match(f.scene.documentary!.reviewNote,/Принято по прежним правилам/);
});

test('changed bytes never inherit an old pixel approval even under the same filename',async t=>{
  const f=await fixture(t);await f.migrate();
  await writeFile(f.path,'different replacement pixels');
  await f.migrate();
  assert.equal(f.scene.documentary!.verified,false);
  assert.equal(documentarySceneReady(f.scene,undefined,f.project),false);
});

test('neighbor, match mode and explicit scene requirements invalidate retained approval',async t=>{
  for(const change of [
    (p:Project)=>{p.scenes[1]!.narration='Now it means a different ship.';},
    (p:Project)=>{p.settings.assembly.documentary!.matchMode='thematic';},
    (p:Project)=>{p.scenes[0]!.documentary!.requirement.years=['1952'];},
  ]){
    const f=await fixture(t);await f.migrate();change(f.project);
    assert.equal(documentarySceneReady(f.scene,undefined,f.project),false);
    await f.migrate();assert.equal(f.scene.documentary!.verified,false);
  }
});

test('a changed video interval is not grandfathered during first migration',async t=>{
  const f=await fixture(t),s=f.scene;
  s.videoPath=f.path;s.imagePath=undefined;s.trimStartSeconds=5;s.trimEndSeconds=10;
  s.documentary!.selected!.kind='video';
  s.documentary!.visualReview!.trimStartSeconds=0;s.documentary!.visualReview!.trimEndSeconds=5;
  await f.migrate();
  assert.equal(f.scene.documentary!.verified,false);
  assert.equal(f.scene.documentary!.acceptedUnderPreviousRules,undefined);
});
