import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import {createDefaultProjectSettings,editMusicClips,resolveMusicClips,moveMusicClip,trimMusicClip,splitMusicClip,type MusicClip,type MusicSettings,type Project} from '@gold-work/shared';
import {buildDocumentaryTimeline,documentaryMusicClipGain,documentaryMusicClipGainExpression} from '@gold-work/remotion-video';
import {renderDocumentaryAudio} from './documentary-fast-render.js';
import {runFfmpeg} from './standard-renderer.js';
import {FileProjectRepository} from './file-project-repository.js';

const base:MusicClip={id:'a',path:'source.wav',startSeconds:2,durationSeconds:8,sourceOffsetSeconds:3,sourceDurationSeconds:20,volume:80,enabled:true,origin:'automatic',status:'ready'};
const timeline=(music:MusicSettings)=>buildDocumentaryTimeline({aspectRatio:'16:9',scenes:[{id:'scene',order:0,durationSeconds:6}],settings:{music,voice:{enabled:false},assembly:{kenBurns:false}}});

test('left/right trim, move and split preserve source time, including missing placeholders',()=>{
  const left=trimMusicClip(base,'left',4,20);
  assert.deepEqual([left.startSeconds,left.durationSeconds,left.sourceOffsetSeconds],[4,6,5]);
  const right=trimMusicClip(left,'right',9,20);
  const moved=moveMusicClip(right,10,20);
  assert.deepEqual([moved.startSeconds,moved.durationSeconds,moved.sourceOffsetSeconds],[10,5,5]);
  const parts=splitMusicClip(moved,12,'right')!;
  assert.deepEqual(parts.map(clip=>[clip.startSeconds,clip.durationSeconds,clip.sourceOffsetSeconds]),[[10,2,5],[12,3,7]]);
  assert.equal(parts[1].sourceOffsetSeconds+(15-parts[1].startSeconds),base.sourceOffsetSeconds+(9-base.startSeconds));
  assert.equal(splitMusicClip(moved,10,'bad'),undefined);
  assert.equal(splitMusicClip(moved,15,'bad'),undefined);
  assert.equal(trimMusicClip(base,'left',-20,20).sourceOffsetSeconds,1);
  assert.equal(trimMusicClip(base,'right',99,40).durationSeconds,17);
  const missing={...base,path:undefined,status:'missing' as const,sourceOffsetSeconds:0};
  assert.equal(trimMusicClip(missing,'left',1,20).startSeconds,1);
  assert.ok(splitMusicClip(missing,5,'missing-right')!.every(clip=>clip.status==='missing'&&!clip.path));
  assert.deepEqual(base,{id:'a',path:'source.wav',startSeconds:2,durationSeconds:8,sourceOffsetSeconds:3,sourceDurationSeconds:20,volume:80,enabled:true,origin:'automatic',status:'ready'},'operations are immutable');
});

test('legacy is read-only; explicit silence and master mute never resurrect path',async()=>{
  const legacy={path:'old.wav',volume:10};
  assert.equal(resolveMusicClips(legacy,6)[0]!.loop,true);
  assert.equal('clips' in legacy,false);
  assert.equal(timeline(legacy).music!.clips[0]!.durationSeconds,6);
  assert.deepEqual(timeline({...legacy,clips:[]}).music!.clips,[]);
  assert.equal(timeline({...legacy,enabled:false}).music,undefined);
  assert.equal(timeline({...legacy,clips:[base],enabled:false}).music,undefined);
  assert.equal(await renderDocumentaryAudio(timeline({...legacy,clips:[]}),'.'),undefined);
  assert.equal(await renderDocumentaryAudio(timeline({...legacy,enabled:false}),'.'),undefined);
});

