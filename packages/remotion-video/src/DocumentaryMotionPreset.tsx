import {useMemo,type ComponentProps,type CSSProperties,type ReactNode} from 'react';
import {AbsoluteFill,Img} from 'remotion';
import type {DocumentaryMotionPresetId} from '@gold-work/shared';
import type {DocumentaryMotionGraphic} from './documentary-timeline.js';
import {resolveMediaSource} from './MediaSurface.js';
import {fitDocumentaryText} from './documentary-typography.js';
import {documentaryMarkerInk,documentaryStatisticRatio} from './documentary-editorial.js';
import {motionPresetBoardRects,motionPresetChoreography,motionPresetHighlightRange,motionPresetItemProgress,motionPresetSourceRect,motionPresetTextGroups,type MotionPresetRect} from './documentary-motion-preset-choreography.js';
import {automaticBoardRevealWindows} from './documentary-board-reveal.js';
import {DocumentarySourceEmphasis} from './DocumentarySourceEmphasis.js';

export interface DocumentaryMotionPresetProps {
  graphic:DocumentaryMotionGraphic;frame:number;frames:number;material:ReactNode;accent:string;
  width:number;height:number;mediaAspect:number;isVideo:boolean;motionEnabled:boolean;customBackground?:boolean;sourceFilter?:string;
  /** Set only by the automatic, unpinned scene path. */
  stageAutomaticBoards?:boolean;
}
type Rect=MotionPresetRect;
const rect=(x:number,y:number,w:number,h:number):Rect=>({x,y,w,h});
const box=(r:Rect,w:number,h:number):CSSProperties=>({position:'absolute',left:r.x*w,top:r.y*h,width:r.w*w,height:r.h*h});

const displayFont='Bahnschrift,"Arial Narrow",Impact,"Segoe UI",sans-serif';
const editorialFont='"Segoe UI",Arial,sans-serif';
const clampMotion=(value:number)=>Math.max(0,Math.min(1,value));
const smoothMotion=(value:number)=>{const t=clampMotion(value);return t*t*(3-2*t);};

// Only the display treatments opt into these metrics; existing board/profile text keeps its fitter.
function fitDisplayText(text:string,size:number,width:number,height:number,weight:number,family:string):number {
  if(typeof document==='undefined')return size;
  const context=document.createElement('canvas').getContext('2d');if(!context)return size;
  for(let candidate=size;candidate>=12;candidate--){
    context.font=`${weight} ${candidate}px ${family}`;
    let lines=0,tooWide=false;
    for(const paragraph of text.split('\n')){
      let line='';lines++;
      for(const word of paragraph.split(/\s+/u).filter(Boolean)){
        if(context.measureText(word).width>width){tooWide=true;break;}
        const next=line?`${line} ${word}`:word;
        if(line&&context.measureText(next).width>width){lines++;line=word;}else line=next;
      }
    }
    if(!tooWide&&lines*candidate*1.15<=height)return candidate;
  }
  return 12;
}

// Prefer the author's punctuation to arbitrary word cuts, retaining every character and offset.
function kineticGroups(copy:string,count:number):string[] {
  const clauses=copy.match(/[^\n,;:!?—–]+(?:[\n,;:!?—–]+|$)/gu);
  if(clauses&&clauses.length>1&&clauses.length<=count&&clauses.join('')===copy)return clauses;
  return motionPresetTextGroups(copy,count);
}

function calendarLiteral(copy:string):{year:string;rest:string}|undefined {
  const years=Array.from(copy.matchAll(/(?<!\d)\d{4}(?!\d)/gu));
  if(years.length!==1)return undefined;
  const match=years[0]!,start=match.index!;
  return {year:match[0],rest:(copy.slice(0,start)+copy.slice(start+match[0].length)).replace(/^[\s,]+|[\s,]+$/gu,'')};
}

