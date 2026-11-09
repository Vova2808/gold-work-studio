import assert from 'node:assert/strict';
import {test} from 'node:test';
import {documentaryMotionPresetFor, documentaryMotionPresetsFor, type DocumentaryMotionGraphic} from '@gold-work/shared';

const phrase:DocumentaryMotionGraphic={kind:'key-point',enabled:true,title:'Industrial power against a legend.',preset:'type-slam',origin:'automatic',startSeconds:0,durationSeconds:4};

test('saved compatible presets survive JSON roundtrip; incompatible and unknown IDs fall back',()=>{
  assert.equal(documentaryMotionPresetFor(JSON.parse(JSON.stringify(phrase)))?.id,'type-slam');
  assert.equal(documentaryMotionPresetFor({...phrase,kind:'map-locator'}),undefined);
  assert.equal(documentaryMotionPresetFor({...phrase,preset:'future-layout' as never}),undefined);
});
test('preset selection cannot displace measured speech or source-linked compositions',()=>{
  for(const graphic of [
    {...phrase,kind:'quote' as const,quoteMode:'speech' as const},
    {...phrase,reading:{text:phrase.title,words:[]}},
    {...phrase,sequenceId:'joined-sentence'},
    {...phrase,kind:'feature-list' as const,presentation:'panels' as const},
    {...phrase,kind:'explainer' as const,cards:[{label:'Ferrari',sceneId:'verified-scene'}]},
    {...phrase,kind:'chronology' as const,items:['1963','1966']},
  ]) assert.deepEqual(documentaryMotionPresetsFor(graphic),[]);
  assert.ok(documentaryMotionPresetsFor({...phrase,kind:'quote',quoteMode:'phrase'}).length>0);
});
