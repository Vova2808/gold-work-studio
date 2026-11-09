import type {DocumentaryMotionGraphic,Scene} from '@gold-work/shared';

/** Same layouts for machinery, nature, history and any other narrated subject.
 * All displayed content comes from the existing plan/text and verified posters. */
export function explainDocumentaryGraphic(graphic:DocumentaryMotionGraphic):DocumentaryMotionGraphic{
  if(graphic.kind==='feature-list'&&graphic.presentation!=='panels'&&graphic.presentation!=='list'&&graphic.items?.length){
    return {...graphic,kind:'explainer',theme:'paper',presentation:undefined,boardLayout:'parts',
      cards:graphic.items.map((label,i)=>({label,sceneId:graphic.panels?.[i]?.sceneId}))};
  }
  return graphic;
}

export function documentaryDetailAnnotations(scene:Scene):DocumentaryMotionGraphic|undefined{
  const doc=scene.documentary,review=doc?.visualReview;
  if(!doc?.verified||review?.status!=='accepted'||!review.annotations?.length||!doc.checksum||doc.cuts?.length)return;
  const trim=scene.videoPath?scene.trimStartSeconds??0:0,rate=scene.playbackRate??1;
  const duration=(doc.timing?.durationInFrames??scene.durationSeconds*30)/30;
  const annotations=review.annotations.flatMap(annotation=>{
    if(scene.videoPath&&annotation.points.length<3)return [];
    const points=annotation.points.map(p=>({...p,seconds:(p.seconds-trim)/rate}));
    // No extrapolation across an edited trim or a different selected interval.
    if(scene.videoPath&&(points[0]!.seconds<-.2||points.at(-1)!.seconds>duration+.2))return [];
    return [{...annotation,points}];
  });
  if(!annotations.length)return;
  return {kind:'annotations',enabled:true,title:'',annotations,variant:'clean',isolateSubject:false,sourceChecksum:doc.checksum,
    sourceTrimStartSeconds:trim,sourcePlaybackRate:rate,startSeconds:0,durationSeconds:duration,origin:'automatic'};
}
