import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {DocumentaryCandidate,EffectAsset,Scene} from '@gold-work/shared';
import {prepareDocumentaryDiagram,prepareDocumentaryDiagrams,prepareDocumentaryImages} from './documentary-media-cache.js';
import {effectFfmpeg,probeEffectMedia} from './effect-media.js';

test('SVG diagram derivatives have a readable white sheet, preserve black ink and original alpha, and reuse outputs',async()=>{
  const root=await mkdtemp(join(tmpdir(),'gws-diagram-media-')),file='original.png';
  await effectFfmpeg(['-y','-f','lavfi','-i','color=black@0:s=128x96,format=rgba,drawbox=x=40:y=30:w=40:h=30:c=black@1:t=fill:replace=1','-frames:v','1',join(root,file)]);
  const original=await readFile(join(root,file));
  const asset={id:'fixture',file,kind:'image'} as EffectAsset;
  const prepared={metadata:await probeEffectMedia(join(root,file))};
  const candidate={provider:'commons',kind:'image',title:'Mechanism.svg'} as DocumentaryCandidate;
  const result=await prepareDocumentaryDiagram(root,asset,candidate,prepared);
  assert.deepEqual(await readFile(join(root,file)),original);
  for(const [xy,expected] of [['0:0',255],['50:40',0]] as const){
    const raw=join(root,`${expected}.rgb`);
    await effectFfmpeg(['-y','-i',join(root,result.proxy!),'-vf',`crop=2:2:${xy},format=rgb24`,'-frames:v','1','-f','rawvideo',raw]);
    assert.deepEqual([...await readFile(raw)],Array(12).fill(expected));
  }
  const before=(await stat(join(root,result.proxy!))).mtimeMs;
  assert.deepEqual(await prepareDocumentaryDiagram(root,asset,candidate,prepared),result);
  assert.equal((await stat(join(root,result.proxy!))).mtimeMs,before);
  assert.equal(await prepareDocumentaryDiagram(root,asset,{...candidate,title:'Person cutout.png'},prepared),prepared);
  const legacy=await prepareDocumentaryDiagram(join(root,'separate-output'),{...asset,file:join(root,file)},candidate,
    {metadata:{...prepared.metadata,hasAlpha:undefined} as unknown as EffectAsset['metadata']});
  assert.equal(legacy.metadata?.hasAlpha,true,'older Commons manifests without alpha are inspected rather than skipped');
  assert.ok((await stat(join(root,'separate-output',legacy.proxy!))).size>0,'an absolute input path is not joined beneath the output directory');
});

test('local SVG diagram playback and Final share a cached matte without changing the selected source or ordinary cutouts',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-local-diagram-')),source=join(root,'original.png');
  t.after(()=>rm(root,{recursive:true,force:true}));
  await effectFfmpeg(['-y','-f','lavfi','-i','color=black@0:s=128x96,format=rgba,drawbox=x=40:y=30:w=40:h=30:c=black@1:t=fill:replace=1','-frames:v','1',source]);
  const bytes=await readFile(source);
  const scene={id:'diagram',imagePath:source,durationSeconds:6,documentary:{checksum:'local-diagram',verified:true,
    selected:{id:'local:diagram',provider:'local',kind:'image',title:'Piston schema.svg',description:'Kinematic diagram of the mechanism',
      localPath:source,width:128,height:96},visualReview:{status:'accepted',reason:'Technical diagram'}}} as unknown as Scene;
  const original=JSON.stringify(scene);
  // This is the same narrow preparation invoked by Final before timeline construction.
  const [prepared]=await prepareDocumentaryDiagrams(root,[scene]);assert.ok(prepared?.imagePath);
  assert.notEqual(prepared.imagePath,source);assert.equal((await probeEffectMedia(prepared.imagePath)).hasAlpha,false);
  assert.equal(prepared.documentary,scene.documentary,'candidate, original path and approval are retained');
  const raw=join(root,'background.rgb');
  await effectFfmpeg(['-y','-i',prepared.imagePath,'-vf','crop=2:2:0:0,format=rgb24','-frames:v','1','-f','rawvideo',raw]);
  assert.deepEqual([...await readFile(raw)],Array(12).fill(255));
  const modified=(await stat(prepared.imagePath)).mtimeMs;
  assert.deepEqual(await prepareDocumentaryImages(root,[scene]),[prepared],'preview uses the identical derived path');
  assert.deepEqual(await prepareDocumentaryDiagrams(root,[prepared]),[prepared]);
  assert.equal((await stat(prepared.imagePath)).mtimeMs,modified,'repeated export does not regenerate the matte');
  const cutout={...scene,documentary:{...scene.documentary!,selected:{...scene.documentary!.selected!,title:'Person cutout.svg',description:'Portrait'}}};
  assert.deepEqual(await prepareDocumentaryDiagrams(root,[cutout]),[cutout],'an arbitrary transparent SVG/PNG is not made white');
  const opaque={...scene,imagePath:prepared.imagePath,documentary:{...scene.documentary!,checksum:'opaque-diagram'}};
  assert.deepEqual(await prepareDocumentaryDiagrams(root,[opaque]),[opaque],'already opaque artwork needs no new matte');
  assert.deepEqual(await readFile(source),bytes);assert.equal(JSON.stringify(scene),original);
});
