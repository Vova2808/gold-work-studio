import { documentaryPlaces } from './documentary-places-data.js';
import type {DocumentaryMotionPresetId} from './documentary-motion-presets.js';

// Named venues missing from populated places retain their primary source.
const documentaryPlaceCatalog=[...documentaryPlaces,{
  id:'sepang-international-circuit',name:'Sepang International Circuit',country:'Malaysia',countryCode:'MY',
  aliases:['Sepang','Sepang International Circuit','PETRONAS Sepang International Circuit','Сепанг'],
  latitude:2.76101,longitude:101.7369094,source:'https://www.sepangcircuit.com/contact-details',
}];

export const documentaryMotionKinds = [
  ['map-locator', 'Карта · приближение к месту'], ['map-route', 'Карта · маршрут'],
  ['chapter-number', 'Глава · номер и заголовок'], ['chronology', 'История · шкала лет'],
  ['statistic', 'Число · счётчик и материал'], ['feature-list', 'Список · активный пункт'],
  ['callout', 'Деталь · линия и подпись'], ['quote', 'Цитата · выделение текста'],
  ['key-point', 'Акцент · кинетическая фраза'],
  ['explainer', 'Разбор · карточки и связи'], ['annotations', 'Детали · выноски на материале'],
  ['subject-card', 'Герой или объект · представление'], ['bar-chart', 'Числа · сравнительная диаграмма'],
] as const;
export type DocumentaryMotionKind = typeof documentaryMotionKinds[number][0];
export interface DocumentaryPlace { name: string; latitude: number; longitude: number; country?: string; source?: string }
export interface DocumentaryMapDetail {imagePath:string;latitude:number;longitude:number;radiusKm:number;featureCount:number;createdAt:string;kind?:'satellite';attribution?:string;imageryDate?:string;sourceUrl?:string;license?:string;bounds?:[number,number,number,number];routeKey?:string}
export interface DocumentaryAnnotation {
  label:string;
  /** Confidence in the observed position, not in the source's overall match. */
  confidence?:number;
  points:Array<{seconds:number;x:number;y:number}>;
}
/** A literal argument carried across adjacent shots. It reuses each shot's
 * selected material; it does not identify or search for additional footage. */
export interface DocumentaryArgument {
  stage: 0 | 1 | 2;
  groups: [{title:string;items:string[];summary:string},{title:string;items:string[];summary:string}];
  /** Editorial cue estimates in this scene, not measured speech alignment. */
  itemFrames: number[];
}
/** A partition of a literal ratio. The first one or two groups sum to the
 * numerator; the last group is its complement to the denominator. Amounts
 * remain explicit even when a remainder follows by subtraction. */
