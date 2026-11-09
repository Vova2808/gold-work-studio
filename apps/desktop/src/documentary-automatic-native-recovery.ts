import {statSync} from 'node:fs';
import {documentaryVideoCoverage,type Project,type Scene} from '@gold-work/shared';
import {documentaryAutomaticMaterialReady} from './documentary-auto-readiness.js';
import {documentarySavedContextIssue} from './documentary-context-approval.js';
import {currentDocumentaryAiSearchPlan} from './documentary-ai-plan-state.js';
import {applyDocumentaryNativeFallback} from './documentary-native-fallback.js';
import {documentaryAutomaticRecoveryPolicyIssue,documentaryThematicRecoveryBinding,documentaryThematicDiscoveryRequirement} from './documentary-automatic-thematic-recovery.js';

/** Denominator includes every included scene. Only readable, currently approved
 * moving originals contribute; pending/manual media and native cards contribute zero. */
export function documentaryCheckedVideoCoverage(project:Project) {
  const scenes=project.scenes.map(scene=>{
    const doc=scene.documentary,review=doc?.visualReview;
    let checked=Boolean(doc?.selected?.kind==='video'&&scene.videoPath&&documentaryAutomaticMaterialReady(scene)
      &&review?.status==='accepted'&&(review.illustrationApproval||review.contextApproval)&&!documentarySavedContextIssue(project,scene));
    if(checked){
      try{
        const info=statSync(scene.videoPath!,{bigint:true}),local=review!.localReview;
        // Already-approved files may acquire metadata-only ctime changes after
        // library/catalog maintenance. This quota gate checks content size/mtime;
        // it never creates or relaxes a pixel approval or dispatch/receipt guard.
        checked=info.isFile()&&info.size>0n&&(!local||local.size===String(info.size)&&local.mtimeNs===String(info.mtimeNs));
      }catch{checked=false;}
    }
    return checked||!doc?scene:{...scene,documentary:{...doc,verified:false,manualReview:undefined}};
  });
  return documentaryVideoCoverage(scenes);
}

/** Caller supplies exhaustion observed in this invocation and checks the quota once
 * against the same atomic project snapshot. Never rebind a stale authored marker. */
export function applyDocumentaryAutomaticNativeFallback(project:Project,scene:Scene,exhaustedBinding:string|undefined,videoQuotaMet:boolean):Scene {
  const doc=scene.documentary,settings=project.settings.assembly.documentary;
  if(!videoQuotaMet||!exhaustedBinding||exhaustedBinding!==documentaryThematicRecoveryBinding(project,scene)
    ||settings?.autoMotionGraphics!==true||settings.excludedTemplates?.includes('full')
    ||documentaryAutomaticRecoveryPolicyIssue(project,scene)||!doc||doc.nativeFallback?.automaticRecovery
    ||!currentDocumentaryAiSearchPlan(project,scene)
    ||doc.requirement.footageFallback?.automaticRecovery&&!documentaryThematicDiscoveryRequirement(project,scene))return scene;
  const pending=doc.autoError?scene:{...scene,documentary:{...doc,
    autoError:'Ограниченный поиск источников завершён; подходящий материал не получил подтверждения.'}};
  const card=applyDocumentaryNativeFallback(project,pending);
  if(card===pending||!card.documentary?.nativeFallback)return scene;
  // The prior footage marker remains as audit, with its used-source quarantine.
  // A new native marker owns the explicit, separately validated composition.
  return {...card,status:'ready',documentary:{...card.documentary,nativeFallback:{...card.documentary.nativeFallback,
    automaticRecovery:{version:1,binding:documentaryThematicRecoveryBinding(project,card)}}}};
}
