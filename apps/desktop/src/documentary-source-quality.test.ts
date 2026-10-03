import assert from 'node:assert/strict';
import test from 'node:test';
import {documentarySourceQualityIssue,enforceDocumentaryTechnicalQuality,documentarySavedQualityIssue,documentaryKnownQualityIssue,documentaryAutoPortraitTemplate} from './documentary-source-quality.js';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import type {Project,Scene} from '@gold-work/shared';
import {documentaryEditErrors} from './documentary-validation.js';

test('rejects small originals and narrow strips while accepting usable HD and detailed 4:3 images',()=>{
  for(const [width,height] of [[640,360],[854,480],[320,240],[1920,300],[1080,1920]])assert.ok(documentarySourceQualityIssue({kind:'video',width,height},'16:9'),`${width}x${height}`);
  for(const [width,height] of [[1280,720],[1920,1080],[3840,2160],[1200,900]])assert.equal(documentarySourceQualityIssue({kind:'image',width,height},'16:9'),undefined,`${width}x${height}`);
  assert.equal(documentarySourceQualityIssue({kind:'video',width:1080,height:1920},'9:16'),undefined);
  assert.equal(documentarySourceQualityIssue({kind:'image',width:1080,height:1920},'16:9','subject-card'),undefined,'a sharp portrait belongs in the portrait panel');
  assert.ok(documentarySourceQualityIssue({kind:'image',width:320,height:560},'16:9','subject-card'),'small portraits remain rejected');
});

test('sharp portrait photographs remain usable and original dimensions reject wasted downloads before paid ranking',()=>{
  const scene={durationSeconds:5} as Scene;
  for(const [width,height] of [[1648,2464],[1500,2500],[1080,1920]])assert.equal(documentarySourceQualityIssue({kind:'image',width,height}),undefined);
  for(const [width,height] of [[480,854],[601,900]])assert.ok(documentarySourceQualityIssue({kind:'image',width,height}));
  const source={provider:'commons',kind:'image',width:640,height:360} as const;
  assert.ok(documentaryKnownQualityIssue(source as never,{aspectRatio:'16:9'},scene));
  assert.match(documentaryKnownQualityIssue({provider:'local',kind:'video',localPath:'catalogued-original.mp4',width:480,height:854} as never,{aspectRatio:'16:9'},scene)!,/менее половины кадра/);
  assert.equal(documentaryKnownQualityIssue({provider:'local',kind:'video',localPath:'catalogued-original.mp4',width:1920,height:1080} as never,{aspectRatio:'16:9'},scene),undefined);
  assert.equal(documentaryKnownQualityIssue({...source,provider:'youtube'} as never,{aspectRatio:'16:9'},scene),undefined,'YouTube previews are not original dimensions');
  assert.equal(documentaryKnownQualityIssue({...source,width:undefined} as never,{aspectRatio:'16:9'},scene),undefined);
});

test('a narrow original may pass only when the automatic portrait panel can display it sharply',()=>{
  const photo={provider:'commons',kind:'image',width:608,height:1080} as const;
  const scene={order:154,durationSeconds:5,documentary:{layout:'full',caption:{enabled:false},verified:false,pinned:false}} as Scene;
  const project={aspectRatio:'16:9'} as Project;
  assert.match(documentarySourceQualityIssue(photo,'16:9')!,/менее половины кадра/);
  assert.equal(documentarySourceQualityIssue(photo,'16:9','portrait-card'),undefined);
  assert.equal(documentaryAutoPortraitTemplate(scene,photo,'16:9'),'portrait-stage');
  assert.equal(documentaryKnownQualityIssue(photo as never,project,scene),undefined);
  const accepted={...scene,documentary:{...scene.documentary!,verified:true,selected:photo,template:'portrait-stage',templateOrigin:'automatic'}} as Scene;
  assert.equal(documentarySavedQualityIssue(project,accepted),undefined);
  assert.ok(documentaryKnownQualityIssue({...photo,width:320,height:560} as never,project,scene));
  const manual={...scene,documentary:{...scene.documentary!,template:'full',templateOrigin:'manual'}} as Scene;
  assert.equal(documentaryAutoPortraitTemplate(manual,photo,'16:9'),undefined);
  assert.ok(documentaryKnownQualityIssue(photo as never,project,manual));
});

