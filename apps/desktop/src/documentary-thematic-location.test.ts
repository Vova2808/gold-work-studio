import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createDefaultProjectSettings,createDocumentarySettings,createVoiceCalibration,type Project} from '@gold-work/shared';
import {prepareDocumentaryScript} from './documentary-plan.js';
import {documentaryAiPlanContext,currentDocumentaryAiSearchPlan} from './documentary-ai-plan-state.js';
import {claimDocumentaryThematicRecovery,documentaryThematicRecoveryBinding,documentaryThematicDiscoveryRequirement,documentaryAutomaticThematicIssue,repairDocumentaryGeographicReserve} from './documentary-automatic-thematic-recovery.js';
import {documentaryGeographicReservePlan,documentaryGeographicReserveIssue} from './documentary-thematic-location.js';
import {planFastDocumentaryScene} from './documentary-fast-plan.js';
import {documentarySavedContextIssue} from './documentary-context-approval.js';
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function fixture(narration='The Suez Canal had opened.',subject='Suez Canal',target='Suez Canal channel with vessels passing; a modern view of the surviving canal illustrating its 1869 opening'){
 const p={id:'geographic-reserve',title:'Canals',topic:'Canals',language:'en',mediaMode:'stock',aspectRatio:'16:9',settings:createDefaultProjectSettings(),videoBrief:{readyScript:narration},scenes:[]} as unknown as Project;
 p.settings.assembly.documentary=createDocumentarySettings();
 const s=prepareDocumentaryScript(p,createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:narration,audioDurationSeconds:3}))[0]!;
 s.documentary!.requirement={text:narration,entities:[subject],identities:[{name:subject,aliases:[]}],years:['1869'],queries:['Suez Canal ships'],detail:target,
  aiSearchPlan:{version:1,inputHash:'',model:'fixture',subject,visualTarget:target,years:['1869'],visualScope:'illustrative',preferredKind:'video',
   imageQueries:[subject],videoQueries:[`${subject} ships`],fallbackVisualTarget:'cargo ship passing through canal waterway',fallbackVideoQueries:['cargo ship canal waterway']}};
 p.scenes=[s];const ai=s.documentary!.requirement.aiSearchPlan!;ai.inputHash=hash({inputHash:hash({version:1,model:ai.model,context:documentaryAiPlanContext(p)}),sceneId:s.id});return {p,s,ai};
}
test('Suez reserve preserves place in queries and the complete visual task, while permitting a modern view',()=>{
 const {p,s,ai}=fixture(),before=structuredClone(s);const claimed=claimDocumentaryThematicRecovery(p,s);
 const projected=documentaryThematicDiscoveryRequirement(p,claimed)!;assert.ok(projected);
 assert.match(projected.detail!,/Suez Canal/);assert.ok(projected.queries.every(q=>q.includes('Suez Canal')));
 const visual=planFastDocumentaryScene(p,claimed,'video');assert.match(visual.visualTarget,/Suez Canal/);assert.match(visual.visualTarget,/modern view/);
 assert.equal(documentaryGeographicReserveIssue(claimed),undefined);assert.equal(claimed.documentary!.requirement.aiSearchPlan!.visualTarget,ai.visualTarget);
 assert.deepEqual(s,before,'Projection never mutates the source scene');
});
test('saved generic approval cannot authorize Panama for a Suez scene or open another generic visual task',()=>{
 const {p,s,ai}=fixture();const binding=documentaryThematicRecoveryBinding(p,s);
 s.documentary!.requirement.footageFallback={version:1,target:ai.fallbackVisualTarget,queries:ai.fallbackVideoQueries,narration:s.narration,originalTarget:ai.visualTarget,kind:'video',reason:'thematic',
  automaticRecovery:{version:1,binding,startedAt:'now',blockedSourceKeys:[]}};
 s.documentary!.verified=true;s.documentary!.visualReview={status:'accepted',confidence:1,reason:'Generic canal accepted',checkedAt:'now',sampleSeconds:[0],quality:''};
 assert.match(documentarySavedContextIssue(p,s)!,/место|географ/);
 assert.equal(documentaryThematicDiscoveryRequirement(p,s),undefined);assert.deepEqual(planFastDocumentaryScene(p,s).queries,[]);
 s.videoPath='preserved-panama.mp4';s.audioPath='preserved-voice.mp3';
 const resumed=repairDocumentaryGeographicReserve(p,s);
 assert.equal(resumed.documentary!.verified,false);assert.equal(resumed.documentary!.visualReview,undefined);
 assert.equal(resumed.videoPath,s.videoPath);assert.equal(resumed.audioPath,s.audioPath);
 assert.ok(documentaryThematicDiscoveryRequirement(p,resumed));assert.ok(planFastDocumentaryScene(p,resumed).queries.length);
 assert.match(planFastDocumentaryScene(p,resumed).visualTarget,/Suez Canal/);
 assert.ok(currentDocumentaryAiSearchPlan(p,resumed));assert.equal(repairDocumentaryGeographicReserve(p,resumed),resumed);
});
test('geography is enforced after a generic fallback replan and survives current-plan and discovery projections',()=>{
 const {p,s,ai}=fixture();
 // Actual saved fallback-cache transition: sandy canal -> generic cargo canal.
 ai.fallbackVisualTarget='Ship moving along an artificial canal with sandy banks';ai.fallbackVideoQueries=['ship sailing canal sandy banks'];
 s.documentary!.requirement.aiSearchPlan={...ai,fallbackVisualTarget:'cargo ship passing through canal waterway',fallbackVideoQueries:['cargo ship canal waterway','ship sailing narrow canal']};
 const claimed=claimDocumentaryThematicRecovery(p,s);const current=currentDocumentaryAiSearchPlan(p,claimed)!;
 assert.ok(current);assert.match(current.fallbackVisualTarget,/Suez Canal/);
 assert.ok(current.fallbackVideoQueries.every(q=>q.includes('Suez Canal')));
 const projected=documentaryThematicDiscoveryRequirement(p,claimed)!;
 assert.equal(projected.detail,current.fallbackVisualTarget);assert.deepEqual(projected.queries,current.fallbackVideoQueries);
 assert.equal(planFastDocumentaryScene(p,claimed).visualTarget,current.fallbackVisualTarget);
});
test('generic navigation and a place mentioned only in surrounding context do not inherit geography',()=>{
 for(const [narration,subject,target] of [['Shipping routes became shorter.','cargo ship','cargo ship at sea'],
  ['Steamships used the Suez Canal shortcut.','steamship','steamship of the type using the Suez Canal shortcut']]){
  const {p,s,ai}=fixture(narration,subject,target);const corrected=documentaryGeographicReservePlan(s,ai);
  assert.equal(corrected,ai);assert.equal(claimDocumentaryThematicRecovery(p,s).documentary!.requirement.footageFallback!.target,ai.fallbackVisualTarget);
 }
});
test('an authored OR is preserved whole rather than imposing one place on every alternative',()=>{
 const target='Suez Canal modern view OR an old map showing the route around Africa';const {p,s,ai}=fixture(undefined,undefined,target);
 const claimed=claimDocumentaryThematicRecovery(p,s);assert.equal(planFastDocumentaryScene(p,claimed).visualTarget,target);
 assert.deepEqual(claimed.documentary!.requirement.footageFallback!.queries,ai.videoQueries);
 assert.equal(documentaryGeographicReserveIssue(claimed),undefined);
});
test('an ambiguous OR without primary video queries stays closed with a geographic explanation',()=>{
 const {p,s,ai}=fixture(undefined,undefined,'Suez Canal OR an old route map');ai.videoQueries=[];
 assert.match(documentaryAutomaticThematicIssue(p,s)!,/географ/);
 assert.equal(claimDocumentaryThematicRecovery(p,s),s);
});
test('saved short03 expanded place identity cannot authorize its accepted generic barge receipt',()=>{
 // Values from short03 primary plan and ca52fae1... vision receipt. No API/media mutation.
 const {p,s,ai}=fixture('The Suez Canal had opened.\n\n','Suez Canal opening, November 1869','Suez Canal inauguration ceremony 1869');
 ai.fallbackVisualTarget='ships transiting a canal waterway';ai.fallbackVideoQueries=['ships canal waterway'];
 const oldBinding=documentaryThematicRecoveryBinding(p,s);
 s.documentary!.requirement.footageFallback={version:1,target:ai.fallbackVisualTarget,queries:ai.fallbackVideoQueries,narration:s.narration,originalTarget:ai.visualTarget,kind:'video',reason:'thematic',
  automaticRecovery:{version:1,binding:oldBinding,startedAt:'2026-11-08T22:28:00Z',blockedSourceKeys:[]}};
 s.documentary!.verified=true;s.documentary!.checksum='54081faa0cebde0943daa073bb263fac4135460faa4381baa8be3556cccda9ad';
 s.documentary!.visualReview={status:'accepted',confidence:0,reason:'The video visibly depicts a cargo ship transiting along a canal waterway, with another vessel visible further down the canal.',
  checkedAt:'2026-11-08T22:28:56.055Z',sampleSeconds:[.047,.7833333333333333,1.5196666666666667],quality:'',
  fastRelevance:{version:1,target:'ships transiting a canal waterway',relevant:true,evidence:'Cargo barge transits a canal.'}};
 assert.match(documentarySavedContextIssue(p,s)!,/географ|место/);
 const resumed=repairDocumentaryGeographicReserve(p,s);assert.equal(resumed.documentary!.verified,false);
 assert.match(planFastDocumentaryScene(p,resumed).visualTarget,/Suez Canal/);
 assert.ok(documentaryThematicDiscoveryRequirement(p,resumed)!.queries.every(q=>q.includes('Suez Canal')));
});
test('expanded place identities keep authored OR alternatives and do not turn another subject context into a location requirement',()=>{
 const {p,s}=fixture('The Suez Canal had opened.','Suez Canal opening, November 1869','Suez Canal OR a diagram showing its route');
 const claimed=claimDocumentaryThematicRecovery(p,s);assert.equal(planFastDocumentaryScene(p,claimed).visualTarget,'Suez Canal OR a diagram showing its route');
 const other=fixture('Steamships gained a shortcut through the Suez Canal.','steamships','Steamship of the type using the Suez Canal shortcut');
 assert.equal(documentaryGeographicReservePlan(other.s,other.ai),other.ai);
});
