import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import type {Project} from '@gold-work/shared';
import {LocalProjectStorage} from '../src/local-project-storage.js';
import {StandardRenderer,runFfmpeg,mediaDurationSeconds} from '../src/standard-renderer.js';
import {RemotionMontageRenderer} from '../src/remotion-montage-renderer.js';
import {documentarySavedQualityIssue} from '../src/documentary-source-quality.js';
import {probeEffectMedia} from '../src/effect-media.js';

const registry='C:/Users/rosup/AppData/Roaming/@gold-work/desktop/projects.json',raw=await readFile(registry,'utf8');
const source=(JSON.parse(raw) as Project[]).find(p=>p.id==='project_mukba0q1_0cubga6')!,root=resolve('captures/montage-rich-20260928/full-frame-annotations');
await mkdir(root,{recursive:true});
const issues=source.scenes.flatMap(scene=>{const issue=documentarySavedQualityIssue(source,scene);return issue?[{order:scene.order,width:scene.documentary!.selected?.width,height:scene.documentary!.selected?.height,issue}]:[];});
const originals=[];
for(const issue of issues){
  const scene=source.scenes.find(s=>s.order===issue.order)!;
  const metadata=await probeEffectMedia((scene.videoPath||scene.imagePath)!);
  originals.push({order:issue.order,width:metadata.width,height:metadata.height,matchesSaved:metadata.width===issue.width&&metadata.height===issue.height});
}
assert.ok(originals.every(item=>item.matchesSaved),'Original dimensions differ from the saved selection');
await writeFile(join(root,'quality-audit.json'),JSON.stringify({checkedAt:new Date().toISOString(),source:source.id,verified:source.scenes.filter(s=>s.documentary?.verified).length,flagged:issues.length,issues,originals,registryChanged:false,paidRequests:0},null,2));
const scene=structuredClone(source.scenes.find(s=>s.order===1)!);assert.ok(scene.videoPath);assert.ok((scene.documentary!.selected!.durationSeconds??0)>=6);
for(const [i,time] of [.25,3,5.75].entries())await runFfmpeg(['-y','-ss',String(time),'-i',scene.videoPath,'-frames:v','1','-vf','scale=1280:-2',join(root,`source-${i}.jpg`)]);
if(!process.argv.includes('--render')){console.log(JSON.stringify({flagged:issues.length,frames:root}));process.exit(0);}
// Explicit local renderer/controls fixture. Coordinates are reviewed manually
// on these frames; this is NOT evidence of a live automatic detector.
scene.durationSeconds=6;scene.durationOverrideSeconds=undefined;scene.trimStartSeconds=0;scene.trimEndSeconds=6;scene.audioPath=undefined;scene.sourceVolume=0;scene.narration='';
scene.transition='none';scene.autoTransition=undefined;scene.documentary={...scene.documentary!,template:'full',cuts:undefined,texts:undefined,effects:[],caption:{...scene.documentary!.caption,enabled:false},timing:{sourceKey:'local-silent-check',durationInFrames:180,speechSeconds:0},motionGraphic:{kind:'annotations',enabled:true,title:'',origin:'manual',startSeconds:0,durationSeconds:6,annotations:[
  {label:'Переднее колесо',points:[{seconds:.25,x:44.2,y:61.9},{seconds:3,x:50.4,y:61.1},{seconds:5.75,x:57.4,y:61.2}]},
  {label:'Кузов',points:[{seconds:.25,x:35,y:55},{seconds:3,x:36,y:54},{seconds:5.75,x:37,y:54}]},
]}};
const project={...structuredClone(source),id:'local-full-frame-annotation-check',scenes:[scene],outputPath:undefined,settings:{...source.settings,voice:{...source.settings.voice,enabled:false}}};
const storage=new LocalProjectStorage(join(root,'projects'));await storage.ensureProject(project);
const renderer=new StandardRenderer(storage,new RemotionMontageRenderer(id=>storage.projectDirectory(id))),started=Date.now();
const output=await renderer.render(project,stage=>{if(!stage.includes('%'))console.log(stage);});
await runFfmpeg(['-v','error','-i',output,'-f','null','-']);
const frames=[];for(const [i,time] of [1,3,5].entries()){const path=join(root,`annotated-${i}.jpg`);await runFfmpeg(['-y','-ss',String(time),'-i',output,'-frames:v','1','-vf','scale=1280:-2',path]);frames.push(path);}
assert.equal(await readFile(registry,'utf8'),raw);
await writeFile(join(root,'result.json'),JSON.stringify({output,duration:await mediaDurationSeconds(output),renderAndCheckSeconds:(Date.now()-started)/1000,frames,registryPreserved:true,paidRequests:0,manualAnnotationFixture:true,liveAutomaticDetection:false},null,2));
console.log(JSON.stringify({output,frames}));
