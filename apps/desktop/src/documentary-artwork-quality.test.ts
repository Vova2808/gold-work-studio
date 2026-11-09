import assert from 'node:assert/strict';
import test from 'node:test';
import type {DocumentaryArtwork, DocumentaryArtworkLayer as Layer} from '@gold-work/shared';
import {assessArtworkReplacement} from './documentary-artwork-quality.js';

const photo: Layer = {id:'source',kind:'media',x:0,y:0,w:1000,h:562};
const label: Layer = {id:'caption',kind:'text',x:620,y:200,w:180,h:50,text:'1 podium',fontSize:44};
const line: Layer = {id:'rule',kind:'path',x:0,y:0,w:1000,h:562,path:'M950 80 L600 380',keyframes:[{t:0,draw:0},{t:.4,draw:1}]};
const artwork = (layers: Layer[]): DocumentaryArtwork => ({version:1,intent:'',layout:'full',canvas:{width:1000,height:562},
  palette:{background:'#eeeeee',ink:'#111111',accent:'#ff0000',secondary:'#555555'},startSeconds:0,durationSeconds:5,layers});

test('actual failure shape cannot replace native composition through layer count, camera or storyboard claims', () => {
  const value = artwork([photo,label,line,...Array.from({length:13},(_,i): Layer =>
    ({id:`plate-${i}`,kind:'rect',x:611,y:196,w:198,h:58,fill:'#111111'}))]);
  value.direction = {concept:'A cinematic composition',alternatives:[],beats:[{at:.4,action:'Reveal evidence'}]};
  value.camera = {keyframes:[{t:0,x:500,y:281,scale:1},{t:1,x:500,y:281,scale:1.18}]};
  const before = JSON.stringify(value);
  assert.deepEqual(assessArtworkReplacement(value), {allowReplacement:false,reason:'single-source-annotation'});
  assert.equal(JSON.stringify(value),before);
});

test('moving caption group, arrow and a large declared font in a small box remain annotations', () => {
  const group: Layer = {id:'moving',kind:'group',x:0,y:0,w:1000,h:562,keyframes:[{t:0,x:0},{t:1,x:400}]};
  assert.equal(assessArtworkReplacement(artwork([photo,group,{...label,parentId:'moving',fontSize:160},
    {...line,path:'M0 10 L90 10 L85 5 M90 10 L85 15'}])).allowReplacement,false);
});

test('the guard preserves a standalone diagram and a photographic composition with an independent diagram', () => {
  const diagram: Layer = {id:'diagram',kind:'ellipse',x:60,y:181,w:200,h:200,fill:'none',stroke:'#111111'};
  assert.equal(assessArtworkReplacement(artwork([photo,label,diagram])).allowReplacement,true);
  assert.equal(assessArtworkReplacement(artwork([label,line,diagram])).allowReplacement,true);
});

test('enlarging the caption does not promote it to an explanation; independent geometry survives', () => {
  assert.equal(assessArtworkReplacement(artwork([photo,{...label,x:100,y:200,w:800,h:140,fontSize:110}])).allowReplacement,false);
  const bar: Layer = {id:'bar',kind:'rect',x:80,y:320,w:300,h:100,fill:'#ff0000'};
  assert.equal(assessArtworkReplacement(artwork([photo,label,bar])).allowReplacement,true);
  assert.equal(assessArtworkReplacement(artwork([photo,label,{...line,path:'M0 0 L200 0 L100 180 Z'}])).allowReplacement,true);
});

test('a standalone caption board with animated rules has no illustrated subject', () => {
  const board=artwork([label,line,
    {id:'plate',kind:'rect',x:610,y:190,w:210,h:70,fill:'#111111'},
    {id:'axis',kind:'path',x:50,y:360,w:850,h:3,path:'M0 1 L850 1',keyframes:[{t:0,draw:0},{t:1,draw:1}]}]);
  assert.deepEqual(assessArtworkReplacement(board),{allowReplacement:false,reason:'no-illustrated-subject'});
  board.linkedMechanism={kind:'slider-crank',centerX:500,centerY:410,crankRadius:60,rodLength:160,pistonWidth:120,pistonHeight:60};
  assert.equal(assessArtworkReplacement(board).allowReplacement,true,'the procedural subject renders outside layers');
});

test('a second slightly changed crop does not promote a photograph board; a readable detail reveal can',()=>{
  const whole:Layer={...photo,x:230,y:88,w:540,h:386,sourceWindow:{x:0,y:0,w:.936,h:1},
    keyframes:[{t:0,x:0},{t:.28,x:0},{t:.52,x:170,opacity:.72},{t:1,x:170,opacity:.72}]};
  const crop:Layer={...photo,id:'crop',x:60,y:40,w:274,h:440,sourceWindow:{x:.04,y:.02,w:.3,h:.72},
    keyframes:[{t:0,x:190,opacity:0},{t:.32,x:190,opacity:0},{t:.56,x:0,opacity:1},{t:1,x:0,opacity:1}]};
  const duplicateBoard=artwork([whole,crop,label]);
  assert.equal(assessArtworkReplacement(duplicateBoard).allowReplacement,false);
  const subject:Layer={...photo,x:280,y:34,w:441,h:494,sourceWindow:{x:.15,y:.14,w:.8,h:.6},
    keyframes:[{t:0,x:0},{t:.45,x:-220},{t:1,x:-220}]};
  const detail:Layer={...photo,id:'detail',x:560,y:34,w:300,h:300,sourceWindow:{x:.54,y:.46,w:.24,h:.16},
    keyframes:[{t:0,opacity:0},{t:.5,opacity:0},{t:.65,opacity:1},{t:1,opacity:1}]};
  assert.equal(assessArtworkReplacement(artwork([subject,detail,label])).allowReplacement,true,
    'a staged magnified detail can remain alongside its context; panels are not forbidden');
  detail.keyframes=undefined;
  assert.equal(assessArtworkReplacement(artwork([subject,detail,label])).allowReplacement,false,
    'static details and moving the whole source do not establish a reveal');
});

test('a distinct source takes over focus; two copies and camera drift do not',()=>{
  const first:Layer={...photo,sourceSceneId:'one',keyframes:[{t:0,opacity:1},{t:.6,opacity:0},{t:1,opacity:0}]};
  const second:Layer={...photo,id:'second',sourceSceneId:'two',keyframes:[{t:0,opacity:0},{t:.25,opacity:0},{t:.6,opacity:1},{t:1,opacity:1}]};
  const value=artwork([first,second,label]);assert.equal(assessArtworkReplacement(value).allowReplacement,true);
  second.sourceSceneId='one';assert.equal(assessArtworkReplacement(value).allowReplacement,false);
  const single=artwork([{...photo,keyframes:[{t:0,scale:1},{t:.76,scale:1.18},{t:1,scale:1.18}]},label]);
  assert.equal(assessArtworkReplacement(single).allowReplacement,false,'pan/zoom alone cannot prove new content');
});
