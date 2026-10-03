import type {DocumentarySceneContext} from './documentary-scene-context.js';

const years=(text:string)=>[...new Set(text.match(/\b(?:1[0-9]|20)\d{2}\b/g)??[])];
const normalized=(text:string)=>text.replace(/\s+/g,' ').trim();
type Candidate={id:string;title:string;description:string};

/** Metadata provenance, not pixel/identity approval. Added only at dispatch so
 * existing pending keys remain protected and completed rankings remain usable. */
export const documentaryRankingEraInstruction=' For a dated event in data.narrativeContext (or narrativeContext for a single request), additionally return era:{years:["required original-script year"],scriptQuote:"exact short quotation from the ORIGINAL script establishing that period"} and sourceQuotes:{"selected id":"exact short quotation from that candidate title or description containing the compatible depicted year"}. Resolve the current event before looking at sources; a historical comparison does not replace the current season. A 2007 portrait is not a 2004 race source. Do not use capturedAt/upload/file dates or infer a source year from the narration, clothing or brand. Do not select explicitly contradictory years. If no particular period is needed (e.g. an era-independent mechanism), use era.years:[] and quote the original general statement. Do not invent quotations. These are metadata quotations only, not visual-review fields. Keep quotations short and select at most six IDs.';

/** Validate the model's declared period against literal script/source text.
 * A bad metadata answer cannot buy a frame review just to rediscover its dates.
 * Legacy answers retain their old behavior unless their own single-year reason
 * contradicts an explicit year in the selected title. Never guess the nearest
 * script date, particularly across flashbacks and comparisons. */
export function filterDocumentaryRankingEra(response:Record<string,unknown>,context:DocumentarySceneContext,candidates:Candidate[],ids:string[]):string[]{
 const lines=[context.current,...context.preceding,...context.following,...context.earlierTimeReferences].sort((a,b)=>a.scene-b.scene);
 const segments:string[]=[];let last:number|undefined;
 for(const line of lines){
   if(line.scene===last)continue;
   if(last!==undefined&&line.scene===last+1)segments[segments.length-1]+=' '+line.text;
   else segments.push(line.text);
   last=line.scene;
 }
 // One original sentence can span adjacent editing slices. Do not reject its
 // literal quotation, or concatenate disjoint older references across gaps.
 const script=segments.map(normalized);
 if(!script.some(text=>years(text).length))return ids;
 const era=response.era;
 if(era&&typeof era==='object'&&!Array.isArray(era)){
   const value=era as Record<string,unknown>;
   const quote=typeof value.scriptQuote==='string'?normalized(value.scriptQuote):'';
   if(!Array.isArray(value.years)||value.years.some(year=>typeof year!=='string'||!/^(?:1[0-9]|20)\d{2}$/.test(year))
     ||quote.length<4||!script.some(text=>text.includes(quote))||value.years.some(year=>!years(quote).includes(year)))return [];
   if(!value.years.length)return years(quote).length?[]:ids;
   const required=value.years as string[];
   const quotes=response.sourceQuotes&&typeof response.sourceQuotes==='object'&&!Array.isArray(response.sourceQuotes)?response.sourceQuotes as Record<string,unknown>:{};
   return ids.filter(id=>{
     const c=candidates.find(c=>c.id===id),q=typeof quotes[id]==='string'?normalized(quotes[id] as string):'';
     return c&&q.length>=4&&[c.title,c.description].some(text=>normalized(text).includes(q))&&years(q).some(year=>required.includes(year));
   });
 }
 if(era!==undefined)return [];
 const declared=typeof response.reason==='string'?years(response.reason):[];
 if(declared.length!==1||!script.some(text=>years(text).includes(declared[0]!)))return ids;
 return ids.filter(id=>{
   const candidate=candidates.find(c=>c.id===id);
   if(!candidate)return false;
   const titled=years(candidate.title);
   // A source describing several periods can contain the needed archive.
   return titled.length!==1||titled[0]===declared[0]||years(candidate.description).includes(declared[0]!);
 });
}
