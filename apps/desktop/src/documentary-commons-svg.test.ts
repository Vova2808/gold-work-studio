import assert from 'node:assert/strict';
import test from 'node:test';
import {DocumentarySearch,commonsCandidates} from './documentary-search.js';

function page(id:number,mime:string){return {pageid:id,title:`File:Mechanism-${id}`,
  imageinfo:[{mime,width:300,height:220,size:1000,url:`https://upload.wikimedia.org/commons/${id}.svg`,
    descriptionurl:`https://commons.wikimedia.org/wiki/File:Mechanism-${id}`,
    thumburl:`https://upload.wikimedia.org/commons/thumb/${id}.svg/640px-${id}.svg.png`,thumbwidth:640,thumbheight:469,
    extmetadata:{LicenseShortName:{value:'CC BY-SA 4.0'},LicenseUrl:{value:'https://creativecommons.org/licenses/by-sa/4.0/'},Artist:{value:'Original artist'},ImageDescription:{value:'Engine schematic'}}}]};}

test('Commons requests one high resolution batch for SVG, keeps original credit and small raster previews, never approves pixels',async()=>{
  const svg=page(1,'image/svg+xml'),second=page(2,'image/svg+xml'),raster=page(3,'image/jpeg');
  raster.imageinfo[0]!.width=1920;raster.imageinfo[0]!.height=1080;raster.imageinfo[0]!.url='https://upload.wikimedia.org/commons/photo.jpg';
  const calls:URL[]=[];
  const search=new DocumentarySearch(undefined,async input=>{
    const url=new URL(String(input));calls.push(url);
    if(url.searchParams.has('generator'))return Response.json({query:{pages:[svg,second,raster]}});
    assert.equal(url.searchParams.get('pageids'),'1|2');assert.equal(url.searchParams.get('iiurlwidth'),'1600');
    return Response.json({query:{pages:[1,2].map(pageid=>({pageid,imageinfo:[{mime:'image/svg+xml',width:300,height:220,
      thumburl:`https://upload.wikimedia.org/commons/thumb/${pageid}.svg/1600px-${pageid}.svg.png`,thumbwidth:1600,thumbheight:1173}]}))}});
  });
  const result=await search.search({query:'engine schematic',kind:'image',providers:['commons']});
  assert.equal(calls.length,2);assert.equal(calls[0]!.searchParams.get('iiurlwidth'),'640');
  assert.equal(result.candidates.length,3);
  const converted=result.candidates.find(c=>c.id==='commons:1')!;
  assert.match(converted.downloadUrl!,/1600px.*\.png$/);assert.equal(converted.width,1600);assert.equal(converted.height,1173);
  assert.equal(converted.author,'Original artist');assert.equal(converted.license,'CC BY-SA 4.0');assert.equal(converted.rights,'licensed');
  assert.equal(converted.bytes,undefined,'SVG size is not the downloaded PNG size');assert.equal(converted.match,'unverified');
  assert.match(result.candidates.find(c=>c.id==='commons:3')!.previewUrl!,/640px/);
});

test('missing, tiny or non-PNG SVG render is never used; a render-service failure preserves raster results',async()=>{
  assert.equal(commonsCandidates({query:{pages:[page(1,'image/svg+xml')]}},'engine').length,0);
  const svg=page(1,'image/svg+xml');Object.assign(svg.imageinfo[0]!,{thumbwidth:1600,thumbheight:1173,thumburl:'https://upload.wikimedia.org/commons/raw.svg'});
  assert.equal(commonsCandidates({query:{pages:[svg]}},'engine').length,0);
  const search=new DocumentarySearch(undefined,async input=>new URL(String(input)).searchParams.has('generator')
    ?Response.json({query:{pages:[page(1,'image/svg+xml'),page(2,'image/jpeg')]}}):new Response('unavailable',{status:503}));
  const result=await search.search({query:'engine',kind:'image',providers:['commons']});
  assert.equal(result.candidates.length,1);assert.equal(result.candidates[0]!.id,'commons:2');
});
