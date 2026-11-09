import {annotationInsets,annotationPosition} from './documentary-annotation-position.js';
import type {DocumentaryMotionGraphic} from './documentary-timeline.js';

/** Lens and source share contain-fit geometry. No unverified target, no lens. */
export function documentaryMagnifierGeometry(graphic:DocumentaryMotionGraphic,seconds:number,aspect:number,width:number,height:number) {
  if(!Number.isFinite(aspect)||aspect<=0||width<=0||height<=0)return;
  const annotation=graphic.annotations?.find(item=>item.label.trim()&&(graphic.origin==='manual'||(item.confidence??0)>=.93)&&annotationPosition(item.points,seconds));
  const point=annotation&&annotationPosition(annotation.points,seconds);
  if(!point)return;
  const inset=annotationInsets(graphic),availableW=width*(1-2*inset.horizontal),availableH=height*(1-2*inset.vertical);
  const sourceW=Math.min(availableW,availableH*aspect),sourceH=sourceW/aspect;
  const source={x:(width-sourceW)/2,y:(height-sourceH)/2,width:sourceW,height:sourceH};
  const anchor={x:source.x+point.x/100*sourceW,y:source.y+point.y/100*sourceH};
  const radius=Math.min(width,height)*.15,zoom=Math.max(1.2,Math.min(4,Number.isFinite(graphic.zoom)?graphic.zoom!:2.4));
  const bounded=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
  const lens={x:bounded(anchor.x+(anchor.x>width/2?-1:1)*radius*2.2,radius+width*.04,width-radius-width*.04),y:bounded(anchor.y-radius*.55,radius+height*.06,height-radius-height*.06)};
  // Translate the SAME source point to the centre of the scaled duplicate.
  const image={left:radius-point.x/100*sourceW*zoom,top:radius-point.y/100*sourceH*zoom,width:sourceW*zoom,height:sourceH*zoom};
  return {source,anchor,radius,zoom,lens,image,label:annotation!.label};
}
