import {useMemo} from 'react';
import {AbsoluteFill} from 'remotion';
import type {DocumentaryMotionGraphic} from './documentary-timeline.js';
import {fitDocumentaryText} from './documentary-typography.js';
import {documentaryEditorialStages,documentaryMarkerInk,documentaryPhraseWords,documentaryPhraseWordProgress} from './documentary-editorial.js';

/** Keep routine accents smaller than the explicitly chosen hook posters. */
export function documentaryCompactPhrase(graphic:DocumentaryMotionGraphic,automatic:boolean) {
  const count=graphic.title.match(/\S+/gu)?.length??0;
  return automatic&&graphic.kind==='key-point'&&graphic.origin==='automatic'&&(!graphic.variant||graphic.variant==='clean')
    &&count>0&&count<=8&&graphic.title.length<=100;
}

/** A brief exact excerpt. The entrance settles completely before the reading hold. */
export function DocumentaryPhrase({graphic,frame,frames,accent,textColor,compact=false,motionEnabled=true}:{graphic:DocumentaryMotionGraphic;frame:number;frames:number;accent:string;textColor:string;compact?:boolean;motionEnabled?:boolean}) {
  const kinetic=graphic.variant==='poster',stages=documentaryEditorialStages(frame,frames,motionEnabled);
  // A single existing word can carry the accent; never add text or expand into subtitles.
  const words=useMemo(()=>{
    const phraseWords=graphic.title.match(/[\p{L}\p{M}]+/gu)??[];
    const highlight=graphic.highlight??(graphic.origin==='automatic'&&phraseWords.length>1&&phraseWords.length<=8
      ?phraseWords.filter(word=>word.length>=4).at(-1):undefined);
    return documentaryPhraseWords(graphic.title,highlight);
  },[graphic.title,graphic.highlight,graphic.origin]);
  const weight=800,short=(graphic.title.match(/\S+/gu)?.length??0)<=4;
  const size=useMemo(()=>fitDocumentaryText(graphic.title,kinetic?124:compact?(short?112:94):82,compact?1696:1520,compact?220:380,weight),[graphic.title,kinetic,compact,short,weight]);
  const exit=motionEnabled?Math.max(0,Math.min(1,(frames-frame)/Math.max(1,Math.min(8,frames*.08)))):1;
  return <AbsoluteFill style={{pointerEvents:'none',opacity:exit}}>
    <AbsoluteFill style={{background:compact?'linear-gradient(transparent 38%,#050d14e6)':kinetic?'linear-gradient(90deg,#081019a8,#08101955)':'linear-gradient(transparent 30%,#081019d8)'}}/>
    <svg viewBox="0 0 1920 1080" width="100%" height="100%" style={{position:'absolute'}}>
      <foreignObject x={compact?112:190} y={compact?744:kinetic?320:610} width={compact?1696:1540} height={compact?240:430}>
        <div style={{fontFamily:'Arial,sans-serif',fontSize:size,fontWeight:weight,lineHeight:1.2,color:textColor,whiteSpace:'pre-wrap',overflowWrap:'anywhere',textAlign:kinetic?'center':'left',textShadow:'0 3px 10px #0008'}}>
          {words.map((word,i)=>{const reveal=motionEnabled?documentaryPhraseWordProgress(frame,frames,i,words.length):1,marked=word.highlightStart>=0;
            return <span key={i}><span style={{display:'inline-block',verticalAlign:'bottom',overflow:'hidden'}}><span style={{display:'inline-block',opacity:reveal,transform:`translateY(${(1-reveal)*(kinetic?90:55)}%)`}}>{marked?<>{word.text.slice(0,word.highlightStart)}<span style={{background:accent+'eb',color:documentaryMarkerInk(accent),textShadow:'none',borderRadius:'.04em'}}>{word.text.slice(word.highlightStart,word.highlightEnd)}</span>{word.text.slice(word.highlightEnd)}</>:word.text}</span></span>{word.space}</span>;
          })}
        </div>
      </foreignObject>
      <path d={`M${compact?112:kinetic?960-90*stages.settle:190} ${compact?700:kinetic?790:1020}h${(compact?96:180)*stages.settle}`} stroke={accent} strokeWidth={compact?3:7} opacity={stages.settle}/>
    </svg>
  </AbsoluteFill>;
}
