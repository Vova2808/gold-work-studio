import type {DocumentaryRouteComparison} from '@gold-work/shared';
import {documentaryLandPath} from './documentary-land-data.js';

const xy=(p:{longitude:number;latitude:number})=>({x:(p.longitude+180)*4,y:(90-p.latitude)*4});
export class DocumentaryRouteGeometryError extends Error {
  readonly name='DocumentaryRouteGeometryError';
  constructor(message:string,readonly correctable=true){super(message);}
}
let rings:Array<{points:Array<[number,number]>;box:number[]}>|undefined;
function landRings(){
  return rings??= [...documentaryLandPath.matchAll(/M([^M]+)/g)].map(m=>{
    const n=m[1]!.match(/-?\d+(?:\.\d+)?/g)!.map(Number),points:Array<[number,number]>=[];
    for(let i=0;i+1<n.length;i+=2)points.push([n[i]!,n[i+1]!]);
    return {points,box:[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))]};
  });
}
/** Coarse existing coastline rejects continental shortcuts. This is not navigation. */
function deepLand(point:{x:number;y:number}){
  for(const {points,box} of landRings()){
    if(point.x<box[0]!||point.x>box[2]!||point.y<box[1]!||point.y>box[3]!)continue;
    let inside=false,distance=Infinity;
    for(let i=0,j=points.length-1;i<points.length;j=i++){
      const [ax,ay]=points[j]!,[bx,by]=points[i]!,dx=bx-ax,dy=by-ay;
      if((ay>point.y)!==(by>point.y)&&point.x<(bx-ax)*(point.y-ay)/(by-ay)+ax)inside=!inside;
      const t=Math.max(0,Math.min(1,((point.x-ax)*dx+(point.y-ay)*dy)/(dx*dx+dy*dy||1)));
      distance=Math.min(distance,Math.hypot(point.x-ax-t*dx,point.y-ay-t*dy));
    }
    if(inside&&distance>5.6)return true;
  }
  return false;
}
export function documentaryRouteComparisonGeometry(value:DocumentaryRouteComparison){
  if(value.routes.length!==2)throw Error('Сравнению нужны ровно два маршрута.');
  const intermediates=value.routes.map(r=>r.places.slice(1,-1).map(p=>`${p.latitude}:${p.longitude}`));
  if(intermediates.some((places,i)=>!places.some(p=>!intermediates[1-i]!.includes(p))))throw Error('Двум альтернативам нужны разные промежуточные именованные опоры, а не только разные изгибы.');
  for(const route of value.routes){
    if(route.points.length<3||route.points.length>32||route.points.some(p=>!Number.isFinite(p.latitude)||!Number.isFinite(p.longitude)||Math.abs(p.latitude)>80||Math.abs(p.longitude)>180))throw new DocumentaryRouteGeometryError('Маршрут содержит неизвестные или некорректные координаты изгибов.');
    if(route.places.length<3||route.places.some(place=>!route.points.some(p=>Math.hypot(p.latitude-place.latitude,p.longitude-place.longitude)<.00001)))throw Error('Не все проверенные места привязаны к линии.');
    for(let i=1;i<route.points.length;i++){
      const a=route.points[i-1]!,b=route.points[i]!;
      if(Math.abs(a.longitude-b.longitude)>180)throw Error('Маршрут через линию перемены дат пока не поддерживается.');
      const samples=Math.max(1,Math.ceil(Math.hypot(a.latitude-b.latitude,a.longitude-b.longitude)));
      for(let j=1;j<samples;j++){
        const p={longitude:a.longitude+(b.longitude-a.longitude)*j/samples,latitude:a.latitude+(b.latitude-a.latitude)*j/samples};
        if(route.places.some(v=>Math.hypot(v.longitude-p.longitude,v.latitude-p.latitude)<1.5))continue;
        if(deepLand(xy(p)))throw new DocumentaryRouteGeometryError(`Условная морская линия «${route.label}» пересекает материк возле ${p.latitude.toFixed(1)}, ${p.longitude.toFixed(1)}; геометрия не принята.`);
      }
    }
  }
  const [a,b]=value.routes;
  for(const at of [0,-1])if(JSON.stringify(a!.points.at(at))!==JSON.stringify(b!.points.at(at)))throw Error('У сравниваемых маршрутов должны совпадать начало и конец.');
  if(JSON.stringify(a!.points)===JSON.stringify(b!.points))throw Error('Маршруты сравнения совпадают.');
  const all=value.routes.flatMap(r=>r.points.map(xy)),left=Math.min(...all.map(p=>p.x))-20,right=Math.max(...all.map(p=>p.x))+20,top=Math.min(...all.map(p=>p.y))-20,bottom=Math.max(...all.map(p=>p.y))+20;
  const scale=Math.min(1290/(right-left),680/(bottom-top));
  if(!Number.isFinite(scale)||scale<=0)throw Error('Некорректный охват карты.');
  const transform=`translate(${70+(1290-(right-left)*scale)/2} ${165+(680-(bottom-top)*scale)/2}) scale(${scale}) translate(${-left} ${-top})`;
  return {transform,routes:value.routes.map(r=>({path:r.points.map((p,i)=>{const v=xy(p);return `${i?'L':'M'}${v.x} ${v.y}`;}).join(' '),places:r.places.map(p=>({...p,...xy(p)}))})),scale};
}