function PresetText({text,r,width,height,unit,size=88,weight=750,color='#fffaf2',progress=1,align='left',dx=0,dy=16,scale=1,opacity=1,outline=false,highlightRange,markerColor='#e6bc39',highlightProgress=1,strip=false,reveal='none',fontFamily}: {
  text:string;r:Rect;width:number;height:number;unit:number;size?:number;weight?:number;color?:string;progress?:number;
  align?:'left'|'center'|'right';dx?:number;dy?:number;scale?:number;opacity?:number;outline?:boolean;
  highlightRange?:{start:number;end:number};markerColor?:string;highlightProgress?:number;strip?:boolean;reveal?:'none'|'words'|'wipe';fontFamily?:string;
}) {
  const font=useMemo(()=>fontFamily?fitDisplayText(text,size*unit,r.w*width,r.h*height,weight,fontFamily):fitDocumentaryText(text,size*unit,r.w*width,r.h*height,weight),[text,size,unit,r.w,r.h,width,height,weight,fontFamily]);
  if(!text)return null;
  const lightInk=documentaryMarkerInk(color)==='#10161c';
  const parts=text.split(/(\s+)/u),wordCount=Math.ceil(parts.length/2);
  const copy=highlightRange?<>{text.slice(0,highlightRange.start)}<mark data-motion-highlight style={{background:highlightProgress>=1?markerColor:`linear-gradient(90deg,${markerColor} ${highlightProgress*100}%,transparent ${highlightProgress*100}%)`,color:highlightProgress>=1?documentaryMarkerInk(markerColor):color,textShadow:'none',boxDecorationBreak:'clone',WebkitBoxDecorationBreak:'clone'}}>{text.slice(highlightRange.start,highlightRange.end)}</mark>{text.slice(highlightRange.end)}</>:reveal==='words'?parts.map((part,i)=>{
    if(/^\s*$/u.test(part))return part;
    const arrival=Math.max(0,Math.min(1,progress*1.65-Math.floor(i/2)/Math.max(1,wordCount-1)*.65));
    return <span key={i} style={{display:'inline-block',maxWidth:'100%',overflowWrap:'anywhere',opacity:arrival,transform:`translateY(${(1-arrival)*.32}em) scale(${.96+.04*arrival})`,transformOrigin:'left bottom'}}>{part}</span>;
  }):text;
  return <div style={{...box(r,width,height),display:'flex',alignItems:'center',opacity:progress*opacity,
    transform:`translate(${(1-progress)*dx*unit}px,${(1-progress)*dy*unit}px) scale(${scale})`,transformOrigin:align==='center'?'center':'left center',
    fontFamily:fontFamily??'Arial,sans-serif',fontSize:font,fontWeight:weight,lineHeight:1.1,textAlign:align,color,whiteSpace:'pre-wrap',overflowWrap:'anywhere',
    clipPath:reveal==='wipe'?`inset(0 ${(1-progress)*100}% 0 0)`:undefined,
    textShadow:outline||!lightInk?undefined:'0 2px 12px #000c',WebkitTextStroke:outline?`${unit}px ${color}`:undefined,WebkitTextFillColor:outline?'transparent':undefined}}>
    <div style={{width:'100%',minWidth:0}}><span style={strip?{background:lightInk?'#090d12de':'#f3f0e8f2',boxDecorationBreak:'clone',WebkitBoxDecorationBreak:'clone'}:undefined}>{copy}</span></div>
  </div>;
}

/** Source first, editorial overlays second. One source instance stays large and
 * visible even while the text enters. No generated labels or detail coordinates. */
