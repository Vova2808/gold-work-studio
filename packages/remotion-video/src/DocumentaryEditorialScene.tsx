import type {ReactNode} from 'react';
import {AbsoluteFill} from 'remotion';
import {documentaryEase} from './documentary-design.js';
import {DocumentaryBackground} from './DocumentaryBackground.js';

/** Single-source compositions: one decoder, no invented second illustration. */
export function DocumentaryEditorialScene({template,frame,frames,material,accent}:{template:string;frame:number;frames:number;material:ReactNode;accent:string}) {
  const enter=documentaryEase(frame/22),travel=documentaryEase(frame/Math.max(1,frames-1));
  const orbit=template==='editorial-orbit',gate=template==='editorial-film-gate',shutters=template==='editorial-shutters';
  return <AbsoluteFill style={{overflow:'hidden',perspective:1600}}>
    <DocumentaryBackground kind={orbit?'grid-dark':'grid-light'} frame={frame}/>
    {orbit&&[0,1,2].map(i=><div key={i} style={{position:'absolute',left:`${42+i*6}%`,top:`${-22+i*4}%`,width:'65%',height:'145%',border:`${i===0?3:1}px solid ${accent}55`,borderRadius:'50%',transform:`rotate(${26+i*24+travel*8}deg)`}}/>)}
    <div style={{position:'absolute',inset:gate?'6% 3%':orbit?'8% 6%':shutters?'4% 4%':'7% 4%',overflow:'hidden',background:'#10171d',
      boxShadow:'0 18px 60px #0005',border:gate?'14px solid #0c1116':'1px solid #ffffff66',
      transform:orbit?`rotateY(${-9+travel*6}deg) rotateZ(${-1.3+travel*1.8}deg) translateY(${(1-enter)*40}px)`:gate?`translateX(${(1-enter)*60}px) rotate(${-1+travel*1.2}deg)`:`scale(${.97+.03*enter})`,
      clipPath:template==='editorial-iris'?`circle(${8+enter*68}% at ${45+travel*8}% 50%)`:undefined}}>{material}
      {shutters&&[0,1,2,3].map(i=><div key={i} style={{position:'absolute',left:`${i*25}%`,top:0,width:'25.2%',height:'100%',background:i%2?'#ebede4':'#10191e',transform:`translateY(${(i%2?-1:1)*documentaryEase((frame-i*3)/19)*105}%)`}}/>)}
      {gate&&[0,1].map(side=><div key={side} style={{position:'absolute',left:0,right:0,[side?'bottom':'top']:0,height:'4%',background:'#10151a',display:'flex',justifyContent:'space-around',alignItems:'center'}}>{Array.from({length:25},(_,i)=><i key={i} style={{width:'1.6%',height:'52%',borderRadius:2,background:'#e6e5da',opacity:.8}}/>)}</div>)}
    </div>
    {!gate&&<div style={{position:'absolute',bottom:'3%',left:'6%',width:`${12+travel*18}%`,height:4,background:accent,transformOrigin:'left',transform:`scaleX(${enter})`}}/>}
  </AbsoluteFill>;
}
