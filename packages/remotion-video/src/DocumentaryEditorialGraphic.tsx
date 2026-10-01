import type {ReactNode} from 'react';
import {AbsoluteFill,Img} from 'remotion';
import type {DocumentaryMotionGraphic as Graphic} from './documentary-timeline.js';
import {DocumentaryBackground} from './DocumentaryBackground.js';
import {resolveMediaSource} from './MediaSurface.js';
import {documentaryEase} from './documentary-design.js';
import {readingTokens} from '@gold-work/shared';

const clamp=(n:number)=>Math.max(0,Math.min(1,n));
function lines(text:string,limit:number){const result:string[]=[];let line='';for(const word of text.split(/\s+/u)){if(line&&line.length+word.length+1>limit){result.push(line);line=word;}else line+=(line?' ':'')+word;}if(line)result.push(line);return result;}
function Heading({text,x,y,width,font=100,color='#fff',maxHeight=420}:{text:string;x:number;y:number;width:number;font?:number;color?:string;maxHeight?:number}){
  const rows=lines(text,Math.max(8,Math.floor(width/(font*.72)))),longest=Math.max(1,...rows.map(row=>row.length)),size=Math.min(font,maxHeight/Math.max(1,rows.length)/1.13,width/(longest*.75));
  return <text x={x} y={y} fill={color} fontFamily="Arial,sans-serif" fontWeight="800" fontSize={size}>{rows.map((line,i)=><tspan key={i} x={x} dy={i?size*1.13:0}>{line}</tspan>)}</text>;
}
export function DocumentaryEditorialGraphic({graphic,frame,frames,material,accent,customBackground=false}:{graphic:Graphic;frame:number;frames:number;material:ReactNode;accent:string;customBackground?:boolean}){
  const enter=documentaryEase(clamp(frame/20)),profile=graphic.kind==='subject-card',chart=graphic.kind==='bar-chart',collage=graphic.variant==='collage';
  const title=graphic.title,background=graphic.background??(profile?'spotlight':chart?'grid-dark':'grid-light');
  const media=graphic.cutoutPath?<Img src={resolveMediaSource(graphic.cutoutPath)} style={{width:'100%',height:'100%',objectFit:'contain',filter:'drop-shadow(0 20px 32px #0008)'}}/>:material;
  const quoteLines=lines(title,42),quoteFont=Math.min(57,500/Math.max(1,quoteLines.length)/1.25);
  const quoteTop=540-quoteLines.length*quoteFont*.65;
  const highlight=(graphic.highlight??quoteLines[0]??'').toLocaleLowerCase();
  const highlightAt=quoteLines.join(' ').toLocaleLowerCase().indexOf(highlight);
  const bars=graphic.cards?.map(c=>({...c,number:Math.max(0,Number(c.value?.match(/^\d+(?:[.,]\d+)?/u)?.[0]?.replace(',','.'))||0)}))??[];
  const max=Math.max(1,...bars.map(b=>b.number));
  const speech=graphic.quoteMode!=='phrase',reading=graphic.reading?.text===title?graphic.reading.words:undefined;
  // Keep the entire sentence visible until the narrator finishes its final word.
  const fadeFrames=graphic.kind==='quote'&&speech&&reading?.length
    ? Math.max(1,Math.min(10,frames-Math.ceil(reading.at(-1)!.endSeconds*30))) : 10;
  const exit=clamp((frames-frame)/fadeFrames);
  return <AbsoluteFill style={{opacity:Math.min(profile||chart?enter:clamp(frame/5),exit)}}>
    {(profile||chart)&&!customBackground&&<DocumentaryBackground kind={background} frame={frame} accent={accent}/>}
    {profile&&<>
      {graphic.variant==='poster'&&<div style={{position:'absolute',left:'8%',top:'13%',width:'31%',height:'74%',border:`4px solid ${accent}`,background:`${accent}20`,transform:'rotate(-4deg)'}}/>}
      <div style={{position:'absolute',left:'2.5%',top:'5%',width:'43%',height:'92%',transform:`translateX(${(1-enter)*-80}px) scale(${.97+enter*.03})`,...(!graphic.cutoutPath?{maskImage:'linear-gradient(90deg,transparent,#000 5%,#000 88%,transparent)'}:{})}}>{media}</div>
      <svg viewBox="0 0 1920 1080" width="100%" height="100%" style={{position:'absolute'}}>
        {collage&&<path d="M830 -10L839 136 828 280 843 450 832 650 840 820 833 1100M860 425L1900 415 1890 450 1925 482 1910 660 1918 715 859 726Z" stroke="#e8e9f3" strokeWidth="18" fill="#e8e9f3"/>}
        <text x="895" y="380" fill={collage?accent:'#ddd'} fontFamily="Arial,sans-serif" fontSize="35" letterSpacing="3">{graphic.kicker}</text>
        <Heading text={title.toLocaleUpperCase()} x={895} y={collage?545:535} width={925} font={collage?86:110} maxHeight={collage?200:360} color={collage?'#151922':accent}/>
        {!collage&&<path d={`M900 865h${(graphic.variant==='poster'?850:170)*enter}`} stroke={accent} strokeWidth="7"/>}
      </svg>
    </>}
    {chart&&<svg viewBox="0 0 1920 1080" width="100%" height="100%" style={{position:'absolute'}}>
      <Heading text={title} x={150} y={150} width={1620} font={65} maxHeight={140}/>
      {[0,1,2,3,4].map(i=><path key={i} d={`M170 ${855-i*140}H1760`} stroke="#a1aabd" strokeOpacity=".2"/>)}
      {bars.map((b,i)=>{const width=1250/Math.max(1,bars.length),x=330+i*(1380/Math.max(1,bars.length)),h=560*b.number/max*documentaryEase(clamp((frame-i*6)/30));return <g key={i}>
        <rect x={x} y={855-h} width={Math.min(300,width-45)} height={h} rx="3" fill={i%2? '#bcc2ff':accent}/>
        <Heading text={b.value??''} x={x} y={825-h} width={width-20} font={43} maxHeight={65}/>
        <Heading text={b.label} x={x} y={921} width={width-20} font={33} maxHeight={100}/>
      </g>;})}
      <text x="170" y="1000" fontSize="25" fontFamily="Arial,sans-serif" fill="#abb5c7">{graphic.kicker}</text>
    </svg>}
    {!profile&&!chart&&<>
      <AbsoluteFill style={{background:'linear-gradient(90deg,#060e1970,#060e1940)'}}/>
      <svg viewBox="0 0 1920 1080" width="100%" height="100%" style={{position:'absolute'}}>
        {graphic.variant!=='collage'&&<rect x="280" y={quoteTop-quoteFont-22} width="1360" height={quoteLines.length*quoteFont*1.32+95} fill="#092a62"/>}
        {quoteLines.map((line,i)=>{const y=quoteTop+i*quoteFont*1.32,arrival=speech?1:documentaryEase(clamp((frame-i*6)/15)),offset=quoteLines.slice(0,i).reduce((n,s)=>n+s.length+1,0),from=Math.max(0,highlightAt-offset),to=Math.min(line.length,highlightAt+highlight.length-offset),marked=highlightAt>=0&&to>from;
          let wordIndex=readingTokens(quoteLines.slice(0,i).join(' ')).length;
          const highlightColor=graphic.variant==='collage'?'#bea61b':'#008dbb';
          return <g key={i} opacity={arrival}>
          <foreignObject x="320" y={y-quoteFont*.95} width="1270" height={quoteFont*1.32}><div style={{fontFamily:'Arial,sans-serif',fontSize:quoteFont,fontWeight:700,lineHeight:1.2,color:'white',whiteSpace:'pre'}}>{speech?(line.match(/\S+\s*/gu)??[]).map((word,j)=>{const count=readingTokens(word).length,cue=reading?.[wordIndex],last=reading?.[wordIndex+Math.max(0,count-1)];wordIndex+=count;
            const progress=cue&&last?clamp((frame/30-cue.startSeconds)/Math.max(.04,last.endSeconds-cue.startSeconds)):0;
            return <span key={j} style={{backgroundImage:`linear-gradient(90deg,${highlightColor} ${progress*100}%,transparent ${progress*100}%)`,padding:'2px 0'}}>{word}</span>;
          }):marked?<>{line.slice(0,from)}<span style={{background:highlightColor}}>{line.slice(from,to)}</span>{line.slice(to)}</>:line}</div></foreignObject>
        </g>;})}
        {graphic.kicker&&<text x="320" y={quoteTop+quoteLines.length*quoteFont*1.32+45} fontSize="29" fontFamily="Arial,sans-serif" fill="white">{graphic.kicker}</text>}
      </svg>
    </>}
  </AbsoluteFill>;
}
