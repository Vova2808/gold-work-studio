import {useMemo,type ReactNode} from 'react';
import {AbsoluteFill,useVideoConfig} from 'remotion';
import {DocumentaryBackground} from './DocumentaryBackground.js';
import {documentaryBoardLayout,documentaryCardStages,documentaryEditorialStages,documentaryMarkerInk} from './documentary-editorial.js';
import {fitDocumentaryText} from './documentary-typography.js';

interface Card {material:ReactNode;label?:string;value?:string}
/** Two full panels; fitting the material remains the source owner's decision. */
export function documentaryComparisonSplit(width:number,height:number,reveal=1) {
  const portrait=height>width,hidden=(1-Math.max(0,Math.min(1,reveal)))*100;
  return [0,1].map(index=>({
    x:portrait?0:index*width/2,y:portrait?index*height/2:0,
    w:portrait?width:width/2,h:portrait?height/2:height,
    clipPath:portrait?`inset(${index?0:hidden}% 0 ${index?hidden:0}% 0)`
      :`inset(0 ${index?hidden:0}% 0 ${index?0:hidden}%)`,
  }));
}
function Label({text,width,height,color,unit,size=38*unit,outlined=false}:{text:string;width:number;height:number;color:string;unit:number;size?:number;outlined?:boolean}) {
  const font=useMemo(()=>fitDocumentaryText(text,size,width,height,700),[text,width,height,size]);
  return <div style={{fontSize:font,fontWeight:700,lineHeight:1.15,color,whiteSpace:'pre-wrap',overflowWrap:'anywhere',WebkitTextStroke:outlined?`${2.5*unit}px ${documentaryMarkerInk(color)}`:undefined,paintOrder:outlined?'stroke fill':undefined}}>{text}</div>;
}
/** Reused by legacy comparisons and motionGraphic compare. Material/label association stays intact. */
export function DocumentaryComparisonBoard({template='compare-grid',frame,frames=150,left,right,labels=[],items,accent,customBackground=false,variant,theme,title,motionEnabled=true}:{template?:string;frame:number;frames?:number;left?:ReactNode;right?:ReactNode;labels?:Array<string|undefined>;items?:Card[];accent:string;customBackground?:boolean;variant?:string;theme?:'dark'|'paper';title?:string;motionEnabled?:boolean}){
  const {width,height}=useVideoConfig(),unit=width/1920;
  const stages=documentaryEditorialStages(frame,frames,motionEnabled);
  const cards=(items??[{material:left,label:labels[0]},{material:right,label:labels[1]}]).slice(0,5);
  const circular=variant==='poster',paper=variant==='collage'||template==='compare-diagonal'||theme==='paper';
  const dark=!paper&&(theme==='dark'||template==='compare-dossier'||template==='compare-filmstrip'||circular),ink=dark?'#f2f3ee':'#18252d';
  const {columns,rows,slotW,slotH,top}=documentaryBoardLayout(cards.length,width,height);
  if(cards.length===2&&cards.every(card=>card.material)&&variant!=='collage'&&template!=='compare-diagonal'&&!circular){
    const portrait=height>width,u=Math.min(width,height)/1080;
    const panels=documentaryComparisonSplit(width,height,stages.main);
    return <AbsoluteFill data-comparison-layout="split" style={{overflow:'hidden',background:paper?'#eeeae0':'#0c141c',fontFamily:'Arial,sans-serif'}}>
      {cards.map((card,i)=>{
        const r=panels[i]!;
        const copy=[card.value,card.label].filter(Boolean).join(' · ');
        return <div key={i} style={{position:'absolute',left:r.x,top:r.y,width:r.w,height:r.h,overflow:'hidden',clipPath:r.clipPath}}>
          {/* Do not clone or override objectFit: documents and explicit contain survive. */}
          <AbsoluteFill>{card.material}</AbsoluteFill>
          {copy&&<div style={{position:'absolute',left:0,right:0,bottom:0,padding:`${42*u}px ${32*u}px ${28*u}px`,background:'linear-gradient(transparent,#081019ee)',opacity:stages.detail}}>
            <Label text={copy} width={r.w-64*u} height={r.h*.2} color="#f5f5f2" unit={u} size={50*u}/>
          </div>}
        </div>;
      })}
      <div aria-hidden style={{position:'absolute',left:portrait?0:'50%',top:portrait?'50%':0,width:portrait?'100%':3*u,height:portrait?3*u:'100%',background:accent,opacity:stages.main,
        transform:portrait?`translateY(-50%) scaleX(${stages.main})`:`translateX(-50%) scaleY(${stages.main})`,transformOrigin:'center'}}/>
      {title&&<div style={{position:'absolute',left:'5%',top:'4%',width:'90%',boxSizing:'border-box',padding:16*u,background:'#081019df',opacity:stages.detail}}>
        <Label text={title} width={width*.9-32*u} height={height*.12} color="#f5f5f2" unit={u} size={52*u}/>
      </div>}
    </AbsoluteFill>;
  }
  if(cards.length>=2&&cards.length<=4&&cards.every(card=>!card.material)){
    // Text is the material here. Keep the supplied background visible between columns.
    const textTop=height*(title?.trim() ? .23 : .15),columnW=width*.86/columns,rowH=height*(title?.trim() ? .66 : .74)/rows;
    const heading=stages.main;
    const backing=customBackground?(dark?'#10161cf2':'#f3f0e8f2'):undefined;
    const backingShadow=customBackground?`0 14px 36px #0003,inset 0 0 0 1px ${dark?'#ffffff20':'#18252d22'}`:undefined;
    return <AbsoluteFill style={{overflow:'hidden',fontFamily:'Arial,sans-serif'}}>
      {!customBackground&&<DocumentaryBackground kind={dark?'grid-dark':'grid-light'} frame={frame} accent={accent} motionEnabled={motionEnabled}/>}
      {title&&<div style={{position:'absolute',left:width*.07,top:height*.055,width:width*.86,textAlign:'center',opacity:heading,background:backing,borderRadius:6*unit,boxShadow:backingShadow,transform:`translateY(${(1-heading)*-24*unit}px)`}}>
        <Label text={title} width={width*.86} height={height*.12} color={ink} unit={unit} size={52*unit}/>
      </div>}
      {cards.map((card,i)=>{
        const {source:arrival,label:detail,rule}=documentaryCardStages(frame,frames,i,cards.length,motionEnabled);
        const column=i%columns,row=Math.floor(i/columns),copyW=columnW*.82,hasValue=Boolean(card.value?.trim());
        const labelH=rowH*(hasValue ? .24 : .65),valueH=rowH*.43;
        return <div key={i} style={{position:'absolute',left:width*.07+column*columnW,top:textTop+row*rowH,width:columnW,height:rowH}}>
          {column>0&&<div style={{position:'absolute',left:0,top:'12%',height:'76%',width:2*unit,background:ink,opacity:rule*.42,transform:`scaleY(${rule})`,transformOrigin:'center'}}/>}
          {row>0&&<div style={{position:'absolute',left:'9%',top:0,width:'82%',height:2*unit,background:ink,opacity:rule*.3,transform:`scaleX(${rule})`,transformOrigin:'left'}}/>}
          <div style={{position:'absolute',left:'9%',top:'8%',width:copyW,height:'84%',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:20*unit,textAlign:'center',opacity:arrival,background:backing,borderRadius:6*unit,boxShadow:backingShadow,
            transform:`translate(${(1-arrival)*(column%2?64:-64)*unit}px,${(1-arrival)*44*unit}px) scale(${.9+.1*arrival})`}}>
            <div style={{width:'100%',height:labelH,display:'flex',alignItems:'center',justifyContent:'center'}}>
              <Label text={card.label??''} width={copyW} height={labelH} color={ink} unit={unit} size={(hasValue?(rows===2?40:56):(cards.length===2?106:rows===2?76:88))*unit}/>
            </div>
            <div style={{width:Math.min(120*unit,copyW*.3),height:3*unit,flexShrink:0,background:accent,opacity:rule,transform:`scaleX(${rule})`,transformOrigin:'center'}}/>
            {hasValue&&<div style={{width:'100%',height:valueH,display:'flex',alignItems:'center',justifyContent:'center',opacity:detail,transform:`translateY(${(1-detail)*26*unit}px)`}}>
              <Label text={card.value!} width={copyW} height={valueH} color={accent} unit={unit} size={(cards.length===2?144:rows===2?96:112)*unit} outlined={customBackground}/>
            </div>}
          </div>
        </div>;
      })}
    </AbsoluteFill>;
  }
  return <AbsoluteFill style={{overflow:'hidden',fontFamily:'Arial,sans-serif'}}>
    {!customBackground&&<DocumentaryBackground kind={dark?'grid-dark':'grid-light'} frame={frame} accent={accent} motionEnabled={motionEnabled}/>}
    {!customBackground&&circular&&<><AbsoluteFill style={{width:'50%',background:accent,opacity:.16}}/><AbsoluteFill style={{left:'50%',width:'50%',background:'#142f3b',opacity:.5}}/></>}
    {title&&<div style={{position:'absolute',left:width*.07,top:height*.055,width:width*.86,opacity:stages.main,background:customBackground?(dark?'#10161ce8':'#f1eee5eb'):undefined,padding:customBackground?8*unit:0}}><Label text={title} width={width*.86} height={height*.11} color={ink} unit={unit*1.35}/></div>}
    {cards.map((card,i)=>{
      const {source:arrival,label,rule}=documentaryCardStages(frame,frames,i,cards.length,motionEnabled);
      const availableW=slotW-width*.025,availableH=slotH*.74,diameter=Math.min(availableW,availableH);
      const w=circular?diameter:availableW,h=circular?diameter:availableH;
      const x=width*.06+(i%columns)*slotW+(slotW-w)/2,y=top+Math.floor(i/columns)*slotH;
      const angle=paper?(i%2?1.6:-1.6):0;
      const startScale=circular ? .76 : paper ? .86 : .92;
      return <div key={i} style={{position:'absolute',left:x,top:y,width:w,height:h,opacity:arrival,transform:`translate(${(1-arrival)*(i%2?1:-1)*width*.055}px,${(1-arrival)*height*.07}px) scale(${startScale+(1-startScale)*arrival}) rotate(${angle*arrival}deg)`,transformOrigin:'center center'}}>
        <AbsoluteFill style={{background:dark?'#101a22':'#eeeae0',borderRadius:circular?'50%':2,boxSizing:'border-box',border:(paper?8:3)*unit+'px solid '+(paper?'#f8f5ec':'#ffffffa0'),overflow:'hidden',boxShadow:'0 16px 32px #0005',
          clipPath:paper?'polygon(0 1%,8% 0,17% 1%,26% 0,38% 1%,49% 0,62% 1%,73% 0,86% 1%,100% 0,99% 100%,87% 99%,74% 100%,61% 99%,47% 100%,34% 99%,20% 100%,9% 99%,0 100%)':undefined}}>{card.material??<div style={{position:'absolute',inset:'15%',display:'flex',alignItems:'center',justifyContent:'center',textAlign:'center',opacity:label}}><Label text={[card.value,card.label].filter(Boolean).join(' · ')} width={w*.7} height={h*.7} color={ink} unit={unit*1.3}/></div>}</AbsoluteFill>
        {card.material&&(card.label||card.value)&&<div style={{position:'absolute',top:'104%',left:0,width:w,boxSizing:'border-box',padding:10*unit,opacity:label,transform:'translateY('+((1-label)*15*unit)+'px)',textAlign:'center',background:customBackground?(dark?'#10161ce8':'#f1eee5eb'):undefined}}>
          <div style={{position:'absolute',top:0,left:'10%',width:'80%',height:2*unit,background:accent,transform:`scaleX(${rule})`,transformOrigin:i%2?'right':'left'}}/>
          <Label text={[card.value,card.label].filter(Boolean).join(' · ')} width={w-20*unit} height={slotH*.22} color={ink} unit={unit} size={(cards.length===2?46:38)*unit}/>
        </div>}
      </div>;
    })}
  </AbsoluteFill>;
}
