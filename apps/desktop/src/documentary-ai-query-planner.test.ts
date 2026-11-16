import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import type { Project, Scene } from '@gold-work/shared';
import { AnyModelClient, AnyModelCompletionUncertainError, AnyModelOutputFormatError } from './anymodel-client.js';
import { DocumentaryAiQueryPlanner } from './documentary-ai-query-planner.js';
import { ProxyConnectError } from './proxy-utils.js';
import {createHash} from 'node:crypto';
import {documentaryAiPlanContext,currentDocumentaryAiSearchPlan} from './documentary-ai-plan-state.js';
import {documentaryAiPlanGroundingIssue} from '@gold-work/shared';

const MODEL = 'fixture/text-model';
// Pipeline fixtures use synthetic provenance; semantic source grounding is
// exercised separately below with unchanged, real multi-theme narration.
const fixtureQuote = 'The fixture subject and its visible period are explicitly requested.';
type Payload = { originalScript: string; contextScenes: Array<{ sceneId: string; narration: string }>;
  requestedScenes: Array<{ sceneId: string; narration: string;sourcePassage?:string }>;visualPolicy:{mode:string} };
type Call = { system: string; data: Payload; model: string | undefined; images: string[] };
const scenesOf = (...narrations: string[]): Scene[] => narrations.map((narration, order) =>
  ({ id: `scene-${order}`, order, narration, title: `Scene ${order}` } as Scene));
const projectOf = (scenes: Scene[], script = scenes.map(scene => scene.narration).join('\n')): Project =>
  ({ id: 'fixture-project', title: 'Fixture', topic: 'History', language: 'ru', scenes,
    videoBrief: { readyScript: script+'\n'+fixtureQuote } } as Project);
const entry = (id: string, extra = {}) => ({ sceneId: id, subject: 'RMS Titanic',
  grounding:{version:1,mandatory:[{kind:'identity',required:'RMS Titanic',scriptQuote:fixtureQuote},
    {kind:'era',required:'1912',scriptQuote:fixtureQuote}],illustrations:['authentic photograph or drawing of the same subject'],optionalDetails:[]},
  visualTarget: 'RMS Titanic propellers 1912', years: ['1912'], visualScope: 'exact', preferredKind: 'video',reservePolicy:'thematic',
  imageQueries: ['RMS Titanic propellers 1912'], videoQueries: ['RMS Titanic 1912 footage'],
  fallbackVisualTarget: 'Early twentieth century ocean liner propellers',
  fallbackVideoQueries: ['ocean liner propellers archival footage'], ...extra });
const response = (ids: string[]) => JSON.stringify({ scenes: ids.map(id => entry(id)) });

test('an explicit unknown-plan retry submits one scene once and retains the original uncertain batch',async t=>{
  let answer=false;
  const f=await fixture(t,async call=>{
    if(!answer)throw Error('Connection lost after submission');
    return response(call.data.requestedScenes.map(scene=>scene.sceneId));
  });
  const scenes=scenesOf('First ship scene.','Second ship scene.'),project=projectOf(scenes);
  await assert.rejects(f.planner().plan(project,scenes),/не подтверждён/);
  const file=path.join(f.root,'documentary-ai-query-plans',(await f.cacheFiles())[0]!);
  const original=JSON.parse(await readFile(file,'utf8'));
  const [first,second]=await f.planner().readIssues(project,scenes);
  assert.equal(first?.retryKind,'unknown');assert.ok(first?.retryToken&&second?.retryToken);
  await assert.rejects(f.planner().plan(project,scenes),/автоматического платного повтора нет/);
  await assert.rejects(f.planner().plan(project,[scenes[1]!],{retryToken:first.retryToken}),/Состояние попыток изменилось/);
  assert.equal(f.calls.length,1);
  answer=true;
  const restored=await f.planner().plan(project,[scenes[0]!],{retryToken:first.retryToken});
  assert.equal(restored.size,1);assert.equal(f.calls.length,2);
  assert.deepEqual(f.calls[1]!.data.requestedScenes.map(scene=>scene.sceneId),[scenes[0]!.id]);
  const saved=JSON.parse(await readFile(file,'utf8'));
  assert.deepEqual(saved.attempts[0],original.attempts[0]);
  assert.deepEqual(saved.attempts[1].explicitRetry,{sceneId:scenes[0]!.id,token:first.retryToken,previousOutcome:'unknown'});
  assert.equal((await f.planner().readIssues(project,[scenes[0]!]))[0]?.cached,true,
    'The newly completed explicit answer is applicable despite its preserved predecessor');
  await assert.rejects(f.planner().plan(project,[scenes[1]!]),/автоматического платного повтора нет/);
  assert.equal(f.calls.length,2);
  for(const damage of ['token','result','state','context','scene']){
    const changed=structuredClone(saved),retry=changed.attempts[1];
    if(damage==='token')retry.explicitRetry.token='forged';
    if(damage==='result')retry.rawResponse='{"scenes":[]}';
    if(damage==='state')retry.status='uncertain';
    if(damage==='context'){const input=JSON.parse(retry.request.payload);input.originalScript+=' changed';retry.request.payload=JSON.stringify(input);}
    if(damage==='scene')retry.explicitRetry.sceneId=scenes[1]!.id;
    await writeFile(file,JSON.stringify(changed));
    const [held]=await f.planner().readIssues(project,[scenes[0]!]);
    assert.equal(held?.cached,undefined,damage);assert.match(held?.reason??'',/не подтверждён/,damage);
  }
});

for(const outcome of ['disconnect','invalid','partial'])test(`an explicit unknown-plan retry remains one-shot after ${outcome}`,async t=>{
  let calls=0;
  const f=await fixture(t,async(_call,partial)=>{
    calls++;
    if(calls===1||outcome==='disconnect')throw Error('Connection lost after submission');
    if(outcome==='partial'){partial?.('{"scenes":[');throw Error('Disconnected mid-response');}
    return '{"scenes":[]}';
  });
  const scenes=scenesOf('One ship scene.'),project=projectOf(scenes);
  await assert.rejects(f.planner().plan(project,scenes));
  const first=(await f.planner().readIssues(project,scenes))[0]!;
  assert.ok(first.retryToken);
  await assert.rejects(f.planner().plan(project,scenes,{retryToken:first.retryToken}));
  assert.equal(calls,2);
  await assert.rejects(f.planner().plan(project,scenes));
  await assert.rejects(f.planner().plan(project,scenes,{retryToken:first.retryToken}),/Состояние попыток изменилось/);
  assert.equal(calls,2);
  const file=path.join(f.root,'documentary-ai-query-plans',(await f.cacheFiles())[0]!);
  const cache=JSON.parse(await readFile(file,'utf8'));
  assert.equal(cache.attempts.length,2);assert.equal(cache.attempts[0].status,'uncertain');
});

test('unknown-plan permission cannot survive changed context, evidence or a malformed request',async t=>{
  const f=await fixture(t,async()=>{throw Error('Unknown submitted request');});
  const scenes=scenesOf('A ship departed.'),project=projectOf(scenes);
  await assert.rejects(f.planner().plan(project,scenes));
  const token=(await f.planner().readIssues(project,scenes))[0]!.retryToken!;assert.ok(token);
  const file=path.join(f.root,'documentary-ai-query-plans',(await f.cacheFiles())[0]!);
  const original=JSON.parse(await readFile(file,'utf8'));
  const changedScript={...project,videoBrief:{...project.videoBrief!,readyScript:project.videoBrief!.readyScript+' A changed fact.'}};
  await assert.rejects(f.planner().plan(changedScript,scenes,{retryToken:token}),/Состояние попыток изменилось/);
  f.state.model='fixture/other-model';
  await assert.rejects(f.planner().plan(project,scenes,{retryToken:token}),/Состояние попыток изменилось/);
  f.state.model=MODEL;
  const changed=structuredClone(original);changed.attempts[0].rawResponse='A later saved fragment';changed.attempts[0].responseState='partial';
  await writeFile(file,JSON.stringify(changed));
  await assert.rejects(f.planner().plan(project,scenes,{retryToken:token}),/Состояние попыток изменилось/);
  for(const request of [undefined,{system:23,payload:'{}'},{system:'saved',payload:'broken'},
    {system:'saved',payload:JSON.stringify({requestedScenes:[{sceneId:scenes[0]!.id,narration:'Changed narration'}]})}]){
    const damaged=structuredClone(original);damaged.attempts[0].request=request;
    await writeFile(file,JSON.stringify(damaged));
    assert.equal((await f.planner().readIssues(project,scenes))[0]!.retryToken,undefined);
  }
  assert.equal(f.calls.length,1);
});

test('two clicks on one unknown-plan token make only one new submission',async t=>{
  let calls=0;
  const f=await fixture(t,async()=>{calls++;throw Error('Unknown submitted request');});
  const scenes=scenesOf('A ship departed.'),project=projectOf(scenes);
  await assert.rejects(f.planner().plan(project,scenes));
  const token=(await f.planner().readIssues(project,scenes))[0]!.retryToken!;assert.ok(token);
  const results=await Promise.allSettled([f.planner().plan(project,scenes,{retryToken:token}),f.planner().plan(project,scenes,{retryToken:token})]);
  assert.ok(results.every(result=>result.status==='rejected'));
  assert.equal(calls,2);
});

test('unknown-plan retry refreshes an existing plan once without replacing it before application',async t=>{
  const scenes=scenesOf('The clipper Aurora sailed.'),project=projectOf(scenes);
  let revised=false;
  const f=await fixture(t,async call=>JSON.stringify({scenes:call.data.requestedScenes.map(scene=>groundedEntry(scene.sceneId,'Aurora',scenes[0]!.narration,
    {visualTarget:revised?'A stern view of Aurora':'An overall view of Aurora'}))}));
  const initial=await f.planner().plan(project,scenes);
  scenes[0]!.documentary={requirement:initial.get(scenes[0]!.id)!,verified:false} as Scene['documentary'];
  const file=path.join(f.root,'documentary-ai-query-plans',(await f.cacheFiles())[0]!);
  const cache=JSON.parse(await readFile(file,'utf8'));
  cache.attempts.push({ids:[scenes[0]!.id],refreshIds:[scenes[0]!.id],status:'uncertain',request:structuredClone(cache.attempts[0].request)});
  await writeFile(file,JSON.stringify(cache));
  const issue=(await f.planner().readIssues(project,scenes))[0]!;
  assert.equal(issue.retryKind,'unknown');assert.ok(issue.retryToken);
  await f.planner().plan(project,scenes);assert.equal(f.calls.length,1,'Ordinary resume cannot repay the unknown correction');
  revised=true;
  const result=await f.planner().plan(project,scenes,{retryToken:issue.retryToken});
  assert.equal(f.calls.length,2);assert.equal(result.get(scenes[0]!.id)!.aiSearchPlan!.visualTarget,'A stern view of Aurora');
  const after=JSON.parse(await readFile(file,'utf8'));
  assert.deepEqual(after.plans,cache.plans);assert.deepEqual(after.attempts.slice(0,2),cache.attempts);
  assert.deepEqual(after.attempts[2].refreshIds,[scenes[0]!.id]);
  assert.equal((await f.planner().readCached(project,scenes)).get(scenes[0]!.id)!.aiSearchPlan!.visualTarget,'A stern view of Aurora');
  const cachedIssue=(await f.planner().readIssues(project,scenes))[0]!;
  assert.equal(cachedIssue.cached,true);assert.equal(cachedIssue.retryToken,undefined);
  assert.equal((await f.planner().plan(project,scenes)).get(scenes[0]!.id)!.aiSearchPlan!.visualTarget,'A stern view of Aurora');
  assert.equal(f.calls.length,2,'A complete paid correction survives a restart before project apply');
  scenes[0]!.documentary!.requirement=result.get(scenes[0]!.id)!;
  assert.deepEqual(await f.planner().readIssues(project,scenes),[]);
  await f.planner().plan(project,scenes);assert.equal(f.calls.length,2);
  await assert.rejects(f.planner().plan(project,scenes,{retryToken:issue.retryToken}),/Состояние попыток изменилось/);
  assert.equal(f.calls.length,2);
});

const groundedEntry=(id:string,subject:string,quote:string,extra={})=>entry(id,{subject,visualTarget:subject,years:[],
  visualScope:'illustrative',preferredKind:'image',imageQueries:[subject+' historical portrait drawing photograph'],videoQueries:[subject+' preserved view'],
  grounding:{version:1,mandatory:[{kind:'identity',required:subject,scriptQuote:quote}],
    illustrations:['archival photograph or drawing of '+subject,'present-day view of the same surviving subject'],
    optionalDetails:['Narrated historical activity need not be occurring in the illustration.']},...extra});

test('source-grounded plans keep history separate from visible requirements across ships, biography, engineering and places',async t=>{
  const cases=[
    {subject:'Cutty Sark',quote:'After eight tea voyages, Cutty Sark left the trade for which she had been built.'},
    {subject:'Richard Woodget',quote:'In 1885, Richard Woodget became captain.'},
    {subject:'Marie Curie',quote:'Marie Curie later left her teaching position to focus on research.'},
    {subject:'Suez Canal',quote:'The Suez Canal changed the journey between the Mediterranean and the Red Sea.'},
    {subject:'Power Jets W.1',quote:'The Power Jets W.1 demonstrated a new propulsion concept in 1941.'},
  ];
  const scenes=scenesOf(...cases.map(item=>item.quote));scenes[0]!.audioPath='retained-original-audio.mp3';
  const project=projectOf(scenes);project.videoBrief!.readyScript=cases.map(item=>item.quote).join('\n');
  const before=structuredClone(project);
  const f=await fixture(t,async call=>JSON.stringify({scenes:call.data.requestedScenes.map(scene=>{
    const item=cases[scenes.findIndex(current=>current.id===scene.sceneId)]!;
    return groundedEntry(scene.sceneId,item.subject,item.quote);
  })}));
  const plans=await f.planner().plan(project,scenes);
  assert.equal(plans.size,cases.length);assert.deepEqual(project,before);
  for(const [index,scene] of scenes.entries()){
    const result=plans.get(scene.id)!,plan=result.aiSearchPlan!;
    assert.equal(documentaryAiPlanGroundingIssue(plan,project.videoBrief!.readyScript!),undefined);
    assert.deepEqual(plan.years,[]);assert.deepEqual(plan.grounding!.mandatory.map(check=>check.kind),['identity']);
    assert.equal(result.identities![0]!.name,cases[index]!.subject);
  }
  assert.match(f.calls[0]!.system,/end of trade.*does not require a historical event photo, loading/);
  assert.match(f.calls[0]!.system,/different named subject or a broad thematic association is not a substitute/);
  assert.match(f.calls[0]!.system,/quote establishes provenance, not an automatic requirement/);
});

