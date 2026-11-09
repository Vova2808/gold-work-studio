import test from 'node:test';
import assert from 'node:assert/strict';
import {documentaryManualReviewReady,type Scene} from '@gold-work/shared';
import {mergeScenarioDraft,restoreDocumentaryEdit} from './scenario-draft-merge';

test('Undo and draft merge restore pending Pexels material; Redo clears its flag again',()=>{
 const pending={id:'s',order:0,narration:'Racing cars',imagePath:'original.png',audioPath:'voice.wav',documentary:{verified:false,pinned:false,checksum:'original',
  selected:{id:'pexels:1',provider:'pexels',kind:'image',localPath:'original.png'},selectionPlan:{kind:'image',videoPercent:0},
  manualReview:{version:1,status:'pending',provider:'pexels',kind:'image',candidateId:'pexels:1',checksum:'original',mediaPath:'original.png',narration:'Racing cars',reason:'Exact footage unavailable'}}} as Scene;
 const chosen=structuredClone(pending);chosen.imagePath='manual.png';chosen.documentary!.verified=true;chosen.documentary!.pinned=true;
 chosen.documentary!.manualReview=undefined;chosen.documentary!.checksum='manual';chosen.documentary!.selected={...chosen.documentary!.selected!,id:'local:2',provider:'local',localPath:'manual.png'};
 const restored=restoreDocumentaryEdit([pending],[chosen],['s']);
 assert.equal(documentaryManualReviewReady(restored[0]!),true);
 const remote={...chosen,audioPath:'new-voice.wav'};
 const merged=mergeScenarioDraft(restored,[chosen],[remote],['s']);
 assert.equal(documentaryManualReviewReady(merged[0]!),true);assert.equal(merged[0]!.audioPath,'new-voice.wav');
 const redone=restoreDocumentaryEdit([chosen],merged,['s']);
 assert.equal(redone[0]!.documentary!.manualReview,undefined);assert.equal(redone[0]!.documentary!.verified,true);assert.equal(redone[0]!.imagePath,'manual.png');
});
