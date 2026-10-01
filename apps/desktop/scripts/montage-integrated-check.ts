import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import type {Project} from '@gold-work/shared';
import {buildDocumentaryTimeline} from '@gold-work/remotion-video';
import {planDocumentaryMontage} from '../src/documentary-montage.js';
import {renderDocumentary} from '../src/documentary-renderer.js';
import {probeEffectMedia,effectFfmpeg} from '../src/effect-media.js';

// An uninterrupted opening from the existing paid film through the real
// planner and exporter. No hand-selected replacement footage or provider calls.
const directory=resolve('captures/montage-speed-20260927/new-production/integrated-20260929');await mkdir(directory,{recursive:true});
const registry=join(process.env.APPDATA!,'@gold-work/desktop/projects.json'),before=await readFile(registry,'utf8');
const original=(JSON.parse(before) as Project[]).find(p=>p.id==='project_mukba0q1_0cubga6')!;assert.ok(original);
const project=structuredClone(original);project.id='local-integrated-20260929';project.outputPath=undefined;
const planned=planDocumentaryMontage(project,false,true);let frames=0;
project.scenes=planned.filter(s=>{if(s.includeInAssembly===false)return false;if(frames>=60*30)return false;frames+=Math.max(s.documentary?.timing?.durationInFrames??Math.ceil(s.durationSeconds*30),Math.ceil((s.durationOverrideSeconds??0)*30));return true;});
assert.deepEqual(project.scenes.map(s=>[s.id,s.imagePath,s.videoPath,s.audioPath,s.narration]),original.scenes.filter(s=>project.scenes.some(t=>t.id===s.id)).map(s=>[s.id,s.imagePath,s.videoPath,s.audioPath,s.narration]));
const started=Date.now(),output=join(directory,'automatic-opening.mp4');
await renderDocumentary({project,clips:[],audioMasterPath:'',outputPath:output,onProgress:(stage,progress)=>console.log(JSON.stringify({stage,progress}))},{projectDirectory:join(directory,'work'),entryPoint:createRequire(import.meta.url).resolve('@gold-work/remotion-video/entry')});
const timeline=buildDocumentaryTimeline(project),info=await probeEffectMedia(output);
assert.ok(Math.abs((info.durationSeconds??0)-timeline.durationInFrames/30)<.15);
assert.equal(info.width,1920);assert.equal(info.height,1080);assert.equal(info.hasAudio,true);
await effectFfmpeg(['-v','error','-i',output,'-f','null','-']);
for(const second of [1,12,24,36,48,58])await effectFfmpeg(['-y','-ss',String(second),'-i',output,'-frames:v','1',join(directory,`frame-${second}.jpg`)]);
await effectFfmpeg(['-y','-ss','0','-i',output,'-t','16','-vn','-ar','24000','-ac','1',join(directory,'opening-audio.wav')]);
assert.equal(await readFile(registry,'utf8'),before);
const result={at:new Date().toISOString(),elapsedMs:Date.now()-started,scenes:project.scenes.length,seconds:info.durationSeconds,output,registryPreserved:true,voicePreserved:true,paidRequests:0,note:'One contiguous opening, real automatic planner and product exporter. Not a fresh full production or a 20-minute speed benchmark.'};
await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
