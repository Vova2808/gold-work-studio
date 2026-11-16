import type {Project,Scene} from './index.js';
import {documentaryMaterialUsable} from './documentary.js';
import {documentaryRetainedApproval} from './documentary-acceptance.js';

/** Structural contract shared by editor readiness and the final native-card gate.
 * Project-specific automatic-recovery permissions remain the caller's concern. */
export function documentaryNativeCardReady(scene:Scene):boolean {
  const doc=scene.documentary,fallback=doc?.nativeFallback,graphic=doc?.motionGraphic;
  if(!doc?.verified||doc.pinned||!fallback||fallback.version!==1
    ||fallback.narration!==scene.narration||!fallback.reason.trim()
    ||doc.selected||scene.imagePath||scene.videoPath||doc.visualReview||doc.checksum)return false;
  const title=scene.narration.replace(/\s+/gu,' ').trim();
  const seconds=Math.max((doc.timing?.durationInFrames??Math.ceil(scene.durationSeconds*30))/30,scene.durationOverrideSeconds??0);
  return Boolean(title&&Number.isFinite(seconds)&&seconds>0&&graphic?.enabled
    &&graphic.kind==='quote'&&graphic.title===title&&graphic.quoteMode==='speech'&&graphic.origin==='automatic'
    &&graphic.startSeconds===0&&Number.isFinite(graphic.durationSeconds)&&Math.abs(graphic.durationSeconds-seconds)<1/30);
}

export function documentarySceneReadiness(scene:Scene,fileAvailable:(path:string)=>boolean=()=>true,project?:Project):{
  state:'ready'|'placeholder'|'needs-choice'|'held-unknown';reason?:string;
} {
  const doc=scene.documentary;
  if(!doc?.verified){
    const state=doc?.manualReview?.analysis?.status;
    return {state:state==='unknown'||state==='pending'?'held-unknown':'needs-choice',
      reason:doc?.autoError||doc?.manualReview?.analysis?.reason||'Материал ещё не подтверждён.'};
  }
  if(doc.selected){
    if(doc.acceptedUnderPreviousRules?.reviewCheckedAt===doc.visualReview?.checkedAt
      &&doc.acceptedUnderPreviousRules&&!documentaryRetainedApproval(scene,project))
      return {state:'needs-choice',reason:'Материал был одобрен для прежней задачи сцены.'};
    const path=doc.selected.kind==='video'?scene.videoPath:scene.imagePath;
    if(!path||!fileAvailable(path))return {state:'needs-choice',reason:'Локальный файл выбранного материала недоступен.'};
    return documentaryRetainedApproval(scene,project)||documentaryMaterialUsable(scene,fileAvailable)
      ?{state:'ready'}:{state:'needs-choice',reason:doc.reviewNote||'Проверка материала не завершена.'};
  }
  const graphic=doc.motionGraphic;
  if(doc.nativeFallback)return documentaryNativeCardReady(scene)
    ?{state:'placeholder'}:{state:'needs-choice',reason:'Карточка больше не соответствует реплике или измеренной длительности озвучки.'};
  return graphic?.enabled&&graphic.origin==='automatic'&&graphic.durationSeconds>0
    ?{state:'ready'}:{state:'needs-choice',reason:'Нет материала или готовой графики.'};
}

export function documentarySceneReady(scene:Scene,fileAvailable?:(path:string)=>boolean,project?:Project):boolean {
  const {state}=documentarySceneReadiness(scene,fileAvailable,project);
  return state==='ready'||state==='placeholder';
}
