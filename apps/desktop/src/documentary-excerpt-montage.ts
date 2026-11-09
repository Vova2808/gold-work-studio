import type {Project,Scene} from '@gold-work/shared';
import {semanticMontageHash} from './documentary-semantic-montage.js';
import {motionArtworkHash} from './documentary-artwork-plan.js';
import {createHash} from 'node:crypto';
import {join} from 'node:path';

/** The preview IPC owns these generated paths. Preserve the paid decision only
 * when replacing posters/proxies; every other semantic input must be identical. */
export function rebaseDocumentaryPreviewMontage(before:Project,scenes:Scene[],root:string):Pick<Project,'scenes'|'settings'> {
  const originals=new Map(before.scenes.map(scene=>[scene.id,scene]));
  let converted=false;
  const normalized=scenes.map(scene=>{
    const original=originals.get(scene.id),doc=original?.documentary;
    if(!original||scene.imagePath===original.imagePath||!doc?.checksum)return scene;
    let output:string|undefined;
    if(original.videoPath&&doc.selected?.kind==='video'){
      const start=original.trimStartSeconds??0,end=original.trimEndSeconds??start+(doc.timing?.durationInFrames??original.durationSeconds*30)/30;
      const time=Math.max(start,Math.min((doc.selected.durationSeconds??end)-.05,(start+end)/2));
      const key=createHash('sha256').update(JSON.stringify([doc.checksum,original.videoPath,time])).digest('hex');
      output=join(root,'Documentary','RangePosters',`${key}.jpg`);
    }else if(doc.selected?.kind==='image'&&Math.max(doc.selected.width??0,doc.selected.height??0)>3840){
      output=join(root,'Documentary','Playback',`${doc.checksum}-3840.png`);
    }
    if(!output||scene.imagePath!==output)return scene;
    converted=true;return {...scene,imagePath:original.imagePath};
  });
  return carryDecision(before,scenes,normalized,converted);
}

function carryDecision(before:Project,scenes:Scene[],normalized:Scene[],converted:boolean):Pick<Project,'scenes'|'settings'> {
  const unchanged={scenes,settings:before.settings},oldHash=semanticMontageHash(before);
  const outcome=before.settings.assembly.documentary?.semanticMontageStatus;
  if(outcome?.inputHash!==oldHash||!converted||semanticMontageHash({...before,scenes:normalized})!==oldHash)return unchanged;
  const inputHash=semanticMontageHash({...before,scenes});
  const artwork=before.settings.assembly.documentary?.motionArtworkStatus,oldArtworkHash=motionArtworkHash(before);
  const carriedArtwork=artwork?.inputHash===oldArtworkHash&&motionArtworkHash({...before,scenes:normalized})===oldArtworkHash
    ?{...artwork,inputHash:motionArtworkHash({...before,scenes})}:undefined;
  return {scenes:scenes.map(scene=>scene.documentary?.semanticMontageInputHash===oldHash
    ?{...scene,documentary:{...scene.documentary,semanticMontageInputHash:inputHash}}:scene),
    settings:{...before.settings,assembly:{...before.settings.assembly,documentary:{...before.settings.assembly.documentary!,
      semanticMontageStatus:{...outcome,inputHash},...(carriedArtwork?{motionArtworkStatus:carriedArtwork}:{})}}}};
}

/** Carry an existing editorial decision across our checked local excerpt conversion.
 * This is called only at the assembly conversion boundary, never on user edits.
 * Receipt keys and the global semantic hash schema remain unchanged. */
export function rebaseDocumentaryExcerptMontage(before:Project,scenes:Scene[]):Pick<Project,'scenes'|'settings'> {
  const unchanged={scenes,settings:before.settings};
  const oldHash=semanticMontageHash(before),outcome=before.settings.assembly.documentary?.semanticMontageStatus;
  if(outcome?.inputHash!==oldHash)return unchanged;
  const originals=new Map(before.scenes.map(scene=>[scene.id,scene]));
  const near=(a:number,b:number)=>Math.abs(a-b)<1e-6;
  let converted=false;
  const normalized=scenes.map(scene=>{
    const original=originals.get(scene.id),excerpt=scene.documentary?.selected?.excerpt;
    if(!original?.videoPath||scene.videoPath===original.videoPath)return scene;
    if(!excerpt||!scene.documentary?.checksum||excerpt.sourceChecksum!==original.documentary?.checksum
      ||original.documentary?.selected?.excerpt||!near(excerpt.sourceDurationSeconds,original.documentary?.selected?.durationSeconds??NaN)
      ||!near((scene.trimStartSeconds??0)+excerpt.startSeconds,original.trimStartSeconds??0)
      ||(original.trimEndSeconds===undefined?scene.trimEndSeconds!==undefined:
        !near((scene.trimEndSeconds??NaN)+excerpt.startSeconds,original.trimEndSeconds)))return scene;
    converted=true;
    return {...scene,videoPath:original.videoPath,trimStartSeconds:original.trimStartSeconds,trimEndSeconds:original.trimEndSeconds,
      documentary:{...scene.documentary,checksum:original.documentary!.checksum}};
  });
  // A changed narration, duration, playback rate, source review or any other
  // semantic input still invalidates the old decision normally.
  return carryDecision(before,scenes,normalized,converted);
}
