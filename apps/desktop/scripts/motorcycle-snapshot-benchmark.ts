import {readFile,mkdir,writeFile,rm} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import assert from 'node:assert/strict';
import {LocalProjectStorage} from '../src/local-project-storage.js';
import type {Project} from '@gold-work/shared';

const mode=process.argv[2];assert.ok(mode==='before'||mode==='after');
const out=resolve('captures/montage-speed-20260927/new-production/motorcycle-live-20261001');
const project=JSON.parse(await readFile(join(out,'baseline/project.json'),'utf8')) as Project;
const scratch=join(out,`snapshot-${mode}-scratch`);await mkdir(scratch,{recursive:true});
const storage=new LocalProjectStorage(scratch);
const instrument=storage as unknown as {writeProjectSnapshot:(project:Project)=>Promise<string>};
const write=instrument.writeProjectSnapshot.bind(storage);let writes=0;
instrument.writeProjectSnapshot=async p=>{writes++;return write(p);};
const snapshots=Array.from({length:8},(_,i)=>({...structuredClone(project),updatedAt:`2026-10-01T06:00:0${i}.000Z`,title:`Snapshot ${i}`}));
let peakRss=process.memoryUsage().rss,maxLag=0,last=performance.now();
const timer=setInterval(()=>{peakRss=Math.max(peakRss,process.memoryUsage().rss);const now=performance.now();maxLag=Math.max(maxLag,now-last-20);last=now;},20);
const started=performance.now();
await Promise.all(snapshots.map(p=>mode==='before'?instrument.writeProjectSnapshot(p):storage.ensureProject(p)));
clearInterval(timer);
const saved=JSON.parse(await readFile(join(scratch,project.id,'project.json'),'utf8')) as Project;
const lastIndex=Number(saved.title.split(' ').at(-1));assert.deepEqual(saved,snapshots[lastIndex]);
if(mode==='after')assert.equal(lastIndex,7);
const result={mode,elapsedMs:performance.now()-started,writes,peakRssMB:peakRss/1048576,maxEventLoopDelayMs:maxLag,savedRevision:lastIndex,allSnapshotFieldsPreserved:true,note:'Eight overlapping real-size backups on an isolated copy; not a live selection or full-film memory benchmark.'};
await writeFile(join(out,`snapshot-${mode}.json`),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
// This script owns only these temporary outputs below its fixed capture folder.
assert.ok(resolve(scratch).startsWith(out+sep));
await rm(scratch,{recursive:true,force:true});
