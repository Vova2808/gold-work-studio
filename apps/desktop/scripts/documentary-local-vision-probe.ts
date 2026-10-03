import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {freemem} from 'node:os';
import type {Project} from '@gold-work/shared';
import {ensureDocumentaryLocalVision,rankDocumentaryLocalImages} from '../src/documentary-local-vision.js';

async function main(){
 if(process.argv.includes('--prepare')){console.log(await ensureDocumentaryLocalVision(console.log));return;}
 const source=resolve('captures/montage-speed-20260927/new-production/motorcycle-live-20261001/speed-five/project.json');
 const project=JSON.parse(await readFile(source,'utf8')) as Project;
 const out=resolve('captures/stock-speed-20261002/local-vision');await mkdir(out,{recursive:true});
 const candidates=project.scenes.filter(s=>s.imagePath&&existsSync(s.imagePath));
 const rows=Array.from({length:10},(_,i)=>candidates[Math.floor(i*(candidates.length-1)/9)]!).map(s=>({scene:s.order+1,file:s.imagePath!,query:s.documentary?.requirement.queries[0]??s.narration,narration:s.narration,title:s.documentary?.selected?.title}));
 const queries=['a photograph of a motorcycle racer riding a motorcycle','a technical diagram of pistons and a crankshaft inside an engine','a portrait photograph of a man wearing a business suit','a screenshot of a video game','a photograph of a ship on the ocean'];
 const before=freemem();
 const result=await rankDocumentaryLocalImages(rows.map(r=>r.file),queries,join(out,'rgb'),console.log);
 await writeFile(join(out,`result-${Date.now()}.json`),JSON.stringify({at:new Date().toISOString(),source,queries,rows,result,skipped:!result?'memory-pressure':undefined,freeBefore:before,freeAfter:freemem(),paidCalls:0},null,2));
 console.log(JSON.stringify({rows:rows.map((r,i)=>({scene:r.scene,title:r.title,scores:result?.scores[i]})),...result,scores:undefined,freeBeforeMB:before/1048576,freeAfterMB:freemem()/1048576}));
}
main().catch(error=>{console.error(String(error));process.exitCode=1;});
