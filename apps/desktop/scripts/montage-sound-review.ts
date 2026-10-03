import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import type {Project} from '@gold-work/shared';
import {buildDocumentaryTimeline} from '@gold-work/remotion-video';
import {EffectLibrary} from '../src/effect-library.js';
import {LocalProjectStorage} from '../src/local-project-storage.js';
import {planDocumentaryEffects} from '../src/documentary-effects.js';
import {renderDocumentaryAudio} from '../src/documentary-fast-render.js';
import {effectFfmpeg,probeEffectMedia} from '../src/effect-media.js';

// Local review only: old narration and visuals, new automatic SFX on a clone.
// This is explicitly NOT a new-production or live-provider measurement.
const root=resolve('captures/montage-speed-20260927/sound-review');
await mkdir(root,{recursive:true});
const registryPath='C:/Users/rosup/AppData/Roaming/@gold-work/desktop/projects.json';
const registry=await readFile(registryPath,'utf8');
const source=(JSON.parse(registry) as Project[]).find(p=>p.id==='project_mujq2wnq_4gdz3f3');
assert.ok(source);
const clone=structuredClone(source);clone.id='montage-sound-review';
for(const scene of clone.scenes)if(scene.documentary)scene.documentary.effects=[];
clone.scenes=await planDocumentaryEffects(clone,new EffectLibrary('D:/GoldWorkStorage/Library'),new LocalProjectStorage(join(root,'projects')));
const events=(project:Project)=>buildDocumentaryTimeline(project).scenes.flatMap(s=>(s.documentary?.effects??[])
  .filter(e=>e.enabled&&e.kind==='audio').map(e=>({scene:s.order+1,at:s.fromFrame/30+e.startSeconds,duration:e.durationSeconds,
    name:e.name,graphic:s.documentary?.motionGraphic?.kind,value:s.documentary?.motionGraphic?.value,title:s.documentary?.motionGraphic?.title})));
const before=events(source),after=events(clone);
const timeline=buildDocumentaryTimeline(clone);
assert.ok(after.length<before.length,'Automatic sound design should be sparser on this real edit');
assert.ok(after.length<=Math.ceil(timeline.durationInFrames/30/90));
for(let i=1;i<after.length;i++)assert.ok(after[i]!.at-after[i-1]!.at>=44.5);
await writeFile(join(root,'sound-events.json'),JSON.stringify({duration:timeline.durationInFrames/30,before,after},null,2));
console.log(JSON.stringify({before:before.length,after:after.length,events:after}));
// A continuous 90-second actual scene sequence around a surviving accent.
const first=after[0];assert.ok(first);
const from=Math.max(0,first.at-20),to=from+90;
const included=new Set(timeline.scenes.filter(s=>s.fromFrame/30>=from&&(s.fromFrame+s.durationInFrames)/30<=to).map(s=>s.id));
for(const scene of clone.scenes)scene.includeInAssembly=included.has(scene.id);
const excerpt=buildDocumentaryTimeline(clone);
const output=await renderDocumentaryAudio(excerpt,root);assert.ok(output);
const info=await probeEffectMedia(output),log=await effectFfmpeg(['-i',output,'-af','volumedetect','-f','null','-']);
const peakDb=Number(/max_volume:\s*(-?[\d.]+) dB/.exec(log)?.[1]);
assert.ok(Number.isFinite(peakDb)&&peakDb<=-.4);
assert.ok(Math.abs(info.durationSeconds-excerpt.durationInFrames/30)<.03);
await effectFfmpeg(['-y','-i',output,'-c:a','libmp3lame','-q:a','3',join(root,'Sparse-accents.mp3')]);
assert.equal(await readFile(registryPath,'utf8'),registry);
await writeFile(join(root,'result.json'),JSON.stringify({beforeCount:before.length,afterCount:after.length,excerptSeconds:info.durationSeconds,
  originalFromSeconds:excerpt.scenes[0]&&timeline.scenes.find(s=>s.id===excerpt.scenes[0]!.id)!.fromFrame/30,
  peakDb,registryUnchanged:true,noPaidCalls:true,method:'Read-only original; freshly planned automatic SFX on disposable clone, reused paid narration.'},null,2));
