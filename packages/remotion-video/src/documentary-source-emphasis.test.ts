import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createElement as h} from 'react';
import {DocumentarySourceEmphasis} from './DocumentarySourceEmphasis.js';
import type {DocumentaryMotionGraphic} from './documentary-timeline.js';
const {renderToStaticMarkup}=createRequire(import.meta.url)('react-dom/server');
const graphic:DocumentaryMotionGraphic={kind:'chronology',enabled:true,title:'',value:'November 2003',origin:'automatic',preset:'source-emphasis',startSeconds:0,durationSeconds:4};
const render=(g=graphic,frame=45,motionEnabled=true)=>renderToStaticMarkup(h(DocumentarySourceEmphasis,{graphic:g,frame,frames:120,
  material:h('div',{'data-original':true},'original'),accent:'#f0cf42',width:1920,height:1080,motionEnabled}));

test('date and phrase accents darken a single intact source and preserve the literal copy',()=>{
  const date=render();assert.equal((date.match(/data-original/g)||[]).length,1);
  assert.match(date,/2003/);assert.match(date,/November/);assert.match(date,/radial-gradient/);
  assert.doesNotMatch(date,/clip-path|data-tv-controls/);
  const phrase=render({...graphic,kind:'key-point',title:'Only one factory',value:undefined,highlight:'one factory'});
  assert.equal(phrase.replace(/<[^>]*>/g,''),'originalOnly one factory');assert.match(phrase,/scaleX\(1\)/);
  assert.notEqual(render(graphic,0),render(graphic,45));
  assert.equal(render(graphic,0,false),render(graphic,119,false));
  assert.doesNotMatch(render({...graphic,showSource:false}),/data-original/);
});
