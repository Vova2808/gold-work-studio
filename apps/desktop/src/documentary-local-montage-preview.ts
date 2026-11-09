import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import type {Project} from '@gold-work/shared';
import {planDocumentaryMontage} from './documentary-montage.js';
import {montageFrames} from './documentary-semantic-montage.js';
import {compactMontageBatches} from './documentary-semantic-batches.js';

// Read-only input; the only write is an explicitly separate JSON preview.
const source=resolve(process.argv[2]??''),output=resolve(process.argv[3]??'');
if(!process.argv[2]||!process.argv[3]||source===output)throw Error('Provide project.json and a different preview.json path');
const original=await readFile(source,'utf8'),project=JSON.parse(original.replace(/^\uFEFF/u,'')) as Project;
const planned=planDocumentaryMontage(project),distribution:Record<string,number>={},templates:Record<string,number>={};
const rows=planned.filter(s=>s.includeInAssembly!==false).map(s=>{
  const g=s.documentary?.motionGraphic,kind=g?.enabled?g.kind:'footage';
  distribution[kind]=(distribution[kind]??0)+1;
  const template=s.documentary?.template??'full';templates[template]=(templates[template]??0)+1;
  return {sceneId:s.id,seconds:montageFrames(s)/30,kind,variant:g?.variant,layout:g?.boardLayout,
    text:g?.title||g?.value||g?.cards?.map(c=>c.label).join(' / '),items:g?.cards?.map(c=>c.label),
    startSeconds:g?.startSeconds,holdSeconds:g?.durationSeconds,cuts:s.documentary?.cuts?.length??0};
});
const checksum=(value:string)=>createHash('sha256').update(value).digest('hex');
const after=await readFile(source,'utf8');if(after!==original)throw Error('Project changed during preview');
const preview={source,projectSha256:checksum(original),sourceUnchanged:true,paidCalls:0,rendered:false,scenes:rows.length,
  durationSeconds:rows.reduce((sum,s)=>sum+s.seconds,0),meaningfulGraphics:rows.filter(r=>r.kind!=='footage').length,
  distribution,templates,cutScenes:rows.filter(r=>r.cuts>0).length,
  futureCompactBatches:compactMontageBatches(project.scenes.filter(s=>s.includeInAssembly!==false).sort((a,b)=>a.order-b.order)).map(b=>b.length),
  limitations:['Local event onset uses literal text position, not measured speech alignment.','No render/audio/visual acceptance performed.','Old paid receipts keep their existing boundaries and retry protection.'],rows};
await writeFile(output,JSON.stringify(preview,null,2),'utf8');
console.log(JSON.stringify({...preview,rows:undefined}));
