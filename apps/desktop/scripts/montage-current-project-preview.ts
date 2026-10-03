import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import type {Project,Scene} from '@gold-work/shared';
import {buildDocumentaryTimeline} from '@gold-work/remotion-video';
import {planDocumentaryMontage} from '../src/documentary-montage.js';
import {LocalProjectStorage} from '../src/local-project-storage.js';
import {StandardRenderer,mediaDurationSeconds,runFfmpeg} from '../src/standard-renderer.js';
import {RemotionMontageRenderer} from '../src/remotion-montage-renderer.js';

const root=resolve('captures/montage-speed-20260927/current-project-preview');
await mkdir(root,{recursive:true});
const registry='C:/Users/rosup/AppData/Roaming/@gold-work/desktop/projects.json';
const original=await readFile(registry,'utf8');
const source=(JSON.parse(original) as Project[]).find(p=>p.id==='project_mukba0q1_0cubga6')!;
assert.ok(source);
// Take the earliest complete, verified paragraph of at least 30 seconds.
// Selection is mechanical; assets, edit decisions and narration are not replaced.
let scenes:Scene[]=[],seconds=0;
for(const scene of [...source.scenes].sort((a,b)=>a.order-b.order)){
  if(scene.includeInAssembly===false)continue;
  if(!scene.documentary?.verified||!scene.audioPath){scenes=[];seconds=0;continue;}
  scenes.push(structuredClone(scene));seconds+=(scene.documentary.timing?.durationInFrames??scene.durationSeconds*30)/30;
  if(seconds>=30&&/\n\s*\n/.test(scene.narration))break;
  if(seconds>90){scenes=[];seconds=0;}
}
assert.ok(scenes.length&&seconds>=30&&seconds<=90,'Need a complete verified paragraph');
const planned=planDocumentaryMontage(structuredClone(source));
const p={...structuredClone(source),id:'local-current-project-preview',outputPath:undefined,
  scenes:scenes.map(s=>structuredClone(planned.find(item=>item.id===s.id)!))};
const voiceHashes=await Promise.all(p.scenes.map(async s=>({id:s.id,path:s.audioPath!,sha256:createHash('sha256').update(await readFile(s.audioPath!)).digest('hex')})));
await writeFile(join(root,'selection.json'),JSON.stringify({source:source.id,orders:p.scenes.map(s=>s.order),seconds,
  scope:'Read-only preview of an automatically selected completed paragraph; not a full production benchmark',paidRequests:0},null,2));
const storage=new LocalProjectStorage(join(root,'projects'));await storage.ensureProject(p);
const expected=buildDocumentaryTimeline(p);
const renderer=new StandardRenderer(storage,new RemotionMontageRenderer(id=>storage.projectDirectory(id)));
const started=Date.now();let last='';
const output=await renderer.render(p,(stage)=>{if(stage!==last){last=stage;console.log(stage);}});
const duration=await mediaDurationSeconds(output);
assert.ok(Math.abs(duration-expected.durationInFrames/30)<.08);
await runFfmpeg(['-v','error','-i',output,'-f','null','-']);
const frames=[];
for(let i=0;i<expected.scenes.length;i++){
  const s=expected.scenes[i]!,time=(s.fromFrame+s.durationInFrames*.5)/30;
  const path=join(root,`frame-${String(i+1).padStart(2,'0')}.jpg`);
  await runFfmpeg(['-y','-ss',String(time),'-i',output,'-frames:v','1','-vf','scale=960:-2',path]);
  frames.push({sceneOrder:p.scenes[i]!.order,time,path});
}
assert.equal(await readFile(registry,'utf8'),original,'User registry must remain unchanged');
for(const voice of voiceHashes)assert.equal(createHash('sha256').update(await readFile(voice.path)).digest('hex'),voice.sha256);
await writeFile(join(root,'result.json'),JSON.stringify({checkedAt:new Date().toISOString(),output,duration,
  renderAndCheckSeconds:(Date.now()-started)/1000,frames,voiceHashes,registryPreserved:true,paidRequests:0,
  fullProduction:false,sceneOrders:p.scenes.map(s=>s.order)},null,2));
console.log(JSON.stringify({output,duration,frames:frames.length,registryPreserved:true}));
