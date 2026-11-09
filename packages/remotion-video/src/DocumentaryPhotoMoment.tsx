import type {ReactNode} from 'react';
import {AbsoluteFill,Freeze} from 'remotion';
import type {DocumentaryMotionGraphic} from './documentary-timeline.js';
import {fitDocumentaryText} from './documentary-typography.js';

const clamp=(n:number)=>Math.max(0,Math.min(1,n));
const ease=(n:number)=>1-Math.pow(1-clamp(n),3);
/** The source becomes the object of the narration. Exactly one live/frozen
 * surface is mounted, at the same source time; the original clip is untouched. */
export function DocumentaryPhotoMoment({graphic,frame,sceneStart,width,height,material,accent,moving}: {
  graphic:DocumentaryMotionGraphic;frame:number;sceneStart:number;width:number;height:number;material:ReactNode;accent:string;moving:boolean;
}){
  const cue=graphic.photoMoment!,u=Math.min(width,height)/1080,portrait=height>width;
  const capture=cue.captureFrame,opening=moving?ease((frame-capture)/22):1;
  const reveal=moving?ease((frame-(cue.consequenceFrame??1e8))/12):1;
  const held=moving&&frame>=capture;
  const consequenceProgress=cue.consequence?reveal:0;
  const printScale=1-.10*opening,captionHeight=portrait?.18:.12;
  const titleFont=fitDocumentaryText(graphic.title,70*u,width*.82,height*captionHeight*.80,650);
  const consequenceFont=fitDocumentaryText(cue.consequence??'',128*u,width*.76,height*.19,750);
  return <AbsoluteFill data-photo-moment style={{background:'#101418',overflow:'hidden'}}>
    <AbsoluteFill style={{background:'radial-gradient(ellipse at center,#3b4244,#11161a 72%)'}}/>
    <AbsoluteFill style={{transform:`translateY(${-opening*height*.04}px) scale(${printScale}) rotate(${-opening*.6}deg)`,
      transformOrigin:'50% 45%',boxShadow:`0 ${24*opening*u}px ${55*opening*u}px #000b`,border:`${14*opening*u}px solid #f5f1e7`,boxSizing:'border-box'}}>
      <AbsoluteFill style={{overflow:'hidden',filter:`saturate(${1-.55*opening}) contrast(${1+.06*opening})`}}>
        {held?<Freeze frame={sceneStart+capture}>{material}</Freeze>:material}
      </AbsoluteFill>
      <div style={{position:'absolute',left:0,right:0,bottom:0,height:height*(captionHeight+.14*consequenceProgress),background:'#f5f1e7',
        transform:`translateY(${(1-opening)*height*captionHeight}px)`,padding:`${18*u}px ${42*u}px`,boxSizing:'border-box',
        fontFamily:'Bahnschrift,"Segoe UI",Arial,sans-serif',fontSize:titleFont*(1-.32*consequenceProgress),fontWeight:600,color:'#17212a',lineHeight:1.05}}>
        <div style={{opacity:1-.35*consequenceProgress}}>{graphic.title}</div>
        {cue.consequence&&<div style={{position:'absolute',left:42*u,right:42*u,bottom:16*u,height:height*.15,
          clipPath:`inset(0 ${(1-reveal)*100}% 0 0)`,fontSize:consequenceFont*.75,fontWeight:750,lineHeight:1.06,color:'#10202b'}}>
          <span style={{borderBottom:`${7*u}px solid ${accent}`}}>{cue.consequence}</span>
        </div>}
      </div>
    </AbsoluteFill>
  </AbsoluteFill>;
}
