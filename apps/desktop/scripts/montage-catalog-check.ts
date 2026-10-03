import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
import {bundle} from '@remotion/bundler';
import {openBrowser,selectComposition,renderStill,renderMedia} from '@remotion/renderer';
import {documentaryLayoutPresets,documentaryTemplates,type Project} from '@gold-work/shared';
import type {DocumentaryTimeline} from '@gold-work/remotion-video';
import {prepareDocumentaryRenderMedia,serveDocumentaryRenderMedia} from '../src/documentary-render-media.js';
import {planDocumentaryMontage} from '../src/documentary-montage.js';
import {runFfmpeg} from '../src/standard-renderer.js';

const root=resolve('captures/montage-speed-20260927/new-production/catalog-20260929');await mkdir(root,{recursive:true});
const registry='C:/Users/rosup/AppData/Roaming/@gold-work/desktop/projects.json',before=await readFile(registry,'utf8');
const project=(JSON.parse(before) as Project[]).find(p=>p.id==='project_mukba0q1_0cubga6')!;
const saved=JSON.parse(await readFile('D:/GoldWorkStorage/projects/project_mukba0q1_0cubga6/Documentary/timeline.json','utf8')) as DocumentaryTimeline;
const photos=saved.scenes.filter(s=>s.imagePath&&!s.videoPath);assert.ok(photos.length>=2);
assert.equal(documentaryTemplates.length,76);assert.equal(documentaryLayoutPresets.length,38);
const scenes=documentaryLayoutPresets.map((preset,i)=>{
  const base=structuredClone(photos[i%photos.length]!);return {...base,id:`catalog-${preset.id}`,order:i,fromFrame:i*60,durationInFrames:60,durationSeconds:2,transitionFrames:0,motion:false,narrationEnabled:false,audioPath:undefined,
    documentary:{...base.documentary!,cuts:undefined,motionGraphic:undefined,effects:[],texts:[],layout:preset.group==='compare'?'compare' as const:'full' as const,template:preset.id,
      comparison:preset.group==='compare'?{sceneId:'second',leftLabel:'Первый материал',rightLabel:'Второй материал',imagePath:photos[(i+1)%photos.length]!.imagePath}:undefined,
      caption:{...base.documentary!.caption,enabled:preset.group!=='photo',text:preset.group==='chapter'?'Как устроена система':preset.group==='fact'?'120 кВт · мощность системы':'Два решения одной задачи',color:'#ffffff',backgroundColor:'#101820',opacity:90,fontSize:preset.group==='chapter'?96:64}}};
});
const timeline={...saved,music:undefined,scenes,durationInFrames:scenes.length*60};
await prepareDocumentaryRenderMedia(timeline,join(root,'prepared'),()=>{});
const close=await serveDocumentaryRenderMedia(timeline);let browser:Awaited<ReturnType<typeof openBrowser>>|undefined;
try{
  const serveUrl=await bundle({entryPoint:createRequire(import.meta.url).resolve('@gold-work/remotion-video/entry'),publicDir:null,outDir:join(root,'bundle')});browser=await openBrowser('chrome');
  const composition=await selectComposition({serveUrl,id:'GoldWorkDocumentaryV2',inputProps:timeline,puppeteerInstance:browser});
  for(let i=process.argv.includes('--typography')?12:0;i<scenes.length;i++)await renderStill({serveUrl,composition,inputProps:timeline,puppeteerInstance:browser,frame:i*60+36,output:join(root,`frame-${String(i).padStart(2,'0')}.jpg`),imageFormat:'jpeg',logLevel:'warn'});
  await runFfmpeg(['-y','-framerate','1','-i',join(root,'frame-%02d.jpg'),'-vf','scale=480:270,tile=4x3','-frames:v','4',join(root,'sheet-%02d.jpg')]);
  await renderMedia({serveUrl,composition,inputProps:timeline,puppeteerInstance:browser,codec:'h264',pixelFormat:'yuv420p',crf:20,concurrency:2,muted:true,frameRange:[20*60,26*60-1],outputLocation:join(root,'chapter-motion.mp4'),logLevel:'warn'});
  const planned=planDocumentaryMontage(structuredClone(project),false,true);
  assert.deepEqual(planned.map(s=>[s.id,s.imagePath,s.videoPath,s.audioPath,s.narration]),project.scenes.map(s=>[s.id,s.imagePath,s.videoPath,s.audioPath,s.narration]));
  assert.equal(await readFile(registry,'utf8'),before);
  const assigned=Object.fromEntries([...new Set(planned.map(s=>s.documentary?.template??'none'))].map(id=>[id,planned.filter(s=>(s.documentary?.template??'none')===id).length]));
  const result={at:new Date().toISOString(),catalog:documentaryTemplates.length,added:documentaryLayoutPresets.length,frames:documentaryLayoutPresets.map((p,i)=>({index:i,id:p.id,label:p.label})),automaticAssignments:assigned,registryPreserved:true,paidRequests:0,note:'Explicit local template fixtures with sample captions; offline automatic planner audited separately. Not a fresh production or acceptance of every scene.'};
  await writeFile(join(root,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,frames:result.frames.length}));
}finally{await browser?.close({silent:true});await close();}