export interface DocumentaryRatioGroup {amount:number;label:string;sourceQuote:string}
export function documentaryRatioGroupsMatch(groups:unknown,amount:number,total:number):groups is DocumentaryRatioGroup[]{
  if(!Array.isArray(groups)||groups.length<2||groups.length>3||!Number.isInteger(amount)||!Number.isInteger(total)
    ||total<2||total>60||amount<0||amount>total)return false;
  return groups.every(g=>g&&Number.isInteger(g.amount)&&g.amount>=0&&g.amount<=total
    &&typeof g.label==='string'&&g.label.trim().length>0&&g.label.length<=70
    &&typeof g.sourceQuote==='string'&&g.sourceQuote.trim().length>0&&g.sourceQuote.length<=400)
    &&groups.reduce((sum,g)=>sum+g.amount,0)===total
    &&groups.slice(0,-1).reduce((sum,g)=>sum+g.amount,0)===amount;
}
export interface DocumentaryMotionGraphic {
  routeComparison?: import('./documentary-route-comparison.js').DocumentaryRouteComparison;
  explanation?: import('./documentary-explanation.js').DocumentaryExplanation;
  artwork?: import('./documentary-artwork.js').DocumentaryArtwork;
  /** Explicit standalone continuity; timing is derived from the current scenes. */
  artworkSpan?: {endSceneId:string};
  /** Literal data drawn as a diagram, never inferred from the source image. */
  diagram?: {kind:'ratio'|'duration'|'time-gap'|'measure'|'engine'|'period';amount:number;total?:number;unit?:string;fromYear?:number;toYear?:number;object?:'car';label:string;groups?:DocumentaryRatioGroup[]};
  /** Optional semantic direction; grounded locally before entering diagram.groups. */
  ratioGroups?: DocumentaryRatioGroup[];
  argument?: DocumentaryArgument;
  /** A photograph mentioned by the narration becomes a large held print. */
  photoMoment?: {captureFrame:number;consequence?:string;consequenceFrame?:number};
  kind: DocumentaryMotionKind;
  enabled: boolean;
  title: string;
  kicker?: string;
  value?: string;
  /** A text-only quantity avoids presenting an unverified source as its evidence. */
  showSource?: boolean;
  hideTitle?: boolean;
  items?: string[];
  activeIndex?: number;
  theme?: 'dark' | 'paper';
  background?: 'grid-light' | 'grid-dark' | 'diagonal' | 'contours' | 'spotlight';
  /** date is chronology; magnifier uses the existing grounded annotation targets. */
  variant?: 'clean' | 'collage' | 'marker' | 'technical' | 'poster' | 'date' | 'magnifier';
  /** Optional staged composition; absent values keep the original renderer. */
  preset?: DocumentaryMotionPresetId;
  highlight?: string;
  /** Speech mode accumulates the highlight at measured word times. */
  quoteMode?: 'speech' | 'phrase';
  reading?: {text:string;sourceKey?:string;words:Array<{text:string;startSeconds:number;endSeconds:number}>};
  readingError?:string;
  accentColor?:string;
  /** Optional local segmentation, original image always retained. */
  isolateSubject?: boolean;
  cutoutPath?: string;
  /** Adjacent automatic list shots share one composition; timing is rebuilt after edits. */
  sequenceId?: string;
  presentation?: 'list' | 'panels';
  /** Verified scene posters frame the currently playing material. */
  panels?: Array<{sceneId:string;label:string}>;
  boardLayout?: 'parts' | 'steps' | 'compare';
  cards?: Array<{label:string;value?:string;sceneId?:string}>;
  /** Positions are relative to the uncropped source; seconds to this graphic. */
  annotations?: DocumentaryAnnotation[];
  sourceChecksum?: string;
  sourceTrimStartSeconds?: number;
  sourcePlaybackRate?: number;
  place?: DocumentaryPlace;
  fromPlace?: DocumentaryPlace;
  /** Ordered verified places; legacy two-place routes remain readable. */
  route?: DocumentaryPlace[];
  /** Local scene seconds. Motion never extends or retimes narration. */
  startSeconds: number;
  durationSeconds: number;
  anchorX?: number;
  anchorY?: number;
  zoom?: number;
  mapRadiusKm?: number;
  cameraZoom?: number;
  /** Geographic surroundings, never presented as administrative borders. */
  regionRadiusKm?: number;
  mapStyle?: 'full' | 'inset';
  cityDetail?: boolean;
  detail?: DocumentaryMapDetail;
  detailError?: string;
  origin?: 'automatic' | 'manual';
}

/** Legacy automatic chapters occupy the rest of their scene. Editorial chapter
 * presets use their authored reading window and return to the source afterwards.
 * Use this same range in export and before making a graphic manual in the editor. */
