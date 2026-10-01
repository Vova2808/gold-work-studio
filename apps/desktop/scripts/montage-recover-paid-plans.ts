import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {ProjectService,MockDirectorProvider} from '@gold-work/core';
import type {Project} from '@gold-work/shared';
import {FileProjectRepository} from '../src/file-project-repository.js';
import {DocumentaryProjectService} from '../src/documentary-project-service.js';
import {LocalProjectStorage} from '../src/local-project-storage.js';
import {DocumentarySearch} from '../src/documentary-search.js';
import {readDocumentaryContextRecovery} from '../src/documentary-plan-recovery.js';

// Invoke the application's normal local planning/recovery path. No completion
// client is supplied, so this check cannot submit a paid request.
const registry='C:/Users/rosup/AppData/Roaming/@gold-work/desktop/projects.json';
const out=resolve('captures/montage-speed-20260927/new-production/context-recovery');await mkdir(out,{recursive:true});
const id='project_mukba0q1_0cubga6',storage=new LocalProjectStorage('D:/GoldWorkStorage/projects');
const projects=new ProjectService(new FileProjectRepository(registry),new MockDirectorProvider());
const before=(JSON.parse(await readFile(registry,'utf8')) as Project[]),p=before.find(p=>p.id===id)!;
assert.ok(p&&!['generating','paused'].includes(p.status));
assert.ok(p.scenes.every(s=>s.documentary?.requirement.plannedBy==='semantic'));
const backup=join(out,`project-before-${Date.now()}.json`);await writeFile(backup,JSON.stringify(p,null,2));
const hash=(data:string|Buffer)=>createHash('sha256').update(data).digest('hex');
const voiceHashes=await Promise.all(p.scenes.filter(s=>s.audioPath).map(async s=>({path:s.audioPath!,hash:hash(await readFile(s.audioPath!))})));
const analysis=join(storage.projectDirectory(id),'Documentary','Analysis');
const checkpoints=await Promise.all((await readdir(analysis)).filter(n=>n.endsWith('.json')).map(async name=>({name,hash:hash(await readFile(join(analysis,name)))})));
const service=new DocumentaryProjectService(projects,storage,new DocumentarySearch(),'D:/GoldWorkStorage/Materials',
  {download:async()=>{throw new Error('Recovery must not download media');}});
const restored=await service.planSearch(id);await storage.ensureProject(restored);
const after=JSON.parse(await readFile(registry,'utf8')) as Project[];
for(const old of before.filter(x=>x.id!==id))assert.deepEqual(after.find(x=>x.id===old.id),old);
assert.deepEqual(restored.settings,p.settings);assert.equal(restored.videoBrief?.readyScript,p.videoBrief?.readyScript);
for(const old of p.scenes){const current=restored.scenes.find(s=>s.id===old.id)!;
  for(const key of ['narration','audioPath','imagePath','videoPath','trimStartSeconds','trimEndSeconds'] as const)assert.equal(current[key],old[key]);
  assert.deepEqual(current.documentary?.selected,old.documentary?.selected);
  assert.deepEqual(current.documentary?.effects,old.documentary?.effects);
  assert.deepEqual(current.documentary?.motionGraphic,old.documentary?.motionGraphic);
}
for(const voice of voiceHashes)assert.equal(hash(await readFile(voice.path)),voice.hash);
for(const checkpoint of checkpoints)assert.equal(hash(await readFile(join(analysis,checkpoint.name))),checkpoint.hash);
const ledger=await readDocumentaryContextRecovery(storage.projectDirectory(id));
const report={checkedAt:new Date().toISOString(),projectId:id,backup,newPaidCalls:0,
  repaired:Object.keys(ledger.scenes).length,verifiedBefore:p.scenes.filter(s=>s.documentary?.verified).length,
  verifiedAfter:restored.scenes.filter(s=>s.documentary?.verified).length,voicesPreserved:voiceHashes.length,
  checkpointsPreserved:checkpoints.length,otherProjectsPreserved:before.length-1,settingsPreserved:true,
  scenes:restored.scenes.filter(s=>ledger.scenes[s.id]).map(s=>({order:s.order,narration:s.narration,
    oldQueries:ledger.scenes[s.id]!.previous.queries,restoredQueries:s.documentary!.requirement.queries}))};
await writeFile(join(out,'result.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,scenes:undefined},null,2));
