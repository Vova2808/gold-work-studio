import test from 'node:test';
import assert from 'node:assert/strict';
import type {DocumentaryArtwork,DocumentaryEffect,Project} from '@gold-work/shared';
import {documentaryDirectedTemplate,documentaryPauseAlignedLengths} from './documentary-montage-direction.js';
import {documentaryArtworkMediaIssue,documentaryArtworkSkipReason} from './documentary-artwork-application.js';
import {documentaryEffectSummary} from './documentary-effects.js';
import {enrichSemanticMontage} from './documentary-semantic-montage.js';
import {buildDocumentaryTimeline} from '../../../packages/remotion-video/src/documentary-timeline.js';

const fixture=()=>({id:'montage',mediaMode:'stock',aspectRatio:'16:9',language:'en',settings:{voice:{enabled:true},music:{enabled:false},assembly:{kenBurns:true,documentary:{version:2,autoEffects:true,autoTransitions:true,autoMotionGraphics:true,montage:{version:1,style:'editorial',intensity:'rich',hookSeconds:10}}}},
  scenes:[{id:'source',order:0,narration:'A measured detail of the selected object.',durationSeconds:6,imagePath:'selected.jpg',documentary:{verified:true,layout:'full',effects:[],caption:{enabled:false,text:''},selected:{id:'source-photo',kind:'image',width:1920,height:1080},requirement:{text:'A measured detail of the selected object.',accent:'none'},semanticMontage:{sceneId:'source',subject:'object',beat:'explain',treatment:'footage',cutawaySceneIds:[]}}}]}) as unknown as Project;
const photograph=():DocumentaryArtwork=>({version:1,intent:'A selected detail becomes readable',layout:'full',canvas:{width:1000,height:600},palette:{background:'#10161c',ink:'#ffffff',accent:'#88bbdd',secondary:'#8899aa'},startSeconds:0,durationSeconds:6,
  layers:[{id:'whole',kind:'media',x:0,y:0,w:1000,h:600,sourceSceneId:'source',keyframes:[{t:0,opacity:1},{t:.6,opacity:0}]},
    {id:'detail',kind:'media',x:0,y:0,w:1000,h:600,sourceSceneId:'source',sourceWindow:{x:.2,y:.2,w:.3,h:.3},keyframes:[{t:0,opacity:0},{t:.6,opacity:1}]},
    {id:'label',kind:'text',x:40,y:520,w:800,h:50,text:'Selected detail'}]});

test('a usable photo artwork survives automatic montage and the render timeline',()=>{
  const p=fixture(),artwork=photograph();p.scenes[0]!.documentary!.semanticMontage!.artwork=artwork;
  assert.equal(documentaryArtworkMediaIssue(p,'source',artwork),undefined);
  const scenes=enrichSemanticMontage(p);
  assert.equal(scenes[0]!.documentary!.motionGraphic?.artwork,artwork);
  assert.deepEqual(buildDocumentaryTimeline({...p,scenes}).scenes[0]!.documentary!.motionGraphic?.artwork,artwork);
  const unavailable=photograph();unavailable.layers[1]!.sourceSceneId='missing';
  assert.equal(documentaryArtworkSkipReason(p,'source',unavailable).code,'unavailable-photo-source');
  p.scenes[0]!.documentary!.pinned=true;
  assert.equal(documentaryArtworkSkipReason(p,'source',artwork).code,'authored-presentation');
});

test('layout follows meaning and geometry regardless of scene order',()=>{
  const s=fixture().scenes[0]!;
  assert.equal(documentaryDirectedTemplate(s),'paper-grid');
  assert.equal(documentaryDirectedTemplate({...s,order:55}),'paper-grid');
  s.documentary!.semanticMontage!.beat='turn';assert.equal(documentaryDirectedTemplate(s),'push');
  s.documentary!.selected!.width=4000;s.documentary!.selected!.height=700;
  assert.equal(documentaryDirectedTemplate(s),'contain');
});

test('measured pauses move an edit without shortening either speech or source capacity',()=>{
  const s=fixture().scenes[0]!;s.documentary!.timing={sourceKey:'current',durationInFrames:180,speechSeconds:6};
  s.documentary!.motionGraphic={kind:'quote',title:'A real pause',enabled:true,startSeconds:0,durationSeconds:6,
    reading:{sourceKey:'current',text:'A real pause',words:[{text:'A',startSeconds:0,endSeconds:2.1},{text:'pause',startSeconds:2.7,endSeconds:5.8}]}};
  assert.deepEqual(documentaryPauseAlignedLengths(s,[90,90],[180,180],42),[72,108]);
  assert.deepEqual(documentaryPauseAlignedLengths(s,[90,90],[180,100],42),[90,90]);
  s.documentary!.motionGraphic.reading!.sourceKey='stale';
  assert.deepEqual(documentaryPauseAlignedLengths(s,[90,90],[180,180],42),[90,90]);
});

test('effects summary distinguishes an empty eligible library and the actual automatic sounds',()=>{
  const p=fixture();assert.equal(documentaryEffectSummary(p,[]).emptyLibrary,true);
  p.scenes[0]!.documentary!.effects=[{enabled:true,origin:'automatic',kind:'audio'} as DocumentaryEffect];
  assert.equal(documentaryEffectSummary(p,[]).sounds,1);
});
