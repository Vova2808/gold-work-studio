import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {DocumentaryTimeline} from '@gold-work/remotion-video';
import {runFfmpeg} from './standard-renderer.js';
import {effectFfmpeg} from './effect-media.js';
import {renderPlainDocumentaryShot} from './documentary-fast-render.js';
import {assertDocumentaryStreamDuration} from './documentary-render-validation.js';
import {createDefaultProjectSettings,createDocumentarySettings,type Project} from '@gold-work/shared';
import {renderDocumentary} from './documentary-renderer.js';

test('a dissolve after a short 29.97fps source yields every frame, including after concat',async t=>{
 const root=await mkdtemp(join(tmpdir(),'gws-render-timing-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const source=join(root,'source.mp4'),empty=join(root,'empty.mp4'),part=join(root,'part.mp4');
 await runFfmpeg(['-y','-f','lavfi','-i','testsrc2=size=320x180:rate=30000/1001','-frames:v','59','-an','-c:v','libx264','-pix_fmt','yuv420p',source]);
 // The old seek formula lands after the last presentation frame. FFmpeg
 // returns success and writes a nonempty MP4 container with no video stream.
 await runFfmpeg(['-y','-ss',String(1.98-1/30),'-t','0.1','-i',source,'-frames:v','1','-an','-c:v','libx264',empty]);
 await assert.rejects(assertDocumentaryStreamDuration(empty,'video',1.2));
 const previous={id:'previous',fromFrame:0,durationInFrames:229,videoPath:source,transition:'mix',transitionFrames:11,documentary:{selected:{durationSeconds:1.98}}};
 const current={id:'current',fromFrame:229,durationInFrames:36,videoPath:source,transition:'cut',transitionFrames:0,documentary:{selected:{durationSeconds:1.98}}};
 const timeline={fps:30,width:320,height:180,scenes:[previous,current]} as unknown as DocumentaryTimeline;
 await renderPlainDocumentaryShot(timeline,timeline.scenes[1]!,part,28);
 await assertDocumentaryStreamDuration(part,'video',1.2);
 const decoded=await effectFfmpeg(['-xerror','-i',part,'-map','0:v:0','-f','null','-']);
 assert.equal(Number([...decoded.matchAll(/frame=\s*(\d+)/g)].at(-1)?.[1]),36);
 const list=join(root,'parts.txt'),joined=join(root,'joined.mp4');
 await writeFile(list,`file '${part.replace(/\\/g,'/')}'\nfile '${part.replace(/\\/g,'/')}'\n`);
 await runFfmpeg(['-y','-f','concat','-safe','0','-i',list,'-map','0:v:0','-c:v','copy',joined]);
 await assertDocumentaryStreamDuration(joined,'video',2.4);
});

test('long audio cannot hide a short video stream, and an absent stream is rejected',async t=>{
 const root=await mkdtemp(join(tmpdir(),'gws-render-streams-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const output=join(root,'wrong.mp4');
 await runFfmpeg(['-y','-f','lavfi','-i','color=c=red:s=320x180:r=30:d=1','-f','lavfi','-i','sine=frequency=1000:duration=3','-c:v','libx264','-c:a','aac',output]);
 await assert.rejects(assertDocumentaryStreamDuration(output,'video',3),/Неверная длительность/);
 await assertDocumentaryStreamDuration(output,'audio',3);
 await assertDocumentaryStreamDuration(output,'video',1);
 const silent=join(root,'silent.mp4');
 await runFfmpeg(['-y','-i',output,'-map','0:v:0','-c','copy',silent]);
 await assert.rejects(assertDocumentaryStreamDuration(silent,'audio',1));
});

test('native documentary export permits intentionally muted voice and sound effects',async t=>{
 const root=await mkdtemp(join(tmpdir(),'gws-render-silent-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const source=join(root,'source.mp4'),outputPath=join(root,'Final.mp4'),entryPoint=join(root,'entry.js');
 await writeFile(entryPoint,'// Plain shot never starts Remotion');
 await runFfmpeg(['-y','-f','lavfi','-i','color=c=blue:s=320x180:r=30:d=0.5','-f','lavfi','-i','sine=duration=0.5','-c:v','libx264','-c:a','aac',source]);
 const settings=createDefaultProjectSettings();
 settings.voice.enabled=true;settings.music.enabled=false;settings.assembly.kenBurns=false;
 settings.assembly.documentary={...createDocumentarySettings(),captionsEnabled:false,sfxVolume:0};
 const project={id:'silent',mediaMode:'stock',aspectRatio:'16:9',settings,scenes:[{id:'s',order:0,narration:'Muted voice',durationSeconds:.5,status:'ready',imagePrompt:'',animationPrompt:'',
  videoPath:source,audioPath:source,narrationVolume:0,sourceVolume:0,transition:'none',documentary:{version:2,verified:true,checksum:'fixture',pinned:true,layout:'full',template:'full',candidates:[],caption:{enabled:false,text:''},
   timing:{sourceKey:'fixture',audioPath:source,durationInFrames:15,speechSeconds:.5},
   selected:{id:'source',provider:'pexels',kind:'video',localPath:source,width:320,height:180,durationSeconds:.5},
   effects:[{id:'muted',name:'Muted',filePath:source,kind:'audio',role:'sound',enabled:true,startSeconds:0,durationSeconds:.5,x:50,y:50,scale:1,blend:'normal',defaults:{opacity:100,volume:0,sourceAudio:false,trimStartSeconds:0,fadeInSeconds:0,fadeOutSeconds:0}}]}}]} as unknown as Project;
 await renderDocumentary({project,clips:[],audioMasterPath:'',outputPath},{projectDirectory:root,entryPoint});
 await assertDocumentaryStreamDuration(outputPath,'video',.5);
 await assert.rejects(assertDocumentaryStreamDuration(outputPath,'audio',.5));
});

test('export rebuilds a truncated cached mix while keeping the cached picture',async t=>{
 const root=await mkdtemp(join(tmpdir(),'gws-render-repair-audio-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const source=join(root,'source.mp4'),entryPoint=join(root,'entry.js'),outputPath=join(root,'Final.mp4');
 await writeFile(entryPoint,'// Plain video');
 await runFfmpeg(['-y','-f','lavfi','-i','color=c=blue:s=320x180:r=30:d=1','-f','lavfi','-i','sine=duration=1','-c:v','libx264','-c:a','aac',source]);
 const settings=createDefaultProjectSettings();
 settings.voice.enabled=false;settings.music.enabled=false;
 const project={id:'cache-repair',mediaMode:'stock',aspectRatio:'16:9',settings,scenes:[{
   id:'s',order:0,narration:'Ship at sea',durationSeconds:1,sourceVolume:100,videoPath:source,transition:'none',
   documentary:{verified:true,checksum:'local',pinned:true,layout:'full',template:'full',candidates:[],caption:{enabled:false,text:''},effects:[],
     selected:{id:'source',kind:'video',localPath:source,width:320,height:180,durationSeconds:1}}
 }]} as unknown as Project;
 const render=()=>renderDocumentary({project,clips:[],audioMasterPath:'',outputPath},{projectDirectory:root,entryPoint});
 await render();
 const cacheDir=join(root,'Documentary','RenderCache');
 const cacheName=(await readdir(cacheDir)).find(name=>name.endsWith('.wav'));
 assert.ok(cacheName);
 const cachedMix=join(cacheDir,cacheName);
 await runFfmpeg(['-y','-f','lavfi','-i','sine=duration=0.25','-c:a','pcm_s16le',cachedMix]);
 await render();
 await assertDocumentaryStreamDuration(cachedMix,'audio',1);
 await assertDocumentaryStreamDuration(outputPath,'audio',1);
 const metrics=JSON.parse(await readFile(join(root,'Documentary','last-render-metrics.json'),'utf8'));
 assert.equal(metrics.parts.cached,1);
});
