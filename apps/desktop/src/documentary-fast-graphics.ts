import {documentaryAccent,documentaryRoutePlaces,resolveDocumentaryPlace,searchDocumentaryPlaces,validDocumentaryPlace,
  type DocumentaryMotionGraphic,type DocumentaryPlace,type Project,type Scene} from '@gold-work/shared';
import {documentarySceneSeconds} from './documentary-sequences.js';
import {documentaryRouteKey} from '@gold-work/remotion-video';

export interface FastDocumentaryGraphicPlan {
  kind:'location'|'route'|'mechanical';
  graphic:DocumentaryMotionGraphic;
  /** Native graphic, not a camera-footage candidate: no stock/model review needed. */
  replacesStock:true;
  narration:string;
  reason:string;
}
const words=(text:string)=>text.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const contains=(text:string,label:string)=>` ${words(text)} `.includes(` ${words(label)} `);
const locationIntent=/(?:\b(?:race|racing|tested?|testing|arriv\w*|travel\w*|journey|route|located|location|born|moved?|depart\w*|opening|held|visit\w*)\b|гонк|заезд|испытан|тестир|путешеств|маршрут|прибыл|располож|находится|родил|переех|отправил|проходил|состоял)/iu;
const routeIntent=/\b(?:travel\w*|journey|route|flew|fly|drove|drive|sailed?|moved?|depart\w*)\b|маршрут|путешеств|перел[её]т|переех|проех|отправил|приплыл/iu;
const raceIntent=/\b(?:race|racing|tested?|testing|circuit|track|grand prix|motogp)\b|гонк|заезд|трасс|автодром|испытан|тестир/iu;
const existingMapKinds=new Set(['map-locator','map-route']);
const placeCache=new Map<string,DocumentaryPlace|undefined>();

function writable(project:Project,scene:Scene):boolean {
  const doc=scene.documentary,g=doc?.motionGraphic;
  return Boolean(project.mediaMode==='stock'&&project.settings.assembly.documentary?.version===2
    &&project.settings.assembly.documentary.autoMotionGraphics!==false&&scene.includeInAssembly!==false&&doc
    &&!doc.pinned&&!doc.verified&&!doc.cuts?.length&&!doc.texts?.length&&!doc.caption.enabled
    &&doc.layout!=='compare'&&!doc.comparison&&!(doc.effects??[]).some(e=>e.enabled)
    &&(!doc.template||doc.templateOrigin==='automatic')&&(!g||g.enabled&&g.origin==='automatic'));
}

function resolvePlace(name:string,text:string):DocumentaryPlace|undefined {
  // Sepang is ambiguous (district/town/track); this extra entry is ONLY the
  // explicitly narrated motorsport location, never a guessed city centroid.
  if(/^(?:sepang(?: international circuit)?|сепанг(?:е|а)?)$/iu.test(name)&&raceIntent.test(text))
    return {name,latitude:2.760556,longitude:101.7375,country:'Malaysia',source:'https://www.wikidata.org/wiki/Q172738 (CC0)'};
  if(placeCache.has(name))return placeCache.get(name);
  const exact=resolveDocumentaryPlace(name);
  if(exact){placeCache.set(name,exact);return exact;}
  // The existing catalog has nominative Russian names. Resolve a single,
  // unambiguous inflection; do not choose the first fuzzy search result.
  if(!/^[А-ЯЁа-яё-]{4,}$/u.test(name)){placeCache.set(name,undefined);return;}
  const stem=name.replace(/[аеуы]$/iu,'');
  const matches=searchDocumentaryPlaces(stem).filter(p=>p.aliases.some(alias=>words(alias)===words(stem)
    ||words(alias).replace(/[а-яё]$/u,'')===words(stem)));
  if(matches.length!==1){placeCache.set(name,undefined);return;}
  const place=matches[0]!;
  const resolved={name,latitude:place.latitude,longitude:place.longitude,country:place.country,source:'Natural Earth 1:10m'};
  placeCache.set(name,resolved);return resolved;
}

function narratedPlaces(text:string,route=false):DocumentaryPlace[] {
  const found:Array<{at:number;place:DocumentaryPlace}>=[];
  let unresolved=false;
  // Only names attached to a location/route preposition. A person's surname,
  // nationality or an inherited identity from another scene is not geography.
  for(const match of text.matchAll(/(?<![\p{L}\p{N}])(at|in|to|from|through|via|and|в|во|на|из|от|до|через|к|и)\s+(?=([\p{L}\p{N}-]+(?:\s+[\p{L}\p{N}-]+){0,3}))/giu)){
    if(route&&/^(?:at|in|во|на)$/iu.test(match[1]!))continue;
    const tokens=match[2]!.split(/\s+/u);let resolved=false;
    for(let count=tokens.length;count>0;count--){
      const place=resolvePlace(tokens.slice(0,count).join(' '),text);
      if(place){found.push({at:match.index!,place});resolved=true;break;}
    }
    if(route&&!resolved)unresolved=true;
  }
  if(unresolved)return [];
  const unique=new Set<string>();
  return found.sort((a,b)=>a.at-b.at).flatMap(({place})=>{
    const key=`${place.latitude},${place.longitude}`;
    if(unique.has(key))return [];unique.add(key);return [place];
  });
}

