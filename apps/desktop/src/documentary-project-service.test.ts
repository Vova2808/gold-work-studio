import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { MemoryProjectRepository, MockDirectorProvider, ProjectService } from "@gold-work/core";
import { createVoiceCalibration, createDefaultProjectSettings } from "@gold-work/shared";
import { prepareDocumentaryScript } from "./documentary-plan.js";
import { DocumentarySearch } from "./documentary-search.js";
import { DocumentaryProjectService } from "./documentary-project-service.js";
import type {AutoStockSelectionResult,Project,Scene} from '@gold-work/shared';
import { LocalProjectStorage } from "./local-project-storage.js";
import { effectFfmpeg } from "./effect-media.js";
import { missingAssemblyInputs } from "./assembly-readiness.js";

test("local Stock import owns originals and metadata; review gates export and replacement preserves narration/audio", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-doc-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projects = new ProjectService(new MemoryProjectRepository(), new MockDirectorProvider());
  const storage = new LocalProjectStorage(join(root, "projects"));
  const service = new DocumentaryProjectService(projects, storage, new DocumentarySearch(), join(root, "Materials"), { download: async () => { throw new Error("No stock download expected"); } });
  let project = await projects.create({ title: "SS United States", topic: "Ships", mediaMode: "stock", mode: "standard", language: "English", aspectRatio: "16:9" });
  project.videoBrief = { creationMode: "script", readyScript: "SS United States crossed the Atlantic in 1952." } as NonNullable<typeof project.videoBrief>;
  const calibration = createVoiceCalibration({ provider: "elevenlabs", voice: "test", language: "en", sampleText: "A measured voice reads every word at a natural pace.", audioDurationSeconds: 5 });
  project.scenes = prepareDocumentaryScript(project, calibration);
  project.scenes[0]!.audioPath = "existing-narration.wav";
  project = await projects.mutate(project.id, () => project);
  const source = join(root, "source"); await mkdir(source);
  const image = join(source, "ship.png");
  await effectFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=blue:size=640x360", "-frames:v", "1", image]);
  const sceneId = project.scenes[0]!.id;
  const originalNarration = project.scenes.map(scene => scene.narration).join("");
  let result = await service.importMaterial(project.id, sceneId, { path: image, pageUrl: "https://example.org/ship", title: "SS United States", author: "Owner", license: "Owned photo", licenseUrl: "" });
  assert.equal(result.scenes[0]!.audioPath, "existing-narration.wav");
  assert.equal(result.scenes.map(scene => scene.narration).join(""), originalNarration);
  assert.notEqual(result.scenes[0]!.imagePath, image);
  assert.equal(result.scenes[0]!.documentary?.verified, false);
  assert.ok(missingAssemblyInputs(result).some(message => message.includes("подтвердите объект")));
  await assert.rejects(service.review(project.id, sceneId, { verified: true, illustrative: false, note: "", rightsConfirmed: false }), /условия/);
  result = await service.review(project.id, sceneId, { verified: true, illustrative: false, note: "Reviewed source and image", rightsConfirmed: true });
  assert.equal(result.scenes[0]!.documentary?.verified, true);
  assert.equal(result.scenes[0]!.documentary?.pinned, true);
  await rename(source, `${source}-offline`);
  assert.ok((await readFile(result.scenes[0]!.imagePath!)).byteLength > 0);
  const local = await service.localCandidates("SS United States");
  assert.equal(local.length, 1);
  assert.ok(local[0]!.localPath?.startsWith(join(root, "Materials")));
  assert.ok((await readFile(local[0]!.localPath!)).byteLength > 0);
  // This storage test accepts one selected shot; faster pacing may create additional shots.
  await projects.mutate(project.id, current => ({ scenes: current.scenes.map(scene => scene.id === sceneId ? scene : { ...scene, includeInAssembly: false }) }));
  assert.deepEqual((await service.autoSelect(project.id)).failures, []);
  await projects.mutate(project.id, () => ({ status: "generating" }));
  await assert.rejects(service.importMaterial(project.id, sceneId, { path: image, pageUrl: "", title: "Replacement", author: "", license: "", licenseUrl: "" }), /остановите/);
});