test('file repository roundtrip retains edits, missing markers and explicit empty track without touching narration',async()=>{
  const root=await mkdtemp(join(tmpdir(),'gws-music-save-'));
  try{
    const path=join(root,'projects.json'),repo=new FileProjectRepository(path);
    const settings=createDefaultProjectSettings();settings.music={path:'legacy.wav',volume:20};
    const project={id:'music',title:'Music',settings,scenes:[{id:'voice',audioPath:'original.wav',narration:'Keep exactly'}]} as Project;
    await repo.save(project);
    const before=await readFile(path,'utf8');await new FileProjectRepository(path).get(project.id);
    assert.equal(await readFile(path,'utf8'),before,'open must not migrate the original');
    const split=splitMusicClip(base,5,'b')!;
    const missing={...base,id:'needed',path:undefined,status:'missing' as const,message:'Нужна музыка'};
    await repo.mutate(project.id,current=>({...current,settings:{...current.settings,music:editMusicClips(current.settings.music,[...split,missing])}}));
    const reopened=(await new FileProjectRepository(path).get(project.id))!;
    assert.deepEqual(reopened.settings.music.clips,JSON.parse(JSON.stringify([...split,missing])));assert.equal(reopened.settings.music.manualEdits,true);
    assert.deepEqual(reopened.scenes,project.scenes);
    await repo.mutate(project.id,current=>({...current,settings:{...current.settings,music:editMusicClips(current.settings.music,[])}}));
    const empty=(await new FileProjectRepository(path).get(project.id))!;
    assert.deepEqual(resolveMusicClips(empty.settings.music,20),[]);assert.equal(empty.settings.music.path,'legacy.wav');
  }finally{assert.ok(resolve(root).startsWith(resolve(tmpdir())+'\\gws-music-save-'));await rm(root,{recursive:true,force:true});}
});

test('preview and FFmpeg gain expressions agree at global time including gaps and ducking',()=>{
  const t=timeline({volume:40,fadeInSeconds:1,fadeOutSeconds:1,ducking:false,clips:[{...base,startSeconds:1,durationSeconds:3}]});
  const clip=t.music!.clips[0]!;
  const expression=documentaryMusicClipGainExpression(t,clip);
  const evaluate=new Function('t',`const min=Math.min,max=Math.max;return ${expression};`) as (time:number)=>number;
  for(const local of [0,.015,.25,1,2.5,2.985,3])assert.ok(Math.abs(evaluate(local)-documentaryMusicClipGain(t,clip,clip.startSeconds+local))<1e-8);
  assert.equal(documentaryMusicClipGain(t,clip,0),0);assert.equal(documentaryMusicClipGain(t,clip,5),0);
  t.music!.ducking=true;t.scenes[0]!.narrationEnabled=true;
  t.scenes[0]!.documentary={layout:'full',effects:[],caption:{enabled:false,text:'',position:'bottom',animation:'fade',fontSize:42,color:'#fff',backgroundColor:'#000',opacity:100},
    timing:{sourceKey:'speech',audioPath:'speech.wav',durationInFrames:180,speechSeconds:2}};
  const ducked=new Function('t',`const min=Math.min,max=Math.max;return ${documentaryMusicClipGainExpression(t,clip)};`) as (time:number)=>number;
  for(const local of [.1,.5,1,1.3,1.7,2.5])assert.ok(Math.abs(ducked(local)-documentaryMusicClipGain(t,clip,clip.startSeconds+local))<1e-8);
});

