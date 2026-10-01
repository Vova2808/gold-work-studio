import {readFile,writeFile} from 'node:fs/promises';
import {effectFfmpeg} from '../src/effect-media.js';
// Source: Natural Earth I 1:50m, public domain. Download/extract on D: first.
const root='captures/motion-reference-20260926';
await effectFfmpeg(['-y','-i',`${root}/relief/NE1_50M_SR/NE1_50M_SR.tif`,'-vf','scale=5400:2700','-frames:v','1','-quality','86',`${root}/relief.webp`]);
const image=await readFile(`${root}/relief.webp`);
await writeFile('../../packages/remotion-video/src/documentary-relief-data.ts', '// Natural Earth I shaded relief, public domain. GEOGRAPHY_LICENSE.md.\nexport const documentaryRelief = '+JSON.stringify('data:image/webp;base64,'+image.toString('base64'))+';\n');
console.log(JSON.stringify({bytes:image.length,width:5400,height:2700}));
