import test from 'node:test';
import assert from 'node:assert/strict';
import type {Scene} from '@gold-work/shared';
// @ts-expect-error tsx must test current TS, not the historical co-located JS artifact.
import {mergeScenarioDraft,restoreDocumentaryEdit} from '../../renderer/src/scenario-draft-merge.ts';
test('template trim and graphic edits survive undo and background refresh without rolling back paid audio',()=>{
  const before={id:'scene',order:0,audioPath:'old.wav',documentary:{template:'full',motionGraphic:{enabled:true},templateOrigin:'automatic'}} as Scene;
  const edited={...before,documentary:{...before.documentary!,template:'editorial-iris' as const,templateOrigin:'manual' as const,templateTiming:{startSeconds:.4,durationSeconds:2.4},transitionStyle:'blur' as const,motionGraphic:{...before.documentary!.motionGraphic!,enabled:false}}};
  const incoming={...before,audioPath:'new-paid.wav'};
  const merged=mergeScenarioDraft([edited],[before],[incoming])[0]!;
  assert.equal(merged.audioPath,'new-paid.wav');assert.deepEqual(merged.documentary,edited.documentary);
  const deleted={...merged,documentary:{...merged.documentary!,template:'full' as const,templateTiming:undefined}};
  const restored=restoreDocumentaryEdit([edited],[deleted])[0]!;
  assert.equal(restored.audioPath,'new-paid.wav');assert.deepEqual(restored.documentary!.templateTiming,{startSeconds:.4,durationSeconds:2.4});
  assert.equal(restored.documentary!.template,'editorial-iris');assert.equal(restored.documentary!.transitionStyle,'blur');assert.equal(restored.documentary!.motionGraphic!.enabled,false);
});
