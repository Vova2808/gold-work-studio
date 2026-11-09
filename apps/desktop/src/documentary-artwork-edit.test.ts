import test from 'node:test';
import assert from 'node:assert/strict';
import type {DocumentaryArtwork, Scene, Project} from '@gold-work/shared';
// @ts-expect-error Exercise current source rather than a historical JS neighbour.
import {updateArtworkLayer, updateSceneArtwork} from '../../renderer/src/documentary-artwork-edit.ts';
// @ts-expect-error Exercise current source rather than a historical JS neighbour.
import {restoreDocumentaryEdit, mergeScenarioDraft} from '../../renderer/src/scenario-draft-merge.ts';
import {buildDocumentaryTimeline} from '@gold-work/remotion-video';

const art:DocumentaryArtwork={version:1,intent:'Preserve animation and independent objects',layout:'full',canvas:{width:1000,height:600},
  palette:{background:'#eeeeee',ink:'#222222',accent:'#dd4433',secondary:'#336677'},startSeconds:0,durationSeconds:6,
  layers:[{id:'object',kind:'path',x:100,y:100,w:200,h:200,path:'M0 0L200 200',keyframes:[{t:0,x:0,draw:0,ease:'linear'},{t:1,x:60,rotation:360,draw:1}],repeat:2},
    {id:'peer',kind:'text',x:600,y:100,w:300,h:100,text:'Keep exactly',fontSize:32}]};
function scene(id:string,order:number,title='Shared artwork'):Scene {
  return {id,order,title,narration:`Script ${id}`,durationSeconds:3,audioPath:`${id}.wav`,trimStartSeconds:.5,trimEndSeconds:4,
    narrationVolume:65,sourceVolume:0,transition:'mix',transitionDurationSeconds:.5,documentary:{layout:'full',effects:[],texts:[],
      caption:{enabled:false,text:'Exact caption'},motionGraphic:{enabled:true,kind:'explainer',title,origin:'automatic',sequenceId:'span',artworkSpan:{endSceneId:'b'},
        startSeconds:0,durationSeconds:3,artwork:structuredClone(art),reading:{text:'Keep reading',words:[]},cutoutPath:'keep.png'}}} as unknown as Scene;
}
test('single object edit retains exact geometry/keys/peers and updates only its contiguous shared span',()=>{
  const scenes=[scene('a',0),scene('b',1),scene('other',2,'Different composition')],before=JSON.stringify(scenes);
  const edited=updateArtworkLayer(scenes[1]!.documentary!.motionGraphic!.artwork!,'object',{editTransform:{x:50,y:-20,scale:1.25,rotation:15}});
  const next=updateSceneArtwork(scenes,'b',edited);
  assert.equal(next[2],scenes[2]);assert.equal(edited.layers[1],scenes[1]!.documentary!.motionGraphic!.artwork!.layers[1]);
  const {editTransform,...original}=edited.layers[0]!;
  assert.deepEqual(original,art.layers[0]);assert.deepEqual(editTransform,{x:50,y:-20,scale:1.25,rotation:15});
  for(let i=0;i<2;i++) {
    const g=next[i]!.documentary!.motionGraphic!,old=scenes[i]!.documentary!.motionGraphic!;
    assert.equal(g.artwork,edited);assert.equal(g.origin,'manual');assert.equal(g.sequenceId,old.sequenceId);
    assert.deepEqual({...g,artwork:old.artwork,origin:old.origin},old);
    assert.deepEqual({...next[i],documentary:scenes[i]!.documentary},scenes[i]);
  }
  assert.equal(JSON.stringify(scenes),before);
  const project={aspectRatio:'16:9',settings:{voice:{enabled:true},assembly:{kenBurns:false,documentary:{autoMotionGraphics:true}}},scenes:next} as Project;
  const timeline=buildDocumentaryTimeline(project);
  assert.equal(timeline.scenes[0]!.documentary!.motionGraphic!.sequenceDurationFrames,180);
  assert.equal(timeline.scenes[1]!.documentary!.motionGraphic!.sequenceOffsetFrames,90);
  assert.equal(timeline.scenes[2]!.documentary!.motionGraphic!.sequenceDurationFrames,undefined);
  assert.deepEqual(timeline.scenes[0]!.documentary!.motionGraphic!.artwork,edited);
});

test('object edits survive a fresh voice result, undo/redo and serialized reopen without rolling back the voice',()=>{
  const scenes=[scene('a',0),scene('b',1)];
  const edited=updateArtworkLayer(art,'peer',{text:'Edited label',fill:'#123456',fontSize:40});
  const next=updateSceneArtwork(scenes,'a',edited),fresh=scenes.map(s=>({...s,audioPath:'fresh-voice.wav'}));
  const merged=mergeScenarioDraft(next,scenes,fresh);
  assert.equal(merged[0]!.audioPath,'fresh-voice.wav');assert.deepEqual(merged[1]!.documentary!.motionGraphic!.artwork,edited);
  const undone=restoreDocumentaryEdit(scenes,merged),redone=restoreDocumentaryEdit(next,undone);
  assert.deepEqual(undone[1]!.documentary!.motionGraphic!.artwork,art);
  assert.equal(redone[0]!.audioPath,'fresh-voice.wav');assert.deepEqual(JSON.parse(JSON.stringify(redone))[1].documentary.motionGraphic.artwork,edited);
  assert.deepEqual(edited.layers[0],art.layers[0]);assert.equal(edited.layers[1]!.text,'Edited label');
});
