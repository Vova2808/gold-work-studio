import type {DocumentaryArtwork as Artwork,DocumentaryArtworkLayer as Layer,DocumentarySceneDirection} from '@gold-work/shared';
import {artworkObjectState,artworkCameraState} from '@gold-work/remotion-video';

export interface ArtworkTemporalFinding {code:string;layers:string[];at?:number;problem:string;repair:string}
const round=(n:number)=>Math.round(n*1000)/1000;
type Point={x:number;y:number};
/** Convex declared boxes only; this is never a glyph/intent verdict. Common
 * ancestors and the camera cancel in the pair's shared coordinate system. */
function textTransitReview(artwork:Artwork,frames:number,preferred:number[]){
  const byId=new Map(artwork.layers.map(l=>[l.id,l]));
  const chain=(l:Layer)=>{const out=[l],seen=new Set([l.id]);let reason:string|undefined;
    while(out.at(-1)!.parentId){const p=byId.get(out.at(-1)!.parentId!);
      if(!p||p.kind!=='group'||seen.has(p.id)||out.length>=4){reason='unsupported-hierarchy';break;}
      seen.add(p.id);out.push(p);}
    if(out.some(p=>p.editTransform||p.fillOrigin==='manual'||p.framingBeforeEdit))reason='protected-edited-hierarchy';
    if(out.some(p=>p.clip||(p.depth??0)!==0))reason='unsupported-clip-or-parallax';
    if(out.some(p=>![p.x,p.y,p.w,p.h].every(Number.isFinite)||p.w<=0||p.h<=0))reason='insufficient-box-geometry';
    return {layers:out,reason};};
  const texts=artwork.layers.filter(l=>l.kind==='text'&&l.text),chains=texts.map(chain);
  const uncertainty=chains.flatMap((c,i)=>c.reason?[{layerIds:[texts[i]!.id],reason:c.reason,readOnly:true as const}]:[]);
  const area=(p:Point[])=>Math.abs(p.reduce((v,a,i)=>{const b=p[(i+1)%p.length]!;return v+a.x*b.y-b.x*a.y;},0))/2;
  const cross=(a:Point,b:Point,p:Point)=>(b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);
  const intersection=(subject:Point[],clip:Point[])=>{let result=subject;
    for(let i=0;i<clip.length&&result.length;i++){const a=clip[i]!,b=clip[(i+1)%clip.length]!,input=result;result=[];
      for(let j=0;j<input.length;j++){const p=input[j]!,q=input[(j+1)%input.length]!,u=cross(a,b,p),v=cross(a,b,q);
        if(u>=0)result.push(p);
        if((u>=0)!==(v>=0)){const t=u/(u-v);result.push({x:p.x+(q.x-p.x)*t,y:p.y+(q.y-p.y)*t});}}
    }return result.length>=3?area(result):0;};
  const state=(l:Layer,t:number)=>artworkObjectState(artwork,l,t);
  const coverage=(c:Layer[],t:number)=>c.reduce((v,l)=>{const p=state(l,t);return v*p.opacity*p.draw*(p.scale>0?1:0);},1);
  const polygon=(l:Layer,c:Layer[],t:number)=>{let points=[{x:l.x,y:l.y},{x:l.x+l.w,y:l.y},{x:l.x+l.w,y:l.y+l.h},{x:l.x,y:l.y+l.h}];
    for(const item of c){const p=state(item,t),cx=item.x+item.w/2,cy=item.y+item.h/2,r=p.rotation*Math.PI/180;
      points=points.map(q=>{const x=(q.x-cx)*p.scale,y=(q.y-cy)*p.scale;return {x:cx+p.x+x*Math.cos(r)-y*Math.sin(r),y:cy+p.y+x*Math.sin(r)+y*Math.cos(r)};});}
    return points;};
  const encounters:Array<{kind:'declared-box-candidate';layerIds:string[];firstFrame:number;lastFrame:number;from:number;to:number;seconds:number;maxOverlapArea:number;witness:{frame:number;t:number};subsequentSeparateHold:{firstFrame:number;lastFrame:number;seconds:number}|null;readOnly:false}>=[];
  for(let i=0;i<texts.length;i++)for(let j=i+1;j<texts.length;j++){
    const a=texts[i]!,b=texts[j]!,ca=chains[i]!,cb=chains[j]!;
    if(ca.reason||cb.reason||[a,b].some(l=>l.fill==='none'||l.fill==='transparent'))continue;
    const common=ca.layers.find(l=>cb.layers.includes(l));
    const ac=common?ca.layers.slice(0,ca.layers.indexOf(common)):ca.layers,bc=common?cb.layers.slice(0,cb.layers.indexOf(common)):cb.layers;
    // Include action/key boundaries as well as every actual renderer frame.
    const times=[...new Set([...Array.from({length:frames},(_,f)=>f/Math.max(1,frames-1)),
      ...[...ac,...bc].flatMap(l=>(l.keyframes??[]).map(k=>k.t)),...(artwork.actions??[]).filter(a=>[...ac,...bc].some(l=>l.id===a.layerId)).flatMap(a=>[a.start,a.end])])].sort((a,b)=>a-b);
    const poses=times.map(t=>{const p=polygon(a,ac,t),q=polygon(b,bc,t),visible=coverage(ca.layers,t)>0&&coverage(cb.layers,t)>0;return {t,p,q,visible,
      overlap:visible?intersection(p,q):0,
      readable:coverage(ca.layers,t)>=.9&&coverage(cb.layers,t)>=.9};});
    const relative=(p:typeof poses[number])=>{const o=p.q[0]!,u={x:p.q[1]!.x-o.x,y:p.q[1]!.y-o.y},v={x:p.q[3]!.x-o.x,y:p.q[3]!.y-o.y},det=u.x*v.y-u.y*v.x;
      if(Math.abs(det)<1e-9)return [];
      return p.p.flatMap(q=>[((q.x-o.x)*v.y-(q.y-o.y)*v.x)/det*b.w,(u.x*(q.y-o.y)-u.y*(q.x-o.x))/det*b.h]);};
    const visiblePoses=poses.filter(p=>p.visible),origin=visiblePoses.map(relative).find(p=>p.length);if(!origin)continue;
    if(!visiblePoses.some(p=>relative(p).some((n,k)=>Math.abs(n-origin[k]!)>.01)))continue;
    const byTime=new Map(poses.map(p=>[p.t,p]));
    const grid=Array.from({length:frames},(_,f)=>byTime.get(f/Math.max(1,frames-1))!);
    for(let k=0;k<grid.length;k++){
      if(grid[k]!.overlap<=1e-7)continue;
      const first=k;while(k+1<grid.length&&grid[k+1]!.overlap>1e-7)k++;
      const last=k,hits=grid.slice(first,last+1),maximum=Math.max(...hits.map(p=>p.overlap));
      // A hidden reposition cannot prove motion during a later static fade-in.
      // Visible neighbours still establish an actual arrival/departure at contact.
      const visibleContact=grid.slice(Math.max(0,first-1),Math.min(grid.length,last+2)).filter(p=>p.visible);
      const atEntry=visibleContact.map(relative).find(p=>p.length);if(!atEntry)continue;
      if(!visibleContact.some(p=>relative(p).some((n,index)=>Math.abs(n-atEntry[index]!)>.01)))continue;
      const witnesses=hits.filter(p=>p.overlap>=maximum-.001),witness=witnesses.find(p=>preferred.some(t=>Math.abs(t-p.t)<1e-7))??witnesses[0]!;
      let hold:typeof encounters[number]['subsequentSeparateHold']=null,start:number|undefined;
      for(let h=last+1;h<grid.length;h++){
        const p=grid[h]!,prev=grid[start??h]!;
        const stable=p.p.every((v,n)=>Math.hypot(v.x-prev.p[n]!.x,v.y-prev.p[n]!.y)<3)&&p.q.every((v,n)=>Math.hypot(v.x-prev.q[n]!.x,v.y-prev.q[n]!.y)<3);
        if(p.overlap<=1e-7&&p.readable&&stable){start??=h;const seconds=(h-start)/30;
          if(seconds>0&&(!hold||seconds>hold.seconds))hold={firstFrame:start,lastFrame:h,seconds:round(seconds)};
        }else start=undefined;
      }
      encounters.push({kind:'declared-box-candidate',layerIds:[a.id,b.id],firstFrame:first,lastFrame:last,from:grid[first]!.t,to:grid[last]!.t,
        seconds:round((last-first+1)/30),maxOverlapArea:round(maximum),witness:{frame:Math.round(witness.t*(frames-1)),t:witness.t},subsequentSeparateHold:hold,readOnly:false});
    }
  }
  return {textTransitEncounters:encounters,textTransitUncertainty:uncertainty};
}
/** Use the renderer's interpolation and the actual normalized clock. These
 * diagnostics identify concrete failures; their absence is NOT artistic PASS. */
