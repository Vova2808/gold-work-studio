import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createElement, type ReactNode} from 'react';
import type {DocumentaryArtwork as Artwork} from '@gold-work/shared';
import {DocumentaryArtwork, artworkLayerState, artworkTrajectoryFit} from './DocumentaryArtwork.js';

const {renderToStaticMarkup} = createRequire(import.meta.url)('react-dom/server') as {renderToStaticMarkup:(node:ReactNode)=>string};
const artwork:Artwork = {version:1,intent:'Manual transform preserves the existing motion',layout:'full',motionCoordinates:'relative',
  canvas:{width:1000,height:600},palette:{background:'#eeeeee',ink:'#222222',accent:'#dd4433',secondary:'#336677'},startSeconds:0,durationSeconds:6,
  layers:[{id:'assembly',kind:'group',x:100,y:100,w:200,h:200,keyframes:[{t:0,x:0,rotation:0},{t:1,x:80,rotation:30}]},
    {id:'part',parentId:'assembly',kind:'rect',x:120,y:140,w:80,h:40,fill:'accent',keyframes:[{t:0,y:0},{t:1,y:50}]},
    {id:'label',kind:'text',x:600,y:70,w:300,h:90,text:'Unchanged label',fill:'ink',fontSize:32},
    {id:'peer',kind:'ellipse',x:700,y:350,w:100,h:100,fill:'secondary',keyframes:[{t:0,scale:1},{t:1,scale:.8}]}]};
const render = (art:Artwork,frame:number,moving=true,materials?:Parameters<typeof DocumentaryArtwork>[0]['materials']) =>
  renderToStaticMarkup(createElement(DocumentaryArtwork,{artwork:art,frame,frames:101,moving,width:1000,height:600,material:null,materials}));
const transform = (html:string,id:string) => html.match(new RegExp(`data-artwork-layer="${id}"[^>]*transform="([^"]+)"`,'u'))?.[1];

test('whole group transform moves its animated path while preserving child keys and scene framing',()=>{
  const before=JSON.stringify(artwork);
  const edited:Artwork={...artwork,layers:artwork.layers.map(layer=>layer.id==='assembly'?{...layer,editTransform:{x:100,y:40,rotation:90,scale:2}}:layer)};
  assert.deepEqual(artworkTrajectoryFit(edited),artworkTrajectoryFit(artwork),'manual movement never re-fits or moves peer objects');
  const original=render(artwork,50),changed=render(edited,50);
  assert.equal(transform(changed,'assembly'),'translate(100 120) translate(200 200) rotate(105) scale(2) translate(-200 -200)');
  assert.equal(transform(render(edited,0),'assembly'),'translate(100 40) translate(200 200) rotate(90) scale(2) translate(-200 -200)');
  for(const id of ['part','label','peer']) assert.equal(transform(changed,id),transform(original,id));
  assert.ok(changed.indexOf('data-artwork-layer="part"')>changed.indexOf('data-artwork-layer="assembly"'));
  assert.deepEqual(artworkLayerState(edited.layers[0]!, .5),artworkLayerState(artwork.layers[0]!, .5),'authored keyframe evaluator stays unchanged');
  assert.deepEqual(edited.layers[0]!.keyframes,artwork.layers[0]!.keyframes);
  assert.equal(JSON.stringify(artwork),before,'rendering and editing do not mutate the original');
  assert.equal(render(edited,0,false),render(edited,100,false),'Motion0 keeps a held edited pose');
});

test('manual source transform wraps existing authored viewport and source identity without recropping',()=>{
  const source:Artwork={...artwork,layers:[{id:'source',kind:'media',x:100,y:100,w:200,h:300,sourceSceneId:'original',sourceWindow:{x:.2,y:.1,w:.5,h:.6},
    editTransform:{x:60,y:20,scale:.5,rotation:15},keyframes:[{t:0,x:0},{t:1,x:20}]}]};
  const html=render(source,50,true,{source:{material:createElement('div',{'data-real-source':'preserved'}),sourceAspect:2,actualVariant:'original'}});
  assert.equal(transform(html,'source'),'translate(60 20) translate(200 250) rotate(15) scale(0.5) translate(-200 -250) translate(10 0) translate(200 250) rotate(0) scale(1) translate(-200 -250)');
  assert.match(html,/data-artwork-source-box="true" x="100" y="100" width="200" height="300"/u);
  assert.match(html,/data-artwork-source-window="detail"/u);assert.match(html,/data-real-source="preserved"/u);
});
