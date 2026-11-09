import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Project } from "@gold-work/shared";
import { FileProjectRepository } from "./file-project-repository.js";
import { atomicWrite } from "./fs-utils.js";
import {ProjectService,MockDirectorProvider} from '@gold-work/core';
import {projectForDisplay} from './project-display.js';

test("cached project reads stay isolated and notice atomic external updates", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-project-read-cache-")); t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "projects.json"), repository = new FileProjectRepository(path);
  const project = { id: "one", title: "Before", updatedAt: "now", scenes: [{ id: "scene", narration: "Original" }] } as Project;
  await repository.save(project);
  const first = await repository.get("one"); first!.scenes[0]!.narration = "Not saved";
  const listed = await repository.list(); listed[0]!.title = "Not saved";
  assert.equal((await repository.get("one"))!.scenes[0]!.narration, "Original");
  assert.equal((await repository.get("one"))!.title, "Before");
  await atomicWrite(path, JSON.stringify([{ ...project, title: "After!" }]));
  const concurrent = await Promise.all(Array.from({length: 8}, () => repository.get("one")));
  assert.ok(concurrent.every(value => value!.title === "After!"));
  concurrent[0]!.scenes[0]!.narration = "Changed only in caller";
  assert.equal(concurrent[1]!.scenes[0]!.narration, "Original");
  await repository.mutate("one", current => ({ ...current, title: "Changed" }));
  assert.equal((await repository.get("one"))!.title, "Changed");
  await repository.delete("one"); assert.equal(await repository.get("one"), undefined);
});

test('incomplete mutations cannot corrupt a project or change its identity',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-project-incomplete-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const path=join(root,'projects.json'),repo=new FileProjectRepository(path);
  const project={id:'one',title:'Saved',scenes:[{id:'scene',audioPath:'paid.mp3'}]} as Project;
  await repo.save(project);const before=await readFile(path,'utf8');
  await assert.rejects(repo.mutate('one',()=>({scenes:[]} as unknown as Project)),/Неполная запись проекта/);
  await assert.rejects(repo.mutate('one',p=>({...p,id:'other'})),/изменён ID/);
  assert.equal(await readFile(path,'utf8'),before);assert.deepEqual(await repo.get('one'),project);
});

test('external same-size candidate edits invalidate full reads even when the registry mtime is restored',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-candidate-revision-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const path=join(root,'projects.json'),repository=new FileProjectRepository(path);
  const project={id:'one',scenes:[{id:'scene',documentary:{candidates:[{id:'paid',description:'Before'}]}}]} as unknown as Project;
  await writeFile(path,JSON.stringify([project]));
  const fixed=new Date('2026-10-14T00:00:00.000Z');await utimes(path,fixed,fixed);
  assert.deepEqual(await repository.get(project.id),project);
  const before=await stat(path,{bigint:true});
  const changed=structuredClone(project);changed.scenes[0]!.documentary!.candidates[0]!.description='After!';
  await writeFile(path,JSON.stringify([changed]));await utimes(path,fixed,fixed);
  const after=await stat(path,{bigint:true});
  assert.equal(after.ino,before.ino);assert.equal(after.mtimeNs,before.mtimeNs);assert.equal(after.size,before.size);
  assert.notEqual(after.ctimeNs,before.ctimeNs);
  assert.deepEqual(await repository.get(project.id),changed);
  assert.deepEqual(await repository.get(project.id),changed,'Unchanged reads keep the refreshed revision');
});