export function reviewArtworkTemporal(artwork:Artwork,sceneDirection?:DocumentarySceneDirection,previous?:Artwork,previewTimes?:number[]) {
  const findings:ArtworkTemporalFinding[]=[];
  const add=(code:string,layers:string[],problem:string,repair:string,at?:number)=>findings.push({code,layers,problem,repair,...(at!==undefined?{at:round(at)}:{})});
  const byId=new Map(artwork.layers.map(l=>[l.id,l])),area=artwork.canvas.width*artwork.canvas.height;
  const ancestors=(l:Layer)=>{const out:Layer[]=[];let parent=l.parentId;for(let i=0;parent&&i<4;i++){const p=byId.get(parent);if(!p)break;out.push(p);parent=p.parentId;}return out;};
  const solid=(l:Layer)=>l.kind!=='text'&&l.kind!=='media'&&l.kind!=='group'
    &&l.w*l.h>area*.0006&&l.w*l.h<area*.9
    &&(l.kind==='path'?/[zZ]/u.test(l.path??'')||((l.path?.match(/[a-df-z]/giu)??[]).length>4&&l.fill!=='none')
      :l.fill!==undefined&&l.fill!=='none');
  const subjects=artwork.layers.filter(solid);
  const carriers=artwork.layers.filter(l=>solid(l)||l.kind==='group'&&subjects.some(s=>ancestors(s).includes(l)));
  // Remove camera and parallax to measure object changes, not a tour of static art.
  const intrinsic={...artwork,camera:undefined,layers:artwork.layers.map(l=>({...l,depth:0}))};
  const layerState=(l:Layer,t:number)=>artworkObjectState(intrinsic,{...l,depth:0},t);
  const coverage=(l:Layer,t:number)=>[l,...ancestors(l)].reduce((v,item)=>{
    const p=layerState(item,t);return v*p.opacity*p.draw*(p.scale>.04?1:0);
  },1);
  const visible=(l:Layer,t:number)=>coverage(l,t)>.15;
  const inheritedPose=(l:Layer,t:number)=>{
    const own=layerState(l,t);let x=l.x+l.w/2+own.x,y=l.y+l.h/2+own.y,scale=own.scale,rotation=own.rotation;
    for(const parent of ancestors(l)){
      const p=layerState(parent,t),cx=parent.x+parent.w/2,cy=parent.y+parent.h/2,angle=p.rotation*Math.PI/180;
      const dx=(x-cx)*p.scale,dy=(y-cy)*p.scale;
      x=cx+p.x+dx*Math.cos(angle)-dy*Math.sin(angle);y=cy+p.y+dx*Math.sin(angle)+dy*Math.cos(angle);
      scale*=p.scale;rotation+=p.rotation;
    }
    return {x,y,scale,rotation};
  };
  const phases=[...new Set([0,.04,.18,.48,.76,.88,1,...(artwork.direction?.beats.map(b=>b.at)??[]),
    ...artwork.layers.flatMap(l=>(l.keyframes??[]).map(k=>k.t)),...(artwork.actions??[]).flatMap(a=>[a.start,(a.start+a.end)/2,a.end])])].sort((a,b)=>a-b);
  const changes:Array<{layerId:string;from:number;to:number;kind:'transform'|'accumulation'}>=[];
  const reveals:Array<{layerId:string;from:number;to:number;coverageFrom:number;coverageTo:number}>=[];
  for(const l of carriers)for(let i=1;i<phases.length;i++){
    const a=phases[i-1]!,b=phases[i]!,before=layerState(l,a),after=layerState(l,b);
    if(b<=.08||a>=.8||!visible(l,(a+b)/2))continue;
    const transform=Math.hypot(after.x-before.x,after.y-before.y)>Math.hypot(artwork.canvas.width,artwork.canvas.height)*.008
      ||Math.abs(after.scale-before.scale)>.035||Math.abs(after.rotation-before.rotation)>3;
    const coverageFrom=coverage(l,a),coverageTo=coverage(l,b);
    if(Math.abs(coverageTo-coverageFrom)>.18)reveals.push({layerId:l.id,from:round(a),to:round(b),coverageFrom:round(coverageFrom),coverageTo:round(coverageTo)});
    // A board entrance can move every shape while leaving its argument static.
    // Measure a changed relation to a separately visible subject, excluding
    // descendants carried by the very same group transform.
    const relational=transform&&subjects.some(other=>{
      if(other.id===l.id||ancestors(other).includes(l)||!visible(other,a)||!visible(other,b))return false;
      const p=inheritedPose(l,a),q=inheritedPose(l,b),r=inheritedPose(other,a),s=inheritedPose(other,b);
      return Math.hypot((q.x-s.x)-(p.x-r.x),(q.y-s.y)-(p.y-r.y))>Math.hypot(artwork.canvas.width,artwork.canvas.height)*.008
        ||Math.abs(q.scale/Math.max(.01,s.scale)-p.scale/Math.max(.01,r.scale))>.035
        ||Math.abs((q.rotation-s.rotation)-(p.rotation-r.rotation))>3;
    });
    if(relational)changes.push({layerId:l.id,from:round(a),to:round(b),kind:'transform'});
  }
  // Opacity/draw are observations, not proof of a changed argument. A useful
  // repeated-unit accumulation is different: an established compact collection
  // gains matching, separately visible units in successive actual states. Do
  // not infer accumulation from a caption/beat name or one newly faded-in bar.
  // Open strokes are not general subjects: a connector moving/fading is not
  // object action. Compact, visibly painted units may nevertheless form the
  // same repeated collection as filled shapes. Only the accumulation test
  // below may promote them, after multiple separately observed additions.
  const strokeUnits=artwork.layers.filter(l=>l.kind==='path'&&l.fill==='none'
    &&!/[zZ]/u.test(l.path??'')&&Boolean(l.path?.trim())
    &&Boolean(l.stroke&&l.stroke!=='none'&&l.stroke!=='transparent')
    &&Number.isFinite(l.strokeWidth)&&l.strokeWidth!>0
    &&Math.min(l.w,l.h)>=l.strokeWidth!*1.5
    &&l.w*l.h>area*.0006&&l.w*l.h<area*.04
    &&l.w<=artwork.canvas.width*.5&&l.h<=artwork.canvas.height*.5);
  const remaining=new Set([...subjects,...strokeUnits]);
  const matchingNeighbours=(a:Layer,b:Layer)=>{
    if(a.kind!==b.kind||a.fill!==b.fill||a.stroke!==b.stroke||a.strokeWidth!==b.strokeWidth||a.path!==b.path
      ||Math.abs(a.w-b.w)>Math.max(a.w,b.w)*.03||Math.abs(a.h-b.h)>Math.max(a.h,b.h)*.03)return false;
    // Classify neighbours while both units are actually visible. A later
    // scale-exit must not erase their earlier accumulated spatial relation.
    return phases.some(t=>{
      if(t>.8||coverage(a,t)<.9||coverage(b,t)<.9)return false;
      const p=inheritedPose(a,t),q=inheritedPose(b,t),w=a.w*p.scale,h=a.h*p.scale;
      return Math.hypot(p.x-q.x,p.y-q.y)<=Math.max(w,h)*1.8
        &&(Math.abs(p.x-q.x)>=w*.65||Math.abs(p.y-q.y)>=h*.65);
    });
  };
  while(remaining.size){
    const cluster=[remaining.values().next().value!];remaining.delete(cluster[0]!);
    for(let i=0;i<cluster.length;i++)for(const l of remaining)if(matchingNeighbours(cluster[i]!,l)){cluster.push(l);remaining.delete(l);}
    if(cluster.length<3)continue;
    const states=phases.filter(t=>t<=.8).map(t=>({t,ids:cluster.filter(l=>coverage(l,t)>=.9).map(l=>l.id)}));
    let increments:Array<{state:typeof states[number];before:typeof states[number]}>=[];
    for(let i=1;i<states.length;i++){
      const state=states[i]!,before=states[i-1]!;
      if(before.ids.some(id=>!state.ids.includes(id)))increments=[];
      else if(before.ids.length&&state.ids.length>before.ids.length)increments.push({state,before});
      // The established collection can later exit; that does not erase the
      // earlier continuous accumulation, just as a label may finish and leave.
      if(increments.length>=2){
        for(const step of increments)for(const id of step.state.ids.filter(id=>!step.before.ids.includes(id)))
          changes.push({layerId:id,from:round(step.before.t),to:round(step.state.t),kind:'accumulation'});
        break;
      }
    }
  }
  if(!(artwork.linkedMechanism&&(artwork.linkedMechanism.turns??1)>0)&&!changes.length)add('no-object-state-change',carriers.map(l=>l.id),
    'The pictured objects do not visibly change their relationship during the explanation. Captions, connector drawing, fades and camera drift carry all the activity.',
    'Restage the selected idea around a visible object transfer, accumulation, connection, displacement or sequential supported state. Keep a readable held result. Do not add decorative layers.');
  for(const action of artwork.actions??[]){
    const l=byId.get(action.layerId);if(!l)continue;
    if(![action.start,(action.start+action.end)/2,action.end].some(t=>visible(l,t)))add('invisible-action',[l.id],
      `Action ${action.id} happens while its object or parent is hidden.`, 'Make the meaningful travel/contact visible; a hidden reposition followed by fade is not that action.',action.end);
  }
  for(const beat of artwork.direction?.beats??[])if(beat.layerIds?.length){
    const missing=beat.layerIds.filter(id=>!byId.has(id));
    if(missing.length)add('missing-beat-object',missing,'Storyboard names objects that are not rendered.','Bind the beat to actual layer IDs and enact its state change.',beat.at);
  }
  if(artwork.direction?.beats.length&&!artwork.direction.beats.some(b=>b.layerIds?.length))add('unbound-storyboard',[],
    'The storyboard does not identify any rendered objects for its observations.','Bind direction.beats.layerIds to the real objects/actions, then compare their actual states in the supplied phases.');
  const s=sceneDirection?.storyboard;
  const camera=phases.map(t=>artworkCameraState(artwork,t));
  const cameraTravel=Math.max(...camera.map(p=>Math.hypot(p.x-camera[0]!.x,p.y-camera[0]!.y)))/Math.hypot(artwork.canvas.width,artwork.canvas.height);
  const cameraScale=Math.max(...camera.map(p=>p.scale))-Math.min(...camera.map(p=>p.scale));
  if(s&&s.camera.mode!=='hold'&&(cameraTravel<.025&&cameraScale<.12))add('camera-purpose-not-executed',[],
    `Chosen ${s.camera.mode} camera is absent or only a small zoom: ${s.camera.purpose}`,
    'Author an executable continuous camera path with motivated change of framing; protect text and the final reading hold.');
  const depths=[...new Set(artwork.layers.filter(l=>l.kind!=='text'&&l.kind!=='media').map(l=>l.depth??0))];
  if(s?.depth.mode==='layered'&&(depths.length<2||Math.max(...depths)-Math.min(...depths)<.25||cameraTravel<.025))add('depth-purpose-not-executed',[],
    `Chosen layered staging has no meaningful relative parallax: ${s.depth.purpose}`,'Separate the relevant objects/planes in supported depth and motivate camera travel, or select honest flat staging.');
  if(s?.typography.mode==='action'&&!artwork.layers.filter(l=>l.kind==='text').some(l=>phases.some(t=>{
    const a=inheritedPose(l,t),b=inheritedPose(l,1);return visible(l,t)&&(Math.hypot(a.x-b.x,a.y-b.y)>10||Math.abs(a.rotation-b.rotation)>5||Math.abs(a.scale-b.scale)>.08);
  })))add('typography-purpose-not-executed',artwork.layers.filter(l=>l.kind==='text').map(l=>l.id),
    `The selected active typography is only static/faded wording: ${s.typography.purpose}`,'Enact a purposeful word/group action with a settled reading state, or choose a truthful label-only treatment.');
  const readingHolds:Array<{layerId:string;from:number;to:number;seconds:number;requiredSeconds:number}>=[];
  const readingFrames=Math.max(1,Math.ceil(artwork.durationSeconds*30));
  const readingTimes=[...new Set([...phases,...Array.from({length:readingFrames+1},(_,i)=>i/readingFrames)])].sort((a,b)=>a-b);
  for(const l of artwork.layers.filter(l=>l.kind==='text'&&l.text)){
    // Find one continuous readable window, including an authored exit. Never
    // add disconnected flashes or compare every earlier pose to a hidden t=1.
    let start:number|undefined,anchor:ReturnType<typeof inheritedPose>|undefined,last=0,best={from:0,to:0};
    const finish=()=>{if(start!==undefined&&last-start>best.to-best.from)best={from:start,to:last};};
    for(const t of readingTimes){
      const pose=inheritedPose(l,t),readable=coverage(l,t)>=.9;
      const stable=anchor&&Math.hypot(pose.x-anchor.x,pose.y-anchor.y)<3&&Math.abs(pose.scale-anchor.scale)<.01&&Math.abs(pose.rotation-anchor.rotation)<1;
      if(!readable||!stable){finish();start=readable?t:undefined;anchor=readable?pose:undefined;}
      last=t;
    }
    finish();
    const available=(best.to-best.from)*artwork.durationSeconds,required=Math.min(4,Math.max(1.2,.5+l.text!.trim().split(/\s+/u).length/3));
    readingHolds.push({layerId:l.id,from:round(best.from),to:round(best.to),seconds:round(available),requiredSeconds:round(required)});
    if(available+.1<required)add('short-reading-hold',[l.id],`Wording has ${round(available)}s of continuous settled reading; practical target ${round(required)}s.`,
      'Give this wording a continuous stable visible window before its authored exit, or shorten the exact narration excerpt; never shorten speech.',best.from);
  }
  const signature=()=>changes.filter((c,i)=>!i||c.layerId!==changes[i-1]!.layerId).map(c=>byId.get(c.layerId)?.kind+':'+c.kind).join('>');
  if(previous){
    const prior=reviewArtworkTemporal(previous);
    if(changes.length&&prior.signature===signature()&&artwork.direction?.concept===previous.direction?.concept)add('repeated-staging',[],
      'Adjacent artwork repeats the same concept and executable observation sequence.','Choose a different useful alternative, viewpoint or order of observations; preserve palette and factual meaning.');
  }
  const reportTimes=previewTimes??artworkTemporalSampleTimes(artwork,Math.max(2,Math.round(artwork.durationSeconds*30)));
  const changedIds=new Set(changes.map(c=>c.layerId)),reported=[...carriers].sort((a,b)=>Number(changedIds.has(b.id))-Number(changedIds.has(a.id))).slice(0,8);
  return {scope:'renderer-state-diagnostics-not-artistic-verdict' as const,findings,changes,reveals,readingHolds,signature:signature(),
    ...textTransitReview(artwork,Math.max(2,Math.round(artwork.durationSeconds*30)),reportTimes),
    entry:{t:0,camera:camera[0]},exit:{t:1,camera:camera.at(-1)},cameraTravel:round(cameraTravel),cameraScale:round(cameraScale),depths,
    phases:reportTimes.map(t=>({t:round(t),objects:reported.map(l=>({id:l.id,visible:visible(l,t),
      ...Object.fromEntries(Object.entries(layerState(l,t)).map(([k,v])=>[k,round(v)]))}))}))};
}

