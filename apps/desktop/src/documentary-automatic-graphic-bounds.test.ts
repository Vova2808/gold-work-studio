import test from 'node:test';
import assert from 'node:assert/strict';
import {createDefaultProjectSettings,createDocumentarySettings,type Project} from '@gold-work/shared';
import {documentaryEditErrors} from './documentary-validation.js';

function measuredProject(origin:'automatic'|'manual'):Project {
 const settings=createDefaultProjectSettings();settings.assembly.documentary=createDocumentarySettings();
 return {mediaMode:'stock',settings,scenes:[{id:'scene',order:0,durationSeconds:5,narration:'Original narration',documentary:{
  timing:{durationInFrames:120},effects:[],layout:'full',
  motionGraphic:{kind:'quote',origin,enabled:true,startSeconds:0,durationSeconds:5,title:'Original narration'},
 }}]} as unknown as Project;
}

test('automatic graphics use the existing renderer bounds after measured narration without editing the source',()=>{
 const project=measuredProject('automatic'),before=structuredClone(project);
 assert.deepEqual(documentaryEditErrors(project),[]);
 assert.deepEqual(project,before);
});

test('manual graphic overhang and invalid automatic timing still fail preflight',()=>{
 assert.ok(documentaryEditErrors(measuredProject('manual')).some(error=>error.includes('границы сцены')));
 for(const patch of [{startSeconds:5},{durationSeconds:NaN},{durationSeconds:0}]) {
  const project=measuredProject('automatic');Object.assign(project.scenes[0]!.documentary!.motionGraphic!,patch);
  assert.ok(documentaryEditErrors(project).some(error=>error.includes('границы сцены')));
 }
});
