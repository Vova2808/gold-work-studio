import type {CSSProperties,ReactNode} from 'react';
import {AbsoluteFill} from 'remotion';
import {documentaryEase} from './documentary-design.js';
import {DocumentaryBackground} from './DocumentaryBackground.js';

/** One material node / one video decoder, including the blinds. */
export function DocumentaryStudioScene({template:id,frame,frames,material,accent}:{template:string;frame:number;frames:number;material:ReactNode;accent:string}){
  const e=documentaryEase(frame/26),t=documentaryEase(frame/Math.max(1,frames-1));
  const is=(s:string)=>id===`studio-${s}`,portrait=id.startsWith('portrait-');
  const light=is('torn-paper')||is('pinned')||is('page-peel');
  const full=is('diagonal')||is('blinds')||is('radial')||is('scan')||is('page-peel');
  const box:CSSProperties={position:'absolute',inset:full?0:portrait?'5% 29%':is('panorama')?'18% 3%':is('gallery-wall')?'9% 10%':is('diamond')?'7% 19%':'8% 7%',overflow:'hidden',background:light?'#eae7de':'#0a1118',boxShadow:full?undefined:'0 20px 60px #0005'};
  if(id==='portrait-arch')Object.assign(box,{borderRadius:'48% 48% 3% 3%',border:`3px solid ${accent}`,transform:`translateY(${(1-e)*45}px)`});
  if(id==='portrait-stage')Object.assign(box,{background:'transparent',boxShadow:'none',transform:`translateY(${(1-e)*65}px) scale(${.97+.03*e})`});
  if(is('hexagon'))box.clipPath='polygon(14% 0,86% 0,100% 50%,86% 100%,14% 100%,0 50%)';
  if(is('diamond'))box.clipPath=`polygon(50% ${5-5*e}%,100% 50%,50% 100%,0 50%)`;
  if(is('panorama'))box.clipPath=`inset(0 ${(1-e)*50}%)`;
  if(is('diagonal'))box.clipPath=`polygon(0 0,${e*210}% 0,${e*210-100}% 100%,0 100%)`;
  if(is('radial'))box.maskImage=`conic-gradient(#000 ${e*360}deg,transparent 0deg)`;
  if(is('torn-paper'))Object.assign(box,{clipPath:'polygon(0 2%,7% 0,16% 2%,28% 1%,43% 3%,56% 0,71% 2%,82% 0,100% 2%,99% 19%,100% 42%,98% 64%,100% 96%,87% 99%,70% 97%,54% 100%,32% 98%,16% 100%,1% 98%,2% 70%,0 40%)',transform:`rotate(${-1.2+t*.8}deg) scale(${.97+.03*e})`,border:'18px solid #f9f5e8'});
  if(is('pinned'))Object.assign(box,{inset:'10% 13%',transform:`rotate(${2.6-t*1.2}deg) translateY(${(1-e)*50}px)`,border:'22px solid #fff6e8',borderBottomWidth:54});
  if(is('lightbox'))Object.assign(box,{border:'18px solid #e0e4dc',boxShadow:`0 0 ${40+e*50}px #d9f0ed55,0 18px 40px #0008`,opacity:e});
  if(is('gallery-wall'))box.transform=`perspective(1700px) rotateY(${-16+t*9}deg) translateX(${(1-e)*90}px)`;
  if(is('spotlight'))Object.assign(box,{inset:0,maskImage:`radial-gradient(ellipse at ${43+t*10}% 50%,#000 ${e*60}%,transparent ${20+e*80}%)`});
  if(is('scan'))box.filter=`grayscale(${1-e}) contrast(${1.12-e*.12})`;
  if(is('lift'))Object.assign(box,{inset:'6% 16%',transform:`translateY(${(1-e)*110}%) rotate(${-3+3*e}deg)`});
  return <AbsoluteFill style={{overflow:'hidden',background:light?'#eee9dd':'#0a1018'}}>
    {!full&&<DocumentaryBackground kind={light?'grid-light':portrait?'spotlight':is('hexagon')?'grid-dark':'contours'} frame={frame} accent={accent}/>}
    {id==='portrait-stage'&&<div style={{position:'absolute',left:'21%',width:'58%',height:'9%',bottom:'1%',borderRadius:'50%',background:`radial-gradient(ellipse,${accent}88,transparent 70%)`,transform:`scaleX(${.8+e*.2})`}}/>}
    {is('gallery-wall')&&<div style={{position:'absolute',bottom:0,width:'100%',height:'18%',background:`linear-gradient(${accent}33,#080e15)`,clipPath:'polygon(0 40%,100% 0,100% 100%,0 100%)'}}/>}
    {is('lift')&&[0,1,2].map(i=><div key={i} style={{position:'absolute',left:`${i*34}%`,width:'35%',height:`${25+i*23}%`,bottom:0,background:accent,opacity:.1+i*.08,transform:`translateY(${(1-documentaryEase((frame-i*5)/25))*100}%)`}}/>)}
    <div data-studio-template={id} style={box}>{material}
      {is('blinds')&&Array.from({length:7},(_,i)=>{
        const p=documentaryEase((frame-i*2)/16);
        return <div key={i} style={{position:'absolute',left:0,top:`${i*100/7}%`,width:'100%',height:'14.4%',background:i%2?'#182a35':'#e8e9df',transformOrigin:i%2?'top':'bottom',transform:`scaleY(${1-p})`}}/>;
      })}
      {is('scan')&&<div style={{position:'absolute',top:0,bottom:0,left:`${e*110-5}%`,width:'3%',background:`linear-gradient(90deg,transparent,${accent}aa,transparent)`,opacity:1-documentaryEase((frame-22)/12)}}/>}
      {is('page-peel')&&<div style={{position:'absolute',inset:0,background:'linear-gradient(135deg,#fbf6eb 46%,#aaa89e 49%,#f1ecdf 52%)',clipPath:`polygon(${e*210}% 0,100% 0,100% ${210-e*210}%)`,filter:'drop-shadow(-12px 12px 8px #0008)'}}/>}
      {is('curtain')&&[0,1].map(i=><div key={i} style={{position:'absolute',top:0,bottom:0,[i?'right':'left']:0,width:'51%',background:`repeating-linear-gradient(90deg,#101822,${accent}55 12%,#101822 24%)`,transform:`translateX(${(i?1:-1)*e*103}%)`,borderRadius:i?'0 0 0 24%':'0 0 24% 0'}}/>)}
    </div>
    {(is('hexagon')||is('diamond'))&&<svg viewBox="0 0 1920 1080" width="100%" height="100%" style={{position:'absolute'}}><path d={is('hexagon')?'M240 90H85V340M1680 990H1835V740M70 590H240M1680 490H1850':'M960 25L1850 540L960 1055L70 540Z'} stroke={accent} strokeWidth="3" fill="none" pathLength="1" strokeDasharray="1" strokeDashoffset={1-e}/></svg>}
    {is('pinned')&&[0,1].map(i=><div key={i} style={{position:'absolute',top:'8%',left:`${i?77:18}%`,width:18,height:18,borderRadius:'50%',background:accent,boxShadow:'3px 5px 5px #0009',opacity:e}}/>)}
    {is('lightbox')&&[0,1].map(i=><div key={i} style={{position:'absolute',top:'4%',[i?'right':'left']:'6%',width:'15%',height:4,background:accent,opacity:e}}/>)}
    {is('panorama')&&[0,1].map(i=><div key={i} style={{position:'absolute',left:'3%',width:`${e*94}%`,height:3,[i?'bottom':'top']:'15%',background:accent}}/>)}
  </AbsoluteFill>;
}
