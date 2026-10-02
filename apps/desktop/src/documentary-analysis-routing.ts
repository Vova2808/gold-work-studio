export type DocumentaryAnalysisTier='fast'|'careful';

/** Metadata only chooses what to inspect next. Keep detailed reasoning for
 * actual pixels, planning and transcription, including every careful model. */
export function documentaryReasoningEffort(model:string,input:string,hasMedia:boolean):'low'|'medium' {
  if(hasMedia||model!=='ag/gemini-2.5-flash')return 'medium';
  try {
    const data=JSON.parse(input);
    const ranking=(item:unknown):boolean=>Boolean(item&&typeof item==='object'
      &&Array.isArray((item as {candidates?:unknown}).candidates)
      &&(item as {candidates:unknown[]}).candidates.length>0);
    if(ranking(data)||Array.isArray(data.requests)&&data.requests.length>0&&data.requests.length<=4
      &&data.requests.every((request:{data?:unknown})=>ranking(request?.data)))return 'low';
  }catch { /* Other text tasks retain their existing reasoning profile. */ }
  return 'medium';
}

/** A fast metadata opinion never approves pixels. Literal details stay careful. */
export function documentaryAnalysisTier(purpose:string,input:string):DocumentaryAnalysisTier {
  if(purpose==='candidate-relevance'||purpose==='visual-source-preview')return 'fast';
  if(!['visual-overview','visual-range','catalog-range-check','catalog-range-batch'].includes(purpose))return 'careful';
  try {
    const data=JSON.parse(input);
    const text=JSON.stringify([data.narrationContext,data.narrativeContext,data.voiceOverContext,data.narration,data.searchHints,data.detail]);
    // Specific eras, named comparisons, interiors, mechanical parts and explicit
    // actions need the more careful route; never relax the acceptance policy.
    if((data.requiredIdentities?.length??0)>1||data.years?.length||/\b(?:19|20)\d{2}\b|\b(?:engine|interior|inside|valve|piston|crank|cylinder|opening|closing|overtak|win|won|crash|premiere|festival|portrait|person)\w*|двигател|внутри|порш|коленвал|клапан|открыва|закрыва|обгон|побед|портрет|человек/iu.test(text))return 'careful';
    return 'fast';
  } catch {return 'careful';}
}
