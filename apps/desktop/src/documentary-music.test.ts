import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import ffmpeg from 'ffmpeg-static';
import {buildDocumentaryTimeline} from '@gold-work/remotion-video';
import {renderDocumentaryAudio} from './documentary-fast-render.js';
import {documentaryRenderCache} from './documentary-render-cache.js';
import {runFfmpeg} from './standard-renderer.js';
import {importDocumentaryMusic} from './documentary-music-import.js';

test('stock soundtrack loops, fades and ducks without changing voice timing; music edits reuse visual cache',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'gws-music-'));
  try{
    const music=join(directory,'music.wav'),voice=join(directory,'voice.wav');
    await runFfmpeg(['-y','-f','lavfi','-i','sine=frequency=440:duration=1','-ar','48000',music]);
    await runFfmpeg(['-y','-f','lavfi','-i','sine=frequency=1000:duration=2','-ar','48000',voice]);
    const imported=await importDocumentaryMusic(music,join(directory,'library')),original=await readFile(music);
    assert.equal(await importDocumentaryMusic(music,join(directory,'library')),imported);
    await writeFile(imported,'interrupted copy');
    assert.equal(await importDocumentaryMusic(music,join(directory,'library')),imported);
    assert.deepEqual(await readFile(imported),original,'reimport repairs an incomplete app-owned copy');
    const timeline=buildDocumentaryTimeline({aspectRatio:'16:9',settings:{voice:{enabled:true},assembly:{kenBurns:false},music:{path:music,volume:40,fadeInSeconds:.5,fadeOutSeconds:1,ducking:true}},scenes:[0,1,2].map(order=>({id:String(order),order,durationSeconds:2,...(order===1?{audioPath:voice,documentary:{layout:'full' as const,effects:[],caption:{enabled:false,text:'',position:'bottom' as const,animation:'fade' as const,fontSize:42,color:'#ffffff',backgroundColor:'#000000',opacity:100},timing:{sourceKey:'voice',audioPath:voice,durationInFrames:60,speechSeconds:2}}}:{})}))});
    const output=await renderDocumentaryAudio(timeline,directory);
    assert.ok(output);
    const decoded=spawnSync(ffmpeg!,['-v','error','-i',output,'-ac','1','-ar','48000','-f','f32le','pipe:1'],{windowsHide:true,maxBuffer:4*1024*1024});
    assert.equal(decoded.status,0,decoded.stderr.toString());
    const data=decoded.stdout;
    assert.ok(Math.abs(data.length/4/48000-6)<.002,'music must not extend or truncate the film');
    const amplitude=(at:number,frequency:number,seconds=.4)=>{
      const start=Math.round(at*48000),length=Math.round(seconds*48000);let sin=0,cos=0;
      for(let i=0;i<length;i++){const sample=data.readFloatLE((start+i)*4),angle=2*Math.PI*frequency*i/48000;sin+=sample*Math.sin(angle);cos+=sample*Math.cos(angle);}
      return Math.hypot(sin,cos)*2/length;
    };
    const full=amplitude(1,440),underVoice=amplitude(2.4,440);
    assert.ok(full>.02,'a one-second music file must repeat');
    assert.ok(underVoice/full>.25&&underVoice/full<.35,'music is lowered by the expected envelope under speech');
    assert.ok(amplitude(2.4,1000)>.11,'voice level stays intact');
    assert.ok(amplitude(4.6,440)>full*.9,'music returns after narration');
    assert.ok(amplitude(5.85,440,.1)<full*.2,'music fades at the actual film end');
    const cache=await documentaryRenderCache(directory,createRequire(import.meta.url).resolve('@gold-work/remotion-video/entry'));
    const picture=await cache.path(timeline,0,2,20),audio=await cache.audioPath(timeline);
    timeline.music!.volume=20;
    assert.equal(await cache.path(timeline,0,2,20),picture,'volume-only edit must not rerender video');
    assert.notEqual(await cache.audioPath(timeline),audio,'volume-only edit must remix audio');
    const edited=await cache.audioPath(timeline);await writeFile(music,Buffer.alloc(300));
    assert.deepEqual(await readFile(imported),original,'changing the external source never changes the imported music');
    assert.notEqual(await cache.audioPath(timeline),edited,'replaced audio file invalidates the mix');
    const muted={...timeline,music:undefined,scenes:timeline.scenes.map(s=>({...s,narrationEnabled:false}))};
    await mkdir(join(directory,'muted'));
    assert.equal(await renderDocumentaryAudio(muted,join(directory,'muted')),undefined);
  }finally{assert.ok(resolve(directory).startsWith(resolve(tmpdir())+'\\gws-music-'));await rm(directory,{recursive:true,force:true});}
});
