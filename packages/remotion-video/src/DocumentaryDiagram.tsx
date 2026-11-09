import type {ReactNode} from 'react';
import {AbsoluteFill} from 'remotion';
import type {DocumentaryMotionGraphic} from './documentary-timeline.js';
import {DocumentaryTimeGap} from './DocumentaryTimeGap.js';
import {documentaryRatioGroupsMatch} from '@gold-work/shared';
import {ratioGroupLayout,ratioGroupState,ratioGroupLabelLines} from './documentary-ratio-groups.js';

const ease=(n:number)=>{const t=Math.max(0,Math.min(1,n));return 1-(1-t)**3;};

/** An illustrative symbol, not a cutout or an identified object in footage. */
export function DocumentarySymbol({name,color='#f5f0e6'}:{name:string;color?:string}) {
  const lower=name.toLocaleLowerCase();let drawing:ReactNode;
  if(/headlight|фар/u.test(lower))drawing=<><path d="M54 24Q20 24 20 50Q20 76 54 76Z"/><path d="M31 33L45 67M37 29L51 63M66 25L88 17M66 41H90M66 58H90M66 75L88 83"/></>;
  else if(/wheel|колес/u.test(lower))drawing=<><circle cx="50" cy="50" r="36"/><circle cx="50" cy="50" r="26"/><circle cx="50" cy="50" r="7"/>{Array.from({length:5},(_,i)=><path key={i} d="M47 43L44 24M53 43L56 24" transform={`rotate(${i*72} 50 50)`}/>)}</>;
  else if(/intake|воздухозаб/u.test(lower))drawing=<><path d="M20 25H85L70 77H8Z"/>{[35,46,57,68].map(y=><path key={y} d={`M${22-(y-35)*.2} ${y}H${76-(y-35)*.2}`}/>)}<path d="M87 30L94 26M84 46H94M80 64L91 69"/></>;
  else if(/brake|тормоз/u.test(lower))drawing=<><circle cx="50" cy="50" r="32"/><circle cx="50" cy="50" r="10"/>{Array.from({length:8},(_,i)=><path key={i} d="M48 25L55 23" transform={`rotate(${i*45} 50 50)`}/>)}<path d="M72 22L85 32V68L72 78V22Z" fill={color}/></>;
  else if(/cool|охлажд/u.test(lower))drawing=<><rect x="23" y="19" width="54" height="62" rx="5"/>{[32,44,56,68].map(y=><path key={y} d={`M31 ${y}H69`}/>)}<path d="M23 31H12V16M77 69H88V84"/><path d="M45 10H55M45 90H55"/></>;
  else if(/transmission|gear|трансмисс|передач/u.test(lower))drawing=<><path d="M36 17L44 26L56 26L64 17L78 31L70 41V54L79 62L65 77L55 69H43L35 78L21 64L29 54V42L20 32Z"/><circle cx="50" cy="49" r="13"/><path d="M50 77V91M40 91H60"/></>;
  else if(/factor|завод|фабрик/u.test(lower))drawing=<><path d="M13 83V42L36 29V42L58 29V42H84V83ZM68 42V14H79V42"/>{[24,43,63].map(x=><path key={x} d={`M${x} 58H${x+9}V69H${x}Z`}/>)}<path d="M8 87H91"/></>;
  else if(/money|деньг|финанс/u.test(lower))drawing=<><rect x="12" y="25" width="76" height="48" rx="4"/><path d="M19 20H81M25 15H75M12 37Q26 37 26 25M74 25Q74 37 88 37M12 61Q26 61 26 73M74 73Q74 61 88 61"/><ellipse cx="50" cy="49" rx="13" ry="17"/><path d="M47 42L51 38V60M46 60H57"/></>;
  else if(/production|производ/u.test(lower))drawing=<><rect x="9" y="64" width="82" height="21" rx="10"/>{[21,40,59,79].map(x=><circle key={x} cx={x} cy="74" r="4"/>)}<path d="M18 58V40H38V58ZM60 58V40H80V58ZM44 13H62V25H44ZM54 25V42L45 51M54 42L63 51"/></>;
  else if(/prestige|престиж/u.test(lower))drawing=<><path d="M47 87Q13 73 19 30M53 87Q87 73 81 30"/>{[0,1,2,3].flatMap(i=>[<path key={'l'+i} d={`M${22+i*2} ${36+i*12}Q${6+i*3} ${31+i*12} ${14+i*3} ${23+i*12}Q${28+i*2} ${26+i*12} ${22+i*2} ${36+i*12}Z`} fill={color}/>,<path key={'r'+i} d={`M${78-i*2} ${36+i*12}Q${94-i*3} ${31+i*12} ${86-i*3} ${23+i*12}Q${72-i*2} ${26+i*12} ${78-i*2} ${36+i*12}Z`} fill={color}/>])}<path d="M50 19L57 36L75 38L62 50L66 68L50 59L34 68L38 50L25 38L43 36Z"/></>;
  else if(/victor|побед/u.test(lower))drawing=<><path d="M31 15H69V39Q69 58 50 64Q31 58 31 39ZM31 22H15V33Q15 48 34 48M69 22H85V33Q85 48 66 48M50 64V81M32 85H68M39 81H61"/><path d="M50 26L54 34L63 35L56 41L58 50L50 46L42 50L44 41L37 35L46 34Z" fill={color} stroke="none"/></>;
  else if(/mechanic|engineer|механик|инженер/u.test(lower))drawing=<><path d="M58 14L52 32L66 43L82 32Q88 54 66 60L38 88Q24 91 19 79L49 49Q30 30 48 16Z"/><circle cx="31" cy="78" r="4"/></>;
  else if(/test|испыт|тест/u.test(lower))drawing=<><circle cx="50" cy="56" r="30"/><path d="M41 13H59M50 13V26M73 28L79 22M50 36V56L66 64"/><path d="M47 31H53M47 81H53M25 53V59M75 53V59"/></>;
  else if(/racer|driver|гонщик|водител/u.test(lower))drawing=<><path d="M15 58Q15 20 51 20Q87 20 87 57L68 75H21Z"/><path d="M51 35H84L88 52H49ZM20 75V83H63L68 75"/></>;
  else if(/car|автомобил|машин/u.test(lower))drawing=<><path d="M10 66V48L23 43L35 28H65L79 43L90 48V66H10Z"/><path d="M29 43H72L61 33H39Z"/><circle cx="28" cy="66" r="10" fill="#101820"/><circle cx="73" cy="66" r="10" fill="#101820"/></>;
  else return null;
  return <svg viewBox="0 0 100 100" width="100%" height="100%" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{drawing}</svg>;
}

