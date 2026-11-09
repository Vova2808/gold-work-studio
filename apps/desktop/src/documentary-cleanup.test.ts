import assert from "node:assert/strict";
import test from "node:test";
import { copyFile, link, mkdir, mkdtemp, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Project } from "@gold-work/shared";
import { executeDocumentaryCleanup, planDocumentaryCleanup } from "./documentary-cleanup.js";

test("cleanup retains selections across projects, manual imports and backups; removes unused downloads and counts hardlinks once", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-cleanup-policy-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const materialRoot = join(root, "Materials"), projectDirectory = (id: string) => join(root, "projects", id);
  const sceneRoot = join(projectDirectory("one"), "Documentary", "doc-one");
  const backups = join(projectDirectory("one"), "Documentary", "Backups");
  for (const directory of [join(materialRoot, "Files"), join(materialRoot, "Catalog"), sceneRoot, backups]) await mkdir(directory, { recursive: true });
  const old = new Date(Date.now() - 2 * 24 * 3600_000);
  const sources: string[] = [];
  for (let i = 0; i < 5; i++) {
    const hash = String(i).repeat(64), path = join(materialRoot, "Files", `${hash}.mp4`);
    await writeFile(path, Buffer.alloc(100)); await utimes(path, old, old); sources.push(path);
    await writeFile(join(materialRoot, "Catalog", `${hash}.json`), JSON.stringify({ id: i === 3 ? "manual:import" : `youtube:${i}`, provider: i === 3 ? "local" : "youtube", localPath: path }));
    await utimes(join(materialRoot, "Catalog", `${hash}.json`), old, old);
  }
  const unusedCopy = join(sceneRoot, `${"0".repeat(64)}.mp4`); await link(sources[0]!, unusedCopy);
  const redundantCopy = join(sceneRoot, `${"1".repeat(64)}.mp4`); await link(sources[1]!, redundantCopy);
  const migratedRoot = join(sceneRoot, "migrated"); await mkdir(migratedRoot);
  const migratedCopy = join(migratedRoot, `${"1".repeat(64)}.mp4`); await copyFile(sources[1]!, migratedCopy);
  // Re-selecting downloaded or imported content from the cache rewrites its
  // local sidecar, but must not erase the original ownership classification.
  for (const i of [0, 3]) await writeFile(join(sceneRoot, `${String(i).repeat(64)}.source.json`), JSON.stringify({ id: `local:${String(i).repeat(64)}`, provider: "local" }));
  for (const i of [0, 3]) await utimes(join(sceneRoot, `${String(i).repeat(64)}.source.json`), old, old);
  const pendingCatalog = join(materialRoot, "VideoCatalog", "4".repeat(64));
  await mkdir(pendingCatalog, { recursive: true });
  await writeFile(join(pendingCatalog, "catalog-v1.json"), JSON.stringify({ pendingIds: [2] }));
  await writeFile(join(backups, "selection.json"), JSON.stringify({ videoPath: sources[2] }));
  const voice = join(sceneRoot, "voice.wav"), unknown = join(sceneRoot, `${"a".repeat(64)}.mp4`);
  await writeFile(voice, "voice"); await writeFile(unknown, "unknown origin");
  await writeFile(join(sceneRoot, `${"a".repeat(64)}.source.json`), JSON.stringify({ id: `local:${"a".repeat(64)}`, provider: "local" }));
  const projects = [{ id: "one", scenes: [] }, { id: "two", scenes: [{ videoPath: sources[1], documentary: { pinned: true } }] }] as unknown as Project[];
  const plan = await planDocumentaryCleanup({ materialRoot, projects, projectDirectory });
  assert.deepEqual(new Set(plan.files.map(file => file.path)), new Set([sources[0], unusedCopy, redundantCopy, migratedCopy]));
  assert.equal(plan.reclaimableBytes, 200);
  assert.deepEqual(await executeDocumentaryCleanup(plan), { removed: 4, bytes: 200 });
  for (const path of [...sources.slice(1), voice, unknown]) assert.ok((await stat(path)).isFile());
  assert.equal(JSON.parse(await readFile(join(materialRoot, "Catalog", `${"0".repeat(64)}.json`), "utf8")).provider, "youtube", "Provenance/checkpoints are retained");
  await writeFile(join(backups, "broken.json"), "{broken backup");
  await assert.rejects(planDocumentaryCleanup({ materialRoot, projects, projectDirectory }), SyntaxError, "Unreadable references must stop deletion");
});

