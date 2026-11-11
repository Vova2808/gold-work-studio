import assert from 'node:assert/strict';
import test,{type TestContext} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {createVoiceCalibration,type DocumentarySearchInput,type DocumentaryAiSearchPlan} from '@gold-work/shared';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {DocumentarySearch} from './documentary-search.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {prepareDocumentaryScript} from './documentary-plan.js';
import {currentDocumentaryAiSearchPlan,documentaryAiPlanContext} from './documentary-ai-plan-state.js';
import {documentaryCommonsDiscoverySubjects} from './documentary-named-search.js';
import type {DocumentaryRequirement} from '@gold-work/shared';

type Mode='portrait'|'exact'|'multi'|'stale'|'existing';
const plannedQuery='Richard Woodget Cutty Sark captain portrait';
async function fixture(t:TestContext,mode:Mode,stopOnFetch=false){
  const root=await mkdtemp(join(tmpdir(),'gws-commons-caller-'));
  t.after(async()=>{assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));assert.ok(root.includes('gws-commons-caller-'));await rm(root,{recursive:true,force:true});});
  const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
  let project=await projects.create({title:'Cutty Sark',topic:'The captain',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
  const narration='Richard Woodget was the captain of the Cutty Sark.';
  project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:narration};
  project.settings.voice.enabled=false;project.settings.stockVideoPercent=0;
  project.settings.assembly.documentary!.autoMotionGraphics=false;project.settings.assembly.documentary!.autoEffects=false;
  const scene=prepareDocumentaryScript(project,createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:narration,audioDurationSeconds:4}))[0]!;
  scene.audioPath='saved-paid-voice.wav';scene.documentary!.selectionPlan={kind:'image',videoPercent:0};
  const subject=mode==='existing'?'Richard Woodget':'Richard Woodget, Cutty Sark captain';
  const visualTarget='portrait or illustration of Captain Richard Woodget';
  const scope=mode==='exact'?'exact':'illustrative';
  const aiSearchPlan:DocumentaryAiSearchPlan={version:1,inputHash:'',model:'fixture',subject,visualTarget,years:[],visualScope:scope,
    preferredKind:'image',imageQueries:[plannedQuery],videoQueries:[],fallbackVideoQueries:[],fallbackVisualTarget:''};
  scene.documentary!.requirement={text:narration,entities:[subject],identities:mode==='multi'?
    [{name:'Richard Woodget',aliases:[]},{name:'Cutty Sark',aliases:[]}]:[{name:subject,aliases:[]}],
    years:[],queries:[plannedQuery],detail:visualTarget,preferredKind:'image',visualScope:scope,
    aiSearchPlan:mode==='existing'?undefined:aiSearchPlan};
  project.scenes=[scene];
  const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  aiSearchPlan.inputHash=mode==='stale'?'stale':hash({inputHash:hash({version:1,model:'fixture',context:documentaryAiPlanContext(project)}),sceneId:scene.id});
  project=await projects.mutate(project.id,()=>project);
  assert.equal(Boolean(currentDocumentaryAiSearchPlan(project,scene)),!['stale','existing'].includes(mode));
  const before=structuredClone(scene.documentary!.requirement),receipt=join(root,'guarded.json');
  await writeFile(receipt,'{"state":"partial","raw":"do not replay"}');
  const inputs:DocumentarySearchInput[]=[],nativeQueries:string[]=[],perSearchGets:number[]=[],publicQueries:string[]=[];
  let service:DocumentaryProjectService;
  const native=new DocumentarySearch(undefined,async(url,options)=>{
    nativeQueries.push(new URL(String(url)).searchParams.get('gsrsearch')!);assert.ok(options?.signal);
    if(stopOnFetch)await service.stop(project.id);
    return Response.json({query:{pages:[]}});
  },undefined,undefined,undefined,{search:async()=>assert.fail('Use source-specific fallback'),
    searchWithSources:async(query,_kind,_signal,source)=>{assert.equal(source,'commons');publicQueries.push(query);return {candidates:[],errors:[]};}});
  const search=new DocumentarySearch();search.search=async(input,licensed,signal,independent)=>{
    inputs.push(structuredClone(input));
    if(!input.providers?.includes('commons'))return {candidates:[],sources:[]};
    assert.equal(independent,true);assert.equal(licensed,true);
    const count=nativeQueries.length;
    try{return await native.search(input,licensed,signal,independent);}finally{perSearchGets.push(nativeQueries.length-count);}
  };
  service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,'projects')),search,join(root,'materials'),
    {download:async()=>assert.fail('Discovery-only fixture never downloads')},()=>{},
    {simpleSelection:true,available:async()=>true,plan:async()=>new Map(),inspect:async()=>assert.fail('No paid review in discovery fixture')});
  service.localCandidates=async()=>[];Reflect.set(service,'selectionResources',async()=>({workers:1}));
  let error:unknown;
  try{await service.autoSelect(project.id,{sceneIds:[scene.id]});}catch(cause){error=cause;}
  const saved=(await projects.get(project.id))!.scenes[0]!;
  assert.equal(saved.audioPath,'saved-paid-voice.wav');assert.equal(saved.narration,narration);
  assert.deepEqual(saved.documentary!.requirement.aiSearchPlan,before.aiSearchPlan);
  assert.deepEqual(saved.documentary!.requirement.identities,before.identities);
  assert.deepEqual(saved.documentary!.requirement.entities,before.entities);
  assert.equal(saved.documentary!.requirement.detail,before.detail);
  assert.equal(saved.documentary!.verified,false);assert.equal(await readFile(receipt,'utf8'),'{"state":"partial","raw":"do not replay"}');
  assert.ok(inputs.filter(input=>!input.providers?.includes('commons')).every(input=>!input.entities?.length),'Other simple-selection providers retain their original entities=[] contract');
  assert.ok(perSearchGets.every(count=>count<=2),'Each Commons invocation retains its two-GET budget');
  return {inputs,nativeQueries,perSearchGets,publicQueries,error};
}