test('the full project cache retains one detached revision and survives concurrent or thrown updates',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-one-project-cache-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const path=join(root,'projects.json'),repository=new FileProjectRepository(path);
  const first={id:'one',title:'Original',scenes:[{id:'s1',documentary:{candidates:[{id:'paid',description:'Evidence'}]}}]} as unknown as Project;
  const second={id:'two',title:'Second',scenes:[]} as unknown as Project;
  await repository.save(first);await repository.save(second);
  const reads=await Promise.all(Array.from({length:8},()=>repository.get(first.id)));
  reads[0]!.scenes[0]!.documentary!.candidates[0]!.description='Caller mutation';
  assert.ok(reads.slice(1).every(p=>p!.scenes[0]!.documentary!.candidates[0]!.description==='Evidence'));
  const cache=()=>Reflect.get(repository,'fullProject') as {id:string;revision:string;promise:Promise<Project>}|undefined;
  const initial=cache()!;assert.equal(initial.id,first.id);
  await repository.get(second.id);assert.equal(cache()!.id,second.id);assert.notEqual(cache(),initial);
  await repository.get(first.id);
  const kept=cache();await repository.save({...second,title:'Changed other project'});
  assert.equal(cache()!.promise,kept!.promise,'Unchanged bytes can keep only the last cached project across our own write');
  assert.notEqual(cache()!.revision,kept!.revision);
  await assert.rejects(repository.mutate(first.id,p=>{p.scenes[0]!.documentary!.candidates[0]!.description='Thrown';throw new Error('abort');}),/abort/);
  assert.deepEqual(await repository.get(first.id),first);
  await Promise.all([repository.mutate(first.id,p=>({...p,title:'Concurrent title'})),repository.mutate(first.id,p=>({...p,topic:'Concurrent topic'}))]);
  const fresh=(await repository.get(first.id))!;assert.equal(fresh.title,'Concurrent title');assert.equal(fresh.topic,'Concurrent topic');
  await repository.mutate(first.id,p=>({...p,topic:undefined}) as unknown as Project);
  assert.equal(Object.hasOwn((await repository.get(first.id))!,'topic'),false,'Cache follows the actual serialized JSON shape');
  await writeFile(path,JSON.stringify([{...first,title:'External in-place change'}]));
  assert.equal((await repository.get(first.id))!.title,'External in-place change');
  await rm(path);assert.equal(await repository.get(first.id),undefined);assert.equal(cache(),undefined);
  await repository.save(first);assert.deepEqual(await repository.get(first.id),first);
});

test('cold indexed reads and a one-project save preserve large UTF-8 evidence and untouched JSON bytes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'gws-registry-index-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const path = join(root, 'projects.json');
  const projects = [0, 1, 2].map(i => ({id: `p${i}`, title: `Мотоцикл 🏍 ${i}`, updatedAt: `2026-10-0${i + 1}`,
    scenes: [{id: `s${i}`, narration: 'Exact words', audioPath: `paid-${i}.wav`, documentary: {verified: true,
      candidates: [{id: `candidate-${i}`, description: 'x'.repeat(256 * 1024 - 211 + i) + 'Ж🏍 \\" } ], { \n',
        analysis: {status: 'pending', requestId: 'do-not-resend'}, selected: {ranges: [[1, 3]]}}]}}]})) as unknown as Project[];
  const raw = projects.map(project => JSON.stringify(project, null, 2));
  await writeFile(path, '[\n' + raw.join(',\n') + '\n]');
  const repository = new FileProjectRepository(path);
  const displays = await Promise.all(Array.from({length: 4}, () => repository.list({omitCandidates: true})));
  assert.ok(displays.every(items => items.length === 3 && items.every(p => p.scenes[0]!.documentary!.candidates.length === 0)));
  assert.equal(displays[0]![0]!.scenes[0]!.documentary!.candidateCount, 1);
  displays[0]![0]!.title = 'Only caller changed';
  assert.deepEqual(await repository.get('p2'), projects[2]);
  const changed = await repository.mutate('p1', p => ({...p, title: 'Новое имя'}), {candidateSceneIds: []});
  const disk = await readFile(path, 'utf8');
  assert.ok(disk.includes(raw[0]!) && disk.includes(raw[2]!), 'Untouched projects are copied byte for byte');
  const reopened = new FileProjectRepository(path);
  assert.deepEqual(await reopened.list(), [projects[2], changed, projects[0]]);
  assert.deepEqual(changed.scenes, projects[1]!.scenes, 'Voices and unknown paid evidence survive unchanged');
  assert.deepEqual(await readdir(root), ['projects.json'], 'No format migration or candidate sidecars');
});

