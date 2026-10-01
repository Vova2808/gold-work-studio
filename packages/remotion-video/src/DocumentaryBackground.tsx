import type {ReactNode} from 'react';
import {AbsoluteFill} from 'remotion';
export type EditorialBackground='grid-light'|'grid-dark'|'diagonal'|'contours'|'spotlight';

/** Resolution-independent backgrounds: no low-resolution stock texture stretched to 1080p. */
export function DocumentaryBackground({kind='grid-light',frame,accent='#dd1749'}:{kind?:EditorialBackground;frame:number;accent?:string}){
  const light=kind==='grid-light'||kind==='diagonal',ink=light?'#263038':'#d3d9e3';
  return <AbsoluteFill style={{background:light?'#f5f2e9':'#10151a',overflow:'hidden'}}>
    {kind==='spotlight'?<>
      <div style={{position:'absolute',width:'60%',height:'110%',left:'-13%',top:'15%',borderRadius:'50%',background:accent,filter:'blur(45px)',opacity:.38,transform:`translate(${Math.sin(frame/95)*2}%,${Math.cos(frame/100)*2}%)`}}/>
      <div style={{position:'absolute',width:'31%',aspectRatio:'1',left:'5%',top:'31%',borderRadius:'50%',background:accent,opacity:.7,transform:`scale(${1+Math.sin(frame/90)*.025})`}}/>
    </>:<svg viewBox="0 0 1920 1080" preserveAspectRatio="none" width="100%" height="100%" style={{opacity:kind==='grid-dark'?.18:kind==='grid-light'?.32:.2}}>
      {kind==='diagonal'?Array.from({length:42},(_,i)=><path key={i} d={`M${i*95-1000+Math.sin(frame/120)*18} -80l1250 1240`} stroke={ink} strokeWidth={i%5===0?5:1.5}/>)
      :kind==='contours'?Array.from({length:27},(_,i)=><path key={i} d={`M-100 ${i*54-150} C420 ${i*49+160+Math.sin(frame/110+i/7)*90} 480 ${i*47-300} 1090 ${i*48+100} S1570 ${i*55-190} 2020 ${i*57+80}`} fill="none" stroke={ink} strokeWidth={i%4===0?2.5:1}/>)
      :<>{Array.from({length:33},(_,i)=><path key={`v${i}`} d={Array.from({length:10},(_,j)=>`${j?'L':'M'}${i*64-64+Math.sin(j/3+frame/100+i/10)*9} ${j*140-40}`).join(' ')} fill="none" stroke={ink} strokeWidth={i%4===0?1.7:.9}/>)}
        {Array.from({length:20},(_,i)=><path key={`h${i}`} d={Array.from({length:15},(_,j)=>`${j?'L':'M'}${j*150-50} ${i*64-60+Math.sin(j/3+frame/115+i/8)*9}`).join(' ')} fill="none" stroke={ink} strokeWidth={i%4===0?1.7:.9}/>)}</>}
    </svg>}
    <AbsoluteFill style={{background:light?'radial-gradient(ellipse at center,transparent 55%,#22222212)':'radial-gradient(ellipse at center,transparent 36%,#02050899)'}}/>
  </AbsoluteFill>;
}

export function DocumentaryStyledMaterial({template,frame,material,customBackground=false}:{template:string;frame:number;material:ReactNode;customBackground?:boolean}){
  if(template==='broadcast-scanlines')return <AbsoluteFill data-full-frame-crt style={{overflow:'hidden'}}><AbsoluteFill style={{filter:'saturate(.85) contrast(1.06)'}}>{material}</AbsoluteFill><DocumentaryCrtOverlay frame={frame}/></AbsoluteFill>;
  const tv=template==='broadcast-crt',blueprint=template==='blueprint-board',slide=template==='archive-slide';
  const kind=template==='dark-grid'||blueprint?'grid-dark':template==='diagonal-card'?'diagonal':template==='contour-card'?'contours':'grid-light';
  const enter=1-Math.pow(1-Math.min(1,frame/20),3);
  return <AbsoluteFill>
    {!customBackground&&(tv?<AbsoluteFill style={{background:'radial-gradient(ellipse,#242a2d,#080b0e 75%)'}}/>:<DocumentaryBackground kind={kind} frame={frame}/>)}
    <div style={{position:'absolute',inset:tv?'5% 5.5%':slide?'10% 12%':'8% 8%',borderRadius:tv?38:5,overflow:'hidden',background:'#0c1116',border:tv?'12px solid #272b2b':slide?'22px solid #f3ecdc':blueprint?'2px solid #86cddb':'2px solid #ffffffaa',boxShadow:tv?'0 20px 60px #000c,inset 0 0 0 3px #9da099':'0 20px 60px #0005',transform:`translateY(${(1-enter)*35}px) scale(${.98+.02*enter}) rotate(${slide?-1.2:0}deg)`}}>
      <AbsoluteFill style={{filter:tv?'saturate(.7) contrast(1.08)':'none'}}>{material}</AbsoluteFill>
      {tv&&<DocumentaryCrtOverlay frame={frame} framed/>}
    </div>
    {blueprint&&<svg viewBox="0 0 1920 1080" width="100%" height="100%" style={{position:'absolute',pointerEvents:'none'}}>
      <path d="M110 180V60H260 M1660 60H1810V180 M110 900V1020H260 M1660 1020H1810V900" fill="none" stroke="#86cddb" strokeWidth="4" pathLength="1" strokeDasharray="1" strokeDashoffset={1-enter}/>
      <path d="M280 45H1640 M80 230V850" fill="none" stroke="#86cddb66" strokeWidth="2" strokeDasharray="6 8"/>
    </svg>}
  </AbsoluteFill>;
}

function DocumentaryCrtOverlay({frame,framed=false}:{frame:number;framed?:boolean}){
  return <AbsoluteFill style={{pointerEvents:'none'}}>
    <AbsoluteFill style={{inset:-4,width:'auto',height:'auto',background:'repeating-linear-gradient(0deg,#0000 0px,#0000 2px,#0006 3px,#0000 4px)',opacity:.35,transform:`translateY(${Math.sin(frame/24)*1.1}px)`}}/>
    <AbsoluteFill style={{background:'repeating-linear-gradient(90deg,#f004 0px,#0f02 1px,#00f4 2px,#0000 3px)',mixBlendMode:'screen',opacity:.12}}/>
    <AbsoluteFill style={{background:'radial-gradient(ellipse,transparent 45%,#0005 100%)',boxShadow:framed?'inset 0 0 70px #000':undefined}}/>
    <div style={{position:'absolute',left:0,right:0,height:'5%',top:`${(frame*.18)%115-10}%`,background:'linear-gradient(transparent,#ffffff08,transparent)'}}/>
  </AbsoluteFill>;
}
