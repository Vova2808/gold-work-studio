import type {CSSProperties} from 'react';
import type {DocumentaryExplanation as Explanation} from '@gold-work/shared';
import {AbsoluteFill} from 'remotion';
import {fitDocumentaryText} from './documentary-typography.js';
import {explanationGeometry,explanationPoint,explanationState,explanationExchangePosition,explanationLinkPath,explanationTransferProgress,explanationClamp,type ExplanationPoint} from './documentary-explanation.js';

const paper='#f1f1e9',muted='#8e9da8',accent='#b9e76b';
type Symbol=Explanation['nodes'][number]['symbol'];

/** Deliberately schematic symbols. They identify roles, not physical internals. */
function SymbolDrawing({symbol}:{symbol:Symbol}){
  const stroke={fill:'none',stroke:paper,strokeWidth:5,strokeLinecap:'round' as const,strokeLinejoin:'round' as const};
  switch(symbol){
    case 'person':return <><circle cx={50} cy={25} r={16} fill={paper}/><path d="M18 91V72C18 47 82 47 82 72V91Z" fill={paper}/><path d="M42 56L50 70L58 56" fill="none" stroke="#14222c" strokeWidth={5}/></>;
    case 'team':return <><g fill={muted}><circle cx={20} cy={32} r={12}/><circle cx={80} cy={32} r={12}/><path d="M3 87V67C3 47 37 47 37 67V87ZM63 87V67C63 47 97 47 97 67V87Z"/></g><circle cx={50} cy={23} r={16} fill={paper}/><path d="M25 94V68C25 43 75 43 75 68V94Z" fill={paper}/></>;
    case 'machine':return <><path d="M12 30H73L91 48V82H12Z" fill={paper}/><path d="M23 30V13H52V30M73 30V48H91" {...stroke}/><rect x={23} y={43} width={29} height={21} rx={2} fill="#14222c"/><path d="M18 84V94M83 84V94" {...stroke}/><circle cx={72} cy={64} r={7} fill={accent}/></>;
    case 'motorcycle':return <>
      <g data-motorcycle-wheels fill="#14222c" stroke={paper} strokeWidth={5}>
        <circle cx={22} cy={74} r={17}/><circle cx={78} cy={74} r={17}/>
      </g>
      <path data-motorcycle-frame d="M22 74L41 48L57 74H22M41 48L78 74" {...stroke}/>
      <path data-motorcycle-body d="M41 54H58L64 68L57 78H42L35 66Z" fill={paper}/>
      <path data-motorcycle-tank d="M39 44C40 29 61 29 66 43L58 53H43Z" fill={paper}/>
      <path data-motorcycle-seat d="M14 42H39L35 50H24Z" fill={paper}/>
      <path data-motorcycle-fork d="M61 26H69L78 74" {...stroke}/>
      <path d="M66 37L73 40L77 50H68L62 44Z" fill={paper}/>
      <path d="M55 79H70" {...stroke}/>
      <g fill={accent}><circle cx={22} cy={74} r={3}/><circle cx={78} cy={74} r={3}/></g>
    </>;
    case 'signal':return <><path d="M4 55H18L28 22L43 80L57 37L68 55H96" fill="none" stroke={paper} strokeWidth={8} strokeLinejoin="round" strokeLinecap="round"/><circle cx={4} cy={55} r={4} fill={accent}/><circle cx={96} cy={55} r={4} fill={accent}/></>;
    case 'energy':return <path d="M59 5L15 57H45L37 95L87 39H56Z" fill={paper} stroke={paper} strokeWidth={3} strokeLinejoin="round"/>;
    case 'document':return <><path d="M19 6H62L83 28V94H19Z" fill={paper}/><path d="M62 6V28H83" fill="none" stroke="#14222c" strokeWidth={5}/><path d="M32 47H67M32 62H67M32 77H53" stroke="#14222c" strokeWidth={5} strokeLinecap="round"/></>;
    case 'place':return <><path d="M50 96C43 84 17 60 17 37A33 33 0 0 1 83 37C83 60 57 84 50 96Z" fill={paper}/><circle cx={50} cy={37} r={12} fill="#14222c"/></>;
    case 'time':return <><circle cx={50} cy={52} r={39} {...stroke}/><path d="M50 24V52L68 65M39 3H61M50 3V12" {...stroke}/><circle cx={50} cy={52} r={5} fill={accent}/></>;
    default:return <><path d="M50 5L91 28V73L50 96L9 73V28Z" fill={paper}/><path d="M9 28L50 51L91 28M50 51V96" fill="none" stroke="#14222c" strokeWidth={5} strokeLinejoin="round"/></>;
  }
}

function ObjectSymbol({symbol,point,size,opacity=1}:{symbol:Symbol;point:ExplanationPoint;size:number;opacity?:number}){
  return <svg data-explanation-symbol={symbol} viewBox="0 0 100 100"
    style={{position:'absolute',left:point.x-size/2,top:point.y-size/2,width:size,height:size,opacity,overflow:'visible'}}>
    <SymbolDrawing symbol={symbol}/>
  </svg>;
}

