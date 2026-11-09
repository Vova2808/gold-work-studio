import assert from 'node:assert/strict';
import test from 'node:test';
import {isValidElement,type ReactElement,type ReactNode} from 'react';
import {Img} from 'remotion';
import {DocumentarySingleSource,documentarySingleImageCard} from './DocumentaryExplainer.js';
import type {DocumentaryMotionGraphic} from './documentary-timeline.js';

function elements(node:ReactNode):ReactElement<Record<string,any>>[]{
  if(Array.isArray(node))return node.flatMap(elements);
  if(!isValidElement<Record<string,any>>(node))return [];
  return [node,...elements(node.props.children)];
}

test('single authored card is the complete contained source with a bounded thesis, static Motion0 and final hold',()=>{
  const graphic:DocumentaryMotionGraphic={kind:'explainer',enabled:true,title:'',hideTitle:true,origin:'automatic',boardLayout:'parts',
    preset:'board-cascade',startSeconds:0,durationSeconds:5,cards:[{label:'after the cameras stopped rolling',sceneId:'accepted-neighbour',imagePath:'/accepted.jpg'}]};
  for(const [width,height] of [[1920,1080],[1080,1920]]){
    const render=(frame:number,moving=true)=>DocumentarySingleSource({graphic,frame,frames:150,width:width!,height:height!,moving});
    const nodes=elements(render(120)),images=nodes.filter(node=>node.type===Img),copy=nodes.find(node=>'data-single-source-thesis' in node.props)!;
    assert.equal(images.length,1);assert.match(images[0]!.props.src,/\/accepted\.jpg$/u);
    assert.equal(images[0]!.props.style.objectFit,'contain');
    assert.equal(images[0]!.props.style.width,'100%');assert.equal(images[0]!.props.style.height,'100%');
    assert.equal(copy.props.children,'after the cameras stopped rolling');
    assert.ok(copy.props.style.width<=width!*.84);assert.ok(copy.props.style.height<height!*.34);
    assert.ok(!nodes.some(node=>node.type==='svg'||node.type==='path'));
    assert.deepEqual(render(120),render(149),'final readable hold does not move or fade');
    assert.deepEqual(render(0,false),render(149,false),'Motion0 starts at the settled pose');
  }
  assert.equal(documentarySingleImageCard({...graphic,origin:'manual'}),undefined);
  assert.equal(documentarySingleImageCard({...graphic,cards:[{label:'Missing poster',sceneId:'unresolved'}]}),undefined);
  assert.equal(documentarySingleImageCard({...graphic,cards:[...graphic.cards!,...graphic.cards!]}),undefined);
});