test('preselected contextual subjects keep their own identity, while portrait and physical-feature requests stay strict',async t=>{
  const context='The clipper Aurora carried cargo. The Delta Canal connected two seas. The North Observatory studied stars.';
  const cases=[
    {line:'Her owner, Elias Hart, was betting on speed.',subject:'Aurora',quote:'The clipper Aurora carried cargo.',
      relation:'An identified view of Aurora illustrates the very ship owned by Elias Hart; not a portrait of him.'},
    {line:'In 1885, Morgan Vale became captain.',subject:'Aurora',quote:'The clipper Aurora carried cargo.',
      relation:'An identified view of Aurora illustrates the ship of which Morgan Vale became captain, not the appointment ceremony.'},
    {line:'The Delta Canal gave steamships a much shorter passage.',subject:'Delta Canal',quote:'The Delta Canal connected two seas.',
      relation:'An identified canal view illustrates the named waterway responsible for the shorter passage, without inventing ports.'},
    {line:'Nora Finch became director of the North Observatory.',subject:'North Observatory',quote:'The North Observatory studied stars.',
      relation:'An identified view of North Observatory illustrates the institution Nora Finch directed.'},
    {line:'Show a portrait of Morgan Vale with his distinctive scar.',subject:'Morgan Vale',quote:'Show a portrait of Morgan Vale with his distinctive scar.',
      relation:'A portrait of Morgan Vale must show the narrated scar; a ship cannot illustrate this personal physical feature.',feature:'His distinctive scar'},
    {line:'Aurora carried thirty-two thousand square feet of canvas with all sails set.',subject:'Aurora',quote:'The clipper Aurora carried cargo.',
      relation:'An attributed view of Aurora with visible sailcloth or an identified sail-plan depicts the measured canvas.',feature:'Visible sailcloth or a sail-plan depiction'},
  ];
  const scenes=scenesOf(...cases.map(item=>item.line)),project=projectOf(scenes,context+'\n'+cases.map(item=>item.line).join('\n'));
  const before=structuredClone(project);
  const rows=cases.map((item,index)=>groundedEntry(scenes[index]!.id,item.subject,item.quote,{
    visualTarget:item.feature?item.subject+' — '+item.feature:item.subject,
    imageQueries:[item.subject+(item.feature?' '+item.feature:' photograph')],videoQueries:[],
    grounding:{version:1,mandatory:[{kind:'identity',required:item.subject,scriptQuote:item.quote},
      ...(item.feature?[{kind:'condition',required:item.feature,scriptQuote:item.line}]:[])],illustrations:[item.relation],optionalDetails:[]}}));
  const f=await fixture(t,async call=>JSON.stringify({scenes:call.data.requestedScenes.map(scene=>rows.find(row=>row.sceneId===scene.sceneId))}));
  const result=await f.planner().plan(project,scenes);
  assert.deepEqual(project,before,'Planning cannot rewrite accepted materials or narration');
  for(const [index,scene] of scenes.entries()){
    const requirement=result.get(scene.id)!,plan=requirement.aiSearchPlan!;
    assert.equal(requirement.identities![0]!.name,cases[index]!.subject);
    assert.deepEqual(plan.grounding!.illustrations,[cases[index]!.relation]);
    assert.equal(plan.grounding!.mandatory.some(item=>item.kind==='condition'),Boolean(cases[index]!.feature));
    assert.equal(documentaryAiPlanGroundingIssue(plan,project.videoBrief!.readyScript!),undefined);
  }
  const prompt=f.calls[0]!.system;
  assert.match(prompt,/Choose the representation before searching/);
  assert.match(prompt,/DEFAULT to that SAME object or institution/);
  assert.match(prompt,/Merely naming its owner or leader does not make a portrait mandatory/);
  assert.match(prompt,/appearance, personal physical feature or explicitly requested depiction/);
  assert.match(prompt,/generic beneficiary alone does not explain a specific geographic or technical difference/);
  assert.match(prompt,/Never invent ports or borrow unrelated journey details/);
  assert.match(prompt,/mandatory as a separate condition alongside identity/);
  assert.doesNotMatch(prompt,/relationship can be illustrated by one element/);
});

test('editing slices 19 and 20 receive the same exact source paragraph and preserve the complete causal sentence',async t=>{
  const first='The Suez Canal had opened,',second='giving steamships a much shorter passage to the Indian Ocean.';
  const passage=first+'\r\n'+second+'\r\nSailing ships still faced another route.';
  const script='An earlier episode about an unrelated voyage.\r\n\r\n'+passage+'\r\n \r\nA later episode has other ports.';
  const scenes=scenesOf(first,'  '+second+'\r\n'),project=projectOf(scenes,script),before=structuredClone(project);
  const f=await fixture(t);
  await f.planner().plan(project,scenes);
  assert.deepEqual(f.calls[0]!.data.requestedScenes,scenes.map(scene=>({sceneId:scene.id,narration:scene.narration,sourcePassage:passage})));
  assert.equal(f.calls[0]!.data.originalScript,project.videoBrief!.readyScript);
  assert.deepEqual(f.calls[0]!.data.contextScenes,scenes.map(scene=>({sceneId:scene.id,narration:scene.narration})));
  assert.deepEqual(project,before);
  assert.match(f.calls[0]!.system,/COMPLETE original sentence/);
  assert.match(f.calls[0]!.system,/sentence fragment does not establish a new subject/);
});

for(const sample of [
  {name:'repeated fragment',line:'The voyage began.',script:'The voyage began. In the north.\n\nThe voyage began. In the south.',expected:undefined},
  {name:'absent fragment',line:'The absent voyage began.',script:'The recorded voyage ended.',expected:undefined},
  {name:'single paragraph',line:'The canal shortened the passage.',script:'Before. The canal shortened the passage. After.',expected:'whole'},
  {name:'unchanged line breaks',line:'The canal opened.\nIt shortened the passage.',script:'The canal opened.\r\nIt shortened the passage.',expected:undefined},
  {name:'cross-paragraph narration',line:'The canal opened.\n\nIt shortened the passage.',script:'The canal opened.\n\nIt shortened the passage.',expected:undefined},
] as const)test(`source passage never invents or borrows context for ${sample.name}`,async t=>{
  const scenes=scenesOf(sample.line),project=projectOf(scenes,sample.script),f=await fixture(t);
  await f.planner().plan(project,scenes);
  const input=f.calls[0]!.data,row=input.requestedScenes[0]!;
  assert.equal(row.sourcePassage,sample.expected==='whole'?input.originalScript:undefined);
  assert.equal(Object.hasOwn(row,'sourcePassage'),sample.expected==='whole');
  assert.equal(input.originalScript,project.videoBrief!.readyScript);
  assert.equal(row.narration,sample.line);
});

for(const status of ['pending','uncertain'] as const)test(`revision 14 keeps an unresolved revision 12 ${status} receipt despite the new source passage`,async t=>{
  const f=await fixture(t,async()=>{throw new AnyModelCompletionUncertainError('Unknown paid response','{"scenes":[','connection');});
  const scenes=scenesOf('The canal opened.'),project=projectOf(scenes);
  await assert.rejects(f.planner().plan(project,scenes));
  const files=await f.cacheFiles();assert.equal(files.length,1);
  const file=path.join(f.root,'documentary-ai-query-plans',files[0]!),cache=JSON.parse(await readFile(file,'utf8'));
  const receipt=cache.attempts[0];receipt.status=status;receipt.request.promptRevision=12;receipt.request.system='Saved revision 12 primary planner instruction';
  const input=JSON.parse(receipt.request.payload);for(const row of input.requestedScenes)delete row.sourcePassage;
  receipt.request.payload=JSON.stringify(input);
  await writeFile(file,JSON.stringify(cache));const bytes=await readFile(file,'utf8');
  assert.equal((await f.planner().readCached(project,scenes)).size,0);
  await assert.rejects(f.planner().plan(project,scenes,{refreshSceneIds:new Set([scenes[0]!.id])}),/не подтверждён|неопределён/);
  assert.equal(f.calls.length,1,'A new prompt and passage cannot duplicate an unresolved paid request');
  assert.deepEqual(await f.cacheFiles(),files,'Prompt revision does not move the paid cache');
  assert.equal(await readFile(file,'utf8'),bytes,'The original unknown receipt stays intact');
});

test('current paid output with invented quotes, invented aliases, missing grounding or unsupported mandatory era stops within the existing repair budget',async t=>{
  for(const variant of ['quote','alias','generic-alias','missing','era'] as const){
    const quote='Marie Curie left teaching to continue research on a ship.';
    const row=groundedEntry('scene-0','Marie Curie',quote) as ReturnType<typeof entry>;
    if(variant==='quote')row.grounding.mandatory[0]!.scriptQuote='She must be shown teaching at a blackboard.';
    if(variant==='alias')Object.assign(row.grounding.mandatory[0]!,{aliases:['Mary Someone Else']});
    if(variant==='generic-alias')Object.assign(row.grounding.mandatory[0]!,{aliases:['ship']});
    if(variant==='missing')delete (row as {grounding?:unknown}).grounding;
    if(variant==='era')row.years=['1903'];
    const scenes=scenesOf(quote),project=projectOf(scenes);project.videoBrief!.readyScript=quote;
    const f=await fixture(t,async()=>JSON.stringify({scenes:[row]}));
    await assert.rejects(f.planner().plan(project,scenes),/исчерпаны/);
    assert.equal(f.calls.length,2,variant);
    assert.equal((await f.planner().readCached(project,scenes)).size,0);
    await assert.rejects(f.planner().plan(project,scenes),/исчерпаны/);
    assert.equal(f.calls.length,2,variant+' cannot reset its paid budget on restart');
  }
});

test('legacy overstrict plan is explicitly refreshed in the same paid cache while pending scenes retain their protection',async t=>{
  const quote='After eight tea voyages, Cutty Sark left the trade for which she had been built.';
  const f=await fixture(t,async call=>JSON.stringify({scenes:call.data.requestedScenes.map(scene=>groundedEntry(scene.sceneId,'Cutty Sark',quote))}));
  const scenes=scenesOf(quote,quote),project=projectOf(scenes);project.videoBrief!.readyScript=quote;
  const initial=await f.planner().plan(project,scenes);
  for(const scene of scenes)scene.documentary={requirement:initial.get(scene.id)!,verified:false} as Scene['documentary'];
  const file=path.join(f.root,'documentary-ai-query-plans',(await f.cacheFiles())[0]!);
  const cache=JSON.parse(await readFile(file,'utf8'));
  cache.attempts[0].request.promptRevision=11;
  const raw=JSON.parse(cache.attempts[0].rawResponse);
  for(const row of raw.scenes){delete row.grounding;row.visualTarget='Cutty Sark tea cargo being loaded';}
  cache.attempts[0].rawResponse=JSON.stringify(raw);
  for(const scene of scenes){delete cache.plans[scene.id].grounding;cache.plans[scene.id].visualTarget='Cutty Sark tea cargo being loaded';
    scene.documentary!.requirement.aiSearchPlan=structuredClone(cache.plans[scene.id]);}
  cache.attempts.push({ids:[scenes[1]!.id],status:'uncertain',responseState:'partial'});
  await writeFile(file,JSON.stringify(cache));
  const before=structuredClone(project);
  assert.match(documentaryAiPlanGroundingIssue(scenes[0]!.documentary!.requirement.aiSearchPlan,quote)!,/обновление/);
  const refreshed=await f.planner().plan(project,scenes,{refreshSceneIds:new Set(scenes.map(scene=>scene.id))});
  assert.deepEqual(project,before);assert.equal(f.calls.length,2);
  assert.deepEqual(f.calls[1]!.data.requestedScenes.map(scene=>scene.sceneId),[scenes[0]!.id]);
  assert.equal(refreshed.get(scenes[0]!.id)!.aiSearchPlan!.visualTarget,'Cutty Sark');
  assert.equal(refreshed.get(scenes[1]!.id)!.aiSearchPlan!.grounding,undefined);
  const after=JSON.parse(await readFile(file,'utf8'));
  assert.deepEqual(after.attempts.slice(0,2),cache.attempts);assert.deepEqual(after.plans,cache.plans);
  assert.equal((await f.cacheFiles()).length,1,'Grounding refresh keeps the original receipt address');
});

test('portrait image queries and route geography keep usable paid plans without artificial identity or video requirements',async t=>{
  const quote='The new canal connected the Mediterranean with the Red Sea.';
  const scenes=scenesOf(quote),project=projectOf(scenes);project.videoBrief!.readyScript=quote;
  const row=groundedEntry(scenes[0]!.id,'Suez Canal',quote);
  Object.assign(row,{preferredKind:'video',imageQueries:['Suez Canal map'],videoQueries:[],years:[],
    grounding:{version:1,mandatory:[{kind:'geography',required:'Mediterranean and Red Sea',scriptQuote:quote,aliases:[]}],
      illustrations:['Route map'],optionalDetails:[]}});
  const f=await fixture(t,async()=>JSON.stringify({scenes:[row]}));
  const result=await f.planner().plan(project,scenes);
  assert.equal(result.get(scenes[0]!.id)!.preferredKind,'image');
  assert.equal(f.calls.length,1);
  assert.equal(documentaryAiPlanGroundingIssue(result.get(scenes[0]!.id)!.aiSearchPlan,quote),undefined);
});

