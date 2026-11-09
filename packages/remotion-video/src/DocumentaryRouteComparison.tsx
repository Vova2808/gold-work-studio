import {useMemo} from 'react';
import {AbsoluteFill} from 'remotion';
import type {DocumentaryRouteComparison} from '@gold-work/shared';
import {documentaryLandPath} from './documentary-land-data.js';
import {documentaryRouteComparisonGeometry} from './documentary-route-comparison.js';
import {fitDocumentaryText} from './documentary-typography.js';

export function DocumentaryRouteComparisonGraphic({comparison,progress,title}:{comparison:DocumentaryRouteComparison;progress:number;title?:string}){
  const geometry=useMemo(()=>documentaryRouteComparisonGeometry(comparison),[comparison]);
  const automaticTitle=useMemo(()=>comparison.routes.map((route,i)=>route.places.slice(1,-1).find(place=>
    !comparison.routes[1-i]!.places.slice(1,-1).some(other=>other.latitude===place.latitude&&other.longitude===place.longitude))!.name).join(' / '),[comparison]);
  const header=title??automaticTitle;
  const headerFont=useMemo(()=>fitDocumentaryText(header,35,1760,80,400),[header]);
  const legends=useMemo(()=>comparison.routes.map(route=>{
    const places=route.places.slice(1,-1).map(place=>place.name).join('\n'),ends=`${route.places[0]!.name} · ${route.places.at(-1)!.name}`;
    return {places,ends,placeFont:fitDocumentaryText(places,30,320,140,400),endFont:fitDocumentaryText(ends,22,360,70,400)};
  }),[comparison]);
  const colors=['#f2bb67','#70d7e0'];
  return <AbsoluteFill style={{background:'#112b38'}}><svg viewBox="0 0 1920 1080" width="100%" height="100%" style={{fontFamily:'Arial,sans-serif'}}>
    <foreignObject x="80" y="48" width="1760" height="80"><div style={{fontSize:headerFont,lineHeight:1.15,color:'#e8f0f2',whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{header}</div></foreignObject>
    <defs><clipPath id="route-comparison-map"><rect x="50" y="140" width="1340" height="740"/></clipPath></defs>
    <g clipPath="url(#route-comparison-map)"><g transform={geometry.transform}>
      <path d={documentaryLandPath} fill="#52695f" stroke="#9eb19b" strokeWidth={1/geometry.scale} fillRule="evenodd"/>
      {geometry.routes.map((route,i)=><g key={i} opacity={Math.max(0,Math.min(1,(progress-(i ? .12 : 0))/.28))}>
        <path d={route.path} fill="none" stroke="#112b38" strokeWidth={10/geometry.scale}/>
        <path d={route.path} fill="none" stroke={colors[i]} strokeWidth={4/geometry.scale}/>
        {route.places.map((place,j)=><circle key={j} cx={place.x} cy={place.y} r={5/geometry.scale} fill={colors[i]}/>)}
      </g>)}
    </g></g>
    {legends.map((legend,i)=><g key={i} transform={`translate(1430 ${225+i*300})`}>
      <path d="M0 0H360" stroke={colors[i]} strokeWidth="5"/>
      <text y="55" fontSize="28" fill={colors[i]}>{i+1}</text>
      <foreignObject x="40" y="24" width="320" height="140"><div style={{fontSize:legend.placeFont,lineHeight:1.15,color:'#f3f4ee',whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{legend.places}</div></foreignObject>
      <foreignObject x="0" y="185" width="360" height="70"><div style={{fontSize:legend.endFont,lineHeight:1.15,color:'#b9ccd2',whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{legend.ends}</div></foreignObject>
    </g>)}
    <text x="80" y="965" fontSize="25" fill="#f0dcaa">{comparison.disclaimer}</text>
    <text x="80" y="1015" fontSize="20" fill="#b9ccd2">Natural Earth · geographic anchors; illustrated connecting lines</text>
  </svg></AbsoluteFill>;
}
