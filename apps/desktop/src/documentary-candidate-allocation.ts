import {documentaryMaterialUsable,type DocumentaryCandidate,type Project,type Scene} from '@gold-work/shared';
import {documentarySceneSeconds} from './documentary-sequences.js';

const sourceChecksum=(candidate:DocumentaryCandidate,checksum?:string)=>candidate.excerpt?.sourceChecksum||checksum
  ||candidate.id.match(/^local:([a-f0-9]{64})$/i)?.[1]
  ||candidate.localPath?.match(/(?:^|[/\\])([a-f0-9]{64})\.[^/\\]+$/i)?.[1];

/** Include pending fallback files: they are already part of the assembly. */
export function documentaryCandidateUses(project:Project,scene:Scene,candidate:DocumentaryCandidate,checksum?:string):Scene[]{
  const hash=sourceChecksum(candidate,checksum);
  return project.scenes.filter(other=>{
    const doc=other.documentary,selected=doc?.selected;
    if(other.id===scene.id||other.includeInAssembly===false||!documentaryMaterialUsable(other)||!selected||selected.kind!==candidate.kind)return false;
    return Boolean(hash&&hash===sourceChecksum(selected,doc?.checksum)
      ||checksum&&checksum===doc?.checksum
      ||candidate.id&&candidate.provider===selected.provider&&candidate.id===selected.id
      ||candidate.downloadUrl&&candidate.downloadUrl===selected.downloadUrl
      ||candidate.localPath&&candidate.localPath===selected.localPath);
  });
}

/** Duration in source coordinates, shared by download, review and allocation. */
export const documentaryRequiredSourceSeconds=(scene:Scene)=>documentarySceneSeconds(scene)*Math.max(.1,scene.playbackRate??1);
const sourceSeconds=documentaryRequiredSourceSeconds;
function aspectDistance(project:Project,candidate:DocumentaryCandidate){
  const [width,height]=project.aspectRatio.split(':').map(Number);
  return candidate.width&&candidate.height?Math.abs(Math.log(candidate.width/candidate.height/(width!/height!))):Infinity;
}
export function documentaryFallbackSuitability(project:Project,scene:Scene,candidate:DocumentaryCandidate):number{
  const distance=aspectDistance(project,candidate);
  // Keep adequate duration and broadly matching framing ahead of variety.
  return 3*Number(candidate.kind==='video'&&candidate.durationSeconds!==undefined&&candidate.durationSeconds<sourceSeconds(scene)-.05)
    +(distance<=.35?0:Number.isFinite(distance)?1:2);
}

/** A soft order only: never reject a sparse pool or spend another search. */
export function preferUnusedDocumentaryCandidates(project:Project,scene:Scene,candidates:DocumentaryCandidate[],fallback=false,
  relevance?:(candidate:DocumentaryCandidate)=>number):DocumentaryCandidate[]{
  const ordered=project.scenes.filter(item=>item.includeInAssembly!==false).sort((a,b)=>a.order-b.order);
  const index=ordered.findIndex(item=>item.id===scene.id);
  const adjacent=new Set([ordered[index-1]?.id,ordered[index+1]?.id]);
  const scored=candidates.map((candidate,index)=>{
    const uses=documentaryCandidateUses(project,scene,candidate);
    return {candidate,index,uses:uses.length,adjacent:Number(uses.some(item=>adjacent.has(item.id))),
      quality:fallback?documentaryFallbackSuitability(project,scene,candidate):0,distance:fallback?aspectDistance(project,candidate):0,
      relevance:relevance?.(candidate)??0};
  });
  return scored.sort((a,b)=>a.quality-b.quality
    ||Number(a.uses>0)-Number(b.uses>0)||a.adjacent-b.adjacent||a.uses-b.uses
    ||b.relevance-a.relevance||(a.distance===b.distance?0:a.distance-b.distance)||a.index-b.index).map(item=>item.candidate);
}

