import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { EffectLibrary } from './effect-library.js';
import { resolveDocumentaryBackground } from './documentary-background.js';
import { importDocumentaryMusic, listImportedMusic } from './documentary-music-import.js';
import { commonsMusicCandidate, documentaryMusicProfile, prepareDocumentaryMusic } from './documentary-auto-music.js';
import {prepareDocumentaryMontageMedia} from './documentary-montage-media.js';

async function fixture(t: {after(fn:()=>Promise<void>):void}) {
  const root = await mkdtemp(join(tmpdir(), 'gws-media-'));
  t.after(async()=>{assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep + 'gws-media-'));await rm(root,{recursive:true,force:true});});
  const directory=join(root,'Music'),projectDirectory=join(root,'project');
  await mkdir(directory); await mkdir(projectDirectory);
  return {root,directory,projectDirectory};
}
// A small real PCM file. Tests probe it with FFmpeg; no film/video render or network is run.
function wav(seconds=32) {
  const samples=seconds*8000,bytes=Buffer.alloc(44+samples*2);bytes.write('RIFF');bytes.writeUInt32LE(36+samples*2,4);bytes.write('WAVEfmt ',8);
  bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(8000,24);bytes.writeUInt32LE(16000,28);
  bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(samples*2,40);
  for(let i=0;i<samples;i++)bytes.writeInt16LE(Math.round(1000*Math.sin(i*.3)),44+i*2);
  return bytes;
}
function page(overrides: Record<string,unknown>={}) {
  return {title:'File:Calm ambient instrumental.wav',imageinfo:[{url:'https://upload.wikimedia.org/wikipedia/commons/0/00/Calm.wav',
    descriptionurl:'https://commons.wikimedia.org/wiki/File:Calm.wav',mime:'audio/wav',size:512044,
    extmetadata:{LicenseShortName:{value:'CC BY 4.0'},LicenseUrl:{value:'https://creativecommons.org/licenses/by/4.0/'},
      Artist:{value:'Composer'},ImageDescription:{value:'Calm ambient instrumental background music'},...overrides}}]};
}

