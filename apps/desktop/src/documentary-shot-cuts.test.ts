import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {documentaryContinuousRange,documentaryVideoCuts} from './documentary-video-catalog.js';
import {effectFfmpeg} from './effect-media.js';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import type {Project, Scene} from '@gold-work/shared';

test('full interval scan detects a brief inserted shot between all three vision samples',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-shot-cuts-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const file=join(root,'three-shots.mp4');
  await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=size=640x360:rate=30:duration=1.2',
    '-f','lavfi','-i','color=white:size=640x360:rate=30:duration=0.2',
    '-f','lavfi','-i','testsrc2=size=640x360:rate=30:duration=2.6',
    '-filter_complex','[0:v][1:v][2:v]concat=n=3:v=1:a=0','-c:v','libx264','-preset','ultrafast','-threads','1',file]);
  const before=await stat(file),cuts=await documentaryVideoCuts(file,0,4);
  assert.ok(cuts.some(at=>Math.abs(at-1.2)<.04),JSON.stringify(cuts));
  assert.ok(cuts.some(at=>Math.abs(at-1.4)<.04),JSON.stringify(cuts));
  assert.deepEqual(await documentaryVideoCuts(file,.5,3.5),cuts,'Seeked intervals report absolute source coordinates');
  assert.equal(documentaryContinuousRange(4,3,cuts,[]),undefined,'The full narration cannot span an inserted shot');
  const range=documentaryContinuousRange(4,2,cuts,[],0)!;
  assert.ok(range.start>1.4&&range.end<=4);
  assert.equal((await stat(file)).mtimeMs,before.mtimeMs,'The scan preserves user media');
  const scene={id:'edited',videoPath:file,documentary:{verified:true,pinned:false,checksum:'fixture',cuts:[
    {id:'left',fromFrame:0,durationInFrames:30,trimStartSeconds:0,trimEndSeconds:1,playbackRate:1},
    {id:'right',fromFrame:30,durationInFrames:30,trimStartSeconds:1.5,trimEndSeconds:2.5,playbackRate:1},
  ]}} as Scene;
  const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{
    assert.fail('An explicit montage must not trigger another paid review of its unused source interval');
  }},()=>root);
  assert.equal(await intelligence.savedMotionIssue({id:'p',scenes:[scene]} as Project,scene),undefined,
    'Explicit cuts preserve the montage instead of rejecting the unused source cut between them');
});

test('camera-like motion stays continuous and occupied ranges are preserved',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-shot-motion-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const file=join(root,'continuous.mp4');
  await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=size=640x360:rate=30:duration=5','-c:v','libx264','-preset','ultrafast','-threads','1',file]);
  assert.deepEqual(await documentaryVideoCuts(file,0,5),[]);
  const range=documentaryContinuousRange(10,3,[4],[{start:5,end:7}],6)!;
  assert.ok(range.end<=4||range.start>=7.08,'No approved or rejected range is replayed');
});