/** Allocate in source coordinates, then return times in the prepared file. */
export function documentaryFallbackVideoRange(project:Project,scene:Scene,automaticRecovery=false):Pick<Scene,'trimStartSeconds'|'trimEndSeconds'>{
  const candidate=scene.documentary?.selected;
  if(candidate?.kind!=='video')return {trimStartSeconds:scene.trimStartSeconds,trimEndSeconds:scene.trimEndSeconds};
  const duration=Math.min(candidate.durationSeconds??Infinity,candidate.excerpt?candidate.excerpt.endSeconds-candidate.excerpt.startSeconds:Infinity);
  if(!Number.isFinite(duration)||duration<=0)return {trimStartSeconds:scene.trimStartSeconds,trimEndSeconds:scene.trimEndSeconds};
  const desired=Math.min(duration,sourceSeconds(scene)),offset=candidate.excerpt?.startSeconds??0;
  if(automaticRecovery&&duration<sourceSeconds(scene)-.05)throw Error('В запасном видео нет полного отрезка для текущей озвучки.');
  const uses=documentaryCandidateUses(project,scene,candidate,scene.documentary?.checksum);
  const rangeOf=(other:Scene)=>{
    const source=other.documentary!.selected!,start=other.trimStartSeconds??0,sourceOffset=source.excerpt?.startSeconds??0;
    const end=Math.min(start+sourceSeconds(other),other.trimEndSeconds??Infinity,source.durationSeconds??Infinity,
      source.excerpt?source.excerpt.endSeconds-source.excerpt.startSeconds:Infinity);
    return {start:Math.max(0,start+sourceOffset-offset),end:Math.min(duration,end+sourceOffset-offset)};
  };
  const used=uses.map(rangeOf).filter(range=>range.end>range.start);
  // Only a proven same source can contribute an exclusion. Original source
  // coordinates are translated into this prepared excerpt before allocation.
  const localHash=scene.documentary?.checksum,originalHash=sourceChecksum(candidate,localHash);
  const rejected=automaticRecovery?(scene.documentary?.searchRecovery?.rejectedRanges??[]).filter(range=>
    Boolean(localHash&&range.checksum===localHash||originalHash&&range.checksum===originalHash
      ||range.sourceId===candidate.id&&range.sourceStart!==undefined&&range.sourceEnd!==undefined)).map(range=>({
        start:Math.max(0,range.sourceStart!==undefined?range.sourceStart-offset:range.start-(range.checksum===localHash?0:offset)),
        end:Math.min(duration,range.sourceEnd!==undefined?range.sourceEnd-offset:range.end-(range.checksum===localHash?0:offset))
      })).filter(range=>Number.isFinite(range.start)&&Number.isFinite(range.end)&&range.end>range.start):[];
  const occupied=[...used,...rejected].sort((a,b)=>a.start-b.start);
  const merged:Array<{start:number;end:number}>=[];
  for(const range of occupied){
    const previous=merged.at(-1);
    if(previous&&range.start<=previous.end)previous.end=Math.max(previous.end,range.end);
    else merged.push({...range});
  }
  if(automaticRecovery){
    // An approved later view is a useful location hint, never an approval for
    // the new scene. Prefer its unused continuation over an unrelated intro.
    const continuations=uses.filter(other=>other.documentary?.verified).map(rangeOf).map(range=>range.end)
      .filter(start=>start>=0&&start+desired<=duration+1e-6).sort((a,b)=>b-a);
    const preferred=continuations.find(start=>merged.every(range=>start+desired<=range.start+1e-6||start>=range.end-1e-6));
    if(preferred!==undefined)return {trimStartSeconds:preferred,trimEndSeconds:Math.min(duration,preferred+desired)};
  }
  let start=0;
  for(const range of merged){
    if(range.start-start>=desired-1e-6)break;
    start=Math.max(start,range.end);
  }
  if(duration-start<desired-1e-6){
    if(automaticRecovery)throw Error('В запасном видео не осталось свободного проверяемого отрезка.');
    // A short/depleted source must still complete. Minimize the repeated span.
    const starts=[0,duration-desired,...merged.flatMap(range=>[range.end,range.start-desired])]
      .map(value=>Math.max(0,Math.min(duration-desired,value)));
    const overlap=(value:number)=>merged.reduce((total,range)=>total+Math.max(0,Math.min(value+desired,range.end)-Math.max(value,range.start)),0);
    start=starts.sort((a,b)=>overlap(a)-overlap(b)||a-b)[0]!;
  }
  return {trimStartSeconds:start,trimEndSeconds:Math.min(duration,start+desired)};
}
