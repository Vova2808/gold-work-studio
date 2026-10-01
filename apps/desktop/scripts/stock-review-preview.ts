import { readFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Project } from '@gold-work/shared';
import { effectFfmpeg } from '../src/effect-media.js';
const key=process.argv[2];if(!key||!/^\d+(?:-\d+)*$/.test(key))throw new Error('Provide the scene group directory');
const root=resolve('captures/stock-selection-live',key),project:Project=JSON.parse(await readFile(join(root,'project.json'),'utf8'));
for(const number of key.split('-').map(Number)){
  const scene=project.scenes.find(s=>s.order+1===number)!;const review=scene.documentary?.visualReview;
  if(!scene.videoPath||!review?.sampleSeconds.length)continue;
  const directory=join(root,`frames-${number}`);await mkdir(directory,{recursive:true});
  for(const [index,time] of review.sampleSeconds.entries())await effectFfmpeg(['-y','-threads','1','-ss',String(time),'-i',scene.videoPath,'-frames:v','1','-vf','scale=384:216:force_original_aspect_ratio=decrease,pad=384:216:(ow-iw)/2:(oh-ih)/2',join(directory,`${index}.jpg`)]);
  await effectFfmpeg(['-y','-framerate','1','-i',join(directory,'%d.jpg'),'-vf',`tile=${review.sampleSeconds.length}x1`,'-frames:v','1',join(root,`scene-${number}.jpg`)]);
  console.log(join(root,`scene-${number}.jpg`));
}
