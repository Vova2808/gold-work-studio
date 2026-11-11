import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {DocumentaryScene,Project,Scene} from '@gold-work/shared';
import {documentaryAccent,documentaryFootageOrigin,documentaryVideoOriginIssue,groundedDocumentaryMotion,documentaryThematicReserveIssue} from '@gold-work/shared';
import {documentarySceneContext,documentaryNarrativeEvidenceIssue} from './documentary-scene-context.js';
import {documentaryContradictoryModelYear} from './documentary-model-year.js';
import {documentaryIdentityReviewIssue} from './documentary-visual-relevance.js';
import {documentaryGeneralDiagramVerified} from './documentary-general-diagram.js';
import {documentaryScriptEvidence,documentaryScriptEvidenceIssue} from './documentary-script-evidence.js';
import {documentaryMaterialMetadataIssue} from './documentary-material-metadata.js';
import {planFastDocumentaryScene,fastDocumentaryCandidateMetadataIssue,fastDocumentaryTargetCovered,fastDocumentaryEvidenceIssue,fastDocumentarySpecificIssue,fastDocumentaryFilmedScreenIssue} from './documentary-fast-plan.js';
import {fastDocumentaryGraphicReady} from './documentary-fast-graphics.js';
import {routeComparisonReviewNote,savedRouteComparisonIssue} from './documentary-route-comparison.js';
import {documentaryNativeFallbackReady} from './documentary-native-fallback.js';
import {currentDocumentaryAiSearchPlan} from './documentary-ai-plan-state.js';
import {documentarySubjectContinuity} from './documentary-subject-continuity.js';
import {documentarySourceEvidence} from './documentary-source-evidence.js';
import {documentaryRequiredLocation} from './documentary-location-review.js';
import {documentarySavedIllustrationQualityIssue} from './documentary-illustration-quality.js';
import {documentaryKnownOriginalGeometryIssue} from './documentary-source-quality.js';
import {documentaryThematicRecoveryBinding,documentaryThematicDiscoveryRequirement} from './documentary-automatic-thematic-recovery.js';
import {documentaryGeographicReserveIssue} from './documentary-thematic-location.js';
import {documentaryFallbackNarrativeIssue} from './documentary-fallback-narrative.js';

type Review=NonNullable<DocumentaryScene['visualReview']>;
type Approval=NonNullable<Review['contextApproval']>;
const sourceEvidence=(scene:Scene)=>({title:scene.documentary?.selected?.title,description:scene.documentary?.selected?.description});

export function documentaryMapActionIssue(scene:Scene,kind:string):string|undefined {
  if(kind!=='map-locator')return;
  // An establishing location can be mapped; the next race action still needs
  // its subject. A place name alone must not substitute for the narrated action.
  if(/\b(?:penalt\w*|overtak\w*|retook|finished|won|winning|victor\w*|podium|laps?)\b|штраф|обгон|финиш|побед/iu.test(scene.narration))
    return 'Карта места не иллюстрирует действие или результат гонки в этой реплике.';
}

/** Only the stock, scenario-grounded chronology added after the pixel verdict
 * is supplementary. Never exempt a manual graphic or an arbitrary automatic
 * style. Rebuild its complete shape with the same shared graphics factory. */
function supplementaryChronology(project:Project,scene:Scene):boolean {
  const doc=scene.documentary,graphic=doc?.motionGraphic;
  if(!doc||!graphic||graphic.kind!=='chronology'||graphic.origin!=='automatic'||graphic.sequenceId)return false;
  const year=/\b(?:18|19|20)\d{2}\b/u.exec(scene.narration)?.[0];
  const sentence=scene.narration.trim().split(/(?<=[.!?])\s+/u)[0]??'';
  const phrase=sentence.length<=120?sentence:sentence.split(/[,;:]\s+/u)[0]??'';
  const title=phrase.length<=120?phrase.replace(/[.!?:;]+$/u,''):'';
  if(!year||!title)return false;
  const duration=(doc.timing?.durationInFrames??Math.ceil(scene.durationSeconds*30))/30;
  if(!Number.isFinite(duration)||duration<2.5||(scene.durationOverrideSeconds??0)>duration)return false;
  const expected=groundedDocumentaryMotion({kind:'chronology',value:year,title},scene.narration,project.videoBrief?.readyScript??scene.narration);
  if(!expected)return false;
  const canonical={...expected,accentColor:documentaryAccent(doc.requirement.sectionTitle||doc.requirement.identities?.[0]?.name||title||doc.requirement.text),
    durationSeconds:duration,startSeconds:0,origin:'automatic'};
  // Serialization deliberately treats optional undefined fields exactly as a
  // saved project does, while retaining every defined (including unknown) key.
  return isDeepStrictEqual(JSON.parse(JSON.stringify(graphic)),JSON.parse(JSON.stringify(canonical)));
}

