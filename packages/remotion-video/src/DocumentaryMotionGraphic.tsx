import { AbsoluteFill, Img } from 'remotion';
import {DocumentaryRouteComparisonGraphic} from './DocumentaryRouteComparison.js';
import {useMemo,useState,type CSSProperties} from 'react';
import type { DocumentaryMotionGraphic as Graphic } from './documentary-timeline.js';
import { documentaryEase } from './documentary-design.js';
import { documentaryLandPath } from './documentary-land-data.js';
import { documentaryRelief } from './documentary-relief-data.js';
import {resolveMediaSource} from './MediaSurface.js';
import {documentaryRouteBounds, documentaryRouteGeometry, documentaryRouteKey, documentaryRouteLabels} from './documentary-route.js';
import {fitDocumentaryText} from './documentary-typography.js';
import {DocumentaryChapter} from './DocumentaryChapter.js';
import {DocumentaryPhrase,documentaryCompactPhrase} from './DocumentaryPhrase.js';
import {documentaryEditorialStages,documentaryMarkerInk,documentaryRevealFrame,documentaryStatisticRatio} from './documentary-editorial.js';

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
  if(kind==='statistic'||kind==='feature-list') return {left:`${(kind==='statistic'?3:39)+(slot-width)/2}%`,top:`${(100-height)/2}%`,width:`${width}%`,height:`${height}%`,borderRadius:3,overflow:'hidden',opacity:arrival,transform:`translateY(${(1-arrival)*12}px)`};
  const reveal=documentaryEase(clamp(arrivalFrame===undefined?progress/.28:arrivalFrame/28));
  if(['chapter-number','chronology','quote'].includes(kind)) return {filter:`brightness(.42) blur(${(1-reveal)*5}px)`,transform:`scale(${1.04+.035*reveal})`};
  return {};
}
function Text({text,x,y,size=58,color='#fff',center=false,width=30,maxHeight=280,outline}:{text:string;x:number;y:number;size?:number;color?:string;center?:boolean;width?:number;maxHeight?:number;outline?:string}) {
  const rows=lines(text,width);
  size=Math.min(size,maxHeight/Math.max(1,rows.length)/1.24);
  return <text x={x} y={y} fill={color} stroke={outline??'#0006'} strokeWidth={outline?2.5:1} strokeLinejoin="round" paintOrder="stroke" fontSize={size} fontWeight={700} textAnchor={center?'middle':'start'}>
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
  const [failedImage,setFailedImage]=useState<string>();
  const detail=graphic.detail,place=graphic.place!;
  const ready=detail?.kind==='satellite'&&Boolean(detail.imagePath)&&failedImage!==detail.imagePath&&Math.abs(detail.latitude-place.latitude)<.0001&&Math.abs(detail.longitude-place.longitude)<.0001&&Math.abs(detail.radiusKm-(graphic.mapRadiusKm??35))<.01;
  if(!ready)return <MapGraphic graphic={{...graphic,cityDetail:false}} progress={progress} enter={enter} accent={accent} textColor={textColor}/>;
  const scale=1+(clamp(graphic.cameraZoom??1.08,1,1.2)-1)*documentaryEase(progress);
  const pin=documentaryEase(clamp((progress-.12)/.18));
  const mainMap=graphic.mapStyle!=='inset',placeFont=mainMap?64:46;
  const labelWidth=Math.min(780,place.name.length*(mainMap?38:29)+(mainMap?70:44));
  const labelTop=mainMap?398:422,labelHeight=mainMap?96:72;
  const fittedPlaceFont=fitDocumentaryText(place.name,placeFont,labelWidth-40,labelHeight-20,700);
  return <AbsoluteFill style={{background:'#14201c'}}>
    <Img src={resolveMediaSource(detail.imagePath)} maxRetries={0} onError={()=>setFailedImage(detail.imagePath)} style={{width:'100%',height:'100%',objectFit:'cover',transform:`scale(${scale})`}}/>
    <AbsoluteFill style={{background:'linear-gradient(#06141caa,transparent 25%,transparent 74%,#06141ccc)'}}/>
    <svg viewBox="0 0 1920 1080" width="100%" height="100%" style={{position:'absolute',fontFamily:'Arial,sans-serif'}}>
      {graphic.kicker&&<g opacity={enter}><rect x="90" y="72" width="5" height="46" rx="2" fill={accent}/><text x="115" y="106" fill={textColor} fontSize="26" letterSpacing="4">{graphic.kicker}</text></g>}
      <g opacity={pin}>
        {!!graphic.regionRadiusKm&&<ellipse cx="960" cy="540" rx={graphic.regionRadiusKm/detail.radiusKm*960} ry={graphic.regionRadiusKm/detail.radiusKm*960} fill={accent} fillOpacity=".12" stroke={accent} strokeOpacity=".55" strokeWidth="2"/>}
        <circle cx="960" cy="540" r={18+18*(1-pin)} fill="#10202d70" stroke={accent} strokeWidth="2"/><circle cx="960" cy="540" r="6" fill={textColor}/>
        <path d="M976 537L1020 497H1080" fill="none" stroke={accent} strokeWidth="2"/>
        <rect x="1020" y={labelTop} width={labelWidth} height={labelHeight} rx="8" fill="#081a29dc"/>
        <foreignObject x="1040" y={labelTop+10} width={labelWidth-40} height={labelHeight-20}>
          <div style={{height:'100%',display:'flex',alignItems:'center',color:textColor,fontSize:fittedPlaceFont,fontWeight:700,lineHeight:1.1,overflowWrap:'anywhere'}}>{place.name}</div>
        </foreignObject>
      </g>
      <text x="90" y="958" fontSize="22" fill="#fff">{place.country??''}</text>
      <g fill="#e1e7eb" fontSize="18" textAnchor="end"><text x="1830" y="1003">EOxCloudless · https://cloudless.eox.at · EOX IT Services GmbH · CC BY 4.0</text><text x="1830" y="1032">Contains modified Copernicus Sentinel data 2016</text></g>
    </svg>
  </AbsoluteFill>;
}
function SatelliteRouteGraphic({graphic,progress,enter,accent,textColor}:{graphic:Graphic;progress:number;enter:number;accent:string;textColor:string}) {
  const [failedImage,setFailedImage]=useState<string>();
  const places=graphic.route??(graphic.fromPlace&&graphic.place?[graphic.fromPlace,graphic.place]:[]),detail=graphic.detail;
  if(places.length<2)return <MapGraphic graphic={{...graphic,kind:'map-locator',place:places[0]??graphic.place,cityDetail:false}} progress={progress} enter={enter} accent={accent} textColor={textColor}/>;
  const satellite=detail?.kind==='satellite'&&detail.imagePath&&failedImage!==detail.imagePath&&detail.routeKey===documentaryRouteKey(places)
    &&detail.bounds?.every(Number.isFinite)&&detail.bounds[2]>detail.bounds[0]&&detail.bounds[3]>detail.bounds[1]?detail:undefined;
  // Reuse every verified stop and the existing projection; without an asset this
  // is a route diagram, not a new satellite image or a two-endpoint substitute.
  const bounds=satellite?.bounds??documentaryRouteBounds(places);
  const reveal=documentaryEase(clamp((progress-.12)/.72));
  const geometry=documentaryRouteGeometry(places,bounds,reveal),labels=documentaryRouteLabels(geometry.points,places);
  const active=geometry.arrivals.reduce((last,at,index)=>reveal>=at?index:last,0);
  const country=[...new Set(places.map(place=>place.country).filter(Boolean))].join(' · ');
  const scale=1+(clamp(graphic.cameraZoom??1.04,1,1.08)-1)*documentaryEase(progress);
  return <AbsoluteFill style={{background:satellite?'#14201c':'radial-gradient(ellipse at 60% 40%,#173744,#07141c)'}}>
    <AbsoluteFill style={{transform:`scale(${scale})`}}>
      {satellite&&<Img src={resolveMediaSource(satellite.imagePath)} maxRetries={0} onError={()=>setFailedImage(satellite.imagePath)} style={{width:'100%',height:'100%',objectFit:'fill'}}/>}
      <svg viewBox="0 0 1920 1080" width="100%" height="100%" style={{position:'absolute',fontFamily:'Arial,sans-serif'}}>
        <path d={geometry.path} fill="none" stroke="#06141cb0" strokeWidth="11" strokeLinejoin="round"/>
        <path d={geometry.path} pathLength={1} fill="none" stroke={accent} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1" strokeDashoffset={1-reveal}/>
        {geometry.points.map((point,i)=>{
          const arrived=documentaryEase(clamp((reveal-geometry.arrivals[i]!+.1)/.1)),label=labels[i]!;
          return <g key={i} opacity={arrived}>
            {!!graphic.regionRadiusKm&&<circle cx={point.x} cy={point.y} r={graphic.regionRadiusKm*1000/Math.cos(places[i]!.latitude*Math.PI/180)/(bounds[2]-bounds[0])*1920} fill={accent} fillOpacity=".12" stroke={accent} strokeOpacity=".55" strokeWidth="2"/>}
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
      {graphic.kicker&&<g opacity={enter}><rect x="90" y="72" width="5" height="46" rx="2" fill={accent}/><text x="115" y="106" fill={textColor} fontSize="26" letterSpacing="4">{graphic.kicker}</text></g>}
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
      {satellite&&<g fill="#e1e7eb" fontSize="18" textAnchor="end"><text x="1830" y="1003">EOxCloudless · https://cloudless.eox.at · EOX IT Services GmbH · CC BY 4.0</text><text x="1830" y="1032">Contains modified Copernicus Sentinel data 2016</text></g>}
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
      <g opacity={enter}>{graphic.kicker&&<><rect x="90" y="72" width="6" height="58" rx="3" fill={accent}/>
        <text x="118" y="112" fill={textColor} fontSize="28" letterSpacing="5">{graphic.kicker}</text></>}
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
  const [whole,fraction]=(value*Math.max(0,t)).toFixed(decimals).split('.');
  const formatted=whole!.replace(/\B(?=(\d{3})+(?!\d))/g,' ')+(fraction?(match[3]?.[0]??'.')+fraction:'');
  return (match[1]??'')+formatted+(/\s$/u.test(match[2]??'')?' ':'')+(match[4]??'');
}
/** Poster hierarchy uses only authored value/title/kicker. A scale is an exact
 * visual encoding of an explicit ratio, never a guessed maximum for a count. */
function StatisticPoster({graphic,frame,frames,accent,textColor,customBackground=false}:{graphic:Graphic;frame:number;frames:number;accent:string;textColor:string;customBackground?:boolean}) {
  const value=graphic.value??'',ratio=useMemo(()=>documentaryStatisticRatio(value),[value]);
  const stages=documentaryEditorialStages(frame,frames),centered=graphic.showSource===false;
  const x=centered?180:1220,width=centered?1560:600,main=ratio?.main??value;
  const font=useMemo(()=>fitDocumentaryText(main,ratio?(centered?300:248):(centered?220:176),width,300,800),[main,width,centered,ratio]);
  const contextSize=useMemo(()=>fitDocumentaryText(ratio?.context.trimStart()??'',centered?68:56,width,112,600),[ratio,centered,width]);
  const title=graphic.title.trim()===value.trim()?'':graphic.title;
  const titleSize=useMemo(()=>fitDocumentaryText(title,centered?60:44,width,156,600),[title,centered,width]);
  const outline=customBackground?documentaryMarkerInk(textColor):undefined;
  const outlineStyle:CSSProperties|undefined=outline?{WebkitTextStroke:`2.5px ${outline}`,paintOrder:'stroke'}:undefined;
  const exit=clamp((frames-frame)/Math.max(1,Math.min(8,frames*.08)));
  return <AbsoluteFill style={{pointerEvents:'none',opacity:exit}}><svg viewBox="0 0 1920 1080" width="100%" height="100%" style={{fontFamily:'Arial,sans-serif'}}>
    {graphic.kicker&&<g opacity={stages.main}><Text text={graphic.kicker} x={centered?960:x} y={185} center={centered} size={30} color={textColor} width={centered?70:26} maxHeight={70} outline={outline}/></g>}
    <foreignObject x={x} y={280} width={width} height={310} opacity={stages.main} transform={`translate(0 ${(1-stages.main)*36})`}>
      <div style={{fontSize:font,fontWeight:800,lineHeight:1.05,color:textColor,textAlign:centered?'center':'left',fontVariantNumeric:'tabular-nums',whiteSpace:'pre-wrap',overflowWrap:'anywhere',...outlineStyle}}>{countValue(main,stages.detail)}</div>
    </foreignObject>
    {ratio&&<foreignObject x={x} y="588" width={width} height="115" opacity={stages.detail} transform={`translate(0 ${(1-stages.detail)*20})`}>
      <div style={{fontSize:contextSize,fontWeight:600,lineHeight:1.12,color:textColor,textAlign:centered?'center':'left',whiteSpace:'pre-wrap',overflowWrap:'anywhere',...outlineStyle}}>{ratio.context.trimStart()}</div>
    </foreignObject>}
    {ratio?<g opacity={stages.detail}>
      {ratio.segments?Array.from({length:ratio.segments},(_,i)=>{const gap=6,segment=(width-gap*(ratio.segments!-1))/ratio.segments!,fill=clamp(ratio.filled!*stages.detail-i);return <g key={i}>
        <rect x={x+i*(segment+gap)} y="738" width={segment} height="26" rx="3" fill={textColor} opacity=".2"/>
        <rect x={x+i*(segment+gap)} y="738" width={segment*fill} height="26" rx="3" fill={accent}/>
      </g>;}):<><rect x={x} y="738" width={width} height="26" rx="4" fill={textColor} opacity=".2"/><rect x={x} y="738" width={width*ratio.fraction*stages.detail} height="26" rx="4" fill={accent}/></>}
    </g>:<path d={`M${centered?960-100*stages.detail:x} 738h${200*stages.detail}`} stroke={accent} strokeWidth="6" opacity={stages.detail}/>}
    {title&&<foreignObject x={x} y="817" width={width} height="160" opacity={stages.settle} transform={`translate(0 ${(1-stages.settle)*16})`}>
      <div style={{fontSize:titleSize,fontWeight:600,lineHeight:1.12,color:textColor,textAlign:centered?'center':'left',whiteSpace:'pre-wrap',overflowWrap:'anywhere',...outlineStyle}}>{title}</div>
    </foreignObject>}
  </svg></AbsoluteFill>;
}

export function DocumentaryMotionGraphic({graphic,frame,frames,accent,textColor,customBackground=false,allowAutomaticPhrase=false,motionEnabled=true}:{graphic:Graphic;frame:number;frames:number;accent:string;textColor:string;customBackground?:boolean;allowAutomaticPhrase?:boolean;motionEnabled?:boolean}) {
  const keyPointFont=useMemo(()=>graphic.kind==='key-point'?fitDocumentaryText(graphic.title,58,1696,220,500):58,[graphic.kind,graphic.title]);
  const paper=graphic.theme==='paper'&&['feature-list','statistic'].includes(graphic.kind);
  if(paper){textColor='#22352d';accent='#346f55';}
  const outline=customBackground?documentaryMarkerInk(textColor):undefined;
  const stages=documentaryEditorialStages(frame,frames),local=documentaryRevealFrame(frame,frames),p=clamp(frame/Math.max(1,frames-1)), enter=documentaryEase(clamp(local/18));
  if(graphic.routeComparison)return <DocumentaryRouteComparisonGraphic comparison={graphic.routeComparison}
    title={graphic.origin==='manual'||graphic.title!==graphic.routeComparison.title?graphic.title:undefined} progress={motionEnabled?p:1}/>;
  const exit=clamp((frames-1-frame)/8),opacity=Math.min(enter,exit);
  if(graphic.kind==='chapter-number')return <DocumentaryChapter title={graphic.title} number={graphic.value} kicker={graphic.kicker} frame={frame} frames={frames} accent={accent} textColor={textColor} variant={graphic.variant} holdToEnd={graphic.origin==='automatic'}/>;
  if(graphic.kind==='key-point'&&(graphic.variant==='marker'||graphic.variant==='poster'))return <DocumentaryPhrase graphic={graphic} frame={frame} frames={frames} accent={accent} textColor={textColor} motionEnabled={motionEnabled}/>;
  if(documentaryCompactPhrase(graphic,allowAutomaticPhrase))return <DocumentaryPhrase graphic={graphic} frame={frame} frames={frames} accent={accent} textColor={textColor} compact motionEnabled={motionEnabled}/>;
  if(graphic.kind==='statistic'&&(!graphic.variant||graphic.variant==='poster'))return <StatisticPoster graphic={graphic} frame={frame} frames={frames} accent={accent} textColor={textColor} customBackground={customBackground}/>;
  if(graphic.kind.startsWith('map-')) return <AbsoluteFill style={graphic.mapStyle==='inset'?{left:'45%',top:'43%',width:'52%',height:'52%',borderRadius:16,overflow:'hidden',boxShadow:'0 10px 60px #000a',border:'2px solid #ffffff60',opacity:enter}:undefined}>{graphic.kind==='map-route'?<SatelliteRouteGraphic graphic={graphic} progress={p} enter={enter} accent={accent} textColor={textColor}/>:<MapGraphic graphic={graphic} progress={p} enter={enter} accent={accent} textColor={textColor}/>}</AbsoluteFill>;
  const title=graphic.title, active=graphic.activeIndex??-1;
  return <AbsoluteFill style={{pointerEvents:'none',opacity}}><svg viewBox="0 0 1920 1080" width="100%" height="100%" style={{fontFamily:'Arial, sans-serif',overflow:'visible'}}>
    {graphic.kind==='key-point'&&<>
      <defs><linearGradient id="editorial-shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#050d14" stopOpacity="0"/><stop offset="1" stopColor="#050d14" stopOpacity=".9"/></linearGradient></defs>
      <rect x="0" y="410" width="1920" height="670" fill="url(#editorial-shade)"/>
      <path d={`M112 700h${48*enter}`} stroke={accent} strokeWidth="2"/>
      <g transform={`translate(0 ${(1-enter)*12})`}>
        <foreignObject x="112" y="744" width="1696" height="240"><div style={{fontFamily:'Arial,sans-serif',fontSize:keyPointFont,fontWeight:500,lineHeight:1.15,color:textColor,whiteSpace:'pre-wrap'}}>{title}</div></foreignObject>
      </g>
    </>}
    {graphic.kind==='chronology'&&<>
      <g opacity={documentaryEase((local-8)/22)} transform={`translate(0 ${(1-documentaryEase((local-8)/22))*35})`}>
        <Text text={graphic.value??''} x={960} y={graphic.variant==='date'?420:492} center size={graphic.variant==='date'?128:184} color={textColor} width={graphic.variant==='date'?23:12} maxHeight={300}/>
      </g>
      <g opacity={documentaryEase((local-24)/16)}><Text text={title===graphic.value?'':title} x={960} y={650} center size={40} color={textColor} width={52} maxHeight={125}/></g>
      {graphic.variant!=='date'&&<g transform={`translate(${(1-documentaryEase((local-5)/32))*360} 0)`}>
        <path d="M90 820H1830" stroke={textColor} strokeOpacity=".5" strokeWidth="2"/>
        {Array.from({length:13},(_,i)=><path key={i} d={`M${120+i*140} 815v${i===6?46:24}`} stroke={i===6?accent:textColor} opacity={i===6?1:.48} strokeWidth={i===6?4:2}/>)}
      </g>}
      <path d={graphic.variant==='date'?`M${960-240*enter} 790H${960+240*enter}`:'M944 772h32l-16 24Z'} fill={accent} stroke={accent} strokeWidth="3"/>
    </>}
    {graphic.kind==='statistic'&&graphic.showSource===false&&<g transform={`translate(0 ${(1-enter)*24})`}>
      <Text text={countValue(graphic.value??'',documentaryEase(clamp(frame/Math.min(27,frames*.48))))} x={960} y={430} center size={136} color={textColor} width={28} maxHeight={300} outline={outline}/>
      <path d={`M${960-320*enter} 700H${960+320*enter}`} stroke={accent} strokeWidth="3"/>
      <Text text={title===graphic.value?'':title} x={960} y={800} center size={46} color={textColor} width={48} maxHeight={150} outline={outline}/>
    </g>}
    {graphic.kind==='statistic'&&graphic.showSource!==false&&<g>
      <text x="1220" y="260" fill={accent} stroke={customBackground?documentaryMarkerInk(accent):undefined} strokeWidth={2.5} strokeLinejoin="round" paintOrder="stroke" fontSize="26" letterSpacing="3" opacity={stages.main}>{graphic.kicker}</text>
      <g opacity={stages.detail} transform={`translate(0 ${(1-stages.detail)*30})`}>
        <Text text={countValue(graphic.value??'',stages.detail)} x={1220} y={400} size={86} color={textColor} width={14} maxHeight={230} outline={outline}/>
      </g>
      <path d={`M1220 630h${600*stages.settle}`} stroke={accent} strokeWidth="3" opacity={stages.settle}/>
      <g opacity={stages.settle} transform={`translate(0 ${(1-stages.settle)*12})`}><Text text={title} x={1220} y={710} size={42} color={textColor} width={24} maxHeight={260} outline={outline}/></g>
    </g>}
    {graphic.kind==='feature-list'&&graphic.presentation==='panels'&&<>
      <path d={`M100 98h${90*enter}`} stroke={accent} strokeWidth="5"/>
      <Text text={title} x={100} y={177} size={62} color={textColor} width={52} maxHeight={120} outline={outline}/>
      <path d="M100 979H1820" stroke={accent} strokeOpacity=".18" strokeWidth="3"/>
      <path d={`M100 979H${100+1720*p}`} stroke={accent} strokeWidth="4"/>
    </>}
    {graphic.kind==='feature-list'&&graphic.presentation!=='panels'&&<>
      <path d={`M70 140h${94*enter}`} stroke={accent} strokeWidth="5"/>
      <Text text={title} x={70} y={226} size={48} color={textColor} width={23} maxHeight={168} outline={outline}/>
      {(graphic.items??[]).slice(0,5).map((item,i)=><g key={i} opacity={clamp((frame-i*3)/12)*(active<0||i===active?1:.38)} transform={`translate(${(1-enter)*-25} 0)`}>
        {i===active&&<rect x="60" y={400+i*112} width="640" height="96" rx="12" fill={accent} fillOpacity={paper?.08:.1}/>}
        {i===active&&<path d={`M70 ${440+i*112-18}l18 10-18 10Z`} fill={accent}/>}
        <text x="104" y={440+i*112} fill={accent} stroke={customBackground?documentaryMarkerInk(accent):undefined} strokeWidth={2.5} strokeLinejoin="round" paintOrder="stroke" fontSize="34">{String(i+1).padStart(2,'0')}</text>
        <Text text={item} x={176} y={440+i*112} size={36} color={textColor} width={22} maxHeight={86} outline={outline}/>
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
