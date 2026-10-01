import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir,mkdtemp,readFile,stat,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {bundle} from '@remotion/bundler';
import {openBrowser,renderStill,selectComposition} from '@remotion/renderer';
import {validDocumentaryPlace,documentaryRoutePlaces,type DocumentaryMapDetail,type DocumentaryPlace,type Scene} from '@gold-work/shared';
import {atomicWrite} from './fs-utils.js';
import {prepareSatelliteMap} from './documentary-satellite-map.js';
export {prepareSatelliteMap as prepareDocumentaryMap} from './documentary-satellite-map.js';

type Coordinate={lat:number;lon:number};
type Element={type:string;id:number;lat?:number;lon?:number;tags?:Record<string,string>;geometry?:Array<Coordinate|null>};
const isCoordinate=(p:Coordinate|null|undefined):p is Coordinate=>Boolean(p&&Number.isFinite(p.lat)&&Number.isFinite(p.lon));
const xml=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
const inFlight=new Map<string,Promise<DocumentaryMapDetail>>();
// One bounded vector query for an explicitly selected city. Never scrape map tiles.
let requests:Promise<unknown>=Promise.resolve();
async function rasterizeCityMap(svg:string,output:string,root:string){
  const temporary=await mkdtemp(join(root,'raster-'));
  let browser:Awaited<ReturnType<typeof openBrowser>>|undefined;
  try{
    const resolved=createRequire(import.meta.url).resolve('@gold-work/remotion-video/entry'),unpacked=resolved.replace('app.asar','app.asar.unpacked');
    const serveUrl=await bundle({entryPoint:existsSync(unpacked)?unpacked:resolved,publicDir:null,outDir:temporary,enableCaching:true});
    browser=await openBrowser('chrome');
    const inputProps={source:'data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64')};
    const composition=await selectComposition({serveUrl,id:'GoldWorkMapRaster',inputProps,puppeteerInstance:browser});
    const rendered=join(temporary,'map.png');
    await renderStill({serveUrl,composition,inputProps,output:rendered,frame:0,puppeteerInstance:browser});
    await atomicWrite(output,await readFile(rendered));
  }finally{
    await browser?.close({silent:true});
    // Only this mkdtemp render bundle; cached source data and map images stay.
    await rm(temporary,{recursive:true,force:true});
  }
}
export function drawDocumentaryCity(elements:Element[],place:DocumentaryPlace,radiusKm:number){
  const dy=radiusKm/111.32,dx=dy/Math.max(.12,Math.cos(place.latitude*Math.PI/180));
  const point=(p:{lat:number;lon:number})=>({x:((p.lon-place.longitude)/dx+1)*1200,y:(1-(p.lat-place.latitude)/dy)*1200});
  // Overpass clips long ways with null gaps. Never join roads across those gaps.
  const path=(g:Array<Coordinate|null>)=>{
    let connected=false;const parts:string[]=[];
    for(const p of g){if(!isCoordinate(p)){connected=false;continue;}const q=point(p);parts.push(`${connected?'L':'M'}${q.x.toFixed(1)} ${q.y.toFixed(1)}`);connected=true;}
    return parts.join('');
  };
  const areas:string[]=[],buildings:string[]=[],roads:string[]=[],labels:string[]=[],water:string[]=[],rails:string[]=[];
  const occupied:Array<{x:number;y:number;w:number;h:number}>=[],roadNames=new Set<string>();
  const addLabel=(text:string,x:number,y:number,landmark=false)=>{
    const size=landmark?25:23,w=Math.min(55,text.length)*size*.54+20,h=40;
    if(x<150||x>2250||y<150||y>2250||occupied.some(r=>Math.abs(x-r.x)<(w+r.w)/2&&Math.abs(y-r.y)<(h+r.h)/2))return;
    occupied.push({x,y,w,h});
    labels.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" fill="${landmark?'#b8d3de':'#e2e7eb'}" stroke="#142434" stroke-width="5" paint-order="stroke" font-size="${size}">${xml(text.slice(0,55))}</text>`);
  };
  for(const e of elements.slice(0,35000)){
    const t=e.tags??{},g=e.geometry;
    if(g&&g.length>1){
      const d=path(g);if(!d)continue;
      const closed=g.every(isCoordinate);
      if(t.building) {if(closed)buildings.push(`<path d="${d}Z" fill="#526376" stroke="#728398" stroke-width=".8"/>`);}
      else if(t.natural==='water'||t.waterway){water.push(`<path d="${d}${t.natural==='water'&&closed?'Z':''}" fill="${t.natural==='water'&&closed?'#164d70':'none'}" stroke="#347da6" stroke-width="${t.waterway==='river'?15:4}"/>`);}
      else if(t.leisure==='park'||t.landuse==='grass'||t.landuse==='forest') {if(closed)areas.push(`<path d="${d}Z" fill="#294a41" stroke="#456454" stroke-width="1"/>`);}
      else if(t.railway) rails.push(`<path d="${d}" fill="none" stroke="#8c9194" stroke-width="2" stroke-dasharray="8 5"/>`);
      else if(t.highway){
        const major=/^(motorway|trunk|primary|secondary|tertiary)/.test(t.highway),minor=/footway|path|steps|cycleway/.test(t.highway);
        const width=major?9:minor?2:5,color=major?'#e8c585':minor?'#7d8a94':'#a8b0b9';
        roads.push(`<path d="${d}" fill="none" stroke="#192b3d" stroke-width="${width+3}"/><path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`);
        if(t.name&&!minor&&!roadNames.has(t.name)){
          const valid=g.filter(isCoordinate);if(!valid.length)continue;
          const middle=point(valid[Math.floor(valid.length/2)]!);
          addLabel(t.name,middle.x,middle.y);roadNames.add(t.name);
        }
      }
    } else if(e.type==='node'&&e.lat!==undefined&&e.lon!==undefined&&t.name&&(t.place||t.tourism==='museum'||t.railway==='station')){
      const q=point({lat:e.lat,lon:e.lon});
      addLabel(t.name,q.x,q.y,true);
    }
  }
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="2400" viewBox="0 0 2400 2400"><rect width="2400" height="2400" fill="#203142"/><g>${areas.join('')}${water.join('')}${buildings.join('')}${rails.join('')}${roads.join('')}</g><g font-family="Arial,sans-serif">${labels.slice(0,130).join('')}</g></svg>`;
  return {svg,counts:{buildings:buildings.length,roads:roads.length,water:water.length,labels:Math.min(labels.length,130)},bounds:{south:place.latitude-dy,west:place.longitude-dx,north:place.latitude+dy,east:place.longitude+dx}};
}
export function prepareDocumentaryStreetMap(directory:string,place:DocumentaryPlace,radiusKm=1.25,rasterize=rasterizeCityMap):Promise<DocumentaryMapDetail>{
  if(!validDocumentaryPlace(place))return Promise.reject(new Error('Выберите реальные координаты места'));
  radiusKm=Math.max(.5,Math.min(3,Number.isFinite(radiusKm)?radiusKm:1.25));
  const key=createHash('sha256').update(JSON.stringify([1,place.latitude.toFixed(5),place.longitude.toFixed(5),radiusKm])).digest('hex');
  const id=directory+key,active=inFlight.get(id);if(active)return active;
  const job=(async()=>{
    const root=join(directory,'Documentary','Maps');await mkdir(root,{recursive:true});
    const metadata=join(root,key+'.json'),imagePath=join(root,key+'.png'),svgPath=join(root,key+'.svg'),rawPath=join(root,key+'.osm.json');
    const saved=await readFile(metadata,'utf8').then(t=>JSON.parse(t) as DocumentaryMapDetail,()=>undefined);
    if(saved&&(saved as DocumentaryMapDetail&{styleVersion?:number}).styleVersion===3&&await stat(imagePath).then(s=>s.size>0,()=>false))return {...saved,imagePath};
    const run=async()=>{
      const {bounds}=drawDocumentaryCity([],place,radiusKm);
      const bbox=[bounds.south,bounds.west,bounds.north,bounds.east].map(n=>n.toFixed(6)).join(',');
      const query=`[out:json][timeout:25][maxsize:33554432];(way[highway](${bbox});way[building](${bbox});way[natural=water](${bbox});way[waterway](${bbox});way[leisure=park](${bbox});way[landuse~"forest|grass"](${bbox});way[railway=rail](${bbox});node[place~"suburb|neighbourhood"](${bbox});node[tourism=museum](${bbox});node[railway=station](${bbox}););out geom(${bbox});`;
      let raw=await readFile(rawPath).catch(()=>undefined);
      if(!raw){
      const response=await fetch('https://overpass-api.de/api/interpreter',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'GoldWorkStudio/0.2 (private local documentary map; cached vector extracts)'},body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(45000)});
      if(!response.ok)throw new Error(`Подробная карта: Overpass ${response.status}. Сохранённые материалы не изменены; попробуйте загрузить карту позже.`);
      const reader=response.body?.getReader();if(!reader)throw new Error('Пустой ответ картографического сервиса');
      let bytes=0;const chunks:Uint8Array[]=[];
      for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>20*1024*1024){await reader.cancel();throw new Error('Слишком много картографических данных. Уменьшите область карты.');}chunks.push(part.value);}
      raw=Buffer.concat(chunks);
      }
      const data=JSON.parse(raw.toString('utf8')) as {elements:Element[];remark?:string};
      if(data.remark||!data.elements?.length)throw new Error('Нет полных данных для подробной карты этого места. Обзорная карта сохранена.');
      // Retain the completed request even if local SVG generation is interrupted.
      await atomicWrite(rawPath,raw.toString('utf8'));
      const {svg,counts}=drawDocumentaryCity(data.elements,place,radiusKm);
      if(counts.roads<3)throw new Error('В этой области недостаточно данных улиц; выберите другой центр карты.');
      const detail:DocumentaryMapDetail={imagePath,latitude:place.latitude,longitude:place.longitude,radiusKm,featureCount:data.elements.length,createdAt:new Date().toISOString()};
      await atomicWrite(svgPath,svg);
      // Draw thousands of vectors once, not on every frame of a six-second zoom.
      await rasterize(svg,imagePath,root);
      await atomicWrite(metadata,JSON.stringify({...detail,styleVersion:3,counts,bounds,source:'https://overpass-api.de/api/interpreter',license:'ODbL 1.0',attribution:'© OpenStreetMap contributors — openstreetmap.org/copyright'},null,2));
      return detail;
    };
    const pending=requests.then(run,run);requests=pending.catch(()=>{});return pending;
  })().finally(()=>inFlight.delete(id));inFlight.set(id,job);return job;
}
export async function prepareDocumentaryMaps(directory:string,scenes:Scene[]):Promise<Scene[]>{
  const result:Scene[]=[];
  for(const scene of scenes){const doc=scene.documentary,g=doc?.motionGraphic;
    if(scene.includeInAssembly===false||!doc||!g?.enabled||!g.kind.startsWith('map-')||g.kind==='map-locator'&&g.cityDetail===false||!g.place){result.push(scene);continue;}
    try{const detail=await prepareSatelliteMap(directory,g.place,g.mapRadiusKm??35,g.kind==='map-route'?documentaryRoutePlaces(g):undefined);result.push({...scene,documentary:{...doc,motionGraphic:{...g,detail,detailError:undefined}}});}
    catch(e){result.push({...scene,documentary:{...doc,motionGraphic:{...g,detailError:e instanceof Error?e.message:String(e)}}});}
  }return result;
}
