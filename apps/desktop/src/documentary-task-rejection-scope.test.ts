import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {copyFile,mkdir,mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {documentaryAiPlanContext,type DocumentaryCandidate,type DocumentaryRequirement,type Project,type Scene} from '@gold-work/shared';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {DocumentarySearch} from './documentary-search.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {prepareDocumentaryScript} from './documentary-plan.js';
import {effectFfmpeg} from './effect-media.js';
import {FileProjectRepository} from './file-project-repository.js';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function fixture(t:test.TestContext,change:'subject'|'grounding'|'queries'|'proposed-reserve'='subject',repository:'memory'|'file'='memory'){
 const root=await mkdtemp(join(tmpdir(),'gws-task-rejection-scope-'));t.after(()=>rm(root,{recursive:true,force:true}));
 t.mock.method(globalThis,'fetch',async()=>assert.fail('No live network'));
 const file=join(root,'saved-source.mp4');
 await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=s=1280x720:r=6:d=5','-c:v','libx264','-threads','1',file]);
 const checksum=createHash('sha256').update(await readFile(file)).digest('hex');
 const registryPath=join(root,'registry.json');
 const projects=new ProjectService(repository==='file'?new FileProjectRepository(registryPath):new MemoryProjectRepository(),new MockDirectorProvider());
 let project=await projects.create({title:'Task scope',topic:'Ship history',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
 const narration='Elias Hart owned the ship Aurora, which carried red sails.';
 project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:narration};
 project.scenes=[prepareDocumentaryScript(project)[0]!];project.settings.stockVideoPercent=60;
 const scene=project.scenes[0]!,doc=scene.documentary!;
 scene.durationSeconds=3;scene.trimStartSeconds=0;scene.trimEndSeconds=3;
 scene.audioPath=join(root,'paid-narration.mp3');await writeFile(scene.audioPath,'Retained paid audio');scene.videoPath=file;
 const subject=change==='subject'?'Elias Hart':'Aurora',target=change==='subject'?'Elias Hart portrait':'Aurora ship';
 const inputHash=hash({version:1,model:'fixture',context:documentaryAiPlanContext(project)});
 doc.requirement={...doc.requirement,text:narration,entities:[subject],identities:[{name:subject,aliases:[]}],queries:[target],years:[],detail:target,
  aiSearchPlan:{version:1,inputHash:hash({inputHash,sceneId:scene.id}),model:'fixture',subject,visualTarget:target,years:[],visualScope:'illustrative',
   preferredKind:'video',reservePolicy:'thematic',imageQueries:[target],videoQueries:[target],fallbackVisualTarget:target,fallbackVideoQueries:[target],
   grounding:{version:1,mandatory:[{kind:'identity',required:subject,scriptQuote:narration}],illustrations:['An identified view of '+subject],optionalDetails:[]}}};
 const candidate:DocumentaryCandidate={id:'youtube:aurora',provider:'youtube',kind:'video',title:'Aurora ship',description:'The named ship',
  width:1280,height:720,durationSeconds:54,query:'Aurora ship',pageUrl:'https://example.test/aurora',downloadUrl:'https://example.test/aurora.mp4',
  author:'Fixture',license:'Fixture',licenseUrl:'',attribution:'Fixture',rights:'licensed',retrievedAt:'now',match:'unverified',concerns:[]};
 doc.selected={...candidate,id:'local:saved',provider:'local',downloadUrl:'',durationSeconds:5,localPath:file};doc.checksum=checksum;doc.verified=false;
 if(repository==='file')doc.candidates=[candidate];
 doc.searchRecovery={reason:'The ship view does not show the requested owner.',queries:['owner portrait'],rejectedRanges:[
  {checksum,start:0,end:3,sourceId:candidate.id,sourceStart:0,sourceEnd:54,reason:'The ship view does not show the requested owner.'}]};
 const replacement:DocumentaryRequirement=structuredClone(doc.requirement),plan=replacement.aiSearchPlan!;
 if(change==='subject'){
  replacement.entities=['Aurora'];replacement.identities=[{name:'Aurora',aliases:[]}];replacement.detail='Aurora ship';
  Object.assign(plan,{subject:'Aurora',visualTarget:'Aurora ship',imageQueries:['Aurora photograph'],videoQueries:['Aurora ship'],
   fallbackVisualTarget:'Aurora ship',fallbackVideoQueries:['Aurora ship']});
  plan.grounding={version:1,mandatory:[{kind:'identity',required:'Aurora',scriptQuote:narration}],
   illustrations:['An identified Aurora view illustrates the ship Elias Hart owned, not his portrait.'],optionalDetails:[]};
 }else if(change==='grounding'){
  plan.grounding!.mandatory.push({kind:'condition',required:'Visible red sailcloth',scriptQuote:narration});
  plan.grounding!.illustrations=['An identified Aurora view with its red sailcloth visible.'];
 }else if(change==='proposed-reserve'){
  plan.fallbackVisualTarget='Aurora ship near a harbour';plan.fallbackVideoQueries=['Aurora harbour view'];
 }else{
  doc.requirement.footageFallback={version:1,target,queries:[target],originalTarget:target,narration,kind:'video',reason:'Old search wording'};
  replacement.footageFallback={...doc.requirement.footageFallback,queries:['Aurora historic vessel'],reason:'New search wording'};
  plan.imageQueries=['Aurora archive photograph'];plan.videoQueries=['Aurora historic vessel'];plan.fallbackVideoQueries=['Aurora historic vessel'];
  replacement.queries=plan.videoQueries;
 }
 project=await projects.mutate(project.id,()=>project);
 const storage=new LocalProjectStorage(join(root,'projects')),projectRoot=storage.projectDirectory(project.id);
 const sceneRoot=join(projectRoot,'Documentary',scene.id.replace(/[^a-zA-Z0-9_-]/g,'_'));
 await mkdir(sceneRoot,{recursive:true});
 const retainedFiles=new Map<string,string>([
  [join(sceneRoot,checksum+'.review.json'),JSON.stringify({review:{status:'rejected',reason:'Saved original review'}})],
  [join(sceneRoot,'uncertain-candidates.json'),JSON.stringify({version:1,keys:['protected-unknown-source']})],
  [join(sceneRoot,'primary-photo-uncertain-candidates.json'),JSON.stringify({version:1,keys:['protected-unknown-photo']})],
 ]);
 if(repository==='file')for(const state of ['complete','pending'])retainedFiles.set(join(projectRoot,'Documentary','Analysis',hash(state)+'.json'),
  JSON.stringify({state,purpose:'visual-illustration',model:'fixture',requestKey:hash(state),
   ...(state==='complete'?{raw:'Saved paid result',result:{suitable:false,reason:'Retained paid refusal'}}:{error:'Unknown paid outcome'})}));
 for(const [path,bytes]of retainedFiles){await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes);}
 const transfers:Array<{start:number;end:number}|undefined>=[];let plans=0;
 const service=new DocumentaryProjectService(projects,storage,new DocumentarySearch(),join(root,'Materials'),
  {download:async()=>assert.fail('No stock download')},()=>{},
  {simpleSelection:true,available:async()=>true,plan:async()=>assert.fail('No heuristic plan'),inspect:async()=>assert.fail('No implicit review')},undefined,
  {download:async(_source,path,_signal,_progress,_hd,range)=>{transfers.push(range);await copyFile(file,path);}},
  {plan:async()=>{plans++;return new Map([[scene.id,replacement]]);}});
 const archives=async()=>{
  const directory=join(sceneRoot,'TaskRejectionHistory');
  const files=await readdir(directory).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return [];throw error;});
  return Promise.all(files.map(async name=>JSON.parse(await readFile(join(directory,name),'utf8'))));
 };
 return {root,registryPath,projects,project,scene:project.scenes[0]!,replacement,service,storage,projectRoot,sceneRoot,archives,retainedFiles,candidate,transfers,plans:()=>plans};
}

