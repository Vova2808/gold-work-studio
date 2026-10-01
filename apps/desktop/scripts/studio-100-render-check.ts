import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {bundle} from '@remotion/bundler';
import {openBrowser,selectComposition,renderStill,renderMedia} from '@remotion/renderer';
import {documentaryTemplates,documentaryStudioTemplates,type Project,type DocumentaryTemplate} from '@gold-work/shared';
import {buildDocumentaryTimeline} from '@gold-work/remotion-video';
import {planDocumentaryMontage} from '../src/documentary-montage.js';
import {prepareDocumentaryRenderMedia,serveDocumentaryRenderMedia} from '../src/documentary-render-media.js';
import {effectFfmpeg,probeEffectMedia} from '../src/effect-media.js';
const root=resolve('captures/montage-speed-20260927/new-production/studio-removal-20261001');await mkdir(root,{recursive:true});
const registry=join(process.env.APPDATA!,'@gold-work/desktop/projects.json'),before=await readFile(registry,'utf8');
const projects=JSON.parse(before) as Project[],project=projects.find(p=>p.id==='project_mukba0q1_0cubga6')!;
assert.equal(documentaryTemplates.length,98);assert.equal(new Set(documentaryTemplates.map(t=>t[0])).size,documentaryTemplates.length);
const original=buildDocumentaryTimeline(project),planned=planDocumentaryMontage(structuredClone(project),false,true),timeline=buildDocumentaryTimeline({...project,scenes:planned});
assert.equal(original.durationInFrames,timeline.durationInFrames);
assert.deepEqual(planned.map(s=>[s.imagePath,s.videoPath,s.audioPath,s.narration]),project.scenes.map(s=>[s.imagePath,s.videoPath,s.audioPath,s.narration]));
const base=timeline.scenes.find(s=>s.imagePath&&!s.videoPath)!;
const portrait=projects.flatMap(p=>buildDocumentaryTimeline(p).scenes).find(s=>s.imagePath&&existsSync(s.imagePath)&&s.documentary?.selected&&s.documentary.selected.width!/s.documentary.selected.height!<.85)??base;
const templates:DocumentaryTemplate[]=[...documentaryStudioTemplates.map(t=>t[0]),'broadcast-scanlines'];
const fixtures=templates.map((template,i)=>{const source=template.startsWith('portrait-')?portrait:base;return {...structuredClone(source),id:`studio-${i}`,order:i,fromFrame:i*90,durationInFrames:90,transition:'none' as const,transitionFrames:0,narrationEnabled:false,audioPath:undefined,motion:false,sourceVolume:0,
  documentary:{...structuredClone(source.documentary!),layout:'full' as const,template,templateTiming:undefined,caption:{...source.documentary!.caption,enabled:false},motionGraphic:undefined,cuts:undefined,texts:[],effects:[]}};});
const catalog={...timeline,music:undefined,scenes:fixtures,durationInFrames:fixtures.length*90};
await prepareDocumentaryRenderMedia(catalog,join(root,'prepared'),()=>{});const close=await serveDocumentaryRenderMedia(catalog);let browser:Awaited<ReturnType<typeof openBrowser>>|undefined;
try{
  const serveUrl=await bundle({entryPoint:createRequire(import.meta.url).resolve('@gold-work/remotion-video/entry'),publicDir:null,outDir:join(root,'bundle')});browser=await openBrowser('chrome');
  const composition=await selectComposition({serveUrl,id:'GoldWorkDocumentaryV2',inputProps:catalog,puppeteerInstance:browser});
  for(let i=0;!process.argv.includes('--finish')&&i<(process.argv.includes('--portraits')?2:fixtures.length);i++){
    await renderStill({serveUrl,composition,inputProps:catalog,puppeteerInstance:browser,frame:i*90+36,output:join(root,`template-${i}.jpg`),imageFormat:'jpeg',logLevel:'warn'});
    await renderStill({serveUrl,composition,inputProps:catalog,puppeteerInstance:browser,frame:i*90+12,output:join(root,`entrance-${i}.jpg`),imageFormat:'jpeg',logLevel:'warn'});
    console.log(`Rendered ${i+1}/${templates.length} ${templates[i]}`);
  }
  const hashes=[];for(let i=0;i<templates.length;i++)hashes.push(createHash('sha256').update(await readFile(join(root,`entrance-${i}.jpg`))).update(await readFile(join(root,`template-${i}.jpg`))).digest('hex'));assert.equal(new Set(hashes).size,templates.length);
  for(const f of process.argv.includes('--finish')?[]:[1,20,45])await renderStill({serveUrl,composition,inputProps:catalog,puppeteerInstance:browser,frame:templates.indexOf('broadcast-scanlines')*90+f,output:join(root,`crt-${f}.png`),logLevel:'warn'});
  assert.notEqual(createHash('sha256').update(await readFile(join(root,'crt-1.png'))).digest('hex'),createHash('sha256').update(await readFile(join(root,'crt-20.png'))).digest('hex'));
  // Short actual motion preview; fixtures do not alter or manually edit a film.
  const previewIds:DocumentaryTemplate[]=['portrait-stage','studio-panorama','studio-page-peel','broadcast-scanlines'];
  const preview={...catalog,scenes:previewIds.map((id,i)=>({...fixtures[templates.indexOf(id)]!,fromFrame:i*90})),durationInFrames:previewIds.length*90};
  const previewComp=await selectComposition({serveUrl,id:'GoldWorkDocumentaryV2',inputProps:preview,puppeteerInstance:browser});
  await effectFfmpeg(['-y','-framerate','1','-i',join(root,'template-%d.jpg'),'-vf','scale=480:270,tile=4x5','-frames:v','1',join(root,'catalog.jpg')]);
  await effectFfmpeg(['-y','-framerate','1','-i',join(root,'entrance-%d.jpg'),'-vf','scale=480:270,tile=4x5','-frames:v','1',join(root,'entrances.jpg')]);
  const video=join(root,'motion-preview.mp4');await renderMedia({serveUrl,composition:previewComp,inputProps:preview,puppeteerInstance:browser,codec:'h264',pixelFormat:'yuv420p',crf:20,concurrency:2,muted:true,scale:2/3,outputLocation:video,logLevel:'warn'});
  const info=await probeEffectMedia(video);assert.ok(Math.abs(info.durationSeconds!-previewIds.length*3)<.1);await effectFfmpeg(['-v','error','-i',video,'-f','null','-']);
  assert.equal(await readFile(registry,'utf8'),before);
  const thirds=[0,0,0],framed=[0,0,0];for(const s of timeline.scenes){const n=Math.min(2,Math.floor(s.fromFrame/timeline.durationInFrames*3));if(s.documentary?.template==='broadcast-scanlines')thirds[n]!++;if(s.documentary?.template==='broadcast-crt')framed[n]!++;}
  const result={at:new Date().toISOString(),templates:documentaryTemplates.length,newDesigns:templates,fullCrtByThird:thirds,framedCrtByThird:framed,previewSeconds:info.durationSeconds,distinctStillHashes:hashes.length,registryPreserved:true,voicesPreserved:true,paidRequests:0,note:'Local design fixtures and automatic plan of existing film, not a new paid production or end-to-end speed measurement.'};
  await writeFile(join(root,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser?.close({silent:true});await close();}