function knownNarratedPlace(place:DocumentaryPlace,text:string):boolean {
  if(!validDocumentaryPlace(place)||!contains(text,place.name))return false;
  const known=resolveDocumentaryPlace(place.name,place.country)??resolvePlace(place.name,text);
  return Boolean(known&&Math.abs(known.latitude-place.latitude)<.001&&Math.abs(known.longitude-place.longitude)<.001);
}

function mechanicalGraphic(text:string):DocumentaryMotionGraphic|undefined {
  let title='',items:string[]=[];
  const crossplane=text.match(/cross[ -]?plane(?:\s+crankshaft)?|кросс?пл[еэ]йн(?:\s+коленвал)?/iu)?.[0];
  const pins=text.match(/crankpins(?:\s+arranged)?|шатунн\p{L}*\s+шейк\p{L}*|шейк\p{L}*/iu)?.[0];
  const angle=text.match(/(?:ninety|90|девяност\p{L}*)\s*(?:degrees|°|градус\p{L}*)/iu)?.[0];
  // Mentioning technology moving from M1 to R1 is history, not an explanation.
  if(crossplane&&pins&&angle&&/arrang|angle|degree|располож|угл|градус/iu.test(text)){
    title=crossplane;items=[pins,angle];
  }else{
    const parts=text.match(/pistons?\s+and\s+connecting rods?|поршн\p{L}*\s+и\s+шатун\p{L}*/iu)?.[0];
    const actions=[/accelerat\w*|ускоря\p{L}*/iu,/\bstop\w*\b|останавлива\p{L}*/iu,/reverse direction|меня\p{L}*\s+направлен\p{L}*/iu]
      .map(pattern=>text.match(pattern)?.[0]).filter((s):s is string=>Boolean(s));
    if(parts&&actions.length>=2){title=parts;items=actions;}
    else{
      const cycle=text.match(/four[ -]stroke(?:\s+cycle)?|четыр[её]хтактн\p{L}*(?:\s+цикл)?/iu)?.[0];
      const strokes=[/\bintake\b|впуск/iu,/\bcompression\b|сжатие/iu,/\b(?:combustion|power stroke)\b|рабочий ход|сгорание/iu,/\bexhaust\b|выпуск/iu]
        .map(pattern=>text.match(pattern)?.[0]).filter((s):s is string=>Boolean(s));
      if(cycle&&strokes.length===4){title=cycle;items=strokes;}
    }
  }
  if(!title||items.length<2)return;
  // Reuse the existing animated list, without an empty explainer media panel
  // or a new physical simulation. Every displayed label is verbatim speech.
  return {kind:'feature-list',enabled:true,title,items,presentation:'list',theme:'paper',variant:'technical',
    origin:'automatic',startSeconds:0,durationSeconds:4};
}

/** Cheap local preflight BEFORE any stock search/download. Never calls a model,
 * geocoder or network. Uses this scene's speech, not topic-wide entity mentions. */
