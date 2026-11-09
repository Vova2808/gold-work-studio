import {documentaryMaterialUsable,type Project,type Scene} from '@gold-work/shared';
import {montageCutawaySources} from './documentary-semantic-montage.js';
import {documentarySourceFootageIssue} from './documentary-source-eligibility.js';

/** Pure authoring/runtime policy: current selected source plus one approved still cutaway. */
export function allowedArtworkMediaSources(project:Project,sceneId:string):Scene[]{
  const scene=project.scenes.find(item=>item.id===sceneId);
  if(!scene||scene.includeInAssembly===false||!scene.documentary?.requirement||!scene.documentary.selected
    ||!documentaryMaterialUsable(scene)||documentarySourceFootageIssue(scene)||!(scene.imagePath||scene.videoPath))return [];
  const ids=new Set(scene.documentary.semanticMontage?.cutawaySceneIds??[]);
  const other=montageCutawaySources(scene,project.scenes).find(item=>ids.has(item.id)&&item.documentary?.selected
    &&!item.videoPath&&item.imagePath);
  return other?[scene,other]:[scene];
}

/** Only a verified selected still may request local foreground preparation. */
export function artworkForegroundAllowed(source:Scene):boolean{
  return source.documentary?.verified===true&&Boolean(source.imagePath)&&!source.videoPath;
}