/** Only semantic inputs belong here: changing search query/order or a preview
 * filename does not require paying to inspect the same approved pixels again. */
function fingerprint(project:Project,scene:Scene,omitSupplementaryChronology=false):string {
  const doc=scene.documentary!,req=doc.requirement,source=doc.selected;
  return createHash('sha256').update(JSON.stringify({version:1,
    context:documentarySceneContext(project,scene),
    requirement:{text:req.text,entities:req.entities,identities:req.identities,years:req.years,detail:req.detail,
      ...(req.visualScope==='illustrative'?{visualScope:req.visualScope,visualScopeQuote:req.visualScopeQuote,illustrationQuery:req.illustrationQuery}: {})},
    source:{id:source?.id,provider:source?.provider,kind:source?.kind,...sourceEvidence(scene)},
    checksum:doc.checksum,diagramWhite:scene.imagePath?.endsWith('-diagram.png')===true,
    interval:source?.kind==='video'?[scene.trimStartSeconds??0,scene.trimEndSeconds??null]:null,
    ...(doc.visualReview?.localReview?{localReview:doc.visualReview.localReview,scriptRequirements:req.scriptRequirements,
      timing:doc.timing?.durationInFrames??scene.durationSeconds*30,playbackRate:scene.playbackRate??1,
      graphic:omitSupplementaryChronology?undefined:doc.motionGraphic}:{}),
  })).digest('hex');
}

/** Called only on the actual-frame verdict. Missing old evidence must never
 * acquire a current proof merely because its old status says accepted. */
export function documentaryIllustrationApproval(project:Project,scene:Scene):Review['illustrationApproval'] {
  if(documentaryFallbackNarrativeIssue(project,scene,scene.documentary?.visualReview))return;
  return {version:1,fingerprint:illustrationFingerprint(project,scene)};
}

export function documentaryActiveListItem(scene:Scene):string|undefined {
  const graphic=scene.documentary?.motionGraphic;
  if(graphic?.enabled&&graphic.kind==='feature-list'&&graphic.activeIndex!==undefined)
    return graphic.items?.[graphic.activeIndex]?.trim()||undefined;
}

function illustrationFingerprint(project:Project,scene:Scene):string {
  const doc=scene.documentary!,source=doc.selected;
  return createHash('sha256').update(JSON.stringify({version:1,narration:scene.narration,activeListItem:documentaryActiveListItem(scene),
    requiredSubject:documentarySubjectContinuity(project,scene),
    ...(doc.visualReview?.narrativeFit?{narrativeFit:doc.visualReview.narrativeFit}:{}),
    ...(doc.visualReview?.sourceLocation?{sourceEvidence:documentarySourceEvidence(source??{}).fingerprint,requiredLocation:documentaryRequiredLocation(scene)}:{}),
    ...(doc.visualReview?.illustrationQualityVersion?{illustrationQualityVersion:doc.visualReview.illustrationQualityVersion,
      target:planFastDocumentaryScene(project,scene,undefined,false).visualTarget,targetVisibility:doc.visualReview.targetVisibility,sourceText:doc.visualReview.sourceText}:{}),
    source:{id:source?.id,provider:source?.provider,kind:source?.kind},checksum:doc.checksum,
    interval:source?.kind==='video'?[scene.trimStartSeconds??0,scene.trimEndSeconds??null]:null,
    localReview:doc.visualReview?.localReview})).digest('hex');
}

export function documentaryContextApproval(project:Project,scene:Scene,value:Record<string,unknown>):Approval|undefined {
  if(scene.documentary?.requirement.scriptRequirements?.mode==='thematic'&&project.settings.assembly.documentary?.matchMode!=='thematic')return;
  if(value.status!=='accepted'||!scene.documentary?.checksum||!scene.documentary.selected
    ||documentaryMaterialMetadataIssue(scene,scene.documentary.selected)
    ||documentaryContradictoryModelYear(scene.documentary.selected,scene.documentary.requirement,documentarySceneContext(project,scene))
    ||documentaryNarrativeEvidenceIssue(value,sourceEvidence(scene),documentarySceneContext(project,scene)))return;
  const evidence=value.narrativeEvidence as Record<string,unknown>;
  return {version:1,fingerprint:fingerprint(project,scene),evidence:{
    subjectMatch:true,eraMatch:true,detailMatch:true,requiredEra:String(evidence.requiredEra),
    observedEra:String(evidence.observedEra??''),evidence:String(evidence.evidence),
    ...(typeof evidence.eraEvidenceQuote==='string'?{eraEvidenceQuote:evidence.eraEvidenceQuote}:{}),
  }};
}

