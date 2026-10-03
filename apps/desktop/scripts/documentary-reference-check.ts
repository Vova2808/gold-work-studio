import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
import type {Project} from '@gold-work/shared';
import {planDocumentaryMontage} from '../src/documentary-montage.js';
import {renderDocumentary} from '../src/documentary-renderer.js';
import {probeEffectMedia,effectFfmpeg} from '../src/effect-media.js';
import {planDocumentaryEffects} from '../src/documentary-effects.js';
import {EffectLibrary} from '../src/effect-library.js';
import type {LocalProjectStorage} from '../src/local-project-storage.js';

// A silent 16-second composition check from existing assets; no provider calls.
// It does not validate automatic material search or twenty-minute production.
const release=process.argv.includes('--release');
const root=resolve(release?'captures/stock-release-20260927':'captures/reference-review-20260927'),registryPath='C:/Users/rosup/AppData/Roaming/@gold-work/desktop/projects.json';
const registry=await readFile(registryPath,'utf8'),source=(JSON.parse(registry) as Project[]).find(p=>p.id==='project_muihr14p_xsah7wf')!;
assert.ok(source);
const p=structuredClone(source);p.id='reference-composition-local';p.title='Связанный список — локальная проверка';
p.settings.voice.enabled=false;p.settings.assembly.transitionType='none';p.settings.assembly.quality='preview';
const text=['Три детали: ворота, вода и суда. ','Ворота закрывают камеру. ','Вода поднимает корабль. ','Суда проходят канал. '];
p.scenes=[0,33,36,0].map((order,index)=>{
  const s=structuredClone(source.scenes[order]!);
  return {...s,id:`reference-${index}`,order:index,narration:text[index]!,durationSeconds:4,durationOverrideSeconds:undefined,audioPath:undefined,sourceVolume:0,transition:'none' as const,fadeEdges:false,
    documentary:{...s.documentary!,pinned:false,template:undefined,motionGraphic:undefined,cuts:undefined,texts:undefined,effects:[],layout:'full' as const,comparison:undefined,timing:undefined,
      requirement:{...s.documentary!.requirement,text:text[index]!,motionGraphic:undefined,sectionTitle:undefined},caption:{...s.documentary!.caption,enabled:false}}};
});
p.videoBrief={...p.videoBrief!,readyScript:text.join('')};p.scenes=planDocumentaryMontage(p);
assert.deepEqual(p.scenes.map(s=>s.documentary?.motionGraphic?.activeIndex),[undefined,0,1,2]);
if(release){
  assert.ok(p.scenes.slice(1).every(s=>s.documentary?.motionGraphic?.presentation==='panels'));
  p.scenes=await planDocumentaryEffects(p,new EffectLibrary('D:/GoldWorkStorage/Library'),{projectDirectory:()=>root} as unknown as LocalProjectStorage);
  assert.ok(p.scenes.some(s=>s.documentary?.effects.some(e=>e.kind==='audio')));
}
await mkdir(root,{recursive:true});await writeFile(join(root,'sequence-project.json'),JSON.stringify(p,null,2));
const workers=process.argv.includes('--baseline')?2:process.argv.includes('--three-workers')?3:undefined;
const directory=join(root,workers===2?'baseline':workers===3?'three-workers':'adaptive');await mkdir(directory,{recursive:true});
let last=-20;const started=Date.now(),output=join(directory,'Sequence.mp4');
await renderDocumentary({project:p,clips:[],audioMasterPath:'',outputPath:output,onProgress:(stage,percent)=>{if(percent-last>=15){console.log(`${percent}% ${stage}`);last=percent;}}},
  {projectDirectory:directory,entryPoint:createRequire(import.meta.url).resolve('@gold-work/remotion-video/entry'),renderWorkers:workers});
const probe=await probeEffectMedia(output);assert.ok(Math.abs(probe.durationSeconds-16)<.04);
await effectFfmpeg(['-i',output,'-map','0:v:0','-f','null','-']);
assert.equal(await readFile(registryPath,'utf8'),registry);
await writeFile(join(directory,'result.json'),JSON.stringify({output,seconds:probe.durationSeconds,elapsedSeconds:(Date.now()-started)/1000,providerRequests:0,registryUnchanged:true,decodePassed:true,hasAudio:probe.hasAudio,effects:p.scenes.map(s=>({presentation:s.documentary?.motionGraphic?.presentation,sounds:s.documentary?.effects.filter(e=>e.kind==='audio').map(e=>({name:e.name,start:e.startSeconds,duration:e.durationSeconds}))}))},null,2));
await effectFfmpeg(['-i',output,'-vf','fps=1/2,scale=640:-1,tile=4x2','-frames:v','1','-y',join(directory,'contact.png')]);
console.log(output);
