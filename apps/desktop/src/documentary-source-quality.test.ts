import assert from 'node:assert/strict';
import test from 'node:test';
import {documentarySourceQualityIssue,enforceDocumentaryTechnicalQuality,documentarySavedQualityIssue,documentaryKnownQualityIssue,documentaryKnownOriginalGeometryIssue,documentaryAutoPortraitTemplate,receivedDocumentarySourceText} from './documentary-source-quality.js';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import type {DocumentaryRequirement,Project,Scene} from '@gold-work/shared';
import {documentaryEditErrors} from './documentary-validation.js';

test('a positive explanation with an invalid verdict remains uncertain and reports the response format',()=>{
  const result=enforceDocumentaryTechnicalQuality({status:'accept',reason:'The intended person is clearly visible',technicalQuality:{detail:'clear',compression:'clean',pixelated:false,evidence:'Sharp actual frames'}},true);
  assert.equal(result.status,'uncertain');assert.match(String(result.reason),/неподдерживаемый статус/);
  assert.deepEqual(result.annotations,[]);
});

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
  assert.match(documentaryKnownQualityIssue({provider:'youtube',kind:'video',localPath:'cached-original.mp4',width:480,height:854} as never,{aspectRatio:'16:9'},scene)!,/менее половины кадра/,
    'A cached YouTube original has probed geometry, unlike its search thumbnail');
  assert.equal(documentaryKnownQualityIssue({provider:'local',kind:'video',localPath:'catalogued-original.mp4',width:1920,height:1080} as never,{aspectRatio:'16:9'},scene),undefined);
  assert.equal(documentaryKnownQualityIssue({...source,provider:'youtube'} as never,{aspectRatio:'16:9'},scene),undefined,'YouTube previews are not original dimensions');
  assert.equal(documentaryKnownQualityIssue({...source,width:undefined} as never,{aspectRatio:'16:9'},scene),undefined);
});

test('detailed vertical stills have no aspect-ratio gap before download or on saved continuation, without forcing a layout',()=>{
  const project={aspectRatio:'16:9'} as const;
  for(const [width,height] of [[1280,1462],[1839,2101],[1080,1920],[1087,1280],[1088,1280],[1120,1280]] as const){
    const source={provider:'commons',kind:'image',width,height} as const;
    assert.equal(documentarySourceQualityIssue(source,project.aspectRatio),undefined,`${width}x${height}`);
    for(const layout of ['full','contain'] as const){
      const scene={durationSeconds:5,narration:'With all her sails set, she carried around 32,000 square feet of canvas.',
        documentary:{layout,caption:{enabled:false},verified:true,pinned:false,selected:source,
        ...(layout==='contain'?{template:'contain',templateOrigin:'manual'}:{})}} as Scene;
      const before=JSON.stringify(scene);
      assert.equal(documentaryKnownQualityIssue(source as never,project,scene),undefined,`Search geometry: ${width}x${height}`);
      assert.equal(documentaryKnownOriginalGeometryIssue(project,scene),undefined,`Downloaded geometry: ${width}x${height}`);
      assert.equal(documentarySavedQualityIssue(project,scene),undefined,`Saved geometry: ${width}x${height}`);
      assert.equal(documentaryAutoPortraitTemplate(scene,source,project.aspectRatio),undefined,'Detailed still does not need an automatic portrait template');
      assert.equal(JSON.stringify(scene),before,'The user layout and saved selection remain untouched');
    }
  }
});

test('the wider portrait allowance retains detail, minimum pixels, scale, video and strip gates',()=>{
  for(const [width,height] of [[960,594],[960,679],[960,627],[959,1280],[1080,1279],[479,1600],[1920,300],[4000,500]] as const)
    assert.ok(documentarySourceQualityIssue({kind:'image',width,height},'16:9'),`Unusable still ${width}x${height}`);
  for(const [width,height] of [[1080,1920],[1280,1462],[1839,2101]] as const)
    assert.match(documentarySourceQualityIssue({kind:'video',width,height},'16:9')!,/менее половины кадра/,`Video ${width}x${height}`);
  assert.match(documentarySourceQualityIssue({kind:'image',width:960,height:679},'16:9')!,/слишком мал/,'The enlargement limit remains unchanged');
  const review={status:'accepted',technicalQuality:{detail:'clear',compression:'clean',pixelated:false,evidence:'Sharp actual source',orientation:'upright',continuousShot:true}};
  for(const bad of [{detail:'unusable'},{compression:'severe'},{pixelated:true}])
    assert.equal(enforceDocumentaryTechnicalQuality({...review,technicalQuality:{...review.technicalQuality,...bad}},true,true).status,'rejected');
});

