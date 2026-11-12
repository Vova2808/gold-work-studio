import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {documentaryAiPlanContext,type DocumentaryCandidate,type Scene} from '@gold-work/shared';
import {documentaryTerminalEmptySources} from './documentary-terminal-empty.js';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {DocumentarySearch} from './documentary-search.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {prepareDocumentaryScript} from './documentary-plan.js';

const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
async function fixture(t:test.TestContext){
  const root=await mkdtemp(join(tmpdir(),'gws-terminal-empty-'));t.after(()=>rm(root,{recursive:true,force:true}));
  t.mock.method(globalThis,'fetch',async()=>assert.fail('Offline fixture: no HTTP'));
  const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
  let project=await projects.create({title:'Aurora history',topic:'Aurora ship',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
  project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:'Aurora became a general cargo carrier.'};
  project.scenes=[prepareDocumentaryScript(project)[0]!];project.settings.stockVideoPercent=0;
  const scene=project.scenes[0]!,doc=scene.documentary!;
  doc.autoError='No suitable material';scene.audioPath='retained-paid-narration.wav';
  const inputHash=hash(JSON.stringify({version:1,model:'fixture',context:documentaryAiPlanContext(project)}));
  doc.requirement={...doc.requirement,entities:['Aurora'],identities:[{name:'Aurora',aliases:[]}],years:[],queries:['Aurora ship'],detail:'Aurora ship',
    preferredKind:'image',aiSearchPlan:{version:1,inputHash:hash(JSON.stringify({inputHash,sceneId:scene.id})),model:'fixture',subject:'Aurora',
      visualTarget:'Aurora ship',years:[],visualScope:'illustrative',preferredKind:'image',imageQueries:['Aurora ship'],videoQueries:[],
      reservePolicy:'primary-only',fallbackVisualTarget:'',fallbackVideoQueries:[]}};
  project=await projects.mutate(project.id,()=>project);
  const storage=new LocalProjectStorage(join(root,'projects')),home=storage.projectDirectory(project.id),sceneRoot=join(home,'Documentary',scene.id);
  const analysis=join(home,'Documentary','Analysis');await mkdir(analysis,{recursive:true});await mkdir(sceneRoot,{recursive:true});
  const bytes='Immutable fixture image',checksum=hash(bytes),file=join(sceneRoot,checksum+'.jpg');await writeFile(file,bytes);
  const source={id:'commons:aurora',provider:'commons',kind:'image',title:'Aurora ship',description:'The ship Aurora',localPath:file,checksum,
    width:1280,height:720,pageUrl:'https://example.test/aurora',downloadUrl:'',rights:'public-domain',license:'Public domain',licenseUrl:'',
    author:'Fixture',attribution:'Fixture',retrievedAt:'fixture',query:'Aurora ship',match:'unverified',concerns:[]} as DocumentaryCandidate;
  const manifest=join(sceneRoot,checksum+'.source.json');await writeFile(manifest,JSON.stringify(source));
  const receipt={state:'rejected',rejection:'empty-response',purpose:'visual-illustration',model:'fixture',raw:'',completedAt:'2026-11-10T22:02:35.460Z',
    completion:{disposition:'empty',receivedCharacters:0},singleReviewBinding:{checksum,start:0,end:0,quality:{version:1,target:'cargo ship',narration:scene.narration}}};
  const receiptPath=join(analysis,'a'.repeat(64)+'.json');await writeFile(receiptPath,JSON.stringify(receipt));
  const keys=[hash(JSON.stringify(['commons',source.id,null,null,null])),hash('uncertain-file:'+checksum)];
  const quarantinePath=join(sceneRoot,'uncertain-candidates.json'),quarantine=JSON.stringify({version:1,scope:'legacy-visual-task',keys});
  await writeFile(quarantinePath,quarantine);
  let searches=0,inspections=0,downloads=0;
  const search=new DocumentarySearch();search.search=async()=>{searches++;return {candidates:[source],sources:[]};};
  const service=new DocumentaryProjectService(projects,storage,search,join(root,'Materials'),{download:async()=>{downloads++;assert.fail('No download');}},()=>{},
    {simpleSelection:true,available:async()=>true,selectionReviewIdentity:async()=>({model:'fixture',contract:'fixture'}),
      plan:async()=>assert.fail('No heuristic planning'),inspect:async()=>assert.fail('No direct inspection'),
      inspectForSelection:async()=>{inspections++;assert.fail('Settled empty source must not be repaid');}},undefined,undefined,
    {plan:async(_current,scenes)=>new Map(scenes.map(s=>[s.id,s.documentary!.requirement]))});
  Reflect.set(service,'selectionResources',async()=>({workers:1}));service.localCandidates=async()=>[];
  const scope=()=>Reflect.get(service,'queryRefreshScope').call(service,project,project.scenes) as Promise<Set<string>>;
  return {root,projects,project,scene,home,source,file,checksum,manifest,receipt,receiptPath,quarantinePath,quarantine,service,scope,
    counts:()=>({searches,inspections,downloads})};
}

for(const legacy of [false,true])test(`settled empty ${legacy?'legacy':'current'} response allows plan refresh but preserves source quarantine`,async t=>{
  const f=await fixture(t);
  if(legacy)await writeFile(f.receiptPath,JSON.stringify({...f.receipt,state:'complete',rejection:undefined,result:{status:'uncertain'}}));
  const before=await readFile(f.receiptPath,'utf8');
  assert.deepEqual([...await f.scope()],[f.scene.id]);
  assert.equal((await documentaryTerminalEmptySources(f.home,'fixture',f.project.scenes)).get(f.scene.id)?.[0]?.checksum,f.checksum);
  assert.equal(await readFile(f.receiptPath,'utf8'),before);
  assert.equal(await readFile(f.quarantinePath,'utf8'),f.quarantine);
});

test('incomplete proof, other narration/model, altered bytes and unrelated pending requests cannot release a plan',async t=>{
  const f=await fixture(t),before=await readFile(f.receiptPath,'utf8');
  for(const change of [{state:'pending'},{raw:'partial'},{completion:{receivedCharacters:0}},{completedAt:undefined},{model:'other'},
    {singleReviewBinding:{...f.receipt.singleReviewBinding,quality:{version:1,target:'cargo ship',narration:'Different scene.'}}}]){
    await writeFile(f.receiptPath,JSON.stringify({...f.receipt,...change}));assert.equal((await f.scope()).size,0,JSON.stringify(change));
  }
  await writeFile(f.receiptPath,before);await writeFile(f.file,'changed bytes');assert.equal((await f.scope()).size,0);
  await writeFile(f.file,'Immutable fixture image');
  const pendingPath=join(f.home,'Documentary','Analysis','b'.repeat(64)+'.json');
  await writeFile(pendingPath,JSON.stringify({...f.receipt,state:'pending',raw:undefined,completion:undefined}));
  assert.equal((await f.scope()).size,0,'Own empty completion does not settle another unknown request');
  assert.equal(await readFile(f.receiptPath,'utf8'),before);assert.equal(await readFile(f.quarantinePath,'utf8'),f.quarantine);
});

test('after target refresh public selection searches alternatives without paying for the same source or local alias', {timeout:15_000},async t=>{
  const f=await fixture(t),receipt=await readFile(f.receiptPath,'utf8');
  assert.deepEqual([...await f.scope()],[f.scene.id]);
  await f.projects.mutate(f.project.id,current=>({scenes:current.scenes.map(s=>({...s,documentary:{...s.documentary!,
    requirement:{...s.documentary!.requirement,detail:'Aurora preserved hull',aiSearchPlan:{...s.documentary!.requirement.aiSearchPlan!,
      visualTarget:'Aurora preserved hull',imageQueries:['Aurora preserved hull'],grounding:{version:1,
        mandatory:[{kind:'identity',required:'Aurora',scriptQuote:s.narration}],illustrations:['A view of the same vessel'],optionalDetails:[]}}}}}))}));
  for(const alias of [false,true]){
    if(alias)Object.assign(f.source,{provider:'local',id:'local:'+f.checksum});
    const result=await f.service.autoSelect(f.project.id,{sceneIds:[f.scene.id]});
    assert.equal(result.selected,0);assert.equal(result.project.scenes[0]!.audioPath,f.scene.audioPath);
  }
  assert.ok(f.counts().searches>0,'Other sources remain searchable');
  assert.equal(f.counts().inspections,0);assert.equal(f.counts().downloads,0);
  const otherChecksum=hash('A different source'),otherFile=join(f.root,otherChecksum+'.jpg');
  await writeFile(otherFile,'A different source');
  Object.assign(f.source,{id:'local:'+otherChecksum,provider:'local',localPath:otherFile,checksum:otherChecksum});
  const inspected:string[]=[];
  Reflect.set(f.service,'apply',async()=>{
    const current=(await f.projects.get(f.project.id))!;
    return {...current,scenes:current.scenes.map(s=>({...s,imagePath:otherFile,documentary:{...s.documentary!,selected:f.source,checksum:otherChecksum}}))};
  });
  Reflect.get(f.service,'intelligence').inspectForSelection=async(_project:unknown,s:Scene)=>{
    inspected.push(s.documentary!.checksum!);
    return {usedNewAnalysis:false,review:{status:'rejected',confidence:1,reason:'Synthetic fixture: not accepted',quality:'',checkedAt:'fixture',sampleSeconds:[0]}};
  };
  await f.service.autoSelect(f.project.id,{sceneIds:[f.scene.id]});
  assert.deepEqual(inspected,[otherChecksum],'A genuinely different source reaches normal pixel inspection');
  assert.equal(await readFile(f.receiptPath,'utf8'),receipt);assert.equal(await readFile(f.quarantinePath,'utf8'),f.quarantine);
});
