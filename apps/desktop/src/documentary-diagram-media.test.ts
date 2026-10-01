import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {DocumentaryCandidate,EffectAsset} from '@gold-work/shared';
import {prepareDocumentaryDiagram} from './documentary-media-cache.js';
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
});
