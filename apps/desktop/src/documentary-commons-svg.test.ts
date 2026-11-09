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
  for(const item of [svg,second])Object.assign(item.imageinfo[0]!,{
    thumburl:`https://upload.wikimedia.org/commons/thumb/${item.pageid}.svg/1600px-${item.pageid}.svg.png`,thumbwidth:1600,thumbheight:1173});
  const search=new DocumentarySearch(undefined,async input=>{
    const url=new URL(String(input));calls.push(url);
    assert.ok(url.searchParams.has('generator'),'Automatic SVG metadata belongs to the same native GET');
    return Response.json({query:{pages:[svg,second,raster]}});
  });
  const result=await search.search({query:'engine schematic',kind:'image',providers:['commons']},true,undefined,true);
  assert.equal(calls.length,1);assert.equal(calls[0]!.searchParams.get('iiurlwidth'),'1920');
  assert.equal(result.candidates.length,3);
  const converted=result.candidates.find(c=>c.id==='commons:1')!;
  assert.match(converted.downloadUrl!,/1600px.*\.png$/);assert.equal(converted.width,1600);assert.equal(converted.height,1173);
  assert.equal(converted.author,'Original artist');assert.equal(converted.license,'CC BY-SA 4.0');assert.equal(converted.rights,'licensed');
  assert.equal(converted.bytes,undefined,'SVG size is not the downloaded PNG size');assert.equal(converted.match,'unverified');
  assert.match(result.candidates.find(c=>c.id==='commons:3')!.previewUrl!,/640px/);
});

test('missing, tiny or non-PNG SVG render is never used; native discovery preserves raster results without another render request',async()=>{
  assert.equal(commonsCandidates({query:{pages:[page(1,'image/svg+xml')]}},'engine').length,0);
  const svg=page(1,'image/svg+xml');Object.assign(svg.imageinfo[0]!,{thumbwidth:1600,thumbheight:1173,thumburl:'https://upload.wikimedia.org/commons/raw.svg'});
  assert.equal(commonsCandidates({query:{pages:[svg]}},'engine').length,0);
  const search=new DocumentarySearch(undefined,async input=>new URL(String(input)).searchParams.has('generator')
    ?Response.json({query:{pages:[page(1,'image/svg+xml'),page(2,'image/jpeg')]}}):new Response('unavailable',{status:503}));
  const result=await search.search({query:'engine',kind:'image',providers:['commons']},true,undefined,true);
  assert.equal(result.candidates.length,1);assert.equal(result.candidates[0]!.id,'commons:2');
});
