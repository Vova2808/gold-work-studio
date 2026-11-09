import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {MemoryProjectRepository, MockDirectorProvider, ProjectService} from "@gold-work/core";
import {projectScenarioQualityIssue, type Scene, type ReferenceAnalysis, type ScenarioRepairCheckpoint, type ScenarioRepairPlan, type ScenarioRepairAudit} from "@gold-work/shared";
import {AnyModelClient, inspectScenarioReadiness} from "./anymodel-client.js";
import {createScenarioDraftGuard, scenarioRepairCheckpointPatch, validScenarioRepairCheckpoint} from "./scenario-repair.js";
import {FileProjectRepository} from "./file-project-repository.js";
import {mergeScenarioDraft} from "../../renderer/src/scenario-draft-merge.js";
import {mergeProjectEditorDraft} from "../../renderer/src/project-editor-merge.js";
import {createDefaultProjectSettings, type Project} from "@gold-work/shared";

const plan: ScenarioRepairPlan = {title:"History",promise:"Resolve",tone:"Clear",visualBible:"Watercolor",continuityRules:[],requiredBeats:[],endingResolution:"Return home",
  sections:[{title:"Journey",goal:"Return home",keyPoints:["Find the road"],transition:"Arrival"}]};
const audit: ScenarioRepairAudit = {complete:false,endingResolved:false,missingRequiredBeats:[],unresolvedSetups:["Days contradict"],rewriteFromScene:61,reason:"Correct chronology"};

test("settings adopt backend voice/scenes without overwriting real nested user edits",()=>{
  const base:Project={id:"settings-merge",title:"Before",topic:"Story",aspectRatio:"16:9",language:"Русский",mode:"standard",
    status:"draft",createdAt:"before",updatedAt:"before",settings:createDefaultProjectSettings(),scenes:[]};
  base.settings.voice.enabled=false;
  const local=structuredClone(base),incoming=structuredClone(base);
  local.settings.image.style="Local watercolor";
  incoming.title="Backend title";
  incoming.settings.voice.enabled=true;
  incoming.settings.image.style="Remote style";
  incoming.settings.image.references=["new-reference.png"];
  incoming.status="complete";incoming.outputPath="Final.mp4";
  incoming.scenes=[{id:"new-scene",order:0,title:"Repaired",narration:"Repaired text",imagePrompt:"Scene",animationPrompt:"Pan",durationSeconds:5,status:"ready"}];
  const merged=mergeProjectEditorDraft(local,base,incoming);
  assert.equal(merged.settings.voice.enabled,true);
  assert.equal(merged.settings.image.style,"Local watercolor");
  assert.deepEqual(merged.settings.image.references,["new-reference.png"]);
  assert.equal(merged.title,"Backend title");
  assert.deepEqual(merged.scenes,incoming.scenes);assert.equal(merged.outputPath,"Final.mp4");
  assert.equal(local.settings.voice.enabled,false,"Do not mutate the local snapshot");
  const next=structuredClone(incoming);next.settings.image.style="Next remote style";
  assert.equal(mergeProjectEditorDraft(merged,incoming,next).settings.image.style,"Local watercolor","Keep unsaved edits across repeated polls");
  assert.deepEqual(mergeProjectEditorDraft(local,base,{...incoming,id:"another-project"}),{...incoming,id:"another-project"});
});
const source = (): Scene[] => Array.from({length:156},(_,order)=>({id:`s-${order}`,order,title:`Scene ${order+1}`,
  narration:`Person ${order+1} sees the next town and follows the path.`,imagePrompt:`Watercolor town ${order+1}`,
  animationPrompt:`Slow camera pan ${order+1}`,durationSeconds:5,status:"draft"}));