export const hasDocumentarySymbol=(label:string)=>/headlight|фар|wheel|колес|intake|воздухозаб|brake|тормоз|cool|охлажд|transmission|gear|трансмисс|передач|factor|завод|фабрик|money|деньг|финанс|production|производ|victor|prestige|побед|престиж|mechanic|engineer|механик|инженер|test|испыт|тест|racer|driver|гонщик|водител|car|автомобил|машин/iu.test(label);

function GroupedRatioDiagram({diagram,frame,frames,moving,accent,portrait}:{diagram:NonNullable<DocumentaryMotionGraphic['diagram']>;frame:number;frames:number;moving:boolean;accent:string;portrait:boolean}){
  const groups=diagram.groups!,layout=ratioGroupLayout(groups,portrait),state=ratioGroupState(frame,frames,groups.length,moving);
  const ink='#f5f0e6',muted='#a5b3c0',total=diagram.total!,last=groups.length-1;
  return <AbsoluteFill data-documentary-diagram="ratio" data-ratio-partition style={{background:'#101c25',overflow:'hidden',fontFamily:'Bahnschrift,"Segoe UI",sans-serif'}}>
    <svg viewBox={`0 0 ${layout.width} ${layout.height}`} width="100%" height="100%" aria-label={diagram.label}>
      <text x={layout.width/2} y={portrait?210:190} textAnchor="middle" fontSize={portrait?124:112} fontWeight="750" fill={ink}>{diagram.amount} / {total}</text>
      <text x={layout.width/2} y={portrait?285:265} textAnchor="middle" fontSize={Math.min(40,(layout.width-160)/(Math.max(1,diagram.label.length)*.56))} fill={muted}>{diagram.label}</text>
      {layout.units.map(unit=>{
        const p=state.split[unit.group]!,x=unit.start.x+(unit.end.x-unit.start.x)*p,y=unit.start.y+(unit.end.y-unit.start.y)*p;
        const rest=unit.group===last,color=rest?'#354552':unit.group===0?accent:ink;
        return <g key={unit.index} data-ratio-unit={unit.index} data-ratio-group={unit.group} data-filled={!rest}
          transform={`translate(${x} ${y})`}>
          <rect x={-unit.size/2} y={-unit.size/2} width={unit.size} height={unit.size} rx={unit.size*.08}
            fill={rest?color:accent} stroke={rest?muted:ink} strokeWidth={rest?2:1} opacity={rest?.7:1}/>
          {!rest&&unit.group>0&&<rect x={-unit.size/2} y={-unit.size/2} width={unit.size} height={unit.size} rx={unit.size*.08} fill={color} opacity={p}/>}
        </g>;
      })}
      {groups.map((group,i)=>{
        const caption=layout.captions[i]!,p=state.split[i]!,lines=ratioGroupLabelLines(group.label,portrait?19:24);
        const longest=Math.max(...lines.map(line=>line.length)),fontSize=Math.min(portrait?38:36,caption.width/(Math.max(1,longest)*.56),(portrait?140:100)/Math.max(1,lines.length)/1.15);
        const arithmetic=i===last?`${total} − ${diagram.amount} = ${group.amount}`:groups.length===3&&i===1?`${diagram.amount} − ${groups[0]!.amount} = ${group.amount}`:undefined;
        return <g key={i} data-ratio-caption={i} opacity={.38+.62*p}>
          <text x={caption.x} y={caption.y} textAnchor={portrait?'start':'middle'} fontSize="104" fontWeight="750" fill={i===0?accent:ink}>{group.amount}</text>
          <text data-ratio-label={i} x={caption.x} y={caption.y+55} textAnchor={portrait?'start':'middle'} fontSize={fontSize} fill={ink}>
            {lines.map((line,j)=><tspan key={j} x={caption.x} dy={j?fontSize*1.15:0}>{line}</tspan>)}
          </text>
          {arithmetic&&<text data-ratio-arithmetic={i} x={caption.x} y={portrait?caption.y+290:1020} textAnchor={portrait?'start':'middle'} fontSize={portrait?34:38} fill={muted} opacity={p}>{arithmetic}</text>}
        </g>;
      })}
    </svg>
  </AbsoluteFill>;
}

