import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {resolveDocumentaryPlace,searchDocumentaryPlaces,routeComparisonPhysicalPlaces,type DocumentaryRouteComparison,type Project,type Scene} from '@gold-work/shared';
import {documentaryRouteComparisonGeometry,DocumentaryRouteGeometryError} from '@gold-work/remotion-video';
import {documentaryCheckpointKey} from './documentary-checkpoint-key.js';

export const routeComparisonSystem=`Return JSON only: {comparisonQuotes:[exact complete script quotations supporting the route comparison],routes:[{label:exact short script phrase,quote:exact supporting script quotation,stops:[{name:place name literally mentioned in full script,country?:country for ambiguous cities,quote:exact quotation naming it}],points:[{stop:0},{bend:[longitude,latitude]},...,{stop:last}]}]}. Exactly TWO alternative SEA routes with SAME start/end and different intermediate named places. Use 3–8 named stops per route. Named coordinates are resolved locally; do not provide coordinates for places. Put each named stop in the line in its order. Bends are explicitly illustrative unlabeled geometry, not new places. Shape lines around continents and through the appropriate named canal, never across continental interiors. At most 32 line points per route. Use full script context for pronouns and places, not just the current sentence. A route label may copy a phrase such as southern end of Africa; never invent a quotation, distance, historical track, date or location. Use country when a city name is ambiguous. If the script cannot support both routes, return {refusal:reason}. This is an explanatory schematic, NOT navigation or archival footage.`;
const normalized=(s:string)=>s.normalize('NFKC').replace(/\s+/g,' ').trim().toLocaleLowerCase();
export const routeComparisonContext=(project:Project)=>project.videoBrief?.readyScript?.trim()||[...project.scenes].sort((a,b)=>a.order-b.order).map(s=>s.narration).join('\n');
/** A later voyage may mention real ports without supporting this comparison.
 * Keep quotations in the current original paragraph and its immediate context;
 * the full script remains available for reading, not as a bag of interchangeable facts. */
export function routeComparisonEvidenceContext(project:Project,scene:Scene):string{
  const context=routeComparisonContext(project),narration=scene.narration.trim();
  const start=context.indexOf(narration);
  if(!narration||start<0)throw new DocumentaryRouteComparisonValidationError('Реплика схемы не найдена в исходном сценарии.');
  if(context.indexOf(narration,start+1)>=0)throw new DocumentaryRouteComparisonValidationError('Реплика схемы повторяется в разных местах сценария. Однозначный источник географических данных не установлен; схема не создана.');
  if(!/\r?\n\s*\r?\n/.test(context)){
    const ordered=[...project.scenes].sort((a,b)=>a.order-b.order),index=ordered.findIndex(item=>item.id===scene.id);
    if(index<0)throw new DocumentaryRouteComparisonValidationError('Сцена схемы не найдена в последовательности исходного сценария.');
    const adjacent=ordered.slice(Math.max(0,index-2),index+3).map(item=>item.narration.trim());
    const positions=adjacent.map(text=>({text,start:context.indexOf(text)}));
    if(positions.some((item,i)=>!item.text||item.start<0||context.indexOf(item.text,item.start+1)>=0
      ||i>0&&item.start<positions[i-1]!.start+positions[i-1]!.text.length))
      throw new DocumentaryRouteComparisonValidationError('Не удалось однозначно сопоставить ближайшие сцены исходному сценарию. Схема не создана.');
    return context.slice(positions[0]!.start,positions.at(-1)!.start+positions.at(-1)!.text.length);
  }
  const boundaries=[0,...[...context.matchAll(/\r?\n\s*\r?\n/g)].map(match=>match.index!+match[0].length),context.length];
  const first=boundaries.findIndex((boundary,index)=>boundary<=start&&boundaries[index+1]!>start);
  const end=start+narration.length;
  let last=first;
  while(last+1<boundaries.length-1&&boundaries[last+1]!<end)last++;
  return context.slice(boundaries[Math.max(0,first-1)],boundaries[Math.min(boundaries.length-1,last+2)]);
}
export const routeComparisonContextHash=(project:Project)=>createHash('sha256').update(JSON.stringify([routeComparisonContext(project),project.scenes.map(s=>[s.id,s.narration])])).digest('hex');
export const routeComparisonTarget=(scene:Scene)=>scene.documentary?.requirement.aiSearchPlan?.visualTarget??scene.documentary?.requirement.detail??'';
export const routeComparisonRequestBinding=(project:Project,scene:Scene)=>createHash('sha256')
  .update(JSON.stringify([routeComparisonContextHash(project),scene.id,routeComparisonTarget(scene)])).digest('hex');
