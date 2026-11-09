import type {DocumentaryExplanation} from '@gold-work/shared';

export type ExplanationBox={x:number;y:number;w:number;h:number};
export type ExplanationPoint={x:number;y:number};
export type ExplanationLink={from:number;to:number;start:ExplanationPoint;control:ExplanationPoint;end:ExplanationPoint;route?:ExplanationPoint[]};
export const explanationClamp=(n:number)=>Math.max(0,Math.min(1,n));
const smooth=(n:number)=>{const t=explanationClamp(n);return t*t*(3-2*t);};

/** The order expresses the supplied relation, never a magnitude or real duration. */
export function explanationKind(explanation:DocumentaryExplanation):DocumentaryExplanation['kind']{
  const count=explanation.nodes.length;
  if(explanation.kind==='exchange'&&count!==2||(explanation.kind==='branch'||explanation.kind==='merge')&&count<3)return 'contrast';
  return explanation.kind;
}

export function explanationGeometry(explanation:DocumentaryExplanation,width:number,height:number){
  const count=Math.min(4,explanation.nodes.length),kind=explanationKind(explanation),portrait=height>width;
  const position:ExplanationPoint[]=[],labels:ExplanationBox[]=[],sizes:number[]=[];
  const add=(x:number,y:number,size:number,label:ExplanationBox)=>{
    position.push({x:x*width,y:y*height});sizes.push(size);labels.push({x:label.x*width,y:label.y*height,w:label.w*width,h:label.h*height});
  };
  const standard=Math.min(width*(portrait?.28:count===2?.28:count===3?.20:.16),height*(portrait?.15:count===2?.40:count===3?.34:.28));
  if(kind==='branch'||kind==='merge'){
    const leaves=count-1,root=kind==='branch'?0:count-1;
    for(let i=0;i<count;i++){
      if(i===root){
        if(portrait){const y=kind==='branch'?.30:.76;add(.5,y,standard,{x:.19,y:kind==='branch'?.12:y+.09,w:.62,h:.10});}
        else {const x=kind==='branch'?.24:.76;add(x,.44,Math.min(width*.29,height*.44),{x:x-.19,y:.71,w:.38,h:.20});}
      }else{
        const index=kind==='branch'?i-1:i;
        if(portrait){const x=.18+.64*index/Math.max(1,leaves-1),y=kind==='branch'?.70:.26;
          add(x,y,Math.min(width*.20,height*.12),{x:x-.15,y:kind==='merge'?.10:y+.075,w:.30,h:kind==='merge'?.10:.12});
        }else{const x=kind==='branch'?.76:.24,y=.21+.53*index/Math.max(1,leaves-1);
          add(x,y,Math.min(width*.13,height*.14),{x:x-.17,y:y+.083,w:.34,h:.10});}
      }
    }
  }else if(kind==='cycle'){
    // Labels sit outside the loop. A four-node loop reads clockwise rather
    // than as a row with a return wire crossing the whole lower third.
    if(count===2){
      for(let i=0;i<count;i++){
        if(portrait){const y=.32+.36*i;add(.29,y,width*.24,{x:.49,y:y-.07,w:.44,h:.14});}
        else {const x=.25+.50*i;add(x,.43,height*.34,{x:x-.18,y:.69,w:.36,h:.19});}
      }
    }else for(let i=0;i<count;i++){
      const points=count===3?[[.25,.35],[.75,.35],[.50,.70]]:[[.27,.35],[.73,.35],[.73,.68],[.27,.68]];
      const [x,y]=points[i]!,top=i<2;
      add(x!,y!,Math.min(width*(portrait?.23:.20),height*(portrait?.14:.22)),
        {x:x!-(portrait?.20:.18),y:top?.12:.82,w:portrait?.40:.36,h:top?.10:.13});
    }
  }else if(kind==='contrast'&&count===4){
    for(let i=0;i<count;i++){const x=i%2?.75:.25,y=i<2?.28:.70;
      add(x,y,Math.min(width*.25,height*.26),{x:x-.20,y:y+.15,w:.40,h:.11});}
  }else if(portrait&&kind!=='exchange'){
    for(let i=0;i<count;i++){const y=.25+.56*i/Math.max(1,count-1);
      add(.25,y,Math.min(width*.28,height*.145),{x:.46,y:y-.07,w:.47,h:.14});}
  }else{
    for(let i=0;i<count;i++){
      const x=count===2?.24+.52*i:count===3?.17+.66*i/2:.13+.74*i/3,labelWidth=Math.min(.40,.91/count);
      const size=kind==='exchange'?Math.min(standard,height*.18):kind==='contrast'?Math.min(width*(count===2?.28:.25),height*(count===2?.44:.37)):standard;
      add(x,kind==='exchange'?.48:portrait?.49:.43,size,
        {x:x-labelWidth/2,y:kind==='exchange'?(i===0?.26:.60):portrait?.67:count===2?.70:.65,w:labelWidth,h:kind==='exchange'?.12:portrait?.19:.23});
    }
  }
  const pairs:Array<[number,number]>=kind==='branch'?Array.from({length:count-1},(_,i)=>[0,i+1])
    :kind==='merge'?Array.from({length:count-1},(_,i)=>[i,count-1])
    :kind==='flow'||kind==='cycle'?Array.from({length:kind==='cycle'?count:count-1},(_,i)=>[i,(i+1)%count]):[];
  const links:ExplanationLink[]=pairs.map(([from,to])=>{
    const a=position[from]!,b=position[to]!,dx=b.x-a.x,dy=b.y-a.y,length=Math.max(1,Math.hypot(dx,dy));
    const start={x:a.x+dx/length*sizes[from]!*.52,y:a.y+dy/length*sizes[from]!*.52};
    const end={x:b.x-dx/length*sizes[to]!*.52,y:b.y-dy/length*sizes[to]!*.52};
    if(kind==='cycle'&&count===2){
      return {from,to,start,end,control:portrait?{x:width*(from===0?.04:.44),y:(start.y+end.y)/2}
        :{x:(start.x+end.x)/2,y:height*(from===0?.18:.65)}};
    }
    // Keep fan-out arrivals above the destination captions, and fan-in
    // departures clear of the contributors' captions underneath them.
    if(!portrait&&(kind==='branch'||kind==='merge'))return {from,to,start,end,
      control:kind==='branch'?{x:start.x,y:end.y}:{x:end.x,y:start.y}};
    return {from,to,start,end,control:{x:(start.x+end.x)/2,y:(start.y+end.y)/2}};
  });
  return {kind,position,labels,sizes,links};
}