export function fastDocumentaryGraphicPlan(project:Project,scene:Scene):FastDocumentaryGraphicPlan|undefined {
  if(!writable(project,scene))return;
  const text=scene.narration,seconds=documentarySceneSeconds(scene);
  if(!Number.isFinite(seconds)||seconds<2.5||!text.trim())return;
  let graphic:DocumentaryMotionGraphic|undefined,kind:FastDocumentaryGraphicPlan['kind']='location';
  const requested=scene.documentary!.requirement.motionGraphic;
  if(requested?.enabled&&existingMapKinds.has(requested.kind)&&requested.place
    &&knownNarratedPlace(requested.place,text)){
    const route=requested.kind==='map-route'?documentaryRoutePlaces(requested):[];
    if(requested.kind==='map-locator'||routeIntent.test(text)&&route.length>=2&&route.length<=8
      &&route.every(p=>knownNarratedPlace(p,text)))
      graphic={...requested,mapStyle:'full',...(requested.kind==='map-locator'?{cityDetail:false,detail:undefined,detailError:undefined}:{})};
    kind=requested.kind==='map-route'?'route':'location';
  }
  if(!graphic&&locationIntent.test(text)){
    const explicitRoute=routeIntent.test(text)
      &&/\bfrom\b[\s\S]*\bto\b|(?<!\p{L})(?:из|от)\s[\s\S]*(?<!\p{L})(?:в|до|к)\s/iu.test(text);
    const places=narratedPlaces(text,explicitRoute);
    if(places.length>=2&&places.length<=8&&explicitRoute){
      kind='route';graphic={kind:'map-route',enabled:true,title:places.at(-1)!.name,route:places,fromPlace:places[0],place:places.at(-1),
        mapStyle:'full',cameraZoom:1.04,startSeconds:0,durationSeconds:seconds};
    }else if(places.length===1&&!explicitRoute){
      graphic={kind:'map-locator',enabled:true,title:places[0]!.name,place:places[0],mapStyle:'full',cityDetail:false,
        zoom:5,startSeconds:0,durationSeconds:seconds};
    }
  }
  if(!graphic){graphic=mechanicalGraphic(text);kind='mechanical';}
  if(!graphic)return;
  graphic={...graphic,startSeconds:0,durationSeconds:seconds,origin:'automatic',
    accentColor:graphic.accentColor??documentaryAccent(graphic.title),kicker:graphic.kicker??(kind==='mechanical'?'':/[а-яё]/iu.test(text)?'НА КАРТЕ':'LOCATION')};
  return {kind,graphic,replacesStock:true,narration:text,reason:kind==='mechanical'
    ?'Локальная текстовая схема механизма; подписи взяты из реплики.'
    :'Локальная карта названного места с проверенными координатами.'};
}

/** Preparation is free; locator/list are entirely offline. Only explicit routes
 * use the EXISTING bounded EOX request/cache and retain its attribution. */
export async function prepareFastDocumentaryGraphic(directory:string,plan:FastDocumentaryGraphicPlan):Promise<FastDocumentaryGraphicPlan> {
  if(plan.kind!=='route')return plan;
  const {prepareDocumentaryMaps}=await import('./documentary-map.js');
  const scene={includeInAssembly:true,documentary:{motionGraphic:plan.graphic}} as Scene;
  const [prepared]=await prepareDocumentaryMaps(directory,[scene]);
  const graphic=prepared!.documentary!.motionGraphic!;
  if(graphic.detailError||!graphic.detail)throw new Error(graphic.detailError??'Не удалось подготовить карту маршрута');
  return {...plan,graphic};
}

/** Apply to the latest scene after preparation. Preserve speech, audio, media,
 * readiness and authored styling; do not fabricate a pixel/model approval. */
export function applyFastDocumentaryGraphic(project:Project,scene:Scene,plan:FastDocumentaryGraphicPlan):Scene {
  const current=fastDocumentaryGraphicPlan(project,scene);
  if(!current||scene.narration!==plan.narration||JSON.stringify({...current.graphic,detail:undefined,detailError:undefined})
    !==JSON.stringify({...plan.graphic,detail:undefined,detailError:undefined}))return scene;
  if(plan.kind==='route'&&!plan.graphic.detail)return scene;
  return {...scene,documentary:{...scene.documentary!,motionGraphic:plan.graphic}};
}

/** Integration guard for native-graphic readiness. It never approves a saved
 * photo/video or bypasses the single pixel review for a material underneath. */
export function fastDocumentaryGraphicReady(project:Project,scene:Scene):boolean {
  const doc=scene.documentary,graphic=doc?.motionGraphic;
  if(!doc||!graphic?.enabled||doc.selected||scene.videoPath||scene.imagePath)return false;
  const plan=fastDocumentaryGraphicPlan(project,{...scene,documentary:{...doc,verified:false}});
  if(!plan)return false;
  const expected=plan.graphic;
  // Compare actual content/coordinates/timing; incidental serialization order
  // and later harmless typography defaults do not invalidate the local plan.
  if(graphic.kind!==expected.kind||graphic.title!==expected.title||graphic.origin!=='automatic'
    ||graphic.startSeconds!==0||Math.abs(graphic.durationSeconds-expected.durationSeconds)>1/30
    ||graphic.mapStyle!==expected.mapStyle||graphic.cityDetail!==expected.cityDetail
    ||JSON.stringify(graphic.items)!==JSON.stringify(expected.items)||graphic.presentation!==expected.presentation
    ||JSON.stringify(graphic.place)!==JSON.stringify(expected.place)
    ||JSON.stringify(documentaryRoutePlaces(graphic))!==JSON.stringify(documentaryRoutePlaces(expected)))return false;
  return plan.kind!=='route'||Boolean(graphic.detail?.kind==='satellite'&&graphic.detail.imagePath
    &&graphic.detail.bounds?.length===4&&graphic.detail.bounds.every(Number.isFinite)
    &&graphic.detail.routeKey===documentaryRouteKey(documentaryRoutePlaces(graphic)));
}
