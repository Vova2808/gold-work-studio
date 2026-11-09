import test from 'node:test';
import assert from 'node:assert/strict';
import type {Project} from '@gold-work/shared';
import {enrichSemanticMontage,validateMontageDirections} from './documentary-semantic-montage.js';
import {buildDocumentaryTimeline} from '../../../packages/remotion-video/src/documentary-timeline.js';

test('grounded contribution groups survive AI validation into the exported timeline',()=>{
  const narration='The plant completed 15 of 20 units. Team A completed eleven units; the remaining units came from Team B.';
  const p={id:'ratio-integration',mediaMode:'stock',aspectRatio:'16:9',language:'en',settings:{voice:{enabled:false},music:{enabled:false},assembly:{fps:30,kenBurns:true,
    documentary:{version:2,autoMotionGraphics:true,montage:{version:1,style:'editorial',intensity:'rich',musicPolicy:'preserve'}}}},
    scenes:[{id:'s',order:0,narration,durationSeconds:6,imagePath:'plant.jpg',documentary:{verified:true,checksum:'plant',layout:'full',effects:[],caption:{enabled:false,text:''},
      timing:{durationInFrames:180},selected:{id:'plant',kind:'image',width:1920,height:1080},requirement:{text:narration,identities:[],years:[]}}}]} as unknown as Project;
  const ratioGroups=[{amount:11,label:'Team A',sourceQuote:'Team A completed eleven units'},
    {amount:4,label:'Team B',sourceQuote:'the remaining units came from Team B'},
    {amount:5,label:'units',sourceQuote:'15 of 20 units'}];
  const response={scenes:[{sceneId:'s',subject:'The plant',beat:'evidence',treatment:'statistic',cutawaySceneIds:[],composition:{kind:'statistic',title:'The plant',value:'15 of 20 units',ratioGroups}}]};
  const [direction]=validateMontageDirections(response,p.scenes,p.scenes,p);
  assert.deepEqual(direction!.composition!.ratioGroups,ratioGroups);
  p.scenes[0]!.documentary!.semanticMontage=direction;
  p.scenes=enrichSemanticMontage(p);
  const graphic=buildDocumentaryTimeline(p).scenes[0]!.documentary!.motionGraphic!;
  assert.deepEqual(graphic.diagram!.groups,ratioGroups);
  assert.equal(graphic.showSource,false);
  response.scenes[0]!.composition.ratioGroups[1]!.amount=7;
  assert.equal(validateMontageDirections(response,p.scenes,p.scenes,p)[0]!.composition!.ratioGroups,undefined,'inconsistent partition is not silently displayed');
});