export function DocumentaryMotionPreset({graphic,frame,frames,material,accent,width,height,mediaAspect,motionEnabled,customBackground=false,sourceFilter,stageAutomaticBoards=false}:DocumentaryMotionPresetProps) {
  const id:DocumentaryMotionPresetId|undefined=graphic.preset;
  if(!id)return null;
  if(id==='source-emphasis')return <DocumentarySourceEmphasis graphic={graphic} frame={frame} frames={frames} material={material}
    accent={accent} width={width} height={height} motionEnabled={motionEnabled} sourceFilter={sourceFilter}/>;
  const portrait=width<height,unit=Math.min(width,height)/1080,hasSource=graphic.showSource!==false;
  const cutout=graphic.kind==='subject-card'&&Boolean(graphic.cutoutPath);
  const p=motionPresetChoreography(frame,frames,motionEnabled,id),title=graphic.hideTitle?'':graphic.title,value=graphic.value??'',kicker=graphic.kicker??'';
  const paper=!hasSource&&graphic.theme==='paper',ink=paper?'#19232b':'#fffaf2',muted=paper?'#3b4a55':'#e1e2df';
  const text=(copy:string,r:Rect,size=88,progress=p.primary,options:Partial<ComponentProps<typeof PresetText>>={})=><PresetText text={copy} r={r} width={width} height={height} unit={unit} size={size} progress={progress} color={ink} markerColor={accent} {...options}/>;
  const item=(i:number,count:number)=>motionPresetItemProgress(frame,frames,i,count,motionEnabled,id);
  const rule=(r:Rect,progress=p.rule,color=accent)=><div aria-hidden style={{...box(r,width,height),background:color,opacity:progress,transform:`scaleX(${progress})`,transformOrigin:'left'}}/>;
  const scrim=(direction='top',strength=.66)=><AbsoluteFill aria-hidden style={{background:`linear-gradient(to ${direction},rgba(0,0,0,${strength}),transparent 80%)`}}/>;
  const corners=(r:Rect,progress=p.rule)=> <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" style={{...box(r,width,height),opacity:progress}}>
    <path d="M0 15V0H15 M85 0H100V15 M100 85V100H85 M15 100H0V85" fill="none" stroke={accent} strokeWidth={6*unit} vectorEffect="non-scaling-stroke" pathLength="1" strokeDasharray="1" strokeDashoffset={1-progress}/>
  </svg>;
  const circle=(r:Rect,opacity=.36)=>{
    const d=Math.min(r.w*width,r.h*height);
    return <div aria-hidden style={{position:'absolute',left:(r.x+r.w/2)*width-d/2,top:(r.y+r.h/2)*height-d/2,width:d,height:d,borderRadius:'50%',border:`${2*unit}px solid ${accent}`,opacity:opacity*p.secondary,transform:`scale(${.97+.03*p.secondary+.003*p.ambient})`}}/>;
  };
  const footer=(r=rect(.08,.88,.84,.065))=>text(kicker,r,30,p.secondary,{color:muted,weight:500});
  const copy=[title,value].filter(Boolean).join('\n');
  const dateCopy=value||title,dateTitle=value&&value!==title?title:'';
  const support=[kicker,graphic.kind==='subject-card'?value:''].filter(Boolean).join('\n');
  let composition:ReactNode;
  switch(id){
    case 'type-slam': {
      const arrival=motionEnabled?smoothMotion(frame/Math.max(1,Math.min(8,(frames-1)*.12))):1;
      composition=<><div data-type-action="impact"/>{hasSource&&scrim('top',.66)}
        {text(copy,rect(.08,.27,.84,.46),184,arrival,{fontFamily:displayFont,align:'center',weight:900,dy:0,scale:1+.035*(1-arrival),highlightRange:motionPresetHighlightRange(title,graphic.highlight)})}
        {footer()}
      </>;break;
    }
    case 'type-ribbon': {
      const arrival=motionEnabled?smoothMotion(frame/Math.max(1,Math.min(12,(frames-1)*.15))):1;
      // Automatic plans formerly highlighted the entire caption. That is not
      // an emphasis span: it produced the same coloured slab on every scene.
      const highlight=graphic.origin==='automatic'&&graphic.highlight===title?undefined:graphic.highlight;
      const poster=graphic.variant==='poster';
      composition=<><div data-type-action={poster?'editorial-thesis':'inline-marker'}/>{hasSource&&scrim('top',poster?.72:.62)}
        {text(copy,poster?rect(.08,.36,.84,.38):rect(.08,.61,.84,.25),poster?140:96,arrival,{fontFamily:poster?displayFont:editorialFont,weight:poster?800:650,dy:0,
          highlightRange:motionPresetHighlightRange(title,highlight),highlightProgress:p.rule})}
        {footer(rect(.08,.925,.84,.045))}
      </>;break;
    }
    case 'type-echo': {
      const groups=kineticGroups(copy,2);let offset=0;
      composition=<><div data-type-action="counterpoint"/>{hasSource&&scrim('top',.74)}
        {groups.map((group,i)=>{
          const arrival=motionEnabled?smoothMotion((frame-i*Math.min(9,(frames-1)*.12))/Math.max(1,Math.min(12,(frames-1)*.22))):1;
          const range=motionPresetHighlightRange(title,graphic.highlight,offset,group.length);offset+=group.length;
          return <div key={i} data-kinetic-group={i} data-group-progress={arrival}>
            {text(group,i?rect(.08,.55,.84,.25):rect(.08,.32,.84,.18),i?174:94,arrival,{
              fontFamily:i?displayFont:editorialFont,weight:i?900:500,color:i?accent:ink,opacity:i?1:.75,
              dy:0,highlightRange:range,scale:i?1+.02*(1-arrival):1})}
          </div>;
        })}{footer()}
      </>;break;
    }
    case 'type-stack': {
      const groups=kineticGroups(copy,3);let offset=0;
      composition=<><div data-type-action="staircase"/>{hasSource&&scrim('top',.72)}
        {groups.map((group,i)=>{
          const arrival=motionEnabled?smoothMotion((frame-i*Math.min(7,(frames-1)*.10))/Math.max(1,Math.min(12,(frames-1)*.20))):1;
          const range=motionPresetHighlightRange(title,graphic.highlight,offset,group.length);offset+=group.length;
          const r=rect(.07+i*.07,.25+i*.20,.72,.17);
          return <div key={i} data-kinetic-group={i} data-group-progress={arrival}>
            {text(group,r,136,arrival,{fontFamily:displayFont,weight:i===groups.length-1?900:650,highlightRange:range,dy:9,color:i===groups.length-1?accent:ink})}
          </div>;
        })}{footer()}
      </>;break;
    }
    case 'chapter-signal':
      composition=<><div data-chapter-action="source-corners"/>{hasSource&&scrim('top',.62)}
        {corners(rect(.055,.075,.89,.79),p.rule)}
        {text(value,rect(.09,.16,.82,.23),260,p.primary,{fontFamily:displayFont,weight:900,color:accent,dy:0})}
        {text(title,rect(.09,.47,.82,.29),148,p.secondary,{fontFamily:displayFont,weight:850,dy:0})}
        {footer(rect(.09,.80,.82,.05))}
      </>;break;
    case 'chapter-dossier': {
      const beat=Math.max(1,Math.min(110,frames-1));
      const returning=motionEnabled&&hasSource?smoothMotion((frame-beat*.74)/Math.max(1,Math.min(8,beat*.13))):0;
      composition=<><div data-chapter-action="editorial-card"/>
        <AbsoluteFill data-chapter-matte="editorial" style={{background:'#eee9df',opacity:(1-returning)*p.primary}}>
          {text(value,rect(.08,.12,.84,.23),242,1,{fontFamily:displayFont,weight:900,color:'#243545',dy:0})}
          {text(title,rect(.08,.40,.84,.33),166,1,{fontFamily:displayFont,weight:850,color:'#18232c',dy:0})}
          {rule(rect(.08,.79,.84,.006),1,accent)}
          {text(kicker,rect(.08,.83,.84,.08),34,1,{fontFamily:editorialFont,color:'#3b4a55',weight:500,dy:0})}
        </AbsoluteFill>
      </>;break;
    }
    case 'chapter-marquee':
      composition=<><div data-chapter-action="monumental-number"/>{hasSource&&scrim('top',.76)}
        {text(value,rect(.04,.10,.92,.72),690,p.primary,{fontFamily:displayFont,weight:900,color:accent,opacity:.19,align:'center',dy:0,reveal:'wipe'})}
        {text(title,rect(.10,.37,.80,.33),170,p.secondary,{fontFamily:displayFont,weight:850,align:'center',dy:0})}
        {footer(rect(.10,.83,.80,.07))}
      </>;break;
    case 'chapter-aperture': {
      const reveal=motionEnabled&&hasSource?smoothMotion((frame-8)/Math.max(1,Math.min(32,(frames-1)*.38))):hasSource?1:0;
      const hold=motionEnabled&&hasSource?1-smoothMotion((frame-Math.min(65,(frames-1)*.62))/Math.max(1,Math.min(22,(frames-1)*.2))):1;
      composition=<><div data-chapter-action="open-source"/>
        <div aria-hidden style={{...box(rect(0,0,1,.5),width,height),background:'#090d12',transform:`translateY(${-reveal*100}%)`}}/>
        <div aria-hidden style={{...box(rect(0,.5,1,.5),width,height),background:'#090d12',transform:`translateY(${reveal*100}%)`}}/>
        <AbsoluteFill style={{opacity:hold}}>{hasSource&&scrim('top',.55)}
          {text(value,rect(.10,.20,.80,.13),102,p.primary,{fontFamily:displayFont,weight:700,color:accent,align:'center',dy:0})}
          {text(title,rect(.10,.39,.80,.30),164,p.secondary,{fontFamily:displayFont,weight:850,align:'center',dy:0})}
          {footer(rect(.10,.79,.80,.07))}
        </AbsoluteFill>
      </>;break;
    }
    case 'date-stamp':
      composition=<><div data-date-action="archive-stamp"/>{hasSource&&scrim('top',.48)}
        <div style={{...box(rect(.07,.61,.60,.24),width,height),background:'#eee9df',border:`${3*unit}px solid ${accent}`,boxSizing:'border-box',
          opacity:p.primary,transform:`rotate(${-2*(1-p.primary)}deg) scale(${1+.025*(1-p.primary)})`,transformOrigin:'left bottom'}}>
          {text(dateCopy,rect(.045,.08,.91,.48),112,1,{width:width*.60,height:height*.24,fontFamily:displayFont,weight:850,color:'#19232b',dy:0})}
          {text(dateTitle,rect(.045,.63,.91,.27),42,1,{width:width*.60,height:height*.24,fontFamily:editorialFont,weight:500,color:'#3b4a55',dy:0})}
        </div>{footer()}
      </>;break;
    case 'date-ruler': {
      const literal=calendarLiteral(dateCopy);
      composition=<><div data-date-action="year-axis"/>{hasSource&&scrim('top',.69)}
        <svg aria-hidden viewBox="0 0 1000 70" preserveAspectRatio="none" style={{...box(rect(.07,.39,.86,.07),width,height),clipPath:`inset(0 ${(1-p.rule)*100}% 0 0)`}}>
          <path d="M0 15H1000" fill="none" stroke={ink} strokeOpacity=".6" strokeWidth="2"/>
          {Array.from({length:21},(_,i)=><path key={i} d={`M${i*50} 5V${i===10?65:i%5?28:45}`} stroke={i===10?accent:ink} strokeWidth={i===10?5:2} opacity={i===10?1:.5}/>)}
        </svg>
        {text(literal?.year??dateCopy,rect(.10,.48,.80,.23),224,p.primary,{fontFamily:displayFont,weight:900,align:'center',dy:0})}
        {literal?.rest&&text(literal.rest,rect(.10,.73,.80,.08),62,p.secondary,{fontFamily:editorialFont,align:'center',weight:500,dy:0})}
        {text(dateTitle,rect(.10,.83,.80,.08),44,p.secondary,{fontFamily:editorialFont,align:'center',weight:500,dy:0})}
        {footer(rect(.10,.935,.80,.035))}
      </>;break;
    }
    case 'date-calendar': {
      const literal=calendarLiteral(dateCopy);
      const months=['january','february','march','april','may','june','july','august','september','october','november','december'];
      const russian=['январ','феврал','март','апрел','ма','июн','июл','август','сентябр','октябр','ноябр','декабр'];
      const rest=literal?.rest??'',lower=rest.toLocaleLowerCase();
      const english=months.findIndex(m=>new RegExp(`\\b${m}\\b`,'u').test(lower));
      const month=english>=0?english:russian.findIndex(m=>new RegExp(`(?:^|\\s)${m}\\p{L}*`,'u').test(lower));
      const year=Number(literal?.year),day=Number(/(?<!\d)(?:[12]\d|3[01]|[1-9])(?!\d)/u.exec(rest)?.[0]);
      const valid=month>=0&&Boolean(literal),days=valid?new Date(Date.UTC(year,month+1,0)).getUTCDate():0;
      const weekday=valid?(new Date(Date.UTC(year,month,1)).getUTCDay()+6)%7:0;
      const card=portrait?rect(.08,.16,.84,.67):rect(.065,.14,.42,.72),cw=card.w*width,ch=card.h*height;
      composition=<><div data-date-action="calendar-page"/>
        <div style={{...box(card,width,height),background:'#f2eee3',boxShadow:'0 16px 40px #0006',opacity:p.primary,
          transform:`translateY(${(1-p.primary)*10*unit}px) rotate(${-.8*(1-p.primary)}deg)`}}>
          <div aria-hidden style={{position:'absolute',left:0,right:0,top:0,height:'14%',background:accent}}/>
          {text(rest||dateCopy,rect(.07,.015,.86,.105),65,1,{width:cw,height:ch,fontFamily:editorialFont,color:'#10202b',weight:650,dy:0})}
          {text(literal?.year??'',rect(.07,.17,.86,.20),170,1,{width:cw,height:ch,fontFamily:displayFont,color:'#18232b',weight:900,dy:0})}
          {valid&&<div data-calendar-grid style={{position:'absolute',left:'7%',right:'7%',top:'43%',height:'49%',display:'grid',gridTemplateColumns:'repeat(7,1fr)',gridTemplateRows:'repeat(6,1fr)',gap:4*unit}}>
            {Array.from({length:days},(_,i)=>{const n=i+1,selected=n===day,col=(weekday+i)%7,row=Math.floor((weekday+i)/7);return <div key={n} data-calendar-day={n} style={{gridColumn:col+1,gridRow:row+1,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:editorialFont,fontSize:38*unit,fontWeight:selected?800:500,color:selected?'#fdf8ed':'#263741',background:selected?'#203c4c':'transparent',opacity:p.secondary}}>{n}</div>;})}
          </div>}
          {!valid&&text(dateTitle,rect(.07,.48,.86,.40),70,1,{width:cw,height:ch,fontFamily:editorialFont,color:'#263741',weight:500,dy:0})}
        </div>
        {valid&&text(dateTitle,portrait?rect(.08,.86,.84,.07):rect(.54,.70,.40,.17),64,p.secondary,{fontFamily:editorialFont,weight:550,dy:0})}
        {footer()}
      </>;break;
    }
    case 'date-orbit':
      composition=<><div data-date-action="chronology-note"/>{hasSource&&scrim('left',.63)}
        <div aria-hidden style={{...box(rect(.505,.48,.004,.37),width,height),background:accent,opacity:p.rule,transform:`scaleY(${p.rule})`,transformOrigin:'top'}}/>
        {text(dateCopy,rect(.55,.50,.38,.22),120,p.primary,{fontFamily:displayFont,weight:850,dy:0})}
        {text(dateTitle,rect(.55,.76,.38,.12),48,p.secondary,{fontFamily:editorialFont,weight:500,dy:0})}
        {footer(rect(.55,.925,.38,.045))}
      </>;break;
    case 'stat-monument':
    case 'stat-ticket':
    case 'stat-window':
    case 'stat-split': {
      const ratio=documentaryStatisticRatio(value.replace(/^(?:only|только)\s+/iu,''));
      const segmented=ratio?.segments!==undefined;
      const meter=(r:Rect)=>ratio?<div aria-hidden data-ratio={ratio.fraction} style={{...box(r,width,height),display:'flex',gap:8*unit,alignItems:'center',opacity:p.secondary}}>
        {segmented?Array.from({length:ratio.segments!},(_,i)=><div key={i} data-filled={i<ratio.filled!} style={{flex:1,height:'68%',boxSizing:'border-box',border:`${2*unit}px solid ${ink}90`,background:i<ratio.filled!?accent:'transparent',opacity:item(i,ratio.segments!),transform:`translateY(${(1-item(i,ratio.segments!))*10*unit}px)`}}/>):
          <div style={{width:'100%',height:6*unit,background:ink+'44'}}><div style={{width:ratio.fraction*100+'%',height:'100%',background:accent,transform:`scaleX(${p.rule})`,transformOrigin:'left'}}/></div>}
      </div>:null;
      if(id==='stat-monument')composition=<>{hasSource&&scrim('top',.65)}
        {text(value,rect(.08,.25,.84,.34),192,p.primary,{align:'center',weight:800,scale:1+.025*(1-p.primary)})}
        {meter(rect(.14,.64,.72,.065))}
        {text(title,rect(.10,ratio?.75:.65,.80,.15),62,p.secondary,{align:'center',weight:600})}{footer(rect(.10,.91,.80,.05))}
      </>;
      else if(id==='stat-ticket')composition=<>{hasSource&&scrim('top',.69)}
        {text(title,rect(.09,.31,.82,.13),58,p.secondary,{weight:600})}
        {text(value,rect(.09,.47,.82,.23),166,p.primary,{dy:10})}
        {meter(rect(.09,.74,.82,.08))}
        {footer()}
      </>;
      else if(id==='stat-window')composition=<>{hasSource&&<AbsoluteFill aria-hidden style={{background:'radial-gradient(ellipse at center,#0008,transparent 90%)'}}/>}
        {text(value,rect(.14,.30,.72,.29),180,p.primary,{align:'center',weight:650})}
        {text(title,rect(.14,.62,.72,.15),60,p.secondary,{align:'center',weight:600})}
        {meter(rect(.17,.81,.66,.045))}{corners(rect(.09,.24,.82,.57),p.rule)}{footer(rect(.10,.92,.80,.05))}
      </>;
      else composition=<>{hasSource&&scrim('right',.62)}
        <div aria-hidden style={{...box(rect(.71,0,.10,1),width,height),background:accent,opacity:p.secondary*.12,transform:'skewX(-12deg)'}}/>
        {text(value,rect(.08,.25,.84,.30),182,p.primary,{dx:15,dy:0})}
        {ratio?meter(rect(.08,.61,.84,.065)):rule(rect(.08,.60,.23,.007))}
        {text(title,rect(.08,ratio?.73:.66,.84,.14),66,p.secondary,{weight:600})}{footer()}
      </>;
      break;
    }
    case 'board-cascade':
    case 'board-staircase':
    case 'board-orbit':
    case 'board-ledger': {
      const cards=graphic.cards?.length?graphic.cards.slice(0,5):(graphic.items??[]).slice(0,5).map(label=>({label,value:undefined}));
      const requested=graphic.boardLayout??(id==='board-staircase'?'steps':id==='board-orbit'?'compare':'parts');
      const mode=requested==='compare'&&cards.length<2?'parts':requested;
      const windows=stageAutomaticBoards?automaticBoardRevealWindows(graphic,frames):undefined;
      const boardItem=(index:number)=>!motionEnabled?1:windows
        ?smoothMotion((frame-windows[index]!.start)/windows[index]!.duration):item(index,cards.length);
      const slots=motionPresetBoardRects(id,cards.length,portrait,hasSource,mode,Boolean(title)),compare=mode==='compare',steps=mode==='steps';
      if(compare&&cards.length===2&&!hasSource){
        // A conceptual contrast is a deliberate full-frame composition, not
        // two labels pretending to identify unrelated footage underneath.
        composition=<><div data-board-layout="typographic-contrast"/>
          {cards.map((card,i)=>{
            const arrival=boardItem(i),r=portrait?rect(0,i*.5,1,.5):rect(i*.5,0,.5,1);
            const color=i?'#18232c':'#f6f2e9',panel=i?'#eee9df':'#152630';
            return <div key={i} data-board-item={i} data-board-progress={arrival} style={{...box(r,width,height),background:panel,overflow:'hidden',clipPath:portrait?`inset(0 ${(1-arrival)*100}% 0 0)`:`inset(${(1-arrival)*100}% 0 0 0)`}}>
              {text(card.label,rect(.10,card.value?.28:.22,.80,card.value?.27:.56),150,1,{width:r.w*width,height:r.h*height,color,align:'center',weight:850,fontFamily:displayFont,dy:0})}
              {card.value&&text(card.value,rect(.10,.57,.80,.22),126,1,{width:r.w*width,height:r.h*height,color:i?'#285e70':accent,align:'center',weight:700,dy:0})}
            </div>;
          })}
          {title&&text(title,rect(.08,.04,.84,.12),54,p.primary,{align:'center',strip:true,weight:600})}
          {footer()}
        </>;break;
      }
      const spine=steps&&portrait?.105:.075;
      const compareTop=title?.44:.16,compareHeight=title?.51:.76;
      composition=<><div data-board-layout={mode}/>{hasSource&&!compare&&scrim('top',.80)}
        {text(title,rect(.07,.085,.86,.12),64,p.primary,{weight:700,strip:customBackground})}
        {compare&&<>
          {hasSource&&<div aria-hidden data-compare-scrim="local" style={{...box(rect(0,compareTop,1,compareHeight),width,height),background:'linear-gradient(0deg,transparent,#081019bd 18%,#081019bd 82%,transparent)',opacity:p.primary}}/>}
          <div aria-hidden style={{...box(rect(.498,compareTop+.04,.003,compareHeight-.08),width,height),background:ink,opacity:p.rule*.6,transform:`scaleY(${p.rule})`,transformOrigin:'center'}}/>
        </>}
        {!compare&&!steps&&rule(rect(.07,portrait?.44:.51,.86,.003),p.rule,ink+'99')}
        {steps&&<svg aria-hidden viewBox="0 0 1000 1000" preserveAspectRatio="none" style={{position:'absolute',width:'100%',height:'100%'}}>
          {slots.slice(1).map((r,i)=>{
            const previous=slots[i]!,x1=portrait?spine:previous.x+previous.w/2,y1=portrait?previous.y+previous.h/2:.61;
            const x2=portrait?spine:r.x+r.w/2,y2=portrait?r.y+r.h/2:.61,progress=boardItem(i+1);
            return <path key={i} d={`M${x1*1000} ${y1*1000}L${x2*1000} ${y2*1000}`} stroke={accent} fill="none" strokeWidth={2*unit} vectorEffect="non-scaling-stroke" pathLength="1" strokeDasharray="1" strokeDashoffset={1-progress} opacity={progress}/>;
          })}
          {slots.map((r,i)=><circle key={i} cx={(portrait?spine:r.x+r.w/2)*1000} cy={(portrait?r.y+r.h/2:.61)*1000} r={portrait?5:4} fill={graphic.activeIndex===i?accent:ink} opacity={boardItem(i)}/>)}
        </svg>}
        {cards.map((card,i)=>{
          const r=slots[i]!,arrival=boardItem(i),selected=graphic.activeIndex===i;
          const withValue=Boolean(card.value),align=compare?'center':'left',labelH=withValue?.65:.94;
          return <div key={i} data-board-item={i} data-board-progress={arrival} data-active={selected||undefined} style={{...box(r,width,height),opacity:arrival,transform:`translateY(${(1-arrival)*(steps?18:10)*unit}px)`}}>
            {text(card.label,rect(0,0,1,labelH),compare&&cards.length===2?96:cards.length<4?64:48,1,{width:r.w*width,height:r.h*height,weight:selected?800:650,strip:customBackground,align})}
            {withValue&&text(card.value!,rect(0,.69,1,.28),compare&&cards.length===2?112:58,1,{width:r.w*width,height:r.h*height,weight:750,align})}
            {!steps&&<div aria-hidden style={{position:'absolute',left:compare?'35%':-12*unit,top:compare?'98%':'18%',width:compare?'30%':3*unit,height:compare?3*unit:Math.max(8,Math.min(26,r.h*height*.25)),background:selected?accent:ink,opacity:selected?1:.5}}/>}
          </div>;
        })}
        {footer(rect(.07,.95,.86,.035))}
      </>;break;
    }
    case 'profile-dossier':
      composition=<>{scrim('top',.67)}
        {text(support,portrait?rect(.08,.66,.84,.10):rect(.08,.66,.84,.08),36,p.secondary,{weight:500})}
        {text(title,portrait?rect(.08,.77,.84,.17):rect(.08,.76,.84,.16),96,p.primary,{weight:800,dx:16,dy:0})}
        {rule(rect(.08,.62,.10,.005))}
      </>;break;
    case 'profile-halo':
      composition=<>{!cutout&&scrim('top',.64)}
        {text(title,cutout&&!portrait?rect(.55,.47,.40,.24):rect(.08,.68,.84,.20),100,p.primary,{weight:800})}
        {text(support,cutout&&!portrait?rect(.55,.74,.40,.15):rect(.08,.89,.84,.08),36,p.secondary,{weight:500})}
        {rule(cutout&&!portrait?rect(.56,.41,.12,.006):rect(.08,.63,.16,.006))}
      </>;break;
    case 'profile-strip':
      composition=<>{scrim('top',.64)}
        {text(title,rect(.08,.72,.84,.16),98,p.primary,{align:'center',weight:750})}
        {text(support,rect(.08,.89,.84,.075),34,p.secondary,{align:'center',weight:500})}
        {Array.from({length:16},(_,i)=><div key={i} aria-hidden style={{...box(rect(.035+i*.060,.07,.026,.012),width,height),background:ink,opacity:p.rule*.65}}/>)}
      </>;break;
    case 'profile-postcard':
      composition=<>{scrim('top',.42)}
        <div aria-hidden style={{...box(rect(.025,.77,.95,.205),width,height),background:'#f4f0e8',opacity:p.primary}}/>
        {text(title,rect(.07,.79,.86,.115),90,p.primary,{color:'#17232b',weight:750,dy:8})}
        {text(support,rect(.07,.91,.86,.050),30,p.secondary,{color:'#35444c',weight:500})}
      </>;break;
    default: {const exhaustive:never=id;void exhaustive;composition=null;}
  }
  const sourceRect=motionPresetSourceRect(id,mediaAspect,width/height,cutout);
  return <AbsoluteFill className="gws-motion-preset" data-motion-preset={id} style={{overflow:'hidden',pointerEvents:'none',background:customBackground||hasSource?'transparent':paper?'#eeeae1':'#0c1015'}}>
    {!hasSource&&customBackground&&<AbsoluteFill aria-hidden style={{background:paper?'#eeeae1ee':'linear-gradient(135deg,#0c1015ed,#0c1015c9)'}}/>}
    {cutout&&id==='profile-halo'&&<div aria-hidden style={{...box(portrait?rect(.14,.18,.72,.44):rect(.04,.22,.52,.64),width,height),background:`radial-gradient(circle,${accent} 0 46%,transparent 47%)`,opacity:.82*p.secondary}}/>}
    {hasSource&&<div className="gws-motion-preset-source" data-source-area={sourceRect.w*sourceRect.h} style={{...box(sourceRect,width,height),overflow:'hidden',opacity:1,filter:sourceFilter}}>
      {cutout&&id==='profile-halo'?<div data-profile-cutout="entrance" style={{position:'absolute',inset:'4% 2%',opacity:p.secondary,
        transform:`translateY(${(1-p.secondary)*4}%) scale(${.98+.02*p.secondary})`,transformOrigin:'center bottom'}}>
        <Img src={resolveMediaSource(graphic.cutoutPath!)} style={{width:'100%',height:'100%',objectFit:'contain'}}/>
      </div>:cutout?<Img src={resolveMediaSource(graphic.cutoutPath!)} style={{width:'100%',height:'100%',objectFit:'contain'}}/>:material}
    </div>}
    <AbsoluteFill style={{opacity:hasSource?p.overlay:1}}>{composition}</AbsoluteFill>
  </AbsoluteFill>;
}