test('restart cleanup retains fresh downloads and recently reused hardlinks before assignment',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-recent-downloads-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const materialRoot=join(root,'Materials'),files=join(materialRoot,'Files'),catalog=join(materialRoot,'Catalog');
  await mkdir(files,{recursive:true});await mkdir(catalog);
  const now=Date.now(),old=new Date(now-48*3600_000),fresh=new Date(now-60_000);
  const paths:string[]=[];
  for(let i=0;i<3;i++){
    const hash=String(i).repeat(64),path=join(files,`${hash}.jpg`),sidecar=join(catalog,`${hash}.json`);
    await writeFile(path,'source');await writeFile(sidecar,JSON.stringify({id:`commons:${i}`,provider:'commons',localPath:path}));
    await utimes(path,i===0?fresh:old,i===0?fresh:old);
    await utimes(sidecar,i===1?fresh:old,i===1?fresh:old);paths.push(path);
  }
  const input={materialRoot,projects:[],projectDirectory:(id:string)=>join(root,id),now};
  assert.deepEqual((await planDocumentaryCleanup(input)).files.map(file=>file.path),[paths[2]]);
  assert.deepEqual(new Set((await planDocumentaryCleanup({...input,now:now+25*3600_000})).files.map(file=>file.path)),new Set(paths));
  assert.ok((await stat(paths[0]!)).isFile(),'A cleanup plan does not delete anything');
});

test("cleanup ignores nested junctions and recent temp files, and refuses changed or escaped targets", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-cleanup-boundary-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const materialRoot = join(root, "Materials"), outside = join(root, "UserImports");
  await mkdir(materialRoot); await mkdir(outside);
  const name = "11111111-1111-1111-1111-111111111111.download", old = new Date(Date.now() - 2 * 24 * 3600_000);
  const path = join(materialRoot, name), foreign = join(outside, name);
  await writeFile(path, "temporary"); await writeFile(foreign, "import"); await utimes(foreign, old, old);
  await symlink(outside, join(materialRoot, "external"), process.platform === "win32" ? "junction" : "dir");
  const input = { materialRoot, projects: [], projectDirectory: (id: string) => join(root, id) };
  assert.equal((await planDocumentaryCleanup(input)).files.length, 0);
  await utimes(path, old, old);
  const plan = await planDocumentaryCleanup(input); assert.equal(plan.files.length, 1);
  await writeFile(path, "new active download");
  assert.equal((await executeDocumentaryCleanup(plan)).removed, 0);
  await assert.rejects(executeDocumentaryCleanup({ ...plan, files: [{ ...plan.files[0]!, path: foreign }] }), /пределы/);
  assert.equal(await readFile(foreign, "utf8"), "import");
});

test("cleanup recognizes aged downloader fragments and merge temps while protecting recent and referenced files", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-download-remnants-")); t.after(() => rm(root, { recursive: true, force: true }));
  const prefix = "11111111-1111-1111-1111-111111111111";
  const names = [".download-Frag10", ".download.ytdl", ".temp.download", ".download-Frag11.part"];
  const paths = names.map(name => join(root, prefix + name));
  for (const path of paths) await writeFile(path, "fragment");
  const unrelated = join(root, "user-film.download-Frag10"); await writeFile(unrelated, "user data");
  const input = { materialRoot: root, projects: [], projectDirectory: (id: string) => join(root, id) };
  assert.equal((await planDocumentaryCleanup(input)).files.length, 0);
  const old = new Date(Date.now() - 25 * 3600_000);
  for (const path of [...paths, unrelated]) await utimes(path, old, old);
  const plan = await planDocumentaryCleanup({ ...input, projects: [{ id: "one", outputPath: paths[0], scenes: [] }] as unknown as Project[] });
  assert.deepEqual(new Set(plan.files.map(file => file.path)), new Set(paths.slice(1)));
  assert.deepEqual(await executeDocumentaryCleanup(plan), { removed: 3, bytes: 24 });
  assert.equal(await readFile(paths[0]!, "utf8"), "fragment");
  assert.equal(await readFile(unrelated, "utf8"), "user data");
});
