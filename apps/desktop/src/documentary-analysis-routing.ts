export type DocumentaryAnalysisTier='fast'|'careful';

/** Ordinary photos/short excerpts need a concise verdict; identities, literal
 * actions, planning and transcription retain their detailed reasoning. */
export function documentaryReasoningEffort(model:string,input:string,hasMedia:boolean,ordinaryVisual=false):'low'|'medium' {
  if(hasMedia){try{const data=JSON.parse(input);if([2,3].includes(data.reviewPolicyVersion)&&data.singleReview===true)return 'low';}catch{}}
  if(model!=='ag/gemini-2.5-flash')return 'medium';
  if(hasMedia)return ordinaryVisual&&documentaryAnalysisTier('visual-range',input,true)==='fast'?'low':'medium';
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
export function documentaryAnalysisTier(purpose:string,input:string,validatedIllustration=false):DocumentaryAnalysisTier {
  if(purpose==='visual-illustration')return 'fast';
  if(purpose==='candidate-relevance'||purpose==='visual-source-preview'||purpose==='visual-motion')return 'fast';
  if(!['visual-overview','visual-range','catalog-range-check','catalog-range-batch'].includes(purpose))return 'careful';
  try {
    const data=JSON.parse(input);
    // Once the app has validated a thematic visual task, historical facts in
    // the voice-over do not make its ordinary pixels a named/dated review.
    // This changes routing only; the actual content/quality checks stay intact.
    const text=JSON.stringify(validatedIllustration
      ?[data.visualTask,data.narrationContext,data.narrativeContext?.current?.text,data.narration,data.searchHints,data.detail]
      :[data.narrationContext,data.narrativeContext,data.voiceOverContext,data.narration,data.searchHints,data.detail]);
    // Specific eras, named comparisons, interiors, mechanical parts and explicit
    // actions need the more careful route; never relax the acceptance policy.
    if((data.requiredIdentities?.length??0)>0||data.years?.length||/\b(?:19|20)\d{2}\b|\b(?:engine|interior|inside|valve|piston|crank|cylinder|opening|closing|overtak|crash|premiere|festival|portrait|person)\w*|\b(?:win|wins|winning|won)\b|двигател|внутри|порш|коленвал|клапан|открыва|закрыва|обгон|побед|портрет|человек/iu.test(text))return 'careful';
    return 'fast';
  } catch {return 'careful';}
}
