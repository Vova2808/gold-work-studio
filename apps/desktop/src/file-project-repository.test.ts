import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
