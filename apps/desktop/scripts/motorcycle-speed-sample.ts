import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import type {Project} from '@gold-work/shared';
import {documentaryPhotoFirstScenes} from '../src/documentary-project-service.js';
const root=resolve('captures/montage-speed-20260927/new-production/motorcycle-live-20261001');
const registry=JSON.parse(await readFile(join(process.env.APPDATA!,'@gold-work/desktop/projects.json'),'utf8')) as Project[];
const project=registry.find(p=>p.id==='project_mun42rx8_1jcven5')!;
assert.ok(project&&!['generating','paused'].includes(project.status));
const photos=documentaryPhotoFirstScenes(project);
const groups=(['image','video'] as const).map(kind=>{
  const pool=project.scenes.filter(s=>s.includeInAssembly!==false&&!s.documentary?.verified&&!s.documentary?.pinned&&s.documentary?.requirement.plannedBy==='semantic'&&photos.has(s.id)===(kind==='image')).sort((a,b)=>a.order-b.order);
  assert.ok(pool.length>=5);
  return {kind,scenes:Array.from({length:5},(_,i)=>pool[Math.floor((i+.5)*pool.length/5)]!).map(s=>({id:s.id,number:s.order+1,kind,narration:s.narration}))};
});
await writeFile(join(root,'manifest-speed.json'),JSON.stringify({projectId:project.id,at:new Date().toISOString(),sceneCount:project.scenes.length,verified:project.scenes.filter(s=>s.documentary?.verified).length,method:'Five evenly distributed unverified scenes per normal photo/video allocation. Original scenario, settings and source checkpoints; no media manually chosen.',groups},null,2),{flag:'wx'});
console.log(JSON.stringify(groups));
