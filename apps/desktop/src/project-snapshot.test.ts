import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Project} from '@gold-work/shared';
import {LocalProjectStorage} from './local-project-storage.js';

test('overlapping scene backups retain newest metadata/evidence and do not queue every snapshot',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-snapshot-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const storage=new LocalProjectStorage(root);
  const project=(revision:number)=>({id:'p',updatedAt:`2026-10-01T06:00:0${revision}.000Z`,title:`Revision ${revision}`,
    scenes:[{id:'s',order:0,title:'scene',narration:`Exact text ${revision}`,audioPath:'paid-voice.mp3',durationSeconds:5,
      documentary:{candidates:[{description:'Retained evidence '.repeat(40000)}]}}]}) as unknown as Project;
  const instrument=storage as unknown as {writeProjectSnapshot:(p:Project)=>Promise<string>};
  const write=instrument.writeProjectSnapshot.bind(storage);const writes:number[]=[];
  instrument.writeProjectSnapshot=async p=>{writes.push(Number(p.title.at(-1)));return write(p);};
  const pending=[storage.ensureProject(project(0))];
  for(let i=1;i<=8;i++)pending.push(storage.ensureProject(project(i)));
  pending.push(storage.ensureProject(project(3))); // Late completion of an older worker.
  await Promise.all(pending);
  assert.deepEqual(writes,[0,8]);
  assert.deepEqual(JSON.parse(await readFile(join(root,'p','project.json'),'utf8')),project(8));
  assert.equal(JSON.parse(await readFile(join(root,'p','scenario.json'),'utf8'))[0].narration,'Exact text 8');
});

test('a failed coalesced backup rejects waiting callers and permits a later safe save',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-snapshot-error-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const storage=new LocalProjectStorage(root),project={id:'p',updatedAt:'now',scenes:[]} as unknown as Project;
  const instrument=storage as unknown as {writeProjectSnapshot:(p:Project)=>Promise<string>};
  const write=instrument.writeProjectSnapshot.bind(storage);
  instrument.writeProjectSnapshot=async()=>{await new Promise(resolve=>setImmediate(resolve));throw Error('Disk unavailable');};
  const results=await Promise.allSettled([storage.ensureProject(project),storage.ensureProject(project)]);
  assert.ok(results.every(r=>r.status==='rejected'));
  instrument.writeProjectSnapshot=write;await storage.ensureProject(project);
  assert.deepEqual(JSON.parse(await readFile(join(root,'p','project.json'),'utf8')),project);
});
