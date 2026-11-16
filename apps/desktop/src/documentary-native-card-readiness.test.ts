import test from 'node:test';
import assert from 'node:assert/strict';
import {documentaryNativeCardReady,documentarySceneReadiness,documentarySceneReady,type Project,type Scene} from '@gold-work/shared';
import {applyDocumentaryNativeFallback,documentaryNativeFallbackReady} from './documentary-native-fallback.js';

function fixture(){
  const project={mediaMode:'stock',settings:{assembly:{documentary:{version:2}}}} as Project;
  const scene={id:'native-card',order:0,narration:'The original complete narration.',durationSeconds:6,
    documentary:{verified:false,autoError:'Bounded source search exhausted',layout:'full',effects:[],candidates:[],caption:{enabled:false,text:''},
      timing:{sourceKey:'voice',durationInFrames:180,speechSeconds:5.8}}} as unknown as Scene;
  return {project,scene:applyDocumentaryNativeFallback(project,scene)};
}

test('editor and native-card export use the same original text and measured duration',()=>{
  const {project,scene}=fixture();
  assert.equal(documentaryNativeCardReady(scene),true);
  assert.equal(documentarySceneReadiness(scene,undefined,project).state,'placeholder');
  assert.equal(documentaryNativeFallbackReady(project,scene),true);
  const mutations:Array<(s:Scene)=>void>=[
    s=>{s.narration='Changed narration';},
    s=>{s.documentary!.motionGraphic!.title='Changed card text';},
    s=>{s.documentary!.motionGraphic!.quoteMode='phrase';},
    s=>{s.documentary!.motionGraphic!.kind='key-point';},
    s=>{s.documentary!.motionGraphic!.startSeconds=.5;},
    s=>{s.documentary!.motionGraphic!.enabled=false;},
    s=>{s.documentary!.motionGraphic!.origin='manual';},
    s=>{s.documentary!.timing!.durationInFrames=300;},
    s=>{s.durationOverrideSeconds=9;},
    s=>{s.documentary!.motionGraphic!.durationSeconds=Infinity;},
    s=>{s.imagePath='unexpected-photo.jpg';},
    s=>{s.documentary!.nativeFallback!.reason='';},
  ];
  for(const change of mutations){
    const changed=structuredClone(scene);change(changed);
    assert.equal(documentaryNativeCardReady(changed),false,change.toString());
    assert.equal(documentarySceneReady(changed,undefined,project),false,change.toString());
    assert.equal(documentaryNativeFallbackReady(project,changed),false,change.toString());
  }
});

test('long normalized narration remains an accepted paginated placeholder without a character cap',()=>{
  const {project,scene}=fixture();
  scene.narration=Array.from({length:12},()=> 'The full original narration.').join('\n');
  scene.documentary!.verified=false;scene.documentary!.autoError='No source';
  const prepared=applyDocumentaryNativeFallback(project,scene);
  assert.ok(prepared.documentary!.motionGraphic!.title.length>320);
  assert.equal(documentarySceneReadiness(prepared,undefined,project).state,'placeholder');
  assert.equal(documentaryNativeFallbackReady(project,prepared),true);
});
