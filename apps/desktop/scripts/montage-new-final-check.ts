import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import type {Project} from '@gold-work/shared';
import {documentaryVideoCoverage} from '@gold-work/shared';
import {buildDocumentaryTimeline} from '@gold-work/remotion-video';
import {probeEffectMedia,effectFfmpeg} from '../src/effect-media.js';
import {revalidateDocumentaryVariety} from '../src/documentary-reuse.js';

// Final acceptance of the actual new production. Never fabricates a Final,
// substitutes old narration, updates projects, or calls a paid provider.
const out=resolve('captures/montage-speed-20260927/new-production');
const state=JSON.parse(await readFile(join(out,'state.json'),'utf8'));
const registry='C:/Users/rosup/AppData/Roaming/@gold-work/desktop/projects.json';
const before=await readFile(registry,'utf8');
const p=(JSON.parse(before) as Project[]).find(p=>p.id===state.projectId);
assert.ok(p?.outputPath&&p.status==='complete','Requires a completed new production');
assert.ok((await stat(p.outputPath)).mtimeMs>=Date.parse(state.startedAt));
const original=(await readFile(resolve('scripts/fixtures/automobile-production-20260928.txt'),'utf8')).trim();
assert.equal(p.scenes.map(s=>s.narration).join(''),original);
const included=p.scenes.filter(s=>s.includeInAssembly!==false);
assert.ok(included.every(s=>s.audioPath&&s.documentary?.verified));
const timeline=buildDocumentaryTimeline(p),info=await probeEffectMedia(p.outputPath);
const frames=join(out,'final-frames');await mkdir(frames,{recursive:true});
let cursor=0;
const sample=async()=>{for(;;){const i=cursor++;if(i>=timeline.scenes.length)return;const s=timeline.scenes[i]!;
  await effectFfmpeg(['-y','-threads','1','-ss',String((s.fromFrame+Math.floor(s.durationInFrames*.6))/30),'-i',p.outputPath!,'-frames:v','1','-vf','scale=960:-1',join(frames,`scene-${String(i+1).padStart(3,'0')}.jpg`)]);
}};
await Promise.all([sample(),sample()]);
const sheets:string[]=[];
for(let first=1;first<=timeline.scenes.length;first+=20){
  const count=Math.min(20,timeline.scenes.length-first+1),path=join(frames,`contact-${String(first).padStart(3,'0')}-${first+count-1}.jpg`);
  await effectFfmpeg(['-y','-framerate','1','-start_number',String(first),'-i',join(frames,'scene-%03d.jpg'),'-vf',`scale=384:216,tile=5x4:nb_frames=${count}:padding=4:margin=4:color=black`,'-frames:v','1',path]);sheets.push(path);
}
console.log(JSON.stringify({stage:'sampled',scenes:timeline.scenes.length,contactSheets:sheets.length}));
const decoded=await effectFfmpeg(['-xerror','-stats_period','10','-threads','2','-i',p.outputPath,'-map','0:v:0','-map','0:a:0',
  '-vf','blackdetect=d=0.6:pix_th=0.08,freezedetect=n=-60dB:d=8','-af','volumedetect,silencedetect=n=-50dB:d=1.5','-f','null','-'],undefined,false,300000);
const decodedFrames=Number([...decoded.matchAll(/frame=\s*(\d+)/g)].at(-1)?.[1]);
const checked=revalidateDocumentaryVariety(p);
const repeats=checked.filter((s,i)=>p.scenes[i]!.documentary?.verified&&!s.documentary?.verified).map(s=>({scene:s.order+1,reason:s.documentary?.autoError}));
const result={checkedAt:new Date().toISOString(),projectId:p.id,output:p.outputPath,width:info.width,height:info.height,
  seconds:info.durationSeconds,expectedSeconds:timeline.durationInFrames/30,decodedFrames,expectedFrames:timeline.durationInFrames,
  durationTargetMet:info.durationSeconds>=900&&info.durationSeconds<=1200+1/30,
  peakDb:Number(decoded.match(/max_volume: ([-\d.]+) dB/)?.[1]),
  blackIntervals:[...decoded.matchAll(/black_start:(\S+) black_end:(\S+) black_duration:(\S+)/g)].map(m=>({start:Number(m[1]),end:Number(m[2]),seconds:Number(m[3])})),
  freezeMarkers:[...decoded.matchAll(/freeze_(start|end|duration):\s*(\S+)/g)].map(m=>({kind:m[1],seconds:Number(m[2])})),
  silenceMarkers:[...decoded.matchAll(/silence_(start|end):\s*(\S+)/g)].map(m=>({kind:m[1],seconds:Number(m[2])})),
  originalNarrationPreserved:true,newVoiceSceneCount:included.length,videoCoverage:documentaryVideoCoverage(p.scenes),
  graphicScenes:included.filter(s=>s.documentary?.motionGraphic?.enabled).length,
  sounds:included.flatMap(s=>s.documentary?.effects??[]).filter(e=>e.enabled&&e.kind==='audio').length,
  repeatsDetected:repeats.length,repeats,contactSheets:sheets,readOnly:true,
  limitations:'Frame sheets and long-freeze/silence markers still require visual/audio review. This check alone does not prove full production speed or artistic quality.'};
assert.equal(await readFile(registry,'utf8'),before);
await writeFile(join(out,'final-validation.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({...result,repeats:undefined,contactSheets:undefined}));
assert.equal(info.width,1920);assert.equal(info.height,1080);
assert.equal(decodedFrames,timeline.durationInFrames);assert.ok(Math.abs(info.durationSeconds-timeline.durationInFrames/30)<.08);
assert.ok(result.durationTargetMet,'Actual new narration must produce 15–20 minutes');
assert.equal(repeats.length,0,'Review unintended source repeats before acceptance');
