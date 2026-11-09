import type {CSSProperties,ReactNode} from 'react';
import {AbsoluteFill} from 'remotion';
import type {DocumentaryArgument} from '@gold-work/shared';
import {fitDocumentaryText} from './documentary-typography.js';

const clamp=(n:number)=>Math.max(0,Math.min(1,n));
const ease=(n:number)=>1-Math.pow(1-clamp(n),4);
type Box={x:number;y:number;w:number;h:number};

/** Both arguments own a permanent safe zone. Typography is fitted only to its
 * final box; an incoming argument can never cover its neighbour or reflow it. */
export function DocumentaryArgumentSequence({argument,frame,frames,width,height,material,accent,moving=true}: {
  argument:DocumentaryArgument;frame:number;frames:number;width:number;height:number;material:ReactNode;accent:string;moving?:boolean;
}){
  const {stage,groups,itemFrames}=argument,u=Math.min(width,height)/1080,portrait=height>width;
  const phase=(start:number,duration=14)=>moving?ease((frame-start)/Math.max(1,duration)):1;
  const current=stage===0?0:1,firstCue=itemFrames[0]??0;
  const zones:Box[]=portrait
    ?[{x:.04,y:.695,w:.92,h:.135},{x:.04,y:.845,w:.92,h:.135}]
    :[{x:.035,y:.695,w:.445,h:.27},{x:.52,y:.695,w:.445,h:.27}];
  const px=(b:Box,w=width,h=height):CSSProperties=>({position:'absolute',left:b.x*w,top:b.y*h,width:b.w*w,height:b.h*h});
  const panel=(i:number)=>{
    if(stage===0&&i===1)return null;
    const g=groups[i]!,b=zones[i]!,pw=b.w*width,ph=b.h*height;
    const prior=i!==current||stage===2,enter=prior?1:phase(firstCue,12);
    const transition=stage===2?phase(itemFrames[i]??0,Math.min(22,Math.max(1,frames*.22))):0;
    const dark=i===1,paper='#f1ece1',ink=dark?paper:'#142029';
    const label=(value:string,r:Box,size:number,bold=false,extra:CSSProperties={},key?:string)=>
      <div data-argument-text={key} style={{...px(r,pw,ph),fontFamily:'Arial,sans-serif',
        fontSize:fitDocumentaryText(value,size*u,r.w*pw,r.h*ph,bold?800:600),fontWeight:bold?800:600,
        lineHeight:1.1,color:ink,whiteSpace:'pre-wrap',overflowWrap:'anywhere',...extra}}>{value}</div>;
    const content:Box={x:.055,y:.34,w:.89,h:.59};
    return <div key={i} data-argument-group={i} data-argument-zone={`${b.x},${b.y},${b.w},${b.h}`} style={{...px(b),
      opacity:enter,transform:`translateY(${(1-enter)*12*u}px)`,overflow:'hidden',background:dark?'#142029':paper,
      borderTop:`${3*u}px solid ${accent}`,boxSizing:'border-box'}}>
      {label(g.title,{x:.055,y:.055,w:.89,h:.22},portrait?44:54,true,{},`heading-${i}`)}
      <div data-argument-content={i} style={{...px(content,pw,ph),overflow:'hidden'}}>
        <div data-argument-list={i} style={{position:'absolute',inset:0,transform:`translateY(${-transition*100}%)`}}>
          {g.items.map((value,j)=>{
            const arrival=prior?1:phase(itemFrames[j]??firstCue,12),count=Math.max(1,g.items.length);
            const r:Box={x:j/count+.012,y:.02,w:1/count-.035,h:.90};
            const cw=content.w*pw,ch=content.h*ph;
            return <div key={j} data-argument-item={`${i}-${j}`} style={{...px(r,cw,ch),opacity:arrival,transform:`translateY(${(1-arrival)*8*u}px)`}}>
              <div style={{position:'absolute',inset:0,fontFamily:'Arial,sans-serif',fontWeight:600,lineHeight:1.1,color:ink,whiteSpace:'pre-wrap',overflowWrap:'anywhere',
                fontSize:fitDocumentaryText(value,(portrait?40:48)*u,r.w*cw,r.h*ch,600)}}>{value}</div>
            </div>;
          })}
        </div>
        <div data-argument-summary={i} style={{position:'absolute',inset:0,transform:`translateY(${(1-transition)*100}%)`}}>
          <div style={{position:'absolute',inset:0,fontFamily:'Arial,sans-serif',fontWeight:800,lineHeight:1.1,color:dark?accent:ink,whiteSpace:'pre-wrap',overflowWrap:'anywhere',
            fontSize:fitDocumentaryText(g.summary,(portrait?62:94)*u,content.w*pw,content.h*ph,800)}}>{g.summary}</div>
        </div>
      </div>
    </div>;
  };
  return <AbsoluteFill data-argument-stage={stage} style={{background:'#11181c',overflow:'hidden'}}>
    <AbsoluteFill data-argument-source>{material}</AbsoluteFill>
    <AbsoluteFill aria-hidden style={{background:'linear-gradient(0deg,#0006,transparent 38%)'}}/>
    {panel(0)}{panel(1)}
  </AbsoluteFill>;
}
