import {Fragment,useMemo,type ReactNode} from 'react';
import {AbsoluteFill,Img} from 'remotion';
import type {DocumentaryMotionGraphic as Graphic} from './documentary-timeline.js';
import {DocumentaryBackground} from './DocumentaryBackground.js';
import {resolveMediaSource} from './MediaSurface.js';
import {fitDocumentaryText} from './documentary-typography.js';
import {countValue} from './DocumentaryMotionGraphic.js';
import {documentaryCardStages,documentaryEditorialStages,documentaryMarkerInk,documentaryPhraseWords,documentaryPhraseWordProgress,documentarySubjectSize} from './documentary-editorial.js';

const clamp=(n:number)=>Math.max(0,Math.min(1,n));
function Heading({text,x,y,width,font=100,color='#fff',maxHeight=420}:{text:string;x:number;y:number;width:number;font?:number;color?:string;maxHeight?:number}){
  const size=useMemo(()=>fitDocumentaryText(text,font,width,maxHeight,700),[text,font,width,maxHeight]);
  return <foreignObject x={x} y={y} width={width} height={maxHeight}><div style={{fontFamily:'Arial,sans-serif',fontWeight:700,fontSize:size,lineHeight:1.15,color,whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{text}</div></foreignObject>;
}

/** Existing editorial families share supplied text and material, never a generated fact. */
export function DocumentaryEditorialGraphic({graphic,frame,frames,material,accent,customBackground=false,aspect=16/9,containerAspect=16/9,sourceFilter,motionEnabled=true}:{graphic:Graphic;frame:number;frames:number;material:ReactNode;accent:string;customBackground?:boolean;aspect?:number;containerAspect?:number;sourceFilter?:string;motionEnabled?:boolean}){
  const stages=documentaryEditorialStages(frame,frames,motionEnabled),enter=stages.main;
  const profile=graphic.kind==='subject-card',chart=graphic.kind==='bar-chart',paper=graphic.theme==='paper';
  const title=graphic.title,background=graphic.background??(paper?'grid-light':profile?'spotlight':'grid-dark');
  const ink=paper?'#19232b':'#f5f5f2',markerInk=documentaryMarkerInk(accent);
  const media=graphic.cutoutPath?<Img src={resolveMediaSource(graphic.cutoutPath)} style={{width:'100%',height:'100%',objectFit:'contain',filter:'drop-shadow(0 12px 16px #0006)'}}/>:material;
  const centered=profile&&graphic.hideTitle===true;
  const {width:mediaWidth,height:mediaHeight}=documentarySubjectSize(aspect,containerAspect,centered,Boolean(graphic.cutoutPath));
  const circleWidth=Math.min(centered ? .54 : .4,.66/containerAspect),circleHeight=circleWidth*containerAspect;
  const subjectEnter=centered?stages.main:stages.detail,labelEnter=stages.main,leader=stages.settle;
  const speech=graphic.quoteMode!=='phrase',reading=graphic.reading?.text===title?graphic.reading.words:undefined;
  const words=useMemo(()=>documentaryPhraseWords(title,graphic.highlight),[title,graphic.highlight]);
  const quoteFont=useMemo(()=>fitDocumentaryText(title,76,1280,440,600),[title]);
  const bars=graphic.cards?.slice(0,5).map(c=>({...c,number:Math.max(0,Number(c.value?.match(/^\d+(?:[.,]\d+)?/u)?.[0]?.replace(',','.'))||0)}))??[];
  const max=Math.max(1,...bars.map(b=>b.number));
  // Never hide the sentence before its measured final word. Graphic-local seconds are retained.
  const fadeFrames=!profile&&!chart&&speech&&reading?.length
    ? Math.max(1,Math.min(8,frames-Math.ceil(reading.at(-1)!.endSeconds*30))) : Math.min(8,Math.max(1,frames*.08));
  const exit=motionEnabled&&frames>2?clamp((frames-frame)/fadeFrames):1;
  return <AbsoluteFill style={{opacity:exit,overflow:'hidden',pointerEvents:'none'}}>
    {(profile||chart)&&!customBackground&&<DocumentaryBackground kind={background} frame={frame} accent={accent} motionEnabled={motionEnabled}/>}
    {profile&&<>
      {graphic.variant==='poster'&&<div style={{position:'absolute',left:((centered ? .5 : .26)-circleWidth/2)*100+'%',top:(.54-circleHeight/2)*100+'%',width:circleWidth*100+'%',height:circleHeight*100+'%',borderRadius:'50%',background:accent,opacity:enter*.75,transform:'scale('+(.8+.2*enter)+')',boxShadow:'0 0 90px '+accent+'40'}}/>}
      <div style={{position:'absolute',left:((centered ? .5 : .26)-mediaWidth/2)*100+'%',top:(1-mediaHeight)/2*100+'%',width:mediaWidth*100+'%',height:mediaHeight*100+'%',overflow:graphic.cutoutPath?'visible':'hidden',opacity:subjectEnter,
        filter:sourceFilter,transform:`translate(${(1-subjectEnter)*(graphic.variant==='collage'?-12:0)}%,${(1-subjectEnter)*(graphic.cutoutPath?65:12)}%) scale(${.9+.1*subjectEnter}) rotate(${graphic.variant==='collage'?-1.4*subjectEnter:0}deg)`,background:graphic.cutoutPath?undefined:paper?'#f8f5ed':'#0c141c',border:graphic.cutoutPath?undefined:graphic.variant==='collage'?'8px solid #f8f5ed':'2px solid #ffffff90',boxSizing:'border-box',boxShadow:graphic.cutoutPath?undefined:'0 22px 48px #0007'}}>{media}</div>
      {!centered&&<svg viewBox="0 0 1920 1080" width="100%" height="100%" style={{position:'absolute'}}>
        <g opacity={labelEnter} transform={'translate('+((1-labelEnter)*28)+' 0)'}>
          {(customBackground||graphic.variant==='collage')&&<path d={graphic.variant==='collage'?'M950 294l28 12 14-16 30 14 28-9 26 10 24-14 712 9v426l-28-9-24 12-25-10-29 10-26-12-735 10Z':'M962 294H1822V734H962Z'} fill={graphic.variant==='collage'?'#f1eee5':'#10161ce8'}/>}
          {graphic.kicker&&<g opacity={stages.settle}><Heading text={graphic.kicker} x={1000} y={330} width={760} font={30} maxHeight={92} color={graphic.variant==='collage'?'#555363':customBackground?'#d3d7dc':ink}/></g>}
          <Heading text={title} x={1000} y={graphic.kicker?440:370} width={760} font={graphic.variant==='poster'?106:92} maxHeight={260} color={graphic.variant==='collage'?'#19232b':customBackground?'#f5f5f2':ink}/>
          <path d={'M1000 712h'+150*leader} stroke={accent} strokeWidth="5"/>
        </g>
        {graphic.cutoutPath&&graphic.variant!=='collage'&&<path d="M730 590Q850 585 900 530T980 508" fill="none" stroke={customBackground?'#f5f5f2':ink} strokeWidth="3" strokeLinecap="round" pathLength="1" strokeDasharray="1" strokeDashoffset={1-leader} opacity={leader}/>}
      </svg>}
    </>}
    {chart&&<svg viewBox="0 0 1920 1080" width="100%" height="100%" style={{position:'absolute'}}>
      {customBackground&&<rect x="105" y="65" width="1710" height="955" rx="18" fill={paper?'#f1eee5eb':'#10161ceb'}/>}
      <g opacity={enter} transform={`translate(0 ${(1-enter)*-22})`}><Heading text={title} x={150} y={92} width={1620} font={65} maxHeight={145} color={ink}/></g>
      {[0,1,2,3,4].map(i=><path key={i} d={'M170 '+(855-i*130)+'H1760'} stroke={ink} strokeOpacity={stages.detail*.16}/>)}
      {bars.map((b,i)=>{const slot=1500/Math.max(1,bars.length),x=210+i*slot,{source:grow,label}=documentaryCardStages(frame,frames,i,bars.length,motionEnabled),h=540*b.number/max*grow;return <g key={i}>
        <rect x={x} y={855-h} width={slot-55} height={h} rx="3" fill={accent} opacity={i%2 ? .62 : 1}/>
        <g opacity={label}><Heading text={countValue(b.value??'',grow)} x={x} y={792-h} width={slot-25} font={43} maxHeight={60} color={ink}/>
          <Heading text={b.label} x={x} y={886} width={slot-25} font={34} maxHeight={100} color={ink}/></g>
      </g>;})}
      {graphic.kicker&&<g opacity={stages.settle}><Heading text={graphic.kicker} x={170} y={996} width={1590} font={24} maxHeight={45} color={ink}/></g>}
    </svg>}
    {!profile&&!chart&&<>
      <AbsoluteFill style={{background:'linear-gradient(90deg,#060e1950,#060e1920)'}}/>
      <svg viewBox="0 0 1920 1080" width="100%" height="100%" style={{position:'absolute'}}>
        <foreignObject x="275" y="200" width="1370" height="720"><div style={{boxSizing:'border-box',padding:'38px 45px',background:paper?'#f3f0e8f5':'#10161ceb',borderLeft:'6px solid '+accent,color:ink,fontFamily:'Arial,sans-serif',fontSize:quoteFont,fontWeight:600,lineHeight:1.18,whiteSpace:'pre-wrap',overflowWrap:'anywhere',opacity:enter,transform:`translate(${(1-enter)*(graphic.variant==='collage'?-42:0)}px,${(1-enter)*26}px)`,boxShadow:'0 18px 48px #0004'}}>
          {words.map((word,i)=>{
            const cue=reading?.[word.readingIndex],last=reading?.[word.readingIndex+Math.max(0,word.readingCount-1)];
            const reveal=!motionEnabled||speech?1:documentaryPhraseWordProgress(frame,frames,i,words.length);
            const progress=!motionEnabled?1:speech?(cue&&last?clamp((frame/30-cue.startSeconds)/Math.max(.04,last.endSeconds-cue.startSeconds)):graphic.highlight?stages.detail:0):clamp((reveal-.2)/.8);
            const paint=word.highlightStart>=0,from=paint?word.highlightStart:0,to=paint?word.highlightEnd:word.text.length;
            const marked=<span style={{position:'relative',display:'inline-block',fontStyle:graphic.variant==='marker'?'italic':undefined}}>{word.text.slice(from,to)}<span aria-hidden style={{position:'absolute',inset:0,background:accent,color:markerInk,clipPath:`inset(0 ${(1-progress)*100}% 0 0)`}}>{word.text.slice(from,to)}</span></span>;
            return <Fragment key={i}><span style={{display:'inline-block',opacity:reveal,transform:`translateY(${(1-reveal)*16}px)`}}>{paint?<>{word.text.slice(0,from)}{marked}{word.text.slice(to)}</>:speech&&!graphic.highlight?marked:word.text}</span>{word.space}</Fragment>;
          })}
          {graphic.kicker&&<div style={{marginTop:32,fontSize:28,fontWeight:400,lineHeight:1.2,opacity:stages.settle}}>{graphic.kicker}</div>}
        </div></foreignObject>
      </svg>
    </>}
  </AbsoluteFill>;
}
