import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,writeFile,rm,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {buildDocumentaryTimeline} from '@gold-work/remotion-video';
import type {DocumentaryArtwork,Project} from '@gold-work/shared';
import {allowedArtworkMediaSources,prepareDocumentaryArtworkMedia} from './documentary-artwork-materials.js';
import {documentaryRenderCache} from './documentary-render-cache.js';
import {serveDocumentaryRenderMedia} from './documentary-render-media.js';
import {semanticMontageHash} from './documentary-semantic-montage.js';
import {motionArtworkHash} from './documentary-artwork-plan.js';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7coAAAAASUVORK5CYII=','base64');
async function fixture(root:string){
 const paths=[join(root,'selected-a.png'),join(root,'selected-b.png')];
 await Promise.all(paths.map(path=>writeFile(path,png)));
 const artwork:DocumentaryArtwork={version:1,intent:'Compare visible original subjects',layout:'full',canvas:{width:1000,height:600},
  palette:{background:'#eeeeee',ink:'#222222',accent:'#aa4433',secondary:'#336677'},startSeconds:0,durationSeconds:4,layers:[
   {id:'subject',kind:'media',sourceSceneId:'a',sourceVariant:'foreground',x:50,y:30,w:600,h:500},
   {id:'detail',kind:'media',sourceSceneId:'a',sourceWindow:{x:.2,y:.2,w:.5,h:.5},clip:'ellipse',x:700,y:30,w:250,h:220},
   {id:'comparison',kind:'media',sourceSceneId:'b',x:700,y:300,w:250,h:250}]};
 const project={id:'prepared-assets',mediaMode:'stock',language:'en',aspectRatio:'16:9',settings:{voice:{enabled:false},music:{enabled:false},assembly:{kenBurns:true,
  documentary:{version:2,autoMotionGraphics:true,montage:{version:1,style:'editorial',intensity:'rich',musicPolicy:'preserve'}}}},
  scenes:paths.map((path,i)=>({id:i?'b':'a',order:i,durationSeconds:4,narration:'The selected subject is visible.',imagePath:path,documentary:{verified:true,pinned:i===0,checksum:String(i),layout:'full',
   effects:[],caption:{enabled:false,text:''},selected:{id:String(i),kind:'image',width:1,height:1},requirement:{identities:[{name:'Subject'}],years:[]},
   semanticMontage:{sceneId:i?'b':'a',subject:'Subject',beat:'explain',treatment:'subject',cutawaySceneIds:i?[]:['b']},
   ...(!i?{motionGraphic:{enabled:true,origin:'automatic',kind:'explainer',artwork,startSeconds:0,durationSeconds:4}}:{})}}))} as unknown as Project;
 return {project,artwork};
}

test('prepared foreground/detail reuse selected sources, stable derivatives and real loopback bytes without mutating paid-plan hashes',async t=>{
 const root=await mkdtemp(join(tmpdir(),'gws-artwork-assets-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const {project}=await fixture(root),before=structuredClone(project),semantic=semanticMontageHash(project),motion=motionArtworkHash(project);
 assert.deepEqual(allowedArtworkMediaSources(project,'a').map(source=>source.id),['a','b']);
 let masks=0;const cutout=async(_source:string,directory:string)=>{masks++;await mkdir(directory,{recursive:true});const path=join(directory,'approved-alpha.png');await writeFile(path,png);return path;};
 const options={modelAvailable:async()=>true,cutout,probe:async()=>({width:1,height:1})};
 const first=buildDocumentaryTimeline(project),warnings=await prepareDocumentaryArtworkMedia(first,project,root,()=>{},undefined,options);
 assert.deepEqual(warnings,[]);assert.equal(masks,1);
 const media=first.scenes[0]!.documentary!.artworkMedia!;
 assert.equal(media.subject!.actualVariant,'foreground');assert.equal(media.detail!.path,project.scenes[0]!.imagePath);assert.equal(media.comparison!.path,project.scenes[1]!.imagePath);
 const second=buildDocumentaryTimeline(project);await prepareDocumentaryArtworkMedia(second,project,root,()=>{},undefined,options);
 assert.equal(masks,1,'preview and Final share the prepared cutout receipt');
 assert.deepEqual(second.scenes[0]!.documentary!.artworkMedia,media);
 assert.equal(second.scenes[0]!.documentary!.artworkMediaFingerprint,first.scenes[0]!.documentary!.artworkMediaFingerprint);
 assert.deepEqual(project,before);assert.equal(semanticMontageHash(project),semantic);assert.equal(motionArtworkHash(project),motion);
 const entry=join(root,'entry.js');await writeFile(entry,'export {};');const cache=await documentaryRenderCache(root,entry),key=await cache.path(first,0,0,26);
 await appendFile(media.subject!.path,Buffer.from('asset changed'));
 assert.notEqual(await cache.path(first,0,0,26),key,'the actual alpha asset is a render-cache dependency');
 const served=structuredClone(first),close=await serveDocumentaryRenderMedia(served);t.after(close);
 const response=await fetch(served.scenes[0]!.documentary!.artworkMedia!.detail!.path);
 assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),png,'the viewport receives selected-source bytes');
});