test('a fully received malformed grounding refresh gets at most one repair while its old paid plan stays intact',async t=>{
 const quote='The owner sold the ship in 1895.';let replies=0;
 const f=await fixture(t,async call=>{replies++;const rows=call.data.requestedScenes.map(scene=>groundedEntry(scene.sceneId,'The ship',quote));
  if(replies>1)for(const row of rows)delete (row as {grounding?:unknown}).grounding;
  return JSON.stringify({scenes:rows});});
 const scenes=scenesOf(quote),project=projectOf(scenes);project.videoBrief!.readyScript=quote;
 const initial=await f.planner().plan(project,scenes),id=scenes[0]!.id;
 scenes[0]!.documentary={requirement:initial.get(id)!,verified:false} as Scene['documentary'];
 const file=path.join(f.root,'documentary-ai-query-plans',(await f.cacheFiles())[0]!);
 const cache=JSON.parse(await readFile(file,'utf8')),raw=JSON.parse(cache.attempts[0].rawResponse);
 delete raw.scenes[0].grounding;delete cache.plans[id].grounding;
 cache.attempts[0].request.promptRevision=10;cache.attempts[0].rawResponse=JSON.stringify(raw);
 scenes[0]!.documentary!.requirement.aiSearchPlan=structuredClone(cache.plans[id]);await writeFile(file,JSON.stringify(cache));
 for(let pass=0;pass<4;pass++)await f.planner().plan(project,scenes,{refreshSceneIds:new Set([id])});
 assert.equal(f.calls.length,3,'one initial receipt and at most two completed refresh attempts');
 const saved=JSON.parse(await readFile(file,'utf8'));assert.deepEqual(saved.plans,cache.plans);
 assert.deepEqual(saved.attempts[0],cache.attempts[0]);
});

test('a grounded older refresh cannot hide the current contextual illustration revision or cause repeated payment',async t=>{
 const quote='John Willis owned Cutty Sark.';
 const f=await fixture(t,async call=>JSON.stringify({scenes:call.data.requestedScenes.map(scene=>groundedEntry(scene.sceneId,
  f.calls.length===1?'John Willis':'Cutty Sark',quote,{visualTarget:f.calls.length===1?'John Willis at a desk':'Cutty Sark'}))}));
 const scenes=scenesOf(quote),project=projectOf(scenes);project.videoBrief!.readyScript=quote;
 const initial=await f.planner().plan(project,scenes),id=scenes[0]!.id;
 scenes[0]!.documentary={requirement:initial.get(id)!,verified:false} as Scene['documentary'];
 const file=path.join(f.root,'documentary-ai-query-plans',(await f.cacheFiles())[0]!);
 const cache=JSON.parse(await readFile(file,'utf8'));
 cache.attempts[0].request.promptRevision=10;
 const oldRefresh=structuredClone(cache.attempts[0]);oldRefresh.request.promptRevision=12;oldRefresh.refreshIds=[id];
 const raw=JSON.parse(oldRefresh.rawResponse);raw.scenes[0].visualTarget='John Willis portrait';oldRefresh.rawResponse=JSON.stringify(raw);
 cache.attempts.push(oldRefresh);
 scenes[0]!.documentary!.requirement.aiSearchPlan!.visualTarget='John Willis portrait';
 await writeFile(file,JSON.stringify(cache));
 const options={refreshSceneIds:new Set([id])};
 const result=await f.planner().plan(project,scenes,options);
 assert.equal(result.get(id)!.aiSearchPlan!.visualTarget,'Cutty Sark');assert.equal(f.calls.length,2);
 scenes[0]!.documentary!.requirement=result.get(id)!;
 assert.deepEqual(await f.planner().plan(project,scenes,options),result);
 assert.equal(f.calls.length,2,'A complete current-revision refresh must be reused');
 assert.deepEqual(JSON.parse(await readFile(file,'utf8')).attempts.slice(0,2),cache.attempts,'Original paid replies are retained');
});

test('an already staged legacy refresh cannot hide the new grounding revision',async t=>{
  const quote='After eight tea voyages, Cutty Sark left the trade for which she had been built.';
  const f=await fixture(t,async call=>JSON.stringify({scenes:call.data.requestedScenes.map(scene=>groundedEntry(scene.sceneId,'Cutty Sark',quote))}));
  const scenes=scenesOf(quote),project=projectOf(scenes);project.videoBrief!.readyScript=quote;
  const initial=await f.planner().plan(project,scenes);
  scenes[0]!.documentary={requirement:initial.get(scenes[0]!.id)!,verified:false} as Scene['documentary'];
  const file=path.join(f.root,'documentary-ai-query-plans',(await f.cacheFiles())[0]!);
  const cache=JSON.parse(await readFile(file,'utf8')),id=scenes[0]!.id;
  const raw=JSON.parse(cache.attempts[0].rawResponse);delete raw.scenes[0].grounding;
  raw.scenes[0].visualTarget='Cutty Sark tea loading';
  cache.attempts[0].request.promptRevision=9;cache.attempts[0].rawResponse=JSON.stringify(raw);
  delete cache.plans[id].grounding;cache.plans[id].visualTarget=raw.scenes[0].visualTarget;
  scenes[0]!.documentary!.requirement.aiSearchPlan=structuredClone(cache.plans[id]);
  const oldRefresh=structuredClone(cache.attempts[0]);oldRefresh.request.promptRevision=10;oldRefresh.refreshIds=[id];
  raw.scenes[0].visualTarget='Cutty Sark loading tea at a dock';oldRefresh.rawResponse=JSON.stringify(raw);
  cache.attempts.push(oldRefresh);await writeFile(file,JSON.stringify(cache));
  const result=await f.planner().plan(project,scenes,{refreshSceneIds:new Set([id])});
  assert.equal(f.calls.length,2);assert.equal(result.get(id)!.aiSearchPlan!.visualTarget,'Cutty Sark');
  assert.equal(documentaryAiPlanGroundingIssue(result.get(id)!.aiSearchPlan,quote),undefined);
  assert.deepEqual(JSON.parse(await readFile(file,'utf8')).attempts.slice(0,2),cache.attempts);
});

async function fixture(t: { after: (fn: () => Promise<void>) => void },
  handler: (call: Call, partial?: (text: string) => void) => Promise<string> = async call =>
    response(call.data.requestedScenes.map(scene => scene.sceneId))) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gws-query-plan-'));
  const absoluteRoot = path.resolve(root), tempRoot = path.resolve(os.tmpdir());
  assert.ok(absoluteRoot.startsWith(tempRoot + path.sep) && path.basename(absoluteRoot).startsWith('gws-query-plan-'));
  t.after(async () => { await rm(absoluteRoot, { recursive: true, force: true }); });
  const calls: Call[] = [];
  const state = { model: MODEL };
  const client = { documentaryQueryModel: async () => state.model,
    documentaryCompletion: async (system: string, text: string, images: string[], _signal: AbortSignal | undefined,
      partial: ((text: string) => void) | undefined, model: string | undefined) => {
      const call: Call = { system, data: JSON.parse(text), images, model };
      calls.push(call);
      return handler(call, partial);
    } } as unknown as AnyModelClient;
  const planner = () => new DocumentaryAiQueryPlanner(client, () => root);
  const cacheFiles = async () => (await readdir(path.join(root, 'documentary-ai-query-plans'))).filter(file => file.endsWith('.json'));
  return { root, calls, state, planner, cacheFiles };
}

test('text model selection is independent from Sonnet vision selection and does not write settings', async () => {
  let reads = 0;
  const client = new AnyModelClient({ publicSettings: async () => {
    reads++;
    return { configured: true, baseUrl: 'https://anymodel.org', textModel: MODEL };
  } } as never);
  assert.equal(await client.documentaryQueryModel(), MODEL);
  assert.equal(await client.documentaryAnalysisModel('fast'), 'ag/gemini-3.8-flash-high');
  assert.equal(reads, 2);
});

test('every batch includes complete source, unchanged ids and context; no mutation or fallback mixing', async t => {
  const f = await fixture(t);
  const scenes = scenesOf(...Array.from({ length: 19 }, (_, index) => `Exact original narration ${index}.`));
  scenes[0]!.documentary = { requirement: { caption: 'Manual caption', text: 'old', entities: [], years: [], queries: [] } } as unknown as Scene['documentary'];
  const project = projectOf(scenes, `Original source paragraph excluded from scene text.\n${scenes.map(s => s.narration).join('\n')}`);
  const snapshot = structuredClone(project);
  const plans = await f.planner().plan(project, scenes);
  assert.equal(plans.size, 19);
  assert.equal(f.calls.length, 5);
  for (const call of f.calls) {
    assert.equal(call.data.originalScript, project.videoBrief!.readyScript);
    assert.deepEqual(call.data.contextScenes, scenes.map(scene => ({ sceneId: scene.id, narration: scene.narration })));
    assert.equal(call.model, MODEL);
    assert.deepEqual(call.images, []);
    assert.match(call.system, /THEMATIC B-ROLL/);
  }
  assert.deepEqual(project, snapshot);
  const first = plans.get(scenes[0]!.id)!;
  assert.equal(first.caption, 'Manual caption');
  assert.equal(first.text, scenes[0]!.narration);
  assert.equal(first.aiSearchPlan!.model, MODEL);
  assert.equal(first.aiSearchPlan!.version, 1);
  assert.equal(first.aiSearchPlan!.inputHash.length, 64);
  assert.ok(first.queries.every(query => !query.includes('ocean liner')));
  await f.planner().plan(project, scenes);
  assert.equal(f.calls.length, 5, 'new planner instance reuses persistent cache');
  const cache = JSON.parse(await readFile(path.join(f.root, 'documentary-ai-query-plans', (await f.cacheFiles())[0]!), 'utf8'));
  assert.equal(cache.attempts[0].responseState, 'complete');
  assert.equal(cache.attempts[0].rawResponse, response(scenes.slice(0, 4).map(scene => scene.id)));
  assert.deepEqual(JSON.parse(cache.attempts[0].request.payload), f.calls[0]!.data);
  assert.equal(cache.attempts[0].request.system, f.calls[0]!.system);
});

test('two disjoint planning batches overlap and both paid markers are durable before responses',async t=>{
  let arrived=0,release!:()=>void;
  const both=new Promise<void>(resolve=>{release=resolve;});
  const deadline=setTimeout(release,2000);t.after(async()=>{clearTimeout(deadline);});
  const f=await fixture(t,async call=>{
    if(++arrived===2)release();
    await both;
    assert.equal(arrived,2,'The second batch must start while the first is waiting');
    return response(call.data.requestedScenes.map(scene=>scene.sceneId));
  });
  const scenes=scenesOf(...Array.from({length:8},(_,i)=>`Ship scene ${i}.`));
  const plans=await f.planner().plan(projectOf(scenes),scenes);
  assert.equal(plans.size,8);assert.equal(f.calls.length,2);
  assert.equal(new Set(f.calls.flatMap(call=>call.data.requestedScenes.map(scene=>scene.sceneId))).size,8);
  const cache=JSON.parse(await readFile(path.join(f.root,'documentary-ai-query-plans',(await f.cacheFiles())[0]!),'utf8'));
  assert.equal(cache.attempts.length,2);assert.ok(cache.attempts.every((attempt:{status:string})=>attempt.status==='complete'));
  await f.planner().plan(projectOf(scenes),scenes);assert.equal(f.calls.length,2);
});

test('one closed empty response gets one successor while the other completed batch is preserved',async t=>{
  let empty=true;
  const f=await fixture(t,async call=>{
    if(call.data.requestedScenes[0]!.sceneId==='scene-0'&&empty){empty=false;throw new AnyModelCompletionUncertainError('Closed empty response','','connection',true);}
    return response(call.data.requestedScenes.map(scene=>scene.sceneId));
  });
  const scenes=scenesOf(...Array.from({length:16},(_,i)=>`Ship scene ${i}.`)),project=projectOf(scenes);
  assert.equal((await f.planner().plan(project,scenes)).size,16);
  assert.equal(f.calls.length,5);assert.equal(f.calls.filter(call=>call.data.requestedScenes[0]!.sceneId==='scene-4').length,1);
  const cache=JSON.parse(await readFile(path.join(f.root,'documentary-ai-query-plans',(await f.cacheFiles())[0]!),'utf8'));
  assert.equal(cache.attempts[0].status,'uncertain');assert.equal(cache.attempts[0].emptyResponse,true);
  await f.planner().plan(project,scenes);assert.equal(f.calls.length,5);
});

test('repeated closed empty responses stop after one retry and a restart does not reset that limit',async t=>{
  const f=await fixture(t,async()=>{throw new AnyModelCompletionUncertainError('Closed empty response','','connection',true);});
  const scenes=scenesOf('A ship crosses the ocean.'),project=projectOf(scenes);
  await assert.rejects(f.planner().plan(project,scenes));assert.equal(f.calls.length,2);
  await assert.rejects(f.planner().plan(project,scenes));assert.equal(f.calls.length,2);
  const [issue]=await f.planner().readIssues(project,scenes);assert.ok(issue?.retryToken);
  await assert.rejects(f.planner().plan(project,scenes,{retryToken:issue.retryToken}));
  assert.equal(f.calls.length,3,'One explicit click authorizes one additional completion');
  await assert.rejects(f.planner().plan(project,scenes));assert.equal(f.calls.length,3);
});

test('scene-owned plans survive model, title and distant edits; changed local narration requires planning',async t=>{
  const f=await fixture(t),scenes=scenesOf('First.','Second.','Third.','Fourth.','Fifth.'),project=projectOf(scenes);
  const planned=await f.planner().plan(project,scenes);
  for(const scene of scenes)scene.documentary={requirement:planned.get(scene.id)!} as Scene['documentary'];
  const original=scenes[0]!.documentary!.requirement.aiSearchPlan!.inputHash;
  f.state.model='fixture/replacement-model';project.title='Edited title';scenes[4]!.narration='Distant edited ending.';
  project.videoBrief!.readyScript+=' Distant edited ending.';
  const reused=await f.planner().plan(project,[scenes[0]!]);
  assert.equal(f.calls.length,2,'Two original four-scene batches only');
  assert.equal(reused.get(scenes[0]!.id)!.aiSearchPlan!.inputHash,original,'Paid receipt identity is unchanged');
  assert.ok(currentDocumentaryAiSearchPlan(project,scenes[0]!));
  assert.deepEqual(await f.planner().readIssues(project,[scenes[0]!]),[]);
  scenes[0]!.narration+=' New local detail.';
  assert.equal(currentDocumentaryAiSearchPlan(project,scenes[0]!),undefined);
  await f.planner().plan(project,[scenes[0]!]);assert.equal(f.calls.length,3);
});

