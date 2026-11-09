import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import type {Project,Scene} from '@gold-work/shared';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {effectFfmpeg} from './effect-media.js';

test('fast video accepts physical motion evidence in the same three-frame review and refuses missing evidence',async t=>{
 const root=await mkdtemp(join(tmpdir(),'gws-fast-motion-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const file=join(root,'test.mp4');
 await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=size=640x360:rate=10','-t','4','-c:v','libx264','-preset','ultrafast','-threads','1','-pix_fmt','yuv420p',file]);
 const checksum=createHash('sha256').update(await readFile(file)).digest('hex');
 for(const mode of ['missing-motion','accepted','hidden-start','saved-refusal']){
  const motion=mode==='missing-motion'?undefined:{motionType:'live-footage',confidence:.97,cameraMoves:false,subjectMoves:true,globalTransformOnly:false,subjectMotionEvidence:'Mock surfer changes position relative to shore and rocks',evidence:'Mock physical movement, orchestration only'};
  const narration='A surfer rides a wave toward the shore.';
  const scene={id:'s',order:0,narration,durationSeconds:4,videoPath:file,documentary:{checksum,requirement:{text:narration,entities:[],years:[],queries:[]},selected:{id:'pexels:test',title:'Mock surfer',provider:'pexels',kind:'video',durationSeconds:4,localPath:file}}} as unknown as Scene;
  if(mode==='saved-refusal')scene.documentary!.searchRecovery={reason:'Already rejected actual interval',queries:[],rejectedRanges:[{checksum,start:0,end:4}]};
  const project={id:mode,scenes:[scene]} as Project;let calls=0;
  const client={configured:async()=>true,documentaryCompletion:async(system:string,input:string,images:string[])=>{
   calls++;assert.equal(images.length,3);assert.match(system,/relative to at least two background features/);
   const data=JSON.parse(input);return JSON.stringify({description:'Mock surfer',target:data.visualTarget,relevant:true,evidence:'Mock surfer rides a wave toward shore',...(motion?{motion}:{}),sampleChecks:data.sampleSeconds.map((seconds:number,index:number)=>({seconds,targetVisible:mode!=='hidden-start'||index!==0,evidence:'Mock sample, orchestration only'}))});
  }};
  const intelligence=new DocumentaryIntelligence(client as any,()=>join(root,project.id));
  const result=await intelligence.inspectForSelection(project,scene);
  assert.equal(result.review.status,mode==='saved-refusal'?'rejected':mode==='accepted'?'accepted':'uncertain');assert.equal(calls,mode==='saved-refusal'?0:1,'No paid motion cascade or repeat of an exact saved refusal');
 }
});

test('black leading edge missed by sparse samples is rejected locally, including saved approval, with zero model calls',async t=>{
 const root=await mkdtemp(join(tmpdir(),'gws-fast-edge-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const file=join(root,'edge.mp4');
 await effectFfmpeg(['-y','-f','lavfi','-i','color=c=black:s=640x360:r=10:d=0.3','-f','lavfi','-i','testsrc2=s=640x360:r=10:d=3.7',
  '-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[out]','-map','[out]','-c:v','libx264','-preset','ultrafast','-threads','1','-pix_fmt','yuv420p',file]);
 const scene={id:'s',order:0,narration:'A motorcycle rides along the road.',durationSeconds:4,videoPath:file,trimStartSeconds:0,trimEndSeconds:4,
  documentary:{verified:true,checksum:createHash('sha256').update(await readFile(file)).digest('hex'),requirement:{text:'A motorcycle rides along the road.',entities:[],years:[],queries:[]},
   selected:{id:'test',kind:'video',title:'Test',description:'',durationSeconds:4},visualReview:{illustrationApproval:{version:1,fingerprint:'old'}}}} as unknown as Scene;
 const project={id:'p',scenes:[scene]} as Project;let calls=0;
 const intel=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{calls++;throw Error('Must not reach paid model');}},()=>root);
 assert.match((await intel.inspectForSelection(project,scene)).review.reason,/чёрный/);
 assert.match((await intel.savedMotionIssue(project,scene))!,/чёрный/);
 assert.equal(calls,0);
});
