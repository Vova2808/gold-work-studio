import type {ReactNode} from 'react';
import {AbsoluteFill,Img,useVideoConfig} from 'remotion';
import type {DocumentaryMotionGraphic as Graphic} from './documentary-timeline.js';
import {resolveMediaSource} from './MediaSurface.js';
import {documentaryEase} from './documentary-design.js';
import {countValue} from './DocumentaryMotionGraphic.js';
import {annotationPosition,annotationInsets,annotationLabelBox,annotationLeaderEnd,type AnnotationLabelBox} from './documentary-annotation-position.js';
import {DocumentaryBackground} from './DocumentaryBackground.js';
import {DocumentaryObjectComposition} from './DocumentaryObjectComposition.js';
import {DocumentaryComparisonBoard} from './DocumentaryComparisonBoard.js';
import {documentaryMarkerInk,documentaryRevealFrame} from './documentary-editorial.js';
import {documentaryMagnifierGeometry} from './documentary-magnifier.js';
import {fitDocumentaryText} from './documentary-typography.js';

const clamp=(v:number)=>Math.max(0,Math.min(1,v));
function wrap(text:string,width:number){
  const result:string[]=[];let line='';
  for(const word of text.split(/\s+/u)){if(line.length+word.length>width&&line){result.push(line);line=word;}else line+=(line?' ':'')+word;}
  if(line)result.push(line);return result;
}
function Copy({text,x,y,width,size=44,color='#182226',height=155,outline,weight=500,center=false}:{text:string;x:number;y:number;width:number;size?:number;color?:string;height?:number;outline?:string;weight?:number;center?:boolean}){
  const lines=wrap(text,Math.max(10,Math.floor(width/(size*.54))));
  const font=Math.min(size,height/(Math.max(1,lines.length)*1.17));
  const baseline=center?y+font*.35-(lines.length-1)*font*1.17/2:y;
  return <text x={x} y={baseline} fill={color} stroke={outline} strokeWidth={2.5} strokeLinejoin="round" paintOrder="stroke" fontFamily="Arial,sans-serif" fontWeight={weight} fontSize={font}>{lines.map((line,i)=><tspan key={i} x={x} dy={i?font*1.17:0}>{line}</tspan>)}</text>;
}

/** A single authored source is the composition's subject, not a thumbnail of it. */
export function documentarySingleImageCard(graphic:Graphic){
  return graphic.origin==='automatic'&&graphic.kind==='explainer'&&!graphic.artwork&&!graphic.diagram&&!graphic.argument
    &&graphic.boardLayout!=='compare'&&graphic.cards?.length===1&&graphic.cards[0]?.imagePath?graphic.cards[0]:undefined;
}

export function DocumentarySingleSource({graphic,frame,frames,width,height,moving=true}:{graphic:Graphic;frame:number;frames:number;width:number;height:number;moving?:boolean}){
  const card=documentarySingleImageCard(graphic);if(!card?.imagePath)return null;
  const progress=moving&&frames>2?clamp(frame/Math.max(1,(frames-1)*.75)):1;
  const arrival=moving&&frames>2?documentaryEase(clamp(frame/Math.max(1,Math.min(18,(frames-1)*.18)))):1;
  const copy=(!graphic.hideTitle&&graphic.title.trim())||card.label.trim();
  const portrait=height>width,copyWidth=width*.84,copyHeight=height*(portrait?.28:.31);
  const requested=Math.min(width*(portrait?.085:.065),height*.102);
  const fontSize=fitDocumentaryText(copy,requested,copyWidth,copyHeight,800);
  return <AbsoluteFill data-single-source-card style={{background:'#101820',overflow:'hidden',fontFamily:'Arial,sans-serif'}}>
    <Img src={resolveMediaSource(card.imagePath)} style={{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'contain',
      transform:`scale(${.985+.015*documentaryEase(progress)})`,transformOrigin:'center'}}/>
    {copy&&<>
      <div aria-hidden style={{position:'absolute',left:0,right:0,bottom:0,height:'52%',background:'linear-gradient(0deg,#081019ed, #0810199c 48%, transparent)',opacity:arrival}}/>
      <div data-single-source-thesis style={{position:'absolute',left:'8%',bottom:'6%',width:copyWidth,height:copyHeight,display:'flex',alignItems:'flex-end',
        color:'#f6f3eb',fontSize,fontWeight:800,lineHeight:1.12,overflowWrap:'anywhere',overflow:'hidden',opacity:arrival,
        transform:`translateY(${(1-arrival)*height*.012}px)`}}>{copy}</div>
    </>}
  </AbsoluteFill>;
}