test('legacy scene plan migrates from the exact paid request after unrelated context changes without rewriting it',async t=>{
  const f=await fixture(t),scenes=scenesOf('First.','Second.','Third.','Fourth.'),project=projectOf(scenes);
  const planned=await f.planner().plan(project,scenes),scene=scenes[0]!;
  scene.documentary={requirement:planned.get(scene.id)!} as Scene['documentary'];
  delete scene.documentary!.requirement.aiSearchPlan!.sceneInputHash;
  const file=path.join(f.root,'documentary-ai-query-plans',(await f.cacheFiles())[0]!),before=await readFile(file,'utf8');
  project.title='New title';f.state.model='fixture/new-model';scenes[3]!.narration='Changed faraway ending.';
  const cached=await f.planner().readCached(project,[scene]);
  assert.ok(cached.get(scene.id)?.aiSearchPlan?.sceneInputHash);
  scene.documentary!.requirement=cached.get(scene.id)!;
  await f.planner().plan(project,[scene]);assert.equal(f.calls.length,1);
  assert.equal(await readFile(file,'utf8'),before,'Do not rewrite the old receipt during migration');
});

test('an unknown prior plan cannot be resubmitted through a model/title/distant-script cache change',async t=>{
  const f=await fixture(t,async()=>{throw Error('Connection lost');});
  const scenes=scenesOf('First.','Second.','Third.'),project=projectOf(scenes);
  await assert.rejects(f.planner().plan(project,[scenes[0]!]));
  project.title='New title';f.state.model='fixture/new-model';scenes[2]!.narration='New ending.';
  await assert.rejects(f.planner().plan(project,[scenes[0]!]),/неизвестный результат/);
  assert.equal(f.calls.length,1);
  const issues=await f.planner().readIssues(project,[scenes[0]!]);
  assert.match(issues[0]?.reason??'',/неизвестный результат/);
  assert.equal(issues[0]?.canContinue,undefined);
});

test('Stop drains sent planning responses and prevents the next batch',async t=>{
  const controller=new AbortController();
  let release!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;});
  const f=await fixture(t,async call=>{controller.abort();await pending;return response(call.data.requestedScenes.map(scene=>scene.sceneId));});
  const scenes=scenesOf(...Array.from({length:12},(_,index)=>`Scene ${index}.`)),project=projectOf(scenes);
  const job=f.planner().plan(project,scenes,{signal:controller.signal});
  const outcome=assert.rejects(job,/abort/i);
  await new Promise(resolve=>setTimeout(resolve,25));release();await outcome;
  assert.ok(f.calls.length<=2);
  const cached=await f.planner().readCached(project,scenes);
  assert.equal(cached.size,f.calls.length*4,'Every already sent response was saved');
});

test('planner returns generic object class, excluded classes and uncertain availability in the existing response',async t=>{
  const f=await fixture(t,async call=>JSON.stringify({scenes:call.data.requestedScenes.map(scene=>entry(scene.sceneId,{
    objectClass:'ocean liner',excludedClasses:['aircraft','person portrait'],
    availability:{status:'limited',note:'Historical state may need archival art.',representations:['archival drawing']}
  }))}));
  const scenes=scenesOf('A liner.'),planned=await f.planner().plan(projectOf(scenes),scenes);
  const plan=planned.get(scenes[0]!.id)!.aiSearchPlan!;
  assert.equal(plan.objectClass,'ocean liner');assert.deepEqual(plan.excludedClasses,['aircraft','person portrait']);
  assert.equal(plan.availability?.status,'limited');assert.equal(f.calls.length,1);
  assert.match(f.calls[0]!.system,/search hypotheses/);
});

test('context-only scenes are included and a subset reuses the same scene cache', async t => {
  const f = await fixture(t);
  const scenes = scenesOf('Marie Curie studied radium.', 'She worked in Paris.');
  const project = projectOf(scenes);
  await f.planner().plan(project, scenes);
  const subset = await f.planner().plan(project, [scenes[1]!]);
  assert.equal(f.calls.length, 1);
  assert.equal(subset.get(scenes[1]!.id)!.text, scenes[1]!.narration);
});

test('script, surrounding narration, ids, and model invalidate cache; unrelated montage does not', async t => {
  const f = await fixture(t);
  const scenes = scenesOf('A bridge crosses the river.', 'It opened in 1932.');
  const project = projectOf(scenes);
  await f.planner().plan(project, scenes);
  scenes[0]!.kenBurnsDirection = 'out';
  await f.planner().plan(project, scenes);
  assert.equal(f.calls.length, 1);
  project.videoBrief!.readyScript += ' Extra source context.';
  await f.planner().plan(project, scenes);
  scenes[0]!.narration += ' Cars cross it.';
  await f.planner().plan(project, scenes);
  scenes[0]!.id = 'renamed-scene';
  await f.planner().plan(project, scenes);
  f.state.model = 'fixture/another-text-model';
  await f.planner().plan(project, scenes);
  assert.equal(f.calls.length, 5);
  assert.equal((await f.cacheFiles()).length, 5);
});

test('truncated JSON preserves complete entries and repairs only the missing scene once', async t => {
  const f = await fixture(t, async call => call.data.requestedScenes.length === 2
    ? `{"scenes":[${JSON.stringify(entry('scene-0'))},{"sceneId":"scene-1","subject":"unfinished`
    : response(call.data.requestedScenes.map(scene => scene.sceneId)));
  const scenes = scenesOf('The liner sailed.', 'Its propellers turned.');
  const plans = await f.planner().plan(projectOf(scenes), scenes);
  assert.equal(plans.size, 2);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls[1]!.data.requestedScenes.map(scene => scene.sceneId), ['scene-1']);
});

test('invalid or duplicate entries never pass; repair budget persists across repeated runs', async t => {
  for (const malformed of [
    'not JSON',
    JSON.stringify({ scenes: [entry('unknown-id')] }),
    JSON.stringify({ scenes: [entry('scene-0'), entry('scene-0')] }),
    JSON.stringify({ scenes: [entry('scene-0', { imageQueries: ['x'.repeat(241)] })] }),
    JSON.stringify({ scenes: [entry('scene-0', { imageQueries: ['first camera view', 'second camera view', 123] })] }),
    JSON.stringify({ scenes: [entry('scene-0', { imageQueries: Array.from({ length: 5 }, (_, index) => `camera view ${index}`) })] }),
    JSON.stringify({ scenes: [entry('scene-0', { years: ['unknown era'] })] }),
    JSON.stringify({ scenes: [entry('scene-0', { years: ['1875s'] })] }),
    JSON.stringify({ scenes: [entry('scene-0', { preferredKind: 'animation' })] }),
    JSON.stringify({ scenes: [entry('scene-0', { fallbackVisualTarget: '' })] }),
  ]) {
    const f = await fixture(t, async () => malformed);
    const scenes = scenesOf('A liner sailed.');
    await assert.rejects(f.planner().plan(projectOf(scenes), scenes), /исчерпаны/);
    await assert.rejects(f.planner().plan(projectOf(scenes), scenes), /исчерпаны/);
    assert.equal(f.calls.length, 2);
    const cache = JSON.parse(await readFile(path.join(f.root, 'documentary-ai-query-plans', (await f.cacheFiles())[0]!), 'utf8'));
    assert.ok(cache.attempts.every((attempt: { rawResponse: string; responseState: string }) =>
      attempt.rawResponse === malformed && attempt.responseState === 'complete'));
  }
});

test('streaming completion truncation error recovers already received entries', async t => {
  let first = true;
  const f = await fixture(t, async (call, partial) => {
    if (first) {
      first = false;
      partial?.(`{"scenes":[${JSON.stringify(entry('scene-0'))},`);
      throw new AnyModelOutputFormatError('finish_reason:length', true);
    }
    return response(call.data.requestedScenes.map(scene => scene.sceneId));
  });
  const scenes = scenesOf('The ship departed.', 'It crossed the ocean.');
  assert.equal((await f.planner().plan(projectOf(scenes), scenes)).size, 2);
  assert.deepEqual(f.calls[1]!.data.requestedScenes.map(scene => scene.sceneId), ['scene-1']);
});

test('uncertain paid call is not resubmitted; complete streamed scenes remain reusable', async t => {
  const f = await fixture(t, async (_call, partial) => {
    const text = `{"scenes":[${JSON.stringify(entry('scene-0'))},`;
    partial?.(text);
    throw new AnyModelCompletionUncertainError('Connection lost', text);
  });
  const scenes = scenesOf('The ship departed.', 'It crossed the ocean.');
  const project = projectOf(scenes);
  await assert.rejects(f.planner().plan(project, scenes), /автоматически не повторяется/);
  await assert.rejects(f.planner().plan(project, scenes), /автоматического платного повтора нет/);
  assert.equal(f.calls.length, 1);
  const ready = await f.planner().plan(project, [scenes[0]!]);
  assert.equal(ready.size, 1);
  assert.equal(f.calls.length, 1);
  const cache = JSON.parse(await readFile(path.join(f.root, 'documentary-ai-query-plans', (await f.cacheFiles())[0]!), 'utf8'));
  assert.equal(cache.attempts[0].status, 'uncertain');
  assert.equal(cache.attempts[0].responseState, 'partial');
  assert.equal(cache.attempts[0].rawResponse, `{"scenes":[${JSON.stringify(entry('scene-0'))},`);
  assert.equal(cache.attempts[0].errorName, 'AnyModelCompletionUncertainError');
  assert.ok(cache.plans['scene-0']);
});

test('a pending checkpoint after process interruption blocks duplicate payment', async t => {
  const f = await fixture(t);
  const scenes = scenesOf('A liner at sea.');
  const project = projectOf(scenes);
  await f.planner().plan(project, scenes);
  const file = path.join(f.root, 'documentary-ai-query-plans', (await f.cacheFiles())[0]!);
  const cache = JSON.parse(await readFile(file, 'utf8'));
  cache.plans = {};
  cache.attempts[0].status = 'pending';
  await writeFile(file, JSON.stringify(cache));
  await assert.rejects(f.planner().plan(project, scenes), /автоматического платного повтора нет/);
  assert.equal(f.calls.length, 1);
});

test('concurrent planner instances serialize one project and use a single completion', async t => {
  const f = await fixture(t, async call => {
    await new Promise(resolve => setTimeout(resolve, 15));
    return response(call.data.requestedScenes.map(scene => scene.sceneId));
  });
  const scenes = scenesOf('The ship sailed.');
  const project = projectOf(scenes);
  const results = await Promise.all([f.planner().plan(project, scenes), f.planner().plan(project, scenes)]);
  assert.equal(results[0].size, 1);
  assert.equal(results[1].size, 1);
  assert.equal(f.calls.length, 1);
});

test('corrupt cache fails closed and never silently buys a replacement', async t => {
  const f = await fixture(t);
  const scenes = scenesOf('A bridge spans the river.');
  const project = projectOf(scenes);
  await f.planner().plan(project, scenes);
  await writeFile(path.join(f.root, 'documentary-ai-query-plans', (await f.cacheFiles())[0]!), '{broken');
  assert.equal((await f.planner().readCached(project, scenes)).size, 0);
  await assert.rejects(f.planner().plan(project, scenes), /платный вызов не повторён/);
  assert.equal(f.calls.length, 1);
});

test('retained project plan survives a missing sidecar and preserves full long names', async t => {
  const longName = 'International Research Centre for the Study of the Preservation and Restoration of Cultural Property and the Documentation of Historic Monuments and Sites of Universal Significance';
  const f = await fixture(t, async call => JSON.stringify({ scenes: call.data.requestedScenes.map(scene => entry(scene.sceneId,
    { subject: longName, imageQueries: [`${longName} Rome archives`], fallbackVideoQueries: [], fallbackVisualTarget: '' })) }));
  const scenes = scenesOf('The centre preserves cultural heritage.');
  const project = projectOf(scenes);
  const plans = await f.planner().plan(project, scenes);
  scenes[0]!.documentary = { requirement: plans.get(scenes[0]!.id) } as Scene['documentary'];
  await rm(path.join(f.root, 'documentary-ai-query-plans'), { recursive: true });
  assert.equal((await f.planner().readCached(project, scenes)).size, 1);
  const reused = await f.planner().plan(project, scenes);
  assert.equal(reused.get(scenes[0]!.id)!.aiSearchPlan!.imageQueries[0], `${longName} Rome archives`);
  assert.equal(f.calls.length, 1);
});

test('empty, aborted or invalid scene input never submits a completion', async t => {
  const f = await fixture(t);
  assert.equal((await f.planner().plan(projectOf([]), [])).size, 0);
  const scenes = scenesOf('A train runs.');
  await assert.rejects(f.planner().plan(projectOf(scenes), scenes, { signal: AbortSignal.abort() }));
  await assert.rejects(f.planner().plan(projectOf(scenes), [scenes[0]!, scenes[0]!]), /уникальными/);
  assert.equal(f.calls.length, 0);
});

function localTransportClient(transport: (body: Record<string, unknown>) => Response): AnyModelClient {
  return new AnyModelClient({
    publicSettings: async () => ({ configured: true, baseUrl: 'https://fixture.test/v1', textModel: MODEL }),
    apiKey: async () => 'offline-fixture',
  } as never, async (_url, init) => {
    assert.equal(init?.method, 'POST');
    return transport(JSON.parse(String(init.body)));
  });
}
const delta = (content: string, finishReason: string | null = null): string =>
  `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: finishReason }] })}\n\n`;
const sse = (body: string): Response => new Response(body, { headers: { 'content-type': 'text/event-stream' } });

