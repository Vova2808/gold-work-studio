import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {createRequire} from 'node:module';
import type {DocumentaryExplanation as Explanation} from '@gold-work/shared';
import {DocumentaryExplanation} from './DocumentaryExplanation.js';
import {explanationGeometry,explanationState,explanationExchangePosition,explanationPoint,type ExplanationBox} from './documentary-explanation.js';
const {renderToStaticMarkup}=createRequire(import.meta.url)('react-dom/server') as {renderToStaticMarkup:(element:ReturnType<typeof createElement>)=>string};

const kinds:Explanation['kind'][]=['flow','branch','merge','exchange','cycle','contrast'];
const make=(kind:Explanation['kind'],count:number):Explanation=>({kind,nodes:Array.from({length:count},(_,i)=>({id:`n${i}`,label:['request','change','result','response'][i]!,symbol:(['person','signal','machine','document'] as const)[i]!})),emphasis:'A complete thought'});
const overlaps=(a:ExplanationBox,b:ExplanationBox)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;

test('all supported relations keep objects and complete label boxes inside both formats, including exchange transit',()=>{
  for(const kind of kinds)for(const count of kind==='exchange'?[2]:kind==='branch'||kind==='merge'?[3,4]:[2,3,4]){
    const explanation=make(kind,count);
    for(const [width,height] of [[1920,1080],[1080,1920]] as const){
      const geometry=explanationGeometry(explanation,width,height);
      for(const link of geometry.links)for(let step=0;step<=100;step++){
        const p=explanationPoint(link,step/100),size=54*Math.min(width,height)/1080;
        const transfer={x:p.x-size/2,y:p.y-size/2,w:size,h:size};
        assert.ok(transfer.x>=0&&transfer.x+size<=width&&transfer.y>=0&&transfer.y+size<=height,`${kind} transfer remains inside frame`);
        assert.ok(!geometry.labels.some(label=>overlaps(transfer,label)),`${kind}/${count}/${width}x${height}/${link.from}-${link.to}/step${step}: transfer must not travel through a label`);
      }
      for(let frame=0;frame<180;frame++){
        const state=explanationState(explanation,frame,180),boxes:ExplanationBox[]=[];
        geometry.position.forEach((original,i)=>{
          const p=kind==='exchange'?explanationExchangePosition(original,geometry.position[1-i]!,state.exchange,i,height):original;
          const size=geometry.sizes[i]!,label=geometry.labels[i]!;
          boxes.push({x:p.x-size/2,y:p.y-size/2,w:size,h:size},{...label,x:label.x+p.x-original.x,y:label.y+p.y-original.y});
        });
        const context=`${kind}/${count}/${width}x${height}/frame${frame}`;
        for(const b of boxes)assert.ok(b.x>=0&&b.y>=0&&b.x+b.w<=width+.001&&b.y+b.h<=height+.001,`bounds ${context}: ${JSON.stringify(b)}`);
        for(let a=0;a<boxes.length;a++)for(let b=a+1;b<boxes.length;b++)assert.ok(!overlaps(boxes[a]!,boxes[b]!),`object/label collision ${context}: ${a}/${b}`);
      }
    }
  }
});

test('SSR preserves authored meaning without source photos and settles every relation before the final hold',()=>{
  for(const kind of kinds){
    const explanation=make(kind,kind==='exchange'?2:4);
    for(const [width,height] of [[1920,1080],[1080,1920]] as const){
      const render=(frame:number,moving=true)=>renderToStaticMarkup(createElement(DocumentaryExplanation,{explanation,frame,frames:180,width,height,moving}));
      const settled=render(130);
      assert.equal(settled,render(179),`${kind} final hold`);
      assert.equal(render(0,false),render(179,false),`${kind} Motion0`);
      assert.doesNotMatch(settled,/<img|<video|NaN|Infinity/u);
      for(const node of explanation.nodes)assert.ok(settled.includes(`>${node.label}</div>`));
      if(kind==='exchange')assert.notEqual(render(0),settled,'roles actually move');
      if(kind==='flow'||kind==='branch'||kind==='merge'||kind==='cycle')assert.notEqual(render(0),settled,'relationships reveal over time');
    }
  }
});

test('interrupted flow retains a visible gap at rest; merge sends contributions, not copies of participants',()=>{
  const explanation={...make('flow',2),signal:'interrupted'} as Explanation;
  const render=(item:Explanation,frame:number)=>renderToStaticMarkup(createElement(DocumentaryExplanation,{explanation:item,frame,frames:180,width:1920,height:1080}));
  assert.equal((render(explanation,179).match(/data-explanation-interrupted/g)??[]).length,2);
  const merge=render(make('merge',3),55);
  assert.match(merge,/data-explanation-contribution/u);
  assert.doesNotMatch(merge,/data-explanation-transfer/u);
});

test('destinations and labels are present before arrival; only the message moves and sequence time is already global',()=>{
  for(const kind of ['flow','branch','merge','cycle'] as const){
    const explanation=make(kind,kind==='flow'?2:4),initial=explanationState(explanation,0,180);
    assert.ok(initial.visible.every(opacity=>opacity>=.3),'no empty destination while the transfer is in flight');
    const destination=kind==='merge'?3:1;
    assert.equal(initial.active[destination],0,'destination starts pending');
    assert.equal(explanationState(explanation,179,180).active[destination],1,'destination is active at rest');
    const render=(item:Explanation,frame:number)=>renderToStaticMarkup(createElement(DocumentaryExplanation,{explanation:item,frame,frames:180,width:1920,height:1080}));
    const inFlight=render(explanation,55);
    assert.equal((inFlight.match(/data-explanation-symbol=/gu)??[]).length,explanation.nodes.length,'participants are never duplicated as travelling icons');
    for(const node of explanation.nodes)assert.ok(render(explanation,0).includes(`>${node.label}</div>`),'complete labels are readable from the start');
    assert.equal(render({...explanation,sequence:{id:'whole-thought',offsetFrames:61,durationInFrames:180}},61),render(explanation,61),'renderer must not add sequence offset a second time');
  }
});