test('file repository archives changed-task refusals with full candidates and preserves saved sources and paid receipts',async t=>{
 const f=await fixture(t,'subject','file'),before=(await f.projects.get(f.project.id))!.scenes[0]!;
 const display=(await f.projects.get(f.project.id,{omitCandidates:true}))!.scenes[0]!.documentary!;
 assert.deepEqual(display.candidates,[]);assert.equal(display.candidatesDeferred,true);assert.equal(display.candidateCount,1);
 const planned=await f.service.planSearch(f.project.id,[before.id]);
 assert.equal(planned.scenes[0]!.documentary!.searchRecovery,undefined);
 const reopened=(await new FileProjectRepository(f.registryPath).get(f.project.id))!.scenes[0]!,doc=reopened.documentary!;
 assert.equal(doc.requirement.aiSearchPlan!.subject,'Aurora');assert.equal(doc.searchRecovery,undefined);
 assert.deepEqual(doc.candidates,before.documentary!.candidates);assert.equal(doc.candidatesDeferred,undefined);
 assert.equal(doc.candidateCount,undefined);assert.deepEqual(doc.selected,before.documentary!.selected);
 assert.equal(reopened.audioPath,before.audioPath);assert.equal(reopened.videoPath,before.videoPath);assert.equal(doc.checksum,before.documentary!.checksum);
 assert.equal(await readFile(reopened.audioPath!,'utf8'),'Retained paid audio');
 assert.equal(createHash('sha256').update(await readFile(reopened.videoPath!)).digest('hex'),before.documentary!.checksum);
 const archives=await f.archives();assert.equal(archives.length,1);assert.deepEqual(archives[0].searchRecovery,before.documentary!.searchRecovery);
 assert.deepEqual(archives[0].from.requirement,before.documentary!.requirement);
 for(const [path,bytes]of f.retainedFiles)assert.equal(await readFile(path,'utf8'),bytes,'Full and pending receipts remain byte-identical');
});

