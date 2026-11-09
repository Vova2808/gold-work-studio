import {AbsoluteFill,Img,useVideoConfig} from 'remotion';
import {useMemo} from 'react';
import type {DocumentaryMotionGraphic} from './documentary-timeline.js';
import {DocumentaryBackground} from './DocumentaryBackground.js';
import {documentaryEase} from './documentary-design.js';
import {resolveMediaSource} from './MediaSurface.js';
import {documentaryRevealFrame} from './documentary-editorial.js';
import {fitDocumentaryText} from './documentary-typography.js';

function ObjectLabel({text,size,width,height}:{text:string;size:number;width:number;height:number}) {
  const font=useMemo(()=>fitDocumentaryText(text,size,width,height,700),[text,size,width,height]);
  return <span style={{fontSize:font,overflowWrap:'anywhere',whiteSpace:'pre-wrap'}}>{text}</span>;
}

/** A small board of supplied 2D objects, arriving one after another. */
export function DocumentaryObjectComposition({graphic,frame,frames,customBackground=false}:{graphic:DocumentaryMotionGraphic;frame:number;frames:number;customBackground?:boolean}) {
  const {width,height}=useVideoConfig(),unit=width/1920;
  const local=documentaryRevealFrame(frame,frames);
  const cards=graphic.cards?.filter(card=>card.imagePath).slice(0,4)??[];
  const paper=graphic.theme!=='dark',ink=paper?'#17232b':'#f4f5ef',accent=graphic.accentColor??(paper?'#246f82':'#a9d9e4');
  const twoRows=cards.length>2,columns=twoRows?2:cards.length;
  const step=Math.min(14,Math.max(3,(frames-28)/Math.max(1,cards.length)));
  const fade=Math.min(1,Math.max(0,(frames-1-frame)/8));
  return <AbsoluteFill style={{overflow:'hidden',opacity:fade,fontFamily:'Arial,sans-serif'}}>
    {!customBackground&&<DocumentaryBackground kind={graphic.background??(paper?'grid-light':'grid-dark')} frame={frame}/>}
    {cards.map((card,index)=>{
      const arrival=documentaryEase((local-index*step)/22),label=documentaryEase((local-index*step-16)/16);
      return <div key={index} style={{position:'absolute',left:`${6+(index%columns)*46}%`,top:`${twoRows?20+Math.floor(index/2)*38:28}%`,width:columns===1?'88%':'42%',height:twoRows?'34%':'57%'}}>
        <div style={{position:'absolute',inset:'0 0 22%',opacity:arrival,transform:`translateY(${(1-arrival)*190}%) scale(${.94+.06*arrival})`}}>
          <Img src={resolveMediaSource(card.imagePath!)} style={{width:'100%',height:'100%',objectFit:'contain',filter:'drop-shadow(0 9px 12px #0004)'}}/>
        </div>
        <div style={{position:'absolute',top:'80%',width:'100%',textAlign:'center',color:ink,fontSize:(twoRows?36:46)*unit,lineHeight:1.1,fontWeight:700,opacity:label,transform:`translateY(${(1-label)*20*unit}px)`}}>
          <span style={{background:customBackground?(paper?'#f1f1e8e6':'#10161ce6'):undefined,padding:'4px 8px',boxDecorationBreak:'clone'}}><ObjectLabel text={[card.value,card.label].filter(Boolean).join(' · ')} size={(twoRows?36:46)*unit} width={width*(columns===1?.88:.42)-32*unit} height={height*(twoRows?.075:.12)}/></span>
        </div>
      </div>;
    })}
    {!graphic.hideTitle&&<div style={{position:'absolute',top:'6%',left:'7%',width:'86%',color:ink,textAlign:'center',fontWeight:700,lineHeight:1.12,opacity:documentaryEase((local-10)/18),transform:`translateY(${(1-documentaryEase((local-10)/18))*35*unit}px)`}}><span style={{background:customBackground?(paper?'#f1f1e8e6':'#10161ce6'):undefined,padding:'4px 8px',boxDecorationBreak:'clone'}}><ObjectLabel text={graphic.title} size={64*unit} width={width*.86-32*unit} height={height*.12}/></span></div>}
  </AbsoluteFill>;
}
