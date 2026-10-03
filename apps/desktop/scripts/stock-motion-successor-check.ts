import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {bundle} from '@remotion/bundler';
import {openBrowser,renderMedia,renderStill,selectComposition} from '@remotion/renderer';
import {buildDocumentaryTimeline,documentaryRouteGeometry} from '@gold-work/remotion-video';
import {resolveDocumentaryPlace,type Project,type DocumentaryMotionGraphic} from '@gold-work/shared';
import {serveDocumentaryRenderMedia} from '../src/documentary-render-media.js';
import {prepareDocumentaryMap} from '../src/documentary-map.js';
import {effectFfmpeg,probeEffectMedia} from '../src/effect-media.js';
import {documentaryEditErrors} from '../src/documentary-validation.js';

const routeOnly=process.argv.includes('--route-only');
const root=resolve(routeOnly?'captures/stock-route-successor-20260926':'captures/stock-motion-successor-20260926');await mkdir(root,{recursive:true});
const registryPath='C:/Users/rosup/AppData/Roaming/@gold-work/desktop/projects.json';
const registry=await readFile(registryPath,'utf8');
const original=(JSON.parse(registry) as Project[]).find(p=>p.id==='project_muihr14p_xsah7wf')!;
const p=structuredClone(original),base=structuredClone(p.scenes.find(s=>s.documentary?.verified&&s.imagePath)!);
const photo=base.imagePath!,places=['Paris','Lyon','Marseille'].map(name=>resolveDocumentaryPlace(name,'France')!);
assert.ok(places.every(Boolean));
const common={enabled:true,startSeconds:0,durationSeconds:6,origin:'manual' as const};
const graphics:DocumentaryMotionGraphic[]=[
  {...common,kind:'map-route',title:'Маршрут',kicker:'ДЕМОНСТРАЦИЯ МАРШРУТА',route:places,fromPlace:places[0],place:places.at(-1),cameraZoom:1.04,regionRadiusKm:15},
  {...common,kind:'statistic',title:'Редактируемая подпись числового акцента',value:'78 167',kicker:'ПРИМЕР ОФОРМЛЕНИЯ'},
  {...common,kind:'feature-list',title:'Редактируемый список',items:['Первый длинный пункт для проверки читаемости','Второй пункт с отдельным появлением','Третий смысловой акцент'],activeIndex:1},
  {...common,kind:'quote',title:'Эта длинная редактируемая цитата проверяет, что весь текст остаётся в кадре и не обрезается после нескольких строк при экспорте.',kicker:'ПРИМЕР ОФОРМЛЕНИЯ'},
];
graphics[0]!.detail=await prepareDocumentaryMap(root,places.at(-1)!,35,places);
if(routeOnly)graphics.splice(1);
p.id='stock-motion-local-qa';p.title='Проверка оформления — не Final проекта';p.settings.voice.enabled=false;
p.settings.assembly.transitionType='mix';p.settings.assembly.transitionDurationSeconds=.35;
p.scenes=graphics.map((graphic,order)=>({...structuredClone(base),id:`motion-qa-${order}`,order,durationSeconds:6,durationOverrideSeconds:6,narration:'',audioPath:undefined,videoPath:undefined,imagePath:photo,transition:'mix',fadeEdges:false,
  documentary:{...structuredClone(base.documentary!),selected:{...base.documentary!.selected!,kind:'image',width:1920,height:1080},timing:undefined,template:'full',motionGraphic:graphic,layout:'full',comparison:undefined,cuts:undefined,texts:undefined,effects:[],caption:{...base.documentary!.caption,enabled:false}}}));
assert.deepEqual(documentaryEditErrors(p),[]);
await writeFile(join(root,'project.json'),JSON.stringify(p,null,2));
const timeline=buildDocumentaryTimeline(p),close=await serveDocumentaryRenderMedia(timeline);
const require=createRequire(import.meta.url),started=Date.now();
const serveUrl=await bundle({entryPoint:require.resolve('@gold-work/remotion-video/entry'),publicDir:null,outDir:join(root,'bundle')});
const browser=await openBrowser('chrome');
try{
  const composition=await selectComposition({serveUrl,id:'GoldWorkDocumentaryV2',inputProps:timeline,puppeteerInstance:browser});
  for(let i=0;i<graphics.length;i++)for(const frame of [12,75,165])await renderStill({serveUrl,composition,inputProps:timeline,frame:i*180+frame,output:join(root,`frame-${i}-${frame}.png`),scale:.5,puppeteerInstance:browser});
  const output=join(root,'Motion-check.mp4');
  await renderMedia({serveUrl,composition,inputProps:timeline,puppeteerInstance:browser,outputLocation:output,codec:'h264',crf:21,concurrency:2,offthreadVideoThreads:2,offthreadVideoCacheSizeInBytes:128*1024*1024});
  const info=await probeEffectMedia(output);assert.ok(Math.abs(info.durationSeconds-graphics.length*6)<.08);
  const decoded=await effectFfmpeg(['-i',output,'-map','0:v:0','-f','null','-']);
  assert.equal(Number([...decoded.matchAll(/frame=\s*(\d+)/g)].at(-1)?.[1]),graphics.length*180);
  const geometry=documentaryRouteGeometry(places,graphics[0]!.detail!.bounds!,1);
  await writeFile(join(root,'result.json'),JSON.stringify({elapsedSeconds:(Date.now()-started)/1000,duration:info.durationSeconds,frames:graphics.length*180,graphics:graphics.map(g=>g.kind),routePoints:geometry.points,registryUnchanged:await readFile(registryPath,'utf8')===registry,noPaidProviders:true},null,2));
  assert.equal(await readFile(registryPath,'utf8'),registry);console.log(output);
}finally{await browser.close({silent:true});await close();}
