import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {bundle} from '@remotion/bundler';
import {openBrowser,selectComposition,renderStill,renderMedia} from '@remotion/renderer';
import type {Project,DocumentaryTemplate} from '@gold-work/shared';
import {buildDocumentaryTimeline} from '@gold-work/remotion-video';
import {planDocumentaryMontage} from '../src/documentary-montage.js';
import {prepareDocumentaryRenderMedia,serveDocumentaryRenderMedia} from '../src/documentary-render-media.js';
import {effectFfmpeg,probeEffectMedia} from '../src/effect-media.js';
const root=resolve('captures/montage-speed-20260927/new-production/upgrade-render-20260930');await mkdir(root,{recursive:true});
const registry=join(process.env.APPDATA!,'@gold-work/desktop/projects.json'),before=await readFile(registry,'utf8');
const project=(JSON.parse(before) as Project[]).find(p=>p.id==='project_mukba0q1_0cubga6')!;assert.ok(project);
const original=buildDocumentaryTimeline(project),planned=planDocumentaryMontage(structuredClone(project),false,true);
const timeline=buildDocumentaryTimeline({...project,scenes:planned}),counts:Record<string,number>={},thirds=[0,0,0];
assert.equal(timeline.durationInFrames,original.durationInFrames);
assert.deepEqual(planned.map(s=>[s.imagePath,s.videoPath,s.audioPath,s.narration]),project.scenes.map(s=>[s.imagePath,s.videoPath,s.audioPath,s.narration]));
for(const s of timeline.scenes){const id=s.documentary?.template??'full';counts[id]=(counts[id]??0)+1;if(id==='broadcast-crt')thirds[Math.min(2,Math.floor(s.fromFrame/timeline.durationInFrames*3))]!++;}
// Evenly spaced real film samples selected by time, not replacement footage.
const samples=[.015,.25,.5,.75,.97].map(p=>timeline.scenes.find(s=>s.fromFrame+s.durationInFrames>timeline.durationInFrames*p)!);
const selected=[...new Map(samples.map(s=>[s.id,s])).values()];
let cursor=0;const sampled={...timeline,scenes:selected.map(s=>{const mapped={...s,fromFrame:cursor,transition:'none' as const,transitionFrames:0};cursor+=s.durationInFrames;return mapped;}),durationInFrames:0};sampled.durationInFrames=cursor;
const base=timeline.scenes.find(s=>s.imagePath&&!s.videoPath)!;assert.ok(base);
const templates:DocumentaryTemplate[]=['editorial-shutters','editorial-orbit','editorial-film-gate','editorial-iris','broadcast-crt'];
const fixtures=templates.map((template,i)=>({...structuredClone(base),id:`fixture-${i}`,order:i,fromFrame:i*90,durationInFrames:90,transition:'mix' as const,transitionFrames:9,narrationEnabled:false,audioPath:undefined,
  documentary:{...structuredClone(base.documentary!),layout:'full' as const,template,templateTiming:{startSeconds:.3,durationSeconds:2.4},transitionStyle:i===2?'blur' as const:'clean' as const,caption:{...base.documentary!.caption,enabled:false},motionGraphic:undefined,cuts:undefined,texts:[],effects:[]}}));
const catalog={...timeline,music:undefined,scenes:fixtures,durationInFrames:fixtures.length*90};
await prepareDocumentaryRenderMedia(sampled,join(root,'prepared-samples'),()=>{});
await prepareDocumentaryRenderMedia(catalog,join(root,'prepared-catalog'),()=>{});
const closeSample=await serveDocumentaryRenderMedia(sampled),closeCatalog=await serveDocumentaryRenderMedia(catalog);
let browser:Awaited<ReturnType<typeof openBrowser>>|undefined;
try{
  const serveUrl=await bundle({entryPoint:createRequire(import.meta.url).resolve('@gold-work/remotion-video/entry'),publicDir:null,outDir:join(root,'bundle')});browser=await openBrowser('chrome');
  const composition=await selectComposition({serveUrl,id:'GoldWorkDocumentaryV2',inputProps:catalog,puppeteerInstance:browser});
  for(let i=0;i<fixtures.length;i++)await renderStill({serveUrl,composition,inputProps:catalog,puppeteerInstance:browser,frame:i*90+35,output:join(root,`template-${i}.jpg`),imageFormat:'jpeg',logLevel:'warn'});
  // Timing must actually change visible output and restore the full frame outside it.
  for(const frame of [0,15,85])await renderStill({serveUrl,composition,inputProps:catalog,puppeteerInstance:browser,frame,output:join(root,`timing-${frame}.png`),logLevel:'warn'});
  assert.notEqual(createHash('sha256').update(await readFile(join(root,'timing-0.png'))).digest('hex'),createHash('sha256').update(await readFile(join(root,'timing-15.png'))).digest('hex'));
  await renderMedia({serveUrl,composition,inputProps:catalog,puppeteerInstance:browser,codec:'h264',pixelFormat:'yuv420p',crf:20,concurrency:2,muted:true,outputLocation:join(root,'templates-and-transitions.mp4'),logLevel:'warn'});
  const sampleComp=await selectComposition({serveUrl,id:'GoldWorkDocumentaryV2',inputProps:sampled,puppeteerInstance:browser});
  for(let i=0;i<sampled.scenes.length;i++)await renderStill({serveUrl,composition:sampleComp,inputProps:sampled,puppeteerInstance:browser,frame:sampled.scenes[i]!.fromFrame+Math.floor(sampled.scenes[i]!.durationInFrames*.5),output:join(root,`automatic-${i}.jpg`),imageFormat:'jpeg',logLevel:'warn'});
  const output=join(root,'automatic-film-samples.mp4');
  await renderMedia({serveUrl,composition:sampleComp,inputProps:sampled,puppeteerInstance:browser,codec:'h264',pixelFormat:'yuv420p',crf:20,concurrency:2,outputLocation:output,logLevel:'warn'});
  const info=await probeEffectMedia(output);assert.ok(info.hasAudio);assert.ok(Math.abs(info.durationSeconds!-cursor/30)<.15);
  await effectFfmpeg(['-v','error','-i',output,'-f','null','-']);
  await effectFfmpeg(['-y','-framerate','1','-i',join(root,'template-%d.jpg'),'-vf','scale=480:270,tile=3x2','-frames:v','1',join(root,'templates.jpg')]);
  await effectFfmpeg(['-y','-framerate','1','-i',join(root,'automatic-%d.jpg'),'-vf','scale=480:270,tile=3x2','-frames:v','1',join(root,'automatic.jpg')]);
  assert.equal(await readFile(registry,'utf8'),before);
  const result={at:new Date().toISOString(),fullFilmSeconds:timeline.durationInFrames/30,counts,crtByThird:thirds,transitions:timeline.scenes.filter(s=>s.transitionFrames).length,blur:timeline.scenes.filter(s=>s.documentary?.transitionStyle==='blur').length,sampleOrders:selected.map(s=>s.order+1),sampleSeconds:info.durationSeconds,registryPreserved:true,voicesPreserved:true,paidRequests:0,note:'Time-spaced automatic samples plus explicit catalogue fixtures; not a new paid film or full-production speed benchmark.'};
  await writeFile(join(root,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser?.close({silent:true});await closeSample();await closeCatalog();}