const analysis = (scenes:Scene[]): ReferenceAnalysis => ({sourceUrl:"qa://scenario",sourceTitle:"History",niche:"AI Story",targetAudience:"Adults",hook:"Journey",structure:[],strengths:[],improvements:[],suggestedTitle:"History",suggestedAngle:"Journey",recommendedDurationSeconds:780,language:"English",scenes,provider:"anymodel:test"});
type Execution = {contextFingerprint:string;state?:ScenarioRepairCheckpoint;onCheckpoint?:(state:ScenarioRepairCheckpoint|undefined)=>void|Promise<void>};
type Chat = (model:string,messages:Array<{role:string;content:string}>,maxTokens?:number)=>Promise<string>;
function harness() {
  const client = new AnyModelClient({publicSettings:async()=>({textModel:"test"})} as never);
  const internal = client as unknown as {chat:Chat;repairIncompleteScenario:(...args:[ScenarioRepairPlan,Scene[],number[],string,string,ScenarioRepairAudit,ReturnType<typeof inspectScenarioReadiness>,string,undefined,((scenes:Scene[])=>void|Promise<void>)|undefined,undefined,number,boolean,Execution])=>Promise<Scene[]>};
  const scenes=source();
  const repair=(execution:Execution,onCommit?:(scenes:Scene[])=>void|Promise<void>)=>internal.repairIncompleteScenario(plan,scenes,scenes.map(s=>s.durationSeconds),"English","A linear journey",audit,inspectScenarioReadiness(scenes,780),"test",undefined,onCommit,undefined,0,false,execution);
  return {client,internal,scenes,repair};
}
const contract=JSON.stringify({chronology:["Day one departure","Day seven return"],inventory:["Own bicycle"],continuityRules:["One traveller"],endingResolution:"Return home",
  sceneBeats:Array.from({length:96},(_,index)=>({sceneNumber:index+61,beat:`Unique step ${index+61} of the journey`}))});
test("renderer shows repaired narration with unchanged IDs and preserves only genuine unsaved edits",()=>{
  const previous=source().slice(0,3),incoming=structuredClone(previous),local=structuredClone(previous);
  incoming[0]!.narration="New coherent beginning";incoming[1]!.imagePrompt="New consistent style";
  assert.deepEqual(mergeScenarioDraft(local,previous,incoming),incoming);
  local[0]!.title="My title";local[1]!.narration="My unsaved narration";
  const merged=mergeScenarioDraft(local,previous,incoming);
  assert.equal(merged[0]!.title,"My title");assert.equal(merged[0]!.narration,"New coherent beginning");
  assert.equal(merged[1]!.narration,"My unsaved narration");assert.equal(merged[1]!.imagePrompt,"New consistent style");
  assert.equal(mergeScenarioDraft([],previous,incoming).length,0,"Do not resurrect locally deleted scenes");
});
test("checkpoint/final commit guard preserves concurrent manual edits without blocking our own saved progress",()=>{
  const scenes=source();const guard=createScenarioDraftGuard(scenes);
  guard.assertCurrent({scenes});
  const saved=structuredClone(scenes);saved[60]!.narration="Repaired by the current operation";
  guard.saved(saved);guard.assertCurrent({scenes:saved});
  const edited=structuredClone(saved);edited[60]!.narration="Manual edit during final audit";
  assert.throws(()=>guard.assertCurrent({scenes:edited}),/Ручные правки сохранены/);
});
function response(messages:Array<{role:string;content:string}>,short=false) {
  if(messages[0]!.content.includes("ПЛАН СОГЛАСОВАННОГО ИСПРАВЛЕНИЯ")) return contract;
  const match=/Исправь только сцены (\d+)–(\d+)/.exec(messages[1]!.content)!;
  assert.ok(match,"Explicit bounded repair range");
  const start=Number(match[1]),end=Number(match[2]);
  assert.ok(end-start<12);
  return JSON.stringify(Array.from({length:short?7:end-start+1},(_,i)=>({sceneNumber:start+i,title:`Repaired ${start+i}`,
    narration:`Traveller ${start+i} follows the agreed chronology, finds evidence and proceeds toward home.`,
    imagePrompt:`Watercolor traveller ${start+i}`,animationPrompt:`Slow pan ${start+i}`,stockQuery:"traveller"})));
}