test('local FFmpeg mix honors offsets, gains, loops, gaps, mute and independent voice/SFX',async()=>{
  const root=await mkdtemp(join(tmpdir(),'gws-music-clips-'));
  try{
    const source=join(root,'source.wav');
    await runFfmpeg(['-y','-f','lavfi','-i','sine=frequency=440:duration=1','-f','lavfi','-i','sine=frequency=880:duration=1','-filter_complex','[0:a][1:a]concat=n=2:v=0:a=1[out]','-map','[out]','-ar','48000',source]);
    const clip={...base,path:source,sourceDurationSeconds:2,volume:100,startSeconds:.5,durationSeconds:1,sourceOffsetSeconds:1};
    const t=timeline({path:'must-not-open.wav',volume:100,fadeInSeconds:0,fadeOutSeconds:0,ducking:false,clips:[
      clip,{...clip,id:'quiet',startSeconds:2,sourceOffsetSeconds:0,volume:50},
      {...clip,id:'missing',path:'must-not-open.wav',status:'missing',startSeconds:1.5,durationSeconds:.5},
      {...clip,id:'muted',path:'must-not-open.wav',enabled:false,startSeconds:3},
      {...clip,id:'loop',startSeconds:4,durationSeconds:2,sourceOffsetSeconds:3,loop:true},
    ]});
    const output=await renderDocumentaryAudio(t,root);assert.ok(output);
    const decoded=spawnSync(ffmpeg!,['-v','error','-i',output,'-ac','1','-ar','48000','-f','f32le','pipe:1'],{windowsHide:true,maxBuffer:4*1024*1024});
    assert.equal(decoded.status,0,decoded.stderr.toString());
    let data=decoded.stdout;assert.ok(Math.abs(data.length/4/48000-6)<.002);
    const amplitude=(at:number,frequency:number)=>{
      const start=Math.round(at*48000),length=9600;let sin=0,cos=0;
      for(let i=0;i<length;i++){const sample=data.readFloatLE((start+i)*4),angle=2*Math.PI*frequency*i/48000;sin+=sample*Math.sin(angle);cos+=sample*Math.cos(angle);}
      return Math.hypot(sin,cos)*2/length;
    };
    const fullVolume=amplitude(.7,880),halfVolume=amplitude(2.2,440);
    assert.ok(fullVolume>.11,'first clip reads its offset rather than source zero');
    assert.ok(amplitude(.7,440)<.001);
    assert.ok(halfVolume/fullVolume>.45&&halfVolume/fullVolume<.55,'per-clip half volume survives final loudness mastering');
    for(const at of [0,1.65,3.25])assert.ok(amplitude(at,440)<.0001&&amplitude(at,880)<.0001,'gap/missing/mute is silence');
    assert.ok(amplitude(4.2,880)>.11&&amplitude(5.2,440)>.11,'loop offset wraps to full source, not its trimmed tail');
    await mkdir(join(root,'muted'));
    assert.equal(await renderDocumentaryAudio({...t,music:undefined},join(root,'muted')),undefined);
    const voice=join(root,'voice.wav'),sfx=join(root,'sfx.wav');
    await runFfmpeg(['-y','-f','lavfi','-i','sine=frequency=1000:duration=6','-ar','48000',voice]);
    await runFfmpeg(['-y','-f','lavfi','-i','sine=frequency=1500:duration=0.5','-ar','48000',sfx]);
    const withVoice={...t,music:undefined,scenes:[{...t.scenes[0]!,narrationEnabled:true,documentary:{layout:'full' as const,
      caption:{enabled:false,text:'',position:'bottom' as const,animation:'fade' as const,fontSize:42,color:'#fff',backgroundColor:'#000',opacity:100},
      timing:{sourceKey:'voice',audioPath:voice,durationInFrames:180,speechSeconds:6},effects:[{id:'sfx',filePath:sfx,kind:'audio' as const,role:'sound' as const,enabled:true,startSeconds:1.6,durationSeconds:.5,x:0,y:0,scale:1,blend:'normal' as const,
        defaults:{opacity:100,volume:100,sourceAudio:true,trimStartSeconds:0,fadeInSeconds:0,fadeOutSeconds:0}}]}}]};
    const voiceOutput=await renderDocumentaryAudio(withVoice,join(root,'muted'));assert.ok(voiceOutput);
    const voiced=spawnSync(ffmpeg!,['-v','error','-i',voiceOutput,'-ac','1','-ar','48000','-f','f32le','pipe:1'],{windowsHide:true,maxBuffer:4*1024*1024});
    assert.equal(voiced.status,0,voiced.stderr.toString());data=voiced.stdout;
    assert.ok(amplitude(1.65,1000)>.11&&amplitude(4.2,1000)>.11,'master music mute preserves narration across the film');
    assert.ok(amplitude(1.65,1500)>.015,'master music mute preserves the independent SFX cue');
  }finally{assert.ok(resolve(root).startsWith(resolve(tmpdir())+'\\gws-music-clips-'));await rm(root,{recursive:true,force:true});}
});
