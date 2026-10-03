import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import type {Project,Scene,DocumentaryVisualCut} from '@gold-work/shared';
import {buildDocumentaryTimeline} from '@gold-work/remotion-video';
import {prepareDocumentaryScript} from '../src/documentary-plan.js';
import {planDocumentaryMontage} from '../src/documentary-montage.js';
import {planDocumentaryEffects} from '../src/documentary-effects.js';
import {EffectLibrary} from '../src/effect-library.js';
import type {LocalProjectStorage} from '../src/local-project-storage.js';
import {renderDocumentaryAudio} from '../src/documentary-fast-render.js';
import {renderDocumentary} from '../src/documentary-renderer.js';
import {prepareDocumentaryMap} from '../src/documentary-map.js';
import {effectFfmpeg,probeEffectMedia} from '../src/effect-media.js';
import {documentaryEditErrors} from '../src/documentary-validation.js';

// This is an isolated style/renderer check, NOT a new end-to-end production run.
// Sentence-sized audio is assembled from existing paid clips without regenerating
// or changing one word. Original verified visual cuts remain at their old times.
const root=resolve('captures/stock-editorial-speed-20260927');await mkdir(root,{recursive:true});
const registryPath='C:/Users/rosup/AppData/Roaming/@gold-work/desktop/projects.json';
const registry=await readFile(registryPath,'utf8'),projects=JSON.parse(registry) as Project[];
if(process.argv.includes('--render-saved')){
  const project=JSON.parse(await readFile(join(root,'project.json'),'utf8')) as Project;
  const result=JSON.parse(await readFile(join(root,'result.json'),'utf8'));
  let last=-20;const started=Date.now(),output=join(root,'Editorial-preview.mp4');
  await renderDocumentary({project,clips:[],audioMasterPath:'',outputPath:output,onProgress:(stage,percent)=>{if(percent-last>=10){console.log(`${percent}% ${stage}`);last=percent;}}},
    {projectDirectory:root,entryPoint:createRequire(import.meta.url).resolve('@gold-work/remotion-video/entry')});
  const info=await probeEffectMedia(output);assert.ok(Math.abs(info.durationSeconds-result.seconds)<.08);
  const decoded=await effectFfmpeg(['-i',output,'-map','0:v:0','-f','null','-']);
  assert.equal(Number([...decoded.matchAll(/frame=\s*(\d+)/g)].at(-1)?.[1]),Math.round(result.seconds*30));
  assert.equal(await readFile(registryPath,'utf8'),registry);
  await writeFile(join(root,'result.json'),JSON.stringify({...result,renderSeconds:(Date.now()-started)/1000,output,decodePassed:true},null,2));
  console.log(output);process.exit(0);
}
const source=projects.find(p=>p.id==='project_muihr14p_xsah7wf')!;
const cold=projects.find(p=>p.id==='project_muj5r1uv_pphrclx')!;
assert.ok(source&&cold);
const fresh=prepareDocumentaryScript({...source,scenes:[]},source.settings.voice.calibration!);
assert.equal(fresh.map(s=>s.narration).join(''),source.videoBrief!.readyScript);
assert.deepEqual(prepareDocumentaryScript(source,source.settings.voice.calibration!),source.scenes);
const stats={oldProductionUnits:source.scenes.length,newProductionUnits:fresh.length,
  reductionPercent:Math.round((1-fresh.length/source.scenes.length)*100),exactScript:true,paidScenesPreserved:true};
