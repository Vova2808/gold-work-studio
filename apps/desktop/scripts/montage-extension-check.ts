import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import type {Project} from '@gold-work/shared';
import {LocalProjectStorage} from '../src/local-project-storage.js';
import {StandardRenderer,runFfmpeg,mediaDurationSeconds} from '../src/standard-renderer.js';
import {RemotionMontageRenderer} from '../src/remotion-montage-renderer.js';

const registry='C:/Users/rosup/AppData/Roaming/@gold-work/desktop/projects.json',before=await readFile(registry,'utf8');
const fixture=JSON.parse(await readFile(resolve('captures/vidrush-refinement-20260928/visual/fixture.json'),'utf8')) as Project;
const root=resolve('captures/montage-extension-20260928');await mkdir(root,{recursive:true});
const project=structuredClone(fixture);project.id='local-extension-check';project.outputPath=undefined;
project.settings.voice.enabled=false;project.settings.assembly.documentary!.autoMotionGraphics=false;
project.settings.assembly.documentary!.autoEffects=false;project.settings.assembly.documentary!.autoTransitions=false;
const source=fixture.scenes.find(s=>s.documentary?.template==='compare-grid')!;
const other=structuredClone(fixture.scenes.find(s=>s.id===source.documentary!.comparison!.sceneId)!);other.order=5;other.includeInAssembly=false;
project.scenes=(['blueprint-board','archive-slide','compare-reveal','compare-filmstrip','broadcast-crt'] as const).map((template,order)=>{
  const scene=structuredClone(source);scene.id=`extension-${order}`;scene.order=order;scene.title=template;scene.narration='';scene.audioPath=undefined;scene.durationSeconds=2;
  scene.documentary={...scene.documentary!,template,templateOrigin:'manual',layout:template.startsWith('compare')?'compare':'full',motionGraphic:undefined,effects:[],timing:undefined};
  return scene;
});project.scenes.push(other);
const storage=new LocalProjectStorage(join(root,'projects'));await storage.ensureProject(project);
const renderer=new StandardRenderer(storage,new RemotionMontageRenderer(id=>storage.projectDirectory(id))),started=Date.now();
let last='';const output=await renderer.render(project,stage=>{const key=stage.replace(/\d+/g,'#');if(key!==last){last=key;console.log(stage);}});
await runFfmpeg(['-v','error','-i',output,'-f','null','-']);
const frames=[];for(const at of [1,3,5,7,8.3,9.3]){const path=join(root,`frame-${at}.jpg`);await runFfmpeg(['-y','-ss',String(at),'-i',output,'-frames:v','1','-q:v','2',path]);frames.push(path);}
assert.equal(await readFile(registry,'utf8'),before);
const result={output,seconds:(Date.now()-started)/1000,duration:await mediaDurationSeconds(output),frames,registryPreserved:true,paidRequests:0,fixture:true};
await writeFile(join(root,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
