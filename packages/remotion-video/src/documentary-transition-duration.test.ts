import assert from 'node:assert/strict';
import test from 'node:test';
import {buildDocumentaryTimeline, type DocumentaryProjectInput} from './documentary-timeline.js';

test('a dissolve completes within the next included short shot without moving narration',()=>{
  const project:DocumentaryProjectInput={aspectRatio:'16:9',settings:{voice:{enabled:true},assembly:{kenBurns:false}},scenes:[
    {id:'short',order:2,durationSeconds:.2,transition:'none'},
    {id:'excluded',order:1,durationSeconds:.033,includeInAssembly:false},
    {id:'long',order:0,durationSeconds:3,transition:'mix',transitionDurationSeconds:.5},
  ]};
  const original=JSON.stringify(project),timeline=buildDocumentaryTimeline(project);
  assert.deepEqual(timeline.scenes.map(s=>[s.id,s.fromFrame,s.durationInFrames]),[['long',0,90],['short',90,6]]);
  assert.ok(timeline.scenes[0]!.transitionFrames<6,'incoming shot must reach full opacity before it ends');
  assert.equal(timeline.durationInFrames,96);
  assert.equal(JSON.stringify(project),original);
});
