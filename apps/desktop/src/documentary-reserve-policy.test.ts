import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createDefaultProjectSettings,createDocumentarySettings,createVoiceCalibration,type Project} from '@gold-work/shared';
import {prepareDocumentaryScript} from './documentary-plan.js';
import {documentaryAiPlanContext} from './documentary-ai-plan-state.js';
import {claimDocumentaryThematicRecovery,documentaryAutomaticThematicIssue,documentaryThematicDiscoveryRequirement,documentaryThematicRecoveryBinding} from './documentary-automatic-thematic-recovery.js';
import {documentaryFootageRecoveryScenes,documentaryPhotoRecoveryScenes,prepareDocumentaryFootageRecovery,prepareDocumentaryPhotoRecovery} from './documentary-footage-recovery.js';
import {applyDocumentaryAutomaticNativeFallback} from './documentary-automatic-native-recovery.js';
import {applyDocumentaryNativeFallback} from './documentary-native-fallback.js';
import {currentDocumentaryFootageFallback,planFastDocumentaryScene} from './documentary-fast-plan.js';
import {documentarySavedContextIssue} from './documentary-context-approval.js';
import {documentaryThematicRequirement} from './documentary-thematic.js';
import {documentaryIllustrationFallback} from './documentary-illustration-fallback.js';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fixture(policy:'thematic'|'primary-only'){
 const narration='How could a sailing ship compete when her rivals could travel thousands of miles less?\n\n';
 const project={id:'reserve-policy',title:'Cutty Sark',topic:'Sea routes',language:'en',mediaMode:'stock',aspectRatio:'16:9',
  settings:createDefaultProjectSettings(),videoBrief:{readyScript:narration},scenes:[]} as unknown as Project;
 project.settings.assembly.documentary=createDocumentarySettings();project.settings.stockVideoPercent=60;
 const scene=prepareDocumentaryScript(project,createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:narration,audioDurationSeconds:4}))[0]!;
 scene.documentary!.requirement={text:scene.narration,entities:['sea routes'],identities:[],years:[],queries:['Suez Canal vs Cape of Good Hope route map'],
  aiSearchPlan:{version:1,inputHash:'',model:'cc/claude-opus-5-5',reservePolicy:policy,
   subject:'sea routes from Britain to China via Suez Canal and via Cape of Good Hope',
   visualTarget:'route comparison map: Britain to China via Suez Canal versus around the Cape of Good Hope',
   years:[],visualScope:'illustrative',preferredKind:'image',imageQueries:['Suez Canal vs Cape of Good Hope route map'],
   videoQueries:['Suez Canal Cape of Good Hope route comparison map animation'],
   fallbackVisualTarget:'sailing ship on the open ocean',fallbackVideoQueries:['tall ship sailing open ocean','old nautical world map']}};
 project.scenes=[scene];const plan=scene.documentary!.requirement.aiSearchPlan!;
 plan.inputHash=hash({inputHash:hash({version:1,model:plan.model,context:documentaryAiPlanContext(project)}),sceneId:scene.id});
 scene.documentary!.autoError='No suitable material';return {project,scene,plan};
}

test('actual Opus comparison with generic boat reserve cannot enter any automatic thematic stage',()=>{
 const {project,scene}=fixture('primary-only'),before=structuredClone(scene);
 assert.match(documentaryAutomaticThematicIssue(project,scene)!,/основной смысл/);
 assert.equal(claimDocumentaryThematicRecovery(project,scene),scene);
 assert.deepEqual(documentaryFootageRecoveryScenes(project,undefined,true),[],'Even allowEmptyAiReserve must respect primary-only');
 assert.equal(prepareDocumentaryFootageRecovery(project,scene),scene);
 project.settings.stockVideoPercent=0;assert.deepEqual(documentaryPhotoRecoveryScenes(project),[]);
 assert.equal(prepareDocumentaryPhotoRecovery(project,scene),scene);
 assert.equal(applyDocumentaryAutomaticNativeFallback(project,scene,documentaryThematicRecoveryBinding(project,scene),true),scene);
 assert.equal(applyDocumentaryNativeFallback(project,scene),scene,'A narration card must not replace the necessary comparison');
 assert.equal(documentaryThematicRequirement(scene,{id:scene.id,scriptText:scene.narration,subject:'sailing ships',queries:['sailing ship ocean']}),undefined);
 assert.equal(documentaryIllustrationFallback(scene,{safe:true,quote:'a sailing ship compete',query:'sailing ships on open ocean'}),scene.documentary!.requirement);
 assert.deepEqual(scene,before);
});

test('saved generic boat approval cannot become current, while primary and manual search queries remain available',()=>{
 const {project,scene,plan}=fixture('primary-only');
 scene.documentary!.requirement.footageFallback={version:1,target:plan.fallbackVisualTarget,queries:plan.fallbackVideoQueries,
  narration:scene.narration,originalTarget:plan.visualTarget,reason:'legacy generic reserve',kind:'video',
  automaticRecovery:{version:1,binding:documentaryThematicRecoveryBinding(project,scene),startedAt:'now',blockedSourceKeys:[]}};
 scene.documentary!.verified=true;
 assert.equal(currentDocumentaryFootageFallback(scene),undefined);assert.equal(documentaryThematicDiscoveryRequirement(project,scene),undefined);
 assert.match(documentarySavedContextIssue(project,scene)!,/основной смысл/);
 const primary=planFastDocumentaryScene(project,scene,'image');
 assert.equal(primary.visualTarget,plan.visualTarget);assert.deepEqual(primary.queries,plan.imageQueries,'The primary/manual query lane stays available');
 assert.deepEqual(scene.documentary!.requirement.footageFallback.queries,plan.fallbackVideoQueries,'Preserve old receipt metadata for audit');
});

test('ordinary thematic policy retains automatic related footage and discovery',()=>{
 const {project,scene}=fixture('thematic');
 assert.equal(documentaryAutomaticThematicIssue(project,scene),undefined);
 const claimed=claimDocumentaryThematicRecovery(project,scene);assert.notEqual(claimed,scene);
 assert.equal(claimed.documentary!.requirement.footageFallback!.target,'sailing ship on the open ocean');
 assert.equal(documentaryThematicDiscoveryRequirement({...project,scenes:[claimed]},claimed)!.detail,'sailing ship on the open ocean');
});
