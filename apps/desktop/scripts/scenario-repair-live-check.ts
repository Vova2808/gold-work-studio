/** Opt-in live QA against a copy of a saved draft. No TTS, image jobs or user project writes. */
import assert from "node:assert/strict";
import {app} from "electron";
import {copyFileSync,mkdtempSync} from "node:fs";
import {readFile,mkdir,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {countNarrationCharacters,createNarrationTimingBudget,voiceCalibrationMatches,type Project,type ScenarioRepairCheckpoint,type Scene} from "@gold-work/shared";
import {AnyModelStore} from "../src/anymodel-store.js";
import {AnyModelClient} from "../src/anymodel-client.js";
import {proxyFetch} from "../src/proxy-utils.js";
const profile=join(process.env.APPDATA!,"@gold-work","desktop");
const isolated=mkdtempSync(join(tmpdir(),"gws-repair-qa-"));
copyFileSync(join(profile,"Local State"),join(isolated,"Local State"));
app.setPath("userData",isolated);
app.on("window-all-closed",()=>undefined);
const output=resolve("captures","scenario-repair-live",String(Date.now()));
const controller=new AbortController();
const deadlineAt=Date.now()+30*60_000;
const deadline=setTimeout(()=>controller.abort(new Error("Live QA deadline reached")),30*60_000);
let submissions=0;let checkpoint:Scene[]=[];let repair:ScenarioRepairCheckpoint|undefined;
const clean=(error:unknown)=>String(error instanceof Error?error.message:error).replace(/(?:https?|socks5h?):\/\/[^\s]+/gi,"[URL]").slice(0,1600);
app.whenReady().then(async()=>{
  assert.ok(process.env.GW_PROJECT_JSON,"GW_PROJECT_JSON must point to a saved draft");
  const project:Project=JSON.parse(await readFile(process.env.GW_PROJECT_JSON,"utf8"));
  const calibration=project.settings.voice.calibration;
  assert.ok(voiceCalibrationMatches(calibration,project.settings.voice.provider,project.settings.voice.voice,project.language));
  assert.ok(project.referenceAnalysis && project.status==="draft");
  checkpoint=project.scenes;
  repair=project.referenceAnalysis.scenarioRepair;
  if(process.env.GW_REPAIR_RESUME) {
    const saved=JSON.parse(await readFile(process.env.GW_REPAIR_RESUME,"utf8"));
    assert.equal(saved.sourceProjectId,project.id);
    checkpoint=saved.scenes;repair=saved.repair;
  }
  await mkdir(output,{recursive:true});
  console.log(`[scenario-repair-live] ${project.id}: ${checkpoint.length} saved scenes; output ${output}`);
  const save=()=>writeFile(join(output,"checkpoint.json"),JSON.stringify({sourceProjectId:project.id,scenes:checkpoint,repair},null,2));
  const transport:typeof proxyFetch=async(input,init={},proxy)=>{
    const url=new URL(input instanceof Request?input.url:input.toString());
    if(init.method?.toUpperCase()==="POST") {
      assert.match(url.pathname,/\/chat\/completions$/);
      if(Date.now()>deadlineAt-300_000) throw new Error("Live QA paused before submitting a request too close to its deadline; checkpoints retained");
      if(submissions>=24) throw new Error("Live QA submission cap reached");
      console.log(`[scenario-repair-live] completion ${++submissions}/24`);
    }
    return proxyFetch(input,init,proxy);
  };
  const client=new AnyModelClient(new AnyModelStore(join(profile,"credentials","anymodel.json")),transport);
  const auditClient=client as unknown as {auditScenarioCompleteness:(...args:unknown[])=>Promise<{complete:boolean;reason:string}>};
  const auditOriginal=auditClient.auditScenarioCompleteness.bind(client);
  let audits=0;
  auditClient.auditScenarioCompleteness=async(...args)=>{
    const audit=await auditOriginal(...args);
    await writeFile(join(output,`audit-${++audits}.json`),JSON.stringify(audit,null,2));
    if(audit.reason.startsWith("AI-аудит дважды")) throw new Error("Live semantic audit unavailable; local fallback is not live-provider acceptance");
    return audit;
  };
  const target=Math.round(project.settings.durationMinutes*60);
  const result=await client.regenerateScenes(project.referenceAnalysis,target,(_done,_total,stage)=>{if(stage)console.log(`[scenario-repair-live] ${stage}`);},
    project.referenceAnalysis.modelId,controller.signal,"local",async scenes=>{checkpoint=scenes;repair=undefined;await save();},
    createNarrationTimingBudget(calibration,target),checkpoint,"ai-story",{state:repair,onCheckpoint:async state=>{repair=state;await save();}});
  assert.equal(result.scenarioQuality?.complete,true);
  assert.equal(result.scenarioQuality?.endingResolved,true);
  const estimated=result.scenes.reduce((sum,s)=>sum+countNarrationCharacters(s.narration),0)/calibration.charactersPerSecond;
  assert.ok(Math.abs(estimated-target)<=target*0.05,`Estimated ${estimated}s exceeds ±5%`);
  assert.equal(result.scenes.length,project.scenes.length);
  await writeFile(join(output,"result.json"),JSON.stringify({sourceProjectId:project.id,submissions,estimatedSeconds:estimated,targetSeconds:target,result},null,2));
  console.log(`[scenario-repair-live] PASS: ${result.scenes.length} scenes, whole-story audit, estimated ${estimated.toFixed(1)}s/${target}s; ${submissions} completions`);
}).catch(async error=>{
  await mkdir(output,{recursive:true});
  await writeFile(join(output,"failure.json"),JSON.stringify({submissions,error:clean(error),scenes:checkpoint.length,repairedScenes:repair?.completedScenes.length},null,2));
  console.error(`[scenario-repair-live] STOP: ${clean(error)}. No automatic rerun. ${output}`);process.exitCode=1;
}).finally(()=>{clearTimeout(deadline);app.exit(process.exitCode??0);});
