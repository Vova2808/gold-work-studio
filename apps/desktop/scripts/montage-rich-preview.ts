import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import type {Project} from '@gold-work/shared';
import {buildDocumentaryTimeline} from '@gold-work/remotion-video';
import {planDocumentaryMontage} from '../src/documentary-montage.js';
import {LocalProjectStorage} from '../src/local-project-storage.js';
import {StandardRenderer,mediaDurationSeconds,runFfmpeg} from '../src/standard-renderer.js';
import {RemotionMontageRenderer} from '../src/remotion-montage-renderer.js';

const root=resolve('captures/montage-rich-20260928'),registry='C:/Users/rosup/AppData/Roaming/@gold-work/desktop/projects.json';
const original=await readFile(registry,'utf8'),source=(JSON.parse(original) as Project[]).find(p=>p.id==='project_mukba0q1_0cubga6')!;assert.ok(source);
const planned=planDocumentaryMontage(structuredClone(source));
const groups=new Map<string,typeof planned>();
for(const scene of planned){
  const g=scene.documentary?.motionGraphic;if(!g?.enabled||!['explainer','statistic','annotations'].includes(g.kind))continue;
  const key=g.sequenceId??scene.id;groups.set(key,[...groups.get(key)??[],scene]);
}
const candidates=[...groups.values()].filter(scenes=>scenes.every(s=>s.documentary?.verified&&s.audioPath&&s.includeInAssembly!==false));
console.log(JSON.stringify(candidates.map(scenes=>({orders:scenes.map(s=>s.order),kind:scenes[0]!.documentary!.motionGraphic!.kind,text:scenes.map(s=>s.narration).join('').slice(0,200)}))));
if(!process.argv.includes('--render'))process.exit(0);
// First usable examples of each automatic composition. Never replace sources,
// introduce demo facts into the user's film, or pick a hand-edited better shot.
const chosen=new Set<string>(),counts=new Map<string,number>();let seconds=0;
for(const scenes of candidates){
  const kind=scenes[0]!.documentary!.motionGraphic!.kind,duration=scenes.reduce((sum,s)=>sum+(s.documentary!.timing?.durationInFrames??s.durationSeconds*30)/30,0);
  if((counts.get(kind)??0)>=2||seconds+duration>65)continue;
  for(const s of scenes)chosen.add(s.id);counts.set(kind,(counts.get(kind)??0)+1);seconds+=duration;
}
assert.ok(chosen.size,'Need automatically planned, verified editorial examples');
const project={...structuredClone(source),id:'local-rich-montage-preview',outputPath:undefined,scenes:planned.map(s=>({...s,includeInAssembly:chosen.has(s.id)}))};
await mkdir(root,{recursive:true});await writeFile(join(root,'selection.json'),JSON.stringify({source:source.id,orders:project.scenes.filter(s=>s.includeInAssembly).map(s=>s.order),seconds,paidRequests:0,scope:'Automatic editorial excerpts, not full-film acceptance or new-production timing'},null,2));
const storage=new LocalProjectStorage(join(root,'projects'));await storage.ensureProject(project);
const hashes=await Promise.all(source.scenes.filter(s=>s.audioPath).map(async s=>({path:s.audioPath!,hash:createHash('sha256').update(await readFile(s.audioPath!)).digest('hex')})));
const timeline=buildDocumentaryTimeline(project),renderer=new StandardRenderer(storage,new RemotionMontageRenderer(id=>storage.projectDirectory(id))),started=Date.now();
let last='';const output=await renderer.render(project,stage=>{if(stage!==last){last=stage;console.log(stage);}});
const duration=await mediaDurationSeconds(output);assert.ok(Math.abs(duration-timeline.durationInFrames/30)<.08);
await runFfmpeg(['-v','error','-i',output,'-f','null','-']);
const frames=[];
for(const [index,s] of timeline.scenes.entries()){
  const time=(s.fromFrame+s.durationInFrames*.55)/30,path=join(root,`frame-${index+1}.jpg`);
  await runFfmpeg(['-y','-ss',String(time),'-i',output,'-frames:v','1','-vf','scale=1280:-2',path]);frames.push({order:s.order,time,path,kind:s.documentary!.motionGraphic!.kind});
}
assert.equal(await readFile(registry,'utf8'),original);
for(const voice of hashes)assert.equal(createHash('sha256').update(await readFile(voice.path)).digest('hex'),voice.hash);
const report={checkedAt:new Date().toISOString(),output,duration,renderAndCheckSeconds:(Date.now()-started)/1000,frames,registryPreserved:true,voicesPreserved:hashes.length,paidRequests:0,fullProduction:false};
await writeFile(join(root,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,frames:frames.length}));