for(const edited of ['title','candidate'] as const)test(`file repository refuses a real concurrent ${edited} edit after archive creation`,{timeout:10_000},async t=>{
 const f=await fixture(t,'subject','file'),before=(await f.projects.get(f.project.id))!.scenes[0]!;
 let entered!:()=>void,release!:()=>void;
 const waiting=new Promise<void>(resolve=>{entered=resolve;}),resume=new Promise<void>(resolve=>{release=resolve;});
 t.after(()=>release());
 const mutate=f.projects.mutate.bind(f.projects);let paused=false;
 t.mock.method(f.projects,'mutate',async(...args:Parameters<ProjectService['mutate']>)=>{
  if(!paused&&(await f.archives()).length){paused=true;entered();await resume;}
  return mutate(...args);
 });
 const result=assert.rejects(f.service.planSearch(f.project.id,[before.id]),/Сцена изменилась во время сохранения истории отказов/);
 await waiting;
 // A separate repository/service writes the actual registry while planning is
 // suspended after its durable archive and before its guarded mutation.
 const editor=new ProjectService(new FileProjectRepository(f.registryPath),new MockDirectorProvider());
 const userEdit=await editor.mutate(f.project.id,current=>({scenes:current.scenes.map(scene=>scene.id!==before.id?scene:
  edited==='title'?{...scene,title:'User correction during archive'}:{...scene,documentary:{...scene.documentary!,
   candidates:[...scene.documentary!.candidates,{...f.candidate,id:'user-added-source',description:'New evidence from another editor'}]}})}));
 release();await result;
 const reopened=(await new FileProjectRepository(f.registryPath).get(f.project.id))!;
 assert.deepEqual(reopened.scenes,userEdit.scenes,'Rejected plan cannot overwrite an actual concurrent edit');
 assert.deepEqual(reopened.scenes[0]!.documentary!.searchRecovery,before.documentary!.searchRecovery);
 assert.deepEqual(reopened.scenes[0]!.documentary!.requirement,before.documentary!.requirement);
 assert.equal((await f.archives()).length,1,'The earlier history remains safely archived');
 for(const [path,bytes]of f.retainedFiles)assert.equal(await readFile(path,'utf8'),bytes);
});

test('a real task change archives old ranges before releasing both download and actual-frame shortcuts',async t=>{
 const f=await fixture(t),before=structuredClone(f.scene),range=before.documentary!.searchRecovery!.rejectedRanges[0]!;
 const apply=Reflect.get(f.service,'apply').bind(f.service) as (projectId:string,sceneId:string,source:DocumentaryCandidate,commit:boolean)=>Promise<Project>;
 await assert.rejects(apply(f.project.id,before.id,f.candidate,false),/Проверенные участки/);
 assert.equal(f.transfers.length,0,'Old task keeps its settled source-range refusal before transfer');
 let reviews=0;
 const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{
  reviews++;return JSON.stringify({suitable:false,targetVisible:false,reason:'Mock new-task rejection',description:'Synthetic test pattern',
   targetEvidence:'The real pixels do not show the ship',sourceText:{kind:'none',text:''},footageOrigin:'camera',
   scriptFit:{kind:'subject-context',scriptQuote:before.narration,requiredVisible:'Aurora',visible:false,evidence:'Synthetic test pattern'}});
 }},()=>f.projectRoot);
 const oldReview=await intelligence.inspectForSelection(f.project,before);
 assert.equal(oldReview.review.reason,range.reason);assert.equal(oldReview.usedNewAnalysis,false);assert.equal(reviews,0);
 const nextProject=await f.service.planSearch(f.project.id,[before.id]),next=nextProject.scenes[0]!;
 assert.equal(next.documentary!.searchRecovery,undefined);
 const [archive]=await f.archives();assert.ok(archive);
 assert.deepEqual(archive.searchRecovery,before.documentary!.searchRecovery);
 assert.deepEqual(archive.from.requirement,before.documentary!.requirement);
 assert.equal(archive.to.requirement.aiSearchPlan.subject,'Aurora');
 assert.equal(next.audioPath,before.audioPath);assert.equal(next.videoPath,before.videoPath);assert.equal(next.documentary!.checksum,before.documentary!.checksum);
 assert.deepEqual(next.documentary!.selected,before.documentary!.selected);
 const newReview=await intelligence.inspectForSelection(nextProject,next);
 assert.equal(newReview.review.status,'rejected');assert.equal(newReview.usedNewAnalysis,true);assert.equal(reviews,1,'The new task reaches a real frame-review call, not the old range shortcut');
 await apply(f.project.id,next.id,f.candidate,false);
 assert.equal(f.transfers.length,1,'The new task can download the formerly excluded source interval');
 for(const [path,bytes]of f.retainedFiles)assert.equal(await readFile(path,'utf8'),bytes,'Existing source review and unknown markers remain untouched');
 await f.service.planSearch(f.project.id,[next.id]);assert.equal((await f.archives()).length,1,'Repeated application does not discard later history or duplicate archives');
});