test('failed foreground remains the same visible original in preview and Final without downloads or hidden inference retries',async t=>{
 const root=await mkdtemp(join(tmpdir(),'gws-artwork-fallback-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const {project}=await fixture(root);let attempts=0;const notices:string[]=[];
 const options={modelAvailable:async()=>false,cutout:async()=>{attempts++;throw Error('must not run');}};
 const first=buildDocumentaryTimeline(project),second=buildDocumentaryTimeline(project);
 await prepareDocumentaryArtworkMedia(first,project,root,message=>notices.push(message),undefined,options);
 await prepareDocumentaryArtworkMedia(second,project,root,message=>notices.push(message),undefined,{...options,modelAvailable:async()=>true});
 assert.equal(attempts,0);assert.equal(notices.length,2);assert.match(notices[0]!,/Фон сохранён/);
 assert.deepEqual(first.scenes[0]!.documentary!.artworkMedia,second.scenes[0]!.documentary!.artworkMedia);
 assert.equal(first.scenes[0]!.documentary!.artworkMedia!.subject!.actualVariant,'original');
 assert.equal(first.scenes[0]!.documentary!.artworkMedia!.subject!.path,project.scenes[0]!.imagePath);
});

test('runtime refuses foreign sources, malformed windows, multi-scene media and duplicate/current-video detail',async t=>{
 const root=await mkdtemp(join(tmpdir(),'gws-artwork-guards-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const {project}=await fixture(root);
 const video=structuredClone(project);video.scenes[0]!.videoPath=video.scenes[0]!.imagePath;video.scenes[0]!.trimStartSeconds=2;video.scenes[0]!.trimEndSeconds=6;video.scenes[0]!.playbackRate=1.25;
 video.scenes[0]!.documentary!.selected={...video.scenes[0]!.documentary!.selected!,kind:'video',durationSeconds:20};
 video.scenes[0]!.documentary!.motionGraphic!.artwork!.layers=[{id:'current-video',kind:'media',sourceSceneId:'a',x:0,y:0,w:1000,h:600}];
 const videoTimeline=buildDocumentaryTimeline(video);await prepareDocumentaryArtworkMedia(videoTimeline,video,root);
 const preparedVideo=videoTimeline.scenes[0]!.documentary!.artworkMedia!['current-video']!;
 assert.equal(preparedVideo.path,video.scenes[0]!.videoPath);assert.equal(preparedVideo.kind,'video');
 assert.equal(preparedVideo.trimStartSeconds,2);assert.equal(preparedVideo.trimEndSeconds,6);assert.equal(preparedVideo.playbackRate,1.25);
 for(const kind of ['foreign','window','span','video'] as const){
  const input=structuredClone(project),g=input.scenes[0]!.documentary!.motionGraphic!,layers=g.artwork!.layers;
  if(kind==='foreign')layers[0]!.sourceSceneId='outside-project';
  if(kind==='window')layers[1]!.sourceWindow={x:.9,y:0,w:.5,h:1};
  if(kind==='span')g.artworkSpan={endSceneId:'b'};
  if(kind==='video'){input.scenes[0]!.videoPath=input.scenes[0]!.imagePath;layers[0]!.sourceVariant='original';}
  await assert.rejects(()=>prepareDocumentaryArtworkMedia(buildDocumentaryTimeline(input),input,root,()=>{},undefined,{modelAvailable:async()=>false}),
   /разрешённый набор|окно исходного|одну сцену|Видео допускает/);
 }
 const signal=AbortSignal.abort();await assert.rejects(()=>prepareDocumentaryArtworkMedia(buildDocumentaryTimeline(project),project,root,()=>{},signal),{name:'AbortError'});
});
