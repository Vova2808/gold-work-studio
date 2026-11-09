import type {ReactNode} from 'react';
import {AbsoluteFill,Img} from 'remotion';
import type {DocumentaryMotionGraphic} from './documentary-timeline.js';
import {resolveMediaSource} from './MediaSurface.js';
import {documentaryEase} from './documentary-design.js';

/** Only the active material decodes video. Other verified posters hold context. */
export function DocumentaryFocusPanels({graphic,frame,localFrame,material}:{graphic:DocumentaryMotionGraphic;frame:number;localFrame:number;material:ReactNode}){
  const enter=documentaryEase(Math.min(1,frame/18)),focus=documentaryEase(Math.min(1,localFrame/12));
  const paper=graphic.theme==='paper',ink=paper?'#21372c':'#fff',accent=paper?'#346f55':'#a1daca';
  return <AbsoluteFill style={{pointerEvents:'none',opacity:enter}}>
    {graphic.panels?.map((panel,index)=>{
      const active=index===graphic.activeIndex;
      return <div key={index} style={{position:'absolute',left:`${4+index*31}%`,top:'23%',width:'29%',height:'61%',
        transform:`translateY(${(1-enter)*35}px) scale(${active ? .99+.01*focus : .94})`,opacity:active?1:.48,
        filter:active?undefined:'blur(1.5px)',borderRadius:22,overflow:'hidden',background:paper?'#e0e7dc':'#182723',
        boxShadow:active?'0 22px 70px #172b3533':'0 8px 30px #172b3518',border:`2px solid ${active?accent:'transparent'}`}}>
        <AbsoluteFill style={{bottom:'14%',height:'86%',overflow:'hidden'}}>
          {panel.imagePath&&<Img src={resolveMediaSource(panel.imagePath)} style={{position:'absolute',width:'100%',height:'100%',objectFit:'cover',filter:'blur(22px)',opacity:.32,transform:'scale(1.12)'}}/>}
          {active?material:panel.imagePath?<Img src={resolveMediaSource(panel.imagePath)} style={{position:'absolute',width:'100%',height:'100%',objectFit:'contain'}}/>:null}
        </AbsoluteFill>
        <div style={{position:'absolute',bottom:0,height:'14%',left:0,right:0,display:'flex',alignItems:'center',gap:16,padding:'0 22px',
          fontFamily:'Arial,sans-serif',fontWeight:700,fontSize:Math.min(30,Math.max(20,1080/Math.max(1,panel.label.length))),lineHeight:1.15,color:ink,background:paper?'#f7f8f1':'#14211d'}}>
          <span style={{color:accent,fontSize:24}}>{String(index+1).padStart(2,'0')}</span><span>{panel.label}</span>
        </div>
      </div>;
    })}
  </AbsoluteFill>;
}
