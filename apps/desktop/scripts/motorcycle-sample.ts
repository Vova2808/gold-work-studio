import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import type {Project} from '@gold-work/shared';
import {documentaryPhotoFirstScenes} from '../src/documentary-project-service.js';
const root=resolve('captures/montage-speed-20260927/new-production/motorcycle-live-20261001');
const original=JSON.parse(await readFile(join(root,'manifest.json'),'utf8'));
const excluded=new Set(original.groups.flatMap((g:any)=>g.scenes.map((s:any)=>s.id)));
const balanced=process.argv.includes('--balanced');
if(balanced){const previous=JSON.parse(await readFile(join(root,'manifest-additional.json'),'utf8'));for(const group of previous.groups)for(const scene of group.scenes)excluded.add(scene.id);}
const registry=JSON.parse(await readFile(join(process.env.APPDATA!,'@gold-work/desktop/projects.json'),'utf8')) as Project[];
const project=registry.find(p=>p.id===original.projectId)!;
const photoFirst=documentaryPhotoFirstScenes(project);
const key=(id:string)=>createHash('sha256').update(`20261001-additional-sample:${id}`).digest('hex');
const groups=(['image','video'] as const).map(kind=>{
  const pool=project.scenes.filter(s=>!s.documentary?.verified&&s.includeInAssembly!==false&&!excluded.has(s.id)&&photoFirst.has(s.id)===(kind==='image'));
  const selected=balanced?Array.from({length:5},(_,i)=>pool.sort((a,b)=>a.order-b.order)[Math.floor((i+.5)*pool.length/5)]!):pool.sort((a,b)=>key(a.id).localeCompare(key(b.id))).slice(0,5);
  return{kind,scenes:selected.map(s=>({id:s.id,number:s.order+1,kind,narration:s.narration}))};
});
assert.ok(groups.every(g=>g.scenes.length===5));
await writeFile(join(root,balanced?'manifest-balanced.json':'manifest-additional.json'),JSON.stringify({projectId:project.id,at:new Date().toISOString(),method:balanced?'Five evenly spaced remaining unverified scenes per normal photo/video search order, excluding the two earlier cohorts; no media chosen or scenario/settings changed.':'Deterministic hash selection among remaining unverified scenes, five per normal photo/video search order; no media chosen or scenario/settings changed.',groups},null,2),{flag:'wx'});
console.log(groups.map(g=>({kind:g.kind,scenes:g.scenes.map(s=>s.number)})));
