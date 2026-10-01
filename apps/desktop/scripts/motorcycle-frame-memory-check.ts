// Local regression only: fresh decoding must match previously reviewed source frames.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {availableParallelism,freemem} from 'node:os';
import {readVideoFrames} from '../src/documentary-video-catalog.js';
import {documentaryFrameWorkers} from '../src/documentary-resources.js';

const base=resolve('captures/montage-speed-20260927/new-production/motorcycle-live-20261001');
const out=join(base,'night-frame-memory');await mkdir(out,{recursive:true});
const previous=join(base,'range-budget-live');
const input=JSON.parse(await readFile(join(previous,'started.json'),'utf8'));
const project=JSON.parse(await readFile(join(base,'evening-additional/project.json'),'utf8'));
const scene=project.scenes.find((s:{order:number})=>s.order+1===input.scene);
const times=input.regions.map((region:{startSeconds:number})=>region.startSeconds+1.5);
const memory=freemem(),started=Date.now();
const frames=await readVideoFrames(scene.videoPath,join(out,'fresh-frames'),times);
for(let i=0;i<frames.length;i++){
  const expected=await readFile(join(previous,`range-${i}.jpg`));
  const actual=Buffer.from(frames[i]!.slice(frames[i]!.indexOf(',')+1),'base64');
  assert.equal(createHash('sha256').update(actual).digest('hex'),createHash('sha256').update(expected).digest('hex'));
}
const result={at:new Date().toISOString(),scene:input.scene,frames:frames.length,seconds:(Date.now()-started)/1000,freePhysicalMiB:memory/1048576,
  workers:documentaryFrameWorkers(availableParallelism(),memory),exactFrameHashesMatch:true,paidRequests:0,
  scope:'Fresh local decoding matches earlier reviewed JPEGs byte for byte; not a provider or total-production speed benchmark.'};
await writeFile(join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
