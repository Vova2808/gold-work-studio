import type {ReactNode} from 'react';
import {AbsoluteFill} from 'remotion';
import {documentaryEditorialStages} from './documentary-editorial.js';
export type EditorialBackground='grid-light'|'grid-dark'|'diagonal'|'contours'|'spotlight';

/** Resolution-independent backgrounds: no low-resolution stock texture stretched to 1080p. */
export function DocumentaryBackground({kind='grid-light',frame,accent='#dd1749',motionEnabled=true}:{kind?:EditorialBackground;frame:number;accent?:string;motionEnabled?:boolean}){
  const light=kind==='grid-light'||kind==='diagonal';
  const grid=kind==='grid-light'||kind==='grid-dark';
  const gridLine=light?'#1e35491c':'#c5e3f016';
  // A small, finite drift makes the entrance breathe; the reading hold is still.
  const drift=motionEnabled?Math.min(90,Math.max(0,frame))/90:1;
  return <AbsoluteFill style={{background:light?'linear-gradient(135deg,#f4f3ee,#e9e9e3)':
    kind==='spotlight'?`radial-gradient(ellipse at 24% 45%,${accent}12,#10161c 70%)`:'linear-gradient(135deg,#151c23,#0d1218)',overflow:'hidden'}}>
    {grid&&<AbsoluteFill style={{backgroundImage:`linear-gradient(${gridLine} 1px,transparent 1px),linear-gradient(90deg,${gridLine} 1px,transparent 1px)`,backgroundSize:'4% 7.111%',backgroundPosition:`${50+drift*.7}% ${50+drift*1.1}%`}}/>}
    {kind==='diagonal'&&<AbsoluteFill style={{backgroundImage:'repeating-linear-gradient(135deg,transparent 0 90px,#273c5010 90px 92px)',backgroundPosition:`${drift*18}px 0`}}/>}
    {kind==='contours'&&<AbsoluteFill style={{backgroundImage:'repeating-radial-gradient(ellipse at 78% 70%,transparent 0 46px,#b9dbe514 47px 48px,transparent 49px 76px)',transform:`scale(${1.04-drift*.04})`}}/>}
  </AbsoluteFill>;
}

export function DocumentaryStyledMaterial({template,frame,frames=150,material,customBackground=false,motionEnabled=true}:{template:string;frame:number;frames?:number;material:ReactNode;customBackground?:boolean;motionEnabled?:boolean}){
  // Retain the saved CRT ID as an alias for the same full-frame treatment.
  if(template==='broadcast-scanlines'||template==='broadcast-crt')return <AbsoluteFill data-full-frame-crt style={{overflow:'hidden'}}>{material}<DocumentaryCrtOverlay frame={motionEnabled?frame:0}/></AbsoluteFill>;
  const blueprint=template==='blueprint-board',slide=template==='archive-slide';
  const kind=template==='dark-grid'||blueprint?'grid-dark':template==='diagonal-card'?'diagonal':template==='contour-card'?'contours':'grid-light';
  const {main:enter,settle}=documentaryEditorialStages(frame,frames,motionEnabled);
  return <AbsoluteFill>
    {!customBackground&&<DocumentaryBackground kind={kind} frame={frame} motionEnabled={motionEnabled}/>}
    <div data-styled-frame={template} style={{position:'absolute',inset:slide?'10% 12%':'8% 8%',borderRadius:5,overflow:'hidden',background:'#0c1116',border:slide?'22px solid #f3ecdc':blueprint?'2px solid #86cddb':'2px solid #ffffffaa',boxShadow:'0 20px 60px #0005',transform:`translateY(${(1-enter)*35}px) scale(${.98+.02*enter}) rotate(${slide?-1.2:0}deg)`}}>
      <AbsoluteFill style={{overflow:'hidden'}}>{material}</AbsoluteFill>
    </div>
    {blueprint&&<svg viewBox="0 0 1920 1080" width="100%" height="100%" style={{position:'absolute',pointerEvents:'none'}}>
      <path d="M110 180V60H260 M1660 60H1810V180 M110 900V1020H260 M1660 1020H1810V900" fill="none" stroke="#86cddb" strokeWidth="4" pathLength="1" strokeDasharray="1" strokeDashoffset={1-settle}/>
      <path d="M280 45H1640 M80 230V850" fill="none" stroke="#86cddb66" strokeWidth="2" strokeDasharray="6 8"/>
    </svg>}
  </AbsoluteFill>;
}

function DocumentaryCrtOverlay({frame}:{frame:number}){
  return <AbsoluteFill style={{pointerEvents:'none'}}>
    <AbsoluteFill style={{inset:-4,width:'auto',height:'auto',background:'repeating-linear-gradient(0deg,#0000 0px,#0000 2px,#0006 3px,#0000 4px)',opacity:.35,transform:`translateY(${Math.sin(frame/24)*1.1}px)`}}/>
    <AbsoluteFill style={{background:'radial-gradient(ellipse,transparent 45%,#0005 100%)'}}/>
  </AbsoluteFill>;
}