test('a narrow original may pass only when the automatic portrait panel can display it sharply',()=>{
  const photo={provider:'commons',kind:'image',width:608,height:1080} as const;
  const scene={order:154,durationSeconds:5,documentary:{layout:'full',caption:{enabled:false},verified:false,pinned:false}} as Scene;
  const project={aspectRatio:'16:9'} as Project;
  assert.match(documentarySourceQualityIssue(photo,'16:9')!,/менее половины кадра/);
  assert.equal(documentarySourceQualityIssue(photo,'16:9','portrait-card'),undefined);
  assert.equal(documentaryAutoPortraitTemplate(scene,photo,'16:9'),'portrait-stage');
  assert.equal(documentaryAutoPortraitTemplate({...scene,order:155},photo,'16:9'),'portrait-stage');
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
  assert.equal(documentaryKnownQualityIssue(source as never,{aspectRatio:'16:9'},scene),undefined,'A brand hashtag alone does not establish game recording');
  assert.match(documentaryKnownQualityIssue({...source,description:'#valentinorossi #motogp22 game recording'} as never,{aspectRatio:'16:9'},scene)!,/видеоигры/);
  assert.ok(documentaryKnownQualityIssue({...source,title:'Aircraft simulator gameplay',description:''} as never,{aspectRatio:'16:9'},scene));
  assert.match(documentaryKnownQualityIssue({...source,title:'MotoGP 4 (PS2) - Eps #2 - Season Mode',description:''} as never,{aspectRatio:'16:9'},scene)!,/видеоигры/);
  assert.match(documentaryKnownQualityIssue({...source,title:'MotoGP Pov Shoulder Cam vs MotoGP21',
    description:'Some comparison between real life footage and game footage'} as never,{aspectRatio:'16:9'},scene)!,/видеоигры/);
  for(const description of ['MotoGP 2022 race footage','Real vs gameplay comparison','Interview about motorcycle engineering'])
    assert.equal(documentaryKnownQualityIssue({...source,description} as never,{aspectRatio:'16:9'},scene),undefined);
});

test('game metadata uses explicit recording or mode labels for fictional and familiar brands alike',()=>{
  const scene={durationSeconds:5} as Scene;
  const source={provider:'youtube',kind:'video',title:'Nebula Circuit 37',description:''} as const;
  for(const clue of ['gameplay','career mode','season mode','game recording','game footage','game capture','game walkthrough'])
    assert.match(documentaryKnownQualityIssue({...source,title:source.title+' '+clue} as never,{aspectRatio:'16:9'},scene)!,/видеоигры/,clue);
  for(const title of ['Nebula Circuit 37 racing documentary','MotoGP22 #motogp22 PlayStation5','Museum walkthrough'])
    assert.equal(documentaryKnownQualityIssue({...source,title} as never,{aspectRatio:'16:9'},scene),undefined,title);
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
  const narration='Парусник в гавани.';
  const requirement:DocumentaryRequirement={text:narration,entities:[],identities:[],years:[],queries:['sailing ship in harbor'],preferredKind:'image'};
  const scene={id:'s',order:0,narration,durationSeconds:5,documentary:{verified:true,pinned:false,effects:[],requirement,
    selected:{kind:'image',width:640,height:480}}} as unknown as Scene;
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

test('ordinary frame geometry is checked in the same response; legacy paid results are retained',()=>{
  const value={status:'accepted',technicalQuality:{detail:'clear',compression:'clean',pixelated:false,evidence:'Clear visible subject',orientation:'upright',continuousShot:true}};
  assert.equal(enforceDocumentaryTechnicalQuality(value,true,true).status,'accepted');
  assert.equal(enforceDocumentaryTechnicalQuality({...value,technicalQuality:{...value.technicalQuality,orientation:'sideways'}},true,true).status,'rejected');
  const cut=enforceDocumentaryTechnicalQuality({...value,technicalQuality:{...value.technicalQuality,continuousShot:false}},true,true);
  assert.equal(cut.status,'rejected');assert.match(String(cut.reason),/склейка/);
  const malformed=enforceDocumentaryTechnicalQuality({...value,technicalQuality:{...value.technicalQuality,continuousShot:'false'}},true,true);
  assert.equal(malformed.status,'uncertain');assert.doesNotMatch(String(malformed.reason),/обнаружена склейка/);
  const old={...value,technicalQuality:{detail:'clear',compression:'clean',pixelated:false,evidence:'Legacy verdict'}};
  assert.equal(enforceDocumentaryTechnicalQuality(old,true,true).status,'uncertain');
  assert.equal(enforceDocumentaryTechnicalQuality(old).status,'accepted');
});

test('new actual-frame votes reject publisher promotions and strictly classify source text',()=>{
  const clean={status:'accepted',technicalQuality:{detail:'clear',compression:'clean',pixelated:false,evidence:'Clear camera footage',orientation:'upright',continuousShot:true},
    sourceText:{kind:'none',text:''}};
  assert.equal(enforceDocumentaryTechnicalQuality(clean,true,true,true).status,'accepted');
  const promo=enforceDocumentaryTechnicalQuality({...clean,sourceText:{kind:'promotion',text:'Please Subscribe'}},true,true,true);
  assert.equal(promo.status,'rejected');assert.match(String(promo.reason),/Please Subscribe/);
  assert.equal(enforceDocumentaryTechnicalQuality({...clean,sourceText:{kind:'physical',text:'Main Street'}},true,true,true).status,'accepted');
  for(const sourceText of [undefined,{kind:false,text:'Subscribe'},{kind:['none'],text:''},{kind:'none',text:42},{kind:'none',text:'Please Subscribe'},{kind:'promotion',text:''}])
    assert.equal(enforceDocumentaryTechnicalQuality({...clean,sourceText},true,true,true).status,'uncertain');
  assert.equal(enforceDocumentaryTechnicalQuality({...clean,sourceText:undefined},true,true).status,'accepted','Old completed receipts remain readable');
});

test('completed per-frame source-text responses retain promotion evidence without weakening malformed rows',()=>{
  const rows=Array.from({length:3},()=>({sourceText:{kind:'promotion',text:'PLEASE SUBSCRIBE'}}));
  assert.deepEqual(receivedDocumentarySourceText('```json\n'+JSON.stringify(rows)+'\n```'),{sourceText:{kind:'promotion',text:'PLEASE SUBSCRIBE'}});
  for(const invalid of [rows.slice(0,2),[rows[0],rows[1],{sourceText:{kind:'none',text:42}}],{sourceText:rows[0]!.sourceText}])
    assert.equal(receivedDocumentarySourceText(JSON.stringify(invalid)),undefined);
});
