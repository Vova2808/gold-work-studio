import type {Project,Scene} from '@gold-work/shared';
import {documentaryMontageHasEvidence} from './documentary-semantic-montage.js';

function editable(scene:Scene):boolean {
  const d=scene.documentary;
  return Boolean(d&&scene.includeInAssembly!==false&&!d.pinned&&d.templateMotion?.amountPercent!==0&&(!d.template||d.templateOrigin==='automatic')
    &&(!d.motionGraphic||d.motionGraphic.origin==='automatic')&&!d.caption.enabled&&!d.texts?.length
    &&!(d.layout==='compare'&&d.comparison)&&(!d.cuts?.length||d.cutsOrigin==='automatic')
    &&!d.effects.some(e=>e.enabled&&e.kind!=='audio'&&e.origin!=='automatic')
    &&!scene.fadeEdges&&(scene.transition===undefined||scene.transition==='none'||scene.transitionDurationSeconds===0));
}

/** An authored span replaces only automatic visuals, never narration or sources. */
export function planDocumentaryArtworkSpans(project:Project):Scene[] {
  if(project.settings.assembly.documentary?.autoMotionGraphics===false)return project.scenes;
  const ordered=[...project.scenes].filter(s=>s.includeInAssembly!==false).sort((a,b)=>a.order-b.order);
  const changes=new Map<string,Scene>();
  for(let first=0;first<ordered.length;first++){
    const direction=ordered[first]!.documentary?.semanticMontage;
    const endId=direction?.artworkSpan?.endSceneId,artwork=direction?.artwork;
    if(!endId||!artwork||artwork.layout!=='full'||artwork.layers.some(l=>l.kind==='media'))continue;
    const last=ordered.findIndex((s,i)=>i>=first&&s.id===endId);
    if(last<=first)continue;
    const members=ordered.slice(first,last+1);
    const sequenceId=`artwork:${ordered[first]!.id}:${endId}`;
    // Artwork briefs contain at most eight scenes. Never let a malformed endpoint
    // silently cover an unbounded tail or another authored composition.
    if(members.length>8||members.some((s,i)=>{
      const d=s.documentary!,g=d?.motionGraphic,semantic=d?.semanticMontage;
      const own=g?.artworkSpan?.endSceneId===endId&&g.sequenceId===sequenceId;
      const evidence=Boolean(semantic?.composition&&['map-locator','map-route','bar-chart','statistic'].includes(semantic.composition.kind))
        ||documentaryMontageHasEvidence(s,project.scenes);
      // A commissioned span supersedes ordinary automatic captions/boards in
      // its covered scenes. Factual evidence and separate authored work win.
      return !editable(s)||i>0&&Boolean(semantic?.artworkSpan||semantic?.chapter||semantic?.explanation||semantic?.artwork)
        ||!own&&(evidence||Boolean(g?.enabled&&(g.diagram||g.explanation||g.argument||i>0&&g.artwork)));
    }))continue;
    for(const [i,scene] of members.entries()){
      const d=scene.documentary!;
      const frames=Math.max(1,d.timing?.durationInFrames??Math.ceil(scene.durationSeconds*30),Math.ceil((scene.durationOverrideSeconds??0)*30));
      changes.set(scene.id,{...scene,autoTransition:i<members.length-1?'none':scene.autoTransition,
        autoTransitionDurationSeconds:i<members.length-1?0:scene.autoTransitionDurationSeconds,
        documentary:{...d,layout:'full',template:undefined,templateOrigin:'automatic',templateTiming:undefined,
          cuts:undefined,cutsOrigin:undefined,comparison:undefined,
          effects:d.effects.filter(e=>e.kind==='audio'||e.origin!=='automatic'),
          templateMotion:{amountPercent:14,curve:'smooth'},
          motionGraphic:{enabled:true,origin:'automatic',kind:'explainer',title:'',hideTitle:true,theme:'paper',
            artwork,artworkSpan:{endSceneId:endId},sequenceId,startSeconds:0,durationSeconds:frames/30}}});
    }
    first=last;
  }
  return project.scenes.map(s=>changes.get(s.id)??s);
}