export function routeComparisonAvailablePlaces(project:Project,scene?:Scene){
  const context=scene?routeComparisonEvidenceContext(project,scene):routeComparisonContext(project),names=[...new Set(context.match(/\b[A-Z][a-z]{2,}\b/g)??[])];
  const features=routeComparisonPhysicalPlaces.filter(p=>normalized(context).includes(normalized(p.name))).map(p=>({name:p.name,country:undefined as string|undefined}));
  const cities=names.flatMap(name=>searchDocumentaryPlaces(name).filter(p=>normalized(p.name)===normalized(name)).map(p=>({name:p.name,country:p.country})));
  return [...new Map([...features,...cities].map(p=>[p.name+':'+p.country,p])).values()].slice(0,60);
}
export function needsRouteComparison(scene:Scene){
  const target=routeComparisonTarget(scene);
  if(/\b(?:routes?|passages?)\b|маршрут/iu.test(target)&&/\b(?:compar\w*|versus|against|vs\.?|longer.+shorter)\b|сравнен|против/iu.test(target))return true;
  if(!/\b(?:maps?|diagrams?)\b|карт|схем/iu.test(target))return false;
  const alternatives=target.split(/\b(?:versus|against|vs)\b\.?|против/iu);
  return alternatives.length===2&&alternatives.every(part=>/\b(?:via|around|through|bypassing)\s+\p{L}|(?:через|в обход)\s+\p{L}/iu.test(part));
}
export function assertRouteComparisonIdentity(before:any,after:any){
  const identity=(v:any)=>({comparisonQuotes:v?.comparisonQuotes,routes:v?.routes?.map((r:any)=>({label:r.label,quote:r.quote,stops:r.stops?.map((p:any)=>({name:p.name,country:p.country,quote:p.quote}))}))});
  if(JSON.stringify(identity(before))!==JSON.stringify(identity(after)))throw Error('Коррекция изменила именованные опоры, подписи или цитаты; ответ не принят.');
}
export class DocumentaryRouteComparisonValidationError extends Error {}
export function correctableRouteComparisonError(error:unknown):error is Error{
  return error instanceof DocumentaryRouteComparisonValidationError||(error instanceof DocumentaryRouteGeometryError&&error.correctable);
}
const exactQuote=(value:unknown,context:string,limit=1600):value is string=>typeof value==='string'&&!!value.trim()&&value.length<=limit&&context.includes(value);
const namedQuote=(value:unknown,name:unknown,context:string)=>exactQuote(value,context)&&typeof name==='string'&&!!name.trim()&&normalized(value).includes(normalized(name));
export function assertRouteComparisonCorrection(project:Project,scene:Scene,before:any,after:any){
  const context=routeComparisonEvidenceContext(project,scene);
  // A rejected citation may be repaired, but it cannot authorize a different route,
  // another voyage's stops, or rewriting evidence that already passed validation.
  const identity=(v:any)=>({comparisonQuotes:v?.comparisonQuotes?.map((q:any,i:number)=>exactQuote(before?.comparisonQuotes?.[i],context)?q:null),routes:v?.routes?.map((r:any,i:number)=>{
    const prior=before?.routes?.[i];
    const validLabelEvidence=exactQuote(prior?.label,context,60)&&exactQuote(prior?.quote,context)&&prior.quote.includes(prior.label);
    return {label:validLabelEvidence?r.label:null,
      quote:validLabelEvidence?r.quote:null,
      stops:r.stops?.map((p:any,j:number)=>({name:p.name,country:p.country,quote:namedQuote(prior?.stops?.[j]?.quote,prior?.stops?.[j]?.name,context)?p.quote:null}))};
  })});
  if(!isDeepStrictEqual(identity(before),identity(after)))throw Error('Коррекция изменила именованные опоры, подписи или цитаты; ответ не принят.');
}
function knownPlace(name:string,country?:string,context=''){
  const unique=resolveDocumentaryPlace(name),native=resolveDocumentaryPlace(name,country);
  if(native){
    if(!unique){
      const aliases:Record<string,string[]>={'United Kingdom':['Britain','British','England'],'China':['China','Chinese']};
      if(!country||![country,...aliases[country]??[]].some(v=>normalized(context).includes(normalized(v))))throw Error(`Страна неоднозначного места ${name} не обоснована сценарием.`);
    }
    return {...native,sourceUrl:'https://www.naturalearthdata.com/'};
  }
  const matches=routeComparisonPhysicalPlaces.filter(p=>normalized(p.name)===normalized(name));
  if(matches.length!==1)throw Error(`Неизвестные или неоднозначные координаты: ${name}. Схема не создана.`);
  return {...matches[0]!};
}
function quote(value:unknown,context:string,limit=1600){
  if(!exactQuote(value,context,limit))throw new DocumentaryRouteComparisonValidationError('Основание схемы не является точной цитатой относящегося к этой сцене фрагмента исходного сценария. Места из другого эпизода не подтверждают этот маршрут.');
  return value;
}
export function validateRouteComparison(project:Project,scene:Scene,raw:any,model:string):DocumentaryRouteComparison{
  if(!raw||raw.refusal)throw Error(raw?.refusal||'Нет подтверждённого плана сравнения маршрутов.');
  const context=routeComparisonEvidenceContext(project,scene);
  if(!Array.isArray(raw.comparisonQuotes)||!raw.comparisonQuotes.length||raw.comparisonQuotes.length>4)throw Error('Нет оснований сравнения двух маршрутов.');
  const comparisonQuotes=raw.comparisonQuotes.map((v:unknown)=>quote(v,context));
  if(!Array.isArray(raw.routes)||raw.routes.length!==2)throw Error('Сравнению нужны два маршрута.');
  const routes=raw.routes.map((r:any)=>{
    const label=quote(r.label,context,60),evidence=quote(r.quote,context);
    if(!evidence.includes(label))throw new DocumentaryRouteComparisonValidationError('Подпись маршрута не связана с его цитатой.');
    if(!Array.isArray(r.stops)||r.stops.length<3||r.stops.length>8)throw Error('Нужны 3–8 обоснованных географических точек на маршрут.');
    const places=r.stops.map((p:any)=>{
      const evidence=quote(p.quote,context);
      if(typeof p.name!=='string'||!p.name.trim()||p.name.length>100||!normalized(evidence).includes(normalized(p.name)))throw new DocumentaryRouteComparisonValidationError(`Место ${String(p.name).slice(0,100)} не названо в цитате сценария.`);
      return {...knownPlace(p.name,p.country,context),quote:evidence};
    });
    if(!Array.isArray(r.points)||r.points.length>32)throw new DocumentaryRouteComparisonValidationError('Некорректная геометрия схемы.');
    let nextStop=0;
    const points=r.points.map((p:any)=>{
      if(Number.isInteger(p?.stop)){
        if(p.stop!==nextStop||!places[nextStop])throw new DocumentaryRouteComparisonValidationError('Географические точки переставлены или повторены.');
        const place=places[nextStop++];return {latitude:place.latitude,longitude:place.longitude};
      }
      if(!Array.isArray(p?.bend)||p.bend.length!==2||!p.bend.every((v:unknown)=>typeof v==='number'&&Number.isFinite(v)))throw new DocumentaryRouteComparisonValidationError('Неизвестные координаты изгиба схемы.');
      return {latitude:p.bend[1],longitude:p.bend[0]};
    });
    if(nextStop!==places.length||r.points[0]?.stop!==0||r.points.at(-1)?.stop!==places.length-1)throw new DocumentaryRouteComparisonValidationError('Схема пропустила начало, конец или промежуточную точку.');
    return {label,quote:evidence,places,points};
  });
  const requiredFeatures=routeComparisonPhysicalPlaces.filter(p=>normalized(routeComparisonTarget(scene)).includes(normalized(p.name)));
  for(const feature of requiredFeatures)if(!routes.some((r:any)=>r.places.slice(1,-1).some((p:any)=>normalized(p.name)===normalized(feature.name))))throw Error(`Схема не показывает требуемый ориентир ${feature.name}.`);
  const value:DocumentaryRouteComparison={version:1,origin:'generated-route-schematic',contextHash:routeComparisonContextHash(project),sceneNarration:scene.narration,visualTarget:routeComparisonTarget(scene),title:scene.narration.replace(/\s+/g,' ').trim().slice(0,100),comparisonQuotes,model,routes,
    disclaimer:project.language==='ru'?'Условная схема направлений · не навигационный маршрут · без масштаба':'Schematic directions · not a navigational track · not to scale'};
  documentaryRouteComparisonGeometry(value);return value;
}
export function savedRouteComparisonIssue(project:Project,scene:Scene):string|undefined{
  const value=scene.documentary?.motionGraphic?.routeComparison;if(!value)return;
  try{
    if((scene.documentary?.motionGraphic?.mapStyle??'full')!=='full')throw Error('Сравнение маршрутов должно оставаться полноэкранной графикой.');
    if(value.version!==1||value.origin!=='generated-route-schematic'||value.contextHash!==routeComparisonContextHash(project)||value.sceneNarration!==scene.narration||value.visualTarget!==routeComparisonTarget(scene))throw Error('Сценарий или target схемы изменился.');
    const raw={comparisonQuotes:value.comparisonQuotes,routes:value.routes.map(r=>({label:r.label,quote:r.quote,stops:r.places.map(p=>({name:p.name,country:p.country,quote:p.quote})),points:r.points.map(p=>{
      const at=r.places.findIndex(v=>v.latitude===p.latitude&&v.longitude===p.longitude);return at>=0?{stop:at}:{bend:[p.longitude,p.latitude]};
    })}))};
    const checked=validateRouteComparison(project,scene,raw,value.model);
    if(value.selectionFailure)checked.selectionFailure=value.selectionFailure;
    if(JSON.stringify(checked)!==JSON.stringify(value))throw Error('Сохранённая геометрия или основания схемы изменены.');
  }catch(e){return e instanceof Error?e.message:String(e);}
}