test('explicit game footage is skipped before download without rejecting real racing years or mixed comparisons',()=>{
  const scene={durationSeconds:5} as Scene;
  const source={provider:'youtube',kind:'video',title:'VALENTINO ROSSI RC211V 2002 | 4K',description:'#valentinorossi #motogp22'} as const;
  assert.match(documentaryKnownQualityIssue(source as never,{aspectRatio:'16:9'},scene)!,/видеоигры/);
  assert.ok(documentaryKnownQualityIssue({...source,title:'Aircraft simulator gameplay',description:''} as never,{aspectRatio:'16:9'},scene));
  for(const description of ['MotoGP 2022 race footage','Real vs gameplay comparison','Interview about motorcycle engineering'])
    assert.equal(documentaryKnownQualityIssue({...source,description} as never,{aspectRatio:'16:9'},scene),undefined);
});
test('YouTube SD is skipped before a full-screen download but a small card still gets an original check',()=>{
  const scene={durationSeconds:5} as Scene;
  const source={provider:'youtube',kind:'video',title:'Motorcycle workshop',description:'Archive film',videoDefinition:'sd'} as const;
  assert.match(documentaryKnownQualityIssue(source as never,{aspectRatio:'16:9'},scene)!,/SD/);
  assert.equal(documentaryKnownQualityIssue({...source,videoDefinition:'hd'} as never,{aspectRatio:'16:9'},scene),undefined);
  const card={...scene,documentary:{motionGraphic:{enabled:true,kind:'subject-card',startSeconds:0,durationSeconds:5}}} as Scene;
  assert.equal(documentaryKnownQualityIssue(source as never,{aspectRatio:'16:9'},card),undefined);
});
test('pixelation, severe compression and unusable detail reject a semantic approval; bokeh and archive grain do not',()=>{
  for(const bad of [{pixelated:true},{compression:'severe'},{detail:'unusable'}])assert.equal(enforceDocumentaryTechnicalQuality({status:'accepted',technicalQuality:bad}).status,'rejected');
  assert.equal(enforceDocumentaryTechnicalQuality({status:'accepted',technicalQuality:{detail:'clear',compression:'visible',pixelated:false,evidence:'Sharp subject, blurred background and film grain'}}).status,'accepted');
  const result=enforceDocumentaryTechnicalQuality({reviews:[{id:1,status:'accepted',technicalQuality:{pixelated:true}},{id:2,status:'accepted',technicalQuality:{detail:'clear'}}]});
  assert.deepEqual((result.reviews as Array<{status:string}>).map(r=>r.status),['rejected','accepted']);
  assert.equal(enforceDocumentaryTechnicalQuality({status:'accepted'},true).status,'uncertain');
  assert.equal(enforceDocumentaryTechnicalQuality({status:'accepted'},false).status,'accepted'); // Old paid cache is not resubmitted for new fields.
});

test('export flags a previously approved low-resolution source and retains an explicit manual pin',()=>{
  const scene={id:'s',order:0,durationSeconds:5,documentary:{verified:true,pinned:false,effects:[],selected:{kind:'image',width:640,height:480}}} as unknown as Scene;
  const project={mediaMode:'stock',aspectRatio:'16:9',settings:{assembly:{documentary:{version:2}}},scenes:[scene]} as Project;
  assert.match(documentaryEditErrors(project).join('\n'),/слишком мал/);
  scene.documentary!.pinned=true;assert.deepEqual(documentaryEditErrors(project),[]);
});
test('known poor sources are rejected before any paid request, while manual pins remain user decisions',async()=>{
  let calls=0;const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{calls++;throw Error('Must not pay');}},()=>'.');
  const scene={imagePath:'old.png',narration:'Объект.',documentary:{verified:true,pinned:false,checksum:'old',requirement:{text:'Объект.',entities:[],identities:[],years:[]},selected:{kind:'image',width:640,height:360}}} as unknown as Scene;
  const project={id:'quality-test',aspectRatio:'16:9',scenes:[scene]} as Project;
  const review=await service.inspect(project,scene);assert.equal(review.status,'rejected');assert.equal(calls,0);assert.match(review.reason,/слишком мал/);
  assert.ok(documentarySavedQualityIssue(project,scene));scene.documentary!.pinned=true;assert.equal(documentarySavedQualityIssue(project,scene),undefined);
});
