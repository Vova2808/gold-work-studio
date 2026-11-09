import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,link,stat,utimes} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createDefaultProjectSettings,type Project,type Scene} from '@gold-work/shared';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {effectFfmpeg} from './effect-media.js';

for(const unresolved of [false,true])test(`current illustration ${unresolved?'unknown receipt':'completed refusal'} cannot repay after hardlink without saved visualReview`,async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-illustration-cache-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const video=join(root,'source.mp4');
  await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=size=640x360:rate=10','-t','4','-c:v','libx264','-threads','1','-preset','ultrafast',video]);
  const narration='A bird moves in a tree.';
  const scene={id:'s',order:0,narration,title:'Bird',durationSeconds:4,videoPath:video,
    documentary:{version:2,pinned:false,verified:false,illustrative:false,reviewNote:'',candidates:[],effects:[],layout:'full',caption:{enabled:false,text:''},
      checksum:createHash('sha256').update(await readFile(video)).digest('hex'),requirement:{text:narration,entities:[],years:[],queries:['bird'],preferredKind:'video'},
      selected:{id:'local-bird',provider:'local',kind:'video',localPath:video,title:'Bird',description:'Bird',durationSeconds:4,rights:'user-confirmed'}}} as unknown as Scene;
  const p={id:'p',title:'Bird',topic:'Bird',language:'English',mediaMode:'stock',settings:createDefaultProjectSettings(),scenes:[scene],videoBrief:{readyScript:narration}} as Project;
  let calls=0;
  const client={configured:async()=>true,documentaryCompletion:async(_system:string,input:string)=>{calls++;if(unresolved)throw Error('Unknown response');
    return JSON.stringify({description:'No bird is visible.',target:JSON.parse(input).visualTarget,relevant:false,evidence:'No bird is visible in these frames.'});}};
  if(unresolved)await assert.rejects(new DocumentaryIntelligence(client,()=>root).inspectForSelection(p,scene));
  else assert.equal((await new DocumentaryIntelligence(client,()=>root).inspectForSelection(p,scene)).review.status,'rejected');
  assert.equal(scene.documentary!.visualReview,undefined);
  await link(video,join(root,'alias.mp4'));
  if(unresolved)await assert.rejects(new DocumentaryIntelligence(client,()=>root).inspectForSelection(p,scene),/неизвест|оплаченный/);
  else assert.equal((await new DocumentaryIntelligence(client,()=>root).inspectForSelection(p,scene)).review.status,'rejected');
  assert.equal(calls,1);
  const beforeTouch=await stat(video),originalBytes=await readFile(video);
  await utimes(video,beforeTouch.atime,new Date(beforeTouch.mtimeMs+2000));
  assert.deepEqual(await readFile(video),originalBytes);
  if(unresolved)await assert.rejects(new DocumentaryIntelligence(client,()=>root).inspectForSelection(p,scene),/неизвест|оплаченный/);
  else assert.equal((await new DocumentaryIntelligence(client,()=>root).inspectForSelection(p,scene)).review.status,'rejected');
  assert.equal(calls,1,'A metadata-only timestamp touch must preserve complete refusals and unresolved guards');
});
