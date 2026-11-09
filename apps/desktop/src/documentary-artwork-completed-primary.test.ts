import test from 'node:test';
import assert from 'node:assert/strict';
import type {DocumentaryArtwork} from '@gold-work/shared';
import {validateMotionArtwork} from './documentary-artwork-plan.js';
import {assessArtworkReplacement} from './documentary-artwork-quality.js';

const drawing=():DocumentaryArtwork=>({version:1,intent:'Fictional parcel tally',layout:'full',canvas:{width:1000,height:600},
  palette:{background:'#101820',ink:'#f5f0e5',accent:'#7ab5ce',secondary:'#cbb583'},startSeconds:0,durationSeconds:5,
  layers:[{id:'slots',kind:'path',x:80,y:170,w:700,h:130,path:'M0 0V120 M120 0V120 M240 0V120 M360 0V120 M480 0V120',stroke:'ink',fill:'none'},
    {id:'filled',kind:'path',x:80,y:170,w:700,h:130,path:'M0 0V120 M120 0V120 M240 0V120 M360 0V120',stroke:'accent',fill:'none'},
    {id:'number',kind:'text',x:70,y:50,w:300,h:70,text:'4'},
    {id:'label',kind:'text',x:70,y:400,w:700,h:70,text:'parcels'}]});
test('two compound graphic paths plus labels are pictured content',()=>{
  const result=validateMotionArtwork(drawing(),'4 parcels',6,true,16/9);
  assert.ok(result.artwork,result.issue);assert.equal(result.artwork.layers.filter(l=>l.kind==='path').length,2);
  assert.equal(assessArtworkReplacement(result.artwork).allowReplacement,true);
});
test('text, caption plate and simple connector still have no illustrated subject',()=>{
  for(const extras of [[],[{id:'plate',kind:'rect',x:50,y:40,w:750,h:460,fill:'ink'}],
    [{id:'line',kind:'path',x:80,y:170,w:700,h:130,path:'M0 0L100 100',stroke:'ink',fill:'none'}]] as const){
    const art=drawing();art.layers=[...art.layers.filter(l=>l.kind==='text'),{id:'third-label',kind:'text',x:70,y:510,w:700,h:70,text:'parcels'},...structuredClone(extras)] as DocumentaryArtwork['layers'];
    assert.equal(assessArtworkReplacement(art).allowReplacement,false);
    assert.equal(validateMotionArtwork(art,'4 parcels',6,true,16/9).issue,'text-only composition');
  }
});
test('compound paths do not bypass invalid geometry, action or media ownership',()=>{
  const art=drawing();art.layers[0]!.w=-1;assert.ok(!validateMotionArtwork(art,'4 parcels',6,true,16/9).artwork);
  const action=drawing();action.actions=[{id:'bad',layerId:'missing',start:0,end:.8,from:{x:0},to:{x:2}}];
  assert.equal(validateMotionArtwork(action,'4 parcels',6,true,16/9).issue,'invalid causal object action');
});
test('equivalent closed SVG caption/background rectangles remain annotations',()=>{
  const paths=['M0 0H750V460H0Z','M0,0 L750,0 L750,460 L0,460 z','m0 0h750v460h-750z',
    'M0 0 750 0 750 460 0 460Z','M750 460H0V0H750Z','M0 0L375 0H750V230V460H0V0Z',
    'M0 0L750 0L750 460L0 460L0 0','m0 0 7.5e2 0 0 4.6e2 -7.5e2 0z'];
  for(const path of paths){
    const art=drawing();art.layers=[{id:'plate',kind:'path',x:50,y:40,w:750,h:460,path,fill:'ink'},...art.layers.filter(l=>l.kind==='text')];
    assert.equal(validateMotionArtwork(art,'4 parcels',6,true,16/9).issue,'text-only composition',path);
  }
  const background=drawing();background.layers=[{id:'background',kind:'path',x:0,y:0,w:1000,h:600,path:'M0 0H1000V600H0Z',fill:'ink'},...background.layers.filter(l=>l.kind==='text')];
  assert.equal(validateMotionArtwork(background,'4 parcels',6,true,16/9).issue,'text-only composition');
});
test('a closed rectangle subject separate from labels and nonrectangular subject remain eligible',()=>{
  for(const path of ['M0 0H200V140H0Z','M0 140L100 0L200 140Z']){
    const art=drawing();art.layers=[{id:'subject',kind:'path',x:300,y:170,w:200,h:140,path,fill:'accent'},...art.layers.filter(l=>l.kind==='text')];
    assert.ok(validateMotionArtwork(art,'4 parcels',6,true,16/9).artwork,path);
  }
});
