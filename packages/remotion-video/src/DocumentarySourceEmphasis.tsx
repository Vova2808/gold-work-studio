import type {ReactNode} from 'react';
import {AbsoluteFill} from 'remotion';
import type {DocumentaryMotionGraphic} from './documentary-timeline.js';
import {fitDocumentaryText} from './documentary-typography.js';
import {documentaryPhraseWords} from './documentary-editorial.js';

const clamp=(n:number)=>Math.max(0,Math.min(1,n));
const ease=(n:number)=>1-Math.pow(1-clamp(n),3);

/** One intact source and a short, literal accent; no alternate source or crop. */
export function DocumentarySourceEmphasis({graphic,frame,frames,material,accent,width,height,motionEnabled,sourceFilter}:{
  graphic:DocumentaryMotionGraphic;frame:number;frames:number;material:ReactNode;accent:string;width:number;height:number;motionEnabled:boolean;sourceFilter?:string;
}){
  const phrase=graphic.kind==='key-point',date=graphic.kind==='chronology';
  const copy=phrase?graphic.title:graphic.value||graphic.title;
  const years=[...copy.matchAll(/(?<!\d)(?:18|19|20)\d{2}(?!\d)/gu)];
  const year=date&&years.length===1?years[0]!:undefined;
  const primary=year?year[0]:copy;
  const subtitle=year?copy.replace(year[0],'').replace(/^[\s,]+|[\s,]+$/gu,'')
    :!phrase&&!graphic.hideTitle&&graphic.title!==copy?graphic.title:'';
  const unit=Math.min(width,height)/1080;
  const textWidth=width*.84,textHeight=height*(phrase?.34:.36);
  const size=fitDocumentaryText(primary,(phrase?136:date&&year?320:220)*unit,textWidth,textHeight,800);
  const enter=motionEnabled?ease(frame/Math.max(1,Math.min(14,frames*.18))):1;
  const exit=motionEnabled?clamp((frames-1-frame)/Math.max(1,Math.min(8,frames*.10))):1;
  const words=documentaryPhraseWords(primary,graphic.highlight);
  const underline=motionEnabled?ease((frame-10)/14):1;
  return <AbsoluteFill data-source-emphasis={graphic.kind} style={{pointerEvents:'none',overflow:'hidden'}}>
    <AbsoluteFill data-emphasis-source style={{filter:sourceFilter,background:graphic.showSource===false?'#0c1015':'transparent'}}>{graphic.showSource!==false&&material}</AbsoluteFill>
    <AbsoluteFill data-emphasis-overlay style={{opacity:enter*exit,background:'radial-gradient(ellipse at center,rgba(4,7,10,.48),rgba(4,7,10,.72))'}}/>
    <AbsoluteFill style={{opacity:exit,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{width:textWidth,textAlign:'center',fontFamily:'Arial,"Segoe UI",sans-serif',fontWeight:800,color:date?'#fffaf2':accent,
        textShadow:`0 ${3*unit}px ${18*unit}px #000a,0 0 ${22*unit}px ${date?'#ffffff28':accent+'28'}`,
        opacity:enter,transform:`translateY(${(1-enter)*22*unit}px) scale(${.90+.10*enter})`}}>
        <div style={{fontSize:size,lineHeight:1.12,overflowWrap:'anywhere',whiteSpace:'pre-wrap'}}>
          {words.map((word,i)=>{const progress=motionEnabled&&phrase?ease((frame-i*2.5)/10):1;
            const marked=word.highlightStart>=0;
            return <span key={i}><span style={{display:'inline-block',opacity:progress,transform:`translateY(${(1-progress)*.3}em)`}}>
              {marked?<>{word.text.slice(0,word.highlightStart)}<span style={{position:'relative',color:'#fffaf2'}}>{word.text.slice(word.highlightStart,word.highlightEnd)}<span aria-hidden style={{position:'absolute',left:0,right:0,bottom:'-.08em',height:'.045em',background:accent,transform:`scaleX(${underline})`,transformOrigin:'left'}}/></span>{word.text.slice(word.highlightEnd)}</>:word.text}
            </span>{word.space}</span>;
          })}
        </div>
        {subtitle&&<div style={{fontSize:Math.min(50*unit,height*.055),lineHeight:1.2,fontWeight:700,color:'#fffaf2',marginTop:20*unit,opacity:motionEnabled?ease((frame-8)/12):1}}>{subtitle}</div>}
      </div>
    </AbsoluteFill>
  </AbsoluteFill>;
}