export async function hasCompletedRouteComparison(root:string,project:Project,scene:Scene):Promise<boolean>{
  const value=scene.documentary?.motionGraphic?.routeComparison;
  if(!value)return false;
  const documentary=join(root,'Documentary'),directory=join(documentary,'RouteComparisons');
  const binding=routeComparisonRequestBinding(project,scene),purpose='semantic-montage';
  const readJson=async(path:string)=>JSON.parse(await readFile(path,'utf8'));
  const readResponse=async(phase:'primary'|'correction',original?:Record<string,unknown>)=>{
    const request=await readJson(join(directory,`${binding}-${phase}-request.json`));
    if(request.binding!==binding||typeof request.system!=='string'||typeof request.input!=='string')return;
    const input=JSON.parse(request.input);
    if(input.routeComparison!==1||input.sceneId!==scene.id||input.target!==routeComparisonTarget(scene)
      ||input.script!==routeComparisonContext(project))return;
    if(original){
      const rawHash=createHash('sha256').update(JSON.stringify(original)).digest('hex');
      if(input.routeComparisonCorrection!==1||request.rawHash!==rawHash||!isDeepStrictEqual(input.original,original))return;
    }else if(input.routeComparisonCorrection!==undefined||input.narration!==scene.narration||request.rawHash!==undefined)return;
    const key=documentaryCheckpointKey(purpose,request.system,request.input,[]);
    const receipt=await readJson(join(documentary,'Analysis',key+'.json'));
    if(receipt.state!=='complete'||receipt.purpose!==purpose||typeof receipt.model!=='string'||!receipt.model
      ||!receipt.result||typeof receipt.result!=='object')return;
    return {model:receipt.model,result:receipt.result as Record<string,unknown>};
  };
  try{
    const key=createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const saved=await readJson(join(directory,key+'.json'));
    if(saved.version!==1||saved.origin!=='generated-route-schematic'||saved.sceneId!==scene.id||!isDeepStrictEqual(saved.comparison,value))return false;
    const primary=await readResponse('primary');
    if(!primary)return false;
    const {selectionFailure,...expected}=value;
    try{
      return isDeepStrictEqual(validateRouteComparison(project,scene,primary.result,primary.model),expected);
    }catch(error){
      if(!correctableRouteComparisonError(error))return false;
      const correction=await readResponse('correction',primary.result);
      if(!correction)return false;
      assertRouteComparisonCorrection(project,scene,primary.result,correction.result);
      return isDeepStrictEqual(validateRouteComparison(project,scene,correction.result,correction.model),expected);
    }
  }catch{return false;}
}

