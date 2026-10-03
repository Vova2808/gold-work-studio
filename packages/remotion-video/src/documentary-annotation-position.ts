/** Only an isolated subject needs room around it; a full-source fallback
 * remains large. Media and pointer coordinates must use the same viewport. */
export function annotationInsets(graphic: {variant?: string;cutoutPath?: string}) {
  return graphic.variant !== 'clean' && graphic.cutoutPath
    ? {horizontal: .09, vertical: .16} : {horizontal: 0, vertical: 0};
}

export function annotationPosition(points:Array<{seconds:number;x:number;y:number}>,seconds:number){
  if(!points.length)return;
  if(points.length===1)return points[0];
  if(seconds<points[0]!.seconds||seconds>points.at(-1)!.seconds)return;
  const after=points.findIndex(p=>p.seconds>=seconds),b=points[Math.max(0,after)]!,a=points[Math.max(0,after-1)]!;
  const t=b.seconds===a.seconds?0:Math.max(0,Math.min(1,(seconds-a.seconds)/(b.seconds-a.seconds)));
  return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
}
