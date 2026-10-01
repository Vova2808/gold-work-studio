import {copyFile,readFile,mkdir,writeFile,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import assert from 'node:assert/strict';
import {ProjectService,MockDirectorProvider} from '@gold-work/core';
import {FileProjectRepository} from '../src/file-project-repository.js';

const mode=process.argv[2];assert.ok(mode==='before'||mode==='after');
const out=resolve('captures/montage-speed-20260927/new-production/motorcycle-live-20261001');
const scratch=join(out,`mutation-${mode}-scratch`);await mkdir(scratch,{recursive:true});
const path=join(scratch,'registry.json');await copyFile(join(process.env.APPDATA!,'@gold-work/desktop/projects.json'),path);
const repo=new FileProjectRepository(path),projects=new ProjectService(repo,new MockDirectorProvider());
const id='project_mun42rx8_1jcven5',original=(await projects.get(id))!;
const evidence=original.scenes.map(s=>({id:s.id,narration:s.narration,audio:s.audioPath,doc:s.documentary}));
let peakRss=process.memoryUsage().rss,peakHeap=process.memoryUsage().heapUsed,maxLag=0,last=performance.now();
const timer=setInterval(()=>{const m=process.memoryUsage();peakRss=Math.max(peakRss,m.rss);peakHeap=Math.max(peakHeap,m.heapUsed);const now=performance.now();maxLag=Math.max(maxLag,now-last-20);last=now;},20);
const start=performance.now();
for(let i=0;i<8;i++){
  const sceneId=original.scenes[i]!.id;
  await projects.mutate(id,p=>({scenes:p.scenes.map(s=>s.id===sceneId?{...s,imagePrompt:`mutation-benchmark-${i}`}:s)}),mode==='after'?{candidateSceneIds:[sceneId]}:undefined);
}
const elapsedMs=performance.now()-start;clearInterval(timer);
const saved=(await projects.get(id))!;
assert.deepEqual(saved.scenes.map(s=>({id:s.id,narration:s.narration,audio:s.audioPath,doc:s.documentary})),evidence);
assert.deepEqual(saved.settings,original.settings);
assert.ok(saved.scenes.slice(0,8).every((s,i)=>s.imagePrompt===`mutation-benchmark-${i}`));
const result={at:new Date().toISOString(),mode,elapsedMs,mutations:8,peakRssMB:peakRss/1048576,peakHeapMB:peakHeap/1048576,maxEventLoopDelayMs:maxLag,evidencePreserved:true,note:'Eight sequential one-scene mutations in an isolated copy of the real registry; not total live selection time.'};
await writeFile(join(out,`mutation-${mode}.json`),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
assert.ok(resolve(scratch).startsWith(out+sep));await rm(scratch,{recursive:true,force:true});
