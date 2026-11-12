import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {DocumentaryRetryPermissions,documentarySelectionRetry,listDocumentaryRecovery,readDocumentarySelectionRetryGrant} from './documentary-retry.js';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {createDefaultProjectSettings,documentaryAiPlanContext,type Project,type Scene} from '@gold-work/shared';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {DocumentarySearch} from './documentary-search.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {prepareDocumentaryScript} from './documentary-plan.js';
import {effectFfmpeg} from './effect-media.js';
import {AnyModelCompletionUncertainError} from './anymodel-client.js';
import {documentaryIllustrationQualityInstructionV4} from './documentary-illustration-quality.js';

const hash=(value:string)=>createHash('sha256').update(value).digest('hex');

for(const state of ['pending','partial'] as const)test(`a legacy ${state} exact grant dispatches only its reconstructed predecessor and never approves current requirements`,async t=>{
 const root=await mkdtemp(join(tmpdir(),'gws-completed-retry-refresh-'));t.after(()=>rm(root,{recursive:true,force:true}));
 t.mock.method(globalThis,'fetch',async()=>assert.fail('Offline fixture: no HTTP'));
 let calls=0,unknown=true;
 const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryAnalysisModel:async()=>'fixture',
  documentaryCompletion:async()=>{calls++;if(unknown)throw new AnyModelCompletionUncertainError('Fixture disconnected after transmission',state==='partial'?'{"suitable":':'');return '{"suitable":true}';}},()=>root);
 const input=JSON.stringify({singleReview:true,singleReviewVersion:5,illustrationQualityVersion:1,analysisModel:'fixture',
  visualTarget:'Aurora with red sails',narration:'Aurora raised her red sails.',sourcePolicy:'specific',requiredYears:[],
  checksum:'b'.repeat(64),fileRevision:{size:'123',mtimeNs:'1',ctimeNs:'1'},startSeconds:0,endSeconds:0});
 const original='Original fixture pixel instructions',current='Revised fixture pixel instructions';
 const run=(system:string,previousRequests:Array<{system:string;input:string}>=[])=>Reflect.get(intelligence,'complete')
  .call(intelligence,'fixture-project','visual-illustration',system,input,['data:image/png;base64,AA=='],previousRequests) as Promise<unknown>;
 await assert.rejects(run(original));assert.equal(calls,1);
 const [item]=await listDocumentaryRecovery(root);assert.ok(item);assert.equal(item.state,state);
 const directory=join(root,'Documentary','Analysis'),receipt=join(directory,item.id+'.json');
 const originalBytes=await readFile(receipt,'utf8');
 await new DocumentaryRetryPermissions().authorize(root,[item]);
 const grant=await readDocumentarySelectionRetryGrant(directory,item.id);assert.ok(grant);
 const authorizedBytes=await readFile(receipt,'utf8'),permitPath=join(directory,item.id+'.retry-authorization.json'),permit=await readFile(permitPath,'utf8');
 unknown=false;
 const restored=await documentarySelectionRetry.run({grant,probe:false},()=>run(current,[{system:original,input}])) as Record<string,unknown>;
 assert.equal(calls,2,'The grant dispatches exactly one reconstructed old request');
 assert.equal(restored.suitable,undefined);assert.match(String(restored.reason),/Прежний.*завершён/);
 assert.notEqual(await readFile(receipt,'utf8'),authorizedBytes);assert.notEqual(await readFile(permitPath,'utf8'),permit);
 assert.equal(await readFile(join(directory,'RetryHistory',`${item.id}-${item.revision}.json`),'utf8'),originalBytes);
 await documentarySelectionRetry.run({grant,probe:false},()=>run(current,[{system:original,input}]));assert.equal(calls,2);
 assert.equal(JSON.parse(await readFile(receipt,'utf8')).state,'complete');
});

