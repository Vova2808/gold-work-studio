import {useId,type ReactNode} from 'react';
import {AbsoluteFill,Img} from 'remotion';
import type {DocumentaryMotionGraphic as Graphic} from './documentary-timeline.js';
import {resolveMediaSource} from './MediaSurface.js';
import {documentaryEase} from './documentary-design.js';
import {countValue} from './DocumentaryMotionGraphic.js';
import {annotationPosition,annotationInsets} from './documentary-annotation-position.js';
import {DocumentaryBackground} from './DocumentaryBackground.js';

const clamp=(v:number)=>Math.max(0,Math.min(1,v));
function wrap(text:string,width:number){
  const result:string[]=[];let line='';
  for(const word of text.split(/\s+/u)){if(line.length+word.length>width&&line){result.push(line);line=word;}else line+=(line?' ':'')+word;}
  if(line)result.push(line);return result;
}
function Copy({text,x,y,width,size=44,color='#182226',height=155}:{text:string;x:number;y:number;width:number;size?:number;color?:string;height?:number}){
  const lines=wrap(text,Math.max(10,Math.floor(width/(size*.54))));
  const font=Math.min(size,height/(Math.max(1,lines.length)*1.17));
  return <text x={x} y={y} fill={color} fontFamily="Arial,sans-serif" fontWeight="700" fontSize={font} letterSpacing="-.6">{lines.map((line,i)=><tspan key={i} x={x} dy={i?font*1.17:0}>{line}</tspan>)}</text>;
}

/** One video decoder, editable text/cards, a deliberate diagram of relationships.
 * Connector lines attach to cards, never pretend to locate unobserved parts. */
export function DocumentaryExplainer({graphic,frame,frames,material,customBackground=false}:{graphic:Graphic;frame:number;frames:number;material:ReactNode;customBackground?:boolean}){
  const enter=documentaryEase(clamp(frame/18)),paper=graphic.theme!=='dark',ink=paper?'#182226':'#f3f4ed',muted=paper?'#637075':'#acb7bd',accent=paper?'#156c78':'#8ad8dd';
  const cards:Graphic['cards']=graphic.cards?.slice(0,5)??graphic.items?.slice(0,5).map(label=>({label}));
  const statistic=graphic.kind==='statistic',compare=graphic.boardLayout==='compare'&&!statistic;
  const count=cards?.length??0,step=graphic.boardLayout==='steps';
  const progress=clamp(frame/Math.max(1,frames-1));
  return <AbsoluteFill style={{backgroundColor:customBackground?undefined:paper?'#f6f5f0':'#151d22',opacity:Math.min(enter,clamp((frames-frame)/8)),fontFamily:'Arial,sans-serif'}}>
    {!customBackground&&<DocumentaryBackground kind={graphic.background??(paper?'grid-light':'grid-dark')} frame={frame}/>}
    {!compare&&<div style={{position:'absolute',left:'4.8%',top:'25%',width:'57%',height:'62%',borderRadius:12,overflow:'hidden',border:`1px solid ${paper?'#17252b40':'#ffffff55'}`,background:paper?'#e5e7e3':'#253239',boxShadow:'0 18px 40px #17252b20',transform:`translateY(${(1-enter)*35}px)`}}>{material}</div>}
    {compare&&cards?.map((card,index)=>{
      const width=86/Math.max(1,count),arrival=documentaryEase(clamp((frame-index*5)/16));
      return <div key={index} style={{position:'absolute',left:`${5+index*(90/Math.max(1,count))}%`,width:`${width}%`,top:'28%',height:'44%',opacity:arrival,transform:`translateY(${(1-arrival)*40}px)`,overflow:'hidden',borderRadius:12,background:paper?'#e5e7e3':'#253239',border:`1px solid ${muted}`}}>
        {graphic.activeIndex===index?material:card.imagePath?<Img src={resolveMediaSource(card.imagePath)} style={{width:'100%',height:'100%',objectFit:'contain'}}/>:null}
      </div>;
    })}
    <svg viewBox="0 0 1920 1080" width="100%" height="100%" style={{position:'absolute',pointerEvents:'none'}}>
      <path d={`M92 64h${90*enter}`} stroke={ink} strokeWidth="6"/>
      <text x="92" y="105" fontSize="23" fill={muted} letterSpacing="4">{graphic.kicker??''}</text>
      <Copy text={graphic.title} x={92} y={170} width={1740} size={62} height={125} color={ink}/>
      {statistic?<>
        <path d={`M1220 374H${1220+595*enter}`} stroke={ink} strokeWidth="3"/>
        <Copy text={countValue(graphic.value??'',documentaryEase(clamp(frame/28)))} x={1220} y={530} width={585} size={112} height={220} color={ink}/>
        <path d={`M1220 800H${1220+595*documentaryEase(clamp((frame-10)/25))}`} stroke={accent} strokeWidth="10"/>
        <text x="1220" y="861" fontSize="24" fill={muted}>{graphic.kicker??''}</text>
      </>:cards?.map((card,index)=>{
        const arrival=documentaryEase(clamp((frame-index*5-5)/17)),active=graphic.activeIndex===undefined||graphic.activeIndex===index;
        const h=Math.min(190,650/Math.max(1,count)),x=compare?96+index*(1728/Math.max(1,count)):1320,y=compare?815:310+index*h,w=compare?1640/Math.max(1,count):505;
        return <g key={index} opacity={arrival*(active?1:.46)} transform={`translate(${(1-arrival)*24} 0)`}>
          {!compare&&<path d={step&&index?`M1280 ${y-h+40}V${y+26}H1310`:`M1195 ${480+index*14}H1250V${y+24}H1310`} fill="none" stroke={active?accent:muted} strokeWidth={active?3:2} pathLength={1} strokeDasharray="1" strokeDashoffset={1-arrival}/>}
          {!compare&&<rect x={x-15} y={y-29} width={w+20} height={h-17} rx="8" fill={paper?'#fbfaf6':'#202d34'} stroke={paper?'#18222633':'#ffffff44'}/>}
          <rect x={x} y={y-10} width="37" height="37" fill={active?ink:muted}/>
          <text x={x+18} y={y+16} textAnchor="middle" fill={paper?'#fff':'#17242a'} fontSize="22">{index+1}</text>
          <Copy text={card.label} x={x+55} y={y+14} width={w-60} size={count>4?32:39} height={h-65} color={ink}/>
          {card.value&&<Copy text={card.value} x={x+55} y={y+h-52} width={w-60} size={31} height={45} color={accent}/>}
        </g>;
      })}
      <path d="M92 1003H1828" stroke={muted} strokeWidth="1"/>
      <path d={`M92 1003H${92+1736*progress}`} stroke={accent} strokeWidth="4"/>
      {[92,1828].map(x=><path key={x} d={`M${x-7} 985h14m-7-7v14`} stroke={ink} strokeWidth="2"/>)}
    </svg>
  </AbsoluteFill>;
}

