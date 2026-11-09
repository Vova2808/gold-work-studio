import assert from 'node:assert/strict';
import test from 'node:test';
import type {DocumentaryArtwork,DocumentaryArtworkLayer as Layer} from '@gold-work/shared';
import {prepareArtworkLabels} from './documentary-artwork-labels.js';
const media:Layer={id:'photo',kind:'media',x:0,y:0,w:1000,h:562};
const label:Layer={id:'label',kind:'text',text:'2003',x:620,y:260,w:180,h:40,fill:'#7e8082',keyframes:[{t:0,opacity:0},{t:.4,opacity:1}]};
const artwork=(layers:Layer[])=>({canvas:{width:1000,height:562},layers} as DocumentaryArtwork);
test('a faint photographic caption gets one small stable surface with matching motion',()=>{
  const source=[media,label],result=prepareArtworkLabels(artwork(source),source);
  assert.equal(result.length,3);assert.equal(result[2]!.fill,'#f8f7f2');
  assert.deepEqual(result[1]!.keyframes,label.keyframes);
  assert.equal(result[1]!.x+result[1]!.w/2,label.x+label.w/2);
  assert.deepEqual(prepareArtworkLabels(artwork(result),result),result);
  assert.equal(label.fill,'#7e8082');
});
test('removing an ungrounded caption removes its empty plate but retains shared illustrated objects',()=>{
  const plate:Layer={id:'plate',kind:'rect',x:620,y:260,w:180,h:40,fill:'#16191d'};
  const raw=[media,plate,label];assert.deepEqual(prepareArtworkLabels(artwork(raw),[media,plate]),[media]);
  const symbol:Layer={id:'symbol',kind:'ellipse',x:630,y:270,w:10,h:10};
  assert.ok(prepareArtworkLabels(artwork([...raw,symbol]),[media,plate,symbol]).some(layer=>layer.id==='plate'));
});

test('a narrow numeric caption grows together with its existing plate; a slightly short plate does not duplicate',()=>{
  const number:Layer={...label,x:339,y:404,w:122,h:40,text:'0.210 seconds',fontSize:48};
  const plate:Layer={id:'plate',kind:'rect',x:339,y:404,w:122,h:40,fill:'#202020'};
  const result=prepareArtworkLabels(artwork([media,plate,number]),[media,plate,number]);
  assert.equal(result.length,3);assert.ok(result[2]!.w>122);assert.equal(result[1]!.w,result[2]!.w);
  const shortPlate:Layer={...plate,x:610,y:250,w:200,h:47};
  const fixed=prepareArtworkLabels(artwork([media,shortPlate,label]),[media,shortPlate,label]);
  assert.equal(fixed.length,3);assert.ok(fixed[1]!.y+fixed[1]!.h>=label.y+label.h);
  assert.deepEqual(prepareArtworkLabels(artwork(result),result),result);
});
