import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {createVoiceCalibration,type DocumentaryCandidate} from '@gold-work/shared';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {DocumentarySearch} from './documentary-search.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {prepareDocumentaryScript} from './documentary-plan.js';
import {effectFfmpeg} from './effect-media.js';

test('direct Commons and Archive excerpts skip intro and submit excerpt-relative frames without a second seek',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-direct-intro-'));
  assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));t.after(()=>rm(root,{recursive:true,force:true}));
  const file=join(root,'intro-content.mp4');
  await effectFfmpeg(['-y','-f','lavfi','-i','color=red:s=1280x720:r=10:d=8',
    '-f','lavfi','-i','color=green:s=1280x720:r=10:d=12','-f','lavfi','-i','color=blue:s=1280x720:r=10:d=4',
    '-filter_complex','[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]','-map','[v]','-c:v','libx264','-preset','ultrafast',
    '-g','10','-pix_fmt','yuv420p','-movflags','+faststart',file]);
  const bytes=await readFile(file),shortFile=join(root,'short.mp4');
  await effectFfmpeg(['-y','-i',file,'-t','3','-c','copy','-movflags','+faststart',shortFile]);
  const shortBytes=await readFile(shortFile);
  // Only FFmpeg's loopback relay is real HTTP. Every remote request is served
  // from the generated local MP4; no external fetch or provider API is used.
  t.mock.method(globalThis,'fetch',async(input:unknown,init?:RequestInit)=>{
    assert.match(String(input),/^https:\/\/8\.8\.8\.8\/(?:commons|internet-archive)\/(?:intro-content|short)\.mp4$/);
    const data=String(input).endsWith('/short.mp4')?shortBytes:bytes;
    const offset=Number(new Headers(init?.headers).get('Range')?.match(/^bytes=(\d+)-/)?.[1]??0);
    const headers={'Content-Type':'video/mp4','Content-Length':String(data.length-offset),
      'Accept-Ranges':'bytes','Content-Range':`bytes ${offset}-${data.length-1}/${data.length}`};
    return new Response(init?.method==='HEAD'?null:data.subarray(offset),{status:206,headers});
  });
  const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
  let p=await projects.create({title:'Direct range',topic:'Colored content',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
  const text='The content follows an introductory card.';p.videoBrief={...p.videoBrief!,creationMode:'script',readyScript:text};
  const scene=prepareDocumentaryScript(p,createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:text,audioDurationSeconds:3}))[0]!;
  scene.durationSeconds=3;scene.documentary!.timing={sourceKey:'voice',speechSeconds:3,durationInFrames:90};
  p=await projects.update(p.id,{scenes:[scene]});
  const service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,'projects')),new DocumentarySearch(),join(root,'materials'),
    {download:async()=>{throw Error('No stock transfer');}},()=>{},
    {simpleSelection:true,available:async()=>true,plan:async()=>new Map(),inspect:async()=>{throw Error('No model in preparation');}});
  const prepare=Reflect.get(service,'apply').bind(service) as (id:string,sceneId:string,c:DocumentaryCandidate,commit:boolean)=>Promise<typeof p>;
  let calls=0,expectedColor:'red'|'green'|'blue'='green';
  const intel=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(_system,input,images)=>{
    calls++;const data=JSON.parse(input);assert.equal(data.startSeconds,0);assert.equal(data.endSeconds,3);
    assert.deepEqual(data.sampleSeconds,[.09,1.5,2.91]);assert.equal(images?.length,3);
    for(const [i,image] of images!.entries()){
      const jpg=join(root,`submitted-${calls}-${i}.jpg`),rgb=join(root,`pixel-${calls}-${i}.rgb`);
      await writeFile(jpg,Buffer.from(image.split(',')[1]!,'base64'));
      await effectFfmpeg(['-y','-i',jpg,'-vf','scale=1:1','-pix_fmt','rgb24','-f','rawvideo',rgb]);
      const [r,g,b]=await readFile(rgb);
      assert.ok(expectedColor==='green'?g!>100&&r!<20&&b!<20:expectedColor==='blue'?b!>200&&r!<20&&g!<20:r!>200&&g!<20&&b!<20,
        `Expected ${expectedColor} content, not red intro or a double-shifted seek: ${[r,g,b]}`);
    }
    return JSON.stringify({description:'Locally generated color fixture.',suitable:false,reason:'Orchestration fixture only.'});
  }},()=>join(root,'inspection'));
  for(const provider of ['commons','internet-archive'] as const){
    const candidate:DocumentaryCandidate={id:`${provider}:fixture`,provider,kind:'video',title:'Content after intro',description:'Fixture',
      durationSeconds:24,width:1280,height:720,downloadUrl:`https://8.8.8.8/${provider}/intro-content.mp4`,pageUrl:`https://example.test/${provider}`,
      query:'content',author:'fixture',license:'fixture',licenseUrl:'',attribution:'fixture',rights:'licensed',retrievedAt:'now',match:'unverified',concerns:[]};
    const shot=(await prepare(p.id,scene.id,candidate,false)).scenes[0]!;
    assert.equal(shot.documentary!.selected!.excerpt!.startSeconds,11.52);
    assert.equal(shot.trimStartSeconds,0);assert.equal(shot.documentary!.verified,false);
    expectedColor='green';await intel.inspectForSelection({...p,scenes:[shot]},shot);
    // Rejected absolute source interval must advance to the late window.
    await projects.mutate(p.id,current=>({scenes:current.scenes.map(s=>({...s,documentary:{...s.documentary!,searchRecovery:{reason:'Middle rejected',queries:[],
      rejectedRanges:[{sourceId:candidate.id,checksum:shot.documentary!.checksum!,start:0,end:3,sourceStart:11.52,sourceEnd:14.52}]}}}))}));
    const late=(await prepare(p.id,scene.id,candidate,false)).scenes[0]!;
    assert.equal(late.documentary!.selected!.excerpt!.startSeconds,20);assert.equal(late.trimStartSeconds,0);
    expectedColor='blue';await intel.inspectForSelection({...p,scenes:[late]},late);
    const short={...candidate,id:`${provider}:short`,durationSeconds:3,downloadUrl:`https://8.8.8.8/${provider}/short.mp4`};
    const shortShot=(await prepare(p.id,scene.id,short,false)).scenes[0]!;
    assert.equal(shortShot.documentary!.selected!.excerpt,undefined,'A short original must retain its zero-based path');
    assert.equal(shortShot.trimStartSeconds,0);
    expectedColor='red';await intel.inspectForSelection({...p,scenes:[shortShot]},shortShot);
  }
  assert.ok(calls>=2,'Actual three-frame boundary was exercised');
});
