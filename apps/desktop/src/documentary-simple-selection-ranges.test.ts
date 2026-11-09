import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,mkdir,copyFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep,basename} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {createVoiceCalibration,type DocumentaryCandidate,type Scene} from '@gold-work/shared';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {DocumentarySearch} from './documentary-search.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {prepareDocumentaryScript} from './documentary-plan.js';
import {effectFfmpeg} from './effect-media.js';
import {usedDocumentaryRanges} from './documentary-reuse.js';
import {documentaryContinuousRange} from './documentary-video-catalog.js';
import {documentaryPreviewKey} from './documentary-preview.js';

test('parallel simple selection allocates non-overlapping ranges before reviewing the same source',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-selection-ranges-'));
  assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&basename(root).startsWith('gws-selection-ranges-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const file=join(root,'source.mp4');
  await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=size=1280x720:rate=10','-t','12','-c:v','libx264','-preset','ultrafast','-threads','1','-pix_fmt','yuv420p',file]);
  const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
  let p=await projects.create({title:'Ranges',topic:'City traffic',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
  p.videoBrief={...p.videoBrief!,creationMode:'script',readyScript:'Cars move along a city street.'};
  const original=prepareDocumentaryScript(p,createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:p.videoBrief.readyScript!,audioDurationSeconds:3}))[0]!;
  const scenes=[0,1].map<Scene>(order=>({...structuredClone(original),id:`range-${order}`,order,durationSeconds:3,
    documentary:{...structuredClone(original.documentary!),timing:{sourceKey:`voice-${order}`,speechSeconds:3,durationInFrames:90},
      requirement:{...original.documentary!.requirement,text:original.narration,entities:[],identities:[],years:[],queries:['city traffic'],preferredKind:'video' as const,plannedBy:'semantic' as const,identityContextVersion:3,visualScope:'illustrative' as const,visualScopeVersion:3,visualScopeQuote:original.narration,illustrationQuery:'city traffic'}}}));
  p=await projects.update(p.id,{settings:{...p.settings,stockVideoPercent:100},scenes});
  const source:DocumentaryCandidate={id:'pexels:traffic',provider:'pexels',kind:'video',title:'city traffic',description:'traffic',
    width:1280,height:720,durationSeconds:12,query:'city traffic',pageUrl:'https://example.test/traffic',downloadUrl:'https://example.test/traffic.mp4',
    author:'Fixture',license:'Fixture',licenseUrl:'',attribution:'Fixture',rights:'licensed',retrievedAt:'now',match:'unverified',concerns:[]};
  const searcher=new DocumentarySearch();searcher.search=async()=>({candidates:[source],sources:[]});
  let active=0,peak=0,reviews=0,downloads=0;
  const ranges:Array<{start:number;end:number}>=[];
  const service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,'projects')),searcher,join(root,'materials'),
    {download:async()=>{downloads++;return {data:await readFile(file),extension:'.mp4',contentType:'video/mp4'};}},()=>{},
    {simpleSelection:true,available:async()=>true,plan:async(_p,rows)=>new Map(rows.map(s=>[s.id,s.documentary!.requirement])),
      inspect:async(current,scene)=>{
        active++;peak=Math.max(peak,active);reviews++;
        try{
          const range=documentaryContinuousRange(12,3,[],usedDocumentaryRanges(current,scene),0);assert.ok(range);
          ranges.push(range);await delay(40);
          return {status:'accepted',confidence:.99,reason:'Mock pixels: orchestration only',quality:'1280x720',checkedAt:'now',
            sampleSeconds:[range.start+.1,range.start+1.5,range.end-.1],trimStartSeconds:range.start,trimEndSeconds:range.end};
        }finally{active--;}
      }});
  const result=await service.autoSelect(p.id,{sceneIds:scenes.map(s=>s.id)});
  assert.equal(result.selected,2,JSON.stringify(result.failures));assert.equal(result.failed,0);
  assert.equal(peak,1,'Same-source review is serialized, not merely rejected after paying twice');
  assert.equal(reviews,2);assert.equal(downloads,1);assert.equal(ranges[0]!.start,0);
  assert.ok(ranges[1]!.start>=ranges[0]!.end);assert.ok(ranges.every(range=>Math.abs(range.end-range.start-3)<.001));
  assert.deepEqual(result.project.scenes.map(s=>[s.trimStartSeconds,s.trimEndSeconds]),ranges.map(range=>[range.start,range.end]));
});

