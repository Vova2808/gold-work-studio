export interface MotionPresetRect {x:number;y:number;w:number;h:number}
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
const ease=(n:number)=>{const p=clamp(n);return 1-(1-p)**3;};
const smooth=(n:number)=>{const p=clamp(n);return p*p*(3-2*p);};
const timing={type:{cap:27,share:.30,delay:.07},chapter:{cap:39,share:.36,delay:.16},date:{cap:31,share:.29,delay:.12},
  stat:{cap:29,share:.32,delay:.08},board:{cap:47,share:.40,delay:.13},profile:{cap:35,share:.34,delay:.10}};
type Family=keyof typeof timing;
const familyFor=(preset:string):Family=>{const family=preset.split('-')[0] as Family;return family in timing?family:'type';};

/** The source is already on screen. Only authored overlays have an entrance.
 * Families have separate timing budgets; the complete text has a reading hold. */
export function motionPresetChoreography(frame:number,frames:number,motionEnabled=true,preset='type-slam') {
  const family=familyFor(preset),t=timing[family],window=Math.max(1,Math.min(t.cap,(frames-1)*t.share));
  const curve=family==='chapter'||family==='date'?smooth:ease;
  const phase=(from:number,to:number)=>!motionEnabled||frames<=2?1:curve((frame/window-from)/(to-from));
  return {source:1,primary:phase(t.delay,.69),secondary:phase(.35,.91),rule:phase(.57,1),
    drift:phase(0,1),
    ambient:motionEnabled&&frames>2?clamp(frame/Math.max(1,frames-1)):0,
    overlay:!motionEnabled||frames<60?1:1-smooth((frame-(frames-1)*.90)/Math.max(1,(frames-1)*.10))};
}

export function motionPresetItemProgress(frame:number,frames:number,index:number,count:number,motionEnabled=true,preset='board-cascade') {
  if(!motionEnabled||frames<=2)return 1;
  const t=timing[familyFor(preset)],window=Math.max(1,Math.min(t.cap,(frames-1)*t.share));
  const delay=.10+.48*clamp(index/Math.max(1,count-1));
  return ease((frame/window-delay)/.42);
}

/** Original material keeps the parent's fit and camera, including at graphic
 * boundaries. A saved cutout is the only independent source composition. */
export function motionPresetSourceRect(_preset:string,_mediaAspect:number,canvasAspect:number,cutout=false):MotionPresetRect {
  if(cutout)return {x:0,y:0,w:canvasAspect<1?1:.70,h:1};
  return {x:0,y:0,w:1,h:1};
}

/** Keep the complete original string, including whitespace and punctuation. */
export function motionPresetTextGroups(text:string,count=3) {
  const parts=text.match(/\s*\S+\s*|\s+/gu)??[];
  const size=Math.max(1,Math.ceil(parts.length/Math.max(1,count)));
  const groups:string[]=[];
  for(let i=0;i<parts.length;i+=size)groups.push(parts.slice(i,i+size).join(''));
  return groups;
}

/** Find the authored literal span once in the whole title, then intersect a
 * group's character interval. A phrase crossing groups keeps both halves. */
export function motionPresetHighlightRange(text:string,highlight?:string,offset=0,length=text.length) {
  if(!highlight)return;
  const escaped=highlight.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');
  const match=new RegExp(escaped,'iu').exec(text);
  if(!match)return;
  const start=Math.max(offset,match.index),end=Math.min(offset+length,match.index+match[0].length);
  if(end>start)return {start:start-offset,end:end-offset};
}

/** Text cards only: no source IDs, image lookup, numerical inference or ranking. */
export function motionPresetBoardRects(preset:string,count:number,portrait:boolean,hasSource:boolean,layout?:'parts'|'steps'|'compare',hasTitle=true):MotionPresetRect[] {
  const total=Math.max(0,Math.min(5,count));
  const mode=layout??(preset==='board-staircase'?'steps':preset==='board-orbit'?'compare':'parts');
  if(mode==='compare'){
    const split=Math.ceil(total/2);
    return Array.from({length:total},(_,i)=>{
      const side=i<split?0:1,index=side?i-split:i,n=side?total-split:split;
      const top=hasTitle?(portrait?.48:.50):.20,step=((hasTitle?.93:.88)-top)/Math.max(1,n);
      return {x:side?.55:.07,y:top+index*step,w:.38,h:step*.90};
    });
  }
  if(mode==='steps'&&!portrait){
    const gap=.025,w=(.86-gap*Math.max(0,total-1))/Math.max(1,total);
    return Array.from({length:total},(_,i)=>({x:.07+i*(w+gap),y:hasSource?.66:.41,w,h:hasSource?.26:.44}));
  }
  if(portrait){
    const top=hasSource?.48:.25,step=(.94-top)/Math.max(1,total);
    return Array.from({length:total},(_,i)=>({x:mode==='steps'?.14:.09,y:top+i*step,w:mode==='steps'?.77:.82,h:step*.90}));
  }
  if(total<=3){
    const w=.86/Math.max(1,total);
    return Array.from({length:total},(_,i)=>({x:.07+i*w,y:hasSource?.69:.40,w:w-.035,h:hasSource?.24:.43}));
  }
  if(preset==='board-ledger'){
    const rows=Math.ceil(total/2),top=hasSource?.55:.25,step=(.94-top)/rows;
    return Array.from({length:total},(_,i)=>({x:.09+Math.floor(i/rows)*.45,y:top+(i%rows)*step,w:.37,h:step*.90}));
  }
  const top=hasSource?.55:.25,step=(.94-top)/total;
  return Array.from({length:total},(_,i)=>({x:.10,y:top+i*step,w:.80,h:step*.92}));
}
