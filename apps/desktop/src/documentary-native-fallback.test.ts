import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {createVoiceCalibration} from '@gold-work/shared';
import {prepareDocumentaryScript} from './documentary-plan.js';
import {applyDocumentaryNativeFallback,documentaryNativeFallbackReady} from './documentary-native-fallback.js';
import {documentarySavedContextIssue} from './documentary-context-approval.js';
import {missingAssemblyInputs} from './assembly-readiness.js';

test('source outage becomes a complete narration card while retaining rejected media and paid voice',async()=>{
 const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
 const project=await projects.create({title:'Rossi',topic:'Rossi',mediaMode:'stock',mode:'standard',language:'English',aspectRatio:'16:9'});
 const text='Fortunately, Yamaha had already brought in Masao Furusawa to lead that work.';
 project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:text};
 project.scenes=prepareDocumentaryScript(project,createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:text,audioDurationSeconds:5})).slice(0,1);
 const scene=project.scenes[0]!;scene.narration=text;scene.audioPath='paid-voice.wav';scene.imagePath='rejected-photo.jpg';
 scene.documentary!.autoError='Source download HTTP 429';scene.documentary!.visualReview={status:'rejected',confidence:1,reason:'Wrong person',checkedAt:'saved',sampleSeconds:[],quality:'saved'};
 const prepared=applyDocumentaryNativeFallback(project,scene);project.scenes=[prepared];
 assert.equal(prepared.audioPath,scene.audioPath);assert.equal(prepared.narration,text);
 assert.equal(prepared.imagePath,undefined);assert.equal(prepared.documentary!.visualReview,undefined);
 assert.deepEqual(prepared.documentary!.nativeFallback!.previousMaterial!.visualReview,scene.documentary!.visualReview);
 assert.equal(prepared.documentary!.nativeFallback!.previousMaterial!.imagePath,scene.imagePath);
 assert.equal(documentaryNativeFallbackReady(project,prepared),true);
 assert.equal(documentarySavedContextIssue(project,prepared),undefined);
 const missing=missingAssemblyInputs(project);
 assert.deepEqual(missing,[],'A completed narration card is renderable; the configured video share is not a mandatory minimum');
 assert.equal(documentaryNativeFallbackReady(project,{...prepared,narration:'Changed speech'}),false);
 assert.equal(documentaryNativeFallbackReady(project,{...prepared,imagePath:'unreviewed.jpg'}),false);
 const resized=structuredClone(prepared);resized.documentary!.motionGraphic!.durationSeconds+=1;
 assert.equal(documentaryNativeFallbackReady(project,resized),false);
 for(const patch of [{pinned:true},{verified:true},{templateOrigin:'manual' as const}]){
  const authored={...scene,documentary:{...scene.documentary!,...patch}};
  assert.equal(applyDocumentaryNativeFallback(project,authored),authored);
 }
});
