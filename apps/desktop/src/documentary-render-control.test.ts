import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,writeFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {buildDocumentaryTimeline} from '@gold-work/remotion-video';
import {createDefaultProjectSettings,createDocumentarySettings,createVoiceCalibration,type Project} from '@gold-work/shared';
import {prepareDocumentaryScript} from './documentary-plan.js';
import {prepareDocumentaryRenderMedia} from './documentary-render-media.js';
import {renderDocumentary} from './documentary-renderer.js';
import {runFfmpeg} from './standard-renderer.js';
import {probeEffectMedia} from './effect-media.js';

const fixture=(imagePath:string)=>{
  const project={id:'render-control',mediaMode:'stock',aspectRatio:'16:9',scenes:[],settings:createDefaultProjectSettings(),videoBrief:{creationMode:'script',readyScript:'A map explains the journey across the continent.'}} as unknown as Project;
  project.settings.voice.enabled=false;
  project.settings.assembly.documentary=createDocumentarySettings();
  const voice=createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:'A clear measured voice reads this whole sentence.',audioDurationSeconds:5});
  project.scenes=prepareDocumentaryScript(project,voice).slice(0,1).map(scene=>({...scene,imagePath,durationSeconds:12,transition:'none',documentary:{...scene.documentary!,verified:true,pinned:true,template:'push',
    selected:{id:'local:map',provider:'local',kind:'image',title:'Map',description:'Owned test image',pageUrl:'',downloadUrl:'',author:'fixture',license:'Owned',licenseUrl:'',rights:'user-confirmed',attribution:'',query:'',retrievedAt:'',match:'unverified',concerns:[],width:4800,height:2400}}}));
  return project;
};

test('render preparation bounds large raster images and reuses copies without changing originals',async()=>{
  const root=await mkdtemp(join(tmpdir(),'gws-render-image-')),source=join(root,'large.png');
  await runFfmpeg(['-y','-f','lavfi','-i','testsrc2=size=4800x2400:rate=1','-frames:v','1',source]);
  const before=await stat(source,{bigint:true}),project=fixture(source),timeline=buildDocumentaryTimeline(project);
  const cutout=join(root,'cutout.png');
  await runFfmpeg(['-y','-f','lavfi','-i','color=blue@0.5:size=4800x2400:rate=1,format=rgba','-frames:v','1',cutout]);
  timeline.scenes[0]!.documentary!.motionGraphic={enabled:true,kind:'subject-card',title:'Subject',startSeconds:0,durationSeconds:12,cutoutPath:cutout};
  timeline.scenes.push({...timeline.scenes[0]!,id:'second',fromFrame:360});
  await prepareDocumentaryRenderMedia(timeline,join(root,'render'),()=>{});
  assert.equal(timeline.scenes[0]!.imagePath,timeline.scenes[1]!.imagePath);
  assert.notEqual(timeline.scenes[0]!.imagePath,source);
  const info=await probeEffectMedia(timeline.scenes[0]!.imagePath!);
  assert.deepEqual([info.width,info.height],[3840,1920]);
  const prepared=timeline.scenes[0]!.documentary!.motionGraphic!.cutoutPath!;
  assert.notEqual(prepared,cutout);
  const cutoutInfo=await probeEffectMedia(prepared);assert.deepEqual([cutoutInfo.width,cutoutInfo.height],[3840,1920]);
  const alpha=join(root,'alpha.raw');
  await runFfmpeg(['-y','-i',prepared,'-vf','alphaextract,scale=1:1','-frames:v','1','-f','rawvideo',alpha]);
  assert.ok(Math.abs((await readFile(alpha))[0]!-128)<2,'The resized cutout retains transparency');
  assert.equal(project.scenes[0]!.imagePath,source);
  const after=await stat(source,{bigint:true});assert.equal(after.mtimeNs,before.mtimeNs);assert.equal(after.size,before.size);
});

test('Stop terminates an actual FFmpeg process promptly',async()=>{
  const controller=new AbortController(),started=Date.now();
  const timer=setTimeout(()=>controller.abort(),250);
  try{await assert.rejects(runFfmpeg(['-re','-f','lavfi','-i','testsrc2=size=160x90:rate=30','-t','60','-f','null','-'],undefined,controller.signal),{name:'AbortError'});}
  finally{clearTimeout(timer);}
  assert.ok(Date.now()-started<5000);
});

test('Stop cancels actual Remotion rendering and preserves the previous Final',async()=>{
  const root=await mkdtemp(join(tmpdir(),'gws-render-stop-')),source=join(root,'photo.png'),output=join(root,'Final.mp4');
  await runFfmpeg(['-y','-f','lavfi','-i','testsrc2=size=640x360:rate=1','-frames:v','1',source]);
  await writeFile(output,'previous completed output');
  const project=fixture(source),controller=new AbortController();let stoppedAt=0;
  await assert.rejects(renderDocumentary({project,clips:[],audioMasterPath:'',outputPath:output,signal:controller.signal,onProgress:(stage,progress)=>{
    if(!stoppedAt&&stage.includes('графика и переходы')&&progress>17){stoppedAt=Date.now();controller.abort();}
  }},{projectDirectory:root,entryPoint:createRequire(import.meta.url).resolve('@gold-work/remotion-video/entry'),renderWorkers:1}));
  assert.ok(stoppedAt>0,'Cancellation must reach a running Remotion frame render');
  assert.ok(Date.now()-stoppedAt<10000);
  assert.equal(await readFile(output,'utf8'),'previous completed output');
});
