/** A literal year in the complete original sentence is a discovery hint, not
 * proof of the source's era. Keep the original query as an alternative and do
 * not choose a side in comparisons/flashbacks containing several years. */
export function documentaryDatedSearchQueries(queries:string[],sentence:string):string[] {
  const years=[...new Set(sentence.match(/\b(?:1[0-9]|20)\d{2}\b/g)??[])];
  if(years.length!==1||!queries.length||queries.some(query=>new RegExp(`\\b${years[0]}\\b`).test(query)))return queries;
  const dated=`${queries[0]} ${years[0]}`;
  if(dated.length>240)return queries;
  return [dated,...queries].slice(0,4);
}