test('YouTube excerpts skip unreviewed intros and rejected ranges while saved scene-specific evidence takes priority',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-selection-preview-'));
  assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&basename(root).startsWith('gws-selection-preview-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const file=join(root,'source.mp4');
  await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=size=1280x720:rate=10','-t','10','-c:v','libx264','-preset','ultrafast','-threads','1','-pix_fmt','yuv420p',file]);
  const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
  let p=await projects.create({title:'Preview',topic:'City traffic',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
  p.videoBrief={...p.videoBrief!,creationMode:'script',readyScript:'Cars move along a city street.'};
  const scene=prepareDocumentaryScript(p,createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:p.videoBrief.readyScript!,audioDurationSeconds:3}))[0]!;
  scene.durationSeconds=3;p=await projects.update(p.id,{scenes:[scene]});
  const source:DocumentaryCandidate={id:'youtube:traffic',provider:'youtube',kind:'video',title:'city traffic',description:'traffic',
    width:1280,height:720,durationSeconds:120,query:'city traffic',pageUrl:'https://example.test/traffic',downloadUrl:'https://example.test/traffic.mp4',
    author:'Fixture',license:'Fixture',licenseUrl:'',attribution:'Fixture',rights:'licensed',retrievedAt:'now',match:'unverified',concerns:[]};
  const materials=join(root,'materials'),directory=join(materials,'Previews',documentaryPreviewKey(source));await mkdir(directory,{recursive:true});
  const segments=[];for(const start of [0,20,90]){const path=join(directory,`${start}.mp4`);await copyFile(file,path);segments.push({start,end:start+4,path});}
  await writeFile(join(directory,'preview.json'),JSON.stringify({segments,bytes:1}));
  let reads=0;
  const ranges:Array<{start:number;end:number}|undefined>=[];
  const service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,'projects')),new DocumentarySearch(),materials,
    {download:async()=>{throw Error('No stock transfer');}},()=>{},
    {simpleSelection:true,available:async()=>true,plan:async()=>new Map(),inspect:async()=>{throw Error('Only transfer preparation is under test');},
      cachedPreviewForScene:async()=>{reads++;return {selectedIndex:1,rejected:false,reason:'Previously saved scene-specific result'};}},undefined,
    {download:async(_source,path,_signal,_progress,_hd,range)=>{ranges.push(range);await copyFile(file,path);}});
  const prepare=Reflect.get(service,'apply').bind(service) as (id:string,sceneId:string,source:DocumentaryCandidate,commit:boolean)=>Promise<typeof p>;
  const prepared=await prepare(p.id,scene.id,source,false),shot=prepared.scenes[0]!;
  assert.equal(shot.trimStartSeconds,3);assert.equal(shot.documentary!.selected!.excerpt!.startSeconds,17);
  assert.equal(shot.documentary!.verified,false,'A saved preview proposes a range, never approves final pixels');
  await prepare(p.id,scene.id,source,false);assert.deepEqual(ranges,[{start:17,end:27}]);assert.equal(reads,1);
  const fresh={...source,id:'youtube:second',pageUrl:'https://example.test/second',downloadUrl:'https://example.test/second.mp4',durationSeconds:361};
  const staged=await prepare(p.id,scene.id,fresh,false);
  assert.deepEqual(ranges,[{start:17,end:27},{start:173.28,end:173.28+4}]);
  assert.equal(staged.scenes[0]!.documentary!.verified,false);
  await projects.mutate(p.id,current=>({scenes:current.scenes.map(s=>({...s,documentary:{...s.documentary!,searchRecovery:{
    reason:'No subject in the middle window',queries:[],rejectedRanges:[{sourceId:fresh.id,checksum:staged.scenes[0]!.documentary!.checksum!,
      start:0,end:3,sourceStart:173.28,sourceEnd:176.28}]}}}))}));
  await prepare(p.id,scene.id,fresh,false);
  assert.deepEqual(ranges.at(-1),{start:310.46,end:314.46});
  const short={...source,id:'youtube:short',pageUrl:'https://example.test/short',downloadUrl:'https://example.test/short.mp4',durationSeconds:54};
  const shortStage=await prepare(p.id,scene.id,short,false);
  assert.deepEqual(ranges.at(-1),{start:25.92,end:29.92},'A 54-second source must not repeatedly inspect its opening merely because it is under 90 seconds');
  assert.equal(shortStage.scenes[0]!.documentary!.verified,false,'A proposed later range is not visual approval');
  await projects.mutate(p.id,current=>({scenes:current.scenes.map(s=>({...s,documentary:{...s.documentary!,searchRecovery:{
    reason:'The source was already inspected without a suitable subject',queries:[],rejectedRanges:[{sourceId:short.id,checksum:shortStage.scenes[0]!.documentary!.checksum!,
      start:0,end:10,sourceStart:0,sourceEnd:54}]}}}))}));
  const transfersBefore=ranges.length;
  await assert.rejects(prepare(p.id,scene.id,short,false),/Проверенные участки/);
  assert.equal(ranges.length,transfersBefore,'A fully rejected original must not be transferred again');
  await projects.mutate(p.id,current=>({scenes:current.scenes.map(s=>({...s,durationSeconds:10,documentary:{...s.documentary!,timing:undefined,searchRecovery:undefined}}))}));
  const tight={...source,id:'youtube:tight',pageUrl:'https://example.test/tight',downloadUrl:'https://example.test/tight.mp4',durationSeconds:12};
  await prepare(p.id,scene.id,tight,false);
  assert.equal(ranges.at(-1)!.end,12,'An excerpt near the source duration must be clamped to its end');
  assert.ok(ranges.at(-1)!.start>=0);
});

