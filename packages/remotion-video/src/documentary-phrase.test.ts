import assert from 'node:assert/strict';
import test from 'node:test';
import {documentaryCompactPhrase} from './DocumentaryPhrase.js';
import type {DocumentaryMotionGraphic} from './documentary-timeline.js';

test('saved short automatic defaults get compact phrases without replacing authored variants',()=>{
  const graphic:DocumentaryMotionGraphic={kind:'key-point',enabled:true,title:'hand-built sports cars, and prestige',origin:'automatic',startSeconds:0,durationSeconds:3};
  for(const title of [graphic.title,'Low roof. Wide stance.','win']){
    assert.equal(documentaryCompactPhrase({...graphic,title},true),true);
  }
  assert.equal(documentaryCompactPhrase(graphic,false),false,'manual or pinned scene does not permit automatic restyling');
  for(const origin of ['manual',undefined] as const)assert.equal(documentaryCompactPhrase({...graphic,origin},true),false);
  assert.equal(documentaryCompactPhrase({...graphic,variant:'clean'},true),true);
  assert.equal(documentaryCompactPhrase({...graphic,variant:'clean'},false),false);
  for(const variant of ['collage','marker','technical','poster','date','magnifier'] as const){
    assert.equal(documentaryCompactPhrase({...graphic,variant},true),false);
  }
  for(const title of ['', 'one two three four five six seven eight nine','Длинный'.repeat(15)]){
    assert.equal(documentaryCompactPhrase({...graphic,title},true),false);
  }
  for(const kind of ['quote','chapter-number','statistic'] as const)assert.equal(documentaryCompactPhrase({...graphic,kind},true),false);
  assert.equal(graphic.title,'hand-built sports cars, and prestige');
  assert.equal(graphic.durationSeconds,3);assert.equal(graphic.variant,undefined);
});
