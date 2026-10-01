import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,copyFile,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import type {Project} from '@gold-work/shared';
import {buildDocumentaryTimeline} from '@gold-work/remotion-video';
import {renderDocumentary} from '../src/documentary-renderer.js';
import {effectFfmpeg,probeEffectMedia} from '../src/effect-media.js';

// Read-only QA of the user's registry. No provider calls, replacement voices or
// authored substitute graphics: both exports use the product composition.
const root=resolve('captures/montage-speed-20260927');
const registryPath='C:/Users/rosup/AppData/Roaming/@gold-work/desktop/projects.json';
const mode=process.argv.includes('--after')?'after':'before';
await mkdir(root,{recursive:true});
if(process.argv.includes('--compare')){
  const output=join(root,'Before-after.mp4');
  await effectFfmpeg(['-y','-threads','2','-i',join(root,'before','Comparison.mp4'),'-threads','2','-i',join(root,'after','Comparison.mp4'),
    '-filter_complex','[0:v]scale=960:540[a];[1:v]scale=960:540[b];[a][b]hstack[v]',
    '-map','[v]','-map','1:a:0','-c:v','libx264','-preset','veryfast','-crf','20','-threads','2','-c:a','copy',output]);
  for(const scene of [41,50,122,128])await effectFfmpeg(['-y','-i',join(root,'before',`scene-${scene}.png`),'-i',join(root,'after',`scene-${scene}.png`),
    '-filter_complex','[0:v]scale=960:540[a];[1:v]scale=960:540[b];[a][b]hstack','-frames:v','1',join(root,`compare-${scene}.png`)]);
  console.log(output);process.exit(0);
}
const registry=await readFile(registryPath,'utf8');
let project:Project;
if(mode==='before'){
  const source=(JSON.parse(registry) as Project[]).find(p=>p.id==='project_mujq2wnq_4gdz3f3')!;
  assert.ok(source.outputPath);
  const backup=join(root,'Final-before.mp4');
  if(!await stat(backup).then(()=>true,()=>false))await copyFile(source.outputPath,backup);
  const full=buildDocumentaryTimeline(source);
  const orders=new Set([40,49,50,121,125,127,133]);
  project=structuredClone(source);project.id='montage-speed-local-comparison';
  for(const s of project.scenes){s.includeInAssembly=orders.has(s.order);if(s.documentary)s.documentary.candidates=[];}
  await writeFile(join(root,'comparison-project.json'),JSON.stringify(project,null,2));
  await writeFile(join(root,'before-index.json'),JSON.stringify(full.scenes.filter(s=>orders.has(s.order)).map(s=>({
    scene:s.order+1,at:s.fromFrame/30,seconds:s.durationInFrames/30,template:s.documentary?.template,
    graphic:s.documentary?.motionGraphic?.kind,text:s.narration,
    width:s.documentary?.selected?.width,height:s.documentary?.selected?.height
  })),null,2));
}else project=JSON.parse(await readFile(join(root,'comparison-project.json'),'utf8'));
const directory=join(root,process.argv.includes('--repeat')?`${mode}-resource-check`:mode);await mkdir(directory,{recursive:true});
const output=join(directory,'Comparison.mp4'),started=Date.now();
let last=-10;
const result=await renderDocumentary({project,clips:[],audioMasterPath:'',outputPath:output,onProgress:(stage,percent)=>{
  if(percent-last>=15){console.log(JSON.stringify({mode,percent,stage}));last=percent;}
}},{projectDirectory:directory,entryPoint:createRequire(import.meta.url).resolve('@gold-work/remotion-video/entry')});
const renderSeconds=(Date.now()-started)/1000;
const timeline=buildDocumentaryTimeline(project),info=await probeEffectMedia(output);
assert.ok(Math.abs(info.durationSeconds-timeline.durationInFrames/30)<.08);
await effectFfmpeg(['-xerror','-threads','2','-i',output,'-map','0:v:0','-map','0:a:0','-f','null','-']);
for(const [i,s] of timeline.scenes.entries()){
  await effectFfmpeg(['-y','-threads','1','-ss',String((s.fromFrame+s.durationInFrames*.6)/30),'-i',output,'-frames:v','1',join(directory,`scene-${s.order+1}.png`)]);
}
assert.equal(await readFile(registryPath,'utf8'),registry);
await writeFile(join(directory,'result.json'),JSON.stringify({...result,renderSeconds,output,decodePassed:true,registryUnchanged:true,paidCalls:0},null,2));
console.log(JSON.stringify({mode,renderSeconds,seconds:info.durationSeconds,output}));