test("156 scenes: a 96-scene repair uses a fixed contract, <=12 objects and one atomic commit",async()=>{
  const {internal,scenes,repair}=harness(); const original=structuredClone(scenes);
  const requests:string[]=[]; const checkpoints:ScenarioRepairCheckpoint[]=[]; let commits=0;
  internal.chat=async(_model,messages,tokens)=>{
    assert.ok(tokens!<=9300); requests.push(messages[1]!.content);
    if(requests.length>1) {
      assert.ok(messages[1]!.content.includes("Day seven return"));
      assert.match(messages[1]!.content,/ОБЯЗАТЕЛЬНЫЙ ПОКАДРОВЫЙ ПЛАН/);
      assert.doesNotMatch(messages[1]!.content,/ИСХОДНЫЕ СЦЕНЫ|СЕКЦИИ ТЕКУЩЕГО ДИАПАЗОНА/);
    }
    // The first batch returns 7/12: accept these numbered scenes, then start at 68.
    return response(messages,requests.length===2);
  };
  const result=await repair({contextFingerprint:"context",onCheckpoint:state=>{if(state) checkpoints.push(state);}},()=>{commits++;});
  assert.equal(commits,1); assert.equal(result.length,156); assert.deepEqual(scenes,original);
  assert.deepEqual(result.slice(0,60),original.slice(0,60));
  assert.equal(checkpoints[1]!.completedScenes.length,7);
  assert.match(requests[2]!,/Исправь только сцены 68–79/);
  assert.equal(checkpoints.at(-1)!.completedScenes.length,96);
  assert.deepEqual(result.map(s=>s.id),scenes.map(s=>s.id));
  assert.ok(checkpoints.every(s=>validScenarioRepairCheckpoint(s,scenes,"context")));
});

test("uncertain completion stops; durable repair resumes without replanning or rewriting accepted scenes",async()=>{
  const {internal,scenes,repair}=harness(); let state:ScenarioRepairCheckpoint|undefined;let calls=0,commits=0;
  internal.chat=async(_model,messages)=>{calls++; if(calls===3) throw new Error("AnyModelCompletionUncertainError: disconnected");return response(messages);};
  await assert.rejects(repair({contextFingerprint:"context",onCheckpoint:value=>{state=structuredClone(value);}},()=>{commits++;}),/Сохранено 12 из 96.*исходные 156 сцен не потеряны/);
  assert.equal(calls,3); assert.equal(commits,0); assert.equal(state!.completedScenes.length,12);
  const repository=new MemoryProjectRepository(); const service=new ProjectService(repository,new MockDirectorProvider());
  let project=await service.create({title:"Test",topic:"Journey",language:"English",mode:"standard",aspectRatio:"16:9"});
  project=await service.mutate(project.id,()=>({scenes,status:"draft",referenceAnalysis:analysis(scenes)}));
  project=await service.mutate(project.id,current=>scenarioRepairCheckpointPatch(current,state));
  // Simulate the exact JSON boundary used for project.json and process restart.
  const restored=JSON.parse(JSON.stringify(project));
  assert.deepEqual(restored.scenes,scenes);
  assert.equal(projectScenarioQualityIssue(restored),"missing");
  state=restored.referenceAnalysis.scenarioRepair;
  assert.equal(validScenarioRepairCheckpoint(state,scenes,"context"),true);
  const directory=await mkdtemp(join(tmpdir(),"gws-repair-storage-test-"));
  try {
    const file=join(directory,"projects.json");
    const disk=new FileProjectRepository(file);
    await disk.save(restored);
    const restarted=new ProjectService(new FileProjectRepository(file),new MockDirectorProvider());
    const loaded=await restarted.get(project.id);
    assert.deepEqual(loaded?.referenceAnalysis?.scenarioRepair,state,"Repair must survive real disk persistence and service restart");
    assert.deepEqual(loaded?.scenes,scenes,"Active draft must remain unchanged on disk");
  } finally {await rm(directory,{recursive:true,force:true});}
  assert.equal(validScenarioRepairCheckpoint(state,scenes,"changed-model-or-style"),false);
  const changed=structuredClone(scenes);changed[0]!.narration="Edited by user";
  assert.equal(validScenarioRepairCheckpoint(state,changed,"context"),false);
  assert.throws(()=>scenarioRepairCheckpointPatch({...project,scenes:changed},state),/не перезаписана/);
  let remainingCalls=0;
  internal.chat=async(_model,messages)=>{remainingCalls++;assert.ok(!messages[0]!.content.includes("ПЛАН СОГЛАСОВАННОГО ИСПРАВЛЕНИЯ"));
    if(remainingCalls===1) assert.match(messages[1]!.content,/Исправь только сцены 73–84/);return response(messages);};
  const result=await repair({state,contextFingerprint:"context"},()=>{commits++;});
  assert.equal(remainingCalls,7);assert.equal(commits,1);assert.equal(result.length,156);
});

