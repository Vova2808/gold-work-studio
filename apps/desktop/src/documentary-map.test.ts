import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {drawDocumentaryCity,prepareDocumentaryStreetMap as prepareDocumentaryMap} from './documentary-map.js';

const place={name:'Denver',latitude:39.741134,longitude:-104.985962};
const a={lat:place.latitude,lon:place.longitude},b={lat:place.latitude+.001,lon:place.longitude+.001};
const ways=[1,2,3].map(id=>({type:'way',id,tags:{highway:'residential',name:'A & <B>'},geometry:[null,a,b,null,a,b,null]}));

test('clipped city geometry keeps gaps and escapes external labels',()=>{
  const {svg,counts}=drawDocumentaryCity([...ways,{type:'way',id:4,tags:{building:'yes'},geometry:[a,null,b]}],place,1.25);
  assert.equal(counts.roads,3);assert.equal(counts.buildings,0);
  assert.match(svg,/A &amp; &lt;B&gt;/);assert.doesNotMatch(svg,/NaN|undefined/);
  assert.match(svg,/d="M[\d. ]+L[\d. ]+M[\d. ]+L[\d. ]+"/);
});

test('a prepared map and interrupted local SVG rebuild reuse the completed request',async()=>{
  const root=await mkdtemp(join(tmpdir(),'gws-map-test-')),original=globalThis.fetch;
  let calls=0;
  const rasterize=async(svg:string,output:string)=>{await writeFile(output,svg);};
  globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({elements:ways}));};
  try{
    const [one,two]=await Promise.all([prepareDocumentaryMap(root,place,1.25,rasterize),prepareDocumentaryMap(root,place,1.25,rasterize)]);
    assert.equal(one.imagePath,two.imagePath);assert.equal(calls,1);
    await prepareDocumentaryMap(root,place,1.25,rasterize);assert.equal(calls,1);
    const directory=join(root,'Documentary','Maps');
    for(const file of await readdir(directory))if(!file.endsWith('.osm.json'))await rm(join(directory,file));
    const recovered=await prepareDocumentaryMap(root,place,1.25,rasterize);assert.equal(calls,1);
    assert.match(await readFile(recovered.imagePath,'utf8'),/<svg/);
  }finally{globalThis.fetch=original;await rm(root,{recursive:true,force:true});}
});