const fastGraphicContextIssue='Автоматическая графика больше не соответствует текущей реплике.';

function sceneForSavedThematicFootage(project:Project,scene:Scene,doc:DocumentaryScene):Scene {
  if(!doc.requirement.footageFallback?.automaticRecovery||doc.nativeFallback
    ||doc.template!=='full'||doc.templateOrigin!=='automatic'||doc.layout!=='full'
    ||doc.selected?.kind!=='video'||!doc.visualReview?.illustrationApproval
    ||documentaryThematicDiscoveryRequirement(project,scene))return scene;
  // The montage planner makes the default full-frame presentation explicit.
  // Use the exact earlier binding for both narrative and pixel evidence checks.
  const beforeTemplate={...scene,documentary:{...doc,template:undefined,templateOrigin:undefined}};
  return documentaryThematicDiscoveryRequirement(project,beforeTemplate)?beforeTemplate:scene;
}

export function documentarySavedContextIssue(project:Project,saved:Scene):string|undefined {
  const savedDoc=saved.documentary;
  if(!savedDoc?.verified||savedDoc.pinned)return;
  const scene=sceneForSavedThematicFootage(project,saved,savedDoc),doc=scene.documentary!;
  const reserveIssue=documentaryThematicReserveIssue(doc.requirement.aiSearchPlan);
  if(reserveIssue&&(doc.requirement.footageFallback||doc.nativeFallback?.automaticRecovery))return reserveIssue;
  const geographicIssue=documentaryGeographicReserveIssue(scene);if(geographicIssue)return geographicIssue;
  const narrativeIssue=documentaryFallbackNarrativeIssue(project,scene,doc.visualReview);
  if(narrativeIssue)return narrativeIssue.reason;
  if(doc.nativeFallback?.automaticRecovery
    ?doc.nativeFallback.automaticRecovery.binding!==documentaryThematicRecoveryBinding(project,scene)
    :doc.requirement.footageFallback?.automaticRecovery&&!documentaryThematicDiscoveryRequirement(project,scene))
    return 'Визуальное задание тематического резерва изменилось. Исходник, озвучка и оплаченный ответ сохранены; прежнее одобрение не подтверждает новые указания.';
  const geometryIssue=documentaryKnownOriginalGeometryIssue(project,scene);
  if(geometryIssue)return geometryIssue;
  if(doc.requirement.aiSearchPlan&&!currentDocumentaryAiSearchPlan(project,scene))return 'Контекст AI-плана изменился. Материал и озвучка сохранены; подготовьте запросы и проверьте текущую цель.';
  if(doc.nativeFallback&&!doc.selected)return documentaryNativeFallbackReady(project,scene)?undefined:'Графическая сцена больше не соответствует текущей реплике или длительности озвучки.';
  const graphic=doc.motionGraphic;
  if(graphic?.enabled&&graphic.routeComparison){
    if(graphic.kind!=='map-route'||doc.selected||scene.imagePath||scene.videoPath)
      return 'Сравнение маршрутов должно быть отдельной схемой без стокового материала.';
    return savedRouteComparisonIssue(project,scene);
  }
  if(!doc.selected&&doc.motionGraphic?.origin==='automatic'){
    const actionIssue=documentaryMapActionIssue(scene,doc.motionGraphic.kind);
    if(actionIssue)return actionIssue;
    return fastDocumentaryGraphicReady(project,{...scene,documentary:{...doc,effects:[]}})
      ?undefined:fastGraphicContextIssue;
  }
  if(doc.visualReview?.illustrationApproval){
    if(doc.visualReview.status!=='accepted'||!doc.checksum||!doc.selected)
      return 'Материал не принят после просмотра кадров.';
    if(doc.selected.kind==='video'){
      const issue=documentaryVideoOriginIssue(documentaryFootageOrigin(doc.visualReview));
      if(issue)return issue;
    }
    const approval=doc.visualReview.illustrationApproval;
    const qualityIssue=documentarySavedIllustrationQualityIssue(planFastDocumentaryScene(project,scene,undefined,false).visualTarget,doc.visualReview);
    if(qualityIssue)return qualityIssue;
    if(approval.version!==1||approval.fingerprint!==illustrationFingerprint(project,scene))
      return 'После просмотра изменился текст, активный пункт списка, материал или выбранный отрезок.';
    // The saved model decision is the only semantic gate. Fingerprint and
    // file checks still invalidate changed text, bytes or intervals locally.
    const relevance=doc.visualReview.fastRelevance;
    if(relevance?.version!==1||relevance.relevant!==true||!doc.visualReview.viewDescription?.trim())
      return 'Сохранённый просмотр не содержит описания и решения о пригодности.';
    return;
  }
  if(doc.selected){const materialIssue=documentaryMaterialMetadataIssue(scene,doc.selected);if(materialIssue)return materialIssue;}
  if(doc.requirement.scriptRequirements?.mode==='thematic'&&project.settings.assembly.documentary?.matchMode!=='thematic')
    return 'Тематическая иллюстрация не подтверждает точные требования. Включите подбор по теме или подберите точный кадр.';
  if(doc.selected&&documentaryContradictoryModelYear(doc.selected,doc.requirement,documentarySceneContext(project,scene)))
    return 'Год модели в заголовке выбранного материала противоречит году той же модели в исходном сценарии. Нужен другой источник; исходник и озвучка сохранены.';
  const review=doc.visualReview,approval=review?.contextApproval;
  if(approval?.version===1&&approval.fingerprint!==fingerprint(project,scene)
    &&!(review?.localReview&&supplementaryChronology(project,scene)&&approval.fingerprint===fingerprint(project,scene,true)))
    return 'После автоматической проверки изменился сценарий, объект или выбранный фрагмент. Нужна повторная проверка соответствия; исходник и озвучка сохранены.';
  if(review?.status==='accepted'){
    const generalDiagram=doc.selected?.kind==='image'&&documentaryGeneralDiagramVerified({generalDiagram:review.generalDiagram,identityMatch:false,identifiedEntity:review.identifiedEntity,narrativeEvidence:approval?.evidence},documentarySceneContext(project,scene),doc.requirement.identities);
    const identityIssue=!generalDiagram&&documentaryIdentityReviewIssue(doc.requirement,{identityMatch:true,identifiedEntity:review.identifiedEntity});
    if(identityIssue)return identityIssue;
  }
  if(review?.status!=='accepted'||approval?.version!==1||!doc.checksum||!doc.selected)
    return 'Старое автоматическое одобрение не подтверждает человека, эпоху и деталь по текущим правилам. Нужна проверка сохранённого материала; исходник и озвучка сохранены.';
  const scriptEvidence=documentaryScriptEvidence(review as unknown as Record<string,unknown>,scene.narration);
  const scriptIssue=scriptEvidence?documentaryScriptEvidenceIssue(scriptEvidence,doc.selected.kind==='video',review.sampleSeconds,doc.requirement.scriptRequirements)
    :'Сохранённое автоматическое одобрение не содержит отдельных доказательств требований сценария. Материал и озвучка сохранены; нужна проверка.';
  if(scriptIssue)return scriptIssue;
  return documentaryNarrativeEvidenceIssue({narrativeEvidence:approval.evidence},sourceEvidence(scene),documentarySceneContext(project,scene));
}

