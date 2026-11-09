import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test,{type TestContext} from 'node:test';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import type {DocumentaryCandidate,Scene} from '@gold-work/shared';
import {checkDocumentarySelectionRetry,documentarySelectionRetry,DocumentaryRetryPermissions,listDocumentaryRecovery,readDocumentarySelectionRetryGrant} from './documentary-retry.js';
import {DocumentaryIntelligence,documentaryNarrationContext} from './documentary-intelligence.js';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {DocumentarySearch} from './documentary-search.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {prepareDocumentaryScript} from './documentary-plan.js';
import {documentaryAiPlanContext} from './documentary-ai-plan-state.js';

// Full03 scene 11: keep the observed IDs and binding, with a synthetic malformed response.
const id='d7299c20745b40258c7682c9c4839c0369f79d42a633f73c5b6d186849a5ec99';
const model='ag/gemini-3.8-flash-high';
const binding={checksum:'5e84bd34ee6862c877d9f2874a530cbb61f07bcf3cb0d008afd241af4973fd15',
  taskKey:'9f61fa7b6cfe89de1c558df96472417da0c99646038172a87ee395a72e48cafb',start:0,end:3.1333333333333333};

async function setup(t:TestContext){
  const root=await mkdtemp(join(tmpdir(),'gws-selection-retry-grant-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const directory=join(root,'Documentary','Analysis');
  await mkdir(directory,{recursive:true});
  const receipt=join(directory,id+'.json'),approval=join(directory,id+'.retry-authorization.json');
  const raw=JSON.stringify({state:'received',purpose:'visual-illustration',model,singleReviewBinding:binding,raw:'{"description":'});
  await writeFile(receipt,raw);
  const revision=createHash('sha256').update(raw).digest('hex');
  return {root,directory,receipt,approval,archive:join(directory,'RetryHistory',`${id}-${revision}.json`),revision};
}

test('scene 11 source grant is visible only after public authorization of the same unresolved revision',async t=>{
  const f=await setup(t);
  assert.equal(await readDocumentarySelectionRetryGrant(f.directory,id),undefined);
  const requested=await listDocumentaryRecovery(f.root);
  assert.equal(await new DocumentaryRetryPermissions().authorize(f.root,requested),1);
  const grant=JSON.parse(await readFile(f.approval,'utf8'));
  assert.deepEqual(await readDocumentarySelectionRetryGrant(f.directory,id),{id,revision:f.revision,model,binding,
    priorState:'received',approvedAt:grant.approvedAt});
  await writeFile(f.approval,JSON.stringify({...grant,consumedAt:'2026-11-09T00:26:00.000Z'}));
  assert.equal(await readDocumentarySelectionRetryGrant(f.directory,id),undefined);
});

test('47d5557 scene 11 narrative task uses its own key and preserves the old grant',async t=>{
  const f=await setup(t);
  await new DocumentaryRetryPermissions().authorize(f.root,await listDocumentaryRecovery(f.root));
  const grant=(await readDocumentarySelectionRetryGrant(f.directory,id))!;
  // Measured 47d5557 taskKey with fallbackNarrativeContext. The checkpoint ID
  // below stands for the separate current request in this offline test.
  const currentBinding={...binding,taskKey:'4db5e7e2ceb0cfbf39f4ac9a969fcd5c6e967bc2c491572b790c0614dd7e0b48'};
  const current={id:'1'.repeat(64),model,purpose:'visual-illustration',binding:currentBinding,legacyTaskKey:binding.taskKey,existing:false};
  const gate=(request:typeof current)=>documentarySelectionRetry.run({grant,probe:false},()=>checkDocumentarySelectionRetry(f.directory,request));
  assert.equal(await gate(current),'narrative');
  assert.equal(await gate({...current,id,binding}),'exact');
  for(const wrong of [
    {...current,id}, {...current,model:'different-model'}, {...current,binding:{...currentBinding,end:4}},
    {...current,legacyTaskKey:'2'.repeat(64)}, {...current,existing:true},
  ])await assert.rejects(gate(wrong),/не совпадает/);
  await writeFile(join(f.directory,current.id+'.json'),JSON.stringify({state:'failed',purpose:current.purpose,model,singleReviewBinding:currentBinding}));
  await assert.rejects(gate({...current,id:'3'.repeat(64)}),/не совпадает/);
  assert.deepEqual(await readDocumentarySelectionRetryGrant(f.directory,id),grant);
});

for(const priorState of ['pending','partial'] as const)test(`${priorState} can only authorize its exact old request`,async t=>{
  const f=await setup(t),receipt=JSON.parse(await readFile(f.receipt,'utf8'));
  await writeFile(f.receipt,JSON.stringify({...receipt,state:priorState}));
  await new DocumentaryRetryPermissions().authorize(f.root,await listDocumentaryRecovery(f.root));
  const grant=(await readDocumentarySelectionRetryGrant(f.directory,id))!;
  await documentarySelectionRetry.run({grant,probe:false},async()=>{
    assert.equal(await checkDocumentarySelectionRetry(f.directory,{id,model,binding,purpose:'visual-illustration',existing:true}),'exact');
    await assert.rejects(checkDocumentarySelectionRetry(f.directory,{id:'1'.repeat(64),model,purpose:'visual-illustration',existing:false,
      legacyTaskKey:binding.taskKey,binding:{...binding,taskKey:'2'.repeat(64)}}),/не совпадает/);
  });
});

for(const scenario of ['exact crash recovery','exact rejected completion','narrative crash recovery'] as const)test(
  `selection ${scenario} uses the canonical receipt and one dispatch`,async t=>{
  const narrative=scenario==='narrative crash recovery',suitable=scenario!=='exact rejected completion';
  const root=await mkdtemp(join(tmpdir(),'gws-selection-retry-orchestration-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  t.mock.method(globalThis,'fetch',async()=>assert.fail('No live network'));
  const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
  let project=await projects.create({title:'Clipper',topic:'Clipper',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
  const narration='The silhouette of the clipper.',target='Clipper silhouette';
  project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:narration};
  project.settings.stockVideoPercent=0;project.settings.voice.enabled=false;
  project.settings.assembly.documentary!.autoMotionGraphics=false;
  project.scenes=prepareDocumentaryScript(project).slice(0,1);
  const scene=project.scenes[0]!;
  const requirement=scene.documentary!.requirement={text:scene.narration,entities:[],identities:[],years:[],queries:[target],preferredKind:'image',detail:target,
    aiSearchPlan:{version:1,inputHash:'',model:'fixture',subject:'clipper',visualTarget:target,visualScope:'illustrative',preferredKind:'image',years:[],
      imageQueries:[target],videoQueries:[],fallbackVideoQueries:[],fallbackVisualTarget:''}};
  requirement.aiSearchPlan.inputHash=hash({inputHash:hash({version:1,model:'fixture',context:documentaryAiPlanContext(project)}),sceneId:scene.id});
  project=await projects.mutate(project.id,()=>project);
  const storage=new LocalProjectStorage(join(root,'projects')),directory=storage.projectDirectory(project.id);
  const sceneRoot=join(directory,'Documentary',scene.id);
  await mkdir(sceneRoot,{recursive:true});
  const file=join(root,'source.jpg'),bytes='Offline source bytes',checksum=createHash('sha256').update(bytes).digest('hex');
  await writeFile(file,bytes);
  const source:DocumentaryCandidate={id:`local:${checksum}`,provider:'local',kind:'image',title:target,description:target,localPath:file,
    width:1280,height:720,pageUrl:'',downloadUrl:'https://example.test/source.jpg',author:'fixture',license:'fixture',licenseUrl:'',rights:'licensed',attribution:'fixture',query:target,retrievedAt:'fixture',match:'unverified',concerns:[]};
  const scope=JSON.stringify([documentaryNarrationContext(project,scene),requirement.entities,requirement.identities,requirement.years,requirement.detail,scene.documentary?.motionGraphic]);
  const uncertainFile=join(sceneRoot,'uncertain-candidates.json');
  const uncertainty=JSON.stringify({version:1,scope:hash([hash(['visual-rejection-v1',scope,project.aspectRatio,requirement.preferredKind,scene.documentary?.layout]),model]),
    keys:[createHash('sha256').update('uncertain-file:'+checksum).digest('hex')]});
  await writeFile(uncertainFile,uncertainty);
  let calls=0,applications=0,malformed=true,interrupt=suitable,patch:Record<string,unknown>={};
  const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryAnalysisModel:async()=>model,
    documentaryCompletion:async(...args:unknown[])=>{
      calls++;
      if(!malformed){
        const options=args[8] as {purpose?:string;singleAttempt?:boolean;onTerminal?:unknown};
        assert.equal(options.singleAttempt,true);
        assert.equal(options.purpose,'visual-illustration');
        assert.equal(typeof options.onTerminal,'function');
      }
      return malformed?'{"description":':JSON.stringify({description:'Fixture frame',suitable,reason:'Fixture verdict'});
    }},()=>directory);
  const complete=Reflect.get(intelligence,'complete').bind(intelligence) as (id:string,purpose:string,system:string,input:string,images:string[],previous?:{system:string;input:string}[])=>Promise<Record<string,unknown>>;
  const system='Inspect fixture';
  const legacyInput={singleReview:true,singleReviewVersion:5,
    visualTarget:target,narration,sourcePolicy:'background',requiredYears:[],analysisModel:model,checksum,
    fileRevision:{size:String(bytes.length),mtimeNs:'1',ctimeNs:'1'},startSeconds:0,endSeconds:0};
  const inspect=()=>complete(project.id,'visual-illustration',system,JSON.stringify({...legacyInput,...patch}),
    ['data:image/jpeg;base64,AA=='],patch.fallbackNarrativeContext?[{system,input:JSON.stringify(legacyInput)}]:[]);
  await assert.rejects(inspect());assert.equal(calls,1);
  malformed=false;
  const searcher=new DocumentarySearch();
  searcher.search=async input=>({candidates:input.kind==='image'&&input.providers?.includes('local')?[source]:[],sources:[]});
  const service=new DocumentaryProjectService(projects,storage,searcher,join(root,'Materials'),{download:async()=>assert.fail('No download')},()=>{},
    {simpleSelection:true,selectionReviewIdentity:async()=>({model,contract:'fixture'}),available:async()=>true,plan:async()=>new Map(),inspect:async()=>assert.fail('Use selection'),
      inspectForSelection:async()=>{
        const before=calls,value=await inspect(),usedNewAnalysis=calls!==before;
        if(interrupt&&usedNewAnalysis){interrupt=false;throw new Error('Interrupted after saving COMPLETE');}
        return {usedNewAnalysis,review:{status:value.suitable===true?'accepted':'rejected',confidence:1,
          reason:String(value.reason),quality:'',annotations:[],sampleSeconds:[0],checkedAt:'fixture'}};
      }});
  Reflect.set(service,'selectionResources',async()=>({workers:1}));
  Reflect.set(service,'apply',async()=>{
    applications++;
    const p=(await projects.get(project.id))!;
    return {...p,scenes:p.scenes.map(s=>({...s,imagePath:file,documentary:{...s.documentary!,checksum,selected:source}}))};
  });
  const select=()=>service.autoSelect(project.id,{sceneIds:[scene.id]});
  await select();assert.equal(calls,1,'Uncertain source never reaches dispatch without a grant');
  const [item]=await listDocumentaryRecovery(directory);
  assert.ok(item);
  const narrativePatch=narrative?{fallbackNarrativeContext:{binding:'fixture-narrative',narration,visualTarget:target}}:{};
  if(narrative){patch=narrativePatch;await assert.rejects(inspect(),/неизвестный результат/);assert.equal(calls,1);}
  await new DocumentaryRetryPermissions().authorize(directory,[item]);
  const analysis=join(directory,'Documentary','Analysis');
  const mismatches=[{analysisModel:'other'},{endSeconds:1},{visualTarget:'Other task'}];
  for(const mismatch of narrative?mismatches:[...mismatches,{sourceHint:{title:'Changed request key'}}]){
    patch={...narrativePatch,...mismatch};await select();assert.equal(calls,1);
    assert.ok(await readDocumentarySelectionRetryGrant(analysis,item.id),'An unrelated request cannot consume the grant');
  }
  patch=narrativePatch;await select();assert.equal(calls,2);
  assert.equal(applications,1);
  assert.ok(!(await projects.get(project.id))!.scenes[0]!.documentary?.verified,'Scene was not committed before interruption or refusal');
  const receipts=await Promise.all((await readdir(analysis)).filter(file=>/^[a-f0-9]{64}\.json$/.test(file))
    .map(async file=>({id:file.slice(0,-5),...JSON.parse(await readFile(join(analysis,file),'utf8'))})));
  const completed=receipts.filter(receipt=>receipt.state==='complete');
  assert.equal(completed.length,1);
  const grant=await readDocumentarySelectionRetryGrant(analysis,item.id);
  if(narrative){
    assert.ok(grant);
    assert.notEqual(completed[0].id,item.id);
    assert.notEqual(completed[0].singleReviewBinding.taskKey,grant.binding.taskKey);
  }else{
    assert.equal(grant,undefined);
    assert.equal(completed[0].id,item.id);
  }
  await select();assert.equal(calls,2);
  assert.equal(applications,suitable?2:1);
  assert.equal(Boolean((await projects.get(project.id))!.scenes[0]!.documentary?.verified),suitable);
  assert.equal(await readFile(uncertainFile,'utf8'),uncertainty);
});

test('a modified archive and an already completed receipt cannot authorize selection',async t=>{
  const f=await setup(t);
  await new DocumentaryRetryPermissions().authorize(f.root,await listDocumentaryRecovery(f.root));
  const saved=await readFile(f.archive,'utf8');
  await writeFile(f.archive,saved+' ');
  assert.equal(await readDocumentarySelectionRetryGrant(f.directory,id),undefined);
  await writeFile(f.archive,saved);
  await writeFile(f.receipt,JSON.stringify({state:'complete',purpose:'visual-illustration',model,result:{suitable:true}}));
  assert.equal(await readDocumentarySelectionRetryGrant(f.directory,id),undefined);
});
