import assert from 'node:assert/strict';
import test from 'node:test';
import type {DocumentaryArtwork as Artwork,DocumentaryArtworkLayer as Layer} from '@gold-work/shared';
import {reviewArtworkTemporal} from './documentary-artwork-temporal-review.js';
const unit=(i:number):Layer=>({id:`unit-${i}`,kind:'path',x:100+i*22,y:160,w:18,h:100,path:'M9 0 V100',fill:'none',stroke:'#ed9c22',strokeWidth:7,
  keyframes:[{t:0,opacity:0,draw:0},{t:.12+i*.09,opacity:0,draw:0},{t:.16+i*.09,opacity:1,draw:1},{t:1,opacity:1,draw:1}]});
const art=(layers:Layer[]):Artwork=>({version:1,canvas:{width:800,height:450},durationSeconds:6,layers} as Artwork);
const hasChange=(a:Artwork)=>!reviewArtworkTemporal(a).findings.some(f=>f.code==='no-object-state-change');
test('separate painted open units accumulate through renderer states, including a later collection exit',()=>{
  const a=art(Array.from({length:5},(_,i)=>unit(i)));
  assert.equal(hasChange(a),true);assert.ok(reviewArtworkTemporal(a).changes.every(c=>c.kind==='accumulation'));
  a.layers.forEach(l=>{l.keyframes!.splice(-1,1,{t:.78,opacity:1,draw:1},{t:.9,opacity:0,draw:0},{t:1,opacity:0,draw:0});});assert.equal(hasChange(a),true);
});
test('single, simultaneous, decorative, invisible and unpainted strokes do not establish object action',()=>{
  const cases:Record<string,(layers:Layer[])=>Layer[]>={single:l=>l.slice(0,1),
    simultaneous:l=>l.map(x=>({...x,keyframes:unit(0).keyframes})),
    decorative:l=>l.map((x,i)=>({...x,x:i*180,w:170,h:5,path:'M0 2 H170'})),
    zeroOpacity:l=>l.map(x=>({...x,opacity:0,keyframes:x.keyframes!.map(k=>({...k,opacity:0}))})),
    none:l=>l.map(x=>({...x,stroke:'none'})),zeroWidth:l=>l.map(x=>({...x,strokeWidth:0})),
    cameraOnly:l=>l.map(x=>({...x,keyframes:undefined})),
    movingConnector:l=>l.slice(0,1).map(x=>({...x,keyframes:[{t:0,x:0},{t:.5,x:200},{t:1,x:200}]}))};
  for(const [name,change] of Object.entries(cases))assert.equal(hasChange(art(change(Array.from({length:5},(_,i)=>unit(i))))),false,name);
  const drift=art(Array.from({length:5},(_,i)=>({...unit(i),keyframes:undefined})));
  drift.camera={path:'continuous',keyframes:[{t:0,x:400,y:225,scale:1},{t:1,x:600,y:225,scale:1.3}]};
  assert.equal(hasChange(drift),false,'camera tour of static open units');
  assert.equal(hasChange(art(Array.from({length:5},(_,i)=>({...unit(i),kind:'rect' as const,fill:'#ed9c22',keyframes:unit(0).keyframes})))),false,'general fade of filled collection');
});
