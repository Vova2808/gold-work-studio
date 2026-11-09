import assert from 'node:assert/strict';
import test from 'node:test';
import type {DocumentaryArtwork} from '@gold-work/shared';
import {normalizeArtworkGroupCoordinates} from './documentary-artwork-coordinates.js';

const fixture=()=>({motionCoordinates:'absolute',layers:[
  {id:'diagram',kind:'group',x:620,y:340,w:320,h:180},
  {id:'plate',parentId:'diagram',kind:'rect',x:0,y:0,w:320,h:180},
  {id:'rod',parentId:'diagram',kind:'path',x:110,y:20,w:20,h:40,keyframes:[{t:0,y:20},{t:1,y:40}]}
]} as DocumentaryArtwork);
test('local leaf-group geometry and absolute motion targets move together, once',()=>{
  const source=fixture(),normalized=normalizeArtworkGroupCoordinates(source) as DocumentaryArtwork;
  assert.deepEqual([normalized.layers[1]!.x,normalized.layers[1]!.y],[620,340]);
  assert.deepEqual([normalized.layers[2]!.x,normalized.layers[2]!.y],[730,360]);
  assert.deepEqual(normalized.layers[2]!.keyframes,[{t:0,y:360},{t:1,y:380}]);
  assert.equal(source.layers[1]!.x,0);assert.deepEqual(normalizeArtworkGroupCoordinates(normalized),normalized);
});
test('relative movement, already absolute boxes and ambiguous mixed boxes remain intact',()=>{
  const relative=fixture();relative.motionCoordinates='relative';
  assert.deepEqual((normalizeArtworkGroupCoordinates(relative) as DocumentaryArtwork).layers[2]!.keyframes,relative.layers[2]!.keyframes);
  const mixed=fixture();mixed.layers[1]!.x=620;mixed.layers[1]!.y=340;
  assert.deepEqual(normalizeArtworkGroupCoordinates(mixed),mixed);
});
test('1x1 placeholder pivot expands to visible absolute child geometry without moving the children',()=>{
  const artwork={canvas:{width:1000,height:562},motionCoordinates:'relative',layers:[
    {id:'wheel-spokes',kind:'group',x:0,y:0,w:1,h:1,keyframes:[{t:0,rotation:0},{t:.6,rotation:30}]},
    {id:'spoke-a',kind:'path',parentId:'wheel-spokes',x:840,y:181,w:1,h:200,path:'M0 0 L1 200'},
    {id:'spoke-b',kind:'path',parentId:'wheel-spokes',x:780,y:241,w:120,h:80,path:'M0 0 L120 80'}
  ]} as DocumentaryArtwork;
  const normalized=normalizeArtworkGroupCoordinates(artwork) as DocumentaryArtwork;
  assert.deepEqual([normalized.layers[0]!.x,normalized.layers[0]!.y,normalized.layers[0]!.w,normalized.layers[0]!.h],[780,181,120,200]);
  assert.deepEqual(normalized.layers.slice(1),artwork.layers.slice(1));
  assert.deepEqual(normalizeArtworkGroupCoordinates(normalized),normalized);
  assert.deepEqual([artwork.layers[0]!.x,artwork.layers[0]!.w],[0,1]);
});
test('authored bounds, empty placeholders and out-of-canvas children are not guessed',()=>{
  const base={canvas:{width:1000,height:562},motionCoordinates:'relative',layers:[
    {id:'g',kind:'group',x:100,y:100,w:120,h:90},
    {id:'detail',kind:'rect',parentId:'g',x:110,y:110,w:30,h:20}
  ]} as DocumentaryArtwork;
  assert.deepEqual(normalizeArtworkGroupCoordinates(base),base);
  for(const child of [undefined,{...base.layers[1],x:990}]){
    const unchanged={...base,layers:[{...base.layers[0],x:0,y:0,w:1,h:1},...(child?[child]:[])]};
    assert.deepEqual(normalizeArtworkGroupCoordinates(unchanged),unchanged);
  }
});
