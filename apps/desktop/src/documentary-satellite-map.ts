import {createHash} from 'node:crypto';
import {readFile,stat,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {validDocumentaryPlace,type DocumentaryPlace,type DocumentaryMapDetail} from '@gold-work/shared';
import {atomicWrite} from './fs-utils.js';
import {probeEffectMedia} from './effect-media.js';
import {documentaryRouteBounds,documentaryRouteKey} from '@gold-work/remotion-video';

const layer='s2cloudless_3857'; // Explicit 2016 / CC BY 4.0 layer, not newer NC-only layers.
const attribution='EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016)';
const active=new Map<string,Promise<DocumentaryMapDetail>>();
export function satelliteMapRequest(place:DocumentaryPlace,radiusKm=35,route?:DocumentaryPlace[]){
  if(!validDocumentaryPlace(place)||Math.abs(place.latitude)>80)throw Error('Спутниковый слой доступен между 80° ю. ш. и 80° с. ш.; проверьте координаты');
  radiusKm=Math.max(15,Math.min(150,Number.isFinite(radiusKm)?radiusKm:35));
  const lat=place.latitude*Math.PI/180,r=6378137;
  const x=r*place.longitude*Math.PI/180,y=r*Math.log(Math.tan(Math.PI/4+lat/2));
  const halfWidth=radiusKm*1000/Math.cos(lat),halfHeight=halfWidth*9/16;
  if(!route&&Math.abs(x)+halfWidth>Math.PI*r)throw Error('Область пересекает линию перемены дат. Сместите центр или уменьшите охват.');
  const bbox: [number,number,number,number]=route?documentaryRouteBounds(route):[x-halfWidth,y-halfHeight,x+halfWidth,y+halfHeight];
  const url=new URL('https://tiles.maps.eox.at/map');
  url.search=new URLSearchParams({service:'WMS',request:'GetMap',version:'1.1.1',layers:layer,styles:'',srs:'EPSG:3857',bbox:bbox.map(n=>n.toFixed(3)).join(','),width:'2400',height:'1350',format:'image/jpeg'}).toString();
  return {url: url.toString(),radiusKm,bbox};
}
export function prepareSatelliteMap(directory:string,place:DocumentaryPlace,radiusKm=35,route?:DocumentaryPlace[]):Promise<DocumentaryMapDetail>{
  const request=satelliteMapRequest(place,radiusKm,route);
  const key='satellite-'+createHash('sha256').update(request.url).digest('hex');
  const id=directory+key,existing=active.get(id);if(existing)return existing;
  const job=(async()=>{
    const root=join(directory,'Documentary','Maps');await mkdir(root,{recursive:true});
    const imagePath=join(root,key+'.jpg'),metadata=join(root,key+'.json');
    const saved=await readFile(metadata,'utf8').then(t=>JSON.parse(t) as DocumentaryMapDetail).catch(()=>undefined);
    if(saved?.kind==='satellite'&&await stat(imagePath).then(s=>s.size>24,()=>false))return {...saved,imagePath,bounds:request.bbox,routeKey:route?documentaryRouteKey(route):undefined};
    const response=await fetch(request.url,{signal:AbortSignal.timeout(45000)});
    if(!response.ok)throw Error(`Спутниковый снимок: HTTP ${response.status}. Сохранённые материалы не изменены.`);
    if(!response.headers.get('content-type')?.includes('image/jpeg')){await response.body?.cancel();throw Error('Источник не вернул спутниковое изображение. Попробуйте загрузку позже.');}
    const reader=response.body?.getReader();if(!reader)throw Error('Пустой спутниковый снимок');
    let bytes=0;const chunks:Uint8Array[]=[];
    for(;;){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.length;if(bytes>20*1024*1024){await reader.cancel();throw Error('Слишком большой спутниковый снимок');}chunks.push(chunk.value);}
    const data=Buffer.concat(chunks);
    if(data.length<24||data[0]!==0xff||data[1]!==0xd8||data[2]!==0xff)throw Error('Источник вернул повреждённое изображение');
    const detail:DocumentaryMapDetail={kind:'satellite',imagePath,latitude:place.latitude,longitude:place.longitude,radiusKm:request.radiusKm,featureCount:0,createdAt:new Date().toISOString(),attribution,imageryDate:'2016',sourceUrl:request.url,license:'CC BY 4.0',bounds:request.bbox,routeKey:route?documentaryRouteKey(route):undefined};
    await atomicWrite(imagePath,data);
    const image=await probeEffectMedia(imagePath);
    if(image.width!==2400||image.height!==1350)throw Error('Источник вернул спутниковый снимок неверного размера');
    await atomicWrite(metadata,JSON.stringify({...detail,bbox:request.bbox,projection:'EPSG:3857',layer,changes:'cropped geographic area; may be scaled and animated with city label',licenseUrl:'https://creativecommons.org/licenses/by/4.0/'},null,2));
    return detail;
  })().catch(e=>{throw new Error(`Не удалось загрузить спутниковый снимок: ${e instanceof Error?e.message:String(e)}. Схема вместо него не подставлена.`);}).finally(()=>active.delete(id));
  active.set(id,job);return job;
}