export function documentaryMotionTiming(graphic: Pick<DocumentaryMotionGraphic,'kind'|'origin'|'preset'|'startSeconds'|'durationSeconds'>, sceneSeconds:number) {
  if(graphic.kind!=='chapter-number'||graphic.origin!=='automatic')return {startSeconds:graphic.startSeconds,durationSeconds:graphic.durationSeconds};
  const startFrames=Math.max(0,Math.round(graphic.startSeconds*30));
  const sceneFrames=Math.max(1,Math.ceil(sceneSeconds*30-1e-7));
  const available=Math.max(1,sceneFrames-startFrames);
  const duration=graphic.preset?.startsWith('chapter-')?Math.min(available,Math.max(1,Math.round(graphic.durationSeconds*30))):available;
  return {startSeconds:startFrames/30,durationSeconds:duration/30};
}

const normalize = (value: string) => value.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function searchDocumentaryPlaces(query: string) {
  const key = normalize(query);
  if (key.length < 2) return [];
  return documentaryPlaceCatalog.filter(p => p.aliases.some(alias=>normalize(alias).includes(key))).slice(0,20);
}
/** Ambiguous names never silently resolve to the largest or first city. */
export function resolveDocumentaryPlace(name: string, country?: string): DocumentaryPlace | undefined {
  const key = normalize(name), nation = normalize(country ?? '');
  const matches = documentaryPlaceCatalog.filter(p=>p.aliases.some(alias=>normalize(alias)===key)
    && (!nation || normalize(p.country)===nation || normalize(p.countryCode)===nation));
  if (matches.length !== 1) return undefined;
  const p=matches[0]!;
  return {name,latitude:p.latitude,longitude:p.longitude,country:p.country,source:'source' in p?p.source:'Natural Earth 1:10m'};
}
export function validDocumentaryPlace(place?: DocumentaryPlace): place is DocumentaryPlace {
  return Boolean(place?.name.trim() && Number.isFinite(place.latitude) && Math.abs(place.latitude)<=90
    && Number.isFinite(place.longitude) && Math.abs(place.longitude)<=180);
}
export function documentaryRoutePlaces(graphic: DocumentaryMotionGraphic): DocumentaryPlace[] {
  return graphic.route ?? (graphic.fromPlace && graphic.place ? [graphic.fromPlace, graphic.place] : []);
}
/** Validate semantic suggestions against supplied text, never invent displayed facts/coordinates. */
export function groundedDocumentaryMotion(value: unknown, narration: string, context: string): DocumentaryMotionGraphic | undefined {
  if (!value || typeof value!=='object') return undefined;
  const v=value as Record<string,unknown>, kind=v.kind as DocumentaryMotionKind;
  if (!documentaryMotionKinds.some(([id])=>id===kind)) return undefined;
  const literal = (input: unknown, max=120) => {
    if (typeof input!=='string' || !input.trim() || input.length>max) return '';
    return normalize(context).includes(normalize(input)) ? input.trim() : '';
  };
  const title=literal(v.title,kind==='quote'?320:120), fact=literal(v.value,48), kicker=literal(v.kicker,60);
  const items=Array.isArray(v.items)?v.items.map(i=>literal(i,70)).filter(Boolean).slice(0,5):undefined;
  const motion: DocumentaryMotionGraphic={kind,enabled:true,title,kicker,value:fact,items,startSeconds:0,durationSeconds:4,origin:'automatic'};
  if(kind==='subject-card'){
    if(!title||!normalize(narration).includes(normalize(title)))return undefined;
    if(kicker&&!normalize(narration).includes(normalize(kicker)))motion.kicker=undefined;
    motion.isolateSubject=true;motion.background='spotlight';return motion;
  }
  if(kind==='bar-chart'){
    const cards=Array.isArray(v.cards)?v.cards.map(c=>{const row=c as Record<string,unknown>;return {label:literal(row?.label,50),value:literal(row?.value,48)};}):[];
    if(cards.length<2||cards.length>5||cards.some(c=>!c.label||!c.value||!/^\d+(?:[.,]\d+)?\s*[^\d]*$/u.test(c.value)))return undefined;
    if(cards.some(c=>!normalize(narration).includes(normalize(c.label))||!normalize(narration).includes(normalize(c.value))))return undefined;
    const units=cards.map(c=>c.value.replace(/^[\d.,]+\s*/u,'').toLocaleLowerCase());
    if(new Set(units).size!==1)return undefined;
    motion.cards=cards;motion.background='grid-dark';return motion;
  }
  if(kind==='quote'){
    const quoted=[...narration.matchAll(/«([^»]+)»|“([^”]+)”|"([^"\n]+)"/gu)].map(match=>normalize(match[1]??match[2]??match[3]??''));
    if(!title||!quoted.some(part=>part.includes(normalize(title)))&&!normalize(narration).includes(normalize(title)))return undefined;
    const highlight=literal(v.highlight,70);
    motion.highlight=highlight&&title.toLocaleLowerCase().includes(highlight.toLocaleLowerCase())?highlight:undefined;motion.variant='marker';motion.quoteMode='speech';
  }
  if (kind.startsWith('map-')) {
    if(kind==='map-route'&&Array.isArray(v.route)){
      if(v.route.length<2||v.route.length>8)return undefined;
      const route=v.route.map(value=>{
        const item=typeof value==='string'?{name:value}:value as {name?:unknown;country?:unknown}|null;
        const name=literal(item?.name,80);
        if(!name||!normalize(narration).includes(normalize(name)))return undefined;
        return resolveDocumentaryPlace(name,typeof item?.country==='string'?item.country:undefined);
      });
      if(route.some(p=>!p)||new Set(route.map(p=>`${p?.latitude},${p?.longitude}`)).size<2)return undefined;
      motion.route=route as DocumentaryPlace[];motion.fromPlace=motion.route[0];motion.place=motion.route.at(-1);
      motion.title=motion.place!.name;motion.cameraZoom=1.04;
      return motion;
    }
    const name=literal(v.place,80);
    // A place mentioned elsewhere in the film is not this shot's subject.
    if (!name || !normalize(narration).includes(normalize(name))) return undefined;
    motion.place=resolveDocumentaryPlace(name,typeof v.country==='string'?v.country:undefined);
    if (!motion.place) return undefined;
    motion.title=name; motion.zoom=5;
    if (kind==='map-route') {
      const from=literal(v.fromPlace,80);
      motion.fromPlace=resolveDocumentaryPlace(from,typeof v.fromCountry==='string'?v.fromCountry:undefined);
      if (!motion.fromPlace || normalize(from)===normalize(name) || !normalize(narration).includes(normalize(from))) return undefined;
    }
  } else if (kind==='statistic') {
    // Literal quantities can be spoken as words. Keep the source wording rather
    // than guessing a numeric conversion (including ranks such as first/third).
    const numberWord=/(?:^|[^\p{L}])(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|trillion|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|ноль|один|одна|одно|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять|двадцать|тридцать|сорок|пятьдесят|шестьдесят|семьдесят|восемьдесят|девяносто|сто|тысяча|миллион|миллиард)(?=$|[^\p{L}])/iu;
    if (!fact || !/\d/.test(fact)&&!numberWord.test(fact) || /\b(?:18|19|20)\d{2}\b/.test(fact) && fact.length===4) return undefined;
  } else if (kind==='chronology') {
    if(v.variant==='date'){
      if(!/\b\d{3,4}\b/.test(fact))return undefined;
      motion.variant='date';
    }else if (!/^\d{3,4}$/.test(fact)) return undefined;
  } else if (kind==='feature-list'||kind==='explainer') {
    if (!items || items.length<2 || !title) return undefined;
    motion.activeIndex=Number.isInteger(v.activeIndex)?Math.max(0,Math.min(items.length-1,Number(v.activeIndex))):0;
    if(kind==='explainer'){motion.cards=items.map(label=>({label}));motion.boardLayout='parts';motion.theme='paper';}
  } else if (kind==='callout'||kind==='annotations') {
    // Pointing at a specific visible object requires a user's anchor, not a text model guess.
    return undefined;
  } else if (!title) return undefined;
  return motion;
}