await writeFile(join(root,'planning.json'),JSON.stringify(stats,null,2));console.log(JSON.stringify(stats));
if(!process.argv.includes('--render'))process.exit(0);
const groups=[[0,1,2],[3,4,5,6],[7,8],[9,10,11,12,13],[14,15,16,17],[18,19,20,21,22,23],[48,49,50,51],[67,68],[69,70,71,72]];
const p=structuredClone(source);p.id='editorial-speed-local-qa';p.title='Монтаж: проверка новых правил на сохранённых материалах';
p.settings.assembly.quality='preview';p.settings.assembly.transitionType='none';
const cutsById=new Map<string,DocumentaryVisualCut[]>(),narrationSources=new Map<string,number[]>();
p.scenes=[];
for(const [order,orders] of groups.entries()){
  const saved=orders.map(index=>structuredClone(source.scenes[index]!));
  const id=`editorial-check-${order}`,dir=join(root,id);await mkdir(dir,{recursive:true});
  const voiceProject={...source,scenes:saved.map(s=>({...s,sourceVolume:0,documentary:{...s.documentary!,effects:[]}}))};
  const audio=await renderDocumentaryAudio(buildDocumentaryTimeline(voiceProject),dir);assert.ok(audio);
  let frames=0;
  const cuts=saved.map(s=>{
    const durationInFrames=s.documentary!.timing!.durationInFrames;
    const cut={id:`cut-${s.id}`,sourceSceneId:s.id,fromFrame:frames,durationInFrames,trimStartSeconds:s.trimStartSeconds??0,trimEndSeconds:s.trimEndSeconds,playbackRate:s.playbackRate??1};
    frames+=durationInFrames;return cut;
  });
  const first=saved[0]!,narration=saved.map(s=>s.narration).join('');
  const planned=orders.map(index=>cold.scenes[index]!.documentary!.requirement.motionGraphic??source.scenes[index]!.documentary!.requirement.motionGraphic).filter(Boolean);
  // Use the previously saved semantic requirement, giving routes priority.
  const motion=planned.find(g=>g!.kind==='map-route')??planned.find(g=>g!.kind==='statistic')??planned[0];
  const scene:Scene={...first,id,order,narration,audioPath:audio,durationSeconds:frames/30,durationOverrideSeconds:undefined,transition:'none',sourceVolume:0,fadeEdges:false,
    documentary:{...first.documentary!,pinned:false,template:undefined,motionGraphic:undefined,cuts:undefined,texts:undefined,effects:[],comparison:undefined,layout:'full',
      requirement:{...first.documentary!.requirement,text:narration,sectionTitle:undefined,motionGraphic:motion},caption:{...first.documentary!.caption,enabled:false},
      timing:{sourceKey:id,audioPath:audio,durationInFrames:frames,speechSeconds:frames/30}}};
  p.scenes.push(scene);cutsById.set(id,cuts);narrationSources.set(id,orders);
}
p.videoBrief={...p.videoBrief!,readyScript:p.scenes.map(s=>s.narration).join('')};
// The production planner chooses all designs; this script does not pick kinds.
p.scenes=planDocumentaryMontage(p);
for(const scene of p.scenes){
  const graphic=scene.documentary!.motionGraphic;
  if(graphic?.kind.startsWith('map-'))graphic.detail=await prepareDocumentaryMap(root,graphic.place!,graphic.mapRadiusKm??35,graphic.kind==='map-route'?graphic.route:undefined);
}
p.scenes=await planDocumentaryEffects(p,new EffectLibrary('D:/GoldWorkStorage/Library'),{projectDirectory:()=>root} as unknown as LocalProjectStorage);
for(const scene of p.scenes)scene.documentary!.cuts=cutsById.get(scene.id);
// Excluded source scenes provide exact media references for editable visual cuts.
p.scenes.push(...source.scenes.map((s,index)=>({...structuredClone(s),order:100+index,includeInAssembly:false})));
assert.deepEqual(documentaryEditErrors(p),[]);
await writeFile(join(root,'project.json'),JSON.stringify(p,null,2));
const included=p.scenes.filter(s=>s.includeInAssembly!==false),report={...stats,
  purpose:'Short style/render check on grouped saved voice and verified cuts, not cold assembly or a 20-minute benchmark',
  seconds:buildDocumentaryTimeline(p).durationInFrames/30,
  events:included.map(s=>({order:s.order,originalScenes:narrationSources.get(s.id),motion:s.documentary?.motionGraphic?.kind,sounds:s.documentary?.effects.filter(e=>e.kind==='audio').length})),
  paidProviderRequests:0,registryUnchanged:await readFile(registryPath,'utf8')===registry};
await writeFile(join(root,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
const started=Date.now(),output=join(root,'Editorial-preview.mp4');let last=-20;
await renderDocumentary({project:p,clips:[],audioMasterPath:'',outputPath:output,onProgress:(stage,percent)=>{if(percent-last>=10){console.log(`${percent}% ${stage}`);last=percent;}}},
  {projectDirectory:root,entryPoint:createRequire(import.meta.url).resolve('@gold-work/remotion-video/entry')});
const info=await probeEffectMedia(output);assert.ok(Math.abs(info.durationSeconds-report.seconds)<.08);
const decoded=await effectFfmpeg(['-i',output,'-map','0:v:0','-f','null','-']);
assert.equal(Number([...decoded.matchAll(/frame=\s*(\d+)/g)].at(-1)?.[1]),Math.round(report.seconds*30));
assert.equal(await readFile(registryPath,'utf8'),registry);
await writeFile(join(root,'result.json'),JSON.stringify({...report,renderSeconds:(Date.now()-started)/1000,output,decodePassed:true},null,2));
console.log(output);
