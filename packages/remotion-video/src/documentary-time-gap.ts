const clamp=(value:number)=>Math.max(0,Math.min(1,value));
const ease=(value:number)=>{const t=clamp(value);return t*t*(3-2*t);};

/** Editorial reveal at the video's frame resolution, not a stopwatch replay.
 * The supplied interval never changes how long the explanation takes to play. */
export function documentaryTimeGapState(frame:number,frames:number,moving=true) {
  if(!moving||frames<=2)return {first:1,second:1,interval:1};
  // Complete the explanation in at most two seconds. A longer narrated hold
  // must not spend its first half on an almost empty axis.
  const last=Math.max(1,Math.min(60,Math.floor(frames)-1)),at=clamp(Math.floor(frame)/last);
  const phase=(start:number,end:number)=>ease((at-start)/(end-start));
  return {first:phase(0,.12),second:phase(.16,.32),interval:phase(.26,.56)};
}

export const documentaryTimeNumber=(value:number)=>Number(value.toPrecision(6)).toString();
export function documentaryTimeBound(label:string):'>'|'<'|'≥'|'≤'|''{
  if(/\bat least\b|не менее|≥/iu.test(label))return '≥';
  if(/\bat most\b|не более|≤/iu.test(label))return '≤';
  if(/\b(?:more than|over)\b|более|больше|>/iu.test(label))return '>';
  if(/\b(?:less than|under)\b|менее|меньше|</iu.test(label))return '<';
  return '';
}

/** The reference domain is a unit of measurement, not another narrated fact.
 * Subseconds always share one second; longer intervals use a labelled seconds
 * axis with a little headroom, so a lower bound does not look like an endpoint. */
export function documentaryTimeGapGeometry(portrait=false,amount=1) {
  const width=portrait?1080:1920,height=portrait?1920:1080;
  const mode=amount<1?'fraction':'seconds';
  const target=Number.isFinite(amount*1.15)?amount*1.15:amount,raw=Math.max(1,target)/6,power=10**Math.floor(Math.log10(raw));
  const step=Math.max(1,([1,2,5,10].find(n=>n*power>=raw)??10)*power);
  const rounded=Math.ceil(target/step)*step,maxSeconds=mode==='fraction'?1:Number.isFinite(rounded)?rounded:amount;
  const ticks=mode==='fraction'?[0,.25,.5,.75]:Array.from({length:Math.floor(maxSeconds/step)+1},(_,i)=>i*step);
  if(mode==='seconds'&&ticks.at(-1)!<maxSeconds)ticks.push(maxSeconds);
  return {
    mode,width,height,maxSeconds,step,ticks,fraction:clamp(amount/maxSeconds),
    dial:{x:portrait?540:590,y:portrait?640:535,r:portrait?310:280,inner:portrait?180:162},
    axis:{x:portrait?130:170,y:portrait?1080:590,w:portrait?820:1580,h:portrait?140:116},
    label:mode==='fraction'?(portrait?{x:90,y:1250,w:900,h:430}:{x:1080,y:410,w:720,h:330})
      :(portrait?{x:90,y:200,w:900,h:450}:{x:140,y:100,w:1640,h:230}),
    delta:mode==='fraction'?(portrait?{x:540,y:1150}:{x:1080,y:345}):(portrait?{x:130,y:850}:{x:170,y:430}),
  };
}

export function documentaryTimePolar(x:number,y:number,r:number,fraction:number){
  const angle=fraction*Math.PI*2-Math.PI/2;
  return {x:x+Math.cos(angle)*r,y:y+Math.sin(angle)*r};
}

/** Side captions grow away from the ring. A centred side caption extends
 * inward by half its width and crosses the long quarter-second tick. */
export function documentaryTimeDialLabels(dial:{x:number;y:number;r:number}){
  const fontSize=34;
  return [0,.25,.5,.75].map(value=>{
    const side=value===.25||value===.75,point=documentaryTimePolar(dial.x,dial.y,dial.r+(side?66:82),value);
    const anchor:'start'|'end'|'middle'=side?(value===.25?'start':'end'):'middle',text=`${documentaryTimeNumber(value)} s`;
    const w=text.length*fontSize*.64,h=fontSize*1.2;
    return {value,text,...point,anchor,fontSize,box:{x:point.x-(anchor==='end'?w:anchor==='middle'?w/2:0),y:point.y-h/2,w,h}};
  });
}

/** An annular sector has exactly the same fraction of the full reference area. */
export function documentaryTimeSector(dial:{x:number;y:number;r:number;inner:number},fraction:number){
  if(fraction<=0)return '';
  const f=Math.min(.999999999,fraction),a=documentaryTimePolar(dial.x,dial.y,dial.r,0),b=documentaryTimePolar(dial.x,dial.y,dial.r,f);
  const c=documentaryTimePolar(dial.x,dial.y,dial.inner,f),d=documentaryTimePolar(dial.x,dial.y,dial.inner,0),large=f>.5?1:0;
  return `M${a.x} ${a.y}A${dial.r} ${dial.r} 0 ${large} 1 ${b.x} ${b.y}L${c.x} ${c.y}A${dial.inner} ${dial.inner} 0 ${large} 0 ${d.x} ${d.y}Z`;
}