export function explanationPoint(link:ExplanationLink,t:number):ExplanationPoint{
  const p=explanationClamp(t),q=1-p;
  if(link.route){
    const distances=link.route.slice(1).map((point,i)=>Math.hypot(point.x-link.route![i]!.x,point.y-link.route![i]!.y));
    let remaining=p*distances.reduce((sum,n)=>sum+n,0);
    for(let i=0;i<distances.length;i++){
      const length=distances[i]!,a=link.route[i]!,b=link.route[i+1]!;
      if(remaining<=length||i===distances.length-1){const ratio=length?remaining/length:0;return {x:a.x+(b.x-a.x)*ratio,y:a.y+(b.y-a.y)*ratio};}
      remaining-=length;
    }
  }
  return {x:q*q*link.start.x+2*q*p*link.control.x+p*p*link.end.x,y:q*q*link.start.y+2*q*p*link.control.y+p*p*link.end.y};
}

export function explanationLinkPath(link:ExplanationLink,from=0,to=1):string{
  if(link.route)return link.route.map((point,i)=>`${i?'L':'M'}${point.x} ${point.y}`).join('');
  const a=explanationPoint(link,from),b=explanationPoint(link,to),span=to-from;
  const control={x:a.x+span*((1-from)*(link.control.x-link.start.x)+from*(link.end.x-link.control.x)),
    y:a.y+span*((1-from)*(link.control.y-link.start.y)+from*(link.end.y-link.control.y))};
  return `M${a.x} ${a.y}Q${control.x} ${control.y} ${b.x} ${b.y}`;
}

/** The pause is schematic, not a measured latency. The final connection stays broken. */
export function explanationTransferProgress(progress:number,interrupted:boolean):number{
  if(!interrupted)return progress;
  return progress<.36?progress/.36*.42:progress<.64?.42:.58+(progress-.64)/.36*.42;
}

/** All motion ends at 72%; the remaining 28% is an unchanged readable hold. */
export function explanationState(explanation:DocumentaryExplanation,frame:number,frames:number,moving=true){
  const kind=explanationKind(explanation),count=Math.min(4,explanation.nodes.length);
  const phase=!moving||frames<=2?1:explanationClamp(frame/Math.max(1,(frames-1)*.72));
  const serial=kind==='flow'||kind==='cycle',total=kind==='cycle'?count:count-1;
  const links=Array.from({length:total},(_,i)=>serial?smooth((phase-.06)/.84*total-i)
    :smooth((phase-.05-i*.10)/(.75-(count-2)*.10)));
  const arrival=(index:number)=>smooth(((links[index]??0)-.90)/.10);
  const active=Array.from({length:count},(_,i)=>{
    if(kind==='contrast'||kind==='exchange')return 1;
    if(kind==='merge')return i<count-1?1:links.reduce((sum,_,j)=>sum+arrival(j),0)/(count-1);
    return i===0?1:arrival(i-1);
  });
  // Every destination and its complete label exist from the first frame.
  const visible=active.map(value=>.34+.66*value);
  return {phase,links,active,visible,exchange:smooth((phase-.14)/.70),emphasis:smooth(phase/.14)};
}

export function explanationExchangePosition(point:ExplanationPoint,other:ExplanationPoint,progress:number,index:number,height:number):ExplanationPoint{
  return {x:point.x+(other.x-point.x)*progress,y:point.y+(other.y-point.y)*progress+(index===0?-1:1)*Math.sin(Math.PI*progress)*height*.16};
}
