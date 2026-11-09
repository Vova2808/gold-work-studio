import {documentaryVideoCoverage,documentaryThematicReserveIssue,type Project,type Scene} from '@gold-work/shared';
import {fastDocumentaryFootageFallback} from './documentary-fast-plan.js';
import {documentaryNativeFallbackReady} from './documentary-native-fallback.js';
import {isDeepStrictEqual} from 'node:util';
import {currentDocumentaryAiSearchPlan} from './documentary-ai-plan-state.js';

function automaticRecoveryEligible(project:Project,scene:Scene,scope?:string[],allowEmptyAiReserve=false):boolean{
    const doc=scene.documentary;
    if(!doc)return false;
    if(documentaryThematicReserveIssue(doc.requirement.aiSearchPlan))return false;
    if(doc?.requirement.aiSearchPlan){
      const ai=currentDocumentaryAiSearchPlan(project,scene);
      if(!ai||!allowEmptyAiReserve&&(!ai.fallbackVideoQueries.length||!ai.fallbackVisualTarget))return false;
    }
    return scene.includeInAssembly!==false&&(!scope||scope.includes(scene.id))&&doc&&!doc.pinned
      &&!doc.cuts?.length&&!doc.texts?.length&&!doc.caption.enabled&&doc.layout!=='compare'&&!doc.comparison
      &&doc.templateOrigin!=='manual'&&doc.motionGraphic?.origin!=='manual'
      &&!(doc.effects??[]).some(effect=>effect.enabled&&effect.kind!=='audio'&&effect.boundary?.origin!=='automatic')
      // An unknown review protects its source/checksum/interval in the analysis
      // layer. It must not prevent this scene from trying another source.
      &&(!doc.verified||Boolean(doc.nativeFallback&&!doc.selected));
}

export function documentaryFootageRecoveryScenes(project:Project,scope?:string[],allowEmptyAiReserve=false):string[]{
  const coverage=documentaryVideoCoverage(project.scenes);
  if(coverage.percent>=project.settings.stockVideoPercent)return [];
  let missing=coverage.totalSeconds*project.settings.stockVideoPercent/100-coverage.videoSeconds;
  const eligible=project.scenes.filter(scene=>automaticRecoveryEligible(project,scene,scope,allowEmptyAiReserve));
  const seconds=(scene:Scene)=>Math.max((scene.documentary?.timing?.durationInFrames??scene.durationSeconds*30)/30,scene.durationOverrideSeconds??0);
  const ids:string[]=[];
  for(const scene of eligible.sort((a,b)=>seconds(b)-seconds(a)||a.order-b.order)){
    ids.push(scene.id);missing-=seconds(scene);
    // A small reserve allows another scene to succeed after one source fails.
    if(missing<-coverage.totalSeconds*.05)break;
  }
  return ids;
}

/** Photos fill missing visuals only after real moving footage meets its quota. */
export function documentaryPhotoRecoveryScenes(project:Project,scope?:string[]):string[]{
  if(documentaryVideoCoverage(project.scenes).percent<project.settings.stockVideoPercent)return [];
  return project.scenes.filter(scene=>automaticRecoveryEligible(project,scene,scope)).map(scene=>scene.id);
}

export function prepareDocumentaryPhotoRecovery(project:Project,scene:Scene):Scene{
  if(!documentaryPhotoRecoveryScenes(project,[scene.id]).length)return scene;
  const doc=scene.documentary!,fallback={...fastDocumentaryFootageFallback(project,scene),kind:'image' as const};
  return {...scene,documentary:{...doc,verified:false,
    requirement:{...doc.requirement,footageFallback:fallback,queries:fallback.queries,preferredKind:'image',
      fastVisualTarget:fallback.target,fastSourcePolicy:'background',fastPlanVersion:1},
    selectionPlan:{kind:'image',videoPercent:project.settings.stockVideoPercent},
    autoError:fallback.reason,reviewNote:`Подбирается тематическая фотография: ${fallback.target}. Исходный запрос: ${fallback.originalTarget}.`}};
}

export function prepareDocumentaryFootageRecovery(project:Project,scene:Scene,round=0):Scene {
  if(!documentaryFootageRecoveryScenes(project,[scene.id]).length)return scene;
  const doc=scene.documentary!,fallback=fastDocumentaryFootageFallback(project,scene,round);
  return {...scene,documentary:{...doc,verified:false,
    requirement:{...doc.requirement,footageFallback:fallback,queries:fallback.queries,preferredKind:'video',
      fastVisualTarget:fallback.target,fastSourcePolicy:'background',fastPlanVersion:1},
    selectionPlan:{kind:'video',videoPercent:project.settings.stockVideoPercent},
    autoError:fallback.reason,reviewNote:`Подбирается тематический видеоряд: ${fallback.target}. Исходный запрос: ${fallback.originalTarget}.`}};
}

/** A quota upgrade must not discard a ready graphic if skipped, refused or interrupted. */
export function restoreDocumentaryFootageRecovery(project:Project,scene:Scene,previous:Scene):Scene {
  const doc=scene.documentary,saved=previous.documentary;
  if(!doc||!saved||doc.verified||doc.pinned||scene.narration!==previous.narration
    ||!documentaryNativeFallbackReady(project,previous))return scene;
  // Concurrent manual composition edits belong to the user, not this recovery pass.
  for(const key of ['caption','cuts','texts','layout','comparison','template','templateOrigin'] as const)
    if(!isDeepStrictEqual(doc[key],saved[key]))return scene;
  const restored={...scene,imagePath:previous.imagePath,videoPath:previous.videoPath,stockSource:previous.stockSource,
    trimStartSeconds:previous.trimStartSeconds,trimEndSeconds:previous.trimEndSeconds,
    documentary:{...doc,selected:saved.selected,checksum:saved.checksum,visualHash:saved.visualHash,
      visualReview:saved.visualReview,nativeFallback:saved.nativeFallback,verified:true,autoError:undefined,
      reviewNote:[saved.reviewNote,doc.autoError?`Добор видео: ${doc.autoError}`:undefined].filter(Boolean).join(' ')}};
  return documentaryNativeFallbackReady(project,restored)?restored:scene;
}
