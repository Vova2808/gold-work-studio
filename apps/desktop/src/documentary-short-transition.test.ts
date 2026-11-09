import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import {buildDocumentaryTimeline,type DocumentaryProjectInput} from '@gold-work/remotion-video';
import {renderPlainDocumentaryShot} from './documentary-fast-render.js';
import {runFfmpeg} from './standard-renderer.js';

test('a six-frame incoming video reaches its own colour before the next cut',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-short-transition-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const red=join(root,'red.mp4'),blue=join(root,'blue.mp4'),output=join(root,'out.mp4');
  for(const [colour,path] of [['red',red],['blue',blue]]){
    await runFfmpeg(['-y','-f','lavfi','-i',`color=c=${colour}:s=64x64:r=30:d=0.5`,'-an','-c:v','libx264',path!]);
  }
  const project:DocumentaryProjectInput={aspectRatio:'16:9',settings:{voice:{enabled:false},assembly:{kenBurns:false}},scenes:[
    {id:'red',order:0,durationSeconds:3,videoPath:red,transition:'mix',transitionDurationSeconds:.5},
    {id:'blue',order:1,durationSeconds:.2,videoPath:blue,transition:'none'},
  ]};
  const timeline=buildDocumentaryTimeline(project);timeline.width=64;timeline.height=64;
  await renderPlainDocumentaryShot(timeline,timeline.scenes[1]!,output,18);
  const pixels=execFileSync(ffmpeg!,['-v','error','-i',output,'-vf','scale=1:1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],{windowsHide:true});
  assert.equal(pixels.length,6*3);
  assert.ok(pixels[0]!>220&&pixels[2]!<30,'Dissolve starts at the previous red frame');
  assert.ok(pixels[3]!>80&&pixels[3]!<180&&pixels[5]!>80&&pixels[5]!<180,'Middle frame mixes both sources');
  for(let frame=2;frame<6;frame++)assert.ok(pixels[frame*3]!<30&&pixels[frame*3+2]!>220,`Frame ${frame} must pass the current blue source through`);
});