test('proven exact completion releases only its own unchanged source quarantine for planning',async t=>{
 const root=await mkdtemp(join(tmpdir(),'gws-completed-retry-refresh-'));t.after(()=>rm(root,{recursive:true,force:true}));
 t.mock.method(globalThis,'fetch',async()=>assert.fail('Offline fixture: no HTTP'));
 const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
 let project=await projects.create({title:'Aurora',topic:'Aurora',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
 const narration='Aurora raised her red sails.';
 project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:narration};project.scenes=[prepareDocumentaryScript(project)[0]!];
 const scene=project.scenes[0]!;scene.documentary!.autoError='Prior failed selection';
 const inputHash=hash(JSON.stringify({version:1,model:'fixture',context:documentaryAiPlanContext(project)}));
 scene.documentary!.requirement.aiSearchPlan={version:1,inputHash:hash(JSON.stringify({inputHash,sceneId:scene.id})),model:'fixture',
  subject:'Aurora',visualTarget:'Aurora with red sails',years:[],visualScope:'illustrative',preferredKind:'image',imageQueries:['Aurora sails'],
  videoQueries:[],fallbackVideoQueries:[],fallbackVisualTarget:''};
 project=await projects.mutate(project.id,()=>project);
 const storage=new LocalProjectStorage(join(root,'projects')),home=storage.projectDirectory(project.id),directory=join(home,'Documentary','Analysis');
 const sceneRoot=join(home,'Documentary',scene.id);await mkdir(sceneRoot,{recursive:true});
 const bytes='Immutable source bytes',checksum=hash(bytes),file=join(sceneRoot,checksum+'.jpg');await writeFile(file,bytes);
 const source={id:'commons:fixture',provider:'commons',kind:'image',localPath:file,checksum};
 await writeFile(join(sceneRoot,checksum+'.source.json'),JSON.stringify(source));
 const keys=[hash(JSON.stringify(['commons','commons:fixture',undefined,undefined,undefined])),hash('uncertain-file:'+checksum)];
 const quarantinePath=join(sceneRoot,'uncertain-candidates.json'),quarantine=JSON.stringify({version:1,keys});await writeFile(quarantinePath,quarantine);
 let calls=0,unknown=true;
 const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryAnalysisModel:async()=>'fixture',
  documentaryCompletion:async()=>{calls++;if(unknown)throw new Error('Fixture unknown after dispatch');return '{"suitable":false}';}},()=>home);
 const service=new DocumentaryProjectService(projects,storage,new DocumentarySearch(),join(root,'Materials'),{download:async()=>assert.fail('No download')},()=>{},intelligence);
 const scope=()=>Reflect.get(service,'queryRefreshScope').call(service,project,project.scenes) as Promise<Set<string>>;
 const input=JSON.stringify({singleReview:true,singleReviewVersion:5,illustrationQualityVersion:1,analysisModel:'fixture',visualTarget:'Aurora with red sails',
  narration,sourcePolicy:'specific',requiredYears:[],checksum,fileRevision:{size:String(bytes.length),mtimeNs:'1',ctimeNs:'1'},startSeconds:0,endSeconds:0});
 const run=()=>Reflect.get(intelligence,'complete').call(intelligence,project.id,'visual-illustration','Original fixture instructions',input,['data:image/png;base64,AA==']);
 await assert.rejects(run());const [item]=await listDocumentaryRecovery(home);assert.ok(item);
 assert.equal((await scope()).size,0);
 await new DocumentaryRetryPermissions().authorize(home,[item]);const grant=await readDocumentarySelectionRetryGrant(directory,item.id);assert.ok(grant);
 assert.equal((await scope()).size,0,'Permission without a result does not release quarantine');
 unknown=false;await documentarySelectionRetry.run({grant,probe:false},run);assert.equal(calls,2);
 assert.deepEqual([...await scope()],[scene.id]);
 assert.equal(await readFile(quarantinePath,'utf8'),quarantine,'History is preserved');
 const receiptPath=join(directory,item.id+'.json'),permitPath=join(directory,item.id+'.retry-authorization.json');
 const archivePath=join(directory,'RetryHistory',`${item.id}-${item.revision}.json`);
 const completed=await readFile(receiptPath,'utf8'),permit=await readFile(permitPath,'utf8'),archive=await readFile(archivePath,'utf8');
 for(const damage of ['pending','partial','missing-result','unconsumed','other-dispatch','other-model','other-task','other-narration','other-range','other-revision','other-origin','damaged-archive','missing-archive'] as const){
  const next=JSON.parse(completed),approval=JSON.parse(permit);
  if(damage==='pending'||damage==='partial')next.state=damage;
  if(damage==='missing-result')delete next.result;
  if(damage==='unconsumed')delete approval.consumedAt;
  if(damage==='other-dispatch')approval.consumedAt='2000-01-01T00:00:00.000Z';
  if(damage==='other-model')next.model='other-model';
  if(damage==='other-task')next.singleReviewBinding.taskKey='c'.repeat(64);
  if(damage==='other-narration')next.singleReviewBinding.quality.narration='A different scene about the same source.';
  if(damage==='other-range')next.singleReviewBinding.end=5;
  if(damage==='other-revision')next.singleReviewBinding.revision='different-file-revision';
  if(damage==='other-origin')next.singleReviewBinding.groundedRetryOrigin='c'.repeat(64);
  await writeFile(receiptPath,JSON.stringify(next));await writeFile(permitPath,JSON.stringify(approval));
  if(damage==='damaged-archive')await writeFile(archivePath,archive+' ');
  if(damage==='missing-archive')await rm(archivePath);
  assert.equal((await scope()).size,0,damage+' is not exact completion proof');
  await writeFile(receiptPath,completed);await writeFile(permitPath,permit);await writeFile(archivePath,archive);
 }
 // A completed answer for the same bytes under another key cannot replace
 // the missing result of the authorized operation itself.
 await writeFile(join(directory,'c'.repeat(64)+'.json'),completed);
 await writeFile(receiptPath,JSON.stringify({state:'failed',purpose:'visual-illustration'}));
 assert.equal((await scope()).size,0,'An unrelated COMPLETE checksum is not proof');await writeFile(receiptPath,completed);
 assert.deepEqual([...await scope()],[scene.id]);
 unknown=true;
 await assert.rejects(Reflect.get(intelligence,'complete').call(intelligence,project.id,'visual-illustration','Another original task',input,['data:image/png;base64,AA==']));
 const [second]=await listDocumentaryRecovery(home);assert.ok(second);
 await new DocumentaryRetryPermissions().authorize(home,[second]);
 assert.equal((await scope()).size,0,'Settling one exact request cannot clear a different authorized unknown over the same bytes');
 const secondGrant=await readDocumentarySelectionRetryGrant(directory,second.id);assert.ok(secondGrant);
 unknown=false;await documentarySelectionRetry.run({grant:secondGrant,probe:false},()=>Reflect.get(intelligence,'complete')
  .call(intelligence,project.id,'visual-illustration','Another original task',input,['data:image/png;base64,AA==']));
 assert.deepEqual([...await scope()],[scene.id]);
 await writeFile(file,'Changed source bytes');assert.equal((await scope()).size,0,'Another file cannot inherit completion');
 assert.equal(calls,4,'Only fixture setup and the two exact recoveries dispatch requests');
});

