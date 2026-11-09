import {AbsoluteFill} from 'remotion';
import {useMemo} from 'react';
import {fitDocumentaryText} from './documentary-typography.js';
import {documentaryEditorialStages} from './documentary-editorial.js';

/** The caller supplies a real script heading. No invented number or language. */
export function DocumentaryChapter({title,number,kicker,frame,frames,accent,textColor,variant,holdToEnd=false,motionEnabled=true}:{title:string;number?:string;kicker?:string;frame:number;frames:number;accent:string;textColor:string;variant?:string;holdToEnd?:boolean;motionEnabled?:boolean}) {
  const {main:enter,detail:textEnter,settle:line}=documentaryEditorialStages(frame,frames,motionEnabled);
  const frameVariant=variant==='technical',echo=variant==='poster';
  const opacity=holdToEnd||!motionEnabled||frames<=2?1:Math.min(1,Math.max(0,(frames-frame)/Math.max(1,Math.min(8,frames*.08))));
  const titleSize=useMemo(()=>fitDocumentaryText(title,number?112:122,1500,300,750),[title,number]);
  return <AbsoluteFill style={{pointerEvents:'none',opacity}}>
    <AbsoluteFill style={{background:'radial-gradient(ellipse,transparent 20%,#0009 100%)',opacity:enter*.55}}/>
    <svg viewBox="0 0 1920 1080" width="100%" height="100%" style={{fontFamily:'Arial,sans-serif'}}>
      {echo&&<g opacity={enter*.12}>{[150,405,660,915].map((y,index)=><foreignObject key={y} x={-140+(index%2?1:-1)*100*(1-textEnter)} y={y-130} width="2200" height="230"><div style={{fontSize:180,fontWeight:900,color:accent,whiteSpace:'nowrap'}}>{title}</div></foreignObject>)}</g>}
      {frameVariant&&<g stroke={accent} strokeWidth="26" fill="none" opacity={enter}>
        <path d="M145 420V210H420" transform={`translate(${(1-enter)*-80} ${(1-enter)*-60})`}/>
        <path d="M1775 660V870H1500" transform={`translate(${(1-enter)*80} ${(1-enter)*60})`}/>
      </g>}
      {kicker&&<foreignObject x="310" y="252" width="1300" height="92" opacity={enter}><div style={{fontSize:fitDocumentaryText(kicker,30,1300,92,600),fontWeight:600,lineHeight:1.15,textAlign:'center',color:textColor,whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{kicker}</div></foreignObject>}
      {number&&<g opacity={enter} transform={`translate(960 ${500+(1-enter)*110}) scale(${.76+.24*enter})`}>
        <text textAnchor="middle" fill={accent} fontWeight="800" fontSize="156" style={{filter:'drop-shadow(0 6px 0 #0007)'}}>{number}</text>
      </g>}
      <foreignObject x="210" y={number?585:390} width="1500" height="320" opacity={textEnter} transform={`translate(${(1-textEnter)*(frameVariant?-46:0)} ${(1-textEnter)*42})`}>
        <div style={{fontSize:titleSize,fontWeight:750,lineHeight:1.12,color:textColor,textAlign:'center',whiteSpace:'pre-wrap',overflowWrap:'anywhere',textShadow:'0 3px 16px #000a'}}>{title}</div>
      </foreignObject>
      <path d={`M${960-600*line} ${number?935:768}H${960+600*line}`} stroke={accent} strokeWidth={frameVariant?10:4} opacity={line}/>
    </svg>
  </AbsoluteFill>;
}
