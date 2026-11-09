import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {createElement as h} from 'react';
import {DocumentaryStyledMaterial} from './DocumentaryBackground.js';
import {DocumentaryEditorialScene} from './DocumentaryEditorialScene.js';
import {DocumentaryStudioScene} from './DocumentaryStudioScene.js';
import {DocumentaryPresetDecor} from './DocumentaryPresetDecor.js';
import {DocumentaryMotionGraphic} from './DocumentaryMotionGraphic.js';
import {DocumentaryGlitchSeam,documentaryGlitchPulse} from './DocumentaryGlitchSeam.js';
import {documentaryDesign,documentaryPhotoFocus,documentaryPhotoTransform} from './documentary-design.js';
import {documentaryDramaticTreatment} from './documentary-dramatic-treatment.js';
import {buildDocumentaryTimeline,type DocumentaryProjectInput,type DocumentaryMotionGraphic as Graphic} from './documentary-timeline.js';
const {renderToStaticMarkup}=createRequire(import.meta.url)('react-dom/server') as {renderToStaticMarkup:(element:ReturnType<typeof h>)=>string};
const source=h('div',{'data-original-source':true},'accepted material');
const project:DocumentaryProjectInput={aspectRatio:'16:9',settings:{voice:{enabled:true},assembly:{kenBurns:true}},scenes:[{
  id:'photo',order:0,durationSeconds:5,imagePath:'accepted.jpg',autoKenBurnsDirection:'in',autoKenBurnsZoom:1.16,autoKenBurnsFocus:{x:20,y:75},
  autoTransition:'mix',autoTransitionDurationSeconds:.4,
  documentary:{layout:'full',template:'full',templateOrigin:'automatic',autoTransitionStyle:'glitch',
    selected:{width:1920,height:1080},timing:{sourceKey:'voice',durationInFrames:150,speechSeconds:5,audioPath:'voice.wav'},
    semanticMontage:{sceneId:'photo',subject:'a car',beat:'explain',treatment:'footage',cutawaySceneIds:[]},effects:[],
    caption:{enabled:false,text:'',position:'bottom',animation:'fade',fontSize:48,color:'#ffffff',backgroundColor:'#000000',opacity:100}}
}]};
const scene=buildDocumentaryTimeline(project).scenes[0]!;

