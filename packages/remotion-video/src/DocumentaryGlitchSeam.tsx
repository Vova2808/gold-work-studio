import type {ReactNode} from 'react';
import {AbsoluteFill} from 'remotion';

/** Both sides share this clock on the existing dissolve overlap. No duplicate
 * media nodes, random flicker, time remapping or audio processing. */
export function documentaryGlitchPulse(frame:number,frames:number) {
  const count=Math.min(8,Math.max(0,Math.floor(frames)));
  if(frame<0||frame>=count||count<2)return {x:0,amount:0};
  const index=Math.floor(frame/Math.max(1,count-1)*7);
  const offsets=[-3,5,-4,2,-1,2,0,0],amounts=[.35,.7,.5,.35,.22,.18,.08,0];
  return {x:offsets[index]!,amount:amounts[index]!};
}

export function DocumentaryGlitchSeam({frame,frames,enabled,children}:{frame:number;frames:number;enabled:boolean;children:ReactNode}) {
  const pulse=enabled?documentaryGlitchPulse(frame,frames):{x:0,amount:0};
  return <AbsoluteFill data-glitch-seam={pulse.amount>0||undefined} style={{overflow:'hidden'}}>
    <AbsoluteFill style={pulse.amount?{transform:`translateX(${pulse.x}px) scale(1.008)`,filter:`contrast(${1+pulse.amount*.12})`}:undefined}>{children}</AbsoluteFill>
    {pulse.amount>0&&[22,51,76].map((top,index)=><div key={top} aria-hidden style={{position:'absolute',top:`${top+(frame%2)*2}%`,left:0,right:0,height:index===1?'1.2%':'.5%',
      opacity:pulse.amount*.28,background:index===1?'linear-gradient(90deg,#e3f6f8,transparent 80%)':'linear-gradient(90deg,#55d5d5,transparent 40%,#de648c)',mixBlendMode:'screen',pointerEvents:'none'}}/>)}
  </AbsoluteFill>;
}