test('query repair and bounded supplement share the original attempt budget',async t=>{
  const budgetRoot=await mkdtemp(join(tmpdir(),'gws-supplement-budget-'));
  t.after(()=>rm(budgetRoot,{recursive:true,force:true}));
  const scene=(id:string,order:number,verified=false):Scene=>({id,order,title:id,imagePrompt:'',animationPrompt:'',
    durationSeconds:5,status:'ready',narration:`Motorcycle ${id}`,
    includeInAssembly:true,documentary:{verified,pinned:false,requirement:{text:`Motorcycle ${id}`,
      identities:[],entities:['motorcycle'],years:[],queries:[`motorcycle ${id}`],plannedBy:'semantic',
      scriptRequirements:{version:1,scriptText:`Motorcycle ${id}`,checks:[{id:'r1',kind:'object',scriptQuote:`Motorcycle ${id}`,required:`motorcycle ${id}`}],nonVisual:[]}}}} as unknown as Scene);
  let project={id:'resume-scope',settings:createDefaultProjectSettings(),scenes:[scene('ready',0,true),scene('changed',1),scene('unchanged',2)]} as Project;
  const projects={get:async()=>project,mutate:async(_id:string,change:(current:Project)=>Partial<Project>)=>{
    project={...project,...change(project)};return project;
  }};
  const calls:Array<{ids?:string[];session:unknown}>=[];
  const intelligence={refineQueries:async()=>new Map([['changed',['motorcycle racing track']]])};
  const storage={projectDirectory:()=>budgetRoot,ensureProject:async(saved:Project)=>{assert.equal(saved.id,project.id);return project.id;}};
  const service=new DocumentaryProjectService(projects as never,storage as unknown as LocalProjectStorage,
    {} as DocumentarySearch,'',{} as never,()=>{},intelligence as never);
  (service as unknown as {selectAll:(id:string,options:{sceneIds?:string[]},videoOnly:boolean,attempts:unknown,session:unknown)=>Promise<AutoStockSelectionResult>})
    .selectAll=async(_id,options,_videoOnly,_attempts,session)=>{
      calls.push({ids:options.sceneIds,session});
      if(!options.sceneIds)return {project,total:3,selected:0,skipped:1,failed:2,failures:[
        {sceneId:'changed',sceneNumber:2,category:'no-results',message:'not found'},
        {sceneId:'unchanged',sceneNumber:3,category:'no-results',message:'not found'}]};
      assert.deepEqual(options.sceneIds,['changed']);
      project={...project,scenes:project.scenes.map(item=>item.id==='changed'
        ?{...item,documentary:{...item.documentary!,verified:true}}:item)};
      return {project,total:2,selected:1,skipped:0,failed:1,failures:[{sceneId:'unchanged',sceneNumber:3,category:'no-results',message:'not found'}]};
    };
  const result=await service.autoSelect(project.id);
  assert.equal(calls.length,2);
  assert.equal(calls[0]!.session,calls[1]!.session);
  assert.equal(result.total,3);
  assert.equal(result.selected,1);
  assert.equal(result.failed,1);
  assert.deepEqual(result.failures.map(item=>item.sceneId),['unchanged']);
});

test('a budget flush failure releases the run lock so a repaired ledger can continue without restarting',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-budget-flush-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const path=join(root,'Documentary','selection-budget.json');
  let project={id:'flush',settings:createDefaultProjectSettings(),scenes:[]} as unknown as Project;
  const projects={get:async()=>project,mutate:async(_id:string,change:(p:Project)=>Partial<Project>)=>{
    project={...project,...change(project)};return project;
  }};
  const phases:string[]=[];
  const service=new DocumentaryProjectService(projects as never,
    {projectDirectory:()=>root,ensureProject:async()=>root} as never,{} as never,root,{} as never,event=>phases.push(event.phase));
  let calls=0,ledger='';
  (service as unknown as {selectAll:()=>Promise<AutoStockSelectionResult>}).selectAll=async()=>{
    if(++calls===1){ledger=await readFile(path,'utf8');await writeFile(path,'broken ledger');}
    return {project,total:0,selected:0,skipped:0,failed:0,failures:[]};
  };
  const first=service.autoSelect(project.id),sameRun=service.autoSelect(project.id);
  await Promise.all([assert.rejects(first,/сохранённый бюджет/),assert.rejects(sameRun,/сохранённый бюджет/)]);
  assert.equal(calls,1,'Concurrent callers wait for the same durable flush outcome');
  assert.equal(phases.at(-1),'failed');
  await writeFile(path,ledger);
  const resumed=await service.autoSelect(project.id);
  assert.equal(resumed.failed,0);assert.equal(calls,2);
});
