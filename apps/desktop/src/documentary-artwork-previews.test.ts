import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import type {Project} from '@gold-work/shared';
import {motionArtworkPreviews} from './documentary-artwork-previews.js';

test('standalone commissions omit photographs while photographic ownership and old receipt images remain exact',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-artwork-previews-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const path=join(root,'source.ppm');
  await writeFile(path,Buffer.concat([Buffer.from('P6\n16 9\n255\n'),Buffer.alloc(16*9*3,180)]));
  const project={scenes:['diagram','photo'].map(id=>({id,imagePath:path,durationSeconds:5,
    documentary:{verified:true,selected:{title:id,kind:'image',width:16,height:9},
      requirement:{text:'water',identities:[],years:[],accent:'none'}}}))} as unknown as Project;
  const input=JSON.stringify({scenes:[{sceneId:'diagram',editable:true,artworkMode:'standalone'},{sceneId:'photo',editable:true,artworkMode:'photographic'}]});
  const current=await motionArtworkPreviews(project,input,root);
  const rows=JSON.parse(current.input).scenes;
  assert.equal(current.images.length,1);
  assert.equal(rows[0].sourcePreviewImage,undefined);
  assert.equal(rows[1].sourcePreviewImage,1);
  assert.equal(rows[1].sourceCatalog[0].sourceSceneId,'photo');
  assert.deepEqual(rows[1].sourceCatalog[0].variants.map((variant:{status:string})=>variant.status),['actual','on-request']);
  const previous=await motionArtworkPreviews(project,input,root,undefined,true,true);
  assert.equal(previous.images.length,2);
  assert.equal(JSON.parse(previous.input).scenes[1].sourcePreviewImage,2);
  assert.equal(previous.images[1],current.images[0]);
  assert.deepEqual(await motionArtworkPreviews(project,input,root,undefined,true,true),previous,'exact predecessor request can be reconstructed');
  const briefInput=JSON.stringify({scenes:[{sceneId:'diagram',editable:true,artworkMode:'standalone',
    artworkBrief:{view:'object',subjectQuote:'water',phaseQuotes:['water moves','water rests']}}]});
  const brief=await motionArtworkPreviews(project,briefInput,root);
  const briefRow=JSON.parse(brief.input).scenes[0];
  assert.equal(brief.images.length,1,'a brief exposes the selected source before choosing evidence mode');
  assert.equal(briefRow.sourcePreviewImage,1);
  assert.equal(briefRow.sourcePreviewSha256,
    createHash('sha256').update(Buffer.from(brief.images[0]!.split(',')[1]!,'base64')).digest('hex'));
  assert.deepEqual(await motionArtworkPreviews(project,briefInput,root),brief,'preview descriptor is stable');
});

test('a grounded cutaway comparison exposes two distinct selected still samples and hashes',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-artwork-two-sources-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const paths=[join(root,'first.ppm'),join(root,'second.ppm')];
  await Promise.all(paths.map((path,i)=>writeFile(path,Buffer.concat([Buffer.from('P6\n16 9\n255\n'),
    Buffer.alloc(16*9*3,i?80:180)]))));
  const project={scenes:paths.map((path,i)=>({id:`scene-${i}`,order:i,imagePath:path,durationSeconds:5,
    documentary:{verified:true,checksum:`source-${i}`,selected:{id:`scene-${i}`,title:`source-${i}`,kind:'image',width:16,height:9},
      requirement:{text:'water',identities:[{name:'water',aliases:[]}],years:[],accent:'none'},
      ...(i===0?{semanticMontage:{cutawaySceneIds:['scene-1']}}:{})}}))} as unknown as Project;
  const result=await motionArtworkPreviews(project,JSON.stringify({scenes:[{sceneId:'scene-0',editable:true}]}),root);
  assert.equal(result.images.length,2);
  const catalog=JSON.parse(result.input).scenes[0].sourceCatalog;
  assert.deepEqual(catalog.map((item:{sourceSceneId:string})=>item.sourceSceneId),['scene-0','scene-1']);
  for(let i=0;i<2;i++){
    assert.equal(catalog[i].previewImage,i+1);
    assert.equal(catalog[i].previewSha256,createHash('sha256').update(Buffer.from(result.images[i]!.split(',')[1]!,'base64')).digest('hex'));
  }
  const legacy=await motionArtworkPreviews(project,JSON.stringify({scenes:[{sceneId:'scene-0',editable:true}]}),root,undefined,false,true);
  assert.equal(legacy.images.length,1,'old paid single-source identity remains reconstructible');
  assert.equal(JSON.parse(legacy.input).scenes[0].sourceCatalog,undefined);
});