test('automatic unavailable recovery preserves zero volume, custom fades and disabled ducking',async t=>{
  const {root,directory,projectDirectory}=await fixture(t);
  const input={directory,projectDirectory,mode:'auto' as const,theme:'Calm',emotion:'documentary instrumental',hook:'Calm'};
  const ready=await prepareDocumentaryMusic(input,{fetch:async url=>String(url).startsWith('https://upload.wikimedia.org/')?new Response(wav(),{headers:{'content-type':'audio/wav'}}):Response.json({query:{pages:[page()]}})});
  assert.equal(ready.status,'ready');assert.ok(ready.music);
  const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Recovery cache must stay offline');};
  try{
    const project={videoBrief:{readyScript:'Calm'},scenes:[{narration:'Calm'}],settings:{music:{enabled:false,volume:0,fadeInSeconds:4,fadeOutSeconds:8,ducking:false,selectionStatus:'unavailable'},
      assembly:{documentary:{version:2,montage:{version:1,style:'editorial',intensity:'rich',musicPolicy:'automatic'}}}}};
    const recovered=await prepareDocumentaryMontageMedia(project as never,projectDirectory,root);
    assert.equal(recovered.settings.music.selectionStatus,'ready');assert.equal(recovered.settings.music.path,ready.music!.path);
    assert.equal(recovered.settings.music.volume,0);assert.equal(recovered.settings.music.fadeInSeconds,4);assert.equal(recovered.settings.music.fadeOutSeconds,8);assert.equal(recovered.settings.music.ducking,false);
  }finally{globalThis.fetch=originalFetch;}
});
test('background file import has stable IDs, neutral defaults and survives original/library loss',async t=>{
  const {root,projectDirectory}=await fixture(t),file=join(root,'ordinary-photo.png');await writeFile(file,'image fixture');
  const library=new EffectLibrary(join(root,'Library'),undefined,async()=>({state:'ready',metadata:{durationSeconds:0,hasAudio:false,hasAlpha:false}}));
  await library.startImport([file],{category:'background'});const first=(await library.waitForImport()).assets[0]!;
  assert.equal(first.category,'background');assert.equal(first.defaults.opacity,100);assert.equal(first.defaults.blend,'normal');assert.equal(first.defaults.sourceAudio,false);
  await library.startImport([file],{category:'background'});const repeated=await library.waitForImport();assert.equal(repeated.assets.length,1);assert.equal(repeated.importProgress?.duplicates,1);
  const saved=await resolveDocumentaryBackground(library,projectDirectory,first.id);
  await library.trash(first.id,true);await rm(file);await rm(join(library.rootPath,first.file));
  assert.equal((await resolveDocumentaryBackground(library,projectDirectory,first.id)).path,saved.path);
  assert.equal(await readFile(saved.path,'utf8'),'image fixture');
  await assert.rejects(resolveDocumentaryBackground(library,projectDirectory,'../elsewhere'),/ID/);
});
test('background batch ignores SFX and never reclassifies existing reviewed assets',async t=>{
  const {root}=await fixture(t),source=join(root,'source');await mkdir(source);await writeFile(join(source,'photo.png'),'visual');await writeFile(join(source,'click.wav'),'audio');
  const library=new EffectLibrary(join(root,'Library'),undefined,async()=>({state:'ready'}));
  await library.startImport([source]);const before=(await library.waitForImport()).assets;
  await library.startImport([source],{category:'background'});const after=await library.waitForImport();
  assert.equal(after.importProgress?.total,1);assert.equal(after.importProgress?.ignored,1);
  assert.deepEqual(after.assets.map(a=>[a.id,a.category,a.defaults]),before.map(a=>[a.id,a.category,a.defaults]));
  await assert.rejects(library.startImport([join(source,'click.wav')],{category:'background'}),/изображение/);
});
test('Commons eligibility rejects unsupported/missing license, speech/SFX and external download',()=>{
  assert.ok(commonsMusicCandidate(page()));
  assert.equal(commonsMusicCandidate(page({LicenseShortName:{value:'CC BY-SA 4.0'}})),undefined);
  assert.equal(commonsMusicCandidate(page({LicenseUrl:{value:''}})),undefined);
  assert.equal(commonsMusicCandidate(page({Artist:{value:''}})),undefined);
  assert.equal(commonsMusicCandidate(page({ImageDescription:{value:'Instrumental whoosh sound effect'}})),undefined);
  const external=page();external.imageinfo[0]!.url='https://example.com/song.wav';assert.equal(commonsMusicCandidate(external),undefined);
  assert.equal(documentaryMusicProfile({theme:'Космическая наука'}).mood,'discovery');
  assert.equal(documentaryMusicProfile({theme:'Скорость на гонках',hook:'Трагическая гибель'}).mood,'reflective');
  assert.equal(documentaryMusicProfile({theme:'True crime: трагическая гибель'}).mood,'tension');
});
test('bounded mocked retrieval imports real audio once, retains provenance and project-owned copies',async t=>{
  const input=await fixture(t);let searches=0,downloads=0;
  const request:typeof fetch=async url=>{if(String(url).startsWith('https://commons.wikimedia.org/')){searches++;return Response.json({query:{pages:[page()]}});}downloads++;return new Response(wav(),{headers:{'content-type':'audio/wav'}});};
  const [first,second]=await Promise.all([prepareDocumentaryMusic({...input,mode:'auto'},{fetch:request}),prepareDocumentaryMusic({...input,projectDirectory:input.projectDirectory+'-second',mode:'auto'},{fetch:request})]);
  assert.equal(first.status,'ready');assert.equal(second.music?.assetId,first.music?.assetId);assert.notEqual(second.music?.path,first.music?.path);assert.equal(searches,1);assert.equal(downloads,1);
  assert.equal(first.diagnostics?.reason,'downloaded');assert.equal(second.diagnostics?.reason,'cache');assert.equal(second.diagnostics?.downloads,0);
  assert.equal(first.music?.volume,10);assert.equal(first.music?.ducking,true);assert.equal(first.music?.fadeOutSeconds,3);
  const asset=(await listImportedMusic(input.directory))[0]!;assert.equal(asset.provenance.license,'CC BY 4.0');assert.equal(asset.durationSeconds,32);
  const attribution=await readFile(join(input.projectDirectory,'Documentary','Music',`${asset.id}.attribution.txt`),'utf8');assert.match(attribution,/Composer/);assert.match(attribution,/creativecommons/);
  await rm(join(input.directory,asset.file));assert.ok((await stat(first.music!.path)).size>1000);
  const restored=await prepareDocumentaryMusic({...input,mode:'auto'},{fetch:async()=>{throw Error('project must survive library loss');}});
  assert.equal(restored.status,'ready');assert.equal(restored.music?.path,first.music?.path);
  assert.equal(restored.diagnostics?.cached,'project');assert.equal(restored.diagnostics?.searches,0);
});
test('unavailable source falls back to imported music, honors cooldown and excludes short SFX',async t=>{
  const input=await fixture(t),track=join(input.root,'ambient piano.wav'),effect=join(input.root,'click.wav');
  await writeFile(track,wav());await writeFile(effect,wav(1));await importDocumentaryMusic(track,input.directory);await importDocumentaryMusic(effect,input.directory);
  let calls=0;const request:typeof fetch=async()=>{calls++;throw Error('offline');};
  const result=await prepareDocumentaryMusic({...input,mode:'auto'},{fetch:request});assert.equal(result.status,'local-fallback');assert.equal(result.music?.name,'ambient piano');
  await prepareDocumentaryMusic({...input,projectDirectory:input.projectDirectory+'-second',mode:'auto'},{fetch:request});assert.equal(calls,1);assert.match(result.message,/Commons недоступен/);
});
test('empty search uses exactly two queries, unavailable returns no stale music; off/custom never fetch',async t=>{
  const input=await fixture(t);let calls=0;const request:typeof fetch=async()=>{calls++;return Response.json({query:{pages:[]}});};
  const result=await prepareDocumentaryMusic({...input,mode:'auto'},{fetch:request});assert.equal(calls,2);assert.equal(result.status,'unavailable');assert.equal(result.music,undefined);
  assert.equal(result.diagnostics?.reason,'no-results');
  assert.equal((await prepareDocumentaryMusic({...input,mode:'off'},{fetch:request})).status,'off');assert.equal(calls,2);
  const track=join(input.root,'mine.wav');await writeFile(track,wav());const custom=await prepareDocumentaryMusic({...input,mode:'custom',path:track},{fetch:request});
  assert.equal(custom.status,'ready');assert.equal(calls,2);await rm(track);assert.ok((await stat(custom.music!.path)).isFile());
});
test('legacy hash-named music imports become eligible without changing original bytes',async t=>{
  const input=await fixture(t),source=join(input.root,'previous.wav');await writeFile(source,wav());const imported=await importDocumentaryMusic(source,input.directory);
  const id=basename(imported,'.wav');await rm(join(input.directory,'Catalog',`${id}.json`));
  const result=await prepareDocumentaryMusic({...input,mode:'auto'},{fetch:async()=>{throw Error('offline');}});
  assert.equal(result.status,'local-fallback');assert.deepEqual(await readFile(imported),wav());assert.equal((await listImportedMusic(input.directory)).length,1);
});
test('cancellation propagates and never reports a successful silent fallback',async t=>{
  const input=await fixture(t),controller=new AbortController();controller.abort();
  await assert.rejects(prepareDocumentaryMusic({...input,mode:'auto',signal:controller.signal},{fetch:async()=>{throw Error('must not run');}}),{name:'AbortError'});
});
test('oversized download is stopped after one attempt and never enters music catalog',async t=>{
  const input=await fixture(t);let downloads=0;
  const request:typeof fetch=async url=>{if(String(url).startsWith('https://commons.wikimedia.org/'))return Response.json({query:{pages:[page()]}});
    downloads++;return new Response('not music',{headers:{'content-length':String(65*1024**2)}});};
  const result=await prepareDocumentaryMusic({...input,mode:'auto'},{fetch:request});
  assert.equal(downloads,1);assert.equal(result.status,'unavailable');assert.equal(result.music,undefined);assert.equal((await listImportedMusic(input.directory)).length,0);
  assert.equal(result.diagnostics?.reason,'size');
});
test('true crime rejects calm remote and local music with an explicit mood diagnosis',async t=>{
  const input=await fixture(t),track=join(input.root,'calm ambient piano.wav');await writeFile(track,wav());await importDocumentaryMusic(track,input.directory);
  let calls=0;const request:typeof fetch=async()=>{calls++;return Response.json({query:{pages:[page()]}});};
  const result=await prepareDocumentaryMusic({...input,mode:'auto',theme:'True crime: трагическая гибель'},{fetch:request});
  assert.equal(result.status,'unavailable');assert.equal(result.music,undefined);assert.equal(calls,2);
  assert.equal(result.diagnostics?.reason,'mood');assert.equal(result.diagnostics?.moodRejected,2);assert.equal(result.diagnostics?.downloads,0);
  const again=await prepareDocumentaryMusic({...input,mode:'auto',theme:'True crime: трагическая гибель'},{fetch:request});
  assert.equal(again.status,'unavailable');assert.equal(again.diagnostics?.reason,'mood');assert.equal(again.diagnostics?.cached,'cooldown');assert.equal(calls,2);
});
test('true crime accepts explicitly tense instrumental metadata and reuses the cached result',async t=>{
  const input=await fixture(t),tense=page({ImageDescription:{value:'Dark suspense instrumental soundtrack'}});tense.title='File:Dark suspense.wav';let downloads=0;
  const request:typeof fetch=async url=>{if(String(url).startsWith('https://commons.wikimedia.org/'))return Response.json({query:{pages:[tense]}});downloads++;return new Response(wav());};
  const result=await prepareDocumentaryMusic({...input,mode:'auto',theme:'True crime'},{fetch:request});
  assert.equal(result.status,'ready');assert.equal(result.music?.name,'Dark suspense.wav');assert.equal(result.diagnostics?.reason,'downloaded');
  const again=await prepareDocumentaryMusic({...input,projectDirectory:input.projectDirectory+'-second',mode:'auto',theme:'True crime'},{fetch:request});
  assert.equal(again.status,'ready');assert.equal(again.diagnostics?.reason,'cache');assert.equal(downloads,1);
});
test('retrieval reports distinct license, duration and HTTP source failures',async t=>{
  const cases = ['license','duration','source-error'] as const;
  for (const reason of cases) {
    const input=await fixture(t);
    const request:typeof fetch=async url=>{
      if(reason==='source-error')return new Response('unavailable',{status:503});
      if(String(url).startsWith('https://commons.wikimedia.org/'))return Response.json({query:{pages:[reason==='license'?page({LicenseShortName:{value:'CC BY-SA 4.0'}}):page()]}});
      return new Response(wav(1));
    };
    const result=await prepareDocumentaryMusic({...input,mode:'auto'},{fetch:request});
    assert.equal(result.status,'unavailable');assert.equal(result.music,undefined);assert.equal(result.diagnostics?.reason,reason);
    if(reason==='license'){assert.equal(result.diagnostics?.licenseRejected,2);assert.equal(result.diagnostics?.downloads,0);}
    if(reason==='duration')assert.equal(result.diagnostics?.downloads,1);
    if(reason==='source-error')assert.equal(result.diagnostics?.httpStatus,503);
  }
});
