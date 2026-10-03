import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
import {bundle} from '@remotion/bundler';
import {renderStill,renderMedia,selectComposition,openBrowser} from '@remotion/renderer';
import {documentaryTemplates,documentaryMotionKinds} from '@gold-work/shared';
import type {DocumentaryTimeline} from '@gold-work/remotion-video';
import {prepareDocumentarySubjects,serveDocumentaryRenderMedia} from '../src/documentary-render-media.js';

// Replay the saved automatic timeline. Never change source choices, annotation
// coordinates, registry, paid audio or the user's Final.
const root=resolve('captures/montage-speed-20260927/new-production/annotation-size-20260929');
await mkdir(root,{recursive:true});
const registry='C:/Users/rosup/AppData/Roaming/@gold-work/desktop/projects.json',before=await readFile(registry,'utf8');
const timeline=JSON.parse(await readFile('D:/GoldWorkStorage/projects/project_mukba0q1_0cubga6/Documentary/timeline.json','utf8')) as DocumentaryTimeline;
const warnings=await prepareDocumentarySubjects({...timeline,scenes:[timeline.scenes[67]!]},join(root,'cutouts'),message=>console.log(message));
assert.equal(timeline.scenes[67]!.documentary?.motionGraphic?.cutoutPath,undefined,'a tiny isolated subject must retain its source context');
const close=await serveDocumentaryRenderMedia(timeline);
let browser:Awaited<ReturnType<typeof openBrowser>>|undefined;
try {
  const serveUrl=await bundle({entryPoint:createRequire(import.meta.url).resolve('@gold-work/remotion-video/entry'),publicDir:null,outDir:join(root,'bundle')});
  browser=await openBrowser('chrome');
  const composition=await selectComposition({serveUrl,id:'GoldWorkDocumentaryV2',inputProps:timeline,puppeteerInstance:browser});
  const frames=[];
  for(const number of [29,68,264]){
    const scene=timeline.scenes[number-1]!;
    assert.equal(scene.documentary?.motionGraphic?.kind,'annotations');
    const frame=scene.fromFrame+Math.floor(scene.durationInFrames*.6),path=join(root,`scene-${number}.png`);
    await renderStill({serveUrl,composition,inputProps:timeline,puppeteerInstance:browser,frame,output:path,imageFormat:'png',logLevel:'warn'});
    frames.push({number,frame,path,hasCutout:Boolean(scene.documentary?.motionGraphic?.cutoutPath)});
  }
  const scene=timeline.scenes[263]!,video=join(root,'scene-264.mp4');
  await renderMedia({serveUrl,composition,inputProps:timeline,puppeteerInstance:browser,codec:'h264',pixelFormat:'yuv420p',crf:20,concurrency:2,muted:true,
    frameRange:[scene.fromFrame,scene.fromFrame+scene.durationInFrames-1],outputLocation:video,logLevel:'warn',offthreadVideoCacheSizeInBytes:128*1024*1024,offthreadVideoThreads:1});
  assert.equal(await readFile(registry,'utf8'),before);
  const report={at:new Date().toISOString(),frames,video,seconds:scene.durationInFrames/30,warnings,registryPreserved:true,paidRequests:0,
    baselineCatalog:{materialTemplates:documentaryTemplates.length,motionKinds:documentaryMotionKinds.length,templates:documentaryTemplates,motion:documentaryMotionKinds},
    note:'Saved automatic timeline, visual-only local replay; not a new full production or a final export.'};
  await writeFile(join(root,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,baselineCatalog:{materialTemplates:documentaryTemplates.length,motionKinds:documentaryMotionKinds.length}}));
}finally{await browser?.close({silent:true});await close();}
