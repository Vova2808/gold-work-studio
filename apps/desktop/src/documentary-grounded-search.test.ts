import test from 'node:test';
import assert from 'node:assert/strict';
import type {DocumentaryCandidate,DocumentaryRequirement,Project,Scene} from '@gold-work/shared';
import {documentaryGroundedThematicQuery,documentaryThematicMetadataIssue,documentaryGroundedReserveIssue,documentaryThematicQueryAllowed} from './documentary-illustration-fallback.js';
import {documentaryNamedListPortrait,documentaryVisualReviewContext} from './documentary-scene-context.js';
import {documentaryRequiredVisiblePart} from './documentary-detail-evidence.js';
import {currentDocumentaryFootageFallback,resetStaleDocumentaryFootageFallback} from './documentary-fast-plan.js';

test('labelled specification queries discard invented staging while literal parts stay specific',()=>{
  assert.equal(documentaryGroundedThematicQuery('Действующий чемпион выбрал новую команду и новый мотоцикл.','motorcycle racing team paddock setup'),'motorcycle racing team');
  assert.equal(documentaryGroundedThematicQuery('Honda RC211V имел двигатель V5 объёмом 990 кубических сантиметров.','racing motorcycle engine internal components'),'racing motorcycle');
  assert.equal(documentaryGroundedThematicQuery('Крупный план коленчатого вала crossplane.','crossplane crankshaft engine cutaway'),'crossplane crankshaft engine cutaway');
  assert.equal(documentaryGroundedThematicQuery('Показан коленчатый вал.','crankshaft in a garage preparation'),'crankshaft');
  assert.equal(documentaryGroundedThematicQuery('Автомобиль развивает 400 лошадиных сил.','car engine internal components'),'car');
  assert.equal(documentaryGroundedThematicQuery('Он выиграл гонку.','holding championship trophy'),'');
});

test('a firing specification does not require an opened engine in any vehicle topic',()=>{
  for(const text of ['The car uses an uneven firing order.','Big bang engine improves traction.','Порядок зажигания улучшает работу двигателя самолёта.'])
    assert.equal(documentaryRequiredVisiblePart(text),undefined);
  assert.equal(documentaryRequiredVisiblePart('The opened engine shows its moving mechanism.'),'exposed-engine');
  assert.equal(documentaryRequiredVisiblePart('Двигатель в разрезе показывает работу механизма.'),'exposed-engine');
});
test('thematic road racing does not silently switch to motocross, while a motocross episode keeps its sources',()=>{
  const req={visualScope:'illustrative',narrativeQueries:['motorcycle racing']} as DocumentaryRequirement;
  const source={title:'motocross dirt bike'} as DocumentaryCandidate;
  assert.ok(documentaryThematicMetadataIssue(req,source,'Гран-при и гоночные мотоциклы'));
  assert.equal(documentaryThematicMetadataIssue(req,source,'Motocross Grand Prix'),undefined);
  assert.equal(documentaryThematicMetadataIssue({...req,visualScope:'exact'},source,'MotoGP'),undefined);
});

test('a reserve preserves only identities made mandatory by the original script, including genuine original aliases',()=>{
  const plan={version:1,inputHash:'fixture',model:'fixture',years:[],visualScope:'illustrative',preferredKind:'image',
    subject:'Richard Woodget',visualTarget:'Richard Woodget portrait',imageQueries:['Richard Woodget portrait'],videoQueries:[],
    fallbackVisualTarget:'Cutty Sark sailing ship',fallbackVideoQueries:['Cutty Sark ship sailing'],
    grounding:{version:1,mandatory:[{kind:'identity',required:'Richard Woodget, captain of Cutty Sark',scriptQuote:'Richard Woodget became captain.'}],illustrations:['portrait'],optionalDetails:[]}} as NonNullable<DocumentaryRequirement['aiSearchPlan']>;
  const req={aiSearchPlan:plan} as DocumentaryRequirement;
  assert.match(documentaryGroundedReserveIssue(req)!,/Richard Woodget/);
  assert.equal(documentaryGroundedReserveIssue(req,'Captain Richard Woodget portrait',['archival portrait']),undefined);
  const resumed={id:'scene',narration:plan.grounding!.mandatory[0]!.scriptQuote,audioPath:'retained-voice.mp3',imagePath:'retained-material.jpg',
    documentary:{requirement:{...req,text:plan.grounding!.mandatory[0]!.scriptQuote,footageFallback:{version:1,target:plan.fallbackVisualTarget,queries:plan.fallbackVideoQueries}},verified:false}} as unknown as Scene;
  assert.equal(currentDocumentaryFootageFallback(resumed),undefined,'The ordinary autoSelect path must also reject the saved incompatible reserve');
  const restored=resetStaleDocumentaryFootageFallback(resumed);
  assert.equal(restored.documentary!.requirement.footageFallback,undefined);
  assert.equal(restored.audioPath,resumed.audioPath);assert.equal(restored.imagePath,resumed.imagePath);
  assert.equal(restored.documentary!.requirement.aiSearchPlan,plan);
  assert.ok(resumed.documentary!.requirement.footageFallback,'The prior snapshot stays intact');
  assert.equal(documentaryGroundedReserveIssue({...req,aiSearchPlan:{...plan,grounding:undefined}}),undefined,'Legacy contextual substitution has no new mandatory identity');
  assert.equal(documentaryGroundedReserveIssue({...req,aiSearchPlan:{...plan,grounding:{...plan.grounding!,mandatory:[]}}}),undefined);
  const ship={...plan,subject:'Cutty Sark',grounding:{...plan.grounding!,mandatory:[{kind:'identity' as const,required:'the ship Cutty Sark',scriptQuote:'Cutty Sark was renamed Ferreira.',aliases:['Ferreira']}]}};
  assert.equal(documentaryGroundedReserveIssue({aiSearchPlan:ship} as DocumentaryRequirement,'Ferreira vessel',['Ferreira ship']),undefined);
  assert.match(documentaryGroundedReserveIssue({aiSearchPlan:ship} as DocumentaryRequirement,'Olympic ship',['Olympic underway'])!,/Cutty Sark/);
  const named={aiSearchPlan:ship,identities:[{name:'Cutty Sark',aliases:['Ferreira']}]} as DocumentaryRequirement;
  assert.equal(documentaryThematicQueryAllowed(named,'Cutty Sark preserved ship'),true);
  assert.equal(documentaryThematicQueryAllowed(named,'Ferreira sailing ship'),true);
  assert.equal(documentaryThematicQueryAllowed(named,'generic sailing ship'),false);
  assert.equal(documentaryThematicQueryAllowed({...named,aiSearchPlan:undefined},'Cutty Sark preserved ship'),false);
});
test('an explicit person introduction keeps exact names without borrowing an earlier event date',()=>{
  const scene={id:'people',order:1,narration:'За этим результатом стояли конкретные люди и детали: Росси, ',documentary:{requirement:{identities:[{name:'Valentino Rossi',aliases:['Росси']}],years:[]}}} as unknown as Scene;
  const next={id:'next',order:2,narration:'Фурусава и двигатель.'} as Scene;
  const project={scenes:[{id:'race',order:0,narration:'Гонка 2004 года.'} as Scene,scene,next]} as Project;
  assert.equal(documentaryNamedListPortrait(project,scene),true);
  assert.deepEqual(documentaryVisualReviewContext(project,scene).earlierTimeReferences,[]);
  assert.equal(scene.documentary!.requirement.identities![0]!.name,'Valentino Rossi');
  assert.equal(documentaryNamedListPortrait(project,{...scene,narration:'На подиуме гонки 2004 года Росси, '}),false);
});
