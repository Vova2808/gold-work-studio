import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import type {DocumentaryArtwork as Artwork} from '@gold-work/shared';
// Built affected library first: exercise the same implementation used by consumers.
import {DocumentaryArtwork, artworkTrajectoryFit} from '../../../packages/remotion-video/dist/DocumentaryArtwork.js';
// @ts-expect-error Exercise the current TS helper, not a historical JS neighbour.
import {updateArtworkLayer} from '../../renderer/src/documentary-artwork-edit.ts';

const require=createRequire(import.meta.url);
const {createElement}=require('react') as {createElement:(component:typeof DocumentaryArtwork,props:Parameters<typeof DocumentaryArtwork>[0])=>unknown};
const {renderToStaticMarkup}=require('react-dom/server') as {renderToStaticMarkup:(node:unknown)=>string};
const art:Artwork={version:1,intent:'Bounded stage4 review reproductions',layout:'full',canvas:{width:1000,height:600},
  palette:{background:'#ffffff',ink:'#111111',accent:'#ee6633',secondary:'#336677'},startSeconds:0,durationSeconds:3,
  layers:[{id:'label',kind:'text',x:100,y:100,w:600,h:100,text:'Manual color',fontSize:44,fill:'accent'}]};
const render=(artwork:Artwork)=>renderToStaticMarkup(createElement(DocumentaryArtwork,
  {artwork,frame:45,frames:90,moving:true,width:1000,height:600,material:null}));
const textColor=(artwork:Artwork)=>render(artwork).match(/line-height:1\.15;color:([^;]+);/u)?.[1];
const reopen=(artwork:Artwork):Artwork=>JSON.parse(JSON.stringify(artwork));

test('explicit manual text fill wins while untouched artwork keeps contrast repair',()=>{
  const original=JSON.stringify(art);
  assert.equal(textColor(art),'#111111','unmodified low-contrast authored colour is still corrected');
  for(const [fill,expected] of [['accent','#ee6633'],['#ffffff','#ffffff']]) {
    const edited=updateArtworkLayer(art,'label',{fill:fill!});
    assert.equal(edited.layers[0]!.fillOrigin,'manual');
    assert.equal(textColor(edited),expected);
    assert.equal(textColor(reopen(edited)),expected,'manual colour survives saved JSON');
  }
  const moved=updateArtworkLayer(art,'label',{editTransform:{x:30,y:10,rotation:15,scale:1.2}});
  assert.equal(moved.layers[0]!.fillOrigin,undefined,'moving text does not opt out of its authored contrast repair');
  assert.equal(textColor(moved),'#111111');
  assert.equal(JSON.stringify(art),original);
});

test('manual stroke edits retain original fit and peer position, including sequential edits and saved defaults',()=>{
  const edge:Artwork={...art,layers:[
    {id:'edge',kind:'path',x:0,y:100,w:400,h:200,path:'M0 0H400V200H0Z',stroke:'ink',strokeWidth:2},
    {id:'peer',kind:'rect',x:900,y:200,w:50,h:50,fill:'secondary',stroke:'none'}]};
  const original=JSON.stringify(edge),before=artworkTrajectoryFit(edge);
  assert.deepEqual(before,{scale:1,x:1,y:0});
  const thick=updateArtworkLayer(edge,'edge',{strokeWidth:100});
  assert.equal(thick.layers[1],edge.layers[1],'independent peer data stays exact');
  assert.deepEqual(artworkTrajectoryFit(thick),before);
  assert.equal(900*artworkTrajectoryFit(thick).scale+artworkTrajectoryFit(thick).x,901,'review reproduction: no49unit peer jump');
  assert.match(render(thick),/stroke-width="100"/u,'the actual edited stroke is still rendered');
  assert.match(render(thick),/data-artwork-trajectory="fixed" transform="translate\(1 0\) scale\(1\)"/u);
  const again=updateArtworkLayer(reopen(thick),'edge',{stroke:'none',strokeWidth:200});
  assert.deepEqual(again.layers[0]!.framingBeforeEdit,{stroke:'ink',strokeWidth:2},'later edits keep the first original bounds');
  assert.deepEqual(artworkTrajectoryFit(again),before);
  const automatic:Artwork={...edge,layers:[{...edge.layers[0]!,strokeWidth:100},edge.layers[1]!]};
  assert.equal(artworkTrajectoryFit(automatic).x,50,'automatic fit still accounts for unedited authored stroke');
  const implicit:Artwork={...edge,layers:[{...edge.layers[0]!,stroke:undefined,strokeWidth:undefined},edge.layers[1]!]};
  const implicitEdit=reopen(updateArtworkLayer(implicit,'edge',{stroke:'none',strokeWidth:100}));
  assert.deepEqual(implicitEdit.layers[0]!.framingBeforeEdit,{},'absent original fields survive JSON as an explicit empty baseline');
  assert.deepEqual(artworkTrajectoryFit(implicitEdit),artworkTrajectoryFit(implicit));
  assert.equal(JSON.stringify(edge),original);
});
