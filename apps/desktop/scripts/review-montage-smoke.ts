import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {bundle} from '@remotion/bundler';
import {openBrowser,renderStill,selectComposition} from '@remotion/renderer';
import type {DocumentaryArtwork,DocumentaryTemplate} from '@gold-work/shared';
import {buildDocumentaryTimeline,type DocumentaryProjectInput} from '../../../packages/remotion-video/src/documentary-timeline.js';

// Local deterministic media only. Run from the repository root with tsx.
const output=resolve(process.argv[2]??'captures/review-montage');await mkdir(output,{recursive:true});
const source='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="1920" height="1080" fill="#73868b"/><rect x="110" y="130" width="1680" height="820" rx="24" fill="#b1b9ae"/><circle cx="590" cy="540" r="280" fill="#a9573e"/><rect x="1100" y="260" width="350" height="530" fill="#283d47"/><text x="1240" y="575" fill="white" font-size="95">42</text><text x="150" y="1010" fill="#152832" font-size="44">Selected source / complete frame</text></svg>');
const templates:DocumentaryTemplate[]=['archive-slide','museum-mat','paper-grid','gallery','editorial-film-gate','studio-blinds'];
const input:DocumentaryProjectInput={aspectRatio:'16:9',settings:{voice:{enabled:false},assembly:{kenBurns:true,documentary:{version:2}}},
  scenes:templates.map((template,order)=>({id:template,order,durationSeconds:6,imagePath:source,documentary:{template,templateOrigin:'automatic',layout:'full',effects:[],caption:{enabled:false,text:''},selected:{width:1920,height:1080},templateMotion:{amountPercent:14,curve:'smooth'}}}))};
const timeline=buildDocumentaryTimeline(input);
const artwork:DocumentaryArtwork={version:1,intent:'Selected source detail',layout:'full',canvas:{width:1000,height:562},palette:{background:'#10161c',ink:'#ffffff',accent:'#88bbdd',secondary:'#8899aa'},startSeconds:0,durationSeconds:6,
  layers:[{id:'whole',kind:'media',x:0,y:0,w:1000,h:562,keyframes:[{t:0,opacity:1},{t:.6,opacity:0}]},
    {id:'detail',kind:'media',x:0,y:0,w:1000,h:562,sourceWindow:{x:.55,y:.22,w:.25,h:.5},keyframes:[{t:0,opacity:0},{t:.6,opacity:1}]},
    {id:'label',kind:'text',x:50,y:490,w:800,h:45,text:'Selected detail',fill:'#ffffff'}]};
const photo=structuredClone(timeline.scenes[0]!);photo.id='photo-artwork';photo.fromFrame=timeline.durationInFrames;
photo.documentary!.motionGraphic={kind:'explainer',enabled:true,title:'',hideTitle:true,origin:'automatic',startSeconds:0,durationSeconds:6,artwork};
photo.documentary!.artworkMedia=Object.fromEntries(['whole','detail'].map(id=>[id,{sourceSceneId:photo.id,kind:'image',path:source,width:1920,height:1080,actualVariant:'original',sourceIdentity:'local-smoke'}]));
timeline.scenes.push(photo);timeline.durationInFrames+=180;
const quote=structuredClone(timeline.scenes[0]!);quote.id='long-fallback';quote.fromFrame=timeline.durationInFrames;quote.imagePath=undefined;
quote.documentary!.template='full';quote.documentary!.nativeFallback=true;
quote.documentary!.motionGraphic={kind:'quote',quoteMode:'speech',enabled:true,title:Array.from({length:5},(_,i)=>`Page ${i+1}: This complete narration remains readable while the source material is unavailable. Every word is retained in the project and in the voice track.`).join(' '),origin:'automatic',startSeconds:0,durationSeconds:6};
timeline.scenes.push(quote);timeline.durationInFrames+=180;
const serveUrl=await bundle({entryPoint:resolve('packages/remotion-video/dist/remotion-entry.js'),publicDir:null,outDir:join(output,'bundle'),enableCaching:true});
const browserExecutable='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser=await openBrowser('chrome',{browserExecutable,chromeMode:'chrome-for-testing'});
try{
  const common={serveUrl,inputProps:timeline,puppeteerInstance:browser,browserExecutable,chromeMode:'chrome-for-testing' as const,logLevel:'warn' as const};
  const composition=await selectComposition({...common,id:'GoldWorkDocumentaryV2'});
  for(const scene of timeline.scenes)for(const frame of [12,120]){
    await renderStill({...common,composition,output:join(output,`${scene.id}-${frame}.png`),frame:scene.fromFrame+frame,imageFormat:'png',scale:.5});
  }
  await writeFile(join(output,'timing.json'),JSON.stringify({fps:timeline.fps,durationInFrames:timeline.durationInFrames,scenes:timeline.scenes.map(s=>({id:s.id,fromFrame:s.fromFrame,durationInFrames:s.durationInFrames}))},null,2));
  console.log(`Rendered ${timeline.scenes.length*2} local frames to ${output}`);
}finally{await browser.close({silent:true});}
