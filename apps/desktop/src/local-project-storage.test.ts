import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat,utimes,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import type {Project} from '@gold-work/shared';
import {LocalProjectStorage} from './local-project-storage.js';

test('unchanged scenario bytes retain their file while changed/deleted/external scenarios are restored',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-scenario-backup-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const storage=new LocalProjectStorage(root);
  const project={id:'one',title:'Initial',updatedAt:'2026-10-14T10:00:00Z',scenes:[{id:'s1',order:0,title:'Scene',narration:'Exact narration',
    imagePrompt:'Image',animationPrompt:'Move',durationSeconds:3}]} as Project;
  const directory=await storage.ensureProject(project),scenario=join(directory,'scenario.json');
  const original=await readFile(scenario);
  await utimes(scenario,new Date(1_000),new Date(1_000));
  const marked=await stat(scenario,{bigint:true});
  await storage.ensureProject({...project,title:'Only project metadata changed',updatedAt:'2026-10-14T10:00:01Z'});
  const unchanged=await stat(scenario,{bigint:true});
  assert.equal(unchanged.mtimeNs,marked.mtimeNs);assert.equal(unchanged.ino,marked.ino);
  assert.ok((await readFile(scenario)).equals(original));
  const changed={...project,updatedAt:'2026-10-14T10:00:02Z',scenes:project.scenes.map(s=>({...s,narration:'Changed narration'}))};
  await storage.ensureProject(changed);
  const expected=await readFile(scenario);
  assert.equal(JSON.parse(expected.toString())[0].narration,'Changed narration');
  await rm(scenario);await storage.ensureProject(changed);assert.ok((await readFile(scenario)).equals(expected));
  await writeFile(scenario,expected.toString()+'\n');await storage.ensureProject(changed);
  assert.ok((await readFile(scenario)).equals(expected),'Exact bytes include formatting, even when JSON values are equivalent');
  await writeFile(scenario,'externally changed');await storage.ensureProject(changed);
  assert.ok((await readFile(scenario)).equals(expected));
  const newest={...changed,updatedAt:'2026-10-14T10:00:03Z',scenes:changed.scenes.map(s=>({...s,title:'Newest scene'}))};
  await Promise.all([storage.ensureProject(changed),storage.ensureProject(newest)]);
  assert.equal(JSON.parse(await readFile(scenario,'utf8'))[0].title,'Newest scene');
});
