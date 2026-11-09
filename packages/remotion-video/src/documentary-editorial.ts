import {readingTokens} from '@gold-work/shared';
import {documentaryEase} from './documentary-design.js';

/** Three visual beats inside the supplied window, leaving at least 62% for reading.
 * These are animation phases, never fabricated narration timestamps. */
export function documentaryEditorialStages(frame:number,frames:number,motionEnabled=true) {
  if(!motionEnabled||frames<=2)return {revealFrames:1,main:1,detail:1,settle:1};
  const revealFrames=Math.max(1,Math.min(36,Math.max(0,frames-1)*.38));
  return {revealFrames,main:documentaryEase(frame/(revealFrames*.45)),
    detail:documentaryEase((frame-revealFrames*.32)/(revealFrames*.48)),
    settle:documentaryEase((frame-revealFrames*.62)/(revealFrames*.38))};
}

/** A whole card's entrance is budgeted together, including its final rule.
 * Adding cards never pushes the last label into the reading hold. */
export function documentaryCardStages(frame:number,frames:number,index:number,count:number,motionEnabled=true) {
  if(!motionEnabled||frames<=2)return {source:1,label:1,rule:1};
  const {revealFrames}=documentaryEditorialStages(frame,frames);
  const offset=Math.max(0,Math.min(1,index/Math.max(1,count-1)))*.38;
  return {source:documentaryEase((frame/revealFrames-offset)/.3),
    label:documentaryEase((frame/revealFrames-offset-.22)/.24),
    rule:documentaryEase((frame/revealFrames-offset-.42)/.2)};
}

/** Preserve an overview of both portrait and panoramic sources. */
export function documentarySubjectSize(aspect:number,containerAspect:number,centered=false,cutout=false) {
  const source=Number.isFinite(aspect)&&aspect>0?aspect:16/9;
  const canvas=Number.isFinite(containerAspect)&&containerAspect>0?containerAspect:16/9;
  // A cutout has its own transparent canvas and is fitted by Img. Do not size it
  // as the original photograph; keep a tall stage with safe entrance margins.
  if(cutout)return {width:centered?.82:.48,height:.90};
  const width=Math.min(centered ? .92 : .50,.90*source/canvas);
  return {width,height:width*canvas/source};
}

export function documentaryBoardLayout(count:number,width:number,height:number) {
  const total=Math.max(1,Math.min(5,count)),portrait=width<height;
  const columns=portrait?(total<=2?1:2):total<=2?total:total===4?2:3;
  const rows=Math.ceil(total/columns);
  return {columns,rows,slotW:width*.88/columns,slotH:height*(rows===1 ? .67 : .72/rows),top:height*(rows===1 ? .19 : .18)};
}

/** Words rise within their reserved boxes. No enlargement can consume a neighbour's space. */
export function documentaryPhraseWordProgress(frame:number,frames:number,index:number,count:number) {
  if(frames<=2)return 1;
  const {revealFrames}=documentaryEditorialStages(frame,frames);
  const delay=Math.max(0,Math.min(1,index/Math.max(1,count-1)))*revealFrames*.55;
  return documentaryEase((frame-delay)/(revealFrames*.45));
}

/** Only an explicit part-of-whole or percent gets a scale. Dates, scores,
 * bare counts, ranges and approximate statements remain literal typography. */
export function documentaryStatisticRatio(value:string) {
  const text=value.trim();
  const part=/^(\d+)(\s+(?:out\s+of|of|из)\s+)(\d+)(\s+[\p{L}\p{M}][\p{L}\p{M}\s-]*)?$/iu.exec(text);
  if(part){
    const numerator=Number(part[1]),denominator=Number(part[3]);
    if(!Number.isSafeInteger(numerator)||!Number.isSafeInteger(denominator)||denominator<=0||numerator>denominator)return;
    return {main:part[1]!,context:part[2]!+part[3]!+(part[4]??''),fraction:numerator/denominator,
      segments:denominator<=24?denominator:undefined,filled:numerator};
  }
  const percent=/^(\d+(?:[.,]\d+)?)(\s*%)$/u.exec(text);
  if(percent){
    const amount=Number(percent[1]!.replace(',','.'));
    if(amount>100)return;
    return {main:percent[1]!,context:percent[2]!,fraction:amount/100,segments:undefined,filled:undefined};
  }
}

/** Compress only the entrance on short shots. The remainder is a readable hold. */
export function documentaryRevealFrame(frame:number,frames:number) {
  return frame/Math.max(.08,Math.min(1,frames/120));
}

/** Marker text stays readable for user colours, including yellow and purple. */
export function documentaryMarkerInk(color:string) {
  const rgb=/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/iu.exec(color);
  if(!rgb)return '#ffffff';
  const [r,g,b]=rgb.slice(1).map(s=>{const n=parseInt(s,16)/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;});
  return .2126*r!+.7152*g!+.0722*b!>.179?'#10161c':'#ffffff';
}

/** Original whitespace and punctuation survive animation; reading cues keep their indices. */
export function documentaryPhraseWords(text:string,highlight?:string) {
  const found=highlight?new RegExp(highlight.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'iu').exec(text)?.index??-1:-1;
  let offset=0,readingIndex=0;
  return (text.match(/\S+\s*|^\s+/gu)??[]).map(part=>{
    const word=part.trimEnd(),space=part.slice(word.length),start=offset;
    const from=found<0?-1:Math.max(0,found-start),to=found<0?-1:Math.min(word.length,found+highlight!.length-start);
    const count=readingTokens(word).length,index=readingIndex;
    offset+=part.length;readingIndex+=count;
    return {text:word,space,readingIndex:index,readingCount:count,highlightStart:to>from?from:-1,highlightEnd:to>from?to:-1};
  });
}
