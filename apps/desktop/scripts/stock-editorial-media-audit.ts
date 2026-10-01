import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {effectFfmpeg,probeEffectMedia} from '../src/effect-media.js';
const root=resolve('captures/stock-editorial-speed-20260927'),file=join(root,'Editorial-preview.mp4');
const result=JSON.parse(await readFile(join(root,'result.json'),'utf8')),info=await probeEffectMedia(file);
assert.ok(Math.abs(info.durationSeconds-result.seconds)<.08);
const log=await effectFfmpeg(['-i',file,'-vf','blackdetect=d=0.1:pix_th=0.08','-af','volumedetect','-f','null','-']);
const black=[...log.matchAll(/black_start:([\d.]+) black_end:([\d.]+) black_duration:([\d.]+)/g)].map(m=>({start:Number(m[1]),end:Number(m[2]),seconds:Number(m[3])}));
const frames=Number([...log.matchAll(/frame=\s*(\d+)/g)].at(-1)?.[1]);
assert.equal(frames,Math.round(result.seconds*30));assert.deepEqual(black,[]);
await effectFfmpeg(['-y','-i',file,'-vf',"select='eq(n,60)+eq(n,1200)+eq(n,1980)+eq(n,2130)',scale=960:-1,tile=2x2",'-frames:v','1',join(root,'final-checked.png')]);
await effectFfmpeg(['-y','-i',file,'-vf','fps=1/4,scale=480:-1,tile=4x6','-frames:v','1',join(root,'contact.png')]);
const report={seconds:info.durationSeconds,frames,decodePassed:true,blackIntervals:black,
  meanDb:Number(/mean_volume:\s*([-\d.]+) dB/u.exec(log)?.[1]),peakDb:Number(/max_volume:\s*([-\d.]+) dB/u.exec(log)?.[1]),
  note:'Technical level/timing evidence; not a human listening verdict'};
await writeFile(join(root,'media-audit.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
