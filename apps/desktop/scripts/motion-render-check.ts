import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {bundle} from '@remotion/bundler';
import {openBrowser,renderMedia,renderStill,selectComposition} from '@remotion/renderer';
import {buildDocumentaryTimeline} from '@gold-work/remotion-video';
import {resolveDocumentaryPlace,type Project,type DocumentaryMotionGraphic} from '@gold-work/shared';
import {serveDocumentaryRenderMedia} from '../src/documentary-render-media.js';
import {effectFfmpeg,probeEffectMedia} from '../src/effect-media.js';
import {planDocumentaryEffects} from '../src/documentary-effects.js';
import {EffectLibrary} from '../src/effect-library.js';
import {LocalProjectStorage} from '../src/local-project-storage.js';
import {prepareDocumentaryMap} from '../src/documentary-map.js';
import assert from 'node:assert/strict';
const mapOnly=process.argv.includes('--map-only'),seconds=mapOnly?6:4;
const root=resolve(mapOnly?'captures/motion-satellite-render-20260926':'captures/motion-render-20260926');await mkdir(root,{recursive:true});
const registry=await readFile('C:/Users/rosup/AppData/Roaming/@gold-work/desktop/projects.json','utf8');
const p=(JSON.parse(registry) as Project[]).find(p=>p.id==='project_mu9x2ywf_1s9thrt')!;
const photo=p.scenes[54]!.imagePath!;
const landscape=join(root,'landscape.jpg');
await effectFfmpeg(['-y','-ss','8.5','-i','C:/Users/rosup/Downloads/тестик ласт.mp4','-frames:v','1',landscape]);
const base={enabled:true,startSeconds:0,durationSeconds:seconds,origin:'manual' as const};
const graphics:DocumentaryMotionGraphic[]=[
  {...base,kind:'map-locator',title:'Денвер',kicker:'МЕСТО ДЕЙСТВИЯ',place:resolveDocumentaryPlace('Денвер'),zoom:6},
  {...base,kind:'chapter-number',title:'История города',value:'01',kicker:'ГЛАВА'},
  {...base,kind:'chronology',title:'Начало новой истории',value:'1858'},
  {...base,kind:'statistic',title:'Пример числового акцента',value:'78 167',kicker:'В ЦИФРАХ'},
  {...base,kind:'feature-list',title:'Природа Колорадо',items:['Скалистые горы','Меса-Верде','Грейт-Санд-Дьюнс','Блэк-Каньон'],activeIndex:0},
  {...base,kind:'callout',title:'Деталь конструкции',anchorX:52,anchorY:65},
  {...base,kind:'quote',title:'История начинается с одного шага',kicker:'ПРИМЕР ОФОРМЛЕНИЯ'},
  {...base,kind:'map-route',title:'Маршрут',kicker:'ЧЕРЕЗ АТЛАНТИКУ',place:resolveDocumentaryPlace('New York'),fromPlace:resolveDocumentaryPlace('London'),zoom:6},
];
if(mapOnly)graphics.splice(1);
graphics[0]!.detail=await prepareDocumentaryMap(resolve('captures/motion-satellite-20260926'),graphics[0]!.place!);
p.id='motion-local-qa';p.title='Motion · 8 редактируемых композиций';p.settings.voice.enabled=false;
p.settings.assembly.transitionType='none';p.settings.assembly.documentary!.sfxVolume=40;
p.scenes=graphics.map((motionGraphic,order)=>{const s=structuredClone(p.scenes[54]!);s.id=`motion-${order}`;s.order=order;s.durationSeconds=seconds;s.durationOverrideSeconds=seconds;s.videoPath=undefined;s.imagePath=order===3||order===5?photo:landscape;s.audioPath=undefined;s.transition='none';s.fadeEdges=false;s.documentary={...s.documentary!,timing:undefined,template:'full',motionGraphic,layout:'full',cuts:undefined,texts:undefined,comparison:undefined,effects:[],caption:{...s.documentary!.caption,enabled:false}};return s;});
for(const s of p.scenes) if(s.imagePath===landscape) s.documentary!.selected={...s.documentary!.selected!,width:1920,height:1080};
p.scenes=await planDocumentaryEffects(p,new EffectLibrary('D:/GoldWorkStorage/Library'),new LocalProjectStorage(join(root,'projects')));
await writeFile(join(root,'project.json'),JSON.stringify(p,null,2));
const timeline=buildDocumentaryTimeline(p),close=await serveDocumentaryRenderMedia(timeline);
const require=createRequire(import.meta.url),started=Date.now();
const serveUrl=await bundle({entryPoint:require.resolve('@gold-work/remotion-video/entry'),publicDir:null,outDir:join(root,'bundle')});
const browser=await openBrowser('chrome');
try{
  const composition=await selectComposition({serveUrl,id:'GoldWorkDocumentaryV2',inputProps:timeline,puppeteerInstance:browser});
  for(let i=0;i<graphics.length;i++)for(const [j,frame]of[10,Math.round(seconds*30*.45),seconds*30-15].entries())await renderStill({serveUrl,composition,inputProps:timeline,frame:i*seconds*30+frame,output:join(root,`frame-${i}-${j}.png`),scale:.5,puppeteerInstance:browser});
  const output=join(root,'Motion-demo.mp4');
  await renderMedia({serveUrl,composition,inputProps:timeline,puppeteerInstance:browser,outputLocation:output,codec:'h264',crf:21,concurrency:2,offthreadVideoThreads:2,offthreadVideoCacheSizeInBytes:128*1024*1024,onProgress:({progress})=>{if(Math.round(progress*100)%20===0)process.stdout.write('.');}});
  // AAC packet padding may add up to ~70 ms to the container. Verify actual
  // decoded video frames too, so this allowance cannot hide a timing error.
  const info=await probeEffectMedia(output);assert.ok(Math.abs(info.durationSeconds-graphics.length*seconds)<.08);
  const decoded=await effectFfmpeg(['-i',output,'-map','0:v:0','-f','null','-']);
  assert.equal(Number([...decoded.matchAll(/frame=\s*(\d+)/g)].at(-1)?.[1]),graphics.length*seconds*30);
  assert.equal(await readFile('C:/Users/rosup/AppData/Roaming/@gold-work/desktop/projects.json','utf8'),registry);
  await writeFile(join(root,'result.json'),JSON.stringify({seconds:(Date.now()-started)/1000,duration:info.durationSeconds,graphics:graphics.map(g=>g.kind),sounds:p.scenes.flatMap(s=>s.documentary!.effects.map(e=>({name:e.name,duration:e.durationSeconds,start:e.startSeconds}))),originalRegistryUnchanged:true},null,2));
  console.log('\n'+output);
}finally{await browser.close({silent:true});await close();}
