import type {ReactNode} from 'react';
import {AbsoluteFill} from 'remotion';
import type {DocumentaryMotionGraphic} from './documentary-timeline.js';
import {DocumentarySymbol,hasDocumentarySymbol} from './DocumentaryDiagram.js';
import {fitDocumentaryText} from './documentary-typography.js';

export function documentaryObjectBoard(graphic:DocumentaryMotionGraphic) {
  return graphic.origin==='automatic'&&['explainer','feature-list'].includes(graphic.kind)&&graphic.boardLayout!=='compare'
    &&!graphic.argument&&!graphic.sequenceId&&!graphic.panels?.length&&graphic.cards?.length!==undefined
    &&graphic.cards.length>=2&&graphic.cards.length<=4&&graphic.cards.every(c=>!c.sceneId&&!c.imagePath&&hasDocumentarySymbol(c.label));
}

/** These symbols explain the spoken categories; they do not point to imagined
 * locations in a photograph. The original shot remains the main image. */
export function DocumentaryObjectBoard({graphic,frame,frames,width,height,material,accent,moving=true}:{graphic:DocumentaryMotionGraphic;frame:number;frames:number;width:number;height:number;material:ReactNode;accent:string;moving?:boolean}) {
  const cards=graphic.cards!,portrait=height>width,u=Math.min(width,height)/1080;
  const ease=(n:number)=>{const t=Math.max(0,Math.min(1,n));return 1-(1-t)**3;};
  const progress=(i:number)=>moving?ease((frame-i*Math.min(11,frames*.28/cards.length))/19):1;
  const end=moving?Math.min(1,Math.max(0,(frames-1-frame)/10)):1;
  const top=portrait?.58:.65,panelH=1-top;
  const roles=cards.every(c=>/racer|driver|mechanic|engineer|test|гонщик|водител|механик|инженер|испыт/iu.test(c.label));
  const features=cards.every(c=>/headlight|wheel|intake|фар|колес|воздухозаб/iu.test(c.label));
  if(!portrait&&(roles||features)){
    const right=features,railX=right?.68:.065,railWidth=.27;
    return <AbsoluteFill data-object-board={roles?'roles':'features'} style={{overflow:'hidden',background:'#0c131c'}}>
      <AbsoluteFill>{material}</AbsoluteFill>
      <AbsoluteFill style={{background:`linear-gradient(${right?'270':'90'}deg,#09121de8,transparent 65%)`,opacity:end}}/>
      {cards.map((card,i)=>{const p=progress(i),slotH=height*.19,slotW=width*railWidth,icon=100*u,font=fitDocumentaryText(card.label,58*u,slotW-icon-25*u,slotH*.72,700);return <div key={i} style={{position:'absolute',left:width*railX,top:height*(.19+i*.235),width:slotW,height:slotH,opacity:p*end,transform:`translateY(${(1-p)*14*u}px)`,display:'flex',gap:25*u,alignItems:'center'}}>
        <div style={{width:icon,height:icon,flexShrink:0}}><DocumentarySymbol name={card.label} color={accent}/></div>
        <div style={{fontFamily:'Arial,sans-serif',fontSize:font,fontWeight:700,lineHeight:1.12,color:'#faf5ea',textShadow:'0 2px 7px #000',whiteSpace:'pre-wrap',overflowWrap:'break-word'}}>{card.label}</div>
        {i<cards.length-1&&<div aria-hidden style={{position:'absolute',left:icon/2,top:slotH*.92,width:u,height:height*.045,background:accent,opacity:.6}}/>}
      </div>;})}
    </AbsoluteFill>;
  }
  return <AbsoluteFill data-object-board style={{background:'#0c131c',overflow:'hidden'}}>
    <AbsoluteFill>{material}</AbsoluteFill>
    <AbsoluteFill style={{background:'linear-gradient(0deg,#09121df5,transparent 64%)',opacity:end}}/>
    <div style={{position:'absolute',left:'5%',width:'90%',top:`${top*100}%`,height:`${panelH*100}%`,display:'flex',gap:24*u,opacity:end}}>
      {cards.map((card,i)=>{const p=progress(i),slotW=width*.90/cards.length-24*u,icon=portrait?Math.min(slotW*.68,height*.11):height*.135;
        const font=fitDocumentaryText(card.label,52*u,slotW-10*u,height*panelH*.36,700);
        return <div key={i} style={{flex:1,position:'relative',textAlign:'center',opacity:p,transform:`translateY(${(1-p)*18*u}px)`}}>
          <div style={{position:'absolute',top:0,left:'50%',width:icon,height:icon,transform:`translateX(-50%) scale(${.92+.08*p})`,filter:'drop-shadow(0 3px 12px #0008)'}}><DocumentarySymbol name={card.label} color={accent}/></div>
          <div style={{position:'absolute',left:0,right:0,top:icon+22*u,height:height*panelH*.36,fontSize:font,fontFamily:'Arial,sans-serif',fontWeight:700,lineHeight:1.12,color:'#faf5ea',textShadow:'0 2px 7px #000',whiteSpace:'pre-wrap',overflowWrap:'break-word'}}>{card.label}</div>
          {i<cards.length-1&&<div style={{position:'absolute',right:-12*u,top:icon*.2,width:u,height:icon*.65,background:'#d5e6ef66'}}/>}
        </div>;
      })}
    </div>
  </AbsoluteFill>;
}