test('a truncated registry stays in place and cannot be overwritten as an empty project list', async t => {
  const root = await mkdtemp(join(tmpdir(), 'gws-registry-truncated-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const path = join(root, 'projects.json'), repository = new FileProjectRepository(path);
  const broken = '[{"id":"paid-project","scenes":[{"audioPath":"paid.wav"}]},';
  await writeFile(path, broken);
  await assert.rejects(repository.listForDisplay(), /Реестр проектов повреждён/);
  await assert.rejects(repository.save({id: 'new', scenes: []} as unknown as Project), /Реестр проектов повреждён/);
  assert.equal(await readFile(path, 'utf8'), broken);
  assert.deepEqual(await readdir(root), ['projects.json']);
  const recovered = {id: 'paid-project', scenes: [{id: 'scene', audioPath: 'paid.wav'}]} as Project;
  await writeFile(path, JSON.stringify([recovered]));
  assert.deepEqual(await repository.get(recovered.id), recovered);
});

test('an external registry change during serialization is preserved instead of being lost', async t => {
  const root = await mkdtemp(join(tmpdir(), 'gws-registry-conflict-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const path = join(root, 'projects.json'), repository = new FileProjectRepository(path);
  await repository.save({id: 'one', scenes: [], title: 'Initial'} as unknown as Project);
  const external = JSON.stringify([{id: 'one', scenes: [], title: 'Externally saved'}]);
  let externalWrite: Promise<void> | undefined;
  await assert.rejects(repository.mutate('one', current => {
    externalWrite = writeFile(path, external);
    return {...current, scenes: Array.from({length: 20}, (_, i) => ({id: `s${i}`, narration: 'text'.repeat(128 * 1024)}))} as Project;
  }), /Проекты изменены другим процессом/);
  await externalWrite;
  assert.equal(await readFile(path, 'utf8'), external);
  assert.equal((await repository.get('one'))!.title, 'Externally saved');
  assert.deepEqual(await readdir(root), ['projects.json']);
});

test('one-scene mutations retain deferred evidence, voices and isolated snapshots', async t => {
  const root=await mkdtemp(join(tmpdir(),'gws-scene-mutate-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const repository=new FileProjectRepository(join(root,'projects.json'));
  const projects=new ProjectService(repository,new MockDirectorProvider());
  const p=await projects.create({title:'Evidence',topic:'Motorcycles',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
  const candidate={id:'old',title:'Existing evidence'};
  await repository.save({...p,scenes:[0,1].map(i=>({id:`scene-${i}`,order:i,narration:`Exact script ${i}`,audioPath:`paid-${i}.mp3`,documentary:{candidates:[{...candidate,id:`candidate-${i}`}],verified:true}}))} as Project);
  let retained:Project|undefined;
  const saved=await projects.mutate(p.id,current=>{
    retained=current;
    assert.equal(current.scenes[0]!.documentary!.candidates.length,1);
    assert.deepEqual(current.scenes[1]!.documentary!.candidates,[]);
    assert.equal(current.scenes[1]!.documentary!.candidatesDeferred,true);
    return {scenes:current.scenes.map((s,i)=>i===0?{...s,documentary:{...s.documentary!,candidates:[{...s.documentary!.candidates[0]!,title:'New evidence'}]}}:s)};
  },{candidateSceneIds:['scene-0']});
  assert.equal(saved.scenes[0]!.documentary!.candidates[0]!.title,'New evidence');
  assert.equal(saved.scenes[1]!.documentary!.candidates[0]!.id,'candidate-1');
  assert.ok(saved.scenes.every(s=>!s.documentary!.candidatesDeferred&&s.audioPath===`paid-${s.order}.mp3`));
  retained!.scenes[0]!.documentary!.candidates[0]!.title='Unsaved retained mutation';
  saved.scenes[1]!.documentary!.candidates[0]!.title='Unsaved result mutation';
  const fresh=(await repository.get(p.id))!;
  assert.equal(fresh.scenes[0]!.documentary!.candidates[0]!.title,'New evidence');
  assert.equal(fresh.scenes[1]!.documentary!.candidates[0]!.title,'Existing evidence');
  await assert.rejects(projects.mutate(p.id,current=>{current.scenes[0]!.documentary!.candidates[0]!.title='Thrown';throw new Error('abort');},{candidateSceneIds:['scene-0']}),/abort/);
  assert.deepEqual(await repository.get(p.id),fresh);
  await projects.mutate(p.id,current=>({scenes:current.scenes.map((s,i)=>i===0?{...s,documentary:{...s.documentary!,candidates:[]}}:s)}),{candidateSceneIds:['scene-0']});
  const cleared=(await projects.get(p.id))!;
  assert.equal(cleared.scenes[0]!.documentary!.candidates.length,0);
  assert.equal(cleared.scenes[1]!.documentary!.candidates.length,1);
  // Existing timeline edits with a display snapshot still restore evidence.
  await projects.mutate(p.id,()=>({scenes:projectForDisplay(cleared).scenes.map(s=>({...s,imagePrompt:'Caption change'}))}));
  const reloaded=(await new FileProjectRepository(join(root,'projects.json')).get(p.id))!;
  assert.equal(reloaded.scenes[1]!.documentary!.candidates[0]!.id,'candidate-1');
  assert.ok(reloaded.scenes.every(s=>s.imagePrompt==='Caption change'&&!s.documentary!.candidatesDeferred));
});