/** Contain-fit media and anchors share the same uncropped coordinate system. */
export function DocumentaryAnnotations({graphic,frame,aspect,containerAspect,accent='#60ffc5'}:{graphic:Graphic;frame:number;aspect:number;containerAspect:number;accent?:string}){
  const glow=useId().replace(/:/g,'');
  const technical=graphic.variant!=='clean',inset=annotationInsets(graphic);
  const availableWidth=1-2*inset.horizontal,availableHeight=1-2*inset.vertical;
  const viewportAspect=containerAspect*availableWidth/availableHeight;
  const width=1920*availableWidth*Math.min(1,aspect/viewportAspect),height=1080*availableHeight*Math.min(1,viewportAspect/aspect);
  const annotations=[...(graphic.annotations??[])].slice(0,3).sort((a,b)=>(a.points[0]?.y??50)-(b.points[0]?.y??50));
  const slots=new Set<number>();
  return <AbsoluteFill style={{pointerEvents:'none'}}><svg viewBox="0 0 1920 1080" width="100%" height="100%" preserveAspectRatio="none">
    <defs><filter id={glow}><feGaussianBlur stdDeviation="6"/></filter></defs>
    {annotations.map((annotation,index)=>{
      const point=annotationPosition(annotation.points,frame/30);if(!point)return null;
      const x=(1920-width)/2+point.x/100*width,y=(1080-height)/2+point.y/100*height;
      // Keep a label on its initial side when the tracked detail crosses centre.
      const first=annotation.points[0]??point,left=first.x>50;
      let slot=Math.round(first.x/100*2)+(first.y>=45?3:0);
      while(slots.has(slot))slot=(slot+1)%6;slots.add(slot);
      const labelX=technical?100+slot%3*650:left?95:1310,labelY=technical?(slot<3?100:960):210+index*230,reveal=documentaryEase(clamp((frame-index*6-7)/23));
      const labelHeight=Math.max(80,wrap(annotation.label,20).length*48+32);
      const line=technical?`M${x} ${y}V${slot<3?labelY+115:labelY-100}H${labelX+190}V${slot<3?labelY+labelHeight-38:labelY-38}`:`M${x} ${y}L${left?labelX+490:labelX} ${labelY+28}H${left?labelX:labelX+490}`;
      const color=technical?accent:'#fff';
      return <g key={index} opacity={reveal}>
        {technical&&<path d={line} fill="none" stroke={color} strokeWidth="9" opacity=".55" filter={`url(#${glow})`}/>}
        <path d={line} fill="none" stroke={color} strokeWidth="3" pathLength={1} strokeDasharray="1" strokeDashoffset={1-reveal}/>
        <circle cx={x} cy={y} r={16+Math.sin(frame/11)*2} fill={color} opacity=".32" filter={`url(#${glow})`}/><circle cx={x} cy={y} r="6" fill="white"/><circle cx={x} cy={y} r="12" stroke={color} strokeWidth="1.5" fill="none"/>
        <rect x={labelX-14} y={labelY-38} width={technical?425:520} height={labelHeight} rx={technical?17:5} fill="#080d12f5" stroke={technical?'#d8f1e9':'none'} strokeWidth="1.5"/>
        <Copy text={technical?annotation.label.toLocaleUpperCase():annotation.label} x={labelX+12} y={labelY+8} width={technical?374:460} size={technical?36:41} height={labelHeight-20} color={color}/>
      </g>;
    })}
  </svg></AbsoluteFill>;
}