test('query-only primary and reserve refresh retains the exact content refusals and source guards',async t=>{
 const f=await fixture(t,'queries'),before=structuredClone(f.scene);
 const planned=await f.service.planSearch(f.project.id,[before.id]),next=planned.scenes[0]!;
 assert.deepEqual(next.documentary!.searchRecovery,before.documentary!.searchRecovery);assert.equal((await f.archives()).length,0);
 assert.deepEqual(next.documentary!.requirement.aiSearchPlan!.videoQueries,['Aurora historic vessel']);
 assert.deepEqual(next.documentary!.requirement.footageFallback!.queries,['Aurora historic vessel']);
 const apply=Reflect.get(f.service,'apply').bind(f.service);
 await assert.rejects(apply(f.project.id,next.id,f.candidate,false),/Проверенные участки/);assert.equal(f.transfers.length,0);
});

test('a changed mandatory condition and representation invalidates old task refusals even when target text is unchanged',async t=>{
 const f=await fixture(t,'grounding');
 const result=await f.service.planSearch(f.project.id,[f.scene.id]);
 assert.equal(result.scenes[0]!.documentary!.searchRecovery,undefined);assert.equal((await f.archives()).length,1);
 assert.equal(result.scenes[0]!.documentary!.requirement.aiSearchPlan!.visualTarget,f.scene.documentary!.requirement.aiSearchPlan!.visualTarget);
});

test('editing an inactive proposed reserve preserves the primary content refusals',async t=>{
 const f=await fixture(t,'proposed-reserve'),before=structuredClone(f.scene);
 const result=await f.service.planSearch(f.project.id,[f.scene.id]);
 assert.equal(result.scenes[0]!.documentary!.requirement.footageFallback,undefined);
 assert.deepEqual(result.scenes[0]!.documentary!.searchRecovery,before.documentary!.searchRecovery);
 assert.equal((await f.archives()).length,0);
});

test('archive failure does not partially apply the new target or remove its old refusals',async t=>{
 const f=await fixture(t),before=(await f.projects.get(f.project.id))!;
 await writeFile(join(f.sceneRoot,'TaskRejectionHistory'),'blocked archive destination');
 await assert.rejects(f.service.planSearch(f.project.id,[f.scene.id]),/EEXIST|ENOTDIR/);
 const after=(await f.projects.get(f.project.id))!;
 assert.deepEqual(after.scenes,before.scenes);assert.equal(f.transfers.length,0);
});

for(const protection of ['pinned','accepted','uncertain','unknown-recovery-field'] as const)
test(`${protection} evidence cannot be cleared by a planned task change`,async t=>{
 const f=await fixture(t);
 const project=await f.projects.mutate(f.project.id,current=>({scenes:current.scenes.map(scene=>{
  const doc=scene.documentary!;
  if(protection==='pinned')doc.pinned=true;
  if(protection==='accepted'||protection==='uncertain')doc.visualReview={status:protection,confidence:1,reason:'Protected prior outcome',quality:'',sampleSeconds:[],checkedAt:'now'};
  if(protection==='unknown-recovery-field')Object.assign(doc.searchRecovery!,{failedAiAnalysis:{status:'pending',operation:'existing-paid-request'}});
  return scene;
 })}));
 const before=structuredClone(project.scenes[0]!);
 const result=await f.service.planSearch(f.project.id,[before.id]);
 assert.deepEqual(result.scenes[0]!.documentary!.searchRecovery,before.documentary!.searchRecovery);assert.equal((await f.archives()).length,0);
 for(const [path,bytes]of f.retainedFiles)assert.equal(await readFile(path,'utf8'),bytes);
});