/** At most twenty-five images: actual action midpoint/contact and both sides of every
 * eligible scene join, in addition to observation and held-result phases. */
export function artworkTemporalSampleTimes(artwork:Artwork,frames:number,boundary?:number|number[]):number[]{
  const step=1/Math.max(1,frames-1),samples=[.04,.48,.88];
  const actions=[...(artwork.actions??[])].sort((a,b)=>Number(Boolean(b.after))-Number(Boolean(a.after)));
  for(const a of actions.slice(0,2))samples.push((a.start+a.end)/2,Math.max(0,a.end-step),a.end,Math.min(1,a.end+step));
  if(boundary!==undefined)for(const at of Array.isArray(boundary)?boundary:[boundary])samples.push(Math.max(0,at-step),at);
  else if(!actions.length)for(const b of artwork.direction?.beats.slice(1,3)??[])samples.push(Math.max(0,b.at-step),b.at,Math.min(1,b.at+step));
  // Keep contact neighborhoods plus a join within the bounded image budget.
  const existing=[...new Set(samples.map(t=>Math.round(Math.max(0,Math.min(1,t))*(frames-1))))].sort((a,b)=>a-b).map(frame=>frame/Math.max(1,frames-1));
  const strongest=textTransitReview(artwork,frames,existing).textTransitEncounters.sort((a,b)=>b.maxOverlapArea-a.maxOverlapArea)[0];
  if(strongest&&existing.length<25&&!existing.includes(strongest.witness.t))existing.push(strongest.witness.t);
  return existing.sort((a,b)=>a-b);
}
