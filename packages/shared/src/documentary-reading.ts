export interface DocumentaryReadingWord {text:string;startSeconds:number;endSeconds:number}
export const readingTokens=(text:string)=>text.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu)??[];
const key=(s:string)=>s.toLocaleLowerCase().replace(/ё/g,'е').replace(/[’']/g,'');
function distance(a:string,b:string){let row=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]!+1,row[j]!+1,row[j-1]!+(a[i-1]===b[j-1]?0:1));row=next;}return row[b.length]!;}
/** Complete contiguous audio match, with bounded spelling/word-boundary repair.
 * A joined recognizer token ("с тротуара") is split only within its measured
 * interval. No skipped words or fabricated whole-sentence timing. */
export function matchDocumentaryReading(title:string,heard:DocumentaryReadingWord[]):DocumentaryReadingWord[]|undefined{
  const wanted=readingTokens(title).map(key),tokens=heard.flatMap(w=>readingTokens(w.text).map(text=>({...w,text})));
  if(!wanted.length)return;
  for(let i=0;i<=tokens.length-wanted.length;i++){
    if(wanted.every((word,j)=>word===key(tokens[i+j]!.text))){const matched=tokens.slice(i,i+wanted.length);
      if(matched.every((w,j)=>w.endSeconds>w.startSeconds&&(!j||w.startSeconds>=matched[j-1]!.startSeconds)))return matched;
    }
  }
  const limit=Math.max(1,Math.floor(wanted.join('').length*.08));
  for(let offset=0;offset<tokens.length;offset++){
    const visited=new Set<string>();
    const align=(at:number,heardAt:number,errors:number):DocumentaryReadingWord[]|undefined=>{
      if(at===wanted.length)return [];
      const state=`${at}:${heardAt}:${errors}`;if(visited.has(state))return;visited.add(state);
      for(let n=1;n<=2&&at+n<=wanted.length;n++)for(let m=1;m<=2&&heardAt+m<=tokens.length;m++){
        const a=wanted.slice(at,at+n).join(''),b=tokens.slice(heardAt,heardAt+m).map(w=>key(w.text)).join('');
        const d=distance(a,b);if(d&&(a.length<7||d>Math.max(1,Math.floor(a.length*.12)))||errors+d>limit)continue;
        const first=tokens[heardAt]!,last=tokens[heardAt+m-1]!,tail=align(at+n,heardAt+m,errors+d);if(!tail)continue;
        const length=wanted.slice(at,at+n).reduce((v,w)=>v+w.length,0);let position=0;
        return [...wanted.slice(at,at+n).map((word,j)=>{const startSeconds=first.startSeconds+(last.endSeconds-first.startSeconds)*position/length;position+=word.length;return {text:readingTokens(title)[at+j]!,startSeconds,endSeconds:first.startSeconds+(last.endSeconds-first.startSeconds)*position/length};}),...tail];
      }
    };
    const matched=align(0,offset,0);if(matched)return matched;
  }
}