/** Standalone semantic choreography; no source image or inferred mechanism. */
export function DocumentaryExplanation({explanation,frame,frames,width,height,moving=true}:{
  explanation:Explanation;frame:number;frames:number;width:number;height:number;moving?:boolean;
}){
  if(explanation.nodes.length<2||explanation.nodes.length>4
    ||explanation.nodes.some(node=>node.objectType!==undefined&&(node.objectType!=='motorcycle'||node.symbol!=='motorcycle')))return null;
  const geometry=explanationGeometry(explanation,width,height),state=explanationState(explanation,frame,frames,moving);
  const {kind,position,labels,sizes,links}=geometry,unit=Math.min(width,height)/1080,portrait=height>width;
  const interrupted=kind==='flow'&&explanation.signal==='interrupted';
  const box=(r:{x:number;y:number;w:number;h:number}):CSSProperties=>({position:'absolute',left:r.x,top:r.y,width:r.w,height:r.h});
  return <AbsoluteFill data-explanation-kind={kind} style={{background:'#101c25',overflow:'hidden',fontFamily:'Arial,sans-serif'}}>
    {/* Contrast owns distinct fields; no winner, count, or causal arrow is implied. */}
    {kind==='contrast'&&explanation.nodes.map((node,i)=>{
      const r=explanation.nodes.length===4?{x:i%2?width/2:0,y:i<2?0:height/2,w:width/2,h:height/2}
        :portrait?{x:0,y:i*height/explanation.nodes.length,w:width,h:height/explanation.nodes.length}
        :{x:i*width/explanation.nodes.length,y:0,w:width/explanation.nodes.length,h:height};
      return <div key={node.id} aria-hidden style={{...box(r),background:i%2?'#1b303b':'#101c25'}}/>;
    })}
    {explanation.emphasis&&<div data-explanation-emphasis style={{position:'absolute',left:'7%',top:'3%',width:'86%',height:'7%',color:paper,
      fontWeight:700,lineHeight:1.1,textAlign:'center',overflowWrap:'anywhere',overflow:'hidden',opacity:state.emphasis,
      fontSize:fitDocumentaryText(explanation.emphasis,48*unit,width*.86,height*.07,700)}}>{explanation.emphasis}</div>}
    <svg aria-hidden width={width} height={height} style={{position:'absolute',inset:0,overflow:'hidden'}}>
      {links.map((link,i)=>{
        const draw=explanationTransferProgress(state.links[i]??0,interrupted);
        const direction=explanationPoint(link,.9999),angle=Math.atan2(link.end.y-direction.y,link.end.x-direction.x)*180/Math.PI;
        return <g key={i} data-explanation-link={`${link.from}-${link.to}`}>
          {(interrupted?[[0,.42],[.58,1]]:[[0,1]]).map(([start,end],part)=><g key={part}>
            <path d={explanationLinkPath(link,start,end)} fill="none" stroke={muted} strokeWidth={2*unit} opacity={.20}/>
            <path data-explanation-interrupted={interrupted||undefined} d={explanationLinkPath(link,start,end)} fill="none" stroke={muted} strokeWidth={3*unit}
              strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1-explanationClamp((draw-start!)/(end!-start!))}/>
          </g>)}
          <path d={`M${-10*unit} ${-6*unit}L0 0L${-10*unit} ${6*unit}`} fill="none" stroke={accent} strokeWidth={3*unit}
            transform={`translate(${link.end.x} ${link.end.y}) rotate(${angle})`} opacity={draw===1?1:0}/>
        </g>;
      })}
    </svg>
    {links.map((link,i)=>{
      const raw=state.links[i]??0,progress=explanationTransferProgress(raw,interrupted);if(raw<=0||raw>=1)return null;
      const p=explanationPoint(link,progress),node=explanation.nodes[link.from]!,before=explanationPoint(link,progress-.002),after=explanationPoint(link,progress+.002);
      const angle=Math.atan2(after.y-before.y,after.x-before.x)*180/Math.PI,paused=interrupted&&raw>=.36&&raw<.64;
      // A message/contribution travels; the sender remains in place. This is
      // deliberately not a miniature person, machine, or inferred engine part.
      const size=(kind==='merge'?46:54)*unit,opacity=explanationClamp(raw/.08)*explanationClamp((1-raw)/.08);
      return <svg key={`transfer-${i}`} data-explanation-contribution={kind==='merge'?node.id:undefined} data-explanation-transfer={kind!=='merge'||undefined}
        data-explanation-paused={paused||undefined} width={size} height={size} viewBox="0 0 54 54"
        style={{position:'absolute',left:p.x-size/2,top:p.y-size/2,opacity,overflow:'visible',transform:`rotate(${angle}deg) scaleX(${paused?.65:1})`}}>
        <path d="M3 27L27 7L51 27L27 47Z" fill={paused?muted:accent}/>
      </svg>;
    })}
    {explanation.nodes.map((node,i)=>{
      const original=position[i]!,p=kind==='exchange'?explanationExchangePosition(original,position[1-i]!,state.exchange,i,height):original;
      const label=labels[i]!,dx=p.x-original.x,dy=p.y-original.y,visibility=state.visible[i]??1,active=state.active[i]??1;
      const labelBox={...label,x:label.x+dx,y:label.y+dy};
      const textSize=Math.min((portrait?66:72)*unit,label.w/(Math.max(1,...node.label.split(/\s+/u).map(word=>word.length))*.56));
      return <div key={node.id} data-explanation-node={node.id} data-explanation-object-type={node.objectType} data-explanation-position={`${p.x},${p.y}`} data-explanation-active={active} style={{position:'absolute',inset:0}}>
        <ObjectSymbol symbol={node.symbol} point={p} size={sizes[i]!*(.94+.06*active)} opacity={visibility}/>
        <div data-explanation-label={node.id} style={{...box(labelBox),fontWeight:700,lineHeight:1.12,textAlign:portrait&&kind==='flow'?'left':'center',
          color:paper,opacity:.72+.28*active,display:'flex',alignItems:'center',justifyContent:portrait&&kind==='flow'?'flex-start':'center',overflowWrap:'anywhere',overflow:'hidden',
          fontSize:fitDocumentaryText(node.label,textSize,label.w,label.h,700)}}>{node.label}</div>
      </div>;
    })}
  </AbsoluteFill>;
}
