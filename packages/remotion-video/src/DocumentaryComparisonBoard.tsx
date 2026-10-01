import type {ReactNode} from 'react';
import {AbsoluteFill} from 'remotion';
import {DocumentaryBackground} from './DocumentaryBackground.js';
import {documentaryEase} from './documentary-design.js';

/** Two independently verified materials; this component never invents a source. */
export function DocumentaryComparisonBoard({template,frame,left,right,labels,accent,customBackground=false}:{template:string;frame:number;left:ReactNode;right:ReactNode;labels:Array<string|undefined>;accent:string;customBackground?:boolean}){
  const dossier=template==='compare-dossier',paper=template==='compare-diagonal',film=template==='compare-filmstrip',reveal=template==='compare-reveal',dark=dossier||film;
  const boxes=dossier?[[5,23,55,61],[63,17,32,54]]:[[6,21,42,59],[52,21,42,59]];
  return <AbsoluteFill>
    {!customBackground&&<DocumentaryBackground kind={dark?'grid-dark':paper?'diagonal':'grid-light'} frame={frame} accent={accent}/>}
    {[left,right].map((material,i)=>{const b=boxes[i]!,arrival=documentaryEase(Math.max(0,Math.min(1,(frame-i*8)/24)));
      return <div key={i} style={{position:'absolute',left:`${b[0]}%`,top:`${b[1]}%`,width:`${b[2]}%`,height:`${b[3]}%`,transform:`translate(${reveal?(1-arrival)*(i?90:-90):0}px,${reveal?0:(1-arrival)*70}px) rotate(${paper?(i?2:-2):0}deg)`,opacity:arrival}}>
        <AbsoluteFill style={{background:dark?'#141c25':'#fffef7',padding:film?'5% 1%':paper?'2.5%':'1%',boxSizing:'border-box',boxShadow:'0 16px 36px #0004',border:paper?'1px solid #20252b22':`2px solid ${dark?'#ffffff55':'#242b3544'}`,clipPath:reveal?`inset(0 ${i?0:(1-arrival)*100}% 0 ${i?(1-arrival)*100:0}%)`:undefined}}><div style={{width:'100%',height:'100%',position:'relative',overflow:'hidden'}}>{material}</div></AbsoluteFill>
        <div style={{position:'absolute',top:'104%',left:0,right:0,fontFamily:'Arial,sans-serif',fontSize:34,fontWeight:700,color:dark?'#eef1f7':'#14202b',lineHeight:1.12,overflowWrap:'anywhere',padding:'8px 12px',borderTop:`4px solid ${accent}`}}>{labels[i]}</div>
        {film&&[0,1].map(edge=><div key={edge} style={{position:'absolute',left:'2%',right:'2%',height:'2.2%',top:edge?'96%':'2%',background:'repeating-linear-gradient(90deg,#c5c1ad 0 14px,transparent 14px 40px)'}}/>)}
        {paper&&<div style={{position:'absolute',top:'-3%',left:'37%',width:'26%',height:'6%',background:'#e8dca2bb',transform:'rotate(-4deg)'}}/>}
      </div>;
    })}
    <svg viewBox="0 0 1920 1080" width="100%" height="100%" style={{position:'absolute',pointerEvents:'none'}}>
      <path d="M110 110H430" stroke={accent} strokeWidth="8"/><path d="M1810 970H1510" stroke={accent} strokeWidth="5"/>
      {reveal&&<path d={`M960 215V${215+660*documentaryEase(Math.min(1,frame/30))}`} stroke={accent} strokeWidth="5"/>}
      {dossier&&<path d="M1130 550H1180V480H1210" fill="none" stroke={accent} strokeWidth="3" pathLength="1" strokeDasharray="1" strokeDashoffset={1-documentaryEase(Math.min(1,Math.max(0,(frame-15)/25)))}/>}
    </svg>
  </AbsoluteFill>;
}
