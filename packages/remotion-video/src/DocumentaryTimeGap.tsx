import {AbsoluteFill} from 'remotion';
import {fitDocumentaryText} from './documentary-typography.js';
import {documentaryTimeGapGeometry,documentaryTimeGapState,documentaryTimeNumber,documentaryTimeBound,documentaryTimePolar,documentaryTimeSector,documentaryTimeDialLabels} from './documentary-time-gap.js';

/** A calibrated temporal interval, independent of source photography. */
export function DocumentaryTimeGap({amount,label,frame,frames,moving,accent,portrait=false}:{
  amount:number;label:string;frame:number;frames:number;moving:boolean;accent:string;portrait?:boolean;
}) {
  if(!Number.isFinite(amount)||amount<0||!label.trim())return null;
  const g=documentaryTimeGapGeometry(portrait,amount),p=documentaryTimeGapState(frame,frames,moving);
  const font=fitDocumentaryText(label,g.mode==='fraction'?(portrait?128:120):112,g.label.w,g.label.h,800);
  const ink='#f7f3e9',muted='#a7b1bc',axis='#75808c';
  const bound=documentaryTimeBound(label),percentage=`${bound}${documentaryTimeNumber(g.fraction*100)}%`,dial=g.dial;
  const endpoint=documentaryTimePolar(dial.x,dial.y,dial.r,g.fraction),inner=documentaryTimePolar(dial.x,dial.y,dial.inner,g.fraction);
  const markerX=g.axis.x+g.axis.w*g.fraction;
  return <AbsoluteFill data-documentary-time-gap={g.mode} style={{overflow:'hidden',background:'#101923',fontFamily:'Arial,sans-serif'}}>
    <svg viewBox={`0 0 ${g.width} ${g.height}`} width="100%" height="100%" style={{position:'absolute'}}>
      {g.mode==='fraction'?<>
        <circle cx={dial.x} cy={dial.y} r={(dial.r+dial.inner)/2} fill="none" stroke="#293b48" strokeWidth={dial.r-dial.inner}/>
        <path data-time-sector data-time-fraction={g.fraction} d={documentaryTimeSector(dial,g.fraction*p.interval)} fill={accent} opacity={bound?.62:1}/>
        {Array.from({length:20},(_,i)=>{
          const major=i%5===0,a=documentaryTimePolar(dial.x,dial.y,dial.r+12,i/20),b=documentaryTimePolar(dial.x,dial.y,dial.r+(major?39:25),i/20);
          return <path key={i} d={`M${a.x} ${a.y}L${b.x} ${b.y}`} stroke={major?ink:axis} strokeWidth={major?4:2}/>;
        })}
        {documentaryTimeDialLabels(dial).map(caption=><text key={caption.value} data-time-tick-label={caption.value} x={caption.x} y={caption.y}
          textAnchor={caption.anchor} dominantBaseline="middle" fontSize={caption.fontSize} fill={muted}>{caption.text}</text>)}
        <text x={dial.x} y={dial.y+15} textAnchor="middle" fontSize={Math.min(112,dial.inner*1.7/(percentage.length*.56))} fontWeight="800" fill={ink}>{percentage}</text>
        <text data-time-reference x={dial.x} y={dial.y+80} textAnchor="middle" fontSize="32" fill={muted}>1 s = 100%</text>
        <g opacity={p.second}>
          <path d={`M${inner.x} ${inner.y}L${endpoint.x} ${endpoint.y}`} stroke={ink} strokeWidth="4"/>
          <circle cx={endpoint.x} cy={endpoint.y} r="9" fill={bound?'#101923':ink} stroke={ink} strokeWidth="3"/>
        </g>
      </>:<>
        <text x={g.delta.x} y={g.delta.y} fontSize="52" fontStyle="italic" fill={muted}>Δt</text>
        <rect x={g.axis.x} y={g.axis.y-g.axis.h/2} width={g.axis.w} height={g.axis.h} fill="#293b48"/>
        <rect data-time-span data-time-seconds={amount} x={g.axis.x} y={g.axis.y-g.axis.h/2} width={g.axis.w*g.fraction*p.interval} height={g.axis.h} fill={accent} opacity={bound?.62:1}/>
        {g.ticks.map(t=>{const x=g.axis.x+g.axis.w*t/g.maxSeconds;return <g key={t}>
          <path d={`M${x} ${g.axis.y-g.axis.h/2-13}V${g.axis.y+g.axis.h/2+26}`} stroke={ink} strokeWidth="3"/>
          <text x={x} y={g.axis.y+g.axis.h/2+88} textAnchor="middle" fontSize="42" fill={muted}>{documentaryTimeNumber(t)}</text>
        </g>;})}
        <g opacity={p.second}>
          <path d={`M${markerX} ${g.axis.y-g.axis.h/2-52}V${g.axis.y+g.axis.h/2+42}`} stroke={ink} strokeWidth="5"/>
          <text x={markerX} y={g.axis.y-g.axis.h/2-82} textAnchor="end" fontSize="64" fontWeight="700" fill={ink}>{bound}{documentaryTimeNumber(amount)} s</text>
          {bound&&<path d={bound==='>'||bound==='≥'?`M${markerX+12} ${g.axis.y}H${markerX+60}M${markerX+45} ${g.axis.y-14}L${markerX+60} ${g.axis.y}L${markerX+45} ${g.axis.y+14}`
            :`M${markerX-12} ${g.axis.y}H${markerX-60}M${markerX-45} ${g.axis.y-14}L${markerX-60} ${g.axis.y}L${markerX-45} ${g.axis.y+14}`} fill="none" stroke={ink} strokeWidth="4"/>}
        </g>
        <text data-time-reference x={g.axis.x+g.axis.w} y={g.axis.y+(portrait?310:290)} textAnchor="end" fontSize="38" fill={muted}>0–{documentaryTimeNumber(g.maxSeconds)} s</text>
      </>}
      <g opacity={.68+.32*p.first}>
        {g.mode==='fraction'&&<text x={g.delta.x} y={g.delta.y} fill={accent} fontSize="64" fontStyle="italic" textAnchor={portrait?'middle':'start'}>Δt</text>}
        <foreignObject x={g.label.x} y={g.label.y} width={g.label.w} height={g.label.h}>
          <div style={{width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',textAlign:'center',
            color:ink,fontFamily:'Arial,sans-serif',fontWeight:800,fontSize:font,lineHeight:1.1,whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{label}</div>
        </foreignObject>
      </g>
    </svg>
  </AbsoluteFill>;
}
