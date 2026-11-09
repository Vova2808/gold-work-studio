import type {CSSProperties,ReactNode} from 'react';
import {AbsoluteFill} from 'remotion';
import {documentaryEase} from './documentary-design.js';
import {documentaryEditorialStages} from './documentary-editorial.js';
import {DocumentaryBackground} from './DocumentaryBackground.js';

/** One selected material / one decoder. Automatic layouts retain a distinct
 * finite entrance and then hold; manual/pinned layouts keep their saved view. */
export function DocumentaryStudioScene({template:id,frame,frames,material,accent,customBackground=false,motionEnabled=true,enhanced=false}:{template:string;frame:number;frames:number;material:ReactNode;accent:string;customBackground?:boolean;motionEnabled?:boolean;enhanced?:boolean}){
  const enter=enhanced?documentaryEditorialStages(frame,frames,motionEnabled).main:motionEnabled?documentaryEase(frame/18):1,portrait=id.startsWith('portrait-');
  const full=['studio-diagonal','studio-blinds','studio-radial','studio-scan','studio-page-peel','studio-curtain'].includes(id);
  const light=['studio-torn-paper','studio-pinned','studio-lightbox'].includes(id);
  const box:CSSProperties={position:'absolute',inset:full?0:portrait?'5% 27%':id==='studio-panorama'?'16% 3%':'6% 5%',
    overflow:'hidden',background:light?'#f1f0eb':'#10161c',
    border:full?undefined:`1px solid ${light?'#171d2525':'#ffffff25'}`,
    boxShadow:full?undefined:'0 10px 28px #0002',
    transform:full?undefined:`translateY(${(1-enter)*12}px)`,opacity:full?1:.85+.15*enter};
  if(enhanced&&!full)Object.assign(box,{inset:portrait?'6% 25%':id==='studio-panorama'?'19% 5%':'10% 10%',
    border:`${light?16:4}px solid ${light?'#fff8e9':'#84938e'}`,boxShadow:'0 20px 48px #0007',boxSizing:'border-box'});
  if(enhanced&&id==='studio-pinned')Object.assign(box,{inset:'11% 14%',borderBottomWidth:42,transform:`translateY(${(1-enter)*44}px) rotate(${1.4+(1-enter)*2.4}deg)`});
  if(enhanced&&id==='studio-torn-paper')Object.assign(box,{transform:`translateX(${(1-enter)*-55}px) rotate(${-1.4-(1-enter)*1.2}deg)`,borderRadius:'1% 2% 1% 3%',boxShadow:'12px 16px 0 -5px #d8d2c5,0 18px 50px #0006'});
  if(enhanced&&id==='studio-gallery-wall')Object.assign(box,{inset:'12% 13%',border:'18px solid #e9e3d7',transform:`translateX(${(1-enter)*72}px) rotate(${(1-enter)*-2}deg)`,boxShadow:'20px 22px 0 -8px #4b5a60,0 20px 50px #0009'});
  if(enhanced&&id==='studio-lightbox')Object.assign(box,{border:'22px solid #e5e9df',boxShadow:'0 0 45px #d9f0ed66,0 18px 40px #0008'});
  if(enhanced&&id==='portrait-arch')box.borderRadius='46% 46% 3% 3%';
  if(enhanced&&id==='studio-panorama')box.transform=`scaleX(${.96+.04*enter})`;
  const reveal=.08+.92*enter;
  if(enhanced&&id==='studio-diagonal')box.clipPath=`polygon(0 0,${reveal*210}% 0,${reveal*210-100}% 100%,0 100%)`;
  if(enhanced&&id==='studio-radial')box.clipPath=`ellipse(${72*reveal}% ${72*reveal}% at 50% 50%)`;
  if(enhanced&&id==='studio-scan')box.filter=`grayscale(${1-enter})`;
  return <AbsoluteFill style={{overflow:'hidden',background:customBackground?'transparent':light?'#f1f0eb':'#10161c'}}>
    {enhanced&&!full&&!customBackground&&<DocumentaryBackground kind={light?'grid-light':portrait?'spotlight':'contours'} frame={frame} accent={accent} motionEnabled={motionEnabled}/>}
    {enhanced&&id==='studio-pinned'&&[24,72].map(left=><div key={left} data-photo-tape style={{position:'absolute',top:'8%',left:`${left}%`,width:'6%',height:'5%',background:'#d8cdaaa8',transform:`rotate(${left===24?-18:14}deg)`,zIndex:1}}/>)}
    <div data-studio-template={id} style={box}>{material}</div>
    {enhanced&&id==='studio-blinds'&&Array.from({length:6},(_,index)=><div key={index} aria-hidden style={{position:'absolute',left:0,top:`${index*100/6}%`,width:'100%',height:'16.8%',background:'#18242b',transformOrigin:index%2?'top':'bottom',transform:`scaleY(${.92*(1-enter)})`}}/>)}
    {enhanced&&(id==='studio-curtain'||id==='studio-page-peel')&&[0,1].map(index=><div key={index} aria-hidden style={{position:'absolute',top:0,bottom:0,[index?'right':'left']:0,width:'46%',background:id==='studio-page-peel'?'#ece6d9':'#18242b',transform:`translateX(${(index?1:-1)*enter*110}%)`,boxShadow:'0 0 20px #0005'}}/>)}
    {!full&&!portrait&&<div style={{position:'absolute',left:'5%',bottom:'3.5%',width:42,height:2,background:accent,opacity:.65}}/>}
  </AbsoluteFill>;
}
