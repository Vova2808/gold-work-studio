import {parseDocumentaryJson,documentaryJsonAnswer,safeDocumentaryJsonValue} from './documentary-json.js';

function validPlan(value:unknown):value is Record<string,unknown>{
  if(!safeDocumentaryJsonValue(value)||!value||typeof value!=='object'||Array.isArray(value))return false;
  const result=value as Record<string,unknown>,rows=result.scenes;
  return Object.keys(result).length===1&&Array.isArray(rows)&&rows.length>0
    &&rows.every(row=>row&&typeof row==='object'&&!Array.isArray(row)&&typeof row.id==='string'&&row.id.trim()
      &&Array.isArray(row.queries)&&row.queries.length&&row.queries.every((q:unknown)=>typeof q==='string'&&q.trim()))
    &&new Set(rows.map(row=>row.id)).size===rows.length;
}

/** Parse a COMPLETE received search-plan with JSON5's data grammar, never JS
 * evaluation. One complete fenced answer is allowed; incomplete fences,
 * expressions, undefined and unsafe objects fail. No fields invented. */
export function receivedDocumentaryPlanPayload(raw:string):{result:Record<string,unknown>;kind:'last-scene-closing-brace'|'received-json5'|'received-json';parser:'json'|'json5';insertedAt?:number}|undefined{
  const parsed=parseDocumentaryJson(raw);
  if(parsed)return validPlan(parsed.result)?{...parsed,kind:parsed.parser==='json5'?'received-json5':'received-json'}:undefined;
  const clean=documentaryJsonAnswer(raw);
  if(!clean)return;
  const brace=receivedDocumentaryPlan(clean);
  if(brace)return {...brace,insertedAt:raw.indexOf(clean)+brace.insertedAt,kind:'last-scene-closing-brace',parser:'json'};

}

/** One narrowly observed terminal syntax defect: the LAST scene object lacks
 * its closing brace immediately before the root scenes array/object suffix.
 * Never repair strings, values, nested requirements, earlier rows or truncation.
 * This is only for a received answer, never a pending/partial stream. */
export function receivedDocumentaryPlan(raw:string):{result:Record<string,unknown>;insertedAt:number}|undefined{
  const clean=raw.trim();
  if(!clean.startsWith('{'))return;
  const stack:string[]=[];let quoted=false,escaped=false;
  for(let at=0;at<clean.length;at++){
    const char=clean[at]!;
    if(quoted){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;continue;}
    if(char==='"'){quoted=true;continue;}
    if(char==='{'||char==='['){stack.push(char);continue;}
    if(char!=='}'&&char!==']')continue;
    const expected=char==='}'?'{':'[';
    if(stack.at(-1)===expected){stack.pop();continue;}
    if(char!==']'||stack.join('')!=='{[{'||clean.slice(at)!==']}')return;
    try{
      const result=JSON.parse(clean.slice(0,at)+'}'+clean.slice(at)) as Record<string,unknown>;
      if(!validPlan(result))return;
      return {result,insertedAt:raw.indexOf(clean)+at};
    }catch{return;}
  }
}
