import test from 'node:test';
import assert from 'node:assert/strict';
import type {DocumentaryCandidate,DocumentaryRequirement,Project,Scene} from '@gold-work/shared';
import {documentaryGroundedThematicQuery,documentaryThematicMetadataIssue} from './documentary-illustration-fallback.js';
import {documentaryNamedListPortrait,documentaryVisualReviewContext} from './documentary-scene-context.js';
import {documentaryRequiredVisiblePart} from './documentary-detail-evidence.js';

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
test('an explicit person introduction keeps exact names without borrowing an earlier event date',()=>{
  const scene={id:'people',order:1,narration:'За этим результатом стояли конкретные люди и детали: Росси, ',documentary:{requirement:{identities:[{name:'Valentino Rossi',aliases:['Росси']}],years:[]}}} as unknown as Scene;
  const next={id:'next',order:2,narration:'Фурусава и двигатель.'} as Scene;
  const project={scenes:[{id:'race',order:0,narration:'Гонка 2004 года.'} as Scene,scene,next]} as Project;
  assert.equal(documentaryNamedListPortrait(project,scene),true);
  assert.deepEqual(documentaryVisualReviewContext(project,scene).earlierTimeReferences,[]);
  assert.equal(scene.documentary!.requirement.identities![0]!.name,'Valentino Rossi');
  assert.equal(documentaryNamedListPortrait(project,{...scene,narration:'На подиуме гонки 2004 года Росси, '}),false);
});
