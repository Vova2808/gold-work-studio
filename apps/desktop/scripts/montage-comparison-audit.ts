import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {effectFfmpeg} from '../src/effect-media.js';
const root=resolve('captures/montage-speed-20260927');
const sound=[];
for(const mode of ['before','after']){
  const path=join(root,mode,'Comparison.mp4'),hash=join(root,mode,'audio-pcm.md5');
  const log=await effectFfmpeg(['-y','-i',path,'-map','0:a:0','-vn','-af','volumedetect','-c:a','pcm_s16le','-f','md5',hash]);
  sound.push({mode,pcmMd5:(await readFile(hash,'utf8')).trim(),peakDb:Number(log.match(/max_volume: ([-\d.]+) dB/)?.[1])});
}
assert.equal(sound[0]!.pcmMd5,sound[1]!.pcmMd5,'Narration/SFX mix changed during layout comparison');
assert.ok(sound.every(s=>s.peakDb<0));
// Same actual wide source at three times, to inspect the moving crop/navigator.
const at=7.0666666667+5.0666666667+1.3333333333;
for(const [i,offset] of [.2,1.9,3.5].entries())await effectFfmpeg(['-y','-ss',String(at+offset),'-i',join(root,'after','Comparison.mp4'),'-frames:v','1',join(root,`detail-${i}.png`)]);
await effectFfmpeg(['-y','-framerate','1','-i',join(root,'detail-%d.png'),'-vf','scale=640:360,tile=3x1','-frames:v','1',join(root,'detail-sequence.png')]);
await writeFile(join(root,'comparison-audit.json'),JSON.stringify({sound,identicalDecodedAudio:true,clipping:false,wideSourceSequence:[at+.2,at+1.9,at+3.5]},null,2));
console.log(JSON.stringify({identicalDecodedAudio:true,sound}));
