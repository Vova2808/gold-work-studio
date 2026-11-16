import {createHash} from 'node:crypto';
const imageJson=new WeakMap<readonly string[],Array<{raw:string;json:string}>>();

/** Identical to hashing JSON.stringify([2,purpose,system,input,images]), but
 * without copying all base64 frames for every legacy checkpoint variant. */
export function documentaryCheckpointKey(purpose:string,system:string,input:string,images:readonly string[]):string {
  const hash=createHash('sha256');
  hash.update(`[2,${JSON.stringify(purpose)},${JSON.stringify(system)},${JSON.stringify(input)},[`);
  let encoded=imageJson.get(images);
  if(!encoded){encoded=[];imageJson.set(images,encoded);}
  encoded.length=images.length;
  for(let i=0;i<images.length;i++){
    if(i)hash.update(',');
    const raw=images[i]!;
    if(encoded[i]?.raw!==raw)encoded[i]={raw,json:JSON.stringify(raw)};
    hash.update(encoded[i]!.json);
  }
  return hash.update(']]').digest('hex');
}

const canonical=(value:unknown):unknown=>typeof value==='string'?value.normalize('NFC').replace(/\s+/gu,' ').trim()
  :Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
    ?Object.fromEntries(Object.entries(value).filter(([,item])=>item!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])):value;

/** The visual question, independent of transport, model, file dates and prompt
 * wording. Keep the literal constraints and nearby narration that can resolve a
 * pronoun. Legacy byte-exact checkpoint keys remain readable separately. */
export function documentaryVisualTaskKey(input:Record<string,unknown>):string {
  const context=input.narrativeContext as {preceding?:Array<{text:string}>;following?:Array<{text:string}>}|undefined;
  const fallback=input.fallbackNarrativeContext as Record<string,unknown>|undefined;
  const grounding=input.scriptGrounding as {grounding?:Record<string,unknown>}|undefined;
  const task={visualTarget:input.visualTarget,narration:input.narration,sourcePolicy:input.sourcePolicy,
    namedSubject:input.namedSubject,requiredYears:input.requiredYears??[],requiredSubject:input.requiredSubject,
    requiredLocation:input.requiredLocation,activeListItem:input.activeListItem,
    preceding:context?.preceding?.slice(-2).map(line=>line.text)??[],following:context?.following?.slice(0,2).map(line=>line.text)??[],
    ...(grounding?.grounding?{grounding:{mandatory:grounding.grounding.mandatory,illustrations:grounding.grounding.illustrations,optionalDetails:grounding.grounding.optionalDetails}}:{}),
    ...(fallback?{fallback:Object.fromEntries(Object.entries(fallback).filter(([key])=>!['binding','scriptSha256','version'].includes(key)))}:{})};
  return createHash('sha256').update(JSON.stringify(canonical(task))).digest('hex');
}

export function documentaryVisualVerdictKey(input:Record<string,unknown>):string|undefined {
  if(input.singleReview!==true||typeof input.checksum!=='string'||!/^[a-f0-9]{64}$/.test(input.checksum)
    ||!Number.isFinite(input.startSeconds)||!Number.isFinite(input.endSeconds))return;
  return createHash('sha256').update(JSON.stringify(['visual-verdict',input.checksum,input.startSeconds,input.endSeconds,documentaryVisualTaskKey(input)])).digest('hex');
}
