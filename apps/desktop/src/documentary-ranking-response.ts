import JSON5 from 'json5';

/** A fully received ranking sometimes uses single-quoted JSON5 strings.
 * Parse the whole value without eval, token repair or extraction of a fragment.
 * This is only a shortlist: the caller still resolves IDs against its own pool. */
export function receivedDocumentaryRanking(raw:string):{ids:string[];reason?:string}|undefined {
  try{
    const value=JSON5.parse(raw);
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['ids','reason'].includes(key))
      ||!Array.isArray(value.ids)||value.ids.length>6||value.ids.some((id:unknown)=>typeof id!=='string'||!/^(?:[a-f0-9]{8}|[a-f0-9]{64})$/i.test(id))
      ||value.reason!==undefined&&typeof value.reason!=='string')return;
    return {ids:value.ids,...(value.reason===undefined?{}:{reason:value.reason})};
  }catch{return;}
}