test('proxy handshake failures are persisted as not sent, with one attempt per run and safe continuation after restart', async t => {
  const f = await fixture(t), scenes = scenesOf('The ship departed.'), project = projectOf(scenes);
  let calls = 0, recovered = false;
  const client = localTransportClient(() => {
    calls++;
    if (!recovered) throw new ProxyConnectError(new Error('SOCKS5: прокси закрыл соединение во время согласования'));
    return sse(delta(response(['scene-0'])) + 'data: [DONE]\n\n');
  });
  const planner = () => new DocumentaryAiQueryPlanner(client, () => f.root);
  for (let run = 1; run <= 3; run++) {
    await assert.rejects(planner().plan(project, scenes), /не отправлен.*соединение с прокси/);
    assert.equal(calls, run, 'A network failure must not spin or consume the paid malformed-response budget');
    const [issue] = await planner().readIssues(project, scenes);
    assert.equal(issue?.canContinue, true); assert.equal(issue?.retryToken, undefined);
    assert.doesNotMatch(issue!.reason, /не подтверждён|результат неизвестен/);
  }
  const cache = JSON.parse(await readFile(path.join(f.root, 'documentary-ai-query-plans', (await f.cacheFiles())[0]!), 'utf8'));
  assert.equal(cache.attempts.length, 3);
  assert.ok(cache.attempts.every((attempt: Record<string, unknown>) => attempt.status === 'not-sent'
    && attempt.errorName === 'ProxyConnectError' && attempt.responseState === undefined && attempt.rawResponse === undefined));
  recovered = true;
  assert.equal((await planner().plan(project, scenes)).size, 1); assert.equal(calls, 4);
  await planner().plan(project, scenes); assert.equal(calls, 4, 'Completed response is reused after recovery');
});

test('a real local SOCKS greeting refusal reaches the planner as not-sent before destination HTTP', async t => {
  const f = await fixture(t), scenes = scenesOf('The ship departed.'), project = projectOf(scenes);
  let connections = 0;
  const greeting: number[][] = [];
  const server = createServer(socket => {
    connections++;
    socket.once('data', bytes => { greeting.push([...bytes]); socket.end(); });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const client = new AnyModelClient({
    publicSettings: async () => ({ configured: true, baseUrl: 'https://fixture.invalid/v1', textModel: MODEL }),
    apiKey: async () => 'offline-fixture', proxyUrl: async () => `socks5://127.0.0.1:${address.port}`,
  } as never);
  const planner = new DocumentaryAiQueryPlanner(client, () => f.root);
  await assert.rejects(planner.plan(project, scenes), /не отправлен.*соединение с прокси/);
  assert.equal(connections, 1); assert.equal(greeting[0]?.[0], 5, 'Only SOCKS negotiation reached the local proxy');
  assert.equal((await planner.readIssues(project, scenes))[0]?.canContinue, true);
});

test('an accepted HTTP response disconnect with zero generated characters remains uncertain after restart', async t => {
  const f = await fixture(t), scenes = scenesOf('The ship departed.'), project = projectOf(scenes);
  let calls = 0;
  const client = localTransportClient(() => {
    calls++;
    return new Response(new ReadableStream({ start(controller) { controller.error(new Error('connection lost after HTTP 200')); } }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } });
  });
  const planner = () => new DocumentaryAiQueryPlanner(client, () => f.root);
  await assert.rejects(planner().plan(project, scenes), /не подтверждён/);
  await assert.rejects(planner().plan(project, scenes), /автоматического платного повтора нет/);
  assert.equal(calls, 1);
  const [issue] = await planner().readIssues(project, scenes);
  assert.equal(issue?.canContinue, undefined); assert.equal(issue?.retryKind,'unknown');assert.ok(issue?.retryToken);
});

test('wrapped redirect failures and a spoofed proxy error name never authorize query resubmission', async t => {
  for (const error of [new Error('redirect tunnel failed', { cause: new ProxyConnectError(new Error('proxy closed')) }),
    Object.assign(new Error('SOCKS5: прокси закрыл соединение во время согласования'), { name: 'ProxyConnectError' })]) {
    const f = await fixture(t), scenes = scenesOf('The ship departed.'), project = projectOf(scenes);
    let calls = 0;
    const client = localTransportClient(() => { calls++; throw error; });
    const planner = () => new DocumentaryAiQueryPlanner(client, () => f.root);
    await assert.rejects(planner().plan(project, scenes), /не подтверждён/);
    await assert.rejects(planner().plan(project, scenes), /автоматического платного повтора нет/);
    assert.equal(calls, 1);
  }
});

test('a not-sent receipt containing partial response evidence remains protected as uncertain', async t => {
  const f = await fixture(t), scenes = scenesOf('The ship departed.'), project = projectOf(scenes);
  let calls = 0;
  const client = localTransportClient(() => { calls++; throw new ProxyConnectError(new Error('proxy closed')); });
  const planner = () => new DocumentaryAiQueryPlanner(client, () => f.root);
  await assert.rejects(planner().plan(project, scenes), /не отправлен/);
  const file = path.join(f.root, 'documentary-ai-query-plans', (await f.cacheFiles())[0]!);
  const cache = JSON.parse(await readFile(file, 'utf8'));
  cache.attempts[0].responseState = 'partial'; cache.attempts[0].rawResponse = '{';
  await writeFile(file, JSON.stringify(cache));
  await assert.rejects(planner().plan(project, scenes), /автоматического платного повтора нет/);
  assert.equal(calls, 1);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).attempts[0].status, 'uncertain');
});

test('malformed SSE is uncertain with or without terminal events: one POST and no paid replay after restart', async t => {
  for (const terminal of ['', delta('', 'stop'), 'data: [DONE]\n\n']) {
    const f = await fixture(t);
    const scenes = scenesOf('The ship departed.', 'It crossed the ocean.');
    const project = projectOf(scenes);
    const raw = `{"scenes":[${JSON.stringify(entry('scene-0'))},{"sceneId":"scene-1"`;
    let posts = 0;
    const client = localTransportClient(body => {
      posts++;
      assert.equal(body.model, MODEL);
      return sse(delta(raw) + 'data: {BROKEN\n\n' + terminal);
    });
    const planner = () => new DocumentaryAiQueryPlanner(client, () => f.root);
    await assert.rejects(planner().plan(project, scenes), /автоматически не повторяется/);
    assert.equal(posts, 1);
    const cache = JSON.parse(await readFile(path.join(f.root, 'documentary-ai-query-plans', (await f.cacheFiles())[0]!), 'utf8'));
    assert.equal(cache.attempts.length, 1);
    assert.equal(cache.attempts[0].status, 'uncertain');
    assert.equal(cache.attempts[0].responseState, 'partial');
    assert.equal(cache.attempts[0].errorName, 'AnyModelCompletionUncertainError');
    assert.equal(cache.attempts[0].rawResponse, raw);
    assert.ok(cache.plans['scene-0']);
    await assert.rejects(planner().plan(project, scenes), /автоматического платного повтора нет/);
    assert.equal((await planner().plan(project, [scenes[0]!])).size, 1);
    assert.equal(posts, 1, 'Restart must not submit the uncertain scene again');
  }
});

test('completed SSE with malformed model JSON retains the bounded repair budget across restart', async t => {
  const f = await fixture(t);
  const scenes = scenesOf('A ship departed.');
  const project = projectOf(scenes);
  let posts = 0;
  const client = localTransportClient(() => { posts++; return sse(delta('{"scenes":[') + delta('', 'stop')); });
  const planner = () => new DocumentaryAiQueryPlanner(client, () => f.root);
  await assert.rejects(planner().plan(project, scenes), /исчерпаны/);
  assert.equal(posts, 2);
  await assert.rejects(planner().plan(project, scenes), /исчерпаны/);
  assert.equal(posts, 2);
  const cache = JSON.parse(await readFile(path.join(f.root, 'documentary-ai-query-plans', (await f.cacheFiles())[0]!), 'utf8'));
  assert.ok(cache.attempts.every((attempt: { status: string; responseState: string; rawResponse: string }) =>
    attempt.status === 'invalid' && attempt.responseState === 'complete' && attempt.rawResponse === '{"scenes":['));
});

test('confirmed output limit preserves received scene and repairs only missing ids using the real client', async t => {
  const f = await fixture(t);
  const scenes = scenesOf('The ship departed.', 'It crossed the ocean.');
  const project = projectOf(scenes);
  let posts = 0;
  const raw = `{"scenes":[${JSON.stringify(entry('scene-0'))},`;
  const client = localTransportClient(body => {
    posts++;
    if (posts === 1) return sse(delta(raw) + delta('', 'length'));
    const messages = body.messages as Array<{ content: string }>;
    assert.deepEqual((JSON.parse(messages[1]!.content) as Payload).requestedScenes.map(scene => scene.sceneId), ['scene-1']);
    return sse(delta(response(['scene-1'])) + delta('', 'stop'));
  });
  assert.equal((await new DocumentaryAiQueryPlanner(client, () => f.root).plan(project, scenes)).size, 2);
  assert.equal(posts, 2);
  const cache = JSON.parse(await readFile(path.join(f.root, 'documentary-ai-query-plans', (await f.cacheFiles())[0]!), 'utf8'));
  assert.equal(cache.attempts[0].status, 'invalid');
  assert.equal(cache.attempts[0].responseState, 'complete');
  assert.equal(cache.attempts[0].rawResponse, raw);
});

test('a format error without completion proof cannot enable a paid repair', async t => {
  const f = await fixture(t, async () => { throw new AnyModelOutputFormatError('Unknown envelope failure'); });
  const scenes = scenesOf('The ship departed.');
  const project = projectOf(scenes);
  await assert.rejects(f.planner().plan(project, scenes), /автоматически не повторяется/);
  await assert.rejects(f.planner().plan(project, scenes), /автоматического платного повтора нет/);
  assert.equal(f.calls.length, 1);
});

test('an older invalid/partial format checkpoint is migrated to uncertain without a new POST', async t => {
  const f = await fixture(t);
  const scenes = scenesOf('The ship departed.');
  const project = projectOf(scenes);
  await f.planner().plan(project, scenes);
  const file = path.join(f.root, 'documentary-ai-query-plans', (await f.cacheFiles())[0]!);
  const cache = JSON.parse(await readFile(file, 'utf8'));
  cache.plans = {};
  Object.assign(cache.attempts[0], { status: 'invalid', responseState: 'partial',
    errorName: 'AnyModelOutputFormatError', rawResponse: '{"scenes":[' });
  await writeFile(file, JSON.stringify(cache));
  await assert.rejects(f.planner().plan(project, scenes), /автоматического платного повтора нет/);
  assert.equal(f.calls.length, 1);
  const migrated = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(migrated.attempts[0].status, 'uncertain');
  assert.equal(migrated.attempts[0].rawResponse, '{"scenes":[');
});

test('cache-only read returns valid scenes beside uncertain ids after restart without writes or completions', async t => {
  const f = await fixture(t, async (_call, partial) => {
    const raw = `{"scenes":[${JSON.stringify(entry('scene-0'))},`;
    partial?.(raw);
    throw new AnyModelCompletionUncertainError('Connection lost', raw);
  });
  const scenes = scenesOf('The ship departed.', 'It crossed the ocean.');
  const project = projectOf(scenes);
  const snapshot = structuredClone(project);
  await assert.rejects(f.planner().plan(project, scenes), /автоматически не повторяется/);
  const file = path.join(f.root, 'documentary-ai-query-plans', (await f.cacheFiles())[0]!);
  const before = await readFile(file, 'utf8');
  const plans = await f.planner().readCached(project, scenes);
  assert.deepEqual([...plans.keys()], ['scene-0']);
  assert.equal(plans.get('scene-0')!.text, scenes[0]!.narration);
  assert.equal((await f.planner().readCached(project, [scenes[1]!])).size, 0);
  assert.equal(await readFile(file, 'utf8'), before, 'Raw response, receipts and attempt states are byte-for-byte unchanged');
  assert.equal(f.calls.length, 1);
  assert.deepEqual(project, snapshot);
  await assert.rejects(f.planner().plan(project, scenes), /автоматического платного повтора нет/);
  assert.equal(f.calls.length, 1, 'Strict plan() still blocks another payment');
});

test('cache-only read returns completed scenes after other scenes exhaust the repair budget', async t => {
  const f = await fixture(t, async call => call.data.requestedScenes.length === 2
    ? response(['scene-0']) : '{"scenes":[]}');
  const scenes = scenesOf('The ship departed.', 'It crossed the ocean.');
  const project = projectOf(scenes);
  await assert.rejects(f.planner().plan(project, scenes), /исчерпаны/);
  assert.equal(f.calls.length, 2);
  const file = path.join(f.root, 'documentary-ai-query-plans', (await f.cacheFiles())[0]!);
  const before = await readFile(file, 'utf8');
  assert.deepEqual([...(await f.planner().readCached(project, scenes)).keys()], ['scene-0']);
  assert.equal(await readFile(file, 'utf8'), before);
  assert.equal(f.calls.length, 2);
});

