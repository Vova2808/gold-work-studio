import type {DocumentaryRatioGroup} from '@gold-work/shared';

const ease=(value:number)=>{const t=Math.max(0,Math.min(1,value));return t*t*(3-2*t);};

/** One physical unit per item, retained while the aggregate separates into
 * its contributions. Equal units never encode different quantities by area. */
export function ratioGroupLayout(groups:DocumentaryRatioGroup[],portrait:boolean){
  const width=portrait?1080:1920,height=portrait?1920:1080,total=groups.reduce((sum,g)=>sum+g.amount,0);
  const columns=groups.map(g=>Math.max(1,Math.ceil(Math.sqrt(g.amount)))),rows=groups.map((g,i)=>Math.max(1,Math.ceil(g.amount/columns[i]!)));
  const groupWidth=portrait?500:groups.length===3?440:650,groupHeight=portrait?300:340;
  const step=Math.min(portrait?110:120,...columns.map(c=>groupWidth/c),...rows.map(r=>groupHeight/r));
  const size=step*.78,initialColumns=Math.min(portrait?4:8,total),initialRows=Math.ceil(total/initialColumns);
  const initialStep=Math.min(portrait?130:140,(portrait?500:1400)/initialColumns,(portrait?1100:340)/initialRows);
  const captions=groups.map((_,i)=>({x:portrait?80:groups.length===3?400+i*560:520+i*880,y:portrait?460+i*440:400,
    width:portrait?330:groupWidth}));
  let cursor=0;
  const units=groups.flatMap((group,index)=>Array.from({length:group.amount},(_,local)=>{
    const item=cursor++,col=local%columns[index]!,row=Math.floor(local/columns[index]!);
    return {index:item,group:index,size,
      start:{x:(portrait?740:width/2)+(item%initialColumns-(initialColumns-1)/2)*initialStep,y:(portrait?530:600)+Math.floor(item/initialColumns)*initialStep},
      end:{x:(portrait?740:captions[index]!.x)+(col-(columns[index]!-1)/2)*step,y:(portrait?440+index*440:600)+size/2+row*step}};
  }));
  return {width,height,captions,units};
}

/** Timing is an editorial reveal, never measured word alignment. */
export function ratioGroupState(frame:number,frames:number,count:number,moving:boolean){
  const phase=moving?Math.max(0,Math.min(1,frame/Math.max(1,(frames-1)*.72))):1;
  const split=Array.from({length:count},(_,i)=>{
    const start=count===2?.20+i*.24:[.16,.32,.50][i]!;
    const span=count===2?(i===0?.52:.56):(i===count-1?.50:.46);
    return ease((phase-start)/span);
  });
  return {phase,split};
}

/** Bounded labels are allowed to wrap; no clipped SVG text or ellipsis. */
export function ratioGroupLabelLines(text:string,maxCharacters:number){
  const lines:string[]=[];let line='';
  for(const word of text.trim().split(/\s+/u)){
    if(line&&line.length+word.length+1>maxCharacters){lines.push(line);line=word;}
    else line=line?`${line} ${word}`:word;
  }
  if(line)lines.push(line);
  return lines;
}
