/** Page whole words without modifying the stored narration or measured cues. */
export function documentaryQuotePageRanges(words:readonly {text:string;space:string}[],limit=220){
  const ranges:Array<{from:number;to:number}>=[];let from=0,length=0;
  words.forEach((word,index)=>{
    if(index>from&&length+word.text.length>limit){ranges.push({from,to:index});from=index;length=0;}
    length+=word.text.length+word.space.length;
  });
  if(words.length)ranges.push({from,to:words.length});
  return ranges;
}