for(const mode of ['exact','changed-file','changed-model','changed-narration','no-grant','consumed-no-result','damaged-archive'] as const)
test(`ordinary inspectForSelection restores only an exact legacy request: ${mode}`,async t=>{
 const root=await mkdtemp(join(tmpdir(),'gws-completed-retry-refresh-'));t.after(()=>rm(root,{recursive:true,force:true}));
 t.mock.method(globalThis,'fetch',async()=>assert.fail('Offline fixture: no HTTP'));
 const file=join(root,'source.jpg');await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=s=1280x720:r=1','-frames:v','1',file]);
 const narration='Aurora raised her red sails.',target='Aurora with red sails';
 const actualChecksum=createHash('sha256').update(await readFile(file)).digest('hex');
 const scene={id:'fixture',order:0,narration,durationSeconds:4,imagePath:file,documentary:{verified:false,checksum:actualChecksum,
  selected:{id:'commons:fixture',provider:'commons',kind:'image',title:'Aurora under sail',description:'Archived photograph',localPath:file,
   width:1280,height:720,pageUrl:'https://example.test/source',downloadUrl:'',rights:'public-domain',author:'fixture',license:'public domain',
   licenseUrl:'',attribution:'fixture',retrievedAt:'fixture',query:target,match:'unverified',concerns:[]},
  requirement:{text:narration,entities:[],identities:[],years:[],queries:[target],detail:target,visualScope:'illustrative',plannedBy:'semantic',
   aiSearchPlan:{version:1,model:'fixture',inputHash:'',subject:'Aurora',visualTarget:target,visualScope:'illustrative',preferredKind:'image',years:[],
    imageQueries:[target],videoQueries:[],fallbackVisualTarget:'',fallbackVideoQueries:[]}}}} as unknown as Scene;
 const project={id:'fixture-project',title:'History',topic:'History',language:'en',aspectRatio:'16:9',mediaMode:'stock',
  settings:createDefaultProjectSettings(),scenes:[scene],videoBrief:{readyScript:narration}} as Project;
 scene.documentary!.requirement.aiSearchPlan!.inputHash=hash(JSON.stringify({inputHash:hash(JSON.stringify({version:1,model:'fixture',context:documentaryAiPlanContext(project)})),sceneId:scene.id}));
 let calls=0,unknown=true,model='fixture';const submissions:Array<{system:string;input:string;images:string[]}>=[];
 const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryAnalysisModel:async()=>model,
  documentaryCompletion:async(system,input,images)=>{calls++;submissions.push({system,input,images:images??[]});
   if(unknown)throw new AnyModelCompletionUncertainError('Fixture disconnected');return JSON.stringify({suitable:true,targetVisible:true,
    description:'Synthetic fixture approval, not real pixels evidence.',sourceText:{kind:'none',text:''}});}},()=>root);
 const complete=Reflect.get(intelligence,'complete').bind(intelligence);
 let captured:{images:string[];previous:Array<{system:string;input:string}>}|undefined;
 Reflect.set(intelligence,'complete',async(_id:string,_purpose:string,_system:string,_input:string,images:string[],previous:Array<{system:string;input:string}>)=>{
  captured={images,previous};throw Error('Fixture captures canonical requests before any submission');});
 await assert.rejects(intelligence.inspectForSelection(project,scene),/Fixture captures/);Reflect.set(intelligence,'complete',complete);
 assert.ok(captured);const old=captured.previous.find(row=>row.system.endsWith(documentaryIllustrationQualityInstructionV4)&&JSON.parse(row.input).analysisModel==='fixture');assert.ok(old);
 await assert.rejects(complete(project.id,'visual-illustration',old.system,old.input,captured.images));assert.equal(calls,1);
 const [item]=await listDocumentaryRecovery(root);assert.ok(item);
 if(mode==='no-grant'){
  await assert.rejects(intelligence.inspectForSelection(project,scene),/неизвестный результат/);assert.equal(calls,1);return;
 }
 await new DocumentaryRetryPermissions().authorize(root,[item]);
 const directory=join(root,'Documentary','Analysis'),grant=await readDocumentarySelectionRetryGrant(directory,item.id);assert.ok(grant);
 const receiptPath=join(directory,item.id+'.json'),permitPath=join(directory,item.id+'.retry-authorization.json');
 if(mode==='changed-file')await writeFile(file,'Different actual source bytes');
 if(mode==='changed-model')model='other-model';
 if(mode==='changed-narration')scene.narration='Aurora lowered her red sails.';
 if(mode==='consumed-no-result')await writeFile(permitPath,JSON.stringify({...JSON.parse(await readFile(permitPath,'utf8')),consumedAt:'fixture-previous-dispatch'}));
 if(mode==='damaged-archive')await writeFile(join(directory,'RetryHistory',`${item.id}-${item.revision}.json`),'{}');
 const receiptBefore=await readFile(receiptPath,'utf8'),permitBefore=await readFile(permitPath,'utf8');
 unknown=false;
 if(mode!=='exact'){
  await assert.rejects(documentarySelectionRetry.run({grant,probe:false},()=>intelligence.inspectForSelection(project,scene)));
  assert.equal(calls,1);assert.equal(await readFile(receiptPath,'utf8'),receiptBefore);assert.equal(await readFile(permitPath,'utf8'),permitBefore);return;
 }
 const result=await documentarySelectionRetry.run({grant,probe:false},()=>intelligence.inspectForSelection(project,scene));
 assert.equal(calls,2);assert.deepEqual(submissions[1],submissions[0],'Canonical old payload, prompt and actual frames are identical');
 assert.equal(result.review.status,'uncertain');assert.match(result.review.reason,/Прежний.*завершён/);assert.equal(scene.documentary!.verified,false);
 const receipt=JSON.parse(await readFile(join(directory,item.id+'.json'),'utf8'));assert.equal(receipt.state,'complete');assert.equal(receipt.result.suitable,true);
});
