import assert from 'node:assert/strict';
import test,{type TestContext} from 'node:test';
import {mkdir,mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {AnyModelCompletionUncertainError,type AnyModelClient} from './anymodel-client.js';
import {DocumentaryAiQueryPlanner} from './documentary-ai-query-planner.js';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {DocumentarySearch} from './documentary-search.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {prepareDocumentaryScript} from './documentary-plan.js';

async function fixture(t:TestContext,count:number){
 const root=await mkdtemp(join(tmpdir(),'gws-query-resume-reasons-'));t.after(()=>rm(root,{recursive:true,force:true}));
 t.mock.method(globalThis,'fetch',async()=>assert.fail('Offline fixture: no HTTP'));
 const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
 let project=await projects.create({title:'Aurora',topic:'The ship Aurora',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
 const lines=Array.from({length:count},(_,n)=>`Aurora carried cargo on voyage ${n+1}.`);
 project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:lines.join('\n')};
 const base=prepareDocumentaryScript(project)[0]!;
 project.scenes=lines.map((narration,order)=>({...structuredClone(base),id:'fixture-'+order,order,narration,audioPath:`paid-voice-${order}.wav`}));
 project=await projects.mutate(project.id,()=>project);
 const storage=new LocalProjectStorage(join(root,'projects')),home=storage.projectDirectory(project.id);
 const requests:Array<{system:string;ids:string[]}>=[];
 const state={next:'initial'};
 const client={documentaryQueryModel:async()=>'fixture',documentaryCompletion:async(system:string,input:string)=>{
  const requested=JSON.parse(input).requestedScenes as Array<{sceneId:string;narration:string}>;
  requests.push({system,ids:requested.map(s=>s.sceneId)});
  if(state.next==='pending')throw new AnyModelCompletionUncertainError('Server closed without a confirmed body','','connection');
  if(state.next==='partial')throw new AnyModelCompletionUncertainError('Connection lost during JSON','{"scenes":[','connection');
  const scenes=requested.map(s=>({sceneId:s.sceneId,subject:'Aurora',visualTarget:state.next==='complete'?'Aurora identified hull':'Aurora',years:[],
   visualScope:'illustrative',preferredKind:'image',reservePolicy:'primary-only',imageQueries:['Aurora photograph'],videoQueries:[],fallbackVideoQueries:[],fallbackVisualTarget:'',
   ...(state.next==='invalid'?{}:{grounding:{version:1,mandatory:[{kind:'identity',required:'Aurora',scriptQuote:s.narration}],
    illustrations:['An attributed view of Aurora illustrates the same ship.'],optionalDetails:[]}})}));
  return JSON.stringify({scenes});
 }} as unknown as AnyModelClient;
 const planner=new DocumentaryAiQueryPlanner(client,()=>home);
 const service=new DocumentaryProjectService(projects,storage,new DocumentarySearch(),join(root,'Materials'),{download:async()=>assert.fail('No downloads')},()=>{},
  undefined,undefined,undefined,planner);
 project=await service.planSearch(project.id);
 const directory=join(home,'documentary-ai-query-plans'),file=join(directory,(await readdir(directory)).find(name=>name.endsWith('.json'))!);
 return {root,home,projects,project,planner,service,requests,state,file,cache:JSON.parse(await readFile(file,'utf8'))};
}

test('legacy, unknown planner, unknown pixels and source quarantine retain distinct resume reasons without payment',async t=>{
 const f=await fixture(t,5),cache=f.cache,original=structuredClone(cache.attempts[0]);
 const raw=JSON.parse(cache.attempts[0].rawResponse);
 for(const row of raw.scenes){delete row.grounding;row.visualTarget='Legacy event-specific staging';}
 cache.attempts[0].rawResponse=JSON.stringify(raw);cache.attempts[0].request.promptRevision=10;
 for(const plan of Object.values(cache.plans) as Array<Record<string,unknown>>){delete plan.grounding;plan.visualTarget='Legacy event-specific staging';}
 const attempt=(index:number,status:string)=>{
  const next=structuredClone(original),input=JSON.parse(next.request.payload),id=f.project.scenes[index]!.id;
  next.ids=[id];next.refreshIds=[id];next.request.promptRevision=13;next.status=status;
  input.requestedScenes=input.requestedScenes.filter((row:{sceneId:string})=>row.sceneId===id);next.request.payload=JSON.stringify(input);
  next.rawResponse=JSON.stringify({scenes:JSON.parse(original.rawResponse).scenes.filter((row:{sceneId:string})=>row.sceneId===id)});
  if(status==='uncertain'){delete next.rawResponse;delete next.responseState;next.errorName='AnyModelCompletionUncertainError';}
  return next;
 };
 cache.attempts.push(attempt(1,'uncertain'),attempt(4,'complete'));
 await writeFile(f.file,JSON.stringify(cache));
 f.project=await f.projects.mutate(f.project.id,current=>({scenes:current.scenes.map((s,index)=>({...s,documentary:{...s.documentary!,
  autoError:index?'Prior failed selection':undefined,requirement:index===4?s.documentary!.requirement:{...s.documentary!.requirement,aiSearchPlan:cache.plans[s.id]}}}))}));
 const analysis=join(f.home,'Documentary','Analysis');await mkdir(analysis,{recursive:true});
 const visualFile=join(analysis,'a'.repeat(64)+'.json'),visualBytes=JSON.stringify({state:'pending',purpose:'visual-illustration',
  singleReviewBinding:{quality:{narration:f.project.scenes[2]!.narration}}});await writeFile(visualFile,visualBytes);
 const sceneRoot=join(f.home,'Documentary',f.project.scenes[3]!.id);await mkdir(sceneRoot,{recursive:true});
 const uncertaintyFile=join(sceneRoot,'uncertain-candidates.json'),uncertainty=JSON.stringify({version:1,scope:'saved-scope',keys:['b'.repeat(64)]});
 await writeFile(uncertaintyFile,uncertainty);
 const before=await readFile(f.file,'utf8'),scenesBefore=structuredClone(f.project.scenes);
 await assert.rejects(f.service.planSearch(f.project.id,f.project.scenes.map(s=>s.id)),/план.*не готов/i);
 const issues=await f.service.getDocumentaryQueryPlanIssues(f.project.id);
 assert.deepEqual(issues.map(issue=>issue.sceneId),f.project.scenes.slice(0,4).map(s=>s.id));
 assert.match(issues[0]!.reason,/завершённый.*прежнего формата/i);
 assert.match(issues[1]!.reason,/запроса AI-планировщику не подтверждён/);
 assert.match(issues[2]!.reason,/визуальная проверка материала имеет неизвестный результат/);
 assert.match(issues[3]!.reason,/отметкой о незавершённой проверке сохранённого источника/);
 assert.ok(issues.every(issue=>!issue.retryToken&&!issue.canContinue),'Unknown responses must not offer a blind paid retry');
 const status=JSON.parse(await readFile(join(f.home,'Documentary','Plans','ai-query-status.json'),'utf8'));
 assert.deepEqual(status.issues,issues);assert.deepEqual(status.missingSceneIds,issues.map(issue=>issue.sceneId));
 assert.deepEqual(status.aiSceneIds,[f.project.scenes[4]!.id]);
 assert.equal(f.requests.length,1,'Diagnostic reads and normal resume cannot re-pay old unknown requests or usable revision 13');
 assert.equal(await readFile(f.file,'utf8'),before);assert.equal(await readFile(visualFile,'utf8'),visualBytes);
 assert.equal(await readFile(uncertaintyFile,'utf8'),uncertainty);
 assert.deepEqual((await f.projects.get(f.project.id))!.scenes,scenesBefore);
});

test('a newly completed legacy refresh is applied before reporting the superseded plan format',async t=>{
 const f=await fixture(t,1),cache=f.cache,raw=JSON.parse(cache.attempts[0].rawResponse),id=f.project.scenes[0]!.id;
 cache.attempts[0].request.promptRevision=10;delete raw.scenes[0].grounding;delete cache.plans[id].grounding;
 cache.attempts[0].rawResponse=JSON.stringify(raw);await writeFile(f.file,JSON.stringify(cache));
 await f.projects.mutate(f.project.id,current=>({scenes:current.scenes.map(s=>({...s,documentary:{...s.documentary!,autoError:'Prior failed selection',
  requirement:{...s.documentary!.requirement,aiSearchPlan:cache.plans[id]}}}))}));
 f.state.next='complete';
 const result=await f.service.planSearch(f.project.id,[id]);
 assert.equal(f.requests.length,2);assert.equal(result.scenes[0]!.documentary!.requirement.aiSearchPlan!.visualTarget,'Aurora identified hull');
 assert.ok(result.scenes[0]!.documentary!.requirement.aiSearchPlan!.grounding);
 assert.deepEqual(await f.service.getDocumentaryQueryPlanIssues(f.project.id),[]);
 const status=JSON.parse(await readFile(join(f.home,'Documentary','Plans','ai-query-status.json'),'utf8'));
 assert.equal(status.state,'complete');assert.deepEqual(status.missingSceneIds,[]);
});

test('complete scene entries from an ordinary interrupted batch stay usable beside its unknown scene',async t=>{
 const f=await fixture(t,2),cache=f.cache,raw=JSON.parse(cache.attempts[0].rawResponse),first=f.project.scenes[0]!,second=f.project.scenes[1]!;
 cache.attempts[0].status='uncertain';cache.attempts[0].responseState='partial';cache.attempts[0].rawResponse='{"scenes":['+JSON.stringify(raw.scenes[0])+',';
 cache.attempts[0].errorName='AnyModelCompletionUncertainError';delete cache.plans[second.id];await writeFile(f.file,JSON.stringify(cache));
 await f.projects.mutate(f.project.id,current=>({scenes:current.scenes.map(s=>s.id===second.id?{...s,documentary:{...s.documentary!,
  requirement:{...s.documentary!.requirement,aiSearchPlan:undefined}}}:s)}));
 const bytes=await readFile(f.file,'utf8');
 await assert.rejects(f.service.planSearch(f.project.id,[first.id,second.id]),/план.*не готов/i);
 const issues=await f.service.getDocumentaryQueryPlanIssues(f.project.id);assert.deepEqual(issues.map(row=>row.sceneId),[second.id]);
 const status=JSON.parse(await readFile(join(f.home,'Documentary','Plans','ai-query-status.json'),'utf8'));
 assert.deepEqual(status.aiSceneIds,[first.id]);assert.deepEqual(status.missingSceneIds,[second.id]);
 assert.equal(f.requests.length,1);assert.equal(await readFile(f.file,'utf8'),bytes);
});

for(const outcome of ['complete','same','pending','partial','invalid'] as const)test(`explicit instruction correction is scoped and keeps the paid budget: ${outcome}`,async t=>{
 const f=await fixture(t,7),cache=f.cache;
 cache.attempts[0].request.promptRevision=13;await writeFile(f.file,JSON.stringify(cache));
 f.project=await f.projects.mutate(f.project.id,current=>({scenes:current.scenes.map((s,i)=>({...s,documentary:{...s.documentary!,autoError:i?'Prior failed selection':undefined,
  ...(i===3?{pinned:true}:{}),...(i===4?{visualReview:{status:'accepted' as const,confidence:1,reason:'Existing accepted review',quality:'',checkedAt:'fixture',sampleSeconds:[]}}:{})}}))}));
 const ids=f.project.scenes.map(s=>s.id),beforeScenes=structuredClone(f.project.scenes);
 // A different unresolved planner request must keep its old bytes and cannot
 // be included merely because this operation explicitly corrects another plan.
 cache.attempts.push({ids:[ids[2]],status:'uncertain',request:{promptRevision:13,system:'saved',payload:'{}'}});
 await writeFile(f.file,JSON.stringify(cache));const before=await readFile(f.file,'utf8');
 const analysis=join(f.home,'Documentary','Analysis');await mkdir(analysis,{recursive:true});
 const pendingFile=join(analysis,'c'.repeat(64)+'.json'),pendingBytes=JSON.stringify({state:'pending',purpose:'visual-illustration',singleReviewBinding:{quality:{narration:f.project.scenes[5]!.narration}}});
 await writeFile(pendingFile,pendingBytes);
 const sceneRoot=join(f.home,'Documentary',ids[6]!);await mkdir(sceneRoot,{recursive:true});
 const uncertainFile=join(sceneRoot,'uncertain-candidates.json'),uncertainBytes=JSON.stringify({version:1,scope:'saved',keys:['d'.repeat(64)]});
 await writeFile(uncertainFile,uncertainBytes);
 await f.service.planSearch(f.project.id,[ids[0]!]);assert.equal(f.requests.length,1,'Ordinary resume keeps usable revision 13');
 assert.equal(await readFile(f.file,'utf8'),before);
 f.state.next=outcome;
 const requested=[ids[0]!,ids[2]!,ids[3]!,ids[4]!,ids[5]!,ids[6]!];
 await assert.rejects(f.service.planSearch(f.project.id,undefined,undefined,{reviseInstructions:true}),/конкретные/);
 if(outcome==='complete'){
  const running=Reflect.get(f.service,'autoRuns') as Map<string,Promise<unknown>>;running.set(f.project.id,Promise.resolve());
  try{await assert.rejects(f.service.planSearch(f.project.id,requested,undefined,{reviseInstructions:true}),/после остановки/);}
  finally{running.delete(f.project.id);}
 }
 const correct=()=>f.service.planSearch(f.project.id,requested,undefined,{reviseInstructions:true});
 await assert.rejects(correct(),/план.*не готов/i); // the independent unknown scene remains blocked
 assert.equal(f.requests.length,2);assert.deepEqual(f.requests[1]!.ids,[ids[0]]);
 const after=JSON.parse(await readFile(f.file,'utf8'));
 assert.deepEqual(after.attempts.slice(0,cache.attempts.length),cache.attempts);
 assert.equal(after.attempts.at(-1).request.promptRevision,14);
 const successful=outcome==='complete'||outcome==='same',saved=(await f.projects.get(f.project.id))!;
 if(successful)assert.equal(saved.scenes[0]!.documentary!.requirement.aiSearchPlan!.visualTarget,outcome==='complete'?'Aurora identified hull':'Aurora');
 else assert.deepEqual(saved.scenes[0]!.documentary!.requirement,beforeScenes[0]!.documentary!.requirement);
 assert.deepEqual(saved.scenes.slice(1),beforeScenes.slice(1),'Other/accepted/pinned scene plans and voices stay intact');
 const bytes=await readFile(f.file,'utf8');await assert.rejects(correct(),/план.*не готов/i);
 assert.equal(f.requests.length,2,'A completed correction is reused; an unknown or exhausted correction cannot dispatch again');
 assert.equal(await readFile(f.file,'utf8'),bytes);
 assert.equal(await readFile(pendingFile,'utf8'),pendingBytes);assert.equal(await readFile(uncertainFile,'utf8'),uncertainBytes);
 const status=JSON.parse(await readFile(join(f.home,'Documentary','Plans','ai-query-status.json'),'utf8'));
 for(const id of [ids[2],ids[5],ids[6]])assert.ok(status.missingSceneIds.includes(id),'Explicitly blocked corrections remain visible in saved status');
 const issues=await f.service.getDocumentaryQueryPlanIssues(f.project.id);
 if(outcome==='pending'||outcome==='partial')assert.match(issues.find(row=>row.sceneId===ids[0])!.reason,/AI-планировщику не подтверждён/);
 if(outcome==='invalid')assert.match(issues.find(row=>row.sceneId===ids[0])!.reason,/получен полностью.*пригодный план/);
 const prompt=f.requests[1]!.system;
 assert.match(prompt,/Geographic connections and narrated advantages/);
 assert.match(prompt,/do not require a single frame to show both endpoints/);
 assert.match(prompt,/EVERY offered illustration against EVERY mandatory condition/);
 assert.match(prompt,/never weaken a required fact/);
 assert.match(prompt,/Generic people or a similar group cannot stand for a specifically identified person or crew/);
});
