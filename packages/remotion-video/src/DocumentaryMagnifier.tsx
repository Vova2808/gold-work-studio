import type {ReactNode} from 'react';
import {AbsoluteFill} from 'remotion';
import type {DocumentaryMotionGraphic} from './documentary-timeline.js';
import {documentaryMagnifierGeometry} from './documentary-magnifier.js';
import {documentaryEase} from './documentary-design.js';
import {documentaryRevealFrame} from './documentary-editorial.js';

/** The duplicate must be muted and use the original trim/rate, supplied by DocumentaryVideo. */
export function DocumentaryMagnifier({graphic,frame,frames,aspect,width,height,material,accent}:{graphic:DocumentaryMotionGraphic;frame:number;frames:number;aspect:number;width:number;height:number;material:ReactNode;accent:string}) {
  const geometry=documentaryMagnifierGeometry(graphic,frame/30,aspect,width,height);
  if(!geometry)return null;
  const local=documentaryRevealFrame(frame,frames),enter=documentaryEase((local-8)/24),line=documentaryEase((local-25)/16);
  const {radius,anchor,lens,image}=geometry,x=lens.x+(1-enter)*width*.22,y=lens.y;
  const dx=anchor.x-x,dy=anchor.y-y,distance=Math.max(1,Math.hypot(dx,dy));
  return <AbsoluteFill style={{pointerEvents:'none',opacity:enter,overflow:'hidden'}}>
    <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} style={{position:'absolute'}}>
      <path d={`M${anchor.x} ${anchor.y}L${x+dx/distance*radius} ${y+dy/distance*radius}`} fill="none" stroke={accent} strokeWidth={Math.max(2,width/760)} pathLength="1" strokeDasharray="1" strokeDashoffset={1-line}/>
      <circle cx={anchor.x} cy={anchor.y} r={width/260} fill="none" stroke={accent} strokeWidth={2} opacity={line}/>
    </svg>
    <div style={{position:'absolute',left:x-radius,top:y-radius,width:radius*2,height:radius*2,borderRadius:'50%',overflow:'hidden',background:'#10161c',boxShadow:`0 0 0 ${width/480}px ${accent},0 14px 30px #0009`}}>
      <div style={{position:'absolute',...image}}>{material}</div>
      <AbsoluteFill style={{borderRadius:'50%',boxShadow:'inset 0 0 0 3px #ffffff60,inset 0 0 22px #0003'}}/>
    </div>
  </AbsoluteFill>;
}
