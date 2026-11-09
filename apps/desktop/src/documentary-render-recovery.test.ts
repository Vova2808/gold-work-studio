import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {documentaryDecoderResources,withDocumentaryDecoderRecovery} from './documentary-renderer.js';
import {remotionBinariesDirectory} from './remotion-binaries.js';

test('Windows release resolves native Remotion tools on disk and development keeps renderer defaults',{skip:process.platform!=='win32'||process.arch!=='x64'},async t=>{
  const resources=await mkdtemp(join(tmpdir(),'gws-remotion-resources-'));
  t.after(()=>rm(resources,{recursive:true,force:true}));
  assert.equal(remotionBinariesDirectory(resources),undefined);
  const physical=join(resources,'app.asar.unpacked','node_modules','@remotion','compositor-win32-x64-msvc');
  await mkdir(physical,{recursive:true});
  assert.equal(remotionBinariesDirectory(resources),physical);
});

test('1080p decoding retains a useful cache without exceeding half the available RAM',()=>{
 const bytes=1.3*1024**3;
 const resource=documentaryDecoderResources(1920,1080,bytes);
 assert.ok(resource.cacheBytes>=512*1024**2);assert.ok(resource.cacheBytes<=bytes/2);
 assert.equal(resource.threads,1);
 const constrained=documentaryDecoderResources(1920,1080,256*1024**2);
 assert.ok(constrained.cacheBytes<=128*1024**2);assert.equal(constrained.threads,1);
});

test('a compositor cache failure retries only the current part once in safe mode',async()=>{
 const attempts:boolean[]=[];let notices=0;
 const value=await withDocumentaryDecoderRecovery(async retry=>{
  attempts.push(retry);if(!retry)throw new Error('Compositor error: No frame found at position 10752');return 'part.mp4';
 },undefined,()=>{notices++;});
 assert.equal(value,'part.mp4');assert.deepEqual(attempts,[false,true]);assert.equal(notices,1);
 let calls=0;
 await assert.rejects(withDocumentaryDecoderRecovery(async()=>{calls++;throw new Error('No frame found at position 10752');}));
 assert.equal(calls,2);
});

test('cancellation and unrelated storage/media failures never trigger decoder recovery',async()=>{
 const beforeStart=new AbortController();beforeStart.abort();let initialCalls=0;
 await assert.rejects(withDocumentaryDecoderRecovery(async()=>{initialCalls++;},beforeStart.signal));assert.equal(initialCalls,0);
 for(const message of ['Disk full','Invalid source video']) {
  let calls=0;await assert.rejects(withDocumentaryDecoderRecovery(async()=>{calls++;throw new Error(message);}));assert.equal(calls,1);
 }
 const controller=new AbortController();let calls=0;
 await assert.rejects(withDocumentaryDecoderRecovery(async()=>{calls++;controller.abort();throw new Error('No frame found at position 10752');},controller.signal));
 assert.equal(calls,1);
 const onNotice=new AbortController();calls=0;
 await assert.rejects(withDocumentaryDecoderRecovery(async()=>{calls++;throw new Error('No frame found at position 10752');},onNotice.signal,()=>onNotice.abort()));
 assert.equal(calls,1,'Stop from the retry progress callback must prevent a second render');
});