test("wrong scene numbers never replace the user's draft or create a successful checkpoint",async()=>{
  const {internal,repair}=harness();let calls=0,state:ScenarioRepairCheckpoint|undefined,commits=0;
  internal.chat=async(_model,messages)=>{calls++;const raw=response(messages);if(calls===1)return raw;
    const scenes=JSON.parse(raw);scenes[1].sceneNumber=scenes[0].sceneNumber;return JSON.stringify(scenes);};
  await assert.rejects(repair({contextFingerprint:"context",onCheckpoint:value=>{state=value;}},()=>{commits++;}),/Некорректный диапазон 61–72/);
  assert.equal(calls,2);assert.equal(state!.completedScenes.length,0);assert.equal(commits,0);
});

test("an incomplete or duplicate beat plan never starts paid scene writing",async()=>{
  for(const duplicate of [false,true]) {
    const {internal,repair}=harness();let calls=0,checkpoints=0;
    internal.chat=async()=>{
      calls++;const parsed=JSON.parse(contract);
      if(duplicate)parsed.sceneBeats[1].sceneNumber=parsed.sceneBeats[0].sceneNumber;
      else parsed.sceneBeats.pop();
      return JSON.stringify(parsed);
    };
    await assert.rejects(repair({contextFingerprint:"context",onCheckpoint:()=>{checkpoints++;}}),/покадровый план/);
    assert.equal(calls,1);assert.equal(checkpoints,0);
  }
});

test("disk checkpoint failure must not claim that in-memory repair scenes were saved",async()=>{
  const {internal,repair}=harness();let calls=0;
  internal.chat=async(_model,messages)=>{calls++;return response(messages);};
  await assert.rejects(repair({contextFingerprint:"context",onCheckpoint:state=>{
    if(state?.completedScenes.length) throw new Error("Disk write failed");
  }}),/Сохранено 0 из 96.*Disk write failed/);
  assert.equal(calls,2,"Do not write the next range after storage failure");
});

test("resumed long repair still requires a fresh whole-story audit before production approval",async()=>{
  const {client,internal,scenes,repair}=harness();let state:ScenarioRepairCheckpoint|undefined;let calls=0;
  internal.chat=async(_model,messages)=>{if(++calls===3)throw new Error("offline");return response(messages);};
  // Obtain the real context hash without issuing any provider requests.
  const {scenarioRepairContextFingerprint}=await import("./scenario-repair.js");
  const input=analysis(scenes);
  const contextFingerprint=scenarioRepairContextFingerprint({model:"test",targetSeconds:780,language:input.language,instructions:"",title:input.suggestedTitle,angle:input.suggestedAngle,hook:input.hook,structure:input.structure,narrationTiming:undefined,sceneTiming:"ai-story"});
  await assert.rejects(repair({contextFingerprint,onCheckpoint:value=>{state=value;}}));
  internal.chat=async(_model,messages)=>response(messages);
  const methods=client as unknown as {createScenarioPlan:()=>never;auditScenarioCompleteness:()=>Promise<ScenarioRepairAudit>};
  methods.createScenarioPlan=()=>{throw new Error("Saved plan must be reused");};
  let audits=0;methods.auditScenarioCompleteness=async()=>{audits++;throw new Error("Final audit unavailable");};
  await assert.rejects(client.regenerateScenes(input,780,undefined,"test",undefined,"local",undefined,undefined,scenes,"ai-story",{state}),/Final audit unavailable/);
  assert.equal(audits,1);assert.equal(input.scenarioQuality,undefined);
});
