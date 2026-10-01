import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
import {bundle} from '@remotion/bundler';
import {renderMedia,selectComposition,openBrowser} from '@remotion/renderer';
import type {DocumentaryTimeline} from '@gold-work/remotion-video';
import {serveDocumentaryRenderMedia} from '../src/documentary-render-media.js';

const mode=process.argv.includes('--six-workers')?'six-workers':process.argv.includes('--fast-encode')?'fast-encode':process.argv.includes('--after')?'after':'before';
const root=resolve('captures/montage-speed-20260927/new-production/render-cost');
await mkdir(root,{recursive:true});
const registry='C:/Users/rosup/AppData/Roaming/@gold-work/desktop/projects.json',before=await readFile(registry,'utf8');
const timeline=JSON.parse(await readFile('D:/GoldWorkStorage/projects/project_mukba0q1_0cubga6/Documentary/timeline.json','utf8')) as DocumentaryTimeline;
const first=timeline.scenes[271]!,last=timeline.scenes[273]!;
const frameRange:[number,number]=[first.fromFrame,last.fromFrame+last.durationInFrames-1];
const close=await serveDocumentaryRenderMedia(timeline);
let browser:Awaited<ReturnType<typeof openBrowser>>|undefined;
try {
  const serveUrl=await bundle({entryPoint:createRequire(import.meta.url).resolve('@gold-work/remotion-video/entry'),publicDir:null,outDir:join(root,mode+'-bundle')});
  browser=await openBrowser('chrome');
  const composition=await selectComposition({serveUrl,id:'GoldWorkDocumentaryV2',inputProps:timeline,puppeteerInstance:browser});
  const started=Date.now(),outputLocation=join(root,mode+'.mp4');
  await renderMedia({serveUrl,composition,inputProps:timeline,puppeteerInstance:browser,codec:'h264',pixelFormat:'yuv420p',crf:20,concurrency:mode==='six-workers'?6:3,muted:true,frameRange,outputLocation,logLevel:'warn',offthreadVideoCacheSizeInBytes:256*1024*1024,mediaCacheSizeInBytes:128*1024*1024,offthreadVideoThreads:2,...(mode==='fast-encode'?{x264Preset:'veryfast' as const}:{})});
  const report={mode,frameRange,seconds:(frameRange[1]-frameRange[0]+1)/30,renderSeconds:(Date.now()-started)/1000,output:outputLocation,fullTimelineScenes:timeline.scenes.length,paidRequests:0};
  assert.equal(await readFile(registry,'utf8'),before);
  await writeFile(join(root,mode+'.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser?.close({silent:true});await close();}
