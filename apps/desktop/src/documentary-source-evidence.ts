import {createHash} from 'node:crypto';
import {isIP} from 'node:net';

export type DocumentarySourceLocationField='title'|'description'|'location'|'pageUrl'|'urlSlug';
export interface DocumentarySourceEvidence {
  readonly version:1;
  readonly title:string;
  readonly description:string;
  /** Only an actual source/platform field, never a generated location. */
  readonly location?:string;
  readonly pageUrl?:string;
  readonly urlSlug?:string;
  readonly urlEvidence?:'weak';
  readonly fingerprint:string;
}
export interface DocumentaryLocationEvidence {
  version:1;
  sourceFingerprint:string;
  /** Chosen by the caller from the visual target and permitted scope. */
  requiredLocation?:string;
  status:'unspecified'|'supported'|'hint'|'conflict';
  place?:string;
  field?:DocumentarySourceLocationField;
  quote?:string;
  strength?:'source'|'weak';
}

function text(value:unknown,limit:number):string {
  if(typeof value!=='string')return '';
  const clean=value.normalize('NFKC').replace(/[\p{Cc}\p{Cf}]/gu,' ').replace(/\s+/gu,' ').trim();
  if(clean.length<=limit)return clean;
  const head=clean.slice(0,limit);
  // Do not create a new word boundary inside a source token (Romeo -> Rome).
  return (clean[limit]===' '?head:head.replace(/\S+$/u,'')).trimEnd();
}
const quoted=(value:string)=>value.normalize('NFKC').replace(/\s+/gu,' ').trim().toLowerCase();
const words=(value:string)=>` ${quoted(value).replace(/[^\p{L}\p{N}]+/gu,' ').trim()} `;

/** Only a public-host HTTP(S) page hint. No fetch/DNS, authentication or URL query. */
function publicPage(value:unknown):string|undefined {
  if(typeof value!=='string'||value.length>4096)return;
  try{
    const url=new URL(value),host=url.hostname.toLowerCase().replace(/^\[|\]$/g,'').replace(/\.$/,'');
    if(!['http:','https:'].includes(url.protocol)||!host.includes('.')||isIP(host)
      ||/(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example)$/.test(host))return;
    url.username='';url.password='';url.search='';url.hash='';
    return url.href;
  }catch{return;}
}

function sourceFingerprint(source:Omit<DocumentarySourceEvidence,'fingerprint'>):string {
  // Fixed field order; query/target and input object insertion order have no authority.
  return createHash('sha256').update(JSON.stringify({version:source.version,title:source.title,description:source.description,
    location:source.location,pageUrl:source.pageUrl,urlSlug:source.urlSlug,urlEvidence:source.urlEvidence})).digest('hex');
}

/** Untrusted source data for the existing frame review; not a location detector. */
export function documentarySourceEvidence(source:{title?:string;description?:string;pageUrl?:string;location?:string}):DocumentarySourceEvidence {
  const pageUrl=publicPage(source.pageUrl),location=text(source.location,240);
  let urlSlug:string|undefined;
  if(pageUrl){
    const segment=new URL(pageUrl).pathname.split('/').filter(Boolean).at(-1);
    if(segment)try{
      const slug=text(decodeURIComponent(segment).replace(/[-_]+/g,' '),800);
      if(/\p{L}/u.test(slug))urlSlug=slug;
    }catch{/* A malformed escape is not usable readable evidence. */}
  }
  const evidence:Omit<DocumentarySourceEvidence,'fingerprint'>={version:1,title:text(source.title,240),description:text(source.description,800),
    ...(location?{location}:{}),...(pageUrl?{pageUrl,...(urlSlug?{urlSlug}:{}),urlEvidence:'weak' as const}:{})};
  return {...evidence,fingerprint:sourceFingerprint(evidence)};
}

/** Validate sourceLocation from the SAME model review:
 * {status:'unspecified'} or {status:'supported'|'conflict',place,field,quote}.
 * Geography/region compatibility is judged by that review, not inferred here.
 * A URL can supply a conflict hint, never independently confirm the place. */
export function validateDocumentaryLocationEvidence(source:DocumentarySourceEvidence,value:unknown,requiredLocation?:string):{
  evidence?:DocumentaryLocationEvidence;issue?:string;
} {
  if(source.version!==1||sourceFingerprint(source)!==source.fingerprint)
    return {issue:'Данные источника изменились после формирования evidence.'};
  const required=text(requiredLocation,240);
  const base={version:1 as const,sourceFingerprint:source.fingerprint,...(required?{requiredLocation:required}:{})};
  if(value===undefined||value===null)return {evidence:{...base,status:'unspecified'}};
  if(typeof value!=='object'||Array.isArray(value))return {issue:'Неверный формат атрибуции места источника.'};
  const row=value as Record<string,unknown>;
  if(row.status==='unspecified')return ['place','field','quote'].some(key=>row[key]!==undefined)
    ?{issue:'Неуказанное место не может содержать утверждение или цитату.'}:{evidence:{...base,status:'unspecified'}};
  if(row.status!=='supported'&&row.status!=='conflict')return {issue:'Неизвестный статус атрибуции места источника.'};
  if(typeof row.field!=='string'||!['title','description','location','pageUrl','urlSlug'].includes(row.field))
    return {issue:'Место должно опираться на фактическое поле источника, не на запрос или цель сцены.'};
  const field=row.field as DocumentarySourceLocationField,actual=source[field];
  const quote=typeof row.quote==='string'?row.quote.trim():'',place=typeof row.place==='string'?row.place.trim():'';
  if(!actual||!quote||quote.length>actual.length+100||!quoted(actual).includes(quoted(quote)))
    return {issue:'Цитата места отсутствует в указанном поле источника.'};
  if(!place||place.length>240||!/[\p{L}\p{N}]/u.test(place)||!words(quote).includes(words(place))||!words(actual).includes(words(place)))
    return {issue:'Заявленное место отсутствует в цитате источника.'};
  const strength=field==='pageUrl'||field==='urlSlug'?'weak':'source';
  const evidence:DocumentaryLocationEvidence={...base,status:row.status==='conflict'?'conflict':strength==='weak'?'hint':'supported',
    place,field,quote,strength};
  return row.status==='conflict'
    ?{evidence,issue:'Осталось явное противоречие между атрибуцией места источника и визуальной целью; география не подтверждена.'}
    :{evidence};
}
