import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import {buildDocumentaryTimeline} from '@gold-work/remotion-video';
import {effectFfmpeg,probeEffectMedia} from './effect-media.js';
import {isPlainDocumentaryShot,renderPlainDocumentaryShot} from './documentary-fast-render.js';

test('the fast dissolve paints the outgoing frozen frame, blends, and keeps the full next-shot duration',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-fast-blend-'));t.after(()=>rm(root,{recursive:true,force:true}));
  for(const color of ['red','blue'])await effectFfmpeg(['-y','-f','lavfi','-i',`color=c=${color}:s=640x360:r=30:d=2`,'-c:v','libx264','-preset','ultrafast',join(root,`${color}.mp4`)]);
  const timeline=buildDocumentaryTimeline({aspectRatio:'16:9',settings:{voice:{enabled:false},assembly:{kenBurns:false,transitionType:'none',documentary:{version:2,autoTransitions:true}}},scenes:['red','blue'].map((color,order)=>({id:color,order,durationSeconds:2,videoPath:join(root,`${color}.mp4`),autoTransition:order===0?'mix':undefined,autoTransitionDurationSeconds:.4,
    documentary:{layout:'full',caption:{enabled:false,text:''},effects:[],selected:{width:640,height:360,durationSeconds:2}}}))} as never);
  timeline.width=640;timeline.height=360;
  assert.equal(isPlainDocumentaryShot(timeline,0),true);assert.equal(isPlainDocumentaryShot(timeline,1),true);
  const output=join(root,'mixed.mp4');await renderPlainDocumentaryShot(timeline,timeline.scenes[1]!,output,18);
  assert.ok(Math.abs((await probeEffectMedia(output)).durationSeconds!-2)<.04);
  const pixels=(at:number)=>{const r=spawnSync(ffmpeg!,['-v','error','-ss',String(at),'-i',output,'-vf','scale=1:1','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1']);assert.equal(r.status,0);return [...r.stdout];};
  const begin=pixels(0),middle=pixels(.2),end=pixels(.7);
  assert.ok(begin[0]!>200&&begin[2]!<30);assert.ok(middle[0]!>70&&middle[2]!>70);assert.ok(end[2]!>200&&end[0]!<30);
  timeline.scenes[0]!.documentary!.transitionStyle='blur';assert.equal(isPlainDocumentaryShot(timeline,1),false);
});
