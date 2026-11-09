/** A metadata shortlist needs a bounded excerpt, not a whole channel's season
 * table. Keep literal source text around the required names/dates/details so
 * the ranking model can still see a late relevant mention or contradiction. */
export function documentaryRankingExcerpt(description:string,terms:string[],limit=720):string {
  if(description.length<=limit)return description;
  const head=description.slice(0,160),folded=description.toLowerCase();
  const ranges:Array<[number,number]>=[[0,160]];
  for(const term of new Set(terms.map(term=>term.trim()).filter(term=>term.length>=3))){
    const at=folded.indexOf(term.toLowerCase());
    if(at<160||ranges.some(([start,end])=>at>=start&&at<end))continue;
    const start=Math.max(160,at-75),end=Math.min(description.length,start+220);
    if(ranges.some(([left,right])=>start<right&&end>left))continue;
    ranges.push([start,end]);
    if(ranges.length===3)break;
  }
  if(ranges.length===1){
    const start=description.slice(0,Math.min(450,limit-183));
    return `${start}\n…\n${description.slice(-180)}`;
  }
  const pieces=[head,...ranges.slice(1).map(([start,end])=>description.slice(start,end))];
  const tail=description.slice(-150);
  const joined=pieces.join('\n…\n');
  return joined.length+tail.length+3<=limit?`${joined}\n…\n${tail}`:joined.slice(0,limit);
}