export function DocumentaryDiagram({graphic,frame,frames,accent,material,moving=true,sourceFilter,portrait=false}:{graphic:DocumentaryMotionGraphic;frame:number;frames:number;accent:string;material:ReactNode;moving?:boolean;sourceFilter?:string;portrait?:boolean}) {
  const d=graphic.diagram;if(!d)return null;
  if(d.kind==='time-gap')return <DocumentaryTimeGap amount={d.amount} label={d.label} frame={frame} frames={frames} moving={moving} accent={accent} portrait={portrait}/>;
  if(d.kind==='ratio'&&documentaryRatioGroupsMatch(d.groups,d.amount,d.total??0))return <GroupedRatioDiagram diagram={d} frame={frame} frames={frames} moving={moving} accent={accent} portrait={portrait}/>;
  const arrival=Math.min(18,Math.max(1,frames*.23)),enter=moving?ease(frame/arrival):1;
  const part=(i:number,n:number)=>moving?ease((frame-i*Math.min(7,frames*.32/Math.max(1,n)))/arrival):1;
  const exit=moving?Math.min(1,Math.max(0,(frames-1-frame)/Math.min(8,Math.max(1,frames*.10)))):1;
  const paper=d.kind==='period'&&graphic.showSource===false;
  const ink=paper?'#17232b':'#f5f0e6',muted=paper?'#626a6d':'#a5b3c0',source=graphic.showSource!==false;
  let shape:ReactNode;
  if(d.kind==='ratio'){
    const count=d.total!,columns=count>24?Math.min(10,Math.ceil(count/4)):Math.min(6,Math.ceil(count/2)),rows=Math.ceil(count/columns),gap=1120/columns;
    const rowGap=rows>3?Math.min(140,470/(rows-1)):145,iconScale=Math.min(1,gap/165,rowGap/145),longLabel=d.label.length>23;
    shape=<>
      <text x="960" y="240" textAnchor="middle" fontSize="114" fontWeight="750" fill={ink}>{longLabel?`${d.amount} / ${count}`:d.label}</text>
      {longLabel&&<text x="960" y="305" textAnchor="middle" fontSize="40" fill={muted}>{d.label}</text>}
      {Array.from({length:count},(_,i)=>{const p=part(i,count),color=i<d.amount?accent:'#354552',x=960-(columns-1)*gap/2+(i%columns)*gap,y=390+Math.floor(i/columns)*rowGap;return <g key={i} data-filled={i<d.amount} opacity={p} transform={`translate(${x} ${y+12*(1-p)}) scale(${iconScale})`}>
        {d.object==='car'?<g transform="translate(-72 -38)"><path d="M4 62V40L25 33L46 10H95L121 34L140 43V62Z" fill={color} stroke={i<d.amount?ink:'#536573'} strokeWidth="2"/><path d="M37 34H106L87 17H51Z" fill="#111b24"/><circle cx="33" cy="62" r="13" fill="#0b121a" stroke={color} strokeWidth="4"/><circle cx="110" cy="62" r="13" fill="#0b121a" stroke={color} strokeWidth="4"/></g>:<circle r="38" fill={color} stroke={i<d.amount?ink:muted} strokeWidth="2"/>}
        {i>=d.amount&&<path d="M-14 73L14 101M14 73L-14 101" stroke="#8b98a3" strokeWidth="3" opacity={part(i+count,count*2)}/>}
      </g>;})}
    </>;
  }else if(d.kind==='duration'){
    const radius=245,circumference=2*Math.PI*radius;
    shape=<g transform="translate(960 500)">
      <circle r={radius} fill="#142535" stroke="#324555" strokeWidth="18"/>
      <circle r={radius} fill="none" stroke={accent} strokeWidth="18" strokeDasharray={circumference} strokeDashoffset={circumference*(1-part(0,1)*d.amount/24)} transform="rotate(-90)"/>
      {Array.from({length:24},(_,i)=><path key={i} d={`M0 -${i%6?214:202}V-226`} stroke={i%6?muted:ink} strokeWidth={i%6?2:4} transform={`rotate(${i*15})`}/>)}
      <text textAnchor="middle" y="28" fontSize="160" fontWeight="750" fill={ink}>{d.amount}</text>
      <text textAnchor="middle" y="100" fontSize="44" fill={muted}>{d.label.replace(/^.*?\d+(?:[.,]\d+)?\s*/u,'')}</text>
    </g>;
  }else if(d.kind==='measure'){
    shape=<>
      {source&&<rect x="1245" y="110" width="595" height="830" fill="#111c27" opacity=".98"/>}
      <text x={source?1500:960} y="265" textAnchor="middle" fontSize="94" fontWeight="750" fill={ink}>{d.label}</text>
      <g transform={source?undefined:'translate(-540 0)'}>
        <path d="M1390 365H1550M1390 835H1550M1440 365V835M1429 381L1440 365L1451 381M1429 819L1440 835L1451 819" fill="none" stroke={ink} strokeWidth="3" pathLength="1" strokeDasharray="1" strokeDashoffset={1-part(0,1)}/>
        {Array.from({length:17},(_,i)=><g key={i} opacity={part(i,17)}><path d={`M1490 ${835-i*29.375}H${i%4?1508:1530}`} stroke={i%4?muted:accent} strokeWidth={i%4?2:4}/>{i%4===0&&<text x="1560" y={847-i*29.375} fontSize="34" fill={ink}>{Math.round(d.amount*i/16*100)/100}</text>}</g>)}
      </g>
    </>;
  }else if(d.kind==='engine'){
    shape=<><text x="960" y="250" textAnchor="middle" fontSize="100" fontWeight="750" fill={ink}>{d.label}</text>
      <path d="M960 390V760M600 760H1320" stroke="#536a7b" strokeWidth="8"/>
      {Array.from({length:d.total??8},(_,i)=>{const firstBank=Math.ceil((d.total??8)/2),side=i<firstBank?-1:1,row=i<firstBank?i:i-firstBank,p=part(i,d.total??8),rowGap=Math.min(82,310/Math.max(1,firstBank-1));return <g key={i} data-cylinder={i+1} opacity={p} transform={`translate(${960+side*170} ${405+row*rowGap}) rotate(${side*28})`}><rect x="-64" y="-32" width="128" height="64" rx="8" fill="#213e52" stroke={accent} strokeWidth="3"/><path d="M-34 -29V29M-25 -29V29" stroke={ink} strokeWidth="2"/><path d={`M35 0H${side<0?160:-160}`} stroke="#708797" strokeWidth="5"/></g>;})}
      <text x="1430" y="550" textAnchor="middle" fontSize="82" fontWeight="700" fill={accent}>{d.unit}</text>
    </>;
  }else{
    const gap=1460/Math.max(1,d.amount);
    shape=<><text x="960" y="260" textAnchor="middle" fontSize="125" fontWeight="750" fill={ink}>{d.amount}</text>
      {d.label!==String(d.amount)&&<text x="960" y="325" textAnchor="middle" fontSize="38" fill={muted}>{d.label}</text>}
      <path d="M230 735H1690" stroke="#526574" strokeWidth="2"/>
      {Array.from({length:d.amount},(_,i)=>{const x=230+gap*(i+.5),p=part(i,d.amount);return <g key={i} opacity={p} transform={`translate(${x} ${470+(1-p)*20})`}><path d="M-42 -57H42V-7Q42 40 0 55Q-42 40 -42 -7ZM-42 -42H-70V-12Q-70 16 -38 16M42 -42H70V-12Q70 16 38 16M0 55V92M-36 96H36" fill={paper?'#b4914820':'none'} stroke={paper?'#8b682e':accent} strokeWidth="5"/><path d="M0 206V265" stroke={muted} strokeWidth="2"/><text y="320" textAnchor="middle" fontSize="38" fill={ink}>{d.fromYear!+i}</text></g>;})}</>;
  }
  return <AbsoluteFill data-documentary-diagram={d.kind} style={{overflow:'hidden',background:'#0c141e',fontFamily:'Bahnschrift,"Segoe UI",sans-serif'}}>
    {source&&<AbsoluteFill style={{filter:sourceFilter}}>{material}</AbsoluteFill>}
    <AbsoluteFill style={{background:paper?'radial-gradient(ellipse at 50% 38%,#faf8ee,#ded9cb 90%)':source&&(d.kind==='measure'||d.kind==='engine')?'linear-gradient(90deg,transparent 32%,#0c141e77 56%,#0c141ef5 77%)':source?'linear-gradient(90deg,#0c141eb5,#0c141ed9)':'radial-gradient(ellipse at 50% 38%,#203344,#0c141e 78%)',opacity:source?exit:1}}/>
    <svg viewBox="0 0 1920 1080" width="100%" height="100%" style={{position:'absolute',opacity:enter*(source?exit:1)}}>
      <g transform={source&&d.kind==='engine'?'translate(720 170) scale(.62)':undefined}>{shape}</g>
      {graphic.title&&!graphic.hideTitle&&graphic.title!==d.label&&<text x="960" y="930" textAnchor="middle" fontSize="42" fill={muted}>{graphic.title}</text>}
    </svg>
  </AbsoluteFill>;
}