test('ordinary simpleSelection forwards current projected identity to Commons title search and subject fallback',async t=>{
  const result=await fixture(t,'portrait');assert.equal(result.error,undefined);
  const commons=result.inputs.filter(input=>input.providers?.includes('commons'));
  assert.ok(commons.length);assert.deepEqual(commons[0]!.entities,['Richard Woodget']);
  assert.deepEqual(result.nativeQueries,['intitle:"Richard Woodget"','"Richard Woodget"']);
  assert.deepEqual(result.perSearchGets,[2]);assert.equal(result.publicQueries.length,1);
});

test('ordinary Commons exact portrait keeps its identity while using a canonical discovery name',async t=>{
  const result=await fixture(t,'exact');assert.equal(result.error,undefined);
  const commons=result.inputs.filter(input=>input.providers?.includes('commons'));
  assert.ok(commons.length);assert.deepEqual(commons[0]!.entities,['Richard Woodget']);
  assert.ok(result.nativeQueries.includes('"Richard Woodget"'));
});

test('ordinary Commons multi-identity requirement never picks a single portrait identity',async t=>{
  const result=await fixture(t,'multi');assert.equal(result.error,undefined);
  const commons=result.inputs.filter(input=>input.providers?.includes('commons'));
  assert.ok(commons.length);assert.deepEqual(commons[0]!.entities,[]);
  assert.ok(result.perSearchGets.every(count=>count<=1));
  assert.ok(!result.nativeQueries.includes('"Richard Woodget"'));
});

test('ordinary Commons never projects identity from a stale AI plan',async t=>{
  const result=await fixture(t,'stale');assert.equal(result.nativeQueries.length,0);
  assert.equal(result.inputs.filter(input=>input.providers?.includes('commons')).length,0);
});

test('ordinary Commons without a validated current AI plan does not invent a canonical target',async t=>{
  const result=await fixture(t,'existing');assert.equal(result.error,undefined);
  const commons=result.inputs.filter(input=>input.providers?.includes('commons'));
  assert.ok(commons.length);assert.deepEqual(commons[0]!.entities,[]);
});

test('Stop during ordinary native Commons prevents the subject GET and public fallback',async t=>{
  const result=await fixture(t,'portrait',true);
  assert.equal(result.nativeQueries.length,1);assert.equal(result.publicQueries.length,0);
});

test('Commons identity helper preserves projection safeguards, canonical model discriminators and original requirements',()=>{
  const make=(subject:string,target:string,query:string,aliases:string[]=[],scope:'exact'|'illustrative'='illustrative'):DocumentaryRequirement=>({
    text:'Fixture narration',entities:[subject],identities:[{name:subject,aliases}],years:['1869'],queries:[query],detail:target,
    aiSearchPlan:{version:1,inputHash:'fixture',model:'fixture',subject,visualTarget:target,years:['1869'],visualScope:scope,
      preferredKind:'image',imageQueries:[query],videoQueries:[],fallbackVideoQueries:[],fallbackVisualTarget:''}});
  const object=make('Captain George Moodie, Cutty Sark','Preserved Cutty Sark at Greenwich, illustrating the ship under Captain Moodie','Cutty Sark ship');
  const before=structuredClone(object);
  assert.deepEqual(documentaryCommonsDiscoverySubjects(object,object.aiSearchPlan,'Cutty Sark ship'),['Cutty Sark']);
  assert.deepEqual(object,before);
  const exact={...object,aiSearchPlan:{...object.aiSearchPlan!,visualScope:'exact' as const}};
  assert.deepEqual(documentaryCommonsDiscoverySubjects(exact,exact.aiSearchPlan,'Cutty Sark ship'),[],'Exact mixed identity must not switch to its incidental object');
  assert.deepEqual(documentaryCommonsDiscoverySubjects(object,undefined,'Cutty Sark ship'),[]);
  assert.deepEqual(documentaryCommonsDiscoverySubjects(object,{...object.aiSearchPlan!},'Cutty Sark ship'),[]);
  assert.deepEqual(documentaryCommonsDiscoverySubjects(object,object.aiSearchPlan,'Other ship'),[]);
  for(const [name,alias,target,query] of [
    ['Airbus A320','Airbus, passenger aircraft','Airbus A380 aircraft','Airbus A380 aircraft'],
    ['Airbus A320','Aircraft','Aircraft at a museum','Airbus A320 aircraft'],
    ['Nikon D850','Nikon','Nikon camera','Nikon camera'],
    ['Airbus A320-200','Airbus A320','Airbus A320 aircraft','Airbus A320 aircraft']
  ]){
    const requirement=make(name!,target!,query!,[alias!]);
    assert.deepEqual(documentaryCommonsDiscoverySubjects(requirement,requirement.aiSearchPlan,query!),[],name);
  }
  const model=make('Airbus A320-200','Airbus A320-200 cockpit','Airbus A320-200 cockpit',['Airbus']);
  assert.deepEqual(documentaryCommonsDiscoverySubjects(model,model.aiSearchPlan,'Airbus A320-200 cockpit'),['Airbus A320-200']);
});
