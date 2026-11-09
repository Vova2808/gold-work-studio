import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {createRequire} from 'node:module';
import {DocumentaryTimeGap} from './DocumentaryTimeGap.js';
import {documentaryTimeGapGeometry,documentaryTimeGapState,documentaryTimeBound,documentaryTimeSector,documentaryTimeDialLabels,documentaryTimePolar} from './documentary-time-gap.js';

test('events reveal in order and the exact interval holds without a long empty opening',()=>{
  for(const frames of [30,90,150,900]){
    const at=(t:number)=>documentaryTimeGapState(Math.round(Math.min(60,frames-1)*t),frames);
    assert.deepEqual(at(.14),{first:1,second:0,interval:0});
    assert.ok(at(.34).second===1&&at(.34).interval>0&&at(.34).interval<1);
    assert.deepEqual(documentaryTimeGapState(Math.min(60,frames-1),frames),{first:1,second:1,interval:1});
    for(let frame=Math.ceil(frames*.75);frame<frames;frame++)assert.deepEqual(documentaryTimeGapState(frame,frames),{first:1,second:1,interval:1});
  }
  for(const frames of [1,2,30,150])for(const frame of [0,frames-1])assert.deepEqual(documentaryTimeGapState(frame,frames,false),{first:1,second:1,interval:1});
});

test('the drawing calibrates subseconds to one second and longer intervals to labelled seconds',()=>{
  for(const portrait of [false,true])for(const amount of [0,.210,500]){
    const g=documentaryTimeGapGeometry(portrait,amount);
    assert.ok(g.label.x>0&&g.label.y>0&&g.label.x+g.label.w<g.width&&g.label.y+g.label.h<g.height);
    if(amount<1){
      assert.equal(g.mode,'fraction');assert.equal(g.maxSeconds,1);assert.equal(g.fraction,amount);
      assert.ok(g.dial.x-g.dial.r-145>0&&g.dial.x+g.dial.r+145<g.width);
      assert.ok(g.dial.y-g.dial.r-110>0&&g.dial.y+g.dial.r+110<g.height);
      assert.ok(portrait?g.dial.y+g.dial.r+110<g.label.y:g.dial.x+g.dial.r+145<g.label.x);
      assert.doesNotMatch(documentaryTimeSector(g.dial,g.fraction),/NaN|Infinity/u);
    }else{
      assert.equal(g.mode,'seconds');assert.ok(g.maxSeconds>amount);
      assert.equal(g.maxSeconds,600);assert.deepEqual(g.ticks,[0,100,200,300,400,500,600]);
      assert.ok(g.label.y+g.label.h<g.axis.y-g.axis.h/2-160);
      assert.ok(g.axis.x>0&&g.axis.x+g.axis.w<g.width&&g.axis.y+310<g.height);
    }
  }
  const small=documentaryTimeGapGeometry(false,.210),large=documentaryTimeGapGeometry(false,5);
  assert.equal(small.fraction*100,21);assert.equal(large.maxSeconds,6);
  assert.deepEqual(large.ticks,[0,1,2,3,4,5,6]);assert.equal(large.fraction,5/6);
});

test('the exact narration survives, inequalities retain their direction, and the calibrated result holds in Motion0',()=>{
  const {renderToStaticMarkup}=createRequire(import.meta.url)('react-dom/server');
  for(const portrait of [false,true])for(const [amount,label] of [[.210,'0.210 seconds'],[5,'more than five seconds']] as const){
    const render=(frame:number,moving=true)=>renderToStaticMarkup(createElement(DocumentaryTimeGap,{amount,label,frame,frames:150,moving,accent:'#efbe45',portrait}));
    const html=render(120);
    assert.equal(html.split(label).length-1,1);
    assert.ok(html.includes('Δt'));
    assert.doesNotMatch(html,/<img|<video|NaN|Infinity/u);
    assert.equal(html,render(149));assert.equal(render(0,false),render(149,false));
    if(amount<1){assert.match(html,/>21%<\/text>/u);assert.match(html,/1 s = 100%/u);assert.doesNotMatch(html,/data-time-span/u);}
    else {assert.match(html,/0–6 s/u);assert.match(html,/&gt;5 s/u);assert.doesNotMatch(html,/data-time-sector/u);}
  }
  assert.equal(documentaryTimeBound('more than five seconds'),'>');
  assert.equal(documentaryTimeBound('less than five seconds'),'<');
  assert.equal(documentaryTimeBound('не более 5 секунд'),'≤');
  assert.equal(documentaryTimeBound('не менее 5 секунд'),'≥');
});

test('quarter-second captions remain outside every tick and inside the frame at export and preview resolutions',()=>{
  const overlaps=(a:{x:number;y:number;w:number;h:number},b:{x:number;y:number;w:number;h:number})=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
  for(const [width,height] of [[1920,1080],[1280,720],[960,540],[854,480],[1080,1920],[720,1280]]){
    const g=documentaryTimeGapGeometry(height!>width!,.210),scale=Math.min(width!/g.width,height!/g.height);
    const captions=documentaryTimeDialLabels(g.dial);
    assert.equal(captions.find(c=>c.value===.25)!.anchor,'start');
    assert.equal(captions.find(c=>c.value===.75)!.anchor,'end');
    for(const caption of captions){
      const b=caption.box;
      assert.ok(b.x>0&&b.y>0&&b.x+b.w<g.width&&b.y+b.h<g.height,'complete caption stays in frame');
      assert.ok(!overlaps(b,g.label),'tick caption does not intrude into the narration label');
      for(let i=0;i<20;i++){
        const a=documentaryTimePolar(g.dial.x,g.dial.y,g.dial.r+12,i/20),end=documentaryTimePolar(g.dial.x,g.dial.y,g.dial.r+(i%5===0?39:25),i/20);
        // Include stroke and an eight-reference-pixel gutter, then scale both
        // rectangles as the SVG is scaled by the export/preview viewport.
        const tick={x:(Math.min(a.x,end.x)-10)*scale,y:(Math.min(a.y,end.y)-10)*scale,w:(Math.abs(a.x-end.x)+20)*scale,h:(Math.abs(a.y-end.y)+20)*scale};
        assert.ok(!overlaps({x:b.x*scale,y:b.y*scale,w:b.w*scale,h:b.h*scale},tick),`tick/caption collision at ${width}×${height}`);
      }
    }
    assert.equal(g.fraction*100,21);
  }
});
