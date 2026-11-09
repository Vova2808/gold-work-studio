import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {satelliteMapRequest,prepareSatelliteMap} from './documentary-satellite-map.js';
import {effectFfmpeg} from './effect-media.js';
const place={name:'Denver',latitude:39.741134,longitude:-104.985962};

test('satellite request uses the licensed archive layer, city-wide Mercator bounds and limited image size',()=>{
  const {url,radiusKm,bbox}=satelliteMapRequest(place),params=new URL(url).searchParams;
  assert.equal(radiusKm,35);assert.equal(params.get('layers'),'s2cloudless_3857');
  assert.equal(params.get('width'),'2400');assert.equal(params.get('height'),'1350');
  const groundWidth=(bbox[2]!-bbox[0]!)*Math.cos(place.latitude*Math.PI/180);
  assert.ok(Math.abs(groundWidth-70000)<.001);
  assert.throws(()=>satelliteMapRequest({...place,latitude:89}));
  assert.throws(()=>satelliteMapRequest({...place,longitude:179.99}));
});

test('satellite fetch is deduplicated/cached and XML errors never become a ready image',async()=>{
  const root=await mkdtemp(join(tmpdir(),'gws-satellite-test-')),original=globalThis.fetch;
  try{
    const jpeg=join(root,'fixture.jpg');await effectFfmpeg(['-y','-f','lavfi','-i','color=c=green:s=2400x1350','-frames:v','1',jpeg]);
    const bytes=await readFile(jpeg);let calls=0;
    globalThis.fetch=async()=>{calls++;return new Response(bytes,{headers:{'content-type':'image/jpeg'}});};
    const [a,b]=await Promise.all([prepareSatelliteMap(root,place),prepareSatelliteMap(root,place)]);
    assert.equal(a.imagePath,b.imagePath);assert.equal(calls,1);assert.equal(a.kind,'satellite');
    globalThis.fetch=async()=>{throw Error('No network allowed');};
    assert.equal((await prepareSatelliteMap(root,place)).imagePath,a.imagePath);
    globalThis.fetch=async()=>new Response('<ServiceException/>',{headers:{'content-type':'text/xml'}});
    await assert.rejects(prepareSatelliteMap(root,place,50),/не вернул спутниковое изображение/);
  }finally{globalThis.fetch=original;await rm(root,{recursive:true,force:true});}
});