/** One video decoder, editable text/cards, a deliberate diagram of relationships.
 * Connector lines attach to cards, never pretend to locate unobserved parts. */
export function DocumentaryExplainer({graphic,frame,frames,material,customBackground=false,motionEnabled=true}:{graphic:Graphic;frame:number;frames:number;material:ReactNode;customBackground?:boolean;motionEnabled?:boolean}){
  const {width,height}=useVideoConfig(),unit=width/1920;
  if(documentarySingleImageCard(graphic))return <DocumentarySingleSource graphic={graphic} frame={frame} frames={frames} width={width} height={height} moving={motionEnabled}/>;
  const paper=graphic.theme!=='dark',ink=paper?'#182226':'#f3f4ed',muted=paper?'#637075':'#acb7bd',accent=graphic.accentColor??(paper?'#156c78':'#8ad8dd');
  const outline=customBackground?documentaryMarkerInk(ink):undefined,mutedOutline=customBackground?documentaryMarkerInk(muted):undefined,accentOutline=customBackground?documentaryMarkerInk(accent):undefined;
  const cards:Graphic['cards']=graphic.cards?.slice(0,5)??graphic.items?.slice(0,5).map(label=>({label}));
  const statistic=graphic.kind==='statistic',compare=graphic.boardLayout==='compare'&&!statistic;
  const count=cards?.length??0,step=graphic.boardLayout==='steps';
  const progress=clamp(frame/Math.max(1,frames-1));
  // Finish every layer within the first 38% (at most 2.4 seconds), then hold.
  // The 84-frame choreography scales as a unit, including the last of five cards.
  const local=statistic?documentaryRevealFrame(frame,frames):frames<=2?84:frame*84/Math.max(1,Math.min(72,(frames-1)*.38));
  const enter=documentaryEase(local/(statistic?18:26)),settle=documentaryEase((local-22)/14),heading=documentaryEase((local-8)/20);
  const hasHeading=Boolean(!graphic.hideTitle&&graphic.title.trim()||graphic.kicker?.trim());
  const mediaY=statistic?270:hasHeading?285:185,mediaH=statistic?670:hasHeading?645:710,mediaCenter=mediaY+mediaH/2;
  const rowH=Math.min(190,600/Math.max(1,count)),rowTop=mediaCenter-count*rowH/2;
  const materialTransform=statistic?`translateY(${(1-enter)*35*unit}px)`:`translate(${(1-enter)*-108*unit}px,${((1-enter)*64-8*enter*(1-settle))*unit}px) scale(${.86+.16*enter-.02*settle}) rotate(${(1-enter)*-.9}deg)`;
  if(compare&&graphic.isolateSubject&&(cards?.filter(card=>card.imagePath).length??0)>=2)return <DocumentaryObjectComposition graphic={graphic} frame={frame} frames={frames} customBackground={customBackground}/>;
  if(compare)return <DocumentaryComparisonBoard frame={frame} frames={frames} accent={accent} variant={graphic.variant} theme={graphic.theme} title={graphic.hideTitle?undefined:graphic.title} customBackground={customBackground}
    items={cards?.map((card,index)=>({label:card.label,value:card.value,material:graphic.activeIndex===index?material:card.imagePath?<Img src={resolveMediaSource(card.imagePath)} style={{width:'100%',height:'100%',objectFit:'contain'}}/>:null}))}/>;
  return <AbsoluteFill style={{backgroundColor:customBackground?undefined:paper?'#f6f5f0':'#151d22',opacity:Math.min(statistic?enter:1,clamp((frames-frame)/8)),fontFamily:'Arial,sans-serif'}}>
    {!customBackground&&<DocumentaryBackground kind={graphic.background??(paper?'grid-light':'grid-dark')} frame={frame}/>}
    <div style={{position:'absolute',left:'4.8%',top:`${mediaY/10.8}%`,width:'57%',height:`${mediaH/10.8}%`,borderRadius:12*unit,overflow:'hidden',border:`1px solid ${paper?'#17252b40':'#ffffff55'}`,background:paper?'#e5e7e3':'#253239',boxShadow:'0 18px 40px #17252b20',opacity:statistic?1:documentaryEase(local/12),transform:materialTransform,transformOrigin:'50% 60%'}}>{material}</div>
    <svg viewBox="0 0 1920 1080" width="100%" height="100%" style={{position:'absolute',pointerEvents:'none'}}>
      {hasHeading&&<g opacity={statistic?1:heading} transform={`translate(0 ${statistic?0:(1-heading)*26})`}>
        <path d={`M92 64h${90*(statistic?enter:heading)}`} stroke={ink} strokeWidth="6"/>
        <text x="92" y="105" fontSize="23" fill={muted} stroke={mutedOutline} strokeWidth={2.5} strokeLinejoin="round" paintOrder="stroke" letterSpacing="4">{graphic.kicker??''}</text>
        {!graphic.hideTitle&&<Copy text={graphic.title} x={92} y={170} width={1740} size={62} height={125} color={ink} outline={outline}/>}
      </g>}
      {!statistic&&count>0&&<g opacity={documentaryEase((local-36)/12)}>
        {/* This bracket starts at the material FRAME, never at a guessed image detail. */}
        {!step&&<path d={`M1186 ${mediaCenter}H1240`} fill="none" stroke={accent} strokeWidth="3" pathLength="1" strokeDasharray="1" strokeDashoffset={1-documentaryEase((local-36)/12)}/>}
        <path d={`M1240 ${rowTop+rowH/2}V${rowTop+(count-.5)*rowH}`} fill="none" stroke={muted} strokeWidth="2" pathLength="1" strokeDasharray="1" strokeDashoffset={1-documentaryEase((local-38)/16)}/>
      </g>}
      {statistic?<>
        <path d={`M1220 374H${1220+595*enter}`} stroke={ink} strokeWidth="3"/>
        <Copy text={countValue(graphic.value??'',documentaryEase(clamp(frame/28)))} x={1220} y={530} width={585} size={112} height={220} color={ink} outline={outline}/>
        <path d={`M1220 800H${1220+595*documentaryEase(clamp((frame-10)/25))}`} stroke={accent} strokeWidth="10"/>
        <text x="1220" y="861" fontSize="24" fill={muted} stroke={mutedOutline} strokeWidth={2.5} strokeLinejoin="round" paintOrder="stroke">{graphic.kicker??''}</text>
      </>:cards?.map((card,index)=>{
        const delay=36+index*22/Math.max(1,count-1),leader=documentaryEase((local-delay)/12),arrival=documentaryEase((local-delay-4)/14),label=documentaryEase((local-delay-10)/16),accentReveal=documentaryEase((local-delay-20)/6);
        const active=graphic.activeIndex===undefined||graphic.activeIndex===index;
        const x=1320,y=rowTop+index*rowH,thumb=Boolean(card.imagePath),copyX=x+(thumb?126:58),copyW=1828-copyX;
        const longestWord=Math.max(1,...card.label.split(/\s+/u).map(word=>word.length));
        const size=Math.min(count>3?40:58,copyW/(longestWord*.6));
        const labelY=y+rowH*(card.value ? .32 : .5);
        return <g key={index} opacity={active?1:.56}>
          <path d={`M1240 ${y+rowH/2}H1302`} fill="none" stroke={active?accent:muted} strokeWidth="3" pathLength="1" strokeDasharray="1" strokeDashoffset={1-leader}/>
          <circle cx="1302" cy={y+rowH/2} r={4+2*accentReveal} fill={active?accent:muted} opacity={leader}/>
          <g opacity={arrival} transform={`translate(${(1-arrival)*48} ${(1-arrival)*12})`}>
            {thumb?<foreignObject x={x} y={y+22} width="106" height={rowH-44}><Img src={resolveMediaSource(card.imagePath!)} style={{width:'100%',height:'100%',objectFit:'contain'}}/></foreignObject>:<text x={x} y={y+rowH/2+10} fontSize="28" fontWeight="700" fill={muted} stroke={mutedOutline} strokeWidth={2.5} paintOrder="stroke">{index+1}</text>}
          </g>
          <g opacity={label} transform={`translate(0 ${(1-label)*24})`}>
            <Copy text={card.label} x={copyX} y={labelY} width={copyW} size={size} height={rowH*(card.value ? .43 : .68)} color={ink} outline={outline} weight={700} center/>
            {card.value&&<Copy text={card.value} x={copyX} y={y+rowH*.79} width={copyW} size={count>3?28:36} height={rowH*.25} color={accent} outline={accentOutline}/>}
            <path d={`M${copyX} ${y+rowH-12}h${Math.min(150,copyW)*accentReveal}`} stroke={active?accent:muted} strokeWidth="3"/>
          </g>
        </g>;
      })}
      {statistic&&<><path d="M92 1003H1828" stroke={muted} strokeWidth="1"/>
        <path d={`M92 1003H${92+1736*progress}`} stroke={accent} strokeWidth="4"/>
        {[92,1828].map(x=><path key={x} d={`M${x-7} 985h14m-7-7v14`} stroke={ink} strokeWidth="2"/>)}</>}
    </svg>
  </AbsoluteFill>;
}

