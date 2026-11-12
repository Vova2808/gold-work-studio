import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {commonsCandidates,DocumentarySearch} from './documentary-search.js';

const name='StateLibQld_1_145051_Cutty_Sark_%28ship%29.jpg';
const original=`https://upload.wikimedia.org/wikipedia/commons/7/7b/${name}`;
const thumb=`https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7b/${name}/960px-${name}`;
const originalInfo={url:original,thumburl:original+'?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail_unscaled',
  width:1000,height:707,thumbwidth:1000,thumbheight:707,size:83662,mime:'image/jpeg',
  descriptionurl:'https://commons.wikimedia.org/wiki/File:StateLibQld_1_145051_Cutty_Sark_(ship).jpg',
  extmetadata:{LicenseShortName:{value:'Public domain'},Artist:{value:'Original archive credit'}}};
const page=(changes={})=>({pageid:14491633,title:'File:StateLibQld 1 145051 Cutty Sark (ship).jpg',imageinfo:[{...originalInfo,...changes}]});
const payload=(changes={})=>({query:{pages:[page(changes)]}});
const parse=(changes={},automatic=true)=>commonsCandidates(payload(changes),'Cutty Sark sails',automatic)[0]!;

test('small unscaled JPEG uses the closest standard same-file rendition without claiming HD or original bytes',()=>{
  const candidate=parse();
  assert.equal(candidate.downloadUrl,thumb);assert.equal(candidate.previewUrl,thumb);
  assert.equal(candidate.width,960);assert.equal(candidate.height,679);assert.equal(candidate.bytes,undefined);
  assert.equal(candidate.id,'commons:14491633');assert.equal(candidate.author,'Original archive credit');
  assert.equal(candidate.rights,'public-domain');assert.equal(candidate.pageUrl,originalInfo.descriptionurl);
  assert.equal(candidate.match,'unverified');
});

test('real imageinfo unscaled URL may report requested display dimensions rather than original pixels',()=>{
  // The saved live 1920px imageinfo response points at the same 1000px original
  // while advertising 1920x1357 for presentation. Neither dimension is a file upscale.
  for(const [thumbwidth,thumbheight] of [[1920,1357],[999,706]]){
    const candidate=parse({thumbwidth,thumbheight});
    assert.equal(candidate.downloadUrl,thumb);
    assert.equal(candidate.width,960);assert.equal(candidate.height,679);
  }
  for(const change of [{thumbwidth:1920,thumbheight:800},{thumbwidth:0},{thumbheight:NaN}])
    assert.equal(parse(change).downloadUrl,original,'Inconsistent presentation geometry remains unmodified');
});

test('API-confirmed standard rendition is preferred verbatim and manual parsing retains the original',()=>{
  const confirmed=thumb+'?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail';
  const changes={thumburl:confirmed,thumbwidth:960,thumbheight:679,thumbmime:'image/jpeg'};
  assert.equal(parse(changes).downloadUrl,confirmed);
  const manual=parse(changes,false);
  assert.equal(manual.downloadUrl,original);assert.equal(manual.width,1000);assert.equal(manual.height,707);assert.equal(manual.bytes,83662);
  assert.equal(parse({},false).downloadUrl,original);
});

test('generic PNG names keep their encoding, format and closest standard size',()=>{
  const file='Aurora_%E2%80%93_M%C3%BCnchen_%281%29.png';
  const url=`https://upload.wikimedia.org/wikipedia/commons/a/ab/${file}`;
  const data=payload({url,thumburl:url,width:1400,height:1000,thumbwidth:1400,thumbheight:1000,mime:'image/png'});
  data.query.pages[0]!.title='File:Aurora – München (1).png';
  const result=commonsCandidates(data,'Aurora',true)[0]!;
  assert.equal(result.downloadUrl,`https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/${file}/1280px-${file}`);
  assert.equal(result.width,1280);assert.equal(result.height,914);assert.equal(result.bytes,undefined);
});

test('at most ten percent width loss is allowed; originals and thumbnails at or below 500 are never substituted',()=>{
  assert.equal(parse({width:1066,thumbwidth:1066}).width,960);
  for(const width of [500,501,600,959,960,1067,1200,1280,1500,1919,1920,1921]){
    const result=parse({width,thumbwidth:width});
    assert.equal(result.downloadUrl,original,`Original width ${width}`);assert.equal(result.width,width);
  }
  assert.equal(parse({thumburl:thumb.replaceAll('960px-','500px-'),thumbwidth:500,thumbheight:354}).downloadUrl,original);
});

