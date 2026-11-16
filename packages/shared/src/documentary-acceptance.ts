import type {Project,Scene} from './index.js';

export function documentaryAcceptanceContext(project:Project,scene:Scene):string {
  const index=project.scenes.findIndex(item=>item.id===scene.id);
  return JSON.stringify([project.language,project.settings.assembly.documentary?.matchMode??'strict',
    project.scenes.slice(Math.max(0,index-2),index+3).map(item=>[item.id,item.narration])]);
}

/** Bind a retained approval to the user's scene and source, never a code version. */
export function documentaryAcceptanceFingerprint(scene:Scene):string {
  const doc=scene.documentary,source=doc?.selected,req=doc?.requirement,plan=req?.aiSearchPlan;
  return JSON.stringify([scene.narration,req?.text,
    {detail:req?.detail,identities:req?.identities,entities:req?.entities,years:req?.years,visualScope:req?.visualScope,
      scriptRequirements:req?.scriptRequirements,visualTarget:plan?.visualTarget,subject:plan?.subject,grounding:plan?.grounding,
      objectClass:plan?.objectClass,excludedClasses:plan?.excludedClasses,fallbackTarget:req?.footageFallback?.target},
    source?.provider,source?.id,source?.kind,doc?.checksum,source?.kind==='video'?scene.videoPath:scene.imagePath,
    scene.trimStartSeconds??0,scene.trimEndSeconds??null,scene.playbackRate??1]);
}

export function documentaryRetainedApproval(scene:Scene,project?:Project):boolean {
  const doc=scene.documentary,saved=doc?.acceptedUnderPreviousRules;
  return Boolean(doc?.verified&&doc.selected&&doc.visualReview?.status==='accepted'
    &&doc.requirement.text===scene.narration&&saved?.version===1
    &&saved.reviewCheckedAt===doc.visualReview.checkedAt
    &&saved.fingerprint===documentaryAcceptanceFingerprint(scene)
    &&(!project||saved.context===documentaryAcceptanceContext(project,scene)));
}