test('both saved TV IDs show only full-frame horizontal scanlines and vignette over one source',()=>{
  const render=(template:string)=>renderToStaticMarkup(h(DocumentaryStyledMaterial,{template,frame:90,frames:150,material:source}));
  const tv=render('broadcast-crt'),scan=render('broadcast-scanlines');
  assert.equal(tv,scan);
  assert.match(tv,/data-full-frame-crt/);assert.match(tv,/repeating-linear-gradient\(0deg/);assert.match(tv,/radial-gradient/);
  assert.doesNotMatch(tv,/data-styled-frame|data-tv-controls|data-tv-screen|border-radius|saturate|mix-blend-mode/);
  assert.equal((tv.match(/data-original-source/g)??[]).length,1);
});

test('existing editorial layouts keep the source whole without perforations, revealing masks or scale motion',()=>{
  for(const template of ['editorial-film-gate','editorial-orbit','editorial-shutters','editorial-iris']){
    for(const frame of [0,30,90,149]){
      const html=renderToStaticMarkup(h(DocumentaryEditorialScene,{template,frame,frames:150,material:source,accent:'#fff'}));
      assert.equal((html.match(/data-original-source/g)??[]).length,1);
      assert.doesNotMatch(html,/repeating-linear-gradient|clip-path|scale\(|rotate\(/);
    }
  }
});

test('automatic photo cards leave visible background and retain the exact photo aspect inside the border',()=>{
  const geometry={width:2004,height:1350,canvasWidth:1920,canvasHeight:1080};
  for(const template of ['archive','archive-dark','gallery']){
    const legacy=documentaryDesign(template,90,150,'#ffffff',undefined,geometry);
    const rich=documentaryDesign(template,90,150,'#ffffff',undefined,geometry,undefined,true);
    const border=template==='archive-dark'?6:32;
    assert.ok(Number(rich.main.width)<Number(legacy.main.width));assert.ok(Number(rich.main.height)<Number(legacy.main.height));
    assert.ok(Math.abs((Number(rich.main.width)-border)/(Number(rich.main.height)-border)-geometry.width/geometry.height)<1e-8);
    assert.deepEqual(documentaryDesign(template,0,150,'#ffffff',{amountPercent:0,curve:'smooth'},geometry,undefined,true),
      documentaryDesign(template,149,150,'#ffffff',{amountPercent:0,curve:'smooth'},geometry,undefined,true));
  }
});

test('studio variants keep distinct frames, custom backgrounds, one material and a static Motion0 pose',()=>{
  const render=(template:string,frame=90,motionEnabled=true,customBackground=false)=>renderToStaticMarkup(h(DocumentaryStudioScene,
    {template,frame,frames:150,material:source,accent:'#e9b34d',enhanced:true,motionEnabled,customBackground}));
  const pinned=render('studio-pinned'),gallery=render('studio-gallery-wall'),arch=render('portrait-arch');
  assert.match(pinned,/data-photo-tape/);assert.match(pinned,/border-bottom-width:42px/);
  assert.match(gallery,/inset:12% 13%/);assert.match(arch,/border-radius:46% 46% 3% 3%/);
  for(const name of ['studio-pinned','studio-gallery-wall','studio-blinds','studio-curtain','studio-diagonal','studio-radial','portrait-arch']){
    assert.equal((render(name).match(/data-original-source/g)??[]).length,1);
    assert.equal(render(name,0,false),render(name,149,false));
    assert.equal(render(name,90),render(name,149),'settled entrance should not keep drifting');
  }
  assert.match(render('studio-pinned',90,true,true),/background:transparent/);
  assert.doesNotMatch(render('studio-pinned',90,true,true),/background-image/);
});

test('film and blueprint presets recover visible decoration without adding media or overriding custom backgrounds',()=>{
  for(const [template,decor] of [['film-negative','film'],['blueprint-panel','grid'],['photo-corners','brackets']]){
    const render=(enhanced:boolean,frame:number)=>renderToStaticMarkup(h(DocumentaryPresetDecor,{template:template!,accent:'#b8d1d7',frame,customBackground:true,enhanced,motionEnabled:false}));
    assert.match(render(true,0),new RegExp(`data-preset-decor="${decor}"`));
    assert.doesNotMatch(render(false,0),/data-preset-decor/);
    assert.doesNotMatch(render(true,0),/<img|<video|background:#10161c/);
    assert.equal(render(true,0),render(true,149));
  }
});

test('automatic clean accent animates only its saved short phrase and Motion0 makes every word readable immediately',()=>{
  const graphic:Graphic={kind:'key-point',origin:'automatic',variant:'clean',enabled:true,title:'Only 12 cars',startSeconds:0,durationSeconds:3};
  const render=(frame:number,allowAutomaticPhrase=true,motionEnabled=true)=>renderToStaticMarkup(h(DocumentaryMotionGraphic,{graphic,frame,frames:90,accent:'#efb543',textColor:'#fff',allowAutomaticPhrase,motionEnabled}));
  assert.match(render(40),/font-size:112px/);assert.match(render(40),/<foreignObject/);
  assert.notEqual(render(0),render(40));assert.equal(render(0,true,false),render(89,true,false));
  assert.match(render(40,false),/font-size:58px/);assert.doesNotMatch(render(40,false),/translateY\(/);
  const content=render(40).replace(/<[^>]+>/g,'');
  assert.equal(content,graphic.title);assert.equal(graphic.title,'Only 12 cars');
});

test('glitch occupies at most the first eight overlap frames and never duplicates source or audio',()=>{
  for(const frames of [0,1,2,4,8,12,60]){
    for(let frame=-1;frame<=frames;frame++){
      const pulse=documentaryGlitchPulse(frame,frames);
      assert.ok(pulse.amount>=0&&pulse.amount<=.7);assert.ok(Math.abs(pulse.x)<=5);
      if(frame<0||frame>=Math.min(8,frames)||frames<2)assert.deepEqual(pulse,{x:0,amount:0});
    }
  }
  const children=h('div',{},source,h('audio',{src:'accepted-voice.wav'}));
  const render=(frame:number,enabled=true)=>renderToStaticMarkup(h(DocumentaryGlitchSeam,{frame,frames:12,enabled,children}));
  assert.match(render(1),/data-glitch-seam/);
  for(const html of [render(1),render(8),render(1,false)]){
    assert.equal((html.match(/data-original-source/g)??[]).length,1);assert.equal((html.match(/<audio/g)??[]).length,1);
  }
  assert.equal(render(8),render(1,false));assert.equal(render(8),render(60));
});

test('timeline retains focus, transition timing and voice; an explicitly selected transition keeps its style',()=>{
  assert.deepEqual(scene.autoKenBurnsFocus,{x:20,y:75});assert.equal(scene.documentary?.transitionStyle,'glitch');
  assert.equal(scene.documentary?.templateOrigin,'automatic');
  assert.equal(scene.durationInFrames,150);assert.equal(scene.transitionFrames,12);assert.equal(scene.documentary?.timing?.audioPath,'voice.wav');
  const manual=buildDocumentaryTimeline({...project,scenes:[{...project.scenes[0]!,transition:'mix',documentary:{...project.scenes[0]!.documentary!,transitionStyle:'clean'}}]}).scenes[0]!;
  assert.equal(manual.documentary?.transitionStyle,'clean');assert.equal(manual.durationInFrames,150);
});

test('saved focus maps original coordinates through contain and cover without assigning points to video or authored shots',()=>{
  const focus=(s=scene,aspect=16/9,canvas=16/9,fit:'contain'|'cover'='cover')=>documentaryPhotoFocus(s,undefined,'full',aspect,canvas,fit);
  assert.deepEqual(focus(),{x:20,y:75});
  assert.deepEqual(focus(scene,.5,2,'contain'),{x:42.5,y:75});
  assert.deepEqual(focus(scene,.5,2,'cover'),{x:20,y:100});
  assert.deepEqual(focus({...scene,autoKenBurnsFocus:{x:25,y:0}},4,2,'contain'),{x:25,y:25});
  assert.deepEqual(focus({...scene,autoKenBurnsFocus:{x:25,y:0}},4,2,'cover'),{x:0,y:0});
  for(const change of [{videoPath:'accepted.mp4'},{imagePath:undefined},{motion:false},{autoKenBurnsFocus:{x:-1,y:50}},
    {autoKenBurnsFocus:{x:NaN,y:50}},{autoKenBurnsFocus:undefined}])assert.equal(focus({...scene,...change}),undefined);
  for(const change of [{pinned:true},{templateOrigin:'manual' as const},{templateOrigin:undefined},{templateMotion:{amountPercent:0,curve:'smooth' as const}},
    {motionGraphic:{kind:'annotations' as const,enabled:true,title:'',startSeconds:0,durationSeconds:5}}])assert.equal(focus({...scene,documentary:{...scene.documentary!,...change}}),undefined);
  for(const direction of ['in','out','off'] as const)assert.equal(focus({...scene,kenBurnsDirection:direction}),undefined);
  assert.equal(documentaryPhotoFocus(scene,undefined,'archive',16/9,16/9,'contain'),undefined);
});

test('photo cameras pan in four directions, obey zoom in/out and never move video or Motion0',()=>{
  const at=(direction:typeof scene.autoKenBurnsDirection,frame:number)=>documentaryPhotoTransform({...scene,autoKenBurnsDirection:direction},undefined,frame).transform;
  assert.equal(at('in',0),'scale(1)');assert.equal(at('in',149),'scale(1.16)');
  assert.equal(at('out',0),'scale(1.16)');assert.equal(at('out',149),'scale(1)');
  for(const [direction,axis,sign] of [['pan-left','X',1],['pan-right','X',-1],['pan-up','Y',1],['pan-down','Y',-1]] as const){
    assert.equal(at(direction,0),`translate${axis}(${3*sign}%) scale(1.16)`);
    assert.equal(at(direction,149),`translate${axis}(${-3*sign}%) scale(1.16)`);
  }
  for(const change of [{videoPath:'accepted.mp4'},{motion:false},{kenBurnsDirection:'off' as const},
    {documentary:{...scene.documentary!,templateMotion:{amountPercent:0,curve:'smooth' as const}}}]){
    for(const frame of [0,75,149])assert.equal(documentaryPhotoTransform({...scene,...change},undefined,frame).transform,'scale(1)');
  }
});

test('emphasis drains colour smoothly at the saved local onset and stays monochrome through the last scene frame',()=>{
  const direction={monochrome:true,monochromeStartSeconds:2,vignette:true};
  const at=(frame:number)=>documentaryDramaticTreatment(direction,frame,300);
  assert.equal(at(0).filter,undefined);assert.equal(at(60).filter,undefined);
  assert.match(at(72).filter!,/^grayscale\(0\./);assert.equal(at(90).filter,'grayscale(1)');
  assert.equal(at(299).filter,'grayscale(1)');assert.equal(at(299).vignette,0);
  assert.equal(documentaryDramaticTreatment({monochrome:true},29,300,30,1).filter,undefined);
  assert.equal(documentaryDramaticTreatment({monochrome:true},90,300,30,1).filter,'grayscale(1)');
  assert.equal(documentaryDramaticTreatment(undefined,100,300).filter,undefined);
});