/** Contain-fit media and anchors share the same uncropped coordinate system. */
export function DocumentaryAnnotations({graphic,frame,frames=150,aspect,containerAspect,accent='#60ffc5'}:{graphic:Graphic;frame:number;frames?:number;aspect:number;containerAspect:number;accent?:string}){
  const local=documentaryRevealFrame(frame,frames);
  const {width:canvasWidth,height:canvasHeight}=useVideoConfig();
  const inset=annotationInsets(graphic);
  const availableWidth=1-2*inset.horizontal,availableHeight=1-2*inset.vertical;
  const viewportAspect=containerAspect*availableWidth/availableHeight;
  const width=1920*availableWidth*Math.min(1,aspect/viewportAspect),height=1080*availableHeight*Math.min(1,viewportAspect/aspect);
  const annotations=[...(graphic.annotations??[])].slice(0,3).sort((a,b)=>(a.points[0]?.y??50)-(b.points[0]?.y??50));
  const occupied:AnnotationLabelBox[]=[];
  const lens=graphic.variant==='magnifier'?documentaryMagnifierGeometry(graphic,frame/30,aspect,canvasWidth,canvasHeight):undefined;
  if(lens)occupied.push({x:(lens.lens.x-lens.radius)*1920/canvasWidth,y:(lens.lens.y-lens.radius)*1080/canvasHeight,width:lens.radius*2*1920/canvasWidth,height:lens.radius*2*1080/canvasHeight});
  const project=(p:{x:number;y:number})=>({x:(1920-width)/2+p.x/100*width,y:(1080-height)/2+p.y/100*height});
  const anchors=annotations.flatMap(a=>a.points.map(project));
  let captionIndex=0;
  return <AbsoluteFill style={{pointerEvents:'none'}}><svg viewBox="0 0 1920 1080" width="100%" height="100%" preserveAspectRatio="none">
    {annotations.map((annotation,index)=>{
      if(!annotation.label.trim())return null;
      const point=annotationPosition(annotation.points,frame/30),first=annotation.points[0];
      const positioned=graphic.origin==='manual'||Number.isFinite(annotation.confidence)&&annotation.confidence!>=.93;
      const labelWidth=Math.min(460,Math.max(200,Math.min(22,annotation.label.length)*18+44));
      const labelHeight=Math.max(66,wrap(annotation.label,Math.floor((labelWidth-40)/18)).length*39+26);
      const box=positioned&&point&&first?annotationLabelBox(project(first),labelWidth,labelHeight,occupied,anchors):undefined;
      // Old reviews discarded coordinate confidence. Preserve their names as
      // lower thirds, without pretending an unverified point locates a detail.
      const label=box??{x:96,y:984-labelHeight-captionIndex++*(labelHeight+14),width:labelWidth,height:labelHeight};
      occupied.push(label);
      const anchor=box&&point?project(point):undefined,end=anchor?annotationLeaderEnd(anchor,label):undefined;
      const pointReveal=documentaryEase((local-index*10)/12),reveal=documentaryEase((local-index*10-8)/18),labelReveal=documentaryEase((local-index*10-(lens?32:20))/14);
      return <g key={index}>
        {anchor&&end&&<><path d={`M${anchor.x} ${anchor.y}L${end.x} ${end.y}`} fill="none" stroke={graphic.variant==='technical'?accent:'#fff'} strokeOpacity=".8" strokeWidth="1.5" pathLength="1" strokeDasharray="1" strokeDashoffset={1-reveal}/>
          <circle cx={anchor.x} cy={anchor.y} r="6" fill={accent} stroke="#182028" strokeWidth="1" opacity={pointReveal}/></>}
        <g opacity={labelReveal} transform={`translate(0 ${(1-labelReveal)*10})`}>
        <rect {...label} rx="4" fill="#10161ce8" stroke="#ffffff25" strokeWidth="1"/>
        <rect x={label.x+20} y={label.y+17} width="22" height="2" fill={accent}/>
        <Copy text={annotation.label} x={label.x+20} y={label.y+48} width={label.width-40} size={32} height={label.height-24} color="#f5f5f2"/>
        </g>
      </g>;
    })}
  </svg></AbsoluteFill>;
}