test('unsupported formats, transcodes, invalid geometry and nonstandard or wrong-file API thumbnails retain the original',()=>{
  const changes=[
    {mime:'image/tiff'},{mime:'image/webp'},{mime:'image/png'}, {thumbmime:'image/webp'},
    {width:NaN},{height:0},{width:1000.5},{thumbwidth:undefined},{thumbheight:undefined},
    {thumburl:thumb,thumbwidth:960,thumbheight:600},
    {thumburl:thumb.replace('960px-','999px-'),thumbwidth:999,thumbheight:706},
    {thumburl:thumb.replace('960px-'+name,'960px-Other_ship.jpg'),thumbwidth:960,thumbheight:679},
    {thumburl:thumb.replace('/7/7b/','/a/ab/'),thumbwidth:960,thumbheight:679},
    {thumburl:thumb.replace('thumb.wikimedia.org','example.org'),thumbwidth:960,thumbheight:679},
    {thumburl:thumb+'.webp',thumbwidth:960,thumbheight:679},
  ];
  for(const change of changes)assert.equal(parse(change).downloadUrl,original,JSON.stringify(change));
  const data=payload();data.query.pages[0]!.title='File:Different ship.jpg';
  assert.equal(commonsCandidates(data,'Cutty Sark',true)[0]!.downloadUrl,original,'A title cannot bind a different original filename');
});

test('only a confirmed ordinary Commons original path can yield a canonical JPEG/PNG URL',()=>{
  for(const url of [original.replace('upload.wikimedia.org','example.org'),original.replace('upload.wikimedia.org','upload.wikimedia.org.evil.test'),
    original.replace('upload.wikimedia.org','upload.wikimedia.org:8443'),original.replace('/7/7b/','/7/ab/'),
    original.replace('/7/7b/','/7/7bbb/'),original.replace('/wikipedia/commons/','/wikipedia/en/'),
    original+'?redirect=another-file',original+'#other',original.replace(name,'Cutty%2Fother.jpg'),original.replace(name,'Bad%ZZ.jpg')]){
    assert.equal(parse({url,thumburl:url}).downloadUrl,url,url);
  }
  assert.equal(parse({thumburl:'https://thumb.wikimedia.org/wikipedia/commons/transcoded/7/7b/'+name}).downloadUrl,original);
  for(const url of [original.replace('https:','http:'),original.replace('https://','https://user:password@')])
    assert.equal(commonsCandidates(payload({url,thumburl:url}),'Cutty Sark',true).length,0);
  const longName='Длинное_имя_'.repeat(12)+'.jpg',longUrl=original.replace(name,encodeURIComponent(longName));
  const longData=payload({url:longUrl,thumburl:longUrl});longData.query.pages[0]!.title='File:'+longName.replace(/_/g,' ');
  assert.equal(commonsCandidates(longData,'Archive photo',true)[0]!.downloadUrl,longUrl,'Do not guess the shortened thumbnail filename convention');
});

test('one automatic metadata GET supplies the small rendition and coalesces a differently worded query',async()=>{
  let calls=0;
  const search=new DocumentarySearch(undefined,async url=>{
    calls++;assert.equal(new URL(String(url)).searchParams.get('iiurlwidth'),'1920');return Response.json(payload());
  });
  for(const query of ['Cutty Sark sails photograph','Cutty Sark archival view']){
    const result=await search.search({query,entities:['Cutty Sark'],kind:'image',providers:['commons']},true,undefined,true);
    assert.equal(result.candidates[0]!.downloadUrl,thumb);
  }
  assert.equal(calls,1,'No follow-up API request, transport retry or duplicate native discovery');
});

test('previous original-only automatic cache cannot hide the small rendition and remains untouched',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-commons-small-raster-'));
  t.after(async()=>{assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));assert.ok(root.includes('gws-commons-small-raster-'));await rm(root,{recursive:true,force:true});});
  const query='Cutty Sark sails',key=createHash('sha256').update(JSON.stringify(['commons-native-rendition-4','commons','"cutty sark" sails','image','licensed-only','intitle:"cutty sark"'])).digest('hex');
  const oldFile=join(root,key+'.json'),old=JSON.stringify({expiresAt:Date.now()+86400000,candidates:commonsCandidates(payload(),query)});
  await writeFile(oldFile,old);let calls=0;
  const make=()=>new DocumentarySearch(undefined,async()=>{calls++;return Response.json(payload({thumbwidth:1920,thumbheight:1357}));},root);
  for(let attempt=0;attempt<2;attempt++)assert.equal((await make().search({query,entities:['Cutty Sark'],kind:'image',providers:['commons']},true,undefined,true)).candidates[0]!.downloadUrl,thumb);
  assert.equal(calls,1);assert.equal(await readFile(oldFile,'utf8'),old);
});
