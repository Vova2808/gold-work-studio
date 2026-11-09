/** A healthy local catalogue alone cannot prove remote discovery was exhausted. */
export function documentaryDiscoveryCompleted(result:{candidates:readonly unknown[];sources:readonly {provider:string;error?:string}[]}):boolean {
  if(result.candidates.length||!result.sources.length)return true;
  const external=result.sources.filter(source=>source.provider!=='local');
  return external.some(source=>!source.error)||!external.some(source=>source.error)&&result.sources.some(source=>!source.error);
}
