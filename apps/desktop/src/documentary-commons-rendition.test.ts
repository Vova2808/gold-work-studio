import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {commonsCandidates,DocumentarySearch} from './documentary-search.js';

const original='https://upload.wikimedia.org/wikipedia/commons/c/ca/Cutty_Sark_%28ship%2C_1869%29_-_SLV_H91.250-164.jpg';
const thumbnail='https://thumb.wikimedia.org/wikipedia/commons/thumb/c/ca/Cutty_Sark_%28ship%2C_1869%29_-_SLV_H91.250-164.jpg/1920px-Cutty_Sark_%28ship%2C_1869%29_-_SLV_H91.250-164.jpg';
const info={url:original,thumburl:thumbnail,thumbwidth:1920,thumbheight:1439,width:4842,height:3630,size:3684335,mime:'image/jpeg',
 descriptionurl:'https://commons.wikimedia.org/wiki/File:Cutty_Sark_(ship,_1869)_-_SLV_H91.250-164.jpg',
 extmetadata:{LicenseShortName:{value:'CC BY 3.0'},LicenseUrl:{value:'https://creativecommons.org/licenses/by/3.0/'}}};
const payload=(changes={})=>({query:{pages:[{pageid:15656203,title:'File:Cutty Sark (ship, 1869) - SLV H91.250-164.jpg',imageinfo:[{...info,...changes}]}]}});

test('automatic Commons discovery chooses a same-file official full-HD rendition and reports its actual geometry',()=>{
 const c=commonsCandidates(payload(),'Cutty Sark',true)[0]!;
 assert.equal(c.downloadUrl,thumbnail);assert.equal(c.width,1920);assert.equal(c.height,1439);
 assert.equal(c.bytes,undefined,'Original byte size is not the size of the rendition');
 assert.equal(c.id,'commons:15656203');assert.equal(c.rights,'licensed');assert.equal(c.pageUrl,info.descriptionurl);
 assert.equal(commonsCandidates(payload(),'Cutty Sark')[0]!.downloadUrl,original,'Manual/default parsing retains the original');
});

test('old original-only cache cannot mask the new automatic rendition; new metadata is reused',async t=>{
 const root=await mkdtemp(join(tmpdir(),'gws-commons-rendition-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const key=createHash('sha256').update(JSON.stringify(['commons-native-subject-1','commons','cutty sark','image','licensed-only',''])).digest('hex');
 const oldFile=join(root,key+'.json'),old=JSON.stringify({expiresAt:Date.now()+86400000,candidates:commonsCandidates(payload(),'Cutty Sark')});
 await writeFile(oldFile,old);let calls=0;
 const search=new DocumentarySearch(undefined,async input=>{calls++;assert.equal(new URL(String(input)).searchParams.get('iiurlwidth'),'1920');return Response.json(payload());},root);
 for(let attempt=0;attempt<2;attempt++)assert.equal((await search.search({query:'Cutty Sark',kind:'image',providers:['commons']},true,undefined,true)).candidates[0]!.downloadUrl,thumbnail);
 assert.equal(calls,1);assert.equal(await readFile(oldFile,'utf8'),old);
});

for(const changes of [
 {thumbwidth:1600,thumbheight:1200},{thumbwidth:1920,thumbheight:900},{thumbwidth:undefined,thumbheight:undefined},
 {thumburl:thumbnail.replace('thumb.wikimedia.org','example.org')},
 {thumburl:thumbnail.replace('/c/ca/','/a/ab/')},
 {thumbwidth:1920,thumbheight:1080},
])test(`insufficient, unbound or cropped rendition keeps the original: ${JSON.stringify(changes)}`,()=>{
 assert.equal(commonsCandidates(payload(changes),'Cutty Sark',true)[0]!.downloadUrl,original);
});