test('cache-only read never plans missing or stale context/model/id/version data and skips invalid entries individually', async t => {
  const f = await fixture(t);
  const scenes = scenesOf('The ship departed.', 'It crossed the ocean.');
  const project = projectOf(scenes);
  assert.equal((await f.planner().readCached(project, scenes)).size, 0);
  assert.equal((await f.planner().readCached(project, [])).size, 0);
  assert.equal(f.calls.length, 0);
  await f.planner().plan(project, scenes);
  assert.equal((await f.planner().readCached(project, scenes)).size, 2);
  const originalScript = project.videoBrief!.readyScript!;
  project.videoBrief!.readyScript += ' Changed context.';
  assert.equal((await f.planner().readCached(project, scenes)).size, 0);
  project.videoBrief!.readyScript = originalScript;
  const originalNarration = scenes[0]!.narration;
  scenes[0]!.narration += ' Extra.';
  assert.equal((await f.planner().readCached(project, [scenes[1]!])).size, 0, 'Surrounding context participates in the hash');
  scenes[0]!.narration = originalNarration;
  const originalId = scenes[0]!.id;
  scenes[0]!.id = 'changed-id';
  assert.equal((await f.planner().readCached(project, scenes)).size, 0);
  scenes[0]!.id = originalId;
  f.state.model = 'fixture/different-text-model';
  assert.equal((await f.planner().readCached(project, scenes)).size, 0);
  f.state.model = MODEL;
  const file = path.join(f.root, 'documentary-ai-query-plans', (await f.cacheFiles())[0]!);
  const cache = JSON.parse(await readFile(file, 'utf8'));
  cache.plans['scene-0'].version = 999;
  await writeFile(file, JSON.stringify(cache));
  assert.deepEqual([...(await f.planner().readCached(project, scenes)).keys()], ['scene-1']);
  cache.plans['scene-1'].inputHash = 'wrong-hash';
  await writeFile(file, JSON.stringify(cache));
  assert.equal((await f.planner().readCached(project, scenes)).size, 0);
  assert.equal(f.calls.length, 1);
});

