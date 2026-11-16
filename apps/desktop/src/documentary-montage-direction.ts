import type {DocumentaryTemplate,Scene} from '@gold-work/shared';

/** Source geometry and the saved narrative job choose the frame, never its index. */
export function documentaryDirectedTemplate(scene:Scene,cinematic=false):DocumentaryTemplate {
  const d=scene.documentary,direction=d?.semanticMontage,aspect=(d?.selected?.width??16)/(d?.selected?.height??9);
  if(direction?.treatment==='television')return 'broadcast-scanlines';
  if(direction?.treatment==='archive')return cinematic?'editorial-film-gate':scene.videoPath?'archive-dark':'archive-slide';
  if(scene.videoPath)return direction?.beat==='evidence'?'editorial-film-gate':'full';
  if(aspect>2.8||aspect<.65)return 'contain';
  if(direction?.treatment==='subject')return aspect<1?'portrait-stage':'museum-mat';
  if(direction?.beat==='establish'||direction?.beat==='resolve')return 'pull';
  if(direction?.beat==='conflict'||direction?.beat==='turn')return 'push';
  if(direction?.beat==='explain')return 'paper-grid';
  if(direction?.beat==='evidence')return 'museum-mat';
  return 'full';
}

/** Snap only to real measured gaps from this narration; never infer word times. */
export function documentaryPauseAlignedLengths(scene:Scene,lengths:number[],capacities:number[],minimum:number):number[] {
  const reading=scene.documentary?.motionGraphic?.reading,timing=scene.documentary?.timing;
  if(!reading?.sourceKey||reading.sourceKey!==timing?.sourceKey||lengths.length<2)return lengths;
  const offset=scene.documentary?.motionGraphic?.startSeconds??0;
  const words=[...reading.words].sort((a,b)=>a.startSeconds-b.startSeconds);
  const pauses=words.slice(1).flatMap((word,i)=>{
    const before=words[i]!,gap=word.startSeconds-before.endSeconds;
    return Number.isFinite(gap)&&gap>=.12&&before.endSeconds>=0
      ?[Math.round((offset+(before.endSeconds+word.startSeconds)/2)*30)]:[];
  });
  const result=[...lengths];let boundary=0;
  for(let i=0;i<result.length-1;i++){
    boundary+=result[i]!;
    const nearest=pauses.filter(at=>Math.abs(at-boundary)<=24).sort((a,b)=>Math.abs(a-boundary)-Math.abs(b-boundary))
      .find(at=>result[i]!+at-boundary>=minimum&&result[i]!+at-boundary<=capacities[i]!
        &&result[i+1]!-at+boundary>=minimum&&result[i+1]!-at+boundary<=capacities[i+1]!);
    if(nearest===undefined)continue;
    const delta=nearest-boundary;result[i]!+=delta;result[i+1]!-=delta;boundary=nearest;
  }
  return result;
}