export function documentaryRouteApprovalCandidate(project:Project,scene:Scene):Scene {
  const doc=scene.documentary,graphic=doc?.motionGraphic,settings=project.settings.assembly.documentary;
  if(!doc||doc.verified||doc.pinned||doc.manualReview||doc.nativeFallback||doc.reviewNote!==fastGraphicContextIssue
    ||!graphic?.routeComparison||graphic.origin!=='automatic'||scene.includeInAssembly===false
    ||project.mediaMode!=='stock'||settings?.version!==2||settings.autoMotionGraphics!==true
    ||settings.matchMode==='literal'||settings.excludedTemplates?.includes('full'))return scene;
  const documentary={...doc,verified:true,autoError:undefined};
  const restored:Scene={...scene,status:'ready',documentary};
  if(documentarySavedContextIssue(project,restored))return scene;
  documentary.reviewNote=routeComparisonReviewNote(graphic.routeComparison);
  return restored;
}

export function revalidateDocumentaryContext(project:Project,sceneIds?:string[]):Scene[] {
  return project.scenes.map(scene=>{
    if(sceneIds&&!sceneIds.includes(scene.id))return scene;
    const issue=documentarySavedContextIssue(project,scene);
    return issue?{...scene,documentary:{...scene.documentary!,verified:false,autoError:issue,reviewNote:issue}}:scene;
  });
}
