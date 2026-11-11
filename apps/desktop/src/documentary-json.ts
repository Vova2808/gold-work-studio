import JSON5 from 'json5';

/** Diagnostic only: never supplies missing tokens or a model verdict. */
export function documentaryJsonFormatIssue(raw:string):'incomplete-json'|'invalid-json'|undefined{
  if(parseDocumentaryJson(raw))return;
  const text=raw.trim().replace(/^```(?:json5?)?[ \t]*\r?\n/i,'');
  let quote='',escaped=false;
  const stack:string[]=[];
  for(const char of text){
    if(quote){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char===quote)quote='';continue;}
    if(char==='"'||char==="'")quote=char;
    else if(char==='{'||char==='[')stack.push(char);
    else if(char==='}'||char===']'){
      if(stack.pop()!==(char==='}'?'{':'['))return 'invalid-json';
    }
  }
  return quote||stack.length?'incomplete-json':'invalid-json';
}

/** JSON5 is a data parser, never eval. Reject values JSON.stringify would
 * silently change/drop and property names that can alter later object use. */
export function safeDocumentaryJsonValue(value:unknown,depth=0):boolean{
  if(depth>100)return false;
  if(value===null||typeof value==='string'||typeof value==='boolean')return true;
  if(typeof value==='number')return Number.isFinite(value);
  if(!value||typeof value!=='object')return false;
  if(Array.isArray(value))return value.every(item=>safeDocumentaryJsonValue(item,depth+1));
  if(Object.getPrototypeOf(value)!==Object.prototype)return false;
  return Object.entries(value).every(([key,item])=>!['__proto__','prototype','constructor'].includes(key)&&safeDocumentaryJsonValue(item,depth+1));
}

export function documentaryJsonAnswer(raw:string):string|undefined{
  const blocks=[...raw.matchAll(/```(?:json5?)?[ \t]*\r?\n([\s\S]*?)```/gi)];
  if(blocks.length>1)return;
  // Only surrounding prose may be discarded, never a competing object or fence.
  if(blocks[0]&&/```|[{}]/.test(raw.replace(blocks[0][0],'')))return;
  const clean=blocks.length===1?blocks[0]![1]!.trim():raw.trim();
  if(clean.includes('```'))return;
  const object=!blocks.length&&!clean.startsWith('{')?clean.match(/^[^{\[]*({[\s\S]*})[^}\]]*$/)?.[1]:undefined;
  return object??clean;
}

/** Only callers with a fully received answer may use this. The entire object
 * must parse; no fragment extraction, missing tokens or semantic repairs. */
export function parseDocumentaryJson(raw:string):{result:Record<string,unknown>;parser:'json'|'json5'}|undefined{
  const clean=documentaryJsonAnswer(raw);
  if(!clean||!clean.startsWith('{')||!clean.endsWith('}'))return;
  let value:unknown,parser:'json'|'json5'='json';
  try{value=JSON.parse(clean);}catch{
    try{value=JSON5.parse(clean);parser='json5';}catch{return;}
  }
  if(!safeDocumentaryJsonValue(value)||!value||typeof value!=='object'||Array.isArray(value))return;
  return {result:value as Record<string,unknown>,parser};
}
