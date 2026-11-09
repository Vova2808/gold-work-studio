import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {createElement,type ReactNode} from 'react';
import {DocumentaryDiagram} from './DocumentaryDiagram.js';
import type {DocumentaryMotionGraphic} from './documentary-timeline.js';
import {ratioGroupLayout,ratioGroupState} from './documentary-ratio-groups.js';

const {renderToStaticMarkup}=createRequire(import.meta.url)('react-dom/server') as {renderToStaticMarkup:(node:ReactNode)=>string};
const render=(diagram:NonNullable<DocumentaryMotionGraphic['diagram']>)=>renderToStaticMarkup(createElement(DocumentaryDiagram,{
  graphic:{kind:'statistic',enabled:true,title:'',startSeconds:0,durationSeconds:4,showSource:false,diagram},
  frame:70,frames:120,accent:'#f4c430',material:null,moving:false,
}));

test('odd V5 cylinder count has five distinct positions without a fractional row',()=>{
  const html=render({kind:'engine',amount:990,total:5,unit:'V5',label:'990cc V5'});
  const cylinders=[...html.matchAll(/data-cylinder="(\d+)"[^>]*transform="translate\(([\d.]+) ([\d.]+)\)/gu)];
  assert.equal(cylinders.length,5);
  assert.equal(new Set(cylinders.map(m=>`${m[2]},${m[3]}`)).size,5);
  assert.deepEqual(cylinders.map(m=>Number(m[3])),[405,487,569,405,487]);
  assert.ok(html.includes('990cc V5'));
});

test('large literal ratios retain every object and stay inside the drawing area',()=>{
  for(const total of [32,60]){
    const html=render({kind:'ratio',amount:29,total,label:`29 of the previous ${total} Grand Prix races`});
    const objects=[...html.matchAll(/data-filled="(true|false)"[^>]*transform="translate\(([\d.]+) ([\d.]+)\) scale\(([\d.]+)\)/gu)];
    assert.equal(objects.length,total);
    assert.equal(objects.filter(m=>m[1]==='true').length,29);
    for(const [, ,x,y,scale] of objects){
      assert.ok(Number(x)-72*Number(scale)>100&&Number(x)+72*Number(scale)<1820);
      assert.ok(Number(y)-38*Number(scale)>320&&Number(y)+101*Number(scale)<930);
    }
  }
});

test('grouped ratios retain the same units as the aggregate separates, and never cover source faces',()=>{
  const groups=[{amount:11,label:'Rossi',sourceQuote:'Rossi took eleven victories'},
    {amount:3,label:'other Honda riders',sourceQuote:'other Honda riders won too'},
    {amount:2,label:'other',sourceQuote:'14 of 16 races'}];
  for(const portrait of [false,true]){
    const diagram={kind:'ratio' as const,amount:14,total:16,label:'14 of 16 races',groups};
    const draw=(frame:number,moving=true)=>renderToStaticMarkup(createElement(DocumentaryDiagram,{
      graphic:{kind:'statistic',enabled:true,title:'',origin:'automatic',startSeconds:0,durationSeconds:5.4,showSource:true,diagram},
      frame,frames:164,accent:'#b9e76b',material:createElement('div',{'data-source-face':true},'source'),moving,portrait,
    }));
    for(const frame of [0,40,80,118,163]){
      const html=draw(frame);
      assert.equal((html.match(/data-ratio-unit=/gu)??[]).length,16,'one persistent unit per narrated race');
      assert.equal((html.match(/data-filled="true"/gu)??[]).length,14);
      assert.equal((html.match(/data-ratio-group="0"/gu)??[]).length,11);
      assert.equal((html.match(/data-ratio-group="1"/gu)??[]).length,3);
      assert.equal((html.match(/data-ratio-group="2"/gu)??[]).length,2);
      assert.doesNotMatch(html,/data-source-face|NaN|Infinity|<img|<video/u);
    }
    const settled=draw(118);
    assert.equal(settled,draw(163),'last 28% remains a readable composition');
    assert.equal(draw(0,false),draw(163,false),'Motion0 is the final argument');
    assert.ok(settled.includes('14 − 11 = 3')&&settled.includes('16 − 14 = 2'),'derived amounts are shown as subtraction, not attributed as spoken facts');
    assert.notEqual(draw(0),settled,'the units actually repartition');
  }
});

test('ratio group units stay in frame throughout the split and remain distinct in the reading states',()=>{
  for(const amounts of [[11,3,2],[14,2],[0,0,16],[58,1,1],[60,0]] as const)for(const portrait of [false,true]){
    const groups=amounts.map((amount,i)=>({amount,label:`group ${i}`,sourceQuote:'source'})),layout=ratioGroupLayout(groups,portrait);
    for(let frame=0;frame<164;frame++){
      const state=ratioGroupState(frame,164,groups.length,true);
      const boxes=layout.units.map(unit=>{
        const p=state.split[unit.group]!;
        return {x:unit.start.x+(unit.end.x-unit.start.x)*p-unit.size/2,y:unit.start.y+(unit.end.y-unit.start.y)*p-unit.size/2,size:unit.size};
      });
      for(const b of boxes)assert.ok(b.x>=60&&b.y>=300&&b.x+b.size<=layout.width-60&&b.y+b.size<=layout.height-60,`unit bounds ${amounts}/${portrait}/${frame}`);
      // Moving contributions may pass one another, but the reading states
      // must expose every unit without concealment or unequal unit areas.
      if(frame===0||frame>=118)for(let a=0;a<boxes.length;a++)for(let b=a+1;b<boxes.length;b++){
        const x=boxes[a]!,y=boxes[b]!;
        assert.ok(!(x.x<y.x+y.size&&x.x+x.size>y.x&&x.y<y.y+y.size&&x.y+x.size>y.y),`unit collision ${amounts}/${portrait}/${frame}`);
      }
    }
  }
  const invalid=render({kind:'ratio',amount:14,total:16,label:'14 of 16 races',groups:[{amount:15,label:'bad',sourceQuote:'bad'},{amount:2,label:'rest',sourceQuote:'bad'}]});
  assert.doesNotMatch(invalid,/data-ratio-partition/u,'malformed saved groups fall back to the existing literal ratio');
});