function motorcycleFixture(kind:Explanation['kind']='contrast'):Explanation{
  const explanation=make(kind,kind==='branch'||kind==='merge'?3:2);
  explanation.nodes[1]={id:'vehicle',label:'the racing motorcycle',symbol:'motorcycle',objectType:'motorcycle'};
  return explanation;
}

test('the actual motorcycle SVG is a bounded whole two-wheeled object with tank, seat, frame and steering',()=>{
  const markup=renderToStaticMarkup(createElement(DocumentaryExplanation,{explanation:motorcycleFixture(),frame:179,frames:180,width:1920,height:1080}));
  const svg=markup.match(/<svg\b[^>]*data-explanation-symbol="motorcycle"[^>]*>([\s\S]*?)<\/svg>/u)?.[1];
  assert.ok(svg);assert.doesNotMatch(svg,/<rect|<image|<text|<use/u,'shape does not borrow an appliance, image, word or external asset');
  const wheels=svg.match(/<g data-motorcycle-wheels="true"[^>]*>([\s\S]*?)<\/g>/u)?.[1];
  assert.ok(wheels);
  const circles=[...wheels.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/gu)].map(m=>m.slice(1).map(Number));
  assert.equal(circles.length,2);
  const [rear,front]=circles as [number[],number[]];
  assert.ok(rear[0]!<front[0]!&&rear[1]===front[1]&&rear[2]===front[2]);
  assert.ok(front[0]!-rear[0]!>rear[2]!+front[2]!,'two separate full wheels, not appliance feet');
  for(const [cx,cy,r] of circles){
    assert.ok(cx!-r!-2.5>=0&&cx!+r!+2.5<=100&&cy!-r!-2.5>=0&&cy!+r!+2.5<=100,'wheel and stroke stay inside the symbol viewBox');
  }
  for(const part of ['frame','body','tank','seat','fork'])assert.match(svg,new RegExp(`data-motorcycle-${part}="true" d="[^"]+"`,'u'));
  // Check the control hull of every actual path (only M/L/H/V/C/Z are used).
  // It conservatively contains these straight segments and cubic curves.
  for(const path of svg.matchAll(/<path\b[^>]*d="([^"]+)"[^>]*>/gu)){
    const tokens=path[1]!.match(/[MLHVCZ]|-?\d+(?:\.\d+)?/gu)!;let at=0,x=0,y=0;
    while(at<tokens.length){
      const command=tokens[at++]!;if(command==='Z')continue;
      const count=command==='C'?3:1;
      for(let point=0;point<count;point++){
        if(command==='H')x=Number(tokens[at++]);
        else if(command==='V')y=Number(tokens[at++]);
        else {assert.ok(['M','L','C'].includes(command));x=Number(tokens[at++]);y=Number(tokens[at++]);}
        assert.ok(x>=2.5&&x<=97.5&&y>=2.5&&y<=97.5,'path and stroke stay inside symbol viewBox');
      }
    }
  }
});

test('typed motorcycles retain whole-object bounds, relation choreography and final holds in both formats',()=>{
  for(const kind of kinds)for(const [width,height] of [[1920,1080],[1080,1920]] as const){
    const explanation=motorcycleFixture(kind),geometry=explanationGeometry(explanation,width,height);
    const render=(frame:number,moving=true)=>renderToStaticMarkup(createElement(DocumentaryExplanation,{explanation,frame,frames:180,width,height,moving}));
    for(const frame of [0,55,130,179]){
      const markup=render(frame),state=explanationState(explanation,frame,180);
      assert.equal((markup.match(/data-explanation-symbol="motorcycle"/gu)??[]).length,1,'one intact vehicle per participant');
      assert.match(markup,/data-explanation-object-type="motorcycle"/u);
      geometry.position.forEach((original,i)=>{
        const p=kind==='exchange'?explanationExchangePosition(original,geometry.position[1-i]!,state.exchange,i,height):original;
        const size=geometry.sizes[i]!;
        assert.ok(p.x-size/2>=0&&p.y-size/2>=0&&p.x+size/2<=width&&p.y+size/2<=height);
      });
    }
    assert.equal(render(130),render(179),'readable settled hold');
    assert.equal(render(0,false),render(179,false),'Motion0');
    if(kind!=='contrast')assert.notEqual(render(0),render(130),'authored relation still develops');
  }
});

test('renderer rejects an explicitly incompatible or unsupported concrete type and preserves legacy machine',()=>{
  const render=(explanation:Explanation)=>renderToStaticMarkup(createElement(DocumentaryExplanation,{explanation,frame:179,frames:180,width:1920,height:1080}));
  const mismatch=motorcycleFixture();mismatch.nodes[1]!.symbol='machine';
  assert.equal(render(mismatch),'','saved/direct incompatible declarations cannot display the wrong object');
  const unsupported=motorcycleFixture();(unsupported.nodes[1] as {objectType:unknown}).objectType='car';
  assert.equal(render(unsupported),'');
  delete mismatch.nodes[1]!.objectType;
  const legacy=render(mismatch);
  assert.match(legacy,/data-explanation-symbol="machine"/u);
  assert.match(legacy,/<rect x="23" y="43" width="29" height="21"/u);
  assert.doesNotMatch(legacy,/data-motorcycle-/u,'legacy label is never used to infer a new object type');
});
