import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
import {bundle} from '@remotion/bundler';
import {openBrowser,renderStill,selectComposition} from '@remotion/renderer';
import {buildDocumentaryTimeline} from '@gold-work/remotion-video';
import {serveDocumentaryRenderMedia} from '../src/documentary-render-media.js';
const root=resolve('captures/stock-editorial-speed-20260927');
const timeline=buildDocumentaryTimeline(JSON.parse(await readFile(join(root,'project.json'),'utf8')));
const close=await serveDocumentaryRenderMedia(timeline),browser=await openBrowser('chrome');
try{
  const serveUrl=await bundle({entryPoint:createRequire(import.meta.url).resolve('@gold-work/remotion-video/entry'),publicDir:null,outDir:join(root,'still-bundle')});
  const composition=await selectComposition({serveUrl,id:'GoldWorkDocumentaryV2',inputProps:timeline,puppeteerInstance:browser});
  for(const second of [2,40,59,62,66,71])await renderStill({serveUrl,composition,inputProps:timeline,puppeteerInstance:browser,frame:second*30,scale:.5,output:join(root,`checked-${second}.png`)});
  console.log('Six current composition frames saved');
}finally{await browser.close({silent:true});await close();}
