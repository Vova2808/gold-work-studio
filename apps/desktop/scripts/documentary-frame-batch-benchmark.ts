import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile,copyFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {readVideoFrames,DocumentaryBlackFrameError} from '../src/documentary-video-catalog.js';
import {effectFfmpeg} from '../src/effect-media.js';
import type {Project} from '@gold-work/shared';

const root=resolve('captures/montage-speed-20260927/new-production/frame-batch-20260930');await mkdir(root,{recursive:true});
const registry=join(process.env.APPDATA!,'@gold-work/desktop/projects.json'),before=await readFile(registry,'utf8');
const project=(JSON.parse(before) as Project[]).find(p=>p.id==='project_mukba0q1_0cubga6')!;
const scene=project.scenes.find(s=>s.videoPath&&(s.documentary?.selected?.durationSeconds??0)>20)!;assert.ok(scene);
const start=scene.trimStartSeconds??0,end=scene.trimEndSeconds??start+5;
const times=[.03,.25,.5,.75,.97].map(f=>start+(end-start)*f);
const extracted=join(root,'frames');const images=await readVideoFrames(scene.videoPath!,extracted,times);
const samples=[];
for(let trial=0;trial<3;trial++){
  const batchRoot=join(root,`batch-${trial}-${Date.now()}`);await mkdir(batchRoot,{recursive:true});
  for(const time of times)await copyFile(join(extracted,`${time.toFixed(3)}.jpg`),join(batchRoot,`${time.toFixed(3)}.jpg`));
  const legacy=async()=>{
    let cursor=0,black=false;
    const worker=async()=>{for(;;){const time=times[cursor++];if(time===undefined)return;
      const log=await effectFfmpeg(['-i',join(extracted,`${time.toFixed(3)}.jpg`),'-vf','blackframe=amount=98:threshold=20','-frames:v','1','-f','null','-']);
      black ||= /pblack:\s*(?:98|99|100)\b/.test(log);
    }};await Promise.all([worker(),worker()]);return black;
  };
  const at=performance.now(),legacyBlack=await legacy(),legacyMs=performance.now()-at;
  const batchAt=performance.now();let batchBlack=false;
  try{assert.deepEqual(await readVideoFrames(scene.videoPath!,batchRoot,times,true),images);}catch(error){if(!(error instanceof DocumentaryBlackFrameError))throw error;batchBlack=true;}
  const batchMs=performance.now()-batchAt;assert.equal(batchBlack,legacyBlack);
  samples.push({legacyMs,batchMs,black:batchBlack});
}
const median=(key:'legacyMs'|'batchMs')=>samples.map(s=>s[key]).sort((a,b)=>a-b)[1]!;
assert.equal(await readFile(registry,'utf8'),before);
const result={at:new Date().toISOString(),scope:'Five-frame local black validation only, extracted identical real-source JPEGs; no provider or full-production benchmark',sceneOrder:scene.order+1,samples,medianLegacyMs:median('legacyMs'),medianBatchMs:median('batchMs'),speedup:median('legacyMs')/median('batchMs'),processesBefore:5,processesAfter:1,paidRequests:0,registryPreserved:true};
await writeFile(join(root,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