test('an occupied cached YouTube excerpt requests a free interval of the original and preserves existing narration',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-selection-occupied-'));
  assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&basename(root).startsWith('gws-selection-occupied-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const file=join(root,'source.mp4'),audio=join(root,'voice.mp3');
  await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=size=1280x720:rate=10','-t','4','-c:v','libx264','-preset','ultrafast','-threads','1','-pix_fmt','yuv420p',file]);
  await effectFfmpeg(['-y','-f','lavfi','-i','sine=frequency=440:duration=3','-c:a','libmp3lame',audio]);
  const voiceBytes=await readFile(audio);
  const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
  let p=await projects.create({title:'Occupied excerpts',topic:'City traffic',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
  p.videoBrief={...p.videoBrief!,creationMode:'script',readyScript:'Cars move along a city street.'};
  const original=prepareDocumentaryScript(p,createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:p.videoBrief.readyScript!,audioDurationSeconds:3}))[0]!;
  const scene:Scene={...original,id:'needs-new-range',order:4,durationSeconds:3,audioPath:audio,
    documentary:{...original.documentary!,timing:{sourceKey:'retained-narration',audioPath:audio,speechSeconds:3,durationInFrames:90}}};
  p=await projects.update(p.id,{scenes:[scene]});
  const source:DocumentaryCandidate={id:'youtube:long-source',provider:'youtube',kind:'video',title:'city traffic',description:'traffic',
    width:1280,height:720,durationSeconds:1200,query:'city traffic',pageUrl:'https://example.test/long-source',downloadUrl:'https://example.test/long-source.mp4',
    author:'Fixture',license:'Fixture',licenseUrl:'',attribution:'Fixture',rights:'licensed',retrievedAt:'now',match:'unverified',concerns:[]};
  const ranges:Array<{start:number;end:number}>=[];
  const service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,'projects')),new DocumentarySearch(),join(root,'materials'),
    {download:async()=>{throw Error('No stock transfer');}},()=>{},
    {simpleSelection:true,available:async()=>true,plan:async()=>new Map(),inspect:async()=>{throw Error('Only local source preparation is under test');}},undefined,
    {download:async(_source,path,_signal,_progress,_hd,range)=>{assert.ok(range);ranges.push(range);await copyFile(file,path);}});
  const prepare=Reflect.get(service,'apply').bind(service) as (id:string,sceneId:string,source:DocumentaryCandidate,commit:boolean)=>Promise<typeof p>;
  const first=(await prepare(p.id,scene.id,source,false)).scenes[0]!;
  assert.deepEqual(ranges,[{start:576,end:580}]);assert.ok(first.documentary!.selected!.localPath);
  // Existing scenes occupy the middle, late, opening and zero proposals. The
  // same cached file is usable as evidence for those scenes, not for this shot.
  const occupied=[576,1032,96,0].map<Scene>((start,order)=>({...structuredClone(first),id:`occupied-${order}`,order,
    trimStartSeconds:0,trimEndSeconds:3,documentary:{...structuredClone(first.documentary!),verified:true,
      selected:{...first.documentary!.selected!,excerpt:{...first.documentary!.selected!.excerpt!,startSeconds:start,endSeconds:start+4}}}}));
  p=await projects.update(p.id,{scenes:[...occupied,scene]});
  const before=structuredClone(p.scenes);
  const prepared=await prepare(p.id,scene.id,source,false),shot=prepared.scenes.find(s=>s.id===scene.id)!;
  assert.deepEqual(ranges,[{start:576,end:580},{start:3.25,end:7.25}],
    'The occupied cached excerpt must not suppress a transfer from a free interval of the 20-minute original');
  assert.equal(shot.documentary!.selected!.excerpt!.startSeconds,3.25);
  assert.equal(shot.documentary!.selected!.excerpt!.sourceDurationSeconds,1200);
  assert.equal(shot.documentary!.verified,false,'A new interval remains unapproved until its actual frames are checked');
  assert.equal(shot.audioPath,audio);assert.deepEqual(shot.documentary!.timing,scene.documentary!.timing);
  assert.deepEqual(await readFile(audio),voiceBytes,'Source preparation never rewrites the existing MP3');
  assert.deepEqual((await projects.get(p.id))!.scenes,before,'Staging keeps the existing timeline and narration intact');
});
