import { AbsoluteFill, Img } from 'remotion';
import type { CSSProperties } from 'react';
import type { DocumentaryMotionGraphic as Graphic } from './documentary-timeline.js';
import { documentaryEase } from './documentary-design.js';
import { documentaryLandPath } from './documentary-land-data.js';
import { documentaryRelief } from './documentary-relief-data.js';
import {resolveMediaSource} from './MediaSurface.js';
import {documentaryRouteGeometry, documentaryRouteKey, documentaryRouteLabels} from './documentary-route.js';

const clamp=(n:number,min=0,max=1)=>Math.max(min,Math.min(max,n));
const lines=(text:string,size=28)=> {
  const result:string[]=[];
  for(const word of text.split(/\s+/u)) {
    if(!result.length || result.at(-1)!.length+word.length+1>size) result.push(word);
    else result[result.length-1]+=' '+word;
  }
  return result;
};
export function motionMediaStyle(kind: Graphic['kind'],progress=0,aspect=16/9,canvasAspect=16/9,arrivalFrame?:number,paper=false): CSSProperties {
  const slot=58,width=Math.min(slot,90*Math.max(.2,aspect)/canvasAspect),height=width*canvasAspect/Math.max(.2,aspect);
  const arrival=documentaryEase(clamp(arrivalFrame===undefined?progress/.24:arrivalFrame/18));
  if(kind==='statistic'||kind==='feature-list') return {left:`${(kind==='statistic'?3:39)+(slot-width)/2}%`,top:`${(100-height)/2}%`,width:`${width}%`,height:`${height}%`,borderRadius:18,overflow:'hidden',boxShadow:paper?'0 22px 64px #263c302b, 0 2px 8px #263c3018':'0 20px 80px #0008',opacity:arrival,transform:`translateX(${(kind==='statistic'?-1:1)*(1-arrival)*45}px) scale(${.98+.02*arrival})`,clipPath:`inset(0 0 ${(1-arrival)*12}% 0 round 18px)`};
  const breathe=documentaryEase(progress<.5?progress*2:(1-progress)*2);
  if(['chapter-number','chronology','quote'].includes(kind)) return {filter:'brightness(.35) blur(5px)',transform:`scale(${1.04+.1*breathe})`};
  return {};
}
function Text({text,x,y,size=58,color='#fff',center=false,width=30,maxHeight=280}:{text:string;x:number;y:number;size?:number;color?:string;center?:boolean;width?:number;maxHeight?:number}) {
  const rows=lines(text,width);
  size=Math.min(size,maxHeight/Math.max(1,rows.length)/1.24);
  return <text x={x} y={y} fill={color} stroke="#0006" strokeWidth={1} paintOrder="stroke" fontSize={size} fontWeight={700} textAnchor={center?'middle':'start'}>
    {rows.map((line,i)=><tspan x={x} dy={i?size*1.24:0} key={i}>{line}</tspan>)}
  </text>;
}
const valid=(p:Graphic['place'])=>p&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&Math.abs(p.latitude)<=90&&Math.abs(p.longitude)<=180;
const xy=(p:NonNullable<Graphic['place']>)=>({x:(p.longitude+180)*4,y:(90-p.latitude)*4});
/** Shortest longitudinal path also works across the international date line. */
export function documentaryMapCamera(graphic:Graphic, progress:number) {
  const end=xy(graphic.place!), start=graphic.kind==='map-route'&&valid(graphic.fromPlace)?xy(graphic.fromPlace!):end;
  while(start.x-end.x>720) start.x-=1440;
  while(start.x-end.x< -720) start.x+=1440;
  const cx=(start.x+end.x)/2,cy=(start.y+end.y)/2;
  const extent=Math.max(Math.abs(end.x-start.x)*1.6,Math.abs(end.y-start.y)*1.6*16/9,1440/clamp(graphic.zoom??5,1.4,12));
  const target=Math.min(1280,extent), width=1280*Math.exp(Math.log(target/1280)*documentaryEase(clamp(progress/.62))),height=width*9/16;
  return {start,end,cx,cy:clamp(cy,height/2,720-height/2),width,height};
}
function SatelliteMapGraphic({graphic,progress,enter,accent,textColor}:{graphic:Graphic;progress:number;enter:number;accent:string;textColor:string}){
  const detail=graphic.detail,place=graphic.place!;
  const ready=detail?.kind==='satellite'&&Math.abs(detail.latitude-place.latitude)<.0001&&Math.abs(detail.longitude-place.longitude)<.0001&&Math.abs(detail.radiusKm-(graphic.mapRadiusKm??35))<.01;
  if(!ready)return <AbsoluteFill style={{background:'#10202d',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Arial',fontSize:36}}>Спутниковый снимок не загружен</AbsoluteFill>;
  const scale=1+(clamp(graphic.cameraZoom??1.08,1,1.2)-1)*documentaryEase(progress);
  const pin=documentaryEase(clamp((progress-.12)/.18));
  return <AbsoluteFill style={{background:'#14201c'}}>
    <Img src={resolveMediaSource(detail.imagePath)} style={{width:'100%',height:'100%',objectFit:'cover',transform:`scale(${scale})`}}/>
    <AbsoluteFill style={{background:'linear-gradient(#06141caa,transparent 25%,transparent 74%,#06141ccc)'}}/>
    <svg viewBox="0 0 1920 1080" width="100%" height="100%" style={{position:'absolute',fontFamily:'Arial,sans-serif'}}>
      <g opacity={enter}><rect x="90" y="72" width="5" height="46" rx="2" fill={accent}/><text x="115" y="106" fill={textColor} fontSize="26" letterSpacing="4">{graphic.kicker||'LOCATION'}</text></g>
      <g opacity={pin}>
        {!!graphic.regionRadiusKm&&<ellipse cx="960" cy="540" rx={graphic.regionRadiusKm/detail.radiusKm*960} ry={graphic.regionRadiusKm/detail.radiusKm*960} fill={accent} fillOpacity=".12" stroke={accent} strokeOpacity=".55" strokeWidth="2"/>}
        <circle cx="960" cy="540" r={18+18*(1-pin)} fill="#10202d70" stroke={accent} strokeWidth="2"/><circle cx="960" cy="540" r="6" fill={textColor}/>
        <path d="M976 537L1020 497H1080" fill="none" stroke={accent} strokeWidth="2"/>
        <rect x="1020" y="422" width={Math.min(720,place.name.length*29+44)} height="72" rx="8" fill="#081a29dc"/>
        <Text text={place.name} x={1040} y={472} size={46} width={25} color={textColor}/>
      </g>
      <text x="90" y="958" fontSize="22" fill="#fff">{place.country??''}</text>
      <g fill="#e1e7eb" fontSize="18" textAnchor="end"><text x="1830" y="1003">EOxCloudless · https://cloudless.eox.at · EOX IT Services GmbH · CC BY 4.0</text><text x="1830" y="1032">Contains modified Copernicus Sentinel data 2016</text></g>
    </svg>
  </AbsoluteFill>;
}
function SatelliteRouteGraphic({graphic,progress,enter,accent,textColor}:{graphic:Graphic;progress:number;enter:number;accent:string;textColor:string}) {
  const places=graphic.route??(graphic.fromPlace&&graphic.place?[graphic.fromPlace,graphic.place]:[]),detail=graphic.detail;
  if(places.length<2||!detail?.bounds||detail.kind!=='satellite'||detail.routeKey!==documentaryRouteKey(places))return <AbsoluteFill style={{background:'#10202d',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Arial',fontSize:36}}>Спутниковый маршрут не загружен</AbsoluteFill>;
  const reveal=documentaryEase(clamp((progress-.12)/.72));
  const geometry=documentaryRouteGeometry(places,detail.bounds,reveal),labels=documentaryRouteLabels(geometry.points,places);
  const active=geometry.arrivals.reduce((last,at,index)=>reveal>=at?index:last,0);
  const country=[...new Set(places.map(place=>place.country).filter(Boolean))].join(' · ');
  const scale=1+(clamp(graphic.cameraZoom??1.04,1,1.08)-1)*documentaryEase(progress);
  return <AbsoluteFill style={{background:'#14201c'}}>
    <AbsoluteFill style={{transform:`scale(${scale})`}}>
      <Img src={resolveMediaSource(detail.imagePath)} style={{width:'100%',height:'100%',objectFit:'fill'}}/>
      <svg viewBox="0 0 1920 1080" width="100%" height="100%" style={{position:'absolute',fontFamily:'Arial,sans-serif'}}>
        <path d={geometry.path} fill="none" stroke="#06141cb0" strokeWidth="11" strokeLinejoin="round"/>
        <path d={geometry.path} pathLength={1} fill="none" stroke={accent} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1" strokeDashoffset={1-reveal}/>
        {geometry.points.map((point,i)=>{
          const arrived=documentaryEase(clamp((reveal-geometry.arrivals[i]!+.1)/.1)),label=labels[i]!;
          return <g key={i} opacity={arrived}>
            {!!graphic.regionRadiusKm&&<circle cx={point.x} cy={point.y} r={graphic.regionRadiusKm*1000/Math.cos(places[i]!.latitude*Math.PI/180)/(detail.bounds![2]-detail.bounds![0])*1920} fill={accent} fillOpacity=".12" stroke={accent} strokeOpacity=".55" strokeWidth="2"/>}
            <circle cx={point.x} cy={point.y} r={11+8*(1-arrived)} fill="#081a29" stroke={accent} strokeWidth="3"/>
            <path d={`M${point.x} ${point.y}L${Math.max(label.x,Math.min(label.x+label.width,point.x))} ${Math.max(label.y,Math.min(label.y+label.height,point.y))}`} stroke={accent} strokeWidth="1.5"/>
            <rect {...label} rx="7" fill="#081a29eb"/>
            <text x={label.x+18} y={label.y+39} fontSize={Math.min(32,(label.width-36)/Math.max(1,places[i]!.name.length)*1.7)} fill={textColor}>{places[i]!.name}</text>
          </g>;
        })}
        <circle cx={geometry.marker.x} cy={geometry.marker.y} r="17" fill={accent} opacity=".25"/>
        <circle cx={geometry.marker.x} cy={geometry.marker.y} r="7" fill="#fff" stroke={accent} strokeWidth="3"/>
      </svg>
    </AbsoluteFill>
    <AbsoluteFill style={{background:'linear-gradient(#06141caa,transparent 23%,transparent 80%,#06141cdd)'}}/>
    <svg viewBox="0 0 1920 1080" width="100%" height="100%" style={{position:'absolute',fontFamily:'Arial,sans-serif'}}>
      <g opacity={enter}><rect x="90" y="72" width="5" height="46" rx="2" fill={accent}/><text x="115" y="106" fill={textColor} fontSize="26" letterSpacing="4">{graphic.kicker||'МАРШРУТ'}</text></g>
      <text x="1830" y="106" textAnchor="end" fill={textColor} fontSize="26" opacity={enter}>{country}</text>
      <g opacity={enter}>
        <rect x="90" y="870" width="1740" height="93" rx="12" fill="#081a29e8"/>
        {places.map((place,index)=>{
          const width=1740/places.length,x=90+index*width,visited=index<=active;
          return <g key={index} opacity={visited?1:.5}>
            <rect x={x+18} y="888" width={Math.max(0,(width-36)*(index<active?1:index===active?clamp((reveal-geometry.arrivals[index]!)/Math.max(.001,(geometry.arrivals[index+1]??1)-geometry.arrivals[index]!)):0))} height="3" fill={accent}/>
            <text x={x+22} y="931" fontSize="22" fill={accent}>{String(index+1).padStart(2,'0')}</text>
            <text x={x+65} y="931" fontSize={Math.min(27,(width-85)/Math.max(1,place.name.length)*1.6)} fill={textColor}>{place.name}</text>
          </g>;
        })}
      </g>
      <g fill="#e1e7eb" fontSize="18" textAnchor="end"><text x="1830" y="1003">EOxCloudless · https://cloudless.eox.at · EOX IT Services GmbH · CC BY 4.0</text><text x="1830" y="1032">Contains modified Copernicus Sentinel data 2016</text></g>
    </svg>
  </AbsoluteFill>;
}
function MapGraphic({graphic,progress,enter,accent,textColor}:{graphic:Graphic;progress:number;enter:number;accent:string;textColor:string}) {
  if(!valid(graphic.place)) return null;
  if(graphic.kind==='map-locator'&&graphic.cityDetail!==false)return <SatelliteMapGraphic {...{graphic,progress,enter,accent,textColor}}/>;
  const c=documentaryMapCamera(graphic,progress), route=graphic.kind==='map-route'&&valid(graphic.fromPlace);
  const project=(p:{x:number;y:number})=>({x:960+(p.x-c.cx)/c.width*1920,y:510+(p.y-c.cy)/c.height*1080});
  const end=project(c.end),start=project(c.start);
  const reveal=documentaryEase(clamp((progress-.25)/.5)),pin=documentaryEase(clamp((progress-.4)/.22));
  const detail=graphic.kind==='map-locator'&&graphic.cityDetail!==false&&graphic.detail&&Math.abs(graphic.detail.latitude-graphic.place!.latitude)<.0001&&Math.abs(graphic.detail.longitude-graphic.place!.longitude)<.0001?graphic.detail:undefined;
  const detailBlend=detail?documentaryEase(clamp((progress-.38)/.22)):0;
  if(detail)end.y+=(540-end.y)*detailBlend;
  const labelX=clamp(end.x+36,100,1450),labelY=clamp(end.y-42,120,820);
  return <AbsoluteFill style={{background:'radial-gradient(ellipse at 60% 40%,#173744,#07141c)'}}>
    <Img src={documentaryRelief} style={{position:'absolute',width:1,height:1,opacity:0}}/>
    {detail&&<Img src={resolveMediaSource(detail.imagePath)} style={{position:'absolute',width:1,height:1,opacity:0}}/>}
    <svg viewBox="0 0 1920 1080" width="100%" height="100%">
      <defs><linearGradient id="map-edge-shade" x1="0" x2="0" y1="0" y2="1"><stop stopColor="#07141c" stopOpacity=".85"/><stop offset=".18" stopColor="#07141c" stopOpacity="0"/><stop offset=".83" stopColor="#07141c" stopOpacity="0"/><stop offset="1" stopColor="#07141c" stopOpacity=".9"/></linearGradient></defs>
      <g transform={`translate(960 510) scale(${1920/c.width}) translate(${-c.cx} ${-c.cy})`}>
        {[-1440,0,1440].map(offset=><g key={offset} transform={`translate(${offset} 0)`}>
          <image href={documentaryRelief} width="1440" height="720" preserveAspectRatio="none" opacity=".78"/>
          <path d={documentaryLandPath} fill="none" stroke="#d5d3b1" strokeOpacity=".32" strokeWidth={.3} fillRule="evenodd" />
          {Array.from({length:13},(_,i)=><path key={i} d={`M${i*120} 0V720 M0 ${i*60}H1440`} fill="none" stroke="#91bbbd" strokeOpacity={.1} strokeWidth={.3}/>) }
        </g>)}
      </g>
      <rect width="1920" height="1080" fill="#03131d" opacity=".38"/>
      {detail&&<g opacity={detailBlend} transform={`translate(960 540) scale(${1.03+.24*documentaryEase(clamp((progress-.4)/.6))}) translate(-960 -540)`}><image href={resolveMediaSource(detail.imagePath)} x="0" y="-420" width="1920" height="1920" preserveAspectRatio="none"/></g>}
      <rect width="1920" height="1080" fill="url(#map-edge-shade)"/>
      {route&&<><path d={`M${start.x} ${start.y} Q${(start.x+end.x)/2} ${Math.min(start.y,end.y)-130} ${end.x} ${end.y}`} pathLength={1} fill="none" stroke={accent} strokeWidth={6} strokeLinecap="round" strokeDasharray="1" strokeDashoffset={1-reveal}/>
        <circle cx={start.x} cy={start.y} r={9} fill={accent}/><Text text={graphic.fromPlace!.name} x={clamp(start.x-24,180,1700)} y={clamp(start.y+58,140,875)} size={34} center color={textColor}/></>}
      <g opacity={pin}><circle cx={end.x} cy={end.y} r={18+20*(1-pin)} fill="none" stroke={accent} strokeWidth={2}/><circle cx={end.x} cy={end.y} r={8} fill={accent}/>
        <rect x={labelX-15} y={labelY-50} width={Math.min(580,graphic.place!.name.length*29+30)} height={68} rx={8} fill="#081a29" fillOpacity=".92"/>
        <path d={`M${end.x+18} ${end.y} L${labelX-12} ${labelY+10} H${labelX+Math.min(540,graphic.place!.name.length*26)}`} stroke={accent} strokeWidth={2} fill="none"/>
        <Text text={graphic.place!.name} x={labelX} y={labelY} size={48} color={textColor} width={22}/>
      </g>
      <g opacity={enter}><rect x="90" y="72" width="6" height="58" rx="3" fill={accent}/>
        <text x="118" y="112" fill={textColor} fontSize="28" letterSpacing="5">{graphic.kicker||'LOCATION'}</text>
        <text x="90" y="982" fill="#b2c6cd" fontSize="22">{graphic.place!.country??''}</text>
        <text x="1830" y="1028" textAnchor="end" fill="#ccd9df" stroke="#10202d" strokeWidth="3" paintOrder="stroke" fontSize="18">{detailBlend>.1?'© OpenStreetMap contributors · ODbL · openstreetmap.org/copyright':'Natural Earth · geographic overview'}</text>
      </g>
    </svg>
  </AbsoluteFill>;
}
export function countValue(text:string,t:number) {
  if(t>=1) return text;
  const match=/^([^\d+-]*)([+-]?\d[\d\s]*)([.,]\d+)?(.*)$/u.exec(text);
  if(!match) return text;
  const value=Number((match[2]??'').replace(/\s/g,'')+(match[3]??'').replace(',','.'));
  if(!Number.isFinite(value)) return text;
  const decimals=Math.min(2,(match[3]?.length??1)-1);
  return (match[1]??'')+(value*t).toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g,' ')+(/\s$/u.test(match[2]??'')?' ':'')+(match[4]??'');
}
export function DocumentaryMotionGraphic({graphic,frame,frames,accent,textColor}:{graphic:Graphic;frame:number;frames:number;accent:string;textColor:string}) {
  const paper=graphic.theme==='paper'&&['feature-list','statistic'].includes(graphic.kind);
  if(paper){textColor='#22352d';accent='#346f55';}
  const p=clamp(frame/Math.max(1,frames-1)), enter=documentaryEase(clamp(frame/18));
  const exit=clamp((frames-1-frame)/8),opacity=Math.min(enter,exit);
  if(graphic.kind.startsWith('map-')) return <AbsoluteFill style={graphic.mapStyle==='inset'?{left:'45%',top:'43%',width:'52%',height:'52%',borderRadius:16,overflow:'hidden',boxShadow:'0 10px 60px #000a',border:'2px solid #ffffff60',opacity:enter}:undefined}>{graphic.kind==='map-route'?<SatelliteRouteGraphic graphic={graphic} progress={p} enter={enter} accent={accent} textColor={textColor}/>:<MapGraphic graphic={graphic} progress={p} enter={enter} accent={accent} textColor={textColor}/>}</AbsoluteFill>;
  const title=graphic.title, n=Number(graphic.value), active=graphic.activeIndex??-1;
  return <AbsoluteFill style={{pointerEvents:'none',opacity}}><svg viewBox="0 0 1920 1080" width="100%" height="100%" style={{fontFamily:paper?'Arial, sans-serif':'Georgia, Times New Roman, serif',overflow:'visible'}}>
    {graphic.kind==='key-point'&&<>
      <defs><linearGradient id="editorial-shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#050d14" stopOpacity="0"/><stop offset="1" stopColor="#050d14" stopOpacity=".9"/></linearGradient></defs>
      <rect x="0" y="410" width="1920" height="670" fill="url(#editorial-shade)"/>
      <path d={`M112 634h${180*documentaryEase(clamp((frame-3)/19))}`} stroke={accent} strokeWidth="6"/>
      {lines(title,30).slice(0,3).map((line,index)=>{
        const reveal=documentaryEase(clamp((frame-6-index*5)/18));
        return <g key={index} opacity={reveal} transform={`translate(${(1-reveal)*55} ${(1-reveal)*18})`}>
          <text x="112" y={746+index*91} fill={index===0?textColor:accent} fontFamily="Arial,sans-serif" fontSize="76" fontWeight="800" letterSpacing="-2">{line}</text>
        </g>;
      })}
    </>}
    {graphic.kind==='chapter-number'&&<g transform={`translate(0 ${(1-enter)*22})`}>
      <text x="960" y="335" textAnchor="middle" fill={textColor} fontSize="24" letterSpacing="12">{graphic.kicker||'CHAPTER'}</text>
      <text x="960" y="542" textAnchor="middle" fill={accent} fontSize="190">{graphic.value||'01'}</text>
      <path d={`M${960-160*enter} 594H${960+160*enter}`} stroke={accent} strokeWidth="2"/>
      <Text text={title} x={960} y={692} center size={62} color={textColor} width={35}/>
    </g>}
    {graphic.kind==='chronology'&&<>
      <text x="960" y="492" textAnchor="middle" fill={textColor} fontSize="184">{graphic.value}</text>
      <Text text={title} x={960} y={600} center size={38} color={textColor} width={52}/>
      <g transform={`translate(${(1-enter)*180} 0)`}>
        <path d="M90 820H1830" stroke={textColor} strokeOpacity=".5" strokeWidth="2"/>
        {Array.from({length:13},(_,i)=><g key={i} opacity={i===6?1:.48}><path d={`M${120+i*140} 815v${i===6?46:24}`} stroke={i===6?accent:textColor} strokeWidth={i===6?4:2}/><text x={120+i*140} y="908" textAnchor="middle" fontSize="28" fill={i===6?accent:textColor}>{Number.isFinite(n)?n+i-6:''}</text></g>)}
        <path d="M948 772h24l-12 22Z" fill={accent}/>
      </g>
    </>}
    {graphic.kind==='statistic'&&<g transform={`translate(${(1-enter)*32} 0)`}>
      <text x="1220" y="260" fill={accent} fontSize="26" letterSpacing="3">{graphic.kicker}</text>
      <Text text={countValue(graphic.value??'',documentaryEase(clamp(frame/Math.min(27,frames*.48))))} x={1220} y={400} size={86} color={textColor} width={14} maxHeight={230}/>
      <path d={`M1220 630h${600*enter}`} stroke={accent} strokeWidth="3"/>
      <Text text={title} x={1220} y={710} size={42} color={textColor} width={24} maxHeight={260}/>
    </g>}
    {graphic.kind==='feature-list'&&graphic.presentation==='panels'&&<>
      <path d={`M100 98h${90*enter}`} stroke={accent} strokeWidth="5"/>
      <Text text={title} x={100} y={177} size={62} color={textColor} width={52} maxHeight={120}/>
      <path d="M100 979H1820" stroke={accent} strokeOpacity=".18" strokeWidth="3"/>
      <path d={`M100 979H${100+1720*p}`} stroke={accent} strokeWidth="4"/>
    </>}
    {graphic.kind==='feature-list'&&graphic.presentation!=='panels'&&<>
      <path d={`M70 140h${94*enter}`} stroke={accent} strokeWidth="5"/>
      <Text text={title} x={70} y={226} size={48} color={textColor} width={23} maxHeight={168}/>
      {(graphic.items??[]).slice(0,5).map((item,i)=><g key={i} opacity={clamp((frame-i*3)/12)*(active<0||i===active?1:.38)} transform={`translate(${(1-enter)*-25} 0)`}>
        {i===active&&<rect x="60" y={400+i*112} width="640" height="96" rx="12" fill={accent} fillOpacity={paper?.08:.1}/>}
        {i===active&&<path d={`M70 ${440+i*112-18}l18 10-18 10Z`} fill={accent}/>}
        <text x="104" y={440+i*112} fill={accent} fontSize="34">{String(i+1).padStart(2,'0')}</text>
        <Text text={item} x={176} y={440+i*112} size={36} color={textColor} width={22} maxHeight={86}/>
      </g>)}
    </>}
    {graphic.kind==='callout'&&(()=>{const x=clamp(graphic.anchorX??60,5,95)*19.2,y=clamp(graphic.anchorY??58,5,95)*10.8;
      const left=x>960,labelX=left?150:1160,labelY=clamp(y-170,150,760);
      return <><circle cx={x} cy={y} r={9} fill={accent}/><circle cx={x} cy={y} r={19} stroke={accent} fill="none" strokeWidth="2"/>
        <path d={`M${x} ${y}L${left?labelX+540:labelX} ${labelY+32}H${left?labelX:labelX+540}`} stroke={accent} fill="none" strokeWidth="3" pathLength={1} strokeDasharray="1" strokeDashoffset={1-enter}/>
        <Text text={title} x={labelX} y={labelY} size={40} color={textColor} width={23}/></>;
    })()}
    {graphic.kind==='quote'&&<g transform={`translate(0 ${(1-enter)*28})`}>
      <text x="200" y="360" fill={accent} fontSize="180">“</text>
      <Text text={title} x={340} y={415} size={68} color={textColor} width={35} maxHeight={390}/>
      <path d={`M340 836h${1240*enter}`} stroke={accent} strokeWidth="3"/>
      <text x="340" y="900" fill={accent} fontSize="28" letterSpacing="3">{graphic.kicker}</text>
    </g>}
  </svg></AbsoluteFill>;
}
