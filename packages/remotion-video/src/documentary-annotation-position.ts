/** Only an isolated subject needs room around it; a full-source fallback
 * remains large. Media and pointer coordinates must use the same viewport. */
export function annotationInsets(graphic: {variant?: string;cutoutPath?: string}) {
  return graphic.variant !== 'clean' && graphic.cutoutPath
    ? {horizontal: .09, vertical: .16} : {horizontal: 0, vertical: 0};
}

export function annotationPosition(points:Array<{seconds:number;x:number;y:number}>,seconds:number){
  if(!points.length||!Number.isFinite(seconds)||points.some((p,i)=>!Number.isFinite(p.seconds)||!Number.isFinite(p.x)||!Number.isFinite(p.y)
    ||p.x<0||p.x>100||p.y<0||p.y>100||i>0&&p.seconds<=points[i-1]!.seconds))return;
  if(points.length===1)return points[0];
  if(seconds<points[0]!.seconds||seconds>points.at(-1)!.seconds)return;
  const after=points.findIndex(p=>p.seconds>=seconds),b=points[Math.max(0,after)]!,a=points[Math.max(0,after-1)]!;
  if(seconds===b.seconds)return {x:b.x,y:b.y};
  // Sparse samples are not object tracking. Hide the pointer across a long
  // unsampled interval or a large jump instead of inventing its trajectory.
  if(b.seconds-a.seconds>3.1||Math.hypot(b.x-a.x,b.y-a.y)>25)return;
  const t=b.seconds===a.seconds?0:Math.max(0,Math.min(1,(seconds-a.seconds)/(b.seconds-a.seconds)));
  return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
}

export interface AnnotationLabelBox {x:number;y:number;width:number;height:number}
const overlaps=(a:AnnotationLabelBox,b:AnnotationLabelBox)=>a.x<b.x+b.width+18&&a.x+a.width+18>b.x&&a.y<b.y+b.height+18&&a.y+a.height+18>b.y;

/** A nearby label and one straight leader. No elbow paths or glowing rails. */
export function annotationLabelBox(anchor:{x:number;y:number},width:number,height:number,occupied:AnnotationLabelBox[],anchors:Array<{x:number;y:number}>) {
  const gap=68,clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v));
  const candidates=[
    {x:anchor.x+gap,y:anchor.y-height-gap}, {x:anchor.x-width-gap,y:anchor.y-height-gap},
    {x:anchor.x+gap,y:anchor.y+gap}, {x:anchor.x-width-gap,y:anchor.y+gap},
  ].map(p=>({x:clamp(p.x,96,1824-width),y:clamp(p.y,80,1000-height),width,height}));
  return candidates.find(box=>!occupied.some(other=>overlaps(box,other))&&!anchors.some(p=>
    p.x>box.x-35&&p.x<box.x+width+35&&p.y>box.y-35&&p.y<box.y+height+35));
}

export function annotationLeaderEnd(point:{x:number;y:number},box:AnnotationLabelBox){
  return {x:Math.max(box.x,Math.min(box.x+box.width,point.x)),y:Math.max(box.y,Math.min(box.y+box.height,point.y))};
}
