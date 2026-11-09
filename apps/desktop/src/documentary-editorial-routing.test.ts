import test from 'node:test';
import assert from 'node:assert/strict';
import {AnyModelClient} from './anymodel-client.js';
import {motionArtworkSystem} from './documentary-artwork-direction.js';

test('editorial routes are scoped to AnyModel without changing source queries or another provider',async()=>{
  const settings={baseUrl:'https://anymodel.org/v1',textModel:'existing-source-model'};
  const client=new AnyModelClient({publicSettings:async()=>settings} as never);
  assert.equal(await client.documentaryMontageModel(),'ag/claude-sonnet-4-6');
  assert.equal(await client.documentaryMotionModel(),'cc/claude-sonnet-5');
  assert.equal(await client.documentaryConceptModel(),'cc/claude-sonnet-5');
  assert.equal(await client.documentaryQueryModel(),'existing-source-model');
  settings.baseUrl='https://another-provider.example/v1';
  assert.equal(await client.documentaryMontageModel(),'existing-source-model');
  assert.equal(await client.documentaryMotionModel(),'existing-source-model');
  assert.equal(await client.documentaryConceptModel(),'existing-source-model');
});

test('the concise design brief includes its actual output envelope and coordinate contract',()=>{
  assert.match(motionArtworkSystem,/scenes:\[\{sceneId,artwork:\{version:1,motionCoordinates:"absolute"/);
  assert.match(motionArtworkSystem,/canvas:\{width,height\}/);
  assert.match(motionArtworkSystem,/LAYER CONTRACT/);
});
