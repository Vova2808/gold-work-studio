import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ProjectService, MockDirectorProvider } from "@gold-work/core";
import type { Project } from "@gold-work/shared";
import { FileProjectRepository } from "../src/file-project-repository.js";
import { LocalProjectStorage } from "../src/local-project-storage.js";
import { atomicWrite } from "../src/fs-utils.js";
const profile = "C:/Users/rosup/AppData/Roaming/@gold-work/desktop";
const key=process.argv[2];
assert.ok(key&&/^\d+(?:-\d+)*$/.test(key),"Specify the independently reviewed scene group, for example 35");
const numbers=key.split("-").map(Number);
const proposal: Project = JSON.parse(await readFile(resolve("captures/stock-selection-live",key,"project.json"),"utf8"));
const service = new ProjectService(new FileProjectRepository(join(profile,"projects.json")),new MockDirectorProvider());
const storage = new LocalProjectStorage(join(profile,"workspace","projects"));
const original = (await service.get(proposal.id))!;
const targets = original.scenes.filter(s=>numbers.includes(s.order+1));
assert.equal(targets.length,numbers.length);
for(const old of targets){const next=proposal.scenes.find(s=>s.id===old.id)!;assert.equal(old.documentary?.pinned,false);assert.equal(next.narration,old.narration);assert.equal(next.audioPath,old.audioPath);assert.equal(next.documentary?.verified,true);assert.equal(next.documentary?.visualReview?.status,"accepted");assert.ok((await stat(next.videoPath!)).size>0);assert.ok((await stat(next.imagePath!)).size>0);}
const backup=join(storage.projectDirectory(original.id),"Documentary","Backups",`selection-${Date.now()}.json`);
await atomicWrite(backup,JSON.stringify({projectId:original.id,updatedAt:original.updatedAt,scenes:targets},null,2));
const updated=await service.mutate(original.id,current=>{
  assert.equal(current.updatedAt,original.updatedAt,"Project changed during review; preserve concurrent edits");
  return {status:"ready",scenes:current.scenes.map(old=>{
    if(!targets.some(t=>t.id===old.id))return old;
    const next=proposal.scenes.find(s=>s.id===old.id)!;
    return {...old,videoPath:next.videoPath,imagePath:next.imagePath,trimStartSeconds:next.trimStartSeconds,trimEndSeconds:next.trimEndSeconds,stockSource:next.stockSource,
      documentary:{...old.documentary!,selected:next.documentary!.selected,checksum:next.documentary!.checksum,visualHash:next.documentary!.visualHash,visualReview:next.documentary!.visualReview,reviewNote:next.documentary!.reviewNote,verified:true,autoError:undefined}};
  })};
});
await storage.ensureProject(updated);
assert.deepEqual(updated.scenes.map(s=>[s.narration,s.audioPath,s.documentary?.pinned]),original.scenes.map(s=>[s.narration,s.audioPath,s.documentary?.pinned]));
console.log(JSON.stringify({replaced:numbers,backup,scenes:updated.scenes.length,voiceAndPinsUnchanged:true,sourceFilesDeleted:0}));
