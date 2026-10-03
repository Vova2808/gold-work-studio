import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {documentaryTransitionPair,type Project} from '@gold-work/shared';
import {buildDocumentaryTimeline} from '@gold-work/remotion-video';
import {EffectLibrary} from '../src/effect-library.js';
import {copyDocumentaryEffect} from '../src/documentary-effects.js';
import {LocalProjectStorage} from '../src/local-project-storage.js';
import {StandardRenderer,mediaDurationSeconds,runFfmpeg} from '../src/standard-renderer.js';
import {RemotionMontageRenderer} from '../src/remotion-montage-renderer.js';

const root=resolve('captures/montage-speed-20260927/transition-render');await mkdir(root,{recursive:true});
const registry='C:/Users/rosup/AppData/Roaming/@gold-work/desktop/projects.json';
const original=await readFile(registry,'utf8');
const source=(JSON.parse(original) as Project[]).find(p=>p.id==='project_mujq2wnq_4gdz3f3')!;
const p=structuredClone(source);p.id='local-transition-render-check';p.outputPath=undefined;
p.scenes=[40,49,121,127].map((i,order)=>({...structuredClone(source.scenes[i]!),order}));
p.settings.assembly.transitionType='none';p.settings.assembly.documentary!.autoTransitions=true;
for(const s of p.scenes){s.includeInAssembly=true;s.transition=undefined;s.transitionDurationSeconds=undefined;s.autoTransition=undefined;s.autoTransitionDurationSeconds=undefined;
  s.documentary!.effects=[];s.documentary!.comparison=undefined;s.documentary!.layout='full';s.documentary!.cuts=undefined;s.documentary!.texts=undefined;s.documentary!.motionGraphic=undefined;
  s.documentary!.template='full';s.documentary!.caption.enabled=false;}
// Explicit regression fixture: three seam types, separate from the new film.
p.scenes[0]!.autoTransition='mix';p.scenes[0]!.autoTransitionDurationSeconds=.5;
p.scenes[1]!.transition='fade';p.scenes[1]!.transitionDurationSeconds=.5;
const storage=new LocalProjectStorage(join(root,'projects'));
const library=new EffectLibrary('D:/GoldWorkStorage/Library');
const asset=(await library.snapshot()).assets.find(a=>a.id==='14ff805600e511d36691ae47ee5f7079a1d3d2c2d6310af02e3adda47e88f0a0')!;assert.ok(asset);
const effect=await copyDocumentaryEffect(library,storage,p.id,asset.id,asset);
effect.durationSeconds=(asset.defaults.trimEndSeconds??asset.metadata!.durationSeconds!)-asset.defaults.trimStartSeconds;
const [left,right]=documentaryTransitionPair(p.scenes[2]!,p.scenes[3]!,effect,'manual');
p.scenes[2]!.documentary!.effects=[left!];p.scenes[3]!.documentary!.effects=[right!];
await storage.ensureProject(p);
const expected=buildDocumentaryTimeline(p);
const renderer=new StandardRenderer(storage,new RemotionMontageRenderer(id=>storage.projectDirectory(id)));
const progress:Array<{stage:string;percent:number}>=[];
const started=Date.now();let last='';
const output=await renderer.render(p,(stage,percent)=>{progress.push({stage,percent});if(stage!==last){last=stage;console.log(stage)}});
const duration=await mediaDurationSeconds(output);assert.ok(Math.abs(duration-expected.durationInFrames/30)<.06);
assert.ok(progress.some(e=>e.stage.startsWith('Монтаж:')));assert.ok(progress.some(e=>e.stage.startsWith('Экспорт:')&&e.percent===95));
await runFfmpeg(['-v','error','-i',output,'-f','null','-']);
for(let i=1;i<4;i++){
  const cut=expected.scenes[i]!.fromFrame/30;
  for(const [tag,offset] of [['before',-.1],['at',0],['during',.2],['after',.7]] as const){
    await runFfmpeg(['-y','-ss',String(cut+offset),'-i',output,'-frames:v','1',join(root,`seam-${i}-${tag}.png`)]);
  }
}
assert.equal(await readFile(registry,'utf8'),original,'No user project may be changed by a visual regression fixture');
await writeFile(join(root,'result.json'),JSON.stringify({checkedAt:new Date().toISOString(),output,duration,renderSeconds:(Date.now()-started)/1000,progress,
  kind:'Local render fixture on four cloned old scenes; not autonomous new production',sourceProjectPreserved:true,newPaidCalls:0,sourceVoices:p.scenes.map(s=>({id:s.id,path:s.audioPath})),
  registrySha256:createHash('sha256').update(original).digest('hex'),librarySourceMuted:true,cutSeconds:expected.scenes.slice(1).map(s=>s.fromFrame/30)},null,2));
console.log(JSON.stringify({output,duration}));
