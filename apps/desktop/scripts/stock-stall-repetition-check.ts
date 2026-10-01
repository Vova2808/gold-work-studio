// Read-only audit of the actual user project; never revoke stored selections.
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import type {Project} from '@gold-work/shared';
import {revalidateDocumentaryVariety} from '../src/documentary-reuse.js';
const projects=JSON.parse(await readFile(join(process.env.APPDATA!,'@gold-work/desktop/projects.json'),'utf8')) as Project[];
const project=projects.find(p=>p.id==='project_mujq2wnq_4gdz3f3')!;
const checked=revalidateDocumentaryVariety(project);
const repeats=checked.filter((s,index)=>project.scenes[index]!.documentary?.verified&&!s.documentary?.verified)
  .map(s=>({scene:s.order+1,kind:s.documentary?.selected?.kind,reason:s.documentary?.autoError}));
const result={checkedAt:new Date().toISOString(),readOnly:true,sceneCount:checked.length,repeatsDetected:repeats.length,
  photos:repeats.filter(s=>s.kind==='image').length,videos:repeats.filter(s=>s.kind==='video').length,repeats};
await writeFile(resolve('captures/stock-stall-20260927/repetition-audit.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({...result,repeats:undefined},null,2));
