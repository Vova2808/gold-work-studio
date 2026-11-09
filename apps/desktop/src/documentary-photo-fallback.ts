import type {Project} from '@gold-work/shared';
import {documentaryWorkLimits} from './documentary-work-budget.js';

export function documentaryPhotoFallbackStatus(project:Project,excludeSceneId?:string) {
  const videos=project.scenes.filter(scene=>scene.includeInAssembly!==false&&scene.documentary?.selectionPlan?.kind==='video');
  const used=videos.filter(scene=>scene.id!==excludeSceneId&&scene.documentary?.verified
    &&!scene.documentary.pinned&&scene.documentary.selected?.kind==='image').length;
  const limit=Math.floor(videos.length*documentaryWorkLimits.photoFallbackRatio);
  return {planned:videos.length,used,limit,allowed:used<limit};
}