export function routeComparisonReviewNote(value:DocumentaryRouteComparison):string{
  const failure=value.selectionFailure;
  return 'Созданная условная схема двух маршрутов; не архивный материал и не видеофутаж. '
    +(failure?`Исходный результат подбора (${failure.category}): ${failure.message}. `:'')
    +'Основания: '+value.comparisonQuotes.join(' | ');
}

export function attachRouteComparison(project:Project,scene:Scene,value:DocumentaryRouteComparison):Scene{
  const doc=scene.documentary!;
  return {...scene,status:'ready',imagePath:undefined,videoPath:undefined,sourceVolume:0,documentary:{...doc,selected:undefined,checksum:undefined,visualHash:undefined,visualReview:undefined,manualReview:undefined,autoError:undefined,
    verified:true,illustrative:true,illustrationLabelInEditorOnly:true,template:'full',templateOrigin:'automatic',layout:'full',
    motionGraphic:{kind:'map-route',enabled:true,title:value.title,origin:'automatic',mapStyle:'full',startSeconds:0,durationSeconds:Math.max(doc.timing?.durationInFrames??Math.ceil(scene.durationSeconds*30),Math.ceil((scene.durationOverrideSeconds??0)*30))/30,routeComparison:value},
    reviewNote:routeComparisonReviewNote(value)}};
}