test('cache-only read does not wait for a pending completion to settle', async t => {
  const f = await fixture(t);
  const scenes = scenesOf('The ship departed.', 'It crossed the ocean.');
  const project = projectOf(scenes);
  let release!: () => void;
  let started!: () => void;
  const whenStarted = new Promise<void>(resolve => { started = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  const client = { documentaryQueryModel: async () => MODEL,
    documentaryCompletion: async () => { started(); await pending; return response(scenes.map(scene => scene.id)); },
  } as unknown as AnyModelClient;
  const planner = new DocumentaryAiQueryPlanner(client, () => f.root);
  const running = planner.plan(project, scenes);
  await whenStarted;
  try {
    assert.equal((await planner.readCached(project, scenes)).size, 0);
  } finally { release(); }
  assert.equal((await running).size, 2);
});

test('prompt revision 15 separates narrated history from required pixels and preserves primary versus thematic lanes', async t => {
  const expected = [
    entry('scene-0', { subject: 'Yamaha YZR-M1', visualTarget: 'Yamaha YZR-M1 motorcycle cornering', years: ['2003'],
      imageQueries: ['Yamaha YZR-M1 2003 cornering'], videoQueries: ['Yamaha YZR-M1 2003 race footage'],
      fallbackVisualTarget: 'motorcycle cornering on a track', fallbackVideoQueries: ['motorcycle track cornering'] }),
    entry('scene-1', { subject: 'Yamaha YZR-M1 crossplane crankshaft', years: ['2003', '2004'],
      visualTarget: 'crossplane crankshaft with ninety-degree crankpins',
      imageQueries: ['Yamaha M1 2004 crossplane crankshaft'], videoQueries: ['Yamaha M1 crossplane crankshaft'],
      fallbackVisualTarget: 'motorcycle engine components', fallbackVideoQueries: ['motorcycle engine close up', 'engine crankshaft rotating'] }),
    entry('scene-2', { subject: 'motorcycle and rider', visualScope: 'illustrative', years: [],
      visualTarget: 'motorcycle rider on a road', imageQueries: ['motorcycle rider on road'], videoQueries: ['motorcycle riding road'],
      fallbackVisualTarget: 'motorcycle riding', fallbackVideoQueries: ['motorcycle riding'] }),
    entry('scene-3', { subject: 'Power Jets W.1', years: ['1941'], visualTarget: 'Power Jets W.1 jet engine',
      imageQueries: ['Power Jets W.1 1941'], videoQueries: ['Power Jets W.1 engine archive'],
      fallbackVisualTarget: 'jet engine components', fallbackVideoQueries: ['jet engine compressor close up'] }),
  ];
  const f = await fixture(t, async () => JSON.stringify({ scenes: expected }));
  const scenes = scenesOf('Its riders struggled with grip and unpredictable engine behaviour.',
    'The answer was a crossplane crankshaft with crankpins at ninety degrees.',
    'The lesson is that a good machine gives its rider control.', 'In 1941 the Power Jets W.1 demonstrated the new propulsion concept.');
  const project = projectOf(scenes);
  const results = await f.planner().plan(project, scenes);
  const prompt = f.calls[0]!.system;
  assert.match(prompt, /subject names the physical person, object, place or component/);
  assert.match(prompt, /three sparse video samples/);
  assert.match(prompt, /Explicit visual directions take priority/);
  assert.match(prompt, /Never mark the line's central feature optional/);
  assert.match(prompt, /years contains ONLY a visibly required period\/capture year/);
  assert.match(prompt, /Dates may help archival queries without becoming required pixels/);
  assert.match(prompt, /retain the chosen subject, necessary geography and central visible features/);
  assert.match(prompt, /retain that cause, unless the result itself visibly demonstrates the change/);
  assert.match(prompt, /physical model or accurate diagram may illustrate the same subject\/feature/);
  assert.match(prompt, /Explicit visual comparisons must preserve both subjects and the relevant difference/);
  assert.match(prompt, /Require a visible action only when the script makes showing it the point/);
  assert.match(prompt, /All primary and reserve queries must satisfy their corresponding target/);
  assert.match(prompt, /Do not mix different depicted subjects under one mandatory identity/);
  assert.match(prompt, /"kind":"condition","required":"the visible physical feature discussed by this line"/);
  assert.match(prompt, /sample condition is for a physical-feature line; omit it for ordinary subject-context/);
  for (const row of expected) {
    const plan = results.get(row.sceneId)!.aiSearchPlan!;
    assert.deepEqual(plan.imageQueries, row.imageQueries);
    assert.deepEqual(plan.videoQueries, row.videoQueries);
    assert.deepEqual(plan.years, row.years);
    assert.equal(plan.fallbackVisualTarget, row.fallbackVisualTarget);
    assert.deepEqual(plan.fallbackVideoQueries, row.fallbackVideoQueries);
  }
  const file = path.join(f.root, 'documentary-ai-query-plans', (await f.cacheFiles())[0]!);
  const cache = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(cache.version, 1, 'Prompt change does not silently invalidate already paid v1 receipts');
  assert.equal(cache.attempts[0].request.promptRevision, 15);
  assert.equal(cache.attempts[0].request.system, prompt);
});

test('same-contract cached plan keeps its exact paid request without relabelling or resubmitting', async t => {
  const f = await fixture(t);
  const scenes = scenesOf('The ship departed.');
  const project = projectOf(scenes);
  const planned = await f.planner().plan(project, scenes);
  const file = path.join(f.root, 'documentary-ai-query-plans', (await f.cacheFiles())[0]!);
  const cache = JSON.parse(await readFile(file, 'utf8'));
  delete cache.attempts[0].request.promptRevision;
  cache.attempts[0].request.system = 'Legacy prompt retained verbatim in this local fixture';
  await writeFile(file, JSON.stringify(cache));
  const before = await readFile(file, 'utf8');
  assert.deepEqual(await f.planner().plan(project, scenes), planned);
  assert.equal(await readFile(file, 'utf8'), before);
  assert.equal(f.calls.length, 1);
});

test('a scoped refresh stages only eligible scenes and normal reads adopt it only after project apply', async t => {
  let target = 'RMS Titanic propellers 1912';
  const f = await fixture(t, async call => JSON.stringify({ scenes: call.data.requestedScenes.map(scene => entry(scene.sceneId, { visualTarget: target })) }));
  const scenes = scenesOf('The propellers.', 'A ready frame.', 'An unresolved plan.', 'Outside this run.');
  const project = projectOf(scenes);
  const initial = await f.planner().plan(project, scenes);
  for (const scene of scenes) {
    scene.audioPath = `voice-${scene.order}.mp3`;
    scene.documentary = { requirement: initial.get(scene.id)!, verified: scene.order === 1 } as Scene['documentary'];
  }
  const before = structuredClone(project);
  const file = path.join(f.root, 'documentary-ai-query-plans', (await f.cacheFiles())[0]!);
  const cache = JSON.parse(await readFile(file, 'utf8'));
  cache.attempts[0].request.promptRevision = 8;
  cache.attempts.push({ ids: [scenes[2]!.id], status: 'pending' });
  await writeFile(file, JSON.stringify(cache));
  target = 'Attributed close-up of an RMS Titanic propeller';
  const scoped = scenes.slice(0, 3), refreshSceneIds = new Set(scenes.map(scene => scene.id));
  const planner = f.planner();
  const proposed = await planner.plan(project, scoped, { refreshSceneIds });
  const candidate = proposed.get(scenes[0]!.id)!;
  assert.equal(candidate.aiSearchPlan!.visualTarget, target);
  assert.equal(candidate.aiSearchPlan!.inputHash, initial.get(scenes[0]!.id)!.aiSearchPlan!.inputHash);
  assert.deepEqual(f.calls[1]!.data.requestedScenes.map(scene => scene.sceneId), [scenes[0]!.id]);
  assert.deepEqual(proposed.get(scenes[1]!.id), initial.get(scenes[1]!.id));
  assert.deepEqual(proposed.get(scenes[2]!.id), initial.get(scenes[2]!.id));
  assert.deepEqual(project, before);
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(saved.plans, cache.plans);
  assert.deepEqual(saved.attempts.slice(0, 2), cache.attempts);
  assert.deepEqual(saved.attempts[2].refreshIds, [scenes[0]!.id]);
  assert.equal(saved.attempts[2].status, 'complete');
  assert.deepEqual(await f.planner().readCached(project, scenes), initial);
  assert.deepEqual(await f.planner().plan(project, scenes), initial);
  assert.deepEqual(await f.planner().plan(project, scoped, { refreshSceneIds }), proposed);
  scenes[0]!.documentary!.requirement = candidate;
  assert.equal((await f.planner().readCached(project, scenes)).get(scenes[0]!.id)!.aiSearchPlan!.visualTarget, target);
  assert.equal((await f.planner().plan(project, scenes)).get(scenes[0]!.id)!.aiSearchPlan!.visualTarget, target);
  assert.equal(f.calls.length, 2);
});

test('a partial refresh leaves its old plan active and blocks another submission after restart', async t => {
  let interrupt = false;
  const f = await fixture(t, async (call, partial) => {
    const [id] = call.data.requestedScenes.map(scene => scene.sceneId);
    if (!interrupt) return response([id!]);
    const raw = JSON.stringify({ scenes: [entry(id!, { visualTarget: 'A staged detail' })] });
    partial?.(raw);
    throw new AnyModelCompletionUncertainError('Fixture connection interrupted', raw);
  });
  const scenes = scenesOf('The ship departed.'), [scene] = scenes, project = projectOf(scenes);
  const previous = await f.planner().plan(project, scenes);
  scene!.documentary = { requirement: previous.get(scene!.id)!, verified: false } as Scene['documentary'];
  const file = path.join(f.root, 'documentary-ai-query-plans', (await f.cacheFiles())[0]!);
  const cache = JSON.parse(await readFile(file, 'utf8'));
  cache.attempts[0].request.promptRevision = 8;
  await writeFile(file, JSON.stringify(cache));
  interrupt = true;
  const options = { refreshSceneIds: new Set([scene!.id]) };
  assert.deepEqual(await f.planner().plan(project, scenes, options), previous);
  const bytes = await readFile(file, 'utf8'), saved = JSON.parse(bytes);
  assert.deepEqual(saved.plans, cache.plans);
  assert.equal(saved.attempts[1].status, 'uncertain');
  assert.equal(saved.attempts[1].responseState, 'partial');
  assert.deepEqual(await f.planner().plan(project, scenes, options), previous);
  assert.deepEqual(await f.planner().readCached(project, scenes), previous);
  assert.equal(await readFile(file, 'utf8'), bytes);
  assert.equal(f.calls.length, 2);
});

test('representation contract preserves historical alternatives, an explicitly modern museum view and the named place',async t=>{
 const scenes=scenesOf('Cutty Sark got home with an improvised rudder.',
  'Show a modern museum view of preserved Cutty Sark at Greenwich.',
  'The Suez Canal had opened.');
 const rows=[
  entry('scene-0',{subject:'Cutty Sark',visualTarget:'Cutty Sark; archival photo or drawing OR modern view of the same ship',years:[],visualScope:'illustrative',
   imageQueries:['Cutty Sark historical illustration'],videoQueries:['Cutty Sark preserved ship']}),
  entry('scene-1',{subject:'Cutty Sark',visualTarget:'Modern museum view of preserved Cutty Sark at Greenwich',years:[],visualScope:'illustrative',
   imageQueries:['Cutty Sark Greenwich museum'],videoQueries:['Cutty Sark Greenwich modern museum view']}),
  entry('scene-2',{subject:'Suez Canal',visualTarget:'Suez Canal waterway; archival illustration or modern view of the same canal',years:['1869'],visualScope:'illustrative',
   imageQueries:['Suez Canal 1869 engraving'],videoQueries:['Suez Canal waterway ships']})];
 const f=await fixture(t,async call=>{
  assert.match(call.system,/archival, drawn or modern representations of that SAME subject/);
  assert.match(call.system,/Explicit visual directions take priority/);
  assert.match(call.system,/optionalDetails contains only nonessential staging, capture date or viewpoint/);
  assert.match(call.system,/different named subject or a broad thematic association is not a substitute/);
  assert.doesNotMatch(call.system,/put its proper name and a filmable present-day detail or location in the first video query/);
  assert.deepEqual(call.data.requestedScenes.map(s=>s.narration),scenes.map(s=>s.narration));
  return JSON.stringify({scenes:rows});
 });
 const project=projectOf(scenes),plans=await f.planner().plan(project,scenes);
 for(const row of rows){const ai=plans.get(row.sceneId)!.aiSearchPlan!;
  assert.equal(ai.visualTarget,row.visualTarget);assert.deepEqual(ai.imageQueries,row.imageQueries);assert.deepEqual(ai.videoQueries,row.videoQueries);}
 assert.deepEqual(await f.planner().readCached(project,scenes),plans);assert.equal(f.calls.length,1);
});

test('short03 raw event plans become stale and subject-illustration is explicit in the replacement request',async t=>{
 const scenes=scenesOf('On November 22, 1869, Cutty Sark slid into the water at Dumbarton, Scotland.',
  'The Suez Canal had opened.','But getting home with an improvised rudder revealed something a finishing position could not:');
 const raw=[
  {subject:'Cutty Sark clipper ship',visualTarget:'Cutty Sark being launched at Dumbarton shipyard, 1869',years:['1869']},
  {subject:'Suez Canal opening, November 1869',visualTarget:'Suez Canal inauguration ceremony 1869',years:['1869']},
  {subject:'Cutty Sark completing 1872 voyage with jury-rigged rudder',visualTarget:'Cutty Sark arriving in port after jury-rudder passage, 1872',years:['1872']}];
 const f=await fixture(t),project=projectOf(scenes),hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
 const {queryContractVersion:_revision,visualPolicy:_policy,...base}=documentaryAiPlanContext(project);
 const oldHash=hash({version:1,model:MODEL,context:{...base,queryContractVersion:3}}),oldPlans:Record<string,unknown>={};
 scenes.forEach((s,i)=>{const {sceneId:_id,...fields}=entry(s.id,raw[i]);const plan={...fields,version:1,model:MODEL,inputHash:hash({inputHash:oldHash,sceneId:s.id})};
  oldPlans[s.id]=plan;s.documentary={requirement:{text:s.narration,aiSearchPlan:plan}} as never;assert.equal(currentDocumentaryAiSearchPlan(project,s),undefined);});
 const directory=path.join(f.root,'documentary-ai-query-plans');await (await import('node:fs/promises')).mkdir(directory,{recursive:true});
 const file=path.join(directory,oldHash+'.json'),bytes=JSON.stringify({version:1,inputHash:oldHash,model:MODEL,plans:oldPlans,attempts:[]});await writeFile(file,bytes);
 assert.equal((await f.planner().readCached(project,scenes)).size,0);await f.planner().plan(project,scenes);
 assert.equal(f.calls.length,1);assert.equal(f.calls[0]!.data.visualPolicy.mode,'subject-illustration');
 assert.match(f.calls[0]!.system,/narrated biography, an end of trade or a past voyage does not require a historical event photo/);
 assert.match(f.calls[0]!.system,/years contains ONLY a visibly required period\/capture year/);
 assert.doesNotMatch(f.calls[0]!.system,/years are exact relevant years|asserts or requests|Preserve exact names, models and relevant years in primary/);
 assert.equal(await readFile(file,'utf8'),bytes);
});

test('literal visual policy is sent explicitly and invalidates a subject-illustration plan',async t=>{
 const f=await fixture(t),scenes=scenesOf('The ship arrived in 1872.'),project=projectOf(scenes);
 await f.planner().plan(project,scenes);assert.equal(f.calls[0]!.data.visualPolicy.mode,'subject-illustration');
 project.settings={assembly:{documentary:{matchMode:'literal'}}} as never;
 assert.equal((await f.planner().readCached(project,scenes)).size,0);
 await f.planner().plan(project,scenes);assert.equal(f.calls[1]!.data.visualPolicy.mode,'literal');
 assert.match(f.calls[1]!.system,/literal requires the specifically narrated event, state and period/);
});
test('a direct visual instruction retains the requested event, place and archival period',async t=>{
 const scenes=scenesOf('Show an archival image of the actual Cutty Sark launch at Dumbarton in 1869.');
 const expected=entry('scene-0',{subject:'Cutty Sark',visualTarget:'Actual Cutty Sark launch at Dumbarton in 1869',years:['1869'],visualScope:'exact',
  imageQueries:['Cutty Sark launch Dumbarton 1869'],videoQueries:[],preferredKind:'image'});
 const f=await fixture(t,async call=>{
  assert.match(call.system,/Explicit visual directions take priority/);
  assert.equal(call.data.requestedScenes[0]!.narration,scenes[0]!.narration);
  return JSON.stringify({scenes:[expected]});
 });
 const plan=(await f.planner().plan(projectOf(scenes),scenes)).get('scene-0')!.aiSearchPlan!;
 assert.equal(plan.visualTarget,expected.visualTarget);assert.equal(plan.visualScope,'exact');assert.deepEqual(plan.years,['1869']);
});

test('comparison plans preserve actual short04 context and remain usable as image-first explanations',async t=>{
 const scenes=scenesOf('She had been built to race across oceans and bring Chinese tea home before her rivals.\n\n',
  'Before Cutty Sark began her first voyage, steamships had gained a shortcut she could not practically use. ',
  'How could a sailing ship compete when her rivals could travel thousands of miles less?\n\n',
  'Earth is much smaller than Jupiter.');
 const script='Cutty Sark was a tea clipper. The Suez Canal had opened.\n'+scenes.map(s=>s.narration).join('\n');
 const rows=[
  entry('scene-0',{subject:'Cutty Sark',visualTarget:'Cutty Sark clipper ship',years:[],visualScope:'illustrative',
   imageQueries:['Cutty Sark clipper ship archival photograph'],videoQueries:['Cutty Sark clipper ship']}),
  entry('scene-1',{subject:'Suez Canal',visualTarget:'Suez Canal with steamships as an illustration of the shortcut',years:[],visualScope:'illustrative',
   imageQueries:['Suez Canal steamships'],videoQueries:['Suez Canal steamship']}),
  entry('scene-2',{subject:'Sea routes via Suez Canal and around Africa',
   visualTarget:'Route comparison map showing shorter route through Suez Canal versus longer route around Africa',years:[],visualScope:'illustrative',preferredKind:'image',reservePolicy:'primary-only',
   imageQueries:['Suez Canal Cape of Good Hope route comparison map'],videoQueries:[],fallbackVisualTarget:'',fallbackVideoQueries:[]}),
  entry('scene-3',{subject:'Earth and Jupiter',visualTarget:'Side-by-side size comparison diagram of Earth and Jupiter at the same scale',
   years:[],visualScope:'illustrative',preferredKind:'image',reservePolicy:'primary-only',imageQueries:['Earth Jupiter size comparison diagram same scale'],videoQueries:[],fallbackVisualTarget:'',fallbackVideoQueries:[]})];
 const f=await fixture(t,async call=>{
  assert.equal(call.data.originalScript,script+'\n'+fixtureQuote);
  assert.deepEqual(call.data.requestedScenes.map(({sceneId,narration})=>({sceneId,narration})),scenes.map(s=>({sceneId:s.id,narration:s.narration})));
  return JSON.stringify({scenes:rows});
 });
 const project=projectOf(scenes,script),before=structuredClone(project),plans=await f.planner().plan(project,scenes);
 for(const row of rows){const plan=plans.get(row.sceneId)!.aiSearchPlan!;
  assert.equal(plan.subject,row.subject);assert.equal(plan.visualTarget,row.visualTarget);
  assert.deepEqual(plan.imageQueries,row.imageQueries);assert.deepEqual(plan.videoQueries,row.videoQueries);assert.deepEqual(plan.years,[]);}
 assert.deepEqual(project,before);assert.deepEqual(await f.planner().readCached(project,scenes),plans);assert.equal(f.calls.length,1);
});

test('literal policy retains an explicitly requested visible state beside type-only subject illustrations',async t=>{
 const scenes=scenesOf('Show Cutty Sark under full sail at sea.');
 const row=entry('scene-0',{subject:'Cutty Sark',visualTarget:'Cutty Sark under full sail at sea',years:[],visualScope:'exact',
  imageQueries:['Cutty Sark under full sail at sea'],videoQueries:['Cutty Sark under full sail at sea']});
 const f=await fixture(t,async call=>{assert.equal(call.data.visualPolicy.mode,'literal');return JSON.stringify({scenes:[row]});});
 const project=projectOf(scenes);project.settings={assembly:{documentary:{matchMode:'literal'}}} as never;
 const plan=(await f.planner().plan(project,scenes)).get('scene-0')!.aiSearchPlan!;
 assert.equal(plan.visualTarget,row.visualTarget);assert.equal(plan.visualScope,'exact');assert.deepEqual(plan.imageQueries,row.imageQueries);
});

test('actual Opus route comparison cannot retain its generic-boat reserve or open later paid reserve stages',async t=>{
 const scenes=scenesOf('How could a sailing ship compete when her rivals could travel thousands of miles less?\n\n');
 const row=entry('scene-0',{subject:'sea routes from Britain to China via Suez Canal and via Cape of Good Hope',
  visualTarget:'route comparison map: Britain to China via Suez Canal versus around the Cape of Good Hope',
  years:[],visualScope:'illustrative',preferredKind:'image',reservePolicy:'primary-only',
  imageQueries:['Suez Canal vs Cape of Good Hope route map'],videoQueries:['Suez Canal Cape of Good Hope route comparison map animation'],
  fallbackVisualTarget:'sailing ship on the open ocean',fallbackVideoQueries:['tall ship sailing open ocean','old nautical world map']});
 const f=await fixture(t,async()=>JSON.stringify({scenes:[row]})),project=projectOf(scenes);
 const planned=await f.planner().plan(project,scenes),req=planned.get('scene-0')!;
 assert.equal(req.aiSearchPlan!.reservePolicy,'primary-only');assert.equal(req.aiSearchPlan!.visualTarget,row.visualTarget);
 assert.equal(req.aiSearchPlan!.fallbackVisualTarget,'');assert.deepEqual(req.aiSearchPlan!.fallbackVideoQueries,[]);
 scenes[0]!.documentary={requirement:req,verified:false,pinned:false} as never;
 for(const action of ['planFallbacks','planTopicFallbacks','readCachedFallbacks','readCachedTopicFallbacks'] as const)
  assert.equal((await f.planner()[action](project,scenes)).size,0);
 assert.equal(f.calls.length,1,'No reserve completion may be submitted for primary-only');
 const file=path.join(f.root,'documentary-ai-query-plans',(await f.cacheFiles())[0]!);
 assert.equal(JSON.parse(await readFile(file,'utf8')).attempts[0].rawResponse,JSON.stringify({scenes:[row]}),'Preserve the paid raw response, including the rejected reserve');
});

for(const previousRevision of [undefined,2,3,4,5])test(`a new-contract healthy plan remains readable beside pending contract ${previousRevision??'original'}`,async t=>{
 const f=await fixture(t),scenes=scenesOf('First healthy scene.','Second blocked scene.'),project=projectOf(scenes);
 const healthy=await f.planner().plan(project,[scenes[0]!]);assert.equal(f.calls.length,1);
 const directory=path.join(f.root,'documentary-ai-query-plans'),currentFile=path.join(directory,(await f.cacheFiles())[0]!);
 const currentBytes=await readFile(currentFile,'utf8');
 const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
 const currentContext=documentaryAiPlanContext(project);
 const {queryContractVersion:_revision,visualPolicy:_policy,...baseContext}=currentContext;
 const context=previousRevision?{...(previousRevision>=4?currentContext:baseContext),queryContractVersion:previousRevision}:baseContext;
 const inputHash=hash({version:1,model:MODEL,context}),legacyFile=path.join(directory,inputHash+'.json');
 const legacyBytes=JSON.stringify({version:1,inputHash,model:MODEL,plans:{},attempts:[{ids:[scenes[1]!.id],status:'pending'}]});await writeFile(legacyFile,legacyBytes);
 assert.deepEqual(await f.planner().readCached(project,scenes),healthy);
 const issues=await f.planner().readIssues(project,scenes);
 assert.equal(issues.find(i=>i.sceneId===scenes[0]!.id)?.cached,true,'Healthy A still offers local application');
 assert.match(issues.find(i=>i.sceneId===scenes[1]!.id)!.reason,/неизвестный результат/);
 await assert.rejects(f.planner().plan(project,scenes),/неизвестный результат/);
 assert.equal(f.calls.length,1);assert.deepEqual(await f.planner().readCached(project,scenes),healthy);
 assert.equal(await readFile(currentFile,'utf8'),currentBytes);assert.equal(await readFile(legacyFile,'utf8'),legacyBytes);
});

for(const previousRevision of [undefined,2,3,4,5])for(const pending of [false,true])test(`contract invalidates old disk/scene plans and preserves unknown guards revision=${previousRevision??'original'} pending=${pending}`,async t=>{
 const f=await fixture(t);const scenes=scenesOf('Steamships gained a shortcut.');const project=projectOf(scenes);
 const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
 const currentContext=documentaryAiPlanContext(project);
 const {queryContractVersion:_revision,visualPolicy:_policy,...baseContext}=currentContext;
 const context=previousRevision?{...(previousRevision>=4?currentContext:baseContext),queryContractVersion:previousRevision}:baseContext;
 const inputHash=hash({version:1,model:MODEL,context});
 const {sceneId:_id,...fields}=entry(scenes[0]!.id,{subject:'steamships',visualTarget:'steamship with funnel AND smoke'});
 const old={...fields,version:1,inputHash:hash({inputHash,sceneId:scenes[0]!.id}),model:MODEL};
 scenes[0]!.documentary={requirement:{text:scenes[0]!.narration,aiSearchPlan:old}} as never;
 const directory=path.join(f.root,'documentary-ai-query-plans');await (await import('node:fs/promises')).mkdir(directory,{recursive:true});
 const file=path.join(directory,inputHash+'.json'),bytes=JSON.stringify({version:1,inputHash,model:MODEL,plans:pending?{}:{[scenes[0]!.id]:old},
  attempts:[{ids:[scenes[0]!.id],status:pending?'pending':'complete',...(pending?{}:{responseState:'complete'})}]});
 await writeFile(file,bytes);
 assert.equal(currentDocumentaryAiSearchPlan(project,scenes[0]!),undefined);
 assert.equal((await f.planner().readCached(project,scenes)).size,0);
 if(pending){await assert.rejects(f.planner().plan(project,scenes),/неизвестный результат/);assert.equal(f.calls.length,0);}
 else{assert.equal((await f.planner().plan(project,scenes)).size,1);assert.equal(f.calls.length,1);
  assert.match(f.calls[0]!.system,/subject names the physical person, object, place or component, not an event, date or assessment/);
  assert.match(f.calls[0]!.system,/years contains ONLY a visibly required period\/capture year/);
  assert.match(f.calls[0]!.system,/different named subject or a broad thematic association is not a substitute/);
  assert.equal((await f.planner().plan(project,scenes)).size,1);assert.equal(f.calls.length,1);}
 assert.equal(await readFile(file,'utf8'),bytes,'The old paid receipt is preserved byte-for-byte');
});

test('three valid queries use one real-client simulated POST and preserve all raw phrases across cached repeats', async t => {
  const f = await fixture(t);
  const scenes = scenesOf('A crossplane crankshaft has crankpins at ninety degrees.');
  const project = projectOf(scenes);
  const imageQueries = ['Yamaha crossplane crankshaft crankpins', 'crossplane crankshaft 90 degree configuration 2004',
    'Yamaha YZR-M1 crossplane crankshaft'];
  const raw = JSON.stringify({ scenes: [entry('scene-0', { subject: 'Yamaha YZR-M1 crossplane crankshaft',
    imageQueries, years: ['2004'] })] });
  let posts = 0;
  const client = localTransportClient(() => {
    posts++;
    return Response.json({ choices: [{ message: { content: raw }, finish_reason: 'stop' }] });
  });
  const planner = () => new DocumentaryAiQueryPlanner(client, () => f.root);
  const planned = await planner().plan(project, scenes);
  assert.deepEqual(planned.get('scene-0')!.aiSearchPlan!.imageQueries, imageQueries.slice(0, 2));
  assert.equal(posts, 1);
  const file = path.join(f.root, 'documentary-ai-query-plans', (await f.cacheFiles())[0]!);
  const cache = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(cache.attempts.length, 1);
  assert.equal(cache.attempts[0].status, 'complete');
  assert.equal(cache.attempts[0].rawResponse, raw);
  assert.deepEqual(JSON.parse(cache.attempts[0].rawResponse).scenes[0].imageQueries, imageQueries);
  const before = await readFile(file, 'utf8');
  assert.deepEqual(await planner().plan(project, scenes), planned);
  assert.deepEqual(await planner().readCached(project, scenes), planned);
  assert.equal(await readFile(file, 'utf8'), before);
  assert.equal(posts, 1, 'Cache repeat adds zero POSTs');
});

test('surplus normalization deduplicates full phrases before keeping two and never cuts long names or dates', async t => {
  const subject = 'International Research Centre for the Study of the Preservation and Restoration of Cultural Property';
  const first = `${subject} Rome 1959 archives`, second = `${subject} 1960 building`;
  const f = await fixture(t, async () => JSON.stringify({ scenes: [entry('scene-0', {
    subject, imageQueries: [first, first.toUpperCase(), second, 'cultural heritage restoration archives'],
  })] }));
  const scenes = scenesOf('The centre was established to preserve cultural heritage.');
  const plan = (await f.planner().plan(projectOf(scenes), scenes)).get('scene-0')!.aiSearchPlan!;
  assert.deepEqual(plan.imageQueries, [first, second]);
  assert.equal(f.calls.length, 1);
});

test('a completed raw surplus response rejected by an older validator is reusable without writes, status changes or payments', async t => {
  const raw = '```json\n' + JSON.stringify({ scenes: [entry('scene-0', { imageQueries: [
    'Yamaha crossplane crankshaft crankpins', 'crossplane crankshaft 90 degree configuration', 'Yamaha YZR-M1 crossplane crankshaft',
  ] })] }) + '\n```';
  const f = await fixture(t, async () => raw);
  const scenes = scenesOf('A crossplane crankshaft has crankpins at ninety degrees.');
  const project = projectOf(scenes);
  const original = await f.planner().plan(project, scenes);
  const file = path.join(f.root, 'documentary-ai-query-plans', (await f.cacheFiles())[0]!);
  const cache = JSON.parse(await readFile(file, 'utf8'));
  cache.plans = {};
  cache.attempts[0].status = 'invalid'; // Exact state left by the previous >2 validator.
  await writeFile(file, JSON.stringify(cache));
  const before = await readFile(file, 'utf8');
  assert.deepEqual(await f.planner().readCached(project, scenes), original);
  assert.equal(await readFile(file, 'utf8'), before, 'readCached remains read-only');
  assert.deepEqual(await f.planner().plan(project, scenes), original);
  assert.equal(await readFile(file, 'utf8'), before, 'No migration/hash/status/raw rewrite needed to reuse the paid answer');
  assert.equal(f.calls.length, 1);
});

test('raw recovery never trusts unknown completion, duplicate ids, invalid types, incomplete JSON or another context', async t => {
  for (const mode of ['pending', 'uncertain', 'partial', 'duplicate', 'wrong-id', 'bad-type', 'truncated', 'context', 'request-text', 'request-ids']) {
    const raw = JSON.stringify({ scenes: [entry('scene-0', { imageQueries: ['first camera view', 'second camera view', 'third camera view'] })] });
    const f = await fixture(t, async () => raw);
    const scenes = scenesOf('A camera is visible.');
    const project = projectOf(scenes);
    await f.planner().plan(project, scenes);
    const file = path.join(f.root, 'documentary-ai-query-plans', (await f.cacheFiles())[0]!);
    const cache = JSON.parse(await readFile(file, 'utf8'));
    cache.plans = {};
    const attempt = cache.attempts[0];
    attempt.status = 'invalid';
    if (mode === 'pending' || mode === 'uncertain') attempt.status = mode;
    if (mode === 'partial') { attempt.status = 'uncertain'; attempt.responseState = 'partial'; }
    if (mode === 'duplicate') attempt.rawResponse = JSON.stringify({ scenes: [entry('scene-0'), entry('scene-0')] });
    if (mode === 'wrong-id') attempt.rawResponse = JSON.stringify({ scenes: [entry('other-id')] });
    if (mode === 'bad-type') attempt.rawResponse = JSON.stringify({ scenes: [entry('scene-0', { imageQueries: ['first view', 'second view', null] })] });
    if (mode === 'truncated') attempt.rawResponse = `{"scenes":[${JSON.stringify(entry('scene-0'))},`;
    const payload = JSON.parse(attempt.request.payload);
    if (mode === 'context') payload.originalScript += ' Different script.';
    if (mode === 'request-text') payload.requestedScenes[0].narration = 'Different narration';
    if (mode === 'request-ids') attempt.ids.push('scene-0');
    attempt.request.payload = JSON.stringify(payload);
    if (attempt.status === 'invalid') cache.attempts.push(structuredClone(attempt)); // Already exhausted; no request is allowed.
    await writeFile(file, JSON.stringify(cache));
    const before = await readFile(file, 'utf8');
    assert.equal((await f.planner().readCached(project, scenes)).size, 0, mode);
    assert.equal(await readFile(file, 'utf8'), before, mode);
    await assert.rejects(f.planner().plan(project, scenes), /автоматического платного повтора нет|исчерпаны/, mode);
    assert.equal(f.calls.length, 1, `No new completion for ${mode}`);
    assert.equal(await readFile(file, 'utf8'), before, mode);
  }
});

test('an image plan with an unused reserve keeps its primary searches and replays completed old answers', async t => {
  const image = entry('scene-0', { subject: 'Wilfred Dowman', visualTarget: 'portrait of retired sea captain Wilfred Dowman',
    years: [], preferredKind: 'image', imageQueries: ['Wilfred Dowman captain portrait', 'Wilfred Dowman Cutty Sark'],
    videoQueries: [], fallbackVisualTarget: 'a retired sailing ship captain portrait', fallbackVideoQueries: [] });
  const f = await fixture(t, async () => JSON.stringify({ scenes: [image] }));
  const scenes = scenesOf('Captain Wilfred Dowman bought the Cutty Sark.'), project = projectOf(scenes);
  const result = await f.planner().plan(project, scenes);
  const requirement = result.get(image.sceneId)!;
  const { sceneId, ...fields } = image;
  assert.deepEqual(requirement.aiSearchPlan, { ...fields, version: 1, inputHash: requirement.aiSearchPlan!.inputHash,
    model: MODEL, fallbackVisualTarget: '',sceneInputHash:requirement.aiSearchPlan!.sceneInputHash });
  assert.deepEqual(requirement.queries, image.imageQueries);
  assert.equal(f.calls.length, 1, 'The original response needs no repair');

  const file = path.join(f.root, 'documentary-ai-query-plans', (await f.cacheFiles())[0]!);
  const cache = JSON.parse(await readFile(file, 'utf8'));
  delete cache.plans[sceneId];
  cache.attempts[0].status = 'invalid';
  const before = JSON.stringify(cache);
  await writeFile(file, before);
  assert.deepEqual(await f.planner().readCached(project, scenes), result);
  assert.deepEqual(await f.planner().plan(project, scenes), result);
  assert.equal(f.calls.length, 1, 'A previous rejection must not trigger a second submission');
  assert.equal(await readFile(file, 'utf8'), before);
});

test('an unused reserve cannot rescue a malformed primary plan or invalid reserve fields', async t => {
  const f = await fixture(t);
  const scenes = scenesOf('A ship portrait.'), project = projectOf(scenes);
  await f.planner().plan(project, scenes);
  const file = path.join(f.root, 'documentary-ai-query-plans', (await f.cacheFiles())[0]!);
  const cache = JSON.parse(await readFile(file, 'utf8'));
  cache.plans = {};
  cache.attempts[0].status = 'invalid';
  for (const invalid of [
    { imageQueries: [], videoQueries: [] }, { imageQueries: [null] }, { visualTarget: '' }, { years: ['unknown'] },
    { fallbackVisualTarget: null }, { fallbackVisualTarget: 'x'.repeat(501) },
    { fallbackVideoQueries: null }, { fallbackVideoQueries: ['ship at sea'], fallbackVisualTarget: '' },
  ]) {
    cache.attempts[0].rawResponse = JSON.stringify({ scenes: [entry('scene-0', { preferredKind: 'image',
      fallbackVideoQueries: [], fallbackVisualTarget: 'ship at sea', ...invalid })] });
    await writeFile(file, JSON.stringify(cache));
    assert.equal((await f.planner().readCached(project, scenes)).size, 0, JSON.stringify(invalid));
  }
});

test('decade years from a completed Cutty Sark plan normalize to ranges without buying a repair', async t => {
  const f = await fixture(t, async () => JSON.stringify({ scenes: [entry('scene-0', {
    subject: 'Cutty Sark', years: ['1869', '1860s', '1870s', '1870-1879'],
    imageQueries: ['Cutty Sark full sail painting'], videoQueries: ['Cutty Sark sailing'],
  })] }));
  const scenes = scenesOf('Cutty Sark raced to bring tea to London.');
  const project = projectOf(scenes);
  const plans = await f.planner().plan(project, scenes);
  assert.deepEqual(plans.get('scene-0')!.aiSearchPlan!.years, ['1869', '1860-1869', '1870-1879']);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(await f.planner().readCached(project, scenes), plans);
});

test('completed decade receipts recover beside saved plans even after repair exhaustion without rewriting or paying', async t => {
  const f = await fixture(t);
  const scenes = scenesOf('Cutty Sark was launched in 1869.', 'Tea clippers raced.', 'The ship sailed under full canvas.');
  const project = projectOf(scenes);
  await f.planner().plan(project, scenes);
  const file = path.join(f.root, 'documentary-ai-query-plans', (await f.cacheFiles())[0]!);
  const cache = JSON.parse(await readFile(file, 'utf8'));
  const preserved = structuredClone(cache.plans['scene-0']);
  delete cache.plans['scene-1'];
  delete cache.plans['scene-2'];
  cache.attempts[0].status = 'invalid';
  cache.attempts[0].rawResponse = JSON.stringify({ scenes: [entry('scene-0'),
    entry('scene-1', { years: ['1860s', '1870s'] }), entry('scene-2', { years: ['1870s'] })] });
  cache.attempts.push(structuredClone(cache.attempts[0]));
  await writeFile(file, JSON.stringify(cache));
  const before = await readFile(file, 'utf8');
  const cached = await f.planner().readCached(project, scenes);
  assert.equal(cached.size, 3);
  assert.deepEqual(cached.get('scene-0')!.aiSearchPlan, {...preserved,sceneInputHash:cached.get('scene-0')!.aiSearchPlan!.sceneInputHash});
  assert.deepEqual(cached.get('scene-1')!.aiSearchPlan!.years, ['1860-1869', '1870-1879']);
  assert.deepEqual(await f.planner().plan(project, scenes), cached);
  assert.equal(f.calls.length, 1, 'Already completed responses are reused even when repair attempts are exhausted');
  assert.equal(await readFile(file, 'utf8'), before, 'Keep raw answers, receipt status and canonical plans unchanged');
});

test('thirteen explicit years retain their meaning and recover exhausted completed receipts without payment', async t => {
  const years=Array.from({length:13},(_,index)=>String(1883+index));
  const f=await fixture(t,async()=>JSON.stringify({scenes:[entry('scene-0',{years})]}));
  const scenes=scenesOf('Cutty Sark carried wool from 1883 to 1895.'),project=projectOf(scenes);
  const plans=await f.planner().plan(project,scenes);
  assert.deepEqual(plans.get('scene-0')!.aiSearchPlan!.years,years);
  assert.equal(f.calls.length,1,'A valid year list needs no repair');
  const file=path.join(f.root,'documentary-ai-query-plans',(await f.cacheFiles())[0]!);
  const cache=JSON.parse(await readFile(file,'utf8'));
  cache.plans={};
  cache.attempts[0].status='invalid';
  // The live completed answer has a trailing scenes-array comma: accepted while streaming, too.
  cache.attempts[0].rawResponse=cache.attempts[0].rawResponse.replace(/\]\}$/,',]}');
  cache.attempts.push(structuredClone(cache.attempts[0]));
  await writeFile(file,JSON.stringify(cache));
  const before=await readFile(file,'utf8');
  assert.deepEqual(await f.planner().readCached(project,scenes),plans);
  assert.deepEqual(await f.planner().plan(project,scenes),plans);
  assert.equal(f.calls.length,1);
  assert.equal(await readFile(file,'utf8'),before,'Do not reset attempts or rewrite the paid raw answer');
});
